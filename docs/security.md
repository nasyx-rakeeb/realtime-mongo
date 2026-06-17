# Security Model

This document describes the security architecture of realtime-mongo, including transport security, authentication, authorization, and known limitations.

---

## Transport Security

### TLS / WSS

In production, always run the WebSocket server behind a TLS-terminating reverse proxy (nginx, Caddy, AWS ALB) so clients connect via `wss://` rather than `ws://`. The `ws` library used by `@realtimemongo/server` does not handle TLS natively.

### Origin Validation

By default, the server accepts connections from any origin. In production, restrict this to your known frontend origins to prevent [Cross-Site WebSocket Hijacking (CSWSH)](https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking):

```ts
const realtime = await createRealtimeMongo({
  transport: {
    allowedOrigins: ['https://app.example.com', 'https://www.example.com'],
  },
});
```

### Connection Limits

Prevent connection-flood attacks by setting a maximum connection count:

```ts
transport: {
  maxConnections: 1000,  // Close with code 1008 when exceeded
}
```

### Rate Limiting

Each connection is rate-limited using a Token Bucket algorithm. Connections that exceed the limit receive `RATE_LIMIT_EXCEEDED` errors. Connections that repeatedly send invalid messages are terminated after `maxViolations` (default: 5) infractions.

```ts
transport: {
  rateLimit: {
    tokensPerInterval: 30,
    intervalMs: 1000,
  },
  maxViolations: 5,
}
```

### Payload Size

Messages exceeding `maxPayload` (default: 64 KB) are rejected at the WebSocket level before parsing.

### Backpressure

Connections with a send buffer exceeding `maxBufferedBytes` (default: 1 MB) are closed to prevent the server from accumulating memory for slow clients.

---

## Authentication

realtime-mongo uses a **first-message authentication** pattern:

1. Client connects via WebSocket.
2. Client sends `{ t: "auth", p: { token: "..." } }` as the **first** message.
3. Server calls `auth.verify(token)`. On success, the returned principal is stored on the connection. On failure, the connection is closed with code `1008`.
4. If no valid auth message is received within `auth.timeoutMs` (default: 5000ms), the connection is closed.

```ts
import { createRealtimeMongo } from '@realtimemongo/server';
import { verify } from 'jsonwebtoken';

const realtime = await createRealtimeMongo({
  mongoUri: process.env.MONGO_URI!,
  collections: ['mydb.tasks'],
  port: 8080,
  transport: {
    auth: {
      verify: async (token) => {
        const payload = verify(token, process.env.JWT_SECRET!) as { userId: string };
        return payload.userId; // Return the principal (stored on the connection)
      },
      timeoutMs: 5000,
    },
  },
});
```

When `auth` is not configured, the server accepts all connections without authentication. **Do not deploy without authentication in production.**

---

## Authorization

Per-subscription authorization is enforced via `auth.canSubscribe`. This is called before every `sub` message is processed:

```ts
transport: {
  auth: {
    verify: async (token) => getUserIdFromToken(token),
    canSubscribe: async (principal, db, coll, docId) => {
      // principal = the value returned by verify()
      // Return false to deny the subscription
      return await userHasAccessToDocument(principal, db, coll, docId);
    },
  },
},
```

If `canSubscribe` returns `false` or throws, the client receives `AUTH_FAILED` and the subscription is not created.

### Subscription Limits

Limit the number of active subscriptions per connection to prevent resource exhaustion:

```ts
transport: {
  maxSubscriptionsPerConnection: 100,  // default: 200
}
```

---

## Data Exposure

> **Critical:** realtime-mongo sends the **full MongoDB document** to every subscriber. Any field stored in a subscribed collection will be transmitted to clients that subscribe to those documents.

**Recommended mitigations:**

1. **Collection design** — Only register collections that contain fields safe to expose. Store sensitive data (password hashes, API keys, PII) in separate, unregistered collections.

2. **MongoDB views** — Create a read-only view with a `$project` stage to limit exposed fields, and register the view name instead of the underlying collection.

3. **`canSubscribe` authorization** — Use the authorization hook to ensure users can only subscribe to documents they own.

A `projection` option for `registerCollection` is planned for a future release.

---

## Input Validation

All incoming messages are validated against [Zod](https://zod.dev) schemas before processing:

- `db` and `coll` fields: 1–128 characters, pattern `^[a-zA-Z0-9_.-]+$`
- `id` field: 1–256 characters
- `token` field: minimum 1 character
- Protocol version: must equal `1`

Messages that fail validation result in an `INVALID_MESSAGE` error and increment the connection's violation counter.

---

## Reporting Vulnerabilities

See [SECURITY.md](../SECURITY.md) for the vulnerability disclosure process.
