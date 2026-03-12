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

const PARTYKIT_HOST = 'agentdex.patrick-lapid.partykit.dev';
const SITE_HOST = 'agentdex.gg';

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: agentdex [options]');
  console.log('');
  console.log('Options:');
  console.log('  --room <name>       Join a specific room (default: saved preference or prompt)');
  console.log('  --no-open           Do not auto-open browser');
  console.log('  --uninstall-hooks   Remove agentdex hooks from ~/.claude/settings.json');
  console.log('  --help, -h          Show this help message');
  process.exit(0);
}

let room = null;
const roomIdx = args.indexOf('--room');
if (roomIdx !== -1 && args[roomIdx + 1]) {
  room = args[roomIdx + 1].toLowerCase().replace(/[^a-z0-9-]/g, '');
}

const noOpen = args.includes('--no-open');

// ── Config persistence ─────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.agentdex');
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

// ── Display name from git config ───────────────────────────────────────────

function getDisplayName() {
  try {
    const { execSync } = require('child_process');
    return execSync('git config user.name', { encoding: 'utf8', timeout: 3000 }).trim()
        || execSync('git config user.email', { encoding: 'utf8', timeout: 3000 }).trim()
        || 'anonymous';
  } catch (e) { return 'anonymous'; }
}

// ── Uninstall hooks ─────────────────────────────────────────────────────────

if (args.includes('--uninstall-hooks')) {
  const removed = uninstallHooks();
  if (removed) {
    console.log(`  ${green}✓${reset}  Agentdex hooks removed from ~/.claude/settings.json`);
  } else {
    console.log(`  ${dim}No agentdex hooks found in ~/.claude/settings.json${reset}`);
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
  if (!room) {
    const config = loadConfig();
    if (config.room) {
      room = config.room;
    } else {
      console.log('');
      console.log('  Which room do you want to join?');
      console.log('  Press Enter for the global room, or type a custom name.');
      console.log('');
      const answer = await prompt(`  Room name ${dim}[global]${reset}: `);
      room = answer.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'global';
      saveConfig({ ...config, room });
    }
  }

  // 2. Build the PartyKit ingest URL
  const username = getDisplayName();
  const ingestUrl = `https://${PARTYKIT_HOST}/party/${room}?username=${encodeURIComponent(username)}`;

  // 3. Configure hooks to POST directly to PartyKit
  const status = checkHooks();

  if (status.installed && status.target === ingestUrl) {
    // Already configured correctly
  } else if (status.installed) {
    installHooks(ingestUrl);
    console.log(`  ${green}✓${reset}  Hooks updated to point at room: ${room}`);
  } else {
    console.log('');
    console.log(`  ${yellow}!${reset}  Claude Code hooks not configured.`);
    console.log(`  ${dim}Hooks let agentdex see your agents in real time.${reset}`);
    console.log('');
    const answer = (await prompt(`  Configure hooks automatically? ${dim}(Y/n)${reset} `)).toLowerCase();
    if (answer === '' || answer === 'y' || answer === 'yes') {
      installHooks(ingestUrl);
      console.log(`  ${green}✓${reset}  Hooks installed`);
    } else {
      console.log(`  ${dim}Skipped. Run agentdex again to configure later.${reset}`);
    }
  }

  // 4. Print status
  const roomPath = room === 'global' ? 'world' : `room/${room}`;
  const shareUrl = `https://${SITE_HOST}/${roomPath}`;

  console.log('');
  console.log(`  ${dim}╔══════════════════════════════════════╗${reset}`);
  console.log(`  ${dim}║${reset}                                      ${dim}║${reset}`);
  console.log(`  ${dim}║${reset}   ${bold}${green}▓▓▓${reset} ${bold}a g e n t d e x${reset}                ${dim}║${reset}`);
  console.log(`  ${dim}║${reset}   ${dim}A pokedex for your Claude agents${reset}   ${dim}║${reset}`);
  console.log(`  ${dim}║${reset}                                      ${dim}║${reset}`);
  console.log(`  ${dim}╚══════════════════════════════════════╝${reset}`);
  console.log('');
  console.log(`  ${green}✓${reset}  Connected to room: ${bold}${room}${reset}`);
  console.log(`  ${green}✓${reset}  Share: ${cyan}${shareUrl}${reset}`);
  console.log('');
  console.log(`  Start a Claude Code session to spawn your first creature.`);
  console.log('');

  // 5. Open browser
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
