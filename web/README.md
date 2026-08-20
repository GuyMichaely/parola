# Parola web

Parola is a static Italian flashcard web app.

## Architecture

The app is intentionally small and hosting-provider agnostic:

- React for the interactive UI.
- Vite only as a development/build tool.
- Plain CSS.
- No Next.js.
- No application server required for local-only use.
- Browser `localStorage` for optional persistent local inventory state.
- Optional user-supplied HTTP API for synchronization between machines.

A production build is just static files in `dist/`. The build uses relative asset URLs, so the same `dist/` can be served at `/`, `/parola/`, or another directory without rebuilding.

The canonical production deployment is `https://guymichaely.com/parola/`.

## Storage and sync

Parola always has a local working inventory. With no API endpoint configured, it is local-only.

Configure a sync API endpoint from **Storage & sync** to maintain a remote copy of the same timestamped inventory. Local and remote are not mutually exclusive storage modes.

When local and remote timestamps differ, the newer snapshot is authoritative. Local changes automatically push to remote while sync is configured. Settings control whether the local synchronized copy persists between browser sessions and whether startup mismatches sync automatically or wait for **Sync now**.

See `docs/REMOTE_API.md` for the sync endpoint contract.

## Noun morphology

Noun cards store a base, their actual declension rule, gender, number behavior, and article behavior. Declension rules generate noun forms and recognize typed forms. Syntax rules describe accepted answer structures. Inference sets control which declensions each shorthand syntax may infer.

See `../docs/NOUN_MORPHOLOGY_AND_SYNTAX.md` for the model and candidate-evaluation rules.

## Inventory transfer

**Storage & sync** can export/download the inventory, copy it to the clipboard, import a JSON file, or replace the inventory from pasted JSON.

The inventory JSON payload contains `cards` and `nounMorphology`; export-format/version/timestamp metadata is not added.

## Development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

The deployable site will be in `dist/`. Local Node tooling is not required when builds are performed by GitHub Actions.
