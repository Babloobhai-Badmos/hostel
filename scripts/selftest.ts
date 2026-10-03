// `npm run selftest` (with the server running): plays scripted rounds against
// the real server and checks the anti-cheat and combat rules end to end.
// Each check prints PASS or FAIL; the exit code is non-zero if any failed.
//
// Clients walk around using the shared map (breadth-first search over tiles),
// exactly like a player holding the joystick would.

import {
  BASE_SPEED_PX_PER_SEC,
  CHAT_COOLDOWN_SECONDS,
  CHAT_MAX_LENGTH,
  CHAOS_DEBUG_SECONDS,
  DOOR_ROOM_FRACTION,
  INPUT_SEND_MS,
  WARDEN_SECONDS,
  ROLE_REVEAL_SECONDS,
  SPAWN_PROTECTION_SECONDS,
  TASK_MIN_SECONDS,
  TILE_SIZE,
} from "../shared/constants";
import { character } from "../shared/characters";
import { hostelMap } from "../shared/world";
import { areaAt } from "../shared/buildMap";
import { doorwaySides } from "../shared/doors";
import { ClientMsg, ServerMsg } from "../shared/types";
import { DEFAULT_URL, TestClient, sleep } from "./testClient";

// Usage: npm run selftest -- [url|-] [scenario]   (scenario: core | dash | wide | gas | gujju | chaos | chat | doors)
const url = process.argv[2] && process.argv[2] !== "-" ? process.argv[2] : DEFAULT_URL;
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

/**
 * A fresh room: the host forced to `hostRole`, a second client that must be
 * dealt a Hosteller (retries with a new room otherwise), bots up to 10 (so
 * the Gujju Rapper is in and one kill doesn't end the round).
 */
async function setupRoom(hostRole: string, tries = 6, extra: Record<string, unknown> = {}): Promise<{ host: TestClient; crew: TestClient; startedAt: number } | null> {
  for (let i = 0; i < tries; i++) {
    const host = await new TestClient(url).join("TestHost", { debug: true, role: hostRole, bots: 10, ...extra });
    const crew = await new TestClient(url).join("TestCrew", {}, host.room.roomId);
    const startedAt = Date.now();
    host.send(ClientMsg.Start);
    await sleep(500);
    if (host.role?.characterId === hostRole && character(crew.role?.characterId ?? "")?.role === "regular") {
      return { host, crew, startedAt };
    }
    await host.leave();
    await crew.leave();
  }
  console.log(`  (couldn't get a Hosteller second player after ${tries} rooms)`);
  return null;
}

const sinceStart = (startedAt: number) => Date.now() - startedAt;
/** Wait until the reveal is over (and optionally spawn protection too). */
async function waitPlaying(startedAt: number, protection = false): Promise<void> {
  const ms = ROLE_REVEAL_SECONDS * 1000 + (protection ? SPAWN_PROTECTION_SECONDS * 1000 : 0) + 300;
  if (sinceStart(startedAt) < ms) await sleep(ms - sinceStart(startedAt));
}

async function coreScenario(): Promise<void> {
  console.log("--- Core: tasks, hiding, combat, vents ---");
  const setup = await setupRoom("arch-semen");
  if (!setup) return check("core scenario set up", false);
  const { host: killer, crew, startedAt } = setup;
  check("host gets the forced debug role", killer.role?.characterId === "arch-semen", killer.role?.characterId);

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
}

async function dashScenario(): Promise<void> {
  console.log("--- Arch-Semen: dash ---");
  const setup = await setupRoom("arch-semen");
  if (!setup) return check("dash scenario set up", false);
  const { host, crew, startedAt } = setup;
  await waitPlaying(startedAt);
  await host.walkTo(hostelMap.tasks.get("measure")!); // the long North Corridor
  const t0 = host.me.x;
  for (let i = 0; i < 8; i++) {
    host.input(1, 0);
    await sleep(INPUT_SEND_MS);
  }
  await sleep(150);
  const normal = host.me.x - t0;
  host.send(ClientMsg.Ability);
  await sleep(60);
  check("dash starts", host.me.dashing === true);
  const t1 = host.me.x;
  for (let i = 0; i < 8; i++) {
    host.input(-1, 0);
    await sleep(INPUT_SEND_MS);
  }
  await sleep(150);
  const dashed = t1 - host.me.x;
  check("dashing covers more ground", dashed > normal * 1.4, `${Math.round(dashed)}px vs ${Math.round(normal)}px`);
  await sleep(300);
  check("dash ends by itself", host.me.dashing === false);
  host.send(ClientMsg.Ability);
  await sleep(100);
  check("dash has a cooldown", host.me.dashing === false);
  await host.leave();
  await crew.leave();
}

