# Parola

Parola is an Italian flashcard suite with three independently understandable parts:

- `web/` — static React/Vite frontend.
- `extension/` — Chrome extension for staging words and contexts before review/import.
- `api/` — optional Node synchronization API.

## Production

The public repository is the canonical source for both the web app and extension release.

- Web app: `https://guymichaely.com/parola/`
- Extension update feed: `https://github.com/GuyMichaely/parola/releases/latest/download/updates.xml`
- Signed extension CRX: `https://github.com/GuyMichaely/parola/releases/latest/download/parola.crx`

`.github/workflows/release-extension.yml` statically validates and signs the extension, verifies its fixed extension ID, and publishes release assets through GitHub Releases. The source cutover to that independent feed was completed in extension `0.2.3` and finalized with `0.2.4`. Current source/tag `0.2.5` repairs the Parola import boundary so the extension hands reviewed candidates to the web app instead of writing Parola storage itself.

`.github/workflows/deploy-pages.yml` builds and deploys the web app. It still publishes a temporary compatibility feed under `/parola/extension/` for clients installed before the GitHub Releases cutover. Keep that bridge until the installed extension is confirmed to have updated onto the independent feed; confirming `0.2.5` also verifies the current import build is installed.

The optional API is deployed separately to Azure by `.github/workflows/deploy-api.yml`.

The frontend always has a local working inventory. Configuring an API endpoint adds timestamp-based synchronization with a remote copy so the same inventory can be kept in sync across machines.

Approved extension candidates are canonicalized and persisted by the web app through the same current card/morphology and `CardStorage` path used by ordinary card creation. The extension does not maintain a second Parola persistence implementation.

## Project checkpoint

See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for the current architecture decisions, deployment status, testing policy, roadmap, and immediate next steps.

See `web/README.md`, `web/ARCHITECTURE.md`, and `extension/README.md` for development details.
