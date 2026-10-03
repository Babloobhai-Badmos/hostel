// Movement system: queues client inputs and applies them once per tick.
//
// Anti-cheat: a client can't move faster by sending more inputs. Each player
// earns one input credit per tick (banked up to INPUT_BUDGET_MAX), every
// input costs one credit and moves exactly one tick's worth of distance, and
// the direction vector is clamped to length 1. Speed comes from the server's
// record of the player's character, never from the client.

import {
  BASE_SPEED_PX_PER_SEC,
  INPUT_BUDGET_MAX,
  INPUT_QUEUE_MAX,
  PLAYER_RADIUS_PX,
  TICK_DT,
} from "../../shared/constants";
import { sanitizeDirection, stepGhost, stepMovement } from "../../shared/physics";
import type { CollisionGrid, InputMessage, Vec2 } from "../../shared/types";
import type { Player } from "../schema/GameState";

interface MoveRuntime {
  queue: { dir: Vec2; seq: number }[];
  budget: number;
  lastSeq: number;
  /** Last non-zero movement direction, radians. Killers swing this way. */
  facing: number;
}

/** walk = normal, ghost = through walls, frozen = inputs acknowledged but ignored. */
export type MoveMode = "walk" | "ghost" | "frozen";

export class MovementSystem {
  private runtimes = new Map<string, MoveRuntime>();

  /** One collision grid per floor id. */
  constructor(private grids: Map<number, CollisionGrid>) {}

  addPlayer(id: string): void {
    const facing = this.runtimes.get(id)?.facing ?? 0;
    this.runtimes.set(id, { queue: [], budget: 0, lastSeq: 0, facing });
  }

  removePlayer(id: string): void {
    this.runtimes.delete(id);
  }

  facing(id: string): number {
    return this.runtimes.get(id)?.facing ?? 0;
  }

  /** Validate and queue an input from a client. Out-of-order or replayed inputs are dropped. */
  enqueue(id: string, msg: unknown): void {
    const rt = this.runtimes.get(id);
    if (!rt || typeof msg !== "object" || msg === null) return;
    const input = msg as Partial<InputMessage>;
    const seq = input.seq;
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq <= rt.lastSeq) return;
    rt.lastSeq = seq;
    rt.queue.push({ dir: sanitizeDirection(input.dx, input.dy), seq });
    if (rt.queue.length > INPUT_QUEUE_MAX) rt.queue.splice(0, rt.queue.length - INPUT_QUEUE_MAX);
  }

  /** Forget queued inputs (e.g. after a teleport) but keep the sequence counter. */
  clearQueue(id: string): void {
    const rt = this.runtimes.get(id);
    if (rt) rt.queue.length = 0;
  }

  /**
   * Apply queued inputs to one player for this tick. A frozen player (hiding,
   * venting, role reveal) still has inputs acknowledged so the client's
   * prediction doesn't pile them up.
   */
  tick(player: Player, mode: MoveMode, speedMultiplier = 1): void {
    const rt = this.runtimes.get(player.id);
    const grid = this.grids.get(player.floor);
    if (!rt || !grid) return;
    rt.budget = Math.min(INPUT_BUDGET_MAX, rt.budget + 1);
    const speed = BASE_SPEED_PX_PER_SEC * speedMultiplier;
    while (rt.budget >= 1 && rt.queue.length > 0) {
      const input = rt.queue.shift()!;
      rt.budget -= 1;
      if (mode !== "frozen") {
        const step = mode === "ghost" ? stepGhost : stepMovement;
        const next = step(grid, player, input.dir, speed, TICK_DT, PLAYER_RADIUS_PX);
        player.x = next.x;
        player.y = next.y;
        if (input.dir.x !== 0 || input.dir.y !== 0) rt.facing = Math.atan2(input.dir.y, input.dir.x);
      }
      player.ack = input.seq;
    }
  }
}
