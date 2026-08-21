# Architecture

Parola consists of a static React frontend, a Chrome capture extension, and an optional remote sync API.

```text
Parola web (React + Vite)
    |
    +--> local inventory snapshot
    |
    +--> optional remote sync snapshot

Chrome capture extension
    |
    +--> stages words/contexts
    +--> imports approved cards into Parola web
```

## Web

The frontend is a static Vite application. React manages the interactive UI; Vite and TypeScript are build-time tools. The production output is ordinary HTML, CSS, and JavaScript in `dist/`.

The build uses relative asset URLs so the same output can be served from `/`, `/parola/`, or another static path.

The main source boundaries are:

```text
src/
├── App.tsx                         application, inventory, and study-session orchestration
├── cardTypes.ts                   shared card-type labels and ordering
├── cards/
│   ├── types.ts                   Flashcard/CardType domain model
│   ├── editorModel.ts             card editor rows, validation, conversion, drafts
│   └── nounMorphology.ts          noun rules, syntax rules, inference sets, generation
├── storage/
│   ├── types.ts                   inventory storage contract
│   ├── browser.ts                 local snapshot persistence
│   ├── remote.ts                  HTTP snapshot client
│   ├── sync.ts                    local/remote last-write-wins synchronization
│   ├── cardCodec.ts               storage-boundary card normalization/parsing
│   ├── inventoryState.ts          cross-card/morphology inventory invariants
│   ├── inventoryTransfer.ts       inventory JSON import/export
│   ├── settings.ts                sync settings
│   └── index.ts                   storage factory and public exports
├── study/
│   ├── order.ts                   study-item ordering/shuffling
│   ├── nounSyntax.ts              candidate-based noun syntax evaluation
│   ├── verification.ts            answer verification for all card types
│   └── logic.ts                   study-module public exports
└── components/
    ├── AddCardModal.tsx            batch card creation
    ├── AnswerParsePreview.tsx      structural live answer preview
    ├── CardAnswer.tsx              prompt/answer/verification presentation
    ├── CardEditorFields.tsx        reusable editor table fields
    ├── CardEditors.tsx             editor-component public exports
    ├── EditCardModal.tsx           single-card editing
    ├── InventoryCardsEditor.tsx    editable inventory table
    ├── NounMorphologyPanel.tsx     rules, inference sets, syntax editing, assignments
    ├── SaveIndicator.tsx           persistence status UI
    ├── StorageSettingsModal.tsx    sync and inventory-transfer UI
    ├── StudyOptions.tsx            study options and noun answer-keyword settings
    └── StudyScope.tsx              study-scope selection UI
```

`App.tsx` owns cross-cutting application state, including the current card collection and active noun morphology. Morphology is passed explicitly to study and editor code rather than stored in a second global runtime singleton. Domain transformations, persistence implementations, verification logic, and self-contained UI live outside the application shell.

English-to-Italian typed verification always uses the prompted card's known part of speech. There is no part-of-speech answer prefix or type-specific study mode. Noun gender and tantum markers remain configurable answer tokens.

## Noun morphology and syntax

A noun card stores its actual morphology as `ruleId`, `base`, `gender`, `numberMode`, and `articleMode`. It does not store derived plural or article fields.

A declension rule describes base-to-form transformations. Parola derives simple recognition by reversing those transformations. Gender and study policy are not part of a declension rule.

A syntax rule describes the structure of a typed noun answer. Each syntax references an inference set. An inference set lists the declension rules that syntax may use to interpret the learner's input. Several syntaxes can share one inference set.

The noun parser evaluates every syntax against the typed input. A structurally complete syntax can then produce zero, one, or several morphology candidates. Candidate generation does not consult the prompted card's actual rule. Verification compares the generated candidates with the card only after parsing.

This gives three outcomes:

- a matching candidate means correct;
- otherwise, any structurally complete syntax means wrong, even if that syntax produced no morphology candidate;
- no structurally complete syntax means invalid or incomplete.

Ambiguous grammatical facts can branch. For example, `l’` does not determine noun gender by itself, so the parser can try masculine and feminine interpretations. Contradictory explicit facts make that syntax inapplicable.

