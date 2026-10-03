// The Gujju Rapper: a computer-controlled killer who lives in his home room
// (characters.json `home`, room 303) and appears from GUJJU_MIN_PLAYERS.
//
//   idle      sits in his room, never leaves on his own.
//   awake     someone opened the task in his room (the door knock). He shouts
//             and, GUJJU_REACT_SECONDS later, drops the beat...
//   beat      everyone within stunRadius tiles on his floor is stunned for
//             stunSeconds, killers included (ghosts and hiders aren't).
//   hunting   he walks to the knocker (or the closest stunned victim) and
//             finishes them (butt-crush). Shielded / spawn-protected players
//             are safe. One kill per beat.
//   returning walks home, then idle again. abilityCooldown between beats.
//
// He doesn't count as a player for the win check and can't be killed.

import {
  BASE_SPEED_PX_PER_SEC,
  GUJJU_KILL_RANGE_TILES,
  GUJJU_REACT_SECONDS,
  PLAYER_RADIUS_PX,
  TICK_DT,
  TILE_SIZE,
} from "../../shared/constants";
import { character, GUJJU_RAPPER_ID } from "../../shared/characters";
import type { CharacterDef } from "../../shared/characters";
import type { Area, HostelMap } from "../../shared/buildMap";
import { stepMovement } from "../../shared/physics";
import type { FxMessage, Vec2 } from "../../shared/types";
import { Npc } from "../schema/GameState";
import type { GameState, Player } from "../schema/GameState";
import type { CombatSystem } from "./combat";

const MS = 1000;
const NPC_ID = "npc-gujju";
const FINISHER = "butt-crush";
/** Close enough to home to stop walking. */
const HOME_EPSILON_PX = 3;

type Mood = "idle" | "awake" | "hunting" | "returning";

export class GujjuSystem {
  private npc: Npc | null = null;
  private def: CharacterDef = character(GUJJU_RAPPER_ID)!;
  private home: Vec2 = { x: 0, y: 0 };
  private homeArea: Area | null = null;
  private mood: Mood = "idle";
  private reactAt = 0;
  private huntUntil = 0;
  private nextBeatAt = 0;
  private targetId = "";

  constructor(
    private state: GameState,
    private map: HostelMap,
    private combat: CombatSystem,
    private fx: (msg: FxMessage) => void,
  ) {}

  get active(): boolean {
    return this.npc !== null;
  }

  /** Area key of his room ("F2:303"). */
  get homeKey(): string {
    return this.homeArea?.key ?? "";
  }

  spawn(): void {
    this.despawn();
    const ref = this.def.home ?? "F2:303";
    const m = /^F(\d+):(.+)$/.exec(ref);
    const floor = m ? this.map.floors.get(Number(m[1])) : undefined;
    const area = floor?.areas.find((a) => a.id === m?.[2]);
    if (!floor || !area) return;
    this.homeArea = area;
    this.home = this.pickHomeSpot(floor.id, area);
    const npc = new Npc();
    npc.id = NPC_ID;
    npc.name = this.def.name;
    npc.floor = floor.id;
    npc.x = this.home.x;
    npc.y = this.home.y;
    npc.mood = "idle";
    this.state.npcs.set(NPC_ID, npc);
    this.npc = npc;
    this.mood = "idle";
    this.nextBeatAt = 0;
  }

  despawn(): void {
    this.state.npcs.clear();
    this.npc = null;
    this.mood = "idle";
  }

  /** A walkable tile in his room, away from the task station and vent, near the middle. */
  private pickHomeSpot(floorId: number, area: Area): Vec2 {
    const floor = this.map.floors.get(floorId)!;
    const avoid = [...floor.tasks, ...floor.vents].filter((o) => o.area === area.key);
    const { x, y, w, h } = area.rect;
    let best: Vec2 = { x: (x + w / 2) * TILE_SIZE, y: (y + h / 2) * TILE_SIZE };
    let bestScore = Infinity;
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (floor.grid.solid[ty * floor.grid.width + tx]) continue;
        const c = { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
        if (avoid.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < TILE_SIZE * 1.5)) continue;
        const score = Math.hypot(c.x - (x + w / 2) * TILE_SIZE, c.y - (y + h / 2) * TILE_SIZE);
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    return best;
  }

