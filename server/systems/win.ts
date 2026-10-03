// Win conditions (checked every tick while playing). Disconnected players
// don't count as alive. The Gujju Rapper NPC isn't counted on either side.
//
//   Crew wins:    every killer is dead or gone.
//                 (Phase 4 adds: all living regular players finished their tasks.)
//   Killers win:  every non-killer is dead, or killers >= non-killers alive.

import type { ResultsMessage } from "../../shared/types";
import type { GameState } from "../schema/GameState";
import type { RoleSystem } from "./roles";

export interface WinResult {
  winner: ResultsMessage["winner"];
  reason: string;
}

export function checkWin(state: GameState, roles: RoleSystem): WinResult | null {
  let killers = 0;
  let others = 0;
  for (const id of roles.ids()) {
    const p = state.players.get(id);
    if (!p || !p.connected || !p.alive) continue;
    if (roles.isKiller(id)) killers++;
    else others++;
  }
  if (killers === 0) return { winner: "crew", reason: "All the killers are gone." };
  if (others === 0) return { winner: "killers", reason: "Everyone is dead." };
  if (killers >= others) return { winner: "killers", reason: "The killers outnumber everyone left alive." };
  return null;
}
