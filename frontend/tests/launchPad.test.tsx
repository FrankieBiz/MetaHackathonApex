// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LaunchPad } from "@/components/LaunchPad";
import { useTerminal } from "@/store/terminal";
import { buildSampleState } from "@/lib/sampleSyllabus";

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

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("open", vi.fn());
  if (typeof window !== "undefined") {
    window.URL.createObjectURL = vi.fn(() => "blob:fake-url");
    window.URL.revokeObjectURL = vi.fn();
  }
  useTerminal.setState({
    data: buildSampleState(),
    studentMode: false,
  });
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

describe("LaunchPad", () => {
  it("renders header with launchpad title and workstation toggle button", async () => {
    const handleOpenWorkstation = vi.fn();
    await render(<LaunchPad onOpenWorkstation={handleOpenWorkstation} />);

    expect(container.textContent).toContain("APEX LAUNCHPAD");
    expect(container.textContent).toContain("UNDER THE HOOD: FULL TERMINAL");

    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("UNDER THE HOOD")
    );
    expect(btn).toBeDefined();

    await act(async () => {
      btn?.click();
    });
    expect(handleOpenWorkstation).toHaveBeenCalledTimes(1);
  });

  it("renders syllabus drop zone with Meta Llama badge and file input", async () => {
    await render(<LaunchPad onOpenWorkstation={vi.fn()} />);

    expect(container.textContent).toContain("DROP SYLLABUS");
    expect(container.textContent).toContain("POWERED BY META LLAMA 3.2 VISION");
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
  });

  it("renders sample syllabus demo loader and loads sample data on click", async () => {
    useTerminal.setState({ data: null });
    await render(<LaunchPad onOpenWorkstation={vi.fn()} />);

    const sampleBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("SAMPLE SYLLABUS DEMO")
    );
    expect(sampleBtn).toBeDefined();

    await act(async () => {
      sampleBtn?.click();
    });
    expect(useTerminal.getState().data?.courses[0].course_code).toBe("CS-101");
  });

  it("renders FocusBlockCard and priority rail when portfolio data is present", async () => {
    await render(<LaunchPad onOpenWorkstation={vi.fn()} />);

    expect(container.querySelector('[data-testid="focus-block-card"]')).not.toBeNull();
    expect(container.textContent).toContain("Priority Execution Rail");
    expect(container.textContent).toContain("CS-101");
  });

  it("renders clear state when all deliverables are done", async () => {
    const sample = buildSampleState();
    sample.assignments.forEach((a) => {
      a.status = "completed";
      a.subtasks.forEach((t) => {
        t.is_completed = true;
      });
    });
    useTerminal.setState({ data: sample });

    await render(<LaunchPad onOpenWorkstation={vi.fn()} />);
    expect(container.textContent).toContain("ALL DELIVERABLES EXECUTED");
  });

  it("triggers 30s audio briefing when audio button is clicked", async () => {
    await render(<LaunchPad onOpenWorkstation={vi.fn()} />);
    const audioBtn = container.querySelector('[data-testid="audio-briefing-button"]') as HTMLButtonElement | null;
    expect(audioBtn).not.toBeNull();
    expect(audioBtn?.textContent).toContain("30s AUDIO BRIEFING");

    await act(async () => {
      audioBtn?.click();
    });

    const { useMorningBell } = await import("@/components/MorningBell");
    expect(useMorningBell.getState().open).toBe(true);
  });

  it("toggles visual extraction audit receipt drawer with category weights verified", async () => {
    await render(<LaunchPad onOpenWorkstation={vi.fn()} />);
    const drawer = container.querySelector('[data-testid="extraction-audit-drawer"]');
    expect(drawer).not.toBeNull();
    expect(drawer?.textContent).toContain("SYLLABUS EXTRACTION AUDIT RECEIPT");

    // Drawer is closed by default
    expect(drawer?.textContent).not.toContain("CS-101 · Introduction to Computer Science");

    // Toggle open
    const toggleBtn = container.querySelector('[data-testid="toggle-audit-receipt"]') as HTMLButtonElement | null;
    expect(toggleBtn).not.toBeNull();

    await act(async () => {
      toggleBtn?.click();
    });

    expect(drawer?.textContent).toContain("CS-101 · Introduction to Computer Science");
    expect(drawer?.textContent).toContain("Σ 100.0% ✓ VERIFIED");
    expect(drawer?.textContent).toContain("Binary Trees Lab");
    expect(drawer?.textContent).toContain("Syllabus Source Excerpt");

    // Toggle close
    await act(async () => {
      toggleBtn?.click();
    });
    expect(drawer?.textContent).not.toContain("CS-101 · Introduction to Computer Science");
  });

  it("displays portfolio course balance and congestion status on priority rail", async () => {
    await render(<LaunchPad onOpenWorkstation={vi.fn()} />);
    const badge = container.querySelector('[data-testid="congestion-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("BALANCED ACROSS 1 COURSES · 0 CONGESTION PILE-UPS");
  });
});
