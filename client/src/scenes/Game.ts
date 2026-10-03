// The world view: the current floor, players on it, client-side prediction
// for the local player and interpolation for everyone else.
//
// Local player: every INPUT_SEND_MS we sample the controls, send
// { dx, dy, seq } and immediately apply the same step locally (prediction).
// When the server's position + ack for us arrives, we snap to it and replay
// the inputs it hasn't processed yet (reconciliation). A change in `tp`
// (stairs, round start) means a teleport: we snap without sliding.
//
// Only the local player's floor is drawn. Players on other floors, and
// anyone hiding, are not shown.

import Phaser from "phaser";
import {
  BASE_SPEED_PX_PER_SEC,
  INPUT_SEND_MS,
  PLAYER_COLORS,
  PLAYER_RADIUS_PX,
  TICK_DT,
  TILE_SIZE,
  VIEW_MIN_HEIGHT_TILES,
  VIEW_WIDTH_TILES,
} from "../../../shared/constants";
import { useTarget } from "../../../shared/interact";
import type { UseTarget } from "../../../shared/interact";
import { sanitizeDirection, stepMovement } from "../../../shared/physics";
import { ClientMsg } from "../../../shared/types";
import type { InputMessage, Vec2 } from "../../../shared/types";
import { hostelMap } from "../../../shared/world";
import type { Player } from "../../../server/schema/GameState";
import { KeyboardControls } from "../input/keyboard";
import { InterpolationBuffer } from "../render/interpolation";
import { createFloorView } from "../render/mapRenderer";
import { createPlayerView } from "../render/placeholderSprites";
import type { PlayerView } from "../render/placeholderSprites";
import { net } from "../net";
import type { HUDScene } from "./HUD";

/** Max inputs sent in one frame when catching up after a hitch. */
const MAX_INPUT_CATCHUP = 3;
/** Opacity of your own body while you're hiding (others can't see you at all). */
const HIDDEN_SELF_ALPHA = 0.45;
const OFFLINE_ALPHA = 0.4;

interface RemotePlayer {
  view: PlayerView;
  buffer: InterpolationBuffer;
  lastTp: number;
}

export class GameScene extends Phaser.Scene {
  private keyboard!: KeyboardControls;
  private floorViews = new Map<number, Phaser.GameObjects.Container>();
  private remotes = new Map<string, RemotePlayer>();
  private localView: PlayerView | null = null;
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
  private inputAccumulator = 0;
  /** Wall-clock time of the previous frame. Phaser's smoothed delta drifts from real time on slow devices. */
  private lastFrameAt = 0;

  constructor() {
    super("Game");
  }

  create(): void {
    this.remotes.clear();
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

    this.fitCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this);

