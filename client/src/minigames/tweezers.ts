// TWEEZERS — "Teddy bear surgery" (room 311)
//
// Input: press on a piece of stuffing to grab it with the tweezers, drag it
// out of the teddy's swollen testicles and drop it in the tray on the right.
//   - While you're holding a piece, touching a RED zone makes the teddy
//     scream "OUCH!": the piece falls back where it came from.
//   - Letting go anywhere except the tray also puts the piece back.
// Pull out all PIECES pieces to finish. There's always a gap between the red
// zones: go slowly.

import Phaser from "phaser";
import { buzzPhone, sfx } from "../audio/synth";
import type { MinigameFactory } from "./types";
import { COLORS, label, shake } from "./ui";

const TUNING = {
  pieces: 5,
  /** Grab radius around a piece, in u (generous for thumbs). */
  grabRadiusU: 7,
  /** Red zone radius, in u. */
  redRadiusU: 5.5,
};

type Vec = { x: number; y: number };

export const tweezersGame: MinigameFactory = (ctx) => {
  const { scene, area, u } = ctx;
  const cx = area.x + area.width * 0.36;
  const top = area.y + area.height * 0.08;

  // The teddy: head, ears, body, arms, legs, and the two pouches.
  const g = scene.add.graphics();
  const fur = 0xa0522d;
  const furDark = 0x7b3f1d;
  g.fillStyle(fur, 1);
  g.fillCircle(cx - u * 12, top + u * 6, u * 6);
  g.fillCircle(cx + u * 12, top + u * 6, u * 6);
  g.fillCircle(cx, top + u * 16, u * 14);
  g.fillEllipse(cx, top + u * 46, u * 40, u * 36);
  g.fillCircle(cx - u * 22, top + u * 40, u * 7);
  g.fillCircle(cx + u * 22, top + u * 40, u * 7);
  g.fillCircle(cx - u * 15, top + u * 68, u * 9);
  g.fillCircle(cx + u * 15, top + u * 68, u * 9);
  g.fillStyle(0x000000, 1);
  g.fillCircle(cx - u * 5, top + u * 13, u * 1.8);
  g.fillCircle(cx + u * 5, top + u * 13, u * 1.8);
  g.fillCircle(cx, top + u * 19, u * 2.2);
  // The patient area: two big round pouches between the legs, stitched open.
  const pouchY = top + u * 66;
  const pouches: Vec[] = [{ x: cx - u * 6, y: pouchY }, { x: cx + u * 6, y: pouchY }];
  g.fillStyle(furDark, 1);
  for (const p of pouches) g.fillCircle(p.x, p.y, u * 8);
  g.fillStyle(0xf8f8f8, 1);
  for (const p of pouches) g.fillCircle(p.x, p.y, u * 6);
  g.lineStyle(u * 0.6, 0x000000, 1);
  for (const p of pouches) for (let k = -2; k <= 2; k++) g.lineBetween(p.x + k * u * 2, p.y - u * 7.5, p.x + k * u * 2, p.y - u * 5.5);

  // Red zones around the pouches, leaving gaps to pull through.
  const reds: Vec[] = [
    { x: cx - u * 17, y: pouchY - u * 5 },
    { x: cx + u * 17, y: pouchY - u * 5 },
    { x: cx, y: pouchY - u * 12 },
    { x: cx - u * 12, y: pouchY + u * 11 },
    { x: cx + u * 12, y: pouchY + u * 11 },
    { x: cx + u * 28, y: pouchY - u * 2 },
  ];
  const redG = scene.add.graphics();
  redG.fillStyle(COLORS.bad, 0.55);
  redG.lineStyle(2, COLORS.bad, 1);
  for (const r of reds) {
    redG.fillCircle(r.x, r.y, TUNING.redRadiusU * u);
    redG.strokeCircle(r.x, r.y, TUNING.redRadiusU * u);
  }

  // Tray.
  const tray = new Phaser.Geom.Rectangle(area.x + area.width * 0.7, area.y + area.height * 0.3, area.width * 0.25, area.height * 0.45);
  const trayG = scene.add.graphics();
  trayG.fillStyle(0xb0bec5, 1);
  trayG.fillRoundedRect(tray.x, tray.y, tray.width, tray.height, u * 3);
  trayG.lineStyle(u, 0x78909c, 1);
  trayG.strokeRoundedRect(tray.x, tray.y, tray.width, tray.height, u * 3);
  label(scene, tray.centerX, tray.y - u * 4, "TRAY", u * 5);
  const counter = label(scene, tray.centerX, tray.bottom + u * 6, "", u * 6);

  // Stuffing pieces (fluffy blobs) inside the pouches.
  const homes: Vec[] = [
    { x: pouches[0].x - u * 2, y: pouches[0].y - u * 1 },
    { x: pouches[0].x + u * 1.5, y: pouches[0].y + u * 2 },
    { x: pouches[1].x - u * 1.5, y: pouches[1].y - u * 1.5 },
    { x: pouches[1].x + u * 2, y: pouches[1].y + u * 1.5 },
    { x: cx, y: pouchY + u * 1 },
  ].slice(0, TUNING.pieces);
  const pieces = homes.map((h) => {
    const p = scene.add.container(h.x, h.y);
    const pg = scene.add.graphics();
    pg.fillStyle(0xffffff, 1);
    for (let i = 0; i < 5; i++) pg.fillCircle(Math.cos(i * 1.3) * u * 1.2, Math.sin(i * 1.3) * u * 1.2, u * 1.8);
    pg.lineStyle(1, 0xcccccc, 1);
    pg.strokeCircle(0, 0, u * 2.6);
    p.add(pg);
    return { obj: p, home: h, done: false };
  });

  // Tweezers that follow the finger while holding a piece.
  const tweezers = scene.add.graphics().setVisible(false);
  tweezers.lineStyle(u * 0.9, 0xcfd8dc, 1);
  tweezers.lineBetween(0, 0, u * 14, -u * 16);
  tweezers.lineBetween(u * 2, 0, u * 16, -u * 15);

  let held: (typeof pieces)[number] | null = null;
  let done = 0;
  let finished = false;
  const updateCounter = () => counter.setText(`${done} / ${TUNING.pieces}`);

  const dropBack = () => {
    if (!held) return;
    const h = held;
    scene.tweens.add({ targets: h.obj, x: h.home.x, y: h.home.y, duration: 150 });
    held = null;
    tweezers.setVisible(false);
  };

  scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
    if (finished || held) return;
    const grab = TUNING.grabRadiusU * u;
    held = pieces.find((pc) => !pc.done && Math.hypot(pc.obj.x - p.x, pc.obj.y - p.y) <= grab) ?? null;
    if (held) {
      sfx.click();
      tweezers.setVisible(true).setPosition(p.x, p.y);
    }
  });
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
    if (!held) return;
    held.obj.setPosition(p.x, p.y);
    tweezers.setPosition(p.x, p.y);
    if (reds.some((r) => Math.hypot(r.x - p.x, r.y - p.y) <= TUNING.redRadiusU * u)) {
      sfx.buzz();
      buzzPhone(100);
      ctx.setStatus("OUCH!! The teddy screams. Avoid the red bits!");
      shake(scene, redG, u);
      dropBack();
    }
  });
  scene.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
    if (!held) return;
    if (tray.contains(p.x, p.y)) {
      held.done = true;
      held.obj.setScale(0.8);
      held = null;
      tweezers.setVisible(false);
      done++;
      sfx.ding();
      updateCounter();
      if (done === TUNING.pieces) {
        finished = true;
        ctx.setStatus("The teddy feels much lighter.");
        ctx.complete();
      }
    } else {
      dropBack();
    }
  });

  ctx.setStatus("Drag the stuffing out into the tray. Don't touch the red!");
  updateCounter();
  return {};
};
