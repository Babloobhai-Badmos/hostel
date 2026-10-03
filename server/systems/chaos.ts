// Chaos events: one at a time, every CHAOS_MIN..MAX seconds while a round
// is playing. Cosmetic or mildly disruptive, never an instant kill.
//
//   warden     a Warden NPC patrols the corridors of the busiest floor for
//              WARDEN_SECONDS. Anyone caught in his flashlight cone (killers
//              too) is stunned for WARDEN_STUN_SECONDS.
//   lights     crew see only LIGHTS_OUT_FRONT/BACK_TILES ahead/behind (client side); killers unaffected.
//   foodfight  purely visual: banner and laddus flying across the screen.
//   powercut   door gaps flicker and BZZZT (purely cosmetic).
//
// The running event is synced as `state.chaos`; clients draw the rest.

import {
  BASE_SPEED_PX_PER_SEC,
  CHAOS_DEBUG_SECONDS,
  CHAOS_MAX_SECONDS,
  CHAOS_MIN_SECONDS,
  FOOD_FIGHT_SECONDS,
  LIGHTS_OUT_SECONDS,
  PLAYER_RADIUS_PX,
  POWER_CUT_SECONDS,
  TICK_DT,
  TILE_SIZE,
  WARDEN_CONE_DEG,
  WARDEN_CONE_TILES,
  WARDEN_RESTUN_SECONDS,
  WARDEN_SECONDS,
  WARDEN_SPEED_MULTIPLIER,
  WARDEN_STUN_SECONDS,
} from "../../shared/constants";
import type { FloorMap, HostelMap } from "../../shared/buildMap";
import { hasLineOfSight, stepMovement } from "../../shared/physics";
import { ChaosKind } from "../../shared/types";
import type { FxMessage, Vec2 } from "../../shared/types";
import { Npc } from "../schema/GameState";
import type { GameState } from "../schema/GameState";
import type { CombatSystem } from "./combat";

const MS = 1000;
const WARDEN_ID = "npc-warden";
/** The warden picks a new corridor destination at least this many tiles away. */
const WARDEN_MIN_LEG_TILES = 12;

const DURATION_S: Record<Exclude<ChaosKind, "">, number> = {
  warden: WARDEN_SECONDS,
  lights: LIGHTS_OUT_SECONDS,
  foodfight: FOOD_FIGHT_SECONDS,
  powercut: POWER_CUT_SECONDS,
};
const ALL_KINDS = Object.keys(DURATION_S) as Exclude<ChaosKind, "">[];

export class ChaosSystem {
  private nextAt = 0;
  private endsAt = 0;
  private kinds: Exclude<ChaosKind, "">[] = ALL_KINDS;
  private debugInterval = false;
  private warden: Npc | null = null;
  private path: Vec2[] = [];
  private lastStun = new Map<string, number>();

  constructor(
    private state: GameState,
    private map: HostelMap,
    private combat: CombatSystem,
    private fx: (msg: FxMessage) => void,
  ) {}

  /** Debug rooms: `option` is "all" or one event id; events then come every CHAOS_DEBUG_SECONDS. */
  setDebug(option: string): void {
    if (!option) return;
    this.debugInterval = true;
    this.kinds = ALL_KINDS.includes(option as never) ? [option as Exclude<ChaosKind, "">] : ALL_KINDS;
  }

  private scheduleNext(now: number): void {
    const s = this.debugInterval
      ? CHAOS_DEBUG_SECONDS
      : CHAOS_MIN_SECONDS + Math.random() * (CHAOS_MAX_SECONDS - CHAOS_MIN_SECONDS);
    this.nextAt = now + s * MS;
  }

  startRound(now: number): void {
    this.stop();
    this.scheduleNext(now);
  }

  /** End whatever is running (round over). */
  stop(): void {
    this.state.chaos = ChaosKind.None;
    this.state.npcs.delete(WARDEN_ID);
    this.warden = null;
    this.path = [];
    this.lastStun.clear();
    this.endsAt = 0;
  }

  tick(now: number): void {
    if (this.state.chaos !== ChaosKind.None) {
      if (now >= this.endsAt) {
        this.stop();
        this.scheduleNext(now);
        return;
      }
      if (this.state.chaos === ChaosKind.Warden) this.tickWarden(now);
      return;
    }
    if (now >= this.nextAt) this.begin(this.kinds[Math.floor(Math.random() * this.kinds.length)], now);
  }

  private begin(kind: Exclude<ChaosKind, "">, now: number): void {
    this.state.chaos = kind;
    this.endsAt = now + DURATION_S[kind] * MS;
    if (kind === ChaosKind.Warden) this.spawnWarden();
  }

  // ---------- Warden ----------

