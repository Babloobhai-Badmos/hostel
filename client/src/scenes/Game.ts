// The world view: the current floor, players and bodies on it, the vision
// fog, client-side prediction for the local player and interpolation for
// everyone else.
//
// Local player: every INPUT_SEND_MS we sample the controls, send
// { dx, dy, seq } and immediately apply the same step locally (prediction).
// When the server's position + ack for us arrives, we snap to it and replay
// the inputs it hasn't processed yet (reconciliation). A change in `tp`
// (stairs, vents, round start) means a teleport: we snap without sliding.
//
// Who you can see:
//  - Only your own floor is drawn.
//  - Alive: players and bodies within your vision radius (crew 6 tiles,
//    killers half that) with no wall or solid furniture in between. Ghosts,
//    hiders and anyone inside a vent are invisible.
//  - Ghost: everything on your floor, including other ghosts (see-through).

import Phaser from "phaser";
import {
  ATTACK_REACH_TOLERANCE_TILES,
  BASE_SPEED_PX_PER_SEC,
  FOG_ALPHA,
  GHOST_SPEED_MULTIPLIER,
  INPUT_SEND_MS,
  KILLER_VISION_MULTIPLIER,
  PLAYER_COLORS,
  PLAYER_RADIUS_PX,
  TICK_DT,
  TILE_SIZE,
  VIEW_MIN_HEIGHT_TILES,
  VIEW_WIDTH_TILES,
  VISION_RADIUS_TILES,
  VISION_RAYS,
  VISION_WALL_PEEK_PX,
} from "../../../shared/constants";
import { attackReachPx, pickAttackTarget } from "../../../shared/combat";
import type { Combatant } from "../../../shared/combat";
import { useTarget } from "../../../shared/interact";
import type { UseTarget } from "../../../shared/interact";
import { castRay, hasLineOfSight, sanitizeDirection, stepGhost, stepMovement } from "../../../shared/physics";
import { ClientMsg, GamePhase } from "../../../shared/types";
import type { InputMessage, KillMessage, Vec2 } from "../../../shared/types";
import { hostelMap } from "../../../shared/world";
import type { Body, Player } from "../../../server/schema/GameState";
import { KeyboardControls } from "../input/keyboard";
import { InterpolationBuffer } from "../render/interpolation";
import { createFloorView } from "../render/mapRenderer";
import { createCorpseView, createPlayerView } from "../render/placeholderSprites";
import type { PlayerView } from "../render/placeholderSprites";
import { killEffect, searchEffect, ventPopEffect } from "../render/effects";
import { net } from "../net";
import type { HUDScene } from "./HUD";
import { MinigameScene } from "./Minigame";

/** Max inputs sent in one frame when catching up after a hitch. */
const MAX_INPUT_CATCHUP = 3;
/** Opacity of your own body while you're hiding or in a vent (others can't see you at all). */
const HIDDEN_SELF_ALPHA = 0.45;
const GHOST_ALPHA = 0.45;
const OFFLINE_ALPHA = 0.4;
/** Drawn above everything in the world, including effects. */
const FOG_DEPTH = 1_000_000;
/** The fog rectangle extends this far past the camera edges. */
const FOG_MARGIN_PX = 200;
/** A body that appears within this long of its kill message waits for the ragdoll to land. */
const BODY_REVEAL_WAIT_MS = 1500;
/** Spawn-protection bubble. */
const SAFE_RING_COLOR = 0x7fdbff;
/** Glow on your own unfinished task stations. */
const TASK_GLOW_COLOR = 0xffe066;
const TASK_GLOW_PULSE_MS = 800;

interface RemotePlayer {
  view: PlayerView;
  buffer: InterpolationBuffer;
  lastTp: number;
  /** Interpolated position this frame. */
  pos: Vec2;
}

interface BodyView {
  container: Phaser.GameObjects.Container;
  body: Body;
  /** Hidden until the ragdoll animation lands. */
  landed: boolean;
}

