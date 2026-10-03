// WALK-MARKERS — "Measure the corridor" (North Corridor, Floor 2)
//
// Input: a giant measuring tape with MARKERS marker lines. A slider runs
// back and forth along it. Tap MARK (or press Space) when the slider is on
// an unmarked line (within TOLERANCE of the tape's length). A good tap turns
// that line green; a miss buzzes and nothing else happens. Mark all lines
// to finish. Lines can be marked in any order, on any pass.

import Phaser from "phaser";
import { buzzPhone, sfx } from "../audio/synth";
import type { MinigameFactory } from "./types";
import { COLORS, bigButton, label } from "./ui";

const TUNING = {
  markers: 5,
  /** Seconds for the slider to cross the whole tape once. */
  passSeconds: 2.6,
  /** Hit window as a fraction of the tape length. */
  tolerance: 0.025,
  /** Markers are kept at least this far apart (fraction of tape length). */
  minGap: 0.12,
};

export const walkMarkersGame: MinigameFactory = (ctx) => {
  const { scene, area, u } = ctx;
  const tapeX = area.x + area.width * 0.06;
  const tapeW = area.width * 0.88;
  const tapeY = area.y + area.height * 0.3;
  const tapeH = u * 16;

  // Tape with tick marks.
  const g = scene.add.graphics();
  g.fillStyle(0xf4c430, 1);
  g.fillRoundedRect(tapeX, tapeY, tapeW, tapeH, u * 2);
  g.lineStyle(2, 0x000000, 0.8);
  for (let i = 0; i <= 100; i++) {
    const x = tapeX + (tapeW * i) / 100;
    g.lineBetween(x, tapeY, x, tapeY + (i % 10 === 0 ? tapeH * 0.6 : i % 5 === 0 ? tapeH * 0.4 : tapeH * 0.22));
  }
  for (let i = 0; i <= 10; i++) label(scene, tapeX + (tapeW * i) / 10, tapeY + tapeH * 0.8, `${i}m`, u * 3.4, "#000000").setStroke("#f4c430", 0);

  // Marker positions, spread out.
  const positions: number[] = [];
  while (positions.length < TUNING.markers) {
    const p = 0.06 + Math.random() * 0.88;
    if (positions.every((q) => Math.abs(q - p) >= TUNING.minGap)) positions.push(p);
  }
  const marked = positions.map(() => false);
  const lines = positions.map((p) =>
    scene.add.rectangle(tapeX + tapeW * p, tapeY + tapeH / 2, u * 1.2, tapeH + u * 10, COLORS.bad),
  );

  const slider = scene.add.triangle(tapeX, tapeY - u * 3, 0, 0, u * 6, 0, u * 3, u * 5, 0xffffff).setOrigin(0.5, 1);
  const sliderLine = scene.add.rectangle(tapeX, tapeY + tapeH / 2, 2, tapeH + u * 6, 0xffffff, 0.8);
  const counter = label(scene, area.centerX, area.y + area.height * 0.12, "", u * 6);

  let pos = 0;
  let dir = 1;
  let finished = false;
  const updateCounter = () => counter.setText(`${marked.filter(Boolean).length} / ${TUNING.markers} marked`);

  const mark = () => {
    if (finished) return;
    const i = positions.findIndex((p, k) => !marked[k] && Math.abs(p - pos) <= TUNING.tolerance);
    if (i < 0) {
      sfx.buzz();
      buzzPhone(60);
      return;
    }
    marked[i] = true;
    lines[i].setFillStyle(COLORS.good);
    sfx.ding();
    updateCounter();
    if (marked.every(Boolean)) {
      finished = true;
      ctx.complete();
    }
  };
  bigButton(scene, area.centerX, area.y + area.height * 0.78, u * 50, u * 22, "MARK!", 0x2e86de, mark);
  scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE).on("down", mark);

  ctx.setStatus("Tap MARK when the slider is on a red line.");
  updateCounter();

  return {
    update(dt) {
      if (finished) return;
      pos += (dir * dt) / TUNING.passSeconds;
      if (pos >= 1) {
        pos = 1;
        dir = -1;
      } else if (pos <= 0) {
        pos = 0;
        dir = 1;
      }
      const x = tapeX + tapeW * pos;
      slider.setX(x);
      sliderLine.setX(x);
    },
  };
};
