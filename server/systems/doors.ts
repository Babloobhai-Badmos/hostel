// Doors: at the start of each round DOOR_ROOM_FRACTION of the rooms get real
// doors (all start open). Living players open and close them with USE. A door
// can't shut on someone standing in the doorway. NPCs barge through: a closed
// door they walk up to swings open.
//
// The open/closed state is in GameState.doors; the closed ones are solid in
// this room's collision grids (see shared/doors.ts).

import {
  DOOR_ROOM_FRACTION,
  DOOR_TOGGLE_COOLDOWN_MS,
  NPC_DOOR_BARGE_TILES,
  PLAYER_RADIUS_PX,
} from "../../shared/constants";
import type { Doorway, HostelMap } from "../../shared/buildMap";
import { doorNear, doorwayBlocked, pickDoorways, setDoorClosed } from "../../shared/doors";
import type { GameState } from "../schema/GameState";

export class DoorSystem {
  /** Doorway id -> when it was last opened or closed. */
  private lastToggle = new Map<string, number>();

  constructor(private state: GameState, private map: HostelMap) {}

  /** New round: pick which rooms get doors. They all start open. */
  setupRound(): void {
    this.clear();
    for (const id of pickDoorways(this.map, DOOR_ROOM_FRACTION)) this.state.doors.set(id, true);
  }

  /** Back to the lobby: no doors, every doorway walkable. */
  clear(): void {
    for (const id of this.state.doors.keys()) this.set(this.map.doorways.get(id)!, true);
    this.state.doors.clear();
    this.lastToggle.clear();
  }

  /** Player pressed USE at a door. Returns an error message for the player, if any. */
  toggle(doorway: Doorway, now: number): string | null {
    const open = this.state.doors.get(doorway.id);
    if (open === undefined) return null;
    if (now - (this.lastToggle.get(doorway.id) ?? -Infinity) < DOOR_TOGGLE_COOLDOWN_MS) return null;
    if (open && this.blocked(doorway)) return "Someone's in the doorway!";
    this.set(doorway, !open);
    this.lastToggle.set(doorway.id, now);
    return null;
  }

  /** Open any closed door an NPC is walking into. Call every tick. */
  bargeThrough(now: number): void {
    this.state.npcs.forEach((npc) => {
      const floor = this.map.floors.get(npc.floor);
      if (!floor) return;
      const d = doorNear(floor, npc.x, npc.y, (id) => this.state.doors.get(id) === false, NPC_DOOR_BARGE_TILES);
      if (!d) return;
      this.set(d, true);
      this.lastToggle.set(d.id, now);
    });
  }

  /** Anyone solid (living, not tucked away) or an NPC standing in the doorway. */
  private blocked(doorway: Doorway): boolean {
    const bodies: { x: number; y: number }[] = [];
    this.state.players.forEach((p) => {
      if (p.alive && !p.hidden && !p.venting && p.floor === doorway.floor) bodies.push(p);
    });
    this.state.npcs.forEach((n) => {
      if (n.floor === doorway.floor) bodies.push(n);
    });
    return doorwayBlocked(doorway, bodies, PLAYER_RADIUS_PX);
  }

  private set(doorway: Doorway, open: boolean): void {
    setDoorClosed(this.map.floors.get(doorway.floor)!, doorway, !open);
    if (this.state.doors.has(doorway.id)) this.state.doors.set(doorway.id, open);
  }
}
