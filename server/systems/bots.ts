// Debug bots (?debug=1): server-side players with no client. They wander
// randomly by feeding inputs into the normal movement system, so every
// movement rule (walls, speed, input budget) applies to them too.

import type { Vec2 } from "../../shared/types";
import { Player } from "../schema/GameState";
import type { GameState } from "../schema/GameState";
import type { MovementSystem } from "./movement";

/** Chance per tick that a bot picks a new direction. */
const TURN_CHANCE = 0.04;
/** Chance per tick that a bot stands still for a moment instead. */
const PAUSE_CHANCE = 0.01;
const BOT_NAMES = [
  "Pappu", "Chintu", "Bunty", "Golu", "Monty", "Sonu", "Tinku", "Babloo", "Lucky", "Rinku",
  "Dabbu", "Guddu", "Titu", "Pinku", "Raju", "Chotu", "Bittu", "Montu", "Lalloo",
];

interface BotBrain {
  dir: Vec2;
  seq: number;
  lastX: number;
  lastY: number;
}

export class BotSystem {
  private brains = new Map<string, BotBrain>();
  private counter = 0;

  constructor(private state: GameState, private movement: MovementSystem) {}

  isBot(id: string): boolean {
    return this.brains.has(id);
  }

  count(): number {
    return this.brains.size;
  }

  /** Add one bot player at `spawn`; returns it so the room can finish setting it up. */
  add(spawn: Vec2, floor: number, color: number): Player {
    const id = `bot-${++this.counter}`;
    const p = new Player();
    p.id = id;
    p.name = `${BOT_NAMES[(this.counter - 1) % BOT_NAMES.length]} (bot)`;
    p.color = color;
    p.floor = floor;
    p.x = spawn.x;
    p.y = spawn.y;
    this.state.players.set(id, p);
    this.movement.addPlayer(id);
    this.brains.set(id, { dir: randomDir(), seq: 0, lastX: p.x, lastY: p.y });
    return p;
  }

  removeAll(): void {
    for (const id of this.brains.keys()) {
      this.state.players.delete(id);
      this.movement.removePlayer(id);
    }
    this.brains.clear();
  }

  /** Feed each bot one input per tick, turning randomly or when stuck on a wall. */
  tick(): void {
    for (const [id, brain] of this.brains) {
      const p = this.state.players.get(id);
      if (!p) continue;
      const moving = brain.dir.x !== 0 || brain.dir.y !== 0;
      const stuck = moving && Math.abs(p.x - brain.lastX) + Math.abs(p.y - brain.lastY) < 0.5;
      if (stuck || Math.random() < TURN_CHANCE) brain.dir = randomDir();
      if (Math.random() < PAUSE_CHANCE) brain.dir = { x: 0, y: 0 };
      brain.lastX = p.x;
      brain.lastY = p.y;
      this.movement.enqueue(id, { dx: brain.dir.x, dy: brain.dir.y, seq: ++brain.seq });
    }
  }
}

function randomDir(): Vec2 {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}
