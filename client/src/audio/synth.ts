// Tiny WebAudio synth: every sound is generated, no audio files. Phase 7
// adds more (thwack, vent pop, alarms); the minigames use these now.

let ctx: AudioContext | null = null;
const MASTER_VOLUME = 0.25;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One oscillator note, optionally sliding to another pitch. */
export function tone(freq: number, ms: number, type: OscillatorType = "sine", volume = 1, slideTo?: number): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + ms / 1000);
  gain.gain.setValueAtTime(MASTER_VOLUME * volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.02);
}

/** Short filtered noise burst (knocks, splashes). */
export function noise(ms: number, filterHz: number, volume = 1): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const len = Math.floor((a.sampleRate * ms) / 1000);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = filterHz;
  const gain = a.createGain();
  gain.gain.value = MASTER_VOLUME * volume;
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(t);
}

export const sfx = {
  ding: () => {
    tone(880, 180, "sine", 0.8);
    setTimeout(() => tone(1320, 260, "sine", 0.7), 90);
  },
  buzz: () => tone(140, 220, "square", 0.5, 90),
  click: () => tone(1200, 40, "square", 0.3),
  womp: () => tone(220, 260, "sawtooth", 0.6, 60),
  knock: () => noise(70, 600, 1.4),
  chomp: () => {
    noise(60, 1800, 0.8);
    tone(300, 60, "square", 0.3, 180);
  },
  splash: () => noise(350, 2500, 0.7),
  success: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 160, "triangle", 0.7), i * 90)),
};

/** Say a line with the browser's built-in voice (no audio files). Silently does nothing if unsupported. */
export function speak(text: string, rate = 1.3, pitch = 0.7): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = pitch;
    u.lang = "en-IN";
    synth.speak(u);
  } catch {
    // ignore
  }
}

/** Short vibration on phones that support it. */
export function buzzPhone(ms = 40): void {
  navigator.vibrate?.(ms);
}
