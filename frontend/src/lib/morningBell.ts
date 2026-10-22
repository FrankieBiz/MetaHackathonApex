// Morning bell: a client-side voice briefing. A struck bell (Web Audio, see
// playBell in lib/feedback) opens the market, then the Web Speech API reads
// the book segment by segment: standing, circuit breaker, open deliverables
// and priority #1, what is due today, deadline congestion, and the first
// move. Every figure comes from terminal state; nothing leaves the browser,
// and it stays silent while terminal audio is muted.

import { evaluateCircuitBreaker, LEVEL_STYLE } from "@/lib/circuitBreaker";
import { detectCongestion } from "@/lib/congestion";
import { nextBestAction, portfolio, rankQueue } from "@/lib/engine";
import { soundEnabled } from "@/lib/feedback";
import { score } from "@/lib/format";
import type { TerminalState } from "@/types";

export type SegmentId =
  | "open"
  | "book"
  | "breaker"
  | "queue"
  | "today"
  | "congestion"
  | "move"
  | "close";

export interface BriefingSegment {
  id: SegmentId;
  label: string;
  text: string;
}

export interface MorningBriefing {
  generated_at: string;
  segments: BriefingSegment[];
}

/** Deliverables named aloud before the rest are summed up. */
export const BRIEF_NAMED = 3;

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** "A, B and C". */
function series(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** 395 → "6 hours 35 minutes". */
export function spokenDuration(total: number): string {
  const rounded = Math.max(0, Math.round(total));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return plural(rest, "minute");
  return rest
    ? `${plural(hours, "hour")} ${plural(rest, "minute")}`
    : plural(hours, "hour");
}

function spokenHours(hours: number): string {
  return hours < 1 ? "under an hour" : plural(Math.round(hours), "hour");
}

const longDate = (at: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", options).format(new Date(at));

export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function composeBriefing(
  state: Pick<TerminalState, "courses" | "assignments">,
  now: number,
): MorningBriefing {
  const segments: BriefingSegment[] = [];
  const codes = new Map(state.courses.map((c) => [c.id, c.course_code]));

  segments.push({
    id: "open",
    label: "Opening bell",
    text: `${greeting(new Date(now).getHours())}. The Apex academic market is open for ${longDate(now, { weekday: "long", month: "long", day: "numeric" })}.`,
  });

  const book = portfolio(state.courses);
  let standing: string;
  if (book.average === null || book.margin === null) {
    standing = "No course grades are posted yet.";
  } else {
    const gap = Math.abs(book.margin);
    const position =
      gap < 0.05
        ? "right on target"
        : `${gap.toFixed(1)} points ${book.margin > 0 ? "above" : "below"} target`;
    standing = `The book stands at ${book.average.toFixed(1)}%, ${position}, with ${book.above} of ${plural(book.graded, "graded course")} at or above target.`;
  }
  segments.push({ id: "book", label: "Book", text: standing });

  const breaker = evaluateCircuitBreaker(state);
  let breakerText =
    "Circuit breaker normal. No course crosses an intervention threshold.";
  if (breaker.triggered) {
    const { rank } = LEVEL_STYLE[breaker.level];
    const word = breaker.level.split("_").at(-1)!.toLowerCase();
    breakerText = `Circuit breaker at level ${rank}, ${word}. ${breaker.reason}`;
    if (breaker.halted_course_ids.length)
      breakerText += ` Paused: ${series(breaker.halted_course_ids.map((id) => codes.get(id) ?? id))}.`;
    if (breaker.protected_assignment_ids.length)
      breakerText += ` ${plural(breaker.protected_assignment_ids.length, "deliverable")} protected.`;
    if (breaker.reallocated_minutes > 0)
      breakerText += ` About ${spokenDuration(breaker.reallocated_minutes)} can move to protected work.`;
  }
  segments.push({ id: "breaker", label: "Circuit breaker", text: breakerText });

  const queue = rankQueue(state.assignments, now);
  const top = queue[0];
  segments.push({
    id: "queue",
    label: "Priority #1",
    text: !top
      ? "No open deliverables on the book."
      : `${plural(queue.length, "open deliverable")} on the book. Priority one: ${top.assignment.title}, ${top.assignment.course_code}, priority score ${score(top.priority)}, ${
          top.hours === null
            ? "with no due date"
            : top.hours < 0
              ? `past due by ${spokenHours(-top.hours)}`
              : `due in ${spokenHours(top.hours)}`
        }.`,
  });

  const today = queue
    .filter((e) => e.hours !== null && e.hours >= 0 && e.hours < 24)
    .sort((x, y) => x.hours! - y.hours!);
  const overdue = queue
    .filter((e) => e.hours !== null && e.hours < 0)
    .sort((x, y) => x.hours! - y.hours!);
  let todayText: string;
  if (!today.length) {
    todayText = "Nothing is due in the next 24 hours.";
  } else {
    const named = today
      .slice(0, BRIEF_NAMED)
      .map(
        (e) =>
          `${e.assignment.title}, ${e.assignment.course_code}, in ${spokenHours(e.hours!)}`,
      )
      .join("; ");
    const more = today.length - BRIEF_NAMED;
    todayText = `${plural(today.length, "deliverable")} due in the next 24 hours: ${named}${more > 0 ? `; and ${more} more` : ""}.`;
  }
  if (overdue.length)
    todayText += ` ${plural(overdue.length, "deliverable")} past due, starting with ${overdue[0].assignment.title}.`;
  segments.push({ id: "today", label: "Due today", text: todayText });

  const clusters = detectCongestion(state.assignments, now);
  if (clusters.length) {
    const worst = clusters.reduce((a, b) =>
      b.congestion_score > a.congestion_score ? b : a,
    );
    const day = (iso: string) =>
      longDate(Date.parse(iso), { month: "long", day: "numeric" });
    const start = day(worst.start_at);
    const end = day(worst.end_at);
    segments.push({
      id: "congestion",
      label: "Congestion",
      text: `Deadline congestion: ${plural(worst.assignment_ids.length, "deliverable")} across ${series(worst.course_ids.map((id) => codes.get(id) ?? id))} ${start === end ? `on ${start}` : `between ${start} and ${end}`}.`,
    });
  }

  const move = nextBestAction(state, now);
  segments.push({
    id: "move",
    label: "First move",
    text: !move
      ? "The queue is clear."
      : move.leaf
        ? `First move: ${move.leaf.title}, for ${move.assignment.title}. About ${spokenDuration(move.duration ?? 0)}.`
        : `First move: triage ${move.assignment.title} to size the work.`,
  });

  segments.push({
    id: "close",
    label: "Close",
    text: "That's the bell. The desk is open.",
  });

  return { generated_at: new Date(now).toISOString(), segments };
}

/** The transcript as plain text, one segment per paragraph. */
export const briefingScript = (briefing: MorningBriefing) =>
  briefing.segments
    .map((s) => `${s.label.toUpperCase()}: ${s.text}`)
    .join("\n\n");

/** Reads symbols a speech engine would spell out or skip. */
export function speakable(text: string): string {
  return text
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/&/g, " and ")
    .replace(/[—–·]/g, ", ")
    .replace(/≥/g, " at least ")
    .replace(/≤/g, " at most ")
    .replace(/−/g, "minus ")
    .replace(/×/g, " times ")
    .replace(/[[\]{}<>_*#`|~^]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .trim();
}

// ----------------------------------------------------------------- speech

type Voice = Pick<SpeechSynthesisVoice, "lang" | "localService" | "name">;

/** An on-device US English voice, then any US, then any English; null is the engine default. */
export function pickVoice<V extends Voice>(voices: readonly V[]): V | null {
  const lang = (v: Voice) => v.lang.replace("_", "-").toLowerCase();
  const rank = (v: Voice) =>
    (lang(v) === "en-us" ? 0 : lang(v).startsWith("en") ? 2 : 4) +
    (v.localService ? 0 : 1);
  const english = voices.filter((v) => rank(v) < 4);
  if (!english.length) return null;
  return english.reduce((best, v) => (rank(v) < rank(best) ? v : best));
}

export interface SpeechEngine {
  synth: Pick<SpeechSynthesis, "speak" | "cancel" | "getVoices">;
  Utterance: new (text: string) => SpeechSynthesisUtterance;
}

/** The browser's Web Speech API, or null where it does not exist (and on the server). */
export function speechEngine(): SpeechEngine | null {
  if (typeof window === "undefined") return null;
  const synth = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  return synth && Utterance ? { synth, Utterance } : null;
}

export interface SpeechRun {
  cancel: () => void;
}

/**
 * Queues one utterance per line so the transcript can follow along. `onLine`
 * fires as each starts; `onDone` fires once, true after the last line ends,
 * false when cancelled or the engine errors. Null without a speech engine.
 */
export function speakLines(
  lines: string[],
  {
    onLine,
    onDone,
    rate = 1,
    engine = speechEngine(),
  }: {
    onLine?: (index: number) => void;
    onDone?: (completed: boolean) => void;
    rate?: number;
    engine?: SpeechEngine | null;
  } = {},
): SpeechRun | null {
  if (!engine || !lines.length) return null;
  const { synth, Utterance } = engine;
  synth.cancel();
  const voice = pickVoice(synth.getVoices());
  let finished = false;
  const finish = (completed: boolean) => {
    if (finished) return;
    finished = true;
    onDone?.(completed);
  };
  // Held for the whole run: some engines drop callbacks on collected utterances.
  const utterances = lines.map((line, index) => {
    const utterance = new Utterance(speakable(line));
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-US";
    utterance.rate = rate;
    utterance.onstart = () => {
      if (!finished) onLine?.(index);
    };
    utterance.onend = () => {
      if (index === lines.length - 1) finish(true);
    };
    utterance.onerror = () => {
      if (finished) return;
      finish(false);
      synth.cancel();
    };
    return utterance;
  });
  for (const utterance of utterances) synth.speak(utterance);
  return {
    cancel: () => {
      if (finished) return;
      finish(false);
      synth.cancel();
    },
  };
}

// ------------------------------------------------------------ bell timing

export const BELL_KEY = "apex:morning-bell";
/** Local hours the bell may ring on its own: 05:00 up to noon. */
export const BELL_OPENS = 5;
export const BELL_CLOSES = 12;
/** Speech starts as the third strike rings out. */
export const BELL_LEAD_MS = 1400;

const pad = (value: number) => String(value).padStart(2, "0");

/** The local calendar day, e.g. 2026-10-21. */
export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Once per local day, inside the morning window. */
export function bellDue(lastRung: string | null, now: Date): boolean {
  const hour = now.getHours();
  return hour >= BELL_OPENS && hour < BELL_CLOSES && lastRung !== dayKey(now);
}

export function lastRung(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(BELL_KEY);
  } catch {
    return null;
  }
}

export function markRung(now: Date): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BELL_KEY, dayKey(now));
  } catch {
    // Without storage the bell may ring again after a reload; harmless.
  }
}

/**
 * Rings on the first gesture of each morning while terminal audio is on.
 * Browsers block audio and speech until a gesture, so the bell waits for one
 * rather than queueing on load; the listener stays for the session so a desk
 * left open overnight rings the next morning.
 */
export function armMorningBell(
  onRing: () => void,
  clock: () => Date = () => new Date(),
): () => void {
  if (typeof window === "undefined") return () => {};
  const onGesture = () => {
    if (!soundEnabled()) return;
    const now = clock();
    if (!bellDue(lastRung(), now)) return;
    markRung(now);
    onRing();
  };
  window.addEventListener("click", onGesture);
  window.addEventListener("keyup", onGesture);
  return () => {
    window.removeEventListener("click", onGesture);
    window.removeEventListener("keyup", onGesture);
  };
}
