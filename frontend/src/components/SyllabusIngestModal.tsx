"use client";

import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { create } from "zustand";
import { Key, Spinner, useEscape, useRestoreFocus } from "@/components/ui";
import { useNow } from "@/hooks/useNow";
import { API_BASE, ApiError, api } from "@/lib/api";
import {
  SYLLABUS_ACCEPT,
  SYLLABUS_MAX_BYTES,
  SYLLABUS_MAX_CHARS,
  SYLLABUS_MIN_CHARS,
  classifySyllabusFile,
  encodeSyllabusFile,
  formatBytes,
  type SyllabusFileKind,
} from "@/lib/syllabus";
import { isRemote, useTerminal } from "@/store/terminal";

/** Opened from the top bar and the command palette. */
export const useSyllabusIngest = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

export function SyllabusIngestModal() {
  const open = useSyllabusIngest((s) => s.open);
  const setOpen = useSyllabusIngest((s) => s.setOpen);
  if (!open) return null;
  return <IngestDialog onClose={() => setOpen(false)} />;
}

interface Staged {
  file: File;
  kind: Exclude<SyllabusFileKind, "text">;
  mimeType: string;
}

const KIND_TAG: Record<Staged["kind"], string> = {
  image: "IMG",
  document: "DOC",
};

/** Plain-language failure for the dialog; the raw cause still lands in the log. */
export function describeIngestError(error: unknown): string {
  if (!(error instanceof ApiError)) return (error as Error).message;
  switch (error.kind) {
    case "network":
      return `Cannot reach the Apex backend at ${API_BASE}. Start it, then ingest again.`;
    case "timeout":
      return "Extraction ran past 90s. Try a tighter crop, fewer pages, or paste the grading section as text.";
    case "parse":
      return `The backend answered, but not with a course book (${error.message}).`;
    case "http":
      return error.status === 404
        ? "This backend has no syllabus ingest endpoint yet (HTTP 404)."
        : `Extraction failed: ${error.message}.`;
  }
}

/** Seconds since it mounted, i.e. since the extraction started. */
function Elapsed() {
  const [since] = useState(() => Date.now());
  const now = useNow(1000);
  return <span>{Math.max(0, Math.round((now - since) / 1000))}s</span>;
}

