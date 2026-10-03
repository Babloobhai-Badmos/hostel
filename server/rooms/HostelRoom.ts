// HostelRoom: orchestration only. Game rules live in server/systems/*.
//
// Round flow: lobby -> reveal (ROLE_REVEAL_SECONDS, nobody moves) -> playing
// -> ended (results screen) -> host presses Play Again -> lobby.

import { Client, Room } from "colyseus";
import {
  DEBUG_DEFAULT_BOT_FILL,
  GHOST_SPEED_MULTIPLIER,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  RECONNECT_SECONDS,
  ROLE_REVEAL_SECONDS,
  ROUND_END_DELAY_MS,
  TICK_MS,
} from "../../shared/constants";
import { GUJJU_RAPPER_ID, REGULAR } from "../../shared/characters";
import { useTarget } from "../../shared/interact";
import { attackReachPx } from "../../shared/combat";
import { ClientMsg, GamePhase, ServerMsg } from "../../shared/types";
import type { CooldownMessage, ErrorMessage, FxMessage, JoinOptions, ResultsMessage } from "../../shared/types";
import { TASKS, hostelMap } from "../../shared/world";
import { withOwnGrids } from "../../shared/doors";
import { GameState, Player } from "../schema/GameState";
import { AbilitySystem } from "../systems/abilities";
import { BotSystem } from "../systems/bots";
import { ChaosSystem } from "../systems/chaos";
import { ChatSystem } from "../systems/chat";
import { CombatSystem } from "../systems/combat";
import { DoorSystem } from "../systems/doors";
import { GujjuSystem } from "../systems/gujju";
import { HidingSystem } from "../systems/hiding";
import {
  ensureHost,
  pickColor,
  pickSpawn,
  sanitizeFace,
  sanitizeName,
  spawnAssignments,
  uniqueName,
} from "../systems/lobby";
import { MovementSystem } from "../systems/movement";
import type { MoveMode } from "../systems/movement";
import { RoleSystem } from "../systems/roles";
import { StairSystem } from "../systems/stairs";
import { TaskSystem } from "../systems/tasks";
import { teleport } from "../systems/teleport";
import { VentSystem } from "../systems/vents";
import { checkWin } from "../systems/win";
import type { WinResult } from "../systems/win";

export class HostelRoom extends Room<GameState> {
  override maxClients = MAX_PLAYERS;

  /** Own collision grids: this room's doors open and close without touching other rooms. */
  private map = withOwnGrids(hostelMap);
  private movement!: MovementSystem;
  private stairs!: StairSystem;
  private hiding!: HidingSystem;
  private roles!: RoleSystem;
  private combat!: CombatSystem;
  private vents!: VentSystem;
  private bots!: BotSystem;
  private tasks!: TaskSystem;
  private abilities!: AbilitySystem;
  private gujju!: GujjuSystem;
  private chaos!: ChaosSystem;
  private chat!: ChatSystem;
  private doors!: DoorSystem;
  /** Debug settings from the host's join options. */
  private debugBots = DEBUG_DEFAULT_BOT_FILL;
  private debugRole = "";
  private lastResults: ResultsMessage | null = null;
  /** Set once a win is detected; the round ends ROUND_END_DELAY_MS later. */
  private ending = false;

