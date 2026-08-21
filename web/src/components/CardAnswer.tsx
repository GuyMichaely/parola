import { type FormEvent, useState } from "react";
import type { Flashcard } from "../cards/types";
import { resolvedNounForms, ruleForNounCard, type NounMorphology } from "../cards/nounMorphology";
import { typeLabels } from "../cardTypes";
import type { AnswerKeywords } from "./StudyOptions";
import { AnswerParsePreview, analyzeAnswerSyntax } from "./AnswerParsePreview";
import { verifyPowerAnswer } from "../study/logic";
import { evaluateNounAnswer } from "../study/nounSyntax";

export function NounAnswer({ card, morphology }: { card: Flashcard; morphology: NounMorphology }) {
  const forms = resolvedNounForms(card, morphology);
  const rule = ruleForNounCard(card, morphology);
  const hasArticles = Boolean(forms.definiteSingularArticle || forms.definitePluralArticle || forms.indefiniteArticle);
  return (
    <div className="answer-content">
      <span className="answer-label">Italian · {forms.gender}{rule ? ` · ${rule.name}` : ""}</span>
      <h2>{forms.singular || forms.plural || card.italian}</h2>
      {hasArticles && <table className="noun-forms-table">
        <thead><tr><th>Form</th><th>Article</th><th>Word</th></tr></thead>
        <tbody>
          {forms.singular && forms.definiteSingularArticle && <tr><td>Definite singular</td><td>{forms.definiteSingularArticle}</td><td>{forms.singular}</td></tr>}
          {forms.plural && forms.definitePluralArticle && <tr><td>Definite plural</td><td>{forms.definitePluralArticle}</td><td>{forms.plural}</td></tr>}
          {forms.singular && forms.indefiniteArticle && <tr><td>Indefinite</td><td>{forms.indefiniteArticle}</td><td>{forms.singular}</td></tr>}
        </tbody>
      </table>}
      {!hasArticles && <p className="noun-article-note">No articles</p>}
    </div>
  );
}

export function NounAnswerDiagnostic({ card, answer, keywords, morphology }: { card: Flashcard; answer: string; keywords: AnswerKeywords; morphology: NounMorphology }) {
  if (card.type !== "noun") return null;
  const evaluation = evaluateNounAnswer(card, answer, morphology, keywords);
  if (evaluation.result === "correct") return null;

  if (!evaluation.candidates.length) {
    return <div className="submitted-answer noun-answer-diagnostic">
      <span>How Parola interpreted it</span>
      <strong>No allowed declension rule recognized the completed noun syntax.</strong>
    </div>;
  }

  const uniqueCandidates = Array.from(new Map(evaluation.candidates.map((candidate) => {
    const key = `${candidate.syntaxName}\u0000${candidate.declensionRule}\u0000${candidate.definition.base}\u0000${candidate.definition.gender}`;
    return [key, candidate] as const;
  })).values());

  return <div className="submitted-answer noun-answer-diagnostic">
    <span>How Parola interpreted it</span>
    <div>
      {uniqueCandidates.map((candidate) => <p key={`${candidate.syntaxName}:${candidate.declensionRule}:${candidate.definition.base}:${candidate.definition.gender}`}>
        <strong>{candidate.declensionRule}</strong>
        {` · base ${candidate.definition.base || "∅"} · ${candidate.definition.gender} · ${candidate.syntaxName}`}
      </p>)}
    </div>
  </div>;
}

