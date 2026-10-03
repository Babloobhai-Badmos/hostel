import { MapSchema, Schema, type } from "@colyseus/schema";
import { ChaosKind, GamePhase } from "../../shared/types";

/**
 * Everything in here is synced to every client. Roles are NOT in here: each
 * client is told only its own role, by private message.
 */
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  /** Which floor the player is on (layout.json floor id). */
  @type("uint8") floor = 0;
  /** False = ghost: walks through walls, invisible to the living. */
  @type("boolean") alive = true;
  /** Inside a hiding spot: invisible to others and can't move. */
  @type("boolean") hidden = false;
  /** Travelling through a vent: invisible and can't move. */
  @type("boolean") venting = false;
  /** Can't be killed right now (spawn protection or the Supreme Leader's shield). */
  @type("boolean") safe = false;
  /** Frozen by the Gujju Rapper's beat: can't move or act, but can still be killed. */
  @type("boolean") stunned = false;
  /** Arch-Semen mid-dash (everyone sees the speed; clients predict with it). */
  @type("boolean") dashing = false;
  /** Bumped on every teleport (stairs, vents, round start) so clients snap instead of sliding. */
  @type("uint8") tp = 0;
  /** Index into PLAYER_COLORS. */
  @type("uint8") color = 0;
  /** The player's own face photo (small JPEG data URL), or "" for the cartoon face. */
  @type("string") face = "";
  @type("boolean") connected = true;
  /** Last input sequence number the server applied; used for client reconciliation. */
  @type("uint32") ack = 0;
}

/** A computer-controlled character (the Gujju Rapper, the warden). */
export class Npc extends Schema {
  @type("string") id = "";
  /** "gujju" | "warden": picks the look on the client. */
  @type("string") kind = "gujju";
  @type("string") name = "";
  /** Facing in radians (the warden's flashlight points this way). */
  @type("float32") facing = 0;
  @type("uint8") floor = 0;
  @type("float32") x = 0;
  @type("float32") y = 0;
  /** idle | awake | hunting | returning (drives the speech bubble). */
  @type("string") mood = "idle";
}

/** Mota-dalla's poison cloud: kills non-killers who enter it until it fades. */
export class Gas extends Schema {
  @type("string") id = "";
  @type("uint8") floor = 0;
  @type("float32") x = 0;
  @type("float32") y = 0;
  /** Pixels. */
  @type("float32") radius = 0;
}

/** A dead body. Bodies are never cleared during a round (a revive removes one). */
export class Body extends Schema {
  @type("string") id = "";
  @type("string") victimId = "";
  @type("uint8") color = 0;
  @type("uint8") floor = 0;
  @type("float32") x = 0;
  @type("float32") y = 0;
}

export class GameState extends Schema {
  @type("string") phase: GamePhase = GamePhase.Lobby;
  @type("string") hostId = "";
  /** Debug room (bots fill the gaps). Shown in the lobby. */
  @type("boolean") debug = false;
  /** The chaos event running right now ("" = none). */
  @type("string") chaos: ChaosKind = ChaosKind.None;
  /** Crew task progress, 0..1: finished / assigned, over living regular players. */
  @type("float32") taskProgress = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Body }) bodies = new MapSchema<Body>();
  @type({ map: Npc }) npcs = new MapSchema<Npc>();
  @type({ map: Gas }) gas = new MapSchema<Gas>();
  /** Doors this round: doorway id (see shared/doors.ts) -> open. Empty in the lobby. */
  @type({ map: "boolean" }) doors = new MapSchema<boolean>();
}
