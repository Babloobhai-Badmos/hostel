// `npm run sprites`: draws the chibi character sprite sheets as editable SVG
// files into client/public/sprites/. Run it once to get the starting art,
// then touch the SVGs up by hand (Inkscape, Krita, Photopea...).
//
// WARNING: running it again OVERWRITES the SVGs (and your edits). Pass
// --force to confirm.
//
// Sheet layout (same for every sheet), see client/public/sprites/README.md:
//   frame 64 x 80 px, 6 columns x 4 rows
//   rows:    0 = walking down (front), 1 = side (facing LEFT; the game mirrors
//            it for right), 2 = up (back), 3 = specials
//   columns: 0 = idle, 1 = idle blink, 2..5 = walk cycle
//   row 3:   column 0 = stunned (dizzy), column 1 = dead (lying down)
//
// Players are drawn in TWO layers so each player gets their own colour while
// everyone (killers included) looks exactly the same:
//   player-shirt.svg    the T-shirt only, in white/grey. The game tints it.
//   player-details.svg  everything else (skin, hair, face, shorts, slippers).
// NPCs (gujju.svg, warden.svg) are a single full-colour layer.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../client/public/sprites");

export const FW = 64;
export const FH = 80;
const COLS = 6;
const ROWS = 4;

const C = {
  line: "#2b1d14",
  skin: "#f1c27d",
  skinShade: "#d9a066",
  hair: "#2b1b17",
  hairShine: "#4a342c",
  shorts: "#2f3e66",
  shortsShade: "#24304f",
  slipper: "#3a7bd5",
  sole: "#1f2a44",
  eyeWhite: "#ffffff",
  pupil: "#1a1a1a",
  blush: "#f4a3a3",
  mouth: "#7a2e2e",
  tongue: "#e8707a",
  shirt: "#ffffff",
  shirtShade: "#cfcfcf",
};
const LW = 2; // outline width

const ln = `stroke="${C.line}" stroke-width="${LW}" stroke-linejoin="round" stroke-linecap="round"`;

// ---------- Pose parameters ----------

/** walk phase -1 = idle; 0..3 walk cycle. */
function pose(phase) {
  if (phase < 0) return { bob: 0, legL: 0, legR: 0, armL: 0, armR: 0 };
  const bob = phase % 2 === 1 ? -1.5 : 0;
  const swing = [3, 0, -3, 0][phase];
  return { bob, legL: swing, legR: -swing, armL: -swing, armR: swing };
}

// ---------- FRONT (down) ----------

function frontShirt(p, color = C.shirt, shade = C.shirtShade) {
  const b = p.bob;
  return `
  <g transform="translate(0 ${b})">
    <path d="M20 42 Q32 38 44 42 L51 50 L46 54 L44 51 L44 60 Q32 62 20 60 L20 51 L18 54 L13 50 Z" fill="${color}" ${ln}/>
    <path d="M40 43 L44 42 L44 60 Q42 60.6 40 61 Z" fill="${shade}"/>
    <path d="M28 40.5 L32 45 L36 40.5" fill="none" ${ln}/>
  </g>`;
}

function frontLegs(p) {
  const lift = (o) => (o > 0 ? -2.5 : 0);
  const leg = (x, o) => {
    const y = lift(o);
    return `
    <rect x="${x}" y="${64 + y}" width="6" height="8" rx="2" fill="${C.skin}" ${ln}/>
    <ellipse cx="${x + 3}" cy="${73.5 + y}" rx="5.5" ry="2.6" fill="${C.sole}" ${ln}/>
    <path d="M${x} ${72 + y} L${x + 3} ${70 + y} L${x + 6} ${72 + y}" fill="none" stroke="${C.slipper}" stroke-width="2.2" stroke-linecap="round"/>`;
  };
  return leg(23.5, p.legL) + leg(34.5, p.legR) +
    `<g transform="translate(0 ${p.bob})"><path d="M21 58 L43 58 L43.5 66 L33.5 66 L32 62 L30.5 66 L20.5 66 Z" fill="${C.shorts}" ${ln}/></g>`;
}

