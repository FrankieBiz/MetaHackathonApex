import { useState, useSyncExternalStore } from "react";
import {
  Link2,
  Upload,
  ShieldCheck,
  RefreshCw,
  Check,
  LoaderCircle,
  UserRound,
  ExternalLink,
  CalendarDays,
  Download,
  Database,
} from "lucide-react";
import { useWorkspace } from "../store";
import {
  downloadFile,
  parseBackup,
  serializeBackup,
  type WorkspaceData,
} from "../lib/workspace";
import { storageStatus, recoveryData } from "../lib/persistence";
import { parseCalendar } from "../lib/calendar";
import type { CanvasAssignment, ScheduleEvent } from "../types";
import { Modal, Badge } from "./ui";
export type SyncResult = {
  assignments: CanvasAssignment[];
  events: ScheduleEvent[];
};
export function Settings({
  onClose,
  toast,
  onSubscribe,
}: {
  onClose: () => void;
  toast: (message: string) => void;
  onSubscribe: (url: string) => void;
}) {
  const connection = useWorkspace((s) => s.connection),
    name = useWorkspace((s) => s.name),
    setName = useWorkspace((s) => s.setName),
    importData = useWorkspace((s) => s.importData),
    restore = useWorkspace((s) => s.restore),
    initialize = useWorkspace((s) => s.initialize);
  const status = useSyncExternalStore(
    storageStatus.subscribe,
    storageStatus.get,
  );
  const [pendingBackup, setPendingBackup] = useState<WorkspaceData>();
  const [confirmReset, setConfirmReset] = useState(false);
  const [tab, setTab] = useState<"calendar" | "canvas" | "workspace">(
      "calendar",
    ),
    [url, setUrl] = useState(""),
    [domain, setDomain] = useState(connection.domain),
    [token, setToken] = useState(""),
    [displayName, setDisplayName] = useState(name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = (data: SyncResult, kind: "ical" | "canvas") => {
    importData(data.assignments, data.events, {
      domain: kind === "canvas" ? domain : "",
      kind,
      lastSynced: new Date().toISOString(),
    });
    toast(
      `Synced ${data.assignments.length} assignments and ${data.events.length} events`,
    );
  };
  const sync = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        tab === "canvas" ? "/api/canvas" : "/api/calendar",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tab === "canvas" ? { domain, token } : { url }),
          signal: AbortSignal.timeout(55_000),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sync failed.");
      save(data, tab === "canvas" ? "canvas" : "ical");
      if (tab === "calendar") onSubscribe(url);
      setToken("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not sync. Make sure the API server is running.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Workspace settings" onClose={onClose} wide>
      <div className="settings-tabs tabs">
        <button
          className={tab === "calendar" ? "active" : ""}
          onClick={() => {
            setTab("calendar");
            setError("");
          }}
        >
          <CalendarDays size={14} />
          Calendar feed
        </button>
        <button
          className={tab === "canvas" ? "active" : ""}
          onClick={() => {
            setTab("canvas");
            setError("");
          }}
        >
          <Link2 size={14} />
          Canvas API
        </button>
        <button
          className={tab === "workspace" ? "active" : ""}
          onClick={() => {
            setTab("workspace");
            setError("");
          }}
        >
          <UserRound size={14} />
          Workspace & backups
        </button>
      </div>
      <div className="form-body">
        {tab === "calendar" ? (
          <>
            <div className="settings-intro">
              <div className="goal-icon emerald">
                <CalendarDays size={20} />
              </div>
              <div>
                <h3>Your deadlines, in one place.</h3>
                <p>Connect your Canvas iCal feed or import a calendar file.</p>
              </div>
            </div>
            <label>
              Calendar subscription URL
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://school.instructure.com/feeds/calendars/…"
              />
            </label>
            <p className="input-help">
              In Canvas, open Calendar → Calendar Feed and copy the subscription
              link. The feed refreshes every 15 minutes while this workspace is
              open.
            </p>
            <button
              className="button primary"
              disabled={busy || !url.trim()}
              onClick={() => void sync()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              Connect & sync
            </button>
            <div className="divider-label">
              <span>or import a file</span>
            </div>
            <label className="file-upload">
              <Upload size={22} />
              <strong>Choose an .ics calendar</strong>
              <span>
                Events, deadlines, and recurring commitments · up to 2 MB
              </span>
              <input
                type="file"
                accept=".ics,text/calendar"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setError("");
                  try {
                    if (file.size > 2_000_000)
                      throw new Error("Maximum calendar size is 2 MB.");
                    save(parseCalendar(await file.text()), "ical");
                  } catch (err) {
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Invalid calendar file.",
                    );
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </>
        ) : tab === "canvas" ? (
          <>
            <div className="settings-intro">
              <div className="goal-icon violet">
                <Link2 size={20} />
              </div>
              <div>
                <h3>A direct line to your coursework.</h3>
                <p>
                  Import assignments, point values, descriptions, and rubrics.
                </p>
              </div>
            </div>
            <label>
              Canvas domain
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="school.instructure.com"
                autoComplete="off"
              />
            </label>
            <label>
              Personal access token
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your Canvas token"
                autoComplete="off"
              />
            </label>
            <p className="input-help">
              Create a token in Canvas → Account → Settings → Approved
              Integrations. The token is used for this sync and is never saved.
            </p>
            <div className="privacy-note">
              <ShieldCheck size={17} />
              <span>
                Your token stays out of browser storage. The server only uses it
                to contact your Canvas domain.
              </span>
            </div>
            <button
              className="button primary"
              disabled={busy || !domain.trim() || !token.trim()}
              onClick={() => void sync()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              Sync Canvas
            </button>
            <a
              href="https://community.canvaslms.com/t5/Student-Guide/How-do-I-manage-API-access-tokens-in-my-user-account/ta-p/273"
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              Canvas token guide
              <ExternalLink size={12} />
            </a>
          </>
        ) : (
          <>
            <label>
              Your first name
              <input
                maxLength={30}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
              />
            </label>
            <p className="input-help">
              Your layout, goals, and notes save automatically on this device.
              Clock timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
              .
            </p>
            <div className="settings-status">
              <Check size={16} />
              <span>
                {status === "error"
                  ? "Storage unavailable. Export a backup to keep your changes."
                  : status === "saving"
                    ? "Saving workspace…"
                    : "Workspace saved on this browser"}
              </span>
              <Badge color={status === "error" ? "rose" : "emerald"}>
                {status === "error" ? "Needs backup" : "Active"}
              </Badge>
            </div>
            <button
              className="button primary"
              disabled={!displayName.trim()}
              onClick={() => {
                setName(displayName.trim());
                toast("Workspace personalized");
                onClose();
              }}
            >
              Save preferences
            </button>
            <div className="divider-label">
              <span>Your workspace, always portable</span>
            </div>
            <div className="settings-intro">
              <div className="goal-icon cyan">
                <Database size={20} />
              </div>
              <div>
                <h3>Keep a copy of your progress.</h3>
                <p>
                  Backups include goals, history, notes, deadlines, and layouts.
                  You can restore them in another browser or on another device.
                </p>
              </div>
            </div>
            <button
              className="button secondary"
              onClick={() => {
                downloadFile(
                  serializeBackup(useWorkspace.getState()),
                  `apex-os-backup-${new Date().toISOString().slice(0, 10)}.json`,
                );
                toast("Workspace backup downloaded");
              }}
            >
              <Download size={14} />
              Export workspace backup
            </button>
            <label className="file-upload">
              <Upload size={20} />
              <strong>Restore an Apex OS backup</strong>
              <span>Choose a .json file · up to 10 MB</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setError("");
                  try {
                    if (file.size > 10_000_000)
                      throw new Error("Maximum backup size is 10 MB.");
                    setPendingBackup(parseBackup(await file.text()));
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Invalid backup.",
                    );
                  }
                  e.target.value = "";
                }}
              />
            </label>
            {pendingBackup && (
              <div className="restore-confirm" role="alert">
                <strong>Restore {pendingBackup.name}’s workspace?</strong>
                <p>
                  {pendingBackup.goals.length} goals ·{" "}
                  {pendingBackup.assignments.length} assignments ·{" "}
                  {pendingBackup.events.length} calendar events. This replaces
                  your current workspace. Export a backup above first.
                </p>
                <div className="confirmation-actions">
                  <button
                    className="button secondary"
                    onClick={() => setPendingBackup(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    className="button primary"
                    onClick={() => {
                      restore(pendingBackup);
                      onSubscribe("");
                      toast("Workspace restored. Your focus timer is paused.");
                      onClose();
                    }}
                  >
                    Replace & restore
                  </button>
                </div>
              </div>
            )}
            {recoveryData && (
              <button
                className="text-link"
                onClick={() =>
                  downloadFile(recoveryData, "apex-os-recovery.json")
                }
              >
                Download original recovery data
              </button>
            )}
            <div className="goal-management">
              <span className="input-help">Want a fresh start?</span>
              <button
                className="text-link rose"
                onClick={() => setConfirmReset(true)}
              >
                Clear workspace
              </button>
            </div>
            {confirmReset && (
              <div className="restore-confirm" role="alert">
                <p>
                  Clear all goals, notes, deadlines, and focus history? Export a
                  backup first. This cannot be undone.
                </p>
                <div className="confirmation-actions">
                  <button
                    className="button secondary"
                    onClick={() => setConfirmReset(false)}
                  >
                    Keep workspace
                  </button>
                  <button
                    className="button danger"
                    onClick={() => {
                      initialize(name, false);
                      onSubscribe("");
                      toast("A fresh workspace is ready");
                      onClose();
                    }}
                  >
                    Clear everything
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-connection">
          <span
            className={`tiny-dot ${["sample", "none"].includes(connection.kind) ? "amber" : "emerald"}`}
          />
          {connection.kind === "none"
            ? "Calendar and Canvas are ready to connect"
            : connection.kind === "sample"
              ? "Currently using sample data"
              : `Connected via ${connection.kind === "canvas" ? "Canvas API" : "iCalendar"}`}
        </div>
      </div>
    </Modal>
  );
}
