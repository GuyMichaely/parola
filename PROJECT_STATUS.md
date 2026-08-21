# Parola project status

_Last updated: 2026-08-20_

This is the durable checkpoint for the current Parola architecture, project decisions, and next steps.

## Project policy

GitHub issues are informal ideas and reminders. They are not an authoritative specification, SDLC queue, priority order, or requirement to use branches, pull requests, milestones, release gates, or compatibility layers.

Current conversation decisions and current code take precedence over old issue wording.

## Data and schema policy

Do not design around backwards compatibility.

Treat each release as if it were a fresh 1.0. Keep one canonical data model. When a useful schema change would otherwise lose real user data, provide a one-time migration script or instructions outside the application. Do not commit permanent compatibility readers, dual schemas, or migration branches merely to preserve old representations.

## Current architecture

Parola has three independently deployable parts:

- `web/`, a React/Vite flashcard frontend served at `https://guymichaely.com/parola/`;
- `extension/`, a Chrome extension for manually capturing and staging Italian words and contexts;
- `api/`, an optional synchronization API deployed separately to Azure.

The web app is local-first. A configured API endpoint acts as a synchronization peer rather than replacing local state.

## Inventory synchronization

Local and remote state are copies of one complete inventory snapshot.

- Snapshots have an internal `updatedAt` timestamp.
- The later snapshot wins. There is no per-card merge.
- Local mutations receive a newer timestamp and push automatically when sync is configured.
- The server rejects stale snapshot writes.
- On load, the user can choose automatic reconciliation or ask-first behavior.
- Persistent browser storage can be disabled while remote sync remains active for the session.
- Browser persistence stores the complete state in one `parola:inventory` JSON value.
- API persistence stores the complete state in one JSON file. Cards, morphology, and the sync timestamp are not persisted as separately coordinated files.

The canonical synchronization state is:

```json
{
  "cards": [],
  "nounMorphology": {
    "declensionRules": [],
    "inferenceSets": [],
    "syntaxRules": []
  },
  "updatedAt": "..."
}
```

Manual inventory export contains `cards` and `nounMorphology`. It does not include sync timestamps or export metadata.

## Inventory categorization and editing

Cards have optional sets and ordinary tags. There is no deck model. Strings with the old `__deck__:` prefix receive no special behavior.

The Inventory grid is normal page content rather than a vertically scrolling box. The inline grid and normal single-card editor are the canonical editing interfaces.

## Typed English to Italian verification

The prompted card determines the expected part of speech. The learner does not type noun, verb, adjective, or adverb prefixes.

The live parser shows part of speech as an ordinary parsed field. The only configurable answer keywords are noun gender and tantum markers:

- masculine;
- feminine;
- singular-only;
- plural-only.

Gender and tantum markers may appear in either order.

Typed input can be partial, syntactically complete, or invalid. Syntax validity is separate from answer correctness.

For noun answers, Parola evaluates candidate interpretations. If at least one candidate matches the prompted noun definition, the answer is correct. Otherwise, if at least one syntax is structurally complete, the answer is wrong even when no permitted declension rule produces a candidate. If no syntax is structurally complete, the syntax is invalid or incomplete.

The live preview may show possible declension candidates, but it does not reveal which candidate matches the prompted card before submission. Candidate names shown in the preview belong to the syntax the preview is currently displaying. If one interpretation is structurally complete but produces no candidate while another syntax is still a viable partial parse, the live preview favors the viable partial parse.

After submission, a wrong noun answer may show the syntax, declension rule, base, and gender Parola inferred from the submitted input.

## Noun morphology

Noun morphology, answer syntax, and learning policy are separate concepts.

A canonical noun card stores:

- `ruleId`;
- `base`;
- `gender`;
- `numberMode`, one of `both`, `singular`, or `plural`;
- `articleMode`, currently `automatic` or `none`.

It does not store derived singular, plural, or article strings.

A declension rule defines how its supported surface forms relate to the stored base. Rules may support both numbers or only one. Generation and recognition use the same reversible suffix definition.

Examples:

```text
cetriolo: rule o-i, base cetriol, both numbers
specchio: rule chio-chi, base spec, both numbers
Venezia: rule singular-base, base Venezia, singular only
vestiti meaning clothes: rule plural-base, base vestiti, plural only
vestito meaning dress: rule o-i, base vestit, both numbers
```

