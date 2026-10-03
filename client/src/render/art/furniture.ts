// Furniture, seen from above, painted with soft shadows. One painter per
// layout.json furniture type; unknown types get a plain wooden crate.
// Rects are in world pixels (whole tiles); pieces are drawn a little inset so
// neighbours don't touch.

import { ball, box, circle, roundRect, rgba, shade, withShadow } from "./paint";
import type { Ctx } from "./paint";

export interface Piece {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

type Painter = (ctx: Ctx, p: Piece, rnd: () => number, scale: number) => void;

const WOOD = "#8a5a34";
const WOOD_DARK = "#5e3b20";
const METAL = "#9aa4ad";
const STEEL = "#c9d1d6";
const BLANKETS = ["#c0392b", "#2e86c1", "#27ae60", "#8e44ad", "#d35400", "#16a085", "#e84393", "#f1c40f"];
const BOOKS = ["#c0392b", "#2980b9", "#27ae60", "#f39c12", "#8e44ad", "#ecf0f1", "#2c3e50", "#d35400", "#1abc9c"];
const CLOTHES = ["#e74c3c", "#3498db", "#f1c40f", "#2ecc71", "#ffffff", "#9b59b6", "#e67e22"];

const pick = <T,>(arr: T[], rnd: () => number): T => arr[Math.floor(rnd() * arr.length)];

function inset(p: Piece, d: number): Piece {
  return { ...p, x: p.x + d, y: p.y + d, w: p.w - d * 2, h: p.h - d * 2 };
}

// ---------- Big pieces ----------

const bed: Painter = (ctx, p, rnd, s) => {
  const b = inset(p, 2);
  withShadow(ctx, s, () => box(ctx, b.x, b.y, b.w, b.h, 4, WOOD_DARK));
  // Mattress.
  box(ctx, b.x + 3, b.y + 3, b.w - 6, b.h - 6, 3, "#efe9dc", { outline: "rgba(0,0,0,0.25)" });
  // Pillow.
  withShadow(ctx, s, () => box(ctx, b.x + 7, b.y + 6, b.w - 14, 13, 5, "#ffffff", { outline: "rgba(0,0,0,0.2)" }), 2, 1, 0.3);
  // Blanket, folded back at the top.
  const color = pick(BLANKETS, rnd);
  const top = b.y + b.h * 0.38;
  box(ctx, b.x + 3, top, b.w - 6, b.y + b.h - 3 - top, 3, color, { outline: "rgba(0,0,0,0.35)" });
  box(ctx, b.x + 3, top, b.w - 6, 6, 2, shade(color, 0.25), { outline: null });
  ctx.strokeStyle = rgba(shade(color, -0.4), 0.5);
  ctx.lineWidth = 0.8;
  for (let k = 0; k < 3; k++) {
    const y = top + 12 + rnd() * (b.y + b.h - top - 20);
    ctx.beginPath();
    ctx.moveTo(b.x + 6, y);
    ctx.quadraticCurveTo(b.x + b.w / 2, y + (rnd() - 0.5) * 6, b.x + b.w - 6, y + (rnd() - 0.5) * 3);
    ctx.stroke();
  }
};

const desk: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 2);
  // Chair pulled up to the room side.
  withShadow(ctx, s, () => box(ctx, d.x + d.w / 2 - 8, d.y + d.h - 4, 16, 12, 4, "#3d3d46"), 3, 2);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h - 4, 3, WOOD, { light: 0.2 }));
  // Laptop, books, lamp, mug.
  const lx = d.x + 6 + rnd() * Math.max(0, d.w - 40);
  box(ctx, lx, d.y + 4, 20, 13, 2, "#4b5563", { outline: "rgba(0,0,0,0.6)" });
  ctx.fillStyle = "#7fd3ff";
  ctx.fillRect(lx + 2.5, d.y + 6, 15, 8);
  box(ctx, d.x + d.w - 18, d.y + 4, 12, 9, 1, pick(BOOKS, rnd));
  box(ctx, d.x + d.w - 16, d.y + 7, 12, 9, 1, pick(BOOKS, rnd));
  circle(ctx, d.x + 5, d.y + d.h - 10, 3, "#ffffff", "rgba(0,0,0,0.5)");
  circle(ctx, d.x + 5, d.y + d.h - 10, 1.8, "#6b3a1d");
};

