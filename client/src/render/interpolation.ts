// Snapshot interpolation for other players: positions are rendered
// INTERPOLATION_DELAY_MS in the past, blended between the two snapshots that
// surround that moment. This hides network jitter at the cost of 100 ms delay.

import {
  INTERPOLATION_DELAY_MS,
  SNAPSHOT_BUFFER_SIZE,
  TICK_MS,
} from "../../../shared/constants";
import type { Vec2 } from "../../../shared/types";

interface Snapshot {
  t: number;
  x: number;
  y: number;
}

export class InterpolationBuffer {
  private snaps: Snapshot[] = [];

  push(x: number, y: number, now = performance.now()): void {
    const last = this.snaps[this.snaps.length - 1];
    // After standing still there are no recent snapshots (the server sends
    // nothing when nothing changes). Re-anchor the old position one tick ago
    // so movement starts at normal speed instead of sliding from long ago.
    if (last && now - last.t > TICK_MS * 2) {
      this.snaps.push({ t: now - TICK_MS, x: last.x, y: last.y });
    }
    this.snaps.push({ t: now, x, y });
    if (this.snaps.length > SNAPSHOT_BUFFER_SIZE) {
      this.snaps.splice(0, this.snaps.length - SNAPSHOT_BUFFER_SIZE);
    }
  }

  /** Jump straight to a position (teleports, first sighting). */
  reset(x: number, y: number): void {
    this.snaps = [{ t: performance.now(), x, y }];
  }

  sample(now = performance.now()): Vec2 | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    const renderT = now - INTERPOLATION_DELAY_MS;
    if (renderT <= this.snaps[0].t) return { x: this.snaps[0].x, y: this.snaps[0].y };
    for (let i = n - 1; i > 0; i--) {
      const a = this.snaps[i - 1];
      const b = this.snaps[i];
      if (renderT >= a.t) {
        if (renderT >= b.t) return { x: b.x, y: b.y };
        const k = (renderT - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    const last = this.snaps[n - 1];
    return { x: last.x, y: last.y };
  }
}
