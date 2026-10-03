// MASH — "Fight the ghost-demon" (room 309)
//
// Input: tap the big BONK button as fast as you can (or mash Space). Every
// tap pushes your power bar up by TAP_GAIN with a silly WOMP; the bar drains
// by DRAIN_PER_SECOND all the time. Fill it to 100% to banish the demon. If
// it drains to zero, the demon laughs and you start again from START.

import Phaser from "phaser";
import { buzzPhone, sfx } from "../audio/synth";
import type { MinigameFactory } from "./types";
import { COLORS, bigButton, label } from "./ui";

const TUNING = {
  start: 0.3,
  tapGain: 0.045,
  drainPerSecond: 0.18,
};

export const mashGame: MinigameFactory = (ctx) => {
  const { scene, area, u } = ctx;
  let power = TUNING.start;
  let finished = false;

  // The demon: a wobbly purple ghost with angry eyes.
  const dx = area.x + area.width * 0.3;
  const dy = area.centerY - u * 4;
  const demon = scene.add.container(dx, dy);
  const body = scene.add.graphics();
  body.fillStyle(0x7b2cbf, 1);
  body.fillCircle(0, -u * 8, u * 18);
  body.fillRect(-u * 18, -u * 8, u * 36, u * 22);
  for (let i = 0; i < 4; i++) body.fillCircle(-u * 13.5 + i * u * 9, u * 14, u * 4.5);
  body.fillStyle(0xffffff, 1);
  body.fillCircle(-u * 7, -u * 10, u * 5);
  body.fillCircle(u * 7, -u * 10, u * 5);
  body.fillStyle(0xd7263d, 1);
  body.fillCircle(-u * 6, -u * 9, u * 2.4);
  body.fillCircle(u * 6, -u * 9, u * 2.4);
  body.lineStyle(u * 1.2, 0x000000, 1);
  body.lineBetween(-u * 12, -u * 17, -u * 3, -u * 13);
  body.lineBetween(u * 12, -u * 17, u * 3, -u * 13);
  demon.add(body);
  scene.tweens.add({ targets: demon, y: dy - u * 3, duration: 600, yoyo: true, repeat: -1, ease: "Sine.InOut" });

  // Power bar.
  const barX = area.x + area.width * 0.06;
  const barY = area.y + area.height * 0.88;
  const barW = area.width * 0.48;
  const barH = u * 7;
  const bar = scene.add.graphics();
  const pct = label(scene, barX + barW / 2, barY + barH / 2, "", u * 5);

  const tap = () => {
    if (finished) return;
    power = Math.min(1, power + TUNING.tapGain);
    sfx.womp();
    buzzPhone(15);
    demon.setScale(1 - power * 0.3);
    if (power >= 1) {
      finished = true;
      scene.tweens.add({ targets: demon, alpha: 0, scale: 0.1, angle: 360, duration: 500 });
      ctx.complete();
    }
  };
  bigButton(scene, area.x + area.width * 0.76, area.centerY, u * 42, u * 42, "BONK!", COLORS.bad, tap);
  scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE).on("down", tap);

  ctx.setStatus("Tap BONK as fast as you can before the bar drains!");

  return {
    update(dt) {
      if (!finished) {
        power -= TUNING.drainPerSecond * dt;
        if (power <= 0) {
          power = TUNING.start;
          sfx.buzz();
          ctx.setStatus("The demon laughs at you. Again! Faster!");
        }
        demon.setScale(1 - power * 0.3);
      }
      bar.clear();
      bar.fillStyle(0x000000, 0.6);
      bar.fillRoundedRect(barX, barY, barW, barH, barH / 2);
      bar.fillStyle(power > 0.7 ? COLORS.good : COLORS.accent, 1);
      bar.fillRoundedRect(barX, barY, Math.max(barH, barW * power), barH, barH / 2);
      pct.setText(`${Math.round(power * 100)}%`);
    },
  };
};
