// HostelRoom: orchestration only. Game rules live in server/systems/*.

import { Client, Room } from "colyseus";
import {
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  RECONNECT_SECONDS,
  TICK_MS,
} from "../../shared/constants";
import { useTarget } from "../../shared/interact";
import { ClientMsg, GamePhase, ServerMsg } from "../../shared/types";
import type { ErrorMessage, JoinOptions } from "../../shared/types";
import { hostelMap } from "../../shared/world";
import { GameState, Player } from "../schema/GameState";
import { HidingSystem } from "../systems/hiding";
import {
  ensureHost,
  pickColor,
  pickSpawn,
  sanitizeName,
  spawnAssignments,
  uniqueName,
} from "../systems/lobby";
import { MovementSystem } from "../systems/movement";
import { StairSystem } from "../systems/stairs";
import { teleport } from "../systems/teleport";

export class HostelRoom extends Room<GameState> {
  override maxClients = MAX_PLAYERS;

  private map = hostelMap;
  private movement!: MovementSystem;
  private stairs!: StairSystem;
  private hiding!: HidingSystem;

  override onCreate(): void {
    this.setState(new GameState());
    const grids = new Map([...this.map.floors].map(([id, f]) => [id, f.grid]));
    this.movement = new MovementSystem(grids);
    this.stairs = new StairSystem(this.map, this.movement);
    this.hiding = new HidingSystem();

    this.setPatchRate(TICK_MS);
    this.setSimulationInterval(() => this.tick(), TICK_MS);

    this.onMessage(ClientMsg.Input, (client, msg: unknown) => {
      const player = this.activePlayer(client);
      if (player) this.movement.enqueue(client.sessionId, msg);
    });
    this.onMessage(ClientMsg.Use, (client) => this.handleUse(client));
    this.onMessage(ClientMsg.Start, (client) => this.handleStart(client));

    // Reserved for later phases. Registered so the server doesn't log warnings.
    for (const msg of [ClientMsg.Attack, ClientMsg.Ability, ClientMsg.TaskDone]) {
      this.onMessage(msg, () => {});
    }
  }

  override onJoin(client: Client, options: Partial<JoinOptions> = {}): void {
    const player = new Player();
    player.id = client.sessionId;
    player.name = uniqueName(this.state, sanitizeName(options.name));
    player.color = pickColor(this.state);
    const spawn = pickSpawn(this.state, this.map.spawns);
    player.floor = this.map.spawnFloor;
    player.x = spawn.x;
    player.y = spawn.y;
    this.state.players.set(client.sessionId, player);
    this.movement.addPlayer(client.sessionId);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    console.log(`[room] ${player.name} joined (${this.state.players.size}/${MAX_PLAYERS})`);
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    this.movement.clearQueue(client.sessionId);
    ensureHost(this.state);

    if (!consented) {
      try {
        console.log(`[room] ${player.name} dropped, holding slot for ${RECONNECT_SECONDS}s`);
        await this.allowReconnection(client, RECONNECT_SECONDS);
        player.connected = true;
        // A reloaded page restarts its input sequence at 1.
        player.ack = 0;
        this.movement.addPlayer(client.sessionId);
        ensureHost(this.state);
        console.log(`[room] ${player.name} reconnected`);
        return;
      } catch {
        // Reconnection window expired; fall through to removal.
      }
    }

    this.hiding.exit(player);
    this.state.players.delete(client.sessionId);
    this.movement.removePlayer(client.sessionId);
    this.stairs.removePlayer(client.sessionId);
    ensureHost(this.state);
    console.log(`[room] ${player.name} left (${this.state.players.size}/${MAX_PLAYERS})`);
  }

  override onDispose(): void {
    console.log("[room] disposed");
  }

  private tick(): void {
    this.state.players.forEach((player) => {
      if (player.connected) this.movement.tick(player, !player.hidden);
    });
  }

  /** The player for a client, if they're connected and allowed to act. */
  private activePlayer(client: Client): Player | null {
    const player = this.state.players.get(client.sessionId);
    return player && player.connected ? player : null;
  }

  /** USE is context-sensitive; the server works out the target itself from the player's position. */
  private handleUse(client: Client): void {
    const player = this.activePlayer(client);
    if (!player) return;
    const target = useTarget(this.map, player);
    if (!target) return;
    switch (target.kind) {
      case "unhide":
        this.hiding.exit(player);
        break;
      case "stairs":
        this.stairs.use(player, target.stair);
        break;
      case "hide":
        if (this.hiding.enter(player, target.spot) === "occupied") {
          this.sendError(client, "Someone's already hiding in there!");
        } else {
          this.movement.clearQueue(player.id);
        }
        break;
    }
  }

  private handleStart(client: Client): void {
    if (client.sessionId !== this.state.hostId) {
      return this.sendError(client, "Only the host can start the game.");
    }
    if (this.state.phase !== GamePhase.Lobby) return;
    if (this.connectedCount() < MIN_PLAYERS_TO_START) {
      return this.sendError(client, `Need at least ${MIN_PLAYERS_TO_START} players to start.`);
    }
    this.hiding.reset(this.state.players.values());
    for (const [p, s] of spawnAssignments(this.state, this.map.spawns)) {
      teleport(p, this.map.spawnFloor, s.x, s.y, this.movement);
    }
    this.state.phase = GamePhase.Playing;
    console.log(`[room] game started with ${this.connectedCount()} players`);
  }

  private connectedCount(): number {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.connected) n++;
    });
    return n;
  }

  private sendError(client: Client, message: string): void {
    const payload: ErrorMessage = { message };
    client.send(ServerMsg.Error, payload);
  }
}
