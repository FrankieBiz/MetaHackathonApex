"use client";

// Defense Council sessions and the execution deck's active tab. Session-only:
// deliberations are advice, never persisted into task or grade data.

import { create } from "zustand";
import { api, type CouncilRun } from "@/lib/api";
import { isRemote, useTerminal } from "@/store/terminal";

export type DeckTab = "breakdown" | "council";

interface CouncilStore {
  tab: DeckTab;
  setTab: (tab: DeckTab) => void;
  /** The latest session per assignment. */
  runs: Record<string, CouncilRun>;
  /** Assignment id → when its session opened (ms epoch). */
  convening: Record<string, number>;
  convene: (assignmentId: string) => Promise<void>;
}

export const useCouncil = create<CouncilStore>()((set, get) => ({
  tab: "breakdown",
  setTab: (tab) => set({ tab }),
  runs: {},
  convening: {},

  convene: async (assignmentId) => {
    const { data, mode, simulationPinned } = useTerminal.getState();
    if (!data || get().convening[assignmentId]) return;
    if (!data.assignments.some((a) => a.id === assignmentId)) return;
    const started = Date.now();
    set((s) => ({ convening: { ...s.convening, [assignmentId]: started } }));
    try {
      const run = await api.defenseCouncil(assignmentId, data, {
        offline: !isRemote(mode) || simulationPinned,
      });
      set((s) => ({ runs: { ...s.runs, [assignmentId]: run } }));
    } finally {
      set((s) => {
        const rest = { ...s.convening };
        delete rest[assignmentId];
        return { convening: rest };
      });
    }
  },
}));
