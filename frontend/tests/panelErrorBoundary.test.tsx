// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const TITLE = "[⚠️ PANEL TELEMETRY RECALCULATING]";

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function retryButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("RETRY"),
  );
  if (!button) throw new Error("RETRY button not rendered");
  return button;
}

async function clickRetry() {
  await act(async () => {
    retryButton().click();
  });
}

/** Throws while `state.broken` is set; renders a marker otherwise. */
function Panel({ state, value = "panel-ok" }: { state: { broken: boolean }; value?: string }) {
  if (state.broken) throw new Error("equity series was NaN");
  return <p data-testid="panel">{value}</p>;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // React reports caught render errors through console.error; keep the run output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe("PanelErrorBoundary", () => {
  it("renders its children untouched when nothing throws", async () => {
    await render(
      <PanelErrorBoundary label="ORDER BOOK">
        <Panel state={{ broken: false }} />
      </PanelErrorBoundary>,
    );

    expect(container.textContent).toContain("panel-ok");
    expect(container.textContent).not.toContain("RECALCULATING");
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders the telemetry fallback with the error detail and a RETRY button when a child throws", async () => {
    await render(
      <PanelErrorBoundary label="ORDER BOOK">
        <Panel state={{ broken: true }} />
      </PanelErrorBoundary>,
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain(TITLE);
    expect(alert?.textContent).toContain("ORDER BOOK");
    expect(alert?.textContent).toContain("equity series was NaN");
    expect(retryButton()).toBeTruthy();
    expect(container.querySelector('[data-testid="panel"]')).toBeNull();
  });

  it("contains the failure so sibling panels keep rendering", async () => {
    await render(
      <>
        <PanelErrorBoundary label="ORDER BOOK">
          <Panel state={{ broken: true }} />
        </PanelErrorBoundary>
        <PanelErrorBoundary label="TASK TREE">
          <Panel state={{ broken: false }} value="tree-ok" />
        </PanelErrorBoundary>
      </>,
    );

    expect(container.textContent).toContain(TITLE);
    expect(container.textContent).toContain("tree-ok");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("recovers on RETRY once the child can render again", async () => {
    const state = { broken: true };
    await render(
      <PanelErrorBoundary label="EQUITY CURVE">
        <Panel state={state} />
      </PanelErrorBoundary>,
    );
    expect(container.textContent).toContain(TITLE);

    state.broken = false;
    await clickRetry();

    expect(container.textContent).toContain("panel-ok");
    expect(container.textContent).not.toContain(TITLE);
    expect(container.querySelector("button")).toBeNull();
  });

  it("stays on the fallback, without crashing, when RETRY fails again", async () => {
    const state = { broken: true };
    await render(
      <PanelErrorBoundary label="TASK TREE">
        <Panel state={state} />
      </PanelErrorBoundary>,
    );

    await clickRetry();

    expect(container.textContent).toContain(TITLE);
    expect(container.textContent).toContain("equity series was NaN");
    expect(retryButton()).toBeTruthy();

    state.broken = false;
    await clickRetry();
    expect(container.textContent).toContain("panel-ok");
  });

  it("shows readable detail when a non-Error value is thrown", async () => {
    function Throws(): never {
      throw "raw string failure";
    }
    await render(
      <PanelErrorBoundary label="NEXT BEST ACTION">
        <Throws />
      </PanelErrorBoundary>,
    );

    expect(container.textContent).toContain(TITLE);
    expect(container.textContent).toContain("raw string failure");
  });
});
