// Doors: a wooden panel filling the doorway when shut, swung back against
// the jamb (into the room) when open. Purely visual: whether a door blocks
// anything is decided by the collision grid (shared/doors.ts).

import Phaser from "phaser";
import { TILE_SIZE } from "../../../shared/constants";
import type { Doorway, FloorMap } from "../../../shared/buildMap";

const WOOD = 0x9c6b3e;
const WOOD_DARK = 0x6b4423;
const WOOD_LIGHT = 0xc08a55;
const OUTLINE = 0x2b1d14;
const KNOB = 0xf4c430;
/** Thickness of an open door seen edge-on, in pixels. */
const OPEN_THICKNESS_PX = 7;
/** How far an open door reaches into the room, as a share of the doorway width. */
const OPEN_REACH = 0.75;

export class DoorView {
  readonly graphics: Phaser.GameObjects.Graphics;
  private readonly rect: { x: number; y: number; w: number; h: number };
  /** Direction from the doorway into its room (unit vector along x or y). */
  private readonly inward: { x: number; y: number };

  constructor(scene: Phaser.Scene, floor: FloorMap, readonly doorway: Doorway) {
    const xs = doorway.tiles.map((t) => t.x);
    const ys = doorway.tiles.map((t) => t.y);
    this.rect = {
      x: Math.min(...xs) * TILE_SIZE,
      y: Math.min(...ys) * TILE_SIZE,
      w: (Math.max(...xs) - Math.min(...xs) + 1) * TILE_SIZE,
      h: (Math.max(...ys) - Math.min(...ys) + 1) * TILE_SIZE,
    };
    const room = floor.areas.find((a) => a.key === doorway.room)!.rect;
    const roomCx = (room.x + room.w / 2) * TILE_SIZE;
    const roomCy = (room.y + room.h / 2) * TILE_SIZE;
    this.inward = doorway.horizontal
      ? { x: 0, y: Math.sign(roomCy - doorway.y) || 1 }
      : { x: Math.sign(roomCx - doorway.x) || 1, y: 0 };
    this.graphics = scene.add.graphics();
  }

  setOpen(open: boolean): void {
    const g = this.graphics;
    const { x, y, w, h } = this.rect;
    g.clear();
    // Door frame: dark posts at both ends of the gap.
    g.fillStyle(OUTLINE, 1);
    if (this.doorway.horizontal) {
      g.fillRect(x - 2, y, 4, h);
      g.fillRect(x + w - 2, y, 4, h);
    } else {
      g.fillRect(x, y - 2, w, 4);
      g.fillRect(x, y + h - 2, w, 4);
    }
    if (open) {
      // Swung open against the left/top post, sticking into the room.
      const len = (this.doorway.horizontal ? w : h) * OPEN_REACH;
      const t = OPEN_THICKNESS_PX;
      const px = this.doorway.horizontal ? x + 2 : x + w / 2 - t / 2;
      const py = this.doorway.horizontal ? y + h / 2 - t / 2 : y + 2;
      const rx = this.doorway.horizontal ? px : px + (this.inward.x > 0 ? 0 : -len + t);
      const ry = this.doorway.horizontal ? py + (this.inward.y > 0 ? 0 : -len + t) : py;
      const rw = this.doorway.horizontal ? t : len;
      const rh = this.doorway.horizontal ? len : t;
      g.fillStyle(WOOD, 1);
      g.fillRect(rx, ry, rw, rh);
      g.lineStyle(2, OUTLINE, 1);
      g.strokeRect(rx, ry, rw, rh);
      return;
    }
    // Shut: planks across the whole gap, with a knob.
    const inset = 2;
    g.fillStyle(WOOD, 1);
    g.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
    g.lineStyle(2, WOOD_DARK, 1);
    const planks = 4;
    for (let k = 1; k < planks; k++) {
      if (this.doorway.horizontal) g.lineBetween(x + (w * k) / planks, y + inset, x + (w * k) / planks, y + h - inset);
      else g.lineBetween(x + inset, y + (h * k) / planks, x + w - inset, y + (h * k) / planks);
    }
    g.fillStyle(WOOD_LIGHT, 1);
    if (this.doorway.horizontal) g.fillRect(x + inset, y + inset, w - inset * 2, 4);
    else g.fillRect(x + inset, y + inset, 4, h - inset * 2);
    g.lineStyle(3, OUTLINE, 1);
    g.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
    g.fillStyle(KNOB, 1);
    if (this.doorway.horizontal) g.fillCircle(x + w - 10, y + h / 2, 3.5);
    else g.fillCircle(x + w / 2, y + h - 10, 3.5);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
