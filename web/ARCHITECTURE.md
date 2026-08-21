# Architecture

Parola consists of a static React frontend and an optional remote sync API. Extension work is separate from the current Parola-only implementation.

```text
Parola web (React + Vite)
    |
    +--> local inventory snapshot
    |
    +--> optional remote sync snapshot
```

## Web

The frontend is a static Vite application. React manages the interactive UI; Vite and TypeScript are build-time tools. The production output is ordinary HTML, CSS, and JavaScript in `dist/`.

The build uses relative asset URLs so the same output can be served from `/`, `/parola/`, or another static path.

The main source boundaries are:

```text
src/
├── App.tsx                         application, inventory, study, external-import orchestration
├── cardTypes.ts                   shared card-type labels and ordering
├── extensionImport.ts             external import envelope and canonical-card validation
├── cards/
│   ├── types.ts                   Flashcard/CardType domain model
│   ├── editorModel.ts             card editor rows, validation, conversion, drafts
│   └── nounMorphology.ts          noun rules, syntax rules, inference sets, generation
├── storage/
│   ├── types.ts                   inventory storage contract
│   ├── browser.ts                 local snapshot persistence
│   ├── remote.ts                  HTTP snapshot client
│   ├── sync.ts                    local/remote last-write-wins synchronization
│   ├── cardCodec.ts               canonical card normalization/validation
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
    ├── InventoryCardsEditor.tsx    editable inventory table and noun definitions
    ├── NounMorphologyPanel.tsx     rules, inference sets, and syntax editing
    ├── SaveIndicator.tsx           persistence status UI
    ├── StorageSettingsModal.tsx    sync and inventory-transfer UI
    ├── StudyOptions.tsx            study options and noun answer-keyword settings
    └── StudyScope.tsx              study-scope selection UI
```

`App.tsx` owns cross-cutting application state, including the current card collection and active noun morphology. Morphology is passed explicitly to study and editor code rather than stored in a second runtime singleton.

English-to-Italian typed verification always uses the prompted card's known part of speech. There is no part-of-speech answer prefix. Noun gender and tantum markers remain configurable answer tokens.

## Noun morphology and syntax

A noun card stores its lexical definition as `rule`, `base`, `gender`, and `articleProfile`. The profile is one of `111`, `100`, `010`, or `000`; the bits represent definite singular, definite plural, and indefinite singular article availability.

A declension rule has a unique `name` plus supported `forms`. Its name is its reference. If both singular and plural form entries exist, the rule is a two-number rule. If only one exists, the rule is singular-only or plural-only. Number availability is therefore derived from the rule rather than duplicated on every noun card.

Article availability is independent from declension number availability. A noun may use a two-number declension and still have profile `100`, for example. Validation only requires that any enabled article capability has the noun form it needs.

An inference set has a unique `name` and a `declensionRules` array containing rule names. A syntax rule references an inference set by its name. Syntax-rule names are also unique and are used directly in parser diagnostics and editing instead of carrying separate IDs.

The morphology editor cascades renames through references. Renaming a declension updates inference-set membership immediately in the draft and updates noun-card rule references when the morphology state is saved. Renaming an inference set updates syntax references in the same draft. Duplicate names are rejected.

A syntax rule stores markers, ordered fields, and an inference-set reference. It does not persist `articleMode`, `articleProfile`, or `numberMode`.

Article constraints are derived from article fields at runtime. A definite singular field requires the target noun's first article-profile bit, a definite plural field requires the second, and an indefinite singular field requires the third. A syntax with no article field asserts `000` and must require explicit gender plus a singular-only or plural-only marker.

A noun field requires an inferred declension to support that surface number. A tantum marker additionally restricts inference to a declension whose number availability is exactly singular-only or plural-only. This lets article-bearing singular shorthand match both two-number and singular-only nouns without pretending that the syntax itself asserts one exact number class.

The noun parser evaluates every syntax against the typed input. A structurally complete syntax can produce zero, one, or several morphology candidates. Candidate generation does not consult the prompted card. Verification compares generated candidates with the card only after parsing.

A candidate contains inferred `rule`, `base`, and `gender`, plus an article constraint derived from its syntax. Final matching checks rule/base/gender and then applies that article constraint to the target's stored `articleProfile`. This means `il N` can match either `111` or `100`; it does not force an exact profile match.

This gives three outcomes:

- a matching candidate means correct;
- otherwise, any structurally complete syntax means wrong, even if it produced no morphology candidate;
- no structurally complete syntax means invalid or incomplete.

Article spelling contributes grammatical evidence. Unambiguous articles can establish gender. `l'` is gender-ambiguous, so the default syntax requires an explicit gender marker in that case. Contradictory explicit gender and article evidence makes that syntax inapplicable.

