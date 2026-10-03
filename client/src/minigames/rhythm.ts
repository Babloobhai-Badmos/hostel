// RHYTHM — "Knock on 303" (room 303, the Gujju Rapper's room)
//
// Input: tap the door (or press Space) in time with the beat. A ring
// shrinks onto the knocker; tap when it lands. BEATS beats, one every
// BEAT_SECONDS. A tap within HIT_WINDOW seconds of a beat is a hit. Between
// beats the Gujju Rapper shouts a line through the door (browser voice).
// Get REQUIRED_HITS hits out of BEATS to finish; otherwise it restarts.
// (Phase 5: the Gujju Rapper hears you knocking...)

import Phaser from "phaser";
import { buzzPhone, sfx, speak } from "../audio/synth";
import type { MinigameFactory } from "./types";
import { COLORS, label } from "./ui";

const TUNING = {
  beats: 6,
  beatSeconds: 1.3,
  hitWindow: 0.2,
  requiredHits: 5,
  leadInSeconds: 1.5,
};

const VOICE_LINES = ["Kaun hai?", "Kem cho!", "Arre bhai!", "Dhol baja!", "Ruk ja!", "Darwaja todega kya?", "Yo yo!"];

export const rhythmGame: MinigameFactory = (ctx) => {
  const { scene, area, u } = ctx;
  const doorX = area.x + area.width * 0.38;
  const doorY = area.centerY;
  const doorW = u * 46;
  const doorH = u * 80;

  // The door of 303.
  const door = scene.add.container(doorX, doorY);
  const dg = scene.add.graphics();
  dg.fillStyle(0x6d4c41, 1);
  dg.fillRoundedRect(-doorW / 2, -doorH / 2, doorW, doorH, u * 2);
  dg.lineStyle(u, 0x3e2723, 1);
  dg.strokeRoundedRect(-doorW / 2 + u * 4, -doorH / 2 + u * 4, doorW - u * 8, doorH * 0.4, u);
  dg.strokeRoundedRect(-doorW / 2 + u * 4, u * 2, doorW - u * 8, doorH * 0.4, u);
  dg.fillStyle(0xf4c430, 1);
  dg.fillCircle(doorW * 0.32, u * 2, u * 2.5);
  door.add(dg);
  door.add(label(scene, 0, -doorH / 2 + u * 8, "303", u * 8, "#f4c430"));
  door.setSize(doorW, doorH).setInteractive();

  const targetY = -u * 14;
  const target = scene.add.circle(doorX, doorY + targetY, u * 7, 0x000000, 0).setStrokeStyle(u, 0xffffff, 0.9);
  const ring = scene.add.circle(doorX, doorY + targetY, u * 7, 0x000000, 0).setStrokeStyle(u * 0.8, COLORS.accent, 1);
  const bubble = label(scene, area.x + area.width * 0.76, area.y + area.height * 0.28, "", u * 6, "#ff9ad5");
  const score = label(scene, area.x + area.width * 0.76, area.y + area.height * 0.7, "", u * 7);

  let t = -TUNING.leadInSeconds;
  let hits = 0;
  let judged: boolean[] = [];
  let finished = false;
  let lastVoiceBeat = -1;

  const reset = () => {
    t = -TUNING.leadInSeconds;
    hits = 0;
    judged = new Array(TUNING.beats).fill(false);
    lastVoiceBeat = -1;
    score.setText(`0 / ${TUNING.requiredHits}`);
  };

  const knock = () => {
    if (finished) return;
    sfx.knock();
    buzzPhone(20);
    scene.tweens.add({ targets: door, scaleX: 0.97, scaleY: 0.97, duration: 50, yoyo: true });
    // Which beat is this tap closest to?
    const beat = Math.round(t / TUNING.beatSeconds);
    if (beat < 0 || beat >= TUNING.beats || judged[beat]) return;
    const off = Math.abs(t - beat * TUNING.beatSeconds);
    if (off > TUNING.hitWindow) return;
    judged[beat] = true;
    hits++;
    target.setStrokeStyle(u, COLORS.good, 1);
    scene.time.delayedCall(150, () => target.setStrokeStyle(u, 0xffffff, 0.9));
    score.setText(`${hits} / ${TUNING.requiredHits}`);
  };
  door.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, knock);
  scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE).on("down", knock);

  ctx.setStatus("Knock when the ring lands on the circle.");
  reset();

  return {
    update(dt) {
      if (finished) return;
      t += dt;
      // Ring shrinks from 3x to 1x over each beat interval, landing on the beat.
      const next = Math.max(0, Math.ceil(t / TUNING.beatSeconds));
      const phase = (next * TUNING.beatSeconds - t) / TUNING.beatSeconds; // 1 → 0
      ring.setRadius(u * 7 * (1 + 2 * Phaser.Math.Clamp(phase, 0, 1)));
      ring.setVisible(next < TUNING.beats && t > -TUNING.leadInSeconds + 0.2);

      // Voice line halfway between beats.
      const half = Math.floor(t / TUNING.beatSeconds - 0.5);
      if (half >= 0 && half < TUNING.beats - 1 && half !== lastVoiceBeat && t - (half + 0.5) * TUNING.beatSeconds < 0.1) {
        lastVoiceBeat = half;
        const line = VOICE_LINES[Math.floor(Math.random() * VOICE_LINES.length)];
        bubble.setText(`🎤 "${line}"`);
        speak(line);
      }

      if (t > (TUNING.beats - 1) * TUNING.beatSeconds + TUNING.hitWindow + 0.3) {
        if (hits >= TUNING.requiredHits) {
          finished = true;
          ring.setVisible(false);
          bubble.setText('🎤 "Aavo aavo!"');
          ctx.complete();
        } else {
          sfx.buzz();
          ctx.setStatus(`Only ${hits} in time. Again! Knock with the beat.`);
          reset();
        }
      }
    },
    destroy() {
      window.speechSynthesis?.cancel();
    },
  };
};
