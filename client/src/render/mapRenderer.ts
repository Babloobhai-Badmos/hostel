// Gray-box rendering of one floor. The static parts (floors, walls,
// furniture, stairs, vents, spawn markers) are drawn once and baked into a
// texture; labels and glowing task markers are separate objects on top.

import Phaser from "phaser";
import { PLAYER_RADIUS_PX, TILE_SIZE } from "../../../shared/constants";
import type { FloorMap, HostelMap } from "../../../shared/buildMap";

/** Floor colour per room kind. Unknown kinds use DEFAULT_FLOOR. */
const FLOOR_COLORS: Record<string, number> = {
  corridor: 0x4a4458,
  standard: 0x3b3548,
  hub: 0x3d4a5e,
  rangeen: 0x5c3358,
  washroom: 0x2f5862,
  stairs: 0x5a5236,
  mess: 0x55462f,
  terrace: 0x2f5a37,
  library: 0x4d3a2a,
  laundry: 0x2f4f6a,
  office: 0x4a3b3b,
  store: 0x403a33,
  tv: 0x3e3552,
  gym: 0x3a4a40,
};
const DEFAULT_FLOOR = 0x3b3548;
const GRID_LINE = 0x000000;
const GRID_ALPHA = 0.12;
const WALL_DEEP = 0x14121c;
const WALL_FACE = 0x6b5f80;
const WALL_FACE_DARK = 0x4a4060;

/** Furniture colour per type. Unknown types use DEFAULT_FURNITURE. */
const FURNITURE_COLORS: Record<string, number> = {
  bed: 0x8a6d4b,
  desk: 0x6b4f2f,
  sofa: 0x8a3b5c,
  table: 0x7a5a35,
  speaker: 0x222222,
  tv: 0x1a1a1a,
  carrom: 0xc9a46a,
  counter: 0x6d6d6d,
  boxes: 0x9a7a4a,
  "washing-machine": 0xd9d9d9,
  "bucket-pile": 0x3a7ac9,
  "water-tank": 0x2b2b2b,
  "chai-stall": 0xb5651d,
  bookshelf: 0x5a3a1f,
  bench: 0x555555,
  rack: 0x777777,
  sink: 0xcfd8dc,
};
const DEFAULT_FURNITURE = 0x705a48;
/** Hiding spots: colour per type, all drawn with a dotted yellow outline. */
const HIDE_COLORS: Record<string, number> = {
  cupboard: 0x7b4f2a,
  locker: 0x5a6f80,
  "under-bed": 0x5e4630,
  curtain: 0xa02c2c,
  beanbag: 0xd06a2a,
  "food-drum": 0x8a8a8a,
  "under-table": 0x5a4025,
  "file-cabinet": 0x6a6a72,
  "mattress-pile": 0xb0a080,
  clothesline: 0x4aa3d6,
  "behind-tank": 0x333333,
  plant: 0x3f8f3f,
  "between-shelves": 0x4a3018,
  "behind-sofa": 0x6a2b48,
  "mat-pile": 0x2a6a5a,
  boxes: 0x9a7a4a,
};
const HIDE_OUTLINE = 0xf4c430;
const STAIR_STRIPE = 0xc9b458;
const VENT_COLOR = 0x23262b;
const VENT_SLAT = 0x6e7681;
const SPAWN_COLOR = 0xf4c430;
const SPAWN_ALPHA = 0.22;
const TASK_COLOR = 0xffe066;
/** Every station gets a faint static marker; the Game scene adds a pulsing glow on your own unfinished ones. */
const TASK_IDLE_ALPHA = 0.35;
const LABEL_ALPHA = 0.3;
const LABEL_MIN_FONT_PX = 14;
const LABEL_MAX_FONT_PX = 34;

export function textureKeyForFloor(floorId: number): string {
  return `floor-${floorId}`;
}

