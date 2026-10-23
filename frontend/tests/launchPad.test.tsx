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
});
