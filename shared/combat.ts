// Who a killer's swing would hit. Shared so the client can light up the
// ATTACK button only when the server would accept the swing.

import {
  ATTACK_ARC_DEG,
  PLAYER_RADIUS_PX,
  TILE_SIZE,
} from "./constants";
import { hasLineOfSight } from "./physics";
import type { CollisionGrid } from "./types";

export interface Combatant {
  id: string;
  floor: number;
  x: number;
  y: number;
}

/** Centre-to-centre reach in pixels for an attackRange measured between body edges. */
export function attackReachPx(attackRangeTiles: number, toleranceTiles = 0): number {
  return (attackRangeTiles + toleranceTiles) * TILE_SIZE + PLAYER_RADIUS_PX * 2;
}

/** Smallest absolute difference between two angles, in radians. */
function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/**
 * The closest candidate in front of the attacker (within the arc), within
 * reach and with no wall in between. `candidates` must already be filtered to
 * valid victims (alive, not a killer, not protected, not hidden).
 */
export function pickAttackTarget<T extends Combatant>(
  grid: CollisionGrid,
  attacker: Combatant,
  facing: number,
  reachPx: number,
  candidates: Iterable<T>,
  arcDeg = ATTACK_ARC_DEG,
): T | null {
  const halfArc = ((arcDeg / 2) * Math.PI) / 180;
  let best: T | null = null;
  let bestD = reachPx * reachPx;
  for (const c of candidates) {
    if (c.id === attacker.id || c.floor !== attacker.floor) continue;
    const dx = c.x - attacker.x;
    const dy = c.y - attacker.y;
    const d = dx * dx + dy * dy;
    if (d > bestD) continue;
    // Overlapping bodies always count, whatever way you face.
    if (d > PLAYER_RADIUS_PX ** 2 && angleDiff(Math.atan2(dy, dx), facing) > halfArc) continue;
    if (!hasLineOfSight(grid, attacker.x, attacker.y, c.x, c.y)) continue;
    best = c;
    bestD = d;
  }
  return best;
}
