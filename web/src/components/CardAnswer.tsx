import { type FormEvent, useState } from "react";
import type { CardType, Flashcard } from "../cards/types";
import { getActiveNounPatterns } from "../cards/nounPatternRuntime";
import { nounPatternForCard, resolvedNounForms } from "../cards/nounPatterns";
import { typeLabels } from "../cardTypes";
import { answerKeyword, type AnswerKeywords } from "./StudyOptions";
import { AnswerParsePreview, analyzeAnswerSyntax } from "./AnswerParsePreview";
import {
  verifyPowerAnswer,
  type AnswerSyntaxMode,
} from "../study/logic";

export function NounAnswer({ card }: { card: Flashcard }) {
  const patterns = getActiveNounPatterns();
  const forms = resolvedNounForms(card, patterns);
  const pattern = nounPatternForCard(card, patterns);
  const hasArticles = Boolean(forms.definiteSingularArticle || forms.definitePluralArticle || forms.indefiniteArticle);
  return (
    <div className="answer-content">
      <span className="answer-label">Italian · {forms.gender}{pattern ? ` · ${pattern.name}` : ""}</span>
      <h2>{forms.singular || forms.plural || card.italian}</h2>
      {hasArticles && <table className="noun-forms-table">
        <thead><tr><th>Form</th><th>Article</th><th>Word</th></tr></thead>
        <tbody>
          {forms.singular && forms.definiteSingularArticle && <tr><td>Definite singular</td><td>{forms.definiteSingularArticle}</td><td>{forms.singular}</td></tr>}
          {forms.plural && forms.definitePluralArticle && <tr><td>Definite plural</td><td>{forms.definitePluralArticle}</td><td>{forms.plural}</td></tr>}
          {forms.singular && forms.indefiniteArticle && <tr><td>Indefinite</td><td>{forms.indefiniteArticle}</td><td>{forms.singular}</td></tr>}
        </tbody>
      </table>}
      {!hasArticles && <p className="noun-article-note">No stored articles</p>}
    </div>
  );
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

export function CardAnswer({ card }: { card: Flashcard }) {
  if (card.type === "noun") return <NounAnswer card={card} />;
  if (card.type === "verb") return <VerbAnswer card={card} />;
  if (card.type === "adverb") return <AdverbAnswer card={card} />;
  return <AdjectiveAnswer card={card} />;
}

export function ItalianPrompt({ card }: { card: Flashcard }) {
  const nounForm = card.type === "noun" ? resolvedNounForms(card, getActiveNounPatterns()).singular : "";
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

export function ItalianVerificationForm({ card, syntaxMode, compactType, keywords, onResult }: { card: Flashcard; syntaxMode: AnswerSyntaxMode; compactType: CardType | null; keywords: AnswerKeywords; onResult: (correct: boolean, answer: string) => void }) {
  const [answer, setAnswer] = useState("");
  const syntax = analyzeAnswerSyntax(card, answer, syntaxMode, compactType, keywords);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (syntax.status !== "complete") return;
    onResult(verifyPowerAnswer(card, answer, syntaxMode, keywords), answer);
  }

  const compactLabel = compactType ? `${typeLabels[compactType]} mode` : "Compact mode";
  const placeholder = syntaxMode === "universal"
    ? `il libro  ·  ${keywords.verb} parlare parlo …  ·  ${keywords.adjective} bello bella …  ·  ${keywords.adverb} molto`
    : compactType === "noun" ? `i vestiti  or  ${keywords.feminine} ${keywords.singularOnly} Venezia`
      : compactType === "verb" ? "parlare parlo parli parla …"
        : compactType === "adjective" ? "bello  or  bello bella belli belle"
          : "molto";

  return (
    <form className="verification-form power-verification-form" onSubmit={submit}>
      <div className="verification-heading">
        <span className="answer-label">Type the Italian</span>
        <p>{syntaxMode === "universal" ? `Start with ${keywords.noun}, ${keywords.verb}, ${keywords.adjective}, or ${keywords.adverb}. A noun answer beginning with an article or gender/number markers may omit ${keywords.noun}.` : `${compactLabel} is on, so the part-of-speech prefix is optional.`}</p>
      </div>
      <label className="power-answer-field"><span>Answer</span><input name="powerAnswer" value={answer} onChange={(event) => setAnswer(event.target.value)} required autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus placeholder={placeholder} /></label>
      <AnswerParsePreview card={card} value={answer} syntaxMode={syntaxMode} compactType={compactType} keywords={keywords} />
      <details className="answer-syntax-help">
        <summary>Answer format</summary>
        <div>
          <p><strong>Noun:</strong> omit <code>{keywords.noun}</code> when an article or gender/number markers identify the noun format. Full: <code>il libro i libri un</code> or <code>l’entrata le entrate un’</code>. A noun pattern may opt into <strong>Article + singular</strong> shorthand; patterns left on <strong>Full forms required</strong> still require the whole declension. Plural-only: <code>i vestiti</code>. Articleless singular-only: <code>{keywords.feminine} {keywords.singularOnly} Venezia</code>. An ambiguous article also needs gender: <code>{keywords.feminine} {keywords.singularOnly} l’Aquila</code>.</p>
          <p><strong>Verb:</strong> <code>{keywords.verb} infinitive io tu lui/lei noi voi loro auxiliary participle</code>.</p>
          <p><strong>Adjective:</strong> regular shorthand <code>{keywords.adjective} bello</code>, or full <code>{keywords.adjective} bello bella belli belle</code>.</p>
          <p><strong>Adverb:</strong> invariant form <code>{keywords.adverb} molto</code>.</p>
          <p>Separate fields with spaces. Wrap a multi-word field in double quotes.</p>
          {syntaxMode === "compact" && compactType && <p>In {compactLabel}, omit the <code>{answerKeyword(compactType, keywords)}</code> prefix.</p>}
        </div>
      </details>
      <button className="primary-button check-answer-button" type="submit" disabled={syntax.status !== "complete"}>Check answer</button>
    </form>
  );
}
