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
): void {
  const [text, textColor] = FINISHER_TEXT[finisher] ?? FINISHER_TEXT.thwack;
  if (finisher === "strangle") redCloth(scene, x, y, angle);
  starBurst(scene, x, y, 0xffffff);
  bloodSpray(scene, x, y, angle);
  popText(scene, x, y - 30, text, textColor);

  // Ragdoll: the victim's blob is launched up and sideways (along `angle`),
  // spinning, and comes down where the body will lie.
  const doll = scene.add.image(x, y, TEX_BODY).setTint(color).setDepth(EFFECT_DEPTH);
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

export function ventPopEffect(scene: Phaser.Scene, x: number, y: number): void {
  starBurst(scene, x, y, 0x9aa4b2);
  popText(scene, x, y - 20, "POP!", "#cfd8dc", 20);
  const ring = scene.add.circle(x, y, 6, 0x000000, 0).setStrokeStyle(3, 0xcfd8dc).setDepth(EFFECT_DEPTH);
  scene.tweens.add({ targets: ring, radius: 26, alpha: 0, duration: 400, onComplete: () => ring.destroy() });
}

export function searchEffect(scene: Phaser.Scene, x: number, y: number, found: boolean): void {
  popText(scene, x, y - 22, found ? "FOUND YOU!" : "*rummage*", found ? "#ff4d4d" : "#cccccc", found ? 22 : 16);
}
