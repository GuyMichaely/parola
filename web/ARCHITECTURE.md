# Architecture

Parola consists of a static React frontend and an optional remote card API.

```text
GitHub Pages
    |
    v
Parola web (React + Vite)
    |
    +--> browser localStorage
    |
    +--> remote HTTP card API
```

## Web

The frontend is a static Vite application. React manages the interactive UI; Vite and TypeScript are build-time tools. The production output is ordinary HTML, CSS, and JavaScript in `dist/`.

The build uses relative asset URLs so the same output can be served from `/`, `/parola/`, or another static path.

The main source boundaries are:

```text
src/
├── App.tsx                         application/session orchestration
├── storage.ts                     card-storage contract and implementations
├── cardTypes.ts                   shared card-type metadata
└── components/
    ├── StorageSettingsModal.tsx    storage selection UI
    ├── StudyOptions.tsx            study options and answer-keyword settings
    ├── StudyScope.tsx              study-scope selection UI
    └── SaveIndicator.tsx           persistence status UI
```

`App.tsx` owns the application-level state and coordinates the study session, inventory, card editing, and the selected `CardStorage`. UI that can stand on a narrow prop contract belongs in a component module rather than in `App.tsx`.

## Storage

Card persistence is behind the `CardStorage` interface in `storage.ts`:

```text
CardStorage
├── BrowserStorage  -> localStorage
└── RemoteStorage   -> HTTP API
```

`createCardStorage("")` selects browser storage. A non-empty endpoint selects remote storage. The Browser/Remote setting controls whether the saved endpoint or an empty string is passed to that factory.

The browser persists cards, the optional remote endpoint, and the selected Browser/Remote storage mode as independent localStorage values.

Remote storage is accessed through the HTTP contract documented in `docs/REMOTE_API.md`. The frontend does not depend on a provider-specific SDK.

## Deployment

The static frontend is deployed with GitHub Pages. The API is deployed independently, so either side can be changed without coupling the frontend to a particular backend host.
