// One-shot visual effects: kills (finisher text, star burst, blood spray,
// ragdoll fling), vent pops and hiding-spot searches. All cartoon, all
// short. Positions are in world pixels; effects live in the Game scene so
// the vision fog hides the ones you can't see.

import Phaser from "phaser";
import { PLAYER_RADIUS_PX } from "../../../shared/constants";
import { TEX_BLOOD, TEX_BODY, TEX_SPARK } from "./placeholderSprites";

const EFFECT_DEPTH = 100_000;
const FLING_PX = 70;
const FLING_MS = 650;
const BURST_SPARKS = 10;
const BLOOD_DROPS = 14;

/** Finisher -> big comic text and its colour. */
const FINISHER_TEXT: Record<string, [string, string]> = {
  thwack: ["THWACK!", "#ffe066"],
  bonk: ["BONK!", "#ffb347"],
  splat: ["SPLAT!", "#9be564"],
  strangle: ["GHHKK!", "#ff4d4d"],
  "butt-crush": ["SQUISH!", "#ff9ad5"],
  gas: ["COUGH! COUGH!", "#9be564"],
};

function popText(scene: Phaser.Scene, x: number, y: number, text: string, color: string, size = 26): void {
  const t = scene.add
    .text(x, y, text, {
      fontFamily: "Impact, system-ui, sans-serif",
      fontSize: `${size}px`,
      fontStyle: "bold",
      color,
      stroke: "#000000",
      strokeThickness: 6,
    })
    .setOrigin(0.5)
    .setDepth(EFFECT_DEPTH + 2)
    .setScale(0.2)
    .setAngle(Phaser.Math.Between(-12, 12))
    .setResolution(2);
  scene.tweens.add({ targets: t, scale: 1.2, duration: 160, ease: "Back.Out" });
  scene.tweens.add({ targets: t, y: y - 30, alpha: 0, delay: 600, duration: 500, onComplete: () => t.destroy() });
}

function starBurst(scene: Phaser.Scene, x: number, y: number, tint: number): void {
  for (let i = 0; i < BURST_SPARKS; i++) {
    const a = (i / BURST_SPARKS) * Math.PI * 2 + Math.random() * 0.3;
    const s = scene.add.image(x, y, TEX_SPARK).setTint(tint).setRotation(a).setDepth(EFFECT_DEPTH + 1).setScale(0.6);
    scene.tweens.add({
      targets: s,
      x: x + Math.cos(a) * 40,
      y: y + Math.sin(a) * 40,
      scale: 0.1,
      alpha: 0,
      duration: 380,
      ease: "Cubic.Out",
      onComplete: () => s.destroy(),
    });
  }
}

function bloodSpray(scene: Phaser.Scene, x: number, y: number, angle: number): void {
  for (let i = 0; i < BLOOD_DROPS; i++) {
    const a = angle + Phaser.Math.FloatBetween(-0.8, 0.8);
    const d = Phaser.Math.Between(15, 60);
    const drop = scene.add.image(x, y, TEX_BLOOD).setScale(Phaser.Math.FloatBetween(0.08, 0.2)).setDepth(EFFECT_DEPTH);
    scene.tweens.add({
      targets: drop,
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      duration: 260,
      ease: "Quad.Out",
      onComplete: () => scene.tweens.add({ targets: drop, alpha: 0, delay: 2500, duration: 800, onComplete: () => drop.destroy() }),
    });
  }
}

/** Laal Jhanda: a red cloth whips in and wraps around the victim. */
function redCloth(scene: Phaser.Scene, x: number, y: number, angle: number): void {
  const fromX = x - Math.cos(angle) * 50;
  const fromY = y - Math.sin(angle) * 50;
  const cloth = scene.add.rectangle(fromX, fromY, 34, 8, 0xd0021b).setRotation(angle).setDepth(EFFECT_DEPTH + 1);
  scene.tweens.add({
    targets: cloth,
    x,
    y: y - PLAYER_RADIUS_PX * 0.3,
    rotation: angle + Math.PI * 4,
    duration: 350,
    onComplete: () => scene.tweens.add({ targets: cloth, scaleX: 0.7, alpha: 0, delay: 500, duration: 300, onComplete: () => cloth.destroy() }),
  });
}

