import { MapSchema, Schema, type } from "@colyseus/schema";
import { GamePhase } from "../../shared/types";

/**
 * Everything in here is synced to every client. Keep secrets (roles, task
 * lists) out of this schema: they go to individual clients as private
 * messages in later phases.
 */
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  /** Index into PLAYER_COLORS. */
  @type("uint8") color = 0;
  @type("boolean") connected = true;
  /** Last input sequence number the server applied; used for client reconciliation. */
  @type("uint32") ack = 0;
}

export class GameState extends Schema {
  @type("string") phase: GamePhase = GamePhase.Lobby;
  @type("string") hostId = "";
  @type({ map: Player }) players = new MapSchema<Player>();
}