export function VerbAnswer({ card }: { card: Flashcard }) {
  const d = card.details;
  return (
    <div className="answer-content compact-answer">
      <span className="answer-label">Italian · present tense</span>
      <h2>{card.italian}</h2>
      <div className="conjugation-grid">
        {[["io", d.io], ["tu", d.tu], ["lui / lei", d.luiLei], ["noi", d.noi], ["voi", d.voi], ["loro", d.loro]].map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>
      <p className="verb-extra">auxiliary <strong>{d.auxiliary}</strong> · participle <strong>{d.participle}</strong></p>
    </div>
  );
}

export function AdjectiveAnswer({ card }: { card: Flashcard }) {
  const d = card.details;
  return (
    <div className="answer-content">
      <span className="answer-label">Italian · adjective</span>
      <h2>{card.italian}</h2>
      <div className="noun-answer-grid">
        <div><span>Masculine singular</span><strong>{d.masculineSingular}</strong></div>
        <div><span>Feminine singular</span><strong>{d.feminineSingular}</strong></div>
        <div><span>Masculine plural</span><strong>{d.masculinePlural}</strong></div>
        <div><span>Feminine plural</span><strong>{d.femininePlural}</strong></div>
      </div>
    </div>
  );
}

export function AdverbAnswer({ card }: { card: Flashcard }) {
  return <div className="answer-content"><span className="answer-label">Italian · adverb</span><h2>{card.italian}</h2><p className="noun-article-note">Invariant</p></div>;
}

export function CardAnswer({ card, morphology }: { card: Flashcard; morphology: NounMorphology }) {
  if (card.type === "noun") return <NounAnswer card={card} morphology={morphology} />;
  if (card.type === "verb") return <VerbAnswer card={card} />;
  if (card.type === "adverb") return <AdverbAnswer card={card} />;
  return <AdjectiveAnswer card={card} />;
}

export function ItalianPrompt({ card, morphology }: { card: Flashcard; morphology: NounMorphology }) {
  const nounForm = card.type === "noun" ? resolvedNounForms(card, morphology).singular : "";
  return (
    <div className="question-content">
      <span className="answer-label">Italian</span>
      <h2>{card.type === "noun" ? nounForm || card.italian : card.italian}</h2>
    </div>
  );
}

export function EnglishAnswer({ card, showType = false }: { card: Flashcard; showType?: boolean }) {
  return (
    <div className="answer-content english-answer">
      <span className="answer-label">English{showType ? ` · ${typeLabels[card.type]}` : ""}</span>
      <h2>{card.english}</h2>
    </div>
  );
}

export function ItalianVerificationForm({ card, keywords, morphology, onResult }: { card: Flashcard; keywords: AnswerKeywords; morphology: NounMorphology; onResult: (correct: boolean, answer: string) => void }) {
  const [answer, setAnswer] = useState("");
  const [syntaxRejected, setSyntaxRejected] = useState(false);
  const syntax = analyzeAnswerSyntax(card, answer, keywords, morphology);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!syntax.checkable) {
      setSyntaxRejected(true);
      return;
    }
    setSyntaxRejected(false);
    onResult(verifyPowerAnswer(card, answer, keywords, morphology), answer);
  }

  const placeholder = card.type === "noun"
    ? `il libro  ·  m lo specchio  ·  ${keywords.feminine} ${keywords.singularOnly} Venezia`
    : card.type === "verb" ? "parlare parlo parli parla parliamo parlate parlano avere parlato"
      : card.type === "adjective" ? "bello  or  bello bella belli belle"
        : "molto";

  return (
    <form className={`verification-form power-verification-form${syntaxRejected ? " syntax-rejected" : ""}`} onSubmit={submit}>
      <div className="verification-heading">
        <span className="answer-label">Type the Italian · {typeLabels[card.type]}</span>
      </div>
      <label className="power-answer-field"><span>Answer</span><input name="powerAnswer" value={answer} onChange={(event) => { setAnswer(event.target.value); setSyntaxRejected(false); }} required aria-invalid={syntaxRejected || syntax.status === "invalid"} autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus placeholder={placeholder} /></label>
      <AnswerParsePreview card={card} value={answer} keywords={keywords} morphology={morphology} />
      {syntaxRejected && <p className="syntax-submit-error" role="alert">The answer cannot be checked until its syntax is complete and valid.</p>}
      <details className="answer-syntax-help">
        <summary>Answer format</summary>
        <div>
          <p><strong>Noun:</strong> full form <code>il libro i libri un</code> or <code>l’entrata le entrate un’</code>. Short noun syntaxes use configured inference sets. Gender and tantum markers may appear in either order. Singular-only example: <code>{keywords.feminine} {keywords.singularOnly} Venezia</code>.</p>
          <p><strong>Verb:</strong> <code>infinitive io tu lui/lei noi voi loro auxiliary participle</code>.</p>
          <p><strong>Adjective:</strong> regular shorthand <code>bello</code>, or full <code>bello bella belli belle</code>.</p>
          <p><strong>Adverb:</strong> one invariant form, such as <code>molto</code>.</p>
          <p>Separate fields with spaces. Wrap a multi-word field in double quotes.</p>
        </div>
      </details>
      <button className="primary-button check-answer-button" type="submit" disabled={!answer.trim()}>Check answer</button>
    </form>
  );
}