/**
 * The victim spins and flies off in `angle`, then `onLanded` runs (the
 * caller shows the body there). Returns immediately.
 */
export function killEffect(
  scene: Phaser.Scene,
  x: number,
  y: number,
  angle: number,
  color: number,
  finisher: string,
  onLanded: () => void,
  /** Builds the spinning ragdoll (defaults to the round blob). */
  makeDoll?: () => Phaser.GameObjects.Container | Phaser.GameObjects.Image,
): void {
  const [text, textColor] = FINISHER_TEXT[finisher] ?? FINISHER_TEXT.thwack;
  if (finisher === "strangle") redCloth(scene, x, y, angle);
  if (finisher === "butt-crush") buttDrop(scene, x, y);
  starBurst(scene, x, y, 0xffffff);
  bloodSpray(scene, x, y, angle);
  popText(scene, x, y - 30, text, textColor);

  // Ragdoll: the victim's blob is launched up and sideways (along `angle`),
  // spinning, and comes down where the body will lie.
  const doll = (makeDoll ? makeDoll() : scene.add.image(x, y, TEX_BODY).setTint(color)).setPosition(x, y).setDepth(EFFECT_DEPTH);
  const side = { x: Math.cos(angle) * FLING_PX * 0.5, y: Math.sin(angle) * FLING_PX * 0.5 };
  scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: FLING_MS,
    onUpdate: (tw) => {
      const p = tw.getValue() ?? 0;
      const out = Math.sin(Math.PI * p); // out and back
      const up = FLING_PX * 4 * p * (1 - p); // parabola
      doll.setPosition(x + side.x * out, y + side.y * out - up).setAngle(720 * p);
    },
    onComplete: () => {
      doll.destroy();
      onLanded();
    },
  });
}

/** Gujju Rapper's finisher: a giant bare bum drops out of the sky onto the victim. */
function buttDrop(scene: Phaser.Scene, x: number, y: number): void {
  const g = scene.add.graphics().setDepth(EFFECT_DEPTH + 1);
  g.fillStyle(0x000000, 1);
  g.fillCircle(-11, 0, 14);
  g.fillCircle(11, 0, 14);
  g.fillStyle(0xd4a017, 1);
  g.fillRect(-26, -26, 52, 16);
  g.fillStyle(0xf2b48c, 1);
  g.fillCircle(-11, 0, 12);
  g.fillCircle(11, 0, 12);
  g.lineStyle(2, 0xc98a66, 1);
  g.lineBetween(0, -8, 0, 10);
  g.setPosition(x, y - 120);
  scene.tweens.add({
    targets: g,
    y,
    duration: 260,
    ease: "Quad.In",
    onComplete: () => {
      scene.tweens.add({ targets: g, scaleY: 0.6, scaleX: 1.25, duration: 90, yoyo: true, repeat: 2 });
      scene.tweens.add({ targets: g, alpha: 0, delay: 700, duration: 300, onComplete: () => g.destroy() });
    },
  });
}

/** Dash: speed lines behind the dasher. */
export function dashEffect(scene: Phaser.Scene, x: number, y: number, angle: number): void {
  for (let i = 0; i < 4; i++) {
    const off = (i - 1.5) * 7;
    const len = 30 + Math.random() * 20;
    const sx = x - Math.cos(angle) * 10 + Math.cos(angle + Math.PI / 2) * off;
    const sy = y - Math.sin(angle) * 10 + Math.sin(angle + Math.PI / 2) * off;
    const line = scene.add
      .line(0, 0, sx, sy, sx - Math.cos(angle) * len, sy - Math.sin(angle) * len, 0xffffff, 0.8)
      .setOrigin(0)
      .setLineWidth(2)
      .setDepth(EFFECT_DEPTH);
    scene.tweens.add({ targets: line, alpha: 0, duration: 400, onComplete: () => line.destroy() });
  }
  popText(scene, x, y - 24, "ZOOM!", "#ffffff", 16);
}

