/**
 * Judge-facing trust copy and the demo-tour launch hotkey. The wording lives
 * here so the top bar, the syllabus dialog, and the tour HUD cannot drift apart.
 */

export const FERPA_BADGE = {
  label: "🛡️ FERPA COMPLIANT",
  tooltip:
    "Zero-retention client-side isolation; academic records never persist to public cloud",
} as const;

export const JUDGE_TOUR_BUTTON = {
  label: "🚀 60s JUDGE TOUR",
  hotkey: "D",
  title:
    "Launch the 60-second automated judge tour in one click (Key D). Esc exits.",
} as const;

export const VISION_INGEST = {
  heading: "👁️ META LLAMA 3.2 VISION: MULTIMODAL INGEST",
  modelBadge: "Model: Llama-3.2-11B-Vision-Instruct",
  privacyBadge: "Zero-leakage local document processing",
} as const;

export const TOUR_HUD_TITLE = "60-SECOND META HACKATHON JUDGE TOUR";

/** One-based "STEP n OF total" for a zero-based beat index, clamped into the tour. */
export function tourProgress(beatIndex: number, total: number) {
  const step = Math.min(Math.max(beatIndex, 0), total - 1) + 1;
  return { step, total, label: `STEP ${step} OF ${total}` };
}

/**
 * A bare D launches the tour. Any modifier is left to its own shortcut:
 * Ctrl+Shift+D toggles the simulation desk, Ctrl/Cmd+D is the browser's.
 */
export function isTourHotkey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    event.key.toLowerCase() === JUDGE_TOUR_BUTTON.hotkey.toLowerCase() &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  );
}
