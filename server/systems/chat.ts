// Chat: living players standing in a chat room (layout.json "chatRooms",
// the Common Lounge) can talk to everyone else alive in that same room.
// Nobody outside the room hears it. One line per CHAT_COOLDOWN_SECONDS,
// CHAT_MAX_LENGTH characters, control characters stripped.

import { CHAT_COOLDOWN_SECONDS, CHAT_MAX_LENGTH } from "../../shared/constants";
import { areaAt } from "../../shared/buildMap";
import type { HostelMap } from "../../shared/buildMap";
import type { ChatMessage } from "../../shared/types";
import type { GameState, Player } from "../schema/GameState";

const MS = 1000;

export class ChatSystem {
  private lastAt = new Map<string, number>();

  constructor(private state: GameState, private map: HostelMap) {}

  /** The chat room a player is standing in, or null. */
  roomOf(p: Player): string | null {
    const floor = this.map.floors.get(p.floor);
    const area = floor ? areaAt(floor, p.x, p.y) : null;
    return area && this.map.chatRooms.includes(area.key) ? area.key : null;
  }

  /** Validate a chat line; returns the message and who should receive it, or null. */
  say(p: Player, raw: unknown, now: number): { message: ChatMessage; to: string[] } | null {
    if (!p.alive || !p.connected || p.hidden || p.venting) return null;
    const room = this.roomOf(p);
    if (!room) return null;
    if (now - (this.lastAt.get(p.id) ?? -Infinity) < CHAT_COOLDOWN_SECONDS * MS) return null;
    const text = (typeof raw === "object" && raw !== null ? (raw as { text?: unknown }).text : raw);
    if (typeof text !== "string") return null;
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LENGTH);
    if (!clean) return null;
    this.lastAt.set(p.id, now);
    const to: string[] = [];
    this.state.players.forEach((q) => {
      if (q.alive && q.connected && this.roomOf(q) === room) to.push(q.id);
    });
    return { message: { fromId: p.id, name: p.name, text: clean }, to };
  }

  removePlayer(id: string): void {
    this.lastAt.delete(id);
  }
}
