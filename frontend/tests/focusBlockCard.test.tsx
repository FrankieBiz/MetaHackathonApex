// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusBlockCard } from "@/components/FocusBlockCard";
import type { FocusBlock } from "@/lib/focusBlock";
import { useTerminal } from "@/store/terminal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

const mockFocusBlock: FocusBlock = {
  assignment_id: "asg-1",
  course_id: "crs-1",
  course_code: "CS 3801",
  assignment_title: "Raft Consensus Implementation",
  due_at: "2026-11-01T23:59:00Z",
  break_even_score: 75.0,
  points_locked_in: 1.88,
  downside_floor: 82.5,
  total_minutes: 45,
  tasks: [
    {
      id: "t-1",
      title: "Write log replication invariant unit test",
      estimated_minutes: 25,
      is_completed: false,
    },
    {
      id: "t-2",
      title: "Pass test harness for leader election failure",
      estimated_minutes: 20,
      is_completed: false,
    },
  ],
  policy_reason: "BREAKER L1 · PROTECTING CS 3801",
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("open", vi.fn());
  if (typeof window !== "undefined") {
    window.URL.createObjectURL = vi.fn(() => "blob:fake-url");
    window.URL.revokeObjectURL = vi.fn();
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("FocusBlockCard", () => {
  it("renders course code, deliverable title, and policy reason badge", async () => {
    await render(<FocusBlockCard focusBlock={mockFocusBlock} />);
    expect(container.textContent).toContain("CS 3801");
    expect(container.textContent).toContain("Raft Consensus Implementation");
    expect(container.textContent).toContain("BREAKER L1 · PROTECTING CS 3801");
    expect(container.textContent).toContain("NEXT 45 MINUTES");
  });

  it("renders the 3 consequential figures", async () => {
    await render(<FocusBlockCard focusBlock={mockFocusBlock} />);
    expect(container.textContent).toContain("75.0%");
    expect(container.textContent).toContain("+1.9");
    expect(container.textContent).toContain("≥82.5%");
  });

  it("renders the 45-minute subtask list with estimates", async () => {
    await render(<FocusBlockCard focusBlock={mockFocusBlock} />);
    expect(container.textContent).toContain("Write log replication invariant unit test");
    expect(container.textContent).toContain("25m");
    expect(container.textContent).toContain("Pass test harness for leader election failure");
    expect(container.textContent).toContain("20m");
  });

  it("calls onToggleTask when checkbox is clicked", async () => {
    const handleToggle = vi.fn();
    await render(<FocusBlockCard focusBlock={mockFocusBlock} onToggleTask={handleToggle} />);
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);

    await act(async () => {
      checkboxes[0].click();
    });
    expect(handleToggle).toHaveBeenCalledWith("t-1");
  });

  it("triggers calendar export on button click", async () => {
    const handleCalendar = vi.fn();
    vi.stubGlobal("open", vi.fn());
    await render(<FocusBlockCard focusBlock={mockFocusBlock} onAddToCalendar={handleCalendar} />);

    const calBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("ADD 45-MIN BLOCK TO CALENDAR")
    );
    expect(calBtn).toBeDefined();

    await act(async () => {
      calBtn?.click();
    });
    expect(handleCalendar).toHaveBeenCalled();
    expect(container.textContent).toContain("ADDED TO CALENDAR");
  });

  it("switches subtitle labels when studentMode is active", async () => {
    await act(async () => {
      useTerminal.setState({ studentMode: true });
    });
    await render(<FocusBlockCard focusBlock={mockFocusBlock} />);
    expect(container.textContent).toContain("Target Score Needed");
    expect(container.textContent).toContain("GPA Points Earned");
    expect(container.textContent).toContain("Grade Floor Protected");

    await act(async () => {
      useTerminal.setState({ studentMode: false });
    });
    await render(<FocusBlockCard focusBlock={mockFocusBlock} />);
    expect(container.textContent).toContain("Break-Even Score");
    expect(container.textContent).toContain("Grade Points Locked In");
    expect(container.textContent).toContain("Downside Floor (VaR)");
  });
});
