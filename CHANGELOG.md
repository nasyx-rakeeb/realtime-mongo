# Changelog

All notable changes to realtime-mongo packages are documented here.

This project adheres to [Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions. Releases are managed with [Changesets](https://github.com/changesets/changesets).

---

## [0.1.0] — 2026-06-17

### Initial release

**`@realtimemongo/shared`**

- WebSocket protocol v1 with versioned message envelope
- Zod schemas for all client→server and server→client message types
- VClock implementation based on MongoDB `clusterTime` (BSON Timestamp)
- `parseClientMessage` and `parseServerMessage` with version pre-checks
- Typed error codes: `AUTH_REQUIRED`, `AUTH_FAILED`, `COLLECTION_NOT_REGISTERED`, `RATE_LIMIT_EXCEEDED`, `SUBSCRIPTION_LIMIT_EXCEEDED`, `CONNECTION_LIMIT_EXCEEDED`, `SERVER_ERROR`, `INVALID_MESSAGE`, `UNSUPPORTED_PROTOCOL_VERSION`

**`@realtimemongo/server`**

- `createRealtimeMongo()` factory — single-call server setup
- `MongoChangeSource` — database-level Change Streams with resume tokens and exponential backoff (resets after 60 s healthy uptime)
- `WebSocketTransportServer` — origin validation, max connections, per-connection rate limiting (Token Bucket), transport-layer authentication, per-subscription authorization, subscription count limits, heartbeat, backpressure detection
- `SubscriptionManager` — O(1) composite key indexing for `(db, coll, docId)` tuples
- `ConnectionManager` — correct error codes for client-caused vs server-caused failures
- Connection IDs generated with `crypto.randomUUID()`

**`@realtimemongo/client`**

- `RealtimeMongoClient` with `collection<T>()`, `db()`, `onConnectionStateChange()`, `onError()`, `close()`
- `DocumentReference<T>.onSnapshot(onNext, onError?)` — typed callbacks, per-subscription error handling
- `DatabaseReference` for multi-database access
- Exponential backoff with full jitter and configurable `maxAttempts`
- Monotonic message IDs (`m1`, `m2`, …) — never reuses `docId` as a request correlator
- Deterministic snapshot routing using `db + coll + id` from `snap` payload
- Causal ordering via VClock — stale events are silently dropped

**`@realtimemongo/react`**

- `<RealtimeMongoProvider>` — shared client context, created once via ref
- `useDocument<T>(collection, docId)` — `{ data, loading, error }` with generic typing
- `useDocumentFromDb<T>(db, collection, docId)` — multi-database variant
- `useConnectionState()` — live `ConnectionState` string
- `useRealtimeMongoClient()` — raw client access

---

[0.1.0]: https://github.com/nasyx-rakeeb/realtime-mongo/releases/tag/v0.1.0
