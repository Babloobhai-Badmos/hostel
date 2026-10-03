// Character abilities (ABILITY button / Q), plus the Supreme Leader's revive.
//
//   Arch-Semen    dash        DASH_SECONDS at DASH_SPEED_MULTIPLIER; a hit while dashing counts normally.
//   Kallu Koli    wide-swing  arms the next attack: it hits everyone in a WIDE_SWING_ARC_DEG arc.
//   Mota-dalla    gas         a poison cloud (gasRadius tiles) at his feet for gasSeconds; any
//                             non-killer who is in it (and not protected/hidden) dies. Killers immune.
//   Supreme Leader shield     the closest living player within SHIELD_RANGE_TILES (or yourself)
//                             can't be killed for shieldSeconds.
//                 revive      hold USE on a body for reviveHoldSeconds: they come back to life
//                             where the body lay. Once per round.
//   Laal Jhanda and Hostellers have no ability.
//
// Cooldowns come from characters.json (`abilityCooldown`).

import {
  DASH_SECONDS,
  DASH_SPEED_MULTIPLIER,
  PLAYER_RADIUS_PX,
  REVIVE_RANGE_TILES,
  SHIELD_RANGE_TILES,
  TILE_SIZE,
  WIDE_SWING_ARMED_SECONDS,
} from "../../shared/constants";
import type { FxMessage } from "../../shared/types";
import { Gas } from "../schema/GameState";
import type { GameState, Player } from "../schema/GameState";
import type { CombatSystem } from "./combat";
import type { MovementSystem } from "./movement";
import type { RoleSystem } from "./roles";

const MS = 1000;
/** Gas finisher name (effects text on the client). */
const GAS_FINISHER = "gas";

interface GasCloud {
  ownerId: string;
  until: number;
}

export class AbilitySystem {
  private nextAt = new Map<string, number>();
  private dashUntil = new Map<string, number>();
  private wideUntil = new Map<string, number>();
  private reviveUsed = new Set<string>();
  /** saviorId -> body being revived and when the hold started. */
  private reviving = new Map<string, { bodyId: string; startedAt: number }>();
  private clouds = new Map<string, GasCloud>();
  private gasCounter = 0;

  constructor(
    private state: GameState,
    private roles: RoleSystem,
    private movement: MovementSystem,
    private combat: CombatSystem,
    private fx: (msg: FxMessage) => void,
  ) {}

  reset(): void {
    this.nextAt.clear();
    this.dashUntil.clear();
    this.wideUntil.clear();
    this.reviveUsed.clear();
    this.reviving.clear();
    this.clouds.clear();
    this.state.gas.clear();
    this.state.players.forEach((p) => (p.dashing = false));
  }

  readyIn(id: string, now: number): number {
    return Math.max(0, (this.nextAt.get(id) ?? 0) - now);
  }

  isWideArmed(id: string, now: number): boolean {
    return (this.wideUntil.get(id) ?? 0) > now;
  }

  consumeWide(id: string): void {
    this.wideUntil.delete(id);
  }

  hasRevive(id: string): boolean {
    return !!this.roles.get(id)?.revive && !this.reviveUsed.has(id);
  }

  speedMultiplier(id: string, now: number): number {
    return (this.dashUntil.get(id) ?? 0) > now ? DASH_SPEED_MULTIPLIER : 1;
  }

