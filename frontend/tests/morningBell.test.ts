import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BellKey,
  MorningBellModal,
  openMorningBell,
  useMorningBell,
} from "@/components/MorningBell";
import { HOUR, nextBestAction, rankQueue } from "@/lib/engine";
import { playBell, setSoundEnabled } from "@/lib/feedback";
import { score } from "@/lib/format";
import { createMockState } from "@/lib/mockData";
import {
  BELL_KEY,
  BELL_LEAD_MS,
  BRIEF_NAMED,
  armMorningBell,
  bellDue,
  briefingScript,
  composeBriefing,
  dayKey,
  greeting,
  lastRung,
  markRung,
  pickVoice,
  speakLines,
  speakable,
  speechEngine,
  spokenDuration,
  type SpeechEngine,
} from "@/lib/morningBell";
import { useTerminal } from "@/store/terminal";
import type { Assignment, Course } from "@/types";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString();

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

function course(id: string, score: number | null, target = 90): Course {
  return {
    id,
    course_code: id.toUpperCase(),
    name: `Course ${id}`,
    current_score: score,
    target_score: target,
    portfolio_margin: score === null ? null : score - target,
    grade_history: [],
  };
}

function assignment(
  id: string,
  courseId: string,
  dueInHours: number | null,
  overrides: Partial<Assignment> = {},
): Assignment {
  return {
    id,
    course_id: courseId,
    course_code: courseId.toUpperCase(),
    title: `Deliverable ${id}`,
    due_at: dueInHours === null ? null : at(dueInHours),
    points_possible: 100,
    weight: 20,
    description: null,
    status: "pending",
    graded: false,
    score: null,
    priority_score: 0,
    subtasks: [],
    ...overrides,
  };
}

class FakeUtterance {
  voice: unknown = null;
  lang = "";
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

function fakeSpeech(voices = [{ lang: "en-US", localService: true, name: "Samantha" }]) {
  const spoken: FakeUtterance[] = [];
  const synth = {
    speak: vi.fn((u: FakeUtterance) => void spoken.push(u)),
    cancel: vi.fn(),
    getVoices: () => voices,
  };
  const engine = {
    synth,
    Utterance: FakeUtterance,
  } as unknown as SpeechEngine;
  return { spoken, synth, engine };
}

function fakeAudio() {
  return {
    currentTime: 0,
    state: "running",
    destination: {},
    createOscillator: vi.fn(() => ({
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn().mockReturnValue({ connect: vi.fn() }),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    })),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      disconnect: vi.fn(),
    })),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// -------------------------------------------------------------- composition

