// Screen-space overlay on top of the Game scene: touch controls, where you
// are, what USE would do, and a minimap of the floor with a floor toggle.
// Later phases add the task list, progress bar, role badge and kill feed.

import Phaser from "phaser";
import { MAX_PLAYERS, TILE_SIZE } from "../../../shared/constants";
import { areaAt } from "../../../shared/buildMap";
import type { UseTarget } from "../../../shared/interact";
import { hostelMap } from "../../../shared/world";
import { TouchControls } from "../input/touch";
import { bakeMinimapTexture } from "../render/mapRenderer";
import { net } from "../net";
import type { GameScene } from "./Game";

const STATUS_FONT_PX = 14;
const MARGIN_PX = 10;
/** Minimap height as a fraction of the screen height. */
const MINIMAP_HEIGHT_FRAC = 0.3;
const MINIMAP_MIN_PX_PER_TILE = 2;
const MINIMAP_MAX_PX_PER_TILE = 4;
const MINIMAP_SELF_COLOR = 0xffe066;
const MINIMAP_SELF_RADIUS = 3;

const textStyle = (px: number): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: "system-ui, sans-serif",
  fontSize: `${px}px`,
  color: "#ffffff",
  stroke: "#000000",
  strokeThickness: 3,
});

function describeUse(t: UseTarget): { button: string; prompt: string } {
  switch (t.kind) {
    case "unhide":
      return { button: "EXIT", prompt: "Climb out" };
    case "stairs": {
      const floor = hostelMap.stairs.get(t.stair.target)?.floor;
      const name = floor !== undefined ? hostelMap.floors.get(floor)?.name : "";
      return { button: "STAIRS", prompt: `Take the stairs to ${name}` };
    }
    case "hide":
      return { button: "HIDE", prompt: `Hide in the ${t.spot.type.replace(/-/g, " ")}` };
  }
}

export class HUDScene extends Phaser.Scene {
  touch: TouchControls | null = null;
  private status!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private minimap!: Phaser.GameObjects.Image;
  private minimapFrame!: Phaser.GameObjects.Graphics;
  private minimapLabel!: Phaser.GameObjects.Text;
  private minimapFloor = hostelMap.spawnFloor;
  /** The floor the local player was on last frame; the minimap follows it when it changes. */
  private lastOwnFloor = -1;
  private pxPerTile = MINIMAP_MIN_PX_PER_TILE;
  private dot: Phaser.GameObjects.Arc | null = null;

  constructor() {
    super("HUD");
  }

  create(): void {
    this.touch = new TouchControls(this);
    this.status = this.add.text(MARGIN_PX, MARGIN_PX, "", textStyle(STATUS_FONT_PX));
    this.prompt = this.add.text(0, 0, "", textStyle(STATUS_FONT_PX + 2)).setOrigin(0.5, 1);
    this.banner = this.add
      .text(0, 0, "Connection lost. Reconnecting…", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "22px",
        fontStyle: "bold",
        color: "#ffe066",
        backgroundColor: "#000000aa",
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.minimap = this.add.image(0, 0, "__DEFAULT").setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.minimapFrame = this.add.graphics();
    this.minimapLabel = this.add.text(0, 0, "", textStyle(STATUS_FONT_PX)).setOrigin(1, 0);
    // Tap the minimap (or press M) to look at the other floor.
    this.minimap.on(Phaser.Input.Events.POINTER_DOWN, () => this.cycleMinimapFloor());
    this.input.keyboard?.on("keydown-M", () => this.cycleMinimapFloor());
    this.lastOwnFloor = -1;
    this.dot = null;

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.touch = null;
    });
  }

  private cycleMinimapFloor(): void {
    const ids = hostelMap.floorIds;
    this.minimapFloor = ids[(ids.indexOf(this.minimapFloor) + 1) % ids.length];
    this.refreshMinimap();
  }

  private layout(): void {
    const { width, height } = this.scale;
    this.banner.setPosition(width / 2, height / 2);
    this.prompt.setPosition(width / 2, height - MARGIN_PX);
    const floor = hostelMap.floors.get(this.minimapFloor)!;
    this.pxPerTile = Phaser.Math.Clamp(
      Math.floor((height * MINIMAP_HEIGHT_FRAC) / floor.grid.height),
      MINIMAP_MIN_PX_PER_TILE,
      MINIMAP_MAX_PX_PER_TILE,
    );
    this.refreshMinimap();
  }

  private refreshMinimap(): void {
    const { width } = this.scale;
    const floor = hostelMap.floors.get(this.minimapFloor)!;
    this.minimap.setTexture(bakeMinimapTexture(this, floor, this.pxPerTile));
    this.minimap.setPosition(width - MARGIN_PX, MARGIN_PX);
    this.minimapLabel
      .setText(`${floor.name}  ⇄`)
      .setPosition(width - MARGIN_PX - 4, MARGIN_PX + this.minimap.height + 2);
    this.minimapFrame.clear();
    this.minimapFrame.lineStyle(2, 0xffffff, 0.6);
    this.minimapFrame.strokeRect(width - MARGIN_PX - this.minimap.width, MARGIN_PX, this.minimap.width, this.minimap.height);
  }

  override update(): void {
    this.touch?.draw();
    this.banner.setVisible(net.reconnecting);
    const room = net.room;
    const game = this.scene.get("Game") as GameScene | undefined;
    const me = game?.localState;
    if (!room || !game || !me) return;

    // Status line: who you are, where you are, how many are in.
    let connected = 0;
    room.state.players.forEach((p) => {
      if (p.connected) connected++;
    });
    const floor = hostelMap.floors.get(me.floor);
    const area = floor ? areaAt(floor, me.x, me.y) : null;
    const name = room.state.players.get(room.sessionId)?.name ?? "";
    this.status.setText(`${name}  ·  ${floor?.name ?? ""}${area?.label ? ` · ${area.label}` : ""}  ·  ${connected}/${MAX_PLAYERS}`);

    // USE button + prompt.
    const target = game.currentUseTarget();
    const use = target ? describeUse(target) : null;
    this.touch?.setEnabled("use", !!use);
    this.touch?.setLabel("use", use?.button ?? "USE");
    const keyHint = this.touch?.visible ? "" : "[E] ";
    this.prompt.setText(use ? `${keyHint}${use.prompt}` : "");

    // Minimap follows you between floors; draw your dot on your own floor.
    if (me.floor !== this.lastOwnFloor) {
      this.lastOwnFloor = me.floor;
      this.minimapFloor = me.floor;
      this.refreshMinimap();
    }
    if (this.minimapFloor === me.floor) {
      const left = this.scale.width - MARGIN_PX - this.minimap.width;
      const dotX = left + (me.x / TILE_SIZE) * this.pxPerTile;
      const dotY = MARGIN_PX + (me.y / TILE_SIZE) * this.pxPerTile;
      this.refreshMinimapDot(dotX, dotY);
    } else {
      this.refreshMinimapDot(null, null);
    }
  }

  private refreshMinimapDot(x: number | null, y: number | null): void {
    if (!this.dot) this.dot = this.add.circle(0, 0, MINIMAP_SELF_RADIUS, MINIMAP_SELF_COLOR).setStrokeStyle(1, 0x000000);
    if (x === null || y === null) this.dot.setVisible(false);
    else this.dot.setVisible(true).setPosition(x, y);
  }
}
