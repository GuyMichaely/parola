# Parola for Duolingo

Chrome Manifest V3 extension for staging words that Duolingo explicitly marks as new.

Current behavior:

- Watches Duolingo lesson DOM changes for a visible `NEW WORD` marker.
- Looks for purple-highlighted single-word candidates in the same exercise region.
- Stages each detected word once while retaining repeated occurrences as counts/context.
- Logs every positive detector result with the relevant DOM and detection evidence.
- Provides a manual missed-word snapshot action that captures the current Duolingo document for false-negative debugging.
- Provides a review page to approve/discard staged words and export/clear diagnostics.

The Parola import bridge is intentionally a separate next step; this first slice establishes reliable capture, staging, diagnostics, and browser test infrastructure.

## Development testing

`npm test` launches Chrome with the unpacked extension using Puppeteer and checks both the extension popup and a screenshot-derived `NEW WORD` fixture.

## Distribution

`manifest.json` points at a self-hosted Linux update manifest under `https://guymichaely.com/parola/extension/updates.xml`. A signed CRX release workflow will publish there once the repository has a `PAROLA_EXTENSION_PRIVATE_KEY` Actions secret.
