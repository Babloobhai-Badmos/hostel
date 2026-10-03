// Builds both hostel floors from layout.json + tasks.json: collision grid,
// per-tile area lookup, furniture, hiding spots, vents, stairs, task stations
// and spawn points. Server and client both call this, so they always agree on
// where the walls are.
//
// Any mistake in layout.json throws a MapError naming the room and problem.

import {
  CORRIDOR_WIDTH_TILES,
  DOOR_WIDTH_TILES,
  SPAWN_GRID_SPACING_TILES,
  TILE_SIZE,
} from "./constants";
import type { CollisionGrid, Vec2 } from "./types";

// ---------- layout.json shapes ----------

export type Side = "N" | "S" | "E" | "W";
export type Anchor = "NW" | "NE" | "SW" | "SE" | "N" | "S" | "E" | "W" | "C";

export interface DoorDef {
  side: Side;
  at?: number;
}
export interface RoomDef {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  doors?: DoorDef[];
}
export interface CorridorDef {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FloorDef {
  id: number;
  name: string;
  width: number;
  height: number;
  rooms: RoomDef[];
  corridors: CorridorDef[];
}
export interface FurnitureDef {
  type: string;
  w: number;
  h: number;
  anchor: Anchor;
  dx?: number;
  dy?: number;
  solid?: boolean;
  hide?: boolean;
}
export interface LayoutDef {
  sizes: Record<string, [number, number]>;
  floors: FloorDef[];
  stairs: [string, string][];
  vents: [string, string][];
  spawn: { room: string; cols: number; rows: number };
  chatRooms?: string[];
  lockers: { spacing: number };
  furniture: Record<string, FurnitureDef[] | string>;
}
export interface TaskDef {
  id: string;
  name: string;
  room: string;
  type: string;
}

// ---------- Built map shapes ----------

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Area {
  /** Global key, e.g. "F2:303". */
  key: string;
  id: string;
  label: string;
  kind: string;
  corridor: boolean;
  floor: number;
  rect: TileRect;
}

export interface Furniture {
  type: string;
  rect: TileRect;
  solid: boolean;
}

export interface HideSpot {
  /** Unique across the whole map, e.g. "F2:hide:7". */
  id: string;
  type: string;
  floor: number;
  area: string;
  tile: Vec2;
  /** Pixel centre. */
  x: number;
  y: number;
}

export interface Vent {
  id: string;
  floor: number;
  area: string;
  x: number;
  y: number;
  /** id of the paired vent. */
  target: string;
}

export interface Stair {
  /** Same as the area key, e.g. "F2:Stair W". */
  id: string;
  floor: number;
  /** Pixel rectangle you have to stand in to use the stairs. */
  zone: { x: number; y: number; w: number; h: number };
  /** Where you appear when arriving from the other floor. */
  arrive: Vec2;
  target: string;
}

export interface TaskStation {
  taskId: string;
  name: string;
  type: string;
  floor: number;
  area: string;
  x: number;
  y: number;
}

/** A doorway cut in a room's wall (DOOR_WIDTH_TILES wide). Some get real doors each round. */
export interface Doorway {
  /** Unique across the map, e.g. "F2:303:d0". */
  id: string;
  floor: number;
  /** Area key of the room it belongs to. */
  room: string;
  /** The wall tiles that were cut out. */
  tiles: Vec2[];
  /** Pixel centre of the gap. */
  x: number;
  y: number;
  /** true when the gap runs left-right (a door in a north or south wall). */
  horizontal: boolean;
}

/** Two areas that touch. Through a doorway, or directly (e.g. corridors meeting). */
export interface AreaLink {
  a: number;
  b: number;
  /** Doorway id when they only meet through a doorway. */
  doorway: string | null;
}

export interface FloorMap {
  id: number;
  name: string;
  grid: CollisionGrid;
  /** Per tile: index into `areas`, or -1 for wall. */
  areaIndex: Int16Array;
  areas: Area[];
  furniture: Furniture[];
  hides: HideSpot[];
  vents: Vent[];
  stairs: Stair[];
  tasks: TaskStation[];
  /** Door-gap tiles (the cut-out wall tiles), for the power-cut flicker. */
  doors: Vec2[];
  doorways: Doorway[];
  /** Per tile: index into `doorways`, or -1. */
  doorwayIndex: Int16Array;
  /** Which areas touch which (for "what can I see from here"). */
  links: AreaLink[];
}

export interface HostelMap {
  floors: Map<number, FloorMap>;
  floorIds: number[];
  spawnFloor: number;
  spawns: Vec2[];
  stairs: Map<string, Stair>;
  vents: Map<string, Vent>;
  hides: Map<string, HideSpot>;
  tasks: Map<string, TaskStation>;
  doorways: Map<string, Doorway>;
  /** Area keys where living players can chat (layout.json "chatRooms"). */
  chatRooms: string[];
}

export class MapError extends Error {
  constructor(message: string) {
    super(`layout.json: ${message}`);
    this.name = "MapError";
  }
}

// ---------- Helpers ----------

/** Objects keep at least this far (per axis) from spawn markers. */
const AVOID_PX = TILE_SIZE * 0.6;

const tileCentre = (tx: number, ty: number): Vec2 => ({
  x: (tx + 0.5) * TILE_SIZE,
  y: (ty + 0.5) * TILE_SIZE,
});

function parseRef(ref: string): { floor: number; id: string } {
  const m = /^F(\d+):(.+)$/.exec(ref);
  if (!m) throw new MapError(`"${ref}" should look like F2:303`);
  return { floor: Number(m[1]), id: m[2] };
}

/** Builder for a single floor. Keeps its scratch state together. */
class FloorBuilder {
  readonly width: number;
  readonly height: number;
  readonly solid: Uint8Array;
  readonly areaIndex: Int16Array;
  /** Tiles that must stay free (door aprons, objects). */
  readonly reserved: Uint8Array;
  readonly areas: Area[] = [];
  readonly furniture: Furniture[] = [];
  readonly hides: HideSpot[] = [];
  readonly doors: Vec2[] = [];
  readonly doorways: Doorway[] = [];
  readonly doorwayIndex: Int16Array;
  private roomDefs = new Map<string, RoomDef & { w: number; h: number }>();