    this.bindRoom();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
      this.cleanups.forEach((fn) => fn());
      this.cleanups = [];
    });
  }

  /** Where the local player is right now, as the client predicts it. */
  get localState(): { floor: number; x: number; y: number; hidden: boolean } | null {
    if (!this.me) return null;
    return { floor: this.me.floor, x: this.predicted.x, y: this.predicted.y, hidden: this.me.hidden };
  }

  /** What USE would do right now (null = nothing in reach). */
  currentUseTarget(): UseTarget | null {
    const s = this.localState;
    return s ? useTarget(hostelMap, s) : null;
  }

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
            this.refreshView(player, id);
          }),
        );
      }),
      $(room.state).players.onRemove((_player, id) => {
        this.remotes.get(id)?.view.container.destroy();
        this.remotes.delete(id);
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
    this.pending = [];
    this.localView.container.setPosition(player.x, player.y).setDepth(player.y);
    this.showFloor(player.floor);
    this.cameras.main.startFollow(this.localView.container, true);
    this.refreshView(player, player.id);
  }

  private addRemote(player: Player, id: string): void {
    this.remotes.get(id)?.view.container.destroy();
    const view = createPlayerView(this, player.name, PLAYER_COLORS[player.color], false);
    const buffer = new InterpolationBuffer();
    buffer.reset(player.x, player.y);
    view.container.setPosition(player.x, player.y);
    this.remotes.set(id, { view, buffer, lastTp: player.tp });
    this.refreshView(player, id);
  }

  private onLocalChange(player: Player): void {
    this.reconcile(player);
    if (player.tp !== this.lastTp) {
      // Teleported: no lerp from the old spot, and switch floors if needed.
      this.lastTp = player.tp;
      this.previous = { ...this.predicted };
      this.showFloor(player.floor);
      this.remotes.forEach((_r, id) => {
        const p = net.room?.state.players.get(id);
        if (p) this.refreshView(p, id);
      });
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

  /** Non-positional state: name, colour, connected, hidden, floor visibility. */
  private refreshView(player: Player, id: string): void {
    const isLocal = id === net.sessionId;
    const view = isLocal ? this.localView : this.remotes.get(id)?.view;
    if (!view) return;
    const tag = !player.connected ? " (offline)" : isLocal && player.hidden ? " (hiding)" : "";
    view.label.setText(player.name + tag);
    view.body.setTint(PLAYER_COLORS[player.color]);
    if (isLocal) {
      view.container.setAlpha(player.hidden ? HIDDEN_SELF_ALPHA : 1);
    } else {
      view.container.setVisible(player.floor === this.currentFloor && !player.hidden);
      view.container.setAlpha(player.connected ? 1 : OFFLINE_ALPHA);
    }
  }

  /** Server says where we are as of input `ack`; replay everything after it. */
  private reconcile(player: Player): void {
    this.pending = this.pending.filter((input) => input.seq > player.ack);
    let pos: Vec2 = { x: player.x, y: player.y };
    if (!player.hidden) for (const input of this.pending) pos = this.applyInput(pos, input, player.floor);
    this.predicted = pos;
  }

  private applyInput(pos: Vec2, input: InputMessage, floorId: number): Vec2 {
    const floor = hostelMap.floors.get(floorId);
    if (!floor) return pos;
    const dir = sanitizeDirection(input.dx, input.dy);
    return stepMovement(floor.grid, pos, dir, BASE_SPEED_PX_PER_SEC, TICK_DT, PLAYER_RADIUS_PX);
  }

  private hud(): HUDScene | undefined {
    return this.scene.get("HUD") as HUDScene | undefined;
  }

  private currentInput(): Vec2 {
    const kb = this.keyboard.vector;
    if (kb.x !== 0 || kb.y !== 0) return kb;
    return this.hud()?.touch?.vector ?? { x: 0, y: 0 };
  }

  private handleUse(): void {
    const pressed =
      Phaser.Input.Keyboard.JustDown(this.keyboard.use) || (this.hud()?.touch?.consumePress("use") ?? false);
    if (pressed && this.currentUseTarget()) net.room?.send(ClientMsg.Use);
  }

  override update(): void {
    const room = net.room;
    if (!room || !this.me) return;
    const now = performance.now();

    this.handleUse();

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
      // Standing still (or hiding) costs nothing: the server keeps us where we are.
      if ((dir.x === 0 && dir.y === 0) || net.reconnecting || this.me.hidden) continue;
      const input: InputMessage = { dx: dir.x, dy: dir.y, seq: ++this.seq };
      room.send(ClientMsg.Input, input);
      this.pending.push(input);
      this.predicted = this.applyInput(this.predicted, input, this.me.floor);
    }

    // Render the local player between the last two predicted steps.
    if (this.localView) {
      const alpha = Phaser.Math.Clamp(this.inputAccumulator / INPUT_SEND_MS, 0, 1);
      const x = Phaser.Math.Linear(this.previous.x, this.predicted.x, alpha);
      const y = Phaser.Math.Linear(this.previous.y, this.predicted.y, alpha);
      this.localView.container.setPosition(x, y).setDepth(y);
    }

    this.remotes.forEach((r) => {
      if (!r.view.container.visible) return;
      const p = r.buffer.sample(now);
      if (p) r.view.container.setPosition(p.x, p.y).setDepth(p.y);
    });
  }
}
