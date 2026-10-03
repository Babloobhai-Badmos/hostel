// Gray-box art generated at runtime, so no image files are needed.
// Every player uses the SAME body texture tinted with their colour: a killer
// is drawn exactly like everyone else.

import Phaser from "phaser";
import { PLAYER_RADIUS_PX } from "../../../shared/constants";

export const TEX_BODY = "body";
export const TEX_SHADOW = "shadow";

/** Outline thickness of the body circle, in pixels. */
const OUTLINE_PX = 3;

export function createPlaceholderTextures(scene: Phaser.Scene): void {
  const size = (PLAYER_RADIUS_PX + OUTLINE_PX) * 2;
  const centre = size / 2;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  // Body: white disc with a black outline. White takes the tint; black stays black.
  g.fillStyle(0x000000, 1);
  g.fillCircle(centre, centre, PLAYER_RADIUS_PX + OUTLINE_PX);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(centre, centre, PLAYER_RADIUS_PX);
  // A little shine so it reads as a cartoon blob.
  g.fillStyle(0xffffff, 0.6);
  g.fillCircle(centre - PLAYER_RADIUS_PX * 0.35, centre - PLAYER_RADIUS_PX * 0.35, PLAYER_RADIUS_PX * 0.25);
  g.generateTexture(TEX_BODY, size, size);
  g.clear();

  // Soft shadow under the feet.
  g.fillStyle(0x000000, 0.35);
  g.fillEllipse(centre, centre, size, size * 0.45);
  g.generateTexture(TEX_SHADOW, size, size);
  g.destroy();
}

export interface PlayerView {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

/** Name label font size in world pixels. */
const LABEL_FONT_PX = 12;
/** Gap between the top of the body and the name label. */
const LABEL_GAP_PX = 4;

export function createPlayerView(
  scene: Phaser.Scene,
  name: string,
  color: number,
  isLocal: boolean,
): PlayerView {
  const shadow = scene.add.image(0, PLAYER_RADIUS_PX * 0.9, TEX_SHADOW);
  const body = scene.add.image(0, 0, TEX_BODY).setTint(color);
  const label = scene.add
    .text(0, -PLAYER_RADIUS_PX - LABEL_GAP_PX, name, {
      fontFamily: "system-ui, sans-serif",
      fontSize: `${LABEL_FONT_PX}px`,
      fontStyle: "bold",
      color: isLocal ? "#ffe066" : "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5, 1)
    .setResolution(Math.max(2, window.devicePixelRatio * 2));
  const container = scene.add.container(0, 0, [shadow, body, label]);
  return { container, body, label };
}