The `specchio` learning policy remains inference-set driven. `-chio → -chi` is assigned to the card but excluded from `Learned shorthand` by default. `lo specchio` is therefore wrong until the rule is added to that inference set. Other permitted rules infer different rule/base candidates, such as `-o → -i` with base `specchi`.

The live preview is structural. It shows the selected syntax, consumed fields, and missing fields. When that selected syntax produces morphology candidates, the preview may show their input-derived declension names. It does not indicate which candidate matches the prompted card.

See `../docs/NOUN_MORPHOLOGY_AND_SYNTAX.md` for the detailed model.

## Storage and sync

Cards and noun morphology form one logical `InventoryState`. `App` loads them with one `readInventory()` call. Whole-inventory operations use `replaceInventory()` so card definitions and morphology are validated and saved together.

Local snapshots contain `cards`, `nounMorphology`, and an internal `updatedAt`. Remote synchronized snapshots contain the same three values. `nounMorphology` contains declension rules, inference sets, and syntax rules.

Inventory validation checks relationships between cards and morphology. Every noun must reference an existing rule, enabled article capabilities must have the necessary noun forms, and its stored primary `italian` form must match the primary form generated from its canonical rule/base definition.

Bulk inventory edits and mass tag changes are committed as one inventory replacement instead of parallel card writes. Single-card creation, editing, and deletion continue to use narrower card operations that preserve active morphology in the same snapshot.

Both local and remote sides carry an inventory-level `updatedAt` timestamp. When they differ, the later timestamp wins. Local changes automatically push remotely when sync is configured. The user can choose whether a synchronized local copy persists between browser sessions and whether startup mismatches reconcile automatically or wait for an explicit Sync now action.

Inventory JSON export/import contains `cards` and `nounMorphology` without transport metadata.

## Morphology editing

`NounMorphologyPanel` edits a draft against the current App-owned inventory. If noun definitions or morphology change externally while that draft is dirty, the panel preserves the unsaved draft but marks it stale and disables saving. The user must explicitly discard the stale draft and reload current inventory before saving further morphology changes.

Changes to non-noun cards do not invalidate the morphology draft.

Noun-to-declension assignment is not duplicated in this panel. It lives in the Inventory noun-definition grid together with each noun's base, gender, article profile, and derived forms.

## External card import contract

The import bridge is intentionally thin. It accepts an envelope containing cards that already obey Parola's current canonical `Flashcard` schema.

Parola normalizes those cards with the same `cardCodec` used at storage boundaries. Unknown card types are rejected. Nouns must contain exactly the current `rule`, `base`, `gender`, and `articleProfile` details. Retired `ruleId`, noun `numberMode`, `articleMode`, singular/plural, and stored article-detail representations are rejected rather than translated.

Imported noun cards are checked against active `NounMorphology` before persistence. A syntactically current noun whose rule/base does not generate its stored primary Italian form, or whose enabled article capability lacks the required noun form, is rejected. After validation, imported cards use the same `addBatch` and `CardStorage` path as ordinary card creation.

This boundary is not a migration layer.

## Validation

`npm test` compiles parser, preview, synchronization, and import-validation modules into temporary CommonJS test output and runs deterministic Node tests against the real source modules. Test files run serially so their shared temporary CommonJS package marker cannot race.

The noun suite covers rule-derived number behavior, staged `specchio` inference, article capability matching, profile/declension independence, ambiguous article gender, contradictory evidence, articleless nouns, zero-candidate complete syntax, candidate specificity ordering, strict morphology schema validation, and live-preview candidate scoping. The sync suite covers automatic newer-remote reconciliation, newer-local push, ask-first reconciliation, non-persistent local mode, and offline fallback. Import tests verify that current canonical cards are accepted while retired noun shapes, unknown card types, and noun/morphology mismatches are rejected.

These synchronization tests verify decision logic without mutating a deployed inventory. A live browser-to-API smoke test remains the environment-level check for endpoint configuration, CORS/networking, and deployed persistence.

`.github/workflows/validate.yml` runs `npm ci`, `npm test`, the production web build, API syntax, and repository extension static checks on relevant pull requests and pushes to `main`.

## API

The API is an independent Node service that stores the timestamped inventory snapshot used for synchronization. It validates the same strict noun-card article-profile schema and name-reference morphology structure as the web app. It also verifies article-profile/rule compatibility and that each noun's stored primary `italian` value agrees with its referenced rule and base.

## Deployment

- `.github/workflows/deploy-pages.yml` tests, builds, and deploys only the web app to GitHub Pages.
- `.github/workflows/release-extension.yml` independently validates, signs, and publishes extension release assets through GitHub Releases.
- `.github/workflows/deploy-api.yml` independently deploys the API to Azure App Service.

The former Pages extension compatibility path is retired.
