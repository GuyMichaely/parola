import type { CardType, Flashcard } from "../cards/types";
import { getActiveNounPatterns } from "../cards/nounPatternRuntime";
import { deriveNounPatternForms } from "../cards/nounPatterns";
import { typeLabels } from "../cardTypes";
import {
  cardSupportsStandardAdjectivePattern,
  expandElidedArticleTokens,
  normalizeAnswer,
  parseNounMarkers,
  parseNounShorthandAnswer,
  whitespaceParts,
  type NounNumberMode,
} from "../study/logic";
import type { AnswerKeywords } from "./StudyOptions";

type ParsePiece = {
  label: string;
  value: string;
};

export type AnswerSyntaxStatus = "empty" | "partial" | "complete" | "invalid";

export type AnswerSyntaxAnalysis = {
  type: CardType;
  pieces: ParsePiece[];
  message: string;
  status: AnswerSyntaxStatus;
  missing: string[];
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

function articleGender(value: string) {
  const article = normalizeAnswer(value);
  if (["il", "lo", "i", "gli", "un", "uno"].includes(article)) return "masculine" as const;
  if (["la", "le", "una", "un'"].includes(article)) return "feminine" as const;
  return null;
}

function nounFullLabels(numberMode: NounNumberMode | null, values: string[]) {
  if (numberMode === "singular") {
    const first = normalizeAnswer(values[0] ?? "");
    const hasArticleShape = !first || ["il", "lo", "la", "l'"].includes(first);
    return hasArticleShape
      ? ["Definite singular article", "Singular", "Indefinite article"]
      : ["Singular"];
  }
  if (numberMode === "plural") {
    const first = normalizeAnswer(values[0] ?? "");
    const hasArticleShape = !first || ["i", "gli", "le"].includes(first);
    return hasArticleShape
      ? ["Definite plural article", "Plural"]
      : ["Plural"];
  }
  return ["Definite singular article", "Singular", "Definite plural article", "Plural", "Indefinite article"];
}

function invalidNounArticle(values: string[], labels: string[]) {
  const allowed: Record<string, string[]> = {
    "Definite singular article": ["", "il", "lo", "la", "l'"],
    "Definite plural article": ["", "i", "gli", "le"],
    "Indefinite article": ["", "un", "uno", "una", "un'"],
  };
  for (let index = 0; index < Math.min(values.length, labels.length); index += 1) {
    const possibilities = allowed[labels[index] ?? ""];
    if (possibilities && !possibilities.includes(normalizeAnswer(values[index] ?? ""))) {
      return labels[index] ?? "article";
    }
  }
  return null;
}

function analyzed(
  type: CardType,
  pieces: ParsePiece[],
  message: string,
  status: AnswerSyntaxStatus,
  missing: string[] = [],
): AnswerSyntaxAnalysis {
  return { type, pieces, message, status, missing };
}

export function analyzeAnswerSyntax(card: Flashcard, rawValue: string, keywords: AnswerKeywords): AnswerSyntaxAnalysis {
  const trimmed = rawValue.normalize("NFC").trim();
  const typePiece: ParsePiece = { label: "Part of speech", value: typeLabels[card.type] };
  if (!trimmed) {
    return analyzed(card.type, [typePiece], `This prompt expects a ${typeLabels[card.type].toLowerCase()} answer.`, "empty");
  }

  const unclosedQuote = (trimmed.match(/"/g)?.length ?? 0) % 2 === 1;
  let pieces: ParsePiece[] = [typePiece];
  let message = `Parsing as ${typeLabels[card.type].toLowerCase()} because that is the prompted card type.`;
  let status: AnswerSyntaxStatus = "partial";
  let missing: string[] = [];

  if (card.type === "noun") {
    const rawParts = whitespaceParts(trimmed);
    const markerParse = parseNounMarkers(rawParts, keywords);
    pieces.push(...markerParse.markers.map((marker) => ({
      label: marker.kind === "gender" ? "Gender marker" : "Tantum marker",
      value: marker.kind === "gender" ? marker.value : marker.value === "singular" ? "singular only" : "plural only",
    })));

    if (markerParse.invalid) {
      return analyzed(card.type, pieces, "A gender or tantum marker was repeated or appeared in an invalid marker position.", "invalid");
    }

    const shorthand = !markerParse.numberMode && rawParts.length <= 3 ? parseNounShorthandAnswer(trimmed, keywords) : null;
    if (shorthand) {
      const matchingPatterns = getActiveNounPatterns().filter((pattern) =>
        pattern.syntax === "article-singular"
        && pattern.gender === shorthand.gender
        && Boolean(deriveNounPatternForms(pattern, shorthand.singular)),
      );
      pieces.push(
        { label: shorthand.articleKind === "indefinite" ? "Indefinite article" : "Definite article", value: shorthand.article },
        { label: "Singular", value: shorthand.singular },
      );
      if (matchingPatterns.length) {
        status = "complete";
        message = `Valid Article + singular noun syntax under ${matchingPatterns.map((pattern) => pattern.name).join(" / ")}. It will be checked against the prompted noun when submitted.`;
      } else {
        status = "partial";
        missing = ["Definite plural article", "Plural", "Indefinite article"];
        message = "The shorthand is recognizable, but no matching noun pattern currently allows Article + singular syntax. Continue with the full declension.";
      }
    } else {
      const values = expandElidedArticleTokens(markerParse.rest);
      const labels = nounFullLabels(markerParse.numberMode, values);
      pieces.push(...labeledPieces(values, labels));

      const badArticle = invalidNounArticle(values, labels);
      if (badArticle) {
        return analyzed(card.type, pieces, `${badArticle} contains a token that is not valid in that syntactic position.`, "invalid");
      }

      if (markerParse.gender && values[0]) {
        const firstArticleGender = articleGender(values[0]);
        if (firstArticleGender && firstArticleGender !== markerParse.gender) {
          return analyzed(card.type, pieces, `The ${values[0]} article conflicts with the ${markerParse.gender} gender marker.`, "invalid");
        }
      }

      if (values.length > labels.length) {
        status = "invalid";
        message = `Too many noun fields were supplied; this syntax accepts ${labels.length} after the optional gender/tantum markers.`;
      } else if (values.length === labels.length) {
        status = "complete";
        message = "Noun syntax is complete and will be checked against the prompted noun.";
      } else {
        status = "partial";
        missing = labels.slice(values.length);
        message = "Noun syntax is valid so far but incomplete.";
      }
    }
  } else if (card.type === "verb") {
    const labels = ["Infinitive", "io", "tu", "lui / lei", "noi", "voi", "loro", "Auxiliary", "Participle"];
    const values = whitespaceParts(trimmed);
    pieces.push(...labeledPieces(values, labels));
    if (values.length > labels.length) {
      status = "invalid";
      message = `Too many verb fields were supplied; expected ${labels.length}.`;
    } else if (values.length === labels.length) {
      status = "complete";
      message = "Verb syntax is complete and will be checked against the prompted verb.";
    } else {
      status = "partial";
      missing = labels.slice(values.length);
      message = "Verb syntax is valid so far but incomplete.";
    }
  } else if (card.type === "adjective") {
    const labels = ["Masculine singular", "Feminine singular", "Masculine plural", "Feminine plural"];
    const values = whitespaceParts(trimmed);
    if (values.length === 1 && cardSupportsStandardAdjectivePattern(card)) {
      pieces.push({ label: "Regular adjective base", value: displayValue(values[0] ?? "") });
      status = "complete";
      message = "Regular adjective shorthand is syntactically complete; Parola will check the inferred forms against this adjective.";
    } else {
      pieces.push(...labeledPieces(values, labels));
      if (values.length > labels.length) {
        status = "invalid";
        message = `Too many adjective fields were supplied; expected ${labels.length}.`;
      } else if (values.length === labels.length) {
        status = "complete";
        message = "Adjective syntax is complete and will be checked against the prompted adjective.";
      } else {
        status = "partial";
        missing = labels.slice(values.length);
        message = "Adjective syntax is valid so far but incomplete.";
      }
    }
  } else {
    const values = whitespaceParts(trimmed);
    pieces.push(...labeledPieces(values, ["Invariant form"]));
    if (values.length > 1) {
      status = "invalid";
      message = "An adverb answer accepts one invariant form. Quote it if the stored form itself contains spaces.";
    } else {
      status = values.length === 1 ? "complete" : "partial";
      missing = values.length ? [] : ["Invariant form"];
      message = status === "complete" ? "Adverb syntax is complete and will be checked against the prompted adverb." : message;
    }
  }

  if (unclosedQuote && status !== "invalid") {
    status = "partial";
    missing = [...missing, "Closing quote"];
    message = "The quoted field is still open.";
  }

  return analyzed(card.type, pieces, message, status, missing);
}

export function AnswerParsePreview({ card, value, keywords }: { card: Flashcard; value: string; keywords: AnswerKeywords }) {
  const preview = analyzeAnswerSyntax(card, value, keywords);
  const heading = preview.status === "invalid"
    ? `${typeLabels[preview.type]} · invalid`
    : `${typeLabels[preview.type]} · ${preview.status === "complete" ? "complete" : "in progress"}`;
  return (
    <div className={`answer-parse-preview parsed-${preview.type} syntax-${preview.status}`}>
      <div className="answer-parse-heading">
        <span>Parola reads this as</span>
        <strong>{heading}</strong>
      </div>
      <p className="answer-parse-message">{preview.message}</p>
      {preview.pieces.length > 0 && <div className="answer-parse-pieces">
        {preview.pieces.map((piece, index) => <div className="answer-parse-piece" key={`${piece.label}:${index}`}>
          <span>{piece.label}</span>
          <code>{piece.value}</code>
        </div>)}
      </div>}
      {preview.missing.length > 0 && <p className="answer-parse-message"><strong>Still needed:</strong> {preview.missing.join(" · ")}</p>}
    </div>
  );
}
