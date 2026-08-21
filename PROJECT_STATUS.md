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

`Flashcard` is a discriminated union keyed by `type`. Nouns, verbs, adjectives, and adverbs each have their own typed `details` shape. Storage/import code validates external JSON at runtime before it enters that typed model.

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

Noun definitions live in the Inventory noun grid. The noun grid shows English, gender, base, declension, article profile, derived singular/plural forms, set, and tags. Number is not an editable noun-card column because it is derived from the selected declension rule.

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
- `articleProfile`, an object with Boolean `definiteSingular`, `definitePlural`, and `indefiniteSingular` capabilities.

Only four article-profile combinations are canonical:

```text
definite singular  definite plural  indefinite singular
true               true             true
true               false            false
false              true             false
false              false            false
```

Article availability is independent from declension number availability. A two-number rule may therefore be paired with a profile whose only enabled capability is `definiteSingular`; the plural noun form still exists even though the card does not accept a definite plural article.

Declension rules use their unique names as references. Their `forms` entries define number availability:

```text
singular + plural -> both numbers
singular only     -> singular-only
plural only       -> plural-only
```

Inference sets use unique names as references. Their `declensionRules` arrays contain declension-rule names. Syntax rules reference an inference set by name. Syntax-rule names are unique and are used directly for parser identity and diagnostics.

The morphology editor cascades renames. A rule rename updates inference-set references in the draft and noun-card references on save. An inference-set rename updates syntax references in the draft. Duplicate names are rejected.

Syntax rules do not store article or number profiles. Article constraints come from article fields. A definite singular field requires `articleProfile.definiteSingular`, a definite plural field requires `articleProfile.definitePlural`, and an indefinite singular field requires `articleProfile.indefiniteSingular`. A syntax with no article field requires the no-article profile and must require explicit gender plus a singular-only or plural-only marker.

A noun field requires the inferred declension to support that surface number. A tantum marker is stronger and restricts inference to an exactly singular-only or plural-only rule.

Examples:

```text
cetriolo: rule -o → -i, base cetriol, all three article capabilities
specchio: rule -chio → -chi, base spec, all three article capabilities
Venezia: rule Singular form is the base, base Venezia, no article capabilities
```

The `specchio` learning-policy case remains deliberate. `-chio → -chi` exists and is assigned to the card but is excluded from `Learned shorthand` by default. `lo specchio` is wrong until that rule is added to the inference set, because the other permitted rules infer different rule/base definitions.

Article-bearing shorthand requires an article. Ambiguous `l'` does not determine gender, so the learner must also provide a gender marker. Articleless nouns use explicit gender and singular/plural-only markers, for example `f s Venezia`.

See `docs/NOUN_MORPHOLOGY_AND_SYNTAX.md` for the detailed model.

## External card import contract

Parola does not contain a compatibility adapter for retired card formats.

The external import bridge accepts only cards that already obey the current canonical `Flashcard` schema. Unknown card types are rejected. Nouns must contain exactly current `rule`, `base`, `gender`, and structured `articleProfile` details and must agree with active noun morphology. Retired `ruleId`, noun `numberMode`, `articleMode`, singular/plural, and stored article-detail payloads are rejected rather than converted.

After validation, imported cards use the same `addBatch` and `CardStorage` persistence path as ordinary card creation.

## Automated validation

`npm test` runs deterministic tests against the real noun parser/preview, synchronization logic, and external import contract. Noun coverage includes rule-derived number behavior, staged `specchio` inference, article capability matching, article profiles independent of declension number availability, ambiguous article gender, contradictory evidence, articleless nouns, zero-candidate complete syntax, candidate ordering, preview candidate scoping, and strict rejection of retired schemas.

Test files run serially because they share one temporary CommonJS output directory.

`.github/workflows/validate.yml` runs tests, the production web build, API syntax, migration-script syntax, and repository static checks on relevant pull requests and pushes to `main`.

## Deployment

- `.github/workflows/deploy-pages.yml` tests, builds, and deploys only the web app to GitHub Pages.
- `.github/workflows/deploy-api.yml` independently deploys the optional synchronization API to Azure.
- Extension release infrastructure is separate from Pages.

The former Pages extension compatibility feed/package path has been removed.

## Inventory migration state

The current noun schema is intentionally canonical and does not read previous noun representations. `scripts/migrate-article-profiles.mjs` is a one-off utility for converting retired `articleMode` inventories outside application runtime.

## Parola-only remaining work

Remaining work is primarily validation and product iteration:

1. Run a live browser-to-Azure synchronization smoke test.
2. Manually exercise noun-study edge cases in the actual UI.
3. Expand automated coverage beyond the current noun-heavy suite if useful.
4. Continue normal UX/product iteration as new requirements are identified.
