const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const { checkHooks, getHooksConfig } = require('./hooks');

// ── State ──────────────────────────────────────────────────────────────────────

const watchedFiles = new Map(); // path → { offset, lineBuffer, watcher, interval }
const knownSessions = new Set();
const endedSessions = new Set(); // sessions that have ended (SessionEnd received)
const sessionLastSeen = new Map(); // sessionId → timestamp of last hook event
const sessionTranscripts = new Map(); // sessionId → transcript file path
const sessionXp = new Map(); // sessionId → number
const sessionSpecies = new Map(); // sessionId → species index
const recentlyCleared = new Map(); // sessionId → { timestamp, speciesIndex, xp }
let speciesCounter = 0;
let wss = null;
let server = null;

// ── XP persistence ─────────────────────────────────────────────────────────────

const DATA_DIR = path.join(os.homedir(), '.pokeclaw');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
let saveTimer = null;

const MAX_XP_ENTRIES = 10000;

function loadSessionData() {
  try {
    // Refuse to read symlinks
    const stat = fs.lstatSync(DATA_FILE);
    if (!stat.isFile()) return;
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    let count = 0;
    if (data && typeof data.xp === 'object') {
      for (const [id, xp] of Object.entries(data.xp)) {
        if (count >= MAX_XP_ENTRIES) break;
        if (typeof xp === 'number' && xp > 0) { sessionXp.set(id, xp); count++; }
      }
    }
    if (data && typeof data.species === 'object') {
      let sCount = 0;
      for (const [id, idx] of Object.entries(data.species)) {
        if (sCount >= MAX_XP_ENTRIES) break;
        if (typeof idx === 'number' && idx >= 0) { sessionSpecies.set(id, idx); sCount++; }
      }
    }
    if (typeof data.speciesCounter === 'number') speciesCounter = data.speciesCounter;
  } catch (e) { /* file missing or corrupt, start fresh */ }
}

function saveSessionData() {
  if (saveTimer) return; // already scheduled
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const data = {
      xp: Object.fromEntries(sessionXp),
      species: Object.fromEntries(sessionSpecies),
      speciesCounter
    };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      // Remove existing file first to avoid writing through symlinks
      try { fs.unlinkSync(DATA_FILE); } catch (e) {}
      fs.writeFileSync(DATA_FILE, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    } catch (e) { /* ignore write errors */ }
  }, 2000); // debounce 2s
}

function getSpeciesIndex(sessionId) {
  if (sessionSpecies.has(sessionId)) return sessionSpecies.get(sessionId);
  const idx = speciesCounter++;
  sessionSpecies.set(sessionId, idx);
  saveSessionData();
  return idx;
}

function addXp(sessionId) {
  const current = sessionXp.get(sessionId) || 0;
  sessionXp.set(sessionId, current + 1);
  saveSessionData();
  return current + 1;
}

// ── Tool → status mapping ──────────────────────────────────────────────────────

function toolStatus(toolName, toolInput) {
  const input = toolInput || {};
  const basename = (p) => p ? path.basename(String(p)) : '';
  switch (toolName) {
    case 'Read':   return `Reading ${basename(input.file_path)}`;
    case 'Edit':   return `Editing ${basename(input.file_path)}`;
    case 'Write':  return `Writing ${basename(input.file_path)}`;
    case 'Bash': {
      const cmd = String(input.command || '').slice(0, 50);
      return `Running: ${cmd}${(input.command || '').length > 50 ? '…' : ''}`;
    }
    case 'Grep':   return 'Searching code';
    case 'Glob':   return 'Searching files';
    case 'Task':   return 'Running subtask';
    default:       return `Using ${toolName}`;
  }
}

// ── WebSocket broadcast ────────────────────────────────────────────────────────

function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(data); } catch (e) { /* ignore */ }
    }
  }
}

// ── JSONL parsing ──────────────────────────────────────────────────────────────

function extractSessionId(filePath) {
  const base = path.basename(filePath, '.jsonl');
  return base;
}

