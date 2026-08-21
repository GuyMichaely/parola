import { type FormEvent, useRef, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import {
  nounDefinitionForCard,
  resolvedNounForms,
  ruleSupportsNumberMode,
  type NounArticleMode,
  type NounGender,
  type NounMorphology,
  type NounNumberMode,
} from "../cards/nounMorphology";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  adjectiveCard,
  adjectiveRowFromCard,
  adverbCard,
  adverbRowFromCard,
  joinArticle,
  parseTags,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type VerbBatchRow,
  verbCard,
  verbRowFromCard,
} from "../cards/editorModel";
import {
  AdjectiveRowCells,
  AdverbRowCells,
  VerbRowCells,
} from "./CardEditorFields";

type InventoryMetadataDraft = Record<string, { setName: string; tags: string }>;

type NounInventoryRow = {
  id: string;
  english: string;
  ruleId: string;
  base: string;
  gender: NounGender;
  numberMode: NounNumberMode;
  articleMode: NounArticleMode;
};

const inventoryHeightLimitKey = "parola:inventory:limit-height";

function readInventoryHeightLimit() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(inventoryHeightLimitKey) === "1";
  } catch {
    return false;
  }
}

function writeInventoryHeightLimit(value: boolean) {
  try {
    window.localStorage.setItem(inventoryHeightLimitKey, value ? "1" : "0");
  } catch {
    // This is only a display preference.
  }
}

function nounInventoryRowFromCard(card: Flashcard): NounInventoryRow {
  const definition = nounDefinitionForCard(card);
  return {
    id: String(card.id),
    english: card.english,
    ruleId: definition.ruleId,
    base: definition.base,
    gender: definition.gender,
    numberMode: definition.numberMode,
    articleMode: definition.articleMode,
  };
}

function numberModeForRule(morphology: NounMorphology, ruleId: string): NounNumberMode {
  const rule = morphology.declensionRules.find((item) => item.id === ruleId);
  if (!rule) return "both";
  if (rule.forms.singular && rule.forms.plural) return "both";
  if (rule.forms.singular) return "singular";
  return "plural";
}

function nounPreview(row: NounInventoryRow, morphology: NounMorphology) {
  const card: Flashcard = {
    id: Number(row.id),
    type: "noun",
    english: row.english,
    italian: "",
    setName: null,
    tags: [],
    details: {
      ruleId: row.ruleId,
      base: row.base,
      gender: row.gender,
      numberMode: row.numberMode,
      articleMode: row.articleMode,
    },
  };
  return resolvedNounForms(card, morphology);
}

