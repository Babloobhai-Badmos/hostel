// Lobby system: display names, colours, spawn slots and who the host is.

import { FACE_MAX_CHARS, NAME_FALLBACK, NAME_MAX_LENGTH, PLAYER_COLORS } from "../../shared/constants";
import type { Vec2 } from "../../shared/types";
import type { GameState, Player } from "../schema/GameState";

/** Trim, strip control characters and limit length. */
export function sanitizeName(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, NAME_MAX_LENGTH) || NAME_FALLBACK;
}

/**
 * A face photo is accepted only as a small JPEG/PNG/WebP data URL. Anything
 * else (wrong type, too big) is dropped and the cartoon face is used.
 */
export function sanitizeFace(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > FACE_MAX_CHARS) return "";
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw) ? raw : "";
}

/** Append a number if someone already has this name ("Rahul", "Rahul 2", ...). */
export function uniqueName(state: GameState, wanted: string): string {
  const taken = new Set<string>();
  state.players.forEach((p) => taken.add(p.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = wanted.slice(0, NAME_MAX_LENGTH - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** First colour not used by anyone in the room. */
export function pickColor(state: GameState): number {
  const used = new Set<number>();
  state.players.forEach((p) => used.add(p.color));
  for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i;
  return state.players.size % PLAYER_COLORS.length;
}

/** First spawn slot nobody is standing on (falls back to slot by player count). */
export function pickSpawn(state: GameState, spawns: Vec2[]): Vec2 {
  const occupied = (s: Vec2) => {
    let hit = false;
    state.players.forEach((p) => {
      if (Math.abs(p.x - s.x) < 1 && Math.abs(p.y - s.y) < 1) hit = true;
    });
    return hit;
  };
  return spawns.find((s) => !occupied(s)) ?? spawns[state.players.size % spawns.length];
}

/** Spawn slot for each player, in join order (round start). */
export function spawnAssignments(state: GameState, spawns: Vec2[]): [Player, Vec2][] {
  const out: [Player, Vec2][] = [];
  state.players.forEach((p: Player) => out.push([p, spawns[out.length % spawns.length]]));
  return out;
}

/**
 * Keep the host valid: if the host left, hand it to the longest-connected
 * person still connected (MapSchema keeps insertion order = join order).
 * Debug bots never become host: they can't press Start or Play Again.
 */
export function ensureHost(state: GameState, isBot: (id: string) => boolean = () => false): void {
  const current = state.players.get(state.hostId);
  if (current && current.connected) return;
  let next = "";
  state.players.forEach((p) => {
    if (!next && p.connected && !isBot(p.id)) next = p.id;
  });
  if (next) state.hostId = next;
  else if (!current) state.hostId = "";
}
