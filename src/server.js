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
const sessionSpecies = new Map(); // sessionId → species index (into SPECIES_DATA)
const sessionUsernames = new Map(); // sessionId → username
const collections = new Map(); // username → { speciesId: count }
const recentlyCleared = new Map(); // sessionId → { timestamp, speciesIndex }
let wss = null;
let server = null;

// ── Species data (duplicated from public/js/species.js for server-side rolling) ─

const SPECIES_DATA = [
  { id: 0,  name: 'Bulbasaur',  rarity: 0 },
  { id: 1,  name: 'Charmander', rarity: 0 },
  { id: 2,  name: 'Squirtle',   rarity: 0 },
  { id: 3,  name: 'Pikachu',    rarity: 0 },
  { id: 4,  name: 'Jigglypuff', rarity: 0 },
  { id: 5,  name: 'Meowth',     rarity: 0 },
  { id: 6,  name: 'Psyduck',    rarity: 0 },
  { id: 7,  name: 'Machop',     rarity: 0 },
  { id: 8,  name: 'Geodude',    rarity: 0 },
  { id: 9,  name: 'Eevee',      rarity: 0 },
  { id: 10, name: 'Growlithe',  rarity: 1 },
  { id: 11, name: 'Abra',       rarity: 1 },
  { id: 12, name: 'Gastly',     rarity: 1 },
  { id: 13, name: 'Scyther',    rarity: 1 },
  { id: 14, name: 'Snorlax',    rarity: 1 },
  { id: 15, name: 'Dratini',    rarity: 1 },
  { id: 16, name: 'Togepi',     rarity: 1 },
  { id: 17, name: 'Larvitar',   rarity: 1 },
  { id: 18, name: 'Charizard',  rarity: 2 },
  { id: 19, name: 'Gengar',     rarity: 2 },
  { id: 20, name: 'Dragonite',  rarity: 2 },
  { id: 21, name: 'Tyranitar',  rarity: 2 },
  { id: 22, name: 'Mewtwo',     rarity: 3 },
  { id: 23, name: 'Mew',        rarity: 3 }
];

const RARITY_WEIGHTS = [0.06, 0.035, 0.025, 0.01];

// ── Species persistence ─────────────────────────────────────────────────────────

const DATA_DIR = path.join(os.homedir(), '.pokeclaw');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
let saveTimer = null;

const MAX_ENTRIES = 10000;

function loadSessionData() {
  try {
    // Refuse to read symlinks
    const stat = fs.lstatSync(DATA_FILE);
    if (!stat.isFile()) return;
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.species === 'object') {
      let sCount = 0;
      for (const [id, idx] of Object.entries(data.species)) {
        if (sCount >= MAX_ENTRIES) break;
        if (typeof idx === 'number' && idx >= 0 && idx < SPECIES_DATA.length) {
          sessionSpecies.set(id, idx);
          sCount++;
        }
      }
    }
    if (data && typeof data.collections === 'object') {
      for (const [user, coll] of Object.entries(data.collections)) {
        if (typeof coll === 'object') collections.set(user, coll);
      }
    }
  } catch (e) { /* file missing or corrupt, start fresh */ }
}

function saveSessionData() {
  if (saveTimer) return; // already scheduled
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const data = {
      species: Object.fromEntries(sessionSpecies),
      collections: Object.fromEntries(collections)
    };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      // Remove existing file first to avoid writing through symlinks
      try { fs.unlinkSync(DATA_FILE); } catch (e) {}
      fs.writeFileSync(DATA_FILE, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    } catch (e) { /* ignore write errors */ }
  }, 2000); // debounce 2s
}

function rollSpecies() {
  const roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < SPECIES_DATA.length; i++) {
    cumulative += RARITY_WEIGHTS[SPECIES_DATA[i].rarity];
    if (roll < cumulative) return i;
  }
  return 0;
}

function getOrRollSpecies(sessionId) {
  if (sessionSpecies.has(sessionId)) return sessionSpecies.get(sessionId);
  const idx = rollSpecies();
  sessionSpecies.set(sessionId, idx);
  saveSessionData();
  return idx;
}

