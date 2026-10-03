// Animated chibi characters from the sprite sheets in client/public/sprites/
// (layout described in sprites.json and README.md there).
//
// Players use TWO layers drawn on top of each other:
//   shirt   white/grey art, tinted with the player's colour
//   details everything else (skin, face, hair, shorts...), never tinted
// so everyone is the same character in a different shirt: killers can't be
// told apart by their sprite. NPCs use a single full-colour sheet.
//
// If a sheet fails to load, the game falls back to the old round blobs.

import Phaser from "phaser";
import {
  BLINK_MAX_MS,
  BLINK_MIN_MS,
  BLINK_MS,
  CHARACTER_SPRITE_SCALE,
  PLAYER_RADIUS_PX,
  SPRITE_SVG_RENDER_SCALE,
  WALK_FPS,
} from "../../../shared/constants";

const MANIFEST_KEY = "sprites-manifest";
const BASE_URL = "sprites/";

export const SHEET_PLAYER_SHIRT = "sheet-player-shirt";
export const SHEET_PLAYER_DETAILS = "sheet-player-details";
export const npcSheetKey = (kind: string) => `sheet-npc-${kind}`;

interface Manifest {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  feetY: number;
  headTopY: number;
  player: { shirt: string; details: string };
  npcs: Record<string, string>;
}

/** Rows and columns of every sheet (see README.md). */
const ROW = { down: 0, side: 1, up: 2, special: 3 } as const;
const COL = { idle: 0, blink: 1, walk0: 2 } as const;
const WALK_FRAMES = 4;
const SPECIAL = { stunned: 0, dead: 1 } as const;
/** Below this many px per frame of movement a character counts as standing still. */
const MOVING_EPSILON_PX = 0.15;
/** Stay in the walk animation this long after the last movement (smooths network jitter). */
const WALK_LINGER_MS = 120;
/** Feet sit this far below the collision-circle centre. */
const FEET_OFFSET_PX = PLAYER_RADIUS_PX * 0.6;

let manifest: Manifest | null = null;
/** Per texture key: how many texture pixels per sheet pixel (2 for a 2x SVG render). */
const textureScale = new Map<string, number>();

/** Boot.preload(): queue the manifest, then every sheet it lists. */
export function loadCharacterSheets(scene: Phaser.Scene): void {
  scene.load.json(MANIFEST_KEY, `${BASE_URL}sprites.json`);
  scene.load.once(`filecomplete-json-${MANIFEST_KEY}`, (_key: string, _type: string, data: Manifest) => {
    const queue = (key: string, file: string) => {
      const url = BASE_URL + file;
      if (file.toLowerCase().endsWith(".svg")) scene.load.svg(key, url, { scale: SPRITE_SVG_RENDER_SCALE });
      else scene.load.image(key, url);
    };
    queue(SHEET_PLAYER_SHIRT, data.player.shirt);
    queue(SHEET_PLAYER_DETAILS, data.player.details);
    for (const [kind, file] of Object.entries(data.npcs)) queue(npcSheetKey(kind), file);
  });
}

/** Boot.create(): cut every loaded sheet into named frames "row-col". */
export function registerCharacterFrames(scene: Phaser.Scene): void {
  const data = scene.cache.json.get(MANIFEST_KEY) as Manifest | undefined;
  if (!data) return;
  manifest = data;
  const keys = [SHEET_PLAYER_SHIRT, SHEET_PLAYER_DETAILS, ...Object.keys(data.npcs).map(npcSheetKey)];
  for (const key of keys) {
    if (!scene.textures.exists(key)) continue;
    const tex = scene.textures.get(key);
    const src = tex.getSourceImage() as { width: number };
    const s = src.width / (data.columns * data.frameWidth);
    textureScale.set(key, s);
    for (let r = 0; r < data.rows; r++) {
      for (let c = 0; c < data.columns; c++) {
        tex.add(`${r}-${c}`, 0, c * data.frameWidth * s, r * data.frameHeight * s, data.frameWidth * s, data.frameHeight * s);
      }
    }
  }
}

export function hasPlayerSprites(scene: Phaser.Scene): boolean {
  return !!manifest && scene.textures.exists(SHEET_PLAYER_SHIRT) && scene.textures.exists(SHEET_PLAYER_DETAILS);
}

export function hasNpcSprite(scene: Phaser.Scene, kind: string): boolean {
  return !!manifest && scene.textures.exists(npcSheetKey(kind));
}

/** Where to hang labels, bubbles and stars relative to a character's position. */
export function characterMetrics(spritesOn: boolean): { headTop: number; bodyCenter: number; bodyRadius: number } {
  if (!spritesOn || !manifest) return { headTop: -PLAYER_RADIUS_PX, bodyCenter: 0, bodyRadius: PLAYER_RADIUS_PX + 6 };
  const height = (manifest.feetY - manifest.headTopY) * CHARACTER_SPRITE_SCALE;
  return { headTop: FEET_OFFSET_PX - height, bodyCenter: FEET_OFFSET_PX - height / 2, bodyRadius: height / 2 + 4 };
}