/** Wide swing: a big half-moon swoosh in front of the swinger. */
export function wideSwingEffect(scene: Phaser.Scene, x: number, y: number, angle: number, reachPx: number): void {
  const g = scene.add.graphics().setDepth(EFFECT_DEPTH);
  g.fillStyle(0xffffff, 0.35);
  g.slice(x, y, reachPx, angle - Math.PI / 2, angle + Math.PI / 2, false);
  g.fillPath();
  g.lineStyle(4, 0xffffff, 0.9);
  g.beginPath();
  g.arc(x, y, reachPx, angle - Math.PI / 2, angle + Math.PI / 2, false);
  g.strokePath();
  scene.tweens.add({ targets: g, alpha: 0, duration: 450, onComplete: () => g.destroy() });
  popText(scene, x, y - 34, "WHOOSH!", "#ffb347", 22);
}

export function shieldEffect(scene: Phaser.Scene, x: number, y: number): void {
  const ring = scene.add.circle(x, y, PLAYER_RADIUS_PX, 0x7fdbff, 0.3).setStrokeStyle(3, 0x7fdbff).setDepth(EFFECT_DEPTH);
  scene.tweens.add({ targets: ring, radius: PLAYER_RADIUS_PX * 3, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
  popText(scene, x, y - 26, "SHIELD!", "#7fdbff", 16);
}

/** Beat drop: shockwave rings and flying music notes. */
export function beatEffect(scene: Phaser.Scene, x: number, y: number, radius: number): void {
  for (let i = 0; i < 3; i++) {
    const ring = scene.add.circle(x, y, 8, 0xff9ad5, 0).setStrokeStyle(4, 0xff9ad5, 0.9).setDepth(EFFECT_DEPTH);
    scene.tweens.add({ targets: ring, radius, alpha: 0, delay: i * 180, duration: 600, onComplete: () => ring.destroy() });
  }
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const note = scene.add.text(x, y, Math.random() < 0.5 ? "♪" : "♫", { fontSize: "20px", color: "#ff9ad5" }).setOrigin(0.5).setDepth(EFFECT_DEPTH + 1);
    scene.tweens.add({ targets: note, x: x + Math.cos(a) * radius * 0.8, y: y + Math.sin(a) * radius * 0.8, alpha: 0, duration: 900, onComplete: () => note.destroy() });
  }
  popText(scene, x, y - 40, "DROP THE BEAT!", "#ff9ad5", 24);
}

export function reviveEffect(scene: Phaser.Scene, x: number, y: number): void {
  const halo = scene.add.ellipse(x, y - PLAYER_RADIUS_PX - 6, 26, 8, 0x000000, 0).setStrokeStyle(3, 0xffe066).setDepth(EFFECT_DEPTH);
  scene.tweens.add({ targets: halo, y: halo.y - 20, alpha: 0, duration: 1200, onComplete: () => halo.destroy() });
  starBurst(scene, x, y, 0xffe066);
  popText(scene, x, y - 30, "REVIVED!", "#ffe066", 22);
}

/** The warden's flashlight caught someone. */
export function wardenStunEffect(scene: Phaser.Scene, x: number, y: number): void {
  popText(scene, x, y - 30, "HALT!! 🔦", "#7fdbff", 20);
}

/** Your task got ticked off: a little "+1" above your head. */
export function taskDoneEffect(scene: Phaser.Scene, x: number, y: number): void {
  popText(scene, x, y - 34, "TASK DONE ✓", "#9be564", 16);
}

export function gujjuAwakeEffect(scene: Phaser.Scene, x: number, y: number): void {
  popText(scene, x, y - 46, "KAUN HAI BEY?!", "#ff4d4d", 20);
}

export function ventPopEffect(scene: Phaser.Scene, x: number, y: number): void {
  starBurst(scene, x, y, 0x9aa4b2);
  popText(scene, x, y - 20, "POP!", "#cfd8dc", 20);
  const ring = scene.add.circle(x, y, 6, 0x000000, 0).setStrokeStyle(3, 0xcfd8dc).setDepth(EFFECT_DEPTH);
  scene.tweens.add({ targets: ring, radius: 26, alpha: 0, duration: 400, onComplete: () => ring.destroy() });
}

export function searchEffect(scene: Phaser.Scene, x: number, y: number, found: boolean): void {
  popText(scene, x, y - 22, found ? "FOUND YOU!" : "*rummage*", found ? "#ff4d4d" : "#cccccc", found ? 22 : 16);
}
