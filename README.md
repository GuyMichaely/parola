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

`.github/workflows/release-extension.yml` statically validates and signs the extension, verifies its fixed extension ID, and publishes release assets through GitHub Releases. The source cutover to that independent feed was completed in extension `0.2.3` and finalized with `0.2.4`.

`.github/workflows/deploy-pages.yml` builds and deploys the web app. It still publishes a temporary compatibility feed under `/parola/extension/` for clients installed before the GitHub Releases cutover. That bridge should be removed only after the installed legacy client is confirmed to have updated to `0.2.4` or later.

The optional API is deployed separately to Azure by `.github/workflows/deploy-api.yml`.

The frontend always has a local working inventory. Configuring an API endpoint adds timestamp-based synchronization with a remote copy so the same inventory can be kept in sync across machines.

## Project checkpoint

See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for the current architecture decisions, deployment status, testing policy, roadmap, and immediate next steps.

See `web/README.md`, `web/ARCHITECTURE.md`, and `extension/README.md` for development details.
