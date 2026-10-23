"use client";

import { Component, type ReactNode } from "react";
import { Key } from "@/components/ui";

type Props = {
  /** Panel name shown in the fallback, e.g. `ORDER BOOK`. */
  label: string;
  children: ReactNode;
};

type State = { error: Error | null };

const toError = (thrown: unknown): Error =>
  thrown instanceof Error ? thrown : new Error(String(thrown));

/**
 * Contains render errors to a single panel so the rest of the terminal keeps running.
 * Error boundaries have no hook equivalent, hence the class.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(thrown: unknown): State {
    return { error: toError(thrown) };
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <section
        role="alert"
        aria-label={`${this.props.label} unavailable`}
        className="flex h-full min-h-24 flex-col border border-down/50 bg-panel"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-head px-2.5 py-1">
          <h2 className="truncate text-[11px] tracking-wider text-accent uppercase">
            {this.props.label}
          </h2>
        </header>
        <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-2 overflow-auto p-3">
          <p className="text-[12px] font-bold tracking-wider text-down">
            [⚠️ PANEL TELEMETRY RECALCULATING]
          </p>
          <p className="font-mono text-[11px] break-words text-ink-3">
            {error.message || error.name}
          </p>
          <Key tone="accent" onClick={this.retry}>
            RETRY
          </Key>
        </div>
      </section>
    );
  }
}
