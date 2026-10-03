// Screen-space overlay on top of the Game scene: touch controls, where you
// are, your role badge, what USE would do, the kill feed, the role-reveal
// screen, and a minimap of the floor with a floor toggle.
// Phase 4 adds the task list and crew progress bar.

import Phaser from "phaser";
import {
  CHAT_MAX_LENGTH,
  GUJJU_REACT_SECONDS,
  KILL_FEED_SECONDS,
  MAX_PLAYERS,
  ROLE_REVEAL_SECONDS,
  SEARCH_COOLDOWN_SECONDS,
  TILE_SIZE,
  VENT_COOLDOWN_SECONDS,
} from "../../../shared/constants";
import { ChaosKind, ClientMsg, GamePhase } from "../../../shared/types";
import { sfx } from "../audio/synth";
import type { KillMessage } from "../../../shared/types";
import type { CharacterDef } from "../../../shared/characters";
import { areaAt } from "../../../shared/buildMap";
import type { UseTarget } from "../../../shared/interact";
import { hostelMap } from "../../../shared/world";
import { TouchControls } from "../input/touch";
import { bakeMinimapTexture } from "../render/mapRenderer";
import { net } from "../net";
import type { GameScene } from "./Game";
import { MinigameScene } from "./Minigame";

const STATUS_FONT_PX = 14;
const MARGIN_PX = 10;
/** Minimap height as a fraction of the screen height. */
const MINIMAP_HEIGHT_FRAC = 0.3;
const MINIMAP_MIN_PX_PER_TILE = 2;
const MINIMAP_MAX_PX_PER_TILE = 4;
const MINIMAP_SELF_COLOR = 0xffe066;
const MINIMAP_SELF_RADIUS = 3;
const MINIMAP_TASK_COLOR = 0xffe066;
const MINIMAP_TASK_RADIUS = 2.5;

const FEED_MAX_LINES = 4;
const CHAT_LOG_LINES = 4;
const CHAT_LOG_SECONDS = 10;
/** Big banner when a chaos event starts. */
const CHAOS_BANNER_MS = 3000;
const CHAOS_TEXT: Record<string, [string, string]> = {
  warden: ["🔦 WARDEN PATROL!", "Stay out of his flashlight or you'll be frozen."],
  lights: ["💡 LIGHTS OUT!", "You can barely see a thing…"],
  foodfight: ["🍛 FOOD FIGHT IN THE MESS!", "Laddus everywhere!"],
  powercut: ["⚡ POWER CUT!", "BZZZT. The doors are flickering."],
};
/** Food fight: one flying laddu every this many ms. */
const FOOD_FIGHT_SPAWN_MS = 90;
const TASK_FONT_PX = 11;
/** Crew progress bar width as a fraction of the screen width, and its height. */
const PROGRESS_WIDTH_FRAC = 0.32;
const PROGRESS_HEIGHT_PX = 14;
const PROGRESS_COLOR = 0x3cb44b;
const ROLE_COLORS: Record<string, string> = { killer: "#ff4d4d", savior: "#7fdbff", regular: "#9be564" };

const textStyle = (px: number): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: "system-ui, sans-serif",
  fontSize: `${px}px`,
  color: "#ffffff",
  stroke: "#000000",
  strokeThickness: 3,
});

function describeUse(t: UseTarget): { button: string; prompt: string } {
  switch (t.kind) {
    case "unhide":
      return { button: "EXIT", prompt: "Climb out" };
    case "stairs": {
      const floor = hostelMap.stairs.get(t.stair.target)?.floor;
      const name = floor !== undefined ? hostelMap.floors.get(floor)?.name : "";
      return { button: "STAIRS", prompt: `Take the stairs to ${name}` };
    }
    case "hide":
      return { button: "HIDE", prompt: `Hide in the ${t.spot.type.replace(/-/g, " ")}` };
    case "search":
      return { button: "SEARCH", prompt: `Search the ${t.spot.type.replace(/-/g, " ")}` };
    case "vent":
      return { button: "VENT", prompt: "Jump into the vent" };
    case "task":
      return { button: "TASK", prompt: t.station.name };
    case "revive":
      return { button: "REVIVE", prompt: "HOLD to revive this body" };
  }
}

