import type { CardType, Flashcard } from "../cards/types";
import { typeLabels } from "../cardTypes";
import {
  cardSupportsStandardAdjectivePattern,
  expandElidedArticleTokens,
  hasImplicitNounShape,
  inferArticle,
  keywordMatches,
  parseGender,
  parseNounShorthandAnswer,
  parsePowerAnswerPrefix,
  whitespaceParts,
  type AnswerSyntaxMode,
} from "../study/logic";
import type { AnswerKeywords } from "./StudyOptions";

type ParsePiece = {
  label: string;
  value: string;
};

export type AnswerSyntaxStatus = "empty" | "partial" | "complete" | "invalid";

export type AnswerSyntaxAnalysis = {
  type: CardType | null;
  source: string;
  pieces: ParsePiece[];
  message: string;
  status: AnswerSyntaxStatus;
  missing: string[];
};

function typeFromToken(value: string, keywords: AnswerKeywords): CardType | null {
  const token = value.trim().replace(/:$/, "");
  if (keywordMatches(token, keywords.noun)) return "noun";
  if (keywordMatches(token, keywords.verb)) return "verb";
  if (keywordMatches(token, keywords.adjective)) return "adjective";
  if (keywordMatches(token, keywords.adverb)) return "adverb";
  return null;
}

function displayValue(value: string) {
  return value || "—";
}

function labeledPieces(values: string[], labels: string[]) {
  return values.map((value, index) => ({
    label: labels[index] ?? `Extra token ${index - labels.length + 1}`,
    value: displayValue(value),
  }));
}

function nounFieldLabels(card: Flashcard, numberMode: "singular" | "plural" | null) {
  if (card.type !== "noun") {
    if (numberMode === "singular") return ["Definite singular article", "Singular", "Indefinite article"];
    if (numberMode === "plural") return ["Definite plural article", "Plural"];
    return ["Definite singular article", "Singular", "Definite plural article", "Plural", "Indefinite article"];
  }

  const d = card.details;
  const singular = d.singular === undefined ? card.italian : d.singular;
  const plural = d.plural ?? "";
  const definiteSingularArticle = d.definiteSingularArticle || inferArticle(d.definiteSingular, singular, "");
  const definitePluralArticle = d.definitePluralArticle || inferArticle(d.definitePlural, plural, "");
  const indefiniteArticle = d.indefiniteArticle || inferArticle(d.indefinite, singular, "");

  if (numberMode === "singular") {
    return [
      ...(definiteSingularArticle ? ["Definite singular article"] : []),
      ...(singular ? ["Singular"] : []),
      ...(indefiniteArticle ? ["Indefinite article"] : []),
    ];
  }
  if (numberMode === "plural") {
    return [
      ...(definitePluralArticle ? ["Definite plural article"] : []),
      ...(plural ? ["Plural"] : []),
    ];
  }
  if (!singular && plural) {
    return [
      ...(definitePluralArticle ? ["Definite plural article"] : []),
      "Plural",
    ];
  }
  return [
    ...(definiteSingularArticle ? ["Definite singular article"] : []),
    ...(singular ? ["Singular"] : []),
    ...(definitePluralArticle ? ["Definite plural article"] : []),
    ...(plural ? ["Plural"] : []),
    ...(indefiniteArticle ? ["Indefinite article"] : []),
  ];
}

