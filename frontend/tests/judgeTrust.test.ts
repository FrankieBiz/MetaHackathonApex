import { beforeEach, describe, expect, it } from "vitest";
import {
  FERPA_BADGE,
  JUDGE_TOUR_BUTTON,
  TOUR_HUD_TITLE,
  VISION_INGEST,
  isTourHotkey,
  tourProgress,
} from "@/lib/judgeTrust";
import { TOUR_BEATS, useTourStore } from "@/store/tourStore";

const press = (
  key: string,
  modifiers: Partial<
    Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>
  > = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("Judge trust copy", () => {
  it("labels the privacy badge and explains the isolation model in its tooltip", () => {
    expect(FERPA_BADGE.label).toBe("🛡️ FERPA COMPLIANT");
    expect(FERPA_BADGE.tooltip).toBe(
      "Zero-retention client-side isolation; academic records never persist to public cloud",
    );
  });

  it("labels the one-click tour launcher and advertises its hotkey", () => {
    expect(JUDGE_TOUR_BUTTON.label).toBe("🚀 60s JUDGE TOUR");
    expect(JUDGE_TOUR_BUTTON.hotkey).toBe("D");
    expect(JUDGE_TOUR_BUTTON.title).toContain("Key D");
  });

  it("names the vision model and the document-handling guarantee", () => {
    expect(VISION_INGEST.heading).toBe(
      "👁️ META LLAMA 3.2 VISION: MULTIMODAL INGEST",
    );
    expect(VISION_INGEST.modelBadge).toBe(
      "Model: Llama-3.2-11B-Vision-Instruct",
    );
    expect(VISION_INGEST.privacyBadge).toBe(
      "Zero-leakage local document processing",
    );
  });

  it("titles the tour HUD", () => {
    expect(TOUR_HUD_TITLE).toBe("60-SECOND META HACKATHON JUDGE TOUR");
  });
});

describe("tourProgress", () => {
  it("reports a one-based step out of the total", () => {
    expect(tourProgress(0, 5)).toEqual({
      step: 1,
      total: 5,
      label: "STEP 1 OF 5",
    });
    expect(tourProgress(4, 5)).toEqual({
      step: 5,
      total: 5,
      label: "STEP 5 OF 5",
    });
  });

  it("clamps an out-of-range beat index into the tour", () => {
    expect(tourProgress(-3, 5).step).toBe(1);
    expect(tourProgress(99, 5).step).toBe(5);
  });
});

describe("isTourHotkey", () => {
  it("accepts a bare D in either case", () => {
    expect(isTourHotkey(press("d"))).toBe(true);
    expect(isTourHotkey(press("D"))).toBe(true);
  });

  it("leaves modified D chords to the other shortcuts", () => {
    // Ctrl+Shift+D toggles the simulation desk; Ctrl/Cmd+D belongs to the browser.
    expect(isTourHotkey(press("d", { ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
    expect(isTourHotkey(press("d", { ctrlKey: true }))).toBe(false);
    expect(isTourHotkey(press("d", { metaKey: true }))).toBe(false);
    expect(isTourHotkey(press("d", { altKey: true }))).toBe(false);
    expect(isTourHotkey(press("d", { shiftKey: true }))).toBe(false);
  });

  it("ignores other keys", () => {
    expect(isTourHotkey(press("u"))).toBe(false);
    expect(isTourHotkey(press("Escape"))).toBe(false);
  });
});

describe("Judge tour HUD navigation", () => {
  beforeEach(() => {
    useTourStore.getState().stop();
  });

  it("jumps straight to any step while the tour runs", () => {
    const store = useTourStore.getState();
    store.setRunning(true);
    store.setBeatIndex(3);
    expect(useTourStore.getState().beatIndex).toBe(3);
    expect(tourProgress(useTourStore.getState().beatIndex, TOUR_BEATS.length).label).toBe(
      "STEP 4 OF 5",
    );
  });

  it("exits from any step back to a closed, rewound tour", () => {
    const store = useTourStore.getState();
    store.setRunning(true);
    store.setBeatIndex(2);
    store.stop();
    expect(useTourStore.getState().running).toBe(false);
    expect(useTourStore.getState().beatIndex).toBe(0);
  });
});
