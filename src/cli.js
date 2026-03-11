#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { startServer } = require('./server');
const { checkHooks, installHooks, uninstallHooks } = require('./hooks');

const args = process.argv.slice(2);

const dim = '\x1b[2m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const yellow = '\x1b[33m';
const green = '\x1b[32m';
const red = '\x1b[31m';

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: agentdex [options]');
  console.log('');
  console.log('Options:');
  console.log('  --port <number>     Port to listen on (default: 3000)');
  console.log('  --no-open           Do not auto-open browser');
  console.log('  --uninstall-hooks   Remove agentdex hooks from ~/.claude/settings.json');
  console.log('  --help, -h          Show this help message');
  process.exit(0);
}

let port = 3000;
const portIdx = args.indexOf('--port');
if (portIdx !== -1 && args[portIdx + 1]) {
  const p = parseInt(args[portIdx + 1], 10);
  if (!isNaN(p) && p > 0 && p < 65536) {
    port = p;
  }
}

const noOpen = args.includes('--no-open');

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

// ── Auto-configure hooks ────────────────────────────────────────────────────

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function ensureHooks() {
  const status = checkHooks();

  if (status.installed && status.port === port) {
    // Hooks exist with correct port — ensure all events are covered
    const result = installHooks(port);
    if (result === 'updated') {
      console.log(`  ${green}✓${reset}  Hooks updated (added missing events)`);
      console.log('');
    }
    return;
  }

  if (status.installed && status.port !== port) {
    // Hooks exist but on a different port — update silently
    installHooks(port);
    console.log(`  ${green}✓${reset}  Hooks updated to port ${port} ${dim}(was ${status.port})${reset}`);
    console.log('');
    return;
  }

  // No hooks installed — prompt user
  console.log('');
  console.log(`  ${yellow}!${reset}  Claude Code hooks not configured.`);
  console.log(`  ${dim}Hooks let agentdex see your agents in real time.${reset}`);
  console.log('');

  const answer = await prompt(`  Configure hooks automatically? ${dim}(Y/n)${reset} `);

  if (answer === '' || answer === 'y' || answer === 'yes') {
    installHooks(port);
    console.log(`  ${green}✓${reset}  Hooks installed in ~/.claude/settings.json`);
    console.log('');
  }
}

async function main() {
  await ensureHooks();
  startServer({ port, open: !noOpen });
}

main();
