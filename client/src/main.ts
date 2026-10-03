import Phaser from "phaser";
import { installFullscreenOnTap, preventBrowserGestures } from "./fullscreen";
import { BootScene } from "./scenes/Boot";
import { LobbyScene } from "./scenes/Lobby";
import { GameScene } from "./scenes/Game";
import { HUDScene } from "./scenes/HUD";
import { net } from "./net";
import { GamePhase } from "../../shared/types";

/** How many fingers can be tracked at once (joystick + a button + spare). */
const MAX_TOUCH_POINTERS = 4;

preventBrowserGestures();
installFullscreenOnTap();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#14121c",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  input: { activePointers: MAX_TOUCH_POINTERS },
  render: { antialias: true, roundPixels: true },
  scene: [BootScene, LobbyScene, GameScene, HUDScene],
});

/**
 * Scene router: whenever we get a room (first join or reconnect) or the
 * room's phase changes, show the matching scenes. Restarting a scene rebinds
 * it to the current room.
 */
function showScenesFor(phase: string): void {
  const sm = game.scene;
  if (phase === GamePhase.Playing) {
    sm.stop("Lobby");
    sm.start("Game");
    sm.start("HUD");
  } else {
    sm.stop("Game");
    sm.stop("HUD");
    sm.start("Lobby");
  }
}

let detachPhase: (() => void) | null = null;
net.onRoom(() => {
  const room = net.room!;
  detachPhase?.();
  const $ = net.callbacks(room);
  detachPhase = $(room.state).listen("phase", (phase) => showScenesFor(phase), true);
});

// Handy in the browser console while testing.
(window as unknown as { game: Phaser.Game }).game = game;