  override onCreate(): void {
    this.setState(new GameState());
    const grids = new Map([...this.map.floors].map(([id, f]) => [id, f.grid]));
    this.movement = new MovementSystem(grids);
    this.stairs = new StairSystem(this.map, this.movement);
    this.hiding = new HidingSystem();
    this.roles = new RoleSystem();
    this.bots = new BotSystem(this.state, this.movement);
    this.tasks = new TaskSystem(this.state, this.map, TASKS, this.roles);
    this.combat = new CombatSystem(this.state, this.map, this.roles, this.movement, this.hiding, {
      onKill: (msg) => {
        this.broadcast(ServerMsg.Kill, msg);
        // Killed mid-minigame or mid-revive: stop it (as a ghost they can start tasks again).
        this.tasks.cancel(msg.victimId);
        this.abilities.reviveCancel(msg.victimId);
        this.clients.getById(msg.victimId)?.send(ServerMsg.TaskClose);
      },
      onSearch: (msg) => this.broadcast(ServerMsg.Search, msg),
    });
    const fx = (msg: FxMessage) => this.broadcast(ServerMsg.Fx, msg);
    this.abilities = new AbilitySystem(this.state, this.roles, this.movement, this.combat, fx, this.map);
    this.gujju = new GujjuSystem(this.state, this.map, this.combat, fx);
    this.chaos = new ChaosSystem(this.state, this.map, this.combat, fx);
    this.chat = new ChatSystem(this.state, this.map);
    this.doors = new DoorSystem(this.state, this.map);
    this.vents = new VentSystem(this.map, this.roles, this.movement, (msg) => this.broadcast(ServerMsg.VentPop, msg));

    this.setPatchRate(TICK_MS);
    this.setSimulationInterval(() => this.tick(), TICK_MS);

    this.onMessage(ClientMsg.Input, (client, msg: unknown) => {
      if (this.activePlayer(client)) this.movement.enqueue(client.sessionId, msg);
    });
    this.onMessage(ClientMsg.WhoAmI, (client) => this.sendPrivateInfo(client));
    this.onMessage(ClientMsg.Use, (client) => this.handleUse(client));
    this.onMessage(ClientMsg.Attack, (client) => this.handleAttack(client));
    this.onMessage(ClientMsg.Start, (client) => this.handleStart(client));
    this.onMessage(ClientMsg.PlayAgain, (client) => this.handlePlayAgain(client));
    this.onMessage(ClientMsg.TaskDone, (client, msg: unknown) => this.handleTaskDone(client, msg));
    this.onMessage(ClientMsg.TaskCancel, (client) => this.tasks.cancel(client.sessionId));
    this.onMessage(ClientMsg.Ability, (client) => this.handleAbility(client));
    this.onMessage(ClientMsg.ReviveStart, (client) => this.handleReviveStart(client));
    this.onMessage(ClientMsg.ReviveCancel, (client) => this.abilities.reviveCancel(client.sessionId));
    this.onMessage(ClientMsg.Chat, (client, msg: unknown) => this.handleChat(client, msg));
    this.onMessage(ClientMsg.Face, (client, msg: unknown) => {
      // Faces can only change in the lobby, so nobody swaps looks mid-round.
      const player = this.activePlayer(client);
      if (!player || this.state.phase !== GamePhase.Lobby) return;
      player.face = sanitizeFace(typeof msg === "object" && msg !== null ? (msg as { face?: unknown }).face : msg);
    });
  }

