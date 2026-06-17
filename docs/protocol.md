# WebSocket Protocol Specification

**Version:** 1  
**Transport:** WebSocket (RFC 6455)  
**Encoding:** JSON (UTF-8 text frames only — binary frames are rejected)

---

## Overview

The realtime-mongo protocol is a simple request/event protocol over a persistent WebSocket connection. The client sends commands; the server sends events and responses.

All messages share a common envelope:

```ts
{
  v: 1,           // Protocol version (integer)
  id: string,     // Unique message ID (client-generated for commands, server-generated for events)
  t: string,      // Message type discriminator
  p: object       // Type-specific payload
}
```

The `v` field is validated on every message. A version mismatch results in an `err` response with code `UNSUPPORTED_PROTOCOL_VERSION`.

---

## Message Types

### Client → Server

#### `sub` — Subscribe to a document

```json
{
  "v": 1,
  "id": "m1",
  "t": "sub",
  "p": {
    "db": "mydb",
    "coll": "tasks",
    "id": "64a1b2c3d4e5f6a7b8c9d0e1"
  }
}
```

The server responds immediately with a `snap` message containing the current document state, then sends `upd` or `del` messages on every subsequent change.

**Field constraints:**

- `db` — 1–128 characters, pattern `^[a-zA-Z0-9_.-]+$`
- `coll` — 1–128 characters, pattern `^[a-zA-Z0-9_.-]+$`
- `id` — 1–256 characters (MongoDB ObjectId hex string or custom string key)

---

#### `unsub` — Unsubscribe from a document

```json
{
  "v": 1,
  "id": "m2",
  "t": "unsub",
  "p": {
    "db": "mydb",
    "coll": "tasks",
    "id": "64a1b2c3d4e5f6a7b8c9d0e1"
  }
}
```

No response is sent. The server stops forwarding events for this document to this connection.

---

#### `auth` — Authenticate the connection

```json
{
  "v": 1,
  "id": "m0",
  "t": "auth",
  "p": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

When the server has `auth.verify` configured, this **must be the first message** sent after connecting. The server closes the connection with code `1008` if:

- No `auth` message is received within `auth.timeoutMs` (default: 5000ms)
- The first message is not an `auth` message
- `auth.verify` throws or rejects

No explicit success response is sent — the absence of an `err` message indicates success. Subsequent `sub` messages may be further checked via `auth.canSubscribe`.

---

#### `ping` — Heartbeat

```json
{
  "v": 1,
  "id": "m3",
  "t": "ping",
  "p": {}
}
```

The server responds with a `pong` echoing the same `id`. Used by clients to measure latency or verify liveness.

---

### Server → Client

#### `snap` — Initial document snapshot

Sent immediately after a successful `sub`. Contains the full current state of the document.

```json
{
  "v": 1,
  "id": "ev_1719216000000_1",
  "t": "snap",
  "vclock": { "t": 1719216000, "i": 1 },
  "p": {
    "db": "mydb",
    "coll": "tasks",
    "id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "doc": { "title": "Launch SDK", "done": false }
  }
}
```

`doc` is `null` if the document does not exist.

---

#### `upd` — Document updated

Sent when a subscribed document is inserted, updated, or replaced.

```json
{
  "v": 1,
  "id": "ev_1719216001000_2",
  "t": "upd",
  "vclock": { "t": 1719216001, "i": 1 },
  "p": {
    "db": "mydb",
    "coll": "tasks",
    "id": "64a1b2c3d4e5f6a7b8c9d0e1",
    "doc": { "title": "Launch SDK", "done": true }
  }
}
```

Always contains the full document (MongoDB `fullDocument: 'updateLookup'`).

---

#### `del` — Document deleted

```json
{
  "v": 1,
  "id": "ev_1719216002000_3",
  "t": "del",
  "vclock": { "t": 1719216002, "i": 1 },
  "p": {
    "db": "mydb",
    "coll": "tasks",
    "id": "64a1b2c3d4e5f6a7b8c9d0e1"
  }
}
```

---

#### `pong` — Heartbeat response

```json
{
  "v": 1,
  "id": "m3",
  "t": "pong",
  "p": {}
}
```

Echoes the `id` from the `ping` that triggered it.

---

#### `err` — Error

```json
{
  "v": 1,
  "id": "m1",
  "t": "err",
  "p": {
    "code": "COLLECTION_NOT_REGISTERED",
    "message": "Collection mydb.unknown is not registered"
  }
}
```

The `id` field echoes the request `id` that caused the error where applicable (e.g. a failed `sub`). For connection-level errors (auth timeout, rate limiting), a descriptive `id` string is used.

---

## Error Codes

| Code                           | Cause                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `INVALID_MESSAGE`              | Message failed schema validation                                                 |
| `UNSUPPORTED_PROTOCOL_VERSION` | `v` field is not `1`                                                             |
| `COLLECTION_NOT_REGISTERED`    | `db.coll` not registered on the server                                           |
| `DOCUMENT_NOT_FOUND`           | Document does not exist (currently unused; `snap` returns `null` doc instead)    |
| `AUTH_REQUIRED`                | Auth is configured but no valid auth has been provided                           |
| `AUTH_FAILED`                  | `auth.verify` rejected the token, or `auth.canSubscribe` denied the subscription |
| `RATE_LIMIT_EXCEEDED`          | Too many messages in the rate limit window                                       |
| `SUBSCRIPTION_LIMIT_EXCEEDED`  | Connection has reached `maxSubscriptionsPerConnection`                           |
| `CONNECTION_LIMIT_EXCEEDED`    | Server has reached `maxConnections`                                              |
| `SERVER_ERROR`                 | Unexpected internal server error                                                 |

---

## VClock

Every server-to-client event message includes a `vclock` field derived from the MongoDB `clusterTime`:

```ts
interface VClock {
  t: number; // Unix seconds (high bits of the BSON Timestamp)
  i: number; // Increment (low bits of the BSON Timestamp)
}
```

Clients use this to enforce causal ordering — events are accepted only if they are strictly newer than the last cached vclock for that `(db, coll, docId)` key. This prevents stale change events from overwriting a fresher snapshot.

---

## WebSocket Close Codes

| Code   | Meaning                                                                |
| ------ | ---------------------------------------------------------------------- |
| `1000` | Normal closure (server shutdown or `client.close()`)                   |
| `1001` | Server going away (graceful server stop)                               |
| `1008` | Policy violation — auth failure, max connections, max payload exceeded |

---

## Versioning

The protocol version is `1`. When breaking changes are introduced, the version number will be incremented and the server will support both versions during a transition period. Clients sending an unsupported version receive `UNSUPPORTED_PROTOCOL_VERSION` and should upgrade.
