// Moving a player instantly (stairs, vents, round start). Bumping `tp` tells
// clients to snap instead of interpolating across the map.

import type { Player } from "../schema/GameState";
import type { MovementSystem } from "./movement";

/** `tp` is a uint8 in the schema. */
const TP_WRAP = 256;

export function teleport(player: Player, floor: number, x: number, y: number, movement: MovementSystem): void {
  player.floor = floor;
  player.x = x;
  player.y = y;
  player.tp = (player.tp + 1) % TP_WRAP;
  movement.clearQueue(player.id);
}
