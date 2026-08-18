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

Live GitHub-hosted tests restore the disposable Duolingo account's authenticated browser state from `tests/fixtures/duolingo-session-state.b64`. This avoids performing a fresh Duolingo credential login on every CI run.

### Refreshing the Duolingo CI session

When the committed session expires, run this from a local checkout on a machine with Chrome/Chromium and Python 3:

```bash
bash scripts/refresh-duolingo-session-local.sh
```

The helper is intentionally self-contained: it creates a temporary Python virtual environment and a disposable Chrome profile, opens Duolingo, waits up to ten minutes for an authenticated session, exports only the Duolingo cookies/localStorage/sessionStorage needed by CI, commits the refreshed state, and pushes it. The temporary browser profile and Python environment are deleted when the script exits.

By default the login is manual, which is the most reliable refresh path. To try the known Autofill + password-paste automation first and fall back to manual login if Duolingo rejects it, use:

```bash
bash scripts/refresh-duolingo-session-local.sh --auto-login
```

Use `--no-push` to create the refresh commit without pushing it. Once the state-file commit reaches `main`, the `Test Duolingo session restore` workflow runs on a GitHub-hosted runner and verifies that the committed state still reaches authenticated `/learn`.

This refresh procedure does not require the local machine to be registered as a GitHub Actions runner and does not require Tailscale.

## Distribution

Signed Linux releases are produced with the `PAROLA_EXTENSION_PRIVATE_KEY` Actions secret. The extension checks the update manifest at:

`https://raw.githubusercontent.com/GuyMichaely/parola/main/web/public/extension/updates.xml`

The signed CRX and update metadata are committed under `web/public/extension/`. The signing key determines the permanent extension ID and must remain unchanged between releases.
