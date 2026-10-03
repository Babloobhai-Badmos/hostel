// Floor materials: small seamless pattern tiles (wood planks, terrazzo,
// red-oxide, carpet, concrete...) painted once and repeated across a room.
// They don't line up with the 32 px collision grid, so the grid disappears.

import { makeCanvas, rgba, seeded, shade } from "./paint";
import type { Ctx } from "./paint";

/** Pattern tile size in world pixels (not a multiple of 32 on purpose). */
const P = 144;

type Painter = (ctx: Ctx, rnd: () => number) => void;

interface MaterialDef {
  base: string;
  paint: Painter;
}

/** Long planks in rows, each a slightly different tone, with grain and seams. */
function planks(base: string, plankH: number): Painter {
  return (ctx, rnd) => {
    for (let y = 0; y < P; y += plankH) {
      let x = -rnd() * 60;
      while (x < P) {
        const len = 48 + rnd() * 54;
        const tone = shade(base, (rnd() - 0.5) * 0.18);
        // Wrap around the right edge so the tile repeats seamlessly.
        for (const ox of [0, -P]) {
          const px = x + ox;
          if (px + len < 0) continue;
          const g = ctx.createLinearGradient(0, y, 0, y + plankH);
          g.addColorStop(0, shade(tone, 0.06));
          g.addColorStop(1, shade(tone, -0.06));
          ctx.fillStyle = g;
          ctx.fillRect(px, y, len, plankH);
          ctx.strokeStyle = rgba(shade(tone, -0.35), 0.18);
          ctx.lineWidth = 0.5;
          for (let k = 0; k < 2; k++) {
            const gy = y + 1.5 + rnd() * (plankH - 3);
            ctx.beginPath();
            ctx.moveTo(px + 2, gy);
            ctx.bezierCurveTo(px + len * 0.3, gy + (rnd() - 0.5) * 2, px + len * 0.7, gy + (rnd() - 0.5) * 2, px + len - 2, gy);
            ctx.stroke();
          }
          ctx.fillStyle = rgba(shade(base, -0.55), 0.55);
          ctx.fillRect(px + len - 0.6, y, 0.6, plankH);
        }
        x += len;
      }
      ctx.fillStyle = rgba(shade(base, -0.6), 0.6);
      ctx.fillRect(0, y + plankH - 0.6, P, 0.6);
    }
  };
}

