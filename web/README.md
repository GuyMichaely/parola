# Parola

Parola is a static Italian flashcard web app.

## Architecture

The app is intentionally small and hosting-provider agnostic:

- React for the interactive UI.
- Vite only as a development/build tool.
- Plain CSS.
- No Next.js.
- No application server.
- No server-side database dependency.
- Browser `localStorage` by default.
- Optional user-supplied HTTP API for remote card storage.

A production build is just static files in `dist/`. They can be hosted on GitHub Pages, Cloudflare Pages, an object-storage website, nginx, Apache, or essentially any other static host.

The build uses relative asset URLs, so the same `dist/` can be served at `/`, `/parola/`, or another directory without rebuilding.

## Storage

Click the **Browser** / **Remote** storage control in the app header.

### Browser storage

Leave the API endpoint blank. Cards are saved in this browser under the `parola:cards` localStorage key.


### Remote storage

Enter the complete URL of an API endpoint, for example:

```
https://api.example.com/cards
```

The browser talks directly to that endpoint. See `docs/REMOTE_API.md` for the small protocol it must implement.

Switching storage locations does **not** copy cards from one location to another.

## Development

If developing locally with Node installed:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

The deployable site will be in `dist/`.

Local Node tooling is not required when builds are performed by GitHub Actions.