async function wideScenario(): Promise<void> {
  console.log("--- Kallu Koli: wide swing ---");
  const setup = await setupRoom("kallu-koli");
  if (!setup) return check("wide scenario set up", false);
  const { host, crew, startedAt } = setup;
  let wideArmed = false;
  host.room.onMessage(ServerMsg.Cooldowns, (m: { wideArmed: boolean }) => (wideArmed = m.wideArmed));
  await waitPlaying(startedAt, true);
  await crew.walkTo({ x: host.me.x + TILE_SIZE, y: host.me.y });
  host.input(1, 0); // face the crew player
  await sleep(150);
  host.send(ClientMsg.Ability);
  await sleep(200);
  check("ability arms the wide swing", wideArmed);
  host.send(ClientMsg.Attack);
  await sleep(300);
  check("the wide swing kills", !crew.me.alive);
  check("the wide swing is used up", !wideArmed);
  await host.leave();
  await crew.leave();
}

async function gasScenario(): Promise<void> {
  console.log("--- Mota-dalla: poison gas ---");
  const setup = await setupRoom("mota-dalla");
  if (!setup) return check("gas scenario set up", false);
  const { host, crew, startedAt } = setup;
  await waitPlaying(startedAt, true);
  // Mota walks into the corridor, away from the crowd of bots at spawn; the
  // crew player waits a few tiles away (the cloud only lasts 4 s).
  const spot = hostelMap.tasks.get("measure")!;
  await host.walkTo(spot);
  await crew.walkTo({ x: spot.x + TILE_SIZE * 4, y: spot.y });
  host.send(ClientMsg.Ability);
  await sleep(200);
  const gas = [...(host.room.state as { gas: Map<string, { x: number; y: number }> }).gas.values()][0];
  check("gas cloud appears", !!gas);
  check("killers are immune to their own gas", host.me.alive);
  check("crew can walk into the gas", await crew.walkTo({ x: host.me.x + TILE_SIZE * 0.5, y: host.me.y }));
  await sleep(200);
  check("the gas kills crew who walk in", !crew.me.alive);
  await sleep(4200);
  check("the gas fades", (host.room.state as { gas: Map<string, unknown> }).gas.size === 0);
  await host.leave();
  await crew.leave();
}

async function gujjuScenario(): Promise<void> {
  console.log("--- Gujju Rapper, Supreme Leader revive + shield ---");
  const setup = await setupRoom("supreme-leader");
  if (!setup) return check("gujju scenario set up", false);
  const { host, crew, startedAt } = setup;
  const npcs = () => [...(host.room.state as { npcs: Map<string, { x: number; y: number; mood: string }> }).npcs.values()];
  check("the Gujju Rapper is in the hostel (10 players)", npcs().length === 1);
  await waitPlaying(startedAt, true);
  const knock = hostelMap.tasks.get("knock")!;
  const hadKnock = crew.tasks.tasks.some((t) => t.id === "knock");
  if (!hadKnock) {
    console.log("  (crew wasn't dealt the knock task this time; skipping the Gujju checks)");
    await host.leave();
    await crew.leave();
    return;
  }
  check("crew can walk to the 303 door task", await crew.walkTo(knock));
  crew.send(ClientMsg.Use);
  await sleep(400);
  check("knocking wakes him up", npcs()[0]?.mood === "awake", npcs()[0]?.mood);
  let stunnedSeen = false;
  for (let i = 0; i < 60 && crew.me.alive; i++) {
    if (crew.me.stunned) stunnedSeen = true;
    await sleep(100);
  }
  check("the beat stuns the knocker", stunnedSeen);
  check("then he finishes them off", !crew.me.alive);
  const body = [...(host.room.state as { bodies: Map<string, { id: string; x: number; y: number }> }).bodies.values()][0];
  check("a body is left in 303", !!body);
  // Supreme Leader walks over (after the stun is over) and holds USE on the body.
  await sleep(1500);
  check("Supreme Leader can reach the body", await host.walkTo({ x: body.x + TILE_SIZE * 0.6, y: body.y }));
  host.send(ClientMsg.ReviveStart);
  await sleep(1500);
  host.send(ClientMsg.ReviveCancel);
  await sleep(300);
  check("letting go early doesn't revive", !crew.me.alive);
  host.send(ClientMsg.ReviveStart);
  await sleep(3400);
  check("holding for 3 s revives them", crew.me.alive);
  check("the body is gone", (host.room.state as { bodies: Map<string, unknown> }).bodies.size === 0);
  // Shield: the closest player (the revived crew) gets it.
  await crew.walkTo({ x: host.me.x + TILE_SIZE, y: host.me.y });
  host.send(ClientMsg.Ability);
  await sleep(300);
  check("shield protects the nearest player", crew.me.safe === true);
  await host.leave();
  await crew.leave();
}

