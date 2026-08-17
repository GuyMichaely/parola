import { type FormEvent, useEffect, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  adjectiveCard,
  adjectiveRowFromCard,
  adverbCard,
  adverbRowFromCard,
  deckTagPrefix,
  nounCard,
  nounFormsError,
  nounRowFromCard,
  parseTags,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchRow,
  type VerbBatchRow,
  updateNounRow,
  verbCard,
  verbRowFromCard,
  visibleTags,
} from "../cards/editorModel";
import {
  AdjectiveRowCells,
  AdverbRowCells,
  NounRowCells,
  VerbRowCells,
} from "./CardEditorFields";

type InventoryMetadataDraft = Record<string, { setName: string; tags: string }>;

export function InventoryCardsEditor({
  cards,
  knownSets,
  onSave,
  onOpen,
  onRemove,
}: {
  cards: Flashcard[];
  knownSets: string[];
  onSave: (updated: Flashcard[], original: Flashcard[]) => Promise<boolean>;
  onOpen: (card: Flashcard) => void;
  onRemove: (id: number) => void;
}) {
  const [nounRows, setNounRows] = useState(() => cards.filter((card) => card.type === "noun").map(nounRowFromCard));
  const [verbRows, setVerbRows] = useState(() => cards.filter((card) => card.type === "verb").map(verbRowFromCard));
  const [adjectiveRows, setAdjectiveRows] = useState(() => cards.filter((card) => card.type === "adjective").map(adjectiveRowFromCard));
  const [adverbRows, setAdverbRows] = useState(() => cards.filter((card) => card.type === "adverb").map(adverbRowFromCard));
  const [metadata, setMetadata] = useState<InventoryMetadataDraft>(() => Object.fromEntries(cards.map((card) => [String(card.id), { setName: card.setName ?? "", tags: visibleTags(card.tags).join(", ") }])));
  const firstType: CardType = nounRows.length ? "noun" : verbRows.length ? "verb" : adjectiveRows.length ? "adjective" : "adverb";
  const [type, setType] = useState<CardType>(firstType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const counts = { noun: nounRows.length, verb: verbRows.length, adjective: adjectiveRows.length, adverb: adverbRows.length };

  function updateMetadata(id: string, field: "setName" | "tags", value: string) {
    setMetadata((items) => ({ ...items, [id]: { ...items[id], [field]: value } }));
  }

  function commonFor(rowId: string) {
    const original = cardById.get(Number(rowId))!;
    const rowMetadata = metadata[rowId] ?? { setName: original.setName ?? "", tags: visibleTags(original.tags).join(", ") };
    return {
      id: original.id,
      setName: rowMetadata.setName.trim() || null,
      tags: Array.from(new Set([...original.tags.filter((tag) => tag.startsWith(deckTagPrefix)), ...parseTags(rowMetadata.tags)])),
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nounRows.some((row) => !row.english.trim())) { setType("noun"); setError("Every noun needs an English prompt."); return; }
    const nounError = nounRows.map(nounFormsError).find(Boolean);
    if (nounError) { setType("noun"); setError(nounError); return; }
    if (verbRows.some((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((value) => !value.trim()))) { setType("verb"); setError("Every verb needs English, infinitive, all six present-tense forms, and the participle."); return; }
    if (adjectiveRows.some((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((value) => !value.trim()))) { setType("adjective"); setError("Every adjective needs English and all four Italian forms."); return; }
    if (adverbRows.some((row) => !row.english.trim() || !row.form.trim())) { setType("adverb"); setError("Every adverb needs English and an Italian form."); return; }

    const updated: Flashcard[] = [
      ...nounRows.map((row) => nounCard({ ...row, ...commonFor(row.id), english: row.english.trim(), singular: row.singular.trim(), plural: row.plural.trim() })),
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
      <td><div className="inventory-row-actions"><button type="button" className="row-open" onClick={() => onOpen(original)} aria-label={`Open focused editor for ${original.english}`} title="Focused editor">↗</button><button type="button" className="row-remove" onClick={() => { if (window.confirm(`Remove ${original.english}?`)) onRemove(original.id); }} aria-label={`Remove ${original.english}`} title="Remove card">×</button></div></td>
    </>;
  }

  return <form className="inventory-editor" onSubmit={submit}>
    <div className="inventory-editor-heading">
      <div className="mode-tabs" aria-label="Inventory card type">
        {cardTypes.map((item) => <button type="button" key={item} className={type === item ? "active" : ""} disabled={counts[item] === 0} onClick={() => { setType(item); setError(""); }}>{typeLabels[item]}s <span className="tab-count">{counts[item]}</span></button>)}
      </div>
      <button type="submit" className="primary-button inventory-save" disabled={saving}>{saving ? "Saving…" : `Save visible cards (${cards.length})`}</button>
    </div>
    <datalist id="known-card-sets">{knownSets.map((name) => <option key={name} value={name} />)}</datalist>
    <p className="batch-help">Every visible field is editable. Filters use union matching; saving updates the cards currently shown.</p>
    <div className="batch-table-wrap inventory-table-wrap">
      {type === "noun" && <table className="batch-table inventory-edit-table noun-inventory-table"><thead><tr><th>English</th><th>Gender</th><th>Singular</th><th>Plural</th><th>Def. sg.</th><th>Def. pl.</th><th>Indef.</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{nounRows.map((row, index) => <tr key={row.id}><NounRowCells row={row} index={index} onChange={(field, value) => setNounRows((rows) => rows.map((item) => item.id === row.id ? updateNounRow(item, field, value) : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
      {type === "verb" && <table className="batch-table verb-batch-table inventory-edit-table"><thead><tr><th>English</th><th>Infinitive</th><th>io</th><th>tu</th><th>lui / lei</th><th>noi</th><th>voi</th><th>loro</th><th>Aux.</th><th>Participle</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{verbRows.map((row, index) => <tr key={row.id}><VerbRowCells row={row} index={index} onChange={(field, value) => setVerbRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } as VerbBatchRow : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
      {type === "adjective" && <table className="batch-table adjective-batch-table inventory-edit-table"><thead><tr><th>English</th><th>Masculine singular</th><th>Feminine singular</th><th>Masculine plural</th><th>Feminine plural</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{adjectiveRows.map((row, index) => <tr key={row.id}><AdjectiveRowCells row={row} index={index} onChange={(field, value) => setAdjectiveRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
      {type === "adverb" && <table className="batch-table adverb-batch-table inventory-edit-table"><thead><tr><th>English</th><th>Italian adverb</th><th>Set</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{adverbRows.map((row, index) => <tr key={row.id}><AdverbRowCells row={row} index={index} onChange={(field, value) => setAdverbRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } : item))} />{metadataCells(row.id)}</tr>)}</tbody></table>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
