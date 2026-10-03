// `npm run selftest` (with the server running): plays scripted rounds against
// the real server and checks the anti-cheat and combat rules end to end.
// Each check prints PASS or FAIL; the exit code is non-zero if any failed.
//
// Clients walk around using the shared map (breadth-first search over tiles),
// exactly like a player holding the joystick would.

import { Client, Room } from "colyseus.js";
import {
  BASE_SPEED_PX_PER_SEC,
  INPUT_SEND_MS,
  ROLE_REVEAL_SECONDS,
  ROOM_NAME,
  SERVER_PORT,
  SPAWN_PROTECTION_SECONDS,
  TASK_MIN_SECONDS,
  TICK_DT,
  TILE_SIZE,
} from "../shared/constants";
import { character } from "../shared/characters";
import { hostelMap } from "../shared/world";
import { ClientMsg, ServerMsg } from "../shared/types";
import type { RoleMessage, TaskListMessage, TaskOpenMessage, Vec2 } from "../shared/types";

const url = process.argv[2] ?? `ws://localhost:${SERVER_PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

interface PlayerView {
  x: number;
  y: number;
  floor: number;
  alive: boolean;
  hidden: boolean;
  venting: boolean;
}

class TestClient {
  room!: Room;
  role: RoleMessage | null = null;
  tasks: TaskListMessage = { tasks: [], fake: false };
  lastOpen: TaskOpenMessage | null = null;
  closes = 0;
  private seq = 0;

  /** Without `roomId`, creates a brand-new room so the test never lands in a real game. */
  async join(name: string, options: Record<string, unknown> = {}, roomId?: string): Promise<this> {
    const client = new Client(url);
    this.room = roomId ? await client.joinById(roomId, { name, ...options }) : await client.create(ROOM_NAME, { name, ...options });
    this.room.onMessage(ServerMsg.Role, (m: RoleMessage) => (this.role = m));
    this.room.onMessage(ServerMsg.TaskList, (m: TaskListMessage) => (this.tasks = m));
    this.room.onMessage(ServerMsg.TaskOpen, (m: TaskOpenMessage) => (this.lastOpen = m));
    this.room.onMessage(ServerMsg.TaskClose, () => this.closes++);
    for (const t of [ServerMsg.Cooldowns, ServerMsg.Kill, ServerMsg.VentPop, ServerMsg.Search, ServerMsg.Results, ServerMsg.Error]) {
      this.room.onMessage(t, () => {});
    }
    await sleep(200);
    return this;
  }

  get me(): PlayerView {
    return this.room.state.players.get(this.room.sessionId) as PlayerView;
  }

  send(type: string, msg?: unknown): void {
    this.room.send(type, msg);
  }

  input(dx: number, dy: number): void {
    this.room.send(ClientMsg.Input, { dx, dy, seq: ++this.seq });
  }

  /** Walk to a pixel position on the current floor along a tile path. */
  async walkTo(target: Vec2, timeoutMs = 30_000): Promise<boolean> {
    const floor = hostelMap.floors.get(this.me.floor)!;
    const path = tilePath(floor.grid, this.me, target);
    if (!path) return false;
    const waypoints = [...path.map((t) => ({ x: (t.x + 0.5) * TILE_SIZE, y: (t.y + 0.5) * TILE_SIZE })), target];
    const deadline = Date.now() + timeoutMs;
    for (const wp of waypoints) {
      while (Date.now() < deadline) {
        const dx = wp.x - this.me.x;
        const dy = wp.y - this.me.y;
        const d = Math.hypot(dx, dy);
        if (d < 4) break;
        // Don't overshoot: scale the last step down.
        const stepPx = BASE_SPEED_PX_PER_SEC * TICK_DT;
        const k = Math.min(1, d / stepPx);
        this.input((dx / d) * k, (dy / d) * k);
        await sleep(INPUT_SEND_MS);
      }
    }
    await sleep(150);
    return Math.hypot(target.x - this.me.x, target.y - this.me.y) < TILE_SIZE / 2;
  }

  leave(): Promise<number> {
    return this.room.leave();
  }
}

/** Breadth-first search over walkable tiles. */
function tilePath(grid: { width: number; height: number; solid: Uint8Array }, from: Vec2, to: Vec2): Vec2[] | null {
  const key = (x: number, y: number) => y * grid.width + x;
  const sx = Math.floor(from.x / TILE_SIZE);
  const sy = Math.floor(from.y / TILE_SIZE);
  const tx = Math.floor(to.x / TILE_SIZE);
  const ty = Math.floor(to.y / TILE_SIZE);
  const prev = new Map<number, number>([[key(sx, sy), -1]]);
  const queue = [key(sx, sy)];
  while (queue.length) {
    const k = queue.shift()!;
    const x = k % grid.width;
    const y = Math.floor(k / grid.width);
    if (x === tx && y === ty) {
      const out: Vec2[] = [];
      for (let c = k; c !== -1; c = prev.get(c)!) out.unshift({ x: c % grid.width, y: Math.floor(c / grid.width) });
      return out;
    }
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      const nk = key(nx, ny);
      if (grid.solid[nk] || prev.has(nk)) continue;
      prev.set(nk, k);
      queue.push(nk);
    }
  }
  return null;
}

async function main(): Promise<void> {
  console.log(`Self-test against ${url}\n`);
  // Host: debug room, forced to Arch-Semen, bots fill to 10 so one kill doesn't end the round.
  const killer = await new TestClient().join("TestKiller", { debug: true, role: "arch-semen", bots: 10 });
  const crew = await new TestClient().join("TestCrew", {}, killer.room.roomId);
  const startedAt = Date.now();
  killer.send(ClientMsg.Start);
  await sleep(500);
  check("host gets the forced debug role", killer.role?.characterId === "arch-semen", killer.role?.characterId);
  const crewChar = character(crew.role?.characterId ?? "");
  check("second player is dealt a role", !!crewChar, crew.role?.characterId);
  if (crewChar?.role !== "regular") {
    console.log(`\nSecond player was dealt ${crewChar?.name ?? "nothing"} this time; re-run for the crew checks.`);
    await killer.leave();
    await crew.leave();
    process.exit(failures ? 1 : 0);
  }

  // Inputs during the reveal are ignored.
  const before = { ...crew.me };
  for (let i = 0; i < 10; i++) {
    crew.input(1, 0);
    await sleep(INPUT_SEND_MS);
  }
  check("nobody moves during the role reveal", Math.abs(crew.me.x - before.x) < 0.5);
  await sleep(ROLE_REVEAL_SECONDS * 1000 - (Date.now() - startedAt) + 300);

  // Attack during spawn protection: crew is right next to the killer's spawn slot? Walk next to them first.
  await crew.walkTo({ x: killer.me.x + TILE_SIZE, y: killer.me.y });
  killer.send(ClientMsg.Attack);
  await sleep(300);
  check("spawn protection blocks kills", crew.me.alive);

  // ---------- Tasks ----------
  check("crew gets 6 real tasks", crew.tasks.tasks.length === 6 && !crew.tasks.fake, `${crew.tasks.tasks.length}, fake=${crew.tasks.fake}`);
  check("killer gets a fake task list", killer.tasks.fake && killer.tasks.tasks.length > 0);
  const doneCount = () => crew.tasks.tasks.filter((t) => t.done).length;
  const station = crew.tasks.tasks
    .map((t) => hostelMap.tasks.get(t.id)!)
    .filter((st) => st.floor === crew.me.floor)
    .sort((a, b) => Math.hypot(a.x - crew.me.x, a.y - crew.me.y) - Math.hypot(b.x - crew.me.x, b.y - crew.me.y))[0];
  crew.send(ClientMsg.TaskDone, { taskId: station.taskId });
  await sleep(300);
  check("TaskDone without opening the task is refused", doneCount() === 0);
  if (Math.hypot(station.x - crew.me.x, station.y - crew.me.y) > TILE_SIZE * 3) {
    crew.send(ClientMsg.Use);
    await sleep(300);
    check("USE far from the station doesn't open it", crew.lastOpen === null);
  }
  check(`crew can walk to the "${station.name}" station`, await crew.walkTo(station));
  crew.send(ClientMsg.Use);
  await sleep(300);
  check("USE at the station opens its minigame", crew.lastOpen?.taskId === station.taskId, crew.lastOpen?.type);
  crew.send(ClientMsg.TaskDone, { taskId: station.taskId });
  await sleep(300);
  check("finishing instantly is refused", doneCount() === 0);
  crew.send(ClientMsg.Use);
  await sleep(TASK_MIN_SECONDS * 1000 + 300);
  crew.send(ClientMsg.TaskDone, { taskId: "not-a-task" });
  crew.send(ClientMsg.TaskDone, { taskId: station.taskId });
  await sleep(300);
  check("finishing after playing counts", doneCount() === 1);
  check("the crew progress bar moves", (crew.room.state as { taskProgress: number }).taskProgress > 0, `${Math.round((crew.room.state as { taskProgress: number }).taskProgress * 100)}%`);
  crew.send(ClientMsg.TaskDone, { taskId: station.taskId });
  await sleep(200);
  check("a finished task can't be finished twice", doneCount() === 1);
  // Open another task, then walk away: the server closes it.
  const other = crew.tasks.tasks.find((t) => !t.done && hostelMap.tasks.get(t.id)!.floor === crew.me.floor);
  if (other) {
    const st = hostelMap.tasks.get(other.id)!;
    await crew.walkTo(st);
    crew.lastOpen = null;
    const closesBefore = crew.closes;
    crew.send(ClientMsg.Use);
    await sleep(300);
    await crew.walkTo(station);
    await sleep(300);
    check("walking away from an open task closes it", crew.lastOpen !== null && crew.closes > closesBefore);
  }

  // Crew hides in the nearest corridor locker.
  const floor = hostelMap.floors.get(crew.me.floor)!;
  const locker = floor.hides
    .filter((h) => h.type === "locker")
    .sort((a, b) => Math.hypot(a.x - crew.me.x, a.y - crew.me.y) - Math.hypot(b.x - crew.me.x, b.y - crew.me.y))[0];
  check("crew can walk to a locker", await crew.walkTo(locker));
  crew.send(ClientMsg.Use);
  await sleep(300);
  check("crew can hide", crew.me.hidden);
  const hiddenAt = { ...crew.me };
  crew.input(1, 0);
  crew.input(1, 0);
  await sleep(300);
  check("hidden players can't move", Math.abs(crew.me.x - hiddenAt.x) < 0.5);

  // Killer can't hit a hidden player with a normal attack, but can search the spot.
  check("killer can walk to the locker", await killer.walkTo({ x: locker.x + TILE_SIZE * 0.6, y: locker.y + TILE_SIZE * 0.6 }));
  const protectionLeft = SPAWN_PROTECTION_SECONDS * 1000 + ROLE_REVEAL_SECONDS * 1000 - (Date.now() - startedAt);
  if (protectionLeft > 0) await sleep(protectionLeft + 300);
  killer.send(ClientMsg.Attack);
  await sleep(300);
  check("a normal swing can't hit someone hiding", crew.me.alive && crew.me.hidden);
  killer.send(ClientMsg.Use);
  await sleep(400);
  check("searching the spot drags the hider out and kills them", !crew.me.alive && !crew.me.hidden);
  killer.send(ClientMsg.Use);
  await sleep(300);
  // (search cooldown: nothing observable without another hider; covered by cooldown message)

  // Ghost walks through walls.
  const ghostStart = { ...crew.me };
  for (let i = 0; i < 20; i++) {
    crew.input(0, -1);
    await sleep(INPUT_SEND_MS);
  }
  await sleep(200);
  check("ghosts float through walls", ghostStart.y - crew.me.y > TILE_SIZE * 2, `moved ${Math.round(ghostStart.y - crew.me.y)}px`);

  // Killer vents: walk to the vent in 303 and use it.
  const vent = hostelMap.vents.get("F2:303:vent")!;
  const exit = hostelMap.vents.get(vent.target)!;
  check("killer can walk to the 303 vent", await killer.walkTo(vent));
  killer.send(ClientMsg.Use);
  await sleep(300);
  check("venting makes the killer invisible", killer.me.venting);
  await sleep(1000);
  check("killer pops out of the paired vent", !killer.me.venting && Math.hypot(killer.me.x - exit.x, killer.me.y - exit.y) < 2, exit.area);
  killer.send(ClientMsg.Use);
  await sleep(300);
  check("vent cooldown stops an immediate second trip", Math.hypot(killer.me.x - exit.x, killer.me.y - exit.y) < 2 && !killer.me.venting);

  // Attack cooldown: a swing straight after a kill does nothing (no one near anyway, so check server cooldown via a fresh victim is not possible here).

  // Speed hack: flood inputs.
  const fx = killer.me.x;
  const fy = killer.me.y;
  for (let i = 0; i < 200; i++) killer.input(0, 1);
  await sleep(1000);
  const moved = Math.hypot(killer.me.x - fx, killer.me.y - fy);
  const legit = BASE_SPEED_PX_PER_SEC * 1.2 * 1.2;
  check("flooding inputs can't beat the speed limit", moved <= legit, `${Math.round(moved)}px in 1s, limit ${Math.round(legit)}`);

  await killer.leave();
  await crew.leave();
  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