  override onJoin(client: Client, options: Partial<JoinOptions> = {}): void {
    const first = this.state.players.size === 0;
    const player = new Player();
    player.id = client.sessionId;
    player.name = uniqueName(this.state, sanitizeName(options.name));
    player.color = pickColor(this.state);
    player.face = sanitizeFace(options.face);
    const spawn = pickSpawn(this.state, this.map.spawns);
    player.floor = this.map.spawnFloor;
    player.x = spawn.x;
    player.y = spawn.y;
    // Joined mid-round: watch as a ghost until the next round.
    if (this.state.phase !== GamePhase.Lobby) player.alive = false;
    this.state.players.set(client.sessionId, player);
    this.movement.addPlayer(client.sessionId);
    if (!this.state.hostId) this.state.hostId = client.sessionId;

    if (first && options.debug) {
      this.state.debug = true;
      const bots = Number(options.bots);
      if (Number.isInteger(bots) && bots > 0) this.debugBots = Math.min(MAX_PLAYERS, bots);
      this.debugRole = typeof options.role === "string" ? options.role : "";
      if (typeof options.chaos === "string") this.chaos.setDebug(options.chaos);
      console.log(`[room] debug room: bots fill to ${this.debugBots}${this.debugRole ? `, host plays ${this.debugRole}` : ""}`);
    }
    console.log(`[room] ${player.name} joined (${this.state.players.size}/${MAX_PLAYERS})`);
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    this.movement.clearQueue(client.sessionId);
    ensureHost(this.state, (id) => this.bots.isBot(id));

    if (!consented) {
      try {
        console.log(`[room] ${player.name} dropped, holding slot for ${RECONNECT_SECONDS}s`);
        await this.allowReconnection(client, RECONNECT_SECONDS);
        player.connected = true;
        // A reloaded page restarts its input sequence at 1.
        player.ack = 0;
        this.movement.addPlayer(client.sessionId);
        ensureHost(this.state, (id) => this.bots.isBot(id));
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
    this.combat.removePlayer(client.sessionId);
    this.vents.removePlayer(client.sessionId);
    this.tasks.removePlayer(client.sessionId);
    this.abilities.removePlayer(client.sessionId);
    this.chat.removePlayer(client.sessionId);
    ensureHost(this.state, (id) => this.bots.isBot(id));
    console.log(`[room] ${player.name} left (${this.state.players.size}/${MAX_PLAYERS})`);
  }

  override onDispose(): void {
    this.vents.reset();
    console.log("[room] disposed");
  }

  // ---------- Tick ----------

  private tick(): void {
    const playing = this.state.phase === GamePhase.Playing;
    const now = Date.now();
    if (playing) {
      this.bots.tick();
      for (const id of this.bots.ids()) this.tasks.botTick(id, now);
    }
    this.state.players.forEach((p) => {
      if (!p.connected) return;
      this.movement.tick(p, this.moveModeOf(p, playing), this.speedOf(p));
    });
    if (!playing) return;
    this.doors.bargeThrough(now);
    this.combat.tick(now);
    this.abilities.tick(now);
    this.gujju.tick(now);
    this.chaos.tick(now);
    this.closeStaleTasks();
    // Deaths and disconnects change who counts towards the bar.
    this.tasks.updateProgress();
    if (this.ending) return;
    const win = checkWin(this.state, this.roles, this.tasks);
    if (win) {
      this.ending = true;
      this.clock.setTimeout(() => {
        // Re-check: someone may have been revived or reconnected in the meantime.
        const still = checkWin(this.state, this.roles, this.tasks);
        if (still) this.endRound(still);
        else this.ending = false;
      }, ROUND_END_DELAY_MS);
    }
  }

  private moveModeOf(p: Player, playing: boolean): MoveMode {
    if (this.state.phase === GamePhase.Reveal || this.state.phase === GamePhase.Ended) return "frozen";
    if (!p.alive) return "ghost";
    if (!playing) return "walk"; // lobby
    if (p.hidden || p.venting || p.stunned) return "frozen";
    return "walk";
  }

  private speedOf(p: Player): number {
    if (!p.alive) return GHOST_SPEED_MULTIPLIER;
    return (this.roles.get(p.id) ?? REGULAR).speed * this.abilities.speedMultiplier(p.id, Date.now());
  }

  // ---------- Messages ----------

  /** The player for a client, if they're connected. */
  private activePlayer(client: Client): Player | null {
    const player = this.state.players.get(client.sessionId);
    return player && player.connected ? player : null;
  }

  private sendPrivateInfo(client: Client): void {
    if (this.state.phase !== GamePhase.Lobby) {
      client.send(ServerMsg.Role, this.roles.messageFor(client.sessionId, (id) => this.nameOf(id)));
      client.send(ServerMsg.TaskList, this.tasks.listFor(client.sessionId));
      this.sendCooldowns(client);
    }
    if (this.state.phase === GamePhase.Ended && this.lastResults) client.send(ServerMsg.Results, this.lastResults);
  }

  private sendCooldowns(client: Client): void {
    const id = client.sessionId;
    const now = Date.now();
    const msg: CooldownMessage = {
      attack: this.combat.attackReadyIn(id, now),
      vent: this.vents.readyIn(id, now),
      search: this.combat.searchReadyIn(id, now),
      ability: this.abilities.readyIn(id, now),
      wideArmed: this.abilities.isWideArmed(id, now),
      reviveUsed: !this.abilities.hasRevive(id),
      protection: this.combat.protectionLeft(id, now),
    };
    client.send(ServerMsg.Cooldowns, msg);
  }

  private handleAttack(client: Client): void {
    const player = this.activePlayer(client);
    if (!player || this.state.phase !== GamePhase.Playing) return;
    const now = Date.now();
    const wide = this.abilities.isWideArmed(player.id, now);
    const hits = this.combat.tryAttack(player, now, wide);
    if (hits > 0 && wide) {
      this.abilities.consumeWide(player.id);
      const c = this.roles.get(player.id);
      const radius = attackReachPx(c?.wideSwingRange ?? c?.attackRange ?? 1);
      this.broadcast(ServerMsg.Fx, { kind: "wide", floor: player.floor, x: player.x, y: player.y, angle: this.movement.facing(player.id), radius } satisfies FxMessage);
    }
    this.sendCooldowns(client);
  }

  private handleChat(client: Client, msg: unknown): void {
    const player = this.activePlayer(client);
    if (!player || this.state.phase !== GamePhase.Playing) return;
    const out = this.chat.say(player, msg, Date.now());
    if (!out) return;
    for (const id of out.to) this.clients.getById(id)?.send(ServerMsg.Chat, out.message);
  }

  private handleAbility(client: Client): void {
    const player = this.activePlayer(client);
    if (!player || this.state.phase !== GamePhase.Playing) return;
    this.abilities.use(player, Date.now());
    this.sendCooldowns(client);
  }

  private handleReviveStart(client: Client): void {
    const player = this.activePlayer(client);
    if (!player || this.state.phase !== GamePhase.Playing) return;
    const target = useTarget(this.map, this.actorFor(player));
    if (target?.kind === "revive") this.abilities.reviveStart(player, target.body.id, Date.now());
  }

  /** The useTarget() view of a player, with what their role allows right now. */
  private actorFor(player: Player) {
    const playing = this.state.phase === GamePhase.Playing;
    const c = this.roles.get(player.id);
    const revivable = playing && player.alive && this.abilities.hasRevive(player.id) ? [...this.state.bodies.values()] : [];
    return {
      floor: player.floor,
      x: player.x,
      y: player.y,
      hidden: player.hidden,
      alive: player.alive,
      isKiller: playing && c?.role === "killer",
      canVent: playing && !!c?.canVent,
      openTasks: playing ? this.tasks.openTaskIds(player.id) : [],
      revivable,
      doors: this.state.doors,
    };
  }

  /** USE is context-sensitive; the server works out the target itself from the player's position. */
  private handleUse(client: Client): void {
    const player = this.activePlayer(client);
    if (!player || player.venting || player.stunned) return;
    const target = useTarget(this.map, this.actorFor(player));
    if (!target) return;
    // In the lobby you can only wander (and take the stairs); after the round, nothing.
    if (this.state.phase === GamePhase.Lobby ? target.kind !== "stairs" : this.state.phase !== GamePhase.Playing) return;
    const now = Date.now();
    switch (target.kind) {
      case "unhide":
        this.hiding.exit(player);
        break;
      case "stairs":
        this.stairs.use(player, target.stair);
        break;
      case "vent":
        this.vents.use(player, target.vent, now);
        break;
      case "search":
        this.combat.trySearch(player, target.spot, now);
        break;
      case "task": {
        const open = this.tasks.start(player, target.station, now);
        if (open) client.send(ServerMsg.TaskOpen, open);
        // Knocking in the Gujju Rapper's room wakes him up.
        if (open && player.alive && target.station.area === this.gujju.homeKey) this.gujju.onKnock(player, now);
        break;
      }
      case "door": {
        const error = this.doors.toggle(target.doorway, now);
        if (error) this.sendError(client, error);
        break;
      }
      case "revive":
        // Reviving is hold-to-use: the client sends ReviveStart / ReviveCancel instead.
        break;
      case "hide":
        if (this.hiding.enter(player, target.spot) === "occupied") {
          this.sendError(client, "Someone's already hiding in there!");
        } else {
          this.movement.clearQueue(player.id);
        }
        break;
    }
    this.sendCooldowns(client);
  }

  private handleTaskDone(client: Client, msg: unknown): void {
    const player = this.activePlayer(client);
    if (!player || this.state.phase !== GamePhase.Playing) return;
    const taskId = typeof msg === "object" && msg !== null ? (msg as { taskId?: unknown }).taskId : undefined;
    if (this.tasks.complete(player, taskId, Date.now())) {
      client.send(ServerMsg.TaskList, this.tasks.listFor(client.sessionId));
    } else {
      client.send(ServerMsg.TaskClose);
    }
  }

  /** Close minigames for players who walked away, died mid-task, hid or vented. */
  private closeStaleTasks(): void {
    const stale = this.tasks.staleSessions((p) => !p.hidden && !p.venting);
    for (const id of stale) this.clients.getById(id)?.send(ServerMsg.TaskClose);
  }

  private handleStart(client: Client): void {
    if (client.sessionId !== this.state.hostId) {
      return this.sendError(client, "Only the host can start the game.");
    }
    if (this.state.phase !== GamePhase.Lobby) return;
    const humans = this.connectedCount();
    if (this.state.debug) {
      while (this.state.players.size < this.debugBots) {
        this.bots.add(this.map.spawns[0], this.map.spawnFloor, pickColor(this.state));
      }
    } else if (humans < MIN_PLAYERS_TO_START) {
      return this.sendError(
        client,
        `Need at least ${MIN_PLAYERS_TO_START} players to start (add ?debug=1 to the host's URL to fill with bots).`,
      );
    }

    const ids = [...this.state.players.keys()];
    const forced = this.state.debug && this.debugRole ? { id: this.state.hostId, characterId: this.debugRole } : undefined;
    this.roles.assign(ids, forced);
    this.tasks.assign(ids);
    this.abilities.reset();
    if (this.roles.npcs.some((n) => n.id === GUJJU_RAPPER_ID)) this.gujju.spawn();
    else this.gujju.despawn();
    this.hiding.reset(this.state.players.values());
    this.vents.reset();
    this.doors.setupRound();
    this.state.bodies.clear();
    this.lastResults = null;
    for (const [p, s] of spawnAssignments(this.state, this.map.spawns)) {
      p.alive = true;
      p.venting = false;
      teleport(p, this.map.spawnFloor, s.x, s.y, this.movement);
    }
    this.ending = false;
    this.state.phase = GamePhase.Reveal;
    for (const c of this.clients) this.sendPrivateInfo(c);
    console.log(
      `[room] round starting with ${ids.length} players: ` +
        ids.map((id) => `${this.nameOf(id)}=${this.roles.get(id)?.id}`).join(", ") +
        (this.roles.npcs.length ? ` + NPC ${this.roles.npcs.map((n) => n.id).join(", ")}` : ""),
    );

    this.clock.setTimeout(() => {
      if (this.state.phase !== GamePhase.Reveal) return;
      this.state.phase = GamePhase.Playing;
      this.combat.startRound(Date.now());
      this.chaos.startRound(Date.now());
      for (const c of this.clients) this.sendCooldowns(c);
    }, ROLE_REVEAL_SECONDS * 1000);
  }

  private endRound(win: WinResult): void {
    if (this.state.phase !== GamePhase.Playing) return;
    this.ending = false;
    this.state.phase = GamePhase.Ended;
    this.abilities.reset();
    this.chaos.stop();
    for (const c of this.clients) c.send(ServerMsg.TaskClose);
    this.vents.reset();
    const players = this.roles.ids().flatMap((id) => {
      const p = this.state.players.get(id);
      const c = this.roles.get(id);
      if (!p || !c) return [];
      return [{
        name: p.name,
        character: c.name,
        role: c.role,
        alive: p.alive,
        kills: this.combat.killsOf(id),
        tasksDone: this.tasks.counts(id).done,
        tasksTotal: this.tasks.counts(id).total,
        bot: this.bots.isBot(id),
      }];
    });
    this.lastResults = { winner: win.winner, reason: win.reason, players };
    this.broadcast(ServerMsg.Results, this.lastResults);
    console.log(`[room] round over: ${win.winner} win. ${win.reason}`);
  }

  private handlePlayAgain(client: Client): void {
    if (client.sessionId !== this.state.hostId || this.state.phase !== GamePhase.Ended) return;
    this.bots.removeAll();
    this.roles.clear();
    this.tasks.clear();
    this.abilities.reset();
    this.gujju.despawn();
    this.chaos.stop();
    this.doors.clear();
    this.hiding.reset(this.state.players.values());
    this.state.bodies.clear();
    this.lastResults = null;
    for (const [p, s] of spawnAssignments(this.state, this.map.spawns)) {
      p.alive = true;
      p.safe = false;
      p.stunned = false;
      p.venting = false;
      teleport(p, this.map.spawnFloor, s.x, s.y, this.movement);
    }
    this.state.phase = GamePhase.Lobby;
  }

  // ---------- Helpers ----------

  private nameOf(id: string): string {
    return this.state.players.get(id)?.name ?? "?";
  }

  private connectedCount(): number {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.connected && !this.bots.isBot(p.id)) n++;
    });
    return n;
  }

  private sendError(client: Client, message: string): void {
    const payload: ErrorMessage = { message };
    client.send(ServerMsg.Error, payload);
  }
}