  /** ABILITY pressed. Returns true if something happened. */
  use(p: Player, now: number): boolean {
    const c = this.roles.get(p.id);
    if (!c?.ability || !p.alive || p.hidden || p.venting || p.stunned) return false;
    if (now < (this.nextAt.get(p.id) ?? 0)) return false;

    switch (c.ability) {
      case "dash":
        this.dashUntil.set(p.id, now + DASH_SECONDS * MS);
        p.dashing = true;
        this.fx({ kind: "dash", floor: p.floor, x: p.x, y: p.y, angle: this.movement.facing(p.id) });
        break;
      case "wide-swing":
        this.wideUntil.set(p.id, now + WIDE_SWING_ARMED_SECONDS * MS);
        break;
      case "poisonous-smell": {
        const id = `gas-${++this.gasCounter}`;
        const gas = new Gas();
        gas.id = id;
        gas.floor = p.floor;
        gas.x = p.x;
        gas.y = p.y;
        gas.radius = (c.gasRadius ?? 1.5) * TILE_SIZE;
        this.state.gas.set(id, gas);
        this.clouds.set(id, { ownerId: p.id, until: now + (c.gasSeconds ?? 4) * MS });
        this.fx({ kind: "gas", floor: p.floor, x: p.x, y: p.y, radius: gas.radius });
        break;
      }
      case "shield": {
        const target = this.closestLiving(p, SHIELD_RANGE_TILES * TILE_SIZE) ?? p;
        this.combat.protect(target, (c.shieldSeconds ?? 5) * MS, now);
        this.fx({ kind: "shield", floor: target.floor, x: target.x, y: target.y });
        break;
      }
      default:
        return false;
    }
    this.nextAt.set(p.id, now + (c.abilityCooldown ?? 0) * MS);
    return true;
  }

  private closestLiving(from: Player, rangePx: number): Player | null {
    let best: Player | null = null;
    let bestD = rangePx * rangePx;
    this.state.players.forEach((q) => {
      if (q.id === from.id || !q.alive || q.floor !== from.floor || q.hidden || q.venting) return;
      const d = (q.x - from.x) ** 2 + (q.y - from.y) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = q;
      }
    });
    return best;
  }

  /** Supreme Leader starts holding USE on a body (already validated in range by useTarget). */
  reviveStart(p: Player, bodyId: string, now: number): void {
    if (!this.hasRevive(p.id) || !p.alive || p.stunned) return;
    this.reviving.set(p.id, { bodyId, startedAt: now });
  }

  reviveCancel(id: string): void {
    this.reviving.delete(id);
  }

  tick(now: number): void {
    // Dash ends.
    for (const [id, until] of this.dashUntil) {
      if (now < until) continue;
      this.dashUntil.delete(id);
      const p = this.state.players.get(id);
      if (p) p.dashing = false;
    }

    // Gas: kill anyone (non-killer, unprotected) standing in a cloud; fade old clouds.
    for (const [gasId, cloud] of this.clouds) {
      const gas = this.state.gas.get(gasId);
      if (!gas || now >= cloud.until) {
        this.clouds.delete(gasId);
        this.state.gas.delete(gasId);
        continue;
      }
      const owner = this.state.players.get(cloud.ownerId) ?? null;
      const reach = gas.radius + PLAYER_RADIUS_PX;
      this.state.players.forEach((p) => {
        if (p.floor !== gas.floor || !this.combat.isVictim(p)) return;
        if ((p.x - gas.x) ** 2 + (p.y - gas.y) ** 2 > reach * reach) return;
        this.combat.kill(p, owner, Math.atan2(p.y - gas.y, p.x - gas.x), GAS_FINISHER);
      });
    }

    // Revives: keep holding, stay close, stay alive and unstunned.
    for (const [saviorId, session] of this.reviving) {
      const savior = this.state.players.get(saviorId);
      const body = this.state.bodies.get(session.bodyId);
      const victim = body ? this.state.players.get(body.victimId) : undefined;
      const range = REVIVE_RANGE_TILES * TILE_SIZE;
      if (
        !savior || !savior.alive || !savior.connected || savior.stunned || !body || !victim ||
        savior.floor !== body.floor || Math.hypot(savior.x - body.x, savior.y - body.y) > range
      ) {
        this.reviving.delete(saviorId);
        continue;
      }
      const hold = (this.roles.get(saviorId)?.reviveHoldSeconds ?? 3) * MS;
      if (now - session.startedAt < hold) continue;
      this.reviving.delete(saviorId);
      this.reviveUsed.add(saviorId);
      this.combat.revive(victim, body.id);
      this.fx({ kind: "revive", floor: victim.floor, x: victim.x, y: victim.y });
    }
  }

  removePlayer(id: string): void {
    this.nextAt.delete(id);
    this.dashUntil.delete(id);
    this.wideUntil.delete(id);
    this.reviving.delete(id);
  }
}
