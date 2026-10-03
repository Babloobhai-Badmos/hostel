// Phone controls, drawn in screen space by the HUD scene.
//
// Left half of the screen: a floating joystick appears wherever the left
// thumb lands and follows that finger until it lifts. Output is analog: the
// further from the centre (up to the radius), the faster you walk.
//
// Right side: three big round buttons, ATTACK, USE, ABILITY. Each one can be
// enabled/disabled (grayed out) and shows a cooldown ring (0 = ready, 1 =
// just used). USE lights up and relabels itself when something is in reach
// (stairs, a hiding spot); ATTACK and ABILITY arrive in later phases.

import Phaser from "phaser";
import {
  ACTION_BUTTON_RADIUS_FRAC,
  JOYSTICK_DEAD_ZONE,
  JOYSTICK_RADIUS_FRAC,
} from "../../../shared/constants";
import type { Vec2 } from "../../../shared/types";

export type ActionName = "attack" | "use" | "ability";

interface ActionButton {
  name: ActionName;
  label: string;
  color: number;
  enabled: boolean;
  cooldown: number;
  /** Set on press, cleared by consumePress(). */
  pressed: boolean;
  /** True while a finger is on the button (for hold-to-use actions). */
  held: boolean;
  pointerId: number | null;
  x: number;
  y: number;
  r: number;
  text: Phaser.GameObjects.Text;
}

const BASE_ALPHA = 0.35;
const KNOB_ALPHA = 0.6;
const DISABLED_COLOR = 0x555060;
const COOLDOWN_RING_COLOR = 0x000000;
const COOLDOWN_RING_ALPHA = 0.55;
/** Horizontal/vertical spacing between buttons, as multiples of the button radius. */
const BUTTON_SPACING = 2.4;
/** Distance of the button cluster from the screen edge, as multiples of the radius. */
const BUTTON_MARGIN = 1.4;

export class TouchControls {
  private scene: Phaser.Scene;
  private gfx: Phaser.GameObjects.Graphics;
  private stickPointer: number | null = null;
  private stickOrigin: Vec2 = { x: 0, y: 0 };
  private stickKnob: Vec2 = { x: 0, y: 0 };
  private stickRadius = 0;
  private buttons: ActionButton[] = [];
  private _vector: Vec2 = { x: 0, y: 0 };
  readonly visible: boolean;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.visible = navigator.maxTouchPoints > 0 || "ontouchstart" in window;
    this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(1000);

    const defs: [ActionName, string, number][] = [
      ["attack", "ATTACK", 0xd7263d],
      ["use", "USE", 0x2e86de],
      ["ability", "ABILITY", 0x8e44ad],
    ];
    for (const [name, label, color] of defs) {
      const text = scene.add
        .text(0, 0, label, {
          fontFamily: "system-ui, sans-serif",
          fontStyle: "bold",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1001)
        .setVisible(this.visible);
      this.buttons.push({
        name, label, color, text,
        enabled: false, cooldown: 0, pressed: false, held: false, pointerId: null,
        x: 0, y: 0, r: 0,
      });
    }

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
    this.layout();
  }

  /** Joystick direction, length 0..1. */
  get vector(): Vec2 {
    return this._vector;
  }

  setEnabled(name: ActionName, enabled: boolean): void {
    const b = this.find(name);
    b.enabled = enabled;
    if (!enabled) b.held = false;
  }

  /** Change a button's caption (e.g. USE -> STAIRS / HIDE / EXIT). */
  setLabel(name: ActionName, text: string): void {
    const b = this.find(name);
    if (b.text.text !== text) b.text.setText(text);
  }

  /** 0 = ready, 1 = full cooldown remaining. */
  setCooldown(name: ActionName, fraction: number): void {
    this.find(name).cooldown = Phaser.Math.Clamp(fraction, 0, 1);
  }

  /** True once per tap. */
  consumePress(name: ActionName): boolean {
    const b = this.find(name);
    const was = b.pressed;
    b.pressed = false;
    return was;
  }