describe("composeBriefing", () => {
  const texts = (state: Parameters<typeof composeBriefing>[0], now = NOW) =>
    Object.fromEntries(
      composeBriefing(state, now).segments.map((s) => [s.id, s.text]),
    );

  it("reads the simulation desk in market order", () => {
    const state = createMockState(NOW);
    const briefing = composeBriefing(state, NOW);
    expect(briefing.generated_at).toBe(new Date(NOW).toISOString());
    expect(briefing.segments.map((s) => s.id)).toEqual([
      "open",
      "book",
      "breaker",
      "queue",
      "today",
      "congestion",
      "move",
      "close",
    ]);
    const text = texts(state);
    expect(text.open).toMatch(
      new RegExp(
        `^${greeting(new Date(NOW).getHours())}\\. The Apex academic market is open for \\w+day, October \\d+\\.$`,
      ),
    );
    expect(text.book).toMatch(
      /^The book stands at \d+\.\d%, \d+\.\d points (above|below) target, with 2 of 4 graded courses at or above target\.$/,
    );
    expect(text.breaker).toBe(
      "Circuit breaker at level 2, restriction. Multiple courses are below target or a course is below 65%. " +
        "Paused: CS 3801 and ENG 2001. 6 deliverables protected. About 10 hours 20 minutes can move to protected work.",
    );

    const queue = rankQueue(state.assignments, NOW);
    expect(text.queue).toContain(`${queue.length} open deliverables on the book.`);
    expect(text.queue).toContain(
      `Priority one: ${queue[0].assignment.title}, ${queue[0].assignment.course_code}, priority score ${score(queue[0].priority)}, due in`,
    );

    const today = queue
      .filter((e) => e.hours! >= 0 && e.hours! < 24)
      .sort((x, y) => x.hours! - y.hours!);
    expect(text.today).toMatch(
      new RegExp(`^${today.length} deliverables due in the next 24 hours: `),
    );
    expect(text.today).toContain(today[0].assignment.title);
    expect(text.congestion).toMatch(
      /^Deadline congestion: \d+ deliverables across .+ (on|between) October \d+/,
    );
    const move = nextBestAction(state, NOW)!;
    expect(text.move).toContain(move.leaf ? move.leaf.title : move.assignment.title);
    expect(text.close).toBe("That's the bell. The desk is open.");
  });

  it("says so plainly when the book is empty", () => {
    const text = texts({ courses: [], assignments: [] });
    expect(text).toMatchObject({
      book: "No course grades are posted yet.",
      breaker:
        "Circuit breaker normal. No course crosses an intervention threshold.",
      queue: "No open deliverables on the book.",
      today: "Nothing is due in the next 24 hours.",
      move: "The queue is clear.",
    });
    expect(text.congestion).toBeUndefined();
  });

  it("names the first few due today, sums the rest, and flags past-due work", () => {
    const state = {
      courses: [course("a", 90)],
      assignments: [
        assignment("late", "a", -5),
        ...[2, 3, 5, 8].map((h) => assignment(`d${h}`, "a", h)),
      ],
    };
    const text = texts(state);
    expect(text.book).toBe(
      "The book stands at 90.0%, right on target, with 1 of 1 graded course at or above target.",
    );
    expect(text.today).toBe(
      `4 deliverables due in the next 24 hours: Deliverable d2, A, in 2 hours; Deliverable d3, A, in 3 hours; Deliverable d5, A, in 5 hours; and ${4 - BRIEF_NAMED} more. ` +
        "1 deliverable past due, starting with Deliverable late.",
    );
    expect(text.queue).toMatch(/^5 open deliverables on the book\. Priority one: Deliverable late, A, priority score 2000, past due by 5 hours\.$/);
    expect(text.move).toBe("First move: triage Deliverable late to size the work.");
  });

  it("reads an undated top priority and a planned first step", () => {
    const planned = assignment("p", "a", null, {
      subtasks: [
        {
          id: "leaf",
          assignment_id: "p",
          parent_id: null,
          title: "Outline the memo",
          estimated_minutes: 45,
          actual_minutes: 0,
          is_completed: false,
          is_study_recommendation: false,
          children: [],
        },
      ],
    });
    const text = texts({ courses: [course("a", 80)], assignments: [planned] });
    expect(text.queue).toMatch(/with no due date\.$/);
    expect(text.move).toBe("First move: Outline the memo, for Deliverable p. About 45 minutes.");
    expect(text.book).toContain("10.0 points below target");
    expect(text.breaker).toMatch(/^Circuit breaker at level 1, caution\./);
  });

  it("flattens to a copyable script", () => {
    const script = briefingScript({
      generated_at: at(0),
      segments: [
        { id: "open", label: "Opening bell", text: "Hi." },
        { id: "close", label: "Close", text: "Bye." },
      ],
    });
    expect(script).toBe("OPENING BELL: Hi.\n\nCLOSE: Bye.");
  });
});

