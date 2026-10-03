// Face photos: each player can put their own photo on their character.
//
//   photoToFace(file)       camera/gallery image -> small square JPEG data URL
//                           (centre-cropped a little above the middle, where
//                           faces usually are in a selfie), FACE_SIZE_PX wide.
//   ensureFaceTexture(...)  data URL -> round Phaser texture with an outline,
//                           cached, ready for drawing on a character's head.
//
// The photo is remembered on this phone (localStorage) for next time.

import type Phaser from "phaser";
import { FACE_JPEG_QUALITY, FACE_MAX_CHARS, FACE_SIZE_PX } from "../../shared/constants";

const STORAGE_KEY = "hostel.face";
/** Part of the shorter side used for the crop (a bit of zoom-in on the face). */
const CROP_FRACTION = 0.85;
/** Vertical centre of the crop as a fraction of the photo height (selfies have faces high up). */
const CROP_CENTER_Y = 0.45;
const OUTLINE_PX = 4;
const OUTLINE_COLOR = "#2b1d14";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = src;
  });
}

/** Crop + shrink a photo to a small JPEG data URL that fits the server's limit. */
export async function photoToFace(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.naturalWidth, img.naturalHeight) * CROP_FRACTION;
    const sx = (img.naturalWidth - side) / 2;
    const sy = Math.min(Math.max(img.naturalHeight * CROP_CENTER_Y - side / 2, 0), img.naturalHeight - side);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = FACE_SIZE_PX;
    canvas.getContext("2d")!.drawImage(img, sx, sy, side, side, 0, 0, FACE_SIZE_PX, FACE_SIZE_PX);
    for (let q = FACE_JPEG_QUALITY; q > 0.2; q -= 0.15) {
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length <= FACE_MAX_CHARS) return data;
    }
    throw new Error("That photo is too detailed; try another one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function savedFace(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveFace(data: string): void {
  try {
    if (data) localStorage.setItem(STORAGE_KEY, data);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the face just isn't remembered.
  }
}

/** Short stable id for a data URL (texture key). */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function faceTextureKey(data: string): string {
  return `face-${hash(data)}`;
}

const pending = new Map<string, Promise<string>>();

/**
 * Resolve with the key of a round, outlined texture made from the photo.
 * Built once per photo and shared by every scene (Phaser textures are global).
 */
export function ensureFaceTexture(scene: Phaser.Scene, data: string): Promise<string> {
  const key = faceTextureKey(data);
  if (scene.textures.exists(key)) return Promise.resolve(key);
  let p = pending.get(key);
  if (!p) {
    p = loadImage(data).then((img) => {
      if (scene.textures.exists(key)) return key;
      const size = FACE_SIZE_PX + OUTLINE_PX * 2;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, FACE_SIZE_PX / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, OUTLINE_PX, OUTLINE_PX, FACE_SIZE_PX, FACE_SIZE_PX);
      ctx.restore();
      ctx.lineWidth = OUTLINE_PX;
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, FACE_SIZE_PX / 2, 0, Math.PI * 2);
      ctx.stroke();
      scene.textures.addCanvas(key, canvas);
      return key;
    });
    pending.set(key, p);
    p.catch(() => pending.delete(key));
  }
  return p;
}
