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
