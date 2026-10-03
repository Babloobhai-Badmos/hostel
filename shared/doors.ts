// Doors, shared by the server (authoritative) and the client (prediction and
// vision). A closed door is just its doorway tiles turned solid in the
// collision grid, so movement, attacks and line of sight all respect it
// without knowing doors exist.
//
// Each round the server picks DOOR_ROOM_FRACTION of the rooms to get doors
// (every doorway of a picked room gets one) and keeps their open/closed state
// in GameState.doors (doorway id -> open).

import { DOOR_RANGE_TILES, TILE_SIZE } from "./constants";
import type { Doorway, FloorMap, HostelMap } from "./buildMap";
import type { Vec2 } from "./types";

/** doorwaySides(): distance from the middle of the doorway. */
const SIDE_PX = TILE_SIZE * 1.25;

/** Open or close a door by setting its doorway tiles solid or walkable. */
export function setDoorClosed(floor: FloorMap, doorway: Doorway, closed: boolean): void {
  for (const t of doorway.tiles) floor.grid.solid[t.y * floor.grid.width + t.x] = closed ? 1 : 0;
}

/**
 * A copy of the map whose floors have their own collision grids, so each
 * game room can open and close its doors without touching other rooms.
 * Everything else (areas, objects) is shared and read-only.
 */
export function withOwnGrids(map: HostelMap): HostelMap {
  const floors = new Map(
    [...map.floors].map(([id, f]) => [id, { ...f, grid: { ...f.grid, solid: f.grid.solid.slice() } }] as const),
  );
  return { ...map, floors };
}

/** The doorway with a door nearest to (x, y) within reach, if any. */
export function doorNear(
  floor: FloorMap,
  x: number,
  y: number,
  hasDoor: (id: string) => boolean,
  rangeTiles = DOOR_RANGE_TILES,
): Doorway | null {
  let best: Doorway | null = null;
  let bestD = (rangeTiles * TILE_SIZE) ** 2;
  for (const d of floor.doorways) {
    if (!hasDoor(d.id)) continue;
    const dist = (d.x - x) ** 2 + (d.y - y) ** 2;
    if (dist <= bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

/**
 * Points just inside the doorway's room and just outside it, straight through
 * the gap: far enough that someone standing there is clear of the door, close
 * enough to reach it with USE.
 */
export function doorwaySides(floor: FloorMap, doorway: Doorway): { inside: Vec2; outside: Vec2 } {
  const room = floor.areas.find((a) => a.key === doorway.room)!.rect;
  const cx = (room.x + room.w / 2) * TILE_SIZE;
  const cy = (room.y + room.h / 2) * TILE_SIZE;
  const dir = doorway.horizontal ? { x: 0, y: Math.sign(cy - doorway.y) } : { x: Math.sign(cx - doorway.x), y: 0 };
  return {
    inside: { x: doorway.x + dir.x * SIDE_PX, y: doorway.y + dir.y * SIDE_PX },
    outside: { x: doorway.x - dir.x * SIDE_PX, y: doorway.y - dir.y * SIDE_PX },
  };
}

/** True if a circle (a body standing there) overlaps the doorway, so the door can't shut. */
export function doorwayBlocked(doorway: Doorway, bodies: Iterable<{ x: number; y: number }>, radius: number): boolean {
  for (const b of bodies) {
    for (const t of doorway.tiles) {
      const cx = Math.max(t.x * TILE_SIZE, Math.min(b.x, (t.x + 1) * TILE_SIZE));
      const cy = Math.max(t.y * TILE_SIZE, Math.min(b.y, (t.y + 1) * TILE_SIZE));
      if ((b.x - cx) ** 2 + (b.y - cy) ** 2 < radius * radius) return true;
    }
  }
  return false;
}

/**
 * Indexes of the areas (rooms and corridors) on this floor you can see from
 * area `from`: everything connected to it except through a closed door.
 */
export function visibleAreas(floor: FloorMap, from: number, isClosed: (doorwayId: string) => boolean): Set<number> {
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const a = queue.pop()!;
    for (const l of floor.links) {
      if (l.a !== a && l.b !== a) continue;
      if (l.doorway && isClosed(l.doorway)) continue;
      const b = l.a === a ? l.b : l.a;
      if (seen.has(b)) continue;
      seen.add(b);
      queue.push(b);
    }
  }
  return seen;
}

/**
 * Pick DOOR_ROOM_FRACTION of the rooms at random; returns the ids of all their
 * doorways. Stairwells are left out: the whole stair room is the "take the
 * stairs" zone, so a door there couldn't be opened from inside.
 */
export function pickDoorways(map: HostelMap, fraction: number, random: () => number = Math.random): string[] {
  const rooms = new Map<string, string[]>();
  for (const d of map.doorways.values()) {
    if (map.stairs.has(d.room)) continue;
    rooms.set(d.room, [...(rooms.get(d.room) ?? []), d.id]);
  }
  const keys = [...rooms.keys()];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.slice(0, Math.round(keys.length * fraction)).flatMap((k) => rooms.get(k)!);
}
