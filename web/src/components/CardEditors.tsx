import { type FormEvent, useEffect, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { cardTypes, typeLabels } from "../cardTypes";
import {
  inferArticle,
  normalizeAnswer,
  standardAdjectivePattern,
  standardNounPattern,
} from "../study/logic";

type BatchRow = {
  id: string;
  english: string;
  gender: "masculine" | "feminine";
  singular: string;
  plural: string;
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
};

type VerbBatchRow = {
  id: string;
  english: string;
  infinitive: string;
  io: string;
  tu: string;
  luiLei: string;
  noi: string;
  voi: string;
  loro: string;
  auxiliary: "avere" | "essere";
  participle: string;
};

type AdjectiveBatchRow = {
  id: string;
  english: string;
  masculineSingular: string;
  feminineSingular: string;
  masculinePlural: string;
  femininePlural: string;
};

type AdverbBatchRow = {
  id: string;
  english: string;
  form: string;
};

type BatchDraft<Row> = {
  setName: string;
  tags: string;
  rows: Row[];
};

const cardAdderTypeKey = "parola:card-adder:type";
export const deckTagPrefix = "__deck__:";
export function cardAdderDraftKey(type: CardType) {
  return `parola:card-adder:${type}`;
}

export function readCardAdderType(): CardType {
  if (typeof window === "undefined") return "noun";
  try {
    const stored = window.localStorage.getItem(cardAdderTypeKey);
    return cardTypes.includes(stored as CardType) ? stored as CardType : "noun";
  } catch {
    return "noun";
  }
}

export function readBatchDraft<Row>(type: CardType, createRows: () => Row[]): BatchDraft<Row> {
  const fallback = { setName: "", tags: "", rows: createRows() };
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(cardAdderDraftKey(type));
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<BatchDraft<Row>>;
    return {
      setName: typeof parsed.setName === "string" ? parsed.setName : "",
      tags: typeof parsed.tags === "string" ? parsed.tags : "",
      rows: Array.isArray(parsed.rows) && parsed.rows.length ? parsed.rows : createRows(),
    };
  } catch {
    return fallback;
  }
}

export function clearBatchDraft(type: CardType) {
  try {
    window.localStorage.removeItem(cardAdderDraftKey(type));
  } catch {
    // Draft persistence is a convenience; saving cards must still work if storage is unavailable.
  }
}

export function writeBatchDraft<Row>(type: CardType, draft: BatchDraft<Row>) {
  try {
    window.localStorage.setItem(cardAdderDraftKey(type), JSON.stringify(draft));
  } catch {
    // Keep the editor usable when the browser blocks or exhausts local storage.
  }
}

export function writeCardAdderType(type: CardType) {
  try {
    window.localStorage.setItem(cardAdderTypeKey, type);
  } catch {
    // Keep the editor usable when the browser blocks local storage.
  }
}

let nextRowId = 0;

export function newRowId() {
  nextRowId += 1;
  return `${Date.now()}-${nextRowId}`;
}

export function joinArticle(article: string, noun: string) {
  const cleanArticle = article.trim();
  const cleanNoun = noun.trim();
  if (!cleanArticle) return cleanNoun;
  return cleanArticle.endsWith("’") || cleanArticle.endsWith("'")
    ? `${cleanArticle}${cleanNoun}`
    : `${cleanArticle} ${cleanNoun}`;
}

export function parseTags(value: string) {
  return Array.from(new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean)));
}

export function visibleTags(tags: string[]) {
  return tags.filter((tag) => !tag.startsWith(deckTagPrefix));
}

export function deckName(tag: string) {
  return tag.startsWith(deckTagPrefix) ? tag.slice(deckTagPrefix.length) : null;
}

export function localDateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function emptyBatchRow(id: string): BatchRow {
  return {
    id,
    english: "",
    gender: "masculine",
    singular: "",
    plural: "",
    definiteSingularArticle: "",
    definitePluralArticle: "",
    indefiniteArticle: "",
  };
}