  /** Someone opened the task in his room. */
  onKnock(knocker: Player, now: number): void {
    if (!this.npc || this.mood !== "idle" || now < this.nextBeatAt) return;
    this.mood = "awake";
    this.npc.mood = "awake";
    this.reactAt = now + GUJJU_REACT_SECONDS * MS;
    this.targetId = knocker.id;
    this.fx({ kind: "gujju-awake", floor: this.npc.floor, x: this.npc.x, y: this.npc.y });
  }

  tick(now: number): void {
    const npc = this.npc;
    if (!npc) return;
    switch (this.mood) {
      case "awake":
        if (now >= this.reactAt) this.dropTheBeat(npc, now);
        break;
      case "hunting": {
        const target = this.pickTarget(npc);
        if (!target || now > this.huntUntil) {
          this.setMood("returning");
          break;
        }
        const reach = GUJJU_KILL_RANGE_TILES * TILE_SIZE + PLAYER_RADIUS_PX * 2;
        if (Math.hypot(target.x - npc.x, target.y - npc.y) <= reach) {
          this.combat.kill(target, null, Math.atan2(target.y - npc.y, target.x - npc.x), FINISHER);
          this.setMood("returning");
        } else {
          this.walkTowards(npc, target);
        }
        break;
      }
      case "returning":
        if (Math.hypot(this.home.x - npc.x, this.home.y - npc.y) <= HOME_EPSILON_PX) {
          npc.x = this.home.x;
          npc.y = this.home.y;
          this.setMood("idle");
        } else {
          this.walkTowards(npc, this.home);
        }
        break;
      case "idle":
        break;
    }
  }

  private setMood(mood: Mood): void {
    this.mood = mood;
    if (this.npc) this.npc.mood = mood;
  }

  private dropTheBeat(npc: Npc, now: number): void {
    const radius = (this.def.stunRadius ?? 4) * TILE_SIZE;
    const ms = (this.def.stunSeconds ?? 3) * MS;
    this.state.players.forEach((p) => {
      if (!p.alive || p.hidden || p.venting || p.floor !== npc.floor) return;
      if (Math.hypot(p.x - npc.x, p.y - npc.y) <= radius + PLAYER_RADIUS_PX) this.combat.stun(p, ms, now);
    });
    this.fx({ kind: "beat", floor: npc.floor, x: npc.x, y: npc.y, radius });
    this.nextBeatAt = now + (this.def.abilityCooldown ?? 20) * MS;
    this.huntUntil = now + ms;
    this.setMood("hunting");
  }

  /** The knocker if they're stunned and killable, else the closest stunned victim. */
  private pickTarget(npc: Npc): Player | null {
    const ok = (p: Player | undefined): p is Player =>
      !!p && p.stunned && p.floor === npc.floor && this.combat.isVictim(p);
    const knocker = this.state.players.get(this.targetId);
    if (ok(knocker)) return knocker;
    let best: Player | null = null;
    let bestD = Infinity;
    this.state.players.forEach((p) => {
      if (!ok(p)) return;
      const d = Math.hypot(p.x - npc.x, p.y - npc.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    });
    return best;
  }

  private walkTowards(npc: Npc, target: Vec2): void {
    const grid = this.map.floors.get(npc.floor)?.grid;
    if (!grid) return;
    const dx = target.x - npc.x;
    const dy = target.y - npc.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    const speed = BASE_SPEED_PX_PER_SEC * this.def.speed;
    const step = Math.min(1, d / (speed * TICK_DT));
    const next = stepMovement(grid, npc, { x: (dx / d) * step, y: (dy / d) * step }, speed, TICK_DT, PLAYER_RADIUS_PX);
    npc.x = next.x;
    npc.y = next.y;
  }
}