function processLine(line, sessionId) {
  let obj;
  try { obj = JSON.parse(line); } catch (e) { return; }
  if (!obj || !obj.type) return;

  // Don't broadcast events for sessions that have ended
  if (endedSessions.has(sessionId)) return;

  if (!knownSessions.has(sessionId)) {
    knownSessions.add(sessionId);
    broadcast({ type: 'session_discovered', sessionId, xp: sessionXp.get(sessionId) || 0, speciesIndex: getSpeciesIndex(sessionId) });
  }

  if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
    let hasToolUse = false;
    for (const block of obj.message.content) {
      if (block.type === 'tool_use') {
        hasToolUse = true;
        const status = toolStatus(block.name, block.input);
        const xp = addXp(sessionId);
        broadcast({
          type: 'tool_start',
          sessionId,
          toolId: block.id || '',
          toolName: block.name || 'unknown',
          status,
          xp
        });
      }
    }
    if (!hasToolUse) {
      // Text-only assistant response
      broadcast({ type: 'agent_active', sessionId });
    }
    return;
  }

  if (obj.type === 'user' && obj.message) {
    const content = obj.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result') {
          broadcast({
            type: 'tool_done',
            sessionId,
            toolId: block.tool_use_id || ''
          });
        }
      }
    } else if (typeof content === 'string') {
      broadcast({ type: 'new_turn', sessionId });
    }
    return;
  }

  if (obj.type === 'system' && obj.subtype === 'turn_duration') {
    broadcast({ type: 'turn_end', sessionId });
    return;
  }

  if (obj.type === 'progress' && obj.data) {
    broadcast({ type: 'agent_active', sessionId });
    return;
  }
}

// ── File watching ──────────────────────────────────────────────────────────────

function readNewLines(filePath) {
  const state = watchedFiles.get(filePath);
  if (!state) return;

  let stat;
  try { stat = fs.statSync(filePath); } catch (e) { return; }

  if (stat.size <= state.offset) return;

  const bufSize = stat.size - state.offset;
  if (bufSize > 10 * 1024 * 1024) return; // skip reads > 10 MB
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(bufSize);
    fs.readSync(fd, buf, 0, bufSize, state.offset);
    fs.closeSync(fd);
    state.offset = stat.size;
    state.lineBuffer += buf.toString('utf8');
  } catch (e) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e2) {}
    return;
  }

  const lines = state.lineBuffer.split('\n');
  state.lineBuffer = lines.pop(); // keep incomplete last fragment

  const sessionId = extractSessionId(filePath);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) processLine(trimmed, sessionId);
  }
}

function watchFile(filePath, { announce = false } = {}) {
  if (watchedFiles.has(filePath)) return;

  let stat;
  try { stat = fs.statSync(filePath); } catch (e) { return; }

  const state = {
    offset: stat.size, // skip existing content
    lineBuffer: '',
    watcher: null,
    interval: null
  };

  try {
    state.watcher = fs.watch(filePath, () => readNewLines(filePath));
    state.watcher.on('error', () => {});
  } catch (e) { /* fs.watch may not work on all platforms */ }

  state.interval = setInterval(() => readNewLines(filePath), 2000);

  watchedFiles.set(filePath, state);

  // When hooks are configured, only announce sessions discovered via hooks
  // to avoid showing dead sessions. Without hooks, fall back to JSONL scanning.
  if (announce || !checkHooksConfigured()) {
    const sessionId = extractSessionId(filePath);
    if (!knownSessions.has(sessionId)) {
      knownSessions.add(sessionId);
      broadcast({ type: 'session_discovered', sessionId, xp: sessionXp.get(sessionId) || 0, speciesIndex: getSpeciesIndex(sessionId) });
    }
    console.log(`  ◈ Watching ${path.basename(filePath)}`);
  }
}

