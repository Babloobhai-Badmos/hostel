// Floor art. Each floor is painted once with Canvas 2D into a texture
// (FLOOR_ART_SCALE x sharper than world pixels) and drawn under everything:
//
//   outside   night-time ground around the building
//   floors    a material per room kind (planks, terrazzo, red-oxide, carpet,
//             concrete...) that ignores the collision grid, so no tiles show
//   decor     rugs, puddles, drains, rooftop patches
//   shading   soft shadow along every wall, warm ceiling-light pools
//   furniture painted pieces with drop shadows; hiding spots get a dashed
//             golden outline
//   walls     a dark cap with a painted front face (cream over a coloured
//             dado, like a real hostel), windows on the outside walls,
//             stone sills in doorways, a nameplate over each room
//
// Doors, players and everything that changes are separate objects on top.

import Phaser from "phaser";
import { FLOOR_ART_SCALE, TILE_SIZE } from "../../../shared/constants";
import type { Area, FloorMap, HostelMap } from "../../../shared/buildMap";
import { hashString, makeCanvas, rgba, roundRect, seeded, shade, withShadow } from "./art/paint";
import type { Ctx } from "./art/paint";
import { materialBase, materialPattern } from "./art/materials";
import { paintFurniture, paintHideMarker } from "./art/furniture";

const TS = TILE_SIZE;
const OUTSIDE = "#16231d";
const WALL_CAP = "#2c2633";
/** Height of a wall's painted front face (the part you see above a floor below it). */
const FACE_PX = 13;
/** Upper wall paint and the darker dado band below it, per room kind. */
const WALL_PAINT: Record<string, [string, string]> = {
  corridor: ["#d9cfae", "#7a8f5c"],
  standard: ["#e3d5b8", "#8b6b4a"],
  washroom: ["#cfe3df", "#4f8a83"],
  mess: ["#e8d2a6", "#9b4a35"],
  hub: ["#cdd8e6", "#4e6a8f"],
  rangeen: ["#e7b9e0", "#7d2f72"],
  office: ["#e6d7c2", "#6b3036"],
  store: ["#bdb6a8", "#6e6a62"],
  laundry: ["#c9d9e2", "#5c7685"],
  terrace: ["#cfc7b5", "#8a8170"],
  library: ["#e0cfae", "#5e3c22"],
  tv: ["#d6cce6", "#54467a"],
  gym: ["#c7cdd1", "#3b4448"],
  stairs: ["#d8d0bc", "#7d7462"],
};
const DEFAULT_PAINT: [string, string] = ["#ddd2b6", "#7b6b55"];
const TASK_COLOR = 0xffe066;
/** Every station gets a faint static marker; the Game scene adds a pulsing glow on your own unfinished ones. */
const TASK_IDLE_ALPHA = 0.35;

export function textureKeyForFloor(floorId: number): string {
  return `floor-${floorId}`;
}

const kindOf = (a: Area) => (a.corridor ? "corridor" : a.kind);

type TileClass = "floor" | "wall" | "outside";

/** Walkable tiles are "floor"; non-walkable tiles reachable from the map edge without touching a room are "outside". */
function classifyTiles(floor: FloorMap): TileClass[] {
  const { width, height } = floor.grid;
  const isArea = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && floor.areaIndex[y * width + x] >= 0;
  const nearArea = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isArea(x + dx, y + dy)) return true;
    return false;
  };
  const out: TileClass[] = new Array(width * height).fill("wall");
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (isArea(x, y)) out[y * width + x] = "floor";
  // Flood fill the outside from the border through tiles that aren't next to a room.
  const queue: number[] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (out[i] !== "wall" || nearArea(x, y)) return;
    out[i] = "outside";
    queue.push(i);
  };
  for (let x = 0; x < width; x++) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    visit(0, y);
    visit(width - 1, y);
  }
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }
  return out;
}

/** Fill every tile of one area (row runs, so overlapping corridors stay exact). */
function areaPath(ctx: Ctx, floor: FloorMap, index: number): void {
  const { width } = floor.grid;
  const { x, y, w, h } = floor.areas[index].rect;
  ctx.beginPath();
  // Include the doorway tiles that belong to this area (they sit in the wall row).
  for (let ty = y - 1; ty <= y + h; ty++) {
    let run = -1;
    for (let tx = x - 1; tx <= x + w + 1; tx++) {
      const inside = tx <= x + w && floor.areaIndex[ty * width + tx] === index;
      if (inside && run < 0) run = tx;
      if (!inside && run >= 0) {
        ctx.rect(run * TS, ty * TS, (tx - run) * TS, TS);
        run = -1;
      }
    }
  }
}