  constructor(readonly def: FloorDef, private layout: LayoutDef) {
    this.width = def.width;
    this.height = def.height;
    const n = def.width * def.height;
    this.solid = new Uint8Array(n).fill(1);
    this.areaIndex = new Int16Array(n).fill(-1);
    this.reserved = new Uint8Array(n);
    this.doorwayIndex = new Int16Array(n).fill(-1);
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isFree(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.solid[this.idx(x, y)] === 0;
  }

  area(id: string): Area | undefined {
    return this.areas.find((a) => a.id === id);
  }

  build(): void {
    const f = this.def;
    // 1. Corridors first, so rooms drawn later own the tiles where they overlap (they shouldn't).
    for (const c of f.corridors) {
      if (Math.min(c.w, c.h) !== CORRIDOR_WIDTH_TILES) {
        throw new MapError(
          `F${f.id} corridor "${c.id}" is ${c.w}x${c.h}; corridors must be ${CORRIDOR_WIDTH_TILES} tiles wide`,
        );
      }
      this.carve({ key: `F${f.id}:${c.id}`, id: c.id, label: c.label, kind: "corridor", corridor: true, floor: f.id, rect: { x: c.x, y: c.y, w: c.w, h: c.h } });
    }
    // 2. Rooms.
    for (const r of f.rooms) {
      const size = this.layout.sizes[r.kind];
      const w = r.w ?? size?.[0];
      const h = r.h ?? size?.[1];
      if (!w || !h) throw new MapError(`F${f.id} room "${r.id}" has no w/h and kind "${r.kind}" has no default size`);
      if (this.roomDefs.has(r.id) || f.corridors.some((c) => c.id === r.id)) {
        throw new MapError(`F${f.id} has two areas with id "${r.id}"`);
      }
      this.roomDefs.set(r.id, { ...r, w, h });
      this.carve({ key: `F${f.id}:${r.id}`, id: r.id, label: r.label, kind: r.kind, corridor: false, floor: f.id, rect: { x: r.x, y: r.y, w, h } });
    }
    // 3. Doors.
    for (const r of this.roomDefs.values()) {
      const doors = r.doors ?? [];
      if (doors.length === 0) throw new MapError(`F${f.id} room "${r.id}" has no doors`);
      doors.forEach((d, i) => this.cutDoor(r, d, i));
    }
    // 4. Furniture + hiding spots.
    for (const r of this.roomDefs.values()) this.furnish(r);
    this.placeLockers();
  }

  private carve(area: Area): void {
    const { x, y, w, h } = area.rect;
    if (x < 1 || y < 1 || x + w > this.width - 1 || y + h > this.height - 1) {
      throw new MapError(`${area.key} sticks out of the floor (floor is ${this.width}x${this.height}, outer ring is wall)`);
    }
    const index = this.areas.length;
    this.areas.push(area);
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        const i = this.idx(tx, ty);
        if (!area.corridor && this.areaIndex[i] !== -1) {
          throw new MapError(`${area.key} overlaps ${this.areas[this.areaIndex[i]].key} at tile ${tx},${ty}`);
        }
        this.solid[i] = 0;
        this.areaIndex[i] = index;
      }
    }
  }

