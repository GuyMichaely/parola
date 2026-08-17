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

## Storage

Browser card storage is the default. The browser persists cards, the optional remote endpoint, and the selected Browser/Remote storage mode as independent localStorage values.

Remote storage is accessed through the HTTP contract documented in `docs/REMOTE_API.md`. The frontend does not depend on a provider-specific SDK.

## Deployment

The static frontend is deployed with GitHub Pages. The API is deployed independently, so either side can be changed without coupling the frontend to a particular backend host.
