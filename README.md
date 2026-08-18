# Parola

Italian flashcard suite with three independently useful parts:

- `web/` — static React/Vite flashcard frontend, deployed to GitHub Pages.
- `api/` — optional Node card-storage API, deployed to Azure App Service.
- `extension/` — Chrome capture extension for staging Italian words/contexts, reviewing card details, and importing approved cards into Parola.

The web app uses browser `localStorage` by default and can instead use any HTTP endpoint implementing `web/docs/REMOTE_API.md`.

The extension is deliberately user-driven: capture a word from its popup, capture a word in sentence context with `*target*` markup, or stage highlighted text from the browser context menu. It keeps an exportable local debug event log for diagnosing manual tests.

See `web/README.md` and `web/ARCHITECTURE.md` for the frontend, and `extension/README.md` for extension development and testing.
