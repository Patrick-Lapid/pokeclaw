# pokeclaw

A Pokedex for your Claude Code agents. Watch your coding sessions come to life as pixel-art pokemon on an interactive map.

![MIT License](https://img.shields.io/badge/license-MIT-green)

## What is it?

Pokeclaw monitors your active [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions and represents each one as a unique pixel-art pokemon. Pokemon wander around a tile-based overworld and react to tool usage in real time.

## Features

- **24 pokemon species** — 4 rarity tiers (common, uncommon, rare, legendary) with weighted random assignment
- **Real-time activity tracking** — pokemon show what your agent is doing (reading, editing, searching, running commands)
- **Pokédex & collections** — track which species you've encountered across sessions
- **Hover cards** — PMD-style popup cards showing species, username, rarity, and current status
- **Visual effects** — legendary glow, rare sparkle effects, and type-colored selection outlines
- **Persistent data** — species assignments and collections saved across sessions in `~/.pokeclaw/data.json`
- **Interactive canvas** — pan, zoom, click to select, and drag pokemon
- **Hooks integration** — optional Claude Code hooks for instant updates (tool start/stop, notifications, subagent spawns)
- **Auto-discovery** — scans `~/.claude/projects/` for recent session transcripts

## Install

```bash
npm install -g pokeclaw
```

Or run directly from the repo:

```bash
git clone https://github.com/Patrick-Lapid/pokeclaw.git
cd pokeclaw
npm install
npm start
```

## Usage

```bash
pokeclaw [options]
```

| Option | Description |
|---|---|
| `--world <name>` | Set and save world name (default: saved preference or prompt) |
| `--username <name>` | Set and save username for your pokemon |
| `--reset` | Re-prompt for world and username |
| `--dev` | Use local dev server (localhost:8787) |
| `--no-open` | Don't auto-open the browser |
| `--uninstall-hooks` | Remove pokeclaw hooks from `~/.claude/settings.json` |
| `--help`, `-h` | Show help |

Once running, open the shared URL printed in the terminal to view your pokemon.

## Hooks Setup (Optional)

For real-time pokemon reactions, pokeclaw can automatically configure Claude Code hooks in `~/.claude/settings.json`. On first run, it will prompt you to install them.

Hooks enable instant updates for:
- Tool start/stop events
- Permission prompts (pokemon shows `!` bubble)
- Idle prompts (pokemon shows `?` bubble)
- Subagent spawn/stop (new pokemon appear and disappear)

Without hooks, pokeclaw still works by tailing session JSONL files — updates are just slightly delayed.

To remove hooks later, run:

```bash
pokeclaw --uninstall-hooks
```

## How It Works

1. When you run `pokeclaw`, it configures Claude Code hooks to POST events to a shared server
2. Each Claude Code session is assigned a random pokemon species from the weighted roster
3. Tool usage, turn boundaries, and progress events are broadcast in real time via WebSocket
4. The browser renders an interactive pixel-art overworld with pokemon mapped to sessions
5. Collections track unique species encountered per username
6. Config (world, username) is persisted in `~/.pokeclaw/config.json`

## License

[MIT](LICENSE)
