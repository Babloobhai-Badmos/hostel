import { MapSchema, Schema, type } from "@colyseus/schema";
import { GamePhase } from "../../shared/types";

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
  /** Can't be killed right now (spawn protection; later the Supreme Leader's shield). */
  @type("boolean") safe = false;
  /** Bumped on every teleport (stairs, vents, round start) so clients snap instead of sliding. */
  @type("uint8") tp = 0;
  /** Index into PLAYER_COLORS. */
  @type("uint8") color = 0;
  @type("boolean") connected = true;
  /** Last input sequence number the server applied; used for client reconciliation. */
  @type("uint32") ack = 0;
}

/** A dead body. Bodies are never cleared during a round. */
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
  /** Crew task progress, 0..1: finished / assigned, over living regular players. */
  @type("float32") taskProgress = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Body }) bodies = new MapSchema<Body>();
}
