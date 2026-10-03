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
//  - Lights on (and killers, always): every room and corridor connected to
//    where you stand, as far as the screen goes. A closed door hides the
//    room (or corridor) behind it.
//  - Lights out (crew): LIGHTS_OUT_FRONT_TILES ahead of you, LIGHTS_OUT_BACK_TILES
//    behind, stopped by walls, solid furniture and closed doors.
//  - Ghosts, hiders and anyone inside a vent are invisible to the living.
//  - Ghost: everything on your floor, including other ghosts (see-through).

import Phaser from "phaser";
import {
  ATTACK_REACH_TOLERANCE_TILES,
  BASE_SPEED_PX_PER_SEC,
  DASH_SPEED_MULTIPLIER,
  CHAT_BUBBLE_SECONDS,
  FOG_ALPHA,
  GHOST_SPEED_MULTIPLIER,
  HEARING_RANGE_TILES,
  INPUT_SEND_MS,
  PLAYER_COLORS,
  PLAYER_RADIUS_PX,
  TICK_DT,
  TILE_SIZE,
  VIEW_MIN_HEIGHT_TILES,
  VIEW_WIDTH_TILES,
  VISION_RAYS,
  VISION_WALL_PEEK_PX,
  WARDEN_CONE_DEG,
  WARDEN_CONE_TILES,
  KILLERS_SEE_THROUGH_DOORS,
  WIDE_SWING_ARC_DEG,
  LIGHTS_OUT_BACK_TILES,
  LIGHTS_OUT_FRONT_TILES,
} from "../../../shared/constants";
import { sfx } from "../audio/synth";
import { attackReachPx, pickAttackTarget } from "../../../shared/combat";
import type { Combatant } from "../../../shared/combat";
import { useTarget } from "../../../shared/interact";
import type { UseTarget } from "../../../shared/interact";
import { castRay, hasLineOfSight, sanitizeDirection, stepGhost, stepMovement } from "../../../shared/physics";
import { ClientMsg, GamePhase } from "../../../shared/types";
import type { InputMessage, KillMessage, Vec2 } from "../../../shared/types";
import { hostelMap } from "../../../shared/world";
import { areaAt } from "../../../shared/buildMap";
import { setDoorClosed, visibleAreas } from "../../../shared/doors";
import { DoorView } from "../render/doors";
import { createGasCloud } from "../render/gas";
import type { GasCloud } from "../render/gas";
import type { Body, Player } from "../../../server/schema/GameState";
import { KeyboardControls } from "../input/keyboard";
import { InterpolationBuffer } from "../render/interpolation";
import { createFloorView } from "../render/mapRenderer";
import { createCorpseView, createGujjuView, createPlayerView, createWardenView } from "../render/placeholderSprites";
import { createDeadFace, createRagdollLayers, hasPlayerSprites } from "../render/characterSprites";
import { ensureFaceTexture, faceTextureKey } from "../faces";
import type { PlayerView } from "../render/placeholderSprites";
import {
  beatEffect,
  dashEffect,
  gujjuAwakeEffect,
  killEffect,
  reviveEffect,
  searchEffect,
  shieldEffect,
  taskDoneEffect,
  ventPopEffect,
  wardenStunEffect,
  wideSwingEffect,
} from "../render/effects";
import { ChaosKind } from "../../../shared/types";
import type { ChatMessage, FxMessage } from "../../../shared/types";
import type { Gas, Npc } from "../../../server/schema/GameState";
import { net } from "../net";
import type { HUDScene } from "./HUD";
import { MinigameScene } from "./Minigame";

/**
 * What the local player can see:
 *   all    everything on the floor (ghosts, round over)
 *   rooms  the areas connected to yours, not behind a closed door (lights on)
 *   dark   a short flashlight-ish shape around you (lights out)
 */
type VisionMode = "all" | "rooms" | "dark";

