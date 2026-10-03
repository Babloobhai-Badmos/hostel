import Phaser from "phaser";
import { installFullscreenOnTap, preventBrowserGestures } from "./fullscreen";
import { BootScene } from "./scenes/Boot";
import { LobbyScene } from "./scenes/Lobby";
import { GameScene } from "./scenes/Game";
import { HUDScene } from "./scenes/HUD";
import { ResultsScene } from "./scenes/Results";
import { MinigameScene } from "./scenes/Minigame";
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
  scene: [BootScene, LobbyScene, GameScene, HUDScene, ResultsScene, MinigameScene],
});

/**
 * Scene router: whenever we get a room (first join or reconnect) or the
 * room's phase changes, show the matching scenes. A new room restarts the
 * scenes so they rebind to it; a phase change within the same room keeps the
 * game running (reveal -> playing -> ended).
 */
let boundRoom: unknown = null;
function showScenesFor(phase: string): void {
  const sm = game.scene;
  const freshRoom = boundRoom !== net.room;
  boundRoom = net.room;
  if (phase !== GamePhase.Playing) sm.stop("Minigame");
  if (phase === GamePhase.Lobby) {
    sm.stop("Game");
    sm.stop("HUD");
    sm.stop("Results");
    sm.start("Lobby");
    return;
  }
  sm.stop("Lobby");
  for (const key of ["Game", "HUD"]) {
    if (freshRoom || !sm.isActive(key)) sm.start(key);
  }
  if (phase === GamePhase.Ended) {
    if (freshRoom || !sm.isActive("Results")) sm.start("Results");
  } else {
    sm.stop("Results");
  }
}

let detachPhase: (() => void) | null = null;
net.onRoom(() => {
  const room = net.room!;
  detachPhase?.();
  boundRoom = null;
  const $ = net.callbacks(room);
  detachPhase = $(room.state).listen("phase", (phase) => showScenesFor(phase), true);
});

// Handy in the browser console while testing.
(window as unknown as { game: Phaser.Game; net: typeof net }).game = game;
(window as unknown as { net: typeof net }).net = net;
