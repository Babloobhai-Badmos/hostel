// Tasks: dealing task lists, opening minigames, accepting completions, and
// the shared crew progress bar.
//
//   - Regular players get TASKS_PER_PLAYER random tasks; these count.
//   - Killers get a fake list of the same size so they can pretend; finishing
//     a fake task does nothing.
//   - The Supreme Leader and spectators get no tasks.
//   - Ghosts can still finish their tasks, but only living players' tasks
//     count towards the progress bar (and the crew task win).
//
// Validation: a task can only be finished if the server opened it for this
// player (USE in range of that station), at least TASK_MIN_SECONDS ago, and
// the player is still in range when they send TaskDone.

import {
  DEBUG_BOT_TASK_SECONDS,
  TASK_MIN_SECONDS,
  TASK_RANGE_TILES,
  TASKS_PER_PLAYER,
  TILE_SIZE,
} from "../../shared/constants";
import type { HostelMap, TaskStation } from "../../shared/buildMap";
import type { TaskDef } from "../../shared/buildMap";
import type { TaskEntry, TaskListMessage, TaskOpenMessage } from "../../shared/types";
import type { GameState, Player } from "../schema/GameState";
import type { RoleSystem } from "./roles";

const MS = 1000;

interface TaskSlot {
  id: string;
  done: boolean;
}

interface PlayerTasks {
  slots: TaskSlot[];
  fake: boolean;
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class TaskSystem {
  private lists = new Map<string, PlayerTasks>();
  /** Open minigame per player: which task and when it was opened. */
  private open = new Map<string, { taskId: string; openedAt: number }>();
  /** Debug bots: when each one next "finishes" a task. */
  private botNextAt = new Map<string, number>();

  constructor(
    private state: GameState,
    private map: HostelMap,
    private tasks: TaskDef[],
    private roles: RoleSystem,
  ) {}

  /** Deal task lists for a new round. */
  assign(ids: string[]): void {
    this.clear();
    const allIds = this.tasks.map((t) => t.id);
    for (const id of ids) {
      const c = this.roles.get(id);
      if (!c || c.role === "savior") continue;
      const picks = shuffle(allIds).slice(0, Math.min(TASKS_PER_PLAYER, allIds.length));
      this.lists.set(id, { slots: picks.map((t) => ({ id: t, done: false })), fake: c.role === "killer" });
    }
    this.updateProgress();
  }

  clear(): void {
    this.lists.clear();
    this.open.clear();
    this.botNextAt.clear();
    this.state.taskProgress = 0;
  }

  /** Ids of a player's unfinished tasks (for useTarget). */
  openTaskIds(id: string): string[] {
    return this.lists.get(id)?.slots.filter((s) => !s.done).map((s) => s.id) ?? [];
  }

  counts(id: string): { done: number; total: number } {
    const l = this.lists.get(id);
    if (!l || l.fake) return { done: 0, total: 0 };
    return { done: l.slots.filter((s) => s.done).length, total: l.slots.length };
  }

  /** The private task list message for one player. */
  listFor(id: string): TaskListMessage {
    const l = this.lists.get(id);
    if (!l) return { tasks: [], fake: false };
    const tasks: TaskEntry[] = l.slots.map((s) => {
      const def = this.tasks.find((t) => t.id === s.id)!;
      const station = this.map.tasks.get(s.id);
      return { id: s.id, name: def.name, type: def.type, where: station ? this.whereLabel(station) : "", done: s.done };
    });
    return { tasks, fake: l.fake };
  }

  private whereLabel(station: TaskStation): string {
    const floor = this.map.floors.get(station.floor);
    const area = floor?.areas.find((a) => a.key === station.area);
    return `${area?.label || station.area} · F${station.floor}`;
  }

  private inRange(player: Player, station: TaskStation): boolean {
    const range = TASK_RANGE_TILES * TILE_SIZE;
    return player.floor === station.floor && Math.hypot(player.x - station.x, player.y - station.y) <= range;
  }

  /** USE at a station: returns the minigame to open, or null if not allowed. */
  start(player: Player, station: TaskStation, now: number): TaskOpenMessage | null {
    if (player.hidden || player.venting) return null;
    if (!this.openTaskIds(player.id).includes(station.taskId)) return null;
    if (!this.inRange(player, station)) return null;
    this.open.set(player.id, { taskId: station.taskId, openedAt: now });
    return { taskId: station.taskId, type: station.type, name: station.name };
  }

  /** TaskDone from the client. Returns true if the task was marked done. */
  complete(player: Player, taskId: unknown, now: number): boolean {
    const session = this.open.get(player.id);
    if (!session || typeof taskId !== "string" || session.taskId !== taskId) return false;
    const station = this.map.tasks.get(taskId);
    if (!station || !this.inRange(player, station) || player.hidden || player.venting) return false;
    if (now - session.openedAt < TASK_MIN_SECONDS * MS) return false;
    const slot = this.lists.get(player.id)?.slots.find((s) => s.id === taskId);
    if (!slot || slot.done) return false;
    slot.done = true;
    this.open.delete(player.id);
    this.updateProgress();
    return true;
  }

  /**
   * Debug bots don't play minigames; a living bot ticks off one task every
   * DEBUG_BOT_TASK_SECONDS so the progress bar (and the task win) still work
   * in bot-filled test rounds.
   */
  botTick(id: string, now: number): void {
    const next = this.botNextAt.get(id);
    if (next === undefined) {
      this.botNextAt.set(id, now + DEBUG_BOT_TASK_SECONDS * MS * (0.5 + Math.random()));
      return;
    }
    if (now < next) return;
    this.botNextAt.set(id, now + DEBUG_BOT_TASK_SECONDS * MS);
    const p = this.state.players.get(id);
    const slot = this.lists.get(id)?.slots.find((s) => !s.done);
    if (!p || !p.alive || !slot) return;
    slot.done = true;
    this.updateProgress();
  }

  cancel(id: string): void {
    this.open.delete(id);
  }

  /** Players whose open minigame should close (moved out of range, died...). Clears them. */
  staleSessions(isValid: (player: Player, station: TaskStation) => boolean): string[] {
    const stale: string[] = [];
    for (const [id, session] of this.open) {
      const p = this.state.players.get(id);
      const station = this.map.tasks.get(session.taskId);
      if (!p || !station || !p.connected || !this.inRange(p, station) || !isValid(p, station)) stale.push(id);
    }
    stale.forEach((id) => this.open.delete(id));
    return stale;
  }

  /** Recompute the crew progress bar: real tasks of living regular players (including ones reconnecting). */
  updateProgress(): void {
    let done = 0;
    let total = 0;
    for (const [id, l] of this.lists) {
      if (l.fake) continue;
      const p = this.state.players.get(id);
      if (!p || !p.alive) continue;
      total += l.slots.length;
      done += l.slots.filter((s) => s.done).length;
    }
    this.state.taskProgress = total > 0 ? done / total : 0;
  }

  /** True when there are living crew tasks and all of them are done. */
  allDone(): boolean {
    let total = 0;
    for (const [id, l] of this.lists) {
      const p = this.state.players.get(id);
      if (l.fake || !p || !p.alive) continue;
      total += l.slots.length;
      if (l.slots.some((s) => !s.done)) return false;
    }
    return total > 0;
  }

  removePlayer(id: string): void {
    this.lists.delete(id);
    this.open.delete(id);
    this.updateProgress();
  }
}