function paintOutside(ctx: Ctx, floor: FloorMap, classes: TileClass[], rnd: () => number): void {
  const { width, height } = floor.grid;
  ctx.fillStyle = OUTSIDE;
  ctx.fillRect(0, 0, width * TS, height * TS);
  // Grass tufts and dirt specks, and a few bushes hugging the building.
  for (let i = 0; i < width * height * 3; i++) {
    const x = rnd() * width * TS;
    const y = rnd() * height * TS;
    ctx.fillStyle = rnd() < 0.6 ? "rgba(70,110,70,0.35)" : "rgba(10,15,12,0.4)";
    ctx.fillRect(x, y, 1.2, 2.2);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (classes[y * width + x] !== "outside" || rnd() > 0.08) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => classes[(y + dy) * width + (x + dx)] === "wall");
      if (!near) continue;
      for (let k = 0; k < 4; k++) {
        const g = ctx.createRadialGradient(x * TS + 16 + (rnd() - 0.5) * 16, y * TS + 16 + (rnd() - 0.5) * 16, 1, x * TS + 16, y * TS + 16, 12);
        g.addColorStop(0, "rgba(60,110,55,0.9)");
        g.addColorStop(1, "rgba(30,60,30,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x * TS - 4, y * TS - 4, TS + 8, TS + 8);
      }
    }
  }
}

function paintFloors(ctx: Ctx, floor: FloorMap): void {
  floor.areas.forEach((a, i) => {
    areaPath(ctx, floor, i);
    ctx.fillStyle = materialPattern(ctx, kindOf(a), FLOOR_ART_SCALE);
    ctx.fill();
  });
}

