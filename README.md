# pokeclaw

A Pokedex for your Claude Code agents. Watch your coding sessions come to life as pixel-art creatures on an interactive map.

![MIT License](https://img.shields.io/badge/license-MIT-green)

## What is it?

Pokeclaw monitors your active [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions and represents each one as a unique pixel-art creature. Creatures wander around a tile-based overworld, react to tool usage in real time, and level up as your agents work.

<img width="1664" height="1308" alt="image" src="https://github.com/user-attachments/assets/eaeb1b22-a872-403a-8e76-d40762a1ca18" />


## Features

- **Real-time activity tracking** — creatures show what your agent is doing (reading, editing, searching, running commands)
- **XP & leveling** — every tool call earns XP; creatures level up over time
- **Persistent data** — XP and species assignments are saved across sessions in `~/.pokeclaw/data.json`
- **Interactive canvas** — pan, zoom, and click to select creatures
- **Party bar** — quick overview of all active agents with status and level
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
| `--room <name>` | Set and save room name (default: saved preference or prompt) |
| `--username <name>` | Set and save username for your creature |
| `--reset` | Re-prompt for room and username |
| `--dev` | Use local PartyKit dev server (localhost:1999) |
| `--no-open` | Don't auto-open the browser |
| `--uninstall-hooks` | Remove pokeclaw hooks from `~/.claude/settings.json` |
| `--help`, `-h` | Show help |

Once running, open the shared URL printed in the terminal to view your creatures.

## Hooks Setup (Optional)

For real-time creature reactions, pokeclaw can automatically configure Claude Code hooks in `~/.claude/settings.json`. On first run, it will prompt you to install them.

Hooks enable instant updates for:
- Tool start/stop events
- Permission prompts (creature shows `!` bubble)
- Idle prompts (creature shows `?` bubble)
- Subagent spawn/stop (new creatures appear and disappear)

Without hooks, pokeclaw still works by tailing session JSONL files — updates are just slightly delayed.

To remove hooks later, run:

```bash
pokeclaw --uninstall-hooks
```

## How It Works

1. When you run `pokeclaw`, it configures Claude Code hooks to POST events to a shared PartyKit server
2. Each Claude Code session is represented as a unique creature in a shared room
3. Tool usage, turn boundaries, and progress events are broadcast in real time
4. The browser renders an interactive pixel-art overworld with creatures mapped to sessions
5. Config (room, username) is persisted in `~/.pokeclaw/config.json`

## License

[MIT](LICENSE)
