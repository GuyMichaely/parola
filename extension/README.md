# Parola Capture extension

Parola Capture is a Chrome extension for collecting Italian words while studying and staging them for review before they are added to Parola.

## Current capture workflow

- Click the extension icon and enter either one word (`gatto`) or a sentence with the target surrounded by asterisks (`Vorrei un *panino*, per favore.`).
- Or highlight text on any web page, right-click, and choose **Stage … in Parola**.
- Captures are deduplicated by normalized Italian text and kept in extension-local staging storage.
- Open **Review staged words** to edit the Italian form, English meaning, part of speech, and grammatical details, then approve and import cards into Parola.

The extension no longer inspects Duolingo's DOM, logs into Duolingo for CI, or tries to determine which words Duolingo considers new.

## Debugging manual tests

The extension records a bounded local event log covering staging, review changes, imports, and errors. Click **Export debug log** in the popup to download a JSON bundle containing:

- extension ID/version;
- current staged items;
- recent extension events and errors.

When a manual test behaves incorrectly, reproduce the problem once, export the debug log, and provide that JSON with a short description of what you expected and observed.

## Deterministic tests

```bash
cd extension
npm install
npm test
```

The deterministic suite loads the unpacked extension in Chrome and checks popup staging, starred-sentence parsing, the shared selection-staging path, review persistence, debug logging, and the Parola browser-storage bridge. It deliberately does not automate a live Duolingo lesson.

## Release

`.github/workflows/publish-extension.yml` runs the deterministic tests, packages the extension with the existing signing key, and publishes the CRX/update feed to `guymichaely.com/extension/`. Release versions increment from the last successfully published `version.json`, so failed publish attempts do not consume version numbers.
