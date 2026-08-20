import { type FormEvent, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  adjectiveCard,
  adjectiveRowFromCard,
  adverbCard,
  adverbRowFromCard,
  nounCard,
  nounFormsError,
  nounRowFromCard,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchRow,
  type VerbBatchRow,
  updateNounRow,
  verbCard,
  verbRowFromCard,
} from "../cards/editorModel";
import {
  AdjectiveRowCells,
  AdverbRowCells,
  NounRowCells,
  VerbRowCells,
} from "./CardEditorFields";

export function BulkEditCardsModal({ cards, onClose, onSave }: { cards: Flashcard[]; onClose: () => void; onSave: (cards: Flashcard[]) => Promise<boolean> }) {
  const [nounRows, setNounRows] = useState(() => cards.filter((card) => card.type === "noun").map(nounRowFromCard));
  const [verbRows, setVerbRows] = useState(() => cards.filter((card) => card.type === "verb").map(verbRowFromCard));
  const [adjectiveRows, setAdjectiveRows] = useState(() => cards.filter((card) => card.type === "adjective").map(adjectiveRowFromCard));
  const [adverbRows, setAdverbRows] = useState(() => cards.filter((card) => card.type === "adverb").map(adverbRowFromCard));
  const firstType: CardType = nounRows.length ? "noun" : verbRows.length ? "verb" : adjectiveRows.length ? "adjective" : "adverb";
  const [type, setType] = useState<CardType>(firstType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const counts = { noun: nounRows.length, verb: verbRows.length, adjective: adjectiveRows.length, adverb: adverbRows.length };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nounRows.some((row) => !row.english.trim())) { setType("noun"); setError("Every noun needs an English prompt."); return; }
    const nounError = nounRows.map(nounFormsError).find(Boolean);
    if (nounError) { setType("noun"); setError(nounError); return; }
    if (verbRows.some((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((value) => !value.trim()))) { setType("verb"); setError("Every verb needs English, infinitive, all six present-tense forms, and the participle."); return; }
    if (adjectiveRows.some((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((value) => !value.trim()))) { setType("adjective"); setError("Every adjective needs English and all four Italian forms."); return; }
    if (adverbRows.some((row) => !row.english.trim() || !row.form.trim())) { setType("adverb"); setError("Every adverb needs English and an Italian form."); return; }

    const updated: Flashcard[] = [
      ...nounRows.map((row) => {
        const original = cardById.get(Number(row.id))!;
        return nounCard({ ...row, id: original.id, english: row.english.trim(), singular: row.singular.trim(), plural: row.plural.trim(), setName: original.setName, tags: original.tags });
      }),
      ...verbRows.map((row) => {
        const original = cardById.get(Number(row.id))!;
        return verbCard({ ...row, id: original.id, english: row.english.trim(), infinitive: row.infinitive.trim(), io: row.io.trim(), tu: row.tu.trim(), luiLei: row.luiLei.trim(), noi: row.noi.trim(), voi: row.voi.trim(), loro: row.loro.trim(), participle: row.participle.trim(), setName: original.setName, tags: original.tags });
      }),
      ...adjectiveRows.map((row) => {
        const original = cardById.get(Number(row.id))!;
        return adjectiveCard({ ...row, id: original.id, english: row.english.trim(), masculineSingular: row.masculineSingular.trim(), feminineSingular: row.feminineSingular.trim(), masculinePlural: row.masculinePlural.trim(), femininePlural: row.femininePlural.trim(), setName: original.setName, tags: original.tags });
      }),
      ...adverbRows.map((row) => {
        const original = cardById.get(Number(row.id))!;
        return adverbCard({ id: original.id, english: row.english.trim(), form: row.form.trim(), setName: original.setName, tags: original.tags });
      }),
    ];
    setError("");
    setSaving(true);
    if (await onSave(updated)) onClose();
    else { setSaving(false); setError("The changes could not be saved. The previous cards were restored."); }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-edit-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="modal-header"><div><h2 id="bulk-edit-title">Edit cards</h2><p className="modal-subtitle">{cards.length} cards match the selected tags. Sets and tags are preserved.</p></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></header>
      <form onSubmit={submit}>
        <div className="mode-tabs" aria-label="Card type">
          {cardTypes.map((item) => <button type="button" key={item} className={type === item ? "active" : ""} disabled={counts[item] === 0} onClick={() => { setType(item); setError(""); }}>{typeLabels[item]}s <span className="tab-count">{counts[item]}</span></button>)}
        </div>
        <div className="batch-table-wrap bulk-edit-table-wrap">
          {type === "noun" && <table className="batch-table"><thead><tr><th>English</th><th>Gender</th><th>Singular</th><th>Plural</th><th>Def. sg.</th><th>Def. pl.</th><th>Indef.</th><th /></tr></thead><tbody>{nounRows.map((row, index) => <tr key={row.id}><NounRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => setNounRows((rows) => rows.map((item) => item.id === row.id ? updateNounRow(item, field, value) : item))} /><td /></tr>)}</tbody></table>}
          {type === "verb" && <table className="batch-table verb-batch-table"><thead><tr><th>English</th><th>Infinitive</th><th>io</th><th>tu</th><th>lui / lei</th><th>noi</th><th>voi</th><th>loro</th><th>Aux.</th><th>Participle</th><th /></tr></thead><tbody>{verbRows.map((row, index) => <tr key={row.id}><VerbRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => setVerbRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } as VerbBatchRow : item))} /><td /></tr>)}</tbody></table>}
          {type === "adjective" && <table className="batch-table adjective-batch-table"><thead><tr><th>English</th><th>Masculine singular</th><th>Feminine singular</th><th>Masculine plural</th><th>Feminine plural</th><th /></tr></thead><tbody>{adjectiveRows.map((row, index) => <tr key={row.id}><AdjectiveRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => setAdjectiveRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } : item))} /><td /></tr>)}</tbody></table>}
          {type === "adverb" && <table className="batch-table adverb-batch-table"><thead><tr><th>English</th><th>Italian adverb</th><th /></tr></thead><tbody>{adverbRows.map((row, index) => <tr key={row.id}><AdverbRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => setAdverbRows((rows) => rows.map((item) => item.id === row.id ? { ...item, [field]: value } : item))} /><td /></tr>)}</tbody></table>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="modal-actions"><button type="button" className="text-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : `Save ${cards.length} cards`}</button></footer>
      </form>
    </section>
  </div>;
}
