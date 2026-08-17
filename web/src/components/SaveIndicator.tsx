export type SaveState = "idle" | "saving" | "saved" | "failed";

export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const label = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save failed";
  return <div className={`save-indicator ${state}`} role="status" aria-live="polite"><i />{label}</div>;
}

