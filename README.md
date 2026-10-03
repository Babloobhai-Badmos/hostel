# Hostel

A chaotic multiplayer top-down browser game for 1–20 friends on the same WiFi or hotspot. One laptop runs the server; everyone else opens a URL in their phone or laptop browser. Nothing to install on the phones.

**Current status: Phase 7 (all phases done).** Lobby, two generated hostel floors, secret roles with a reveal screen, killers with melee attacks and special abilities, the Gujju Rapper NPC, the Supreme Leader's revive and shield, bodies, ghosts, vision with line of sight, vents, hiding spots, tasks with 9 minigames, chaos events (warden patrol, lights out, food fight, power cut), Common Lounge chat, synth sound effects, screen shake and phone vibration, and a results screen. There are no meetings or voting (by design).

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

## Controls

| | Phone | Laptop |
| --- | --- | --- |
| Move | Left thumb anywhere on the left half (floating joystick) | WASD / arrow keys |
| Use (stairs, hide, climb out, vent, search) | USE button (lights up and relabels when something is in reach) | E |
| Attack (killers) | ATTACK button (lights up when someone is in reach) | Space |
| Ability (DASH / WIDE / GAS / SHIELD) | ABILITY button (shows a cooldown ring) | Q |
| Revive a body (Supreme Leader) | HOLD the USE button (it says REVIVE) for 3 s | hold E |
| Chat (only in the Common Lounge) | 💬 CHAT button at the top | Enter |
| Look at the other floor's map | Tap the minimap | M |

- **Stairs:** walk onto the yellow-striped stairs and press USE to go to the matching stairs on the other floor. You only see players on your own floor.
- **Hiding spots:** anything with a **dotted yellow outline** (cupboards, lockers, under beds, curtains, behind water tanks, between bookshelves...). Stand next to it and press USE. While hidden, nobody else can see you and you can't move. USE again to climb out. One person per spot. Killers can't hit you in there, but they can **SEARCH** a spot (10 s cooldown): if you're inside, you're dragged out and killed.

## Roles

Everyone gets a secret character at the start of each round, shown on a 4-second reveal screen. Killers also see who the other killers are. Characters are data in `shared/characters.json`.

| Players | Killers | Also |
| --- | --- | --- |
| 15–20 | Arch-Semen, Kallu Koli, Mota-dalla, Laal Jhanda | Supreme Leader, Gujju Rapper (NPC in room 303) |
| 10–14 | 3 of those 4, at random | Supreme Leader, Gujju Rapper (NPC) |
| 5–9 | 2 of those 4, at random | Supreme Leader |

Everyone else is a regular Hosteller. Killers all look exactly like everyone else.

- **Killing:** killers press ATTACK to hit the closest player in front of them within their range, then wait out their cooldown (15 s). Killers can't hurt each other. Nobody can be killed in the first 5 seconds (spawn protection, shown as a blue bubble).
- **Bodies** stay where they fell for the whole round (unless the Supreme Leader revives them).
- **Ghosts:** dead players float through walls, see everything, and are invisible to the living.
- **Vision:** the living see 6 tiles around them; killers see half that. Walls and solid furniture block sight.
- **Vents:** killers can jump into a grate and pop out of the paired one, maybe on the other floor (8 s cooldown).
- **Winning:** crew wins when every killer is dead or has left, or when every living Hosteller has finished their tasks. Killers win when everyone else is dead, or killers are at least as many as everyone else alive.

## Abilities

| Character | ABILITY (Q) | Cooldown |
| --- | --- | --- |
| Arch-Semen | **Dash**: 0.4 s at 2.5x speed. A hit while dashing counts normally. | 12 s |
| Kallu Koli | **Wide swing**: arms your next attack to hit everyone in a 180° arc in front of you. | 15 s |
| Mota-dalla | **Poison gas**: a green cloud (1.5 tiles) at your feet for 4 s. Anyone (except killers) in it dies. | 20 s |
| Laal Jhanda | none (his kill is the red-cloth strangle) | |
| Supreme Leader | **Shield**: the nearest player within 2 tiles (or yourself) can't be killed for 5 s. Plus **revive**: hold USE on a body for 3 s to bring them back, once per round. Can't kill. | 30 s |

