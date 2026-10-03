// Contract between the Minigame scene and each minigame file.
//
// A minigame builds its objects in `ctx.scene` inside `ctx.area` (screen
// pixels), listens to pointer/keyboard input on that scene, and calls
// `ctx.complete()` once when the player succeeds. Everything it creates is
// destroyed when the scene closes, so most games need no cleanup.

import type Phaser from "phaser";

export interface MinigameContext {
  scene: Phaser.Scene;
  /** Play area in screen pixels (below the title bar). */
  area: Phaser.Geom.Rectangle;
  /** 1% of the area's smaller side: size everything in these units so it fits any screen. */
  u: number;
  /** One-line instruction / status under the title. */
  setStatus(text: string): void;
  /** Call once on success. */
  complete(): void;
}

export interface Minigame {
  /** Called every frame with seconds since the last frame. */
  update?(dt: number): void;
  /** Called when the minigame closes (only needed for listeners outside the scene, e.g. window). */
  destroy?(): void;
}

export type MinigameFactory = (ctx: MinigameContext) => Minigame;
