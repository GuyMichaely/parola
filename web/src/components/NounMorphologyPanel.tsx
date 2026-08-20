import { useEffect, useMemo, useState } from "react";
import type { Flashcard } from "../cards/types";
import {
  cloneNounMorphology,
  normalizeNounMorphology,
  nounDefinitionForCard,
  resolvedNounForms,
  ruleSupportsNumberMode,
  type NounDeclensionRule,
  type NounFormNumber,
  type NounMorphology,
} from "../cards/nounMorphology";
import type { InventoryState } from "../storage";

function newRule(): NounDeclensionRule {
  const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return { id, name: "New declension", forms: { singular: { suffix: "" }, plural: { suffix: "" } } };
}

function syntaxDescription(syntax: NounMorphology["syntaxRules"][number]) {
  const markers = syntax.markers.map((marker) => marker.kind === "gender"
    ? marker.required ? "<gender>" : "[gender]"
    : marker.required ? `<${marker.value}-only>` : `[${marker.value}-only]`);
  const fields = syntax.fields.map((field) => field.kind === "noun"
    ? `<${field.number} noun>`
    : `<${field.definiteness} ${field.number} article>`);
  return [...markers, ...fields].join(" ");
}

type Assignment = {
  ruleId: string;
  base: string;
  gender: string;
  numberMode: string;
  articleMode: string;
};

function assignmentsFor(cards: Flashcard[]) {
  return Object.fromEntries(cards.filter((card) => card.type === "noun").map((card) => {
    const definition = nounDefinitionForCard(card);
    return [card.id, { ...definition }];
  })) as Record<number, Assignment>;
}

