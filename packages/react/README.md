# @realtimemongo/react

React hooks for [realtime-mongo](https://github.com/nasyx-rakeeb/realtime-mongo) — subscribe to MongoDB documents in real-time with a Firestore-like API.

> **Part of the realtime-mongo ecosystem.** See the [root documentation](https://github.com/nasyx-rakeeb/realtime-mongo) for architecture, protocol specification, security model, and server setup.

---

## Installation

```bash
npm install @realtimemongo/react @realtimemongo/client
```

**Peer dependency:** React 17.0.0 or later.

---

## Quick Start

### 1. Wrap your app

```tsx
import { RealtimeMongoProvider } from '@realtimemongo/react';

function App() {
  return (
    <RealtimeMongoProvider url="ws://localhost:8080" db="mydb">
      <Dashboard />
    </RealtimeMongoProvider>
  );
}
```

### 2. Subscribe to a document

```tsx
import { useDocument } from '@realtimemongo/react';

interface Task {
  _id: string;
  title: string;
  done: boolean;
}

function TaskView({ taskId }: { taskId: string }) {
  const { data, loading, error } = useDocument<Task>('tasks', taskId);

  if (loading) return <p>Loading…</p>;
  if (error) return <p>Error: {error.message}</p>;
  if (!data) return <p>Task not found</p>;

  return (
    <div>
      <h1>{data.title}</h1>
      <span>{data.done ? '✅ Done' : '⏳ In progress'}</span>
    </div>
  );
}
```

The component re-renders automatically whenever the document changes in MongoDB.

---

## API

### `<RealtimeMongoProvider>`

Creates a shared `RealtimeMongoClient` and makes it available to the entire component tree. All hooks in this package must be used inside a provider.

```tsx
<RealtimeMongoProvider
  url="ws://localhost:8080" // required — WebSocket server URL
  db="mydb" // default database name (default: 'default')
  token={authToken} // optional — sent as first auth message
  reconnect={{
    baseDelayMs: 1000, // initial reconnect delay
    maxDelayMs: 30000, // maximum reconnect delay
    maxAttempts: Infinity, // stop retrying after N failures
  }}
>
  {children}
</RealtimeMongoProvider>
```

The client instance is created once on mount and closed on unmount.

---

### `useDocument<TDoc>(collection, docId)`

Subscribes to a single document in the default database.

```tsx
const { data, loading, error } = useDocument<Task>('tasks', taskId);
```

| Return value | Type            | Description                                                     |
| ------------ | --------------- | --------------------------------------------------------------- |
| `data`       | `TDoc \| null`  | Current document data. `null` if not found or deleted.          |
| `loading`    | `boolean`       | `true` until the first snapshot is received.                    |
| `error`      | `Error \| null` | Set when a subscription-level error occurs (e.g. auth failure). |

The subscription is automatically cleaned up when the component unmounts, or when `collection` or `docId` changes.

---

### `useDocumentFromDb<TDoc>(db, collection, docId)`

Like `useDocument`, but targets a specific database. Use this in multi-database setups.

```tsx
const { data } = useDocumentFromDb<Metric>('analytics', 'metrics', metricId);
```

---

### `useConnectionState()`

Returns the current WebSocket connection state of the shared client. Re-renders the component on every state transition.

```tsx
import { useConnectionState } from '@realtimemongo/react';

function ConnectionIndicator() {
  const state = useConnectionState();
  // 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
  return <div className={`indicator indicator--${state}`} />;
}
```

---

### `useRealtimeMongoClient()`

Returns the raw `RealtimeMongoClient` instance. Use this for advanced patterns not covered by the other hooks.

```tsx
import { useRealtimeMongoClient } from '@realtimemongo/react';
import { useEffect } from 'react';

function AdvancedComponent({ eventId }: { eventId: string }) {
  const client = useRealtimeMongoClient();

  useEffect(() => {
    return client
      .db('analytics')
      .collection('events')
      .doc(eventId)
      .onSnapshot(
        (doc) => console.log(doc),
        (err) => console.error(err)
      );
  }, [client, eventId]);
}
```

---

## Authentication

```tsx
import { useState, useEffect } from 'react';
import { RealtimeMongoProvider } from '@realtimemongo/react';

function AuthenticatedApp() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    getAuthToken().then(setToken);
  }, []);

  if (!token) return <LoginPage />;

  return (
    <RealtimeMongoProvider url="wss://api.example.com" db="mydb" token={token}>
      <Dashboard />
    </RealtimeMongoProvider>
  );
}
```

The token is sent to the server as an `auth` message immediately after the WebSocket connection opens. See the [security documentation](https://github.com/nasyx-rakeeb/realtime-mongo/blob/main/docs/security.md) for the full auth model.

---

## Requirements

- React 17.0.0+
- `@realtimemongo/client` (installed as a peer dependency alongside this package)
- A running `@realtimemongo/server` instance

---

## Further Reading

- [Root documentation](https://github.com/nasyx-rakeeb/realtime-mongo) — overview, server setup, architecture
- [Architecture](https://github.com/nasyx-rakeeb/realtime-mongo/blob/main/docs/architecture.md) — how the system works
- [Security model](https://github.com/nasyx-rakeeb/realtime-mongo/blob/main/docs/security.md) — auth, authorization, data exposure
- [Roadmap](https://github.com/nasyx-rakeeb/realtime-mongo/blob/main/docs/roadmap.md) — planned Vue, Svelte, and Angular packages

---

## License

MIT
