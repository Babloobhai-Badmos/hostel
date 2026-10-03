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
  /** Finished the minigame for the task the server opened. */
  TaskDone: "taskDone",
  /** Closed a minigame without finishing it. */
  TaskCancel: "taskCancel",
  /** Use your character's ability (Q / ABILITY button). */
  Ability: "ability",
  /** Supreme Leader started / stopped holding USE on a body. */
  ReviveStart: "reviveStart",
  ReviveCancel: "reviveCancel",
  /** A chat line (only works inside a chat room, e.g. the Common Lounge). */
  Chat: "chat",
  /** Lobby only: set or clear your face photo ({ face: dataURL | "" }). */
  Face: "face",
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
  /** Private: your task list (sent whenever it changes). */
  TaskList: "taskList",
  /** Private: the server accepted USE on a task station; open its minigame. */
  TaskOpen: "taskOpen",
  /** Private: close the open minigame (you moved away, died, or the round ended). */
  TaskClose: "taskClose",
  /** Broadcast: an ability effect to draw (dash, wide swing, shield, beat drop, revive, gas). */
  Fx: "fx",
  /** To players in the same chat room: someone said something. */
  Chat: "chat",
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
  /** Debug only: frequent chaos events, all kinds ("all") or just one (?chaos=warden). */
  chaos?: string;
  /** Your face photo as a small JPEG data URL (optional). */
  face?: string;
}

export const ChaosKind = {
  None: "",
  Warden: "warden",
  LightsOut: "lights",
  FoodFight: "foodfight",
  PowerCut: "powercut",
} as const;
export type ChaosKind = (typeof ChaosKind)[keyof typeof ChaosKind];

export interface ChatMessage {
  fromId: string;
  name: string;
  text: string;
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
  ability: number;
  /** Kallu Koli: the next swing is a wide swing. */
  wideArmed: boolean;
  /** Supreme Leader: revive already used this round. */
  reviveUsed: boolean;
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

export type FxKind = "dash" | "wide" | "shield" | "beat" | "revive" | "gas" | "gujju-awake" | "warden-stun";

export interface FxMessage {
  kind: FxKind;
  floor: number;
  x: number;
  y: number;
  /** Facing (dash, wide swing), radians. */
  angle?: number;
  /** Radius in pixels (beat, gas). */
  radius?: number;
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
  /** Real tasks done / assigned (0/0 for killers and the savior). */
  tasksDone: number;
  tasksTotal: number;
  bot: boolean;
}

export interface TaskEntry {
  id: string;
  name: string;
  type: string;
  /** Room label + floor, for the HUD list. */
  where: string;
  done: boolean;
}

export interface TaskListMessage {
  tasks: TaskEntry[];
  /** Killers get a fake list so they can pretend; their tasks never count. */
  fake: boolean;
}

export interface TaskOpenMessage {
  taskId: string;
  type: string;
  name: string;
}

export interface TaskDoneMessage {
  taskId: string;
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