function frontArms(p) {
  const b = p.bob;
  const arm = (x, o) => `
    <rect x="${x}" y="${50 + b + o * 0.6}" width="5.5" height="8" rx="2.5" fill="${C.skin}" ${ln}/>
    <circle cx="${x + 2.75}" cy="${59 + b + o * 0.6}" r="3" fill="${C.skin}" ${ln}/>`;
  return arm(12.5, p.armL) + arm(46, p.armR);
}

function frontHead(p, face) {
  const b = p.bob;
  return `
  <g transform="translate(0 ${b})">
    <rect x="29" y="38" width="6" height="4" fill="${C.skinShade}"/>
    <circle cx="15.5" cy="27" r="3.4" fill="${C.skin}" ${ln}/>
    <circle cx="48.5" cy="27" r="3.4" fill="${C.skin}" ${ln}/>
    <circle cx="32" cy="24" r="17" fill="${C.skin}" ${ln}/>
    ${frontHair()}
    ${face}
  </g>`;
}

function frontHair() {
  return `
    <path d="M15 25 Q14 8 32 6.5 Q50 8 49 25 Q47 17 43 15 L41 19 L37 14.5 L33 19 L29 14.5 L25 19.5 L22 15.5 Q17 18 15 25 Z" fill="${C.hair}" ${ln}/>
    <path d="M24 10 Q31 7.5 38 9.5" fill="none" stroke="${C.hairShine}" stroke-width="2" stroke-linecap="round"/>`;
}

function faceNormal(blink) {
  const eye = (x) =>
    blink
      ? `<path d="M${x - 4} 28 Q${x} 30.5 ${x + 4} 28" fill="none" ${ln}/>`
      : `<ellipse cx="${x}" cy="27.5" rx="4" ry="5" fill="${C.eyeWhite}" ${ln}/>
         <circle cx="${x + 0.6}" cy="28.4" r="2.6" fill="${C.pupil}"/>
         <circle cx="${x + 1.6}" cy="26.8" r="1" fill="#fff"/>`;
  return `
    ${eye(25.5)}${eye(38.5)}
    <path d="M22 21 L28 20.2" ${ln}/><path d="M36 20.2 L42 21" ${ln}/>
    <ellipse cx="20.5" cy="33.5" rx="3" ry="1.8" fill="${C.blush}" opacity="0.7"/>
    <ellipse cx="43.5" cy="33.5" rx="3" ry="1.8" fill="${C.blush}" opacity="0.7"/>
    <path d="M29 35 Q32 38 35 35" fill="none" ${ln}/>`;
}

function faceDizzy() {
  const spiral = (x) =>
    `<path d="M${x} 27.5 m-0.5 0 a1 1 0 1 1 1 1 a2 2 0 1 1 -2 -2.5 a3.2 3.2 0 1 1 3.6 3.6" fill="none" ${ln}/>`;
  return `
    <ellipse cx="25.5" cy="27.5" rx="4.2" ry="5" fill="${C.eyeWhite}" ${ln}/>
    <ellipse cx="38.5" cy="27.5" rx="4.2" ry="5" fill="${C.eyeWhite}" ${ln}/>
    ${spiral(25.5)}${spiral(38.5)}
    <ellipse cx="32" cy="36" rx="3" ry="3.4" fill="${C.mouth}" ${ln}/>
    <path d="M47 12 Q50 16 47.5 18 Q45 16 47 12 Z" fill="#7fdbff" ${ln}/>`;
}

// ---------- SIDE (facing left) ----------

function sideShirt(p, color = C.shirt, shade = C.shirtShade) {
  const b = p.bob;
  return `
  <g transform="translate(0 ${b})">
    <path d="M23 42 Q32 39 41 42 L41 60 Q32 62 23 60 Z" fill="${color}" ${ln}/>
    <path d="M37 42 L41 42 L41 60 L37 60.6 Z" fill="${shade}"/>
    <path d="M27 42.5 L23.5 51 L29 52.5 L31 45 Z" fill="${color}" ${ln}/>
  </g>`;
}

