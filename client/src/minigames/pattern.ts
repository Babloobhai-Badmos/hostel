// PATTERN — "Charge your phone" (Common Lounge)
//
// Input: a sequence of 4 arrows is shown for SHOW_SECONDS, then hidden.
// Repeat it by tapping the four arrow buttons (or pressing the arrow keys)
// in the same order. A wrong arrow buzzes and shows a NEW sequence. Each
// correct sequence charges the battery; ROUNDS correct sequences to finish.

import Phaser from "phaser";
import { sfx } from "../audio/synth";
import type { MinigameFactory } from "./types";
import { COLORS, bigButton, label, shake } from "./ui";

const TUNING = {
  rounds: 2,
  length: 4,
  showSeconds: 2,
};

type Dir = "up" | "down" | "left" | "right";
const DIRS: Dir[] = ["up", "down", "left", "right"];
const ARROW: Record<Dir, string> = { up: "▲", down: "▼", left: "◀", right: "▶" };

export const patternGame: MinigameFactory = (ctx) => {
  const { scene, area, u } = ctx;
  let round = 0;
  let sequence: Dir[] = [];
  let entered = 0;
  let accepting = false;
  let finished = false;

  // Phone with battery on the left.
  const px = area.x + area.width * 0.22;
  const py = area.centerY;
  const phone = scene.add.graphics();
  const drawPhone = () => {
    phone.clear();
    phone.fillStyle(0x111111, 1);
    phone.fillRoundedRect(px - u * 14, py - u * 26, u * 28, u * 52, u * 4);
    phone.fillStyle(0x333333, 1);
    phone.fillRect(px - u * 11, py - u * 20, u * 22, u * 40);
    const charge = round / TUNING.rounds;
    phone.fillStyle(charge >= 1 ? COLORS.good : COLORS.accent, 1);
    phone.fillRect(px - u * 9, py + u * 18 - u * 36 * charge, u * 18, u * 36 * charge);
  };
  drawPhone();
  const pct = label(scene, px, py + u * 32, "", u * 6);

  // The sequence row.
  const slots = Array.from({ length: TUNING.length }, (_, i) =>
    label(scene, area.x + area.width * (0.45 + i * 0.08), area.y + area.height * 0.2, "", u * 12),
  );

  const show = () => {
    sequence = Array.from({ length: TUNING.length }, () => DIRS[Math.floor(Math.random() * 4)]);
    entered = 0;
    accepting = false;
    slots.forEach((s, i) => s.setText(ARROW[sequence[i]]).setColor("#ffe066"));
    ctx.setStatus("Remember this!");
    scene.time.delayedCall(TUNING.showSeconds * 1000, () => {
      slots.forEach((s) => s.setText("•").setColor("#888888"));
      accepting = true;
      ctx.setStatus("Now repeat it.");
    });
  };

  const press = (d: Dir) => {
    if (!accepting || finished) return;
    if (d === sequence[entered]) {
      sfx.click();
      slots[entered].setText(ARROW[d]).setColor("#9be564");
      entered++;
      if (entered === TUNING.length) {
        round++;
        drawPhone();
        pct.setText(`${Math.round((round / TUNING.rounds) * 100)}%`);
        sfx.ding();
        accepting = false;
        if (round >= TUNING.rounds) {
          finished = true;
          ctx.complete();
        } else {
          scene.time.delayedCall(500, show);
        }
      }
    } else {
      sfx.buzz();
      slots.forEach((s) => shake(scene, s, u * 2));
      accepting = false;
      ctx.setStatus("Wrong! New pattern…");
      scene.time.delayedCall(700, show);
    }
  };

  // D-pad on the right.
  const cx = area.x + area.width * 0.7;
  const cy = area.y + area.height * 0.64;
  const s = u * 17;
  const offsets: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  for (const d of DIRS) {
    const [ox, oy] = offsets[d];
    bigButton(scene, cx + ox * s * 1.1, cy + oy * s * 1.1, s, s, ARROW[d], 0x5a4d70, () => press(d));
  }
  const K = Phaser.Input.Keyboard.KeyCodes;
  const keyMap: [number, Dir][] = [[K.UP, "up"], [K.DOWN, "down"], [K.LEFT, "left"], [K.RIGHT, "right"], [K.W, "up"], [K.S, "down"], [K.A, "left"], [K.D, "right"]];
  for (const [code, d] of keyMap) scene.input.keyboard?.addKey(code).on("down", () => press(d));

  pct.setText("0%");
  show();
  return {};
};