The live preview is structural. It shows the selected syntax, consumed fields, and missing fields. When that selected syntax produces morphology candidates, the preview may also show their input-derived declension names. Those names come only from the selected syntax and never indicate which candidate, if any, matches the prompted card.

See `../docs/NOUN_MORPHOLOGY_AND_SYNTAX.md` for the full model.

## Storage and sync

Cards and noun morphology form one logical `InventoryState`. `App` loads them with one `readInventory()` call. Whole-inventory operations use `replaceInventory()` so card definitions and morphology are validated and saved together.

Local snapshots contain `cards`, `nounMorphology`, and an internal `updatedAt`. Remote synchronized snapshots contain the same three values. `nounMorphology` contains declension rules, inference sets, and syntax rules.

Inventory validation checks the relationship between cards and morphology, not only their individual shapes. Every noun must reference an existing compatible rule, and its stored primary `italian` form must match the primary form generated from its canonical noun definition.

Bulk inventory edits and mass tag changes are committed as one inventory replacement instead of parallel card writes. Single-card creation, editing, and deletion continue to use the narrower card operations, which preserve the active morphology in the same snapshot.

Both local and remote sides carry an inventory-level `updatedAt` timestamp. When they differ, the later timestamp wins. Local changes automatically push remotely when sync is configured. The user can choose whether a synchronized local copy persists between browser sessions and whether startup mismatches reconcile automatically or wait for an explicit Sync now action.

Inventory JSON export/import contains `cards` and `nounMorphology` without transport metadata.

## Morphology editing

`NounMorphologyPanel` edits a draft against the current App-owned inventory. If noun definitions or morphology change externally while that draft is dirty, the panel preserves the unsaved draft but marks it stale and disables saving. The user must explicitly discard the stale draft and reload the current noun inventory before saving further morphology changes.

Changes to non-noun cards do not invalidate the morphology draft.

## Validation

`npm test` compiles the parser, preview, and synchronization modules into temporary CommonJS test output and runs deterministic Node tests against the real source modules.

The noun suite covers ordinary shorthand, staged `specchio` inference, shared gender shorthand policy, elided and ambiguous articles, contradictory grammatical evidence, singularia/pluralia tantum, zero-candidate complete syntax, candidate specificity ordering, and live-preview candidate scoping. The sync suite covers automatic newer-remote reconciliation, newer-local push, ask-first reconciliation, non-persistent local mode, and offline fallback using in-memory browser storage plus a fake HTTP peer.

These synchronization tests verify decision logic without mutating a deployed inventory. A live browser↔API smoke test remains the environment-level check for endpoint configuration, CORS/networking, and deployed persistence.

`.github/workflows/validate.yml` runs `npm ci`, `npm test`, the production web build, and `node --check api/server.mjs` on relevant pull requests and pushes to `main`. The Pages deployment also runs the complete web test suite before building the production site.

## Extension

The Chrome extension is source-controlled under `extension/`. It stages user-selected Italian words and context, provides a review UI, and sends approved typed cards to the hosted Parola page through its content script.

There is no automated browser/end-to-end extension test harness. Release workflows perform static JavaScript/manifest validation and use Chrome only to pack/sign the CRX.

The canonical extension release workflow is `.github/workflows/release-extension.yml`, which publishes signed release assets through GitHub Releases. The extension manifest has used the GitHub Releases update feed since `0.2.3`; `0.2.4` was the cutover release. The Pages workflow still publishes the old feed path only as a compatibility bridge for clients installed before the cutover. Remove that bridge after the installed legacy client is confirmed to have reached `0.2.4` or later.

## API

The API is an independent Node service that stores the timestamped inventory snapshot used for synchronization. It validates the canonical noun-card shape, rule compatibility, and agreement between each noun's stored primary `italian` value and the form generated by its canonical morphology.

## Deployment

- `.github/workflows/deploy-pages.yml` validates and deploys the web app to GitHub Pages and temporarily packages the signed extension into the Pages artifact for old-feed compatibility.
- `.github/workflows/release-extension.yml` independently validates, signs, and publishes extension release assets through GitHub Releases.
- `.github/workflows/deploy-api.yml` independently deploys the API to Azure App Service.