function sideLegs(p) {
  const leg = (dx, front) => {
    const lift = dx < 0 ? -2 : 0;
    return `
    <g transform="translate(${dx} ${lift})">
      <rect x="29" y="64" width="6" height="8" rx="2" fill="${front ? C.skin : C.skinShade}" ${ln}/>
      <path d="M25.5 73.8 Q27 71.5 32 71.5 L36 71.5 Q37.5 72.5 36 75 L27 75 Q25 75 25.5 73.8 Z" fill="${C.sole}" ${ln}/>
      <path d="M27 71.5 L32 70.5" stroke="${C.slipper}" stroke-width="2.2" stroke-linecap="round"/>
    </g>`;
  };
  return leg(-p.legL, false) + leg(-p.legR, true) +
    `<g transform="translate(0 ${p.bob})"><path d="M24 58 L41 58 L41.5 66 L23.5 66 Z" fill="${C.shorts}" ${ln}/></g>`;
}

function sideArm(p) {
  const b = p.bob;
  const o = p.armL;
  return `
    <g transform="rotate(${o * 6} 29 47) translate(0 ${b})">
      <rect x="25.5" y="49" width="5.5" height="8.5" rx="2.5" fill="${C.skin}" ${ln}/>
      <circle cx="28.2" cy="58.5" r="3" fill="${C.skin}" ${ln}/>
    </g>`;
}

function sideHead(p, blink) {
  const b = p.bob;
  const eye = blink
    ? `<path d="M18 28 Q21.5 30.5 25 28" fill="none" ${ln}/>`
    : `<ellipse cx="21.5" cy="27.5" rx="3.6" ry="5" fill="${C.eyeWhite}" ${ln}/>
       <circle cx="20.5" cy="28.4" r="2.4" fill="${C.pupil}"/>
       <circle cx="21.6" cy="26.8" r="0.9" fill="#fff"/>`;
  return `
  <g transform="translate(0 ${b})">
    <rect x="30" y="38" width="6" height="4" fill="${C.skinShade}"/>
    <circle cx="32" cy="24" r="17" fill="${C.skin}" ${ln}/>
    <path d="M15.2 28 Q12.5 30.5 15.6 32" fill="${C.skin}" ${ln}/>
    <path d="M24 8 Q46 4 49 22 Q50 30 46 36 Q43 31 41 28 Q38 22 36 18 L33 21 L30 15 L26 19 L23 15 L18.5 18 Q17 13 24 8 Z" fill="${C.hair}" ${ln}/>
    <circle cx="38" cy="27" r="3.4" fill="${C.skin}" ${ln}/>
    ${eye}
    <path d="M18 21 L24 20.3" ${ln}/>
    <ellipse cx="25.5" cy="33.5" rx="2.6" ry="1.7" fill="${C.blush}" opacity="0.7"/>
    <path d="M17.5 35.5 Q20 36.8 22.5 35.5" fill="none" ${ln}/>
  </g>`;
}

// ---------- BACK (up) ----------

function backShirt(p, color = C.shirt, shade = C.shirtShade) {
  const b = p.bob;
  return `
  <g transform="translate(0 ${b})">
    <path d="M20 42 Q32 38 44 42 L51 50 L46 54 L44 51 L44 60 Q32 62 20 60 L20 51 L18 54 L13 50 Z" fill="${color}" ${ln}/>
    <path d="M20 42 L24 42 L24 61 Q22 60.6 20 60 Z" fill="${shade}"/>
  </g>`;
}

function backHead(p) {
  const b = p.bob;
  return `
  <g transform="translate(0 ${b})">
    <rect x="29" y="38" width="6" height="4" fill="${C.skinShade}"/>
    <circle cx="15.5" cy="27" r="3.4" fill="${C.skin}" ${ln}/>
    <circle cx="48.5" cy="27" r="3.4" fill="${C.skin}" ${ln}/>
    <circle cx="32" cy="24" r="17" fill="${C.hair}" ${ln}/>
    <path d="M17 31 Q32 42 47 31 Q44 39 32 41 Q20 39 17 31 Z" fill="${C.skin}" ${ln}/>
    <path d="M30 9 Q34 4 36 9" fill="none" ${ln}/>
    <path d="M22 13 Q32 8 42 13" fill="none" stroke="${C.hairShine}" stroke-width="2" stroke-linecap="round"/>
  </g>`;
}

// ---------- DEAD (lying face-down, bum up, X eyes) ----------