async function chaosScenario(): Promise<void> {
  console.log("--- Chaos: warden patrol ---");
  const setup = await setupRoom("regular", 6, { chaos: "warden" });
  if (!setup) return check("chaos scenario set up", false);
  const { host, crew, startedAt } = setup;
  type St = { chaos: string; npcs: Map<string, { kind: string; x: number; y: number; floor: number; facing: number }> };
  const state = () => host.room.state as St;
  const warden = () => [...state().npcs.values()].find((n) => n.kind === "warden");
  const deadline = startedAt + (ROLE_REVEAL_SECONDS + CHAOS_DEBUG_SECONDS + 3) * 1000;
  while (Date.now() < deadline && state().chaos !== "warden") await sleep(200);
  check("a chaos event starts on schedule", state().chaos === "warden", state().chaos || "none");
  const w = warden();
  check("the warden appears", !!w);
  if (w) {
    const start = { x: w.x, y: w.y };
    await sleep(1500);
    check("the warden patrols", Math.hypot(w.x - start.x, w.y - start.y) > TILE_SIZE, `${Math.round(Math.hypot(w.x - start.x, w.y - start.y))}px`);
    // Step into his flashlight: aim for a spot just ahead of him, again and again.
    let stunned = false;
    const until = Date.now() + 14_000;
    while (!stunned && Date.now() < until && crew.me.floor === w.floor) {
      const ahead = { x: w.x + Math.cos(w.facing) * TILE_SIZE * 2, y: w.y + Math.sin(w.facing) * TILE_SIZE * 2 };
      const walking = crew.walkTo(ahead, 1200);
      for (let i = 0; i < 12 && !stunned; i++) {
        if (crew.me.stunned) stunned = true;
        await sleep(100);
      }
      await walking;
      if (crew.me.stunned) stunned = true;
    }
    check("his flashlight stuns people it catches", stunned);
  }
  const endBy = startedAt + (ROLE_REVEAL_SECONDS + CHAOS_DEBUG_SECONDS + WARDEN_SECONDS + 3) * 1000;
  while (Date.now() < endBy && state().chaos !== "") await sleep(250);
  check("the event ends after its time", state().chaos === "");
  check("the warden leaves", !warden());
  await host.leave();
  await crew.leave();
}