  /** Cut a DOOR_WIDTH_TILES gap in the wall on one side and check it leads somewhere. */
  private cutDoor(r: RoomDef & { w: number; h: number }, d: DoorDef, n: number): void {
    const horizontal = d.side === "N" || d.side === "S";
    const length = horizontal ? r.w : r.h;
    const at = d.at ?? Math.floor((length - DOOR_WIDTH_TILES) / 2);
    if (at < 0 || at + DOOR_WIDTH_TILES > length) {
      throw new MapError(`F${this.def.id} room "${r.id}" door ${d.side} at ${at} doesn't fit on a side of length ${length}`);
    }
    const index = this.areas.findIndex((a) => a.id === r.id);
    const doorway: Doorway = {
      id: `F${this.def.id}:${r.id}:d${n}`,
      floor: this.def.id,
      room: this.areas[index].key,
      tiles: [],
      x: 0,
      y: 0,
      horizontal,
    };
    for (let k = 0; k < DOOR_WIDTH_TILES; k++) {
      let wx: number, wy: number, ox: number, oy: number, ix: number, iy: number;
      if (horizontal) {
        wx = r.x + at + k;
        wy = d.side === "N" ? r.y - 1 : r.y + r.h;
        ox = wx;
        oy = d.side === "N" ? wy - 1 : wy + 1;
        ix = wx;
        iy = d.side === "N" ? r.y : r.y + r.h - 1;
      } else {
        wy = r.y + at + k;
        wx = d.side === "W" ? r.x - 1 : r.x + r.w;
        oy = wy;
        ox = d.side === "W" ? wx - 1 : wx + 1;
        iy = wy;
        ix = d.side === "W" ? r.x : r.x + r.w - 1;
      }
      if (!this.isFree(ox, oy)) {
        throw new MapError(
          `F${this.def.id} room "${r.id}" door ${d.side}${d.at !== undefined ? ` at ${d.at}` : ""} leads into a wall (tile ${ox},${oy}). Rooms need exactly 1 wall tile between them and the next area.`,
        );
      }
      const wi = this.idx(wx, wy);
      if (this.doorwayIndex[wi] >= 0) {
        throw new MapError(
          `F${this.def.id} room "${r.id}" door ${d.side} uses the same wall tiles as ${this.doorways[this.doorwayIndex[wi]].id}; list a shared door on one room only`,
        );
      }
      this.doors.push({ x: wx, y: wy });
      doorway.tiles.push({ x: wx, y: wy });
      this.doorwayIndex[wi] = this.doorways.length;
      this.solid[wi] = 0;
      this.areaIndex[wi] = index;
      // Keep the tiles just inside and outside the doorway clear of furniture.
      this.reserved[wi] = 1;
      this.reserved[this.idx(ix, iy)] = 1;
      this.reserved[this.idx(ox, oy)] = 1;
    }
    doorway.x = (doorway.tiles.reduce((sum, t) => sum + t.x, 0) / doorway.tiles.length + 0.5) * TILE_SIZE;
    doorway.y = (doorway.tiles.reduce((sum, t) => sum + t.y, 0) / doorway.tiles.length + 0.5) * TILE_SIZE;
    this.doorways.push(doorway);
  }

