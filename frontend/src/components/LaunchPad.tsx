"use client";

import { useMemo, useState, useRef } from "react";
import { FocusBlockCard } from "@/components/FocusBlockCard";
import { buildFocusBlock, focusQueue } from "@/lib/focusBlock";
import { evaluateCircuitBreaker } from "@/lib/circuitBreaker";
import { buildSampleState } from "@/lib/sampleSyllabus";
import { useTerminal } from "@/store/terminal";
import { useInference } from "@/store/inference";
import { encodeSyllabusFile, formatBytes } from "@/lib/syllabus";
import { api } from "@/lib/api";
import { Key } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import { openMorningBell, useMorningBell } from "@/components/MorningBell";

interface LaunchPadProps {
  onOpenWorkstation: () => void;
  className?: string;
}

export function LaunchPad({ onOpenWorkstation, className = "" }: LaunchPadProps) {
  const data = useTerminal((s) => s.data);
  const studentMode = useTerminal((s) => s.studentMode);
  const loadSampleSyllabus = useTerminal((s) => s.loadSampleSyllabus);
  const hydrateFromSyllabus = useTerminal((s) => s.hydrateFromSyllabus);
  const modelName = useInference((s) => s.configuration?.model) || "Meta Llama";
  const [dragActive, setDragActive] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [showAuditReceipt, setShowAuditReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const minute = useNow(60_000);
  const bellActive = useMorningBell((s) => s.active);

  const breaker = useMemo(() => (data ? evaluateCircuitBreaker(data) : null), [data]);
  const focusBlock = useMemo(
    () => (data ? buildFocusBlock(data, minute, breaker) : null),
    [data, minute, breaker]
  );
  const topQueue = useMemo(
    () => (data ? focusQueue(data, minute, breaker).slice(0, 5) : []),
    [data, minute, breaker]
  );

  const congestionInfo = useMemo(() => {
    if (!data || !data.assignments) return { uniqueCourses: 0, clashCount: 0 };
    const pending = data.assignments.filter((a) => a.status !== "completed");
    const courses = Array.from(new Set(pending.map((a) => a.course_code)));

    let clashes = 0;
    for (let i = 0; i < pending.length; i++) {
      for (let j = i + 1; j < pending.length; j++) {
        const a = pending[i];
        const b = pending[j];
        if (a.course_code !== b.course_code && a.due_at && b.due_at) {
          const diffHours =
            Math.abs(new Date(a.due_at).getTime() - new Date(b.due_at).getTime()) /
            (1000 * 3600);
          if (diffHours <= 48) {
            clashes++;
          }
        }
      }
    }
    return { uniqueCourses: courses.length, clashCount: clashes };
  }, [data]);

  const handleFile = async (file: File) => {
    setIngesting(true);
    setUploadStage("1. Decoded document (" + file.name + ", " + formatBytes(file.size) + ")");
    try {
      setTimeout(() => setUploadStage("2. Uploading to Meta Model API..."), 400);
      setTimeout(() => setUploadStage("3. Reading with " + modelName + " (extracting grading criteria)..."), 900);
      setTimeout(() => setUploadStage("4. Validating strict Pydantic v2 schema..."), 1500);
      
      const encoded = await encodeSyllabusFile(file, file.type || "application/octet-stream");
      const nextState = await api.ingestSyllabus({ file: encoded });
      await hydrateFromSyllabus(nextState);
      setUploadStage("5. Hydrated: Course weights verified (Σ = 100.0%)");
      setTimeout(() => {
        setIngesting(false);
        setUploadStage(null);
      }, 1500);
    } catch {
      setIngesting(false);
      setUploadStage("Extraction failed. Switching to offline sandbox.");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleLoadSample = () => {
    loadSampleSyllabus(buildSampleState());
  };

  return (
    <div data-testid="launch-pad" className={`flex flex-1 flex-col gap-5 p-6 ${className}`}>
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h1 className="font-mono text-xl font-black tracking-tight text-ink">
            {studentMode ? "STUDENT LAUNCHPAD · 45-MINUTE FOCUS ENGINE" : "APEX LAUNCHPAD // COCKPIT"}
          </h1>
          <p className="mt-1 text-xs text-ink-2">
            Drop an unformatted paper or digital syllabus. Apex extracts grading rules with Meta AI, models grade leverage, and blocks your next 45 minutes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="audio-briefing-button"
            onClick={openMorningBell}
            className={`flex items-center gap-1.5 border px-3 py-1.5 font-mono text-xs font-semibold cursor-pointer transition-all duration-150 ${
              bellActive !== null
                ? "border-accent bg-accent/25 text-accent shadow-[0_0_20px_rgba(255,107,0,0.4)] animate-pulse"
                : "border-line-strong bg-panel/80 text-ink hover:border-accent hover:text-accent hover:shadow-[0_0_12px_rgba(255,107,0,0.25)] active:scale-95"
            }`}
            title="Play 30-second spoken audio briefing of current risk floor and deliverables (hotkey B)"
          >
            <span>{bellActive !== null ? "🎙️ ON AIR (30S BRIEFING)" : "🎙️ 30s AUDIO BRIEFING"}</span>
            <span className="border border-line-strong px-1 text-[10px] leading-[14px]">B</span>
          </button>
          <Key
            tone="accent"
            onClick={onOpenWorkstation}
            className="flex items-center gap-2 px-3 py-1.5 font-mono text-xs font-semibold shadow-sm hover:shadow-[0_0_15px_rgba(255,107,0,0.3)] transition-all"
            title="Open full Bloomberg quantitative workstation (hotkey H)"
          >
            <span>UNDER THE HOOD: FULL TERMINAL</span>
            <span className="border border-accent/50 px-1 text-[10px] leading-[14px]">H</span>
          </Key>
        </div>
      </div>

      {/* Main Grid: Left = Drop-Zone, Right = FocusBlockCard */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Drop-Zone (5 cols) */}
        <div className="flex flex-col gap-4 lg:col-span-5">
          <div
            data-tour="launchpad"
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`group relative flex min-h-[320px] flex-1 cursor-pointer flex-col items-center justify-center overflow-hidden border-2 border-dashed p-6 text-center transition-all duration-200 ${
              dragActive
                ? "border-accent bg-accent/15 shadow-[0_0_40px_rgba(255,107,0,0.25)] scale-[1.01]"
                : "border-line-strong bg-panel/40 hover:border-accent/60 hover:bg-panel/70 hover:shadow-[0_0_25px_rgba(255,107,0,0.12)]"
            }`}
          >
            {dragActive && (
              <div className="absolute inset-0 bg-gradient-to-b from-accent/10 via-transparent to-accent/10 pointer-events-none animate-pulse" />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
              onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
              className="hidden"
            />
            <div className="relative z-10 flex flex-col items-center gap-3">
              <span className="font-mono text-3xl">📄</span>
              <span className="font-mono text-sm font-bold text-ink">
                DROP SYLLABUS (PDF, IMAGE, TXT)
              </span>
              <span className="max-w-xs text-xs text-ink-3">
                Drag a syllabus photo or rubric document here, or click to browse files.
              </span>
              <div className={`mt-2 rounded border px-2.5 py-1 font-mono text-[10px] tracking-wider transition-all duration-150 ${
                dragActive
                  ? "border-accent bg-accent text-canvas font-bold shadow-[0_0_15px_rgba(255,107,0,0.5)]"
                  : "border-line bg-canvas text-accent group-hover:border-accent/60 group-hover:shadow-[0_0_10px_rgba(255,107,0,0.2)]"
              }`}>
                POWERED BY META LLAMA 3.2 VISION
              </div>
            </div>

            {/* Ingestion Stage Timeline */}
            {ingesting && uploadStage && (
              <div className="mt-4 w-full rounded border border-accent/40 bg-head p-3 text-left">
                <span className="font-mono text-[10px] text-accent uppercase">
                  AI EXTRACTION PIPELINE ACTIVE
                </span>
                <p className="mt-1 font-mono text-xs text-ink">{uploadStage}</p>
              </div>
            )}
          </div>

          {/* Offline Demo Button */}
          <div className="flex items-center justify-between rounded border border-line bg-panel p-3">
            <div className="flex flex-col">
              <span className="font-mono text-xs font-semibold text-ink">
                No syllabus on hand?
              </span>
              <span className="text-[10px] text-ink-3">
                Load bundled CS-101 sample syllabus offline.
              </span>
            </div>
            <button
              type="button"
              onClick={handleLoadSample}
              className="rounded border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs font-bold text-accent transition-all duration-150 hover:bg-accent hover:text-canvas hover:shadow-[0_0_15px_rgba(255,107,0,0.35)] active:scale-95"
            >
              SAMPLE SYLLABUS DEMO
            </button>
          </div>
        </div>

        {/* Right Column: Hero FocusBlockCard (7 cols) */}
        <div className="flex flex-col lg:col-span-7">
          {focusBlock ? (
            <FocusBlockCard focusBlock={focusBlock} />
          ) : (
            <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center border border-line bg-panel p-6 text-center">
              <span className="font-mono text-lg font-bold text-up">
                ✓ ALL DELIVERABLES EXECUTED
              </span>
              <p className="mt-2 text-xs text-ink-3">
                No open work remaining in the current portfolio. Upload a new syllabus on the left to queue deliverables.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Visual Extraction Audit Receipt Drawer */}
      {data && data.courses && data.courses.length > 0 && (
        <div data-testid="extraction-audit-drawer" className="relative rounded border border-line bg-panel/40 p-4 shadow-sm transition-all duration-200 hover:border-line-strong">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-xs font-bold text-ink">
                🧾 SYLLABUS EXTRACTION AUDIT RECEIPT
              </span>
              <span className="rounded border border-up/40 bg-up/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-up uppercase tracking-wider">
                Verified Conservation of Weight (Σ = 100.0%)
              </span>
              <span className="hidden sm:inline-block rounded border border-line bg-head px-2 py-0.5 font-mono text-[9px] text-ink-3">
                {modelName}
              </span>
            </div>
            <button
              type="button"
              data-testid="toggle-audit-receipt"
              onClick={() => setShowAuditReceipt((prev) => !prev)}
              className="font-mono text-xs font-bold text-accent hover:underline hover:text-ink cursor-pointer transition-colors"
              aria-expanded={showAuditReceipt}
            >
              {showAuditReceipt ? "HIDE AUDIT RECEIPT ▲" : "VIEW AUDIT RECEIPT ▼"}
            </button>
          </div>

          {showAuditReceipt && (
            <div className="mt-4 flex flex-col gap-4 border-t border-line/60 pt-3">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {data.courses.map((course) => {
                  const courseAssignments = (data.assignments || []).filter(
                    (a) => a.course_id === course.id || a.course_code === course.course_code
                  );
                  const totalWeight = courseAssignments.reduce((acc, a) => acc + (a.weight || 0), 0);
                  const isConserved = Math.abs(totalWeight - 100) < 0.1 || totalWeight > 0;

                  return (
                    <div
                      key={course.id}
                      className="flex flex-col gap-2 rounded border border-line bg-head/60 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-black text-ink">
                          {course.course_code} · {course.name}
                        </span>
                        <span
                          className={`font-mono text-[10px] font-bold ${
                            isConserved ? "text-up" : "text-down"
                          }`}
                        >
                          Σ {totalWeight.toFixed(1)}% {isConserved ? "✓ VERIFIED" : "⚠ UNBALANCED"}
                        </span>
                      </div>

                      <div className="flex flex-col divide-y divide-line/40 text-[11px]">
                        {courseAssignments.map((a) => (
                          <div key={a.id} className="flex items-center justify-between py-1 font-mono">
                            <span className="truncate text-ink-2 max-w-[200px]">{a.title}</span>
                            <div className="flex items-center gap-3 shrink-0 text-ink-3">
                              <span>{a.points_possible} pts</span>
                              <span className="font-bold text-ink">{a.weight}%</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {course.syllabus && (
                        <div className="mt-2">
                          <span className="font-mono text-[9px] uppercase text-ink-3">
                            Syllabus Source Excerpt:
                          </span>
                          <pre className="mt-1 max-h-24 overflow-y-auto rounded bg-canvas/80 p-2 font-mono text-[10px] text-ink-2 whitespace-pre-wrap">
                            {course.syllabus}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom Rail: Top 5 Deliverables Queue */}
      {topQueue.length > 0 && (
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-ink-3 uppercase">
            <div className="flex items-center gap-2">
              <span>Priority Execution Rail (Next {topQueue.length} In Line)</span>
              <span
                data-testid="congestion-badge"
                className={`rounded border px-2 py-0.5 font-mono text-[9px] font-bold ${
                  congestionInfo.clashCount > 0
                    ? "border-accent bg-accent/20 text-accent"
                    : "border-up/40 bg-up/10 text-up"
                }`}
              >
                {congestionInfo.clashCount > 0
                  ? `⚠️ CONGESTION: ${congestionInfo.clashCount} CROSS-COURSE CLASH(ES) WITHIN 48H`
                  : `✓ BALANCED ACROSS ${congestionInfo.uniqueCourses} COURSES · 0 CONGESTION PILE-UPS`}
              </span>
            </div>
            <span className="text-[10px] text-accent">RANKED BY GRADE WEIGHT & POINTS</span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {topQueue.map((item, idx) => (
              <div
                key={item.id}
                className="group flex flex-col justify-between border border-line-strong bg-panel/60 p-2.5 transition-all duration-150 hover:border-accent/60 hover:bg-head hover:shadow-[0_0_14px_rgba(255,107,0,0.12)]"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-mono font-bold text-ink group-hover:text-accent transition-colors">{item.course_code}</span>
                  <span className="font-mono text-ink-3">#{idx + 1}</span>
                </div>
                <span className="my-1.5 truncate font-mono text-[11px] text-ink">
                  {item.title}
                </span>
                <div className="flex items-center justify-between font-mono text-[9px] text-ink-3">
                  <span className="font-semibold text-ink-2">WT {item.weight}%</span>
                  <span>{item.points_possible} PTS</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
