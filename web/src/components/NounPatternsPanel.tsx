import { useEffect, useMemo, useState } from "react";
import type { Flashcard } from "../cards/types";
import { setActiveNounPatterns } from "../cards/nounPatternRuntime";
import {
  deriveNounPatternForms,
  inferNounPatternId,
  normalizeNounPatterns,
  resolvedNounForms,
  type NounPattern,
} from "../cards/nounPatterns";
import {
  createCardStorage,
  readStorageEndpoint,
  readSyncLoadPolicy,
  readSyncPersistLocal,
} from "../storage";

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

function patternedCard(card: Flashcard, patternId: string, base: string): Flashcard {
  return {
    ...card,
    italian: base,
    details: {
      patternId,
      singular: base,
    },
  };
}

function manualCard(card: Flashcard, patterns: NounPattern[]): Flashcard {
  if (card.type !== "noun") return card;
  const forms = resolvedNounForms(card, patterns);
  return {
    ...card,
    italian: forms.singular || forms.plural || card.italian,
    details: {
      patternId: "manual",
      gender: forms.gender,
      singular: forms.singular,
      plural: forms.plural,
      definiteSingularArticle: forms.definiteSingularArticle,
      definitePluralArticle: forms.definitePluralArticle,
      indefiniteArticle: forms.indefiniteArticle,
      definiteSingular: forms.definiteSingularArticle
        ? `${forms.definiteSingularArticle.endsWith("’") || forms.definiteSingularArticle.endsWith("'") ? forms.definiteSingularArticle : `${forms.definiteSingularArticle} `}${forms.singular}`
        : forms.singular,
      definitePlural: forms.definitePluralArticle
        ? `${forms.definitePluralArticle.endsWith("’") || forms.definitePluralArticle.endsWith("'") ? forms.definitePluralArticle : `${forms.definitePluralArticle} `}${forms.plural}`
        : forms.plural,
      indefinite: forms.indefiniteArticle
        ? `${forms.indefiniteArticle.endsWith("’") || forms.indefiniteArticle.endsWith("'") ? forms.indefiniteArticle : `${forms.indefiniteArticle} `}${forms.singular}`
        : forms.singular,
    },
  };
}

type Assignment = {
  patternId: string;
  base: string;
};

