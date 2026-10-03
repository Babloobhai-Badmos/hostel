// `npm run map`: validates layout.json + tasks.json and prints each floor as
// ASCII so you can check a layout change without starting the game.
//
//   #  wall          .  floor           =  corridor
//   F  furniture     H  hiding spot     V  vent
//   S  stairs zone   T  task station    *  spawn marker

import { TILE_SIZE } from "../shared/constants";

try {
  const { hostelMap } = await import("../shared/world");
  for (const floor of hostelMap.floors.values()) {
    const { width, height, solid } = floor.grid;
    const rows: string[][] = [];
    for (let y = 0; y < height; y++) {
      const row: string[] = [];
      for (let x = 0; x < width; x++) {
        const a = floor.areaIndex[y * width + x];
        row.push(solid[y * width + x] ? (a >= 0 ? "F" : "#") : a >= 0 && floor.areas[a].corridor ? "=" : ".");
      }
      rows.push(row);
    }
    const put = (px: number, py: number, ch: string) => {
      rows[Math.floor(py / TILE_SIZE)][Math.floor(px / TILE_SIZE)] = ch;
    };
    for (const s of floor.stairs) {
      for (let y = s.zone.y; y < s.zone.y + s.zone.h; y += TILE_SIZE)
        for (let x = s.zone.x; x < s.zone.x + s.zone.w; x += TILE_SIZE) put(x, y, "S");
    }
    for (const h of floor.hides) put(h.x, h.y, "H");
    for (const v of floor.vents) put(v.x, v.y, "V");
    for (const t of floor.tasks) put(t.x, t.y, "T");
    if (floor.id === hostelMap.spawnFloor) for (const s of hostelMap.spawns) put(s.x, s.y, "*");

    console.log(`\n${floor.name} (F${floor.id})  ${width}x${height} tiles`);
    console.log(rows.map((r) => r.join("")).join("\n"));
    const rooms = floor.areas.filter((a) => !a.corridor).map((a) => a.label);
    console.log(`Rooms: ${rooms.join(", ")}`);
    console.log(`Hiding spots: ${floor.hides.length}  Vents: ${floor.vents.length}  Tasks: ${floor.tasks.map((t) => t.taskId).join(", ") || "none"}`);
  }
  console.log("\nLayout OK.");
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
