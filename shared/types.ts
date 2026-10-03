// Message names and payload shapes shared by server and client.

export const ClientMsg = {
  /** Movement input, sent at INPUT_SEND_RATE. */
  Input: "input",
  /** Host only: start the round. */
  Start: "start",
  // Reserved for later phases (server ignores them in phase 1):
  Attack: "attack",
  Use: "use",
  Ability: "ability",
  TaskDone: "taskDone",
} as const;
export type ClientMsg = (typeof ClientMsg)[keyof typeof ClientMsg];

export const ServerMsg = {
  /** Sent to a single client when the server rejects an action. */
  Error: "error",
} as const;
export type ServerMsg = (typeof ServerMsg)[keyof typeof ServerMsg];

export const GamePhase = {
  Lobby: "lobby",
  Playing: "playing",
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
