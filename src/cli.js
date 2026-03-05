#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { startServer } = require('./server');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: agentdex [options]');
  console.log('');
  console.log('Options:');
  console.log('  --port <number>  Port to listen on (default: 3000)');
  console.log('  --no-open        Do not auto-open browser');
  console.log('  --help, -h       Show this help message');
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

// ── Auto-configure hooks ──────────────────────────────────────────────────────

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

function getHooksConfig(p) {
  const curlCmd = `curl -s -X POST http://127.0.0.1:${p}/hook -H 'Content-Type: application/json' --data-binary @- < /dev/stdin`;
  const hook = { type: "command", command: curlCmd };
  const matchAll = { matcher: "", hooks: [hook] };
  const noMatcher = { hooks: [hook] };
  return {
    PreToolUse: [matchAll],
    PostToolUse: [matchAll],
    Notification: [matchAll],
    Stop: [noMatcher],
    SubagentStart: [noMatcher],
    SubagentStop: [noMatcher],
    UserPromptSubmit: [noMatcher],
    SessionStart: [noMatcher],
    SessionEnd: [noMatcher]
  };
}

function isHooksConfigured() {
  try {
    const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const settings = JSON.parse(data);
    if (settings.hooks && settings.hooks.PreToolUse) {
      const entries = settings.hooks.PreToolUse;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          for (const h of (entry.hooks || [])) {
            if (h.command && h.command.includes('/hook')) return true;
          }
        }
      }
    }
  } catch (e) {}
  return false;
}

function installHooks() {
  let settings = {};
  try {
    const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
    settings = JSON.parse(data);
  } catch (e) {}

  if (!settings.hooks) settings.hooks = {};

  const hooksConfig = getHooksConfig(port);
  for (const [event, entries] of Object.entries(hooksConfig)) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = entries;
    } else {
      // Check if agentdex hook already exists in this event
      const existing = settings.hooks[event];
      const hasAgentdex = existing.some(entry =>
        (entry.hooks || []).some(h => h.command && h.command.includes('/hook'))
      );
      if (!hasAgentdex) {
        settings.hooks[event] = existing.concat(entries);
      }
    }
  }

  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  if (!isHooksConfigured()) {
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const yellow = '\x1b[33m';
    const green = '\x1b[32m';

    console.log('');
    console.log(`  ${yellow}⚠${reset}  Claude Code hooks not configured.`);
    console.log(`  ${dim}Hooks let agentdex see your agents in real time.${reset}`);
    console.log('');

    const answer = await prompt(`  Configure hooks automatically? ${dim}(Y/n)${reset} `);

    if (answer === '' || answer === 'y' || answer === 'yes') {
      installHooks();
      console.log(`  ${green}✓${reset}  Hooks installed in ~/.claude/settings.json`);
      console.log('');
    }
  }

  startServer({ port, open: !noOpen });
}

main();
