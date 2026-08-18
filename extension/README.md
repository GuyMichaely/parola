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

When the committed session expires, run this from the repository root on a machine with Chrome/Chromium and Python 3:

```bash
bash scripts/refresh-duolingo-session-local.sh
```

The helper creates a temporary Python virtual environment and a disposable Chrome profile, opens Duolingo, waits up to ten minutes for an authenticated session, exports the Duolingo cookies/localStorage/sessionStorage needed by CI, commits the refreshed state, and pushes it. The temporary browser profile and Python environment are deleted when the script exits.

By default the login is manual. To try the known Autofill + password-paste automation first and fall back to manual login if Duolingo rejects it, use:

```bash
bash scripts/refresh-duolingo-session-local.sh --auto-login
```

Use `--no-push` to create the refresh commit without pushing it. Once the state-file commit reaches `main`, the hosted session-restore/live tests verify that the state still reaches authenticated Duolingo.

This refresh procedure does not require the local machine to be registered as a GitHub Actions runner and does not require Tailscale.

## Distribution

Signed Linux releases are produced with the `PAROLA_EXTENSION_PRIVATE_KEY` Actions secret. The extension checks the update manifest at:

`https://raw.githubusercontent.com/GuyMichaely/parola/main/web/public/extension/updates.xml`

The signed CRX and update metadata are committed under `web/public/extension/`. The signing key determines the permanent extension ID and must remain unchanged between releases.