export function NounPatternsPanel() {
  const storage = useMemo(() => createCardStorage(readStorageEndpoint(), {
    persistLocal: readSyncPersistLocal(),
    loadPolicy: readSyncLoadPolicy(),
  }), []);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [patterns, setPatterns] = useState<NounPattern[]>([]);
  const [draft, setDraft] = useState<NounPattern[]>([]);
  const [assignments, setAssignments] = useState<Record<number, Assignment>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [loadedCards, loadedPatterns] = await Promise.all([storage.listCards(), storage.listNounPatterns()]);
        setActiveNounPatterns(loadedPatterns);

        let migrated = false;
        const migratedCards = loadedCards.map((card) => {
          if (card.type !== "noun" || card.details.patternId) return card;
          migrated = true;
          const patternId = inferNounPatternId(card, loadedPatterns);
          if (patternId === "manual") return manualCard(card, loadedPatterns);
          return patternedCard(card, patternId, card.details.singular ?? card.italian);
        });
        if (migrated) {
          await storage.replaceCards(migratedCards);
          if (active) window.location.reload();
          return;
        }

        if (!active) return;
        setCards(loadedCards);
        setPatterns(loadedPatterns);
        setDraft(loadedPatterns.map((pattern) => ({ ...pattern })));
        setAssignments(Object.fromEntries(loadedCards.filter((card) => card.type === "noun").map((card) => [card.id, {
          patternId: card.details.patternId || "manual",
          base: card.details.singular ?? card.italian,
        }])));
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Noun patterns could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [storage]);

  const nounCards = useMemo(() => cards.filter((card) => card.type === "noun"), [cards]);
  const usedPatternIds = useMemo(() => new Set(Object.values(assignments).map((assignment) => assignment.patternId).filter((id) => id !== "manual")), [assignments]);

  function updatePattern(id: string, patch: Partial<NounPattern>) {
    setDraft((items) => items.map((pattern) => pattern.id === id ? { ...pattern, ...patch } : pattern));
    setMessage("");
    setError("");
  }

  function updateAssignment(cardId: number, patch: Partial<Assignment>) {
    setAssignments((items) => ({ ...items, [cardId]: { ...items[cardId], ...patch } }));
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
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const normalized = normalizeNounPatterns(draft.map((pattern) => ({
        ...pattern,
        name: pattern.name.trim(),
        singularSuffix: pattern.singularSuffix.normalize("NFC").trim(),
        pluralSuffix: pattern.pluralSuffix.normalize("NFC").trim(),
      })));
      const patternById = new Map(normalized.map((pattern) => [pattern.id, pattern]));

      const updatedCards = cards.map((card) => {
        if (card.type !== "noun") return card;
        const assignment = assignments[card.id] ?? { patternId: "manual", base: card.details.singular ?? card.italian };
        if (assignment.patternId === "manual") return manualCard(card, patterns);
        const pattern = patternById.get(assignment.patternId);
        if (!pattern) throw new Error(`The pattern assigned to “${card.italian}” no longer exists.`);
        const base = assignment.base.normalize("NFC").trim();
        if (!deriveNounPatternForms(pattern, base)) {
          throw new Error(`“${base || card.italian}” does not match ${pattern.name}; its singular base must end in “${pattern.singularSuffix}”.`);
        }
        return patternedCard(card, pattern.id, base);
      });

      await storage.replaceNounPatterns(normalized);
      await storage.replaceCards(updatedCards);
      setActiveNounPatterns(normalized);
      setMessage("Noun patterns and assignments saved. Reloading Parola…");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Noun patterns could not be saved.");
      setSaving(false);
    }
  }

  return <details className="noun-patterns-panel">
    <summary>Noun patterns</summary>
    <div className="noun-patterns-body">
      {loading ? <p>Loading noun patterns…</p> : <>
        <p>Patterns are reusable noun classes. A patterned card stores a singular base plus a pattern; Parola derives the plural and articles at study time.</p>
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
        <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={() => setDraft((items) => [...items, newPattern()])} disabled={saving}>Add pattern</button></div>

        <h3>Noun assignments</h3>
        <p>Choose a pattern and singular base for each noun. Manual nouns keep explicit forms in the normal card editor.</p>
        <div className="noun-patterns-table-wrap noun-assignments-wrap">
          <table className="noun-patterns-table noun-assignments-table">
            <thead><tr><th>English</th><th>Italian base</th><th>Pattern</th><th>Derived plural</th><th>Study syntax</th></tr></thead>
            <tbody>{nounCards.map((card) => {
              const assignment = assignments[card.id] ?? { patternId: "manual", base: card.details.singular ?? card.italian };
              const pattern = draft.find((item) => item.id === assignment.patternId);
              const derived = pattern ? deriveNounPatternForms(pattern, assignment.base) : null;
              return <tr key={card.id}>
                <td>{card.english}</td>
                <td><input value={assignment.base} disabled={assignment.patternId === "manual"} onChange={(event) => updateAssignment(card.id, { base: event.target.value })} /></td>
                <td><select value={assignment.patternId} onChange={(event) => updateAssignment(card.id, { patternId: event.target.value })}><option value="manual">Manual forms</option>{draft.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td>
                <td>{assignment.patternId === "manual" ? "Explicit" : derived?.plural || "Does not match"}</td>
                <td>{assignment.patternId === "manual" ? "Full explicit forms" : pattern?.syntax === "article-singular" ? "Article + singular" : "Full forms required"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <p className="noun-patterns-note"><strong>Article + singular</strong> is one shared shorthand syntax. Any number of patterns can opt into it. For example, leave <strong>Masculine -chio → -chi</strong> on full forms while learning it, then switch it to Article + singular when you are ready for <code>m lo specchio</code> to be sufficient.</p>
        {message && <p className="inventory-transfer-message" role="status">{message}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="noun-pattern-actions"><button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save patterns & assignments"}</button></div>
      </>}
    </div>
  </details>;
}
