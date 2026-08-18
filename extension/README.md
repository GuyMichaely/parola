# Parola Capture extension

Parola Capture is a Chrome extension for collecting Italian words while studying and staging them for review before they are added to Parola.

## Current capture workflow

- Click the extension icon and enter either one word (`gatto`) or a sentence with the target surrounded by asterisks (`Vorrei un *panino*, per favore.`).
- Or highlight text on any web page, right-click, and choose **Stage … in Parola**.
- Captures are deduplicated by normalized Italian text and kept in extension-local staging storage.
- Open **Review staged words** to edit the Italian form, English meaning, part of speech, and grammatical details, then approve and import cards into Parola.

The extension does not inspect Duolingo's DOM or automate a Duolingo session.

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

The deterministic suite loads the unpacked extension in Chrome and checks popup staging, starred-sentence parsing, the shared selection-staging path, review persistence, debug logging, and the Parola browser-storage bridge.

## Release

The extension release is part of the repository's single GitHub Pages deployment. `.github/workflows/deploy-pages.yml` runs the deterministic tests, packages the extension with the existing signing key, verifies the expected extension ID, and publishes alongside the web app.

Canonical release locations:

- update feed: `https://guymichaely.com/parola/extension/updates.xml`
- CRX: `https://guymichaely.com/parola/extension/parola.crx`
- release metadata: `https://guymichaely.com/parola/extension/version.json`

The release version is source-controlled in both `manifest.json` and `package.json`; they must match. Bump them together when extension behavior changes. CI packages the exact source version rather than synthesizing a version from workflow state.
