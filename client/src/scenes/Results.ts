// Round over: winner banner and everyone's role revealed, as an HTML overlay
// on top of the frozen game. The host gets PLAY AGAIN (back to the lobby).

import Phaser from "phaser";
import { ClientMsg } from "../../../shared/types";
import type { ResultsMessage } from "../../../shared/types";
import { net } from "../net";

const $id = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class ResultsScene extends Phaser.Scene {
  constructor() {
    super("Results");
  }

  create(): void {
    const overlay = $id<HTMLDivElement>("results");
    const again = $id<HTMLButtonElement>("again-btn");
    const onAgain = () => net.room?.send(ClientMsg.PlayAgain);
    again.addEventListener("click", onAgain);

    const render = () => {
      const r = net.results;
      overlay.classList.toggle("show", !!r);
      if (r) this.fill(r);
    };
    const offResults = net.on("results", render);
    const offHost = net.room ? net.callbacks(net.room)(net.room.state).listen("hostId", render) : () => {};
    render();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      again.removeEventListener("click", onAgain);
      offResults();
      offHost();
      overlay.classList.remove("show");
    });
  }

  private fill(r: ResultsMessage): void {
    const title = $id<HTMLHeadingElement>("results-title");
    title.textContent = r.winner === "killers" ? "KILLERS WIN" : "CREW WINS";
    title.className = r.winner;
    $id<HTMLParagraphElement>("results-reason").textContent = r.reason;

    const tbody = $id<HTMLTableElement>("results-table").tBodies[0];
    tbody.replaceChildren();
    const order = { killer: 0, savior: 1, regular: 2 } as Record<string, number>;
    const rows = [...r.players].sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || b.kills - a.kills);
    for (const p of rows) {
      const tr = document.createElement("tr");
      if (!p.alive) tr.className = "dead";
      const cells = [p.name, p.character, p.alive ? "Alive" : "Dead", p.role === "killer" ? String(p.kills) : ""];
      cells.forEach((text, i) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (i === 1) td.className = p.role;
        tr.append(td);
      });
      tbody.append(tr);
    }

    const isHost = net.room?.state.hostId === net.sessionId;
    $id<HTMLButtonElement>("again-btn").classList.toggle("hidden", !isHost);
    $id<HTMLDivElement>("results-wait").classList.toggle("hidden", isHost);
  }
}
