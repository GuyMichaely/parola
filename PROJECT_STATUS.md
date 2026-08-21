# Parola project status

_Last updated: 2026-08-21_

This is the durable checkpoint for the current Parola architecture, project decisions, and next steps.

## Project policy

GitHub issues are informal ideas and reminders. They are not an authoritative specification, SDLC queue, priority order, or requirement to use branches, pull requests, milestones, release gates, or compatibility layers.

Current conversation decisions and current code take precedence over old issue wording.

## Data and schema policy

Do not design around backwards compatibility.

Treat each release as if it were a fresh 1.0. Keep one canonical data model. When a useful schema change would otherwise lose real user data, provide a one-time migration script or instructions outside the application. Do not commit permanent compatibility readers or dual schemas merely to preserve old representations.

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

Deterministic tests cover newer-remote reconciliation, newer-local push, ask-first behavior, non-persistent local mode, and offline fallback. A real browser-to-Azure smoke test remains an environment-level verification task rather than missing synchronization logic.

## Inventory and editing

Cards have optional sets and ordinary tags. There is no deck model. The Inventory grid and normal single-card editor are the canonical editing interfaces.

Current card creation/editing supports nouns, verbs, adjectives, and adverbs. Duplicate card creation is rejected. Bulk edits and mass tag changes commit through complete inventory replacement so cards and noun morphology remain consistent.

Noun definitions live in the Inventory noun grid. The separate noun-assignment table has been removed. The noun grid shows English, gender, base, declension, article behavior, derived singular/plural forms, set, and tags. Number is not an editable noun-card column because it is derived from the selected declension rule.

## Typed study

The prompted card determines the expected part of speech; the learner does not type part-of-speech prefixes.

Study supports English, Italian, or both prompt directions; optional typed Italian verification; one direction per word; English-first ordering when both directions are studied; scope filtering by part of speech, set, or tag; mistake review; and creation of mistake tags.

Noun typed verification uses configurable gender/tantum keywords and a candidate-based syntax parser. Default markers are `m`, `f`, `s`, and `p`. Syntax validity is separate from answer correctness. The live parse preview shows structural interpretation without revealing which candidate matches the prompted card before submission.

Verb, adjective, and adverb typed verification use their current canonical stored forms. Regular adjective shorthand is supported where the stored adjective matches the standard pattern.

## Noun morphology

A canonical noun card stores:

- `rule`, the unique name of its declension rule;
- `base`;
- `gender`;
- `articleMode`, currently `automatic` or `none`.

It does not store derived singular/plural strings, article strings, or a separate `numberMode`.

Declension rules use their unique names as references. Their `forms` entries define number availability:

```text
singular + plural -> both numbers
singular only     -> singular-only
plural only       -> plural-only
```

Inference sets also use unique names as references. Their `declensionRules` arrays contain declension-rule names. Syntax rules reference an inference set by name. Syntax-rule names are unique and are used directly for parser identity/diagnostics.

The morphology editor cascades renames. A rule rename updates inference-set references in the draft and noun-card references on save. An inference-set rename updates syntax references in the draft. Duplicate names are rejected.

Syntax `numberMode` remains because it is parser policy rather than noun-card data. It decides whether a syntax may try two-number, singular-only, or plural-only declension rules.

Syntax `articleMode` currently has two effects: it controls expected article generation for article fields, and it is copied to produced candidates for equality against the target noun. Whether no-article-field syntaxes should constrain target article behavior is still a design question under discussion.

Examples:

```text
cetriolo: rule -o → -i, base cetriol
specchio: rule -chio → -chi, base spec
Venezia: rule Singular form is the base, base Venezia
vestiti meaning clothes: rule Plural form is the base, base vestiti
```

The `specchio` learning-policy case is implemented: a rule may exist for the noun while being absent from shorthand inference until the learner adds it to the relevant inference set.

See `docs/NOUN_MORPHOLOGY_AND_SYNTAX.md` for the detailed model.

## External card import contract

Parola does not contain a compatibility adapter for retired card formats.

The external import bridge accepts only cards that already obey the current canonical `Flashcard` schema. Unknown card types are rejected. Nouns must contain exactly current `rule`, `base`, `gender`, and `articleMode` details and must agree with active noun morphology. Retired `ruleId`, `numberMode`, singular/plural, and stored article-detail payloads are rejected rather than converted.

After validation, imported cards use the same `addBatch` and `CardStorage` persistence path as ordinary card creation.

## Automated validation

`npm test` runs deterministic tests against the real noun parser/preview, synchronization logic, and external import contract. Coverage includes rule-derived number behavior, ordinary shorthand, staged `specchio` inference, gender shorthand, elided and ambiguous articles, contradictory evidence, singularia/pluralia tantum, zero-candidate complete syntax, candidate ordering, preview candidate scoping, synchronization decisions, and rejection of retired/invalid import shapes.

Test files run serially because they share one temporary CommonJS output directory.

`.github/workflows/validate.yml` runs tests, the production web build, API syntax, and repository static checks on relevant pull requests and pushes to `main`.

## Deployment

- `.github/workflows/deploy-pages.yml` tests, builds, and deploys only the web app to GitHub Pages.
- `.github/workflows/deploy-api.yml` independently deploys the optional synchronization API to Azure.
- Extension release infrastructure is separate from Pages.

The former Pages extension compatibility feed/package path has been removed.

## Inventory migration state

The current noun schema is intentionally canonical and does not read previous noun representations. Any one-time conversion of real old inventory belongs outside application runtime.

## Parola-only remaining work

There is no known unimplemented core feature from the current Parola architecture/issue set. Remaining work is primarily validation and product iteration:

1. Run a live browser-to-Azure synchronization smoke test.
2. Manually exercise noun-study edge cases in the actual UI.
3. Expand automated coverage beyond the current noun-heavy suite if useful.
4. Resolve whether syntax-level `articleMode` should constrain candidate equality when the syntax contains no article field.
5. Continue normal UX/product iteration as new requirements are identified.