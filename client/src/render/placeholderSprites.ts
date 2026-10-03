// Character views. With the sprite sheets in client/public/sprites/ loaded,
// players are animated chibi students (see characterSprites.ts); otherwise
// they fall back to the gray-box blobs generated here at runtime.
// Every player uses the SAME art tinted with their colour: a killer is drawn
// exactly like everyone else.

import Phaser from "phaser";
import { PLAYER_RADIUS_PX } from "../../../shared/constants";
import {
  CharacterRig,
  characterMetrics,
  createDeadLayers,
  createNpcRig,
  createPlayerRig,
  hasNpcSprite,
  hasPlayerSprites,
} from "./characterSprites";

export const TEX_BODY = "body";
export const TEX_SHADOW = "shadow";
export const TEX_CORPSE = "corpse";
export const TEX_CORPSE_DETAIL = "corpse-detail";
export const TEX_BLOOD = "blood";
export const TEX_SPARK = "spark";

const SKIN = 0xf2b48c;
const SKIN_DARK = 0xc98a66;
const BLOOD = 0xb0001a;
const BLOOD_DARK = 0x6e0010;

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
  g.clear();

  // Corpse: the body squashed flat (white, takes the player's tint).
  const cw = size * 1.5;
  const ch = size * 0.75;
  g.fillStyle(0x000000, 1);
  g.fillEllipse(cw / 2, ch / 2, cw, ch);
  g.fillStyle(0xffffff, 1);
  g.fillEllipse(cw / 2, ch / 2, cw - OUTLINE_PX * 2, ch - OUTLINE_PX * 2);
  g.generateTexture(TEX_CORPSE, cw, ch);
  g.clear();

  // Corpse details (not tinted): X-eyes on the left end, and the bare bum
  // sticking up on the right end, pants gone.
  const dh = ch * 1.6;
  const by = dh * 0.42;
  g.lineStyle(3, 0x000000, 1);
  const ex = cw * 0.22;
  const ey = dh - ch / 2 - 2;
  for (const off of [-5, 5]) {
    g.lineBetween(ex + off - 3, ey - 3, ex + off + 3, ey + 3);
    g.lineBetween(ex + off - 3, ey + 3, ex + off + 3, ey - 3);
  }
  g.fillStyle(0x000000, 1);
  g.fillCircle(cw * 0.66, by, 9);
  g.fillCircle(cw * 0.8, by, 9);
  g.fillStyle(SKIN, 1);
  g.fillCircle(cw * 0.66, by, 7.5);
  g.fillCircle(cw * 0.8, by, 7.5);
  g.lineStyle(2, SKIN_DARK, 1);
  g.lineBetween(cw * 0.73, by - 6, cw * 0.73, by + 6);
  g.fillStyle(0xffffff, 0.7);
  g.fillCircle(cw * 0.63, by - 3, 2);
  g.generateTexture(TEX_CORPSE_DETAIL, cw, dh);
  g.clear();

  // Blood pool: a few overlapping blobs and drips.
  const bs = size * 2.2;
  g.fillStyle(BLOOD_DARK, 0.9);
  g.fillEllipse(bs / 2, bs / 2, bs * 0.9, bs * 0.55);
  g.fillStyle(BLOOD, 0.95);
  g.fillEllipse(bs / 2 - 4, bs / 2 - 2, bs * 0.75, bs * 0.45);
  for (const [dx, dy, r] of [[-0.42, -0.2, 4], [0.4, 0.15, 5], [0.3, -0.28, 3], [-0.3, 0.26, 3.5], [0.46, -0.05, 2.5]]) {
    g.fillCircle(bs / 2 + dx * bs, bs / 2 + dy * bs, r);
  }
  g.generateTexture(TEX_BLOOD, bs, bs);
  g.clear();

  // Spark for the star burst.
  g.fillStyle(0xffffff, 1);
  g.fillTriangle(0, 6, 16, 4, 16, 8);
  g.fillTriangle(16, 4, 32, 6, 16, 8);
  g.generateTexture(TEX_SPARK, 32, 12);
  g.destroy();
}

/** The Gujju Rapper: gold blob with a mic and a speech bubble. Everyone knows who he is. */
export function createGujjuView(scene: Phaser.Scene, name: string): PlayerView & { speech: Phaser.GameObjects.Text } {
  const view = createPlayerView(scene, `🎤 ${name}`, 0xd4a017, false, "gujju");
  view.label.setColor("#ffd54f");
  const speech = scene.add
    .text(0, view.label.y - LABEL_FONT_PX - 4, "", {
      fontFamily: "system-ui, sans-serif",
      fontSize: `${LABEL_FONT_PX}px`,
      fontStyle: "bold",
      color: "#000000",
      backgroundColor: "#ffffff",
      padding: { x: 4, y: 2 },
    })
    .setOrigin(0.5, 1)
    .setResolution(2);
  view.container.add(speech);
  return { ...view, speech };
}

