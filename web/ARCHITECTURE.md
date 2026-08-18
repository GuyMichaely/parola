# Architecture

Parola consists of a static React frontend, a Chrome capture extension, and an optional remote card API.

```text
GitHub Pages (GuyMichaely/parola)
    |
    +--> Parola web (React + Vite)
    |      |
    |      +--> browser localStorage
    |      |
    |      +--> remote HTTP card API
    |
    +--> signed Chrome extension release
           |
           +--> stages words/contexts
           +--> imports approved cards into Parola web
```

## Web

The frontend is a static Vite application. React manages the interactive UI; Vite and TypeScript are build-time tools. The production output is ordinary HTML, CSS, and JavaScript in `dist/`.

The build uses relative asset URLs so the same output can be served from `/`, `/parola/`, or another static path.

The main source boundaries are:

```text
src/
├── App.tsx                         application and study-session orchestration
├── cardTypes.ts                   shared card-type labels and ordering
├── cards/
│   ├── types.ts                   Flashcard/CardType domain model
│   └── editorModel.ts             card editor rows, validation, conversion, drafts
├── storage/
│   ├── types.ts                   CardStorage CRUD contract
│   ├── browser.ts                 localStorage implementation
│   ├── remote.ts                  HTTP implementation
│   ├── cardCodec.ts               storage-boundary normalization/parsing
│   ├── settings.ts                persisted Browser/Remote configuration
│   └── index.ts                   storage factory and public exports
├── study/
│   ├── order.ts                   study-item ordering/shuffling
│   ├── verification.ts            typed-answer parsing and verification
│   └── logic.ts                   study-module public exports
└── components/
    ├── AddCardModal.tsx            batch card creation
    ├── BulkEditCardsModal.tsx      focused multi-card editing
    ├── CardAnswer.tsx              prompt/answer/verification presentation
    ├── CardEditorFields.tsx        reusable editor table fields
    ├── CardEditors.tsx             editor-component public exports
    ├── EditCardModal.tsx           focused single-card editing
    ├── InventoryCardsEditor.tsx    editable inventory table
    ├── SaveIndicator.tsx           persistence status UI
    ├── StorageSettingsModal.tsx    storage selection UI
    ├── StudyOptions.tsx            study options and answer-keyword settings
    └── StudyScope.tsx              study-scope selection UI
```

`App.tsx` owns cross-cutting application state: the active study session, the current card collection, storage selection, and coordination between the study and inventory views. Domain transformations, persistence implementations, verification logic, and self-contained UI live outside the application shell.

## Extension

The Chrome extension is source-controlled under `extension/`. It stages user-selected Italian words and context, provides a review UI, and sends approved typed cards to the hosted Parola page through its content script.

The extension release version is explicit source state in `extension/manifest.json` and `extension/package.json`. The single Pages workflow tests the extension, signs it with the repository secret, verifies the expected extension ID, and places its release files under the Pages artifact's `extension/` directory.

## Storage

Card persistence is behind one CRUD contract:

```text
CardStorage
├── BrowserStorage  -> localStorage
└── RemoteStorage   -> HTTP API
```

The rest of the application calls `listCards`, `createCards`, `updateCard`, and `deleteCard` without depending on the backing store.

`createCardStorage("")` selects browser storage. A non-empty endpoint selects remote storage. The Browser/Remote setting controls whether the saved endpoint or an empty string is passed to that factory.

Cards, the optional remote endpoint, and the selected Browser/Remote mode are separate browser-persisted values. Switching storage locations does not copy cards between them.

Remote storage follows the provider-independent HTTP contract documented in `docs/REMOTE_API.md`.

## API

The API is an independent Node service. It implements the same card CRUD semantics over HTTP and persists its JSON data on the App Service filesystem. The web application has no Azure-specific SDK or API code.

## Deployment

`.github/workflows/deploy-pages.yml` builds the web app, tests/signs the extension, assembles both into one GitHub Pages artifact, and deploys that artifact directly from this repository. The API is deployed independently to Azure App Service by `.github/workflows/deploy-api.yml` using GitHub OIDC.
