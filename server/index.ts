import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME, SERVER_HOST, SERVER_PORT, WS_MAX_PAYLOAD_BYTES } from "../shared/constants";
import { HostelRoom } from "./rooms/HostelRoom";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../dist/client");
const port = Number(process.env.PORT) || SERVER_PORT;

const app = express();
app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});
app.use(express.static(clientDist));
app.get("/", (_req, res) => {
  // Only reached when dist/client/index.html doesn't exist yet.
  const built = fs.existsSync(path.join(clientDist, "index.html"));
  res
    .status(503)
    .type("text/plain")
    .send(built ? "Reload the page." : "Client not built yet. Run `npm start` (or `npm run build`) and refresh.");
});

const httpServer = http.createServer(app);
const gameServer = new Server({
  // Face photos are a few kB, more than the 4 kB default message limit.
  transport: new WebSocketTransport({ server: httpServer, maxPayload: WS_MAX_PAYLOAD_BYTES }),
  greet: false,
});
gameServer.define(ROOM_NAME, HostelRoom);

/** Every IPv4 address other devices on the LAN might reach us on. */
function lanAddresses(): { iface: string; address: string }[] {
  const out: { iface: string; address: string }[] = [];
  for (const [iface, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) out.push({ iface, address: info.address });
    }
  }
  return out;
}

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${port} is already in use. Close the other server or run with PORT=3001.\n`);
    process.exit(1);
  }
  throw err;
});

gameServer.listen(port, SERVER_HOST).then(() => {
  const lines = [
    "",
    "  HOSTEL server is running",
    "",
    `  This computer:   http://localhost:${port}`,
  ];
  const lan = lanAddresses();
  if (lan.length === 0) {
    lines.push("  No LAN address found. Connect to WiFi / a hotspot, or use `npm run tunnel`.");
  } else {
    lines.push("  Share one of these with friends on the same WiFi / hotspot:");
    for (const { iface, address } of lan) {
      lines.push(`    http://${address}:${port}    (${iface})`);
    }
  }
  lines.push("", "  WiFi blocks devices from seeing each other? Run `npm run tunnel` for the fallback.", "");
  console.log(lines.join("\n"));
});
