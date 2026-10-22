/**
 * Feedback sounds and haptics for Apex OS.
 *
 * All audio is synthesized with the Web Audio API, so there are no external assets.
 * Nothing touches `window` or `navigator` at module load, so this file is SSR-safe.
 */

const SOUND_KEYS = ["apex:sound", "apex-terminal:sound"] as const;
const PRIMARY_SOUND_KEY = SOUND_KEYS[0];

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

let sharedContext: AudioContext | null = null;

interface ToneOptions {
  type: OscillatorType;
  startFreq: number;
  endFreq: number;
  /** Offset in seconds from the current audio clock time. */
  start: number;
  duration: number;
  volume: number;
}

export function soundEnabled(): boolean {
  if (typeof window === "undefined") return false;

  for (const key of SOUND_KEYS) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return false;
    }
    if (raw !== null) return raw === "1" || raw === "true" || raw === "on";
  }

  return false;
}

export function setSoundEnabled(on: boolean): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(PRIMARY_SOUND_KEY, on ? "1" : "0");
  } catch {
    // Storage can be unavailable (private mode, quota). The setting just won't persist.
  }
}

export function toggleSound(): boolean {
  const next = !soundEnabled();
  setSoundEnabled(next);
  return next;
}

/**
 * Lazily creates the shared AudioContext and resumes it if the browser suspended it.
 * The first call should come from a user gesture (click, key, pointer) to satisfy autoplay policy.
 */
function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  if (!sharedContext) {
    const Ctor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!Ctor) return null;
    try {
      sharedContext = new Ctor();
    } catch {
      return null;
    }
  }

  if (sharedContext.state === "suspended") {
    void sharedContext.resume().catch(() => {});
  }

  return sharedContext;
}

function scheduleTone(ctx: AudioContext, options: ToneOptions): void {
  const { type, startFreq, endFreq, start, duration, volume } = options;
  const t0 = ctx.currentTime + start;
  const t1 = t0 + duration;
  const attack = Math.min(0.004, duration / 4);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, t0);
  if (endFreq !== startFreq) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, t1);
  }

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t1 + 0.01);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

/** Soft ascending terminal boot chord, played only after audio is enabled. */
export function playStartup(): void {
  if (!soundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;

  for (const [index, frequency] of [392, 523.25, 783.99].entries()) {
    scheduleTone(ctx, {
      type: "sine",
      startFreq: frequency,
      endFreq: frequency,
      start: index * 0.09,
      duration: 0.26,
      volume: 0.035,
    });
  }
}

/** Wait for an enabled user gesture; never queue blocked autoplay on page load. */
export function armStartupChime(): () => void {
  if (typeof window === "undefined") return () => {};
  const cleanup = () => {
    window.removeEventListener("click", onGesture);
    window.removeEventListener("keyup", onGesture);
  };
  const onGesture = () => {
    if (!soundEnabled()) return;
    cleanup();
    playStartup();
  };
  window.addEventListener("click", onGesture);
  window.addEventListener("keyup", onGesture);
  return cleanup;
}

/** Subtle low-volume micro-click for checkbox toggles. */
export function playTick(): void {
  if (!soundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;

  scheduleTone(ctx, {
    type: "triangle",
    startFreq: 1200,
    endFreq: 800,
    start: 0,
    duration: 0.03,
    volume: 0.03,
  });
}

/** Crisp two-tone rising chord for a completed or filled assignment. */
export function playFill(): void {
  if (!soundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;

  scheduleTone(ctx, {
    type: "triangle",
    startFreq: 660,
    endFreq: 990,
    start: 0,
    duration: 0.12,
    volume: 0.05,
  });

  scheduleTone(ctx, {
    type: "sine",
    startFreq: 1320,
    endFreq: 1320,
    start: 0.06,
    duration: 0.06,
    volume: 0.02,
  });
}

/** Descending warning double-blip for a new defensive or volatile stance. */
export function playAlert(): void {
  if (!soundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;

  for (const start of [0, 0.14]) {
    scheduleTone(ctx, {
      type: "triangle",
      startFreq: 523.25,
      endFreq: 330,
      start,
      duration: 0.11,
      volume: 0.04,
    });
  }
}

/** Struck-bell partials: frequency ratio to the strike note, relative level, ring-out seconds. */
const BELL_PARTIALS = [
  [0.5, 0.35, 2.2],
  [1, 1, 1.8],
  [1.2, 0.45, 1.2],
  [1.5, 0.3, 1],
  [2, 0.55, 0.9],
  [2.76, 0.25, 0.6],
  [5.4, 0.12, 0.35],
] as const;
const BELL_NOTE = 659.25;
const BELL_STRIKES = [0, 0.38, 0.76];

/**
 * The morning bell: three strikes of inharmonic partials, each ringing out on
 * its own decay. Returns its length in seconds, 0 when silent.
 */
export function playBell(): number {
  if (!soundEnabled()) return 0;
  const ctx = getContext();
  if (!ctx) return 0;

  for (const start of BELL_STRIKES) {
    for (const [ratio, level, duration] of BELL_PARTIALS) {
      const frequency = BELL_NOTE * ratio;
      scheduleTone(ctx, {
        type: "sine",
        startFreq: frequency,
        endFreq: frequency,
        start,
        duration,
        volume: 0.045 * level,
      });
    }
  }
  return BELL_STRIKES.at(-1)! + Math.max(...BELL_PARTIALS.map((p) => p[2]));
}

/** Short vibration pulse on devices that support the Vibration API. */
export function triggerHaptic(ms = 12): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(ms);
}
