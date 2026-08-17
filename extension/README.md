# Parola for Duolingo

Chrome Manifest V3 extension for staging words that Duolingo explicitly marks as new.

Current behavior:

- Watches Duolingo lesson DOM changes for a visible `NEW WORD` marker.
- Looks for purple-highlighted single-word candidates in the same exercise region.
- Stages each detected word once while retaining repeated occurrences as counts/context.
- Logs every positive detector result with the relevant DOM and detection evidence.
- Provides a manual missed-word snapshot action that captures the current Duolingo document for false-negative debugging.
- Provides a review page to approve/discard staged words and export/clear diagnostics.

The Parola import bridge is a separate next step; the current extension establishes capture, staging, diagnostics, and browser-test infrastructure.

## Testing

`npm test` runs the deterministic extension suite. Puppeteer launches Chrome with the unpacked extension and verifies the popup plus a screenshot-derived `NEW WORD` fixture.

The `Capture live Duolingo` GitHub Actions workflow is the real-site integration suite. It starts Chrome for Testing with the unpacked extension, waits for Chrome's CDP endpoint, attaches nodriver, verifies the Parola review UI, and attempts the configured disposable Duolingo login. HTML, screenshots, Chrome logs, extension targets, and a machine-readable summary are retained as workflow artifacts even when the live test fails.

Live-account credentials are supplied only through the `DUOLINGO_TEST_EMAIL` and `DUOLINGO_TEST_PASSWORD` Actions secrets.

## Distribution

Signed Linux releases are produced with the `PAROLA_EXTENSION_PRIVATE_KEY` Actions secret. The extension checks the update manifest at:

`https://raw.githubusercontent.com/GuyMichaely/parola/main/web/public/extension/updates.xml`

The signed CRX and update metadata are committed under `web/public/extension/`. The signing key determines the permanent extension ID and must remain unchanged between releases.
