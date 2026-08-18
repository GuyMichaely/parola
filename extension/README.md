# Parola Capture extension

Parola Capture is a Chrome extension for collecting Italian words and contexts, staging them for review, and importing approved cards into Parola.

## Capture workflow

- Click the extension icon and enter either one word (`gatto`) or a sentence with the target surrounded by asterisks (`Vorrei un *panino*, per favore.`).
- Or highlight text on any web page, right-click, and choose **Stage … in Parola**.
- Captures are deduplicated by normalized Italian text. Distinct contexts and capture sources are retained on the staged item.
- Open **Review staged words** to edit the Italian form, English meaning, part of speech, and grammatical details, then approve and import cards into Parola.

## Staging model

A staged item contains the editable card candidate plus capture context:

- `word` and `normalizedWord`
- `english`
- `cardType`
- `details`
- `status`
- `createdAt` and `updatedAt`
- `contexts`
- `sources`
- `sourceUrl`

Staging is intentionally user-driven and global to the extension.

## Manual testing and debugging

Extension behavior is tested manually with the signed extension. The extension records a bounded local debug-event log covering capture, review changes, imports, and errors. Click **Export debug log** in the popup to download a JSON bundle containing:

- extension ID/version;
- current staged items;
- recent debug events.

When a manual test behaves incorrectly, reproduce the problem once, export the debug log, and provide that JSON with a short description of what you expected and observed.

CI performs lightweight static validation of the JavaScript source and manifest. It does not launch the extension or run browser automation.

## Release

Extension releases are independent from the Parola web deployment. `.github/workflows/release-extension.yml` statically validates the extension source, packages it with the existing signing key, verifies the expected extension ID, and publishes signed release assets through GitHub Releases.

Canonical release locations:

- update feed: `https://github.com/GuyMichaely/parola/releases/latest/download/updates.xml`
- CRX: `https://github.com/GuyMichaely/parola/releases/latest/download/parola.crx`
- release metadata: `https://github.com/GuyMichaely/parola/releases/latest/download/version.json`

The release version is source-controlled in `manifest.json`. CI packages that exact version rather than synthesizing a version from workflow state.
