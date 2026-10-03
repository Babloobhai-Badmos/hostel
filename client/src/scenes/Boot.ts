import Phaser from "phaser";
import { createPlaceholderTextures } from "../render/placeholderSprites";
import { bakeFloorTextures } from "../render/mapRenderer";
import { hostelMap } from "../../../shared/world";
import { net } from "../net";

/** Generates placeholder art and the floor textures, then resumes a previous session or shows the lobby. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create(): void {
    createPlaceholderTextures(this);
    bakeFloorTextures(this, hostelMap);
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Loading…", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    // After a page reload, try to reclaim our slot (the main router then picks
    // the right scene). Otherwise show the name entry.
    void net.resume().then((room) => {
      if (!room) this.scene.start("Lobby");
      else this.scene.stop();
    });
  }
}
