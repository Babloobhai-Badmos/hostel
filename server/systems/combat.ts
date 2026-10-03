// Combat: killers' melee swings, searching hiding spots, spawn protection,
// and turning victims into bodies + ghosts.
//
// Validation (server-side, never trusting the client):
//  - the attacker is alive, a killer, not hidden/venting/stunned, and off cooldown
//  - the victim is alive, not a killer, not hidden, not `safe` (spawn
//    protection or shield), on the same floor, inside the swing arc, within
//    reach, with no wall in between. Stunned victims CAN be hit.
//
// Also owns the timed statuses: `safe` (spawn protection, shield) and
// `stunned` (the Gujju Rapper's beat).

import {
  ATTACK_REACH_TOLERANCE_TILES,
  SEARCH_COOLDOWN_SECONDS,
  SPAWN_PROTECTION_SECONDS,
  WIDE_SWING_ARC_DEG,
} from "../../shared/constants";
import { attackReachPx, pickAllAttackTargets, pickAttackTarget } from "../../shared/combat";
import type { HideSpot, HostelMap } from "../../shared/buildMap";
import type { KillMessage, SearchMessage } from "../../shared/types";
import { Body, GameState, Player } from "../schema/GameState";
import type { HidingSystem } from "./hiding";
import type { MovementSystem } from "./movement";
import type { RoleSystem } from "./roles";
import { teleport } from "./teleport";

const MS = 1000;

export interface CombatEvents {
  onKill(msg: KillMessage): void;
  onSearch(msg: SearchMessage): void;
}

export class CombatSystem {
  private nextAttackAt = new Map<string, number>();
  private nextSearchAt = new Map<string, number>();
  private safeUntil = new Map<string, number>();
  private stunUntil = new Map<string, number>();
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
    this.stunUntil.clear();
    this.state.players.forEach((p) => {
      p.stunned = false;
      this.safeUntil.set(p.id, now + SPAWN_PROTECTION_SECONDS * MS);
      p.safe = true;
    });
  }

  /** Called every tick: expire protection and stuns. */
  tick(now: number): void {
    for (const [id, until] of this.safeUntil) {
      if (now < until) continue;
      this.safeUntil.delete(id);
      const p = this.state.players.get(id);
      if (p) p.safe = false;
    }
    for (const [id, until] of this.stunUntil) {
      if (now < until) continue;
      this.stunUntil.delete(id);
      const p = this.state.players.get(id);
      if (p) p.stunned = false;
    }
  }

  /** Make a player unkillable for `ms` (shield). Extends, never shortens. */
  protect(p: Player, ms: number, now: number): void {
    this.safeUntil.set(p.id, Math.max(this.safeUntil.get(p.id) ?? 0, now + ms));
    p.safe = true;
  }

  stun(p: Player, ms: number, now: number): void {
    this.stunUntil.set(p.id, Math.max(this.stunUntil.get(p.id) ?? 0, now + ms));
    p.stunned = true;
    this.movement.clearQueue(p.id);
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
    return killer.connected && killer.alive && !killer.hidden && !killer.venting && !killer.stunned && this.roles.isKiller(killer.id);
  }

  /** Can this player be killed right now (by a swing, gas or the Gujju Rapper)? */
  isVictim(p: Player): boolean {
    return p.alive && !p.hidden && !p.venting && !p.safe && !this.roles.isKiller(p.id) && !this.roles.isSpectator(p.id);
  }

  /**
   * Returns how many died. A whiff doesn't use up the cooldown. With `wide`
   * (Kallu Koli's armed wide swing) it hits everyone in a 180 degree arc.
   */
  tryAttack(killer: Player, now: number, wide = false): number {
    if (!this.canAct(killer) || now < (this.nextAttackAt.get(killer.id) ?? 0)) return 0;
    const c = this.roles.get(killer.id)!;
    const grid = this.map.floors.get(killer.floor)?.grid;
    if (!grid) return 0;
    const facing = this.movement.facing(killer.id);
    const range = wide ? c.wideSwingRange ?? c.attackRange ?? 1 : c.attackRange ?? 1;
    const reach = attackReachPx(range, ATTACK_REACH_TOLERANCE_TILES);
    const victims = [...this.state.players.values()].filter((p) => this.isVictim(p));
    const targets = wide
      ? pickAllAttackTargets(grid, killer, facing, reach, victims, WIDE_SWING_ARC_DEG)
      : [pickAttackTarget(grid, killer, facing, reach, victims)].filter((t): t is Player => !!t);
    if (targets.length === 0) return 0;
    this.nextAttackAt.set(killer.id, now + (c.attackCooldown ?? 0) * MS);
    for (const t of targets) this.kill(t, killer, Math.atan2(t.y - killer.y, t.x - killer.x));
    return targets.length;
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

  /** Turn a player into a ghost and leave a body behind. `finisher` overrides the killer's own. */
  kill(victim: Player, killer: Player | null, angle: number, finisher?: string): void {
    this.hiding.exit(victim);
    victim.alive = false;
    victim.safe = false;
    victim.stunned = false;
    victim.dashing = false;
    this.safeUntil.delete(victim.id);
    this.stunUntil.delete(victim.id);
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
    finisher ??= killer ? this.roles.get(killer.id)?.finisher ?? "thwack" : "thwack";
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

  /** Bring a dead player back to life where their body lies. */
  revive(victim: Player, bodyId: string): void {
    const body = this.state.bodies.get(bodyId);
    if (!body) return;
    this.state.bodies.delete(bodyId);
    victim.alive = true;
    teleport(victim, body.floor, body.x, body.y, this.movement);
  }

  removePlayer(id: string): void {
    this.nextAttackAt.delete(id);
    this.stunUntil.delete(id);
    this.nextSearchAt.delete(id);
    this.safeUntil.delete(id);
  }
}
