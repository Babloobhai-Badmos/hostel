// HostelRoom: orchestration only. Game rules live in server/systems/*.

import { Client, Room } from "colyseus";
import {
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  RECONNECT_SECONDS,
  TICK_MS,
} from "../../shared/constants";
import { buildTestRoom, testRoomSpawns } from "../../shared/testRoom";
import { ClientMsg, GamePhase, ServerMsg } from "../../shared/types";
import type { ErrorMessage, JoinOptions, Vec2 } from "../../shared/types";
import { GameState, Player } from "../schema/GameState";
import {
  ensureHost,
  pickColor,
  pickSpawn,
  placeAllOnSpawns,
  sanitizeName,
  uniqueName,
} from "../systems/lobby";
import { MovementSystem } from "../systems/movement";

export class HostelRoom extends Room<GameState> {
  override maxClients = MAX_PLAYERS;

  private movement!: MovementSystem;
  private spawns: Vec2[] = [];

  override onCreate(): void {
    this.setState(new GameState());
    const grid = buildTestRoom();
    this.spawns = testRoomSpawns();
    this.movement = new MovementSystem(grid);

    this.setPatchRate(TICK_MS);
    this.setSimulationInterval(() => this.tick(), TICK_MS);

    this.onMessage(ClientMsg.Input, (client, msg: unknown) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.connected) return;
      this.movement.enqueue(client.sessionId, msg);
    });

    this.onMessage(ClientMsg.Start, (client) => this.handleStart(client));

    // Reserved for later phases. Registered so the server doesn't log warnings.
    for (const msg of [ClientMsg.Attack, ClientMsg.Use, ClientMsg.Ability, ClientMsg.TaskDone]) {
      this.onMessage(msg, () => {});
    }
  }

  override onJoin(client: Client, options: Partial<JoinOptions> = {}): void {
    const player = new Player();
    player.id = client.sessionId;
    player.name = uniqueName(this.state, sanitizeName(options.name));
    player.color = pickColor(this.state);
    const spawn = pickSpawn(this.state, this.spawns);
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

    this.state.players.delete(client.sessionId);
    this.movement.removePlayer(client.sessionId);
    ensureHost(this.state);
    console.log(`[room] ${player.name} left (${this.state.players.size}/${MAX_PLAYERS})`);
  }

  override onDispose(): void {
    console.log("[room] disposed");
  }

  private tick(): void {
    this.state.players.forEach((player) => {
      if (player.connected) this.movement.tick(player);
    });
  }

  private handleStart(client: Client): void {
    if (client.sessionId !== this.state.hostId) {
      return this.sendError(client, "Only the host can start the game.");
    }
    if (this.state.phase !== GamePhase.Lobby) return;
    if (this.connectedCount() < MIN_PLAYERS_TO_START) {
      return this.sendError(client, `Need at least ${MIN_PLAYERS_TO_START} players to start.`);
    }
    placeAllOnSpawns(this.state, this.spawns);
    this.state.players.forEach((p) => this.movement.clearQueue(p.id));
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