function updateCollection(username, speciesId) {
  if (!username || username === 'anonymous') return;
  let coll = collections.get(username);
  if (!coll) { coll = {}; collections.set(username, coll); }
  coll[speciesId] = (coll[speciesId] || 0) + 1;
  saveSessionData();
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
    broadcast({ type: 'session_discovered', sessionId, speciesIndex: getOrRollSpecies(sessionId) });
  }

  if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
    let hasToolUse = false;
    for (const block of obj.message.content) {
      if (block.type === 'tool_use') {
        hasToolUse = true;
        const status = toolStatus(block.name, block.input);
        broadcast({
          type: 'tool_start',
          sessionId,
          toolId: block.id || '',
          toolName: block.name || 'unknown',
          status
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
      broadcast({ type: 'session_discovered', sessionId, speciesIndex: getOrRollSpecies(sessionId) });
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
  const username = data.username || 'anonymous';

  // Track username for this session
  if (username && username !== 'anonymous') {
    sessionUsernames.set(sessionId, username);
  }

  // Clear ended state if a new hook event arrives (session restarted)
  if (hookName !== 'SessionEnd') {
    endedSessions.delete(sessionId);
    sessionLastSeen.set(sessionId, Date.now());
  }

  if (!knownSessions.has(sessionId)) {
    knownSessions.add(sessionId);
    const speciesId = getOrRollSpecies(sessionId);
    updateCollection(username, speciesId);
    broadcast({ type: 'session_discovered', sessionId, speciesIndex: speciesId, username });
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
      broadcast({
        type: 'hook_tool_start',
        sessionId,
        toolName,
        status,
        username
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
      const prompt = data.prompt || '';
      broadcast({ type: 'hook_new_turn', sessionId, prompt, username });
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

      // Check if this follows a /clear — transfer the old pokemon to this new session
      let replacesSessionId = null;
      for (const [oldId, info] of recentlyCleared) {
        // Clean up stale entries (older than 10s)
        if (Date.now() - info.timestamp > 10000) {
          recentlyCleared.delete(oldId);
          continue;
        }
        replacesSessionId = oldId;
        // Transfer species to new session
        if (typeof info.speciesIndex === 'number') sessionSpecies.set(sessionId, info.speciesIndex);
        recentlyCleared.delete(oldId);
        saveSessionData();
        break;
      }

      const speciesId = getOrRollSpecies(sessionId);
      broadcast({ type: 'hook_session_start', sessionId, replacesSessionId, speciesIndex: speciesId, username });
      break;
    }
    case 'SessionEnd': {
      const reason = data.reason || '';
      // /clear triggers SessionEnd followed by SessionStart with a NEW session ID.
      // Store the old session so we can transfer the pokemon to the new session.
      if (reason === 'clear') {
        recentlyCleared.set(sessionId, {
          timestamp: Date.now(),
          speciesIndex: sessionSpecies.get(sessionId)
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
    // Build agent list and send world_init with collections
    const hooksActive = checkHooksConfigured();
    const staleCutoff = Date.now() - 10 * 60 * 1000; // 10 minutes
    const agents = [];
    for (const sessionId of knownSessions) {
      if (endedSessions.has(sessionId)) continue;
      if (hooksActive) {
        const lastSeen = sessionLastSeen.get(sessionId);
        if (!lastSeen || lastSeen < staleCutoff) continue;
      }
      agents.push({
        sessionId,
        speciesIndex: getOrRollSpecies(sessionId),
        username: sessionUsernames.get(sessionId) || 'anonymous',
        isActive: true,
        status: 'idle'
      });
    }
    try {
      ws.send(JSON.stringify({
        type: 'world_init',
        agents,
        collections: Object.fromEntries(collections)
      }));
    } catch (e) {}
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
      species: Object.fromEntries(sessionSpecies),
      collections: Object.fromEntries(collections)
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
