// Mota-dalla's gas cloud: swirling green puffs that fill the space around
// him but stop at walls and closed doors (the same rule the server uses to
// decide who it kills).

import Phaser from "phaser";
import { TILE_SIZE } from "../../../shared/constants";
import { castRay } from "../../../shared/physics";
import type { CollisionGrid } from "../../../shared/types";

const GAS_COLOR = 0x7cb342;
const GAS_DARK = 0x4e7d24;
const RAYS = 120;
/** Rays poke this far into walls so the cloud visibly touches them. */
const WALL_PEEK_PX = 6;

export interface GasCloud {
  obj: Phaser.GameObjects.Container;
  destroy(): void;
}

export function createGasCloud(scene: Phaser.Scene, x: number, y: number, radius: number, grid: CollisionGrid): GasCloud {
  const shape: Phaser.Types.Math.Vector2Like[] = [];
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2;
    const d = Math.min(radius, castRay(grid, x, y, a, radius) + WALL_PEEK_PX);
    shape.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d });
  }
  const maskShape = scene.make.graphics({ x: 0, y: 0 }, false);
  maskShape.fillStyle(0xffffff, 1);
  maskShape.fillPoints(shape, true);

  const haze = scene.add.graphics();
  haze.fillStyle(GAS_COLOR, 0.28);
  haze.fillPoints(shape, true);
  haze.lineStyle(3, GAS_DARK, 0.5);
  haze.strokePoints(shape, true);

  // Puffs scattered through the reachable area, each drifting and breathing.
  const puffs: Phaser.GameObjects.Arc[] = [];
  const count = Phaser.Math.Clamp(Math.round((radius / TILE_SIZE) * 6), 8, 70);
  for (let i = 0; i < count; i++) {
    const p = shape[Math.floor(Math.random() * shape.length)];
    const t = Math.sqrt(Math.random());
    const px = x + (p.x! - x) * t;
    const py = y + (p.y! - y) * t;
    const r = TILE_SIZE * (0.6 + Math.random() * 1.2);
    const puff = scene.add.circle(px, py, r, i % 3 === 0 ? GAS_DARK : GAS_COLOR, 0.22 + Math.random() * 0.15);
    scene.tweens.add({
      targets: puff,
      x: px + (Math.random() - 0.5) * TILE_SIZE * 2,
      y: py + (Math.random() - 0.5) * TILE_SIZE * 2,
      scale: 1.25 + Math.random() * 0.4,
      alpha: 0.12,
      duration: 900 + Math.random() * 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    puffs.push(puff);
  }
  const cloud = scene.add.container(0, 0, puffs);
  cloud.setMask(maskShape.createGeometryMask());
  const obj = scene.add.container(0, 0, [haze, cloud]).setDepth(y + TILE_SIZE).setAlpha(0);
  scene.tweens.add({ targets: obj, alpha: 1, duration: 250 });
  return {
    obj,
    destroy: () => {
      scene.tweens.killTweensOf(puffs);
      scene.tweens.add({
        targets: obj,
        alpha: 0,
        duration: 350,
        onComplete: () => {
          obj.destroy();
          maskShape.destroy();
        },
      });
    },
  };
}
