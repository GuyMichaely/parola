import type { CardType, Flashcard } from "../cards/types";
import type { AnswerKeywords, PromptLanguage } from "../components/StudyOptions";

export type AnswerSyntaxMode = "universal" | "compact";

export type StudyItem = {
  key: string;
  card: Flashcard;
  promptLanguage: PromptLanguage;
};

export type VerificationField = {
  key: string;
  label: string;
  expected: string;
};

export function inferArticle(fullForm: string | undefined, noun: string | undefined, fallback: string) {
  if (!fullForm || !noun) return fallback;
  if (fullForm.endsWith(noun)) {
    const article = fullForm.slice(0, -noun.length).trim();
    return article || fallback;
  }
  return fallback;
}

export function normalizeAnswer(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("it-IT")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

type NounGender = "masculine" | "feminine";

export function standardNounPattern(singular: string, gender: NounGender) {
  const word = singular.trim();
  if (!word) return null;
  const lower = word.toLocaleLowerCase("it-IT");
  let plural = "";
  if (lower.endsWith("a")) {
    if (gender === "feminine" && lower.endsWith("ca")) plural = `${word.slice(0, -2)}che`;
    else if (gender === "feminine" && lower.endsWith("ga")) plural = `${word.slice(0, -2)}ghe`;
    else plural = `${word.slice(0, -1)}${gender === "feminine" ? "e" : "i"}`;
  } else if (lower.endsWith("o") || lower.endsWith("e")) {
    plural = `${word.slice(0, -1)}i`;
  } else {
    return null;
  }
  const beginsWithVowel = /^[aeiouàèéìòóù]/i.test(lower);
  const takesLo = /^(z|x|y|gn|pn|ps|s[^aeiouàèéìòóù])/i.test(lower);
  const definiteSingularArticle = gender === "feminine" ? (beginsWithVowel ? "l’" : "la") : beginsWithVowel ? "l’" : takesLo ? "lo" : "il";
  const definitePluralArticle = gender === "feminine" ? "le" : (beginsWithVowel || takesLo ? "gli" : "i");
  const indefiniteArticle = gender === "feminine" ? (beginsWithVowel ? "un’" : "una") : (takesLo ? "uno" : "un");
  return { singular: word, plural, definiteSingularArticle, definitePluralArticle, indefiniteArticle };
}

export function keywordMatches(value: string, configured: string, _aliases: string[] = []) {
  return normalizeAnswer(value) === normalizeAnswer(configured);
}

export function parseRegularNounAnswer(value: string, keywords: AnswerKeywords) {
  let answer = value.normalize("NFC").trim().replace(/[’`]/g, "'").replace(/\s+/g, " ");
  let explicitGender: NounGender | null = null;
  const firstSpace = answer.search(/\s/);
  if (firstSpace > 0) {
    const possibleGender = answer.slice(0, firstSpace);
    if (keywordMatches(possibleGender, keywords.masculine, ["masculine"])) explicitGender = "masculine";
    else if (keywordMatches(possibleGender, keywords.feminine, ["feminine"])) explicitGender = "feminine";
    if (explicitGender) answer = answer.slice(firstSpace).trim();
  }

  let article = "";
  let singular = "";
  const elidedMatch = answer.match(/^(l'|un')(.+)$/i);
  const spacedMatch = answer.match(/^(il|lo|la|un|uno|una)\s+(.+)$/i);
  if (elidedMatch) [article, singular] = [elidedMatch[1].toLowerCase(), elidedMatch[2].trim()];
  else if (spacedMatch) [article, singular] = [spacedMatch[1].toLowerCase(), spacedMatch[2].trim()];
  else return null;

  const articleGender: NounGender | null = ["il", "lo", "un", "uno"].includes(article)
    ? "masculine"
    : ["la", "una", "un'"].includes(article) ? "feminine" : null;
  const gender = explicitGender ?? articleGender;
  if (!gender || (explicitGender && articleGender && explicitGender !== articleGender)) return null;
  return {
    article,
    singular,
    gender,
    articleKind: ["un", "uno", "una", "un'"].includes(article) ? "indefinite" as const : "definite" as const,
  };
}

export function cardSupportsStandardNounPattern(card: Flashcard) {
  if (card.type !== "noun") return false;
  const gender = card.details.gender === "feminine" ? "feminine" : "masculine";
  const singular = card.details.singular ?? card.italian;
  if (!singular || !card.details.plural || !card.details.definiteSingularArticle || !card.details.definitePluralArticle || !card.details.indefiniteArticle) return false;
  const pattern = standardNounPattern(singular, gender);
  if (!pattern) return false;
  return verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected));
}

export function standardAdjectivePattern(masculineSingular: string) {
  const word = masculineSingular.trim();
  const lower = word.toLocaleLowerCase("it-IT");
  if (lower.endsWith("o")) {
    const stem = word.slice(0, -1);
    return { masculineSingular: word, feminineSingular: `${stem}a`, masculinePlural: `${stem}i`, femininePlural: `${stem}e` };
  }
  if (lower.endsWith("e")) {
    const plural = `${word.slice(0, -1)}i`;
    return { masculineSingular: word, feminineSingular: word, masculinePlural: plural, femininePlural: plural };
  }
  return null;
}

export function cardSupportsStandardAdjectivePattern(card: Flashcard) {
  if (card.type !== "adjective") return false;
  const pattern = standardAdjectivePattern(card.details.masculineSingular || card.italian);
  return Boolean(pattern && verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected)));
}

export function parseGender(value: string, keywords: AnswerKeywords): NounGender | null {
  if (keywordMatches(value, keywords.masculine, ["masculine"])) return "masculine";
  if (keywordMatches(value, keywords.feminine, ["feminine"])) return "feminine";
  return null;
}

export function genderIndicatedByArticles(articles: string[]): NounGender | null {
  const genders = new Set(articles.flatMap((article) => {
    const normalized = normalizeAnswer(article);
    if (["il", "lo", "i", "gli", "un", "uno"].includes(normalized)) return ["masculine" as const];
    if (["la", "le", "una", "un'"].includes(normalized)) return ["feminine" as const];
    return [];
  }));
  return genders.size === 1 ? [...genders][0] : null;
}

export function isDefinitePluralArticle(article: string) {
  return ["i", "gli", "le"].includes(normalizeAnswer(article));
}

export function parsePowerAnswerPrefix(value: string, keywords: AnswerKeywords) {
  const match = value.trim().match(/^(\S+)(?:\s*:\s*|\s+)([\s\S]*)$/);
  if (!match) return null;
  const token = match[1];
  const type: CardType | null = keywordMatches(token, keywords.noun, ["noun"])
    ? "noun"
    : keywordMatches(token, keywords.verb, ["verb"])
      ? "verb"
      : keywordMatches(token, keywords.adjective, ["adj", "adjective"])
        ? "adjective"
        : keywordMatches(token, keywords.adverb, ["adverb"])
          ? "adverb"
        : null;
  return type ? { type, answer: match[2].trim() } : null;
}

export function whitespaceParts(value: string) {
  return (value.match(/"[^"]*"|\S+/g) ?? []).map((part) => {
    const unquoted = part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part;
    return unquoted === "-" || unquoted === "—" ? "" : unquoted;
  });
}

export function hasImplicitNounShape(value: string, keywords: AnswerKeywords) {
  const parts = whitespaceParts(value);
  let index = 0;
  const hasGender = Boolean(parseGender(parts[index] ?? "", keywords));
  if (hasGender) index += 1;
  const hasNumber = keywordMatches(parts[index] ?? "", keywords.singularOnly, ["s", "sin"])
    || keywordMatches(parts[index] ?? "", keywords.pluralOnly, ["p", "plu"]);
  if (hasNumber) index += 1;
  const token = normalizeAnswer(parts[index] ?? "");
  return (hasGender && hasNumber)
    || ["il", "lo", "la", "l'", "i", "gli", "le", "un", "uno", "una", "un'"].includes(token)
    || /^(?:l'|un').+/.test(token);
}

export function expandElidedArticleTokens(parts: string[]) {
  return parts.flatMap((part) => {
    const match = part.match(/^(l['’]|un['’])(.+)$/i);
    return match ? [match[1], match[2]] : [part];
  });
}

export function matchesExpected(actual: string[], expected: string[]) {
  return actual.length === expected.length && actual.every((value, index) => normalizeAnswer(value) === normalizeAnswer(expected[index] ?? ""));
}

export function shuffled<T>(items: T[], seed: number) {
  const result = [...items];
  let state = seed >>> 0 || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function withEnglishPromptFirst(items: StudyItem[]) {
  const result = [...items];
  const positions = new Map<number, Partial<Record<PromptLanguage, number>>>();
  result.forEach((item, index) => {
    positions.set(item.card.id, { ...positions.get(item.card.id), [item.promptLanguage]: index });
  });
  positions.forEach(({ english, italian }) => {
    if (english !== undefined && italian !== undefined && english > italian) {
      [result[english], result[italian]] = [result[italian], result[english]];
    }
  });
  return result;
}

export function verifyPowerAnswer(card: Flashcard, rawValue: string, syntaxMode: AnswerSyntaxMode, keywords: AnswerKeywords) {
  const prefixed = parsePowerAnswerPrefix(rawValue, keywords);
  const implicitNoun = !prefixed && hasImplicitNounShape(rawValue, keywords);
  if (syntaxMode === "universal" && !prefixed && !implicitNoun) return false;
  if (prefixed && prefixed.type !== card.type) return false;
  if (implicitNoun && card.type !== "noun") return false;
  const answer = prefixed?.answer ?? rawValue.trim();
  const d = card.details;

  if (card.type === "noun") {
    const singular = d.singular ?? card.italian;

    if (whitespaceParts(answer).length <= 3 && cardSupportsStandardNounPattern(card)) {
      const parsed = parseRegularNounAnswer(answer, keywords);
      if (parsed) {
        const pattern = standardNounPattern(parsed.singular, parsed.gender);
        const expectedGender = d.gender === "feminine" ? "feminine" : "masculine";
        const expectedArticle = parsed.articleKind === "indefinite" ? pattern?.indefiniteArticle : pattern?.definiteSingularArticle;
        return Boolean(pattern && parsed.gender === expectedGender && normalizeAnswer(parsed.article) === normalizeAnswer(expectedArticle ?? "") && verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected)));
      }
    }

    const rawParts = whitespaceParts(answer);
    const expectedGender = d.gender === "feminine" ? "feminine" : "masculine";
    const plural = d.plural ?? "";
    const definiteSingularArticle = d.definiteSingularArticle || inferArticle(d.definiteSingular, singular, "");
    const definitePluralArticle = d.definitePluralArticle || inferArticle(d.definitePlural, plural, "");
    const indefiniteArticle = d.indefiniteArticle || inferArticle(d.indefinite, singular, "");
    const explicitGender = parseGender(rawParts[0] ?? "", keywords);
    if (explicitGender && explicitGender !== expectedGender) return false;
    if (!explicitGender && genderIndicatedByArticles([definiteSingularArticle, definitePluralArticle, indefiniteArticle]) !== expectedGender) return false;

    const expectsElidedArticle = [definiteSingularArticle, definitePluralArticle, indefiniteArticle].some((article) => /^(l|un)['’]$/i.test(article));
    const answerParts = explicitGender ? rawParts.slice(1) : rawParts;
    const parts = expectsElidedArticle ? expandElidedArticleTokens(answerParts) : answerParts;

    if (keywordMatches(parts[0] ?? "", keywords.singularOnly, ["s", "sin"])) {
      if (!singular || plural) return false;
      return matchesExpected(parts.slice(1), [
        ...(definiteSingularArticle ? [definiteSingularArticle] : []),
        singular,
        ...(indefiniteArticle ? [indefiniteArticle] : []),
      ]);
    }
    if (keywordMatches(parts[0] ?? "", keywords.pluralOnly, ["p", "plu"])) {
      if (singular || !plural) return false;
      return matchesExpected(parts.slice(1), [
        ...(definitePluralArticle ? [definitePluralArticle] : []),
        plural,
      ]);
    }
    if (!singular && plural && isDefinitePluralArticle(definitePluralArticle)) {
      return matchesExpected(parts, [definitePluralArticle, plural]);
    }
    if (!singular || !plural) return false;
    return matchesExpected(parts, [
      ...(definiteSingularArticle ? [definiteSingularArticle] : []),
      singular,
      ...(definitePluralArticle ? [definitePluralArticle] : []),
      plural,
      ...(indefiniteArticle ? [indefiniteArticle] : []),
    ]);
  }

  if (card.type === "verb") {
    return matchesExpected(whitespaceParts(answer), [card.italian, d.io, d.tu, d.luiLei, d.noi, d.voi, d.loro, d.auxiliary, d.participle]);
  }

  if (card.type === "adverb") return normalizeAnswer(answer) === normalizeAnswer(card.italian);

  const adjectiveParts = whitespaceParts(answer);
  if (adjectiveParts.length === 1 && cardSupportsStandardAdjectivePattern(card)) {
    const pattern = standardAdjectivePattern(adjectiveParts[0]);
    return Boolean(pattern && verificationFields(card).every((field) => normalizeAnswer(pattern[field.key as keyof typeof pattern] ?? "") === normalizeAnswer(field.expected)));
  }
  return matchesExpected(adjectiveParts, [d.masculineSingular || card.italian, d.feminineSingular, d.masculinePlural, d.femininePlural]);
}

export function verificationFields(card: Flashcard): VerificationField[] {
  const d = card.details;
  if (card.type === "noun") {
    const singular = d.singular === undefined ? card.italian : d.singular;
    return [
      { key: "singular", label: "Singular noun", expected: singular },
      { key: "plural", label: "Plural noun", expected: d.plural },
      { key: "definiteSingularArticle", label: "Definite singular article", expected: d.definiteSingularArticle || inferArticle(d.definiteSingular, singular, "") },
      { key: "definitePluralArticle", label: "Definite plural article", expected: d.definitePluralArticle || inferArticle(d.definitePlural, d.plural, "") },
      { key: "indefiniteArticle", label: "Indefinite article", expected: d.indefiniteArticle || inferArticle(d.indefinite, singular, "") },
    ].filter((field) => Boolean(field.expected));
  }
  if (card.type === "verb") {
    return [
      { key: "infinitive", label: "Infinitive", expected: card.italian },
      { key: "io", label: "io", expected: d.io },
      { key: "tu", label: "tu", expected: d.tu },
      { key: "luiLei", label: "lui / lei", expected: d.luiLei },
      { key: "noi", label: "noi", expected: d.noi },
      { key: "voi", label: "voi", expected: d.voi },
      { key: "loro", label: "loro", expected: d.loro },
      { key: "auxiliary", label: "Auxiliary", expected: d.auxiliary },
      { key: "participle", label: "Past participle", expected: d.participle },
    ];
  }
  if (card.type === "adverb") return [{ key: "form", label: "Adverb", expected: card.italian }];
  return [
    { key: "masculineSingular", label: "Masculine singular", expected: d.masculineSingular || card.italian },
    { key: "feminineSingular", label: "Feminine singular", expected: d.feminineSingular },
    { key: "masculinePlural", label: "Masculine plural", expected: d.masculinePlural },
    { key: "femininePlural", label: "Feminine plural", expected: d.femininePlural },
  ];
}
