// Lobby: name entry, list of players, and the host's START button. The UI is
// a plain HTML overlay (see index.html) so the phone keyboard works properly.

import Phaser from "phaser";
import { MAX_PLAYERS, MIN_PLAYERS_TO_START, NAME_MAX_LENGTH, PLAYER_COLORS } from "../../../shared/constants";
import { ClientMsg } from "../../../shared/types";
import { net } from "../net";
import { photoToFace, saveFace, savedFace } from "../faces";

const $id = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class LobbyScene extends Phaser.Scene {
  private cleanups: (() => void)[] = [];

  constructor() {
    super("Lobby");
  }

  create(): void {
    const overlay = $id<HTMLDivElement>("lobby");
    const form = $id<HTMLDivElement>("join-form");
    const roomView = $id<HTMLDivElement>("room-view");
    const nameInput = $id<HTMLInputElement>("name-input");
    const joinBtn = $id<HTMLButtonElement>("join-btn");
    const startBtn = $id<HTMLButtonElement>("start-btn");
    const errorEl = $id<HTMLDivElement>("lobby-error");

    overlay.classList.add("show");
    errorEl.textContent = "";
    nameInput.maxLength = NAME_MAX_LENGTH;
    if (!nameInput.value) nameInput.value = net.savedName;

    const showRoom = () => {
      form.classList.add("hidden");
      roomView.classList.remove("hidden");
      this.bindRoom();
    };

    let joining = false;
    const join = async () => {
      // Enter auto-repeat or a double tap must not join twice (the first seat would become a ghost player).
      if (joining || net.room) return;
      const name = nameInput.value.trim();
      if (!name) {
        errorEl.textContent = "Type a name first.";
        nameInput.focus();
        return;
      }
      joining = true;
      joinBtn.disabled = true;
      errorEl.textContent = "";
      nameInput.blur();
      try {
        await net.join(name);
        // The router restarts this scene for the new room; bindRoom runs then.
      } catch (err) {
        errorEl.textContent = `Couldn't join: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        joining = false;
        joinBtn.disabled = false;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.repeat) void join();
    };
    const onJoinClick = () => void join();
    const onStartClick = () => net.room?.send(ClientMsg.Start);

    // Face photo: camera or gallery, remembered on this device, sent to the room if we're in one.
    const faceBtn = $id<HTMLButtonElement>("face-btn");
    const faceClear = $id<HTMLButtonElement>("face-clear");
    const faceInput = $id<HTMLInputElement>("face-input");
    const setFace = (face: string) => {
      saveFace(face);
      this.showFacePreview(face);
      net.room?.send(ClientMsg.Face, { face });
    };
    const onFaceClick = () => faceInput.click();
    const onFaceClear = () => setFace("");
    const onFacePicked = async () => {
      const file = faceInput.files?.[0];
      faceInput.value = "";
      if (!file) return;
      faceBtn.disabled = true;
      try {
        setFace(await photoToFace(file));
        errorEl.textContent = "";
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : String(err);
      } finally {
        faceBtn.disabled = false;
      }
    };
    faceBtn.addEventListener("click", onFaceClick);
    faceClear.addEventListener("click", onFaceClear);
    faceInput.addEventListener("change", onFacePicked);
    this.showFacePreview(savedFace());

    joinBtn.addEventListener("click", onJoinClick);
    nameInput.addEventListener("keydown", onKey);
    startBtn.addEventListener("click", onStartClick);
    this.cleanups.push(() => {
      joinBtn.removeEventListener("click", onJoinClick);
      nameInput.removeEventListener("keydown", onKey);
      startBtn.removeEventListener("click", onStartClick);
      faceBtn.removeEventListener("click", onFaceClick);
      faceClear.removeEventListener("click", onFaceClear);
      faceInput.removeEventListener("change", onFacePicked);
      overlay.classList.remove("show");
    });

    if (net.room) showRoom();
    else {
      form.classList.remove("hidden");
      roomView.classList.add("hidden");
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cleanups.forEach((fn) => fn());
      this.cleanups = [];
    });
  }

  private showFacePreview(face: string): void {
    const preview = $id<HTMLDivElement>("face-preview");
    preview.style.backgroundImage = face ? `url("${face}")` : "";
    preview.textContent = face ? "" : "🙂";
    $id<HTMLButtonElement>("face-btn").textContent = face ? "📷 Change photo" : "📷 Add your photo";
    $id<HTMLButtonElement>("face-clear").classList.toggle("hidden", !face);
  }

  /** Keep the player list and Start button in sync with the room state. */
  private bindRoom(): void {
    const room = net.room!;
    const $ = net.callbacks(room);
    const render = () => this.renderRoom();

    this.cleanups.push(
      $(room.state).players.onAdd((player) => {
        this.cleanups.push($(player).onChange(render));
        render();
      }),
      $(room.state).players.onRemove(render),
      $(room.state).listen("hostId", render),
      net.onStatus(render),
    );
    this.cleanups.push(
      net.on("error", (message) => {
        $id<HTMLDivElement>("lobby-error").textContent = message;
      }),
      $(room.state).listen("debug", render),
    );
    render();
  }

  private renderRoom(): void {
    const room = net.room;
    if (!room) return;
    const list = $id<HTMLUListElement>("player-list");
    const status = $id<HTMLDivElement>("lobby-status");
    const startBtn = $id<HTMLButtonElement>("start-btn");

    list.replaceChildren();
    let connected = 0;
    room.state.players.forEach((p) => {
      if (p.connected) connected++;
      const li = document.createElement("li");
      if (!p.connected) li.classList.add("offline");
      const dot = document.createElement("span");
      const color = `#${PLAYER_COLORS[p.color].toString(16).padStart(6, "0")}`;
      if (p.face) {
        dot.className = "face-thumb";
        dot.style.backgroundImage = `url("${p.face}")`;
        dot.style.borderColor = color;
      } else {
        dot.className = "dot";
        dot.style.background = color;
      }
      const label = document.createElement("span");
      const tags = [p.id === room.state.hostId ? "👑" : "", p.id === room.sessionId ? "(you)" : ""];
      label.textContent = `${p.name} ${tags.join(" ")}`.trim();
      li.append(dot, label);
      list.append(li);
    });

    const isHost = room.state.hostId === room.sessionId;
    const enough = room.state.debug || connected >= MIN_PLAYERS_TO_START;
    startBtn.classList.toggle("hidden", !isHost);
    startBtn.disabled = !enough;
    startBtn.textContent = enough ? "START" : `Need ${MIN_PLAYERS_TO_START} players`;

    if (net.reconnecting) status.textContent = "Connection lost. Reconnecting…";
    else {
      const who = isHost ? "You're the host. Press START when everyone's in." : "Waiting for the host to start…";
      const debug = room.state.debug ? " DEBUG ROOM: bots fill the empty slots." : "";
      status.textContent = `${connected}/${MAX_PLAYERS} in the hostel. ${who}${debug}`;
    }
  }
}