describe("speech text", () => {
  it("spells out symbols a voice would trip on", () => {
    expect(speakable("Score ≥ 85% · up 3 × 2 — done")).toBe(
      "Score at least 85 percent, up 3 times 2, done",
    );
    expect(speakable("R&D [lab] −3.9 ≤ 4")).toBe("R and D lab minus 3.9 at most 4");
    expect(speakable("Lab — · test")).toBe("Lab, test");
  });

  it("speaks durations and greetings", () => {
    expect(spokenDuration(0)).toBe("0 minutes");
    expect(spokenDuration(1)).toBe("1 minute");
    expect(spokenDuration(60)).toBe("1 hour");
    expect(spokenDuration(61)).toBe("1 hour 1 minute");
    expect(spokenDuration(395)).toBe("6 hours 35 minutes");
    expect([5, 11, 12, 17, 18, 23].map(greeting)).toEqual([
      "Good morning",
      "Good morning",
      "Good afternoon",
      "Good afternoon",
      "Good evening",
      "Good evening",
    ]);
  });

  it("prefers an on-device US voice, then any US, then any English", () => {
    const fr = { lang: "fr-FR", localService: true, name: "Amélie" };
    const gb = { lang: "en-GB", localService: true, name: "Daniel" };
    const usRemote = { lang: "en-US", localService: false, name: "Google US" };
    const usLocal = { lang: "en_US", localService: true, name: "Samantha" };
    expect(pickVoice([fr, gb, usRemote, usLocal])).toBe(usLocal);
    expect(pickVoice([fr, gb, usRemote])).toBe(usRemote);
    expect(pickVoice([fr, gb])).toBe(gb);
    expect(pickVoice([fr])).toBeNull();
    expect(pickVoice([])).toBeNull();
  });
});