function deadShirt(color = C.shirt, shade = C.shirtShade) {
  return `<path d="M20 58 Q22 52 30 52 L42 53 Q45 58 42 66 L30 67 Q22 66 20 58 Z" fill="${color}" ${ln}/>
    <path d="M30 62 L42 62 L42 66 L30 67 Z" fill="${shade}"/>`;
}

function deadDetails() {
  return `
    <path d="M42 56 L48 54 L49 64 L42 66 Z" fill="${C.shorts}" ${ln}/>
    <circle cx="46" cy="53" r="6.5" fill="${C.skin}" ${ln}/>
    <circle cx="51" cy="55" r="6.5" fill="${C.skin}" ${ln}/>
    <path d="M48.5 48 L49 58" stroke="${C.skinShade}" stroke-width="1.6"/>
    <circle cx="44" cy="50.5" r="1.4" fill="#fff" opacity="0.8"/>
    <rect x="53" y="59" width="10" height="5" rx="2" fill="${C.skin}" ${ln}/>
    <rect x="52" y="64" width="10" height="5" rx="2" fill="${C.skinShade}" ${ln}/>
    <path d="M24 66 L20 74 L25 75 L27 67 Z" fill="${C.skin}" ${ln}/>
    <circle cx="13" cy="60" r="12" fill="${C.skin}" ${ln}/>
    <path d="M4 54 Q8 46 17 48 Q24 50 24 57 L20 55 L17 58 L14 54 L10 57 Z" fill="${C.hair}" ${ln}/>
    <path d="M6 59 l4 4 m0 -4 l-4 4" ${ln}/>
    <path d="M13 59 l4 4 m0 -4 l-4 4" ${ln}/>
    <path d="M8 67 Q12 69 15 67" fill="none" ${ln}/>
    <path d="M11 67.5 Q12.5 71.5 14 68" fill="${C.tongue}" ${ln}/>`;
}

// ---------- NPC accessories ----------

const NPC = {
  gujju: {
    shirt: "#d4a017",
    shade: "#a77c0a",
    front: `
      <path d="M17 18 Q32 2 47 18 L49 22 L15 22 Z" fill="#d7263d" stroke="${C.line}" stroke-width="2"/>
      <rect x="20" y="24" width="10" height="6" rx="2" fill="#111"/><rect x="34" y="24" width="10" height="6" rx="2" fill="#111"/>
      <path d="M30 27 L34 27" stroke="#111" stroke-width="2"/>
      <path d="M24 44 Q32 54 40 44" fill="none" stroke="#ffd700" stroke-width="2.5" stroke-dasharray="2 1.5"/>
      <circle cx="32" cy="51" r="3" fill="#ffd700" stroke="${C.line}" stroke-width="1.5"/>
      <rect x="48" y="52" width="4" height="9" rx="1.5" fill="#333" stroke="${C.line}" stroke-width="1.5"/>
      <circle cx="50" cy="51" r="3.2" fill="#888" stroke="${C.line}" stroke-width="1.5"/>`,
    side: `
      <path d="M16 18 Q30 2 48 16 L52 20 L44 20 L16 22 Z" fill="#d7263d" stroke="${C.line}" stroke-width="2"/>
      <path d="M44 18 L54 19 L52 22 L44 21 Z" fill="#a51c2e" stroke="${C.line}" stroke-width="1.5"/>
      <rect x="15" y="24" width="10" height="6" rx="2" fill="#111"/>
      <path d="M26 44 Q30 52 34 46" fill="none" stroke="#ffd700" stroke-width="2.5" stroke-dasharray="2 1.5"/>`,
    back: `
      <path d="M17 18 Q32 2 47 18 L49 22 L15 22 Z" fill="#d7263d" stroke="${C.line}" stroke-width="2"/>
      <path d="M26 20 L38 20 L36 26 L28 26 Z" fill="#a51c2e" stroke="${C.line}" stroke-width="1.5"/>`,
  },
  warden: {
    shirt: "#1f3a93",
    shade: "#162a6b",
    front: `
      <path d="M15 17 Q32 4 49 17 L49 20 L15 20 Z" fill="#0b1a4a" stroke="${C.line}" stroke-width="2"/>
      <path d="M13 20 L51 20 L47 23 L17 23 Z" fill="#111" stroke="${C.line}" stroke-width="1.5"/>
      <circle cx="32" cy="13" r="2.5" fill="#ffd700"/>
      <path d="M24 34 Q28 31 32 33 Q36 31 40 34 Q36 35 32 34 Q28 35 24 34 Z" fill="#3b2a1a" stroke="${C.line}" stroke-width="1"/>
      <rect x="36" y="46" width="5" height="6" rx="1" fill="#ffd700" stroke="${C.line}" stroke-width="1.2"/>
      <path d="M26 42 Q24 50 22 52" fill="none" stroke="#ddd" stroke-width="1.5"/>
      <rect x="19" y="51" width="5" height="3" rx="1" fill="#c0c0c0" stroke="${C.line}" stroke-width="1"/>`,
    side: `
      <path d="M17 17 Q32 4 48 15 L48 19 L17 20 Z" fill="#0b1a4a" stroke="${C.line}" stroke-width="2"/>
      <path d="M10 20 L30 19 L28 22 L12 23 Z" fill="#111" stroke="${C.line}" stroke-width="1.5"/>
      <path d="M15 34 Q19 31 23 34 Q19 35 15 34 Z" fill="#3b2a1a" stroke="${C.line}" stroke-width="1"/>`,
    back: `
      <path d="M15 17 Q32 4 49 17 L49 21 L15 21 Z" fill="#0b1a4a" stroke="${C.line}" stroke-width="2"/>`,
  },
};

