# Architecture checkpoint

## Current direction

Parola is a static client application.

```
static host
    |
    v
Parola (React)
    |
    +--> browser localStorage (default)
    |
    +--> optional remote HTTP card API
```

## Deliberately removed

- Next.js runtime and routing
- Next.js API routes
- Node server deployment
- SQLite runtime dependency
- Docker requirement for the frontend
- Google Cloud-specific application code
- Azure-specific application code

## Deliberately retained

React is retained for now because the existing application is a large interactive component and removing React would be a separate rewrite with little effect on hosting complexity. React is now only a browser UI library; it no longer dictates deployment architecture.

## Portability

The compiled output is ordinary HTML/CSS/JavaScript. Remote storage is behind a small HTTP contract rather than a provider-specific SDK.