export function InventoryCardsEditor({
  cards,
  knownSets,
  morphology,
  onSave,
  onOpen,
  onRemove,
}: {
  cards: Flashcard[];
  knownSets: string[];
  morphology: NounMorphology;
  onSave: (updated: Flashcard[], original: Flashcard[]) => Promise<boolean>;
  onOpen: (card: Flashcard) => void;
  onRemove: (id: number) => void;
}) {
  const [nounRows, setNounRows] = useState<NounInventoryRow[]>(() => cards.filter((card) => card.type === "noun").map(nounInventoryRowFromCard));
  const [verbRows, setVerbRows] = useState(() => cards.filter((card) => card.type === "verb").map(verbRowFromCard));
  const [adjectiveRows, setAdjectiveRows] = useState(() => cards.filter((card) => card.type === "adjective").map(adjectiveRowFromCard));
  const [adverbRows, setAdverbRows] = useState(() => cards.filter((card) => card.type === "adverb").map(adverbRowFromCard));
  const [metadata, setMetadata] = useState<InventoryMetadataDraft>(() => Object.fromEntries(cards.map((card) => [String(card.id), { setName: card.setName ?? "", tags: card.tags.join(", ") }])));
  const previousCardsRef = useRef(cards);
  const firstType: CardType = nounRows.length ? "noun" : verbRows.length ? "verb" : adjectiveRows.length ? "adjective" : "adverb";
  const [type, setType] = useState<CardType>(firstType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [limitHeight, setLimitHeight] = useState(readInventoryHeightLimit);
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const counts = { noun: nounRows.length, verb: verbRows.length, adjective: adjectiveRows.length, adverb: adverbRows.length };

  const previousById = new Map(previousCardsRef.current.map((card) => [card.id, card]));
  if (previousCardsRef.current !== cards) {
    const nextMetadata: InventoryMetadataDraft = {};
    for (const card of cards) {
      const id = String(card.id);
      const previous = previousById.get(card.id);
      const existing = metadata[id];
      if (!previous || !existing) {
        nextMetadata[id] = { setName: card.setName ?? "", tags: card.tags.join(", ") };
        continue;
      }
      const removedTags = new Set(previous.tags.filter((tag) => !card.tags.includes(tag)));
      const addedTags = card.tags.filter((tag) => !previous.tags.includes(tag));
      const draftTags = parseTags(existing.tags).filter((tag) => !removedTags.has(tag));
      for (const tag of addedTags) {
        if (!draftTags.includes(tag)) draftTags.push(tag);
      }
      nextMetadata[id] = {
        setName: existing.setName === (previous.setName ?? "") ? (card.setName ?? "") : existing.setName,
        tags: draftTags.join(", "),
      };
    }
    previousCardsRef.current = cards;
    if (JSON.stringify(nextMetadata) !== JSON.stringify(metadata)) queueMicrotask(() => setMetadata(nextMetadata));
  }

  function updateMetadata(id: string, field: "setName" | "tags", value: string) {
    setMetadata((items) => ({ ...items, [id]: { ...items[id], [field]: value } }));
  }

  function commonFor(rowId: string) {
    const original = cardById.get(Number(rowId))!;
    const rowMetadata = metadata[rowId] ?? { setName: original.setName ?? "", tags: original.tags.join(", ") };
    return {
      id: original.id,
      setName: rowMetadata.setName.trim() || null,
      tags: parseTags(rowMetadata.tags),
    };
  }

  function updateNounRow(id: string, patch: Partial<NounInventoryRow>) {
    setNounRows((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function changeNounRule(id: string, ruleId: string) {
    updateNounRow(id, { ruleId, numberMode: numberModeForRule(morphology, ruleId) });
  }

  function setHeightLimited(value: boolean) {
    setLimitHeight(value);
    writeInventoryHeightLimit(value);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nounRows.some((row) => !row.english.trim())) { setType("noun"); setError("Every noun needs an English prompt."); return; }
    for (const row of nounRows) {
      const rule = morphology.declensionRules.find((item) => item.id === row.ruleId);
      if (!rule) { setType("noun"); setError(`${row.english} references a declension rule that no longer exists.`); return; }
      if (!ruleSupportsNumberMode(rule, row.numberMode)) { setType("noun"); setError(`${rule.name} does not support the number behavior selected for ${row.english}.`); return; }
    }
    if (verbRows.some((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((value) => !value.trim()))) { setType("verb"); setError("Every verb needs English, infinitive, all six present-tense forms, and the participle."); return; }
    if (adjectiveRows.some((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((value) => !value.trim()))) { setType("adjective"); setError("Every adjective needs English and all four Italian forms."); return; }
    if (adverbRows.some((row) => !row.english.trim() || !row.form.trim())) { setType("adverb"); setError("Every adverb needs English and an Italian form."); return; }

    let nounCards: Flashcard[];
    try {
      nounCards = nounRows.map((row) => {
        const common = commonFor(row.id);
        const candidate: Flashcard = {
          ...common,
          type: "noun",
          english: row.english.trim(),
          italian: "",
          details: {
            ruleId: row.ruleId,
            base: row.base.normalize("NFC"),
            gender: row.gender,
            numberMode: row.numberMode,
            articleMode: row.articleMode,
          },
        };
        const forms = resolvedNounForms(candidate, morphology);
        return { ...candidate, italian: forms.singular || forms.plural };
      });
    } catch (caught) {
      setType("noun");
      setError(caught instanceof Error ? caught.message : "A noun definition is invalid.");
      return;
    }

    const updated: Flashcard[] = [
      ...nounCards,
      ...verbRows.map((row) => verbCard({ ...row, ...commonFor(row.id), english: row.english.trim(), infinitive: row.infinitive.trim(), io: row.io.trim(), tu: row.tu.trim(), luiLei: row.luiLei.trim(), noi: row.noi.trim(), voi: row.voi.trim(), loro: row.loro.trim(), participle: row.participle.trim() })),
      ...adjectiveRows.map((row) => adjectiveCard({ ...row, ...commonFor(row.id), english: row.english.trim(), masculineSingular: row.masculineSingular.trim(), feminineSingular: row.feminineSingular.trim(), masculinePlural: row.masculinePlural.trim(), femininePlural: row.femininePlural.trim() })),
      ...adverbRows.map((row) => adverbCard({ ...commonFor(row.id), english: row.english.trim(), form: row.form.trim() })),
    ];
    setError("");
    setSaving(true);
    if (!(await onSave(updated, cards))) setError("The changes could not be saved. The previous cards were restored.");
    setSaving(false);
  }

  function metadataCells(rowId: string) {
    const rowMetadata = metadata[rowId];
    const original = cardById.get(Number(rowId))!;
    return <>
      <td><input aria-label={`Set for ${original.english}`} list="known-card-sets" value={rowMetadata?.setName ?? ""} onChange={(event) => updateMetadata(rowId, "setName", event.target.value)} placeholder="Optional" /></td>
      <td><input aria-label={`Tags for ${original.english}`} value={rowMetadata?.tags ?? ""} onChange={(event) => updateMetadata(rowId, "tags", event.target.value)} placeholder="tag, tag" /></td>
      <td><div className="inventory-row-actions"><button type="button" className="row-open" onClick={() => onOpen(original)} aria-label={`Edit ${original.english}`} title="Edit card">↗</button><button type="button" className="row-remove" onClick={() => { if (window.confirm(`Remove ${original.english}?`)) onRemove(original.id); }} aria-label={`Remove ${original.english}`} title="Remove card">×</button></div></td>
    </>;
  }

  return <form className="inventory-editor" onSubmit={submit}>
    <div className="inventory-editor-heading">
      <div className="mode-tabs" aria-label="Inventory card type">
        {cardTypes.map((item) => <button type="button" key={item} className={type === item ? "active" : ""} disabled={counts[item] === 0} onClick={() => { setType(item); setError(""); }}>{typeLabels[item]}s <span className="tab-count">{counts[item]}</span></button>)}
      </div>
      <label className="inventory-height-toggle"><input type="checkbox" checked={limitHeight} onChange={(event) => setHeightLimited(event.target.checked)} /><span>Limit card list height</span></label>
      <button type="submit" className="primary-button inventory-save" disabled={saving}>{saving ? "Saving…" : `Save visible cards (${cards.length})`}</button>
    </div>
    <datalist id="known-card-sets">{knownSets.map((name) => <option key={name} value={name} />)}</datalist>
    <p className="batch-help">Every visible definition field is editable. Filters use union matching; saving updates the cards currently shown.</p>
    <div className={`batch-table-wrap inventory-table-wrap${limitHeight ? " height-limited" : ""}`}>
      {type === "noun" && <table className="batch-table inventory-edit-table noun-inventory-table"><thead><tr><th>English</th><th>Gender</th><th>Base</th><th>Declension</th><th>Number</th><th>Articles</th><th>Singular</th><th>Plural</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{nounRows.map((row, index) => {
        const rule = morphology.declensionRules.find((item) => item.id === row.ruleId);
        let forms = null;
        try { forms = nounPreview(row, morphology); } catch { /* The row can be fixed in place. */ }
        return <tr key={row.id}>
          <td><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(event) => updateNounRow(row.id, { english: event.target.value })} /></td>
          <td><select aria-label={`Row ${index + 1} gender`} value={row.gender} onChange={(event) => updateNounRow(row.id, { gender: event.target.value as NounGender })}><option value="masculine">M</option><option value="feminine">F</option></select></td>
          <td><input aria-label={`Row ${index + 1} noun base`} value={row.base} onChange={(event) => updateNounRow(row.id, { base: event.target.value })} /></td>
          <td><select aria-label={`Row ${index + 1} declension rule`} value={row.ruleId} onChange={(event) => changeNounRule(row.id, event.target.value)}>{morphology.declensionRules.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td>
          <td><select aria-label={`Row ${index + 1} number behavior`} value={row.numberMode} onChange={(event) => updateNounRow(row.id, { numberMode: event.target.value as NounNumberMode })}><option value="both" disabled={!rule || !ruleSupportsNumberMode(rule, "both")}>Singular + plural</option><option value="singular" disabled={!rule || !ruleSupportsNumberMode(rule, "singular")}>Singular only</option><option value="plural" disabled={!rule || !ruleSupportsNumberMode(rule, "plural")}>Plural only</option></select></td>
          <td><select aria-label={`Row ${index + 1} article behavior`} value={row.articleMode} onChange={(event) => updateNounRow(row.id, { articleMode: event.target.value as NounArticleMode })}><option value="automatic">Automatic</option><option value="none">None</option></select></td>
          <td className="noun-derived-cell">{forms?.singular ? <><strong>{forms.singular}</strong>{forms.articleMode === "automatic" && <small>{joinArticle(forms.definiteSingularArticle, forms.singular)} · {joinArticle(forms.indefiniteArticle, forms.singular)}</small>}</> : <span>—</span>}</td>
          <td className="noun-derived-cell">{forms?.plural ? <><strong>{forms.plural}</strong>{forms.articleMode === "automatic" && <small>{joinArticle(forms.definitePluralArticle, forms.plural)}</small>}</> : <span>—</span>}</td>
          {metadataCells(row.id)}
        </tr>;
      })}</tbody></table>}
      {type === "verb" && <table className="batch-table verb-batch-table inventory-edit-table"><thead><tr><th>English</th><th>Infinitive</th><th>io</th><th>tu</th><th>lui / lei</th><th>noi</th><th>voi</th><th>loro</th><th>Aux.</th><th>Participle</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{verbRows.map((row, index) => <tr key={row.id}><VerbRowCells row={row} index={index} onChange={(field, value) => setVerbRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } as VerbBatchRow : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
      {type === "adjective" && <table className="batch-table adjective-batch-table inventory-edit-table"><thead><tr><th>English</th><th>Masculine singular</th><th>Feminine singular</th><th>Masculine plural</th><th>Feminine plural</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{adjectiveRows.map((row, index) => <tr key={row.id}><AdjectiveRowCells row={row} index={index} onChange={(field, value) => setAdjectiveRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
      {type === "adverb" && <table className="batch-table adverb-batch-table inventory-edit-table"><thead><tr><th>English</th><th>Italian adverb</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{adverbRows.map((row, index) => <tr key={row.id}><AdverbRowCells row={row} index={index} onChange={(field, value) => setAdverbRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