const sofa: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 2);
  const color = pick(["#8e3b5c", "#2f5d8a", "#6b4c2f", "#3e7d5a"], rnd);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 6, shade(color, -0.25)));
  // Back rest along the top, arms at the ends, cushions in between.
  box(ctx, d.x + 2, d.y + 1, d.w - 4, 9, 4, shade(color, -0.1), { outline: "rgba(0,0,0,0.35)" });
  box(ctx, d.x + 1, d.y + 2, 7, d.h - 4, 3, shade(color, -0.05));
  box(ctx, d.x + d.w - 8, d.y + 2, 7, d.h - 4, 3, shade(color, -0.05));
  const n = Math.max(2, Math.round((d.w - 16) / 30));
  const cw = (d.w - 16) / n;
  for (let i = 0; i < n; i++) box(ctx, d.x + 8 + i * cw + 1, d.y + 10, cw - 2, d.h - 13, 3, color, { light: 0.2 });
  // A cushion thrown on it.
  box(ctx, d.x + 10 + rnd() * (d.w - 30), d.y + 11, 10, 9, 3, pick(BLANKETS, rnd));
};

const table: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 3);
  const long = d.w >= d.h * 3;
  if (long) {
    // Mess table: steel benches on both sides, thalis and glasses on top.
    withShadow(ctx, s, () => box(ctx, d.x + 2, d.y - 2, d.w - 4, 4, 2, METAL), 2, 1);
    withShadow(ctx, s, () => box(ctx, d.x + 2, d.y + d.h - 2, d.w - 4, 4, 2, METAL), 2, 1);
    withShadow(ctx, s, () => box(ctx, d.x, d.y + 2, d.w, d.h - 4, 3, "#b98a5a", { light: 0.2 }));
    for (let x = d.x + 14; x < d.x + d.w - 8; x += 26) {
      for (const y of [d.y + 8, d.y + d.h - 8]) {
        if (rnd() < 0.25) continue;
        circle(ctx, x, y, 5.5, STEEL, "rgba(0,0,0,0.45)", 0.8);
        circle(ctx, x - 1.5, y - 1, 1.8, pick(["#f1c40f", "#e67e22", "#ffffff", "#c0392b"], rnd));
        circle(ctx, x + 2, y + 1, 1.5, "#ffffff");
        circle(ctx, x + 9, y, 2.2, "#dfe6ea", "rgba(0,0,0,0.4)", 0.6);
      }
    }
    return;
  }
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, Math.min(d.w, d.h) / 2.5, "#7a4f2a", { light: 0.22 }));
  // Snacks and cans.
  for (let i = 0; i < 4; i++) {
    const x = d.x + 8 + rnd() * (d.w - 16);
    const y = d.y + 8 + rnd() * (d.h - 16);
    if (i === 0) {
      box(ctx, x - 8, y - 5, 16, 10, 2, "#f1c40f");
      ctx.fillStyle = "#c0392b";
      ctx.fillRect(x - 6, y - 2, 12, 4);
    } else {
      ball(ctx, x, y, 2.6, pick(["#e74c3c", "#2ecc71", "#3498db", "#ecf0f1"], rnd));
    }
  }
};

const tv: Painter = (ctx, p, _rnd, s) => {
  const d = inset(p, 2);
  withShadow(ctx, s, () => box(ctx, d.x, d.y + 6, d.w, d.h - 8, 3, "#3b2a1c"));
  box(ctx, d.x + 6, d.y + 1, d.w - 12, 10, 2, "#111318", { outline: "#000" });
  const g = ctx.createLinearGradient(d.x, 0, d.x + d.w, 0);
  g.addColorStop(0, "#3a7bd5");
  g.addColorStop(1, "#00d2ff");
  ctx.fillStyle = g;
  ctx.fillRect(d.x + 8, d.y + 3, d.w - 16, 6);
  // Screen glow on the floor in front.
  const glow = ctx.createRadialGradient(d.x + d.w / 2, d.y + d.h, 2, d.x + d.w / 2, d.y + d.h, d.w * 0.7);
  glow.addColorStop(0, "rgba(120,190,255,0.22)");
  glow.addColorStop(1, "rgba(120,190,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(d.x - d.w * 0.3, d.y + d.h, d.w * 1.6, d.w * 0.7);
};

const speaker: Painter = (ctx, p, _rnd, s) => {
  const d = inset(p, 3);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 3, "#24242a"));
  ball(ctx, d.x + d.w / 2, d.y + d.h * 0.32, d.w * 0.32, "#444a52");
  circle(ctx, d.x + d.w / 2, d.y + d.h * 0.32, d.w * 0.1, "#111");
  ball(ctx, d.x + d.w / 2, d.y + d.h * 0.72, d.w * 0.22, "#444a52");
  circle(ctx, d.x + d.w - 5, d.y + 5, 1.5, "#2ecc71");
};

