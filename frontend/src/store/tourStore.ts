import { create } from "zustand";

export interface TourBeat {
  id: number;
  panel: "order-book" | "task-tree" | "equity-curve" | "nba" | "all";
  badge: string;
  title: string;
  summary: string;
  narrative: string;
}

export const TOUR_BEATS: TourBeat[] = [
  {
    id: 1,
    panel: "order-book",
    badge: "ACT 1 · THE CRISIS",
    title: "COURSE GRADE DRAWDOWN & MARGIN CALL",
    summary: "CS 3801 Distributed Systems is at 88.0% against a 90.0% target floor.",
    narrative: "Margin Call audit flags an active deficit. Student risks losing the honors bracket without immediate triage.",
  },
  {
    id: 2,
    panel: "task-tree",
    badge: "ACT 2 · META LLAMA TRIAGE",
    title: "AGENTIC RUBRIC DECONSTRUCTION",
    summary: "Multi-agent defense council breaks down Raft lab into 25-min Pomodoro tasks.",
    narrative: "Live SSE streams tool calls, audits grading weights (test harness 60%, design doc 30%), and builds execution tree.",
  },
  {
    id: 3,
    panel: "task-tree",
    badge: "ACT 3 · ATOMIC EXECUTION",
    title: "TASK FILL & COMPLETION VELOCITY",
    summary: "Completing leaf tasks updates real-time completion velocity and recomputes grade floor.",
    narrative: "Actual study minutes are logged to persistent storage. Velocity auditor dynamically rescales remaining work.",
  },
  {
    id: 4,
    panel: "equity-curve",
    badge: "ACT 4 · RISK MODELING",
    title: "1,000-PATH MONTE CARLO & 90% VAR",
    summary: "What-If simulation perturbs exam scores to model downside volatility.",
    narrative: "90% Value-at-Risk calculates the worst-case semester GPA outcome, quantifying grade buffer margin.",
  },
  {
    id: 5,
    panel: "all",
    badge: "ACT 5 · PARETO ALLOCATION",
    title: "MARKOWITZ EFFICIENT FRONTIER & CALENDAR",
    summary: "Convex Pareto optimizer allocates weekly hours for maximum GPA yield.",
    narrative: "Exports live RFC 5545 calendar stream with 24h & 2h focus alarms directly to Google & Apple Calendar.",
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
