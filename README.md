# Hostel

A chaotic multiplayer top-down browser game for 1–20 friends on the same WiFi or hotspot. One laptop runs the server; everyone else opens a URL in their phone or laptop browser. Nothing to install on the phones.

**Current status: Phase 1 (scaffold and sync).** You get a lobby with name entry, a host START button, and players moving around a test room, synced across devices.

## Requirements

- **Node.js 20.19+** (or 22.12+) on the computer that hosts the game. Check with `node -v`.
- All players on the same WiFi or hotspot. If that doesn't work, see the tunnel fallback below.

## Start the server

```bash
npm install      # first time only
npm start        # builds the client, then starts the server on port 3000
```

The server prints something like:

```
  HOSTEL server is running

  This computer:   http://localhost:3000
  Share one of these with friends on the same WiFi / hotspot:
    http://192.168.1.42:3000    (Wi-Fi)
```

## Finding the LAN URL

- The server prints every address it's reachable on. Share the one for your WiFi or hotspot adapter. It's usually `192.168.x.x`, `10.x.x.x` or `172.16–31.x.x`.
- If several addresses are listed, ignore ones that belong to VirtualBox, WSL, Docker or a VPN, and try the WiFi one first.
- To find it yourself: on Windows run `ipconfig` (look for "IPv4 Address" under your Wi-Fi adapter). On macOS run `ipconfig getifaddr en0`. On Linux run `hostname -I`.
- **Windows:** the first time you run the server, Windows Firewall asks whether to allow Node.js. Tick **Private networks** and click Allow. If you missed the prompt, go to *Windows Security → Firewall → Allow an app through firewall* and enable Node.js for Private networks. Also set your WiFi network profile to **Private**.
- **macOS:** click *Allow* when asked about incoming connections for `node`.

### Using a phone hotspot

Turn on the hotspot on one phone and connect the laptop and the other phones to it. Start the server on the laptop and share the printed `http://192.168.x.x:3000` (Android hotspots usually use `192.168.43.x` or similar). The phone that runs the hotspot can play too, using the same URL.

## If the WiFi blocks other devices

Many hostel and college networks use **client isolation**: every device can reach the internet but not each other. You'll notice because the URL works on the host laptop but just spins or times out on phones. Fixes, in order of preference:

1. **Use a hotspot** from a phone or the laptop (Windows: *Settings → Network → Mobile hotspot*). That is a private network with no isolation.
2. **Use the tunnel fallback** below. It works on any network, even mobile data, but adds some lag.

## Tunnel fallback

```bash
npm run tunnel
```

This prints step-by-step instructions. In short: install `cloudflared`, keep `npm start` running, and in a second terminal run:

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints an `https://<random-words>.trycloudflare.com` URL. Send that to everyone. The URL changes every time you restart cloudflared.

## Testing from your phone (Phase 1)

1. Run `npm start` on the laptop. Note the LAN URL.
2. On the laptop, open `http://localhost:3000`, type a name and press **Join**. You're the host (👑).
3. On your phone, open the LAN URL (for example `http://192.168.1.42:3000`), turn it sideways, type a name and tap **Join**. Both devices now list both players.
4. On the laptop, press **START**. Both devices switch to the test room.
5. Move:
   - **Phone:** put your left thumb anywhere on the left half of the screen and drag. The joystick appears where your thumb lands. The ATTACK / USE / ABILITY buttons on the right stay grayed out until later phases.
   - **Laptop:** WASD or the arrow keys.
6. Each device should see the other moving smoothly. The yellow name is you.
7. Reconnect test: lock the phone or reload the page, then come back within 30 seconds. You get your slot back (other players see you as "(offline)" in the meantime).

The first tap on a phone puts the page into fullscreen landscape on Android. **iPhones don't support the fullscreen API**. For a full-screen experience there, tap *Share → Add to Home Screen* and open the game from the new icon.

### Load test

With the server running, in a second terminal:

```bash
npm run sim -- 20 300     # 20 simulated players for 300 seconds
```

It prints server update rate (should stay ~20/s) and the worst gap between updates every 10 seconds.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Build the client and start the server (what you normally run) |
| `npm run dev` | Rebuild the client and restart the server on file changes (refresh the browser yourself) |
| `npm run serve` | Start the server without rebuilding the client |
| `npm run build` | Build the client into `dist/client` |
| `npm run typecheck` | TypeScript strict check of everything |
| `npm run tunnel` | Print tunnel fallback instructions |
| `npm run sim -- [count] [seconds] [url]` | Headless bot load test |

Use another port with `PORT=3001 npm start` (on Windows PowerShell: `$env:PORT=3001; npm start`).

## How it's put together

- `shared/`: constants (every tunable number), message types, and the movement and collision code that both the server and the client run.
- `server/`: Express serves the built client. Colyseus runs the `hostel` room at 20 ticks/second. `rooms/HostelRoom.ts` only orchestrates. Rules live in `systems/`.
- `client/`: Phaser 3 + Vite. Scenes: Boot → Lobby → Game + HUD.

Networking is server-authoritative. Clients send only `{ dx, dy, seq }` movement inputs, 20 per second. The server clamps the direction length and gives each player one input credit per tick, so sending inputs faster can't make anyone move faster. Your own player is predicted locally and corrected by the server. Other players are drawn 100 ms in the past and blended between server updates.