function paintRug(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, accent: string, rnd: () => number): void {
  withShadow(ctx, FLOOR_ART_SCALE, () => {
    roundRect(ctx, x, y, w, h, 4);
    ctx.fillStyle = color;
    ctx.fill();
  }, 2, 1, 0.3);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 3);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(accent, 0.6);
  roundRect(ctx, x + 8, y + 8, w - 16, h - 16, 2);
  ctx.stroke();
  // A diamond motif in the middle.
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) * 0.22;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 1.4, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 1.4, cy);
  ctx.closePath();
  ctx.fillStyle = rgba(accent, 0.55);
  ctx.fill();
  // Fringe on the short ends.
  ctx.strokeStyle = rgba(shade(color, 0.4), 0.8);
  ctx.lineWidth = 0.8;
  for (let k = y + 3; k < y + h - 3; k += 3) {
    for (const [ex, dir] of [[x, -1], [x + w, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(ex, k);
      ctx.lineTo(ex + dir * (2.5 + rnd()), k);
      ctx.stroke();
    }
  }
}

/** Floor-level touches per room kind (drawn under furniture). */
function paintDecor(ctx: Ctx, floor: FloorMap, rnd: () => number): void {
  for (const a of floor.areas) {
    const x = a.rect.x * TS;
    const y = a.rect.y * TS;
    const w = a.rect.w * TS;
    const h = a.rect.h * TS;
    switch (a.kind) {
      case "standard":
        if (!a.corridor) paintRug(ctx, x + w * 0.42, y + h * 0.45, w * 0.34, h * 0.32, "#7b2d26", "#e0b04a", rnd);
        break;
      case "hub":
        paintRug(ctx, x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.6, "#2f4a6b", "#d9b45a", rnd);
        break;
      case "tv":
        paintRug(ctx, x + w * 0.25, y + h * 0.3, w * 0.5, h * 0.45, "#5a2f4f", "#e7c66b", rnd);
        break;
      case "office":
        paintRug(ctx, x + w * 0.3, y + h * 0.45, w * 0.4, h * 0.4, "#2e4a3a", "#c9a14a", rnd);
        break;
      case "rangeen": {
        // Disco floor glow.
        for (let k = 0; k < 7; k++) {
          const cx = x + rnd() * w;
          const cy = y + rnd() * h;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
          const c = ["#ff4fd8", "#4fd8ff", "#ffe14f", "#7dff4f"][k % 4];
          g.addColorStop(0, rgba(c, 0.25));
          g.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = g;
          ctx.fillRect(cx - 40, cy - 40, 80, 80);
        }
        break;
      }
      case "washroom": {
        // Floor drain and puddles.
        const cx = x + w / 2;
        const cy = y + h * 0.7;
        ctx.fillStyle = "#3d4f55";
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#9db3b9";
        ctx.lineWidth = 0.8;
        for (let k = -3; k <= 3; k += 2) {
          ctx.beginPath();
          ctx.moveTo(cx + k, cy - 4);
          ctx.lineTo(cx + k, cy + 4);
          ctx.stroke();
        }
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          ctx.ellipse(x + rnd() * w, y + h * 0.3 + rnd() * h * 0.6, 6 + rnd() * 12, 3 + rnd() * 5, rnd(), 0, Math.PI * 2);
          ctx.fillStyle = "rgba(200,235,245,0.18)";
          ctx.fill();
        }
        break;
      }
      case "terrace":
        for (let k = 0; k < 4; k++) {
          ctx.beginPath();
          ctx.ellipse(x + rnd() * w, y + rnd() * h, 14 + rnd() * 20, 8 + rnd() * 12, rnd() * 3, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(25,25,28,0.25)";
          ctx.fill();
        }
        break;
    }
  }
}

/** Soft shadow on the floor along every wall edge (and around doorway jambs). */
function paintWallShadows(ctx: Ctx, floor: FloorMap): void {
  const { width, height } = floor.grid;
  const isFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && floor.areaIndex[y * width + x] >= 0;
  const depth = 11;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isFloor(x, y)) continue;
      const px = x * TS;
      const py = y * TS;
      const edges: [number, number, number, number, number, number][] = [];
      if (!isFloor(x, y - 1)) edges.push([px, py, px, py + depth * 1.3, TS, depth * 1.3]);
      if (!isFloor(x - 1, y)) edges.push([px, py, px + depth, py, depth, TS]);
      if (!isFloor(x + 1, y)) edges.push([px + TS, py, px + TS - depth, py, depth, TS]);
      if (!isFloor(x, y + 1)) edges.push([px, py + TS, px, py + TS - depth * 0.6, TS, depth * 0.6]);
      for (const [x0, y0, x1, y1, w, h] of edges) {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, "rgba(0,0,0,0.38)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), w, h);
      }
    }
  }
}

/** Warm pools of ceiling light: one per room, a row of them along corridors. */
function paintLights(ctx: Ctx, floor: FloorMap): void {
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  for (const a of floor.areas) {
    const { x, y, w, h } = a.rect;
    const spots: [number, number][] = [];
    if (a.corridor) {
      const horizontal = w >= h;
      const len = horizontal ? w : h;
      for (let k = 3; k < len; k += 7) spots.push(horizontal ? [x + k, y + h / 2] : [x + w / 2, y + k]);
    } else if (w > 12 || h > 8) {
      for (let k = 1; k <= 3; k++) spots.push([x + (w * k) / 4, y + h / 2]);
    } else {
      spots.push([x + w / 2, y + h / 2]);
    }
    const radius = (a.corridor ? 4 : Math.min(Math.max(w, h) * 0.6, 7)) * TS;
    for (const [sx, sy] of spots) {
      const g = ctx.createRadialGradient(sx * TS, sy * TS, 0, sx * TS, sy * TS, radius);
      g.addColorStop(0, "rgba(255,236,190,0.55)");
      g.addColorStop(1, "rgba(255,236,190,0)");
      ctx.fillStyle = g;
      ctx.fillRect(sx * TS - radius, sy * TS - radius, radius * 2, radius * 2);
    }
  }
  ctx.restore();
  // Darken the far corners of each room a touch.
  floor.areas.forEach((a, i) => {
    if (a.corridor) return;
    const { x, y, w, h } = a.rect;
    const cx = (x + w / 2) * TS;
    const cy = (y + h / 2) * TS;
    const r = Math.hypot(w, h) * TS * 0.55;
    const g = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.save();
    areaPath(ctx, floor, i);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(x * TS, y * TS, w * TS, h * TS);
    ctx.restore();
  });
}

