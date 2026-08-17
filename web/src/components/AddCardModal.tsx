import { type FormEvent, useEffect, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  adjectiveCard,
  adverbCard,
  clearBatchDraft,
  emptyAdjectiveBatchRow,
  emptyAdverbBatchRow,
  emptyBatchRow,
  emptyVerbBatchRow,
  newRowId,
  normalizeNounRow,
  nounCard,
  nounFormsError,
  parseTags,
  readBatchDraft,
  readCardAdderType,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchDraft,
  type BatchRow,
  type VerbBatchRow,
  updateNounRow,
  verbCard,
  writeBatchDraft,
  writeCardAdderType,
} from "../cards/editorModel";
import {
  AdjectiveRowCells,
  AdverbRowCells,
  NounRowCells,
  SetField,
  TagsField,
  VerbRowCells,
} from "./CardEditorFields";

export function BatchNouns({
  knownSets,
  saving,
  error,
  onSave,
  onCancel,
}: {
  knownSets: string[];
  saving: boolean;
  error: string;
  onSave: (cards: Flashcard[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BatchDraft<BatchRow>>(() => {
    const stored = readBatchDraft("noun", () => Array.from({ length: 3 }, (_, index) => emptyBatchRow(String(index + 1))));
    return { ...stored, rows: stored.rows.map(normalizeNounRow) };
  });
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => {
    writeBatchDraft("noun", draft);
  }, [draft]);

  function updateRow<K extends keyof BatchRow>(id: string, field: K, value: BatchRow[K]) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? updateNounRow(row, field, value) : row);
      const last = updated.at(-1);
      const nextRows = last && (last.english.trim() || last.singular.trim() || last.plural.trim())
        ? [...updated, emptyBatchRow(newRowId())]
        : updated;
      return { ...currentDraft, rows: nextRows };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    const used = rows.filter((row) => row.english.trim() || row.singular.trim() || row.plural.trim());
    if (!used.length) {
      setLocalError("Enter at least one noun.");
      return;
    }
    if (used.some((row) => !row.english.trim())) {
      setLocalError("Each used row needs an English prompt.");
      return;
    }
    const formsError = used.map(nounFormsError).find(Boolean);
    if (formsError) {
      setLocalError(formsError);
      return;
    }
    setLocalError("");
    await onSave(used.map((row, index) => nounCard({
      ...row,
      id: Date.now() + index,
      english: row.english.trim(),
      singular: row.singular.trim(),
      plural: row.plural.trim(),
      setName,
      tags,
    })));
  }

  return (
    <form onSubmit={submit}>
      <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
      <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
      <p className="batch-help">One noun per row. Articles are suggested from gender and spelling—including lo / gli / uno forms—and remain editable. Choose None when a stored form takes no article. Progress saves automatically on this device.</p>
      <div className="batch-table-wrap">
        <table className="batch-table">
          <thead><tr><th>English</th><th>Gender</th><th>Singular</th><th>Plural</th><th>Def. sg.</th><th>Def. pl.</th><th>Indef.</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <NounRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} />
            </tr>)}
          </tbody>
        </table>
      </div>
      {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
      <footer className="modal-actions">
        <button type="button" className="text-button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add batch"}</button>
      </footer>
    </form>
  );
}

