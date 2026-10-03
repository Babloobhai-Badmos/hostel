// Full-screen overlay that hosts one minigame. Opened when the server
// accepts USE at one of your task stations; closed by the ✕ button (or Esc),
// by finishing, or by the server (you moved away, died, or the round ended).
//
// While it's open you're still standing in the hostel, and killers can still
// get you. The world keeps running underneath.

import Phaser from "phaser";
import { ClientMsg } from "../../../shared/types";
import type { TaskOpenMessage } from "../../../shared/types";
import { buzzPhone, sfx } from "../audio/synth";
import { MINIGAMES } from "../minigames";
import type { Minigame } from "../minigames/types";
import { label } from "../minigames/ui";

/** Name of the full-screen backdrop: minigames ignore it when checking what a touch landed on. */
export const BACKDROP_NAME = "minigame-backdrop";
import { net } from "../net";

/** Fraction of the screen the panel leaves as a margin on each side. */
const MARGIN_FRAC = 0.02;
const TITLE_FRAC = 0.13;
/** How long "DONE!" shows before the overlay closes. */
const DONE_HOLD_MS = 700;
/** Longer frames (tab in background) are clamped so timers don't jump. */
const MAX_FRAME_MS = 100;

export class MinigameScene extends Phaser.Scene {
  private game_: Minigame | null = null;
  private task: TaskOpenMessage | null = null;
  private finished = false;
  /** Wall-clock time of the previous frame: Phaser's smoothed delta runs slow on slow phones. */
  private lastFrameAt = 0;

  constructor() {
    super("Minigame");
  }

  /** True while a minigame is on screen (the Game scene stops sending movement). */
  static isOpen(scene: Phaser.Scene): boolean {
    return scene.scene.isActive("Minigame");
  }

  create(data: TaskOpenMessage): void {
    this.task = data;
    this.finished = false;
    this.lastFrameAt = performance.now();
    const { width, height } = this.scale;
    const m = Math.min(width, height) * MARGIN_FRAC;

    // Backdrop eats every touch so nothing reaches the HUD below.
    this.add.rectangle(0, 0, width, height, 0x000000, 0.75).setOrigin(0).setInteractive().setName(BACKDROP_NAME);
    const panel = new Phaser.Geom.Rectangle(m, m, width - m * 2, height - m * 2);
    const g = this.add.graphics();
    g.fillStyle(0x221d2e, 1);
    g.fillRoundedRect(panel.x, panel.y, panel.width, panel.height, m * 2);
    g.lineStyle(3, 0xf4c430, 1);
    g.strokeRoundedRect(panel.x, panel.y, panel.width, panel.height, m * 2);

    const titleH = height * TITLE_FRAC;
    label(this, panel.x + panel.width / 2, panel.y + titleH * 0.35, data.name.toUpperCase(), titleH * 0.32, "#f4c430");
    const status = label(this, panel.x + panel.width / 2, panel.y + titleH * 0.78, "", titleH * 0.2);

    // Close button (top right): gives up without finishing.
    const closeSize = titleH * 0.6;
    const close = this.add
      .text(panel.right - closeSize * 0.7, panel.y + closeSize * 0.7, "✕", {
        fontFamily: "system-ui, sans-serif",
        fontSize: `${closeSize}px`,
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    close.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.cancel());
    this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on("down", () => this.cancel());

    const area = new Phaser.Geom.Rectangle(panel.x + m, panel.y + titleH, panel.width - m * 2, panel.height - titleH - m);
    const factory = MINIGAMES[data.type];
    if (!factory) {
      status.setText(`No minigame for "${data.type}"`);
      return;
    }
    this.game_ = factory({
      scene: this,
      area,
      u: Math.min(area.width, area.height) / 100,
      setStatus: (text) => status.setText(text),
      complete: () => this.complete(status),
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game_?.destroy?.();
      this.game_ = null;
    });
  }

  override update(): void {
    const now = performance.now();
    const dt = Math.min(now - this.lastFrameAt, MAX_FRAME_MS) / 1000;
    this.lastFrameAt = now;
    if (!this.finished) this.game_?.update?.(dt);
  }

  private complete(status: Phaser.GameObjects.Text): void {
    if (this.finished || !this.task) return;
    this.finished = true;
    net.room?.send(ClientMsg.TaskDone, { taskId: this.task.taskId });
    sfx.success();
    buzzPhone(80);
    status.setText("");
    const { width, height } = this.scale;
    const done = label(this, width / 2, height / 2, "DONE!", Math.min(width, height) * 0.2, "#9be564").setScale(0.2);
    this.tweens.add({ targets: done, scale: 1, duration: 250, ease: "Back.Out" });
    this.time.delayedCall(DONE_HOLD_MS, () => this.scene.stop());
  }

  private cancel(): void {
    if (this.finished) return;
    net.room?.send(ClientMsg.TaskCancel);
    this.scene.stop();
  }
}