function paintStairs(ctx: Ctx, map: HostelMap, floor: FloorMap): void {
  for (const s of floor.stairs) {
    const { x, y, w, h } = s.zone;
    const steps = Math.max(4, Math.round(h / 10));
    const sh = h / steps;
    const up = (map.stairs.get(s.target)?.floor ?? floor.id) > floor.id;
    for (let k = 0; k < steps; k++) {
      const t = up ? k / steps : 1 - k / steps;
      const base = shade("#a59c88", -0.35 * t);
      const g = ctx.createLinearGradient(0, y + k * sh, 0, y + (k + 1) * sh);
      g.addColorStop(0, shade(base, 0.18));
      g.addColorStop(0.75, base);
      g.addColorStop(1, shade(base, -0.4));
      ctx.fillStyle = g;
      ctx.fillRect(x + 4, y + k * sh, w - 8, sh);
    }
    // Handrails.
    for (const rx of [x + 2, x + w - 5]) {
      ctx.fillStyle = "#6b4a2b";
      ctx.fillRect(rx, y, 3, h);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(rx, y, 1, h);
    }
    ctx.fillStyle = "rgba(255,240,200,0.85)";
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const name = map.floors.get(map.stairs.get(s.target)?.floor ?? floor.id)?.name ?? "";
    ctx.fillText(`${up ? "▲" : "▼"} ${name.toUpperCase()}`, x + w / 2, y + h / 2);
  }
}

