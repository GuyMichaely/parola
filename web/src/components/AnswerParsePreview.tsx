import type { CardType, Flashcard } from "../cards/types";
import { typeLabels } from "../cardTypes";
import {
  cardSupportsStandardAdjectivePattern,
  cardSupportsStandardNounPattern,
  expandElidedArticleTokens,
  hasImplicitNounShape,
  inferArticle,
  keywordMatches,
  parseGender,
  parsePowerAnswerPrefix,
  parseRegularNounAnswer,
  whitespaceParts,
  type AnswerSyntaxMode,
} from "../study/logic";
import type { AnswerKeywords } from "./StudyOptions";

type ParsePiece = {
  label: string;
  value: string;
};

type ParsePreview = {
  type: CardType | null;
  source: string;
  pieces: ParsePiece[];
  message: string;
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

function buildPreview(card: Flashcard, rawValue: string, syntaxMode: AnswerSyntaxMode, compactType: CardType | null, keywords: AnswerKeywords): ParsePreview {
  const trimmed = rawValue.normalize("NFC").trim();
  if (!trimmed) return { type: null, source: "", pieces: [], message: "Start typing to see how Parola interprets each part of the answer." };

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
      return {
        type: null,
        source: "",
        pieces: [{ label: "Gender marker", value: gender }],
        message: `Gender marker recognized. Add ${keywords.singularOnly} or ${keywords.pluralOnly} plus the noun form so the noun syntax is complete.`,
      };
    }
    return {
      type: null,
      source: "",
      pieces: [{ label: "Unrecognized start", value: parts[0] ?? trimmed }],
      message: `Parola does not yet see a complete answer type. Use ${keywords.noun}, ${keywords.verb}, ${keywords.adjective}, or ${keywords.adverb}, or start a noun with its noun syntax.`,
    };
  }

  if (!answer) {
    return { type, source, pieces: [], message: `${typeLabels[type]} selected. Enter the fields after the marker.` };
  }

  let pieces: ParsePiece[] = [];
  let message = `Parsed as ${typeLabels[type]} from ${source}.`;

  if (type === "noun") {
    const rawParts = whitespaceParts(answer);
    const regular = card.type === "noun" && cardSupportsStandardNounPattern(card) && rawParts.length <= 3
      ? parseRegularNounAnswer(answer, keywords)
      : null;
    if (regular) {
      const explicitGender = parseGender(rawParts[0] ?? "", keywords);
      pieces = [
        ...(explicitGender ? [{ label: "Gender marker", value: regular.gender }] : [{ label: "Gender from article", value: regular.gender }]),
        { label: regular.articleKind === "indefinite" ? "Indefinite article" : "Definite article", value: regular.article },
        { label: "Singular", value: regular.singular },
      ];
      message = "Regular noun shorthand recognized; Parola will infer the other regular noun forms before comparing them with the stored card.";
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
      const values = expandElidedArticleTokens(rawParts.slice(index));
      pieces.push(...labeledPieces(values, nounFieldLabels(card, numberMode)));
    }
  } else if (type === "verb") {
    pieces = labeledPieces(whitespaceParts(answer), ["Infinitive", "io", "tu", "lui / lei", "noi", "voi", "loro", "Auxiliary", "Participle"]);
  } else if (type === "adjective") {
    const values = whitespaceParts(answer);
    if (values.length === 1 && card.type === "adjective" && cardSupportsStandardAdjectivePattern(card)) {
      pieces = [{ label: "Regular adjective base", value: displayValue(values[0] ?? "") }];
      message = "Regular adjective shorthand recognized; Parola will infer the other regular forms before comparing them with the stored card.";
    } else {
      pieces = labeledPieces(values, ["Masculine singular", "Feminine singular", "Masculine plural", "Feminine plural"]);
    }
  } else {
    pieces = labeledPieces(whitespaceParts(answer), ["Invariant form"]);
  }

  if (type !== card.type) {
    message = `${message} This card expects ${typeLabels[card.type]}, so the type does not match the prompt.`;
  }
  return { type, source, pieces, message };
}

export function AnswerParsePreview({ card, value, syntaxMode, compactType, keywords }: { card: Flashcard; value: string; syntaxMode: AnswerSyntaxMode; compactType: CardType | null; keywords: AnswerKeywords }) {
  const preview = buildPreview(card, value, syntaxMode, compactType, keywords);
  return (
    <div className={`answer-parse-preview ${preview.type ? `parsed-${preview.type}` : "unparsed"}`}>
      <div className="answer-parse-heading">
        <span>Parola reads this as</span>
        <strong>{preview.type ? typeLabels[preview.type] : "Incomplete"}</strong>
      </div>
      <p className="answer-parse-message">{preview.message}</p>
      {preview.pieces.length > 0 && <div className="answer-parse-pieces">
        {preview.pieces.map((piece, index) => <div className="answer-parse-piece" key={`${piece.label}:${index}`}>
          <span>{piece.label}</span>
          <code>{piece.value}</code>
        </div>)}
      </div>}
    </div>
  );
}
