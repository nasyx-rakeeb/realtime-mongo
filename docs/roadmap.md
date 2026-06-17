# Roadmap

This document lists features and improvements planned for future releases. Items here are **not** in the current release (`v0.1.x`) but are actively planned.

For the current feature set, see the [root README](../README.md).

---

## v0.2 — Expanded Functionality

### Collection-Level Subscriptions

Subscribe to all documents in a collection and receive events when any document is created, updated, or deleted.

```ts
// Planned API
client.collection<Task>('tasks').onSnapshot((tasks) => {
  // tasks: Task[] — the full current set of documents
});
```

This is the single most requested missing feature relative to Firestore parity.

### Field Projection on `registerCollection`

Control which fields are sent to subscribers, preventing accidental exposure of sensitive data.

```ts
// Planned API
mongoSource.registerCollection('mydb', 'users', {
  projection: { passwordHash: 0, internalScore: 0 },
});
```

### Mongoose Model Registration

Allow registering a Mongoose model directly instead of specifying the database and collection name manually.

```ts
// Planned API
import { User } from './models/User';
mongoSource.registerModel(User);
```

### Non-ObjectId Primary Key Support

An `idType` option to explicitly specify the key type, removing the current heuristic that uses `ObjectId.isValid()`.

```ts
// Planned API
mongoSource.registerCollection('mydb', 'sessions', {
  idType: 'string',
});
```

### Vue Composables Package (`@realtimemongo/vue`)

First-class Vue 3 composables: `useDocument()`, `useConnectionState()`, `provideRealtimeMongoClient()`.

### Auth Token Rotation

Support refreshing tokens on a live connection without disconnecting — relevant for short-lived JWTs.

---

## v0.3 — Framework Expansion

### Svelte Stores Package (`@realtimemongo/svelte`)

Svelte-native reactive stores for document subscriptions.

### Angular Service Package (`@realtimemongo/angular`)

An injectable Angular service and RxJS Observable-based document subscription API.

---

## v1.0 — Query Subscriptions & Scale

### Query Subscriptions

Subscribe to a filtered set of documents using MongoDB query operators.

```ts
// Planned API
client
  .collection<Task>('tasks')
  .where('assigneeId', '==', userId)
  .where('done', '==', false)
  .onSnapshot((tasks) => { ... });
```

This requires server-side re-evaluation of filter conditions on each change event — the most complex feature on the roadmap.

### Batched Fan-out

For documents with thousands of subscribers, the current synchronous fan-out loop blocks the Node.js event loop. A `setImmediate`-based batching strategy will be added to yield between sends.

### Horizontal Scaling (Redis Adapter)

The `IChangeSource` interface is designed to be replaceable. A `RedisChangeSource` adapter that distributes events via Redis Pub/Sub will be provided, enabling multiple server processes to share subscription state.

### Session Pooling for Snapshots

Replace per-request `ClientSession` objects in `fetchSnapshot` with a pooling strategy to reduce overhead under concurrent subscription load.

---

## Contributing to the Roadmap

Have a feature request? [Open an issue](https://github.com/nasyx-rakeeb/realtime-mongo/issues/new?template=feature_request.yml) with your use case. Features with the most community interest are prioritised.