  /** Every pair of areas with neighbouring walkable tiles, and the doorway between them if any. */
  links(): AreaLink[] {
    const seen = new Map<string, AreaLink>();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = this.idx(x, y);
        const a = this.areaIndex[i];
        if (a < 0) continue;
        for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          const b = this.areaIndex[j];
          if (b < 0 || b === a) continue;
          const d = this.doorwayIndex[i] >= 0 ? this.doorwayIndex[i] : this.doorwayIndex[j];
          const doorway = d >= 0 ? this.doorways[d].id : null;
          const key = `${Math.min(a, b)}-${Math.max(a, b)}-${doorway ?? ""}`;
          if (!seen.has(key)) seen.set(key, { a, b, doorway });
        }
      }
    }
    return [...seen.values()];
  }

  private furnish(r: RoomDef & { w: number; h: number }): void {
    const entry = this.layout.furniture[r.kind];
    const pieces = Array.isArray(entry) ? entry : [];
    const area = this.area(r.id)!;
    for (const p of pieces) {
      for (const rect of this.candidates(r, p)) {
        if (this.tryPlace(r, area, p, rect)) break;
      }
    }
  }

  /** The piece at its anchor, then mirrored variants, so a door in the way doesn't drop it. */
  private candidates(r: { x: number; y: number; w: number; h: number }, p: FurnitureDef): TileRect[] {
    const dx = p.dx ?? 0;
    const dy = p.dy ?? 0;
    const mirrorX: Record<Anchor, Anchor> = { NW: "NE", NE: "NW", SW: "SE", SE: "SW", N: "N", S: "S", E: "W", W: "E", C: "C" };
    const mirrorY: Record<Anchor, Anchor> = { NW: "SW", NE: "SE", SW: "NW", SE: "NE", N: "S", S: "N", E: "E", W: "W", C: "C" };
    const variants: [Anchor, number, number][] = [
      [p.anchor, dx, dy],
      [mirrorX[p.anchor], p.anchor === "C" ? -dx : dx, dy],
      [mirrorY[p.anchor], dx, p.anchor === "C" ? -dy : dy],
      [mirrorY[mirrorX[p.anchor]], p.anchor === "C" ? -dx : dx, p.anchor === "C" ? -dy : dy],
    ];
    return variants.map(([anchor, ox, oy]) => {
      let x: number;
      let y: number;
      // Horizontal placement: dx pushes inward from the anchored edge (or offsets from centre).
      if (anchor === "NW" || anchor === "SW" || anchor === "W") x = r.x + ox;
      else if (anchor === "NE" || anchor === "SE" || anchor === "E") x = r.x + r.w - p.w - ox;
      else x = r.x + Math.floor((r.w - p.w) / 2) + ox;
      if (anchor === "NW" || anchor === "NE" || anchor === "N") y = r.y + oy;
      else if (anchor === "SW" || anchor === "SE" || anchor === "S") y = r.y + r.h - p.h - oy;
      else y = r.y + Math.floor((r.h - p.h) / 2) + oy;
      return { x, y, w: p.w, h: p.h };
    });
  }

  private tryPlace(r: { x: number; y: number; w: number; h: number }, area: Area, p: FurnitureDef, rect: TileRect): boolean {
    if (rect.x < r.x || rect.y < r.y || rect.x + rect.w > r.x + r.w || rect.y + rect.h > r.y + r.h) return false;
    for (let ty = rect.y; ty < rect.y + rect.h; ty++) {
      for (let tx = rect.x; tx < rect.x + rect.w; tx++) {
        const i = this.idx(tx, ty);
        if (this.solid[i] || this.reserved[i]) return false;
      }
    }
    const solid = !!p.solid && !p.hide;
    if (solid) {
      for (let ty = rect.y; ty < rect.y + rect.h; ty++)
        for (let tx = rect.x; tx < rect.x + rect.w; tx++) this.solid[this.idx(tx, ty)] = 1;
      if (!this.roomConnected(r)) {
        for (let ty = rect.y; ty < rect.y + rect.h; ty++)
          for (let tx = rect.x; tx < rect.x + rect.w; tx++) this.solid[this.idx(tx, ty)] = 0;
        return false;
      }
    }
    for (let ty = rect.y; ty < rect.y + rect.h; ty++)
      for (let tx = rect.x; tx < rect.x + rect.w; tx++) this.reserved[this.idx(tx, ty)] = 1;
    this.furniture.push({ type: p.type, rect, solid });
    if (p.hide) this.addHide(p.type, area, rect.x, rect.y);
    return true;
  }

  addHide(type: string, area: Area, tx: number, ty: number): void {
    const c = tileCentre(tx, ty);
    this.hides.push({ id: `F${this.def.id}:hide:${this.hides.length}`, type, floor: this.def.id, area: area.key, tile: { x: tx, y: ty }, ...c });
  }

  /**
   * All free tiles in a room (including the tiles inside each doorway) must
   * still reach each other. A 1-tile gap is enough to walk through: a tile is
   * 32 px and a player is 24 px wide.
   */
  private roomConnected(r: { x: number; y: number; w: number; h: number }): boolean {
    const free: number[] = [];
    for (let ty = r.y; ty < r.y + r.h; ty++)
      for (let tx = r.x; tx < r.x + r.w; tx++) if (!this.solid[this.idx(tx, ty)]) free.push(this.idx(tx, ty));
    if (free.length === 0) return false;
    const seen = new Set<number>([free[0]]);
    const stack = [free[0]];
    while (stack.length) {
      const i = stack.pop()!;
      const tx = i % this.width;
      const ty = Math.floor(i / this.width);
      for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]]) {
        if (nx < r.x || ny < r.y || nx >= r.x + r.w || ny >= r.y + r.h) continue;
        const j = this.idx(nx, ny);
        if (!this.solid[j] && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    return seen.size === free.length;
  }

  /** Lockers along corridor walls (skipping door gaps and junctions). */
  private placeLockers(): void {
    const spacing = this.layout.lockers?.spacing ?? 0;
    if (spacing <= 0) return;
    for (const area of this.areas) {
      if (!area.corridor) continue;
      const { x, y, w, h } = area.rect;
      const horizontal = w > h;
      const length = horizontal ? w : h;
      for (let k = Math.floor(spacing / 2); k < length; k += spacing) {
        // Hug the first wall side (top for horizontal corridors, left for vertical).
        const tx = horizontal ? x + k : x;
        const ty = horizontal ? y : y + k;
        const wx = horizontal ? tx : tx - 1;
        const wy = horizontal ? ty - 1 : ty;
        const i = this.idx(tx, ty);
        if (this.reserved[i] || this.areaIndex[i] !== this.areas.indexOf(area)) continue;
        if (this.isFree(wx, wy)) continue; // that's a doorway or a junction, not a wall
        this.reserved[i] = 1;
        this.furniture.push({ type: "locker", rect: { x: tx, y: ty, w: 1, h: 1 }, solid: false });
        this.addHide("locker", area, tx, ty);
      }
    }
  }

  /** Free tile in an area closest to a preferred point, skipping reserved tiles and `avoid`. */
  freeTileIn(area: Area, prefer: Vec2, avoid: Vec2[] = []): Vec2 {
    const { x, y, w, h } = area.rect;
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        const i = this.idx(tx, ty);
        if (this.solid[i] || this.reserved[i]) continue;
        const c = tileCentre(tx, ty);
        if (avoid.some((a) => Math.abs(a.x - c.x) < AVOID_PX && Math.abs(a.y - c.y) < AVOID_PX)) continue;
        const d = (tx + 0.5 - prefer.x) ** 2 + (ty + 0.5 - prefer.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x: tx, y: ty };
        }
      }
    }
    if (!best) throw new MapError(`${area.key} has no free tile left for an object`);
    this.reserved[this.idx(best.x, best.y)] = 1;
    return best;
  }

  /** Every area on this floor must be reachable from `start`. */
  checkReachable(start: Vec2): void {
    const startTile = { x: Math.floor(start.x / TILE_SIZE), y: Math.floor(start.y / TILE_SIZE) };
    const seen = new Uint8Array(this.width * this.height);
    const stack = [this.idx(startTile.x, startTile.y)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const tx = i % this.width;
      const ty = Math.floor(i / this.width);
      for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]]) {
        if (!this.isFree(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (!seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    for (let i = 0; i < seen.length; i++) {
      if (!this.solid[i] && !seen[i]) {
        const a = this.areas[this.areaIndex[i]];
        throw new MapError(`${a?.key ?? "a tile"} can't be reached (tile ${i % this.width},${Math.floor(i / this.width)})`);
      }
    }
  }
}

// ---------- Entry point ----------

export function buildHostelMap(layout: LayoutDef, tasks: TaskDef[]): HostelMap {
  const builders = new Map<number, FloorBuilder>();
  for (const f of layout.floors) {
    if (builders.has(f.id)) throw new MapError(`two floors with id ${f.id}`);
    const b = new FloorBuilder(f, layout);
    b.build();
    builders.set(f.id, b);
  }

  const findArea = (ref: string): { b: FloorBuilder; area: Area } => {
    const { floor, id } = parseRef(ref);
    const b = builders.get(floor);
    const area = b?.area(id);
    if (!b || !area) throw new MapError(`unknown room "${ref}"`);
    return { b, area };
  };
  const centreOf = (a: Area): Vec2 => ({ x: a.rect.x + a.rect.w / 2, y: a.rect.y + a.rect.h / 2 });

  // Spawn grid.
  const spawnRef = findArea(layout.spawn.room);
  const spawns: Vec2[] = [];
  {
    const { rect } = spawnRef.area;
    const spacing = SPAWN_GRID_SPACING_TILES * TILE_SIZE;
    const cx = (rect.x + rect.w / 2) * TILE_SIZE;
    const cy = (rect.y + rect.h / 2) * TILE_SIZE;
    for (let row = 0; row < layout.spawn.rows; row++) {
      for (let col = 0; col < layout.spawn.cols; col++) {
        spawns.push({
          x: cx + (col - (layout.spawn.cols - 1) / 2) * spacing,
          y: cy + (row - (layout.spawn.rows - 1) / 2) * spacing,
        });
      }
    }
  }
  const spawnFloor = parseRef(layout.spawn.room).floor;

  // Stairs.
  const stairs = new Map<string, Stair>();
  for (const pair of layout.stairs) {
    const ends = pair.map(findArea);
    for (let k = 0; k < 2; k++) {
      const { area } = ends[k];
      const other = ends[1 - k].area;
      const r = area.rect;
      stairs.set(area.key, {
        id: area.key,
        floor: area.floor,
        zone: { x: r.x * TILE_SIZE, y: r.y * TILE_SIZE, w: r.w * TILE_SIZE, h: r.h * TILE_SIZE },
        arrive: { x: (r.x + r.w / 2) * TILE_SIZE, y: (r.y + r.h / 2) * TILE_SIZE },
        target: other.key,
      });
    }
  }

  // Vents: one grate per room per pairing, tucked into a corner.
  const vents = new Map<string, Vent>();
  for (const pair of layout.vents) {
    const ends = pair.map(findArea);
    if (pair[0] === layout.spawn.room || pair[1] === layout.spawn.room) {
      throw new MapError("the spawn room can't have a vent");
    }
    const ids = pair.map((ref) => `${ref}:vent`);
    if (ids[0] === ids[1]) throw new MapError(`vent "${pair[0]}" pairs with itself`);
    for (let k = 0; k < 2; k++) {
      const { b, area } = ends[k];
      if (vents.has(ids[k])) throw new MapError(`room ${area.key} has two vents; pair each room only once`);
      const r = area.rect;
      const t = b.freeTileIn(area, { x: r.x + r.w - 0.5, y: r.y + r.h - 0.5 });
      vents.set(ids[k], { id: ids[k], floor: area.floor, area: area.key, ...tileCentre(t.x, t.y), target: ids[1 - k] });
    }
  }

  // Task stations: near the middle of their room, never on a spawn marker.
  const taskStations = new Map<string, TaskStation>();
  for (const t of tasks) {
    if (taskStations.has(t.id)) throw new MapError(`tasks.json has two tasks with id "${t.id}"`);
    const { b, area } = findArea(t.room);
    const pos = b.freeTileIn(area, centreOf(area), area.key === spawnRef.area.key ? spawns : []);
    taskStations.set(t.id, { taskId: t.id, name: t.name, type: t.type, floor: area.floor, area: area.key, ...tileCentre(pos.x, pos.y) });
  }

  // Reachability: spawn floor from spawn, other floors from any of their stairs.
  for (const [id, b] of builders) {
    const start = id === spawnFloor ? spawns[0] : [...stairs.values()].find((s) => s.floor === id)?.arrive;
    if (!start) throw new MapError(`Floor ${id} has no stairs connecting it`);
    b.checkReachable(start);
  }
  for (const s of spawns) {
    const tx = Math.floor(s.x / TILE_SIZE);
    const ty = Math.floor(s.y / TILE_SIZE);
    if (!builders.get(spawnFloor)!.isFree(tx, ty)) throw new MapError("a spawn marker lands on a wall; make the spawn room bigger");
  }

  const floors = new Map<number, FloorMap>();
  const hides = new Map<string, HideSpot>();
  for (const [id, b] of builders) {
    for (const h of b.hides) hides.set(h.id, h);
    floors.set(id, {
      id,
      name: b.def.name,
      grid: { width: b.width, height: b.height, tileSize: TILE_SIZE, solid: b.solid },
      areaIndex: b.areaIndex,
      areas: b.areas,
      furniture: b.furniture,
      hides: b.hides,
      vents: [...vents.values()].filter((v) => v.floor === id),
      stairs: [...stairs.values()].filter((s) => s.floor === id),
      tasks: [...taskStations.values()].filter((t) => t.floor === id),
      doors: b.doors,
      doorways: b.doorways,
      doorwayIndex: b.doorwayIndex,
      links: b.links(),
    });
  }

  return {
    floors,
    floorIds: [...floors.keys()],
    spawnFloor,
    spawns,
    stairs,
    vents,
    hides,
    tasks: taskStations,
    doorways: new Map([...floors.values()].flatMap((f) => f.doorways.map((d) => [d.id, d] as const))),
    chatRooms: (layout.chatRooms ?? []).map((ref) => findArea(ref).area.key),
  };
}

/** The area (room or corridor) at a pixel position, or null inside walls. */
export function areaAt(floor: FloorMap, x: number, y: number): Area | null {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= floor.grid.width || ty >= floor.grid.height) return null;
  const i = floor.areaIndex[ty * floor.grid.width + tx];
  return i >= 0 ? floor.areas[i] : null;
}
