// Hiding spots (cupboards, lockers, under beds, curtains...). USE near one to
// climb in: you snap to the spot, become invisible to everyone else and
// can't move. USE again to climb out. One person per spot.

import type { HideSpot } from "../../shared/buildMap";
import type { Player } from "../schema/GameState";

export type HideResult = "hidden" | "occupied";

export class HidingSystem {
  /** spot id -> player id */
  private occupant = new Map<string, string>();
  /** player id -> spot id */
  private spotOf = new Map<string, string>();

  enter(player: Player, spot: HideSpot): HideResult {
    if (this.occupant.has(spot.id)) return "occupied";
    this.occupant.set(spot.id, player.id);
    this.spotOf.set(player.id, spot.id);
    player.x = spot.x;
    player.y = spot.y;
    player.hidden = true;
    return "hidden";
  }

  exit(player: Player): void {
    const spot = this.spotOf.get(player.id);
    if (spot) this.occupant.delete(spot);
    this.spotOf.delete(player.id);
    player.hidden = false;
  }

  /** Empty every spot (round start). */
  reset(players: Iterable<Player>): void {
    for (const p of players) p.hidden = false;
    this.occupant.clear();
    this.spotOf.clear();
  }
}
