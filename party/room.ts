import { Server, routePartykitRequest } from "partyserver";
import type { Connection, ConnectionContext } from "partyserver";

interface AgentState {
  sessionId:    string;
  speciesIndex: number;
  status:       string;
  isActive:     boolean;
  username:     string;
}

// ── Tool → status mapping (mirrors original server.js logic) ────────────────

function basename(p: string | undefined): string {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

function toolStatus(toolName: string, toolInput: Record<string, unknown> | undefined): string {
  const input = toolInput || {};
  switch (toolName) {
    case 'Read':   return `Reading ${basename(input.file_path as string)}`;
    case 'Edit':   return `Editing ${basename(input.file_path as string)}`;
    case 'Write':  return `Writing ${basename(input.file_path as string)}`;
    case 'Bash': {
      const cmd = String(input.command || '').slice(0, 50);
      return `Running: ${cmd}${(String(input.command || '')).length > 50 ? '…' : ''}`;
    }
    case 'Grep':   return 'Searching code';
    case 'Glob':   return 'Searching files';
    case 'Task':   return 'Running subtask';
    default:       return `Using ${toolName}`;
  }
}

// Species data (duplicated from public/js/species.js for server-side rolling)
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

function rollSpecies(): number {
  const roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < SPECIES_DATA.length; i++) {
    cumulative += RARITY_WEIGHTS[SPECIES_DATA[i].rarity];
    if (roll < cumulative) return i;
  }
  return 0;
}

export class World extends Server {
  agents = new Map<string, AgentState>();
  sessionSpecies = new Map<string, number>();
  sessionLastSeen = new Map<string, number>();
  endedSessions = new Set<string>();
  recentlyCleared = new Map<string, { timestamp: number; speciesIndex: number }>();
  collections = new Map<string, Record<string, number>>();

  getOrRollSpecies(sessionId: string): number {
    if (this.sessionSpecies.has(sessionId)) return this.sessionSpecies.get(sessionId)!;
    const idx = rollSpecies();
    this.sessionSpecies.set(sessionId, idx);
    return idx;
  }

  updateCollection(username: string, speciesId: number) {
    if (!username || username === 'anonymous') return;
    let coll = this.collections.get(username);
    if (!coll) { coll = {}; this.collections.set(username, coll); }
    const key = String(speciesId);
    coll[key] = (coll[key] || 0) + 1;
    // Persist to DO storage
    this.ctx.storage.put('collection:' + username, coll);
  }

  onConnect(conn: Connection, ctx: ConnectionContext) {
    conn.send(JSON.stringify({
      type:   'world_init',
      agents: [...this.agents.values()],
      collections: Object.fromEntries(this.collections)
    }));
  }

  onMessage(conn: Connection, raw: string) {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }

