// Movement system: queues client inputs and applies them once per tick.
//
// Anti-cheat: a client can't move faster by sending more inputs. Each player
// earns one input credit per tick (banked up to INPUT_BUDGET_MAX), every
// input costs one credit and moves exactly one tick's worth of distance, and
// the direction vector is clamped to length 1.

import {
  BASE_SPEED_PX_PER_SEC,
  INPUT_BUDGET_MAX,
  INPUT_QUEUE_MAX,
  PLAYER_RADIUS_PX,
  TICK_DT,
} from "../../shared/constants";
import { sanitizeDirection, stepMovement } from "../../shared/physics";
import type { CollisionGrid, InputMessage, Vec2 } from "../../shared/types";
import type { Player } from "../schema/GameState";

interface MoveRuntime {
  queue: { dir: Vec2; seq: number }[];
  budget: number;
  lastSeq: number;
}

export class MovementSystem {
  private runtimes = new Map<string, MoveRuntime>();

  constructor(private grid: CollisionGrid) {}

  addPlayer(id: string): void {
    this.runtimes.set(id, { queue: [], budget: 0, lastSeq: 0 });
  }

  removePlayer(id: string): void {
    this.runtimes.delete(id);
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

  /** Apply queued inputs to one player for this tick. */
  tick(player: Player, speedMultiplier = 1): void {
    const rt = this.runtimes.get(player.id);
    if (!rt) return;
    rt.budget = Math.min(INPUT_BUDGET_MAX, rt.budget + 1);
    const speed = BASE_SPEED_PX_PER_SEC * speedMultiplier;
    while (rt.budget >= 1 && rt.queue.length > 0) {
      const input = rt.queue.shift()!;
      rt.budget -= 1;
      const next = stepMovement(this.grid, player, input.dir, speed, TICK_DT, PLAYER_RADIUS_PX);
      player.x = next.x;
      player.y = next.y;
      player.ack = input.seq;
    }
  }
}
