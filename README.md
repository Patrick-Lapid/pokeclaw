# agentdex

A Pokedex for your Claude Code agents. Watch your coding sessions come to life as pixel-art creatures on an interactive map.

![MIT License](https://img.shields.io/badge/license-MIT-green)

## What is it?

Agentdex monitors your active [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions and represents each one as a unique pixel-art creature. Creatures wander around a tile-based overworld, react to tool usage in real time, and level up as your agents work.

## Features

- **Real-time activity tracking** — creatures show what your agent is doing (reading, editing, searching, running commands)
- **XP & leveling** — every tool call earns XP; creatures level up over time
- **Persistent data** — XP and species assignments are saved across sessions in `~/.agentdex/data.json`
- **Interactive canvas** — pan, zoom, and click to select creatures
- **Party bar** — quick overview of all active agents with status and level
- **Hooks integration** — optional Claude Code hooks for instant updates (tool start/stop, notifications, subagent spawns)
- **Auto-discovery** — scans `~/.claude/projects/` for recent session transcripts

## Install

```bash
npm install -g agentdex
```

Or run directly from the repo:

```bash
git clone https://github.com/Patrick-Lapid/agentdex.git
cd agentdex
npm install
npm start
```

## Usage

```bash
agentdex [options]
```

| Option | Description |
|---|---|
| `--port <number>` | Port to listen on (default: `3000`) |
| `--no-open` | Don't auto-open the browser |
| `--help`, `-h` | Show help |

Once running, open `http://127.0.0.1:3000` in your browser.

## Hooks Setup (Optional)

For real-time creature reactions, add Claude Code hooks to `~/.claude/settings.json`. Agentdex will show you the config to copy when hooks aren't detected, or you can grab it from the `/api/hooks-config` endpoint.

Hooks enable instant updates for:
- Tool start/stop events
- Permission prompts (creature shows `!` bubble)
- Idle prompts (creature shows `?` bubble)
- Subagent spawn/stop (new creatures appear and disappear)

Without hooks, agentdex still works by tailing session JSONL files — updates are just slightly delayed.

## How It Works

1. A local HTTP + WebSocket server starts on `127.0.0.1`
2. The server scans `~/.claude/projects/` for `.jsonl` session transcripts modified in the last 24 hours
3. New lines are parsed for tool usage, turn boundaries, and progress events
4. Updates are broadcast over WebSocket to the browser client
5. The browser renders an interactive pixel-art overworld with creatures mapped to sessions

## License

[MIT](LICENSE)
