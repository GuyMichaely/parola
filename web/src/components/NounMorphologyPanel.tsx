import { useEffect, useRef, useState } from "react";
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
  type NounSyntaxField,
  type NounSyntaxMarker,
  type NounSyntaxRule,
} from "../cards/nounMorphology";
import type { InventoryState } from "../storage";

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function newRule(): NounDeclensionRule {
  return { id: uniqueId("rule"), name: "New declension", forms: { singular: { suffix: "" }, plural: { suffix: "" } } };
}

function newInferenceSet(): NounMorphology["inferenceSets"][number] {
  return { id: uniqueId("inference"), name: "New inference set", declensionRuleIds: [] };
}

function newSyntax(inferenceSetId: string): NounSyntaxRule {
  return {
    id: uniqueId("syntax"),
    name: "New noun syntax",
    markers: [{ kind: "gender", required: false }],
    markerOrder: "any",
    fields: [{ kind: "noun", number: "singular" }],
    numberMode: "both",
    articleMode: "automatic",
    inferenceSetId,
  };
}

function syntaxDescription(syntax: NounSyntaxRule) {
  const markers = syntax.markers.map((marker) => marker.kind === "gender"
    ? marker.required ? "<gender>" : "[gender]"
    : marker.required ? `<${marker.value}-only>` : `[${marker.value}-only]`);
  const fields = syntax.fields.map((field) => field.kind === "noun"
    ? `<${field.number} noun>`
    : `<${field.definiteness} ${field.number} article>`);
  return [...markers, ...fields].join(" ");
}

function syntaxFieldValue(field: NounSyntaxField) {
  if (field.kind === "noun") return `noun:${field.number}`;
  return `article:${field.definiteness}:${field.number}`;
}

function syntaxFieldFromValue(value: string): NounSyntaxField {
  if (value === "noun:singular") return { kind: "noun", number: "singular" };
  if (value === "noun:plural") return { kind: "noun", number: "plural" };
  if (value === "article:definite:singular") return { kind: "article", definiteness: "definite", number: "singular" };
  if (value === "article:definite:plural") return { kind: "article", definiteness: "definite", number: "plural" };
  return { kind: "article", definiteness: "indefinite", number: "singular" };
}

