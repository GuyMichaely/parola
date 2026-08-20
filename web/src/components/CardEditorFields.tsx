import type { CardType } from "../cards/types";
import {
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchRow,
  type VerbBatchRow,
} from "../cards/editorModel";

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

export function NounRowCells({
  row,
  index,
  onChange,
  onRemove,
  autoFocus = false,
}: {
  row: BatchRow;
  index: number;
  onChange: <K extends keyof BatchRow>(field: K, value: BatchRow[K]) => void;
  onRemove?: () => void;
  autoFocus?: boolean;
}) {
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