  isHeld(name: ActionName): boolean {
    return this.find(name).held;
  }

  draw(): void {
    const g = this.gfx;
    g.clear();
    if (!this.visible) return;

    if (this.stickPointer !== null) {
      g.fillStyle(0xffffff, BASE_ALPHA * 0.5);
      g.fillCircle(this.stickOrigin.x, this.stickOrigin.y, this.stickRadius);
      g.lineStyle(3, 0xffffff, BASE_ALPHA);
      g.strokeCircle(this.stickOrigin.x, this.stickOrigin.y, this.stickRadius);
      g.fillStyle(0xffffff, KNOB_ALPHA);
      g.fillCircle(this.stickKnob.x, this.stickKnob.y, this.stickRadius * 0.45);
    }

    for (const b of this.buttons) {
      const alpha = b.held ? 0.95 : 0.7;
      g.fillStyle(b.enabled ? b.color : DISABLED_COLOR, b.enabled ? alpha : 0.45);
      g.fillCircle(b.x, b.y, b.r);
      g.lineStyle(3, 0x000000, 0.6);
      g.strokeCircle(b.x, b.y, b.r);
      if (b.cooldown > 0) {
        // Dark pie slice that shrinks clockwise as the cooldown runs out.
        const start = -Math.PI / 2;
        g.fillStyle(COOLDOWN_RING_COLOR, COOLDOWN_RING_ALPHA);
        g.slice(b.x, b.y, b.r, start, start + Math.PI * 2 * b.cooldown, false);
        g.fillPath();
      }
      b.text.setAlpha(b.enabled ? 1 : 0.5);
    }
  }

  private find(name: ActionName): ActionButton {
    return this.buttons.find((b) => b.name === name)!;
  }

  /** Buttons sit in a triangle in the bottom-right corner, sized from screen height. */
  private layout(): void {
    const { width, height } = this.scene.scale;
    this.stickRadius = height * JOYSTICK_RADIUS_FRAC;
    const r = height * ACTION_BUTTON_RADIUS_FRAC;
    const right = width - r * BUTTON_MARGIN;
    const bottom = height - r * BUTTON_MARGIN;
    const positions: Record<ActionName, Vec2> = {
      attack: { x: right - r * BUTTON_SPACING, y: bottom },
      use: { x: right, y: bottom - r * BUTTON_SPACING * 0.5 },
      ability: { x: right - r * BUTTON_SPACING * 0.9, y: bottom - r * BUTTON_SPACING * 1.15 },
    };
    for (const b of this.buttons) {
      b.r = r;
      b.x = positions[b.name].x;
      b.y = positions[b.name].y;
      b.text.setPosition(b.x, b.y).setFontSize(Math.max(10, Math.round(r * 0.32)));
    }
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (!this.visible) return;
    for (const b of this.buttons) {
      if (Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y) <= b.r * 1.15) {
        if (b.enabled) {
          b.pressed = true;
          b.held = true;
          b.pointerId = p.id;
        }
        return;
      }
    }
    if (this.stickPointer === null && p.x < this.scene.scale.width / 2) {
      this.stickPointer = p.id;
      this.stickOrigin = { x: p.x, y: p.y };
      this.stickKnob = { x: p.x, y: p.y };
      this._vector = { x: 0, y: 0 };
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (p.id !== this.stickPointer) return;
    const dx = p.x - this.stickOrigin.x;
    const dy = p.y - this.stickOrigin.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, this.stickRadius);
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 0;
    this.stickKnob = { x: this.stickOrigin.x + nx * clamped, y: this.stickOrigin.y + ny * clamped };
    const strength = clamped / this.stickRadius;
    this._vector = strength < JOYSTICK_DEAD_ZONE ? { x: 0, y: 0 } : { x: nx * strength, y: ny * strength };
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (p.id === this.stickPointer) {
      this.stickPointer = null;
      this._vector = { x: 0, y: 0 };
    }
    for (const b of this.buttons) {
      if (b.pointerId === p.id) {
        b.held = false;
        b.pointerId = null;
      }
    }
  }
}
