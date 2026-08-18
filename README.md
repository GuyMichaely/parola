# Parola

Parola is an Italian flashcard suite with three independently understandable parts:

- `web/` — static React/Vite frontend.
- `extension/` — Chrome extension for staging words and contexts before review/import.
- `api/` — optional Node card-storage API.

## Production

The public repository is the canonical source for both the web app and extension release.

- Web app: `https://guymichaely.com/parola/`
- Extension update feed: `https://guymichaely.com/parola/extension/updates.xml`
- Signed extension CRX: `https://guymichaely.com/parola/extension/parola.crx`

`.github/workflows/deploy-pages.yml` builds the web app, tests and signs the extension, assembles both into one GitHub Pages artifact, and deploys that artifact from this repository.

The optional API is deployed separately to Azure by `.github/workflows/deploy-api.yml`.

The frontend uses browser `localStorage` by default and can instead use any HTTP endpoint implementing `web/docs/REMOTE_API.md`.

See `web/README.md`, `web/ARCHITECTURE.md`, and `extension/README.md` for development details.
