import { beforeEach, describe, expect, it } from "vitest";
import DEFAULT_VISION_INGEST, {
  JUDGE_TOUR_BUTTON,
  SANDBOX_BADGE,
  TOUR_HUD_TITLE,
  VISION_INGEST,
  getVisionIngestCopy,
  isTourHotkey,
  tourProgress,
} from "@/lib/judgeTrust";
import * as judgeTrust from "@/lib/judgeTrust";
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
  it("labels the sandbox badge and states only what the client does", () => {
    expect(SANDBOX_BADGE.label).toBe("🛡️ LOCAL SANDBOX ISOLATION");
    expect(SANDBOX_BADGE.tooltip).toBe(
      "Client-side ephemeral execution; course records remain local without public cloud logging",
    );
  });

  it("no longer exports the unbacked FERPA compliance claim", () => {
    expect("FERPA_BADGE" in judgeTrust).toBe(false);
  });

  it("labels the one-click tour launcher and advertises its hotkey", () => {
    expect(JUDGE_TOUR_BUTTON.label).toBe("🚀 60s JUDGE TOUR");
    expect(JUDGE_TOUR_BUTTON.hotkey).toBe("D");
    expect(JUDGE_TOUR_BUTTON.title).toContain("Key D");
  });

  it("keeps the multimodal ingest heading", () => {
    expect(VISION_INGEST.heading).toBe(
      "👁️ META LLAMA 3.2 VISION: MULTIMODAL INGEST",
    );
  });

  it("describes document handling as the configured endpoint, not local-only", () => {
    expect(VISION_INGEST.privacyBadge).toBe(
      "Processed via configured Meta Model API endpoint",
    );
    expect(VISION_INGEST.privacyBadge).not.toMatch(/zero-leakage|local/i);
  });

  it("never names a model the app does not know it is running", () => {
    expect(VISION_INGEST.modelBadge).toBe("Model: Configured Meta Provider");
    expect(VISION_INGEST.modelBadge).not.toContain("11B");
  });

  it("exports the static fallback as the default and as VISION_INGEST", () => {
    expect(DEFAULT_VISION_INGEST).toBe(VISION_INGEST);
    expect(VISION_INGEST).toEqual(getVisionIngestCopy());
  });

  it("is overridden by the served model name", () => {
    const copy = getVisionIngestCopy("LLAMA-3.3-70B");
    expect(copy.modelBadge).toBe("Model: LLAMA-3.3-70B");
    expect(copy.heading).toBe(VISION_INGEST.heading);
    expect(copy.privacyBadge).toBe(VISION_INGEST.privacyBadge);
  });

  it.each([undefined, null, "", "   "])(
    "falls back to the configured provider for %j",
    (name) => {
      expect(getVisionIngestCopy(name).modelBadge).toBe(
        "Model: Configured Meta Provider",
      );
    },
  );

  it("trims padding around a served model name", () => {
    expect(getVisionIngestCopy("  muse-spark-1.3 ").modelBadge).toBe(
      "Model: muse-spark-1.3",
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
    store.setBeatIndex(1);
    expect(useTourStore.getState().beatIndex).toBe(1);
    expect(tourProgress(useTourStore.getState().beatIndex, TOUR_BEATS.length).label).toBe(
      "STEP 2 OF 3",
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
