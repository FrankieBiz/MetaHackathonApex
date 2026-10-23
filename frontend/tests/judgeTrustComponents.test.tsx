// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisionIngestHeader } from "@/components/SyllabusIngestModal";
import { SandboxBadge } from "@/components/TopBar";
import { SANDBOX_BADGE, VISION_INGEST } from "@/lib/judgeTrust";
import { useInference } from "@/store/inference";

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

const modelBadge = () =>
  Array.from(container.querySelectorAll("li")).find((li) =>
    li.textContent?.startsWith("Model:"),
  )?.textContent;

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  useInference.setState({
    configuration: null,
    telemetry: null,
    status: "ready",
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

describe("SandboxBadge", () => {
  it("shows the sandbox label and states the isolation model in its tooltip", async () => {
    await render(<SandboxBadge />);
    const badge = container.querySelector('[role="note"]');
    expect(badge?.textContent).toContain(SANDBOX_BADGE.label);
    expect(badge?.getAttribute("title")).toBe(SANDBOX_BADGE.tooltip);
    expect(badge?.getAttribute("aria-label")).toBe(
      `${SANDBOX_BADGE.label}. ${SANDBOX_BADGE.tooltip}`,
    );
    expect(container.textContent).not.toMatch(/FERPA/i);
  });
});

describe("VisionIngestHeader", () => {
  it("names no model until the engine or a run has reported one", async () => {
    await render(<VisionIngestHeader />);
    expect(modelBadge()).toBe("Model: Configured Meta Provider");
    expect(container.textContent).toContain(VISION_INGEST.heading);
    expect(container.textContent).toContain(VISION_INGEST.privacyBadge);
  });

  it("shows the served model once the engine endpoint answers", async () => {
    await render(<VisionIngestHeader />);
    await act(async () => {
      useInference.getState().configure({
        provider: "meta",
        model: "meta-llama/Llama-3.3-70B-Instruct",
      });
    });
    expect(modelBadge()).toBe("Model: LLAMA-3.3-70B");
  });

  it("prefers the model a run measured over the configured one", async () => {
    useInference
      .getState()
      .configure({ provider: "meta", model: "muse-spark-1.3" });
    await render(<VisionIngestHeader />);
    await act(async () => {
      useInference.getState().finish(
        {
          model_used: "llama3",
          latency_ms: 120,
          prompt_tokens: 10,
          completion_tokens: 20,
          tokens_per_sec: 40,
        },
        "ai",
      );
    });
    expect(modelBadge()).toBe("Model: LLAMA3");
  });
});
