"use client";

import { useEffect, useId, useState } from "react";
import { create } from "zustand";
import { Key, Spinner, useEscape, useRestoreFocus } from "@/components/ui";
import { api, type MarginCallRun } from "@/lib/api";
import { clock, shortDate, signed } from "@/lib/format";
import {
  normalizePhone,
  whatsappShareUrl,
  type MarginCallReport,
} from "@/lib/marginCall";
import { stanceLabel } from "@/lib/portfolioReport";
import { isRemote, useTerminal } from "@/store/terminal";

/** Opened from the top bar, the command palette, and the M hotkey. */
export const useMarginCall = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

export function MarginCallModal() {
  const open = useMarginCall((s) => s.open);
  const setOpen = useMarginCall((s) => s.setOpen);
  if (!open) return null;
  return <MarginCallDialog onClose={() => setOpen(false)} />;
}

/** WhatsApp's dark theme, so the preview reads as the message the student will see. */
const WA = {
  chat: "#0b141a",
  head: "#202c33",
  bubble: "#005c4b",
  text: "#e9edef",
  meta: "#8696a0",
  read: "#53bdeb",
} as const;

type Copied = "message" | "json" | "blocked" | null;

function Metric({
  label,
  value,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[10px] tracking-wider text-ink-3 uppercase">
        {label}
      </dt>
      <dd className={`text-[13px] tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

function Book({ report }: { report: MarginCallReport }) {
  const [first, ...rest] = report.restoration_order;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <dl className="flex flex-col gap-1">
        <Metric
          label="Liquidation deficit"
          value={`${report.liquidation_deficit.toFixed(2)} PTS`}
          tone={report.liquidation_deficit > 0 ? "text-down" : "text-up"}
        />
        <Metric
          label="Breached courses"
          value={String(report.breached_courses.length)}
          tone={report.breached_courses.length ? "text-down" : "text-ink"}
        />
        <Metric label="Stance" value={stanceLabel(report.academic_stance)} />
      </dl>

      <section aria-labelledby="mc-breaches">
        <h3
          id="mc-breaches"
          className="bg-head px-2 py-0.5 text-[10px] tracking-wider text-ink-3 uppercase"
        >
          Breached courses
        </h3>
        {report.breached_courses.length ? (
          <table className="w-full text-[11px]">
            <thead className="text-[10px] tracking-wider text-ink-3 uppercase">
              <tr className="border-b border-line">
                <th className="px-2 py-0.5 text-left font-normal">Course</th>
                <th className="px-2 py-0.5 text-right font-normal">Now</th>
                <th className="px-2 py-0.5 text-right font-normal">Target</th>
                <th className="px-2 py-0.5 text-right font-normal">Gap</th>
              </tr>
            </thead>
            <tbody>
              {report.breached_courses.map((c) => (
                <tr
                  key={c.course_id}
                  className="border-b border-line/70 last:border-b-0"
                >
                  <td className="px-2 py-0.5 text-ink">{c.course_code}</td>
                  <td className="px-2 py-0.5 text-right text-ink-2 tabular-nums">
                    {c.current_score.toFixed(1)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-ink-2 tabular-nums">
                    {c.target_score.toFixed(1)}
                  </td>
                  <td className="px-2 py-0.5 text-right text-down tabular-nums">
                    {signed(-c.deficit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-2 py-2 text-[11px] text-ink-3">
            Every graded course is at or above target.
          </p>
        )}
      </section>

      <section aria-labelledby="mc-restore">
        <h3
          id="mc-restore"
          className="bg-head px-2 py-0.5 text-[10px] tracking-wider text-ink-3 uppercase"
        >
          Restoration order
        </h3>
        {first ? (
          <ol className="text-[11px]">
            {[first, ...rest.slice(0, 4)].map((action, index) => (
              <li
                key={action.assignment_id}
                className={`flex flex-col gap-0.5 border-b border-line/70 px-2 py-1 last:border-b-0 ${index === 0 ? "bg-accent/5" : ""}`}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className={`shrink-0 tabular-nums ${index === 0 ? "text-accent" : "text-ink-3"}`}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 truncate text-ink" title={action.title}>
                    {action.title}
                  </span>
                  {index === 0 && (
                    <span className="shrink-0 border border-accent/60 px-1 text-[9px] tracking-wider text-accent">
                      RESTORE FIRST
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 pl-4 text-[10px] tracking-wider text-ink-3 uppercase">
                  <span>
                    Needs{" "}
                    <span
                      className={
                        action.required_score === null
                          ? "text-ink-2"
                          : action.required_score > 100
                            ? "text-down"
                            : "text-ink"
                      }
                    >
                      {action.required_score === null
                        ? "—"
                        : `${action.required_score.toFixed(1)}%`}
                    </span>
                  </span>
                  <span>
                    Leverage{" "}
                    <span className="text-ink">
                      {action.marginal_impact.toFixed(3)}
                    </span>
                  </span>
                  <span>
                    {action.due_at ? `Due ${shortDate(action.due_at)}` : "No due date"}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-2 py-2 text-[11px] text-ink-3">
            {report.triggered
              ? "No open weighted work can restore the target."
              : "No call raised · nothing to restore."}
          </p>
        )}
      </section>
    </div>
  );
}

/** The drafted alert as it would land in WhatsApp; nothing is sent from here. */
function WhatsAppPreview({ body, at }: { body: string | null; at: Date }) {
  return (
    <figure
      aria-label="WhatsApp message preview"
      className="flex min-h-[260px] flex-col overflow-hidden border border-line-strong"
      style={{ background: WA.chat }}
    >
      <figcaption
        className="flex items-center gap-2 px-2.5 py-1.5"
        style={{ background: WA.head, color: WA.text }}
      >
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-canvas"
        >
          A
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px]">Apex Margin Desk</span>
          <span className="block text-[10px]" style={{ color: WA.meta }}>
            preview · not sent
          </span>
        </span>
      </figcaption>
      <div className="flex flex-1 flex-col justify-end gap-2 p-2.5">
        <span
          className="self-center rounded px-2 py-0.5 text-[10px]"
          style={{ background: WA.head, color: WA.meta }}
        >
          TODAY
        </span>
        {body ? (
          <div
            className="relative max-w-[92%] self-end rounded-md rounded-tr-none px-2 pt-1 pb-4 text-[12px] leading-snug whitespace-pre-wrap break-words shadow-sm"
            style={{
              background: WA.bubble,
              color: WA.text,
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
            }}
          >
            {body}
            <span
              className="absolute right-1.5 bottom-0.5 text-[10px]"
              style={{ color: WA.meta }}
            >
              {clock(at).slice(0, 5)}{" "}
              <span aria-label="read" style={{ color: WA.read }}>
                ✓✓
              </span>
            </span>
          </div>
        ) : (
          <p
            className="self-center rounded px-2 py-1 text-center text-[11px]"
            style={{ background: WA.head, color: WA.meta }}
          >
            No alert drafted · the book is inside its margin.
          </p>
        )}
      </div>
    </figure>
  );
}

function MarginCallDialog({ onClose }: { onClose: () => void }) {
  useRestoreFocus();
  useEscape(onClose);
  const phoneId = useId();
  const hasData = useTerminal((s) => s.data !== null);
  const studentMode = useTerminal((s) => s.studentMode);
  const [nonce, setNonce] = useState(0);
  const [run, setRun] = useState<{
    nonce: number;
    run: MarginCallRun;
    at: Date;
  } | null>(null);
  const [copied, setCopied] = useState<Copied>(null);
  const [phone, setPhone] = useState("");

  // A margin call is a snapshot of the book when it was requested; REFRESH takes a new one.
  useEffect(() => {
    const { data, mode, simulationPinned } = useTerminal.getState();
    if (!data) return;
    let active = true;
    void api
      .marginCall(data, { offline: !isRemote(mode) || simulationPinned })
      .then((next) => {
        if (active) setRun({ nonce, run: next, at: new Date() });
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const pending = hasData && run?.nonce !== nonce;
  const report = run?.run.report ?? null;
  const payload = report?.webhook_payload ?? null;
  const body = payload?.text.body ?? null;
  const validPhone = phone.trim() === "" || normalizePhone(phone) !== null;

  const copy = async (text: string, kind: "message" | "json") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setCopied("blocked");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 px-4 pt-[6vh] pb-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="margin-call-title"
        aria-busy={pending}
        // Keep the workstation's single-key hotkeys (J/K/T/M/R) out of the dialog; Escape still closes.
        onKeyDown={(event) => event.key !== "Escape" && event.stopPropagation()}
        className="w-full max-w-[860px] border border-line-strong bg-panel shadow-2xl shadow-black"
      >
        <h2
          id="margin-call-title"
          className="flex items-center justify-between border-b border-line bg-head px-2.5 py-1 text-[11px] tracking-wider text-accent uppercase"
        >
          <span>
            {studentMode
              ? "ACADEMIC INTERVENTION // GRADE FLOOR AUDIT"
              : "MARGIN CALL // LIQUIDATION DESK"}
          </span>
          <span className="text-ink-3">ESC</span>
        </h2>
        {studentMode && (
          <div className="border-b border-line bg-accent/5 px-3 py-1.5 text-[11px] text-accent">
            Academic Intervention Mode: Grade floor audit flags course scores falling below targets, sequencing recovery study blocks to protect your GPA.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
          {report && (
            <span
              className={`border px-1.5 py-0.5 text-[11px] tracking-wider ${
                report.triggered
                  ? "border-down/60 bg-down/10 text-down"
                  : "border-up/60 bg-up/10 text-up"
              }`}
            >
              {report.triggered
                ? "● MARGIN CALL TRIGGERED"
                : "○ NO CALL · WITHIN TOLERANCE"}
            </span>
          )}
          <span
            role="status"
            className="ml-auto flex items-center gap-1.5 text-[10px] tracking-wider text-ink-3 uppercase"
            title={run?.run.source === "local" ? run.run.cause.message : undefined}
          >
            {pending ? (
              <>
                <Spinner /> MARKING THE BOOK
              </>
            ) : (
              run && (
                <span
                  className={run.run.source === "backend" ? "text-up" : "text-accent"}
                >
                  ● {run.run.source === "backend" ? "BACKEND" : "LOCAL ENGINE"}
                </span>
              )
            )}
          </span>
        </div>

        {!hasData ? (
          <p className="px-3 py-6 text-center text-[11px] text-ink-3">
            NO COURSE BOOK LOADED · sync Canvas or load a sample syllabus first
          </p>
        ) : !report || !run ? (
          <p className="flex items-center justify-center gap-2 px-3 py-10 text-[11px] text-accent">
            <Spinner /> MARKING THE BOOK TO TARGET
          </p>
        ) : (
          <div className="grid max-h-[68vh] grid-cols-1 gap-4 overflow-auto px-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
            <Book report={report} />
            <div className="flex min-w-0 flex-col gap-2">
              <WhatsAppPreview body={body} at={run.at} />
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={phoneId}
                  className="text-[10px] tracking-wider text-ink-3 uppercase"
                >
                  Send to (optional, with country code)
                </label>
                <input
                  id={phoneId}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+1 555 010 2030"
                  aria-invalid={!validPhone}
                  className={`h-[24px] border bg-canvas px-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3/60 focus-visible:border-accent ${
                    validPhone ? "border-line-strong" : "border-down"
                  }`}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Key
                  tone="up"
                  disabled={!body || !validPhone}
                  onClick={() =>
                    body &&
                    window.open(
                      whatsappShareUrl(body, phone),
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                  title="Opens WhatsApp with this draft; you press send"
                >
                  OPEN IN WHATSAPP
                </Key>
                <Key
                  disabled={!body}
                  onClick={() => body && void copy(body, "message")}
                >
                  COPY MESSAGE
                </Key>
                <Key
                  disabled={!payload}
                  onClick={() =>
                    payload && void copy(JSON.stringify(payload, null, 2), "json")
                  }
                  title="WhatsApp Cloud API text message body, for a messaging webhook"
                >
                  COPY JSON
                </Key>
              </div>
              {payload && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-[10px] tracking-wider text-ink-3 uppercase hover:text-ink">
                    Webhook payload · JSON
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto border border-line bg-canvas p-2 text-[10px] whitespace-pre-wrap break-words text-ink-2">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          <span
            aria-live="polite"
            className={`text-[10px] tracking-wider uppercase ${
              copied === "blocked"
                ? "text-down"
                : copied
                  ? "text-up"
                  : "text-ink-3"
            }`}
          >
            {copied === "message"
              ? "MESSAGE COPIED"
              : copied === "json"
                ? "JSON PAYLOAD COPIED"
                : copied === "blocked"
                  ? "CLIPBOARD BLOCKED"
                  : "Nothing is sent automatically"}
          </span>
          <Key
            className="ml-auto"
            onClick={() => setNonce((n) => n + 1)}
            disabled={pending || !hasData}
            title="Mark the book again"
          >
            REFRESH
          </Key>
          <Key tone="accent" onClick={onClose}>
            CLOSE
          </Key>
        </div>
      </div>
    </div>
  );
}
