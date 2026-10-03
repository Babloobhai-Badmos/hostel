// Connection to the game server: join, reconnect, and the shared Room handle.

import { Client, Room, getStateCallbacks } from "colyseus.js";
import { RECONNECT_SECONDS, ROOM_NAME } from "../../shared/constants";
import type { JoinOptions } from "../../shared/types";
import type { GameState } from "../../server/schema/GameState";

const TOKEN_KEY = "hostel.reconnectionToken";
const NAME_KEY = "hostel.name";
/** Colyseus close code for an intentional leave. */
const CLOSE_CONSENTED = 4000;
/** Delay between automatic reconnection attempts. */
const RECONNECT_RETRY_MS = 1500;

// Same host and port the page came from, so LAN IPs and the tunnel both work.
const endpoint = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
const client = new Client(endpoint);

export type GameRoom = Room<GameState>;

type Listener = () => void;

class Net {
  room: GameRoom | null = null;
  /** True while we're trying to get back into the room after a drop. */
  reconnecting = false;
  private roomListeners = new Set<Listener>();
  private statusListeners = new Set<Listener>();

  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  get savedName(): string {
    return safeGet(localStorage, NAME_KEY) ?? "";
  }

  /** Called whenever `room` is replaced (first join or a reconnect). */
  onRoom(fn: Listener): () => void {
    this.roomListeners.add(fn);
    return () => this.roomListeners.delete(fn);
  }

  /** Called when `reconnecting` changes. */
  onStatus(fn: Listener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  async join(name: string): Promise<GameRoom> {
    safeSet(localStorage, NAME_KEY, name);
    const options: JoinOptions = { name };
    const room = await client.joinOrCreate<GameState>(ROOM_NAME, options);
    this.attach(room);
    return room;
  }

  /** Try to resume the slot we had before a page reload. */
  async resume(): Promise<GameRoom | null> {
    const token = safeGet(sessionStorage, TOKEN_KEY);
    if (!token) return null;
    try {
      const room = await client.reconnect<GameState>(token);
      this.attach(room);
      return room;
    } catch {
      safeSet(sessionStorage, TOKEN_KEY, null);
      return null;
    }
  }

  callbacks(room: GameRoom) {
    return getStateCallbacks(room);
  }

  private attach(room: GameRoom): void {
    this.room = room;
    safeSet(sessionStorage, TOKEN_KEY, room.reconnectionToken);
    room.onLeave((code) => {
      if (this.room !== room) return;
      if (code === CLOSE_CONSENTED) {
        safeSet(sessionStorage, TOKEN_KEY, null);
        return;
      }
      void this.reconnectLoop(room.reconnectionToken);
    });
    this.roomListeners.forEach((fn) => fn());
  }

  /** Keep retrying until the server's reconnection window closes. */
  private async reconnectLoop(token: string): Promise<void> {
    this.setReconnecting(true);
    const deadline = Date.now() + RECONNECT_SECONDS * 1000;
    while (Date.now() < deadline) {
      try {
        const room = await client.reconnect<GameState>(token);
        this.setReconnecting(false);
        this.attach(room);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, RECONNECT_RETRY_MS));
      }
    }
    // Slot is gone. Start fresh.
    safeSet(sessionStorage, TOKEN_KEY, null);
    location.reload();
  }

  private setReconnecting(value: boolean): void {
    this.reconnecting = value;
    this.statusListeners.forEach((fn) => fn());
  }
}

// Storage can throw in private mode; the game must still work without it.
function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(store: Storage, key: string, value: string | null): void {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // ignore
  }
}

export const net = new Net();
