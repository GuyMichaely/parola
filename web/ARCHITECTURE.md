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
├── App.tsx                         application and study-session orchestration
├── cardTypes.ts                   shared card-type labels and ordering
├── cards/
│   ├── types.ts                   Flashcard/CardType domain model
│   ├── editorModel.ts             card editor rows, validation, conversion, drafts
│   ├── nounMorphology.ts          noun rules, syntax rules, inference sets, generation
│   └── nounMorphologyRuntime.ts   active synchronized morphology definition
├── storage/
│   ├── types.ts                   inventory storage contract
│   ├── browser.ts                 local snapshot persistence
│   ├── remote.ts                  HTTP snapshot client
│   ├── sync.ts                    local/remote last-write-wins synchronization
│   ├── cardCodec.ts               storage-boundary normalization/parsing
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
    ├── AnswerParsePreview.tsx      live syntax and candidate interpretation
    ├── CardAnswer.tsx              prompt/answer/verification presentation
    ├── CardEditorFields.tsx        reusable editor table fields
    ├── CardEditors.tsx             editor-component public exports
    ├── EditCardModal.tsx           single-card editing
    ├── InventoryCardsEditor.tsx    editable inventory table
    ├── NounMorphologyPanel.tsx     rules, inference sets, syntax display, assignments
    ├── SaveIndicator.tsx           persistence status UI
    ├── StorageSettingsModal.tsx    sync and inventory-transfer UI
    ├── StudyOptions.tsx            study options and noun answer-keyword settings
    └── StudyScope.tsx              study-scope selection UI
```

`App.tsx` owns cross-cutting application state: the active study session, current card collection, synchronization configuration, and coordination between the study and inventory views. Domain transformations, persistence implementations, verification logic, and self-contained UI live outside the application shell.

English-to-Italian typed verification always uses the prompted card's known part of speech. There is no part-of-speech answer prefix or type-specific study mode. Noun gender and tantum markers remain configurable answer tokens.

## Noun morphology and syntax

A noun card stores its actual morphology as `ruleId`, `base`, `gender`, `numberMode`, and `articleMode`. It does not store derived plural or article fields.

A declension rule describes base-to-form transformations. Parola derives simple recognition by reversing those transformations. Gender and study policy are not part of a declension rule.

A syntax rule describes the structure of a typed noun answer. Each syntax references an inference set. An inference set lists the declension rules that syntax may use to interpret the learner's input. Several syntaxes can share one inference set.

The noun parser produces all complete candidates allowed by the input and active definitions. It does not consult the prompted card's actual rule while deciding whether syntax is valid. Verification compares the complete candidates with the card afterward.

This gives three outcomes:

- a matching candidate means correct;
- complete candidates with no match mean wrong;
- no complete candidate means invalid or incomplete syntax.

The live preview may show syntax fields and possible declension candidates. It does not reveal whether a candidate matches the prompted card.

See `../docs/NOUN_MORPHOLOGY_AND_SYNTAX.md` for the full model.

## Storage and sync

Local and remote storage are not mutually exclusive modes. The app keeps a working local inventory; configuring an API URL adds an optional synchronized remote copy.

The synchronized snapshot contains `cards`, `nounMorphology`, and `updatedAt`. `nounMorphology` contains declension rules, inference sets, and syntax rules.

Both sides carry an inventory-level `updatedAt` timestamp. When they differ, the later timestamp wins. Local changes automatically push remotely when sync is configured. The user can choose whether a synchronized local copy persists between browser sessions and whether startup mismatches reconcile automatically or wait for an explicit Sync now action.

Inventory JSON export/import contains `cards` and `nounMorphology` without export-format metadata.

## Extension

The Chrome extension is source-controlled under `extension/`. It stages user-selected Italian words and context, provides a review UI, and sends approved typed cards to the hosted Parola page through its content script.

There is no automated browser/end-to-end extension test harness. Release workflows perform static JavaScript/manifest validation and use Chrome only to pack/sign the CRX.

The canonical extension release workflow is `.github/workflows/release-extension.yml`, which publishes signed release assets through GitHub Releases. During the one-time updater cutover, `.github/workflows/deploy-pages.yml` still also packages the signed extension into the Pages artifact as a temporary compatibility bridge for already-installed older versions.

## API

The API is an independent Node service that stores the timestamped inventory snapshot used for synchronization. It validates that noun cards use the canonical noun schema and reference declension rules present in the snapshot.

## Deployment

- `.github/workflows/deploy-pages.yml` builds and deploys the web app to GitHub Pages. It temporarily also publishes the migration-bridge extension feed described above.
- `.github/workflows/release-extension.yml` independently validates, signs, and publishes extension release assets.
- `.github/workflows/deploy-api.yml` independently deploys the API to Azure App Service.
