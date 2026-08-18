# Parola

Parola is an Italian flashcard suite with three independently understandable parts:

- `web/` — static React/Vite frontend.
- `extension/` — Chrome extension for staging words and contexts before review/import.
- `api/` — optional Node card-storage API.

## Production

The public repository is the canonical source for both the web app and extension release.

- Web app: `https://guymichaely.com/parola/`
- Extension update feed: `https://github.com/GuyMichaely/parola/releases/latest/download/updates.xml`
- Signed extension CRX: `https://github.com/GuyMichaely/parola/releases/latest/download/parola.crx`

`.github/workflows/release-extension.yml` statically validates and signs the extension, verifies its fixed extension ID, and publishes release assets through GitHub Releases.

`.github/workflows/deploy-pages.yml` builds and deploys the web app. During the current extension-feed migration it also publishes the temporary compatibility feed under `/parola/extension/`; that bridge can be removed once installed clients have updated to the GitHub Releases feed.

The optional API is deployed separately to Azure by `.github/workflows/deploy-api.yml`.

The frontend uses browser `localStorage` by default and can instead use any HTTP endpoint implementing `web/docs/REMOTE_API.md`.

See `web/README.md`, `web/ARCHITECTURE.md`, and `extension/README.md` for development details.
