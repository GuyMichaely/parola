export type ScopeMode = "all" | "only" | "exclude";

export type StudyScopeOption = {
  key: string;
  label: string;
  kind: "type" | "set" | "deck" | "tag";
};

export function StudyScope({
  mode,
  onMode,
  options,
  selected,
  onToggle,
}: {
  mode: ScopeMode;
  onMode: (mode: ScopeMode) => void;
  options: StudyScopeOption[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <section className="scope-panel" aria-label="Study scope">
      <label>
        <span>Study from</span>
        <select value={mode} onChange={(event) => onMode(event.target.value as ScopeMode)}>
          <option value="all">Entire inventory</option>
          <option value="only">Only selected types / decks / sets / tags</option>
          <option value="exclude">Everything except selected types / decks / sets / tags</option>
        </select>
      </label>
      {mode !== "all" && (
        <div className="set-picker">
          {options.length ? options.map((option) => (
            <button key={option.key} className={`${option.kind} ${selected.includes(option.key) ? "selected" : ""}`} aria-pressed={selected.includes(option.key)} onClick={() => onToggle(option.key)}>{option.kind === "type" ? "Type · " : option.kind === "deck" ? "Deck · " : option.kind === "tag" ? "Tag · " : "Set · "}{option.label}</button>
          )) : <span className="no-sets">No study scopes available.</span>}
        </div>
      )}
    </section>
  );
}