const carrom: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 5);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 3, "#4a2b14"));
  box(ctx, d.x + 4, d.y + 4, d.w - 8, d.h - 8, 1, "#e9cf96", { outline: "rgba(0,0,0,0.35)" });
  for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) circle(ctx, d.x + 6 + cx * (d.w - 12), d.y + 6 + cy * (d.h - 12), 3, "#1a1a1a");
  ctx.strokeStyle = "rgba(150,40,40,0.7)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(d.x + d.w / 2, d.y + d.h / 2, d.w * 0.16, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 9; i++) {
    circle(ctx, d.x + d.w / 2 + (rnd() - 0.5) * d.w * 0.5, d.y + d.h / 2 + (rnd() - 0.5) * d.h * 0.5, 2, i % 2 ? "#222" : "#f5f0e1", "rgba(0,0,0,0.5)", 0.5);
  }
  circle(ctx, d.x + d.w / 2, d.y + d.h / 2, 2.2, "#c0392b");
};

const counter: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 2);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 3, "#aab4bb", { light: 0.3 }));
  // Big steel pots of dal, rice, sabzi.
  const n = Math.max(2, Math.floor(d.h / 26));
  for (let i = 0; i < n; i++) {
    const cy = d.y + (d.h / n) * (i + 0.5);
    ball(ctx, d.x + d.w / 2, cy, Math.min(d.w, d.h / n) * 0.36, STEEL);
    circle(ctx, d.x + d.w / 2, cy, Math.min(d.w, d.h / n) * 0.26, pick(["#e6b422", "#f5f0e1", "#7a9a3a", "#c0592b"], rnd));
  }
};

const boxes: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 2);
  const cols = Math.max(1, Math.round(d.w / 30));
  const rows = Math.max(1, Math.round(d.h / 30));
  const cw = d.w / cols;
  const ch = d.h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const j = 2 + rnd() * 3;
      const x = d.x + c * cw + j / 2;
      const y = d.y + r * ch + j / 2;
      const tone = shade("#b5884f", (rnd() - 0.5) * 0.25);
      withShadow(ctx, s, () => box(ctx, x, y, cw - j, ch - j, 1.5, tone, { light: 0.15 }), 3, 2);
      ctx.fillStyle = "rgba(230,220,180,0.75)";
      ctx.fillRect(x + (cw - j) / 2 - 2, y, 4, ch - j);
    }
  }
};

const washingMachine: Painter = (ctx, p, _rnd, s) => {
  const d = inset(p, 2);
  const n = Math.max(1, Math.round(d.w / 30));
  const w = d.w / n;
  for (let i = 0; i < n; i++) {
    const x = d.x + i * w + 1;
    withShadow(ctx, s, () => box(ctx, x, d.y, w - 2, d.h, 3, "#eef1f3", { light: 0.05 }));
    ball(ctx, x + (w - 2) / 2, d.y + d.h / 2 + 1, Math.min(w, d.h) * 0.3, "#8fb8cf");
    circle(ctx, x + 4, d.y + 4, 1.4, "#2ecc71");
  }
};

const bucketPile: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 2);
  for (let x = d.x + 9; x < d.x + d.w - 4; x += 15) {
    const color = pick(["#2e86c1", "#c0392b", "#27ae60", "#f39c12"], rnd);
    withShadow(ctx, s, () => ball(ctx, x, d.y + d.h / 2 + (rnd() - 0.5) * 4, 8, color), 3, 2);
    circle(ctx, x, d.y + d.h / 2, 5.5, shade(color, -0.35));
    // Mug inside.
    if (rnd() < 0.5) circle(ctx, x + 1, d.y + d.h / 2, 2.5, pick(["#ecf0f1", "#f1c40f"], rnd));
  }
};

const waterTank: Painter = (ctx, p, _rnd, s) => {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const r = Math.min(p.w, p.h) / 2 - 3;
  withShadow(ctx, s, () => ball(ctx, cx, cy, r, "#2b2d30"), 8, 5, 0.55);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  for (let k = 0.45; k < 1; k += 0.18) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  ball(ctx, cx, cy, r * 0.28, "#3a3d42");
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "bold 7px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("1000 L", cx, cy + r * 0.62);
};