function paintVents(ctx: Ctx, floor: FloorMap): void {
  for (const v of floor.vents) {
    const half = TS * 0.42;
    withShadow(ctx, FLOOR_ART_SCALE, () => {
      roundRect(ctx, v.x - half, v.y - half, half * 2, half * 2, 3);
      ctx.fillStyle = "#59616b";
      ctx.fill();
    }, 2, 1, 0.5);
    roundRect(ctx, v.x - half + 2.5, v.y - half + 2.5, half * 2 - 5, half * 2 - 5, 2);
    ctx.fillStyle = "#121417";
    ctx.fill();
    for (let k = -2; k <= 2; k++) {
      const g = ctx.createLinearGradient(0, v.y + k * 4.5 - 1.5, 0, v.y + k * 4.5 + 1.5);
      g.addColorStop(0, "#9aa4ad");
      g.addColorStop(1, "#4a525a");
      ctx.fillStyle = g;
      ctx.fillRect(v.x - half + 4, v.y + k * 4.5 - 1.2, half * 2 - 8, 2.4);
    }
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.fillStyle = "#c9d1d6";
      ctx.beginPath();
      ctx.arc(v.x + sx * (half - 2), v.y + sy * (half - 2), 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintFurnitureLayer(ctx: Ctx, floor: FloorMap, rnd: () => number): void {
  const pieces = [...floor.furniture].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  for (const f of pieces) {
    const piece = { type: f.type, x: f.rect.x * TS, y: f.rect.y * TS, w: f.rect.w * TS, h: f.rect.h * TS };
    paintFurniture(ctx, piece, rnd, FLOOR_ART_SCALE);
  }
  for (const hs of floor.hides) {
    const f = floor.furniture.find((p) => p.rect.x === hs.tile.x && p.rect.y === hs.tile.y);
    const r = f?.rect ?? { x: hs.tile.x, y: hs.tile.y, w: 1, h: 1 };
    paintHideMarker(ctx, { type: hs.type, x: r.x * TS, y: r.y * TS, w: r.w * TS, h: r.h * TS });
  }
}

/** Area kind of the floor tile at (x, y), if it's floor. */
function floorKindAt(floor: FloorMap, x: number, y: number): string | null {
  const { width, height } = floor.grid;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const i = floor.areaIndex[y * width + x];
  return i >= 0 ? kindOf(floor.areas[i]) : null;
}

function paintWalls(ctx: Ctx, floor: FloorMap, classes: TileClass[], rnd: () => number): void {
  const { width, height } = floor.grid;
  const cls = (x: number, y: number): TileClass => (x < 0 || y < 0 || x >= width || y >= height ? "outside" : classes[y * width + x]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cls(x, y) !== "wall") continue;
      const px = x * TS;
      const py = y * TS;
      const g = ctx.createLinearGradient(px, py, px + TS, py + TS);
      g.addColorStop(0, shade(WALL_CAP, 0.06));
      g.addColorStop(1, shade(WALL_CAP, -0.08));
      ctx.fillStyle = g;
      ctx.fillRect(px, py, TS, TS);
    }
  }
  // Lit rim where the cap meets a room, and the outside edge of the building.
  ctx.lineWidth = 1.5;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cls(x, y) !== "wall") continue;
      const px = x * TS;
      const py = y * TS;
      const rim = (nx: number, ny: number, x0: number, y0: number, x1: number, y1: number) => {
        const c = cls(nx, ny);
        if (c === "wall") return;
        ctx.strokeStyle = c === "outside" ? "rgba(0,0,0,0.6)" : "rgba(255,240,215,0.22)";
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      };
      rim(x, y - 1, px, py + 0.75, px + TS, py + 0.75);
      rim(x - 1, y, px + 0.75, py, px + 0.75, py + TS);
      rim(x + 1, y, px + TS - 0.75, py, px + TS - 0.75, py + TS);
    }
  }
  // Front faces: the painted wall you see above a floor tile.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cls(x, y) !== "wall") continue;
      const kind = floorKindAt(floor, x, y + 1);
      if (!kind) continue;
      const [paint, dado] = WALL_PAINT[kind] ?? DEFAULT_PAINT;
      const px = x * TS;
      const top = (y + 1) * TS - FACE_PX;
      const g = ctx.createLinearGradient(0, top, 0, top + FACE_PX);
      g.addColorStop(0, shade(paint, 0.05));
      g.addColorStop(0.55, shade(paint, -0.08));
      g.addColorStop(0.56, dado);
      g.addColorStop(1, shade(dado, -0.25));
      ctx.fillStyle = g;
      ctx.fillRect(px, top, TS, FACE_PX);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(px, top + FACE_PX - 1.5, TS, 1.5);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(px, top, TS, 1);
      // Shade the face where it turns a corner.
      if (cls(x - 1, y) !== "wall" || floorKindAt(floor, x - 1, y + 1) === null) {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(px, top, 2, FACE_PX);
      }
      if (cls(x + 1, y) !== "wall" || floorKindAt(floor, x + 1, y + 1) === null) {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(px + TS - 2, top, 2, FACE_PX);
      }
      // Odd bits on the wall: mirrors in the washroom, notice boards, switchboards, posters.
      const r = rnd();
      if (kind === "washroom" && x % 2 === 0) {
        ctx.fillStyle = "#9aa4ad";
        ctx.fillRect(px + 7, top + 0.5, 18, 8);
        const mg = ctx.createLinearGradient(px + 8, top, px + 24, top + 8);
        mg.addColorStop(0, "#d6f0f7");
        mg.addColorStop(0.5, "#ffffff");
        mg.addColorStop(1, "#9cc6d6");
        ctx.fillStyle = mg;
        ctx.fillRect(px + 8, top + 1.5, 16, 6);
        ctx.fillStyle = "#c9d1d6";
        ctx.fillRect(px + 14.5, top + 9, 3, 3);
      } else if (kind === "corridor" && r < 0.04) {
        ctx.fillStyle = "#6b4a2b";
        ctx.fillRect(px + 3, top, 26, 9);
        ctx.fillStyle = "#c9a26b";
        ctx.fillRect(px + 4, top + 1, 24, 7);
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = ["#ffffff", "#fff3a0", "#ffd1dc", "#cfe8ff"][k];
          ctx.fillRect(px + 5 + k * 6 + rnd(), top + 1.5 + rnd() * 1.5, 4.5, 5);
        }
      } else if (r < 0.05) {
        ctx.fillStyle = "#f2efe6";
        ctx.fillRect(px + 10, top + 2, 9, 5);
        ctx.fillStyle = "#333";
        ctx.fillRect(px + 12, top + 3.5, 1.5, 2);
        ctx.fillRect(px + 15.5, top + 3.5, 1.5, 2);
      } else if (r < 0.09 && kind !== "corridor") {
        ctx.fillStyle = ["#e74c3c", "#3498db", "#f1c40f", "#9b59b6"][Math.floor(rnd() * 4)];
        ctx.fillRect(px + 8 + rnd() * 8, top + 1, 9, 7);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillRect(px + 10 + rnd() * 6, top + 3, 4, 1);
      }
    }
  }
  // Windows on outside walls, with moonlight falling on the floor.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cls(x, y) !== "wall" || (x + y) % 3 !== 0) continue;
      const below = floorKindAt(floor, x, y + 1);
      const above = floorKindAt(floor, x, y - 1);
      const outsideAbove = cls(x, y - 1) === "outside";
      const outsideBelow = cls(x, y + 1) === "outside";
      if (!((below && outsideAbove) || (above && outsideBelow))) continue;
      const px = x * TS;
      const py = y * TS;
      const gy = below ? py + 4 : py + TS - 12;
      const glass = ctx.createLinearGradient(px, gy, px + TS, gy + 8);
      glass.addColorStop(0, "#6fa8c9");
      glass.addColorStop(0.5, "#b9e1f2");
      glass.addColorStop(1, "#5b8fb0");
      ctx.fillStyle = "#4a3a2a";
      ctx.fillRect(px + 3, gy - 1.5, TS - 6, 11);
      ctx.fillStyle = glass;
      ctx.fillRect(px + 4.5, gy, TS - 9, 8);
      ctx.fillStyle = "#4a3a2a";
      ctx.fillRect(px + TS / 2 - 0.75, gy, 1.5, 8);
      // Iron grille bars.
      ctx.fillStyle = "rgba(30,30,35,0.7)";
      for (let k = px + 8; k < px + TS - 6; k += 5) ctx.fillRect(k, gy, 0.8, 8);
      if (below) {
        ctx.save();
        ctx.globalCompositeOperation = "soft-light";
        const lg = ctx.createLinearGradient(0, py + TS, 0, py + TS * 3);
        lg.addColorStop(0, "rgba(190,220,255,0.6)");
        lg.addColorStop(1, "rgba(190,220,255,0)");
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(px + 4, py + TS);
        ctx.lineTo(px + TS - 4, py + TS);
        ctx.lineTo(px + TS + 10, py + TS * 3);
        ctx.lineTo(px - 10 + 8, py + TS * 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

/** Stone sill across each doorway, and dark jambs at both ends (whether or not it has a door this round). */
function paintDoorways(ctx: Ctx, floor: FloorMap): void {
  for (const d of floor.doorways) {
    const xs = d.tiles.map((t) => t.x);
    const ys = d.tiles.map((t) => t.y);
    const x = Math.min(...xs) * TS;
    const y = Math.min(...ys) * TS;
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * TS;
    const h = (Math.max(...ys) - Math.min(...ys) + 1) * TS;
    const g = d.horizontal ? ctx.createLinearGradient(0, y, 0, y + h) : ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#8d8577");
    g.addColorStop(0.5, "#b3aa98");
    g.addColorStop(1, "#7b7366");
    ctx.fillStyle = g;
    if (d.horizontal) ctx.fillRect(x, y + 6, w, h - 12);
    else ctx.fillRect(x + 6, y, w - 12, h);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    if (d.horizontal) {
      ctx.fillRect(x, y + 6, w, 1);
      ctx.fillRect(x, y + h - 7, w, 1);
    } else {
      ctx.fillRect(x + 6, y, 1, h);
      ctx.fillRect(x + w - 7, y, 1, h);
    }
    ctx.fillStyle = "#3b2a1c";
    if (d.horizontal) {
      ctx.fillRect(x - 3, y, 3, h);
      ctx.fillRect(x + w, y, 3, h);
    } else {
      ctx.fillRect(x, y - 3, w, 3);
      ctx.fillRect(x, y + h, w, 3);
    }
  }
}

/** A small nameplate on the wall above each room (skips corridors), clear of its doorways. */
function paintNameplates(ctx: Ctx, floor: FloorMap): void {
  ctx.font = "bold 8px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (const a of floor.areas) {
    if (a.corridor || !a.label) continue;
    const text = a.label.toUpperCase();
    const w = ctx.measureText(text).width + 10;
    const wallY = a.rect.y - 1;
    const blocked = (x0: number, x1: number) =>
      floor.doorways.some((d) => d.tiles.some((t) => t.y === wallY && (t.x + 1) * TS > x0 - 4 && t.x * TS < x1 + 4));
    let cx = (a.rect.x + a.rect.w / 2) * TS;
    for (const tryX of [cx, (a.rect.x + a.rect.w * 0.25) * TS, (a.rect.x + a.rect.w * 0.75) * TS]) {
      if (!blocked(tryX - w / 2, tryX + w / 2)) {
        cx = tryX;
        break;
      }
    }
    const cy = a.rect.y * TS - FACE_PX / 2 - 1;
    withShadow(ctx, FLOOR_ART_SCALE, () => {
      roundRect(ctx, cx - w / 2, cy - 5.5, w, 11, 2.5);
      ctx.fillStyle = "#3b2a1c";
      ctx.fill();
    }, 2, 1, 0.5);
    ctx.strokeStyle = "#c9a14a";
    ctx.lineWidth = 0.8;
    roundRect(ctx, cx - w / 2 + 1, cy - 4.5, w - 2, 9, 2);
    ctx.stroke();
    ctx.fillStyle = "#f6e7c1";
    ctx.fillText(text, cx, cy + 0.5);
  }
}

function paintFloor(ctx: Ctx, map: HostelMap, floor: FloorMap): void {
  const rnd = seeded(hashString(`floor-${floor.id}`));
  const classes = classifyTiles(floor);
  paintOutside(ctx, floor, classes, rnd);
  paintFloors(ctx, floor);
  paintDecor(ctx, floor, rnd);
  paintLights(ctx, floor);
  paintWallShadows(ctx, floor);
  paintDoorways(ctx, floor);
  paintStairs(ctx, map, floor);
  paintVents(ctx, floor);
  paintFurnitureLayer(ctx, floor, rnd);
  paintWalls(ctx, floor, classes, rnd);
  paintNameplates(ctx, floor);
}

/** Paint every floor into a texture (once per game). */
export function bakeFloorTextures(scene: Phaser.Scene, map: HostelMap): void {
  for (const floor of map.floors.values()) {
    const key = textureKeyForFloor(floor.id);
    if (scene.textures.exists(key)) continue;
    const s = FLOOR_ART_SCALE;
    const { canvas, ctx } = makeCanvas(floor.grid.width * TS * s, floor.grid.height * TS * s);
    ctx.scale(s, s);
    paintFloor(ctx, map, floor);
    scene.textures.addCanvas(key, canvas);
  }
}

/** The painted floor plus faint task markers, in one container. */
export function createFloorView(scene: Phaser.Scene, floor: FloorMap): Phaser.GameObjects.Container {
  const children: Phaser.GameObjects.GameObject[] = [
    scene.add.image(0, 0, textureKeyForFloor(floor.id)).setOrigin(0, 0).setScale(1 / FLOOR_ART_SCALE),
  ];
  for (const t of floor.tasks) {
    children.push(scene.add.circle(t.x, t.y, TS * 0.16, TASK_COLOR, TASK_IDLE_ALPHA).setStrokeStyle(1.5, 0x000000, 0.35));
  }
  return scene.add.container(0, 0, children).setDepth(-1);
}

const hex = (c: string) => parseInt(c.slice(1), 16);

/** Small top-down texture for the minimap: `pxPerTile` pixels per tile. */
export function bakeMinimapTexture(scene: Phaser.Scene, floor: FloorMap, pxPerTile: number): string {
  const key = `mini-${floor.id}-${pxPerTile}`;
  if (scene.textures.exists(key)) return key;
  const { width, height } = floor.grid;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x000000, 0.55);
  g.fillRect(0, 0, width * pxPerTile, height * pxPerTile);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = floor.areaIndex[y * width + x];
      if (a < 0) continue;
      g.fillStyle(hex(shade(materialBase(kindOf(floor.areas[a])), 0.1)), 1);
      g.fillRect(x * pxPerTile, y * pxPerTile, pxPerTile, pxPerTile);
    }
  }
  g.fillStyle(0xc9b458, 1);
  for (const s of floor.stairs) {
    g.fillRect((s.zone.x / TS) * pxPerTile, (s.zone.y / TS) * pxPerTile, (s.zone.w / TS) * pxPerTile, (s.zone.h / TS) * pxPerTile);
  }
  g.generateTexture(key, width * pxPerTile, height * pxPerTile);
  g.destroy();
  return key;
}
