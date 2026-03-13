#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { checkHooks, installHooks, uninstallHooks } = require('./hooks');

const args = process.argv.slice(2);

const dim = '\x1b[2m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const yellow = '\x1b[33m';
const green = '\x1b[32m';
const cyan = '\x1b[36m';

const WORKER_HOST = 'pokeclaw.dev';

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: pokeclaw [options]');
  console.log('');
  console.log('Options:');
  console.log('  --room <name>       Set and save room (default: saved preference or prompt)');
  console.log('  --username <name>   Set and save username');
  console.log('  --reset             Re-prompt for room and username');
  console.log('  --dev               Use local wrangler dev server (localhost:8787)');
  console.log('  --no-open           Do not auto-open browser');
  console.log('  --uninstall-hooks   Remove pokeclaw hooks from ~/.claude/settings.json');
  console.log('  --help, -h          Show this help message');
  process.exit(0);
}

let room = null;
const roomIdx = args.indexOf('--room');
if (roomIdx !== -1 && args[roomIdx + 1]) {
  room = args[roomIdx + 1].toLowerCase().replace(/[^a-z0-9-]/g, '');
}

let usernameArg = null;
const usernameIdx = args.indexOf('--username');
if (usernameIdx !== -1 && args[usernameIdx + 1]) {
  usernameArg = args[usernameIdx + 1].trim();
}

const doReset = args.includes('--reset');
const isDev = args.includes('--dev');
const noOpen = args.includes('--no-open');

// ── Config persistence ─────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.pokeclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) { return {}; }
}

function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try { fs.unlinkSync(CONFIG_FILE); } catch (e) {}
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config), { mode: 0o600 });
}

// ── Username ──────────────────────────────────────────────────────────────

function getDefaultName() {
  try {
    const { execSync } = require('child_process');
    return execSync('git config user.name', { encoding: 'utf8', timeout: 3000 }).trim() || null;
  } catch (e) { return null; }
}

// ── Uninstall hooks ─────────────────────────────────────────────────────────

if (args.includes('--uninstall-hooks')) {
  const removed = uninstallHooks();
  if (removed) {
    console.log(`  ${green}✓${reset}  Pokeclaw hooks removed from ~/.claude/settings.json`);
  } else {
    console.log(`  ${dim}No pokeclaw hooks found in ~/.claude/settings.json${reset}`);
  }
  process.exit(0);
}

// ── Prompt helper ───────────────────────────────────────────────────────────

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Select room
  if (room) {
    // --room flag: save it
    saveConfig({ ...loadConfig(), room });
  } else if (!doReset && loadConfig().room) {
    room = loadConfig().room;
  } else {
    console.log('');
    console.log('  Which room do you want to join?');
    console.log('  Press Enter for the global room, or type a custom name.');
    console.log('');
    const current = loadConfig().room;
    const hint = current ? ` ${dim}[${current}]${reset}` : ` ${dim}[global]${reset}`;
    const answer = await prompt(`  Room name${hint}: `);
    room = answer.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || current || 'global';
    saveConfig({ ...loadConfig(), room });
  }

  // 2. Pick username
  let username;
  if (usernameArg) {
    // --username flag: save it
    username = usernameArg;
    saveConfig({ ...loadConfig(), username });
  } else if (!doReset && loadConfig().username) {
    username = loadConfig().username;
  } else {
    const defaultName = loadConfig().username || getDefaultName();
    const hint = defaultName ? ` ${dim}[${defaultName}]${reset}` : '';
    console.log('');
    console.log('  What should your creature be called?');
    console.log('');
    const nameAnswer = await prompt(`  Username${hint}: `);
    username = nameAnswer.trim() || defaultName || 'anonymous';
    saveConfig({ ...loadConfig(), username });
  }

  // 3. Build the ingest URL
  const host = isDev ? 'localhost:8787' : WORKER_HOST;
  const proto = isDev ? 'http' : 'https';
  const ingestUrl = `${proto}://${host}/parties/AgentRoom/${room}?username=${encodeURIComponent(username)}`;

  // 4. Configure hooks
  const status = checkHooks();

  if (status.installed && status.target === ingestUrl) {
    // Already configured correctly
  } else if (status.installed) {
    installHooks(ingestUrl);
    console.log(`  ${green}✓${reset}  Hooks updated to point at room: ${room}`);
  } else {
    console.log('');
    console.log(`  ${yellow}!${reset}  Claude Code hooks not configured.`);
    console.log(`  ${dim}Hooks let your pok\u00e9dex see your agents in real time.${reset}`);
    console.log('');
    const answer = (await prompt(`  Configure hooks automatically? ${dim}(Y/n)${reset} `)).toLowerCase();
    if (answer === '' || answer === 'y' || answer === 'yes') {
      installHooks(ingestUrl);
      console.log(`  ${green}✓${reset}  Hooks installed`);
    } else {
      console.log(`  ${dim}Skipped. Run pokeclaw again to configure later.${reset}`);
    }
  }

  // 5. Print status
  const roomPath = room === 'global' ? 'world' : `room/${room}`;
  const shareUrl = isDev ? `http://localhost:8787?room=${encodeURIComponent(room)}` : `https://${WORKER_HOST}/${roomPath}`;

  console.log('');
  console.log(`  ${yellow} ______  ______   __  __  ______  ______  __       ______  __       __${reset}`);
  console.log(`  ${yellow}/\\  == \\/\\  __ \\ /\\ \\/ / /\\  ___\\/\\  ___\\/\\ \\     /\\  __ \\/\\ \\  _  /\\ \\${reset}`);
  console.log(`  ${yellow}\\ \\  _-/\\ \\ \\/\\ \\\\ \\  _"-\\ \\  __\\\\ \\ \\___\\ \\ \\____\\ \\  __ \\ \\ \\/ \\/ \\ \\${reset}`);
  console.log(`  ${yellow} \\ \\_\\   \\ \\_____\\\\ \\_\\ \\_\\\\ \\_____\\ \\_____\\ \\_____\\\\ \\_\\ \\_\\ \\__/".~\\_\\${reset}`);
  console.log(`  ${yellow}  \\/_/    \\/_____/ \\/_/\\/_/ \\/_____/\\/_____/\\/_____/ \\/_/\\/_/\\/_/   \\/_/${reset}`);
  console.log('');
  console.log(`  ${dim}A pok\u00e9dex for your Claude Code agents${reset}`);
  console.log('');
  console.log(`  ${green}✓${reset}  Connected to room: ${bold}${room}${reset}`);
  console.log(`  ${green}✓${reset}  Share: ${cyan}${shareUrl}${reset}`);
  console.log('');
  console.log(`  Start a Claude Code session to spawn your first creature.`);
  console.log('');

  // 6. Open browser
  if (!noOpen) {
    const { execFile } = require('child_process');
    switch (process.platform) {
      case 'darwin': execFile('open', [shareUrl]); break;
      case 'win32': execFile('cmd', ['/c', 'start', shareUrl]); break;
      default: execFile('xdg-open', [shareUrl]); break;
    }
  }
}

main();
