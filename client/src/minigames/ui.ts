// Shared building blocks for minigames: big chunky buttons and text.

import Phaser from "phaser";

export const COLORS = {
  panel: 0x221d2e,
  good: 0x3cb44b,
  bad: 0xd7263d,
  accent: 0xf4c430,
  text: "#ffffff",
};

export function label(scene: Phaser.Scene, x: number, y: number, text: string, sizePx: number, color = COLORS.text): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, {
      fontFamily: "system-ui, sans-serif",
      fontSize: `${Math.round(sizePx)}px`,
      fontStyle: "bold",
      color,
      stroke: "#000000",
      strokeThickness: Math.max(2, sizePx / 8),
      align: "center",
    })
    .setOrigin(0.5)
    .setResolution(2);
}

export interface BigButton {
  container: Phaser.GameObjects.Container;
  setText(text: string): void;
  setColor(color: number): void;
}

/**
 * A big rounded button. `onDown` fires on press, `onUp` on release (including
 * sliding off the button or releasing anywhere), so it works for hold games.
 */
export function bigButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  color: number,
  onDown: () => void,
  onUp?: () => void,
): BigButton {
  const g = scene.add.graphics();
  let currentColor = color;
  let down = false;
  const draw = () => {
    g.clear();
    g.fillStyle(0x000000, 0.5);
    g.fillRoundedRect(-w / 2, -h / 2 + 6, w, h, h * 0.25);
    g.fillStyle(currentColor, 1);
    g.fillRoundedRect(-w / 2, -h / 2 + (down ? 4 : 0), w, h, h * 0.25);
  };
  draw();
  const t = label(scene, 0, 0, text, h * 0.36);
  // Shrink long captions so they always fit inside the button.
  const fit = () => t.setScale(Math.min(1, (w * 0.85) / Math.max(1, t.width)));
  fit();
  const container = scene.add.container(x, y, [g, t]).setSize(w, h).setInteractive({ useHandCursor: true });
  container.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
    down = true;
    draw();
    t.setY(4);
    onDown();
  });
  const release = () => {
    if (!down) return;
    down = false;
    draw();
    t.setY(0);
    onUp?.();
  };
  container.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, release);
  scene.input.on(Phaser.Input.Events.POINTER_UP, release);
  return {
    container,
    setText: (s) => {
      t.setText(s);
      fit();
    },
    setColor: (c) => {
      currentColor = c;
      draw();
    },
  };
}

/** Shake an object sideways briefly (wrong answer). */
export function shake(scene: Phaser.Scene, target: Phaser.GameObjects.Components.Transform, px: number): void {
  const x0 = target.x;
  scene.tweens.add({ targets: target, x: x0 + px, duration: 40, yoyo: true, repeat: 3, onComplete: () => target.setX(x0) });
}
