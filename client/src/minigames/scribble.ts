// SCRIBBLE — "Paint the wall" (room 421)
//
// Input: drag a finger (or the mouse with the button held) across the dirty
// wall. The roller paints a thick stripe wherever you drag. The wall is
// divided into COLS x ROWS patches; a patch counts as painted once the
// roller centre passes within ROLLER_RADIUS of its centre. Paint every patch
// (100%) to finish.

import Phaser from "phaser";
import { buzzPhone, sfx } from "../audio/synth";
import type { MinigameFactory } from "./types";
import { label } from "./ui";

const TUNING = {
  cols: 12,
  rows: 6,
  /** Roller radius as a fraction of one patch's diagonal. */
  rollerRadius: 0.85,
  paintColor: 0x4fc3f7,
};

/** Distance from point P to the segment AB. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Phaser.Math.Clamp(((px - ax) * vx + (py - ay) * vy) / len2, 0, 1) : 0;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

export const scribbleGame: MinigameFactory = (ctx) => {
  const { scene, area, u } = ctx;
  const wall = new Phaser.Geom.Rectangle(area.x + area.width * 0.05, area.y + area.height * 0.12, area.width * 0.9, area.height * 0.78);
  const cw = wall.width / TUNING.cols;
  const ch = wall.height / TUNING.rows;
  const radius = Math.hypot(cw, ch) * TUNING.rollerRadius * 0.5;

  // Dirty wall with stains.
  const bg = scene.add.graphics();
  bg.fillStyle(0x8d7b68, 1);
  bg.fillRect(wall.x, wall.y, wall.width, wall.height);
  for (let i = 0; i < 25; i++) {
    bg.fillStyle(Phaser.Math.RND.pick([0x6d5d4b, 0x5d4e3e, 0x7a6a55]), 0.8);
    bg.fillCircle(wall.x + Math.random() * wall.width, wall.y + Math.random() * wall.height, u * (2 + Math.random() * 5));
  }
  label(scene, wall.centerX, wall.centerY, "PAINT ME", u * 10, "#00000055").setStroke("#000000", 0);

  const paint = scene.add.graphics();
  const painted = new Array(TUNING.cols * TUNING.rows).fill(false);
  let count = 0;
  let finished = false;
  let last: { x: number; y: number } | null = null;
  const pct = label(scene, area.centerX, area.y + u * 5, "0%", u * 6);
  const roller = scene.add.rectangle(0, 0, radius * 2, u * 4, 0xffffff).setVisible(false);

  const paintAt = (x: number, y: number) => {
    // Clamp the stroke to the wall.
    x = Phaser.Math.Clamp(x, wall.x, wall.right);
    y = Phaser.Math.Clamp(y, wall.y, wall.bottom);
    paint.lineStyle(radius * 2, TUNING.paintColor, 1);
    if (last) paint.lineBetween(last.x, last.y, x, y);
    paint.fillStyle(TUNING.paintColor, 1);
    paint.fillCircle(x, y, radius);
    // Mark every patch whose centre is within reach of the segment we just painted.
    const from = last ?? { x, y };
    for (let r = 0; r < TUNING.rows; r++) {
      for (let c = 0; c < TUNING.cols; c++) {
        const i = r * TUNING.cols + c;
        if (painted[i]) continue;
        const px = wall.x + (c + 0.5) * cw;
        const py = wall.y + (r + 0.5) * ch;
        if (segmentDistance(px, py, from.x, from.y, x, y) <= radius) {
          painted[i] = true;
          count++;
        }
      }
    }
    last = { x, y };
    roller.setPosition(x, y).setVisible(true);
    const done = count / painted.length;
    pct.setText(`${Math.floor(done * 100)}%`);
    if (count === painted.length && !finished) {
      finished = true;
      sfx.ding();
      buzzPhone();
      ctx.complete();
    }
  };

  scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
    if (finished || !wall.contains(p.x, p.y)) return;
    last = null;
    paintAt(p.x, p.y);
  });
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
    if (finished || !p.isDown || !last) return;
    paintAt(p.x, p.y);
  });
  scene.input.on(Phaser.Input.Events.POINTER_UP, () => {
    last = null;
    roller.setVisible(false);
  });

  ctx.setStatus("Drag across the wall to paint every bit of it.");
  return {};
};
