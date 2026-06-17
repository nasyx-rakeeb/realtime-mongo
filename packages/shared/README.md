# @realtimemongo/shared

> **Internal package** — not intended for direct use by end users.

Contains shared protocol types, Zod schemas, and utilities used internally by `@realtimemongo/server` and `@realtimemongo/client`.

## Contents

- **Protocol types** (`protocol.ts`) — Zod schemas and TypeScript types for all WebSocket messages (`sub`, `unsub`, `snap`, `upd`, `del`, `ping`, `pong`, `auth`, `err`)
- **VClock** (`vclock.ts`) — Vector clock logic for causal ordering and deduplication
- **Error codes** (`errors.ts`) — Typed error code constants
- **Parser** (`parser.ts`) — `parseClientMessage` and `parseServerMessage` with version validation
- **Constants** (`constants.ts`) — `PROTOCOL_VERSION`

## Protocol Version

All messages include a `v` field with the protocol version number. The current version is `1`.

When the protocol changes in a breaking way, the version number will be incremented and both the client and server packages will be updated together.

## License

MIT
