import type { Layout, ResponsiveLayouts } from "react-grid-layout";

export const PANELS = ["orderbook", "tasktree", "equity", "velocity"] as const;
export type PanelId = (typeof PANELS)[number];

export const BREAKPOINTS = { lg: 1200, md: 760, sm: 0 } as const;
export const COLS = { lg: 12, md: 12, sm: 1 } as const;
type Breakpoint = keyof typeof BREAKPOINTS;

/** Rows in the fit-to-screen layouts; row height is derived from the viewport. */
export const FIT_ROWS = 24;

const constraints = { minW: 3, minH: 6 };

export const DEFAULT_LAYOUTS: ResponsiveLayouts<Breakpoint> = {
  // Operations on the left (queue above the deck it feeds), analytics on the right.
  lg: [
    { i: "orderbook", x: 0, y: 0, w: 7, h: 12, ...constraints },
    { i: "tasktree", x: 0, y: 12, w: 7, h: 12, ...constraints },
    { i: "equity", x: 7, y: 0, w: 5, h: 13, ...constraints },
    { i: "velocity", x: 7, y: 13, w: 5, h: 11, ...constraints },
  ],
  md: [
    { i: "orderbook", x: 0, y: 0, w: 6, h: 12, ...constraints },
    { i: "tasktree", x: 0, y: 12, w: 6, h: 12, ...constraints },
    { i: "equity", x: 6, y: 0, w: 6, h: 12, ...constraints },
    { i: "velocity", x: 6, y: 12, w: 6, h: 12, ...constraints },
  ],
  sm: [
    { i: "orderbook", x: 0, y: 0, w: 1, h: 14 },
    { i: "tasktree", x: 0, y: 14, w: 1, h: 14 },
    { i: "equity", x: 0, y: 28, w: 1, h: 18 },
    { i: "velocity", x: 0, y: 46, w: 1, h: 16 },
  ],
};

const STORAGE_KEY = "apex-terminal:layout:v1";

const complete = (layout: unknown): layout is Layout =>
  Array.isArray(layout) &&
  PANELS.every((id) =>
    layout.some(
      (item) =>
        item &&
        item.i === id &&
        [item.x, item.y, item.w, item.h].every(
          (n) => Number.isFinite(n) && n >= 0,
        ),
    ),
  );

export function loadLayouts(): ResponsiveLayouts<Breakpoint> {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!saved || typeof saved !== "object") return DEFAULT_LAYOUTS;
    const merged = { ...DEFAULT_LAYOUTS };
    for (const bp of Object.keys(BREAKPOINTS) as Breakpoint[]) {
      if (complete(saved[bp])) merged[bp] = saved[bp];
    }
    return merged;
  } catch {
    return DEFAULT_LAYOUTS;
  }
}

export function saveLayouts(layouts: ResponsiveLayouts<Breakpoint>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // Layout persistence is a convenience; ignore storage failures.
  }
}

export function clearLayouts() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as above.
  }
}