  /** The floor with the most living players (spawn floor on a tie). */
  private busiestFloor(): FloorMap {
    const counts = new Map<number, number>();
    this.state.players.forEach((p) => {
      if (p.alive && p.connected) counts.set(p.floor, (counts.get(p.floor) ?? 0) + 1);
    });
    let best = this.map.spawnFloor;
    for (const [floor, n] of counts) if (n > (counts.get(best) ?? 0)) best = floor;
    return this.map.floors.get(best)!;
  }

  private corridorTiles(floor: FloorMap): Vec2[] {
    const out: Vec2[] = [];
    const { width, height, solid } = floor.grid;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = floor.areaIndex[y * width + x];
        if (a >= 0 && floor.areas[a].corridor && !solid[y * width + x]) out.push({ x, y });
      }
    }
    return out;
  }

  private spawnWarden(): void {
    const floor = this.busiestFloor();
    const tiles = this.corridorTiles(floor);
    if (tiles.length === 0) return;
    const start = tiles[Math.floor(Math.random() * tiles.length)];
    const npc = new Npc();
    npc.id = WARDEN_ID;
    npc.kind = "warden";
    npc.name = "Warden";
    npc.mood = "patrol";
    npc.floor = floor.id;
    npc.x = (start.x + 0.5) * TILE_SIZE;
    npc.y = (start.y + 0.5) * TILE_SIZE;
    this.state.npcs.set(WARDEN_ID, npc);
    this.warden = npc;
    this.path = [];
  }

  /** Breadth-first path through corridor tiles to a random far-away corridor tile. */
  private newLeg(npc: Npc): void {
    const floor = this.map.floors.get(npc.floor)!;
    const { width } = floor.grid;
    const isCorridor = (x: number, y: number) => {
      const i = y * width + x;
      const a = floor.areaIndex[i];
      return a >= 0 && floor.areas[a].corridor && !floor.grid.solid[i];
    };
    const sx = Math.floor(npc.x / TILE_SIZE);
    const sy = Math.floor(npc.y / TILE_SIZE);
    const prev = new Map<number, number>([[sy * width + sx, -1]]);
    const queue = [sy * width + sx];
    const far: number[] = [];
    while (queue.length) {
      const k = queue.shift()!;
      const x = k % width;
      const y = Math.floor(k / width);
      if (Math.abs(x - sx) + Math.abs(y - sy) >= WARDEN_MIN_LEG_TILES) far.push(k);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const nk = ny * width + nx;
        if (prev.has(nk) || !isCorridor(nx, ny)) continue;
        prev.set(nk, k);
        queue.push(nk);
      }
    }
    if (far.length === 0) return;
    const path: Vec2[] = [];
    for (let c = far[Math.floor(Math.random() * far.length)]; c !== -1; c = prev.get(c)!) {
      path.unshift({ x: ((c % width) + 0.5) * TILE_SIZE, y: (Math.floor(c / width) + 0.5) * TILE_SIZE });
    }
    this.path = path;
  }

  private tickWarden(now: number): void {
    const npc = this.warden;
    if (!npc) return;
    if (this.path.length === 0) this.newLeg(npc);
    const target = this.path[0];
    if (target) {
      const dx = target.x - npc.x;
      const dy = target.y - npc.y;
      const d = Math.hypot(dx, dy);
      const speed = BASE_SPEED_PX_PER_SEC * WARDEN_SPEED_MULTIPLIER;
      if (d <= speed * TICK_DT) {
        npc.x = target.x;
        npc.y = target.y;
        this.path.shift();
      } else {
        const grid = this.map.floors.get(npc.floor)!.grid;
        const next = stepMovement(grid, npc, { x: dx / d, y: dy / d }, speed, TICK_DT, PLAYER_RADIUS_PX);
        npc.x = next.x;
        npc.y = next.y;
        npc.facing = Math.atan2(dy, dx);
      }
    }

    // Flashlight: stun anyone alive in the cone with a clear line of sight.
    const grid = this.map.floors.get(npc.floor)!.grid;
    const reach = WARDEN_CONE_TILES * TILE_SIZE;
    const half = ((WARDEN_CONE_DEG / 2) * Math.PI) / 180;
    this.state.players.forEach((p) => {
      if (!p.alive || p.hidden || p.venting || p.floor !== npc.floor) return;
      const dx = p.x - npc.x;
      const dy = p.y - npc.y;
      if (dx * dx + dy * dy > reach * reach) return;
      let diff = Math.abs(Math.atan2(dy, dx) - npc.facing) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff > half || !hasLineOfSight(grid, npc.x, npc.y, p.x, p.y)) return;
      if (now - (this.lastStun.get(p.id) ?? -Infinity) < WARDEN_RESTUN_SECONDS * MS) return;
      this.lastStun.set(p.id, now);
      this.combat.stun(p, WARDEN_STUN_SECONDS * MS, now);
      this.fx({ kind: "warden-stun", floor: p.floor, x: p.x, y: p.y });
    });
  }
}
