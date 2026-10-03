// Draws a collision grid as gray-box rectangles: floor, walls, a light tile
// grid, and room labels. Phase 2 feeds this the generated hostel floors.

import Phaser from "phaser";
import type { CollisionGrid, Vec2 } from "../../../shared/types";
import { PLAYER_RADIUS_PX } from "../../../shared/constants";

const COLOR_FLOOR = 0x3b3548;
const COLOR_GRID = 0x463f55;
const COLOR_WALL = 0x1d1a26;
const COLOR_WALL_EDGE = 0x6b5f80;
const COLOR_SPAWN = 0xf4c430;
const SPAWN_MARKER_ALPHA = 0.25;
const LABEL_FONT_PX = 28;

export interface MapLabel {
  text: string;
  x: number;
  y: number;
}

export function renderMap(
  scene: Phaser.Scene,
  grid: CollisionGrid,
  labels: MapLabel[] = [],
  spawns: Vec2[] = [],
): Phaser.GameObjects.Container {
  const ts = grid.tileSize;
  const g = scene.add.graphics();

  g.fillStyle(COLOR_FLOOR, 1);
  g.fillRect(0, 0, grid.width * ts, grid.height * ts);

  g.lineStyle(1, COLOR_GRID, 1);
  for (let x = 0; x <= grid.width; x++) g.lineBetween(x * ts, 0, x * ts, grid.height * ts);
  for (let y = 0; y <= grid.height; y++) g.lineBetween(0, y * ts, grid.width * ts, y * ts);

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.solid[y * grid.width + x] !== 1) continue;
      g.fillStyle(COLOR_WALL, 1);
      g.fillRect(x * ts, y * ts, ts, ts);
      g.lineStyle(2, COLOR_WALL_EDGE, 1);
      g.strokeRect(x * ts + 1, y * ts + 1, ts - 2, ts - 2);
    }
  }

  g.fillStyle(COLOR_SPAWN, SPAWN_MARKER_ALPHA);
  for (const s of spawns) g.fillCircle(s.x, s.y, PLAYER_RADIUS_PX + 2);

  const children: Phaser.GameObjects.GameObject[] = [g];
  for (const l of labels) {
    children.push(
      scene.add
        .text(l.x, l.y, l.text, {
          fontFamily: "system-ui, sans-serif",
          fontSize: `${LABEL_FONT_PX}px`,
          fontStyle: "bold",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setAlpha(0.18),
    );
  }
  return scene.add.container(0, 0, children);
}
