"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Key, Spinner, useEscape, useRestoreFocus } from "@/components/ui";
import { api, type PortfolioReportRun } from "@/lib/api";
import { pct, signed } from "@/lib/format";
import {
  parseInline,
  parseMemo,
  reportFilename,
  stanceLabel,
  type AcademicStance,
  type PortfolioReport,
} from "@/lib/portfolioReport";
import { isRemote, useTerminal } from "@/store/terminal";

/** Opened from the top bar, the command palette, and the R hotkey. */
export const useDossier = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

export function PortfolioReportModal() {
  const open = useDossier((s) => s.open);
  const setOpen = useDossier((s) => s.setOpen);
  if (!open) return null;
  return <DossierDialog onClose={() => setOpen(false)} />;
}

const STANCE_TONE: Record<AcademicStance, string> = {
  MAXIMAL_AGGRESSION: "border-up/60 bg-up/10 text-up",
  ACTIVE_PROTECTION: "border-accent/60 bg-accent/10 text-accent",
  MAINTAIN_FLOOR: "border-accent/40 text-accent",
  CRITICAL_INTERVENTION: "border-down/60 bg-down/10 text-down",
};

const STATUS_TONE: Record<string, string> = {
  AHEAD: "text-up",
  AT_TARGET: "text-ink",
  BEHIND: "text-accent",
  AT_RISK: "text-down",
};

type Tab = "memo" | "audit";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((span, index) =>
        span.style === "strong" ? (
          <strong key={index} className="font-semibold text-ink">
            {span.text}
          </strong>
        ) : span.style === "em" ? (
          <em key={index} className="text-ink-3 not-italic">
            {span.text}
          </em>
        ) : span.style === "code" ? (
          <code key={index} className="bg-head px-1 text-accent">
            {span.text}
          </code>
        ) : (
          <Fragment key={index}>{span.text}</Fragment>
        ),
      )}
    </>
  );
}

