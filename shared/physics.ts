// Movement and collision code shared by the server (authoritative) and the
// client (prediction). Both sides must run exactly this code so the client's
// predicted position matches what the server computes.

import type { CollisionGrid, Vec2 } from "./types";

/** True if the tile at (tx, ty) is solid. Anything outside the grid counts as solid. */
export function isSolidTile(grid: CollisionGrid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.solid[ty * grid.width + tx] === 1;
}

/** True if a circle at (x, y) with radius r overlaps any solid tile. */
export function circleHitsWall(grid: CollisionGrid, x: number, y: number, r: number): boolean {
  const ts = grid.tileSize;
  const minTx = Math.floor((x - r) / ts);
  const maxTx = Math.floor((x + r) / ts);
  const minTy = Math.floor((y - r) / ts);
  const maxTy = Math.floor((y + r) / ts);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isSolidTile(grid, tx, ty)) continue;
      // Closest point on the tile rectangle to the circle centre.
      const cx = Math.max(tx * ts, Math.min(x, (tx + 1) * ts));
      const cy = Math.max(ty * ts, Math.min(y, (ty + 1) * ts));
      const ddx = x - cx;
      const ddy = y - cy;
      if (ddx * ddx + ddy * ddy < r * r) return true;
    }
  }
  return false;
}

/** Clamp an input vector to length <= 1 and drop NaN/garbage. */
export function sanitizeDirection(dx: unknown, dy: unknown): Vec2 {
  let x = typeof dx === "number" && Number.isFinite(dx) ? dx : 0;
  let y = typeof dy === "number" && Number.isFinite(dy) ? dy : 0;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { x, y };
}

/**
 * Move a circle by one input step. Each axis is resolved separately so the
 * player slides along walls instead of sticking to them.
 * `speed` is in pixels per second; `dt` in seconds.
 */
export function stepMovement(
  grid: CollisionGrid,
  pos: Vec2,
  dir: Vec2,
  speed: number,
  dt: number,
  radius: number,
): Vec2 {
  const stepX = dir.x * speed * dt;
  const stepY = dir.y * speed * dt;
  let x = pos.x;
  let y = pos.y;
  if (stepX !== 0 && !circleHitsWall(grid, x + stepX, y, radius)) x += stepX;
  if (stepY !== 0 && !circleHitsWall(grid, x, y + stepY, radius)) y += stepY;
  return { x, y };
}

/** Ghost movement: no walls, just stay inside the floor. */
export function stepGhost(grid: CollisionGrid, pos: Vec2, dir: Vec2, speed: number, dt: number, radius: number): Vec2 {
  const maxX = grid.width * grid.tileSize - radius;
  const maxY = grid.height * grid.tileSize - radius;
  return {
    x: Math.min(maxX, Math.max(radius, pos.x + dir.x * speed * dt)),
    y: Math.min(maxY, Math.max(radius, pos.y + dir.y * speed * dt)),
  };
}

/**
 * Distance from (x, y) along `angle` to the first solid tile, capped at
 * maxDist. Grid DDA: visits exactly the tiles the ray crosses.
 */
export function castRay(grid: CollisionGrid, x: number, y: number, angle: number, maxDist: number): number {
  const ts = grid.tileSize;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let tx = Math.floor(x / ts);
  let ty = Math.floor(y / ts);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(ts / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(ts / dy) : Infinity;
  let tMaxX = dx > 0 ? ((tx + 1) * ts - x) / dx : dx < 0 ? (tx * ts - x) / dx : Infinity;
  let tMaxY = dy > 0 ? ((ty + 1) * ts - y) / dy : dy < 0 ? (ty * ts - y) / dy : Infinity;
  for (;;) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      ty += stepY;
    }
    if (t >= maxDist) return maxDist;
    if (isSolidTile(grid, tx, ty)) return t;
  }
}

/** True if nothing solid lies on the straight line between two points. */
export function hasLineOfSight(grid: CollisionGrid, x0: number, y0: number, x1: number, y1: number): boolean {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (dist < 1) return true;
  return castRay(grid, x0, y0, Math.atan2(y1 - y0, x1 - x0), dist) >= dist;
}
