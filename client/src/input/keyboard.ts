// Desktop controls: WASD / arrow keys to move, Space = attack, E = use,
// Q = ability, Enter = chat (actions are wired up in later phases).

import Phaser from "phaser";
import type { Vec2 } from "../../../shared/types";

export class KeyboardControls {
  private keys: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;
  readonly attack: Phaser.Input.Keyboard.Key;
  readonly use: Phaser.Input.Keyboard.Key;
  readonly ability: Phaser.Input.Keyboard.Key;
  readonly chat: Phaser.Input.Keyboard.Key;

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: kb.addKey(K.UP),
      down: kb.addKey(K.DOWN),
      left: kb.addKey(K.LEFT),
      right: kb.addKey(K.RIGHT),
      w: kb.addKey(K.W),
      a: kb.addKey(K.A),
      s: kb.addKey(K.S),
      d: kb.addKey(K.D),
    };
    this.attack = kb.addKey(K.SPACE);
    this.use = kb.addKey(K.E);
    this.ability = kb.addKey(K.Q);
    this.chat = kb.addKey(K.ENTER);
  }

  /** Movement direction with length 0 or 1 (diagonals are normalised). */
  get vector(): Vec2 {
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.left.isDown || k.a.isDown) x -= 1;
    if (k.right.isDown || k.d.isDown) x += 1;
    if (k.up.isDown || k.w.isDown) y -= 1;
    if (k.down.isDown || k.s.isDown) y += 1;
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }
}
