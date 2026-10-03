# Character sprites

These sheets are the characters you see in the game. Edit them, save, refresh the browser (after `npm start` rebuilds, or `npm run build`). No code changes needed.

## Files

| File | What it is |
| --- | --- |
| `player-shirt.svg` | The players' **T-shirt only**, in white and light grey. The game **tints** this layer with each player's colour (white becomes the colour, grey becomes a darker shade, dark outlines stay dark). |
| `player-details.svg` | **Everything else** on a player: skin, hair, face, arms, shorts, slippers. Never tinted. Drawn on top of the shirt layer. |
| `gujju.svg` | The Gujju Rapper (full colour, one layer). |
| `warden.svg` | The Warden (full colour, one layer). |
| `sprites.json` | The grid size and which file is which. Point it at `.png` files instead if you'd rather paint in PNG. |

Every player is the **same** character (only the shirt colour changes), so killers look exactly like everyone else. Keep it that way: don't put role-specific things in these sheets.

## The grid (same for every file)

Each sheet is **6 columns x 4 rows** of **64 x 80 px** frames (whole sheet 384 x 320).

| Row | Contents |
| --- | --- |
| 0 | Facing **down** (towards the camera) |
| 1 | Facing **left** (the game mirrors this row for walking right) |
| 2 | Facing **up** (back of the head) |
| 3 | Specials: column 0 = **stunned** (dizzy face), column 1 = **dead** (lying face-down: X-eyes, bum up) |

| Column | Contents |
| --- | --- |
| 0 | Standing still |
| 1 | Standing still, eyes closed (blink, shown for a split second every few seconds) |
| 2-5 | Walk cycle, played in order (about 8 frames per second) |

Inside every frame, the **feet touch the ground at y = 76** and the top of the head is around **y = 6** (set as `feetY` / `headTopY` in `sprites.json`). Keep characters inside their own 64 x 80 box and keep the feet on that line, or they'll appear to float or sink.

Players' face photos are drawn on top of the sheets as a circle. `head` in `sprites.json` is where it goes on standing frames (centre x, y and radius r; the photo is drawn 1.2x that size, see `FACE_HEAD_SCALE`), and `deadHead` is the head on the lying-down frame. If you move or resize the head in your edits, update those numbers. Facing up (row 2) never shows the photo.

In the SVGs every frame is its own group named `r<row>c<col>` (for example `r0c2` = facing down, first walk frame), so in Inkscape's *Objects* panel you can find and edit one frame at a time.

## Touching up

- **Inkscape** (free, best for these SVGs): open the file, edit, *File > Save* as Inkscape SVG or Plain SVG. Both work.
- **Krita / Photopea / Photoshop**: open the SVG, paint at 2x (768 x 640) for crispness, export a PNG of the whole sheet, and change the file name in `sprites.json` to your `.png`. The PNG can be 1x or an exact multiple (2x, 3x).
- Rules for the shirt layer: only white, greys and dark outlines. Any colour there gets mixed with the player's colour and looks muddy.
- Keep the background transparent.

## Starting over

`npm run sprites -- --force` regenerates the original sheets from `scripts/makeSprites.mjs`. **This overwrites your edits**, so make a copy first. Without `--force` it only creates files that are missing.

If a sheet is missing or broken, the game quietly falls back to the old round blobs, so you can't break the game by experimenting.