// ---------- Frame assembly ----------

const ROW = { down: 0, side: 1, up: 2, special: 3 };

/** Returns { shirt, details } SVG fragments for one frame (local coords). */
function frame(row, col, npc) {
  const shirtColor = npc ? NPC[npc].shirt : C.shirt;
  const shirtShade = npc ? NPC[npc].shade : C.shirtShade;
  const blink = col === 1;
  const phase = col >= 2 ? col - 2 : -1;
  const p = pose(phase);
  const acc = (view) => (npc ? `<g transform="translate(0 ${p.bob})">${NPC[npc][view]}</g>` : "");
  if (row === ROW.down) {
    return {
      shirt: frontShirt(p, shirtColor, shirtShade),
      details: frontLegs(p) + frontArms(p) + frontHead(p, faceNormal(blink)) + acc("front"),
    };
  }
  if (row === ROW.side) {
    return {
      shirt: sideShirt(p, shirtColor, shirtShade),
      details: sideLegs(p) + sideHead(p, blink) + sideArm(p) + acc("side"),
    };
  }
  if (row === ROW.up) {
    return {
      shirt: backShirt(p, shirtColor, shirtShade),
      details: frontLegs(p) + frontArms(p) + backHead(p) + acc("back"),
    };
  }
  // Specials.
  if (col === 0) {
    const still = pose(-1);
    return {
      shirt: frontShirt(still, shirtColor, shirtShade),
      details: frontLegs(still) + frontArms(still) + frontHead(still, faceDizzy()) + acc("front"),
    };
  }
  if (col === 1) return { shirt: deadShirt(shirtColor, shirtShade), details: deadDetails() };
  return { shirt: "", details: "" };
}

function sheet(layer, npc) {
  let body = "";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const f = frame(r, c, npc);
      const content = layer === "shirt" ? f.shirt : layer === "details" ? f.details : f.shirt + f.details;
      if (!content) continue;
      body += `\n<g id="r${r}c${c}" transform="translate(${c * FW} ${r * FH})">${content}\n</g>`;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Hostel sprite sheet: ${COLS} columns x ${ROWS} rows of ${FW}x${FH} frames. See README.md in this folder. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * FW}" height="${ROWS * FH}" viewBox="0 0 ${COLS * FW} ${ROWS * FH}">${body}
</svg>
`;
}

const files = {
  "player-shirt.svg": sheet("shirt"),
  "player-details.svg": sheet("details"),
  "gujju.svg": sheet("both", "gujju"),
  "warden.svg": sheet("both", "warden"),
};

const force = process.argv.includes("--force");
fs.mkdirSync(outDir, { recursive: true });
for (const [name, svg] of Object.entries(files)) {
  const file = path.join(outDir, name);
  if (fs.existsSync(file) && !force) {
    console.log(`skip ${name} (exists; use --force to overwrite your edits)`);
    continue;
  }
  fs.writeFileSync(file, svg);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
