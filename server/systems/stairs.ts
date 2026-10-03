// Stairs: standing in a stair zone and pressing USE moves you to the paired
// stairs on the other floor. A short per-player cooldown stops accidental
// double-tap bouncing.

import { STAIR_COOLDOWN_MS } from "../../shared/constants";
import type { HostelMap, Stair } from "../../shared/buildMap";
import type { Player } from "../schema/GameState";
import { teleport } from "./teleport";
import type { MovementSystem } from "./movement";

export class StairSystem {
  private lastUse = new Map<string, number>();

  constructor(private map: HostelMap, private movement: MovementSystem) {}

  /** `stair` must be the one the player is standing in (validated by the caller via useTarget). */
  use(player: Player, stair: Stair, now = Date.now()): boolean {
    const last = this.lastUse.get(player.id) ?? 0;
    if (now - last < STAIR_COOLDOWN_MS) return false;
    const target = this.map.stairs.get(stair.target);
    if (!target) return false;
    this.lastUse.set(player.id, now);
    teleport(player, target.floor, target.arrive.x, target.arrive.y, this.movement);
    return true;
  }

  removePlayer(id: string): void {
    this.lastUse.delete(id);
  }
}