**The Gujju Rapper** (computer-controlled, from 10 players) lives in room 303 and never leaves on his own. Open the "Knock on 303" task and he wakes up ("KAUN HAI BEY?!"). You get 2.5 seconds to run. Then he drops the beat: everyone within 4 tiles (killers too) is stunned for 3 seconds, and he finishes off the knocker with his butt-crush. Shielded and spawn-protected players are safe. 20 s between beats. He can't be killed and doesn't count for either side.

Stunned players can't move or act, but can still be killed. Shielded players show a blue bubble that everyone can see.

All numbers live in `shared/characters.json` (cooldowns, gas radius, stun radius/length, shield length) and `shared/constants.ts` (dash speed, wide-swing arc, Gujju's reaction time, ranges).

## Chaos events

Every 60–90 seconds something happens, one at a time, with a siren and a banner:

| Event | What happens | How long |
| --- | --- | --- |
| 🔦 Warden patrol | A Warden walks the corridors of the busiest floor. His yellow flashlight cone shows through the dark. Anyone it catches (killers too) is frozen for 3 s. | 20 s |
| 💡 Lights out | Everyone can only see 2 tiles around them. | 15 s |
| 🍛 Food fight | Purely for fun: a banner and food flying across everyone's screen. | 8 s |
| ⚡ Power cut | Door gaps flicker black, BZZZT. Cosmetic only. | 10 s |

No event ever kills anyone. Timings are in `shared/constants.ts`. To try them quickly the host can add `&chaos=all` (or `&chaos=warden`, `lights`, `foodfight`, `powercut`) to a debug URL, and events then come every 12 seconds.

## Face photos

In the lobby, tap **📷 Add your photo** to take a selfie or pick one from your gallery. It's cropped to a circle and put on your character's head (big-head style) for everyone to see: facing down or sideways you see the photo, walking away you see the back of the head. When you die, your body lies there with your photo sideways and red X-eyes. Tap ✕ to go back to the cartoon face.

- Each phone picks its own photo, and remembers it for next time.
- You can change it only in the lobby, not during a round.
- Photos are shrunk to 80 x 80 pixels and kept only in the server's memory while the room exists. Nothing is saved on the laptop running the server.
- Everyone still has the same body, so a photo never gives away who the killer is.

## Chat

Living players standing in the **Common Lounge** can talk to everyone else in the lounge (press Enter, or tap 💬 CHAT). Messages show as bubbles over heads and in a small log; nobody outside the lounge sees them. 80 characters per message, one message every 1.5 s. Which rooms allow chat is set by `chatRooms` in `shared/layout.json`.

## Sound and juice

All sounds are generated in the browser (WebAudio), no audio files: THWACK on kills, pops for vents, whooshes, the beat drop, a siren for chaos events, BZZZT, the warden's whistle, chimes for tasks and revives. World sounds get quieter with distance and you don't hear other floors. Kills nearby shake the screen, finished tasks float a "TASK DONE ✓", and phones vibrate when you're killed, stunned or warned. The Gujju Rapper's voice lines use the phone's built-in text-to-speech voice.

## Tasks

Each regular Hosteller gets 6 of the 9 tasks below at random (listed top-left with the room and floor). Your unfinished stations pulse yellow on the map and show as yellow dots on the minimap. Walk up to one and press USE to open its minigame. You're still standing in the hostel while you play, so killers can get you; walking away or dying closes it.

The bar at the top is the whole crew's progress. **When every living Hosteller has finished all their tasks, the crew wins.** Ghosts can still do their tasks for fun, but they no longer count. Killers get a fake list so they can pretend. The Supreme Leader has no tasks.

| Task | Where | How to play |
| --- | --- | --- |
| Fill the water bottle | Washroom, F2 | Hold the button, let go in the green zone. 3 bottles. |
| Charge your phone | Common Lounge, F2 | Remember 4 arrows (shown for 2 s), repeat them. Twice. |
| Carry chai | Terrace, F3 | Tilt the phone (or drag / WASD) to carry the cup along the path without spilling. |
| Knock on 303 | 303, F2 | Tap the door in time with 6 beats while the Gujju Rapper shouts through it. |
| Measure the corridor | North Corridor, F2 | Tap MARK as the slider crosses each of the 5 red lines. |
| Paint the wall | 421, F3 | Drag across the wall until it's 100% painted. |
| Fight the ghost-demon | 309, F2 | Tap BONK as fast as you can before the bar drains. WOMP. |
| Eat the laddus | 310, F2 | Eat all 10 laddus within 3 seconds. |
| Teddy bear surgery | 311, F2 | Drag 5 pieces of stuffing out to the tray without touching the red bits. |

Each minigame's file in `client/src/minigames/` starts with a comment explaining its controls and a `TUNING` block (speeds, zones, counts) you can edit to make it easier or harder. Tasks themselves (names, rooms, types) are in `shared/tasks.json`.

On laptops: Space works for the hold/tap games, arrow keys for the pattern, WASD for the chai, and Esc closes a minigame.

## Testing alone (debug mode)

A round needs 5 players. To test with fewer, the **host** opens the game with `?debug=1` and START fills the room with wandering bots:

```
http://localhost:3000/?debug=1                       # fill up to 5 players with bots
http://localhost:3000/?debug=1&bots=12               # fill up to 12
http://localhost:3000/?debug=1&role=arch-semen       # and make the host Arch-Semen
http://localhost:3000/?debug=1&chaos=all             # chaos events every 12 s
```

`role` takes any id from `shared/characters.json` (`arch-semen`, `kallu-koli`, `mota-dalla`, `laal-jhanda`, `supreme-leader`, `regular`). Debug options only count when the first person to join the room uses them. Bots don't play minigames; each living bot ticks off one of its tasks every 25 seconds so the progress bar still moves.

## The map

Everything comes from `shared/layout.json` (rooms, doors, stairs, vents, spawn, furniture per room type) and `shared/tasks.json` (task stations). No art files.

- Rename a room: change its `label`. Move or resize a room: change `x`, `y` (and `w`, `h`). The file starts with a `_help` section explaining every field.
- Check a change without starting the game:

  ```bash
  npm run map
  ```

  This validates the layout (overlaps, doors that lead into walls, unreachable rooms, corridors not 3 wide...) and prints both floors as ASCII. Restart `npm start` afterwards to see it in game.

## Testing from your phone

1. Run `npm start` on the laptop. Note the LAN URL.
2. On the laptop, open `http://localhost:3000`, type a name and press **Join**. You're the host (👑).
3. On your phone, open the LAN URL (for example `http://192.168.1.42:3000`), turn it sideways, type a name and tap **Join**. Both devices now list both players.
4. With fewer than 5 people, open the laptop page as `http://localhost:3000/?debug=1&role=arch-semen` **before** anyone else joins (see Testing alone).
5. On the laptop, press **START**. Each device shows its role for 4 seconds, then everyone is in the Floor 2 Washroom.
6. Walk around. You only see what's in your vision circle. The yellow name is you.
7. As the killer (laptop): after the 5-second spawn protection, walk up to the phone player, face them and press Space. THWACK. The phone becomes a ghost and a body stays on the floor.
8. Try hiding in a locker on the phone, then search it from the laptop with E.
9. Reconnect test: lock the phone or reload the page, then come back within 30 seconds. You get your slot (and role) back.

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
| `npm run map` | Validate `layout.json` and print both floors as ASCII |
| `npm run selftest` | With the server running: scripted rounds (each in its own room) that check tasks (wrong place, too fast, never opened), hiding, searching, vents, spawn protection, ghosts, speed limits, and every ability incl. the Gujju Rapper and revive. `npm run selftest -- - gujju` runs one scenario (core, dash, wide, gas, gujju, chaos, chat). |
| `npm run tunnel` | Print tunnel fallback instructions |
| `npm run sim -- [count] [seconds] [url]` | Headless load test: simulated players join, start a round and wander |

Use another port with `PORT=3001 npm start` (on Windows PowerShell: `$env:PORT=3001; npm start`).

## How it's put together

- `shared/`: constants (every tunable number), message types, the data files (`layout.json`, `tasks.json`, `characters.json`), the map builder (`buildMap.ts`) and the movement/collision code. Server and client both run this code, so they always agree on where the walls are.
- `server/`: Express serves the built client. Colyseus runs the `hostel` room at 20 ticks/second. `rooms/HostelRoom.ts` only orchestrates. Rules live in `systems/`.
- `client/`: Phaser 3 + Vite. Scenes: Boot → Lobby → Game + HUD.

Networking is server-authoritative. Clients send only `{ dx, dy, seq }` movement inputs, 20 per second. The server clamps the direction length and gives each player one input credit per tick, so sending inputs faster can't make anyone move faster. Your own player is predicted locally and corrected by the server. Other players are drawn 100 ms in the past and blended between server updates.
