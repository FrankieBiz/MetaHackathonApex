"use client";

import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

export function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex h-full min-h-0 flex-col border border-line bg-panel"
    >
      <header className="panel-drag flex shrink-0 cursor-grab items-center justify-between gap-3 border-b border-line bg-head px-2.5 py-1 active:cursor-grabbing">
        <h2 className="truncate text-[11px] tracking-wider text-accent uppercase">
          {title}
        </h2>
        {actions && (
          <div className="no-drag flex shrink-0 items-center gap-1">
            {actions}
          </div>
        )}
      </header>
      <div className="@container relative min-h-0 flex-1 overflow-auto">
        {children}
      </div>
    </section>
  );
}

type Tone = "default" | "accent" | "up" | "down";

const TONES: Record<Tone, string> = {
  default: "text-ink-2 hover:text-ink hover:border-ink-3",
  accent: "text-accent border-accent/60 hover:bg-accent hover:text-canvas",
  up: "text-up border-up/50 hover:bg-up hover:text-canvas",
  down: "text-down border-down/60 hover:bg-down hover:text-canvas",
};

/** Bracketed terminal key: renders `[LABEL]`. */
export function Key({
  tone = "default",
  active = false,
  size = "sm",
  caps = true,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone;
  active?: boolean;
  size?: "sm" | "lg";
  /** Uppercase the label; off for unit labels like `+15m`. */
  caps?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex shrink-0 items-center border whitespace-nowrap transition-colors duration-100 ${caps ? "uppercase" : ""} ${
        size === "lg"
          ? "h-8 px-4 text-[12px] tracking-wider"
          : "h-[22px] px-1.5 text-[11px]"
      } disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-accent bg-accent/15 text-accent"
          : `border-line-strong ${TONES[tone]}`
      } ${className}`}
    >
      <span aria-hidden>[</span>
      {children}
      <span aria-hidden>]</span>
    </button>
  );
}

/** Returns focus to whatever opened the dialog once it closes. */
export function useRestoreFocus() {
  // Read on first render: by the time effects run, the dialog's autoFocus field has focus.
  const [opener] = useState(() =>
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null),
  );
  useEffect(
    () => () => {
      // Only when focus fell to the page with the dialog, so it is never taken from
      // whatever claimed it next (or from the dialog itself in a Strict Mode re-run).
      if (!document.activeElement || document.activeElement === document.body)
        opener?.focus();
    },
    [opener],
  );
}

/** Escape closes the dialog wherever focus is, even after a click on its plain text. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % FRAMES.length),
      80,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <span aria-hidden className="inline-block w-[1ch]">
      {FRAMES[frame]}
    </span>
  );
}

/** Horizontal meter. `marker` draws a reference tick (e.g. 100% budget). */
export function Meter({
  value,
  max,
  color,
  marker,
  label,
}: {
  value: number;
  max: number;
  color: string;
  marker?: number;
  label: string;
}) {
  const fill = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      className="relative h-1.5 w-full bg-line"
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{ width: `${fill * 100}%`, background: color }}
      />
      {marker !== undefined && (
        <div
          className="absolute -inset-y-1 w-px bg-ink-2"
          style={{ left: `${Math.min(1, marker / max) * 100}%` }}
        />
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`-ml-px h-[22px] border px-1.5 text-[10px] tracking-wider uppercase first:ml-0 ${
            value === option.value
              ? "relative z-10 border-accent bg-accent/15 text-accent"
              : "border-line-strong text-ink-3 hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const STATUS_COLOR = {
  up: "var(--color-up)",
  down: "var(--color-down)",
  accent: "var(--color-accent)",
  neutral: "var(--color-ink-3)",
} as const;