function nounSourceFingerprint(cards: Flashcard[], morphology: NounMorphology) {
  return JSON.stringify({
    morphology,
    nouns: cards
      .filter((card) => card.type === "noun")
      .map((card) => ({ id: card.id, details: card.details })),
  });
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
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const appliedSourceRef = useRef(nounSourceFingerprint(cards, morphology));

  useEffect(() => {
    const nextFingerprint = nounSourceFingerprint(cards, morphology);
    if (nextFingerprint === appliedSourceRef.current) return;
    if (dirty) {
      setSourceChanged(true);
      return;
    }
    setDraft(cloneNounMorphology(morphology));
    appliedSourceRef.current = nextFingerprint;
    setSourceChanged(false);
  }, [cards, dirty, morphology]);

  function markEdited() {
    setDirty(true);
    setMessage("");
    setError("");
  }

  function changeMorphology(update: (value: NounMorphology) => NounMorphology) {
    setDraft((current) => update(cloneNounMorphology(current)));
    markEdited();
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
    const usedByCard = cards.some((card) => card.type === "noun" && card.details.ruleId === id);
    const usedBySet = draft.inferenceSets.some((set) => set.declensionRuleIds.includes(id));
    if (usedByCard || usedBySet) {
      setError("This rule is still used by a noun or inference set. Reassign those references first.");
      return;
    }
    changeMorphology((current) => ({ ...current, declensionRules: current.declensionRules.filter((rule) => rule.id !== id) }));
  }

  function updateInferenceSet(id: string, name: string) {
    changeMorphology((current) => ({
      ...current,
      inferenceSets: current.inferenceSets.map((set) => set.id === id ? { ...set, name } : set),
    }));
  }

  function removeInferenceSet(id: string) {
    if (draft.syntaxRules.some((syntax) => syntax.inferenceSetId === id)) {
      setError("Move every syntax rule to another inference set before removing this one.");
      return;
    }
    changeMorphology((current) => ({ ...current, inferenceSets: current.inferenceSets.filter((set) => set.id !== id) }));
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

  function updateSyntax(id: string, patch: Partial<NounSyntaxRule>) {
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax) => syntax.id === id ? { ...syntax, ...patch } : syntax),
    }));
  }

  function addSyntax() {
    const inferenceSetId = draft.inferenceSets[0]?.id;
    if (!inferenceSetId) {
      setError("Create an inference set before adding a syntax rule.");
      return;
    }
    changeMorphology((current) => ({ ...current, syntaxRules: [...current.syntaxRules, newSyntax(inferenceSetId)] }));
  }

  function removeSyntax(id: string) {
    changeMorphology((current) => ({ ...current, syntaxRules: current.syntaxRules.filter((syntax) => syntax.id !== id) }));
  }

  function setSyntaxGenderMarker(id: string, value: "none" | "optional" | "required") {
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax) => {
        if (syntax.id !== id) return syntax;
        const markers: NounSyntaxMarker[] = syntax.markers.filter((marker) => marker.kind !== "gender");
        if (value !== "none") markers.unshift({ kind: "gender", required: value === "required" });
        return { ...syntax, markers };
      }),
    }));
  }

  function setSyntaxTantumMarker(id: string, value: "none" | "singular" | "plural") {
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax) => {
        if (syntax.id !== id) return syntax;
        const markers: NounSyntaxMarker[] = syntax.markers.filter((marker) => marker.kind !== "tantum");
        if (value !== "none") markers.push({ kind: "tantum", required: true, value });
        return { ...syntax, markers };
      }),
    }));
  }

  function updateSyntaxField(id: string, index: number, value: string) {
    const field = syntaxFieldFromValue(value);
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax) => syntax.id !== id ? syntax : {
        ...syntax,
        fields: syntax.fields.map((item, itemIndex) => itemIndex === index ? field : item),
        articleMode: field.kind === "article" ? "automatic" : syntax.articleMode,
      }),
    }));
  }

  function addSyntaxField(id: string) {
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax) => syntax.id === id
        ? { ...syntax, fields: [...syntax.fields, { kind: "noun", number: "singular" }] }
        : syntax),
    }));
  }

  function removeSyntaxField(id: string, index: number) {
    const syntax = draft.syntaxRules.find((item) => item.id === id);
    if (!syntax) return;
    const field = syntax.fields[index];
    if (field?.kind === "noun" && syntax.fields.filter((item) => item.kind === "noun").length === 1) {
      setError("A syntax rule must keep at least one noun field.");
      return;
    }
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((item) => item.id === id
        ? { ...item, fields: item.fields.filter((_, itemIndex) => itemIndex !== index) }
        : item),
    }));
  }

  function moveSyntaxField(id: string, index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    changeMorphology((current) => ({
      ...current,
      syntaxRules: current.syntaxRules.map((syntax) => {
        if (syntax.id !== id || nextIndex < 0 || nextIndex >= syntax.fields.length) return syntax;
        const fields = [...syntax.fields];
        [fields[index], fields[nextIndex]] = [fields[nextIndex]!, fields[index]!];
        return { ...syntax, fields };
      }),
    }));
  }

  function updateSyntaxArticleMode(id: string, value: "automatic" | "none") {
    const syntax = draft.syntaxRules.find((item) => item.id === id);
    if (value === "none" && syntax?.fields.some((field) => field.kind === "article")) {
      setError("Remove article fields before setting article behavior to None.");
      return;
    }
    updateSyntax(id, { articleMode: value });
  }

  function reloadCurrentSource() {
    setDraft(cloneNounMorphology(morphology));
    appliedSourceRef.current = nounSourceFingerprint(cards, morphology);
    setDirty(false);
    setSourceChanged(false);
    setMessage("Reloaded current noun morphology.");
    setError("");
  }

  async function save() {
    if (sourceChanged) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const normalized = normalizeNounMorphology(draft);
      const updatedCards = cards.map((card) => {
        if (card.type !== "noun") return card;
        const definition = nounDefinitionForCard(card);
        const rule = normalized.declensionRules.find((item) => item.id === definition.ruleId);
        if (!rule) throw new Error(`${card.english} references a declension rule that no longer exists.`);
        if (!ruleSupportsNumberMode(rule, definition.numberMode)) {
          throw new Error(`${rule.name} no longer supports the number behavior used by ${card.english}.`);
        }
        const forms = resolvedNounForms(card, normalized);
        return { ...card, italian: forms.singular || forms.plural };
      });
      await onSave({ cards: updatedCards, nounMorphology: normalized });
      setDraft(cloneNounMorphology(normalized));
      appliedSourceRef.current = nounSourceFingerprint(updatedCards, normalized);
      setDirty(false);
      setSourceChanged(false);
      setMessage("Saved noun morphology.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Noun morphology could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="noun-patterns-panel" aria-labelledby="noun-morphology-heading">
    <header className="noun-patterns-header">
      <div>
        <h2 id="noun-morphology-heading">Noun morphology & syntax</h2>
        <p>Define reusable declension rules, decide which rules each shorthand may infer, and configure the accepted noun-answer syntaxes. Noun-to-rule assignments live with the noun definitions above.</p>
      </div>
    </header>
    <div className="noun-patterns-body">
      {sourceChanged && <div className="sync-warning" role="alert">
        <p>The noun inventory changed while this morphology draft had unsaved edits. The draft was preserved, but it cannot be saved over the newer inventory.</p>
        <button type="button" className="neutral-button" onClick={reloadCurrentSource}>Discard draft and reload current inventory</button>
      </div>}

      <h3>Declension rules</h3>
      <p>A rule describes how a stored base produces singular and/or plural forms. A blank suffix means the base itself is the surface form.</p>
      <div className="noun-patterns-table-wrap">
        <table className="noun-patterns-table declension-rules-table">
          <thead><tr><th>Name</th><th>Singular form</th><th>Plural form</th><th /></tr></thead>
          <tbody>{draft.declensionRules.map((rule) => <tr key={rule.id}>
            <td><input value={rule.name} onChange={(event) => updateRule(rule.id, { name: event.target.value })} /></td>
            <td><div className="morphology-form-cell"><label className="morphology-support-toggle"><input type="checkbox" checked={Boolean(rule.forms.singular)} onChange={(event) => toggleRuleForm(rule.id, "singular", event.target.checked)} /><span>Supported</span></label>{rule.forms.singular && <input className="morphology-suffix-input" value={rule.forms.singular.suffix} onChange={(event) => updateRuleSuffix(rule.id, "singular", event.target.value)} placeholder="suffix" />}</div></td>
            <td><div className="morphology-form-cell"><label className="morphology-support-toggle"><input type="checkbox" checked={Boolean(rule.forms.plural)} onChange={(event) => toggleRuleForm(rule.id, "plural", event.target.checked)} /><span>Supported</span></label>{rule.forms.plural && <input className="morphology-suffix-input" value={rule.forms.plural.suffix} onChange={(event) => updateRuleSuffix(rule.id, "plural", event.target.value)} placeholder="suffix" />}</div></td>
            <td><button type="button" className="row-remove" onClick={() => removeRule(rule.id)} aria-label={`Remove declension rule ${rule.name}`}>×</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={() => changeMorphology((current) => ({ ...current, declensionRules: [...current.declensionRules, newRule()] }))}>Add rule</button></div>

      <h3>Inference sets</h3>
      <p>Inference sets are learning-policy groups. A syntax can infer only the declension rules in its selected set.</p>
      {draft.inferenceSets.map((set) => <div className="morphology-inference-set" key={set.id}>
        <div className="noun-pattern-actions">
          <input value={set.name} onChange={(event) => updateInferenceSet(set.id, event.target.value)} aria-label="Inference set name" />
          <button type="button" className="row-remove" onClick={() => removeInferenceSet(set.id)} aria-label={`Remove inference set ${set.name}`}>×</button>
        </div>
        <div className="morphology-rule-checks">{draft.declensionRules.map((rule) => <label key={rule.id}>
          <input type="checkbox" checked={set.declensionRuleIds.includes(rule.id)} onChange={() => toggleInferenceRule(set.id, rule.id)} />
          <span>{rule.name}</span>
        </label>)}</div>
      </div>)}
      <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={() => changeMorphology((current) => ({ ...current, inferenceSets: [...current.inferenceSets, newInferenceSet()] }))}>Add inference set</button></div>

      <h3>Syntax rules</h3>
      <p>Syntax rules describe the learner's input structure. Field order is input order; the selected inference set controls which declensions that syntax may infer.</p>
      {draft.syntaxRules.map((syntax) => {
        const genderMarker = syntax.markers.find((marker) => marker.kind === "gender");
        const tantumMarker = syntax.markers.find((marker) => marker.kind === "tantum");
        const genderValue = !genderMarker ? "none" : genderMarker.required ? "required" : "optional";
        return <div className="morphology-inference-set" key={syntax.id}>
          <div className="noun-pattern-actions">
            <input value={syntax.name} onChange={(event) => updateSyntax(syntax.id, { name: event.target.value })} aria-label="Syntax name" />
            <code>{syntaxDescription(syntax)}</code>
            <button type="button" className="row-remove" onClick={() => removeSyntax(syntax.id)} aria-label={`Remove syntax ${syntax.name}`}>×</button>
          </div>
          <div className="noun-patterns-table-wrap">
            <table className="noun-patterns-table syntax-settings-table">
              <thead><tr><th>Number</th><th>Articles</th><th>Gender marker</th><th>Tantum marker</th><th>Inference set</th></tr></thead>
              <tbody><tr>
                <td><select value={syntax.numberMode} onChange={(event) => updateSyntax(syntax.id, { numberMode: event.target.value as NounSyntaxRule["numberMode"] })}><option value="both">Singular + plural</option><option value="singular">Singular only</option><option value="plural">Plural only</option></select></td>
                <td><select value={syntax.articleMode} onChange={(event) => updateSyntaxArticleMode(syntax.id, event.target.value as "automatic" | "none")}><option value="automatic">Automatic</option><option value="none">None</option></select></td>
                <td><select value={genderValue} onChange={(event) => setSyntaxGenderMarker(syntax.id, event.target.value as "none" | "optional" | "required")}><option value="none">None</option><option value="optional">Optional</option><option value="required">Required</option></select></td>
                <td><select value={tantumMarker?.kind === "tantum" ? tantumMarker.value : "none"} onChange={(event) => setSyntaxTantumMarker(syntax.id, event.target.value as "none" | "singular" | "plural")}><option value="none">None</option><option value="singular">Required singular-only</option><option value="plural">Required plural-only</option></select></td>
                <td><select value={syntax.inferenceSetId} onChange={(event) => updateSyntax(syntax.id, { inferenceSetId: event.target.value })}>{draft.inferenceSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></td>
              </tr></tbody>
            </table>
          </div>
          <div className="noun-patterns-table-wrap">
            <table className="noun-patterns-table syntax-fields-table">
              <thead><tr><th>#</th><th>Input field</th><th /></tr></thead>
              <tbody>{syntax.fields.map((field, index) => <tr key={`${syntax.id}:${index}`}>
                <td>{index + 1}</td>
                <td><select value={syntaxFieldValue(field)} onChange={(event) => updateSyntaxField(syntax.id, index, event.target.value)}>
                  <option value="noun:singular">Singular noun</option>
                  <option value="noun:plural">Plural noun</option>
                  <option value="article:definite:singular">Definite singular article</option>
                  <option value="article:definite:plural">Definite plural article</option>
                  <option value="article:indefinite:singular">Indefinite singular article</option>
                </select></td>
                <td><div className="noun-pattern-actions">
                  <button type="button" className="neutral-button" onClick={() => moveSyntaxField(syntax.id, index, -1)} disabled={index === 0}>↑</button>
                  <button type="button" className="neutral-button" onClick={() => moveSyntaxField(syntax.id, index, 1)} disabled={index === syntax.fields.length - 1}>↓</button>
                  <button type="button" className="row-remove" onClick={() => removeSyntaxField(syntax.id, index)}>×</button>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={() => addSyntaxField(syntax.id)}>Add field</button></div>
        </div>;
      })}
      <div className="noun-pattern-actions"><button type="button" className="neutral-button" onClick={addSyntax}>Add syntax rule</button></div>

      {message && <p className="inventory-transfer-message" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="noun-pattern-actions morphology-save-actions"><button type="button" className="primary-button" onClick={() => void save()} disabled={saving || sourceChanged}>{saving ? "Saving…" : "Save morphology"}</button></div>
    </div>
  </section>;
}