export function nounFormsError(input: Pick<BatchRow, "singular" | "plural" | "definiteSingularArticle" | "definitePluralArticle" | "indefiniteArticle">) {
  const singular = Boolean(input.singular.trim());
  const plural = Boolean(input.plural.trim());
  const definiteSingular = Boolean(input.definiteSingularArticle.trim());
  const definitePlural = Boolean(input.definitePluralArticle.trim());
  const indefinite = Boolean(input.indefiniteArticle.trim());
  if (!singular && !plural) return "Enter at least a singular or plural form.";
  if (!singular && (definiteSingular || indefinite)) return "Singular articles require a singular noun form.";
  if (!plural && definitePlural) return "A definite plural article requires a plural noun form.";
  return "";
}

export function emptyVerbBatchRow(id: string): VerbBatchRow {
  return {
    id,
    english: "",
    infinitive: "",
    io: "",
    tu: "",
    luiLei: "",
    noi: "",
    voi: "",
    loro: "",
    auxiliary: "avere",
    participle: "",
  };
}

export function emptyAdjectiveBatchRow(id: string): AdjectiveBatchRow {
  return {
    id,
    english: "",
    masculineSingular: "",
    feminineSingular: "",
    masculinePlural: "",
    femininePlural: "",
  };
}

export function emptyAdverbBatchRow(id: string): AdverbBatchRow {
  return { id, english: "", form: "" };
}

export function nounCard(input: {
  id: number;
  english: string;
  setName: string | null;
  tags: string[];
  gender: string;
  singular: string;
  plural: string;
  definiteSingularArticle: string;
  definitePluralArticle: string;
  indefiniteArticle: string;
}): Flashcard {
  const definiteSingular = joinArticle(input.definiteSingularArticle, input.singular);
  const definitePlural = joinArticle(input.definitePluralArticle, input.plural);
  const indefinite = joinArticle(input.indefiniteArticle, input.singular);
  return {
    id: input.id,
    type: "noun",
    english: input.english,
    italian: input.singular || input.plural,
    setName: input.setName,
    tags: input.tags,
    details: {
      gender: input.gender,
      singular: input.singular,
      plural: input.plural,
      definiteSingularArticle: input.definiteSingularArticle,
      definitePluralArticle: input.definitePluralArticle,
      indefiniteArticle: input.indefiniteArticle,
      definiteSingular,
      definitePlural,
      indefinite,
    },
  };
}

export function verbCard(input: Omit<VerbBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): Flashcard {
  return {
    id: input.id,
    type: "verb",
    english: input.english,
    italian: input.infinitive,
    setName: input.setName,
    tags: input.tags,
    details: {
      io: input.io,
      tu: input.tu,
      luiLei: input.luiLei,
      noi: input.noi,
      voi: input.voi,
      loro: input.loro,
      auxiliary: input.auxiliary,
      participle: input.participle,
    },
  };
}

export function adjectiveCard(input: Omit<AdjectiveBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): Flashcard {
  return {
    id: input.id,
    type: "adjective",
    english: input.english,
    italian: input.masculineSingular,
    setName: input.setName,
    tags: input.tags,
    details: {
      masculineSingular: input.masculineSingular,
      feminineSingular: input.feminineSingular,
      masculinePlural: input.masculinePlural,
      femininePlural: input.femininePlural,
    },
  };
}

export function adverbCard(input: Omit<AdverbBatchRow, "id"> & { id: number; setName: string | null; tags: string[] }): Flashcard {
  return { id: input.id, type: "adverb", english: input.english, italian: input.form, setName: input.setName, tags: input.tags, details: {} };
}

export function SetField({
  knownSets,
  initialSet = "",
  value,
  onChange,
}: {
  knownSets: string[];
  initialSet?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="field set-field">
      <span>Lesson / unit set <em>optional</em></span>
      <input
        name="setName"
        list="known-card-sets"
        placeholder="e.g. Unit 2 · Food"
        autoComplete="off"
        {...(value === undefined ? { defaultValue: initialSet } : { value, onChange: (event) => onChange?.(event.target.value) })}
      />
      <datalist id="known-card-sets">
        {knownSets.map((name) => <option key={name} value={name} />)}
      </datalist>
    </label>
  );
}