/** Draw a floor into a Graphics object at 1 world px = 1 px. */
function drawFloor(g: Phaser.GameObjects.Graphics, map: HostelMap, floor: FloorMap): void {
  const ts = TILE_SIZE;
  const { width, height, solid } = floor.grid;
  const walkableOrFurniture = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && floor.areaIndex[y * width + x] >= 0;

  g.fillStyle(WALL_DEEP, 1);
  g.fillRect(0, 0, width * ts, height * ts);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const a = floor.areaIndex[i];
      if (a >= 0) {
        const area = floor.areas[a];
        g.fillStyle(FLOOR_COLORS[area.corridor ? "corridor" : area.kind] ?? DEFAULT_FLOOR, 1);
        g.fillRect(x * ts, y * ts, ts, ts);
        g.lineStyle(1, GRID_LINE, GRID_ALPHA);
        g.strokeRect(x * ts, y * ts, ts, ts);
      } else if (solid[i]) {
        // Walls that touch a walkable tile get a lit face; the rest stay dark.
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++)
          for (let dx = -1; dx <= 1 && !edge; dx++) if (walkableOrFurniture(x + dx, y + dy)) edge = true;
        if (edge) {
          g.fillStyle(WALL_FACE_DARK, 1);
          g.fillRect(x * ts, y * ts, ts, ts);
          g.fillStyle(WALL_FACE, 1);
          g.fillRect(x * ts + 2, y * ts + 2, ts - 4, ts - 8);
        }
      }
    }
  }

  // Stairs: yellow stripes across the zone.
  for (const s of floor.stairs) {
    g.fillStyle(STAIR_STRIPE, 0.55);
    for (let sy = s.zone.y; sy < s.zone.y + s.zone.h; sy += ts / 2) {
      g.fillRect(s.zone.x, sy, s.zone.w, ts / 4);
    }
  }

  // Furniture and hiding spots.
  for (const f of floor.furniture) {
    const x = f.rect.x * ts;
    const y = f.rect.y * ts;
    const w = f.rect.w * ts;
    const h = f.rect.h * ts;
    const hide = floor.hides.some((hs) => hs.tile.x === f.rect.x && hs.tile.y === f.rect.y);
    const color = hide ? HIDE_COLORS[f.type] ?? DEFAULT_FURNITURE : FURNITURE_COLORS[f.type] ?? DEFAULT_FURNITURE;
    const inset = f.solid ? 2 : 5;
    g.fillStyle(color, f.solid || hide ? 1 : 0.6);
    g.fillRoundedRect(x + inset, y + inset, w - inset * 2, h - inset * 2, 5);
    g.lineStyle(2, 0x000000, 0.5);
    g.strokeRoundedRect(x + inset, y + inset, w - inset * 2, h - inset * 2, 5);
    if (hide) {
      // Dotted yellow border = "you can hide here".
      g.fillStyle(HIDE_OUTLINE, 0.9);
      const step = 6;
      for (let k = inset; k < w - inset; k += step) {
        g.fillRect(x + k, y + inset - 1, 3, 2);
        g.fillRect(x + k, y + h - inset - 1, 3, 2);
      }
      for (let k = inset; k < h - inset; k += step) {
        g.fillRect(x + inset - 1, y + k, 2, 3);
        g.fillRect(x + w - inset - 1, y + k, 2, 3);
      }
    }
  }

  // Vents: a dark grate with slats.
  for (const v of floor.vents) {
    const half = ts * 0.4;
    g.fillStyle(VENT_COLOR, 1);
    g.fillRect(v.x - half, v.y - half, half * 2, half * 2);
    g.fillStyle(VENT_SLAT, 1);
    for (let k = -2; k <= 2; k++) g.fillRect(v.x - half + 3, v.y + k * 5 - 1, half * 2 - 6, 2);
  }

  if (floor.id === map.spawnFloor) {
    g.fillStyle(SPAWN_COLOR, SPAWN_ALPHA);
    for (const s of map.spawns) g.fillCircle(s.x, s.y, PLAYER_RADIUS_PX + 2);
  }
}

/** Bake every floor's static art into a texture (once per game). */
export function bakeFloorTextures(scene: Phaser.Scene, map: HostelMap): void {
  for (const floor of map.floors.values()) {
    const key = textureKeyForFloor(floor.id);
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    drawFloor(g, map, floor);
    g.generateTexture(key, floor.grid.width * TILE_SIZE, floor.grid.height * TILE_SIZE);
    g.destroy();
  }
}

/** The baked floor plus labels and faint task markers, in one container. */
export function createFloorView(scene: Phaser.Scene, floor: FloorMap): Phaser.GameObjects.Container {
  const ts = TILE_SIZE;
  const children: Phaser.GameObjects.GameObject[] = [
    scene.add.image(0, 0, textureKeyForFloor(floor.id)).setOrigin(0, 0),
  ];

  for (const t of floor.tasks) {
    children.push(scene.add.circle(t.x, t.y, ts * 0.18, TASK_COLOR, TASK_IDLE_ALPHA).setStrokeStyle(2, 0x000000, 0.4));
  }

  for (const a of floor.areas) {
    if (!a.label) continue;
    const short = Math.min(a.rect.w, a.rect.h);
    const fontPx = Phaser.Math.Clamp(short * 4, LABEL_MIN_FONT_PX, LABEL_MAX_FONT_PX);
    const cx = (a.rect.x + a.rect.w / 2) * ts;
    // Corridors: put the label near the west end so it doesn't collide with junctions.
    const x = a.corridor ? (a.rect.x + 8) * ts : cx;
    const y = (a.rect.y + a.rect.h / 2) * ts;
    children.push(
      scene.add
        .text(x, y, a.label.toUpperCase(), {
          fontFamily: "system-ui, sans-serif",
          fontSize: `${fontPx}px`,
          fontStyle: "bold",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setAlpha(LABEL_ALPHA)
        .setResolution(2),
    );
  }

  return scene.add.container(0, 0, children).setDepth(-1);
}

/** Small top-down texture for the minimap: `pxPerTile` pixels per tile. */
export function bakeMinimapTexture(scene: Phaser.Scene, floor: FloorMap, pxPerTile: number): string {
  const key = `mini-${floor.id}-${pxPerTile}`;
  if (scene.textures.exists(key)) return key;
  const { width, height, solid } = floor.grid;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x000000, 0.55);
  g.fillRect(0, 0, width * pxPerTile, height * pxPerTile);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const a = floor.areaIndex[i];
      if (a < 0) continue;
      const area = floor.areas[a];
      g.fillStyle(solid[i] ? 0x2a2633 : FLOOR_COLORS[area.corridor ? "corridor" : area.kind] ?? DEFAULT_FLOOR, 1);
      g.fillRect(x * pxPerTile, y * pxPerTile, pxPerTile, pxPerTile);
    }
  }
  g.fillStyle(STAIR_STRIPE, 1);
  for (const s of floor.stairs) {
    g.fillRect((s.zone.x / TILE_SIZE) * pxPerTile, (s.zone.y / TILE_SIZE) * pxPerTile, (s.zone.w / TILE_SIZE) * pxPerTile, (s.zone.h / TILE_SIZE) * pxPerTile);
  }
  g.generateTexture(key, width * pxPerTile, height * pxPerTile);
  g.destroy();
  return key;
}
