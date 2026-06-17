# @realtimemongo/server

Server-side SDK for [realtime-mongo](https://github.com/nasyx-rakeeb/realtime-mongo). Connects to MongoDB, watches Change Streams, and pushes document updates to subscribed clients via WebSocket.

## Installation

```bash
npm install @realtimemongo/server
```

## Quick Start (Recommended: Factory)

```ts
import { createRealtimeMongo } from '@realtimemongo/server';

const realtime = await createRealtimeMongo({
  mongoUri: process.env.MONGO_URI!, // Must be a Replica Set URI
  collections: ['mydb.tasks', 'mydb.users'],
  port: 8080,
});

// Graceful shutdown
process.on('SIGTERM', () => realtime.stop());
```

That's it. The factory handles all wiring automatically.

## With Authentication

```ts
import jwt from 'jsonwebtoken';
import { createRealtimeMongo } from '@realtimemongo/server';

const realtime = await createRealtimeMongo({
  mongoUri: process.env.MONGO_URI!,
  collections: ['mydb.tasks'],
  port: 8080,
  transport: {
    allowedOrigins: ['https://myapp.com'],
    maxConnections: 1000,
    maxSubscriptionsPerConnection: 100,
    auth: {
      // Verify the JWT token sent by the client
      verify: async (token) => {
        const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
        return payload.userId; // returned value is the "principal"
      },
      // Authorize each subscription (optional)
      canSubscribe: async (userId, db, coll, docId) => {
        return await userOwnsDocument(userId, db, coll, docId);
      },
    },
  },
});
```

## Manual Setup (Advanced)

If you need more control:

```ts
import {
  MongoChangeSource,
  SubscriptionManager,
  ConnectionManager,
  ChangeStreamManager,
  WebSocketTransportServer,
} from '@realtimemongo/server';

const mongoSource = new MongoChangeSource(process.env.MONGO_URI!);
await mongoSource.connect();
mongoSource.registerCollection('mydb', 'tasks');

const subManager = new SubscriptionManager();
const connManager = new ConnectionManager(subManager, mongoSource);
const streamManager = new ChangeStreamManager(mongoSource, subManager, connManager);
streamManager.start();

const transport = new WebSocketTransportServer({ port: 8080 });
transport.onConnection((conn) => connManager.addConnection(conn));
transport.onMessage((id, msg) => connManager.handleMessage(id, msg));
transport.onDisconnect((id) => connManager.removeConnection(id));
await transport.start();

// On shutdown:
await transport.stop();
streamManager.stop();
connManager.closeAll();
await mongoSource.close();
```

## API Reference

### `createRealtimeMongo(config)`

Creates and wires all server components. Returns a `RealtimeMongoInstance`.

| Option        | Type              | Required | Description                                        |
| ------------- | ----------------- | -------- | -------------------------------------------------- |
| `mongoUri`    | `string`          | Yes      | MongoDB Replica Set URI                            |
| `collections` | `string[]`        | Yes      | Collections to watch, as `'db.collection'` strings |
| `port`        | `number`          | Yes      | WebSocket server port                              |
| `transport`   | `TransportConfig` | No       | Auth, rate limits, origins, etc.                   |

### `TransportConfig`

| Option                          | Type              | Default                        | Description                                          |
| ------------------------------- | ----------------- | ------------------------------ | ---------------------------------------------------- |
| `allowedOrigins`                | `string[] \| '*'` | `'*'`                          | Allowed WebSocket origins. Set for CSWSH prevention. |
| `maxConnections`                | `number`          | unlimited                      | Max concurrent connections                           |
| `maxSubscriptionsPerConnection` | `number`          | `200`                          | Max subscriptions per connection                     |
| `maxPayload`                    | `number`          | `65536`                        | Max message payload in bytes                         |
| `rateLimit`                     | `RateLimitConfig` | `{capacity:50, refillRate:10}` | Token bucket rate limit                              |
| `maxViolations`                 | `number`          | `5`                            | Disconnect after this many bad messages              |
| `auth`                          | `AuthConfig`      | none                           | Authentication configuration                         |

### `AuthConfig`

| Option         | Type                                               | Description                               |
| -------------- | -------------------------------------------------- | ----------------------------------------- |
| `verify`       | `(token: string) => Promise<string>`               | Validate token, return principal or throw |
| `canSubscribe` | `(principal, db, coll, docId) => Promise<boolean>` | Per-subscription authorization            |
| `timeoutMs`    | `number`                                           | Auth timeout (default: 5000ms)            |

## Security Considerations

### ⚠️ Field Exposure — Control What's in Your Subscribed Collections

**realtime-mongo broadcasts the full MongoDB document to every subscriber.** If a subscribed collection contains sensitive fields like `passwordHash`, `apiKey`, `ssn`, or any internal data, those fields will be sent to every client that subscribes to that document.

**Recommended mitigations:**

1. **Use dedicated read-only projections via a view**: Create a MongoDB view with only the fields you want to expose and register the view as the collection.

2. **Store sensitive fields in a separate collection**: Keep `users` clean (public fields only) and store secrets in `users_private` (never registered with realtime-mongo).

3. **Use `canSubscribe` for access control**: The `auth.canSubscribe` hook can verify a user is allowed to see a document before the subscription is created.

```ts
const realtime = await createRealtimeMongo({
  mongoUri: process.env.MONGO_URI!,
  // Only register collections that contain ONLY safe-to-expose fields
  collections: ['mydb.tasks', 'mydb.posts'], // NOT 'mydb.users' if it has secrets
  port: 8080,
  transport: {
    auth: {
      verify: async (token) => verifyJWT(token),
      canSubscribe: async (userId, db, coll, docId) => {
        // Verify the user owns this document
        return await userOwnsDocument(userId, db, coll, docId);
      },
    },
  },
});
```

> A `projection` option for `registerCollection` is planned for v0.2.

---

## Requirements

- MongoDB must be running as a **Replica Set** (required for Change Streams)
- MongoDB Atlas works out of the box
- Node.js `>=18.0.0`

## License

MIT
