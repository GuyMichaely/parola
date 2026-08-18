# Parola for Duolingo

Chrome Manifest V3 extension that collects words Duolingo explicitly marks as new and turns them into reviewed Parola cards.

## Lesson flow

- Watches Duolingo DOM changes for a visible `NEW WORD` marker.
- Looks for a purple-highlighted single-word candidate in the same exercise region.
- Creates a lesson-scoped staging session when the first new word is detected.
- Stages each normalized word once per lesson while retaining repeated detections as counts and context.
- Shows a short `Parola staged: …` confirmation in Duolingo when a word is captured.
- Watches for a visible lesson/practice/level/unit completion heading and automatically opens the review for that lesson when completion is detected.
- Keeps words from different lessons separate, so reviewing or clearing one lesson does not discard another lesson's pending words.

The review page lets the user correct the detected Italian, enter the English translation, choose the part of speech, review the Duolingo context, approve/discard each word, and fill the grammatical information needed for a normal Parola card:

- nouns: gender, singular/plural, and articles; regular forms/articles are suggested after gender is chosen but remain editable;
- verbs: infinitive, six present-tense forms, auxiliary, and past participle;
- adjectives: masculine/feminine singular/plural; regular `-o` and `-e` patterns are suggested but remain editable;
- adverbs: invariant Italian form.

`Add approved to Parola` opens the Parola web app and imports the reviewed cards into the storage mode that app is currently using. Browser-mode cards are written to the app's browser inventory; remote mode POSTs the same cards through the app's configured remote endpoint. Successfully imported items are removed from the extension's staging queue.

Every positive detector result is retained in extension diagnostics with its relevant DOM/evidence. The popup also provides a manual missed-word snapshot action for false-negative debugging.

## Testing

`npm test` runs the deterministic extension suite in Chrome. It verifies:

- the screenshot-derived `NEW WORD` detector fixture;
- lesson-session scoping;
- completion signaling;
- editable review state and regular adjective suggestions;
- lesson-specific clearing;
- the Parola browser-inventory import bridge and stored card shape.

`Test live Duolingo extension` is the hosted smoke test. It restores the committed disposable-account session, loads the unpacked extension on the authenticated Duolingo origin, injects a synthetic `NEW WORD` exercise into that live origin, verifies that the extension stages it, then injects a completion heading and verifies that a lesson-scoped review opens. This checks the real Duolingo origin/session/extension wiring without depending on CI solving an actual Duolingo exercise.

The completion-text heuristic currently recognizes visible headings equivalent to `Lesson complete!`, `Practice complete!`, `Level complete!`, or `Unit complete!`. If Duolingo changes its completion UI, the detector can be updated from live diagnostics without affecting staged-word storage.

Live GitHub-hosted tests restore the disposable Duolingo account's authenticated browser state from `tests/fixtures/duolingo-session-state.b64`. This avoids performing a fresh Duolingo credential login on every CI run.

### Refreshing the Duolingo CI session

Refreshing the CI login no longer requires a self-hosted runner, Tailscale, a Chrome remote-debugging port, Python, or a special disposable browser profile.

1. In the normal Chrome profile where Parola for Duolingo is installed, open Duolingo and log into the disposable test account normally.
2. While a logged-in Duolingo tab is active, open the Parola extension popup.
3. Click **Export GitHub login session**.
4. On the export page, click **Download duolingo-session-state.b64**.
5. Replace `extension/tests/fixtures/duolingo-session-state.b64` in this repository with the downloaded file.
6. Commit and push the replacement file.

The extension reads Duolingo localStorage/sessionStorage from the active tab and uses Chrome's `cookies` extension API to include Duolingo cookies, including HttpOnly cookies that page JavaScript cannot read. The export page writes the same gzip + base64 fixture format that the GitHub-hosted restore tests already consume.

When the fixture changes on `main`, the hosted session-restore and live-extension workflows verify that a fresh GitHub-hosted browser can restore it. If the export came from a logged-out Duolingo page, the extension refuses to create the file; the hosted restore test is a second independent guard against accidentally committing an unauthenticated session.

The session file belongs to the disposable testing account and is deliberately committed to the repository for simplicity.

## Distribution

Signed Linux releases are produced with the `PAROLA_EXTENSION_PRIVATE_KEY` Actions secret. The extension checks the update manifest at:

`https://guymichaely.com/extension/updates.xml`

The signed CRX and update metadata are published under `https://guymichaely.com/extension/`. The signing key determines the permanent extension ID and must remain unchanged between releases.
