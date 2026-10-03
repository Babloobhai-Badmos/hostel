// Typed access to characters.json. "Characters are the roles": each player
// is dealt one of these at round start.

import data from "./characters.json";

export type RoleKind = "killer" | "savior" | "regular";

export interface CharacterDef {
  id: string;
  name: string;
  role: RoleKind;
  /** Multiplier on BASE_SPEED. */
  speed: number;
  /** Killers: reach in tiles, measured between body edges. */
  attackRange?: number;
  /** Killers: seconds between kills. */
  attackCooldown?: number;
  canVent: boolean;
  ability?: string;
  abilityCooldown?: number;
  /** Played by the server, never dealt to a person. */
  npc?: boolean;
  home?: string;
  finisher?: string;
  blurb?: string;
  /** Mota-dalla's gas. */
  gasRadius?: number;
  gasSeconds?: number;
  /** Gujju Rapper's beat-stun. */
  stunRadius?: number;
  stunSeconds?: number;
  /** Supreme Leader: shield length, and whether they can revive (once per round). */
  shieldSeconds?: number;
  revive?: boolean;
  reviveHoldSeconds?: number;
}

export const CHARACTERS: CharacterDef[] = data as CharacterDef[];

const byId = new Map(CHARACTERS.map((c) => [c.id, c]));

export function character(id: string): CharacterDef | undefined {
  return byId.get(id);
}

export const REGULAR = character("regular")!;
export const SUPREME_LEADER_ID = "supreme-leader";
export const GUJJU_RAPPER_ID = "gujju-rapper";

/** Killers that can be dealt to a person (not the Gujju Rapper NPC). */
export const PLAYER_KILLERS = CHARACTERS.filter((c) => c.role === "killer" && !c.npc);
