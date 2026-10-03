// Small Canvas 2D helpers shared by the floor and furniture painters.
// Everything is drawn in world pixels; the canvas itself is FLOOR_ART_SCALE
// times bigger (the context is pre-scaled), so art stays sharp when zoomed.

export type Ctx = CanvasRenderingContext2D;
export type Paint = string | CanvasGradient | CanvasPattern;

/** Deterministic random numbers, so every phone paints the same hostel. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  return { canvas, ctx: canvas.getContext("2d")! };
}

/** "#rrggbb" lightened (amount > 0) or darkened (amount < 0), amount in -1..1. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => {
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.round(Math.min(255, Math.max(0, v)));
  };
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Fill a rounded rect with a top-to-bottom gradient (light top, dark bottom) and a thin outline. */
export function box(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  opts: { light?: number; dark?: number; outline?: string | null; lineWidth?: number } = {},
): void {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shade(color, opts.light ?? 0.12));
  g.addColorStop(1, shade(color, -(opts.dark ?? 0.15)));
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();
  if (opts.outline !== null) {
    ctx.lineWidth = opts.lineWidth ?? 1.2;
    ctx.strokeStyle = opts.outline ?? "rgba(20,12,8,0.75)";
    ctx.stroke();
  }
}

/**
 * Run `draw` with a soft drop shadow under whatever it paints. Shadow sizes
 * ignore the canvas transform, so they're multiplied by the art scale.
 */
export function withShadow(ctx: Ctx, scale: number, draw: () => void, blur = 5, dy = 3, alpha = 0.45): void {
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = dy * scale;
  draw();
  ctx.restore();
}

export function circle(ctx: Ctx, x: number, y: number, r: number, fill: Paint, stroke?: string, lineWidth = 1): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** A circle shaded like a ball / cylinder seen from above (highlight top-left). */
export function ball(ctx: Ctx, x: number, y: number, r: number, color: string, outline = "rgba(20,12,8,0.7)"): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, shade(color, 0.35));
  g.addColorStop(0.7, color);
  g.addColorStop(1, shade(color, -0.3));
  circle(ctx, x, y, r, g, outline);
}