/** One image of a sheet, scaled and anchored at the feet. */
function makeLayer(scene: Phaser.Scene, key: string, frame: string): Phaser.GameObjects.Image {
  const m = manifest!;
  const s = textureScale.get(key) ?? 1;
  return scene.add
    .image(0, FEET_OFFSET_PX, key, frame)
    .setOrigin(0.5, m.feetY / m.frameHeight)
    .setScale(CHARACTER_SPRITE_SCALE / s);
}

/**
 * The animated part of a character. Call update() every frame with the
 * container's position; it works out walking vs idle and the direction from
 * how the position changed.
 */
export class CharacterRig {
  readonly layers: Phaser.GameObjects.Image[];
  /** The layer that takes the player's colour (null for NPCs). */
  readonly tinted: Phaser.GameObjects.Image | null;
  private row: number = ROW.down;
  private flip = false;
  private walkMs = 0;
  private lastMoveAt = -Infinity;
  private lastX = NaN;
  private lastY = NaN;
  private nextBlinkAt = performance.now() + Phaser.Math.Between(BLINK_MIN_MS, BLINK_MAX_MS);
  private lastFrameAt = performance.now();

  constructor(scene: Phaser.Scene, keys: string[], tintKey: string | null) {
    this.layers = keys.map((k) => makeLayer(scene, k, `${ROW.down}-${COL.idle}`));
    this.tinted = tintKey ? this.layers[keys.indexOf(tintKey)] ?? null : null;
  }

  /** Point the character a given way (radians), e.g. the warden's flashlight direction. */
  face(angle: number): void {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    this.setDirection(dx, dy);
  }

  private setDirection(dx: number, dy: number): void {
    if (Math.abs(dx) > Math.abs(dy)) {
      this.row = ROW.side;
      this.flip = dx > 0; // the side frames face left
    } else {
      this.row = dy < 0 ? ROW.up : ROW.down;
      this.flip = false;
    }
  }

  update(x: number, y: number, stunned: boolean, speedMultiplier = 1): void {
    const now = performance.now();
    const dt = Math.min(now - this.lastFrameAt, 100);
    this.lastFrameAt = now;
    const dx = Number.isNaN(this.lastX) ? 0 : x - this.lastX;
    const dy = Number.isNaN(this.lastY) ? 0 : y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    if (Math.abs(dx) + Math.abs(dy) > MOVING_EPSILON_PX) {
      this.lastMoveAt = now;
      this.setDirection(dx, dy);
    }
    const walking = now - this.lastMoveAt < WALK_LINGER_MS;

    let frame: string;
    if (stunned) {
      frame = `${ROW.special}-${SPECIAL.stunned}`;
    } else if (walking) {
      this.walkMs += dt * speedMultiplier;
      const i = Math.floor((this.walkMs / 1000) * WALK_FPS) % WALK_FRAMES;
      frame = `${this.row}-${COL.walk0 + i}`;
    } else {
      if (now > this.nextBlinkAt + BLINK_MS) this.nextBlinkAt = now + Phaser.Math.Between(BLINK_MIN_MS, BLINK_MAX_MS);
      const blinking = now >= this.nextBlinkAt && now < this.nextBlinkAt + BLINK_MS;
      frame = `${this.row}-${blinking ? COL.blink : COL.idle}`;
    }
    const flip = stunned ? false : this.flip;
    for (const layer of this.layers) layer.setFrame(frame).setFlipX(flip);
  }
}

/** Player rig: tinted shirt + untinted details. */
export function createPlayerRig(scene: Phaser.Scene, color: number): CharacterRig {
  const rig = new CharacterRig(scene, [SHEET_PLAYER_SHIRT, SHEET_PLAYER_DETAILS], SHEET_PLAYER_SHIRT);
  rig.tinted?.setTint(color);
  return rig;
}

export function createNpcRig(scene: Phaser.Scene, kind: string): CharacterRig {
  return new CharacterRig(scene, [npcSheetKey(kind)], null);
}

/** A body lying on the floor: the "dead" frame of each layer. */
export function createDeadLayers(scene: Phaser.Scene, color: number): Phaser.GameObjects.Image[] {
  const frame = `${ROW.special}-${SPECIAL.dead}`;
  const shirt = makeLayer(scene, SHEET_PLAYER_SHIRT, frame).setTint(color);
  const details = makeLayer(scene, SHEET_PLAYER_DETAILS, frame);
  return [shirt, details];
}

/** The stunned frame of both layers (used as the spinning ragdoll when someone is killed). */
export function createRagdollLayers(scene: Phaser.Scene, color: number): Phaser.GameObjects.Image[] {
  const frame = `${ROW.special}-${SPECIAL.stunned}`;
  const shirt = makeLayer(scene, SHEET_PLAYER_SHIRT, frame).setTint(color);
  const details = makeLayer(scene, SHEET_PLAYER_DETAILS, frame);
  // Spin around the middle of the body rather than the feet.
  for (const l of [shirt, details]) l.setOrigin(0.5, 0.5).setY(0);
  return [shirt, details];
}
