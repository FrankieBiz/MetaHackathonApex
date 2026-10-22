"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { create } from "zustand";
import {
  Key,
  Segmented,
  Spinner,
  useEscape,
  useRestoreFocus,
} from "@/components/ui";
import { api, type NegotiationRun } from "@/lib/api";
import { googleCalendarUrl } from "@/lib/calendarExport";
import { evaluateCircuitBreaker } from "@/lib/circuitBreaker";
import { speakLines, type SpeechRun } from "@/lib/morningBell";
import {
  PETITION_LABEL,
  PETITION_TYPES,
  STUDENT_REASON_LIMIT,
  addToReason,
  isEmail,
  mailtoUrl,
  negotiationCase,
  pitchText,
  spokenSeconds,
  type CaseFact,
  type PetitionType,
} from "@/lib/negotiation";
import { isRemote, useTerminal } from "@/store/terminal";

/** Opened from the inspector, the circuit breaker banner, the palette, and the O hotkey. */
export const useNegotiator = create<{
  assignmentId: string | null;
  open: (assignmentId: string) => void;
  close: () => void;
}>((set) => ({
  assignmentId: null,
  open: (assignmentId) => set({ assignmentId }),
  close: () => set({ assignmentId: null }),
}));

export function NegotiationModal() {
  const assignmentId = useNegotiator((s) => s.assignmentId);
  const close = useNegotiator((s) => s.close);
  if (!assignmentId) return null;
  return (
    <NegotiatorDialog
      key={assignmentId}
      assignmentId={assignmentId}
      onClose={close}
    />
  );
}

const FACT_TONE: Record<CaseFact["tone"], string> = {
  up: "text-up",
  down: "text-down",
  accent: "text-accent",
  neutral: "text-ink-2",
};

/** A spoken pitch longer than this runs past its minute. */
const PITCH_BUDGET_S = 60;

type Copied = "email" | "pitch" | "blocked" | null;

interface Draft {
  nonce: number;
  type: PetitionType;
  reason: string;
}

function Caption({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3
      id={id}
      className="bg-head px-2 py-0.5 text-[10px] tracking-wider text-ink-3 uppercase"
    >
      {children}
    </h3>
  );
}

function sourceLabel(run: NegotiationRun): { text: string; tone: string } {
  if (run.source === "local")
    return { text: "LOCAL TEMPLATE", tone: "text-accent" };
  return run.petition.source === "ai"
    ? {
        text: `AI DRAFT · ${run.petition.telemetry.model_used}`,
        tone: "text-up",
      }
    : { text: "BACKEND TEMPLATE", tone: "text-accent" };
}

