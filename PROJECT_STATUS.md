# Parola project status

_Last updated: 2026-08-19_

This file is the durable checkpoint for the current Parola architecture, project decisions, and next steps.

## GitHub issue policy

GitHub issues in this repository are primarily an informal place for the user to record ideas and reminders. They are **not** an authoritative SDLC queue, specification, commitment, priority order, or indication that a formal issue-driven workflow is desired.

When working from an issue:

- use it as context for the underlying idea rather than treating its wording as a rigid specification;
- reconcile it with the current conversation, current code, and this project-status document;
- make sensible architectural/product decisions instead of preserving issue text for its own sake;
- do not infer process requirements such as branches, pull requests, milestones, issue closure, release gates, or backwards compatibility merely because an issue exists.

The current conversation and explicit project decisions take precedence over issue wording.

## Current architecture

Parola has three independently deployable parts:

- `web/` — static React/Vite flashcard frontend served at `https://guymichaely.com/parola/`.
- `extension/` — Chrome extension for manually capturing/staging Italian words and contexts before review/import.
- `api/` — optional synchronization API deployed separately to Azure.

The web app is local-first. Browser state remains a first-class copy of the inventory, while a configured API endpoint can act as a synchronization peer between machines.

## Web inventory synchronization

Remote synchronization is **not** a choice between “browser storage” and “remote storage.” Local and remote are copies of the same inventory snapshot.

- With no API endpoint configured, Parola is local-only.
- With an API endpoint configured, Parola compares the local and remote inventory snapshots when it opens.
- Inventory snapshots carry an internal `updatedAt` timestamp.
- Reconciliation is deliberately simple: **the snapshot with the later timestamp wins**. There is no per-card merge algorithm.
- The server rejects an older full-snapshot write instead of allowing stale state to overwrite newer state.
- Every local inventory mutation receives a newer timestamp and is automatically pushed to the remote server when sync is configured.
- If the server is unavailable, local work remains usable; the UI reports that it is not synced and a later load or manual sync can reconcile it.

Two sync preferences are user-configurable:

1. **Keep a persistent local copy** — when enabled, synchronized state remains in browser `localStorage` between sessions. When disabled, remote state is still used as the working inventory during the session but the synchronized inventory is not retained locally across reloads.
2. **When local and remote differ on load** — either synchronize automatically or report that sync is available and wait for the user to choose **Sync now**. In both cases the later timestamp is authoritative; the setting changes timing, not conflict direction.

The header exposes sync state such as checking, syncing, synced, sync available, or not synced.

## Extension capture model

Capture is intentionally user-driven. There is no automatic Duolingo DOM detection or browser automation.

Supported capture paths:

- type a single Italian word into the extension popup;
- type a sentence with the target surrounded by `*asterisks*`;
- highlight text on a page and use the extension context-menu action.

Captured words are staged for review before they are imported into Parola.

## Testing policy

Do not maintain automated browser/end-to-end tests for the extension.

Extension verification should use:

- static source checks such as `node --check` and manifest parsing in CI;
- signing/package checks, including verification of the fixed extension ID;
- manual testing with the real signed extension;
- exported extension debug logs when manual behavior needs diagnosis.

Puppeteer, Xvfb, automated Chrome interaction, and the old extension E2E harness have been removed.

## Data/schema policy

Do not preserve legacy schemas or compatibility paths merely for backwards compatibility.

When a breaking storage/schema change is useful:

- use a one-time migration when real data is worth preserving; or
- explicitly discard transient data when that is simpler and acceptable;
- then remove the old schema/compatibility code.

The target is one clean canonical model, not permanent support for historical representations.

## Current web-app UX

The web app supports typed English → Italian verification using configurable compact keywords/markers. The typed-answer UI includes a realtime parsing preview that explains how Parola is interpreting the current input: inferred/explicit part of speech, gender/number markers, and positional grammatical fields.

The Storage & sync dialog also provides manual inventory backup/restore:

- export the complete inventory to a JSON file;
- copy the same inventory JSON to the clipboard;
- import a JSON file as a full inventory replacement;
- paste inventory JSON into a text box and import it;
- cards carry their sets, decks/tags, and grammatical details in the export.

