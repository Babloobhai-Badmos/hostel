// `npm run dev` — rebuilds the client on change and restarts the server on
// change. Refresh the browser after editing client code.
import { spawn } from "node:child_process";

const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";

const procs = [
  spawn(npx, ["vite", "build", "--watch", "--mode", "development"], { stdio: "inherit", shell: isWin }),
  spawn(npx, ["tsx", "watch", "server/index.ts"], { stdio: "inherit", shell: isWin }),
];

const stopAll = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
for (const p of procs) p.on("exit", (code) => code && stopAll());