async function chatScenario(): Promise<void> {
  console.log("--- Common Lounge chat ---");
  const setup = await setupRoom("regular");
  if (!setup) return check("chat scenario set up", false);
  const { host, crew, startedAt } = setup;
  await waitPlaying(startedAt);
  host.send(ClientMsg.Chat, { text: "hello from the washroom" });
  await sleep(300);
  check("you can't chat outside the lounge", host.chats.length === 0 && crew.chats.length === 0);
  const lounge = hostelMap.tasks.get("charge")!; // the phone-charging station is in the lounge
  check("host walks into the lounge", await host.walkTo(lounge));
  host.send(ClientMsg.Chat, { text: "anyone here?" });
  await sleep(300);
  check("nobody outside the lounge hears it", crew.chats.length === 0);
  check("crew walks into the lounge", await crew.walkTo({ x: lounge.x + TILE_SIZE * 2, y: lounge.y }));
  await sleep(CHAT_COOLDOWN_SECONDS * 1000);
  host.send(ClientMsg.Chat, { text: "  kaun hai   killer? \u0007 " + "x".repeat(200) });
  await sleep(300);
  check("players in the lounge hear each other", crew.chats.length === 1 && host.chats.at(-1)?.text === crew.chats[0]?.text);
  const got = crew.chats[0]?.text ?? "";
  check("messages are cleaned and capped", got.startsWith("kaun hai killer?") && got.length <= CHAT_MAX_LENGTH && !got.includes("\u0007"));
  host.send(ClientMsg.Chat, { text: "spam" });
  await sleep(300);
  check("chat is rate-limited", crew.chats.length === 1);
  await host.leave();
  await crew.leave();
}

async function doorsScenario(): Promise<void> {
  console.log("--- Doors ---");
  // 6 players: 2 killers, so the round doesn't end on the spot (killers >= everyone else).
  const setup = await setupRoom("supreme-leader", 8, { bots: 6 });
  if (!setup) return check("doors scenario set up", false);
  const { host, crew, startedAt } = setup;
  const doors = () => (crew.room.state as unknown as { doors: Map<string, boolean> }).doors;
  const allRooms = new Set([...hostelMap.doorways.values()].map((d) => d.room)).size;
  const doorRooms = new Set([...doors().keys()].map((id) => hostelMap.doorways.get(id)!.room)).size;
  check("75% of the rooms get doors", doorRooms === Math.round(allRooms * DOOR_ROOM_FRACTION), `${doorRooms}/${allRooms}`);
  check("doors start open", doors().size > 0 && [...doors().values()].every((open) => open));
  await waitPlaying(startedAt);

  const floor = hostelMap.floors.get(crew.me.floor)!;
  const dist = (d: { x: number; y: number }) => Math.hypot(d.x - crew.me.x, d.y - crew.me.y);
  const candidates = floor.doorways.filter((d) => doors().has(d.id)).sort((a, b) => dist(a) - dist(b));
  let door = null;
  for (const d of candidates.slice(0, 5)) {
    if (await crew.walkTo(doorwaySides(floor, d).outside, 20_000)) {
      door = d;
      break;
    }
  }
  check("walks up to a door", !!door);
  if (door) {
    const { inside, outside } = doorwaySides(floor, door);
    crew.send(ClientMsg.Use);
    await sleep(300);
    check("USE closes the door", doors().get(door.id) === false);
    // Push straight at it for a second.
    const len = Math.hypot(inside.x - crew.me.x, inside.y - crew.me.y);
    for (let i = 0; i < 20; i++) {
      crew.input((inside.x - crew.me.x) / len, (inside.y - crew.me.y) / len);
      await sleep(INPUT_SEND_MS);
    }
    await sleep(200);
    check("a closed door blocks the way", areaAt(floor, crew.me.x, crew.me.y)?.key !== door.room);
    crew.send(ClientMsg.Use);
    await sleep(500);
    check("USE opens it again", doors().get(door.id) === true);
    await crew.walkTo({ x: door.x, y: door.y }, 5000);
    await host.walkTo(outside, 30_000);
    host.send(ClientMsg.Use);
    await sleep(500);
    check("a door won't shut on someone standing in the doorway", doors().get(door.id) === true);
    await crew.walkTo(inside, 5000);
    host.send(ClientMsg.Use);
    await sleep(300);
    check("...and shuts once they're through", doors().get(door.id) === false);
  }
  await host.leave();
  await crew.leave();
}

async function main(): Promise<void> {
  console.log(`Self-test against ${url}\n`);
  const only = process.argv[3];
  const scenarios: [string, () => Promise<void>][] = [
    ["core", coreScenario],
    ["dash", dashScenario],
    ["wide", wideScenario],
    ["gas", gasScenario],
    ["gujju", gujjuScenario],
    ["chaos", chaosScenario],
    ["chat", chatScenario],
    ["doors", doorsScenario],
  ];
  for (const [name, run] of scenarios) if (!only || only === name) await run();
  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
