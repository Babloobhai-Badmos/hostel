// HOLD — "Fill the water bottle" (Washroom)
//
// Input: press and HOLD the big FILL button (or hold Space). Water rises
// while held. Let go when the level is inside the green zone (80–95%).
//   - Released inside the zone: bottle done, next bottle.
//   - Released too low: nothing lost, hold again to top it up.
//   - Released too high, or the bottle overflows while holding: SPLASH, the
//     bottle empties and you start that bottle again.
// Fill BOTTLES bottles to finish.

import Phaser from "phaser";
import { buzzPhone, sfx } from "../audio/synth";
import type { MinigameFactory } from "./types";
import { COLORS, bigButton, label } from "./ui";

const TUNING = {
  bottles: 3,
  /** Seconds to fill an empty bottle to the brim while holding. */
  secondsToFill: 2.4,
  greenMin: 0.8,
  greenMax: 0.95,
};

export const holdGame: MinigameFactory = (ctx) => {
  const { scene, area, u } = ctx;
  const bottleW = u * 22;
  const bottleH = u * 70;
  const bx = area.x + area.width * 0.35;
  const by = area.centerY;
  const top = by - bottleH / 2;
  let level = 0;
  let holding = false;
  let filled = 0;
  let finished = false;

  const g = scene.add.graphics();
  const counter = label(scene, bx, top - u * 6, "", u * 6);
  const draw = () => {
    g.clear();
    // Water.
    g.fillStyle(0x4fc3f7, 1);
    const wh = bottleH * Math.min(level, 1);
    g.fillRect(bx - bottleW / 2, top + bottleH - wh, bottleW, wh);
    // Green zone marks on the side.
    g.fillStyle(COLORS.good, 0.9);
    const zTop = top + bottleH * (1 - TUNING.greenMax);
    const zH = bottleH * (TUNING.greenMax - TUNING.greenMin);
    g.fillRect(bx + bottleW / 2 + u, zTop, u * 3, zH);
    g.lineStyle(2, COLORS.good, 0.6);
    g.strokeRect(bx - bottleW / 2, zTop, bottleW, zH);
    // Bottle outline + neck.
    g.lineStyle(u * 1.2, 0xffffff, 1);
    g.strokeRoundedRect(bx - bottleW / 2, top, bottleW, bottleH, u * 3);
    g.fillStyle(0x2e86de, 1);
    g.fillRect(bx - bottleW * 0.2, top - u * 5, bottleW * 0.4, u * 5);
    counter.setText(`Bottle ${Math.min(filled + 1, TUNING.bottles)} / ${TUNING.bottles}`);
  };

  const release = () => {
    if (!holding || finished) return;
    holding = false;
    if (level >= TUNING.greenMin && level <= TUNING.greenMax) {
      filled++;
      sfx.ding();
      buzzPhone();
      if (filled >= TUNING.bottles) {
        finished = true;
        ctx.complete();
        return;
      }
      level = 0;
      ctx.setStatus("Nice! Next bottle.");
    } else if (level > TUNING.greenMax) {
      overflow();
    } else {
      ctx.setStatus("Not full yet. Hold again to top it up.");
    }
  };
  const overflow = () => {
    holding = false;
    level = 0;
    sfx.splash();
    buzzPhone(120);
    ctx.setStatus("SPLASH! Too much. Start this bottle again.");
  };

  bigButton(scene, area.x + area.width * 0.75, by, u * 40, u * 30, "HOLD TO FILL", 0x2e86de, () => (holding = true), release);
  const space = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  space?.on("down", () => (holding = true));
  space?.on("up", release);

  ctx.setStatus("Hold to fill. Let go in the GREEN zone.");
  draw();

  return {
    update(dt) {
      if (holding && !finished) {
        level += dt / TUNING.secondsToFill;
        if (level >= 1) overflow();
      }
      draw();
    },
  };
};
