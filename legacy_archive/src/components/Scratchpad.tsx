import { useState } from "react";
import {
  StickyNote,
  Sparkles,
  ArrowUpRight,
  ArrowRight,
  Plus,
  LoaderCircle,
  Check,
  WandSparkles,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useWorkspace } from "../store";
import { localBreakdown } from "../lib/goals";
import { useAIEngine } from "../lib/ai";
import type { Breakdown } from "../types";
import { Widget, Badge } from "./ui";
export function Scratchpad() {
  const note = useWorkspace((s) => s.scratchpad),
    setNote = useWorkspace((s) => s.setScratchpad);
  const [preview, setPreview] = useState(false);
  return (
    <Widget id="scratchpad" title="Scratchpad" icon={StickyNote}>
      <div className="scratch-toolbar">
        <span className="subtle">A place for the thoughts in between.</span>
        <div className="segmented">
          <button
            className={!preview ? "active" : ""}
            onClick={() => setPreview(false)}
          >
            Write
          </button>
          <button
            className={preview ? "active" : ""}
            onClick={() => setPreview(true)}
          >
            Preview
          </button>
        </div>
      </div>
      {preview ? (
        <div className="markdown-preview">
          <ReactMarkdown>{note}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          className="scratch-textarea"
          aria-label="Markdown scratchpad"
          maxLength={2_000_000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Make a little room for your thoughts…"
          spellCheck={false}
        />
      )}
      <div className="widget-footer">
        <span>
          <Check size={11} />
          Saved automatically
        </span>
        <span className="subtle mono">MARKDOWN</span>
      </div>
    </Widget>
  );
}
export function Deconstructor({
  toast,
  onOpenSprint,
}: {
  toast: (message: string) => void;
  onOpenSprint: () => void;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [breakdown, setBreakdown] = useState<Breakdown>(),
    [parentId, setParentId] = useState(""),
    [error, setError] = useState("");
  const goals = useWorkspace((s) => s.goals),
    add = useWorkspace((s) => s.addBreakdown);
  const decompose = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    useAIEngine.getState().start();
    let reported = false;
    try {
      const response = await fetch("/api/decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      useAIEngine.getState().finish(data.telemetry ?? null, !response.ok);
      reported = true;
      if (!response.ok)
        throw new Error(data.error || "Could not generate a breakdown.");
      setBreakdown(data);
    } catch {
      if (!reported) useAIEngine.getState().finish(null, true);
      setBreakdown(localBreakdown(text));
      setError("AI is unavailable. Here’s an editable starter plan.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Widget
      id="deconstructor"
      title="Task deconstructor"
      icon={Sparkles}
      suffix={<Badge color="violet">APEX INTELLIGENCE</Badge>}
    >
      <div className="deconstructor-intro">
        <WandSparkles size={20} />
        <div>
          <h3>Big task? Find your first small step.</h3>
          <p>Drop in an assignment, a brief, or just an idea.</p>
        </div>
      </div>
      {!breakdown ? (
        <>
          <div className="deconstructor-input">
            <textarea
              value={text}
              maxLength={12000}
              onChange={(e) => setText(e.target.value)}
              placeholder="What are you working on? Paste the details here…"
              aria-label="Task to break down"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void decompose();
                }
              }}
            />
            <button
              className="decompose-button"
              disabled={busy || !text.trim()}
              onClick={() => void decompose()}
            >
              {busy ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Break it down
              <ArrowRight size={13} />
            </button>
          </div>
          <p className="deconstructor-hint">
            <span>Clarity in. Action out.</span>
            <span className="mono">⌘ / CTRL + ↵</span>
          </p>
        </>
      ) : (
        <div className="breakdown-result">
          <div className="breakdown-title">
            <h3>{breakdown.title}</h3>
            <Badge color={breakdown.source === "ai" ? "violet" : "muted"}>
              {breakdown.source === "ai"
                ? "AI generated"
                : "Starter plan · local"}
            </Badge>
          </div>
          {breakdown.tasks.map((task, i) => (
            <div className="breakdown-task" key={i}>
              <span className="breakdown-number mono">0{i + 1}</span>
              <input
                aria-label={`Breakdown step ${i + 1}`}
                value={task.title}
                onChange={(e) =>
                  setBreakdown({
                    ...breakdown,
                    tasks: breakdown.tasks.map((t, j) =>
                      i === j ? { ...t, title: e.target.value } : t,
                    ),
                  })
                }
              />
              <span className="mono subtle">{task.minutes}m</span>
            </div>
          ))}
          {error && <p className="input-help">{error}</p>}
          <div className="breakdown-actions">
            <select
              aria-label="Link breakdown to a goal"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">Standalone sprint</option>
              {goals
                .filter((g) => g.kind === "macro" && !g.archived)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
            </select>
            <button
              className="button primary"
              disabled={breakdown.tasks.some((t) => !t.title.trim())}
              onClick={() => {
                add(breakdown, parentId || undefined);
                setBreakdown(undefined);
                setText("");
                toast("Three actionable steps added to your sprint");
                onOpenSprint();
              }}
            >
              <Plus size={13} />
              Add to sprint
            </button>
          </div>
          <button className="text-link" onClick={() => setBreakdown(undefined)}>
            Start again
            <ArrowUpRight size={12} />
          </button>
        </div>
      )}
    </Widget>
  );
}