export function TagsField({
  initialTags = [],
  value,
  onChange,
}: {
  initialTags?: string[];
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="field tags-field">
      <span>Tags <em>comma separated</em></span>
      <input
        name="tags"
        placeholder="travel, review, food"
        {...(value === undefined ? { defaultValue: initialTags.join(", ") } : { value, onChange: (event) => onChange?.(event.target.value) })}
      />
    </label>
  );
}

export function nounRowFromCard(card: Flashcard): BatchRow {
  const d = card.details;
  const singular = d.singular ?? card.italian;
  const plural = d.plural ?? "";
  return {
    id: String(card.id),
    english: card.english,
    gender: d.gender === "feminine" ? "feminine" : "masculine",
    singular,
    plural,
    definiteSingularArticle: singular ? (d.definiteSingularArticle ?? inferArticle(d.definiteSingular, singular, "")) : "",
    definitePluralArticle: plural ? (d.definitePluralArticle ?? inferArticle(d.definitePlural, plural, "")) : "",
    indefiniteArticle: singular ? (d.indefiniteArticle ?? inferArticle(d.indefinite, singular, "")) : "",
  };
}

export function verbRowFromCard(card: Flashcard): VerbBatchRow {
  return { id: String(card.id), english: card.english, infinitive: card.italian, io: card.details.io ?? "", tu: card.details.tu ?? "", luiLei: card.details.luiLei ?? "", noi: card.details.noi ?? "", voi: card.details.voi ?? "", loro: card.details.loro ?? "", auxiliary: card.details.auxiliary === "essere" ? "essere" : "avere", participle: card.details.participle ?? "" };
}

export function adjectiveRowFromCard(card: Flashcard): AdjectiveBatchRow {
  return { id: String(card.id), english: card.english, masculineSingular: card.details.masculineSingular ?? card.italian, feminineSingular: card.details.feminineSingular ?? "", masculinePlural: card.details.masculinePlural ?? "", femininePlural: card.details.femininePlural ?? "" };
}

export function adverbRowFromCard(card: Flashcard): AdverbBatchRow {
  return { id: String(card.id), english: card.english, form: card.italian };
}

export function normalizeNounRow(row: BatchRow): BatchRow {
  const singular = row.singular ?? "";
  const plural = row.plural ?? "";
  return {
    id: row.id,
    english: row.english ?? "",
    gender: row.gender === "feminine" ? "feminine" : "masculine",
    singular,
    plural,
    definiteSingularArticle: !singular.trim() ? "" : (row.definiteSingularArticle ?? ""),
    definitePluralArticle: !plural.trim() ? "" : (row.definitePluralArticle ?? ""),
    indefiniteArticle: !singular.trim() ? "" : (row.indefiniteArticle ?? ""),
  };
}

export function suggestedNounArticles(gender: BatchRow["gender"], singular: string, plural: string) {
  const startsWithVowel = (word: string) => /^[aeiouàèéìòóù]/u.test(normalizeAnswer(word));
  const takesLoSet = (word: string) => {
    const normalized = normalizeAnswer(word);
    return /^(?:z|x|y|gn|ps|pn)/u.test(normalized)
      || /^s[^aeiouàèéìòóù]/u.test(normalized)
      || /^i[aeouàèéòóù]/u.test(normalized);
  };
  if (gender === "feminine") {
    return {
      definiteSingularArticle: singular.trim() ? (startsWithVowel(singular) ? "l’" : "la") : "",
      definitePluralArticle: plural.trim() ? "le" : "",
      indefiniteArticle: singular.trim() ? (startsWithVowel(singular) ? "un’" : "una") : "",
    };
  }
  return {
    definiteSingularArticle: singular.trim() ? (startsWithVowel(singular) ? "l’" : takesLoSet(singular) ? "lo" : "il") : "",
    definitePluralArticle: plural.trim() ? (startsWithVowel(plural) || takesLoSet(plural) ? "gli" : "i") : "",
    indefiniteArticle: singular.trim() ? (takesLoSet(singular) ? "uno" : "un") : "",
  };
}

