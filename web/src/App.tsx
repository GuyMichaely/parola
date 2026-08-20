import { useEffect, useMemo, useState } from "react";
import {
  createCardStorage,
  readStorageEndpoint,
  readSyncLoadPolicy,
  readSyncPersistLocal,
  saveStorageEndpoint,
  saveSyncLoadPolicy,
  saveSyncPersistLocal,
  type CardStorage,
  type SyncLoadPolicy,
} from "./storage";
import type { CardType, Flashcard } from "./cards/types";
import { cardTypes, typeLabels } from "./cardTypes";
import { SaveIndicator, type SaveState } from "./components/SaveIndicator";
import { CardAnswer, EnglishAnswer, ItalianPrompt, ItalianVerificationForm } from "./components/CardAnswer";
import {
  AddCardModal,
  BulkEditCardsModal,
  EditCardModal,
  InventoryCardsEditor,
  deckName,
  deckTagPrefix,
  localDateStamp,
  visibleTags,
} from "./components/CardEditors";
import { StorageSettingsModal } from "./components/StorageSettingsModal";
import { StudyOptions, answerKeyword, readAnswerKeywords, writeAnswerKeywords, type AnswerKeywords, type PromptLanguage, type PromptMode } from "./components/StudyOptions";
import { StudyScope, type ScopeMode, type StudyScopeOption } from "./components/StudyScope";
import {
  shuffled,
  withEnglishPromptFirst,
  type AnswerSyntaxMode,
  type StudyItem,
} from "./study/logic";

