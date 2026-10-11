import { useState } from "react";
import { ArrowUpRight, Layers, Sparkles, ShieldCheck } from "lucide-react";
import { useWorkspace } from "../store";
import { downloadFile, parseBackup } from "../lib/workspace";
import { recoveryData } from "../lib/persistence";
export function Onboarding() {
  const initialize = useWorkspace((s) => s.initialize);
  const restore = useWorkspace((s) => s.restore);
  const [name, setName] = useState("");
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="onboarding-screen">
      <div className="onboarding-card">
        <div className="onboarding-brand">
          <div className="apex-mark">△</div>
          <span>
            APEX <span className="subtle">OS</span>
          </span>
          <span className="edition-label">PERSONAL OPERATING SYSTEM</span>
        </div>
        <span className="eyebrow emerald">YOUR NEXT CHAPTER STARTS HERE</span>
        <h1>
          A little clarity.
          <br />
          <span>Extraordinary possibilities.</span>
        </h1>
        <p className="onboarding-intro">
          One workspace for your ambitions, deadlines, and daily momentum. Make
          it yours.
        </p>
        {recoveryData && (
          <div className="restore-confirm">
            <p>
              Your previous workspace could not be opened. Download the recovery
              file before starting fresh.
            </p>
            <button
              className="button secondary"
              onClick={() =>
                downloadFile(recoveryData, "apex-os-recovery.json")
              }
            >
              Download recovery file
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) initialize(name, demo);
          }}
        >
          <label>
            Your first name
            <input
              autoFocus
              required
              maxLength={30}
              placeholder="How should we greet you?"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="onboarding-options">
            <button
              type="button"
              aria-pressed={!demo}
              className={`onboarding-option ${!demo ? "selected" : ""}`}
              onClick={() => setDemo(false)}
            >
              <Layers size={19} />
              <strong>Start with a clean slate</strong>
              <span>Your goals. Your schedule. Ready to build.</span>
            </button>
            <button
              type="button"
              aria-pressed={demo}
              className={`onboarding-option ${demo ? "selected" : ""}`}
              onClick={() => setDemo(true)}
            >
              <Sparkles size={19} />
              <strong>Explore a demo workspace</strong>
              <span>Editable examples to see what’s possible.</span>
            </button>
          </div>
          <button
            className="button primary onboarding-submit"
            disabled={!name.trim()}
          >
            Open my workspace
            <ArrowUpRight size={16} />
          </button>
        </form>
        <div className="onboarding-bottom">
          <span>
            <ShieldCheck size={14} />
            Saved on this browser. Back up anytime.
          </span>
          <label className="text-link restore-link">
            Restore a backup
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 10_000_000)
                    throw new Error("Maximum backup size is 10 MB.");
                  restore(parseBackup(await file.text()));
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "Invalid backup.",
                  );
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <span className="onboarding-footnote mono">
        LESS NOISE. MORE MOMENTUM.
      </span>
    </main>
  );
}
