import { type FormEvent, useState } from "react";
import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import { typeLabels } from "../cardTypes";
import {
  adjectiveRowFromCard,
  adverbRowFromCard,
  nounCard,
  nounFormsError,
  nounRowFromCard,
  parseTags,
  type AdjectiveBatchRow,
  type AdverbBatchRow,
  type BatchRow,
  type VerbBatchRow,
  updateNounRow,
  verbRowFromCard,
} from "../cards/editorModel";
import {
  AdjectiveRowCells,
  AdverbRowCells,
  NounRowCells,
  SetField,
  TagsField,
  VerbRowCells,
} from "./CardEditorFields";

export function EditCardModal({
  card,
  knownSets,
  morphology,
  onClose,
  onSave,
}: {
  card: Flashcard;
  knownSets: string[];
  morphology: NounMorphology;
  onClose: () => void;
  onSave: (card: Flashcard) => void;
}) {
  const [formError, setFormError] = useState("");
  const [setName, setSetName] = useState(card.setName ?? "");
  const [tags, setTags] = useState(card.tags.join(", "));
  const [nounRow, setNounRow] = useState<BatchRow>(() => card.type === "noun" ? nounRowFromCard(card, morphology) : {
    id: String(card.id), english: card.english, gender: "masculine", singular: "", plural: "", definiteSingularArticle: "", definitePluralArticle: "", indefiniteArticle: "",
  });
  const [verbRow, setVerbRow] = useState<VerbBatchRow>(() => card.type === "verb" ? verbRowFromCard(card) : {
    id: String(card.id), english: card.english, infinitive: "", io: "", tu: "", luiLei: "", noi: "", voi: "", loro: "", auxiliary: "avere", participle: "",
  });
  const [adjectiveRow, setAdjectiveRow] = useState<AdjectiveBatchRow>(() => card.type === "adjective" ? adjectiveRowFromCard(card) : {
    id: String(card.id), english: card.english, masculineSingular: "", feminineSingular: "", masculinePlural: "", femininePlural: "",
  });
  const [adverbRow, setAdverbRow] = useState<AdverbBatchRow>(() => card.type === "adverb" ? adverbRowFromCard(card) : {
    id: String(card.id), english: card.english, form: "",
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const common = {
      id: card.id,
      setName: setName.trim() || null,
      tags: parseTags(tags),
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
      }, morphology);
    } else if (card.type === "verb") {
      if ([verbRow.english, verbRow.infinitive, verbRow.io, verbRow.tu, verbRow.luiLei, verbRow.noi, verbRow.voi, verbRow.loro, verbRow.participle].some((value) => !value.trim())) { setFormError("English, infinitive, all six present-tense forms, and the participle are required."); return; }
      updated = { ...common, type: "verb", english: verbRow.english.trim(), italian: verbRow.infinitive.trim(), details: {
        io: verbRow.io.trim(), tu: verbRow.tu.trim(), luiLei: verbRow.luiLei.trim(), noi: verbRow.noi.trim(),
        voi: verbRow.voi.trim(), loro: verbRow.loro.trim(), auxiliary: verbRow.auxiliary, participle: verbRow.participle.trim(),
      }};
    } else if (card.type === "adjective") {
      if ([adjectiveRow.english, adjectiveRow.masculineSingular, adjectiveRow.feminineSingular, adjectiveRow.masculinePlural, adjectiveRow.femininePlural].some((value) => !value.trim())) { setFormError("English and all four Italian adjective forms are required."); return; }
      updated = { ...common, type: "adjective", english: adjectiveRow.english.trim(), italian: adjectiveRow.masculineSingular.trim(), details: {
        masculineSingular: adjectiveRow.masculineSingular.trim(), feminineSingular: adjectiveRow.feminineSingular.trim(),
        masculinePlural: adjectiveRow.masculinePlural.trim(), femininePlural: adjectiveRow.femininePlural.trim(),
      }};
    } else {
      if (!adverbRow.english.trim() || !adverbRow.form.trim()) { setFormError("English and the Italian adverb are required."); return; }
      updated = { ...common, type: "adverb", english: adverbRow.english.trim(), italian: adverbRow.form.trim(), details: {} };
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
