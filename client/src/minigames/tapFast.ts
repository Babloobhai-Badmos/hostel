// TAP-FAST — "Eat the laddus" (room 310)
//
// Input: LADDUS laddus sit on a plate. Tap them to eat them. The clock
// (SECONDS) starts on your first bite. Eat all of them before it runs out
// to finish; if time runs out, a fresh plate appears (in new spots) and you
// try again. Each laddu is big enough to hit with a thumb.

import Phaser from "phaser";
import { buzzPhone, sfx } from "../audio/synth";
import type { MinigameFactory } from "./types";
import { COLORS, label } from "./ui";

const TUNING = {
  laddus: 10,
  seconds: 3,
  /** Laddu radius in u. */
  radiusU: 7,
};

export const tapFastGame: MinigameFactory = (ctx) => {
  const { scene, area, u } = ctx;
  const r = TUNING.radiusU * u;
  const plateX = area.centerX - area.width * 0.08;
  const plateY = area.centerY + u * 2;
  const plateRx = area.width * 0.36;
  const plateRy = area.height * 0.42;
  const plate = scene.add.graphics();
  plate.fillStyle(0xdddddd, 1);
  plate.fillEllipse(plateX, plateY, plateRx * 2, plateRy * 2);
  plate.lineStyle(u, 0xaaaaaa, 1);
  plate.strokeEllipse(plateX, plateY, plateRx * 1.7, plateRy * 1.7);

  const timerText = label(scene, area.right - area.width * 0.1, area.centerY - u * 8, "", u * 12);
  const eatenText = label(scene, area.right - area.width * 0.1, area.centerY + u * 10, "", u * 6);

  let laddus: Phaser.GameObjects.Container[] = [];
  let eaten = 0;
  let timeLeft = TUNING.seconds;
  let running = false;
  let finished = false;
  let cooling = false;

  const makeLaddu = (x: number, y: number) => {
    const c = scene.add.container(x, y);
    const g = scene.add.graphics();
    g.fillStyle(0xf39c12, 1);
    g.fillCircle(0, 0, r);
    g.fillStyle(0xffb74d, 1);
    for (let i = 0; i < 8; i++) g.fillCircle(Math.cos(i) * r * 0.55, Math.sin(i * 1.7) * r * 0.55, r * 0.18);
    g.lineStyle(2, 0xb9770e, 1);
    g.strokeCircle(0, 0, r);
    c.add(g);
    c.setSize(r * 2.2, r * 2.2).setInteractive();
    c.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => eat(c));
    return c;
  };

  const lay = () => {
    laddus.forEach((l) => l.destroy());
    laddus = [];
    const spots: { x: number; y: number }[] = [];
    let guard = 0;
    while (spots.length < TUNING.laddus && guard++ < 2000) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * 0.8;
      const s = { x: plateX + Math.cos(a) * plateRx * d, y: plateY + Math.sin(a) * plateRy * d };
      if (spots.every((o) => Math.hypot(o.x - s.x, o.y - s.y) > r * 2.1)) spots.push(s);
    }
    laddus = spots.map((s) => makeLaddu(s.x, s.y));
    eaten = 0;
    timeLeft = TUNING.seconds;
    running = false;
    timerText.setText(`${TUNING.seconds.toFixed(1)}s`).setColor("#ffffff");
    eatenText.setText(`0 / ${TUNING.laddus}`);
  };

  const eat = (c: Phaser.GameObjects.Container) => {
    if (finished || cooling) return;
    running = true;
    sfx.chomp();
    buzzPhone(10);
    c.disableInteractive();
    scene.tweens.add({ targets: c, scale: 0, angle: 90, duration: 120, onComplete: () => c.destroy() });
    eaten++;
    eatenText.setText(`${eaten} / ${TUNING.laddus}`);
    if (eaten === TUNING.laddus) {
      finished = true;
      running = false;
      ctx.complete();
    }
  };

  ctx.setStatus(`Eat all ${TUNING.laddus} laddus in ${TUNING.seconds} seconds! The clock starts on your first bite.`);
  lay();

  return {
    update(dt) {
      if (!running || finished) return;
      timeLeft -= dt;
      timerText.setText(`${Math.max(0, timeLeft).toFixed(1)}s`).setColor(timeLeft < 1 ? "#ff4d4d" : "#ffffff");
      if (timeLeft <= 0) {
        running = false;
        cooling = true;
        sfx.buzz();
        ctx.setStatus("Too slow! Fresh plate…");
        timerText.setColor(Phaser.Display.Color.IntegerToColor(COLORS.bad).rgba);
        scene.time.delayedCall(900, () => {
          cooling = false;
          ctx.setStatus("Again! The clock starts on your first bite.");
          lay();
        });
      }
    },
  };
};
