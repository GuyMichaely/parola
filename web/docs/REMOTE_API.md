# Parola remote storage API

Parola can use any HTTP endpoint that implements this CRUD contract. The endpoint may be hosted anywhere and may use any database.

Assume the configured endpoint is:

```
https://api.example.com/cards
```

## Card shape

```json
{
  "id": 123,
  "type": "noun",
  "english": "umbrella",
  "italian": "ombrello",
  "setName": null,
  "tags": [],
  "details": {
    "gender": "masculine"
  }
}
```

`type` is one of `noun`, `verb`, `adjective`, or `adverb`.

## List cards

```
GET https://api.example.com/cards
```

Return either:

```json
{ "cards": [ ... ] }
```

or the cards array directly.

## Create cards

```
POST https://api.example.com/cards
Content-Type: application/json
```

Request:

```json
{ "cards": [ ... ] }
```

The API owns persisted IDs. It should return the newly saved cards, including their final IDs, as either:

```json
{ "cards": [ ... ] }
```

or the cards array directly.

## Update a card

```
PUT https://api.example.com/cards
Content-Type: application/json
```

Request body: one complete card object.

Return either:

```json
{ "card": { ... } }
```

or the saved card object directly.

## Delete a card

```
DELETE https://api.example.com/cards?id=123
```

Any 2xx response is accepted. A response body is optional.

## Errors

Use a non-2xx HTTP status. If the JSON response contains an `error` string, Parola displays that message:

```json
{ "error": "Database unavailable" }
```

## CORS

Because Parola is a static browser application, a remote API on another origin must permit requests from the origin hosting Parola.

At minimum it needs to support the methods used above (`GET`, `POST`, `PUT`, `DELETE`) and the `Content-Type: application/json` request header.

## Authentication

Parola deliberately does not prescribe an authentication mechanism. If the API requires authentication, put the authentication layer in front of the endpoint in a way the browser can use. Avoid embedding permanent secret API keys in the static Parola source because anyone who can load the site can inspect them.