/** ABILITY button caption per ability id. */
const ABILITY_LABEL: Record<string, string> = {
  dash: "DASH",
  "wide-swing": "WIDE",
  "poisonous-smell": "GAS",
  shield: "SHIELD",
};

function roleTitle(c: CharacterDef | undefined, spectator: boolean): string {
  if (spectator) return "SPECTATOR (ghost)";
  if (!c) return "";
  if (c.role === "killer") return `${c.name.toUpperCase()} · KILLER`;
  if (c.role === "savior") return `${c.name.toUpperCase()} · SAVIOR`;
  return "HOSTELLER";
}

export class HUDScene extends Phaser.Scene {
  touch: TouchControls | null = null;
  private status!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private minimap!: Phaser.GameObjects.Image;
  private minimapFrame!: Phaser.GameObjects.Graphics;
  private minimapLabel!: Phaser.GameObjects.Text;
  private minimapFloor = hostelMap.spawnFloor;
  /** The floor the local player was on last frame; the minimap follows it when it changes. */
  private lastOwnFloor = -1;
  private pxPerTile = MINIMAP_MIN_PX_PER_TILE;
  private dot: Phaser.GameObjects.Arc | null = null;
  private badge!: Phaser.GameObjects.Text;
  private feed!: Phaser.GameObjects.Text;
  private feedLines: { text: string; until: number }[] = [];
  private reveal!: Phaser.GameObjects.Container;
  private revealBg!: Phaser.GameObjects.Rectangle;
  private revealTitle!: Phaser.GameObjects.Text;
  private revealBody!: Phaser.GameObjects.Text;
  private cleanups: (() => void)[] = [];
  private taskList!: Phaser.GameObjects.Text;
  private chaosBanner!: Phaser.GameObjects.Text;
  private chaosBannerUntil = 0;
  private lastChaos = "";
  private nextFoodAt = 0;
  private chatButton!: Phaser.GameObjects.Text;
  private chatLog!: Phaser.GameObjects.Text;
  private chatLines: { text: string; until: number }[] = [];
  private enterKey: Phaser.Input.Keyboard.Key | undefined;
  private minimapTasks!: Phaser.GameObjects.Graphics;
  private progress!: Phaser.GameObjects.Graphics;
  private progressLabel!: Phaser.GameObjects.Text;

  constructor() {
    super("HUD");
  }

