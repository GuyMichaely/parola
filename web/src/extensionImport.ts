import type { Flashcard } from "./cards/types";
import type { NounMorphology } from "./cards/nounMorphology";
import {
  adjectiveCard,
  adverbCard,
  nounCard,
  verbCard,
} from "./cards/editorModel";

export const extensionImportRequestType = "parola-extension-import";
export const extensionImportResultType = "parola-extension-import-result";

export type ExtensionImportCandidate = {
  type: "noun" | "verb" | "adjective" | "adverb";
  english: string;
  italian: string;
  details: Record<string, string>;
};

export type ExtensionImportRequest = {
  source: "parola-capture-extension";
  type: typeof extensionImportRequestType;
  requestId: string;
  candidates: unknown[];
};

export type ExtensionImportResult = {
  source: "parola-web";
  type: typeof extensionImportResultType;
  requestId: string;
  ok: boolean;
  importedCount?: number;
  storage?: "browser" | "sync";
  error?: string;
};

function objectValue(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFC").trim();
}

function details(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, text(item)]));
}

function requireDetails(candidate: ExtensionImportCandidate, keys: string[]) {
  const missing = keys.find((key) => !candidate.details[key]);
  if (missing) throw new Error(`${candidate.italian} is missing required ${candidate.type} information.`);
}

export function normalizeExtensionImportCandidate(value: unknown): ExtensionImportCandidate {
  const candidate = objectValue(value, "Extension import candidate");
  const type = text(candidate.type);
  if (type !== "noun" && type !== "verb" && type !== "adjective" && type !== "adverb") {
    throw new Error("Extension import candidate has an invalid part of speech.");
  }
  const english = text(candidate.english);
  const italian = text(candidate.italian);
  if (!english || !italian) throw new Error("Extension import candidates need English and Italian text.");
  return { type, english, italian, details: details(candidate.details) };
}

export function parseExtensionImportRequest(value: unknown): ExtensionImportRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Partial<ExtensionImportRequest>;
  if (request.source !== "parola-capture-extension" || request.type !== extensionImportRequestType) return null;
  const requestId = text(request.requestId);
  if (!requestId || !Array.isArray(request.candidates) || !request.candidates.length) {
    throw new Error("Extension import request is incomplete.");
  }
  return { source: "parola-capture-extension", type: extensionImportRequestType, requestId, candidates: request.candidates };
}

export function extensionCandidatesToCards(values: unknown[], morphology: NounMorphology): Flashcard[] {
  return values.map((value, index) => {
    const candidate = normalizeExtensionImportCandidate(value);
    const d = candidate.details;
    const id = Date.now() + index;
    const common = { id, english: candidate.english, setName: null, tags: [] as string[] };

    if (candidate.type === "noun") {
      const gender = d.gender === "masculine" || d.gender === "feminine" ? d.gender : null;
      if (!gender) throw new Error(`${candidate.italian} needs a noun gender.`);
      return nounCard({
        ...common,
        gender,
        singular: d.singular || candidate.italian,
        plural: d.plural || "",
        definiteSingularArticle: d.definiteSingularArticle || "",
        definitePluralArticle: d.definitePluralArticle || "",
        indefiniteArticle: d.indefiniteArticle || "",
      }, morphology);
    }

    if (candidate.type === "verb") {
      requireDetails(candidate, ["io", "tu", "luiLei", "noi", "voi", "loro", "participle"]);
      const auxiliary = d.auxiliary === "essere" ? "essere" : d.auxiliary === "avere" ? "avere" : null;
      if (!auxiliary) throw new Error(`${candidate.italian} needs an avere/essere auxiliary.`);
      return verbCard({
        ...common,
        infinitive: d.infinitive || candidate.italian,
        io: d.io,
        tu: d.tu,
        luiLei: d.luiLei,
        noi: d.noi,
        voi: d.voi,
        loro: d.loro,
        auxiliary,
        participle: d.participle,
      });
    }

    if (candidate.type === "adjective") {
      requireDetails(candidate, ["feminineSingular", "masculinePlural", "femininePlural"]);
      return adjectiveCard({
        ...common,
        masculineSingular: d.masculineSingular || candidate.italian,
        feminineSingular: d.feminineSingular,
        masculinePlural: d.masculinePlural,
        femininePlural: d.femininePlural,
      });
    }

    return adverbCard({ ...common, form: d.form || candidate.italian });
  });
}
