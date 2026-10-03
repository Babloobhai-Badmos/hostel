// CARRY — "Carry chai" (Terrace)
//
// Input, any of these (whichever you use moves the cup):
//   - TILT the phone (DeviceOrientation). The angle when the game opens is
//     "level"; tilting up to TILT_FULL_DEG moves the cup at full speed. On
//     iPhone you first tap "Enable tilt" to grant permission.
//   - DRAG: put a finger anywhere and drag; a joystick appears under it.
//   - KEYS: WASD / arrows.
// Carry the cup along the winding path to the cutting-chai glass at the end.
// Off the path the chai spills (spill meter fills); a full spill meter sends
// you back to the start. Back on the path, the meter slowly recovers.

import Phaser from "phaser";
import { buzzPhone, sfx } from "../audio/synth";
import type { MinigameFactory } from "./types";
import { COLORS, bigButton, label } from "./ui";

const TUNING = {
  /** Cup speed at full tilt / full joystick, in path-widths per second. */
  maxSpeedUnits: 30,
  /** Tilting this many degrees from level = full speed. */
  tiltFullDeg: 22,
  /** Path half-width, in u (1% of the play area's smaller side). */
  pathHalfWidth: 7,
  spillPerSecond: 0.9,
  recoverPerSecond: 0.25,
  joystickRadiusU: 14,
};

type Vec = { x: number; y: number };

