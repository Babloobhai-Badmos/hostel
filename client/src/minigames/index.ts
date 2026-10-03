// Task type (tasks.json "type") -> minigame. One file per type.

import { carryGame } from "./carry";
import { holdGame } from "./hold";
import { mashGame } from "./mash";
import { patternGame } from "./pattern";
import { rhythmGame } from "./rhythm";
import { scribbleGame } from "./scribble";
import { tapFastGame } from "./tapFast";
import { tweezersGame } from "./tweezers";
import type { MinigameFactory } from "./types";
import { walkMarkersGame } from "./walkMarkers";

export const MINIGAMES: Record<string, MinigameFactory> = {
  hold: holdGame,
  pattern: patternGame,
  carry: carryGame,
  rhythm: rhythmGame,
  "walk-markers": walkMarkersGame,
  scribble: scribbleGame,
  mash: mashGame,
  "tap-fast": tapFastGame,
  tweezers: tweezersGame,
};
