// What the USE button would do right now. The client calls this to label and
// enable the button; the server calls the same code to validate the request.

import { HIDE_RANGE_TILES, TILE_SIZE } from "./constants";
import type { FloorMap, HideSpot, HostelMap, Stair } from "./buildMap";

export type UseTarget =
  | { kind: "unhide" }
  | { kind: "stairs"; stair: Stair }
  | { kind: "hide"; spot: HideSpot };

export interface Actor {
  floor: number;
  x: number;
  y: number;
  hidden: boolean;
}

/** The stairs whose zone contains this point, if any. */
export function stairAt(floor: FloorMap, x: number, y: number): Stair | null {
  for (const s of floor.stairs) {
    if (x >= s.zone.x && x < s.zone.x + s.zone.w && y >= s.zone.y && y < s.zone.y + s.zone.h) return s;
  }
  return null;
}

/** The closest hiding spot within reach, if any. */
export function hideSpotNear(floor: FloorMap, x: number, y: number): HideSpot | null {
  const range = HIDE_RANGE_TILES * TILE_SIZE;
  let best: HideSpot | null = null;
  let bestD = range * range;
  for (const h of floor.hides) {
    const d = (h.x - x) ** 2 + (h.y - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

export function useTarget(map: HostelMap, actor: Actor): UseTarget | null {
  if (actor.hidden) return { kind: "unhide" };
  const floor = map.floors.get(actor.floor);
  if (!floor) return null;
  const stair = stairAt(floor, actor.x, actor.y);
  if (stair) return { kind: "stairs", stair };
  const spot = hideSpotNear(floor, actor.x, actor.y);
  if (spot) return { kind: "hide", spot };
  return null;
}
