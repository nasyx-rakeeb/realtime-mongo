# realtime-mongo

Firestore-like realtime document subscriptions for MongoDB. Subscribe to a document and receive live updates whenever it changes — powered by MongoDB Change Streams and WebSockets.

```ts
// Server — one call to start
const realtime = await createRealtimeMongo({
  mongoUri: process.env.MONGO_URI!,
  collections: ['mydb.tasks'],
  port: 8080,
});

// Client — Firestore-like API
const unsubscribe = client
  .collection<Task>('tasks')
  .doc(taskId)
  .onSnapshot((task) => {
    console.log('Task updated:', task);
  });
```

---

## Packages

| Package                                                | Description                                                                  | npm                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`@realtimemongo/server`](./packages/server/README.md) | Node.js server SDK — Change Streams, WebSocket server, auth                  | [![npm](https://img.shields.io/npm/v/@realtimemongo/server)](https://www.npmjs.com/package/@realtimemongo/server) |
| [`@realtimemongo/client`](./packages/client/README.md) | Browser / Node.js client SDK — works with any JS framework                   | [![npm](https://img.shields.io/npm/v/@realtimemongo/client)](https://www.npmjs.com/package/@realtimemongo/client) |
| [`@realtimemongo/react`](./packages/react/README.md)   | React hooks — `useDocument`, `useConnectionState`, `<RealtimeMongoProvider>` | [![npm](https://img.shields.io/npm/v/@realtimemongo/react)](https://www.npmjs.com/package/@realtimemongo/react)   |
| `@realtimemongo/shared`                                | Internal protocol types (not installed directly)                             | —                                                                                                                 |

---

## Requirements

- **MongoDB 6.0+** running as a **Replica Set** (required for Change Streams)
- **Node.js 22.0.0+** on the server
- **Any modern browser** on the client (Chrome 80+, Firefox 75+, Safari 14+, Edge 80+)

---

## Quick Start

### 1. Install

**Server:**

```bash
npm install @realtimemongo/server
```

**Client (React):**

```bash
npm install @realtimemongo/react @realtimemongo/client
```

**Client (Vue / Angular / plain JS):**

```bash
npm install @realtimemongo/client
```

### 2. Start the server

```ts
import { createRealtimeMongo } from '@realtimemongo/server';

const realtime = await createRealtimeMongo({
  mongoUri: process.env.MONGO_URI!, // Must be a Replica Set URI
  collections: ['mydb.tasks'], // Register each collection to watch
  port: 8080,
});

// Graceful shutdown
process.on('SIGTERM', () => realtime.stop());
```

### 3. Connect from React

```tsx
import { RealtimeMongoProvider, useDocument } from '@realtimemongo/react';

function App() {
  return (
    <RealtimeMongoProvider url="ws://localhost:8080" db="mydb">
      <TaskView taskId="64a1b2c3d4e5f6a7b8c9d0e1" />
    </RealtimeMongoProvider>
  );
}

interface Task {
  title: string;
  done: boolean;
}

function TaskView({ taskId }: { taskId: string }) {
  const { data, loading, error } = useDocument<Task>('tasks', taskId);

  if (loading) return <p>Loading…</p>;
  if (error) return <p>Error: {error.message}</p>;
  if (!data) return <p>Not found</p>;

  return (
    <h1>
      {data.title} — {data.done ? 'Done' : 'In progress'}
    </h1>
  );
}
```

### 4. Connect from plain JavaScript

```ts
import { RealtimeMongoClient } from '@realtimemongo/client';

const client = new RealtimeMongoClient({
  url: 'ws://localhost:8080',
  db: 'mydb',
});

const unsubscribe = client
  .collection<Task>('tasks')
  .doc(taskId)
  .onSnapshot(
    (task) => console.log('Updated:', task),
    (err) => console.error('Error:', err)
  );

// Stop listening
unsubscribe();

// Disconnect
client.close();
```

---

## Authentication

The server supports a first-message token authentication pattern:

```ts
// Server
const realtime = await createRealtimeMongo({
  mongoUri: process.env.MONGO_URI!,
  collections: ['mydb.tasks'],
  port: 8080,
  transport: {
    auth: {
      verify: async (token) => {
        const payload = verifyJWT(token, process.env.JWT_SECRET!);
        return payload.userId;
      },
      canSubscribe: async (userId, db, coll, docId) => {
        return await userOwnsDocument(userId, db, coll, docId);
      },
    },
    allowedOrigins: ['https://app.example.com'],
  },
});

// Client
const client = new RealtimeMongoClient({
  url: 'wss://api.example.com',
  db: 'mydb',
  token: await getAuthToken(),
});
```

---

## Documentation

| Document                               | Description                                   |
| -------------------------------------- | --------------------------------------------- |
| [Architecture](./docs/architecture.md) | System design, components, data flow          |
| [Protocol](./docs/protocol.md)         | WebSocket message specification               |
| [Security](./docs/security.md)         | Auth model, transport security, data exposure |
| [Roadmap](./docs/roadmap.md)           | Planned features for v0.2, v0.3, and v1.0     |
| [Contributing](./CONTRIBUTING.md)      | Development setup and PR process              |

---

## How It Works

1. The server connects to MongoDB and opens a Change Stream on each registered database.
2. When a client subscribes to `db.collection/docId`, the server fetches the current document and sends a `snap` message.
3. When MongoDB emits a change event, the server looks up all subscribers for that document and fans out an `upd` or `del` message.
4. The client applies causal ordering (VClock) to ensure stale or duplicate events are never delivered to callbacks.
5. On reconnect, the client automatically re-subscribes to all active subscriptions.

See [docs/architecture.md](./docs/architecture.md) for the full system diagram and component breakdown.

---

## License

MIT — see [LICENSE](./LICENSE).
