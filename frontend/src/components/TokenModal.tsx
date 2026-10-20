"use client";

import { useState, type FormEvent } from "react";
import { Key, useRestoreFocus } from "@/components/ui";
import { API_BASE } from "@/lib/api";
import { isRemote, useTerminal } from "@/store/terminal";

const DEFAULT_CANVAS = "https://canvas.instructure.com";

export function TokenModal() {
  const open = useTerminal((s) => s.tokenOpen);
  const setOpen = useTerminal((s) => s.setTokenOpen);
  if (!open) return null;
  return <TokenDialog onClose={() => setOpen(false)} />;
}

function TokenDialog({ onClose }: { onClose: () => void }) {
  const credentials = useTerminal((s) => s.credentials);
  const remote = useTerminal((s) => isRemote(s.mode));
  const setCredentials = useTerminal((s) => s.setCredentials);
  const sync = useTerminal((s) => s.sync);
  const [baseUrl, setBaseUrl] = useState(
    credentials?.baseUrl ?? DEFAULT_CANVAS,
  );
  const [token, setToken] = useState(credentials?.token ?? "");
  const [error, setError] = useState<string | null>(null);
  useRestoreFocus();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let url: URL;
    try {
      url = new URL(baseUrl.trim());
    } catch {
      setError(
        "Enter the full Canvas address, for example https://school.instructure.com.",
      );
      return;
    }
    if (url.protocol !== "https:") {
      setError("Canvas must be reached over https.");
      return;
    }
    if (token.trim().length < 16) {
      setError(
        "That token looks too short. Copy the full token from Canvas → Account → Settings.",
      );
      return;
    }
    setCredentials({ token: token.trim(), baseUrl: url.origin });
    onClose();
    void sync();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[14vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-title"
        onSubmit={submit}
        className="w-full max-w-[520px] border border-line-strong bg-panel shadow-2xl shadow-black"
      >
        <h2
          id="token-title"
          className="border-b border-line bg-head px-2.5 py-1 text-[11px] tracking-wider text-accent uppercase"
        >
          TOKEN CONFIG // CANVAS API
        </h2>
        <div className="flex flex-col gap-3 px-3 py-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] tracking-wider text-ink-3 uppercase">
              Canvas address
            </span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              className="h-7 border border-line-strong bg-canvas px-2 text-[12px] text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] tracking-wider text-ink-3 uppercase">
              Access token
            </span>
            <input
              autoFocus
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Canvas → Account → Settings → New access token"
              className="h-7 border border-line-strong bg-canvas px-2 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
            />
          </label>
          {error && (
            <p role="alert" className="text-[11px] text-down">
              {error}
            </p>
          )}
          <p className="text-[11px] text-ink-3">
            The token stays in this tab&apos;s memory and is sent only to the
            Apex backend at <span className="text-ink-2">{API_BASE}</span>.
            Reloading the page clears it.
            {!remote &&
              " The backend is offline right now; the sync will retry when you press Sync now."}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
          <div>
            {credentials && (
              <Key
                tone="down"
                onClick={() => {
                  setCredentials(null);
                  setToken("");
                }}
              >
                CLEAR TOKEN
              </Key>
            )}
          </div>
          <div className="flex gap-1.5">
            <Key onClick={onClose}>CANCEL</Key>
            <Key tone="accent" type="submit">
              SAVE &amp; SYNC
            </Key>
          </div>
        </div>
      </form>
    </div>
  );
}
