# Architecture Overview

realtime-mongo is a WebSocket-based layer that bridges MongoDB Change Streams to subscribed clients. It provides Firestore-like `onSnapshot` semantics for any MongoDB Replica Set.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Application                        │
│                                                                  │
│  ┌──────────────────┐      ┌─────────────────────────────────┐  │
│  │ @realtimemongo/  │      │     @realtimemongo/react        │  │
│  │ client           │ ◄─── │  useDocument / useConnectionState│  │
│  │                  │      │  RealtimeMongoProvider          │  │
│  └────────┬─────────┘      └─────────────────────────────────┘  │
│           │ WebSocket (wss://)                                   │
└───────────┼─────────────────────────────────────────────────────┘
            │
┌───────────┼─────────────────────────────────────────────────────┐
│           │          @realtimemongo/server                       │
│  ┌────────▼──────────┐    ┌──────────────────────────────────┐  │
│  │ WebSocketTransport│    │        ConnectionManager         │  │
│  │ Server            │───►│  auth · rate-limit · sub-count   │  │
│  └────────┬──────────┘    └──────────────┬───────────────────┘  │
│           │                              │                       │
│  ┌────────▼──────────┐    ┌──────────────▼───────────────────┐  │
│  │ SubscriptionManager│   │       ChangeStreamManager        │  │
│  │ O(1) index        │◄──►│  fan-out on every change event   │  │
│  └───────────────────┘    └──────────────┬───────────────────┘  │
│                                          │                       │
│                           ┌──────────────▼───────────────────┐  │
│                           │       MongoChangeSource          │  │
│                           │  Change Streams · resume tokens  │  │
│                           └──────────────┬───────────────────┘  │
└──────────────────────────────────────────┼─────────────────────-┘
                                           │ mongodb driver
                                ┌──────────▼──────────┐
                                │  MongoDB Replica Set │
                                │  (Change Streams)    │
                                └─────────────────────-┘
```

## Core Components

### Server Side

#### `MongoChangeSource`

The entry point for MongoDB connectivity. Opens a database-level Change Stream per registered database and emits typed `ChangeEvent` objects to registered handlers. Responsibilities:

- Connecting to MongoDB and watching databases via Change Streams
- Maintaining **resume tokens** so streams restart from the correct position after a crash or restart
- **Exponential backoff with reset** — if a stream runs healthily for more than 60 seconds before failing, the backoff resets to 1 second instead of continuing from where it left off
- Filtering events to only registered `db.collection` pairs
- Fetching point-in-time document snapshots using causally consistent sessions

#### `SubscriptionManager` (server)

An in-memory index mapping `(db, coll, docId)` tuples to the set of connection IDs that have subscribed to them. Provides O(1) lookup in both directions — finding all subscribers for a document, and cleaning up all subscriptions for a disconnecting client.

#### `ConnectionManager` (server)

Handles the message lifecycle per connection: subscribe, unsubscribe, ping/pong, and auth forwarding. Sends initial snapshots on subscribe and routes server errors with the correct error codes.

#### `ChangeStreamManager`

Bridges `MongoChangeSource` events to `ConnectionManager.sendTo` calls. For each incoming change event, it looks up the subscriber set and fans out the message. The lifecycle of the underlying MongoDB connection is **not** owned by this manager — callers must close `MongoChangeSource` separately.

#### `WebSocketTransportServer`

The network boundary. Responsibilities:

- Origin validation (CSWSH prevention)
- Maximum connection enforcement
- Per-connection rate limiting via Token Bucket algorithm
- Transport-layer authentication — first-message auth pattern with configurable timeout
- Per-subscription authorization via `canSubscribe` hook
- Per-connection subscription count enforcement
- Heartbeat ping/pong with dead connection cleanup
- Backpressure detection via `bufferedAmount`

### Client Side

#### `RealtimeMongoClient`

The public API surface. Exposes `collection<T>()`, `db()`, `onConnectionStateChange()`, `onError()`, and `close()`. Internally wires the three client managers together.

#### `ConnectionManager` (client)

Manages the WebSocket lifecycle with **exponential backoff with full jitter** on reconnection. Emits typed `ConnectionState` transitions: `connecting → connected → reconnecting → connected`. On reconnect, signals `SubscriptionManager` to re-subscribe all active subscriptions.

#### `SubscriptionManager` (client)

Maintains the set of active subscriptions and their callbacks. Uses null-byte separated composite keys (`db\x00coll\x00docId`) for O(1) lookup. Supports multiple callbacks per subscription (multiple `onSnapshot` callers on the same document) and per-subscription error callbacks.

#### `VClockManager`

Applies **causal ordering** to incoming events. Each message carries a VClock (MongoDB `clusterTime` — a `{t, i}` Timestamp). The manager rejects stale or duplicate events and ensures each callback is only called when an event is genuinely newer than the last seen state.

---

## Data Flow

### Subscription Lifecycle

```
Client                        Server                       MongoDB
  │                             │                             │
  │── sub {db, coll, id} ──────►│                             │
  │                             │── findOne (causal session) ►│
  │                             │◄── {doc, clusterTime} ──────│
  │◄── snap {db,coll,id,vclock}─│                             │
  │   [callback fires]          │                             │
  │                             │◄── Change Stream event ─────│
  │◄── upd {db,coll,id,vclock}──│                             │
  │   [callback fires]          │                             │
  │── unsub {db, coll, id} ────►│                             │
  │                             │                             │
```

### VClock Ordering

MongoDB Change Streams and `findOne` both return a `clusterTime` (an `{t: seconds, i: increment}` Timestamp from the Replica Set oplog). The VClock manager uses this to enforce causal consistency:

- If `incoming.t > cached.t` → accept (newer second)
- If `incoming.t === cached.t && incoming.i > cached.i` → accept (same second, newer increment)
- Otherwise → reject (stale event, do not call callbacks)

This ensures that a snapshot fetched at subscription time is never overwritten by a stale change event that was buffered in the stream before the snapshot was taken.

---

## Protocol

See [protocol.md](./protocol.md) for the full WebSocket message specification.

## Security Model

See [security.md](./security.md) for authentication, authorization, and transport security.

## Architecture Decisions

The `docs/adr/` directory contains Architecture Decision Records explaining the rationale behind key design choices.