function IngestDialog({ onClose }: { onClose: () => void }) {
  const remote = useTerminal((s) => isRemote(s.mode));
  const pinned = useTerminal((s) => s.simulationPinned);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child crossed; count to know when the pointer truly left.
  const depth = useRef(0);
  useRestoreFocus();
  useEscape(onClose);

  const pasted = text.trim();
  const ready =
    (staged !== null || pasted.length >= SYLLABUS_MIN_CHARS) &&
    pasted.length <= SYLLABUS_MAX_CHARS;

  const stage = async (file: File | undefined) => {
    if (!file || busy) return;
    const verdict = classifySyllabusFile(file);
    if (!verdict.ok) {
      setError(verdict.error);
      return;
    }
    setError(null);
    if (verdict.kind === "text") {
      // Text files go straight into the paste buffer, where they can be trimmed first.
      setText(await file.text());
      return;
    }
    setStaged({ file, kind: verdict.kind, mimeType: verdict.mimeType });
  };

  const onDrag = (event: DragEvent) => {
    event.preventDefault();
    if (busy) return;
    if (event.type === "dragenter") depth.current += 1;
    if (event.type === "dragleave") depth.current -= 1;
    setDragging(depth.current > 0);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    void stage(event.dataTransfer.files[0]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!ready) {
      setError(
        pasted.length > SYLLABUS_MAX_CHARS
          ? `That is ${pasted.length.toLocaleString()} characters; the limit is ${SYLLABUS_MAX_CHARS.toLocaleString()}. Keep the grading and schedule sections.`
          : pasted
            ? `That is ${pasted.length} characters; paste the full syllabus (grading weights, deliverables, due dates).`
            : "Drop a syllabus photo or document, or paste its text.",
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const file = staged
        ? await encodeSyllabusFile(staged.file, staged.mimeType)
        : undefined;
      const state = await api.ingestSyllabus({ text: pasted, file });
      await useTerminal.getState().hydrateFromSyllabus(state);
      onClose();
    } catch (failure) {
      setError(describeIngestError(failure));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[10vh]"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose()
      }
      // A file dropped beside the dialog must not navigate the tab away.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="syllabus-title"
        aria-busy={busy}
        onSubmit={submit}
        // Keep the workstation's single-key hotkeys (J/K/T/M) out of the dialog; Escape still closes.
        onKeyDown={(event) => event.key !== "Escape" && event.stopPropagation()}
        onDragEnter={onDrag}
        onDragOver={onDrag}
        onDragLeave={onDrag}
        onDrop={onDrop}
        onPaste={(event) => {
          const file = event.clipboardData.files[0];
          if (!file) return;
          event.preventDefault();
          void stage(file);
        }}
        className="w-full max-w-[600px] border border-line-strong bg-panel shadow-2xl shadow-black"
      >
        <h2
          id="syllabus-title"
          className="flex items-center justify-between border-b border-line bg-head px-2.5 py-1 text-[11px] tracking-wider text-accent uppercase"
        >
          <span>SYLLABUS INGEST // MULTIMODAL EXTRACTION</span>
          <span className="text-ink-3">ESC</span>
        </h2>

        <fieldset disabled={busy} className="flex flex-col gap-3 px-3 py-3">
          {staged ? (
            <div className="flex items-center gap-3 border border-up/40 bg-up/5 px-2.5 py-2 text-[12px]">
              <span className="shrink-0 border border-up/50 px-1 text-[10px] text-up">
                {KIND_TAG[staged.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">
                {staged.file.name}
              </span>
              <span className="shrink-0 text-ink-3 tabular-nums">
                {formatBytes(staged.file.size)}
              </span>
              <Key tone="down" onClick={() => setStaged(null)}>
                REMOVE
              </Key>
            </div>
          ) : (
            <button
              type="button"
              autoFocus
              onClick={() => picker.current?.click()}
              aria-describedby="syllabus-formats"
              className={`flex flex-col items-center gap-1 border border-dashed px-3 py-5 text-center transition-colors duration-100 outline-none focus-visible:border-accent ${
                dragging
                  ? "border-accent bg-accent/10"
                  : "border-line-strong hover:border-ink-3 hover:bg-hover"
              }`}
            >
              <span
                className={`text-[12px] tracking-wider uppercase ${dragging ? "text-accent" : "text-ink"}`}
              >
                {dragging
                  ? "▼ RELEASE TO STAGE"
                  : "DROP SYLLABUS PHOTO OR DOCUMENT"}
              </span>
              <span id="syllabus-formats" className="text-[10px] text-ink-3">
                PNG · JPG · WEBP · PDF · TXT — MAX{" "}
                {formatBytes(SYLLABUS_MAX_BYTES)} · CLICK TO BROWSE · CTRL+V AN
                IMAGE
              </span>
            </button>
          )}
          <input
            ref={picker}
            type="file"
            accept={SYLLABUS_ACCEPT}
            className="hidden"
            tabIndex={-1}
            onChange={(event) => {
              void stage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          <label className="flex flex-col gap-1">
            <span className="flex justify-between text-[10px] tracking-wider text-ink-3 uppercase">
              <span>{staged ? "Notes for the extractor" : "Or paste syllabus text"}</span>
              <span className="tabular-nums">
                {pasted.length.toLocaleString()} CH
              </span>
            </span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={staged ? 3 : 8}
              spellCheck={false}
              placeholder={
                staged
                  ? "Optional: e.g. ignore the lab section, final is cumulative"
                  : "Grading: Midterm 25%, Final 35%, Problem sets 30%…\nPS1 due Sep 12 · Midterm Oct 17 · …"
              }
              className="resize-y border border-line-strong bg-canvas px-2 py-1.5 text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-accent"
            />
          </label>

          <p className="text-[10px] tracking-wider text-ink-3 uppercase">
            Extracts → courses · grade weights · deliverables · due dates ·
            rubric criteria
          </p>

          {busy && (
            <p
              role="status"
              className="flex items-center gap-2 text-[11px] text-accent"
            >
              <Spinner />
              <span>
                EXTRACTING {staged ? KIND_TAG[staged.kind] : "TEXT"} VIA{" "}
                {API_BASE.replace(/^https?:\/\//, "")}
              </span>
              <span className="ml-auto text-ink-3 tabular-nums">
                <Elapsed />
              </span>
            </p>
          )}
          {error && (
            <p role="alert" className="text-[11px] text-down">
              {error}
            </p>
          )}
          {!busy && (!remote || pinned) && (
            <p className="text-[11px] text-ink-3">
              {pinned
                ? "The simulation desk is pinned; a successful ingest returns the terminal to backend data."
                : `The backend looks offline. Ingest needs it at ${API_BASE}; a successful extraction relinks the terminal.`}
            </p>
          )}
        </fieldset>

        <div className="flex items-center justify-end gap-1.5 border-t border-line px-3 py-2">
          <Key onClick={onClose}>{busy ? "CLOSE" : "CANCEL"}</Key>
          <Key tone="accent" type="submit" disabled={busy}>
            {busy ? (
              <>
                EXTRACTING&nbsp;
                <Spinner />
              </>
            ) : (
              "INGEST & HYDRATE"
            )}
          </Key>
        </div>
      </form>
    </div>
  );
}
