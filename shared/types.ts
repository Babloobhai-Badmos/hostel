// Message names and payload shapes shared by server and client.

export const ClientMsg = {
  /** Movement input, sent at INPUT_SEND_RATE. */
  Input: "input",
  /** Host only: start the round. */
  Start: "start",
  /** Host only: back to the lobby after the results screen. */
  PlayAgain: "playAgain",
  /** Ask the server to (re)send this client's private info: role, results. */
  WhoAmI: "whoAmI",
  Attack: "attack",
  Use: "use",
  // Reserved for later phases:
  Ability: "ability",
  TaskDone: "taskDone",
} as const;
export type ClientMsg = (typeof ClientMsg)[keyof typeof ClientMsg];

export const ServerMsg = {
  /** Sent to a single client when the server rejects an action. */
  Error: "error",
  /** Private: your character, and who your fellow killers are. */
  Role: "role",
  /** Private: your cooldowns (ms remaining) after you act. */
  Cooldowns: "cooldowns",
  /** Broadcast: someone was killed (for effects and the kill feed). No killer identity. */
  Kill: "kill",
  /** Broadcast: a vent grate popped. */
  VentPop: "ventPop",
  /** Broadcast: a hiding spot was searched. */
  Search: "search",
  /** Broadcast: round over, roles revealed. */
  Results: "results",
} as const;
export type ServerMsg = (typeof ServerMsg)[keyof typeof ServerMsg];

export const GamePhase = {
  Lobby: "lobby",
  /** Role-reveal screen; nobody moves. */
  Reveal: "reveal",
  Playing: "playing",
  /** Results screen. */
  Ended: "ended",
} as const;
export type GamePhase = (typeof GamePhase)[keyof typeof GamePhase];

/** A single movement input. dx/dy are in [-1, 1]; the server clamps the length to 1. */
export interface InputMessage {
  dx: number;
  dy: number;
  /** Increasing sequence number so the client can reconcile its prediction. */
  seq: number;
}

export interface JoinOptions {
  name: string;
  /** Host only: fill the room with wandering bots (from ?debug=1). */
  debug?: boolean;
  /** Debug only: how many players in total after bot fill (?bots=N). */
  bots?: number;
  /** Debug only: force your own character (?role=arch-semen). */
  role?: string;
}

export interface RoleMessage {
  characterId: string;
  /** Names of the other killers (killers only). */
  fellowKillers: string[];
  /** True for spectators who joined mid-round. */
  spectator: boolean;
}

export interface CooldownMessage {
  /** Milliseconds until each action is ready again. */
  attack: number;
  vent: number;
  search: number;
  /** Milliseconds of spawn protection left. */
  protection: number;
}

export interface KillMessage {
  victimId: string;
  victimName: string;
  floor: number;
  x: number;
  y: number;
  /** Direction the victim is flung, radians. */
  angle: number;
  /** Which finishing move to animate (character's `finisher`). */
  finisher: string;
}

export interface VentPopMessage {
  floor: number;
  x: number;
  y: number;
}

export interface SearchMessage {
  floor: number;
  x: number;
  y: number;
  found: boolean;
}

export interface ResultRow {
  name: string;
  character: string;
  role: string;
  alive: boolean;
  kills: number;
  bot: boolean;
}

export interface ResultsMessage {
  winner: "crew" | "killers";
  reason: string;
  players: ResultRow[];
}

export interface ErrorMessage {
  message: string;
}

/** Tile collision grid. Phase 2's map builder produces the same shape. */
export interface CollisionGrid {
  width: number;
  height: number;
  tileSize: number;
  /** Row-major, 1 = solid wall, 0 = walkable. */
  solid: Uint8Array;
}

export interface Vec2 {
  x: number;
  y: number;
}
