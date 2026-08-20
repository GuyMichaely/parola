# Parola synchronization API

Parola can synchronize its inventory through any HTTP service that implements the snapshot contract below. The service may be hosted anywhere and may use any persistence mechanism.

If the user configures a base endpoint such as:

```text
https://api.example.com
```

Parola uses:

```text
https://api.example.com/state
```

## Inventory snapshot

A synchronization snapshot contains the complete inventory plus its last-change timestamp:

```json
{
  "cards": [
    {
      "id": 123,
      "type": "noun",
      "english": "umbrella",
      "italian": "ombrello",
      "setName": null,
      "tags": [],
      "details": {
        "patternId": "masculine-o-i",
        "singular": "ombrello"
      }
    }
  ],
  "nounPatterns": [
    {
      "id": "masculine-o-i",
      "name": "Masculine -o → -i",
      "gender": "masculine",
      "singularSuffix": "o",
      "pluralSuffix": "i",
      "syntax": "article-singular"
    }
  ],
  "updatedAt": "2026-08-20T03:00:00.000Z"
}
```

`updatedAt` must be a valid timestamp. Parola uses it for snapshot-level last-write-wins synchronization; it does not merge individual cards.

## Read state

```text
GET /state
```

Return the current complete snapshot as JSON.

## Write state

```text
PUT /state
Content-Type: application/json
```

The request body is the complete snapshot.

If the incoming `updatedAt` is newer than the current server state, persist and return it.

If the server state is newer, return HTTP `409` with the current server snapshot:

```json
{
  "error": "Remote inventory is newer.",
  "state": {
    "cards": [ ... ],
    "nounPatterns": [ ... ],
    "updatedAt": "2026-08-20T03:05:00.000Z"
  }
}
```

If timestamps are equal but the snapshots differ, also return `409` rather than arbitrarily overwriting one copy.

## Errors

Use a non-2xx HTTP status. If the JSON response contains an `error` string, Parola can surface that detail.

## CORS

Because Parola is a static browser application, a synchronization service on another origin must permit requests from the origin hosting Parola.

At minimum it needs to support `GET`, `PUT`, and `OPTIONS`, plus the `Content-Type: application/json` request header.

## Authentication

Parola does not prescribe an authentication mechanism. Avoid embedding permanent secret API keys in the static frontend because anyone who can load the site can inspect them.
