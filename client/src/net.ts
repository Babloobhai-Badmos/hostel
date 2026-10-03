// Connection to the game server: join, reconnect, and the shared Room handle.

import { Client, Room, getStateCallbacks } from "colyseus.js";
import { RECONNECT_SECONDS, ROOM_NAME } from "../../shared/constants";
import { ClientMsg, ServerMsg } from "../../shared/types";
import type {
  CooldownMessage,
  JoinOptions,
  KillMessage,
  ResultsMessage,
  RoleMessage,
  SearchMessage,
  VentPopMessage,
} from "../../shared/types";
import { character } from "../../shared/characters";
import type { CharacterDef } from "../../shared/characters";
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

/** One-shot world events from the server, for effects and the kill feed. */
export interface NetEvents {
  kill: KillMessage;
  ventPop: VentPopMessage;
  search: SearchMessage;
  results: ResultsMessage;
  error: string;
}
type EventHandler<K extends keyof NetEvents> = (msg: NetEvents[K]) => void;

/** Debug options from the page URL: ?debug=1&bots=8&role=arch-semen */
function debugOptionsFromUrl(): Partial<JoinOptions> {
  const q = new URLSearchParams(location.search);
  if (q.get("debug") !== "1") return {};
  const bots = Number(q.get("bots"));
  return {
    debug: true,
    ...(Number.isInteger(bots) && bots > 0 ? { bots } : {}),
    ...(q.get("role") ? { role: q.get("role")! } : {}),
  };
}

class Net {
  room: GameRoom | null = null;
  /** True while we're trying to get back into the room after a drop. */
  reconnecting = false;
  /** My character this round (null in the lobby / before the server tells us). */
  role: RoleMessage | null = null;
  /** performance.now() timestamps when each action is ready again. */
  readyAt = { attack: 0, vent: 0, search: 0, protection: 0 };
  results: ResultsMessage | null = null;
  private roomListeners = new Set<Listener>();
  private statusListeners = new Set<Listener>();
  private eventHandlers = new Map<keyof NetEvents, Set<(msg: never) => void>>();

  get character(): CharacterDef | undefined {
    return this.role && !this.role.spectator ? character(this.role.characterId) : undefined;
  }

  get isKiller(): boolean {
    return this.character?.role === "killer";
  }

  /** Subscribe to a server event; returns an unsubscribe function. */
  on<K extends keyof NetEvents>(type: K, fn: EventHandler<K>): () => void {
    let set = this.eventHandlers.get(type);
    if (!set) this.eventHandlers.set(type, (set = new Set()));
    set.add(fn as (msg: never) => void);
    return () => set!.delete(fn as (msg: never) => void);
  }

  private emit<K extends keyof NetEvents>(type: K, msg: NetEvents[K]): void {
    this.eventHandlers.get(type)?.forEach((fn) => (fn as EventHandler<K>)(msg));
  }

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
    const options: JoinOptions = { name, ...debugOptionsFromUrl() };
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
    room.onMessage(ServerMsg.Role, (msg: RoleMessage) => {
      this.role = msg;
      this.statusListeners.forEach((fn) => fn());
    });
    room.onMessage(ServerMsg.Cooldowns, (msg: CooldownMessage) => {
      const now = performance.now();
      this.readyAt = {
        attack: now + msg.attack,
        vent: now + msg.vent,
        search: now + msg.search,
        protection: now + msg.protection,
      };
    });
    room.onMessage(ServerMsg.Kill, (msg: KillMessage) => this.emit("kill", msg));
    room.onMessage(ServerMsg.VentPop, (msg: VentPopMessage) => this.emit("ventPop", msg));
    room.onMessage(ServerMsg.Search, (msg: SearchMessage) => this.emit("search", msg));
    room.onMessage(ServerMsg.Error, (msg: { message: string }) => this.emit("error", msg.message));
    room.onMessage(ServerMsg.Results, (msg: ResultsMessage) => {
      this.results = msg;
      this.emit("results", msg);
    });
    // Back in the lobby: forget last round's role and results.
    getStateCallbacks(room)(room.state).listen("phase", (phase) => {
      if (phase === "lobby") {
        this.role = null;
        this.results = null;
      }
    });
    room.send(ClientMsg.WhoAmI);
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