export class GameScene extends Phaser.Scene {
  private keyboard!: KeyboardControls;
  private floorViews = new Map<number, Phaser.GameObjects.Container>();
  private remotes = new Map<string, RemotePlayer>();
  private bodies = new Map<string, BodyView>();
  /** victimId -> time of the kill message, so their body waits for the ragdoll. */
  private recentKills = new Map<string, number>();
  private localView: PlayerView | null = null;
  private safeRing!: Phaser.GameObjects.Arc;
  private fog!: Phaser.GameObjects.Graphics;
  /** taskId -> pulsing glow at its station (shown only for your own unfinished tasks on this floor). */
  private taskGlows = new Map<string, Phaser.GameObjects.Arc>();
  private me: Player | null = null;
  private cleanups: (() => void)[] = [];

  /** Floor currently drawn (= the local player's floor). */
  currentFloor = hostelMap.spawnFloor;

  // Prediction state for the local player.
  private seq = 0;
  private lastTp = -1;
  private pending: InputMessage[] = [];
  private predicted: Vec2 = { x: 0, y: 0 };
  private previous: Vec2 = { x: 0, y: 0 };
  /** Where the local player is drawn this frame. */
  private display: Vec2 = { x: 0, y: 0 };
  private facing = 0;
  private inputAccumulator = 0;
  /** Wall-clock time of the previous frame. Phaser's smoothed delta drifts from real time on slow devices. */
  private lastFrameAt = 0;

  constructor() {
    super("Game");
  }

  create(): void {
    this.remotes.clear();
    this.bodies.clear();
    this.recentKills.clear();
    this.floorViews.clear();
    this.localView = null;
    this.me = null;
    this.lastTp = -1;
    this.pending = [];
    this.inputAccumulator = 0;
    this.lastFrameAt = performance.now();

    for (const floor of hostelMap.floors.values()) {
      this.floorViews.set(floor.id, createFloorView(this, floor).setVisible(false));
    }
    this.showFloor(hostelMap.spawnFloor);
    this.keyboard = new KeyboardControls(this);
    this.safeRing = this.add.circle(0, 0, PLAYER_RADIUS_PX + 6, SAFE_RING_COLOR, 0.15).setStrokeStyle(2, SAFE_RING_COLOR, 0.8).setVisible(false);
    this.fog = this.add.graphics().setDepth(FOG_DEPTH);
    this.taskGlows.clear();
    for (const station of hostelMap.tasks.values()) {
      const glow = this.add
        .circle(station.x, station.y, TILE_SIZE * 0.4, TASK_GLOW_COLOR, 0.5)
        .setStrokeStyle(3, TASK_GLOW_COLOR, 1)
        .setDepth(station.y - TILE_SIZE)
        .setVisible(false);
      this.tweens.add({ targets: glow, scale: 1.6, alpha: 0.1, duration: TASK_GLOW_PULSE_MS, yoyo: true, repeat: -1 });
      this.taskGlows.set(station.taskId, glow);
    }

    this.fitCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this);

