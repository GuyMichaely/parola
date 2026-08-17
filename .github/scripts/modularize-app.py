from pathlib import Path

app_path = Path("web/src/App.tsx")
source = app_path.read_text()


def cut_between(text: str, start: str, end: str):
    start_index = text.index(start)
    end_index = text.index(end, start_index)
    return text[:start_index] + text[end_index:], text[start_index:end_index]


def remove_exact(text: str, block: str):
    if block not in text:
        raise SystemExit(f"Expected block not found:\n{block[:120]}")
    return text.replace(block, "", 1)

# Extract the existing independent UI blocks verbatim first.
source, study_options_block = cut_between(source, "function AnswerKeywordSettings", "function SaveIndicator")
source, save_indicator_block = cut_between(source, "function SaveIndicator", "function SetField")
source, storage_settings_block = cut_between(source, "function StorageSettingsModal", "function StudyScope")
source, study_scope_block = cut_between(source, "function StudyScope", "export default function Home")

# Move shared card-type labels into a tiny domain module.
source = remove_exact(source, '''const typeLabels: Record<CardType, string> = {
  noun: "Noun",
  verb: "Verb",
  adjective: "Adjective",
  adverb: "Adverb",
};

const cardTypes: CardType[] = ["noun", "verb", "adjective", "adverb"];

''')

# Move study-related public types/settings out of App.
source = remove_exact(source, '''type ScopeMode = "all" | "only" | "exclude";
type PromptLanguage = "english" | "italian";
type PromptMode = PromptLanguage | "both";
''')
source = remove_exact(source, '''type AnswerKeywords = {
  noun: string;
  verb: string;
  adjective: string;
  adverb: string;
  masculine: string;
  feminine: string;
  singularOnly: string;
  pluralOnly: string;
};

''')
source = remove_exact(source, 'type SaveState = "idle" | "saving" | "saved" | "failed";\n\n')
source = remove_exact(source, '''type StudyScopeOption = {
  key: string;
  label: string;
  kind: "type" | "set" | "deck" | "tag";
};

''')

# Move answer-keyword persistence with the study-options UI that owns it.
source, answer_keyword_block = cut_between(source, 'const answerKeywordsKey = "parola:answer-keywords";', "function cardAdderDraftKey")

old_import = 'import { createCardStorage, readStorageEndpoint, readStorageMode, saveStorageEndpoint, saveStorageMode, type CardStorage, type CardType, type Flashcard, type StorageMode } from "./storage";\n'
new_import = old_import + '''import { cardTypes, typeLabels } from "./cardTypes";
import { SaveIndicator, type SaveState } from "./components/SaveIndicator";
import { StorageSettingsModal } from "./components/StorageSettingsModal";
import { StudyOptions, answerKeyword, readAnswerKeywords, writeAnswerKeywords, type AnswerKeywords, type PromptLanguage, type PromptMode } from "./components/StudyOptions";
import { StudyScope, type ScopeMode, type StudyScopeOption } from "./components/StudyScope";
'''
if old_import not in source:
    raise SystemExit("App storage import not found")
source = source.replace(old_import, new_import, 1)

components = Path("web/src/components")
components.mkdir(parents=True, exist_ok=True)

Path("web/src/cardTypes.ts").write_text('''import type { CardType } from "./storage";

export const typeLabels: Record<CardType, string> = {
  noun: "Noun",
  verb: "Verb",
  adjective: "Adjective",
  adverb: "Adverb",
};

export const cardTypes: CardType[] = ["noun", "verb", "adjective", "adverb"];
''')

study_options_block = study_options_block.replace("function StudyOptions", "export function StudyOptions", 1)
Path("web/src/components/StudyOptions.tsx").write_text('''import { useState } from "react";
import type { CardType } from "../storage";
import { typeLabels } from "../cardTypes";

export type PromptLanguage = "english" | "italian";
export type PromptMode = PromptLanguage | "both";

export type AnswerKeywords = {
  noun: string;
  verb: string;
  adjective: string;
  adverb: string;
  masculine: string;
  feminine: string;
  singularOnly: string;
  pluralOnly: string;
};

''' + answer_keyword_block.replace("function answerKeyword", "export function answerKeyword", 1).replace("function readAnswerKeywords", "export function readAnswerKeywords", 1).replace("function writeAnswerKeywords", "export function writeAnswerKeywords", 1) + "\n" + study_options_block)

save_indicator_block = save_indicator_block.replace("function SaveIndicator", "export function SaveIndicator", 1)
Path("web/src/components/SaveIndicator.tsx").write_text('''export type SaveState = "idle" | "saving" | "saved" | "failed";

''' + save_indicator_block)

storage_settings_block = storage_settings_block.replace("function StorageSettingsModal", "export function StorageSettingsModal", 1)
Path("web/src/components/StorageSettingsModal.tsx").write_text('''import { type FormEvent, useState } from "react";
import type { StorageMode } from "../storage";

''' + storage_settings_block)

study_scope_block = study_scope_block.replace("function StudyScope", "export function StudyScope", 1)
Path("web/src/components/StudyScope.tsx").write_text('''export type ScopeMode = "all" | "only" | "exclude";

export type StudyScopeOption = {
  key: string;
  label: string;
  kind: "type" | "set" | "deck" | "tag";
};

''' + study_scope_block)

app_path.write_text(source)

print("App.tsx modularized into cardTypes and four focused UI modules.")
