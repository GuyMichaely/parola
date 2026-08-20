import { useState } from "react";
import type { CardType } from "../cards/types";

export type PromptLanguage = "english" | "italian";
export type PromptMode = PromptLanguage | "both";

export type AnswerKeywords = {
  masculine: string;
  feminine: string;
  singularOnly: string;
  pluralOnly: string;
};

const answerKeywordsKey = "parola:answer-keywords";
const defaultAnswerKeywords: AnswerKeywords = {
  masculine: "m",
  feminine: "f",
  singularOnly: "sin",
  pluralOnly: "plu",
};

export function readAnswerKeywords(): AnswerKeywords {
  if (typeof window === "undefined") return defaultAnswerKeywords;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(answerKeywordsKey) ?? "{}") as Partial<AnswerKeywords>;
    return Object.fromEntries(Object.entries(defaultAnswerKeywords).map(([key, fallback]) => {
      const stored = parsed[key as keyof AnswerKeywords];
      return [key, typeof stored === "string" && stored.trim() ? stored.trim() : fallback];
    })) as AnswerKeywords;
  } catch {
    return defaultAnswerKeywords;
  }
}

export function writeAnswerKeywords(keywords: AnswerKeywords) {
  try {
    window.localStorage.setItem(answerKeywordsKey, JSON.stringify(keywords));
  } catch {
    // Keyword customization is optional; verification still works with the current in-memory values.
  }
}

function AnswerKeywordSettings({ keywords, onChange }: { keywords: AnswerKeywords; onChange: (keywords: AnswerKeywords) => void }) {
  const [draft, setDraft] = useState(keywords);
  const [message, setMessage] = useState("");
  const fields: { key: keyof AnswerKeywords; label: string }[] = [
    { key: "masculine", label: "Masculine" },
    { key: "feminine", label: "Feminine" },
    { key: "singularOnly", label: "Singular-only" },
    { key: "pluralOnly", label: "Plural-only" },
  ];

  function applyKeywords() {
    const normalized = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim().toLocaleLowerCase("it-IT")])) as AnswerKeywords;
    const values = Object.values(normalized);
    if (values.some((value) => !value || /\s|[|:"]/u.test(value))) {
      setMessage("Each keyword must be one non-empty token without spaces or punctuation separators.");
      return;
    }
    if (new Set(values).size !== values.length) {
      setMessage("Each keyword must be different.");
      return;
    }
    onChange(normalized);
    setDraft(normalized);
    setMessage("Applied and saved on this device.");
  }

  function resetKeywords() {
    setDraft(defaultAnswerKeywords);
    onChange(defaultAnswerKeywords);
    setMessage("Defaults restored.");
  }

  return <details className="keyword-settings">
    <summary>Answer keywords</summary>
    <div className="keyword-settings-body">
      <p>Customize the noun gender and tantum markers used while typing Italian answers.</p>
      <div className="keyword-grid">
        {fields.map((field) => <label key={field.key}><span>{field.label}</span><input value={draft[field.key]} onChange={(event) => { setDraft((current) => ({ ...current, [field.key]: event.target.value })); setMessage(""); }} autoCapitalize="none" spellCheck={false} /></label>)}
      </div>
      {message && <p className="keyword-message" role="status">{message}</p>}
      <div className="keyword-actions"><button type="button" className="text-button" onClick={resetKeywords}>Restore defaults</button><button type="button" className="neutral-button" onClick={applyKeywords}>Apply keywords</button></div>
    </div>
  </details>;
}

export function StudyOptions({
  promptMode,
  onPromptMode,
  typeToVerify,
  onTypeToVerify,
  oneDirectionPerWord,
  onOneDirectionPerWord,
  englishFirstWhenBoth,
  onEnglishFirstWhenBoth,
  homogeneousType: _homogeneousType,
  compactAnswers: _compactAnswers,
  onCompactAnswers: _onCompactAnswers,
  answerKeywords,
  onAnswerKeywords,
}: {
  promptMode: PromptMode;
  onPromptMode: (mode: PromptMode) => void;
  typeToVerify: boolean;
  onTypeToVerify: () => void;
  oneDirectionPerWord: boolean;
  onOneDirectionPerWord: () => void;
  englishFirstWhenBoth: boolean;
  onEnglishFirstWhenBoth: () => void;
  homogeneousType: CardType | null;
  compactAnswers: boolean;
  onCompactAnswers: () => void;
  answerKeywords: AnswerKeywords;
  onAnswerKeywords: (keywords: AnswerKeywords) => void;
}) {
  return (
    <section className="study-options" aria-label="Study options">
      <label className="study-option-select">
        <span>Prompt in</span>
        <select value={promptMode} onChange={(event) => onPromptMode(event.target.value as PromptMode)}>
          <option value="english">English</option>
          <option value="italian">Italian</option>
          <option value="both">Both languages</option>
        </select>
      </label>
      <label className="switch-option">
        <input type="checkbox" checked={typeToVerify} onChange={onTypeToVerify} />
        <span><strong>Type to verify</strong><small>Checks Italian answers automatically</small></span>
      </label>
      {promptMode === "both" && (
        <label className="study-option-select direction-choice">
          <span>For each word</span>
          <select value={oneDirectionPerWord ? "one" : "both"} onChange={onOneDirectionPerWord}>
            <option value="both">Prompt in both directions</option>
            <option value="one">Prompt in one mixed direction</option>
          </select>
        </label>
      )}
      {promptMode === "both" && !oneDirectionPerWord && <label className="switch-option">
        <input type="checkbox" checked={englishFirstWhenBoth} onChange={onEnglishFirstWhenBoth} />
        <span><strong>English first</strong><small>Show each word’s English prompt before its Italian prompt</small></span>
      </label>}
      {typeToVerify && promptMode !== "italian" && <AnswerKeywordSettings keywords={answerKeywords} onChange={onAnswerKeywords} />}
    </section>
  );
}