describe("speakLines", () => {
  it("queues one utterance per line and follows along", () => {
    const { spoken, synth, engine } = fakeSpeech();
    const onLine = vi.fn();
    const onDone = vi.fn();
    const run = speakLines(["Book at 92%.", "Close."], {
      engine,
      onLine,
      onDone,
      rate: 1.1,
    });
    expect(run).not.toBeNull();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(spoken.map((u) => u.text)).toEqual(["Book at 92 percent.", "Close."]);
    expect(spoken[0]).toMatchObject({
      lang: "en-US",
      rate: 1.1,
      voice: { name: "Samantha" },
    });

    spoken[0].onstart!();
    spoken[0].onend!();
    expect(onLine).toHaveBeenCalledWith(0);
    expect(onDone).not.toHaveBeenCalled();
    spoken[1].onstart!();
    spoken[1].onend!();
    expect(onLine).toHaveBeenLastCalledWith(1);
    expect(onDone).toHaveBeenCalledExactlyOnceWith(true);

    run!.cancel();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("reports a cancel once and ignores the engine's interrupted events", () => {
    const { spoken, synth, engine } = fakeSpeech([]);
    const onLine = vi.fn();
    const onDone = vi.fn();
    const run = speakLines(["One.", "Two."], { engine, onLine, onDone })!;
    expect(spoken[0].voice).toBeNull();
    expect(spoken[0].lang).toBe("en-US");
    run.cancel();
    spoken[0].onerror!();
    spoken[1].onstart!();
    expect(onDone).toHaveBeenCalledExactlyOnceWith(false);
    expect(onLine).not.toHaveBeenCalled();
    expect(synth.cancel).toHaveBeenCalledTimes(2);
  });

  it("stops the queue when the engine errors", () => {
    const { spoken, synth, engine } = fakeSpeech();
    const onDone = vi.fn();
    speakLines(["One.", "Two."], { engine, onDone });
    spoken[0].onerror!();
    spoken[1].onerror!();
    expect(onDone).toHaveBeenCalledExactlyOnceWith(false);
    expect(synth.cancel).toHaveBeenCalledTimes(2);
  });

  it("needs an engine and something to say", () => {
    expect(speakLines(["Hi."], { engine: null })).toBeNull();
    expect(speakLines([], { engine: fakeSpeech().engine })).toBeNull();
  });

  it("finds the browser's speech engine only where it exists", () => {
    expect(speechEngine()).toBeNull();
    vi.stubGlobal("window", {});
    expect(speechEngine()).toBeNull();
    const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
    vi.stubGlobal("window", {
      speechSynthesis: synth,
      SpeechSynthesisUtterance: FakeUtterance,
    });
    expect(speechEngine()).toEqual({ synth, Utterance: FakeUtterance });
  });
});

// ---------------------------------------------------------------- bell timing

describe("bell timing", () => {
  const morning = new Date(2026, 9, 21, 8, 0);

  it("rings once per local day inside the morning window", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(bellDue(null, morning)).toBe(true);
    expect(bellDue("2026-10-20", morning)).toBe(true);
    expect(bellDue("2026-10-21", morning)).toBe(false);
    expect(bellDue(null, new Date(2026, 9, 21, 4, 59))).toBe(false);
    expect(bellDue(null, new Date(2026, 9, 21, 5, 0))).toBe(true);
    expect(bellDue(null, new Date(2026, 9, 21, 12, 0))).toBe(false);
  });

  it("remembers the last bell in local storage, and survives without it", () => {
    expect(lastRung()).toBeNull();
    expect(() => markRung(morning)).not.toThrow();

    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    markRung(morning);
    expect(storage.getItem(BELL_KEY)).toBe("2026-10-21");
    expect(lastRung()).toBe("2026-10-21");

    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(lastRung()).toBeNull();
    expect(() => markRung(morning)).not.toThrow();
  });

  it("arms on the first gesture of each morning while audio is on", () => {
    const target = new EventTarget();
    Object.assign(target, { localStorage: memoryStorage() });
    vi.stubGlobal("window", target);
    let now = new Date(2026, 9, 21, 8, 0);
    const onRing = vi.fn();
    const disarm = armMorningBell(onRing, () => now);

    target.dispatchEvent(new Event("click"));
    expect(onRing).not.toHaveBeenCalled();

    setSoundEnabled(true);
    target.dispatchEvent(new Event("keyup"));
    expect(onRing).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event("click"));
    expect(onRing).toHaveBeenCalledTimes(1);

    now = new Date(2026, 9, 22, 13, 0);
    target.dispatchEvent(new Event("click"));
    expect(onRing).toHaveBeenCalledTimes(1);
    now = new Date(2026, 9, 23, 7, 30);
    target.dispatchEvent(new Event("click"));
    expect(onRing).toHaveBeenCalledTimes(2);

    const remove = vi.spyOn(target, "removeEventListener");
    disarm();
    expect(remove).toHaveBeenCalledWith("click", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("keyup", expect.any(Function));
    target.dispatchEvent(new Event("click"));
    expect(onRing).toHaveBeenCalledTimes(2);
  });

  it("does nothing on the server", () => {
    expect(armMorningBell(vi.fn())).toBeTypeOf("function");
  });
});

describe("playBell", () => {
  it("stays silent while terminal audio is muted, then strikes three times", () => {
    const audio = fakeAudio();
    const Audio = vi.fn(function () {
      return audio;
    });
    vi.stubGlobal("window", { localStorage: memoryStorage(), AudioContext: Audio });
    expect(playBell()).toBe(0);
    expect(Audio).not.toHaveBeenCalled();

    setSoundEnabled(true);
    expect(playBell()).toBeCloseTo(0.76 + 2.2);
    // Three strikes of seven partials.
    expect(audio.createOscillator).toHaveBeenCalledTimes(21);
  });
});

// ------------------------------------------------------------ bell dispatch

describe("morning bell store", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
    useTerminal.setState({ data: createMockState(NOW), events: [] });
    useMorningBell.setState({
      open: false,
      briefing: null,
      active: null,
      outcome: null,
      voice: null,
    });
  });

  afterEach(() => useMorningBell.getState().stop());

  it("composes a transcript only while audio is muted", () => {
    const speech = fakeSpeech();
    vi.stubGlobal("window", {
      localStorage: storage,
      speechSynthesis: speech.synth,
      SpeechSynthesisUtterance: FakeUtterance,
    });
    useMorningBell.getState().ring();
    const bell = useMorningBell.getState();
    expect(bell.outcome).toBe("muted");
    expect(bell.active).toBeNull();
    expect(bell.briefing?.segments.length).toBeGreaterThan(5);
    expect(speech.synth.speak).not.toHaveBeenCalled();
    expect(storage.getItem(BELL_KEY)).not.toBeNull();
    expect(useTerminal.getState().events[0].text).toContain("audio muted");
  });

  it("rings, then dispatches every segment to the voice", () => {
    vi.useFakeTimers();
    const speech = fakeSpeech();
    vi.stubGlobal("window", {
      localStorage: storage,
      AudioContext: vi.fn(function () {
        return fakeAudio();
      }),
      speechSynthesis: speech.synth,
      SpeechSynthesisUtterance: FakeUtterance,
    });
    setSoundEnabled(true);
    useMorningBell.getState().ring({ auto: true });
    expect(useMorningBell.getState().active).toBe(-1);
    expect(useTerminal.getState().events[0].text).toMatch(
      /^SYS \/\/ MORNING BELL · first open of the day · \d+ segments dispatched to voice$/,
    );
    expect(speech.synth.speak).not.toHaveBeenCalled();

    vi.advanceTimersByTime(BELL_LEAD_MS);
    const segments = useMorningBell.getState().briefing!.segments;
    expect(speech.spoken).toHaveLength(segments.length);
    expect(useMorningBell.getState().voice).toBe("Samantha");

    speech.spoken[0].onstart!();
    expect(useMorningBell.getState().active).toBe(0);
    for (const u of speech.spoken) {
      u.onstart!();
      u.onend!();
    }
    expect(useMorningBell.getState()).toMatchObject({ active: null, outcome: "spoken" });
  });

  it("stops on air, or before the bell finishes", () => {
    vi.useFakeTimers();
    const speech = fakeSpeech();
    vi.stubGlobal("window", {
      localStorage: storage,
      speechSynthesis: speech.synth,
      SpeechSynthesisUtterance: FakeUtterance,
    });
    setSoundEnabled(true);

    useMorningBell.getState().ring();
    useMorningBell.getState().stop();
    expect(useMorningBell.getState()).toMatchObject({ active: null, outcome: "stopped" });
    vi.advanceTimersByTime(BELL_LEAD_MS);
    expect(speech.synth.speak).not.toHaveBeenCalled();

    useMorningBell.getState().ring();
    vi.advanceTimersByTime(BELL_LEAD_MS);
    speech.spoken[0].onstart!();
    useMorningBell.getState().stop();
    expect(useMorningBell.getState()).toMatchObject({ active: null, outcome: "stopped" });
  });

  it("falls back to the transcript without a speech engine", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { localStorage: storage });
    setSoundEnabled(true);
    useMorningBell.getState().ring();
    vi.advanceTimersByTime(BELL_LEAD_MS);
    expect(useMorningBell.getState()).toMatchObject({
      active: null,
      outcome: "voiceless",
      voice: null,
    });
  });

  it("needs a book to brief", () => {
    useTerminal.setState({ data: null });
    useMorningBell.getState().ring();
    expect(useMorningBell.getState().briefing).toBeNull();
  });

  it("opens the transcript and rings only when idle", () => {
    vi.stubGlobal("window", { localStorage: storage });
    openMorningBell();
    expect(useMorningBell.getState().open).toBe(true);
    expect(useMorningBell.getState().outcome).toBe("muted");

    const ring = vi.spyOn(useMorningBell.getState(), "ring");
    useMorningBell.setState({ active: 2 });
    openMorningBell();
    expect(ring).not.toHaveBeenCalled();
  });

  it("renders an idle bell key and no transcript before it opens", () => {
    expect(renderToStaticMarkup(createElement(BellKey))).toContain("BELL");
    expect(renderToStaticMarkup(createElement(MorningBellModal))).toBe("");
  });
});
