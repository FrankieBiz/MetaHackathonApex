import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  studentModeEnabled,
  setStudentModeEnabled,
  STUDENT_GLOSSARY,
} from "@/lib/studentMode";
import { TOUR_BEATS, useTourStore } from "@/store/tourStore";

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

describe("Student Mode", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: memoryStorage(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defaults to false when no localStorage entry exists", () => {
    expect(studentModeEnabled()).toBe(false);
  });

  it("persists true when enabled", () => {
    setStudentModeEnabled(true);
    expect(studentModeEnabled()).toBe(true);
  });

  it("persists false when disabled", () => {
    setStudentModeEnabled(true);
    expect(studentModeEnabled()).toBe(true);
    setStudentModeEnabled(false);
    expect(studentModeEnabled()).toBe(false);
  });

  it("contains clear plain-English collegiate definitions for all core metrics", () => {
    expect(STUDENT_GLOSSARY.orderBookTitle).toContain("Deliverable Queue");
    expect(STUDENT_GLOSSARY.equityCurveTitle).toContain("GPA Trajectory");
    expect(STUDENT_GLOSSARY.sharpeRatioLabel).toContain("Study ROI");
    expect(STUDENT_GLOSSARY.downsideVarLabel).toContain("Worst-Case Exam Scenario");
    expect(STUDENT_GLOSSARY.marginCallTitle).toContain("Grade Floor Breached");
    expect(STUDENT_GLOSSARY.academicStances.MAXIMAL_AGGRESSION).toContain("Sprint Mode");
  });
});

describe("Judge Demo Tour Store", () => {
  beforeEach(() => {
    useTourStore.getState().stop();
  });

  it("has 5 sequential demonstration acts", () => {
    expect(TOUR_BEATS.length).toBe(5);
    expect(TOUR_BEATS[0].badge).toContain("ACT 1");
    expect(TOUR_BEATS[1].badge).toContain("ACT 2");
    expect(TOUR_BEATS[2].badge).toContain("ACT 3");
    expect(TOUR_BEATS[3].badge).toContain("ACT 4");
    expect(TOUR_BEATS[4].badge).toContain("ACT 5");
  });

  it("navigates beats within valid bounds", () => {
    const store = useTourStore.getState();
    store.setRunning(true);
    expect(useTourStore.getState().beatIndex).toBe(0);

    store.nextBeat();
    expect(useTourStore.getState().beatIndex).toBe(1);

    store.nextBeat();
    expect(useTourStore.getState().beatIndex).toBe(2);

    store.prevBeat();
    expect(useTourStore.getState().beatIndex).toBe(1);

    store.setBeatIndex(100); // clamps to max
    expect(useTourStore.getState().beatIndex).toBe(TOUR_BEATS.length - 1);

    store.setBeatIndex(-5); // clamps to min
    expect(useTourStore.getState().beatIndex).toBe(0);
  });

  it("stops and resets state cleanly", () => {
    const store = useTourStore.getState();
    store.setRunning(true);
    store.setBeatIndex(3);
    expect(useTourStore.getState().running).toBe(true);

    store.stop();
    expect(useTourStore.getState().running).toBe(false);
    expect(useTourStore.getState().beatIndex).toBe(0);
  });
});