const chaiStall: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 2);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 3, "#b5651d", { light: 0.2 }));
  // Stove + kettle, glasses of chai.
  circle(ctx, d.x + 12, d.y + d.h / 2, 8, "#2c2c2c");
  ball(ctx, d.x + 12, d.y + d.h / 2, 6, "#c9ccd0");
  for (let i = 0; i < 5; i++) {
    const x = d.x + 26 + i * 7;
    if (x > d.x + d.w - 4) break;
    circle(ctx, x, d.y + d.h / 2 + (rnd() - 0.5) * 6, 2.6, "#e9d9b5", "rgba(0,0,0,0.4)", 0.5);
    circle(ctx, x, d.y + d.h / 2, 1.6, "#a0522d");
  }
};

const bookshelf: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 2);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 2, "#4a2c17"));
  // Book tops seen from above, in a row.
  let x = d.x + 3;
  while (x < d.x + d.w - 4) {
    const w = 2.5 + rnd() * 3.5;
    const color = pick(BOOKS, rnd);
    ctx.fillStyle = color;
    ctx.fillRect(x, d.y + 4 + rnd() * 2, Math.min(w, d.x + d.w - 3 - x), d.h - 10);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x, d.y + 4, 0.8, d.h - 10);
    x += w + 0.6;
  }
};

const bench: Painter = (ctx, p, _rnd, s) => {
  const d = inset(p, 3);
  withShadow(ctx, s, () => box(ctx, d.x + 4, d.y + 3, d.w - 8, d.h - 6, 4, "#1f1f24"));
  box(ctx, d.x + 6, d.y + 5, d.w - 12, d.h - 10, 3, "#c0392b", { light: 0.25 });
  // Barbell across it.
  ctx.fillStyle = "#9aa4ad";
  ctx.fillRect(d.x - 2, d.y + d.h / 2 - 1, d.w + 4, 2);
  for (const x of [d.x + 2, d.x + d.w - 6]) box(ctx, x, d.y - 1, 4, d.h + 2, 1, "#2c3e50");
};

const rack: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 3);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 2, "#3c4146"));
  for (let y = d.y + 7; y < d.y + d.h - 4; y += 11) {
    const color = pick(["#2c3e50", "#c0392b", "#7f8c8d"], rnd);
    ball(ctx, d.x + 6, y, 4, color);
    ball(ctx, d.x + d.w - 6, y, 4, color);
    ctx.fillStyle = "#bdc3c7";
    ctx.fillRect(d.x + 9, y - 1, d.w - 18, 2);
  }
};

const sink: Painter = (ctx, p, _rnd, s) => {
  const d = inset(p, 2);
  // Mirror strip on the wall side, counter with basins and taps.
  withShadow(ctx, s, () => box(ctx, d.x, d.y + 2, d.w, d.h - 4, 3, "#e8edf0", { light: 0.1 }));
  const n = Math.max(1, Math.round(d.w / 30));
  const w = d.w / n;
  for (let i = 0; i < n; i++) {
    const cx = d.x + w * (i + 0.5);
    ctx.beginPath();
    ctx.ellipse(cx, d.y + d.h / 2 + 1, w * 0.32, (d.h - 8) * 0.38, 0, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(cx, d.y + d.h / 2, 1, cx, d.y + d.h / 2, w * 0.35);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#a9bcc6");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    circle(ctx, cx, d.y + 5, 1.8, "#9aa4ad", "rgba(0,0,0,0.5)", 0.5);
  }
};

// ---------- Hiding spots (1x1) ----------

const cupboard: Painter = (ctx, p, _rnd, s) => {
  const d = inset(p, 2);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 2, "#7b4f2a", { light: 0.2 }));
  ctx.strokeStyle = "rgba(30,15,5,0.7)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(d.x + d.w / 2, d.y + 2);
  ctx.lineTo(d.x + d.w / 2, d.y + d.h - 2);
  ctx.stroke();
  circle(ctx, d.x + d.w / 2 - 3, d.y + d.h / 2, 1.2, "#f4c430");
  circle(ctx, d.x + d.w / 2 + 3, d.y + d.h / 2, 1.2, "#f4c430");
};

const locker: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 3);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 2, "#5f7d95", { light: 0.25 }));
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (let k = 0; k < 3; k++) ctx.fillRect(d.x + 5, d.y + 4 + k * 3, d.w - 10, 1.2);
  circle(ctx, d.x + d.w - 6, d.y + d.h / 2 + 3, 1.4, "#dfe6ea");
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "bold 6px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(10 + Math.floor(rnd() * 90)), d.x + d.w / 2, d.y + d.h - 4);
};

