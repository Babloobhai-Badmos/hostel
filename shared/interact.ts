// What the USE button would do right now. The client calls this to label and
// enable the button; the server calls the same code to validate the request.
//
// Priority: climb out > stairs > vent (killers) > body (Supreme Leader, revive)
// > your task station > door (open / close) > hiding spot.
// Near a hiding spot, crew HIDE and killers SEARCH. Ghosts can use stairs and
// do their tasks (which no longer count).

import { HIDE_RANGE_TILES, REVIVE_RANGE_TILES, TASK_RANGE_TILES, TILE_SIZE, VENT_RANGE_TILES } from "./constants";
import type { Doorway, FloorMap, HideSpot, HostelMap, Stair, TaskStation, Vent } from "./buildMap";
import { doorNear } from "./doors";

export type UseTarget =
  | { kind: "unhide" }
  | { kind: "stairs"; stair: Stair }
  | { kind: "vent"; vent: Vent }
  | { kind: "hide"; spot: HideSpot }
  | { kind: "search"; spot: HideSpot }
  | { kind: "task"; station: TaskStation }
  | { kind: "door"; doorway: Doorway; open: boolean }
  | { kind: "revive"; body: BodyRef };

export interface BodyRef {
  id: string;
  floor: number;
  x: number;
  y: number;
}

export interface Actor {
  floor: number;
  x: number;
  y: number;
  hidden: boolean;
  alive: boolean;
  isKiller: boolean;
  canVent: boolean;
  /** Ids of this player's unfinished tasks. */
  openTasks: readonly string[];
  /** Supreme Leader with a revive left: the bodies they could revive. Empty otherwise. */
  revivable: readonly BodyRef[];
  /** Doors this round: doorway id -> open. */
  doors: ReadonlyMap<string, boolean>;
}

/** The stairs whose zone contains this point, if any. */
export function stairAt(floor: FloorMap, x: number, y: number): Stair | null {
  for (const s of floor.stairs) {
    if (x >= s.zone.x && x < s.zone.x + s.zone.w && y >= s.zone.y && y < s.zone.y + s.zone.h) return s;
  }
  return null;
}

function nearest<T extends { x: number; y: number }>(items: T[], x: number, y: number, rangeTiles: number): T | null {
  const range = rangeTiles * TILE_SIZE;
  let best: T | null = null;
  let bestD = range * range;
  for (const it of items) {
    const d = (it.x - x) ** 2 + (it.y - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = it;
    }
  }
  return best;
}

/** The closest hiding spot within reach, if any. */
export function hideSpotNear(floor: FloorMap, x: number, y: number): HideSpot | null {
  return nearest(floor.hides, x, y, HIDE_RANGE_TILES);
}

/** Your closest unfinished task station within reach, if any. */
export function taskStationNear(floor: FloorMap, x: number, y: number, openTasks: readonly string[]): TaskStation | null {
  if (openTasks.length === 0) return null;
  return nearest(floor.tasks.filter((t) => openTasks.includes(t.taskId)), x, y, TASK_RANGE_TILES);
}

export function ventNear(floor: FloorMap, x: number, y: number): Vent | null {
  return nearest(floor.vents, x, y, VENT_RANGE_TILES);
}

export function useTarget(map: HostelMap, actor: Actor): UseTarget | null {
  if (actor.hidden) return { kind: "unhide" };
  const floor = map.floors.get(actor.floor);
  if (!floor) return null;
  const stair = stairAt(floor, actor.x, actor.y);
  if (stair) return { kind: "stairs", stair };
  if (actor.alive && actor.canVent) {
    const vent = ventNear(floor, actor.x, actor.y);
    if (vent) return { kind: "vent", vent };
  }
  if (actor.alive && actor.revivable.length > 0) {
    const body = nearest(actor.revivable.filter((b) => b.floor === actor.floor), actor.x, actor.y, REVIVE_RANGE_TILES);
    if (body) return { kind: "revive", body };
  }
  const station = taskStationNear(floor, actor.x, actor.y, actor.openTasks);
  if (station) return { kind: "task", station };
  if (!actor.alive) return null;
  const door = doorNear(floor, actor.x, actor.y, (id) => actor.doors.has(id));
  if (door) return { kind: "door", doorway: door, open: actor.doors.get(door.id)! };
  const spot = hideSpotNear(floor, actor.x, actor.y);
  if (spot) return actor.isKiller ? { kind: "search", spot } : { kind: "hide", spot };
  return null;
}
