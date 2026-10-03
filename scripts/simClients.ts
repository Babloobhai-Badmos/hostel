// Headless load test: `npm run sim -- [count] [seconds] [url]`
// Connects simulated players that wander randomly, sending inputs at the
// real client rate, and reports average server patch intervals so you can
// spot growing lag. Example: npm run sim -- 20 300
//
// The first simulated client is the host if the room is empty, and it starts
// the round once all bots are in (needs at least MIN_PLAYERS_TO_START).

import { Client } from "colyseus.js";
import { INPUT_SEND_MS, ROOM_NAME, SERVER_PORT } from "../shared/constants";
import { ClientMsg, ServerMsg } from "../shared/types";
import type { InputMessage } from "../shared/types";

const count = Number(process.argv[2] ?? 10);
const seconds = Number(process.argv[3] ?? 60);
const url = process.argv[4] ?? `ws://localhost:${SERVER_PORT}`;
/** Bots pick a new direction this often on average. */
const TURN_CHANCE_PER_INPUT = 0.05;
const REPORT_EVERY_MS = Number(process.env.REPORT_MS) || 10_000;

interface Stats {
  patches: number;
  maxGapMs: number;
  lastPatch: number;
}

async function runBot(i: number, stats: Stats): Promise<{ stop: () => Promise<void>; start: () => void }> {
  const client = new Client(url);
  const room = await client.joinOrCreate(ROOM_NAME, { name: `Bot ${i + 1}` });
  // Bots ignore game events, but register them so the client doesn't warn.
  for (const type of Object.values(ServerMsg)) room.onMessage(type, () => {});
  let seq = 0;
  let angle = Math.random() * Math.PI * 2;
  room.onStateChange(() => {
    const now = Date.now();
    if (i === 0) {
      if (stats.lastPatch) stats.maxGapMs = Math.max(stats.maxGapMs, now - stats.lastPatch);
      stats.lastPatch = now;
      stats.patches++;
    }
  });
  const timer = setInterval(() => {
    if (Math.random() < TURN_CHANCE_PER_INPUT) angle = Math.random() * Math.PI * 2;
    const input: InputMessage = { dx: Math.cos(angle), dy: Math.sin(angle), seq: ++seq };
    room.send(ClientMsg.Input, input);
  }, INPUT_SEND_MS);
  return {
    start: () => room.send(ClientMsg.Start),
    stop: async () => {
      clearInterval(timer);
      await room.leave();
    },
  };
}

async function main(): Promise<void> {
  console.log(`Connecting ${count} bots to ${url} for ${seconds}s…`);
  const stats: Stats = { patches: 0, maxGapMs: 0, lastPatch: 0 };
  const bots: Awaited<ReturnType<typeof runBot>>[] = [];
  for (let i = 0; i < count; i++) bots.push(await runBot(i, stats));
  console.log(`${count} bots connected.`);
  // The first bot is the host: start the round once everyone is in.
  bots[0].start();

  const started = Date.now();
  const report = setInterval(() => {
    const elapsed = Math.round((Date.now() - started) / 1000);
    const rss = Math.round(process.memoryUsage().rss / 1e6);
    console.log(
      `t=${elapsed}s  patches/s=${(stats.patches / (REPORT_EVERY_MS / 1000)).toFixed(1)}  ` +
        `worst gap=${stats.maxGapMs}ms  sim rss=${rss}MB`,
    );
    stats.patches = 0;
    stats.maxGapMs = 0;
  }, REPORT_EVERY_MS);

  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(report);
  await Promise.all(bots.map((b) => b.stop()));
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