export function BatchVerbs({
  knownSets,
  saving,
  error,
  onSave,
  onCancel,
}: {
  knownSets: string[];
  saving: boolean;
  error: string;
  onSave: (cards: Flashcard[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BatchDraft<VerbBatchRow>>(() => readBatchDraft("verb", () => Array.from({ length: 3 }, (_, index) => emptyVerbBatchRow(String(index + 1)))));
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => {
    writeBatchDraft("verb", draft);
  }, [draft]);

  function updateRow(id: string, field: keyof VerbBatchRow, value: string) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? { ...row, [field]: value } as VerbBatchRow : row);
      const last = updated.at(-1);
      const hasText = last && [last.english, last.infinitive, last.io, last.tu, last.luiLei, last.noi, last.voi, last.loro, last.participle].some((item) => item.trim());
      return { ...currentDraft, rows: hasText ? [...updated, emptyVerbBatchRow(newRowId())] : updated };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    const used = rows.filter((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((item) => item.trim()));
    if (!used.length) {
      setLocalError("Enter at least one verb.");
      return;
    }
    if (used.some((row) => [row.english, row.infinitive, row.io, row.tu, row.luiLei, row.noi, row.voi, row.loro, row.participle].some((item) => !item.trim()))) {
      setLocalError("Every used verb row needs English, infinitive, all six present-tense forms, and the participle.");
      return;
    }
    setLocalError("");
    await onSave(used.map((row, index) => verbCard({
      ...row,
      id: Date.now() + index,
      english: row.english.trim(),
      infinitive: row.infinitive.trim(),
      io: row.io.trim(),
      tu: row.tu.trim(),
      luiLei: row.luiLei.trim(),
      noi: row.noi.trim(),
      voi: row.voi.trim(),
      loro: row.loro.trim(),
      participle: row.participle.trim(),
      setName,
      tags,
    })));
  }

  return (
    <form onSubmit={submit}>
      <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
      <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
      <p className="batch-help">One verb per row. A fresh row appears automatically when you begin the last one. Progress saves automatically on this device.</p>
      <div className="batch-table-wrap">
        <table className="batch-table verb-batch-table">
          <thead><tr><th>English</th><th>Infinitive</th><th>io</th><th>tu</th><th>lui / lei</th><th>noi</th><th>voi</th><th>loro</th><th>Aux.</th><th>Participle</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <VerbRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} />
            </tr>)}
          </tbody>
        </table>
      </div>
      {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
      <footer className="modal-actions">
        <button type="button" className="text-button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add verbs"}</button>
      </footer>
    </form>
  );
}

export function BatchAdjectives({
  knownSets,
  saving,
  error,
  onSave,
  onCancel,
}: {
  knownSets: string[];
  saving: boolean;
  error: string;
  onSave: (cards: Flashcard[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BatchDraft<AdjectiveBatchRow>>(() => readBatchDraft("adjective", () => Array.from({ length: 3 }, (_, index) => emptyAdjectiveBatchRow(String(index + 1)))));
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => {
    writeBatchDraft("adjective", draft);
  }, [draft]);

  function updateRow(id: string, field: keyof AdjectiveBatchRow, value: string) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? { ...row, [field]: value } : row);
      const last = updated.at(-1);
      const nextRows = last && [last.english, last.masculineSingular, last.feminineSingular, last.masculinePlural, last.femininePlural].some((item) => item.trim())
        ? [...updated, emptyAdjectiveBatchRow(newRowId())]
        : updated;
      return { ...currentDraft, rows: nextRows };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    const used = rows.filter((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((item) => item.trim()));
    if (!used.length) {
      setLocalError("Enter at least one adjective.");
      return;
    }
    if (used.some((row) => [row.english, row.masculineSingular, row.feminineSingular, row.masculinePlural, row.femininePlural].some((item) => !item.trim()))) {
      setLocalError("Every used adjective row needs English and all four Italian forms.");
      return;
    }
    setLocalError("");
    await onSave(used.map((row, index) => adjectiveCard({
      ...row,
      id: Date.now() + index,
      english: row.english.trim(),
      masculineSingular: row.masculineSingular.trim(),
      feminineSingular: row.feminineSingular.trim(),
      masculinePlural: row.masculinePlural.trim(),
      femininePlural: row.femininePlural.trim(),
      setName,
      tags,
    })));
  }

  return (
    <form onSubmit={submit}>
      <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
      <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
      <p className="batch-help">One adjective per row. A fresh row appears automatically when you begin the last one. Progress saves automatically on this device.</p>
      <div className="batch-table-wrap">
        <table className="batch-table adjective-batch-table">
          <thead><tr><th>English</th><th>Masculine singular</th><th>Feminine singular</th><th>Masculine plural</th><th>Feminine plural</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <AdjectiveRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} />
            </tr>)}
          </tbody>
        </table>
      </div>
      {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
      <footer className="modal-actions">
        <button type="button" className="text-button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add adjectives"}</button>
      </footer>
    </form>
  );
}