export default function Home() {
  const [view, setView] = useState<"study" | "library">("study");
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [storageEndpoint, setStorageEndpoint] = useState(readStorageEndpoint);
  const [persistLocal, setPersistLocal] = useState(readSyncPersistLocal);
  const [syncLoadPolicy, setSyncLoadPolicy] = useState<SyncLoadPolicy>(readSyncLoadPolicy);
  const [storageSettingsOpen, setStorageSettingsOpen] = useState(false);
  const storage = useMemo<CardStorage>(() => createCardStorage(storageEndpoint, {
    persistLocal,
    loadPolicy: syncLoadPolicy,
  }), [persistLocal, storageEndpoint, syncLoadPolicy]);
  const [adding, setAdding] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [bulkEditingCards, setBulkEditingCards] = useState<Flashcard[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [verificationResult, setVerificationResult] = useState<"correct" | "wrong" | null>(null);
  const [submittedAnswer, setSubmittedAnswer] = useState("");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [promptMode, setPromptMode] = useState<PromptMode>("english");
  const [typeToVerify, setTypeToVerify] = useState(false);
  const [answerKeywords, setAnswerKeywords] = useState<AnswerKeywords>(readAnswerKeywords);
  const [oneDirectionPerWord, setOneDirectionPerWord] = useState(false);
  const [englishFirstWhenBoth, setEnglishFirstWhenBoth] = useState(false);
  const [compactAnswers, setCompactAnswers] = useState(false);
  const [directionSeed, setDirectionSeed] = useState(0);
  const [shuffleSeed, setShuffleSeed] = useState(() => Date.now() >>> 0);
  const [selectedInventoryTags, setSelectedInventoryTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [syncWarning, setSyncWarning] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [session, setSession] = useState({ right: 0, wrong: 0, skipped: 0 });
  const [sessionComplete, setSessionComplete] = useState(false);
  const [mistakeKeys, setMistakeKeys] = useState<string[]>([]);
  const [mistakeOnlyKeys, setMistakeOnlyKeys] = useState<string[] | null>(null);
  const [problemDeckName, setProblemDeckName] = useState("");
  const [createdProblemDeckName, setCreatedProblemDeckName] = useState("");

  const setNames = useMemo(() => Array.from(new Set(cards.map((card) => card.setName).filter((name): name is string => Boolean(name)))).sort((a, b) => a.localeCompare(b)), [cards]);
  const problemDeckNames = useMemo(() => Array.from(new Set(cards.flatMap((card) => card.tags.map(deckName).filter((name): name is string => Boolean(name))))).sort((a, b) => a.localeCompare(b)), [cards]);
  const suggestedProblemDeckName = useMemo(() => {
    const prefix = `Trouble · ${localDateStamp()} · `;
    return `${prefix}${problemDeckNames.filter((name) => name.startsWith(prefix)).length + 1}`;
  }, [problemDeckNames]);
  const effectiveProblemDeckName = problemDeckName || suggestedProblemDeckName;
  const arbitraryTags = useMemo(() => Array.from(new Set(cards.flatMap((card) => visibleTags(card.tags)))).sort((a, b) => a.localeCompare(b)), [cards]);
  const studyScopeOptions = useMemo<StudyScopeOption[]>(() => [
    ...cardTypes.map((type) => ({ key: `type:${type}`, label: typeLabels[type], kind: "type" as const })),
    ...setNames.map((name) => ({ key: `set:${name}`, label: name, kind: "set" as const })),
    ...problemDeckNames.map((name) => ({ key: `deck:${name}`, label: name, kind: "deck" as const })),
    ...arbitraryTags.map((tag) => ({ key: `tag:${tag}`, label: tag, kind: "tag" as const })),
  ], [arbitraryTags, problemDeckNames, setNames]);
  const inventoryTagOptions = useMemo(() => [
    ...cardTypes.map((type) => ({ key: `type:${type}`, label: typeLabels[type], kind: "type" })),
    ...setNames.map((name) => ({ key: `set:${name}`, label: name, kind: "set" })),
    ...problemDeckNames.map((name) => ({ key: `deck:${name}`, label: name, kind: "deck" })),
    ...arbitraryTags.map((tag) => ({ key: `tag:${tag}`, label: tag, kind: "custom" })),
  ], [arbitraryTags, problemDeckNames, setNames]);
  const scopedCards = useMemo(() => cards.filter((card) => {
    if (scopeMode === "all") return true;
    const belongsToSelectedScope = selectedScopes.includes(`type:${card.type}`) || Boolean(card.setName && selectedScopes.includes(`set:${card.setName}`)) || card.tags.some((tag) => {
      const name = deckName(tag);
      return name ? selectedScopes.includes(`deck:${name}`) : selectedScopes.includes(`tag:${tag}`);
    });
    return scopeMode === "only" ? belongsToSelectedScope : !belongsToSelectedScope;
  }), [cards, scopeMode, selectedScopes]);
  const homogeneousStudyType = useMemo<CardType | null>(() => {
    const types = new Set(scopedCards.map((item) => item.type));
    return types.size === 1 ? Array.from(types)[0] ?? null : null;
  }, [scopedCards]);
  const answerSyntaxMode: AnswerSyntaxMode = compactAnswers && homogeneousStudyType && typeToVerify && promptMode !== "italian" ? "compact" : "universal";
  const allStudyItems = useMemo(() => scopedCards.flatMap((card): StudyItem[] => {
    if (promptMode === "english" || promptMode === "italian") {
      return [{ key: `${card.id}:${promptMode}`, card, promptLanguage: promptMode }];
    }
    if (oneDirectionPerWord) {
      const promptLanguage: PromptLanguage = Math.abs((card.id * 31) + directionSeed) % 2 === 0 ? "english" : "italian";
      return [{ key: `${card.id}:${promptLanguage}`, card, promptLanguage }];
    }
    return [
      { key: `${card.id}:english`, card, promptLanguage: "english" },
      { key: `${card.id}:italian`, card, promptLanguage: "italian" },
    ];
  }), [directionSeed, oneDirectionPerWord, promptMode, scopedCards]);
  const studyItems = useMemo(() => {
    const randomized = shuffled(mistakeOnlyKeys
      ? mistakeOnlyKeys.map((key) => allStudyItems.find((item) => item.key === key)).filter((item): item is StudyItem => Boolean(item))
      : allStudyItems, shuffleSeed);
    return englishFirstWhenBoth && promptMode === "both" && !oneDirectionPerWord
      ? withEnglishPromptFirst(randomized)
      : randomized;
  }, [allStudyItems, englishFirstWhenBoth, mistakeOnlyKeys, oneDirectionPerWord, promptMode, shuffleSeed]);
  const studyItem = !sessionComplete && studyItems.length && current < studyItems.length ? studyItems[current] : null;
  const card = studyItem?.card ?? null;
  const typingItalian = Boolean(typeToVerify && studyItem?.promptLanguage === "english");
  const tagMatchedCards = useMemo(() => cards.filter((item) => {
    const cardTagKeys = [`type:${item.type}`, ...(item.setName ? [`set:${item.setName}`] : []), ...item.tags.map((tag) => {
      const name = deckName(tag);
      return name ? `deck:${name}` : `tag:${tag}`;
    })];
    return selectedInventoryTags.length === 0 || selectedInventoryTags.some((tag) => cardTagKeys.includes(tag));
  }), [cards, selectedInventoryTags]);
  const filteredCards = useMemo(() => tagMatchedCards.filter((item) => {
    const haystack = `${item.english} ${item.italian} ${item.details.singular ?? ""} ${item.setName ?? ""} ${item.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }), [query, tagMatchedCards]);

  useEffect(() => {
    let active = true;
    setLoadingCards(true);
    setSyncWarning("");
    storage.listCards()
      .then((storedCards) => { if (active) setCards(storedCards); })
      .catch((error) => {
        if (!active) return;
        setSyncWarning(error instanceof Error ? `Storage unavailable: ${error.message}` : "Storage is temporarily unavailable.");
      })
      .finally(() => { if (active) setLoadingCards(false); });
    return () => { active = false; };
  }, [storage]);

  useEffect(() => {
    writeAnswerKeywords(answerKeywords);
  }, [answerKeywords]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && (adding || editingCard || bulkEditingCards)) {
        setAdding(false);
        setEditingCard(null);
        setBulkEditingCards(null);
        return;
      }
      if (view === "study" && typingItalian && verificationResult && event.key === "Enter") {
        event.preventDefault();
        advanceCard();
        return;
      }
      if (adding || editingCard || bulkEditingCards || view !== "study" || !studyItem || typingItalian) return;
      const target = event.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.code === "Space" || (!revealed && event.key === "Enter")) {
        event.preventDefault();
        setRevealed((value) => !value);
      } else if (revealed && event.key === "2") {
        event.preventDefault();
        rate("wrong");
      } else if (revealed && (event.key === "1" || event.key === "Enter")) {
        event.preventDefault();
        rate("right");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function rate(result: "right" | "wrong" | "skipped") {
    if (!studyItems.length || !studyItem) return;
    setSession((value) => ({ ...value, [result]: value[result] + 1 }));
    if (result === "wrong") setMistakeKeys((items) => items.includes(studyItem.key) ? items : [...items, studyItem.key]);
    advanceCard();
  }

  function verifyItalian(correct: boolean, answer: string) {
    if (!studyItem || verificationResult) return;
    const result = correct ? "right" : "wrong";
    setSession((value) => ({ ...value, [result]: value[result] + 1 }));
    if (!correct) setMistakeKeys((items) => items.includes(studyItem.key) ? items : [...items, studyItem.key]);
    setSubmittedAnswer(answer.trim());
    setVerificationResult(correct ? "correct" : "wrong");
    setRevealed(true);
  }

  function advanceCard() {
    if (current + 1 >= studyItems.length) setSessionComplete(true);
    else setCurrent((value) => value + 1);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
  }

  function toggleScope(key: string) {
    setSelectedScopes((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
    setCompactAnswers(false);
    resetStudyProgress();
  }

  function changeScopeMode(mode: ScopeMode) {
    setScopeMode(mode);
    setCompactAnswers(false);
    resetStudyProgress();
  }

  function changePromptMode(mode: PromptMode) {
    setPromptMode(mode);
    resetStudyProgress();
  }

  function toggleTypeToVerify() {
    setTypeToVerify((value) => !value);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
  }

  function toggleOneDirectionPerWord() {
    setOneDirectionPerWord((value) => !value);
    setDirectionSeed((value) => value + 1);
    resetStudyProgress();
  }

  function toggleEnglishFirstWhenBoth() {
    setEnglishFirstWhenBoth((value) => !value);
    resetStudyProgress();
  }

  function toggleCompactAnswers() {
    setCompactAnswers((value) => !value);
    resetStudyProgress();
  }

  function resetStudyProgress() {
    setShuffleSeed((value) => value + 1);
    setCurrent(0);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSessionComplete(false);
    setMistakeKeys([]);
    setMistakeOnlyKeys(null);
    setProblemDeckName("");
    setCreatedProblemDeckName("");
    setSession({ right: 0, wrong: 0, skipped: 0 });
  }

  function toggleInventoryTag(key: string) {
    setSelectedInventoryTags((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
  }

  function removeUnavailableInventoryTags(nextCards: Flashcard[]) {
    const availableTagKeys = new Set([
      "type:noun",
      "type:verb",
      "type:adjective",
      "type:adverb",
      ...nextCards.flatMap((item) => [
        ...(item.setName ? [`set:${item.setName}`] : []),
        ...item.tags.map((tag) => {
          const name = deckName(tag);
          return name ? `deck:${name}` : `tag:${tag}`;
        }),
      ]),
    ]);
    setSelectedInventoryTags((items) => items.filter((key) => availableTagKeys.has(key)));
  }

  function restartCurrentStudy() {
    if (!mistakeOnlyKeys) setDirectionSeed((value) => value + 1);
    setShuffleSeed((value) => value + 1);
    setCurrent(0);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSessionComplete(false);
    setMistakeKeys([]);
    setProblemDeckName("");
    setCreatedProblemDeckName("");
    setSession({ right: 0, wrong: 0, skipped: 0 });
  }

  function returnToOriginalStudy() {
    setMistakeOnlyKeys(null);
    setDirectionSeed((value) => value + 1);
    restartCurrentStudy();
  }

  function studyMistakes() {
    if (!mistakeKeys.length) return;
    setMistakeOnlyKeys([...mistakeKeys]);
    setShuffleSeed((value) => value + 1);
    setCurrent(0);
    setRevealed(false);
    setVerificationResult(null);
    setSubmittedAnswer("");
    setSessionComplete(false);
    setMistakeKeys([]);
    setProblemDeckName("");
    setCreatedProblemDeckName("");
    setSession({ right: 0, wrong: 0, skipped: 0 });
  }

  async function persistManyCards(updatedCards: Flashcard[], originalCards: Flashcard[], failureMessage: string) {
    const updatedById = new Map(updatedCards.map((item) => [item.id, item]));
    const optimisticCards = cards.map((item) => updatedById.get(item.id) ?? item);
    setCards(optimisticCards);
    removeUnavailableInventoryTags(optimisticCards);
    setSyncWarning("");
    setSaveState("saving");
    try {
      const saved = await Promise.all(updatedCards.map((item) => storage.updateCard(item)));
      const savedById = new Map(saved.map((savedCard) => [savedCard.id, savedCard]));
      setCards((items) => items.map((item) => savedById.get(item.id) ?? item));
      setSaveState("saved");
      return true;
    } catch {
      await Promise.allSettled(originalCards.map((item) => storage.updateCard(item)));
      const originalById = new Map(originalCards.map((item) => [item.id, item]));
      setCards((items) => items.map((item) => originalById.get(item.id) ?? item));
      setSaveState("failed");
      setSyncWarning(failureMessage);
      return false;
    }
  }

  async function createProblemDeck() {
    const name = effectiveProblemDeckName.trim();
    if (!name || !mistakeKeys.length) return;
    setProblemDeckName(name);
    const cardIds = new Set(mistakeKeys.map((key) => Number(key.split(":", 1)[0])).filter(Number.isFinite));
    const originalCards = cards.filter((item) => cardIds.has(item.id));
    const tag = `${deckTagPrefix}${name}`;
    const updatedCards = originalCards.map((item) => ({ ...item, tags: item.tags.includes(tag) ? item.tags : [...item.tags, tag] }));
    const saved = await persistManyCards(updatedCards, originalCards, "That problem deck could not be created. No card memberships were changed.");
    if (saved) setCreatedProblemDeckName(name);
  }

  async function removeTagFromExistence(tag: string) {
    const originalCards = cards.filter((item) => item.tags.includes(tag));
    if (!originalCards.length || !window.confirm(`Remove #${tag} from ${originalCards.length} ${originalCards.length === 1 ? "card" : "cards"}?`)) return;
    const updatedCards = originalCards.map((item) => ({ ...item, tags: item.tags.filter((itemTag) => itemTag !== tag) }));
    await persistManyCards(updatedCards, originalCards, `#${tag} could not be removed. The tag has been restored.`);
  }

  async function addBatch(newCards: Flashcard[]) {
    const temporaryCards = newCards.map((card, index) => ({ ...card, id: -(Date.now() + index) }));
    const temporaryIds = new Set(temporaryCards.map((card) => card.id));
    setCards((items) => [...temporaryCards, ...items]);
    setSyncWarning("");
    setSaveState("saving");
    setView("library");
    try {
      const savedCards = await storage.createCards(newCards);
      setCards((items) => [...savedCards, ...items.filter((item) => !temporaryIds.has(item.id))]);
      setSaveState("saved");
    } catch (error) {
      setCards((items) => items.filter((item) => !temporaryIds.has(item.id)));
      setSaveState("failed");
      setSyncWarning("That batch could not be saved and was removed. Please try again.");
      throw error;
    }
  }

  function removeCard(id: number) {
    const removed = cards.find((item) => item.id === id);
    if (!removed) return;
    const remainingCards = cards.filter((item) => item.id !== id);
    setCards(remainingCards);
    removeUnavailableInventoryTags(remainingCards);
    setCurrent(0);
    setSaveState("saving");
    void (async () => {
      try {
        await storage.deleteCard(id);
        setSyncWarning("");
        setSaveState("saved");
      } catch {
        setCards((items) => items.some((item) => item.id === id) ? items : [removed, ...items]);
        setSaveState("failed");
        setSyncWarning("That card could not be removed. It has been restored.");
      }
    })();
  }

  function updateCard(updated: Flashcard) {
    const original = cards.find((item) => item.id === updated.id);
    if (!original) return;
    const updatedCards = cards.map((item) => item.id === updated.id ? updated : item);
    setCards(updatedCards);
    removeUnavailableInventoryTags(updatedCards);
    setSyncWarning("");
    setSaveState("saving");
    void (async () => {
      try {
        const savedCard = await storage.updateCard(updated);
        setCards((items) => items.map((item) => item.id === updated.id ? savedCard : item));
        setSaveState("saved");
      } catch {
        setCards((items) => items.map((item) => item.id === updated.id ? original : item));
        setSaveState("failed");
        setSyncWarning("That edit could not be saved. The previous card has been restored.");
      }
    })();
  }

  async function applyStorageSettings(endpoint: string, nextPersistLocal: boolean, nextLoadPolicy: SyncLoadPolicy) {
    const normalizedEndpoint = endpoint.trim();
    const effectivePersistLocal = normalizedEndpoint ? nextPersistLocal : true;

    if (!normalizedEndpoint && storageEndpoint) {
      const latestCards = storage.syncNow ? await storage.syncNow() : await storage.listCards();
      await createCardStorage("").replaceCards(latestCards);
      setCards(latestCards);
    }

    saveStorageEndpoint(normalizedEndpoint);
    saveSyncPersistLocal(effectivePersistLocal);
    saveSyncLoadPolicy(nextLoadPolicy);
    setStorageEndpoint(normalizedEndpoint);
    setPersistLocal(effectivePersistLocal);
    setSyncLoadPolicy(nextLoadPolicy);
    setSyncWarning("");
    setSaveState("idle");
    setCurrent(0);
    setSessionComplete(false);
  }

  async function syncNow() {
    if (!storage.syncNow) return;
    const nextCards = await storage.syncNow();
    setCards(nextCards);
    removeUnavailableInventoryTags(nextCards);
    setCurrent(0);
    setSessionComplete(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="header-inner">
          <nav aria-label="Main navigation">
            <button className={view === "study" ? "active" : ""} onClick={() => setView("study")}>Study</button>
            <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>Inventory</button>
          </nav>
          <div className="header-actions">
            <button className="storage-button" onClick={() => setStorageSettingsOpen(true)} title={storageEndpoint ? `Sync server: ${storage.label}` : "Inventory is stored locally in this browser"}>
              <span className={`storage-dot ${storageEndpoint ? "remote" : "local"}`} />
              {storageEndpoint ? "Sync" : "Local"}
            </button>
            <SaveIndicator state={saveState} />
            <button className="primary-button" onClick={() => setAdding(true)}>＋ New cards</button>
          </div>
        </div>
      </header>

      <div className="content-frame">
        {view === "study" ? (
          <section className="study-view">
            <StudyScope mode={scopeMode} onMode={changeScopeMode} options={studyScopeOptions} selected={selectedScopes} onToggle={toggleScope} />
            <StudyOptions
              promptMode={promptMode}
              onPromptMode={changePromptMode}
              typeToVerify={typeToVerify}
              onTypeToVerify={toggleTypeToVerify}
              oneDirectionPerWord={oneDirectionPerWord}
              onOneDirectionPerWord={toggleOneDirectionPerWord}
              englishFirstWhenBoth={englishFirstWhenBoth}
              onEnglishFirstWhenBoth={toggleEnglishFirstWhenBoth}
              homogeneousType={homogeneousStudyType}
              compactAnswers={compactAnswers}
              onCompactAnswers={toggleCompactAnswers}
              answerKeywords={answerKeywords}
              onAnswerKeywords={setAnswerKeywords}
            />
            {syncWarning && <p className="sync-warning" role="status">{syncWarning}</p>}
            {loadingCards ? (
              <div className="empty-study" role="status"><p>Loading cards…</p></div>
            ) : sessionComplete ? (
              <div className="session-complete">
                <span className="answer-label">{mistakeOnlyKeys ? "Mistake review complete" : "Study complete"}</span>
                <h2>{mistakeOnlyKeys ? "Mistakes finished" : "Deck finished"}</h2>
                <p>{session.right} right · {session.wrong} wrong · {session.skipped} skipped</p>
                <div className="completion-actions">
                  {mistakeOnlyKeys ? <>
                    <button className="primary-button" onClick={restartCurrentStudy}>Study these mistakes again</button>
                    <button className="neutral-button" onClick={returnToOriginalStudy}>Study original deck</button>
                  </> : <>
                    <button className="primary-button" onClick={restartCurrentStudy}>Study again</button>
                    {mistakeKeys.length > 0 && <button className="wrong-button" onClick={studyMistakes}>Study mistakes ({mistakeKeys.length})</button>}
                  </>}
                </div>
                {!mistakeOnlyKeys && mistakeKeys.length > 0 && <div className="problem-deck-creator">
                  {createdProblemDeckName ? <p className="deck-created" role="status">Created deck <strong>{createdProblemDeckName}</strong></p> : <>
                    <label><span>Problem deck name</span><input value={effectiveProblemDeckName} onChange={(event) => setProblemDeckName(event.target.value)} /></label>
                    <button className="neutral-button" onClick={() => void createProblemDeck()} disabled={!effectiveProblemDeckName.trim() || saveState === "saving"}>Create problem deck</button>
                  </>}
                </div>}
              </div>
            ) : card && studyItem ? <>
              <div className="session-meta">
                <span>{answerSyntaxMode === "compact" && homogeneousStudyType && <><i className={`type-indicator ${homogeneousStudyType}`} />{typeLabels[homogeneousStudyType]} mode · </>}{studyItem.promptLanguage} prompt{card.setName && <b>{card.setName}</b>}</span>
                <span>{current + 1} / {studyItems.length}</span>
              </div>
              {typingItalian ? (
                <div className={`flashcard verification-card ${verificationResult ?? ""}`}>
                  {!verificationResult ? <>
                    <div className="verification-prompt"><span className="answer-label">English prompt</span><h2>{card.english}</h2></div>
                    <ItalianVerificationForm key={`${studyItem.key}:${answerSyntaxMode}`} card={card} syntaxMode={answerSyntaxMode} compactType={homogeneousStudyType} keywords={answerKeywords} onResult={verifyItalian} />
                  </> : <>
                    <div className={`verification-result ${verificationResult}`} role="status">
                      <strong>{verificationResult === "correct" ? "Correct" : "Not quite"}</strong>
                      <span>{verificationResult === "correct" ? "Your Italian matched every stored field." : "Compare your response with the stored answer below."}</span>
                    </div>
                    <div className="submitted-answer"><span>Your answer</span><strong>{submittedAnswer}</strong></div>
                    <div className="verified-answer-stack"><EnglishAnswer card={card} /><CardAnswer card={card} /></div>
                  </>}
                </div>
              ) : (
                <button className="flashcard" onClick={() => setRevealed((value) => !value)} aria-label={revealed ? `Show ${studyItem.promptLanguage} prompt` : `Show ${studyItem.promptLanguage === "english" ? "Italian" : "English"} answer`}>
                  {!revealed
                    ? studyItem.promptLanguage === "english" ? <div className="question-content"><span className="answer-label">English</span><h2>{card.english}</h2></div> : <ItalianPrompt card={card} />
                    : studyItem.promptLanguage === "english" ? <CardAnswer card={card} /> : <EnglishAnswer card={card} showType />}
                </button>
              )}
              {typingItalian ? (
                verificationResult ? (
                  <div className="study-actions verification-actions"><button className="primary-button" onClick={advanceCard}>Continue · Enter</button></div>
                ) : (
                  <div className="study-actions verification-actions"><button className="neutral-button" onClick={() => rate("skipped")}>Skip</button></div>
                )
              ) : !revealed ? (
                <div className="study-actions before-reveal">
                  <button className="neutral-button" onClick={() => rate("skipped")}>Skip</button>
                  <button className="primary-button" onClick={() => setRevealed(true)}>Reveal answer</button>
                </div>
              ) : (
                <div className="study-actions rating-actions">
                  <button className="wrong-button" onClick={() => rate("wrong")}><span>2</span> Wrong</button>
                  <button className="right-button" onClick={() => rate("right")}><span>1</span> Right · Enter</button>
                </div>
              )}
              {!typingItalian && <p className="keyboard-hint">{revealed ? "Space or click flips · 1 or Enter right · 2 wrong" : "Space, Enter, or click flips"}</p>}
              {(session.right + session.wrong + session.skipped) > 0 && <p className="session-counts">This session: {session.right} right · {session.wrong} wrong · {session.skipped} skipped</p>}
            </> : (
              <div className="empty-study">
                <h2>No cards in this study scope</h2>
                <p>{scopeMode === "only" && !selectedScopes.length ? "Select one or more parts of speech, decks, or sets above." : "Change the scope or add cards."}</p>
              </div>
            )}
          </section>
        ) : (
          <section className="library-view">
            <h1>Inventory</h1>
            <div className="inventory-sticky">
              <div className="inventory-control-row">
                <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search words, sets, or tags…" aria-label="Search inventory" />
                <div className="inventory-actions">
                  <button className="edit-filtered-button" onClick={() => setBulkEditingCards(tagMatchedCards)} disabled={!selectedInventoryTags.length || !tagMatchedCards.length} title={!selectedInventoryTags.length ? "Select one or more tags first" : undefined}>Focused edit{selectedInventoryTags.length ? ` (${tagMatchedCards.length})` : ""}</button>
                </div>
              </div>
              <div className="tag-filter-row" aria-label="Filter by tags">
                {inventoryTagOptions.map((tag) => tag.kind === "custom" ? <span className="filter-tag-group" key={tag.key}>
                  <button className={`filter-tag custom ${selectedInventoryTags.includes(tag.key) ? "selected" : ""}`} aria-pressed={selectedInventoryTags.includes(tag.key)} onClick={() => toggleInventoryTag(tag.key)}>{tag.label}</button>
                  <button className="delete-filter-tag" onClick={() => void removeTagFromExistence(tag.label)} aria-label={`Remove tag ${tag.label} from all cards`} title="Remove tag from all cards">×</button>
                </span> : <button key={tag.key} className={`filter-tag ${tag.kind} ${selectedInventoryTags.includes(tag.key) ? "selected" : ""}`} aria-pressed={selectedInventoryTags.includes(tag.key)} onClick={() => toggleInventoryTag(tag.key)}>{tag.label}</button>)}
              </div>
            </div>
            {syncWarning && <p className="sync-warning" role="status">{syncWarning}</p>}
            {loadingCards ? <div className="empty-state" role="status"><strong>Loading cards…</strong></div> : filteredCards.length ? <InventoryCardsEditor
              key={`${selectedInventoryTags.join("|")}:${query}:${filteredCards.map((item) => item.id).join(",")}`}
              cards={filteredCards}
              knownSets={setNames}
              onOpen={setEditingCard}
              onRemove={removeCard}
              onSave={(updatedCards, originalCards) => persistManyCards(updatedCards, originalCards, "Those inventory edits could not be saved. The previous cards were restored.")}
            /> : <div className="empty-state"><strong>No cards found</strong></div>}
          </section>
        )}
      </div>

      {adding && <AddCardModal knownSets={setNames} onClose={() => setAdding(false)} onBatch={addBatch} />}
      {editingCard && <EditCardModal card={editingCard} knownSets={setNames} onClose={() => setEditingCard(null)} onSave={updateCard} />}
      {bulkEditingCards && <BulkEditCardsModal cards={bulkEditingCards} onClose={() => setBulkEditingCards(null)} onSave={(updatedCards) => persistManyCards(updatedCards, bulkEditingCards, "Those card edits could not be saved. The previous cards were restored.")} />}
      {storageSettingsOpen && <StorageSettingsModal
        storage={storage}
        endpoint={storageEndpoint}
        persistLocal={persistLocal}
        loadPolicy={syncLoadPolicy}
        onClose={() => setStorageSettingsOpen(false)}
        onApply={applyStorageSettings}
        onSyncNow={syncNow}
      />}
    </main>
  );
}
