// Screen-space overlay on top of the Game scene: touch controls and a small
// status line. Later phases add the task list, progress bar, minimap, role
// badge and kill feed here.

import Phaser from "phaser";
import { MAX_PLAYERS } from "../../../shared/constants";
import { TouchControls } from "../input/touch";
import { net } from "../net";

const STATUS_FONT_PX = 14;
const STATUS_MARGIN_PX = 10;

export class HUDScene extends Phaser.Scene {
  touch: TouchControls | null = null;
  private status!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;

  constructor() {
    super("HUD");
  }

  create(): void {
    this.touch = new TouchControls(this);
    this.status = this.add.text(STATUS_MARGIN_PX, STATUS_MARGIN_PX, "", {
      fontFamily: "system-ui, sans-serif",
      fontSize: `${STATUS_FONT_PX}px`,
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
    });
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
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.touch = null;
    });
  }

  private layout(): void {
    this.banner.setPosition(this.scale.width / 2, this.scale.height / 2);
  }

  override update(): void {
    this.touch?.draw();
    const room = net.room;
    if (!room) return;
    let connected = 0;
    room.state.players.forEach((p) => {
      if (p.connected) connected++;
    });
    const me = room.state.players.get(room.sessionId);
    this.status.setText(`${me?.name ?? ""}  ·  ${connected}/${MAX_PLAYERS} players`);
    this.banner.setVisible(net.reconnecting);
  }
}
