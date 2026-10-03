// Vents (killers with canVent only): USE next to a grate, the grate pops,
// you spend VENT_TRAVEL_MS invisible in the pipes, then pop out of the paired
// grate (possibly on the other floor). VENT_COOLDOWN_SECONDS between uses.

import { VENT_COOLDOWN_SECONDS, VENT_TRAVEL_MS } from "../../shared/constants";
import type { HostelMap, Vent } from "../../shared/buildMap";
import type { VentPopMessage } from "../../shared/types";
import type { Player } from "../schema/GameState";
import type { MovementSystem } from "./movement";
import type { RoleSystem } from "./roles";
import { teleport } from "./teleport";

const MS = 1000;

export class VentSystem {
  private nextVentAt = new Map<string, number>();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private map: HostelMap,
    private roles: RoleSystem,
    private movement: MovementSystem,
    private onPop: (msg: VentPopMessage) => void,
  ) {}

  readyIn(id: string, now: number): number {
    return Math.max(0, (this.nextVentAt.get(id) ?? 0) - now);
  }

  /** `vent` must be the one the player is next to (validated by the caller via useTarget). */
  use(player: Player, vent: Vent, now: number): boolean {
    if (!player.alive || player.venting || player.hidden) return false;
    if (!this.roles.get(player.id)?.canVent) return false;
    if (now < (this.nextVentAt.get(player.id) ?? 0)) return false;
    const exit = this.map.vents.get(vent.target);
    if (!exit) return false;

    this.nextVentAt.set(player.id, now + VENT_COOLDOWN_SECONDS * MS + VENT_TRAVEL_MS);
    player.venting = true;
    this.movement.clearQueue(player.id);
    this.onPop({ floor: vent.floor, x: vent.x, y: vent.y });
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      teleport(player, exit.floor, exit.x, exit.y, this.movement);
      player.venting = false;
      this.onPop({ floor: exit.floor, x: exit.x, y: exit.y });
    }, VENT_TRAVEL_MS);
    this.timers.add(timer);
    return true;
  }

  /** Round over: cancel anyone mid-pipe and forget cooldowns. */
  reset(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.nextVentAt.clear();
  }

  removePlayer(id: string): void {
    this.nextVentAt.delete(id);
  }
}
