import { create } from "zustand";

export interface TourBeat {
  id: number;
  panel: "launchpad" | "focus-card" | "order-book" | "task-tree" | "equity-curve" | "nba" | "all";
  badge: string;
  title: string;
  summary: string;
  narrative: string;
}

export const TOUR_BEATS: TourBeat[] = [
  {
    id: 1,
    panel: "launchpad",
    badge: "BEAT 1 · MULTIMODAL INGEST",
    title: "SYLLABUS DECONSTRUCTION & LOCAL SANDBOX",
    summary: "Drop an unformatted paper syllabus photo or digital PDF.",
    narrative: "Meta Llama 3.2 Vision parses grading criteria, guarantees rubric constraints (Σ weights = 100%), and isolates course records client-side.",
  },
  {
    id: 2,
    panel: "focus-card",
    badge: "BEAT 2 · 45-MINUTE ENGINE",
    title: "CONSEQUENTIAL ACTION & CALENDAR SYNC",
    summary: "Packs highest-leverage work into your next 45 minutes.",
    narrative: "Harmonizes with circuit breakers to lock in final course points, protect scholarship floor, and sync RFC 5545 calendar blocks with 24h & 2h alarms.",
  },
  {
    id: 3,
    panel: "all",
    badge: "BEAT 3 · UNDER THE HOOD",
    title: "BLOOMBERG QUANTITATIVE WORKSTATION",
    summary: "The institutional trading engine powering student grades (Key U / Key H).",
    narrative: "1,000-path stochastic Monte Carlo simulation, 90% Value-at-Risk floor, Markowitz Pareto study allocator, and task velocity tracking.",
  },
];

interface TourState {
  running: boolean;
  beatIndex: number;
  setRunning: (running: boolean) => void;
  setBeatIndex: (idx: number) => void;
  nextBeat: () => void;
  prevBeat: () => void;
  stop: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  running: false,
  beatIndex: 0,
  setRunning: (running) => set({ running, beatIndex: running ? get().beatIndex : 0 }),
  setBeatIndex: (beatIndex) => set({ beatIndex: Math.max(0, Math.min(TOUR_BEATS.length - 1, beatIndex)) }),
  nextBeat: () => {
    const { beatIndex } = get();
    if (beatIndex < TOUR_BEATS.length - 1) {
      set({ beatIndex: beatIndex + 1 });
    } else {
      set({ running: false, beatIndex: 0 });
    }
  },
  prevBeat: () => {
    const { beatIndex } = get();
    if (beatIndex > 0) {
      set({ beatIndex: beatIndex - 1 });
    }
  },
  stop: () => set({ running: false, beatIndex: 0 }),
}));
