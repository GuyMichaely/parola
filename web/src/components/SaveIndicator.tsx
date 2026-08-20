import { useEffect, useState } from "react";
import { readSyncStatus, subscribeSyncStatus } from "../storage";

export type SaveState = "idle" | "saving" | "saved" | "failed";

export function SaveIndicator({ state }: { state: SaveState }) {
  const [sync, setSync] = useState(readSyncStatus);

  useEffect(() => subscribeSyncStatus(setSync), []);

  if (state === "saving") return <div className="save-indicator saving" role="status" aria-live="polite"><i />Saving…</div>;
  if (state === "failed") return <div className="save-indicator failed" role="status" aria-live="polite"><i />Save failed</div>;

  if (sync.status !== "local") {
    const visualState = sync.status === "synced"
      ? "saved"
      : sync.status === "checking" || sync.status === "syncing"
        ? "saving"
        : "idle";
    return <div className={`save-indicator ${visualState}`} role="status" aria-live="polite"><i />{sync.message}</div>;
  }

  if (state === "saved") return <div className="save-indicator saved" role="status" aria-live="polite"><i />Saved</div>;
  return null;
}
