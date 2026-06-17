# @realtimemongo/client

Browser and Node.js client SDK for [realtime-mongo](https://github.com/nasyx-rakeeb/realtime-mongo). Connects to a `@realtimemongo/server` instance and provides real-time document subscriptions.

## Installation

```bash
npm install @realtimemongo/client
```

> **React users**: Use [`@realtimemongo/react`](../react) for hooks-based integration.

## Quick Start

```ts
import { RealtimeMongoClient } from '@realtimemongo/client';

const client = new RealtimeMongoClient({
  url: 'ws://localhost:8080',
  db: 'mydb',
});

const unsubscribe = client
  .collection('tasks')
  .doc('task_abc123')
  .onSnapshot((task) => {
    console.log('Task updated:', task);
    // task is null when the document is deleted
  });

// Stop listening:
unsubscribe();

// When completely done:
client.close();
```

## TypeScript Generics

```ts
interface Task {
  _id: string;
  title: string;
  done: boolean;
}

const unsubscribe = client
  .collection<Task>('tasks')
  .doc(taskId)
  .onSnapshot((task) => {
    // task is Task | null — fully typed
    console.log(task?.title);
  });
```

## Error Handling

```ts
// Per-subscription error handling
client
  .collection('tasks')
  .doc(taskId)
  .onSnapshot(
    (doc) => console.log(doc),
    (err) => console.error('Subscription error:', err.message)
  );

// Global error handler
client.onError((err) => {
  if ((err as any).code === 'AUTH_FAILED') {
    // Handle authentication failure
  }
});
```

## Connection State

```ts
// Watch connection state
const unsub = client.onConnectionStateChange((state) => {
  // state: 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
  console.log('Connection state:', state);
});

// Or read it synchronously
console.log(client.connectionState);
```

## Multi-Database

```ts
// Use the default db from constructor options
client.collection('tasks').doc(id).onSnapshot(cb);

// Or specify a different database
client.db('analytics').collection('events').doc(id).onSnapshot(cb);
```

## Node.js Usage

In Node.js, pass a WebSocket implementation:

```ts
import WebSocket from 'ws';
import { RealtimeMongoClient } from '@realtimemongo/client';

const client = new RealtimeMongoClient({
  url: 'ws://localhost:8080',
  db: 'mydb',
  WebSocketImpl: WebSocket,
});
```

## With Authentication

```ts
const client = new RealtimeMongoClient({
  url: 'ws://localhost:8080',
  db: 'mydb',
  token: await getAuthToken(), // sent to server after connecting
});
```

## Reconnection Configuration

```ts
const client = new RealtimeMongoClient({
  url: 'ws://localhost:8080',
  db: 'mydb',
  reconnect: {
    baseDelayMs: 1000, // first retry after 1s
    maxDelayMs: 30000, // max 30s between retries
    maxAttempts: Infinity, // retry forever
  },
});
```

## API Reference

### `new RealtimeMongoClient(options)`

| Option          | Type              | Default                | Description                        |
| --------------- | ----------------- | ---------------------- | ---------------------------------- |
| `url`           | `string`          | required               | WebSocket server URL               |
| `db`            | `string`          | `'default'`            | Default database name              |
| `token`         | `string`          | none                   | Auth token sent on connect         |
| `WebSocketImpl` | `any`             | `globalThis.WebSocket` | Custom WS implementation (Node.js) |
| `reconnect`     | `ReconnectConfig` | defaults               | Reconnect behaviour                |

### `client.collection<TDoc>(name)` → `CollectionReference<TDoc>`

### `client.db(name)` → `DatabaseReference`

### `.doc(id)` → `DocumentReference<TDoc>`

### `.onSnapshot(onNext, onError?)` → `Unsubscribe`

### `client.connectionState` → `ConnectionState`

### `client.onConnectionStateChange(cb)` → `Unsubscribe`

### `client.onError(cb)` → `Unsubscribe`

### `client.close()` → `void`

## License

MIT