function unwatchFile(filePath) {
  const state = watchedFiles.get(filePath);
  if (!state) return;
  if (state.watcher) try { state.watcher.close(); } catch (e) {}
  if (state.interval) clearInterval(state.interval);
  watchedFiles.delete(filePath);
}

function unwatchAll() {
  for (const filePath of watchedFiles.keys()) {
    unwatchFile(filePath);
  }
}

// ── Project scanning ───────────────────────────────────────────────────────────

function scanProjects() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  let projectDirs;
  try { projectDirs = fs.readdirSync(claudeDir); } catch (e) { return; }

  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours

  for (const projDir of projectDirs) {
    const projPath = path.join(claudeDir, projDir);
    let stat;
    try { stat = fs.statSync(projPath); } catch (e) { continue; }
    if (!stat.isDirectory()) continue;

    let files;
    try { files = fs.readdirSync(projPath); } catch (e) { continue; }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(projPath, file);

      let fstat;
      try { fstat = fs.statSync(filePath); } catch (e) { continue; }

      if (fstat.mtimeMs < cutoff) continue;

      watchFile(filePath);
    }
  }
}

// ── Hooks (uses shared hooks.js module) ─────────────────────────────────────

function checkHooksConfigured() {
  return checkHooks().installed;
}

// ── Hook event handling ────────────────────────────────────────────────────────

function handleHook(body) {
  let data;
  try { data = JSON.parse(body); } catch (e) { return; }
  if (!data) return;

  const sessionId = data.session_id || 'unknown';
  const hookName = data.hook_event_name || '';

  // Clear ended state if a new hook event arrives (session restarted)
  if (hookName !== 'SessionEnd') {
    endedSessions.delete(sessionId);
    sessionLastSeen.set(sessionId, Date.now());
  }

  if (!knownSessions.has(sessionId)) {
    knownSessions.add(sessionId);
    broadcast({ type: 'session_discovered', sessionId, xp: sessionXp.get(sessionId) || 0, speciesIndex: getSpeciesIndex(sessionId) });
  }

  // Auto-watch transcript if provided (restrict to ~/.claude/projects/)
  if (data.transcript_path) {
    try {
      const tp = path.resolve(String(data.transcript_path));
      const allowedDir = path.join(os.homedir(), '.claude', 'projects');
      if (tp.endsWith('.jsonl') && tp.startsWith(allowedDir + path.sep) && fs.existsSync(tp)) {
        watchFile(tp, { announce: true });
        sessionTranscripts.set(sessionId, tp);
      }
    } catch (e) {}
  }

  switch (hookName) {
    case 'PreToolUse': {
      const toolName = data.tool_name || 'unknown';
      const status = toolStatus(toolName, data.tool_input);
      const xp = addXp(sessionId);
      broadcast({
        type: 'hook_tool_start',
        sessionId,
        toolName,
        status,
        xp
      });
      break;
    }
    case 'PostToolUse': {
      broadcast({
        type: 'hook_tool_done',
        sessionId,
        toolName: data.tool_name || 'unknown'
      });
      break;
    }
    case 'Stop': {
      broadcast({ type: 'hook_stop', sessionId });
      break;
    }
    case 'Notification': {
      broadcast({
        type: 'hook_notification',
        sessionId,
        notificationType: data.notification_type || '',
        message: data.message || '',
        title: data.title || ''
      });
      break;
    }
    case 'SubagentStart': {
      broadcast({
        type: 'hook_subagent_start',
        sessionId,
        agentId: data.agent_id || '',
        agentType: data.agent_type || ''
      });
      break;
    }
    case 'SubagentStop': {
      broadcast({
        type: 'hook_subagent_stop',
        sessionId,
        agentId: data.agent_id || ''
      });
      break;
    }
    case 'UserPromptSubmit': {
      broadcast({ type: 'hook_new_turn', sessionId });
      break;
    }
    case 'SessionStart': {
      // Session started or resumed (e.g. after /clear)
      endedSessions.delete(sessionId);

      // Clean up stale sessions that never got a SessionEnd (e.g. ctrl+C'd instances).
      // Only clean up sessions with no hook activity in the last 30s to avoid
      // killing legitimate parallel sessions.
      const staleThreshold = Date.now() - 30 * 1000;
      for (const [oldId, lastSeen] of sessionLastSeen) {
        if (oldId === sessionId || endedSessions.has(oldId)) continue;
        if (lastSeen < staleThreshold) {
          endedSessions.add(oldId);
          const tp = sessionTranscripts.get(oldId);
          if (tp) { unwatchFile(tp); sessionTranscripts.delete(oldId); }
          broadcast({ type: 'hook_session_end', sessionId: oldId, reason: 'stale' });
        }
      }

      // Check if this follows a /clear — transfer the old creature to this new session
      let replacesSessionId = null;
      for (const [oldId, info] of recentlyCleared) {
        // Clean up stale entries (older than 10s)
        if (Date.now() - info.timestamp > 10000) {
          recentlyCleared.delete(oldId);
          continue;
        }
        replacesSessionId = oldId;
        // Transfer species and XP to new session
        if (typeof info.speciesIndex === 'number') sessionSpecies.set(sessionId, info.speciesIndex);
        if (info.xp > 0) sessionXp.set(sessionId, info.xp);
        recentlyCleared.delete(oldId);
        saveSessionData();
        break;
      }

      broadcast({ type: 'hook_session_start', sessionId, replacesSessionId, xp: sessionXp.get(sessionId) || 0, speciesIndex: getSpeciesIndex(sessionId) });
      break;
    }
    case 'SessionEnd': {
      const reason = data.reason || '';
      // /clear triggers SessionEnd followed by SessionStart with a NEW session ID.
      // Store the old session so we can transfer the creature to the new session.
      if (reason === 'clear') {
        recentlyCleared.set(sessionId, {
          timestamp: Date.now(),
          speciesIndex: sessionSpecies.get(sessionId),
          xp: sessionXp.get(sessionId) || 0
        });
        endedSessions.add(sessionId);
        broadcast({ type: 'hook_session_clear', sessionId });
        break;
      }
      endedSessions.add(sessionId);
      // Stop watching the transcript file to prevent stale events
      const tp = sessionTranscripts.get(sessionId);
      if (tp) {
        unwatchFile(tp);
        sessionTranscripts.delete(sessionId);
      }
      broadcast({ type: 'hook_session_end', sessionId, reason });
      break;
    }
    default: {
      broadcast({
        type: 'hook_event',
        sessionId,
        hookName
      });
      break;
    }
  }
}