/** The warden: navy uniform, cap, whistle. */
export function createWardenView(scene: Phaser.Scene): PlayerView {
  const view = createPlayerView(scene, "👮 WARDEN", 0x1f3a93, false, "warden");
  view.label.setColor("#7fdbff");
  if (!view.rig) {
    const cap = scene.add.graphics();
    cap.fillStyle(0x0b1a4a, 1);
    cap.fillRect(-PLAYER_RADIUS_PX * 0.8, -PLAYER_RADIUS_PX - 2, PLAYER_RADIUS_PX * 1.6, 6);
    cap.fillRect(-PLAYER_RADIUS_PX * 0.2, -PLAYER_RADIUS_PX - 2, PLAYER_RADIUS_PX * 1.2, 3);
    view.container.addAt(cap, 3);
  }
  return view;
}

/**
 * A body on the floor: blood pool, the body lying face-down with X-eyes and
 * its bare bum up. faceKey: the victim's face photo texture, if loaded.
 */
export function createCorpseView(scene: Phaser.Scene, color: number, faceKey?: string): Phaser.GameObjects.Container {
  const blood = scene.add.image(0, 2, TEX_BLOOD).setAngle(Phaser.Math.Between(0, 359));
  if (hasPlayerSprites(scene)) {
    return scene.add.container(0, 0, [blood.setScale(1.4), ...createDeadLayers(scene, color, faceKey)]);
  }
  const flat = scene.add.image(0, 0, TEX_CORPSE).setTint(color);
  const detail = scene.add.image(0, -PLAYER_RADIUS_PX * 0.45, TEX_CORPSE_DETAIL);
  return scene.add.container(0, 0, [blood, flat, detail]);
}

export interface PlayerView {
  container: Phaser.GameObjects.Container;
  /** The coloured part (blob, or the shirt layer of the sprite). */
  body: Phaser.GameObjects.Image;
  /** Animated sprite (null when falling back to blobs). Call rig.update() every frame. */
  rig: CharacterRig | null;
  label: Phaser.GameObjects.Text;
  /** Shield / spawn-protection bubble. */
  bubble: Phaser.GameObjects.Arc;
  /** Spinning stars while stunned. */
  stars: Phaser.GameObjects.Text;
}

const BUBBLE_COLOR = 0x7fdbff;

/** Name label font size in world pixels. */
const LABEL_FONT_PX = 12;
/** Gap between the top of the body and the name label. */
const LABEL_GAP_PX = 4;

export function createPlayerView(
  scene: Phaser.Scene,
  name: string,
  color: number,
  isLocal: boolean,
  npcKind?: string,
): PlayerView {
  const rig = npcKind
    ? hasNpcSprite(scene, npcKind) ? createNpcRig(scene, npcKind) : null
    : hasPlayerSprites(scene) ? createPlayerRig(scene, color) : null;
  const m = characterMetrics(!!rig);
  const shadow = scene.add.image(0, PLAYER_RADIUS_PX * 0.9, TEX_SHADOW).setScale(rig ? 1.5 : 1, rig ? 1.2 : 1);
  const body = rig ? rig.tinted ?? rig.layers[0] : scene.add.image(0, 0, TEX_BODY).setTint(color);
  const label = scene.add
    .text(0, m.headTop - LABEL_GAP_PX, name, {
      fontFamily: "system-ui, sans-serif",
      fontSize: `${LABEL_FONT_PX}px`,
      fontStyle: "bold",
      color: isLocal ? "#ffe066" : "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    })
    .setOrigin(0.5, 1)
    .setResolution(Math.max(2, window.devicePixelRatio * 2));
  const bubble = scene.add
    .circle(0, m.bodyCenter, m.bodyRadius, BUBBLE_COLOR, 0.15)
    .setStrokeStyle(2, BUBBLE_COLOR, 0.85)
    .setVisible(false);
  const stars = scene.add
    .text(0, m.headTop - LABEL_GAP_PX - LABEL_FONT_PX - 2, "💫 💫", { fontSize: `${LABEL_FONT_PX}px` })
    .setOrigin(0.5, 1)
    .setVisible(false);
  scene.tweens.add({ targets: stars, angle: 360, duration: 900, repeat: -1 });
  const art = rig ? rig.layers : [body];
  const container = scene.add.container(0, 0, [shadow, bubble, ...art, label, stars]);
  return { container, body, rig, label, bubble, stars };
}