function NegotiatorDialog({
  assignmentId,
  onClose,
}: {
  assignmentId: string;
  onClose: () => void;
}) {
  useRestoreFocus();
  useEscape(onClose);
  const reasonId = useId();
  const toId = useId();
  const subjectId = useId();
  const bodyId = useId();
  const data = useTerminal((s) => s.data);
  const assignment = useTerminal(
    (s) => s.data?.assignments.find((a) => a.id === assignmentId) ?? null,
  );
  const [openedAt] = useState(() => Date.now());
  const caseFile = useMemo(
    () =>
      data && assignment
        ? negotiationCase(
            assignment,
            data,
            openedAt,
            evaluateCircuitBreaker(data),
          )
        : null,
    [data, assignment, openedAt],
  );

  const [reason, setReason] = useState("");
  // Each draft is a request: picking a petition or pressing REDRAFT files a new one.
  const [draft, setDraft] = useState<Draft | null>(() =>
    caseFile ? { nonce: 0, type: caseFile.recommended, reason: "" } : null,
  );
  const [run, setRun] = useState<{ nonce: number; run: NegotiationRun } | null>(
    null,
  );
  const [failure, setFailure] = useState<{
    nonce: number;
    message: string;
  } | null>(null);
  const [edits, setEdits] = useState<{
    nonce: number;
    subject: string;
    body: string;
  } | null>(null);
  const [tab, setTab] = useState<"email" | "pitch">("email");
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState<Copied>(null);
  const [beat, setBeat] = useState<number | null>(null);
  const [voiceless, setVoiceless] = useState(false);
  const rehearsal = useRef<SpeechRun | null>(null);

  useEffect(() => {
    if (!draft) return;
    const { data, mode, simulationPinned } = useTerminal.getState();
    if (!data) return;
    let active = true;
    api
      .negotiatePetition(assignmentId, draft.type, draft.reason, data, {
        offline: !isRemote(mode) || simulationPinned,
      })
      .then((next) => {
        if (active) setRun({ nonce: draft.nonce, run: next });
      })
      .catch((error: unknown) => {
        // Only an id missing from the book rejects.
        if (active)
          setFailure({
            nonce: draft.nonce,
            message: error instanceof Error ? error.message : "Draft failed",
          });
      });
    return () => {
      active = false;
    };
  }, [assignmentId, draft]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    const live = rehearsal;
    return () => live.current?.cancel();
  }, []);

  const file = (type: PetitionType) =>
    setDraft((d) => ({ nonce: (d?.nonce ?? 0) + 1, type, reason }));

  const pending =
    draft !== null &&
    run?.nonce !== draft.nonce &&
    failure?.nonce !== draft.nonce;
  const petition = run?.run.petition ?? null;
  const edited = edits && run && edits.nonce === run.nonce ? edits : null;
  const subject = edited?.subject ?? petition?.email_subject ?? "";
  const body = edited?.body ?? petition?.email_body ?? "";
  const edit = (patch: { subject?: string; body?: string }) =>
    run && setEdits({ nonce: run.nonce, subject, body, ...patch });
  const validTo = to.trim() === "" || isEmail(to);
  const beats = petition?.office_hours_pitch_60s ?? [];
  const seconds = beats.map(spokenSeconds);
  const total = seconds.reduce((sum, s) => sum + s, 0);
  const source = run ? sourceLabel(run.run) : null;

  const copy = async (text: string, kind: "email" | "pitch") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setCopied("blocked");
    }
  };

  const rehearse = () => {
    if (rehearsal.current) {
      rehearsal.current.cancel();
      return;
    }
    const spoken = speakLines(beats, {
      onLine: setBeat,
      onDone: () => {
        rehearsal.current = null;
        setBeat(null);
      },
    });
    setVoiceless(!spoken);
    rehearsal.current = spoken;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 px-4 pt-[5vh] pb-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="negotiator-title"
        aria-busy={pending}
        // Keep the workstation's single-key hotkeys out of the dialog; Escape still closes.
        onKeyDown={(event) => event.key !== "Escape" && event.stopPropagation()}
        className="w-full max-w-[980px] border border-line-strong bg-panel shadow-2xl shadow-black"
      >
        <h2
          id="negotiator-title"
          className="flex items-center justify-between border-b border-line bg-head px-2.5 py-1 text-[11px] tracking-wider text-accent uppercase"
        >
          <span>OFFICE HOURS // PETITION NEGOTIATOR</span>
          <span className="text-ink-3">ESC</span>
        </h2>

        {!assignment || !caseFile || !draft ? (
          <p className="px-3 py-8 text-center text-[11px] text-ink-3">
            This deliverable is no longer on the book · sync and pick another
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
              <span className="text-[12px] text-ink">
                {assignment.course_code}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-[12px] text-ink-2"
                title={assignment.title}
              >
                {assignment.title}
              </span>
              <span
                role="status"
                className="flex shrink-0 items-center gap-1.5 text-[10px] tracking-wider text-ink-3 uppercase"
                title={
                  run?.run.source === "local"
                    ? run.run.cause.message
                    : undefined
                }
              >
                {pending ? (
                  <>
                    <Spinner /> DRAFTING {PETITION_LABEL[draft.type].label}
                  </>
                ) : failure?.nonce === draft.nonce ? (
                  <span className="text-down">{failure.message}</span>
                ) : (
                  source && <span className={source.tone}>● {source.text}</span>
                )}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
              <Segmented
                label="Petition type"
                value={draft.type}
                onChange={(type) => type !== draft.type && file(type)}
                options={PETITION_TYPES.map((type) => ({
                  value: type,
                  label: `${PETITION_LABEL[type].label}${type === caseFile.recommended ? " ★" : ""}`,
                }))}
              />
              <span
                className="min-w-0 flex-1 text-[10px] text-ink-3"
                title={PETITION_LABEL[draft.type].brief}
              >
                <span className="text-accent">★ </span>
                {caseFile.rationale}
              </span>
            </div>

            <div className="grid max-h-[72vh] grid-cols-1 gap-4 overflow-auto px-3 py-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-3">
                <section aria-labelledby="oh-case">
                  <Caption id="oh-case">Case file</Caption>
                  <dl className="flex flex-col">
                    {caseFile.facts.map((fact) => {
                      const added =
                        fact.reason !== null && reason.includes(fact.reason);
                      return (
                        <div
                          key={fact.id}
                          className="flex items-start gap-2 border-b border-line/70 px-2 py-1 last:border-b-0"
                        >
                          <dt className="w-[9ch] shrink-0 pt-px text-[10px] tracking-wider text-ink-3 uppercase">
                            {fact.label}
                          </dt>
                          <dd
                            className={`min-w-0 flex-1 text-[11px] break-words ${FACT_TONE[fact.tone]}`}
                          >
                            {fact.detail}
                          </dd>
                          {fact.reason !== null && (
                            <Key
                              disabled={added}
                              onClick={() =>
                                setReason((r) => addToReason(r, fact.reason!))
                              }
                              title={
                                added
                                  ? "Already in the reason"
                                  : `Add to the reason: “${fact.reason}”`
                              }
                              aria-label={`Add the ${fact.label.toLowerCase()} fact to the reason`}
                            >
                              {added ? "✓" : "+"}
                            </Key>
                          )}
                        </div>
                      );
                    })}
                  </dl>
                </section>

                <section
                  aria-labelledby="oh-reason"
                  className="flex flex-col gap-1.5"
                >
                  <Caption id="oh-reason">
                    Reason · optional, self-reported
                  </Caption>
                  <label htmlFor={reasonId} className="sr-only">
                    Reason for the petition
                  </label>
                  <textarea
                    id={reasonId}
                    value={reason}
                    maxLength={STUDENT_REASON_LIMIT}
                    rows={4}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Say why in your own words, or add case file facts with +"
                    className="resize-y border border-line-strong bg-canvas px-1.5 py-1 text-[11px] leading-relaxed text-ink outline-none placeholder:text-ink-3/60 focus-visible:border-accent"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-ink-3 tabular-nums">
                      {reason.length}/{STUDENT_REASON_LIMIT}
                    </span>
                    <Key
                      tone="accent"
                      className="ml-auto"
                      disabled={pending}
                      onClick={() => file(draft.type)}
                      title="Draft again with this reason"
                    >
                      {run ? "REDRAFT" : "DRAFT"}
                    </Key>
                  </div>
                </section>
              </div>

              <div
                className={`flex min-w-0 flex-col gap-2 ${pending && petition ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <Segmented
                    label="Draft"
                    value={tab}
                    onChange={setTab}
                    options={[
                      { value: "email", label: "EMAIL" },
                      {
                        value: "pitch",
                        label: `60s PITCH${beats.length ? ` · ${beats.length}` : ""}`,
                      },
                    ]}
                  />
                  {petition && (
                    <span className="ml-auto truncate text-[10px] tracking-wider text-ink-3 uppercase">
                      To {petition.instructor_name}
                    </span>
                  )}
                </div>

                {!petition ? (
                  <p className="flex items-center justify-center gap-2 border border-line px-3 py-16 text-[11px] text-accent">
                    {failure?.nonce === draft.nonce ? (
                      <span className="text-down">{failure.message}</span>
                    ) : (
                      <>
                        <Spinner /> DRAFTING THE PETITION
                      </>
                    )}
                  </p>
                ) : tab === "email" ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                      <label
                        htmlFor={toId}
                        className="text-[10px] tracking-wider text-ink-3 uppercase"
                      >
                        To
                      </label>
                      <input
                        id={toId}
                        type="email"
                        autoComplete="off"
                        value={to}
                        onChange={(event) => setTo(event.target.value)}
                        placeholder="instructor@school.edu (optional)"
                        aria-invalid={!validTo}
                        className={`h-[24px] border bg-canvas px-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3/60 focus-visible:border-accent ${
                          validTo ? "border-line-strong" : "border-down"
                        }`}
                      />
                      <label
                        htmlFor={subjectId}
                        className="text-[10px] tracking-wider text-ink-3 uppercase"
                      >
                        Subject
                      </label>
                      <input
                        id={subjectId}
                        value={subject}
                        onChange={(event) =>
                          edit({ subject: event.target.value })
                        }
                        className="h-[24px] border border-line-strong bg-canvas px-1.5 text-[12px] text-ink outline-none focus-visible:border-accent"
                      />
                    </div>
                    <label htmlFor={bodyId} className="sr-only">
                      Email body
                    </label>
                    <textarea
                      id={bodyId}
                      value={body}
                      rows={13}
                      onChange={(event) => edit({ body: event.target.value })}
                      className="resize-y border border-line-strong bg-canvas px-2 py-1.5 text-[12px] leading-relaxed text-ink outline-none focus-visible:border-accent"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <Key
                        tone="up"
                        disabled={!validTo || !body.trim()}
                        onClick={() => {
                          window.location.href = mailtoUrl(subject, body, to);
                        }}
                        title="Opens your mail client with this draft; you press send"
                      >
                        OPEN IN MAIL
                      </Key>
                      <Key
                        disabled={!body.trim()}
                        onClick={() =>
                          void copy(`Subject: ${subject}\n\n${body}`, "email")
                        }
                      >
                        COPY EMAIL
                      </Key>
                      {edited && (
                        <Key
                          onClick={() => setEdits(null)}
                          title="Discard your edits to this draft"
                        >
                          RESET EDITS
                        </Key>
                      )}
                    </div>
                    <section aria-labelledby="oh-clauses" className="mt-1">
                      <Caption id="oh-clauses">Syllabus clauses cited</Caption>
                      {petition.syllabus_clauses_cited.length ? (
                        <ul className="flex flex-col gap-1 px-2 py-1 text-[11px] text-ink-2">
                          {petition.syllabus_clauses_cited.map(
                            (clause, index) => (
                              <li
                                key={index}
                                className="border-l-2 border-accent/60 pl-2 break-words"
                              >
                                “{clause}”
                              </li>
                            ),
                          )}
                        </ul>
                      ) : (
                        <p className="px-2 py-1.5 text-[11px] text-ink-3">
                          No syllabus policy cited · the draft asks the
                          instructor to confirm it.
                        </p>
                      )}
                    </section>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <ol
                      aria-label="Talking points"
                      className="flex flex-col gap-1.5"
                    >
                      {beats.map((text, index) => (
                        <li
                          key={index}
                          aria-current={beat === index ? "true" : undefined}
                          className={`flex flex-col gap-1 border px-2.5 py-2 transition-colors duration-150 ${
                            beat === index
                              ? "border-accent bg-accent/10"
                              : "border-line-strong bg-canvas"
                          }`}
                        >
                          <span className="flex items-center justify-between text-[10px] tracking-wider text-ink-3 uppercase">
                            <span
                              className={beat === index ? "text-accent" : ""}
                            >
                              Talking point {index + 1}
                            </span>
                            <span className="tabular-nums">
                              ~{seconds[index]}s
                            </span>
                          </span>
                          <span className="text-[12px] leading-relaxed break-words text-ink">
                            {text}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <div className="flex items-center gap-2 text-[10px] tracking-wider text-ink-3 uppercase">
                      <span>Spoken</span>
                      <span
                        className="relative h-1.5 flex-1 bg-line"
                        aria-hidden
                      >
                        <span
                          className={`absolute inset-y-0 left-0 ${total > PITCH_BUDGET_S ? "bg-down" : "bg-up"}`}
                          style={{
                            width: `${Math.min(1, total / PITCH_BUDGET_S) * 100}%`,
                          }}
                        />
                      </span>
                      <span
                        className={
                          total > PITCH_BUDGET_S ? "text-down" : "text-ink"
                        }
                      >
                        ~{total}s / {PITCH_BUDGET_S}s
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Key
                        tone="accent"
                        active={beat !== null}
                        onClick={rehearse}
                        title="Hear the pitch read aloud at speaking pace"
                      >
                        {beat !== null ? "■ STOP" : "▶ REHEARSE"}
                      </Key>
                      <Key onClick={() => void copy(pitchText(beats), "pitch")}>
                        COPY PITCH
                      </Key>
                      <Key
                        onClick={() => {
                          const url = googleCalendarUrl({
                            title: `[OFFICE HOURS] ${assignment.course_code}: ${assignment.title}`,
                            description: `Office Hours Discussion & Talking Points:\n\n${pitchText(beats)}`,
                            start: new Date(Date.now() + 86400000),
                          });
                          window.open(url, "_blank", "noopener,noreferrer");
                        }}
                        title="Add this office hours discussion to Google Calendar"
                      >
                        📅 +CAL OFFICE HOURS ↗
                      </Key>
                      {voiceless && (
                        <span className="text-[10px] tracking-wider text-ink-3 uppercase">
                          Voice unavailable in this browser
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
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
            {copied === "email"
              ? "EMAIL COPIED"
              : copied === "pitch"
                ? "PITCH COPIED"
                : copied === "blocked"
                  ? "CLIPBOARD BLOCKED"
                  : "Drafts are never sent · review before you use them"}
          </span>
          <Key tone="accent" className="ml-auto" onClick={onClose}>
            CLOSE
          </Key>
        </div>
      </div>
    </div>
  );
}