export function updateNounRow<K extends keyof BatchRow>(row: BatchRow, field: K, value: BatchRow[K]) {
  if (field === "singular" || field === "plural" || field === "gender") {
    const previous = suggestedNounArticles(row.gender, row.singular, row.plural);
    const nextRow = { ...row, [field]: value } as BatchRow;
    const next = suggestedNounArticles(nextRow.gender, nextRow.singular, nextRow.plural);
    const keepOrSuggest = (current: string, previousSuggestion: string, nextSuggestion: string) => !current || current === previousSuggestion ? nextSuggestion : current;
    return {
      ...nextRow,
      definiteSingularArticle: nextRow.singular.trim() ? keepOrSuggest(row.definiteSingularArticle, previous.definiteSingularArticle, next.definiteSingularArticle) : "",
      definitePluralArticle: nextRow.plural.trim() ? keepOrSuggest(row.definitePluralArticle, previous.definitePluralArticle, next.definitePluralArticle) : "",
      indefiniteArticle: nextRow.singular.trim() ? keepOrSuggest(row.indefiniteArticle, previous.indefiniteArticle, next.indefiniteArticle) : "",
    };
  }
  return { ...row, [field]: value } as BatchRow;
}

export function NounRowCells({ row, index, onChange, onRemove, autoFocus = false }: { row: BatchRow; index: number; onChange: <K extends keyof BatchRow>(field: K, value: BatchRow[K]) => void; onRemove?: () => void; autoFocus?: boolean }) {
  const singularDisabled = !row.singular.trim();
  const pluralDisabled = !row.plural.trim();
  return <>
    <td><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(e) => onChange("english", e.target.value)} placeholder="the book" autoFocus={autoFocus} /></td>
    <td><select aria-label={`Row ${index + 1} gender`} value={row.gender} onChange={(e) => onChange("gender", e.target.value as BatchRow["gender"])}><option value="masculine">M</option><option value="feminine">F</option></select></td>
    <td><input aria-label={`Row ${index + 1} singular`} value={row.singular} onChange={(e) => onChange("singular", e.target.value)} placeholder="libro" /></td>
    <td><input aria-label={`Row ${index + 1} plural`} value={row.plural} onChange={(e) => onChange("plural", e.target.value)} placeholder="libri" /></td>
    <td><select aria-label={`Row ${index + 1} definite singular article`} value={row.definiteSingularArticle} onChange={(e) => onChange("definiteSingularArticle", e.target.value)} disabled={singularDisabled}><option value="">None</option><option>il</option><option>lo</option><option>la</option><option>l’</option></select></td>
    <td><select aria-label={`Row ${index + 1} definite plural article`} value={row.definitePluralArticle} onChange={(e) => onChange("definitePluralArticle", e.target.value)} disabled={pluralDisabled}><option value="">None</option><option>i</option><option>gli</option><option>le</option></select></td>
    <td><select aria-label={`Row ${index + 1} indefinite article`} value={row.indefiniteArticle} onChange={(e) => onChange("indefiniteArticle", e.target.value)} disabled={singularDisabled}><option value="">None</option><option>un</option><option>uno</option><option>una</option><option>un’</option></select></td>
    {onRemove && <td><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

export function VerbRowCells({ row, index, onChange, onRemove, autoFocus = false }: { row: VerbBatchRow; index: number; onChange: (field: keyof VerbBatchRow, value: string) => void; onRemove?: () => void; autoFocus?: boolean }) {
  return <>
    <td><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(e) => onChange("english", e.target.value)} placeholder="to understand" autoFocus={autoFocus} /></td>
    <td><input aria-label={`Row ${index + 1} infinitive`} value={row.infinitive} onChange={(e) => onChange("infinitive", e.target.value)} placeholder="capire" /></td>
    {(["io", "tu", "luiLei", "noi", "voi", "loro"] as const).map((field) => <td key={field}><input aria-label={`Row ${index + 1} ${field === "luiLei" ? "lui or lei" : field}`} value={row[field]} onChange={(e) => onChange(field, e.target.value)} /></td>)}
    <td><select aria-label={`Row ${index + 1} auxiliary`} value={row.auxiliary} onChange={(e) => onChange("auxiliary", e.target.value)}><option value="avere">avere</option><option value="essere">essere</option></select></td>
    <td><input aria-label={`Row ${index + 1} past participle`} value={row.participle} onChange={(e) => onChange("participle", e.target.value)} placeholder="capito" /></td>
    {onRemove && <td><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

export function AdjectiveRowCells({ row, index, onChange, onRemove, autoFocus = false }: { row: AdjectiveBatchRow; index: number; onChange: (field: keyof AdjectiveBatchRow, value: string) => void; onRemove?: () => void; autoFocus?: boolean }) {
  return <>
    <td><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(e) => onChange("english", e.target.value)} placeholder="beautiful" autoFocus={autoFocus} /></td>
    {(["masculineSingular", "feminineSingular", "masculinePlural", "femininePlural"] as const).map((field) => <td key={field}><input aria-label={`Row ${index + 1} ${field}`} value={row[field]} onChange={(e) => onChange(field, e.target.value)} /></td>)}
    {onRemove && <td><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

export function AdverbRowCells({ row, index, onChange, onRemove, autoFocus = false }: { row: AdverbBatchRow; index: number; onChange: (field: keyof AdverbBatchRow, value: string) => void; onRemove?: () => void; autoFocus?: boolean }) {
  return <>
    <td><input aria-label={`Row ${index + 1} English`} value={row.english} onChange={(event) => onChange("english", event.target.value)} placeholder="very; a lot" autoFocus={autoFocus} /></td>
    <td><input aria-label={`Row ${index + 1} adverb`} value={row.form} onChange={(event) => onChange("form", event.target.value)} placeholder="molto" /></td>
    {onRemove && <td><button type="button" className="row-remove" tabIndex={-1} onClick={onRemove} aria-label={`Remove row ${index + 1}`}>×</button></td>}
  </>;
}

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

export function EditCardModal({
  card,
  knownSets,
  onClose,
  onSave,
}: {
  card: Flashcard;
  knownSets: string[];
  onClose: () => void;
  onSave: (card: Flashcard) => void;
}) {
  const [formError, setFormError] = useState("");
  const [setName, setSetName] = useState(card.setName ?? "");
  const [tags, setTags] = useState(visibleTags(card.tags).join(", "));
  const [nounRow, setNounRow] = useState<BatchRow>(() => nounRowFromCard(card));
  const [verbRow, setVerbRow] = useState<VerbBatchRow>(() => verbRowFromCard(card));
  const [adjectiveRow, setAdjectiveRow] = useState<AdjectiveBatchRow>(() => adjectiveRowFromCard(card));
  const [adverbRow, setAdverbRow] = useState<AdverbBatchRow>(() => adverbRowFromCard(card));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const preservedDeckTags = card.tags.filter((tag) => tag.startsWith(deckTagPrefix));
    const common = {
      id: card.id,
      type: card.type,
      setName: setName.trim() || null,
      tags: Array.from(new Set([...preservedDeckTags, ...parseTags(tags)])),
    };
    let updated: Flashcard;
    if (card.type === "noun") {
      if (!nounRow.english.trim()) { setFormError("Enter an English prompt."); return; }
      const nounFields = { singular: nounRow.singular.trim(), plural: nounRow.plural.trim(), definiteSingularArticle: nounRow.definiteSingularArticle, definitePluralArticle: nounRow.definitePluralArticle, indefiniteArticle: nounRow.indefiniteArticle };
      const formsError = nounFormsError(nounFields);
      if (formsError) {
        setFormError(formsError);
        return;
      }
      updated = nounCard({
        ...common,
        english: nounRow.english.trim(),
        gender: nounRow.gender,
        ...nounFields,
      });
    } else if (card.type === "verb") {
      if ([verbRow.english, verbRow.infinitive, verbRow.io, verbRow.tu, verbRow.luiLei, verbRow.noi, verbRow.voi, verbRow.loro, verbRow.participle].some((value) => !value.trim())) { setFormError("English, infinitive, all six present-tense forms, and the participle are required."); return; }
      updated = { ...common, english: verbRow.english.trim(), italian: verbRow.infinitive.trim(), details: {
        io: verbRow.io.trim(), tu: verbRow.tu.trim(), luiLei: verbRow.luiLei.trim(), noi: verbRow.noi.trim(),
        voi: verbRow.voi.trim(), loro: verbRow.loro.trim(), auxiliary: verbRow.auxiliary, participle: verbRow.participle.trim(),
      }};
    } else if (card.type === "adjective") {
      if ([adjectiveRow.english, adjectiveRow.masculineSingular, adjectiveRow.feminineSingular, adjectiveRow.masculinePlural, adjectiveRow.femininePlural].some((value) => !value.trim())) { setFormError("English and all four Italian adjective forms are required."); return; }
      updated = { ...common, english: adjectiveRow.english.trim(), italian: adjectiveRow.masculineSingular.trim(), details: {
        masculineSingular: adjectiveRow.masculineSingular.trim(), feminineSingular: adjectiveRow.feminineSingular.trim(),
        masculinePlural: adjectiveRow.masculinePlural.trim(), femininePlural: adjectiveRow.femininePlural.trim(),
      }};
    } else {
      if (!adverbRow.english.trim() || !adverbRow.form.trim()) { setFormError("English and the Italian adverb are required."); return; }
      updated = { ...common, english: adverbRow.english.trim(), italian: adverbRow.form.trim(), details: {} };
    }
    setFormError("");
    onSave(updated);
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="edit-card-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div className="edit-title"><h2 id="edit-card-title">Edit card</h2><span className={`inline-type-tag ${card.type}`}>{typeLabels[card.type]}</span></div>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={submit}>
          <div className="edit-fields-top">
            <SetField knownSets={knownSets} value={setName} onChange={setSetName} />
            <TagsField value={tags} onChange={setTags} />
          </div>
          <p className="batch-help">Edit the card in the same column layout used by bulk entry.</p>
          <div className="batch-table-wrap">
            {card.type === "noun" && <table className="batch-table"><thead><tr><th>English</th><th>Gender</th><th>Singular</th><th>Plural</th><th>Def. sg.</th><th>Def. pl.</th><th>Indef.</th><th /></tr></thead><tbody><tr><NounRowCells row={nounRow} index={0} autoFocus onChange={(field, value) => setNounRow((row) => updateNounRow(row, field, value))} /><td /></tr></tbody></table>}
            {card.type === "verb" && <table className="batch-table verb-batch-table"><thead><tr><th>English</th><th>Infinitive</th><th>io</th><th>tu</th><th>lui / lei</th><th>noi</th><th>voi</th><th>loro</th><th>Aux.</th><th>Participle</th><th /></tr></thead><tbody><tr><VerbRowCells row={verbRow} index={0} autoFocus onChange={(field, value) => setVerbRow((row) => ({ ...row, [field]: value } as VerbBatchRow))} /><td /></tr></tbody></table>}
            {card.type === "adjective" && <table className="batch-table adjective-batch-table"><thead><tr><th>English</th><th>Masculine singular</th><th>Feminine singular</th><th>Masculine plural</th><th>Feminine plural</th><th /></tr></thead><tbody><tr><AdjectiveRowCells row={adjectiveRow} index={0} autoFocus onChange={(field, value) => setAdjectiveRow((row) => ({ ...row, [field]: value }))} /><td /></tr></tbody></table>}
            {card.type === "adverb" && <table className="batch-table adverb-batch-table"><thead><tr><th>English</th><th>Italian adverb</th><th /></tr></thead><tbody><tr><AdverbRowCells row={adverbRow} index={0} autoFocus onChange={(field, value) => setAdverbRow((row) => ({ ...row, [field]: value }))} /><td /></tr></tbody></table>}
          </div>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <footer className="modal-actions">
            <button type="button" className="text-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button">Save changes</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

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
      <header className="modal-header"><div><h2 id="bulk-edit-title">Edit cards</h2><p className="modal-subtitle">{cards.length} cards match the selected tags. Sets, decks, and tags are preserved.</p></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></header>
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
