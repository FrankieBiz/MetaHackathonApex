import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  armStartupChime,
  playAlert,
  playFill,
  playStartup,
  playTick,
  setSoundEnabled,
  soundEnabled,
  toggleSound,
  triggerHaptic,
} from "@/lib/feedback";
import { isTourRunning, stopTour } from "@/lib/tour";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    key: (index) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
  };
}

describe("feedback and tour", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: memoryStorage(),
    });
    vi.stubGlobal("navigator", {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("handles sound enablement and persistence in localStorage", () => {
    expect(soundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(soundEnabled()).toBe(true);

    const toggled = toggleSound();
    expect(toggled).toBe(false);
    expect(soundEnabled()).toBe(false);
  });

  it("safely calls tone and haptic methods without errors", () => {
    expect(() => playTick()).not.toThrow();
    expect(() => playFill()).not.toThrow();
    expect(() => playAlert()).not.toThrow();
    expect(() => playStartup()).not.toThrow();
    expect(() => triggerHaptic(15)).not.toThrow();

    setSoundEnabled(true);
    expect(() => playTick()).not.toThrow();
    expect(() => playFill()).not.toThrow();
    expect(() => playAlert()).not.toThrow();
    expect(() => playStartup()).not.toThrow();
  });

  it("waits for an enabled gesture and plays the startup chime once", () => {
    const context = {
      currentTime: 0,
      state: "running",
      destination: {},
      createOscillator: vi.fn(() => ({
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn().mockReturnValue({ connect: vi.fn() }),
        start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        disconnect: vi.fn(),
      })),
    };
    const Audio = vi.fn(function () { return context; });
    const target = new EventTarget();
    Object.assign(target, { localStorage: window.localStorage, AudioContext: Audio });
    vi.stubGlobal("window", target);

    const cleanup = armStartupChime();
    target.dispatchEvent(new Event("click"));
    expect(Audio).not.toHaveBeenCalled();

    setSoundEnabled(true);
    target.dispatchEvent(new Event("keyup"));
    expect(context.createOscillator).toHaveBeenCalledTimes(3);
    target.dispatchEvent(new Event("click"));
    expect(context.createOscillator).toHaveBeenCalledTimes(3);

    playAlert();
    expect(context.createOscillator).toHaveBeenCalledTimes(5);
    setSoundEnabled(false);
    playAlert();
    playStartup();
    expect(context.createOscillator).toHaveBeenCalledTimes(5);
    cleanup();
  });

  it("removes startup gesture listeners on cleanup", () => {
    const target = new EventTarget();
    Object.assign(target, { localStorage: window.localStorage });
    vi.stubGlobal("window", target);
    const remove = vi.spyOn(target, "removeEventListener");
    const cleanup = armStartupChime();
    cleanup();
    expect(remove).toHaveBeenCalledWith("click", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("keyup", expect.any(Function));
  });

  it("manages tour lifecycle safely", () => {
    expect(isTourRunning()).toBe(false);
    stopTour();
    expect(isTourRunning()).toBe(false);
  });
});