const underBed: Painter = (ctx, p, rnd) => {
  // A blanket slipping off the bed and a pair of chappals in the dark gap.
  const d = inset(p, 2);
  const g = ctx.createLinearGradient(d.x, 0, d.x + d.w, 0);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0.05)");
  ctx.fillStyle = g;
  roundRect(ctx, d.x, d.y, d.w, d.h, 4);
  ctx.fill();
  const color = pick(BLANKETS, rnd);
  ctx.beginPath();
  ctx.moveTo(d.x, d.y + 2);
  ctx.quadraticCurveTo(d.x + d.w * 0.6, d.y + d.h * 0.3, d.x + d.w * 0.45, d.y + d.h - 2);
  ctx.lineTo(d.x, d.y + d.h - 4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  box(ctx, d.x + d.w - 10, d.y + 6, 5, 10, 2, "#3a7bd5", { outline: null });
  box(ctx, d.x + d.w - 5, d.y + 8, 5, 10, 2, "#3a7bd5", { outline: null });
};

const curtain: Painter = (ctx, p, _rnd, s) => {
  const d = inset(p, 2);
  withShadow(ctx, s, () => {
    const g = ctx.createLinearGradient(d.x, 0, d.x + d.w, 0);
    for (let k = 0; k <= 6; k++) g.addColorStop(k / 6, k % 2 ? "#7d1f1f" : "#c0392b");
    roundRect(ctx, d.x, d.y, d.w, d.h, 3);
    ctx.fillStyle = g;
    ctx.fill();
  });
  ctx.fillStyle = "#d4ac0d";
  ctx.fillRect(d.x - 1, d.y, d.w + 2, 2.5);
};

const beanbag: Painter = (ctx, p, rnd, s) => {
  const color = pick(["#e67e22", "#16a085", "#c0392b", "#8e44ad"], rnd);
  withShadow(ctx, s, () => ball(ctx, p.x + p.w / 2, p.y + p.h / 2, p.w * 0.42, color));
  circle(ctx, p.x + p.w / 2 + 2, p.y + p.h / 2 + 2, p.w * 0.18, shade(color, -0.2));
};

const foodDrum: Painter = (ctx, p, _rnd, s) => {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  withShadow(ctx, s, () => ball(ctx, cx, cy, p.w * 0.42, "#a7b0b6"));
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, p.w * 0.32, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#5b6166";
  ctx.fillRect(cx - 5, cy - 1, 10, 2);
};

const underTable: Painter = (ctx, p, _rnd, s) => {
  const d = inset(p, 2);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 3, "#f5f0e1", { light: 0.05 }));
  ctx.strokeStyle = "rgba(192,57,43,0.6)";
  ctx.lineWidth = 1.2;
  for (let k = 4; k < d.w; k += 6) {
    ctx.beginPath();
    ctx.moveTo(d.x + k, d.y + 1);
    ctx.lineTo(d.x + k, d.y + d.h - 1);
    ctx.stroke();
  }
};

const fileCabinet: Painter = (ctx, p, _rnd, s) => {
  const d = inset(p, 3);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 2, "#7f8790", { light: 0.25 }));
  for (let k = 1; k < 3; k++) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(d.x + 2, d.y + (d.h / 3) * k, d.w - 4, 0.8);
  }
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = "#dfe6ea";
    ctx.fillRect(d.x + d.w / 2 - 3, d.y + (d.h / 3) * (k + 0.5) - 0.7, 6, 1.4);
  }
};

const mattressPile: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 1);
  for (let k = 0; k < 3; k++) {
    const o = k * 1.5;
    withShadow(ctx, s, () => box(ctx, d.x + o, d.y + o, d.w - 3, d.h - 3, 4, pick(["#d6c7a1", "#c9b48a", "#e4d8bb"], rnd)), 3, 2);
  }
  ctx.strokeStyle = "rgba(60,90,150,0.45)";
  ctx.lineWidth = 1.2;
  for (let x = d.x + 6; x < d.x + d.w - 2; x += 5) {
    ctx.beginPath();
    ctx.moveTo(x, d.y + 4);
    ctx.lineTo(x, d.y + d.h - 2);
    ctx.stroke();
  }
};