export function NounMorphologyPanel({
  cards,
  morphology,
  onSave,
}: {
  cards: Flashcard[];
  morphology: NounMorphology;
  onSave: (state: InventoryState) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => cloneNounMorphology(morphology));
  const [assignments, setAssignments] = useState<Record<number, Assignment>>(() => assignmentsFor(cards));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(cloneNounMorphology(morphology));
    setAssignments(assignmentsFor(cards));
  }, [cards, morphology]);

  const nounCards = useMemo(() => cards.filter((card) => card.type === "noun"), [cards]);

  function changeMorphology(update: (value: NounMorphology) => NounMorphology) {
    setDraft((current) => update(cloneNounMorphology(current)));
    setMessage("");
    setError("");
  }

  function updateRule(id: string, patch: Partial<NounDeclensionRule>) {
    changeMorphology((current) => ({
      ...current,
      declensionRules: current.declensionRules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule),
    }));
  }

  function updateRuleSuffix(id: string, number: NounFormNumber, suffix: string) {
    changeMorphology((current) => ({
      ...current,
      declensionRules: current.declensionRules.map((rule) => rule.id === id ? {
        ...rule,
        forms: { ...rule.forms, [number]: { suffix } },
      } : rule),
    }));
  }

  function toggleRuleForm(id: string, number: NounFormNumber, enabled: boolean) {
    changeMorphology((current) => ({
      ...current,
      declensionRules: current.declensionRules.map((rule) => {
        if (rule.id !== id) return rule;
        const forms = { ...rule.forms };
        if (enabled) forms[number] = { suffix: "" };
        else delete forms[number];
        return { ...rule, forms };
      }),
    }));
  }

  function removeRule(id: string) {
    const usedByCard = Object.values(assignments).some((assignment) => assignment.ruleId === id);
    const usedBySet = draft.inferenceSets.some((set) => set.declensionRuleIds.includes(id));
    if (usedByCard || usedBySet) {
      setError("Remove this rule from noun assignments and inference sets first.");
      return;
    }
    changeMorphology((current) => ({ ...current, declensionRules: current.declensionRules.filter((rule) => rule.id !== id) }));
  }

  function toggleInferenceRule(setId: string, ruleId: string) {
    changeMorphology((current) => ({
      ...current,
      inferenceSets: current.inferenceSets.map((set) => set.id !== setId ? set : {
        ...set,
        declensionRuleIds: set.declensionRuleIds.includes(ruleId)
          ? set.declensionRuleIds.filter((id) => id !== ruleId)
          : [...set.declensionRuleIds, ruleId],
      }),
    }));
  }

  function updateAssignment(cardId: number, field: keyof Assignment, value: string) {
    setAssignments((current) => ({ ...current, [cardId]: { ...current[cardId], [field]: value } }));
    setMessage("");
    setError("");
  }

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const normalized = normalizeNounMorphology(draft);
      const ruleIds = new Set(normalized.declensionRules.map((rule) => rule.id));
      const updatedCards = cards.map((card) => {
        if (card.type !== "noun") return card;
        const assignment = assignments[card.id];
        if (!assignment || !ruleIds.has(assignment.ruleId)) throw new Error(`Choose a valid declension rule for ${card.english}.`);
        if (assignment.gender !== "masculine" && assignment.gender !== "feminine") throw new Error(`Choose a gender for ${card.english}.`);
        if (assignment.numberMode !== "both" && assignment.numberMode !== "singular" && assignment.numberMode !== "plural") throw new Error(`Choose a number mode for ${card.english}.`);
        if (assignment.articleMode !== "automatic" && assignment.articleMode !== "none") throw new Error(`Choose article behavior for ${card.english}.`);
        const rule = normalized.declensionRules.find((item) => item.id === assignment.ruleId)!;
        if (!ruleSupportsNumberMode(rule, assignment.numberMode)) {
          throw new Error(`${rule.name} does not support the ${assignment.numberMode} number mode used by ${card.english}.`);
        }
        const nextCard: Flashcard = {
          ...card,
          details: {
            ruleId: assignment.ruleId,
            base: assignment.base.normalize("NFC"),
            gender: assignment.gender,
            numberMode: assignment.numberMode,
            articleMode: assignment.articleMode,
          },
        };
        const forms = resolvedNounForms(nextCard, normalized);
        return { ...nextCard, italian: forms.singular || forms.plural };
      });
      await onSave({ cards: updatedCards, nounMorphology: normalized });
      setMessage("Saved noun morphology and assignments.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Noun morphology could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <details className="noun-patterns-panel">
    <summary>Noun morphology & syntax</summary>
    <div className="noun-patterns-body">
      <p>Cards store a base and their actual declension rule. A rule defines only the number forms it supports. Syntax rules decide what the learner may type. Inference sets decide which declension rules a syntax may infer.</p>

      <h3>Declension rules</h3>
      <div className="noun-patterns-table-wrap">
        <table className="noun-patterns-table">
          <thead><tr><th>Name</th><th>Singular form</th><th>Plural form</th><th /></tr></thead>
          <tbody>{draft.declensionRules.map((rule) => <tr key={rule.id}>
            <td><input value={rule.name} onChange={(event) => updateRule(rule.id, { name: event.target.value })} /></td>
            <td><label><input type="checkbox" checked={Boolean(rule.forms.singular)} onChange={(event) => toggleRuleForm(rule.id, "singular", event.target.checked)} /> supported</label>{rule.forms.singular && <input value={rule.forms.singular.suffix} onChange={(event) => updateRuleSuffix(rule.id, "singular", event.target.value)} placeholder="suffix" />}</td>
            <td><label><input type="checkbox" checked={Boolean(rule.forms.plural)} onChange={(event) => toggleRuleForm(rule.id, "plural", event.target.checked)} /> supported</label>{rule.forms.plural && <input value={rule.forms.plural.suffix} onChange={(event) => updateRuleSuffix(rule.id, "plural", event.target.value)} placeholder="suffix" />}</td>
            <td><button type="button" className="row-remove" onClick={() => removeRule(rule.id)}>×</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p>A blank suffix means the stored base is already that surface form. This lets a singular-only or plural-only rule use the word itself as its base.</p>
      <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={() => changeMorphology((current) => ({ ...current, declensionRules: [...current.declensionRules, newRule()] }))}>Add rule</button></div>

      <h3>Inference sets</h3>
      <p>An inference set is shared by syntax rules. Add a declension here when every syntax using this set should be allowed to infer that declension.</p>
      {draft.inferenceSets.map((set) => <div className="morphology-inference-set" key={set.id}>
        <strong>{set.name}</strong>
        <div className="morphology-rule-checks">{draft.declensionRules.map((rule) => <label key={rule.id}>
          <input type="checkbox" checked={set.declensionRuleIds.includes(rule.id)} onChange={() => toggleInferenceRule(set.id, rule.id)} />
          <span>{rule.name}</span>
        </label>)}</div>
      </div>)}

      <h3>Syntax rules</h3>
      <p>Syntax definitions are data-driven but read-only in this UI. They use the inference sets above.</p>
      <div className="noun-patterns-table-wrap">
        <table className="noun-patterns-table">
          <thead><tr><th>Name</th><th>Input shape</th><th>Inference set</th></tr></thead>
          <tbody>{draft.syntaxRules.map((syntax) => <tr key={syntax.id}>
            <td>{syntax.name}</td>
            <td><code>{syntaxDescription(syntax)}</code></td>
            <td>{draft.inferenceSets.find((set) => set.id === syntax.inferenceSetId)?.name ?? syntax.inferenceSetId}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <h3>Noun assignments</h3>
      <p>Each noun stores only its base, actual declension rule, gender, number behavior, and article behavior. Parola derives the available forms.</p>
      <div className="noun-patterns-table-wrap noun-assignments-wrap">
        <table className="noun-patterns-table noun-assignments-table">
          <thead><tr><th>English</th><th>Base</th><th>Rule</th><th>Gender</th><th>Number</th><th>Articles</th><th>Derived</th></tr></thead>
          <tbody>{nounCards.map((card) => {
            const assignment = assignments[card.id];
            if (!assignment) return null;
            let derived = "";
            try {
              const previewCard: Flashcard = { ...card, details: { ruleId: assignment.ruleId, base: assignment.base, gender: assignment.gender, numberMode: assignment.numberMode, articleMode: assignment.articleMode } };
              const forms = resolvedNounForms(previewCard, draft);
              derived = [forms.singular, forms.plural].filter(Boolean).join(" / ");
            } catch {
              derived = "Invalid assignment";
            }
            return <tr key={card.id}>
              <td>{card.english}</td>
              <td><input value={assignment.base} onChange={(event) => updateAssignment(card.id, "base", event.target.value)} /></td>
              <td><select value={assignment.ruleId} onChange={(event) => updateAssignment(card.id, "ruleId", event.target.value)}>{draft.declensionRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select></td>
              <td><select value={assignment.gender} onChange={(event) => updateAssignment(card.id, "gender", event.target.value)}><option value="masculine">Masculine</option><option value="feminine">Feminine</option></select></td>
              <td><select value={assignment.numberMode} onChange={(event) => updateAssignment(card.id, "numberMode", event.target.value)}><option value="both">Singular + plural</option><option value="singular">Singular only</option><option value="plural">Plural only</option></select></td>
              <td><select value={assignment.articleMode} onChange={(event) => updateAssignment(card.id, "articleMode", event.target.value)}><option value="automatic">Automatic</option><option value="none">None</option></select></td>
              <td>{derived}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      {message && <p className="inventory-transfer-message" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="noun-pattern-actions"><button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save morphology"}</button></div>
    </div>
  </details>;
}
