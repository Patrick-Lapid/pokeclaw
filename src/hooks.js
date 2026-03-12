// ── Agentdex Claude Code hooks manager ──────────────────────────────────────
// Shared module for installing, uninstalling, and checking agentdex hooks
// in ~/.claude/settings.json. Idempotent — safe to call on every startup.

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// Marker string used to identify agentdex hook commands
const HOOK_MARKER = 'agentdex';

const HOOK_EVENTS = {
  // Events that need a wildcard matcher (fire for every tool)
  matched: ['PreToolUse', 'PostToolUse', 'Notification'],
  // Events with no matcher
  unmatched: ['Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit', 'SessionStart', 'SessionEnd']
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function readSettings() {
  try {
    const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function makeCommand(target) {
  // target is either a port number (localhost) or a full URL (PartyKit)
  if (typeof target === 'string' && target.startsWith('http')) {
    return `curl -s -X POST ${target} -H 'Content-Type: application/json' --data-binary @- < /dev/stdin`;
  }
  return `curl -s -X POST http://127.0.0.1:${target}/hook -H 'Content-Type: application/json' --data-binary @- < /dev/stdin`;
}

function isAgentdexHook(hookEntry) {
  return (hookEntry.hooks || []).some(h =>
    h.command && h.command.includes(HOOK_MARKER)
  );
}

function getAgentdexTarget(hookEntry) {
  for (const h of (hookEntry.hooks || [])) {
    if (!h.command) continue;
    // Check for PartyKit URL
    const urlMatch = h.command.match(/https?:\/\/[^\s]+/);
    if (urlMatch && urlMatch[0].includes('partykit')) return urlMatch[0];
    // Check for localhost port
    const portMatch = h.command.match(/127\.0\.0\.1:(\d+)\/hook/);
    if (portMatch) return parseInt(portMatch[1], 10);
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if agentdex hooks are installed in settings.json.
 * Returns { installed: boolean, port: number|null, target: string|number|null }
 */
function checkHooks() {
  const settings = readSettings();
  if (!settings.hooks || !settings.hooks.PreToolUse) {
    return { installed: false, port: null, target: null };
  }
  const entries = settings.hooks.PreToolUse;
  if (!Array.isArray(entries)) return { installed: false, port: null, target: null };

  for (const entry of entries) {
    if (isAgentdexHook(entry)) {
      const target = getAgentdexTarget(entry);
      const port = typeof target === 'number' ? target : null;
      return { installed: true, port, target };
    }
  }
  return { installed: false, port: null, target: null };
}

/**
 * Install or update agentdex hooks in settings.json.
 * target can be a port number (localhost mode) or a URL string (hosted mode).
 * Returns 'installed' | 'updated' | 'unchanged'
 */
function installHooks(target) {
  const settings = readSettings();
  if (!settings.hooks) settings.hooks = {};

  const command = makeCommand(target);
  const hook = { type: 'command', command };
  const allEvents = [...HOOK_EVENTS.matched, ...HOOK_EVENTS.unmatched];
  let action = 'installed';

  // Check current state
  const current = checkHooks();
  if (current.installed && current.target === target) {
    // Verify all events are present
    let allPresent = true;
    for (const event of allEvents) {
      const entries = settings.hooks[event];
      if (!Array.isArray(entries) || !entries.some(isAgentdexHook)) {
        allPresent = false;
        break;
      }
    }
    if (allPresent) return 'unchanged';
  }

  if (current.installed && current.target !== target) {
    action = 'updated';
  }

  for (const event of allEvents) {
    const useMatcher = HOOK_EVENTS.matched.includes(event);
    const newEntry = useMatcher
      ? { matcher: '', hooks: [hook] }
      : { hooks: [hook] };

    if (!Array.isArray(settings.hooks[event])) {
      // No entries for this event yet
      settings.hooks[event] = [newEntry];
    } else {
      // Find and replace existing agentdex entry, or append
      const idx = settings.hooks[event].findIndex(isAgentdexHook);
      if (idx !== -1) {
        settings.hooks[event][idx] = newEntry;
      } else {
        settings.hooks[event].push(newEntry);
      }
    }
  }

  writeSettings(settings);
  return action;
}

/**
 * Remove all agentdex hooks from settings.json.
 * Preserves other hooks. Returns true if any were removed.
 */
function uninstallHooks() {
  const settings = readSettings();
  if (!settings.hooks) return false;

  let removed = false;
  const allEvents = [...HOOK_EVENTS.matched, ...HOOK_EVENTS.unmatched];

  for (const event of allEvents) {
    const entries = settings.hooks[event];
    if (!Array.isArray(entries)) continue;

    const filtered = entries.filter(entry => !isAgentdexHook(entry));
    if (filtered.length !== entries.length) {
      removed = true;
      if (filtered.length === 0) {
        delete settings.hooks[event];
      } else {
        settings.hooks[event] = filtered;
      }
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (removed) {
    writeSettings(settings);
  }
  return removed;
}

/**
 * Generate the hooks config object for display/API purposes.
 */
function getHooksConfig(target) {
  const command = makeCommand(target);
  const hook = { type: 'command', command };
  const matchAll = { matcher: '', hooks: [hook] };
  const noMatcher = { hooks: [hook] };

  const config = {};
  for (const event of HOOK_EVENTS.matched) {
    config[event] = [matchAll];
  }
  for (const event of HOOK_EVENTS.unmatched) {
    config[event] = [noMatcher];
  }
  return { hooks: config };
}

module.exports = { checkHooks, installHooks, uninstallHooks, getHooksConfig };