// ── HTTP server ────────────────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function startServer({ port, open }) {
  server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /hook
    if (req.method === 'POST' && req.url === '/hook') {
      let body = '';
      let bodySize = 0;
      const MAX_BODY = 1024 * 1024; // 1 MB
      req.on('data', (chunk) => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end('{"error":"payload too large"}');
          req.destroy();
          return;
        }
        body += chunk;
      });
      req.on('end', () => {
        if (bodySize > MAX_BODY) return;
        handleHook(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }

    // GET /api/status
    if (req.method === 'GET' && req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        hooksConfigured: checkHooksConfigured(),
        watchedFiles: watchedFiles.size,
        knownSessions: knownSessions.size
      }));
      return;
    }

    // GET /api/hooks-config
    if (req.method === 'GET' && req.url === '/api/hooks-config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getHooksConfig(port), null, 2));
      return;
    }

    // Static files
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, '..', 'public', filePath);
    filePath = path.normalize(filePath);

    // Security: prevent directory traversal
    const publicDir = path.resolve(path.join(__dirname, '..', 'public'));
    if (!path.resolve(filePath).startsWith(publicDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath);
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    });
  });

  wss = new WebSocketServer({ server, verifyClient: ({ origin, req }) => {
    // Allow connections with no origin (non-browser clients like curl)
    if (!origin) return true;
    // Allow same-host origins
    const host = req.headers.host || '';
    return origin === `http://${host}` || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
  }});

  wss.on('connection', (ws) => {
    // Send all known active sessions to new client (skip ended ones)
    const hooksActive = checkHooksConfigured();
    const staleCutoff = Date.now() - 10 * 60 * 1000; // 10 minutes
    for (const sessionId of knownSessions) {
      if (endedSessions.has(sessionId)) continue;
      // When hooks are configured, only send sessions seen via hooks recently
      // (avoids stale sessions from ctrl+C'd instances that never sent SessionEnd)
      if (hooksActive) {
        const lastSeen = sessionLastSeen.get(sessionId);
        if (!lastSeen || lastSeen < staleCutoff) continue;
      }
      try {
        ws.send(JSON.stringify({ type: 'session_discovered', sessionId, xp: sessionXp.get(sessionId) || 0, speciesIndex: getSpeciesIndex(sessionId) }));
      } catch (e) {}
    }
  });

  loadSessionData();

  server.listen(port, '127.0.0.1', () => {
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const green = '\x1b[32m';
    const yellow = '\x1b[33m';
    const cyan = '\x1b[36m';

    console.log('');
    console.log(`  ${yellow} ______  ______   __  __  ______  ______  __       ______  __       __${reset}`);
    console.log(`  ${yellow}/\\  == \\/\\  __ \\ /\\ \\/ / /\\  ___\\/\\  ___\\/\\ \\     /\\  __ \\/\\ \\  _  /\\ \\${reset}`);
    console.log(`  ${yellow}\\ \\  _-/\\ \\ \\/\\ \\\\ \\  _"-\\ \\  __\\\\ \\ \\___\\ \\ \\____\\ \\  __ \\ \\ \\/ \\/ \\ \\${reset}`);
    console.log(`  ${yellow} \\ \\_\\   \\ \\_____\\\\ \\_\\ \\_\\\\ \\_____\\ \\_____\\ \\_____\\\\ \\_\\ \\_\\ \\__/".~\\_\\${reset}`);
    console.log(`  ${yellow}  \\/_/    \\/_____/ \\/_/\\/_/ \\/_____/\\/_____/\\/_____/ \\/_/\\/_/\\/_/   \\/_/${reset}`);
    console.log('');
    console.log(`  ${dim}A pok\u00e9dex for your Claude Code agents${reset}`);
    console.log('');
    console.log(`  ${green}●${reset} Server    ${cyan}http://127.0.0.1:${port}${reset}`);
    console.log(`  ${green}●${reset} Sessions  ${bold}${knownSessions.size}${reset} discovered`);
    console.log(`  ${green}●${reset} Files     ${bold}${watchedFiles.size}${reset} watched`);
    console.log('');

    // Check hooks
    if (checkHooksConfigured()) {
      console.log(`  ${green}✓${reset} Hooks configured`);
    } else {
      console.log(`  ${yellow}⚠${reset} Hooks not configured — restart pokeclaw to auto-configure`);
    }

    console.log('');

    // Scan immediately, then every 5s
    scanProjects();
    setInterval(scanProjects, 5000);

    // Auto-open browser
    if (open) {
      const url = `http://127.0.0.1:${port}`;
      const { execFile } = require('child_process');
      switch (process.platform) {
        case 'darwin': execFile('open', [url]); break;
        case 'win32': execFile('cmd', ['/c', 'start', url]); break;
        default: execFile('xdg-open', [url]); break;
      }
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n  Shutting down...');
    // Flush session data to disk immediately
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const data = {
      xp: Object.fromEntries(sessionXp),
      species: Object.fromEntries(sessionSpecies),
      speciesCounter
    };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      try { fs.unlinkSync(DATA_FILE); } catch (e) {}
      fs.writeFileSync(DATA_FILE, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    } catch (e) {}
    unwatchAll();
    wss.close();
    server.close();
    process.exit(0);
  });
}

module.exports = { startServer };
