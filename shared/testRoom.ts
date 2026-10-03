// Phase 1 placeholder world: one empty rectangular room with walls around the
// edge, plus a 5x4 spawn grid in the middle. Phase 2 replaces this with the
// hostel floors generated from layout.json.

import {
  SPAWN_GRID_COLS,
  SPAWN_GRID_ROWS,
  SPAWN_GRID_SPACING_TILES,
  TEST_ROOM_HEIGHT_TILES,
  TEST_ROOM_WIDTH_TILES,
  TILE_SIZE,
} from "./constants";
import type { CollisionGrid, Vec2 } from "./types";

export function buildTestRoom(): CollisionGrid {
  const width = TEST_ROOM_WIDTH_TILES;
  const height = TEST_ROOM_HEIGHT_TILES;
  const solid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      solid[y * width + x] = edge ? 1 : 0;
    }
  }
  return { width, height, tileSize: TILE_SIZE, solid };
}

/** Pixel centres of the spawn markers, centred in the test room. */
export function testRoomSpawns(): Vec2[] {
  const spacing = SPAWN_GRID_SPACING_TILES * TILE_SIZE;
  const centreX = (TEST_ROOM_WIDTH_TILES * TILE_SIZE) / 2;
  const centreY = (TEST_ROOM_HEIGHT_TILES * TILE_SIZE) / 2;
  const originX = centreX - ((SPAWN_GRID_COLS - 1) * spacing) / 2;
  const originY = centreY - ((SPAWN_GRID_ROWS - 1) * spacing) / 2;
  const spawns: Vec2[] = [];
  for (let row = 0; row < SPAWN_GRID_ROWS; row++) {
    for (let col = 0; col < SPAWN_GRID_COLS; col++) {
      spawns.push({ x: originX + col * spacing, y: originY + row * spacing });
    }
  }
  return spawns;
}