export const carryGame: MinigameFactory = (ctx) => {
  const { scene, area, u } = ctx;
  const halfW = TUNING.pathHalfWidth * u;

  // A wavy path from left to right, sampled as points.
  const pts: Vec[] = [];
  const left = area.x + area.width * 0.08;
  const right = area.x + area.width * 0.92;
  const amp = area.height * 0.28;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    pts.push({ x: left + (right - left) * t, y: area.centerY + Math.sin(t * Math.PI * 2.5) * amp * (0.4 + 0.6 * t) });
  }
  const g = scene.add.graphics();
  g.lineStyle(halfW * 2 + u * 2, 0x000000, 0.5);
  g.strokePoints(pts);
  g.lineStyle(halfW * 2, 0x8d6e63, 1);
  g.strokePoints(pts);
  g.lineStyle(2, 0xffffff, 0.3);
  g.strokePoints(pts);
  const end = pts[pts.length - 1];
  g.fillStyle(0xffffff, 0.9);
  g.fillRoundedRect(end.x - u * 4, end.y - u * 6, u * 8, u * 12, u * 2);
  label(scene, end.x, end.y - u * 10, "GOAL", u * 4.5);

  // Cup of chai.
  const cup = scene.add.container(pts[0].x, pts[0].y);
  const cupG = scene.add.graphics();
  cupG.fillStyle(0xffffff, 1);
  cupG.fillRoundedRect(-u * 4, -u * 4, u * 8, u * 8, u * 1.5);
  cupG.fillStyle(0xc68642, 1);
  cupG.fillCircle(0, -u * 1.5, u * 3);
  cupG.lineStyle(u, 0xffffff, 1);
  cupG.strokeCircle(u * 5, 0, u * 2);
  cup.add(cupG);

  // Spill meter.
  const meter = scene.add.graphics();
  const meterLabel = label(scene, area.x + area.width * 0.12, area.y + u * 5, "Spill", u * 4);

  let spill = 0;
  let finished = false;
  let tilt: Vec | null = null;
  let tiltZero: Vec | null = null;
  let stick: Vec = { x: 0, y: 0 };
  let stickOrigin: Vec | null = null;
  const stickG = scene.add.graphics();

  // --- Tilt ---
  const onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    // Map device axes to screen axes for the current screen rotation.
    const angle = (screen.orientation?.angle ?? 0) % 360;
    let x = e.gamma;
    let y = e.beta;
    if (angle === 90) [x, y] = [e.beta, -e.gamma];
    else if (angle === 270) [x, y] = [-e.beta, e.gamma];
    else if (angle === 180) [x, y] = [-e.gamma, -e.beta];
    tiltZero ??= { x, y };
    tilt = { x: x - tiltZero.x, y: y - tiltZero.y };
  };
  const startTilt = () => window.addEventListener("deviceorientation", onOrient);
  const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (DOE?.requestPermission) {
    // iOS: permission must be requested from a tap.
    const btn = bigButton(scene, area.right - u * 22, area.y + u * 8, u * 36, u * 11, "Enable tilt", 0x5a4d70, () => {
      DOE.requestPermission!()
        .then((r) => {
          if (r === "granted") startTilt();
        })
        .catch(() => {})
        .finally(() => btn.container.destroy());
    });
  } else if (DOE) {
    startTilt();
  }

  // --- Drag joystick (anywhere except buttons) ---
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer, over: unknown[]) => {
    if (over.length > 0) return;
    stickOrigin = { x: p.x, y: p.y };
  });
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
    if (!stickOrigin || !p.isDown) return;
    const r = TUNING.joystickRadiusU * u;
    const dx = p.x - stickOrigin.x;
    const dy = p.y - stickOrigin.y;
    const d = Math.hypot(dx, dy);
    const k = d > r ? r / d : 1;
    stick = { x: (dx * k) / r, y: (dy * k) / r };
  });
  scene.input.on(Phaser.Input.Events.POINTER_UP, () => {
    stickOrigin = null;
    stick = { x: 0, y: 0 };
  });
  const keys = scene.input.keyboard?.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT") as Record<string, Phaser.Input.Keyboard.Key> | undefined;

  const distToPath = (x: number, y: number) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const t = Phaser.Math.Clamp(((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy), 0, 1);
      best = Math.min(best, Math.hypot(x - (a.x + vx * t), y - (a.y + vy * t)));
    }
    return best;
  };

  ctx.setStatus(DOE ? "Tilt the phone (or drag) to carry the chai along the path." : "Drag (or WASD) to carry the chai along the path.");

  return {
    update(dt) {
      if (finished) return;
      // Pick the input: keys > drag > tilt.
      let v: Vec = { x: 0, y: 0 };
      const kx = keys ? (keys.D.isDown || keys.RIGHT.isDown ? 1 : 0) - (keys.A.isDown || keys.LEFT.isDown ? 1 : 0) : 0;
      const ky = keys ? (keys.S.isDown || keys.DOWN.isDown ? 1 : 0) - (keys.W.isDown || keys.UP.isDown ? 1 : 0) : 0;
      if (kx || ky) v = { x: kx, y: ky };
      else if (stickOrigin) v = stick;
      else if (tilt) v = { x: Phaser.Math.Clamp(tilt.x / TUNING.tiltFullDeg, -1, 1), y: Phaser.Math.Clamp(tilt.y / TUNING.tiltFullDeg, -1, 1) };
      const speed = TUNING.maxSpeedUnits * u;
      cup.x = Phaser.Math.Clamp(cup.x + v.x * speed * dt, area.x, area.right);
      cup.y = Phaser.Math.Clamp(cup.y + v.y * speed * dt, area.y, area.bottom);

      const off = distToPath(cup.x, cup.y) > halfW;
      spill = Phaser.Math.Clamp(spill + (off ? TUNING.spillPerSecond : -TUNING.recoverPerSecond) * dt, 0, 1);
      cup.setAngle(off ? Math.sin(performance.now() / 50) * 15 : 0);
      if (spill >= 1) {
        sfx.splash();
        buzzPhone(120);
        ctx.setStatus("SPILLED! Back to the start. Stay on the path.");
        cup.setPosition(pts[0].x, pts[0].y);
        spill = 0;
      }
      if (Math.hypot(cup.x - end.x, cup.y - end.y) < halfW) {
        finished = true;
        ctx.complete();
      }

      meter.clear();
      meter.fillStyle(0x000000, 0.6);
      meter.fillRect(area.x + area.width * 0.2, area.y + u * 3, area.width * 0.3, u * 4);
      meter.fillStyle(spill > 0.6 ? COLORS.bad : COLORS.accent, 1);
      meter.fillRect(area.x + area.width * 0.2, area.y + u * 3, area.width * 0.3 * spill, u * 4);
      meterLabel.setAlpha(spill > 0 ? 1 : 0.6);

      stickG.clear();
      if (stickOrigin) {
        stickG.lineStyle(3, 0xffffff, 0.4);
        stickG.strokeCircle(stickOrigin.x, stickOrigin.y, TUNING.joystickRadiusU * u);
        stickG.fillStyle(0xffffff, 0.5);
        stickG.fillCircle(stickOrigin.x + stick.x * TUNING.joystickRadiusU * u, stickOrigin.y + stick.y * TUNING.joystickRadiusU * u, u * 5);
      }
    },
    destroy() {
      window.removeEventListener("deviceorientation", onOrient);
    },
  };
};
