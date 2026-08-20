import { useEffect, useState } from "react";
import type { NounPattern } from "../cards/nounPatterns";

function newPattern(): NounPattern {
  return {
    id: `noun-pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "New noun pattern",
    gender: "masculine",
    singularSuffix: "o",
    pluralSuffix: "i",
    syntax: "full",
  };
}

export function NounPatternsPanel({
  patterns,
  usedPatternIds,
  onSave,
}: {
  patterns: NounPattern[];
  usedPatternIds: Set<string>;
  onSave: (patterns: NounPattern[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<NounPattern[]>(() => patterns.map((pattern) => ({ ...pattern })));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(patterns.map((pattern) => ({ ...pattern })));
  }, [patterns]);

  function updatePattern(id: string, patch: Partial<NounPattern>) {
    setDraft((items) => items.map((pattern) => pattern.id === id ? { ...pattern, ...patch } : pattern));
    setMessage("");
    setError("");
  }

  function removePattern(id: string) {
    if (usedPatternIds.has(id)) {
      setError("That pattern is assigned to one or more cards. Change those cards to another pattern or Manual forms first.");
      return;
    }
    setDraft((items) => items.filter((pattern) => pattern.id !== id));
    setMessage("");
    setError("");
  }

  async function save() {
    const normalized = draft.map((pattern) => ({
      ...pattern,
      name: pattern.name.trim(),
      singularSuffix: pattern.singularSuffix.normalize("NFC").trim(),
      pluralSuffix: pattern.pluralSuffix.normalize("NFC").trim(),
    }));
    if (normalized.some((pattern) => !pattern.name || !pattern.singularSuffix || !pattern.pluralSuffix)) {
      setError("Every noun pattern needs a name, singular suffix, and plural suffix.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await onSave(normalized);
      setMessage("Noun patterns saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Noun patterns could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <details className="noun-patterns-panel">
    <summary>Noun patterns</summary>
    <div className="noun-patterns-body">
      <p>Patterns derive a noun’s plural and articles from its singular base. Cards assigned to a pattern always use the current definition.</p>
      <div className="noun-patterns-table-wrap">
        <table className="noun-patterns-table">
          <thead><tr><th>Name</th><th>Gender</th><th>Singular ending</th><th>Plural ending</th><th>Study shorthand</th><th /></tr></thead>
          <tbody>{draft.map((pattern) => <tr key={pattern.id}>
            <td><input aria-label={`Name for ${pattern.name}`} value={pattern.name} onChange={(event) => updatePattern(pattern.id, { name: event.target.value })} /></td>
            <td><select aria-label={`Gender for ${pattern.name}`} value={pattern.gender} onChange={(event) => updatePattern(pattern.id, { gender: event.target.value === "feminine" ? "feminine" : "masculine" })}><option value="masculine">Masculine</option><option value="feminine">Feminine</option></select></td>
            <td><input aria-label={`Singular suffix for ${pattern.name}`} value={pattern.singularSuffix} onChange={(event) => updatePattern(pattern.id, { singularSuffix: event.target.value })} /></td>
            <td><input aria-label={`Plural suffix for ${pattern.name}`} value={pattern.pluralSuffix} onChange={(event) => updatePattern(pattern.id, { pluralSuffix: event.target.value })} /></td>
            <td><select aria-label={`Study shorthand for ${pattern.name}`} value={pattern.syntax} onChange={(event) => updatePattern(pattern.id, { syntax: event.target.value === "article-singular" ? "article-singular" : "full" })}><option value="full">Full forms required</option><option value="article-singular">Article + singular</option></select></td>
            <td><button type="button" className="row-remove" onClick={() => removePattern(pattern.id)} disabled={usedPatternIds.has(pattern.id)} title={usedPatternIds.has(pattern.id) ? "Pattern is assigned to cards" : "Remove pattern"}>×</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="noun-patterns-note"><strong>Article + singular</strong> is one shared shorthand syntax. Any number of patterns can opt into it. Leave a newer pattern on <strong>Full forms required</strong> until you want that pattern accepted by the shorthand.</p>
      {message && <p className="inventory-transfer-message" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={() => setDraft((items) => [...items, newPattern()])} disabled={saving}>Add pattern</button><button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save patterns"}</button></div>
    </div>
  </details>;
}
