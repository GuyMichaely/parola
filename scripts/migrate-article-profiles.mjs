#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/migrate-article-profiles.mjs <input.json> <output.json>");
  process.exit(1);
}

const articleProfiles = {
  all: { definiteSingular: true, definitePlural: true, indefiniteSingular: true },
  definiteSingularOnly: { definiteSingular: true, definitePlural: false, indefiniteSingular: false },
  definitePluralOnly: { definiteSingular: false, definitePlural: true, indefiniteSingular: false },
  none: { definiteSingular: false, definitePlural: false, indefiniteSingular: false },
};

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function nonEmptyString(value, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

function ruleNumberMode(rule) {
  const singular = Boolean(rule?.forms?.singular);
  const plural = Boolean(rule?.forms?.plural);
  if (singular && plural) return "both";
  if (singular) return "singular";
  if (plural) return "plural";
  throw new Error(`Declension rule ${rule?.name ?? "<unnamed>"} has no supported form.`);
}

function profileForOldNoun(details, rule) {
  if (details.articleMode === "none") return articleProfiles.none;
  if (details.articleMode !== "automatic") throw new Error(`Unsupported retired articleMode: ${details.articleMode}.`);
  const numberMode = ruleNumberMode(rule);
  if (numberMode === "both") return articleProfiles.all;
  if (numberMode === "singular") return articleProfiles.definiteSingularOnly;
  return articleProfiles.definitePluralOnly;
}

function migrateMarker(marker) {
  if (marker.kind === "gender") return { kind: "gender", required: Boolean(marker.required) };
  if (marker.kind === "tantum" && (marker.value === "singular" || marker.value === "plural")) {
    return { kind: "tantum", required: Boolean(marker.required), value: marker.value };
  }
  throw new Error("Unsupported syntax marker in retired morphology.");
}

function migrateField(field) {
  if (field.kind === "noun" && (field.number === "singular" || field.number === "plural")) {
    return { kind: "noun", number: field.number };
  }
  if (
    field.kind === "article"
    && (field.number === "singular" || field.number === "plural")
    && (field.definiteness === "definite" || field.definiteness === "indefinite")
  ) {
    return { kind: "article", definiteness: field.definiteness, number: field.number };
  }
  throw new Error("Unsupported syntax field in retired morphology.");
}

function migrateSyntax(raw, inferenceSetIdToName) {
  const syntax = objectValue(raw, "Syntax rule");
  const markers = Array.isArray(syntax.markers) ? syntax.markers.map(migrateMarker) : [];
  const fields = Array.isArray(syntax.fields) ? syntax.fields.map(migrateField) : [];
  const hasArticle = fields.some((field) => field.kind === "article");

  if (syntax.articleMode === "automatic" && !hasArticle) {
    return null;
  }

  if (syntax.articleMode === "none") {
    if (hasArticle) throw new Error(`No-article syntax ${syntax.name} contains an article field.`);
    if (syntax.numberMode !== "singular" && syntax.numberMode !== "plural") {
      throw new Error(`Articleless syntax ${syntax.name} needs manual migration because its retired numberMode is ${syntax.numberMode}.`);
    }

    const genderIndex = markers.findIndex((marker) => marker.kind === "gender");
    if (genderIndex >= 0) markers[genderIndex] = { kind: "gender", required: true };
    else markers.unshift({ kind: "gender", required: true });

    const tantumIndex = markers.findIndex((marker) => marker.kind === "tantum");
    const tantum = { kind: "tantum", required: true, value: syntax.numberMode };
    if (tantumIndex >= 0) markers[tantumIndex] = tantum;
    else markers.push(tantum);
  } else if (syntax.articleMode !== "automatic") {
    throw new Error(`Syntax ${syntax.name} has unsupported retired articleMode ${syntax.articleMode}.`);
  }

  const inferenceSet = syntax.inferenceSet
    ? nonEmptyString(syntax.inferenceSet, `Syntax ${syntax.name} inferenceSet`)
    : inferenceSetIdToName.get(String(syntax.inferenceSetId));
  if (!inferenceSet) throw new Error(`Syntax ${syntax.name} references an unknown inference set.`);

  return {
    name: nonEmptyString(syntax.name, "Syntax name"),
    markers,
    markerOrder: "any",
    fields,
    inferenceSet,
  };
}

const input = objectValue(JSON.parse(await readFile(inputPath, "utf8")), "Inventory");
if (!Array.isArray(input.cards)) throw new Error("Inventory must contain a cards array.");
const morphology = objectValue(input.nounMorphology, "nounMorphology");
if (!Array.isArray(morphology.declensionRules) || !Array.isArray(morphology.inferenceSets) || !Array.isArray(morphology.syntaxRules)) {
  throw new Error("nounMorphology must contain declensionRules, inferenceSets, and syntaxRules arrays.");
}

const ruleIdToName = new Map();
const declensionRules = morphology.declensionRules.map((raw) => {
  const rule = objectValue(raw, "Declension rule");
  const name = nonEmptyString(rule.name, "Declension rule name");
  if (rule.id !== undefined) ruleIdToName.set(String(rule.id), name);
  return { name, forms: rule.forms };
});
const rulesByName = new Map(declensionRules.map((rule) => [rule.name, rule]));

const inferenceSetIdToName = new Map();
const inferenceSets = morphology.inferenceSets.map((raw) => {
  const set = objectValue(raw, "Inference set");
  const name = nonEmptyString(set.name, "Inference set name");
  if (set.id !== undefined) inferenceSetIdToName.set(String(set.id), name);
  const retiredIds = Array.isArray(set.declensionRuleIds) ? set.declensionRuleIds : null;
  const currentNames = Array.isArray(set.declensionRules) ? set.declensionRules : null;
  if (!retiredIds && !currentNames) throw new Error(`Inference set ${name} has no declension-rule references.`);
  const declensionRuleNames = currentNames
    ? currentNames.map((ruleName) => nonEmptyString(ruleName, `Inference set ${name} rule name`))
    : retiredIds.map((ruleId) => {
      const ruleName = ruleIdToName.get(String(ruleId));
      if (!ruleName) throw new Error(`Inference set ${name} references unknown retired rule id ${ruleId}.`);
      return ruleName;
    });
  return { name, declensionRules: declensionRuleNames };
});

const cards = input.cards.map((card) => {
  if (card?.type !== "noun") return card;
  const details = objectValue(card.details, `Noun card ${card.id ?? card.english} details`);
  if (Object.prototype.hasOwnProperty.call(details, "articleProfile")) {
    throw new Error(`Noun card ${card.id ?? card.english} already has articleProfile; this script expects a retired articleMode schema.`);
  }
  const ruleName = details.rule
    ? nonEmptyString(details.rule, `Noun card ${card.id ?? card.english} rule`)
    : ruleIdToName.get(String(details.ruleId));
  if (!ruleName) throw new Error(`Noun card ${card.id ?? card.english} references an unknown retired declension rule.`);
  const rule = rulesByName.get(ruleName);
  if (!rule) throw new Error(`Noun card ${card.id ?? card.english} references unknown rule ${ruleName}.`);
  const { italian: _derivedItalian, ...cardWithoutItalian } = card;
  return {
    ...cardWithoutItalian,
    details: {
      rule: ruleName,
      base: String(details.base ?? ""),
      gender: String(details.gender),
      articleProfile: profileForOldNoun(details, rule),
    },
  };
});

const syntaxRules = morphology.syntaxRules
  .map((syntax) => migrateSyntax(syntax, inferenceSetIdToName))
  .filter(Boolean);
const output = {
  ...input,
  cards,
  nounMorphology: {
    declensionRules,
    inferenceSets,
    syntaxRules,
  },
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote migrated inventory to ${outputPath}.`);
console.log("Noun Italian surface forms are derived from rule + base and are not stored on noun cards.");
console.log("Automatic no-article shorthand syntaxes were removed because article-taking shorthand now requires an article.");
