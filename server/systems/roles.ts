// Role assignment at round start, and who-is-what lookups for the rest of
// the round. Roles live only here on the server; each client is told its own.
//
//   15–20 players: all 4 player killers + Supreme Leader + Gujju Rapper NPC
//   10–14 players: 3 random killers   + Supreme Leader + Gujju Rapper NPC
//    5–9  players: 2 random killers   + Supreme Leader
//   Everyone else is a regular Hosteller.

import {
  GUJJU_MIN_PLAYERS,
  KILLERS_BIG_ROOM,
  KILLERS_MID_ROOM,
  KILLERS_SMALL_ROOM,
  ROLES_BIG_ROOM_MIN,
  ROLES_MID_ROOM_MIN,
} from "../../shared/constants";
import {
  GUJJU_RAPPER_ID,
  PLAYER_KILLERS,
  REGULAR,
  SUPREME_LEADER_ID,
  character,
} from "../../shared/characters";
import type { CharacterDef } from "../../shared/characters";
import type { RoleMessage } from "../../shared/types";

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function killerCountFor(players: number): number {
  if (players >= ROLES_BIG_ROOM_MIN) return KILLERS_BIG_ROOM;
  if (players >= ROLES_MID_ROOM_MIN) return KILLERS_MID_ROOM;
  return KILLERS_SMALL_ROOM;
}

export class RoleSystem {
  private roleOf = new Map<string, CharacterDef>();
  /** NPC characters in play this round (the Gujju Rapper). */
  npcs: CharacterDef[] = [];

  /**
   * Deal characters to `ids`. `forced` (debug only) pins one player's
   * character; the rest of the deal works around it.
   */
  assign(ids: string[], forced?: { id: string; characterId: string }): void {
    this.clear();
    const n = ids.length;
    const killers = shuffle(PLAYER_KILLERS).slice(0, killerCountFor(n));
    const deck: CharacterDef[] = [...killers, character(SUPREME_LEADER_ID)!];
    while (deck.length < n) deck.push(REGULAR);

    let remainingIds = shuffle(ids);
    const pinned = forced ? character(forced.characterId) : undefined;
    if (forced && pinned && !pinned.npc && ids.includes(forced.id)) {
      // Take a card out of the deck for the pinned player: the same character
      // if it was dealt, else one of the same role kind, else the last card.
      let idx = deck.findIndex((c) => c.id === pinned.id);
      if (idx < 0) idx = deck.findIndex((c) => c.role === pinned.role);
      if (idx < 0) idx = deck.length - 1;
      deck.splice(idx, 1);
      this.roleOf.set(forced.id, pinned);
      remainingIds = remainingIds.filter((id) => id !== forced.id);
    }
    const shuffledDeck = shuffle(deck);
    remainingIds.forEach((id, i) => this.roleOf.set(id, shuffledDeck[i] ?? REGULAR));

    this.npcs = n >= GUJJU_MIN_PLAYERS ? [character(GUJJU_RAPPER_ID)!] : [];
  }

  clear(): void {
    this.roleOf.clear();
    this.npcs = [];
  }

  get(id: string): CharacterDef | undefined {
    return this.roleOf.get(id);
  }

  /** Mid-round joiner: no character, watches as a ghost. */
  isSpectator(id: string): boolean {
    return !this.roleOf.has(id);
  }

  isKiller(id: string): boolean {
    return this.roleOf.get(id)?.role === "killer";
  }

  remove(id: string): void {
    this.roleOf.delete(id);
  }

  ids(): string[] {
    return [...this.roleOf.keys()];
  }

  /** The private message for one player. Killers learn the other killers' names. */
  messageFor(id: string, nameOf: (id: string) => string): RoleMessage {
    const c = this.roleOf.get(id);
    if (!c) return { characterId: "", fellowKillers: [], spectator: true };
    const fellowKillers =
      c.role === "killer"
        ? [...this.roleOf].filter(([other, oc]) => other !== id && oc.role === "killer").map(([other]) => nameOf(other))
        : [];
    return { characterId: c.id, fellowKillers, spectator: false };
  }
}