/** Polished stone with coloured chips. */
function terrazzo(base: string, chips: string[], density: number, shine = 0.05): Painter {
  return (ctx, rnd) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, P, P);
    blotches(ctx, rnd, base, 10, 0.07);
    const n = Math.round(P * P * density);
    for (let i = 0; i < n; i++) {
      const x = rnd() * P;
      const y = rnd() * P;
      const r = 0.4 + rnd() * rnd() * 1.6;
      ctx.fillStyle = chips[Math.floor(rnd() * chips.length)];
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    if (shine > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${shine})`;
      ctx.lineWidth = 6;
      for (let i = 0; i < 3; i++) {
        const x = rnd() * P;
        ctx.beginPath();
        ctx.moveTo(x, -10);
        ctx.lineTo(x + 30, P + 10);
        ctx.stroke();
      }
    }
  };
}

/** Soft low-contrast patches, so big floors don't look flat. */
function blotches(ctx: Ctx, rnd: () => number, base: string, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const x = rnd() * P;
    const y = rnd() * P;
    const r = 12 + rnd() * 30;
    const tone = shade(base, (rnd() - 0.5) * 0.4);
    for (const [ox, oy] of [[0, 0], [P, 0], [-P, 0], [0, P], [0, -P]]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, rgba(tone, alpha));
      g.addColorStop(1, rgba(tone, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}

/** Fine fuzzy fibres. */
function carpet(base: string, fleck: string): Painter {
  return (ctx, rnd) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, P, P);
    blotches(ctx, rnd, base, 8, 0.12);
    for (let i = 0; i < P * P * 0.35; i++) {
      ctx.fillStyle = rnd() < 0.5 ? rgba(shade(base, 0.18), 0.35) : rgba(shade(base, -0.25), 0.35);
      ctx.fillRect(rnd() * P, rnd() * P, 0.7, 0.7);
    }
    for (let i = 0; i < P * P * 0.004; i++) {
      ctx.fillStyle = rgba(fleck, 0.5);
      ctx.fillRect(rnd() * P, rnd() * P, 1, 1);
    }
  };
}

/** Rough concrete / rooftop with specks and the odd crack. */
function concrete(base: string, cracks: number): Painter {
  return (ctx, rnd) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, P, P);
    blotches(ctx, rnd, base, 14, 0.14);
    for (let i = 0; i < P * P * 0.05; i++) {
      ctx.fillStyle = rnd() < 0.5 ? rgba(shade(base, 0.25), 0.4) : rgba(shade(base, -0.3), 0.4);
      ctx.fillRect(rnd() * P, rnd() * P, 0.8, 0.8);
    }
    ctx.strokeStyle = rgba(shade(base, -0.5), 0.5);
    ctx.lineWidth = 0.6;
    for (let i = 0; i < cracks; i++) {
      let x = 10 + rnd() * (P - 20);
      let y = 10 + rnd() * (P - 20);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rnd() - 0.5) * 14;
        y += (rnd() - 0.5) * 14;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  };
}

/** Floor material per room kind ("corridor" for corridors). Unknown kinds use "standard". */
const MATERIALS: Record<string, MaterialDef> = {
  corridor: { base: "#8a8070", paint: terrazzo("#8a8070", ["#6f675b", "#a69c86", "#7a766d", "#9a8a70"], 0.035, 0.03) },
  standard: { base: "#9a6a3c", paint: planks("#9a6a3c", 9) },
  library: { base: "#5e3c22", paint: planks("#5e3c22", 8) },
  stairs: { base: "#8f8676", paint: terrazzo("#8f8676", ["#6b6458", "#b9b09c"], 0.03, 0) },
  washroom: { base: "#5f8088", paint: terrazzo("#5f8088", ["#4a6870", "#7896a0", "#88a9b0", "#a9c4c9"], 0.03, 0) },
  mess: { base: "#8c4433", paint: terrazzo("#8c4433", ["#6e3426", "#a85a46", "#7d3b2c"], 0.015, 0) },
  hub: { base: "#3f5571", paint: carpet("#3f5571", "#9fb6d4") },
  tv: { base: "#47395e", paint: carpet("#47395e", "#a58fd0") },
  rangeen: { base: "#6c2c63", paint: carpet("#6c2c63", "#ff8be3") },
  office: { base: "#5c2a2f", paint: carpet("#5c2a2f", "#c9a14a") },
  store: { base: "#6a655c", paint: concrete("#6a655c", 3) },
  laundry: { base: "#5c6a72", paint: terrazzo("#5c6a72", ["#46535a", "#8796a0", "#74838c"], 0.025, 0) },
  terrace: { base: "#7a7266", paint: concrete("#7a7266", 6) },
  gym: { base: "#2f3335", paint: terrazzo("#2f3335", ["#4a5054", "#c0392b", "#2e86c1", "#f1c40f"], 0.012, 0) },
};

export function materialBase(kind: string): string {
  return (MATERIALS[kind] ?? MATERIALS.standard).base;
}

const patternCache = new WeakMap<Ctx, Map<string, CanvasPattern>>();

/** A repeating pattern for this room kind, for a destination context scaled by `scale`. */
export function materialPattern(dest: Ctx, kind: string, scale: number): CanvasPattern {
  const key = `${kind in MATERIALS ? kind : "standard"}@${scale}`;
  let cache = patternCache.get(dest);
  if (!cache) patternCache.set(dest, (cache = new Map()));
  const cached = cache.get(key);
  if (cached) return cached;
  const def = MATERIALS[kind] ?? MATERIALS.standard;
  const { canvas, ctx } = makeCanvas(P * scale, P * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = def.base;
  ctx.fillRect(0, 0, P, P);
  def.paint(ctx, seeded(0x51ed + key.length * 977 + key.charCodeAt(0)));
  const pattern = dest.createPattern(canvas, "repeat")!;
  // The destination is already scaled up; undo that for the pattern's own pixels.
  pattern.setTransform(new DOMMatrix().scale(1 / scale));
  cache.set(key, pattern);
  return pattern;
}