    this.applyEvent(msg);
    this.broadcast(raw, [conn.id]);
  }

  // ── HTTP ingest endpoint for Claude Code hooks ────────────────────────────

  async onRequest(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let data: Record<string, unknown>;
    try {
      data = await req.json() as Record<string, unknown>;
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    // Extract username from query param (set by CLI when configuring hooks)
    const url = new URL(req.url);
    const username = url.searchParams.get('username') || 'anonymous';
    data.username = username;

    const events = this.handleHook(data);

    // Broadcast all generated events to connected browsers
    for (const event of events) {
      this.broadcast(JSON.stringify(event));
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // ── Transform Claude Code hook payload into game events ───────────────────

  handleHook(data: Record<string, unknown>): Record<string, unknown>[] {
    const events: Record<string, unknown>[] = [];
    const sessionId = (data.session_id as string) || 'unknown';
    const hookName = (data.hook_event_name as string) || '';
    const username = (data.username as string) || 'anonymous';

    if (hookName !== 'SessionEnd') {
      this.endedSessions.delete(sessionId);
      this.sessionLastSeen.set(sessionId, Date.now());
    }

    // Discover session if new
    if (!this.agents.has(sessionId) && hookName !== 'SessionEnd') {
      const speciesIndex = this.getOrRollSpecies(sessionId);
      this.updateCollection(username, speciesIndex);
      const discoveryEvent = {
        type: 'session_discovered',
        sessionId,
        speciesIndex,
        username,
      };
      events.push(discoveryEvent);
      this.applyEvent(discoveryEvent);
    }

    switch (hookName) {
      case 'PreToolUse': {
        const toolName = (data.tool_name as string) || 'unknown';
        const status = toolStatus(toolName, data.tool_input as Record<string, unknown>);
        const event = { type: 'hook_tool_start', sessionId, toolName, status, username };
        events.push(event);
        this.applyEvent(event);
        break;
      }
      case 'PostToolUse': {
        events.push({ type: 'hook_tool_done', sessionId, toolName: (data.tool_name as string) || 'unknown' });
        break;
      }
      case 'Stop': {
        const event = { type: 'hook_stop', sessionId };
        events.push(event);
        this.applyEvent(event);
        break;
      }
      case 'Notification': {
        events.push({
          type: 'hook_notification',
          sessionId,
          notificationType: (data.notification_type as string) || '',
          message: (data.message as string) || '',
          title: (data.title as string) || '',
        });
        break;
      }
      case 'SubagentStart': {
        events.push({
          type: 'hook_subagent_start',
          sessionId,
          agentId: (data.agent_id as string) || '',
          agentType: (data.agent_type as string) || '',
        });
        break;
      }
      case 'SubagentStop': {
        events.push({
          type: 'hook_subagent_stop',
          sessionId,
          agentId: (data.agent_id as string) || '',
        });
        break;
      }
      case 'UserPromptSubmit': {
        const prompt = (data.prompt as string) || '';
        events.push({ type: 'hook_new_turn', sessionId, prompt, username });
        break;
      }
      case 'SessionStart': {
        this.endedSessions.delete(sessionId);

        // Clean up stale sessions (no activity in 10 minutes)
        const staleThreshold = Date.now() - 10 * 60 * 1000;
        for (const [oldId, lastSeen] of this.sessionLastSeen) {
          if (oldId === sessionId || this.endedSessions.has(oldId)) continue;
          if (lastSeen < staleThreshold) {
            this.endedSessions.add(oldId);
            this.agents.delete(oldId);
            events.push({ type: 'hook_session_end', sessionId: oldId, reason: 'stale' });
          }
        }

        // Handle /clear pokemon transfer
        let replacesSessionId: string | null = null;
        for (const [oldId, info] of this.recentlyCleared) {
          if (Date.now() - info.timestamp > 10000) {
            this.recentlyCleared.delete(oldId);
            continue;
          }
          replacesSessionId = oldId;
          if (typeof info.speciesIndex === 'number') this.sessionSpecies.set(sessionId, info.speciesIndex);
          this.recentlyCleared.delete(oldId);
          break;
        }

        const speciesIndex = this.getOrRollSpecies(sessionId);
        const startEvent = {
          type: 'hook_session_start',
          sessionId,
          replacesSessionId,
          speciesIndex,
          username,
        };
        events.push(startEvent);
        this.applyEvent(startEvent);
        break;
      }
      case 'SessionEnd': {
        const reason = (data.reason as string) || '';
        if (reason === 'clear') {
          this.recentlyCleared.set(sessionId, {
            timestamp: Date.now(),
            speciesIndex: this.sessionSpecies.get(sessionId) || 0,
          });
          this.endedSessions.add(sessionId);
          events.push({ type: 'hook_session_clear', sessionId });
        } else {
          this.endedSessions.add(sessionId);
          this.agents.delete(sessionId);
          events.push({ type: 'hook_session_end', sessionId, reason });
        }
        break;
      }
    }

    return events;
  }

  // ── Update in-memory state from game events ──────────────────────────────

  applyEvent(msg: Record<string, unknown>) {
    const sessionId = msg.sessionId as string;
    if (!sessionId) return;

    switch (msg.type) {
      case 'session_discovered':
      case 'hook_session_start': {
        if (!this.agents.has(sessionId)) {
          this.agents.set(sessionId, {
            sessionId,
            speciesIndex: msg.speciesIndex as number ?? this.agents.size,
            status:       'ready!',
            isActive:     true,
            username:     msg.username as string ?? 'anonymous',
          });
        } else {
          const agent = this.agents.get(sessionId)!;
          agent.isActive = true;
          agent.status = 'ready!';
          if (msg.username) agent.username = msg.username as string;
        }
        break;
      }
      case 'hook_tool_start':
      case 'tool_start': {
        const agent = this.agents.get(sessionId);
        if (agent) {
          agent.status   = msg.status as string ?? 'working';
          agent.isActive = true;
        }
        break;
      }
      case 'hook_stop':
      case 'turn_end': {
        const agent = this.agents.get(sessionId);
        if (agent) { agent.status = 'idle'; agent.isActive = false; }
        break;
      }
      case 'hook_session_end': {
        this.agents.delete(sessionId);
        break;
      }
    }
  }
}

interface Env {
  world: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
