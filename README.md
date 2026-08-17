# Parola

Italian flashcard application with two independently deployable parts:

- `web/` — static React/Vite frontend, deployed to GitHub Pages.
- `api/` — optional Node card-storage API, deployed to Azure App Service.

The frontend uses browser `localStorage` by default and can instead use any HTTP endpoint implementing `web/docs/REMOTE_API.md`.

See `web/README.md` for frontend development/build instructions and `web/ARCHITECTURE.md` for the source architecture.
