// Combat: killers' melee swings, searching hiding spots, spawn protection,
// and turning victims into bodies + ghosts.
//
// Validation (server-side, never trusting the client):
//  - the attacker is alive, a killer, not hidden/venting, and off cooldown
//  - the victim is alive, not a killer, not hidden, not `safe`, on the same
//    floor, inside the swing arc, within reach, with no wall in between.

import {
  ATTACK_REACH_TOLERANCE_TILES,
  SEARCH_COOLDOWN_SECONDS,
  SPAWN_PROTECTION_SECONDS,
} from "../../shared/constants";
import { attackReachPx, pickAttackTarget } from "../../shared/combat";
import type { HideSpot, HostelMap } from "../../shared/buildMap";
import type { KillMessage, SearchMessage } from "../../shared/types";
import { Body, GameState, Player } from "../schema/GameState";
import type { HidingSystem } from "./hiding";
import type { MovementSystem } from "./movement";
import type { RoleSystem } from "./roles";

const MS = 1000;

export interface CombatEvents {
  onKill(msg: KillMessage): void;
  onSearch(msg: SearchMessage): void;
}

export class CombatSystem {
  private nextAttackAt = new Map<string, number>();
  private nextSearchAt = new Map<string, number>();
  private safeUntil = new Map<string, number>();
  private kills = new Map<string, number>();
  private bodyCounter = 0;

  constructor(
    private state: GameState,
    private map: HostelMap,
    private roles: RoleSystem,
    private movement: MovementSystem,
    private hiding: HidingSystem,
    private events: CombatEvents,
  ) {}

  /** Round start: clear cooldowns and give everyone spawn protection. */
  startRound(now: number): void {
    this.nextAttackAt.clear();
    this.nextSearchAt.clear();
    this.kills.clear();
    this.safeUntil.clear();
    this.state.players.forEach((p) => {
      this.safeUntil.set(p.id, now + SPAWN_PROTECTION_SECONDS * MS);
      p.safe = true;
    });
  }

  /** Called every tick: expire spawn protection. */
  tick(now: number): void {
    for (const [id, until] of this.safeUntil) {
      if (now < until) continue;
      this.safeUntil.delete(id);
      const p = this.state.players.get(id);
      if (p) p.safe = false;
    }
  }

  killsOf(id: string): number {
    return this.kills.get(id) ?? 0;
  }

  attackReadyIn(id: string, now: number): number {
    return Math.max(0, (this.nextAttackAt.get(id) ?? 0) - now);
  }

  searchReadyIn(id: string, now: number): number {
    return Math.max(0, (this.nextSearchAt.get(id) ?? 0) - now);
  }

  protectionLeft(id: string, now: number): number {
    return Math.max(0, (this.safeUntil.get(id) ?? 0) - now);
  }

  private canAct(killer: Player): boolean {
    return killer.connected && killer.alive && !killer.hidden && !killer.venting && this.roles.isKiller(killer.id);
  }

  private isVictim(p: Player): boolean {
    return p.alive && !p.hidden && !p.venting && !p.safe && !this.roles.isKiller(p.id) && !this.roles.isSpectator(p.id);
  }

  /** Returns true if someone died. A whiff doesn't use up the cooldown. */
  tryAttack(killer: Player, now: number): boolean {
    if (!this.canAct(killer) || now < (this.nextAttackAt.get(killer.id) ?? 0)) return false;
    const c = this.roles.get(killer.id)!;
    const grid = this.map.floors.get(killer.floor)?.grid;
    if (!grid) return false;
    const facing = this.movement.facing(killer.id);
    const reach = attackReachPx(c.attackRange ?? 1, ATTACK_REACH_TOLERANCE_TILES);
    const victims = [...this.state.players.values()].filter((p) => this.isVictim(p));
    const target = pickAttackTarget(grid, killer, facing, reach, victims);
    if (!target) return false;
    this.nextAttackAt.set(killer.id, now + (c.attackCooldown ?? 0) * MS);
    this.kill(target, killer, Math.atan2(target.y - killer.y, target.x - killer.x));
    return true;
  }

  /** Killer searches a hiding spot. Anyone inside is dragged out and killed (unless protected). */
  trySearch(killer: Player, spot: HideSpot, now: number): boolean {
    if (!this.canAct(killer) || now < (this.nextSearchAt.get(killer.id) ?? 0)) return false;
    this.nextSearchAt.set(killer.id, now + SEARCH_COOLDOWN_SECONDS * MS);
    const occupantId = this.hiding.occupantOf(spot.id);
    const victim = occupantId ? this.state.players.get(occupantId) : undefined;
    this.events.onSearch({ floor: spot.floor, x: spot.x, y: spot.y, found: !!victim });
    if (!victim) return true;
    this.hiding.exit(victim);
    if (this.isVictim(victim)) this.kill(victim, killer, Math.atan2(victim.y - killer.y, victim.x - killer.x));
    return true;
  }

  /** Turn a player into a ghost and leave a body behind. */
  kill(victim: Player, killer: Player | null, angle: number): void {
    this.hiding.exit(victim);
    victim.alive = false;
    victim.safe = false;
    this.movement.clearQueue(victim.id);

    const body = new Body();
    body.id = `body-${++this.bodyCounter}`;
    body.victimId = victim.id;
    body.color = victim.color;
    body.floor = victim.floor;
    body.x = victim.x;
    body.y = victim.y;
    this.state.bodies.set(body.id, body);

    if (killer) this.kills.set(killer.id, this.killsOf(killer.id) + 1);
    const finisher = killer ? this.roles.get(killer.id)?.finisher ?? "thwack" : "thwack";
    this.events.onKill({
      victimId: victim.id,
      victimName: victim.name,
      floor: victim.floor,
      x: victim.x,
      y: victim.y,
      angle,
      finisher,
    });
  }

  removePlayer(id: string): void {
    this.nextAttackAt.delete(id);
    this.nextSearchAt.delete(id);
    this.safeUntil.delete(id);
  }
}
