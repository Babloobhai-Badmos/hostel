// Scripted test client shared by the self-test and other tools: joins a
// room, tracks private messages, and walks around the map like a player
// holding the joystick (breadth-first search over walkable tiles).

import { Client, Room } from "colyseus.js";
import { BASE_SPEED_PX_PER_SEC, INPUT_SEND_MS, ROOM_NAME, SERVER_PORT, TICK_DT, TILE_SIZE } from "../shared/constants";
import { hostelMap } from "../shared/world";
import { ClientMsg, ServerMsg } from "../shared/types";
import type { RoleMessage, TaskListMessage, TaskOpenMessage, Vec2 } from "../shared/types";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const DEFAULT_URL = `ws://localhost:${SERVER_PORT}`;

export interface PlayerView {
  x: number;
  y: number;
  floor: number;
  alive: boolean;
  hidden: boolean;
  venting: boolean;
  dashing: boolean;
  stunned: boolean;
  safe: boolean;
}

export class TestClient {
  constructor(private url = DEFAULT_URL) {}

  room!: Room;
  role: RoleMessage | null = null;
  tasks: TaskListMessage = { tasks: [], fake: false };
  lastOpen: TaskOpenMessage | null = null;
  closes = 0;
  chats: { name: string; text: string }[] = [];
  private seq = 0;

  /** Without `roomId`, creates a brand-new room so the test never lands in a real game. */
  async join(name: string, options: Record<string, unknown> = {}, roomId?: string): Promise<this> {
    const client = new Client(this.url);
    this.room = roomId ? await client.joinById(roomId, { name, ...options }) : await client.create(ROOM_NAME, { name, ...options });
    this.room.onMessage(ServerMsg.Role, (m: RoleMessage) => (this.role = m));
    this.room.onMessage(ServerMsg.TaskList, (m: TaskListMessage) => (this.tasks = m));
    this.room.onMessage(ServerMsg.TaskOpen, (m: TaskOpenMessage) => (this.lastOpen = m));
    this.room.onMessage(ServerMsg.TaskClose, () => this.closes++);
    this.room.onMessage(ServerMsg.Chat, (m: { name: string; text: string }) => this.chats.push(m));
    for (const t of [ServerMsg.Cooldowns, ServerMsg.Kill, ServerMsg.VentPop, ServerMsg.Search, ServerMsg.Results, ServerMsg.Error, ServerMsg.Fx]) {
      this.room.onMessage(t, () => {});
    }
    await sleep(200);
    return this;
  }

  get me(): PlayerView {
    return this.room.state.players.get(this.room.sessionId) as PlayerView;
  }

  send(type: string, msg?: unknown): void {
    this.room.send(type, msg);
  }

  input(dx: number, dy: number): void {
    this.room.send(ClientMsg.Input, { dx, dy, seq: ++this.seq });
  }

  /** Walk to a pixel position on the current floor along a tile path. */
  async walkTo(target: Vec2, timeoutMs = 30_000): Promise<boolean> {
    const floor = hostelMap.floors.get(this.me.floor)!;
    const path = tilePath(floor.grid, this.me, target);
    if (!path) return false;
    const waypoints = [...path.map((t) => ({ x: (t.x + 0.5) * TILE_SIZE, y: (t.y + 0.5) * TILE_SIZE })), target];
    const deadline = Date.now() + timeoutMs;
    for (const wp of waypoints) {
      while (Date.now() < deadline) {
        const dx = wp.x - this.me.x;
        const dy = wp.y - this.me.y;
        const d = Math.hypot(dx, dy);
        if (d < 4) break;
        // Don't overshoot: scale the last step down.
        const stepPx = BASE_SPEED_PX_PER_SEC * TICK_DT;
        const k = Math.min(1, d / stepPx);
        this.input((dx / d) * k, (dy / d) * k);
        await sleep(INPUT_SEND_MS);
      }
    }
    await sleep(150);
    return Math.hypot(target.x - this.me.x, target.y - this.me.y) < TILE_SIZE / 2;
  }

  leave(): Promise<number> {
    return this.room.leave();
  }
}

/** Breadth-first search over walkable tiles. */
export function tilePath(grid: { width: number; height: number; solid: Uint8Array }, from: Vec2, to: Vec2): Vec2[] | null {
  const key = (x: number, y: number) => y * grid.width + x;
  const sx = Math.floor(from.x / TILE_SIZE);
  const sy = Math.floor(from.y / TILE_SIZE);
  const tx = Math.floor(to.x / TILE_SIZE);
  const ty = Math.floor(to.y / TILE_SIZE);
  const prev = new Map<number, number>([[key(sx, sy), -1]]);
  const queue = [key(sx, sy)];
  while (queue.length) {
    const k = queue.shift()!;
    const x = k % grid.width;
    const y = Math.floor(k / grid.width);
    if (x === tx && y === ty) {
      const out: Vec2[] = [];
      for (let c = k; c !== -1; c = prev.get(c)!) out.unshift({ x: c % grid.width, y: Math.floor(c / grid.width) });
      return out;
    }
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      const nk = key(nx, ny);
      if (grid.solid[nk] || prev.has(nk)) continue;
      prev.set(nk, k);
      queue.push(nk);
    }
  }
  return null;
}

