import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  playAlert,
  playFill,
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
    expect(() => triggerHaptic(15)).not.toThrow();

    setSoundEnabled(true);
    expect(() => playTick()).not.toThrow();
    expect(() => playFill()).not.toThrow();
    expect(() => playAlert()).not.toThrow();
  });

  it("manages tour lifecycle safely", () => {
    expect(isTourRunning()).toBe(false);
    stopTour();
    expect(isTourRunning()).toBe(false);
  });
});
