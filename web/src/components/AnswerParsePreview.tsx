import type { Flashcard } from "../cards/types";
import type { NounMorphology } from "../cards/nounMorphology";
import {
  standardAdjectivePattern,
  whitespaceParts,
} from "../study/logic";
import { analyzeNounInput, choosePreviewAttempt } from "../study/nounSyntax";
import type { AnswerKeywords } from "./StudyOptions";

type ParsePiece = {
  label: string;
  value: string;
};

export type AnswerSyntaxStatus = "empty" | "partial" | "complete" | "invalid";

export type AnswerSyntaxAnalysis = {
  pieces: ParsePiece[];
  message: string;
  status: AnswerSyntaxStatus;
  checkable: boolean;
  missing: string[];
  candidateNames: string[];
  syntaxName: string | null;
};

function displayValue(value: string) {
  return value || "—";
}

function labeledPieces(values: string[], labels: string[]) {
  return values.map((value, index) => ({
    label: labels[index] ?? `Extra token ${index - labels.length + 1}`,
    value: displayValue(value),
  }));
}

export function analyzeAnswerSyntax(card: Flashcard, rawValue: string, keywords: AnswerKeywords, morphology: NounMorphology): AnswerSyntaxAnalysis {
  const trimmed = rawValue.normalize("NFC").trim();
  if (!trimmed) {
    return {
      pieces: [],
      message: "Start typing an answer to see how Parola parses it.",
      status: "empty",
      checkable: false,
      missing: [],
      candidateNames: [],
      syntaxName: null,
    };
  }

  const unclosedQuote = (trimmed.match(/"/g)?.length ?? 0) % 2 === 1;

  if (card.type === "noun") {
    const attempts = analyzeNounInput(trimmed, morphology, keywords);
    const selected = choosePreviewAttempt(attempts);
    const hasCompleteSyntax = attempts.some((attempt) => attempt.status === "complete");
    const candidateNames = selected
      ? Array.from(new Set(selected.candidates.map((candidate) => candidate.declensionRule)))
      : [];

    if (!selected) {
      return {
        pieces: [],
        message: "No noun syntax recognizes this input.",
        status: "invalid",
        checkable: false,
        missing: [],
        candidateNames,
        syntaxName: null,
      };
    }

    let status: AnswerSyntaxStatus = selected.status === "partial" ? "partial" : "complete";
    let message = selected.status === "complete" ? "Noun syntax is complete." : selected.reason;
    let missing = selected.missing;
    if (unclosedQuote) {
      status = "partial";
      missing = [...missing, "Closing quote"];
      message = "The quoted field is still open.";
    }
    return {
      pieces: selected.pieces,
      message,
      status,
      checkable: hasCompleteSyntax && !unclosedQuote,
      missing,
      candidateNames,
      syntaxName: selected.syntax.name,
    };
  }

  if (card.type === "verb") {
    const labels = ["Infinitive", "io", "tu", "lui / lei", "noi", "voi", "loro", "Auxiliary", "Participle"];
    const values = whitespaceParts(trimmed);
    const status: AnswerSyntaxStatus = values.length > labels.length ? "invalid" : values.length === labels.length ? "complete" : "partial";
    const finalStatus = unclosedQuote && status !== "invalid" ? "partial" : status;
    return {
      pieces: labeledPieces(values, labels),
      message: status === "invalid" ? `Too many verb fields were supplied; expected ${labels.length}.` : status === "complete" ? "Verb syntax is complete." : "Verb syntax is valid so far but incomplete.",
      status: finalStatus,
      checkable: finalStatus === "complete",
      missing: unclosedQuote ? [...labels.slice(values.length), "Closing quote"] : labels.slice(values.length),
      candidateNames: [],
      syntaxName: "Full verb",
    };
  }

  if (card.type === "adjective") {
    const labels = ["Masculine singular", "Feminine singular", "Masculine plural", "Feminine plural"];
    const values = whitespaceParts(trimmed);
    const shorthand = values.length === 1 ? standardAdjectivePattern(values[0] ?? "") : null;
    if (shorthand) {
      const status: AnswerSyntaxStatus = unclosedQuote ? "partial" : "complete";
      return {
        pieces: [{ label: "Regular adjective base", value: values[0] ?? "" }],
        message: "Regular adjective shorthand is syntactically complete.",
        status,
        checkable: status === "complete",
        missing: unclosedQuote ? ["Closing quote"] : [],
        candidateNames: ["Regular adjective"],
        syntaxName: "Regular adjective shorthand",
      };
    }
    const status: AnswerSyntaxStatus = values.length > labels.length ? "invalid" : values.length === labels.length ? "complete" : "partial";
    const finalStatus = unclosedQuote && status !== "invalid" ? "partial" : status;
    return {
      pieces: labeledPieces(values, labels),
      message: status === "invalid" ? `Too many adjective fields were supplied; expected ${labels.length}.` : status === "complete" ? "Adjective syntax is complete." : "Adjective syntax is valid so far but incomplete.",
      status: finalStatus,
      checkable: finalStatus === "complete",
      missing: unclosedQuote ? [...labels.slice(values.length), "Closing quote"] : labels.slice(values.length),
      candidateNames: [],
      syntaxName: "Full adjective",
    };
  }

  const values = whitespaceParts(trimmed);
  const status: AnswerSyntaxStatus = values.length > 1 ? "invalid" : values.length === 1 ? "complete" : "partial";
  const finalStatus = unclosedQuote && status !== "invalid" ? "partial" : status;
  return {
    pieces: labeledPieces(values, ["Invariant form"]),
    message: status === "invalid" ? "An adverb answer accepts one invariant form. Quote a stored multi-word form." : status === "complete" ? "Adverb syntax is complete." : "Adverb syntax is incomplete.",
    status: finalStatus,
    checkable: finalStatus === "complete",
    missing: unclosedQuote ? ["Closing quote"] : [],
    candidateNames: [],
    syntaxName: "Invariant adverb",
  };
}

export function AnswerParsePreview({ card, value, keywords, morphology }: { card: Flashcard; value: string; keywords: AnswerKeywords; morphology: NounMorphology }) {
  const preview = analyzeAnswerSyntax(card, value, keywords, morphology);
  const heading = preview.status === "invalid"
    ? "Invalid"
    : preview.status === "complete" ? "Complete" : "In progress";
  return (
    <div className={`answer-parse-preview parsed-${card.type} syntax-${preview.status}`}>
      <div className="answer-parse-heading">
        <span>Parola reads this as</span>
        <strong>{heading}</strong>
      </div>
      {preview.syntaxName && <p className="answer-parse-message"><strong>Syntax:</strong> {preview.syntaxName}</p>}
      <p className="answer-parse-message">{preview.message}</p>
      {preview.pieces.length > 0 && <div className="answer-parse-pieces">
        {preview.pieces.map((piece, index) => <div className="answer-parse-piece" key={`${piece.label}:${index}`}>
          <span>{piece.label}</span>
          <code>{piece.value}</code>
        </div>)}
      </div>}
      {preview.candidateNames.length > 0 && <p className="answer-parse-message"><strong>Possible declensions:</strong> {preview.candidateNames.join(" · ")}</p>}
      {preview.missing.length > 0 && <p className="answer-parse-message"><strong>Still needed:</strong> {preview.missing.join(" · ")}</p>}
    </div>
  );
}
