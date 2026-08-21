# Parola project status

_Last updated: 2026-08-20_

This is the durable checkpoint for the current Parola architecture, project decisions, and next steps.

## Project policy

GitHub issues are informal ideas and reminders. They are not an authoritative specification, SDLC queue, priority order, or requirement to use branches, pull requests, milestones, release gates, or compatibility layers.

Current conversation decisions and current code take precedence over old issue wording.

## Data and schema policy

Do not design around backwards compatibility.

Treat each release as if it were a fresh 1.0. Keep one canonical data model. When a useful schema change would otherwise lose real user data, provide a one-time migration script or instructions outside the application. Do not commit permanent compatibility readers, dual schemas, or migration branches merely to preserve old representations.

## Current Parola architecture

Parola web is a static React/Vite application served at `https://guymichaely.com/parola/`. It is local-first and may optionally synchronize the same complete inventory snapshot with the Node API deployed separately to Azure.

Cards and noun morphology form one logical inventory. Browser persistence stores one `parola:inventory` JSON value containing cards, noun morphology, and an internal `updatedAt` timestamp. Remote synchronization uses the same complete snapshot and last-write-wins timestamp semantics.

## Inventory synchronization

- Local and remote are copies of one complete inventory snapshot.
- The later `updatedAt` wins; there is no per-card merge.
- Local mutations push automatically while sync is configured.
- The server rejects stale snapshot writes.
- Startup can reconcile automatically or wait for explicit **Sync now**.
- Browser persistence can be disabled while remote sync remains active for the session.
- Manual inventory export/import contains `cards` and `nounMorphology`, without sync transport metadata.

Deterministic tests cover newer-remote reconciliation, newer-local push, ask-first behavior, non-persistent local mode, and offline fallback. A real browser↔Azure smoke test remains an environment-level verification task rather than missing synchronization logic.

## Inventory and editing

Cards have optional sets and ordinary tags. There is no deck model. The Inventory grid and normal single-card editor are the canonical editing interfaces.

Current card creation/editing supports nouns, verbs, adjectives, and adverbs. Duplicate card creation is rejected. Bulk edits and mass tag changes commit through complete inventory replacement so cards and noun morphology remain consistent.

## Typed study

The prompted card determines the expected part of speech; the learner does not type part-of-speech prefixes.

Study supports English, Italian, or both prompt directions; optional typed Italian verification; one direction per word; English-first ordering when both directions are studied; scope filtering by part of speech, set, or tag; mistake review; and creation of mistake tags.

Noun typed verification uses configurable gender/tantum keywords and a candidate-based syntax parser. Syntax validity is separate from answer correctness. The live parse preview shows structural interpretation without revealing which candidate matches the prompted card before submission.

Verb, adjective, and adverb typed verification use their current canonical stored forms. Regular adjective shorthand is supported where the stored adjective actually matches the standard pattern.

## Noun morphology

A canonical noun card stores:

- `ruleId`;
- `base`;
- `gender`;
- `numberMode`, one of `both`, `singular`, or `plural`;
- `articleMode`, currently `automatic` or `none`.

It does not store derived singular, plural, or article strings.

Declension rules generate and recognize surface forms. Syntax rules describe accepted answer structures. Inference sets control which declensions each shorthand syntax may infer. Several syntaxes may share one inference set.

Examples:

```text
cetriolo: rule o-i, base cetriol, both numbers
specchio: rule chio-chi, base spec, both numbers
Venezia: rule singular-base, base Venezia, singular only
vestiti meaning clothes: rule plural-base, base vestiti, plural only
```

The Inventory view exposes editable declension rules, inference sets, syntax definitions, and noun assignments. The `specchio` learning-policy case is implemented: a rule may exist for the noun while being absent from shorthand inference until the learner chooses to add it.

See `docs/NOUN_MORPHOLOGY_AND_SYNTAX.md` for the detailed model.

## External card import contract

Parola does not contain a compatibility adapter for retired card formats.

The external import bridge accepts only cards that already obey the current canonical `Flashcard` schema. Unknown card types are rejected. Nouns must already contain current `ruleId`, `base`, `gender`, `numberMode`, and `articleMode` fields, and they must agree with the active noun morphology. Retired noun `singular`/`plural`/article-detail payloads are rejected rather than converted.

After validation, imported cards use the same `addBatch` and `CardStorage` persistence path as ordinary card creation.

## Automated validation

`npm test` runs deterministic tests against the real noun parser/preview, synchronization logic, and external import contract. Coverage includes ordinary shorthand, staged `specchio` inference, gender shorthand, elided and ambiguous articles, contradictory evidence, singularia/pluralia tantum, zero-candidate complete syntax, candidate ordering, preview candidate scoping, synchronization decisions, and rejection of retired/invalid import shapes.

`.github/workflows/validate.yml` runs the tests, the production web build, API syntax, and repository-wide static checks on relevant pull requests and pushes to `main`.

## Deployment

- `.github/workflows/deploy-pages.yml` tests, builds, and deploys only the web app to GitHub Pages.
- `.github/workflows/deploy-api.yml` independently deploys the optional synchronization API to Azure.
- Extension release infrastructure is separate from Pages.

The former Pages extension compatibility feed/package path has been removed. A real installed extension on `0.2.4` successfully updated to `0.2.5` through the independent Releases feed, confirming that bridge was no longer required.

## Inventory migration state

The current noun schema intentionally breaks the previous `nounPatterns` representation. The application contains no compatibility reader for the old schema. Any one-time migration of old real inventory belongs outside the application.

## Parola-only remaining work

There is no known unimplemented core feature from the current Parola architecture/issue set. The previously tracked main-app items—duplicate prevention, deck removal, realtime parse visualization, configurable noun morphology/inference, and the `specchio` shorthand-learning behavior—are implemented.

The remaining work is primarily hardening and validation:

1. Run a live browser↔Azure synchronization smoke test to verify deployed endpoint configuration, CORS/networking, and persistence behavior.
2. Manually exercise the noun-study edge cases in the actual UI: `cetriolo`, staged `specchio`, gender shorthand, elided articles, singularia tantum, and pluralia tantum.
3. Expand automated coverage beyond the current noun-heavy suite if desired—especially verb/adjective/adverb typed verification, card CRUD/inventory transfer, and morphology-editor interactions. This is test coverage, not missing user-facing functionality.
4. Continue normal UX/product iteration only when a new Parola requirement is identified. Extension capture/enrichment work is explicitly deferred and is not part of the current Parola-only implementation queue.
