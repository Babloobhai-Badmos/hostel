// The world view: map, players, client-side prediction for the local player
// and interpolation for everyone else.
//
// Local player: every INPUT_SEND_MS we sample the controls, send
// { dx, dy, seq } and immediately apply the same step locally (prediction).
// When the server's position + ack for us arrives, we snap to it and replay
// the inputs it hasn't processed yet (reconciliation).

import Phaser from "phaser";
import {
  BASE_SPEED_PX_PER_SEC,
  INPUT_SEND_MS,
  PLAYER_COLORS,
  PLAYER_RADIUS_PX,
  TEST_ROOM_HEIGHT_TILES,
  TEST_ROOM_WIDTH_TILES,
  TICK_DT,
  TILE_SIZE,
  VIEW_MIN_HEIGHT_TILES,
  VIEW_WIDTH_TILES,
} from "../../../shared/constants";
import { sanitizeDirection, stepMovement } from "../../../shared/physics";
import { buildTestRoom, testRoomSpawns } from "../../../shared/testRoom";
import { ClientMsg } from "../../../shared/types";
import type { CollisionGrid, InputMessage, Vec2 } from "../../../shared/types";
import type { Player } from "../../../server/schema/GameState";
import { KeyboardControls } from "../input/keyboard";
import { InterpolationBuffer } from "../render/interpolation";
import { renderMap } from "../render/mapRenderer";
import { createPlayerView } from "../render/placeholderSprites";
import type { PlayerView } from "../render/placeholderSprites";
import { net } from "../net";
import type { HUDScene } from "./HUD";

/** Max inputs sent in one frame when catching up after a hitch. */
const MAX_INPUT_CATCHUP = 3;

interface RemotePlayer {
  view: PlayerView;
  buffer: InterpolationBuffer;
}

export class GameScene extends Phaser.Scene {
  private grid!: CollisionGrid;
  private keyboard!: KeyboardControls;
  private remotes = new Map<string, RemotePlayer>();
  private localView: PlayerView | null = null;
  private cleanups: (() => void)[] = [];

  // Prediction state for the local player.
  private seq = 0;
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
    this.localView = null;
    this.pending = [];
    this.inputAccumulator = 0;
    this.lastFrameAt = performance.now();

    this.grid = buildTestRoom();
    renderMap(
      this,
      this.grid,
      [{
        text: "TEST ROOM",
        x: (TEST_ROOM_WIDTH_TILES * TILE_SIZE) / 2,
        y: (TEST_ROOM_HEIGHT_TILES * TILE_SIZE) / 2 - TILE_SIZE * 5,
      }],
      testRoomSpawns(),
    );
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

  /** Zoom so about VIEW_WIDTH_TILES fit across, but never fewer than VIEW_MIN_HEIGHT_TILES vertically. */
  private fitCamera(): void {
    const { width, height } = this.scale;
    const zoom = Math.min(
      width / (VIEW_WIDTH_TILES * TILE_SIZE),
      height / (VIEW_MIN_HEIGHT_TILES * TILE_SIZE),
    );
    this.cameras.main.setZoom(zoom);
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
            if (id === room.sessionId) this.reconcile(player);
            else this.remotes.get(id)?.buffer.push(player.x, player.y);
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
    this.localView = createPlayerView(this, player.name, PLAYER_COLORS[player.color], true);
    this.localView.container.setDepth(player.y);
    this.predicted = { x: player.x, y: player.y };
    this.previous = { ...this.predicted };
    this.pending = [];
    this.localView.container.setPosition(player.x, player.y);
    this.cameras.main.startFollow(this.localView.container, true);
  }

  private addRemote(player: Player, id: string): void {
    this.remotes.get(id)?.view.container.destroy();
    const view = createPlayerView(this, player.name, PLAYER_COLORS[player.color], false);
    const buffer = new InterpolationBuffer();
    buffer.reset(player.x, player.y);
    view.container.setPosition(player.x, player.y);
    this.remotes.set(id, { view, buffer });
    this.refreshView(player, id);
  }

  /** Non-positional state: name, colour, connected. */
  private refreshView(player: Player, id: string): void {
    const view = id === net.sessionId ? this.localView : this.remotes.get(id)?.view;
    if (!view) return;
    view.label.setText(player.connected ? player.name : `${player.name} (offline)`);
    view.body.setTint(PLAYER_COLORS[player.color]);
    view.container.setAlpha(player.connected ? 1 : 0.4);
  }

  /** Server says where we are as of input `ack`; replay everything after it. */
  private reconcile(player: Player): void {
    this.pending = this.pending.filter((input) => input.seq > player.ack);
    let pos: Vec2 = { x: player.x, y: player.y };
    for (const input of this.pending) pos = this.applyInput(pos, input);
    this.predicted = pos;
  }

  private applyInput(pos: Vec2, input: InputMessage): Vec2 {
    const dir = sanitizeDirection(input.dx, input.dy);
    return stepMovement(this.grid, pos, dir, BASE_SPEED_PX_PER_SEC, TICK_DT, PLAYER_RADIUS_PX);
  }

  private currentInput(): Vec2 {
    const kb = this.keyboard.vector;
    if (kb.x !== 0 || kb.y !== 0) return kb;
    const hud = this.scene.get("HUD") as HUDScene | undefined;
    return hud?.touch?.vector ?? { x: 0, y: 0 };
  }

  override update(): void {
    const room = net.room;
    if (!room) return;
    const now = performance.now();

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
      // Standing still costs nothing: the server keeps us where we are.
      if ((dir.x === 0 && dir.y === 0) || net.reconnecting) continue;
      const input: InputMessage = { dx: dir.x, dy: dir.y, seq: ++this.seq };
      room.send(ClientMsg.Input, input);
      this.pending.push(input);
      this.predicted = this.applyInput(this.predicted, input);
    }

    // Render the local player between the last two predicted steps.
    if (this.localView) {
      const alpha = Phaser.Math.Clamp(this.inputAccumulator / INPUT_SEND_MS, 0, 1);
      const x = Phaser.Math.Linear(this.previous.x, this.predicted.x, alpha);
      const y = Phaser.Math.Linear(this.previous.y, this.predicted.y, alpha);
      this.localView.container.setPosition(x, y).setDepth(y);
    }

    this.remotes.forEach((r) => {
      const p = r.buffer.sample(now);
      if (p) r.view.container.setPosition(p.x, p.y).setDepth(p.y);
    });
  }
}
