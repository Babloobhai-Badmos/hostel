// Tiny WebAudio synth: every sound is generated, no audio files.
// Every sfx takes an optional volume (0..1) so world sounds can fade with
// distance (see HEARING_RANGE_TILES).

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
  ding: (v = 1) => {
    tone(880, 180, "sine", 0.8 * v);
    setTimeout(() => tone(1320, 260, "sine", 0.7 * v), 90);
  },
  buzz: (v = 1) => tone(140, 220, "square", 0.5 * v, 90),
  click: (v = 1) => tone(1200, 40, "square", 0.3 * v),
  womp: (v = 1) => tone(220, 260, "sawtooth", 0.6 * v, 60),
  knock: (v = 1) => noise(70, 600, 1.4 * v),
  chomp: (v = 1) => {
    noise(60, 1800, 0.8 * v);
    tone(300, 60, "square", 0.3 * v, 180);
  },
  splash: (v = 1) => noise(350, 2500, 0.7 * v),
  success: (v = 1) => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 160, "triangle", 0.7 * v), i * 90)),
  /** Kill: a meaty smack. */
  thwack: (v = 1) => {
    noise(120, 900, 2 * v);
    tone(160, 180, "square", 0.6 * v, 50);
  },
  ventPop: (v = 1) => {
    tone(600, 90, "sine", 0.8 * v, 1400);
    noise(80, 3000, 0.4 * v);
  },
  whoosh: (v = 1) => noise(250, 4000, 0.8 * v),
  gas: (v = 1) => noise(900, 700, 0.6 * v),
  shield: (v = 1) => [880, 1175, 1568].forEach((f, i) => setTimeout(() => tone(f, 300, "sine", 0.4 * v), i * 60)),
  beatDrop: (v = 1) => {
    tone(110, 600, "sawtooth", 1.2 * v, 40);
    noise(200, 300, 1.5 * v);
  },
  revive: (v = 1) => [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 220, "sine", 0.6 * v), i * 110)),
  squish: (v = 1) => {
    tone(90, 300, "sawtooth", 0.8 * v, 45);
    noise(200, 500, 1.2 * v);
  },
  /** Chaos event siren (two-tone, like the meeting alarm). */
  alarm: (v = 1) => {
    for (let i = 0; i < 4; i++) setTimeout(() => tone(i % 2 ? 660 : 880, 220, "square", 0.45 * v), i * 230);
  },
  /** Power cut. */
  bzzzt: (v = 1) => {
    tone(60, 500, "sawtooth", 0.9 * v);
    tone(120, 500, "square", 0.4 * v);
  },
  /** Warden's whistle. */
  whistle: (v = 1) => {
    tone(2600, 160, "sine", 0.6 * v, 2900);
    setTimeout(() => tone(2600, 260, "sine", 0.6 * v, 2400), 180);
  },
  /** Food fight crowd + splats. */
  foodFight: (v = 1) => {
    for (let i = 0; i < 6; i++) setTimeout(() => noise(90, 1200 + Math.random() * 2000, 0.6 * v), i * 140);
  },
  chat: (v = 1) => tone(1400, 60, "sine", 0.35 * v),
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