The canonical inventory transfer JSON is simply an object containing `cards`; it does not contain `format`, `version`, or `exportedAt`. Sync timestamps are internal synchronization metadata and are not part of the manual inventory export.

Inventory import/export concerns inventory data, not transient study-session state or UI preferences.

## Completed extension cleanup

The old detector/Duolingo architecture has been removed from current extension code and UI:

- no lesson scoping;
- no detection counts;
- no `positive-detection` model;
- capture timestamps use `createdAt` / `updatedAt`;
- debug state is event-oriented rather than detector diagnostics;
- review UI uses capture/staging terminology;
- manual capture/review/import is the canonical workflow.

The review-page focus bug has also been addressed in source so rerenders preserve the active review control when editing Italian, part of speech, or grammar fields.

## Extension release/deployment direction

The web app and extension should be deployed independently.

Target deployment model:

- Parola web: GitHub Pages at `https://guymichaely.com/parola/`.
- Extension: `.github/workflows/release-extension.yml`, publishing signed assets through GitHub Releases.
- API: `.github/workflows/deploy-api.yml`, deployed independently to Azure.

The extension source currently uses the independent GitHub Releases update feed:

- update feed: `https://github.com/GuyMichaely/parola/releases/latest/download/updates.xml`
- CRX: `https://github.com/GuyMichaely/parola/releases/latest/download/parola.crx`
- release metadata: `https://github.com/GuyMichaely/parola/releases/latest/download/version.json`

### One-time extension-feed cutover

The installed pre-cutover extension still needs to receive a release whose manifest points at the new GitHub Releases update feed. Until that is verified on the installed extension, the Pages workflow may temporarily continue publishing `/parola/extension/` as a bridge.

Once the installed extension is confirmed to be on the new feed:

1. remove extension packaging/signing from `.github/workflows/deploy-pages.yml`;
2. make Pages deploy only `web/`;
3. remove the temporary `/parola/extension/` release files from the Pages artifact;
4. thereafter, extension changes should trigger only `release-extension.yml`, while web changes trigger only the Pages workflow.

## Product roadmap

The core pipeline is:

**capture → enrichment → validation → review → persistence**

### 1. Manual capture/staging — done

The user explicitly stages words through the popup or selected text. No automatic Duolingo detection.

### 2. Manual-use hardening — substantially done / ongoing

Use the real signed extension, improve ordinary capture/review/import behavior, and diagnose problems using exported debug logs rather than browser automation.

### 3. Separate capture from canonical card candidate — next architectural step

A captured surface form must be distinct from the eventual canonical card representation.

Example:

- captured surface form: `mangio`
- context: the sentence in which `mangio` appeared
- canonical lemma/card form: `mangiare`

Capture data should represent facts about what the user encountered, such as:

- surface form;
- context(s);
- source/source URL;
- capture timestamp.

Candidate/card data should represent the proposed inventory entry, such as:

- lemma/base form;
- part of speech;
- English meaning;
- grammatical forms/details.

The capture should not be overwritten simply because the candidate is normalized or corrected.

### 4. User-initiated enrichment

Add an action such as **Enrich staged words**.

The extension should send staged captures through a provider/API abstraction that returns structured card candidates. Long-lived LLM/provider credentials should remain server-side rather than being embedded in the extension.

### 5. Morphology/card completion and validation

Use context to disambiguate lemma and meaning. An LLM may help with semantic interpretation, while authoritative dictionary/morphology data may be preferable for grammatical forms.

Validate structured provider output before it becomes importable. Human review remains between enrichment and persistence.

### 6. Optional immediate enrichment

Once batch enrichment is reliable, allow newly captured words to enter the same enrichment pipeline immediately as an optional workflow. This should reuse the same pipeline rather than become a second implementation.

## Immediate next steps

1. Verify the new local-first synchronization flow against the deployed Azure API from two browser/machine states, including newer-local, newer-remote, automatic, ask-first, and remote-unavailable cases.
2. Verify that the cleaned workflows successfully publish the current signed extension release without automated browser testing.
3. Update the installed extension through the existing feed and confirm that its manifest now points to the GitHub Releases feed.
4. Complete the one-time extension deployment separation by making Pages web-only.
5. Begin step 3 of the product roadmap: model captured surface forms separately from canonical card candidates/lemmas.
