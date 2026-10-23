/**
 * Judge-facing trust copy and the demo-tour launch hotkey. The wording lives
 * here so the top bar, the syllabus dialog, and the tour HUD cannot drift apart.
 */

export const SANDBOX_BADGE = {
  label: "🛡️ LOCAL SANDBOX ISOLATION",
  tooltip:
    "Client-side ephemeral execution; course records remain local without public cloud logging",
} as const;

export const JUDGE_TOUR_BUTTON = {
  label: "🚀 60s JUDGE TOUR",
  hotkey: "D",
  title:
    "Launch the 60-second automated judge tour in one click (Key D). Esc exits.",
} as const;

const UNNAMED_MODEL = "Configured Meta Provider";

/**
 * Ingest dialog copy. The model badge names the model the app was told it is
 * running; with none known it says so instead of guessing one.
 */
export function getVisionIngestCopy(modelName?: string | null) {
  return {
    heading: "👁️ META LLAMA 3.2 VISION: MULTIMODAL INGEST",
    modelBadge: `Model: ${modelName?.trim() || UNNAMED_MODEL}`,
    privacyBadge: "Processed via configured Meta Model API endpoint",
  };
}

/** Static fallback for callers that have no served model name. */
export const VISION_INGEST = getVisionIngestCopy();
export default VISION_INGEST;

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