/** Max inputs sent in one frame when catching up after a hitch. */
const MAX_INPUT_CATCHUP = 3;
/** Opacity of your own body while you're hiding or in a vent (others can't see you at all). */
const HIDDEN_SELF_ALPHA = 0.45;
const GHOST_ALPHA = 0.45;
const OFFLINE_ALPHA = 0.4;
/** Drawn above everything in the world, including effects. */
const FOG_DEPTH = 1_000_000;
/** Ceiling drawn over rooms you can't see into. */
const CEILING_COLOR = 0x16121c;
const CEILING_LINE = 0x2a2433;
/** The fog rectangle extends this far past the camera edges. */
const FOG_MARGIN_PX = 200;
/** A body that appears within this long of its kill message waits for the ragdoll to land. */
const BODY_REVEAL_WAIT_MS = 1500;
/** Gujju Rapper's speech bubble per mood. */
const GUJJU_SPEECH: Record<string, string> = {
  idle: "zzz… 🎧",
  awake: "KAUN HAI BEY?!",
  hunting: "🍑 AAVI JA!",
  returning: "hmph 🎤",
};
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
  private npcs = new Map<string, {
    view: PlayerView;
    /** Gujju Rapper's mood bubble. */
    speech?: Phaser.GameObjects.Text;
    /** Warden's flashlight (drawn above the fog so you can see it coming). */
    cone?: Phaser.GameObjects.Graphics;
    buffer: InterpolationBuffer;
    npc: Npc;
    pos: Vec2;
  }>();
  /** Power cut: dark flicker over door gaps. */
  private powerCut!: Phaser.GameObjects.Graphics;
  private nextBzzztAt = 0;
  /** Chat bubbles over heads: playerId -> bubble. */
  private chatBubbles = new Map<string, { text: Phaser.GameObjects.Text; until: number }>();
  /** Task ids already done, to spot newly finished ones. */
  private doneTasks = new Set<string>();
  private gasClouds = new Map<string, { cloud: GasCloud; gas: Gas }>();
  /** Revive hold in progress (Supreme Leader): when it started, or 0. */
  reviveStartedAt = 0;
  private fog!: Phaser.GameObjects.Graphics;
  /** taskId -> pulsing glow at its station (shown only for your own unfinished tasks on this floor). */
  private taskGlows = new Map<string, Phaser.GameObjects.Arc>();
  private doorViews = new Map<string, DoorView>();
  /** Bumped whenever a door opens or closes, so the visible-rooms cache knows to refresh. */
  private doorVersion = 0;
  /** Visible area indexes for "rooms" vision, and what they were computed for. */
  private seenAreas: Set<number> | null = null;
  private seenKey = "";
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
    this.npcs.clear();
    this.gasClouds.clear();
    this.chatBubbles.clear();
    this.doneTasks = new Set(net.tasks.tasks.filter((t) => t.done).map((t) => t.id));
    this.powerCut = this.add.graphics().setDepth(FOG_DEPTH - 1);
    this.reviveStartedAt = 0;
    this.fog = this.add.graphics().setDepth(FOG_DEPTH);
    this.taskGlows.clear();
    this.doorViews.clear();
    this.seenKey = "";
    // A fresh scene starts with every doorway open; the room's door state is applied in bindRoom().
    for (const floor of hostelMap.floors.values()) for (const d of floor.doorways) setDoorClosed(floor, d, false);
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
      net.on("ventPop", (msg) => {
        if (msg.floor !== this.currentFloor) return;
        ventPopEffect(this, msg.x, msg.y);
        sfx.ventPop(this.earVolume(msg.floor, msg.x, msg.y));
      }),
      net.on("search", (msg) => {
        if (msg.floor !== this.currentFloor) return;
        searchEffect(this, msg.x, msg.y, msg.found);
        sfx.knock(this.earVolume(msg.floor, msg.x, msg.y));
      }),
      net.on("chat", (msg) => this.onChat(msg)),
      net.on("taskList", (list) => {
        for (const t of list.tasks) {
          if (!t.done || this.doneTasks.has(t.id)) continue;
          this.doneTasks.add(t.id);
          if (this.me) taskDoneEffect(this, this.display.x, this.display.y);
        }
      }),
      net.on("fx", (msg) => this.onFx(msg)),
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
      revivable: this.revivableBodies(),
      doors: this.doorStates(),
    });
  }

  /** Doors this round: doorway id -> open. */
  private doorStates(): Map<string, boolean> {
    const doors = new Map<string, boolean>();
    net.room?.state.doors.forEach((open, id) => doors.set(id, open));
    return doors;
  }

  /** Supreme Leader with a revive left: every body (useTarget picks the one in reach). */
  private revivableBodies(): { id: string; floor: number; x: number; y: number }[] {
    const room = net.room;
    if (!room || !this.playing || !net.character?.revive || net.reviveUsed || !this.me?.alive) return [];
    return [...room.state.bodies.values()].map((b) => ({ id: b.id, floor: b.floor, x: b.x, y: b.y }));
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
    // Kallu Koli's armed wide swing reaches further, in a wider arc.
    const wide = net.wideArmed && c.ability === "wide-swing";
    const reach = attackReachPx((wide ? c.wideSwingRange : undefined) ?? c.attackRange ?? 1, ATTACK_REACH_TOLERANCE_TILES * 0.5);
    return pickAttackTarget(grid, self, this.facing, reach, valid, wide ? WIDE_SWING_ARC_DEG : undefined);
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
      $(room.state).npcs.onAdd((npc, id) => {
        this.removeNpc(id);
        const buffer = new InterpolationBuffer();
        buffer.reset(npc.x, npc.y);
        const pos = { x: npc.x, y: npc.y };
        if (npc.kind === "warden") {
          const view = createWardenView(this);
          const cone = this.add.graphics().setDepth(FOG_DEPTH + 1);
          this.npcs.set(id, { view, cone, buffer, npc, pos });
          if (npc.floor === this.currentFloor) sfx.whistle(0.6);
        } else {
          const view = createGujjuView(this, npc.name);
          this.npcs.set(id, { view, speech: view.speech, buffer, npc, pos });
        }
        this.npcs.get(id)!.view.container.setPosition(npc.x, npc.y).setVisible(false);
        this.cleanups.push($(npc).onChange(() => buffer.push(npc.x, npc.y)));
      }),
      $(room.state).npcs.onRemove((_npc, id) => this.removeNpc(id)),
      $(room.state).doors.onAdd((open, id) => this.onDoor(id, open, false)),
      $(room.state).doors.onChange((open, id) => this.onDoor(id, open, true)),
      $(room.state).doors.onRemove((_open, id) => this.removeDoor(id)),
      $(room.state).gas.onAdd((gas, id) => {
        const grid = hostelMap.floors.get(gas.floor)?.grid;
        if (!grid) return;
        this.gasClouds.set(id, { cloud: createGasCloud(this, gas.x, gas.y, gas.radius, grid), gas });
      }),
      $(room.state).gas.onRemove((_gas, id) => {
        this.gasClouds.get(id)?.cloud.destroy();
        this.gasClouds.delete(id);
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
    const faceKey = this.faceKeyOf(body.victimId);
    const container = createCorpseView(this, PLAYER_COLORS[body.color], faceKey)
      .setPosition(body.x, body.y)
      .setDepth(body.y - TILE_SIZE)
      .setVisible(false);
    // The photo wasn't loaded yet (e.g. someone you never saw): add it when it is.
    const face = net.room?.state.players.get(body.victimId)?.face;
    if (face && !faceKey && hasPlayerSprites(this)) {
      void ensureFaceTexture(this, face).then((key) => {
        const dead = container.active ? createDeadFace(this, key) : null;
        if (dead) container.add(dead);
      }).catch(() => undefined);
    }
    const killedAt = this.recentKills.get(body.victimId);
    const waiting = killedAt !== undefined && performance.now() - killedAt < BODY_REVEAL_WAIT_MS;
    this.bodies.set(id, { container, body, landed: !waiting });
  }

  /** A door appeared (new round) or opened/closed: update collision, art and vision. */
  private onDoor(id: string, open: boolean, changed: boolean): void {
    const doorway = hostelMap.doorways.get(id);
    if (!doorway) return;
    const floor = hostelMap.floors.get(doorway.floor)!;
    const wasClosed = floor.grid.solid[doorway.tiles[0].y * floor.grid.width + doorway.tiles[0].x] === 1;
    setDoorClosed(floor, doorway, !open);
    let view = this.doorViews.get(id);
    if (!view) {
      view = new DoorView(this, floor, doorway);
      this.floorViews.get(doorway.floor)?.add(view.graphics);
      this.doorViews.set(id, view);
    }
    view.setOpen(open);
    this.doorVersion++;
    if (changed && wasClosed === open) {
      const vol = this.earVolume(doorway.floor, doorway.x, doorway.y);
      if (vol > 0) (open ? sfx.doorOpen : sfx.doorShut)(vol);
    }
  }

  private removeDoor(id: string): void {
    const doorway = hostelMap.doorways.get(id);
    if (doorway) setDoorClosed(hostelMap.floors.get(doorway.floor)!, doorway, false);
    this.doorViews.get(id)?.destroy();
    this.doorViews.delete(id);
    this.doorVersion++;
  }

  private removeNpc(id: string): void {
    const n = this.npcs.get(id);
    n?.view.container.destroy();
    n?.cone?.destroy();
    this.npcs.delete(id);
  }

  /** 0..1 loudness of something happening at (x, y): silent on another floor or far away. */
  earVolume(floor: number, x: number, y: number): number {
    if (floor !== this.currentFloor) return 0;
    const d = Math.hypot(x - this.display.x, y - this.display.y);
    return Phaser.Math.Clamp(1 - d / (HEARING_RANGE_TILES * TILE_SIZE), 0, 1);
  }

  private onChat(msg: ChatMessage): void {
    sfx.chat();
    const view = msg.fromId === net.sessionId ? this.localView : this.remotes.get(msg.fromId)?.view;
    if (!view) return;
    this.chatBubbles.get(msg.fromId)?.text.destroy();
    const text = this.add
      .text(0, view.label.y - 16, msg.text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "11px",
        color: "#000000",
        backgroundColor: "#ffffff",
        padding: { x: 5, y: 3 },
        wordWrap: { width: 160 },
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    view.container.add(text);
    this.chatBubbles.set(msg.fromId, { text, until: performance.now() + CHAT_BUBBLE_SECONDS * 1000 });
  }

  private onKill(msg: KillMessage): void {
    this.recentKills.set(msg.victimId, performance.now());
    const vol = this.earVolume(msg.floor, msg.x, msg.y);
    if (msg.victimId === net.sessionId) {
      this.cameras.main.shake(300, 0.015);
      navigator.vibrate?.([120, 60, 200]);
    } else if (vol > 0.5) {
      this.cameras.main.shake(180, 0.006 * vol);
    }
    if (vol > 0) (msg.finisher === "butt-crush" ? sfx.squish : msg.finisher === "gas" ? sfx.gas : sfx.thwack)(vol);
    if (msg.floor !== this.currentFloor) {
      this.markLanded(msg.victimId);
      return;
    }
    const color = PLAYER_COLORS[net.room?.state.players.get(msg.victimId)?.color ?? 0];
    const doll = hasPlayerSprites(this)
      ? () => this.add.container(0, 0, createRagdollLayers(this, color, this.faceKeyOf(msg.victimId)))
      : undefined;
    killEffect(this, msg.x, msg.y, msg.angle, color, msg.finisher, () => this.markLanded(msg.victimId), doll);
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
    else if (isLocal && player.stunned) tag = " (stunned)";
    view.label.setText(player.name + tag);
    view.body.setTint(PLAYER_COLORS[player.color]);
    this.refreshFace(view, player.face);
  }

  /** Face photo currently shown (or being loaded) on each view. */
  private shownFaces = new WeakMap<PlayerView, string>();

  private refreshFace(view: PlayerView, face: string): void {
    if (!view.rig || this.shownFaces.get(view) === face) return;
    this.shownFaces.set(view, face);
    if (!face) {
      view.rig.setFace(null);
      return;
    }
    ensureFaceTexture(this, face)
      .then((key) => {
        // Still the face this view should show (it may have changed while loading).
        if (this.shownFaces.get(view) === face && view.container.active) view.rig?.setFace(key);
      })
      .catch(() => this.shownFaces.delete(view));
  }

  /** Texture key of a player's face photo if it's ready to draw. */
  private faceKeyOf(playerId: string): string | undefined {
    const face = net.room?.state.players.get(playerId)?.face;
    if (!face) return undefined;
    const key = faceTextureKey(face);
    return this.textures.exists(key) ? key : undefined;
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
    return !p.alive || (!p.hidden && !p.venting && !p.stunned);
  }

  private speedMultiplier(p: Player): number {
    if (!p.alive) return GHOST_SPEED_MULTIPLIER;
    return (net.character?.speed ?? 1) * (p.dashing ? DASH_SPEED_MULTIPLIER : 1);
  }

  private onFx(msg: FxMessage): void {
    if (msg.floor !== this.currentFloor) return;
    const vol = this.earVolume(msg.floor, msg.x, msg.y);
    switch (msg.kind) {
      case "dash":
        dashEffect(this, msg.x, msg.y, msg.angle ?? 0);
        sfx.whoosh(vol);
        break;
      case "wide": {
        wideSwingEffect(this, msg.x, msg.y, msg.angle ?? 0, msg.radius ?? attackReachPx(1.5));
        sfx.whoosh(vol);
        break;
      }
      case "shield":
        shieldEffect(this, msg.x, msg.y);
        sfx.shield(vol);
        break;
      case "beat":
        beatEffect(this, msg.x, msg.y, msg.radius ?? TILE_SIZE * 4);
        sfx.beatDrop(Math.max(vol, 0.3));
        if (this.me?.stunned) {
          this.cameras.main.shake(300, 0.012);
          navigator.vibrate?.(250);
        }
        break;
      case "revive":
        reviveEffect(this, msg.x, msg.y);
        sfx.revive(vol);
        break;
      case "gujju-awake":
        gujjuAwakeEffect(this, msg.x, msg.y);
        sfx.alarm(vol * 0.6);
        break;
      case "gas":
        sfx.gas(vol);
        break; // the cloud itself is drawn from the synced state
      case "warden-stun":
        wardenStunEffect(this, msg.x, msg.y);
        sfx.whistle(vol);
        if (this.me?.stunned) navigator.vibrate?.(200);
        break;
    }
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
    const target = this.currentUseTarget();
    const usePressed = Phaser.Input.Keyboard.JustDown(this.keyboard.use) || (touch?.consumePress("use") ?? false);
    const useHeld = this.keyboard.use.isDown || (touch?.isHeld("use") ?? false);

    // Reviving is hold-to-use: start on press, cancel on release or when the body is out of reach.
    if (target?.kind === "revive") {
      if (useHeld && this.reviveStartedAt === 0) {
        this.reviveStartedAt = performance.now();
        net.room?.send(ClientMsg.ReviveStart);
      }
    }
    if (this.reviveStartedAt !== 0 && (!useHeld || target?.kind !== "revive")) {
      this.reviveStartedAt = 0;
      net.room?.send(ClientMsg.ReviveCancel);
    }
    if (usePressed && target && target.kind !== "revive") net.room?.send(ClientMsg.Use);

    const abilityPressed = Phaser.Input.Keyboard.JustDown(this.keyboard.ability) || (touch?.consumePress("ability") ?? false);
    if (abilityPressed && this.abilityUsable()) net.room?.send(ClientMsg.Ability);
    const attackPressed = Phaser.Input.Keyboard.JustDown(this.keyboard.attack) || (touch?.consumePress("attack") ?? false);
    if (attackPressed && performance.now() >= net.readyAt.attack && this.attackTarget()) net.room?.send(ClientMsg.Attack);
  }

  /** Can the local player use their ABILITY right now? */
  abilityUsable(): boolean {
    const me = this.me;
    const c = net.character;
    return !!(c?.ability && me && me.alive && this.playing && !me.hidden && !me.venting && !me.stunned && performance.now() >= net.readyAt.ability);
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
      this.localView.rig?.update(this.display.x, this.display.y, me.alive && me.stunned, me.dashing ? DASH_SPEED_MULTIPLIER : 1);
    }
    if (this.localView) {
      this.localView.bubble.setVisible(me.alive && me.safe);
      this.localView.stars.setVisible(me.alive && me.stunned);
    }

    this.updateVisibility(now);
  }

  private visionMode(): VisionMode {
    const me = this.me;
    if (!me || !me.alive || net.room?.state.phase === GamePhase.Ended) return "all";
    if (net.isKiller) return KILLERS_SEE_THROUGH_DOORS ? "all" : "rooms";
    return net.room?.state.chaos === ChaosKind.LightsOut ? "dark" : "rooms";
  }

  /** Lights-out sight distance in pixels in a given direction: longest ahead, shortest behind. */
  private darkReach(angle: number): number {
    const mid = (LIGHTS_OUT_FRONT_TILES + LIGHTS_OUT_BACK_TILES) / 2;
    const swing = (LIGHTS_OUT_FRONT_TILES - LIGHTS_OUT_BACK_TILES) / 2;
    return (mid + swing * Math.cos(angle - this.facing)) * TILE_SIZE;
  }

  /** Areas (indexes into the floor's areas) visible from where you stand, or null for "everything". */
  private visibleAreaSet(): Set<number> | null {
    const floor = hostelMap.floors.get(this.currentFloor);
    if (!floor) return null;
    const here = areaAt(floor, this.display.x, this.display.y);
    if (!here) return null;
    const from = floor.areas.indexOf(here);
    const key = `${floor.id}:${from}:${this.doorVersion}`;
    if (key !== this.seenKey) {
      this.seenKey = key;
      const doors = net.room?.state.doors;
      this.seenAreas = visibleAreas(floor, from, (id) => doors?.get(id) === false);
    }
    return this.seenAreas;
  }

  private updateVisibility(now: number): void {
    const room = net.room!;
    const me = this.me!;
    const grid = hostelMap.floors.get(this.currentFloor)?.grid;
    if (!grid) return;
    const mode = this.visionMode();
    const floor = hostelMap.floors.get(this.currentFloor)!;
    const seen = mode === "rooms" ? this.visibleAreaSet() : null;
    const eye = this.display;
    const canSee = (x: number, y: number, extra = PLAYER_RADIUS_PX) => {
      if (mode === "all") return true;
      if (mode === "rooms") {
        const area = areaAt(floor, x, y);
        return !seen || !area || seen.has(floor.areas.indexOf(area));
      }
      const d = Math.hypot(x - eye.x, y - eye.y);
      return d <= this.darkReach(Math.atan2(y - eye.y, x - eye.x)) + extra && hasLineOfSight(grid, eye.x, eye.y, x, y);
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
        r.view.bubble.setVisible(p.alive && p.safe);
        r.view.stars.setVisible(p.alive && p.stunned);
        r.view.rig?.update(r.pos.x, r.pos.y, p.alive && p.stunned, p.dashing ? DASH_SPEED_MULTIPLIER : 1);
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

    this.npcs.forEach((n) => {
      const sample = n.buffer.sample(now);
      if (sample) n.pos = sample;
      const sameFloor = n.npc.floor === this.currentFloor;
      const show = sameFloor && canSee(n.pos.x, n.pos.y);
      n.view.container.setVisible(show).setPosition(n.pos.x, n.pos.y).setDepth(n.pos.y);
      if (show) n.view.rig?.update(n.pos.x, n.pos.y, false);
      n.speech?.setText(GUJJU_SPEECH[n.npc.mood] ?? "");
      if (n.cone) this.drawWardenCone(n.cone, show, n.pos, n.npc.facing, grid);
    });

    this.gasClouds.forEach((g) => g.cloud.obj.setVisible(g.gas.floor === this.currentFloor));

    // Chat bubbles fade out.
    for (const [id, b] of this.chatBubbles) {
      if (now < b.until) continue;
      b.text.destroy();
      this.chatBubbles.delete(id);
    }

    this.drawPowerCut(now, grid);

    if (mode === "dark") this.drawDarkFog(grid);
    else this.drawRoomFog(mode === "rooms" ? seen : null);
  }

  /** The warden's flashlight: a yellow cone, stopped by walls, drawn above the fog. */
  private drawWardenCone(g: Phaser.GameObjects.Graphics, show: boolean, pos: Vec2, facing: number, grid: Parameters<typeof castRay>[0]): void {
    g.clear();
    if (!show) return;
    const reach = WARDEN_CONE_TILES * TILE_SIZE;
    const half = ((WARDEN_CONE_DEG / 2) * Math.PI) / 180;
    const steps = 16;
    const pts: Vec2[] = [{ x: pos.x, y: pos.y }];
    for (let i = 0; i <= steps; i++) {
      const a = facing - half + (2 * half * i) / steps;
      const d = castRay(grid, pos.x, pos.y, a, reach);
      pts.push({ x: pos.x + Math.cos(a) * d, y: pos.y + Math.sin(a) * d });
    }
    g.fillStyle(0xfff3a0, 0.28);
    g.fillPoints(pts, true);
  }

  /** Power cut: door gaps flicker dark, with a BZZZT now and then. */
  private drawPowerCut(now: number, grid: Parameters<typeof castRay>[0]): void {
    const g = this.powerCut;
    g.clear();
    if (net.room?.state.chaos !== ChaosKind.PowerCut) return;
    if (now >= this.nextBzzztAt) {
      sfx.bzzzt(0.8);
      this.nextBzzztAt = now + 900 + Math.random() * 900;
    }
    const doors = hostelMap.floors.get(this.currentFloor)?.doors ?? [];
    for (const d of doors) {
      if (Math.random() < 0.5) continue;
      g.fillStyle(0x000000, 0.85);
      g.fillRect(d.x * grid.tileSize, d.y * grid.tileSize, grid.tileSize, grid.tileSize);
      if (Math.random() < 0.15) {
        g.fillStyle(0x7fdbff, 0.8);
        g.fillRect(d.x * grid.tileSize + 8, d.y * grid.tileSize + 12, grid.tileSize - 16, 3);
      }
    }
  }

  /** Key of what the room fog currently shows, so it's only redrawn when that changes. */
  private roomFogKey = "";

  /**
   * Lights on: every room and corridor you can't see (behind closed doors)
   * is covered by its ceiling: a dark panel with a fan in the middle. Walls
   * and doors themselves stay visible.
   */
  private drawRoomFog(seen: Set<number> | null): void {
    const key = seen ? `${this.currentFloor}:${this.seenKey}` : "none";
    if (key === this.roomFogKey) return;
    this.roomFogKey = key;
    const g = this.fog;
    g.clear();
    if (!seen) return;
    const floor = hostelMap.floors.get(this.currentFloor)!;
    floor.areas.forEach((a, i) => {
      if (seen.has(i)) return;
      // Corridors can overlap; only cover tiles that really belong to this area.
      g.fillStyle(CEILING_COLOR, 1);
      const { x, y, w, h } = a.rect;
      for (let ty = y; ty < y + h; ty++) {
        let run = -1;
        for (let tx = x; tx <= x + w; tx++) {
          const mine = tx < x + w && floor.areaIndex[ty * floor.grid.width + tx] === i;
          if (mine && run < 0) run = tx;
          if (!mine && run >= 0) {
            g.fillRect(run * TILE_SIZE, ty * TILE_SIZE, (tx - run) * TILE_SIZE, TILE_SIZE);
            run = -1;
          }
        }
      }
      if (a.corridor) return;
      // Ceiling panel edge and a fan.
      g.lineStyle(2, CEILING_LINE, 1);
      g.strokeRoundedRect(x * TILE_SIZE + 6, y * TILE_SIZE + 6, w * TILE_SIZE - 12, h * TILE_SIZE - 12, 6);
      const cx = (x + w / 2) * TILE_SIZE;
      const cy = (y + h / 2) * TILE_SIZE;
      g.fillStyle(CEILING_LINE, 1);
      for (let k = 0; k < 3; k++) {
        const a0 = (k / 3) * Math.PI * 2 + 0.4;
        const tip = { x: cx + Math.cos(a0) * 22, y: cy + Math.sin(a0) * 22 };
        const side = { x: Math.cos(a0 + Math.PI / 2) * 4, y: Math.sin(a0 + Math.PI / 2) * 4 };
        g.fillTriangle(cx + side.x, cy + side.y, cx - side.x, cy - side.y, tip.x, tip.y);
        g.fillCircle(tip.x, tip.y, 4);
      }
      g.fillCircle(cx, cy, 6);
    });
  }

  /**
   * Lights out: darkness everywhere except the shape you can see: rays are
   * cast around you (further ahead than behind) and stop at walls, solid
   * furniture and closed doors. The dark shape is one polygon (screen-sized
   * rectangle with the visible area cut out as a "keyhole").
   */
  private drawDarkFog(grid: Parameters<typeof castRay>[0]): void {
    const g = this.fog;
    g.clear();
    this.roomFogKey = "";
    const radius = LIGHTS_OUT_FRONT_TILES * TILE_SIZE;
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
      const reach = this.darkReach(a);
      const d = Math.min(reach, castRay(grid, cx, cy, a, reach) + VISION_WALL_PEEK_PX);
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