const clothesline: Painter = (ctx, p, rnd) => {
  const d = inset(p, 1);
  circle(ctx, d.x + 2, d.y + d.h / 2, 2, "#5b6166");
  circle(ctx, d.x + d.w - 2, d.y + d.h / 2, 2, "#5b6166");
  ctx.strokeStyle = "#ecf0f1";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(d.x + 2, d.y + d.h / 2);
  ctx.lineTo(d.x + d.w - 2, d.y + d.h / 2);
  ctx.stroke();
  for (let x = d.x + 5; x < d.x + d.w - 6; x += 8) {
    const color = pick(CLOTHES, rnd);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, d.y + d.h / 2);
    ctx.lineTo(x + 7, d.y + d.h / 2);
    ctx.lineTo(x + 6, d.y + d.h / 2 + 9 + rnd() * 4);
    ctx.lineTo(x + 1, d.y + d.h / 2 + 9 + rnd() * 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.stroke();
  }
};

const behindTank: Painter = (ctx, p) => {
  const d = inset(p, 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, d.x, d.y, d.w, d.h, 6);
  ctx.fill();
  ctx.strokeStyle = "#5b6166";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(d.x + 4, d.y);
  ctx.lineTo(d.x + 4, d.y + d.h - 6);
  ctx.lineTo(d.x + d.w, d.y + d.h - 6);
  ctx.stroke();
};

const plant: Painter = (ctx, p, rnd, s) => {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  withShadow(ctx, s, () => ball(ctx, cx, cy, p.w * 0.24, "#b5651d"));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.4;
    const r = p.w * (0.22 + rnd() * 0.16);
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.7, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? "#2e8b3a" : "#3fa84c";
    ctx.fill();
    ctx.restore();
  }
  circle(ctx, cx, cy, 2.5, "#7ac25a");
};

const betweenShelves: Painter = (ctx, p, rnd, s) => {
  const d = inset(p, 5);
  for (let k = 0; k < 4; k++) {
    withShadow(ctx, s, () => box(ctx, d.x + (rnd() - 0.5) * 3, d.y + d.h - 8 - k * 4, d.w, 6, 1, pick(BOOKS, rnd)), 2, 1, 0.3);
  }
};

const behindSofa: Painter = (ctx, p, rnd, s) => {
  for (let k = 0; k < 3; k++) {
    withShadow(ctx, s, () => box(ctx, p.x + 4 + rnd() * 8, p.y + 4 + rnd() * 10, 13, 11, 4, pick(BLANKETS, rnd)), 3, 2);
  }
};

const matPile: Painter = (ctx, p, rnd, s) => {
  for (let k = 0; k < 3; k++) {
    const y = p.y + 7 + k * 8;
    const color = pick(["#16a085", "#8e44ad", "#2980b9", "#e67e22"], rnd);
    withShadow(ctx, s, () => box(ctx, p.x + 4, y - 3, p.w - 8, 7, 3.5, color, { light: 0.3 }), 2, 1);
    circle(ctx, p.x + 6, y + 0.5, 2.5, shade(color, -0.3));
  }
};

const crate: Painter = (ctx, p, _rnd, s) => {
  const d = inset(p, 3);
  withShadow(ctx, s, () => box(ctx, d.x, d.y, d.w, d.h, 2, "#8a6a44", { light: 0.18 }));
};

const PAINTERS: Record<string, Painter> = {
  bed,
  desk,
  sofa,
  table,
  tv,
  speaker,
  carrom,
  counter,
  boxes,
  "washing-machine": washingMachine,
  "bucket-pile": bucketPile,
  "water-tank": waterTank,
  "chai-stall": chaiStall,
  bookshelf,
  bench,
  rack,
  sink,
  cupboard,
  locker,
  "under-bed": underBed,
  curtain,
  beanbag,
  "food-drum": foodDrum,
  "under-table": underTable,
  "file-cabinet": fileCabinet,
  "mattress-pile": mattressPile,
  clothesline,
  "behind-tank": behindTank,
  plant,
  "between-shelves": betweenShelves,
  "behind-sofa": behindSofa,
  "mat-pile": matPile,
};

export function paintFurniture(ctx: Ctx, piece: Piece, rnd: () => number, scale: number): void {
  (PAINTERS[piece.type] ?? crate)(ctx, piece, rnd, scale);
}

/** Dashed golden outline marking a hiding spot. */
export function paintHideMarker(ctx: Ctx, piece: Piece): void {
  ctx.save();
  ctx.setLineDash([3, 2.5]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(244,196,48,0.75)";
  roundRect(ctx, piece.x + 1, piece.y + 1, piece.w - 2, piece.h - 2, 5);
  ctx.stroke();
  ctx.restore();
}
