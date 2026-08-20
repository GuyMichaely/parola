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

`.github/workflows/release-extension.yml` statically validates and signs the extension, verifies its fixed extension ID, and publishes release assets through GitHub Releases.

`.github/workflows/deploy-pages.yml` builds and deploys the web app. During the current extension-feed migration it also publishes the temporary compatibility feed under `/parola/extension/`; that bridge can be removed once installed clients have updated to the GitHub Releases feed.

The optional API is deployed separately to Azure by `.github/workflows/deploy-api.yml`.

The frontend always has a local working inventory. Configuring an API endpoint adds timestamp-based synchronization with a remote copy so the same inventory can be kept in sync across machines.

## Project checkpoint

See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for the current architecture decisions, deployment-migration status, testing policy, roadmap, and immediate next steps.

See `web/README.md`, `web/ARCHITECTURE.md`, and `extension/README.md` for development details.