function articleGender(value: string) {
  const article = value.normalize("NFC").toLocaleLowerCase("it-IT").replace(/[’`]/g, "'");
  if (["il", "lo", "i", "gli", "un", "uno"].includes(article)) return "masculine" as const;
  if (["la", "le", "una", "un'"].includes(article)) return "feminine" as const;
  return null;
}

function analyzed(
  type: CardType | null,
  source: string,
  pieces: ParsePiece[],
  message: string,
  status: AnswerSyntaxStatus,
  missing: string[] = [],
): AnswerSyntaxAnalysis {
  return { type, source, pieces, message, status, missing };
}

export function analyzeAnswerSyntax(card: Flashcard, rawValue: string, syntaxMode: AnswerSyntaxMode, compactType: CardType | null, keywords: AnswerKeywords): AnswerSyntaxAnalysis {
  const trimmed = rawValue.normalize("NFC").trim();
  if (!trimmed) return analyzed(null, "", [], "Start typing to see how Parola interprets each part of the answer.", "empty");

  const unclosedQuote = (trimmed.match(/"/g)?.length ?? 0) % 2 === 1;
  const prefixed = parsePowerAnswerPrefix(trimmed, keywords);
  let type = prefixed?.type ?? null;
  let answer = prefixed?.answer ?? trimmed;
  let source = prefixed ? "explicit type marker" : "";

  if (!type) {
    const bareType = typeFromToken(trimmed, keywords);
    if (bareType) {
      type = bareType;
      answer = "";
      source = "explicit type marker";
    } else if (syntaxMode === "compact" && compactType) {
      type = compactType;
      source = "compact study mode";
    } else if (hasImplicitNounShape(trimmed, keywords)) {
      type = "noun";
      source = "noun markers/articles";
    }
  }

  if (!type) {
    const parts = whitespaceParts(trimmed);
    const gender = parseGender(parts[0] ?? "", keywords);
    if (gender) {
      return analyzed(
        "noun",
        "noun gender marker",
        [{ label: "Gender marker", value: gender }],
        "Noun syntax has started but is not complete.",
        "partial",
        ["Article or number marker", "Noun form"],
      );
    }
    const status: AnswerSyntaxStatus = /\s/.test(trimmed) ? "invalid" : "partial";
    return analyzed(
      null,
      "",
      [{ label: status === "invalid" ? "Invalid start" : "Unrecognized start", value: parts[0] ?? trimmed }],
      status === "invalid"
        ? `This cannot be parsed as an answer. Start with ${keywords.noun}, ${keywords.verb}, ${keywords.adjective}, or ${keywords.adverb}, or use noun article/gender syntax.`
        : `Parola does not yet recognize an answer type. Continue typing, or start with ${keywords.noun}, ${keywords.verb}, ${keywords.adjective}, or ${keywords.adverb}.`,
      status,
      status === "partial" ? ["Answer type"] : [],
    );
  }

  if (!answer) {
    return analyzed(type, source, [], `${typeLabels[type]} selected. Enter the fields after the marker.`, "partial", ["Answer fields"]);
  }

  let pieces: ParsePiece[] = [];
  let message = `Parsed as ${typeLabels[type]} from ${source}.`;
  let status: AnswerSyntaxStatus = "partial";
  let missing: string[] = [];

  if (type === "noun") {
    const rawParts = whitespaceParts(answer);
    const shorthand = rawParts.length <= 3 ? parseNounShorthandAnswer(answer, keywords) : null;
    if (shorthand) {
      const explicitGender = parseGender(rawParts[0] ?? "", keywords);
      pieces = [
        ...(explicitGender ? [{ label: "Gender marker", value: shorthand.gender }] : [{ label: "Gender from article", value: shorthand.gender }]),
        { label: shorthand.articleKind === "indefinite" ? "Indefinite article" : "Definite article", value: shorthand.article },
        { label: "Singular", value: shorthand.singular },
      ];
      if (card.type === "noun" && card.details.patternSyntax === "article-singular") {
        status = "complete";
        message = `${card.details.patternName || "This noun pattern"} allows Article + singular shorthand; the omitted forms come from the assigned pattern.`;
      } else if (card.type === "noun") {
        const labels = nounFieldLabels(card, null);
        missing = labels.slice(2);
        status = "partial";
        message = card.details.patternId && card.details.patternId !== "manual"
          ? `${card.details.patternName || "This noun pattern"} currently requires full forms. Continue with the remaining fields.`
          : "This noun uses manual forms. The shorthand is recognizable, but continue with the remaining stored fields.";
      } else {
        status = "complete";
      }
    } else {
      let index = 0;
      const explicitGender = parseGender(rawParts[index] ?? "", keywords);
      if (explicitGender) {
        pieces.push({ label: "Gender marker", value: explicitGender });
        index += 1;
      }
      let numberMode: "singular" | "plural" | null = null;
      if (keywordMatches(rawParts[index] ?? "", keywords.singularOnly)) {
        numberMode = "singular";
        pieces.push({ label: "Number marker", value: "singular only" });
        index += 1;
      } else if (keywordMatches(rawParts[index] ?? "", keywords.pluralOnly)) {
        numberMode = "plural";
        pieces.push({ label: "Number marker", value: "plural only" });
        index += 1;
      }

      if (card.type === "noun" && numberMode === "singular" && Boolean(card.details.plural)) {
        return analyzed(type, source, pieces, "This card has both singular and plural forms, so singular-only syntax is not valid for it.", "invalid");
      }
      if (card.type === "noun" && numberMode === "plural" && Boolean(card.details.singular ?? card.italian)) {
        return analyzed(type, source, pieces, "This card has a singular form, so plural-only syntax is not valid for it.", "invalid");
      }

      const values = expandElidedArticleTokens(rawParts.slice(index));
      const labels = nounFieldLabels(card, numberMode);
      pieces.push(...labeledPieces(values, labels));

      if (explicitGender && values[0]) {
        const firstArticleGender = articleGender(values[0]);
        if (firstArticleGender && firstArticleGender !== explicitGender) {
          return analyzed(type, source, pieces, `The ${values[0]} article conflicts with the ${explicitGender} gender marker.`, "invalid");
        }
      }

      if (values.length > labels.length) {
        status = "invalid";
        message = `Too many noun fields were supplied; this syntax accepts ${labels.length} after the optional markers.`;
      } else if (values.length === labels.length) {
        status = "complete";
      } else {
        status = "partial";
        missing = labels.slice(values.length);
        message = "Noun syntax is valid so far but incomplete.";
      }
    }
  } else if (type === "verb") {
    const labels = ["Infinitive", "io", "tu", "lui / lei", "noi", "voi", "loro", "Auxiliary", "Participle"];
    const values = whitespaceParts(answer);
    pieces = labeledPieces(values, labels);
    if (values.length > labels.length) {
      status = "invalid";
      message = `Too many verb fields were supplied; expected ${labels.length}.`;
    } else if (values.length === labels.length) {
      status = "complete";
    } else {
      status = "partial";
      missing = labels.slice(values.length);
      message = "Verb syntax is valid so far but incomplete.";
    }
  } else if (type === "adjective") {
    const labels = ["Masculine singular", "Feminine singular", "Masculine plural", "Feminine plural"];
    const values = whitespaceParts(answer);
    if (values.length === 1 && card.type === "adjective" && cardSupportsStandardAdjectivePattern(card)) {
      pieces = [{ label: "Regular adjective base", value: displayValue(values[0] ?? "") }];
      status = "complete";
      message = "Regular adjective shorthand is complete; Parola can infer the other regular forms before checking the answer.";
    } else {
      pieces = labeledPieces(values, labels);
      if (values.length > labels.length) {
        status = "invalid";
        message = `Too many adjective fields were supplied; expected ${labels.length}.`;
      } else if (values.length === labels.length) {
        status = "complete";
      } else {
        status = "partial";
        missing = labels.slice(values.length);
        message = "Adjective syntax is valid so far but incomplete.";
      }
    }
  } else {
    const values = whitespaceParts(answer);
    pieces = labeledPieces(values, ["Invariant form"]);
    if (values.length > 1) {
      status = "invalid";
      message = "An adverb answer accepts one invariant form. Quote it if the stored form itself contains spaces.";
    } else {
      status = values.length === 1 ? "complete" : "partial";
      missing = values.length ? [] : ["Invariant form"];
    }
  }

  if (unclosedQuote && status !== "invalid") {
    status = "partial";
    missing = [...missing, "Closing quote"];
    message = "The quoted field is still open.";
  }

  if (status === "complete" && type !== card.type) {
    message = `${message} This card expects ${typeLabels[card.type]}, so the completed answer will not match this prompt.`;
  }

  return analyzed(type, source, pieces, message, status, missing);
}

export function AnswerParsePreview({ card, value, syntaxMode, compactType, keywords }: { card: Flashcard; value: string; syntaxMode: AnswerSyntaxMode; compactType: CardType | null; keywords: AnswerKeywords }) {
  const preview = analyzeAnswerSyntax(card, value, syntaxMode, compactType, keywords);
  const heading = preview.status === "invalid"
    ? "Invalid"
    : preview.type
      ? `${typeLabels[preview.type]} · ${preview.status === "complete" ? "complete" : "in progress"}`
      : "Incomplete";
  return (
    <div className={`answer-parse-preview ${preview.type ? `parsed-${preview.type}` : "unparsed"} syntax-${preview.status}`}>
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