`dress` and `clothes` are separate cards. The `clothes` card has no derived singular `vestito`.

Syntax rules describe typed-answer structure. They do not contain noun-specific morphology. Each syntax references an inference set. An inference set lists the declension rules that syntax may infer.

This is the learner-control mechanism for shorthand. The default `Article + singular` and `Gender + singular` syntaxes share the `learned-shorthand` inference set. `chio-chi` can initially be absent from that set, making `lo specchio` or `m specchio` complete but wrong interpretations through another allowed rule. Adding `chio-chi` later makes the same input capable of producing the correct candidate without changing the `specchio` card.

The Inventory view exposes a noun morphology panel. Declension rules, inference sets, syntax definitions, and noun assignments are editable data. Morphological recognition remains owned by declension rules rather than syntax-specific parser code.

See `docs/NOUN_MORPHOLOGY_AND_SYNTAX.md` for the detailed model.

## Automated validation

The web package has deterministic tests against the real parser, preview, and synchronization modules. The noun cases cover ordinary shorthand, staged `specchio` inference, shared gender shorthand policy, elided and ambiguous articles, contradictory grammatical evidence, singularia/pluralia tantum, complete syntax with zero candidates, morphology-specificity ordering, and preview candidate scoping.

The synchronization cases cover newer-remote reconciliation, newer-local push, ask-first reconciliation, non-persistent local mode, and offline fallback. These tests exercise the single-snapshot synchronization logic with in-memory browser storage and a fake HTTP peer; they do not replace a smoke test against the deployed browser/API environment.

`.github/workflows/validate.yml` runs the tests, the production web build, and the API syntax check on relevant pull requests and pushes to `main`. The Pages deployment also runs the test suite before building the production site.

## Inventory migration state

The current noun schema intentionally breaks the previous `nounPatterns` representation. The application contains no compatibility reader for the old schema.

One-time migration tooling is kept outside the repository. Before using existing inventory with the current application, migrate the old export to the `nounMorphology` schema and install or import the migrated state.

## Extension capture model

Capture is user-driven. There is no automatic Duolingo DOM detection or automated browser interaction.

Supported capture paths:

- type a single Italian word into the extension popup;
- type a sentence with the target surrounded by `*asterisks*`;
- highlight text on a page and use the extension context-menu action.

Captured words are staged for review before import.

The longer-term extension model should keep capture facts separate from canonical card candidates. A captured surface form such as `mangio` should remain distinct from the eventual lemma/card form `mangiare`.

## Extension testing policy

Do not maintain automated browser or end-to-end tests for the extension.

Use static source checks, manifest validation, signing/package checks, manual testing with the real signed extension, and exported debug logs.

## Extension deployment

The independent deployment model is already implemented:

- web through GitHub Pages;
- extension through `.github/workflows/release-extension.yml` and GitHub Releases;
- API through `.github/workflows/deploy-api.yml`.

The extension source moved to the GitHub Releases update feed in `0.2.3`, and `0.2.4` was the explicit cutover release. The Pages workflow still publishes `/parola/extension/updates.xml` and its CRX only as a compatibility bridge for clients installed on the old Pages feed. The project record does not yet confirm that the installed legacy client reached `0.2.4`, so the compatibility bridge should remain until that is confirmed. No further deployment-separation implementation is required before that confirmation.

## Product roadmap

The core pipeline is `capture -> enrichment -> validation -> review -> persistence`.

Manual capture and the basic review flow exist. The next larger extension architecture step is separating captured surface forms and contexts from canonical card candidates, then adding user-initiated enrichment through a provider/API abstraction.

## Immediate next steps

1. Keep the automated suite green and manually exercise `cetriolo`, staged `specchio` inference, gender shorthand, elided articles, singularia tantum, and pluralia tantum in the actual study UI.
2. Run a live browser↔Azure sync smoke test against the deployed environment. The synchronization decision logic itself is covered deterministically, including automatic/ask-first reconciliation and offline/non-persistent behavior.
3. Confirm the installed Parola Capture client is `0.2.4` or later. Once confirmed, remove the temporary Pages extension compatibility feed/package path.
4. Resume the capture/enrichment roadmap: separate captured surface forms/context from canonical card candidates, then add user-initiated enrichment behind a provider/API abstraction.