    this.bindRoom();
    this.cleanups.push(
      net.on("kill", (msg) => this.onKill(msg)),
      net.on("ventPop", (msg) => msg.floor === this.currentFloor && ventPopEffect(this, msg.x, msg.y)),
      net.on("search", (msg) => msg.floor === this.currentFloor && searchEffect(this, msg.x, msg.y, msg.found)),
      net.on("taskOpen", (msg) => {
        if (!MinigameScene.isOpen(this)) this.scene.launch("Minigame", msg);
      }),
      net.on("taskClose", () => this.scene.stop("Minigame")),
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
      this.cleanups.forEach((fn) => fn());
      this.cleanups = [];
    });
  }

  // ---------- Queries used by the HUD ----------

  /** Where the local player is right now, as the client predicts it. */
  get localState(): { floor: number; x: number; y: number; hidden: boolean; alive: boolean; venting: boolean } | null {
    if (!this.me) return null;
    return {
      floor: this.me.floor,
      x: this.predicted.x,
      y: this.predicted.y,
      hidden: this.me.hidden,
      alive: this.me.alive,
      venting: this.me.venting,
    };
  }

  private get playing(): boolean {
    return net.room?.state.phase === GamePhase.Playing;
  }

  /** What USE would do right now (null = nothing in reach). */
  currentUseTarget(): UseTarget | null {
    const s = this.localState;
    if (!s || s.venting || net.room?.state.phase === GamePhase.Reveal) return null;
    const c = net.character;
    return useTarget(hostelMap, {
      ...s,
      isKiller: this.playing && c?.role === "killer",
      canVent: this.playing && !!c?.canVent,
      openTasks: this.playing ? net.openTaskIds : [],
    });
  }

  /** The player a swing would hit right now, if any (killers only). */
  attackTarget(): Combatant | null {
    const c = net.character;
    const me = this.me;
    if (!me || !this.playing || c?.role !== "killer" || !me.alive || me.hidden || me.venting) return null;
    const grid = hostelMap.floors.get(me.floor)?.grid;
    const room = net.room;
    if (!grid || !room) return null;
    const candidates: Combatant[] = [];
    this.remotes.forEach((r, id) => {
      const p = room.state.players.get(id);
      if (!p || !p.alive || p.hidden || p.venting || p.safe || !r.view.container.visible) return;
      candidates.push({ id, floor: p.floor, x: r.pos.x, y: r.pos.y });
    });
    const self = { id: me.id, floor: me.floor, x: this.predicted.x, y: this.predicted.y };
    // Fellow killers can't be attacked; the client knows them by name.
    const fellow = new Set(net.role?.fellowKillers ?? []);
    const valid = candidates.filter((cand) => !fellow.has(room.state.players.get(cand.id)?.name ?? ""));
    return pickAttackTarget(grid, self, this.facing, attackReachPx(c.attackRange ?? 1, ATTACK_REACH_TOLERANCE_TILES * 0.5), valid);
  }

  // ---------- Setup ----------

  /** Zoom so about VIEW_WIDTH_TILES fit across, but never fewer than VIEW_MIN_HEIGHT_TILES vertically. */
  private fitCamera(): void {
    const { width, height } = this.scale;
    const zoom = Math.min(
      width / (VIEW_WIDTH_TILES * TILE_SIZE),
      height / (VIEW_MIN_HEIGHT_TILES * TILE_SIZE),
    );
    this.cameras.main.setZoom(zoom);
  }

  private showFloor(id: number): void {
    this.currentFloor = id;
    this.floorViews.forEach((view, floorId) => view.setVisible(floorId === id));
  }

  private bindRoom(): void {
    const room = net.room!;
    const $ = net.callbacks(room);

    this.cleanups.push(
      $(room.state).players.onAdd((player, id) => {
        if (id === room.sessionId) this.addLocal(player);
        else this.addRemote(player, id);
        this.cleanups.push(
          $(player).onChange(() => {
            if (id === room.sessionId) this.onLocalChange(player);
            else this.onRemoteChange(player, id);
            this.refreshLabel(player, id);
          }),
        );
      }),
      $(room.state).players.onRemove((_player, id) => {
        this.remotes.get(id)?.view.container.destroy();
        this.remotes.delete(id);
      }),
      $(room.state).bodies.onAdd((body, id) => this.addBody(body, id)),
      $(room.state).bodies.onRemove((_body, id) => {
        this.bodies.get(id)?.container.destroy();
        this.bodies.delete(id);
      }),
    );
  }

  private addLocal(player: Player): void {
    this.localView?.container.destroy();
    this.me = player;
    this.localView = createPlayerView(this, player.name, PLAYER_COLORS[player.color], true);
    this.lastTp = player.tp;
    this.predicted = { x: player.x, y: player.y };
    this.previous = { ...this.predicted };
    this.display = { ...this.predicted };
    this.pending = [];
    this.localView.container.setPosition(player.x, player.y).setDepth(player.y);
    this.showFloor(player.floor);
    this.cameras.main.startFollow(this.localView.container, true);
    this.refreshLabel(player, player.id);
  }

  private addRemote(player: Player, id: string): void {
    this.remotes.get(id)?.view.container.destroy();
    const view = createPlayerView(this, player.name, PLAYER_COLORS[player.color], false);
    const buffer = new InterpolationBuffer();
    buffer.reset(player.x, player.y);
    view.container.setPosition(player.x, player.y).setVisible(false);
    this.remotes.set(id, { view, buffer, lastTp: player.tp, pos: { x: player.x, y: player.y } });
    this.refreshLabel(player, id);
  }

  private addBody(body: Body, id: string): void {
    this.bodies.get(id)?.container.destroy();
    const container = createCorpseView(this, PLAYER_COLORS[body.color]).setPosition(body.x, body.y).setDepth(body.y - TILE_SIZE).setVisible(false);
    const killedAt = this.recentKills.get(body.victimId);
    const waiting = killedAt !== undefined && performance.now() - killedAt < BODY_REVEAL_WAIT_MS;
    this.bodies.set(id, { container, body, landed: !waiting });
  }

  private onKill(msg: KillMessage): void {
    this.recentKills.set(msg.victimId, performance.now());
    if (msg.victimId === net.sessionId) this.cameras.main.shake(250, 0.01);
    if (msg.floor !== this.currentFloor) {
      this.markLanded(msg.victimId);
      return;
    }
    const color = PLAYER_COLORS[net.room?.state.players.get(msg.victimId)?.color ?? 0];
    killEffect(this, msg.x, msg.y, msg.angle, color, msg.finisher, () => this.markLanded(msg.victimId));
  }

  private markLanded(victimId: string): void {
    const open = new Set(this.playing ? net.openTaskIds : []);
    this.taskGlows.forEach((glow, taskId) => {
      const station = hostelMap.tasks.get(taskId)!;
      glow.setVisible(open.has(taskId) && station.floor === this.currentFloor);
    });

    this.bodies.forEach((b) => {
      if (b.body.victimId === victimId) b.landed = true;
    });
    this.recentKills.delete(victimId);
  }

  private onLocalChange(player: Player): void {
    this.reconcile(player);
    if (player.tp !== this.lastTp) {
      // Teleported: no lerp from the old spot, and switch floors if needed.
      this.lastTp = player.tp;
      this.previous = { ...this.predicted };
      this.showFloor(player.floor);
    }
  }

  private onRemoteChange(player: Player, id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    if (player.tp !== r.lastTp) {
      r.lastTp = player.tp;
      r.buffer.reset(player.x, player.y);
    } else {
      r.buffer.push(player.x, player.y);
    }
  }

  /** Name tag text and body colour. Visibility is decided every frame in update(). */
  private refreshLabel(player: Player, id: string): void {
    const isLocal = id === net.sessionId;
    const view = isLocal ? this.localView : this.remotes.get(id)?.view;
    if (!view) return;
    let tag = "";
    if (!player.connected) tag = " (offline)";
    else if (isLocal && !player.alive) tag = " (ghost)";
    else if (isLocal && player.hidden) tag = " (hiding)";
    else if (isLocal && player.venting) tag = " (in vent)";
    view.label.setText(player.name + tag);
    view.body.setTint(PLAYER_COLORS[player.color]);
  }

  // ---------- Prediction ----------

  /** Server says where we are as of input `ack`; replay everything after it. */
  private reconcile(player: Player): void {
    this.pending = this.pending.filter((input) => input.seq > player.ack);
    let pos: Vec2 = { x: player.x, y: player.y };
    if (this.canMove(player)) for (const input of this.pending) pos = this.applyInput(pos, input, player);
    this.predicted = pos;
  }

  private canMove(p: Player): boolean {
    const phase = net.room?.state.phase;
    if (phase === GamePhase.Reveal || phase === GamePhase.Ended) return false;
    return !p.alive || (!p.hidden && !p.venting);
  }

  private speedMultiplier(p: Player): number {
    if (!p.alive) return GHOST_SPEED_MULTIPLIER;
    return net.character?.speed ?? 1;
  }

  private applyInput(pos: Vec2, input: InputMessage, p: Player): Vec2 {
    const floor = hostelMap.floors.get(p.floor);
    if (!floor) return pos;
    const dir = sanitizeDirection(input.dx, input.dy);
    const step = p.alive ? stepMovement : stepGhost;
    return step(floor.grid, pos, dir, BASE_SPEED_PX_PER_SEC * this.speedMultiplier(p), TICK_DT, PLAYER_RADIUS_PX);
  }

  private hud(): HUDScene | undefined {
    return this.scene.get("HUD") as HUDScene | undefined;
  }

  private currentInput(): Vec2 {
    const kb = this.keyboard.vector;
    if (kb.x !== 0 || kb.y !== 0) return kb;
    return this.hud()?.touch?.vector ?? { x: 0, y: 0 };
  }

  private handleButtons(): void {
    if (MinigameScene.isOpen(this)) return;
    const touch = this.hud()?.touch;
    const usePressed = Phaser.Input.Keyboard.JustDown(this.keyboard.use) || (touch?.consumePress("use") ?? false);
    if (usePressed && this.currentUseTarget()) net.room?.send(ClientMsg.Use);
    const attackPressed = Phaser.Input.Keyboard.JustDown(this.keyboard.attack) || (touch?.consumePress("attack") ?? false);
    if (attackPressed && performance.now() >= net.readyAt.attack && this.attackTarget()) net.room?.send(ClientMsg.Attack);
  }

  // ---------- Frame ----------

  override update(): void {
    const room = net.room;
    const me = this.me;
    if (!room || !me) return;
    const now = performance.now();

    this.handleButtons();

    // Fixed-rate input sending + local prediction.
    this.inputAccumulator += now - this.lastFrameAt;
    this.lastFrameAt = now;
    let steps = 0;
    while (this.inputAccumulator >= INPUT_SEND_MS) {
      this.inputAccumulator -= INPUT_SEND_MS;
      if (steps++ >= MAX_INPUT_CATCHUP) {
        this.inputAccumulator = 0;
        break;
      }
      this.previous = { ...this.predicted };
      const dir = this.currentInput();
      // Standing still (or frozen, or busy with a minigame) costs nothing: the server keeps us where we are.
      if ((dir.x === 0 && dir.y === 0) || net.reconnecting || !this.canMove(me) || MinigameScene.isOpen(this)) continue;
      this.facing = Math.atan2(dir.y, dir.x);
      const input: InputMessage = { dx: dir.x, dy: dir.y, seq: ++this.seq };
      room.send(ClientMsg.Input, input);
      this.pending.push(input);
      this.predicted = this.applyInput(this.predicted, input, me);
    }

    // Local player, drawn between the last two predicted steps.
    const alpha = Phaser.Math.Clamp(this.inputAccumulator / INPUT_SEND_MS, 0, 1);
    this.display = {
      x: Phaser.Math.Linear(this.previous.x, this.predicted.x, alpha),
      y: Phaser.Math.Linear(this.previous.y, this.predicted.y, alpha),
    };
    if (this.localView) {
      this.localView.container
        .setPosition(this.display.x, this.display.y)
        .setDepth(this.display.y)
        .setAlpha(!me.alive ? GHOST_ALPHA : me.hidden || me.venting ? HIDDEN_SELF_ALPHA : 1);
    }
    this.safeRing.setVisible(me.alive && me.safe).setPosition(this.display.x, this.display.y);

    this.updateVisibility(now);
  }

  /** Vision radius in pixels, or null when you see everything (ghost, between rounds). */
  private visionRadius(): number | null {
    const me = this.me;
    if (!me || !me.alive || net.room?.state.phase === GamePhase.Ended) return null;
    const mult = net.isKiller ? KILLER_VISION_MULTIPLIER : 1;
    return VISION_RADIUS_TILES * mult * TILE_SIZE;
  }

  private updateVisibility(now: number): void {
    const room = net.room!;
    const me = this.me!;
    const grid = hostelMap.floors.get(this.currentFloor)?.grid;
    if (!grid) return;
    const radius = this.visionRadius();
    const eye = this.display;
    const canSee = (x: number, y: number, extra = PLAYER_RADIUS_PX) => {
      if (radius === null) return true;
      const d = Math.hypot(x - eye.x, y - eye.y);
      return d <= radius + extra && hasLineOfSight(grid, eye.x, eye.y, x, y);
    };

    this.remotes.forEach((r, id) => {
      const p = room.state.players.get(id);
      const show =
        !!p &&
        p.floor === this.currentFloor &&
        !p.hidden &&
        !p.venting &&
        (p.alive || !me.alive) &&
        canSee(r.pos.x, r.pos.y);
      if (show) {
        const sample = r.buffer.sample(now);
        if (sample) r.pos = sample;
        r.view.container.setPosition(r.pos.x, r.pos.y).setDepth(r.pos.y);
        r.view.container.setAlpha(!p.connected ? OFFLINE_ALPHA : p.alive ? 1 : GHOST_ALPHA);
      } else {
        // Keep the position fresh so attack checks and re-appearing are accurate.
        const sample = r.buffer.sample(now);
        if (sample) r.pos = sample;
      }
      r.view.container.setVisible(show);
    });

    const open = new Set(this.playing ? net.openTaskIds : []);
    this.taskGlows.forEach((glow, taskId) => {
      const station = hostelMap.tasks.get(taskId)!;
      glow.setVisible(open.has(taskId) && station.floor === this.currentFloor);
    });

    this.bodies.forEach((b) => {
      b.container.setVisible(b.landed && b.body.floor === this.currentFloor && canSee(b.body.x, b.body.y, TILE_SIZE));
    });

    this.drawFog(radius, grid);
  }

  /**
   * Darkness everywhere except the area you can see: rays are cast around
   * you and stop at walls and solid furniture. The dark shape is one polygon
   * (screen-sized rectangle with the visible area cut out as a "keyhole").
   */
  private drawFog(radius: number | null, grid: Parameters<typeof castRay>[0]): void {
    const g = this.fog;
    g.clear();
    if (radius === null) return;
    const cx = this.display.x;
    const cy = this.display.y;
    const v = this.cameras.main.worldView;
    const left = Math.min(v.x, cx - radius) - FOG_MARGIN_PX;
    const top = Math.min(v.y, cy - radius) - FOG_MARGIN_PX;
    const right = Math.max(v.right, cx + radius) + FOG_MARGIN_PX;
    const bottom = Math.max(v.bottom, cy + radius) + FOG_MARGIN_PX;

    // Ray endpoints, angle increasing (clockwise on screen, since y points down).
    const ring: Vec2[] = [];
    for (let i = 0; i < VISION_RAYS; i++) {
      const a = (i / VISION_RAYS) * Math.PI * 2;
      const d = Math.min(radius, castRay(grid, cx, cy, a, radius) + VISION_WALL_PEEK_PX);
      ring.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d });
    }
    // Outer rectangle clockwise from the left-middle, then a bridge to the
    // ray pointing left (index N/2), around the ring anticlockwise, and back.
    const half = VISION_RAYS / 2;
    const pts: Vec2[] = [
      { x: left, y: cy },
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
      { x: left, y: cy },
    ];
    for (let k = 0; k <= VISION_RAYS; k++) pts.push(ring[(half - k + VISION_RAYS) % VISION_RAYS]);
    g.fillStyle(0x000000, FOG_ALPHA);
    g.fillPoints(pts, true);
  }
}