/** The executive memo, rendered as plain React text: no raw HTML from the backend. */
function Memo({ markdown }: { markdown: string }) {
  return (
    <article className="flex flex-col gap-2 text-[12px] leading-relaxed text-ink-2">
      {parseMemo(markdown).map((block, index) => {
        switch (block.type) {
          case "heading":
            return block.level === 1 ? (
              <h3
                key={index}
                className="border-b border-accent/50 pb-1 text-[13px] tracking-[0.2em] text-accent uppercase"
              >
                <Inline text={block.text} />
              </h3>
            ) : (
              <h4
                key={index}
                className="mt-1 text-[11px] tracking-wider text-ink uppercase"
              >
                <Inline text={block.text} />
              </h4>
            );
          case "paragraph":
            return (
              <p key={index}>
                <Inline text={block.text} />
              </p>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={index}
                className={`flex flex-col gap-0.5 pl-5 ${block.ordered ? "list-decimal" : "list-[square]"} marker:text-accent`}
              >
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline text={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <div key={index} className="overflow-x-auto">
                <table className="w-full text-[11px] tabular-nums">
                  <thead className="text-[10px] tracking-wider text-ink-3 uppercase">
                    <tr className="border-b border-line">
                      {block.header.map((cell, i) => (
                        <th
                          key={i}
                          className={`py-1 pr-3 font-normal ${i ? "text-right" : "text-left"}`}
                        >
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-line/60">
                        {row.map((cell, i) => (
                          <td
                            key={i}
                            className={`py-1 pr-3 ${i ? "text-right" : "text-left text-ink"} ${STATUS_TONE[cell] ?? ""}`}
                          >
                            <Inline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </article>
  );
}

function Figure({
  label,
  value,
  tone = "text-ink",
  title,
}: {
  label: string;
  value: string;
  tone?: string;
  title?: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 border-r border-line px-3 py-1.5 last:border-r-0"
      title={title}
    >
      <dt className="text-[10px] tracking-wider text-ink-3 uppercase">
        {label}
      </dt>
      <dd className={`text-[16px] tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

const or = (value: number | null, show: (v: number) => string) =>
  value === null ? "—" : show(value);

function Th({ children, left = false }: { children: ReactNode; left?: boolean }) {
  return (
    <th className={`px-2 py-1 font-normal ${left ? "text-left" : "text-right"}`}>
      {children}
    </th>
  );
}

function AuditMetrics({ report }: { report: PortfolioReport }) {
  const margin = report.margin;
  // With no posted grade the backend reports zero placeholders for the book.
  const graded = report.course_breakdown.some((c) => c.current_score !== null);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 border border-line sm:grid-cols-5">
        <Figure
          label="Portfolio"
          value={graded ? pct(report.portfolio_score) : "—"}
          title="Mean current grade across graded courses"
        />
        <Figure label="Target" value={graded ? pct(report.target_score) : "—"} />
        <Figure
          label="Margin"
          value={graded ? signed(margin) : "—"}
          tone={!graded ? "text-ink-3" : margin >= 0 ? "text-up" : "text-down"}
        />
        <Figure
          label="Proj. GPA"
          value={report.projected_gpa.toFixed(2)}
          title="Equal-course 4.0-scale estimate from each course's median projection; not an official GPA"
        />
        <Figure
          label="VaR 90"
          value={report.downside_var_90.toFixed(2)}
          tone="text-down"
          title="90% downside value at risk of the equal-weighted book: mean minus 10th percentile, in grade points"
        />
      </dl>

      <section aria-labelledby="dossier-positions">
        <h4
          id="dossier-positions"
          className="bg-head px-2 py-0.5 text-[10px] tracking-wider text-ink-3 uppercase"
        >
          Course breakdown
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-[10px] tracking-wider text-ink-3 uppercase">
              <tr className="border-b border-line">
                <Th left>Course</Th>
                <Th>Grade</Th>
                <Th>Target</Th>
                <Th>Status</Th>
                <Th>P(tgt)</Th>
                <Th>VaR 90</Th>
                <Th>Open wt</Th>
              </tr>
            </thead>
            <tbody>
              {report.course_breakdown.map((c) => (
                <tr key={c.course_id} className="border-b border-line/60">
                  <td className="px-2 py-1">
                    <span className="text-ink">{c.course_code}</span>
                    <span className="ml-2 text-ink-3">{c.name}</span>
                  </td>
                  <td className="px-2 py-1 text-right text-ink">
                    {or(c.current_score, (v) => pct(v))}
                  </td>
                  <td className="px-2 py-1 text-right text-ink-2">
                    {pct(c.target_score)}
                  </td>
                  <td
                    className={`px-2 py-1 text-right ${STATUS_TONE[c.status] ?? "text-ink-2"}`}
                  >
                    {c.status.replaceAll("_", " ")}
                  </td>
                  <td className="px-2 py-1 text-right text-ink">
                    {or(c.probability_of_target, (v) => `${Math.round(v * 100)}%`)}
                  </td>
                  <td className="px-2 py-1 text-right text-down">
                    {or(c.var_90, (v) => v.toFixed(2))}
                  </td>
                  <td className="px-2 py-1 text-right text-ink-2">
                    {pct(c.remaining_weight)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="dossier-actions">
        <h4
          id="dossier-actions"
          className="bg-head px-2 py-0.5 text-[10px] tracking-wider text-ink-3 uppercase"
        >
          High-leverage actions
        </h4>
        {report.high_leverage_actions.length ? (
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-[10px] tracking-wider text-ink-3 uppercase">
              <tr className="border-b border-line">
                <Th left>Deliverable</Th>
                <Th>WT</Th>
                <Th>Leverage</Th>
                <Th>Due</Th>
                <Th>Priority</Th>
              </tr>
            </thead>
            <tbody>
              {report.high_leverage_actions.map((a, index) => (
                <tr
                  key={a.assignment_id}
                  className={`border-b border-line/60 ${index === 0 ? "bg-accent/5" : ""}`}
                >
                  <td className="max-w-0 px-2 py-1">
                    <div className="truncate" title={a.title}>
                      <span className={index === 0 ? "text-accent" : "text-ink-3"}>
                        {a.course_code}
                      </span>{" "}
                      <span className="text-ink">{a.title}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1 text-right text-ink-2">
                    {a.weight.toFixed(1)}%
                  </td>
                  <td className="px-2 py-1 text-right text-ink">
                    {a.marginal_impact.toFixed(3)}
                  </td>
                  <td className="px-2 py-1 text-right text-ink-2">
                    {a.due_at ? a.due_at.slice(0, 10) : "—"}
                  </td>
                  <td className="w-24 px-2 py-1">
                    <div className="flex items-center justify-end gap-1.5">
                      <div aria-hidden className="h-[3px] w-10 bg-line">
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${Math.min(1, Math.max(0, a.priority_score)) * 100}%` }}
                        />
                      </div>
                      <span className="text-ink">{a.priority_score.toFixed(2)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-2 py-3 text-center text-[11px] text-ink-3">
            No open weighted work · nothing left can move the book
          </p>
        )}
      </section>
    </div>
  );
}

function download(report: PortfolioReport) {
  const blob = new Blob([report.executive_summary], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = reportFilename(report);
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Defer revocation until the browser has started consuming the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function DossierDialog({ onClose }: { onClose: () => void }) {
  useRestoreFocus();
  useEscape(onClose);
  const hasData = useTerminal((s) => s.data !== null);
  const [tab, setTab] = useState<Tab>("memo");
  const [nonce, setNonce] = useState(0);
  const [run, setRun] = useState<{ nonce: number; run: PortfolioReportRun } | null>(
    null,
  );
  const [copied, setCopied] = useState<"ok" | "blocked" | null>(null);

  // A dossier is a snapshot of the book when it was requested; REGENERATE takes a new one.
  useEffect(() => {
    const { data, mode, simulationPinned } = useTerminal.getState();
    if (!data) return;
    let active = true;
    void api
      .portfolioReport(data, { offline: !isRemote(mode) || simulationPinned })
      .then((next) => {
        if (active) setRun({ nonce, run: next });
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
  const telemetry = report?.telemetry ?? null;

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.executive_summary);
      setCopied("ok");
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
        aria-labelledby="dossier-title"
        aria-busy={pending}
        // Keep the workstation's single-key hotkeys (J/K/T/M/R) out of the dialog; Escape still closes.
        onKeyDown={(event) => event.key !== "Escape" && event.stopPropagation()}
        className="w-full max-w-[820px] border border-line-strong bg-panel shadow-2xl shadow-black"
      >
        <h2
          id="dossier-title"
          className="flex items-center justify-between border-b border-line bg-head px-2.5 py-1 text-[11px] tracking-wider text-accent uppercase"
        >
          <span>DOSSIER // MEMO · ACADEMIC STANDING</span>
          <span className="text-ink-3">ESC</span>
        </h2>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
          {report && (
            <span
              className={`border px-1.5 py-0.5 text-[11px] tracking-wider ${STANCE_TONE[report.academic_stance]}`}
              title="Academic stance for the whole book"
            >
              {stanceLabel(report.academic_stance)}
            </span>
          )}
          <div role="tablist" aria-label="Dossier view" className="flex gap-1">
            {(
              [
                ["memo", "EXECUTIVE MEMO"],
                ["audit", "AUDIT METRICS"],
              ] as const
            ).map(([value, label]) => (
              <Key
                key={value}
                role="tab"
                id={`dossier-tab-${value}`}
                aria-selected={tab === value}
                aria-controls="dossier-body"
                active={tab === value}
                autoFocus={value === "memo"}
                onClick={() => setTab(value)}
              >
                {label}
              </Key>
            ))}
          </div>
          <span
            role="status"
            className="ml-auto flex items-center gap-1.5 text-[10px] tracking-wider text-ink-3 uppercase"
            title={run?.run.source === "local" ? run.run.cause.message : undefined}
          >
            {pending ? (
              <>
                <Spinner /> SYNTHESIZING
              </>
            ) : (
              run && (
                <>
                  <span
                    className={run.run.source === "backend" ? "text-up" : "text-accent"}
                  >
                    ● {run.run.source === "backend" ? "BACKEND" : "LOCAL SYNTHESIZER"}
                  </span>
                  {telemetry && (
                    <span className="normal-case">
                      {telemetry.model}
                      {telemetry.tokens_per_second !== null &&
                        ` · ${telemetry.tokens_per_second.toFixed(1)} tok/s`}
                      {` · ${Math.round(telemetry.latency_ms)} ms`}
                    </span>
                  )}
                </>
              )
            )}
          </span>
        </div>

        <div
          id="dossier-body"
          role="tabpanel"
          aria-labelledby={`dossier-tab-${tab}`}
          className="dossier-print max-h-[64vh] overflow-auto px-4 py-3"
        >
          {!hasData ? (
            <p className="py-6 text-center text-[11px] text-ink-3">
              NO COURSE BOOK LOADED · sync Canvas or load a sample syllabus first
            </p>
          ) : !report ? (
            <p className="flex items-center justify-center gap-2 py-10 text-[11px] text-accent">
              <Spinner /> COMPILING DOSSIER
            </p>
          ) : tab === "memo" ? (
            <Memo markdown={report.executive_summary} />
          ) : (
            <AuditMetrics report={report} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          <span
            aria-live="polite"
            className={`text-[10px] tracking-wider uppercase ${copied === "blocked" ? "text-down" : "text-up"}`}
          >
            {copied === "ok"
              ? "MARKDOWN COPIED"
              : copied === "blocked"
                ? "CLIPBOARD BLOCKED · USE DOWNLOAD"
                : ""}
          </span>
          <Key
            className="ml-auto"
            onClick={() => setNonce((n) => n + 1)}
            disabled={pending || !hasData}
            title="Take a fresh snapshot of the book"
          >
            REGENERATE
          </Key>
          <Key onClick={() => void copy()} disabled={!report}>
            COPY MARKDOWN
          </Key>
          <Key
            caps={false}
            onClick={() => report && download(report)}
            disabled={!report}
          >
            DOWNLOAD .md
          </Key>
          <Key onClick={() => window.print()} disabled={!report}>
            PRINT
          </Key>
          <Key tone="accent" onClick={onClose}>
            CLOSE
          </Key>
        </div>
      </div>
    </div>
  );
}