export function BatchAdverbs({ knownSets, saving, error, onSave, onCancel }: { knownSets: string[]; saving: boolean; error: string; onSave: (cards: Flashcard[]) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<BatchDraft<AdverbBatchRow>>(() => readBatchDraft("adverb", () => Array.from({ length: 3 }, (_, index) => emptyAdverbBatchRow(String(index + 1)))));
  const [localError, setLocalError] = useState("");
  const rows = draft.rows;

  useEffect(() => { writeBatchDraft("adverb", draft); }, [draft]);

  function updateRow(id: string, field: keyof AdverbBatchRow, value: string) {
    setDraft((currentDraft) => {
      const updated = currentDraft.rows.map((row) => row.id === id ? { ...row, [field]: value } : row);
      const last = updated.at(-1);
      return { ...currentDraft, rows: last && (last.english.trim() || last.form.trim()) ? [...updated, emptyAdverbBatchRow(newRowId())] : updated };
    });
  }

  function removeRow(id: string) {
    setDraft((currentDraft) => ({ ...currentDraft, rows: currentDraft.rows.length === 1 ? currentDraft.rows : currentDraft.rows.filter((row) => row.id !== id) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const used = rows.filter((row) => row.english.trim() || row.form.trim());
    if (!used.length) { setLocalError("Enter at least one adverb."); return; }
    if (used.some((row) => !row.english.trim() || !row.form.trim())) { setLocalError("Every used adverb row needs English and an Italian form."); return; }
    setLocalError("");
    const setName = draft.setName.trim() || null;
    const tags = parseTags(draft.tags);
    await onSave(used.map((row, index) => adverbCard({ id: Date.now() + index, english: row.english.trim(), form: row.form.trim(), setName, tags })));
  }

  return <form onSubmit={submit}>
    <SetField knownSets={knownSets} value={draft.setName} onChange={(setName) => setDraft((currentDraft) => ({ ...currentDraft, setName }))} />
    <TagsField value={draft.tags} onChange={(tags) => setDraft((currentDraft) => ({ ...currentDraft, tags }))} />
    <p className="batch-help">One invariant adverb per row. A fresh row appears automatically when you begin the last one. Progress saves automatically on this device.</p>
    <div className="batch-table-wrap"><table className="batch-table adverb-batch-table"><thead><tr><th>English</th><th>Italian adverb</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={row.id}><AdverbRowCells row={row} index={index} autoFocus={index === 0} onChange={(field, value) => updateRow(row.id, field, value)} onRemove={() => removeRow(row.id)} /></tr>)}
    </tbody></table></div>
    {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
    <footer className="modal-actions"><button type="button" className="text-button" onClick={onCancel} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add adverbs"}</button></footer>
  </form>;
}

export function AddCardModal({
  knownSets,
  onClose,
  onBatch,
}: {
  knownSets: string[];
  onClose: () => void;
  onBatch: (cards: Flashcard[]) => Promise<void>;
}) {
  const [type, setType] = useState<CardType>(readCardAdderType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    writeCardAdderType(type);
  }, [type]);

  async function saveBatch(cards: Flashcard[]) {
    try {
      setSaving(true);
      setError("");
      await onBatch(cards);
      if (cards[0]) clearBatchDraft(cards[0].type);
      onClose();
    } catch {
      setSaving(false);
      setError("The batch could not be saved. Try again.");
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="add-card-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2 id="add-card-title">Add cards</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="mode-tabs" aria-label="Card type">
          {cardTypes.map((item) => (
            <button key={item} className={type === item ? "active" : ""} onClick={() => { setType(item); setError(""); }}>{typeLabels[item]}s</button>
          ))}
        </div>

        {type === "noun" && <BatchNouns knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
        {type === "verb" && <BatchVerbs knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
        {type === "adjective" && <BatchAdjectives knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
        {type === "adverb" && <BatchAdverbs knownSets={knownSets} saving={saving} error={error} onSave={saveBatch} onCancel={onClose} />}
      </section>
    </div>
  );
}