  create(): void {
    this.touch = new TouchControls(this);
    this.status = this.add.text(MARGIN_PX, MARGIN_PX, "", textStyle(STATUS_FONT_PX));
    this.prompt = this.add.text(0, 0, "", textStyle(STATUS_FONT_PX + 2)).setOrigin(0.5, 1);
    this.banner = this.add
      .text(0, 0, "Connection lost. Reconnecting…", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "22px",
        fontStyle: "bold",
        color: "#ffe066",
        backgroundColor: "#000000aa",
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.minimap = this.add.image(0, 0, "__DEFAULT").setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.minimapFrame = this.add.graphics();
    this.minimapLabel = this.add.text(0, 0, "", textStyle(STATUS_FONT_PX)).setOrigin(1, 0);
    // Tap the minimap (or press M) to look at the other floor.
    this.minimap.on(Phaser.Input.Events.POINTER_DOWN, () => this.cycleMinimapFloor());
    this.input.keyboard?.on("keydown-M", () => this.cycleMinimapFloor());
    this.lastOwnFloor = -1;
    this.dot = null;

    this.badge = this.add.text(MARGIN_PX, MARGIN_PX + STATUS_FONT_PX + 8, "", { ...textStyle(STATUS_FONT_PX + 2), fontStyle: "bold" });
    this.feed = this.add.text(0, 0, "", textStyle(STATUS_FONT_PX)).setOrigin(1, 0);
    this.feedLines = [];
    this.revealBg = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.88).setOrigin(0);
    this.revealTitle = this.add
      .text(0, 0, "", { fontFamily: "Impact, system-ui, sans-serif", fontSize: "44px", color: "#ffffff", stroke: "#000000", strokeThickness: 8, align: "center" })
      .setOrigin(0.5);
    this.revealBody = this.add.text(0, 0, "", { ...textStyle(18), align: "center", wordWrap: { width: 600 } }).setOrigin(0.5, 0);
    this.reveal = this.add.container(0, 0, [this.revealBg, this.revealTitle, this.revealBody]).setDepth(10_000).setVisible(false);

    this.taskList = this.add
      .text(MARGIN_PX, MARGIN_PX + STATUS_FONT_PX * 2 + 18, "", {
        ...textStyle(TASK_FONT_PX),
        backgroundColor: "#00000066",
        padding: { x: 6, y: 4 },
        lineSpacing: 2,
      });
    this.progress = this.add.graphics();
    this.minimapTasks = this.add.graphics();
    this.progressLabel = this.add.text(0, 0, "", { ...textStyle(TASK_FONT_PX), fontStyle: "bold" }).setOrigin(0.5);

    this.chaosBanner = this.add
      .text(0, 0, "", { ...textStyle(26), fontStyle: "bold", align: "center", color: "#ffe066" })
      .setOrigin(0.5)
      .setDepth(5000)
      .setVisible(false);
    this.lastChaos = net.room?.state.chaos ?? "";
    this.chatButton = this.add
      .text(0, 0, "💬 CHAT", { ...textStyle(16), fontStyle: "bold", backgroundColor: "#2e86de", padding: { x: 12, y: 6 } })
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);
    this.chatButton.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => this.openChat());
    this.chatLog = this.add.text(MARGIN_PX, 0, "", { ...textStyle(13), backgroundColor: "#00000066", padding: { x: 6, y: 4 } }).setOrigin(0, 1);
    this.chatLines = [];
    this.enterKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.bindChatBox();

    this.cleanups = [
      net.on("chat", (msg) => {
        this.chatLines.push({ text: `${msg.name}: ${msg.text}`, until: performance.now() + CHAT_LOG_SECONDS * 1000 });
        if (this.chatLines.length > CHAT_LOG_LINES) this.chatLines.shift();
      }),
      net.on("taskList", () => this.renderTaskList()),
      net.on("kill", (msg) => this.onKill(msg)),
      net.on("error", (text) => this.pushFeed(text)),
      net.on("fx", (msg) => {
        if (msg.kind !== "gujju-awake") return;
        const me = (this.scene.get("Game") as GameScene | undefined)?.localState;
        if (me && me.alive && me.floor === msg.floor && Math.hypot(me.x - msg.x, me.y - msg.y) < TILE_SIZE * 8) {
          this.pushFeed(`The Gujju Rapper heard you knocking… RUN! (${GUJJU_REACT_SECONDS}s)`);
          navigator.vibrate?.([80, 60, 80]);
        }
      }),
    ];

    this.renderTaskList();
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.touch = null;
      this.cleanups.forEach((fn) => fn());
      this.cleanups = [];
    });
  }

  /** Living players only learn that someone died; ghosts get the name. */
  private onKill(msg: KillMessage): void {
    if (msg.victimId === net.sessionId) {
      this.pushFeed("You were eliminated. You're a ghost now.");
      navigator.vibrate?.(200);
      return;
    }
    const me = net.room?.state.players.get(net.sessionId);
    this.pushFeed(me && !me.alive ? `${msg.victimName} was eliminated` : "Someone was eliminated");
  }

  // ---------- Chat ----------

  private chatBoxCleanup: (() => void) | null = null;

  private bindChatBox(): void {
    const box = document.getElementById("chat-box")!;
    const input = document.getElementById("chat-input") as HTMLInputElement;
    const send = document.getElementById("chat-send")!;
    input.maxLength = CHAT_MAX_LENGTH;
    const submit = () => {
      const text = input.value.trim();
      if (text) net.room?.send(ClientMsg.Chat, { text });
      this.closeChat();
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") submit();
      else if (e.key === "Escape") this.closeChat();
    };
    const onSend = (e: Event) => {
      e.preventDefault();
      submit();
    };
    input.addEventListener("keydown", onKey);
    send.addEventListener("pointerdown", onSend);
    this.chatBoxCleanup = () => {
      input.removeEventListener("keydown", onKey);
      send.removeEventListener("pointerdown", onSend);
      box.classList.remove("show");
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.closeChat();
      this.chatBoxCleanup?.();
    });
  }

  /** In a chat room, alive, round running. */
  private canChat(): boolean {
    const game = this.scene.get("Game") as GameScene | undefined;
    const me = game?.localState;
    if (!me || !me.alive || net.room?.state.phase !== GamePhase.Playing) return false;
    const floor = hostelMap.floors.get(me.floor);
    const area = floor ? areaAt(floor, me.x, me.y) : null;
    return !!area && hostelMap.chatRooms.includes(area.key);
  }

  private openChat(): void {
    if (!this.canChat()) return;
    const box = document.getElementById("chat-box")!;
    const input = document.getElementById("chat-input") as HTMLInputElement;
    // Let the text box have the keyboard (no moving while typing).
    this.game.input.keyboard!.enabled = false;
    box.classList.add("show");
    input.value = "";
    input.focus();
  }

  private closeChat(): void {
    const box = document.getElementById("chat-box");
    const input = document.getElementById("chat-input") as HTMLInputElement | null;
    if (!box?.classList.contains("show")) return;
    box.classList.remove("show");
    input?.blur();
    this.game.input.keyboard!.enabled = true;
    this.scene.get("Game")?.input.keyboard?.resetKeys();
    this.input.keyboard?.resetKeys();
  }

  /** Chaos: banner when an event starts, laddus flying during a food fight. */
  private updateChaos(now: number): void {
    const chaos = net.room?.state.chaos ?? "";
    if (chaos !== this.lastChaos) {
      this.lastChaos = chaos;
      const text = CHAOS_TEXT[chaos];
      if (text) {
        this.chaosBanner.setText(`${text[0]}\n${text[1]}`).setVisible(true).setScale(0.3);
        this.tweens.add({ targets: this.chaosBanner, scale: 1, duration: 300, ease: "Back.Out" });
        this.chaosBannerUntil = now + CHAOS_BANNER_MS;
        sfx.alarm(0.8);
        if (chaos === ChaosKind.FoodFight) sfx.foodFight();
        navigator.vibrate?.(100);
      }
    }
    if (this.chaosBanner.visible && now > this.chaosBannerUntil) this.chaosBanner.setVisible(false);
    if (chaos === ChaosKind.FoodFight && now >= this.nextFoodAt) {
      this.nextFoodAt = now + FOOD_FIGHT_SPAWN_MS;
      this.flingLaddu();
    }
  }

  private flingLaddu(): void {
    const { width, height } = this.scale;
    const fromLeft = Math.random() < 0.5;
    const y0 = Math.random() * height;
    const food = this.add
      .text(fromLeft ? -20 : width + 20, y0, Phaser.Math.RND.pick(["🟠", "🍛", "🥟", "🍩", "🟠"]), { fontSize: `${20 + Math.random() * 20}px` })
      .setOrigin(0.5)
      .setDepth(4000);
    this.tweens.add({
      targets: food,
      x: fromLeft ? width + 40 : -40,
      y: y0 + (Math.random() - 0.5) * height * 0.6,
      angle: (Math.random() - 0.5) * 1080,
      duration: 700 + Math.random() * 600,
      onComplete: () => food.destroy(),
    });
  }

  private renderTaskList(): void {
    const { tasks, fake } = net.tasks;
    if (tasks.length === 0) {
      this.taskList.setText("").setVisible(false);
      return;
    }
    const lines = tasks.map((t) => `${t.done ? "✓" : "☐"} ${t.name} · ${t.where}`);
    const header = fake ? "FAKE TASKS (just pretend)" : `TASKS ${tasks.filter((t) => t.done).length}/${tasks.length}`;
    this.taskList.setText([header, ...lines].join("\n")).setVisible(true);
  }

  private drawProgress(): void {
    const { width } = this.scale;
    const w = width * PROGRESS_WIDTH_FRAC;
    const x = (width - w) / 2;
    const y = MARGIN_PX;
    const value = net.room?.state.taskProgress ?? 0;
    this.progress.clear();
    this.progress.fillStyle(0x000000, 0.6);
    this.progress.fillRoundedRect(x - 2, y - 2, w + 4, PROGRESS_HEIGHT_PX + 4, 6);
    this.progress.fillStyle(PROGRESS_COLOR, 1);
    if (value > 0) this.progress.fillRoundedRect(x, y, Math.max(8, w * value), PROGRESS_HEIGHT_PX, 5);
    this.progressLabel.setPosition(width / 2, y + PROGRESS_HEIGHT_PX / 2).setText(`CREW TASKS ${Math.round(value * 100)}%`);
  }

  private pushFeed(text: string): void {
    this.feedLines.push({ text, until: performance.now() + KILL_FEED_SECONDS * 1000 });
    if (this.feedLines.length > FEED_MAX_LINES) this.feedLines.shift();
  }

  private cycleMinimapFloor(): void {
    const ids = hostelMap.floorIds;
    this.minimapFloor = ids[(ids.indexOf(this.minimapFloor) + 1) % ids.length];
    this.refreshMinimap();
  }

  private layout(): void {
    const { width, height } = this.scale;
    this.banner.setPosition(width / 2, height / 2);
    this.revealBg?.setSize(width, height);
    this.chaosBanner?.setPosition(width / 2, height * 0.28).setWordWrapWidth(width * 0.8);
    this.chatButton?.setPosition(width / 2, MARGIN_PX + PROGRESS_HEIGHT_PX + 10);
    this.chatLog?.setY(height * 0.62);
    this.revealTitle?.setPosition(width / 2, height * 0.38);
    this.revealBody?.setPosition(width / 2, height * 0.38 + 40).setWordWrapWidth(Math.min(600, width - 40));
    this.prompt.setPosition(width / 2, height - MARGIN_PX);
    const floor = hostelMap.floors.get(this.minimapFloor)!;
    this.pxPerTile = Phaser.Math.Clamp(
      Math.floor((height * MINIMAP_HEIGHT_FRAC) / floor.grid.height),
      MINIMAP_MIN_PX_PER_TILE,
      MINIMAP_MAX_PX_PER_TILE,
    );
    this.refreshMinimap();
  }

  private refreshMinimap(): void {
    const { width } = this.scale;
    const floor = hostelMap.floors.get(this.minimapFloor)!;
    this.minimap.setTexture(bakeMinimapTexture(this, floor, this.pxPerTile));
    this.minimap.setPosition(width - MARGIN_PX, MARGIN_PX);
    this.minimapLabel
      .setText(`${floor.name}  ⇄`)
      .setPosition(width - MARGIN_PX - 4, MARGIN_PX + this.minimap.height + 2);
    this.feed?.setPosition(width - MARGIN_PX, MARGIN_PX + this.minimap.height + STATUS_FONT_PX + 10);
    this.minimapFrame.clear();
    this.minimapFrame.lineStyle(2, 0xffffff, 0.6);
    this.minimapFrame.strokeRect(width - MARGIN_PX - this.minimap.width, MARGIN_PX, this.minimap.width, this.minimap.height);
  }

  override update(): void {
    const t0 = performance.now();
    this.updateChaos(t0);
    const chatOk = this.canChat();
    this.chatButton.setVisible(chatOk && !MinigameScene.isOpen(this));
    if (!chatOk) this.closeChat();
    else if (this.enterKey && Phaser.Input.Keyboard.JustDown(this.enterKey)) this.openChat();
    this.chatLines = this.chatLines.filter((l) => l.until > t0);
    this.chatLog.setText(this.chatLines.map((l) => l.text).join("\n")).setVisible(this.chatLines.length > 0);
    this.touch?.setSuspended(MinigameScene.isOpen(this));
    this.touch?.draw();
    this.drawProgress();
    this.banner.setVisible(net.reconnecting);
    const room = net.room;
    const game = this.scene.get("Game") as GameScene | undefined;
    const me = game?.localState;
    if (!room || !game || !me) return;

    // Status line: who you are, where you are, how many are in.
    let connected = 0;
    room.state.players.forEach((p) => {
      if (p.connected) connected++;
    });
    const floor = hostelMap.floors.get(me.floor);
    const area = floor ? areaAt(floor, me.x, me.y) : null;
    const name = room.state.players.get(room.sessionId)?.name ?? "";
    this.status.setText(`${name}  ·  ${floor?.name ?? ""}${area?.label ? ` · ${area.label}` : ""}  ·  ${connected}/${MAX_PLAYERS}`);

    const now = performance.now();
    const phase = room.state.phase;
    const c = net.character;

    // Role badge + reveal screen.
    const spectator = !!net.role?.spectator;
    this.badge.setText(roleTitle(c, spectator)).setColor(spectator ? "#cccccc" : ROLE_COLORS[c?.role ?? "regular"]);
    this.updateReveal(phase === GamePhase.Reveal, c, spectator);

    // Kill feed.
    this.feedLines = this.feedLines.filter((l) => l.until > now);
    this.feed.setText(this.feedLines.map((l) => l.text).join("\n"));

    // USE button + prompt (vent and search have their own cooldowns).
    const target = game.currentUseTarget();
    const use = target ? describeUse(target) : null;
    let useCooldown = 0;
    if (target?.kind === "vent") useCooldown = (net.readyAt.vent - now) / (VENT_COOLDOWN_SECONDS * 1000);
    if (target?.kind === "search") useCooldown = (net.readyAt.search - now) / (SEARCH_COOLDOWN_SECONDS * 1000);
    this.touch?.setEnabled("use", !!use && useCooldown <= 0);
    this.touch?.setCooldown("use", useCooldown);
    this.touch?.setLabel("use", use?.button ?? "USE");

    // ATTACK: killers only, lit when someone is in reach and the cooldown is done.
    const attackCd = c?.role === "killer" ? (net.readyAt.attack - now) / ((c.attackCooldown ?? 1) * 1000) : 0;
    const victim = c?.role === "killer" ? game.attackTarget() : null;
    this.touch?.setEnabled("attack", !!victim && attackCd <= 0);
    this.touch?.setCooldown("attack", attackCd);

    // ABILITY: role-specific label, lit when ready.
    const ability = c?.ability;
    const abilityCd = ability ? (net.readyAt.ability - now) / ((c?.abilityCooldown ?? 1) * 1000) : 0;
    this.touch?.setLabel("ability", ability ? ABILITY_LABEL[ability] ?? "ABILITY" : "ABILITY");
    this.touch?.setEnabled("ability", game.abilityUsable());
    this.touch?.setCooldown("ability", abilityCd);

    const keyboard = !this.touch?.visible;
    const prompts: string[] = [];
    if (me.alive && room.state.players.get(net.sessionId)?.stunned) prompts.push("💫 STUNNED! 💫");
    if (ability && keyboard && game.abilityUsable()) prompts.push(`[Q] ${ABILITY_LABEL[ability] ?? "ABILITY"}`);
    if (ability === "wide-swing" && net.wideArmed) prompts.push("WIDE SWING ARMED: next hit gets everyone in front");
    if (game.reviveStartedAt > 0) {
      const hold = (c?.reviveHoldSeconds ?? 3) * 1000;
      prompts.push(`Reviving… ${Math.min(100, Math.round(((now - game.reviveStartedAt) / hold) * 100))}%`);
    }
    if (use) prompts.push(`${keyboard ? "[E] " : ""}${use.prompt}${useCooldown > 0 ? ` (${Math.ceil(useCooldown * (target?.kind === "vent" ? VENT_COOLDOWN_SECONDS : SEARCH_COOLDOWN_SECONDS))}s)` : ""}`);
    if (victim && keyboard) prompts.push(attackCd > 0 ? `Attack ready in ${Math.ceil(attackCd * (c?.attackCooldown ?? 0))}s` : "[Space] ATTACK");
    const chaosNow = room.state.chaos;
    if (chaosNow && CHAOS_TEXT[chaosNow]) prompts.push(CHAOS_TEXT[chaosNow][0]);
    if (chatOk && keyboard) prompts.push("[Enter] chat");
    const protection = net.readyAt.protection - now;
    if (me.alive && protection > 0 && phase === GamePhase.Playing) prompts.push(`Spawn protection ${Math.ceil(protection / 1000)}s`);
    this.prompt.setText(prompts.join("   ·   "));

    // Minimap follows you between floors; draw your dot on your own floor.
    if (me.floor !== this.lastOwnFloor) {
      this.lastOwnFloor = me.floor;
      this.minimapFloor = me.floor;
      this.refreshMinimap();
    }
    // Your unfinished task stations on the floor the minimap is showing.
    const left = this.scale.width - MARGIN_PX - this.minimap.width;
    this.minimapTasks.clear();
    this.minimapTasks.fillStyle(MINIMAP_TASK_COLOR, 1);
    for (const id of phase === GamePhase.Playing ? net.openTaskIds : []) {
      const st = hostelMap.tasks.get(id);
      if (!st || st.floor !== this.minimapFloor) continue;
      this.minimapTasks.fillCircle(left + (st.x / TILE_SIZE) * this.pxPerTile, MARGIN_PX + (st.y / TILE_SIZE) * this.pxPerTile, MINIMAP_TASK_RADIUS);
    }
    if (this.minimapFloor === me.floor) {
      const dotX = left + (me.x / TILE_SIZE) * this.pxPerTile;
      const dotY = MARGIN_PX + (me.y / TILE_SIZE) * this.pxPerTile;
      this.refreshMinimapDot(dotX, dotY);
    } else {
      this.refreshMinimapDot(null, null);
    }
  }

  private updateReveal(show: boolean, c: CharacterDef | undefined, spectator: boolean): void {
    this.reveal.setVisible(show && (!!c || spectator));
    if (!this.reveal.visible) return;
    if (spectator) {
      this.revealTitle.setText("YOU'RE A GHOST").setColor("#cccccc");
      this.revealBody.setText("You joined mid-round. Float around and watch; you'll play next round.");
      return;
    }
    if (!c) return;
    const isKiller = c.role === "killer";
    this.revealTitle.setText(c.role === "regular" ? "YOU ARE A HOSTELLER" : `YOU ARE ${c.name.toUpperCase()}`).setColor(ROLE_COLORS[c.role]);
    const lines = [isKiller ? "KILLER" : c.role === "savior" ? "SAVIOR" : "CREW", c.blurb ?? ""];
    if (isKiller) {
      const fellow = net.role?.fellowKillers ?? [];
      lines.push(fellow.length ? `Other killers: ${fellow.join(", ")}` : "You're the only killer.");
      lines.push(`Kill cooldown ${c.attackCooldown}s${c.canVent ? " · you can use vents" : ""}`);
    }
    lines.push(`(${ROLE_REVEAL_SECONDS} seconds…)`);
    this.revealBody.setText(lines.join("\n\n"));
  }

  private refreshMinimapDot(x: number | null, y: number | null): void {
    if (!this.dot) this.dot = this.add.circle(0, 0, MINIMAP_SELF_RADIUS, MINIMAP_SELF_COLOR).setStrokeStyle(1, 0x000000);
    if (x === null || y === null) this.dot.setVisible(false);
    else this.dot.setVisible(true).setPosition(x, y);
  }
}
