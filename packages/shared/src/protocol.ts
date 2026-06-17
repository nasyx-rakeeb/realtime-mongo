import { z } from 'zod';
import { PROTOCOL_VERSION } from './constants';
import { VClockSchema, VClock } from './vclock';

/**
 * All messages share this envelope. The `v` field is validated first so
 * version mismatches are caught before schema parsing begins.
 */
const BaseMessage = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
});

/**
 * Reusable field validators for database and collection names.
 * The pattern excludes characters that are illegal in MongoDB namespaces
 * ($, null bytes, and leading/trailing dots).
 */
const dbName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid database name');
const collName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid collection name');
const docId = z.string().min(1).max(256);

// ---------------------------------------------------------------------------
// Client → Server schemas
// ---------------------------------------------------------------------------

export const SubscribeSchema = BaseMessage.extend({
  t: z.literal('sub'),
  p: z.object({ db: dbName, coll: collName, id: docId }),
});

export const UnsubscribeSchema = BaseMessage.extend({
  t: z.literal('unsub'),
  p: z.object({ db: dbName, coll: collName, id: docId }),
});

export const PingSchema = BaseMessage.extend({
  t: z.literal('ping'),
  p: z.object({}),
});

export const AuthSchema = BaseMessage.extend({
  t: z.literal('auth'),
  p: z.object({ token: z.string().min(1) }),
});

export const ClientMessageSchema = z.discriminatedUnion('t', [
  SubscribeSchema,
  UnsubscribeSchema,
  PingSchema,
  AuthSchema,
]);

// ---------------------------------------------------------------------------
// Server → Client schemas
// ---------------------------------------------------------------------------

/**
 * The `snap` payload includes `db`, `coll`, and `id` so the client can
 * route snapshots via an O(1) composite key lookup rather than scanning.
 */
export const SnapshotSchema = BaseMessage.extend({
  t: z.literal('snap'),
  vclock: VClockSchema,
  p: z.object({
    db: z.string().min(1),
    coll: z.string().min(1),
    id: z.string().min(1),
    doc: z.record(z.string(), z.any()).nullable(),
  }),
});

export const UpdateSchema = BaseMessage.extend({
  t: z.literal('upd'),
  vclock: VClockSchema,
  p: z.object({
    db: z.string().min(1),
    coll: z.string().min(1),
    id: z.string().min(1),
    doc: z.record(z.string(), z.any()),
  }),
});

export const DeleteSchema = BaseMessage.extend({
  t: z.literal('del'),
  vclock: VClockSchema,
  p: z.object({
    db: z.string().min(1),
    coll: z.string().min(1),
    id: z.string().min(1),
  }),
});

export const PongSchema = BaseMessage.extend({
  t: z.literal('pong'),
  p: z.object({}),
});

export const ErrorSchema = BaseMessage.extend({
  t: z.literal('err'),
  p: z.object({
    code: z.string().min(1),
    message: z.string(),
  }),
});

export const ServerMessageSchema = z.discriminatedUnion('t', [
  SnapshotSchema,
  UpdateSchema,
  DeleteSchema,
  PongSchema,
  ErrorSchema,
]);

// ---------------------------------------------------------------------------
// Derived TypeScript types
// ---------------------------------------------------------------------------

export type SubscribeMessage = Readonly<z.infer<typeof SubscribeSchema>>;
export type UnsubscribeMessage = Readonly<z.infer<typeof UnsubscribeSchema>>;
export type PingMessage = Readonly<z.infer<typeof PingSchema>>;
export type AuthMessage = Readonly<z.infer<typeof AuthSchema>>;
export type ClientMessage = Readonly<z.infer<typeof ClientMessageSchema>>;
export type SnapshotMessage = Readonly<z.infer<typeof SnapshotSchema>>;
export type UpdateMessage = Readonly<z.infer<typeof UpdateSchema>>;
export type DeleteMessage = Readonly<z.infer<typeof DeleteSchema>>;
export type PongMessage = Readonly<z.infer<typeof PongSchema>>;
export type ErrorMessage = Readonly<z.infer<typeof ErrorSchema>>;
export type ServerMessage = Readonly<z.infer<typeof ServerMessageSchema>>;

// ---------------------------------------------------------------------------
// Factory functions — produce frozen, type-safe message objects
// ---------------------------------------------------------------------------

export function createSubscribeMessage(
  id: string,
  db: string,
  coll: string,
  docId: string
): SubscribeMessage {
  return Object.freeze({
    v: PROTOCOL_VERSION,
    id,
    t: 'sub' as const,
    p: Object.freeze({ db, coll, id: docId }),
  });
}

export function createUnsubscribeMessage(
  id: string,
  db: string,
  coll: string,
  docId: string
): UnsubscribeMessage {
  return Object.freeze({
    v: PROTOCOL_VERSION,
    id,
    t: 'unsub' as const,
    p: Object.freeze({ db, coll, id: docId }),
  });
}

export function createPingMessage(id: string): PingMessage {
  return Object.freeze({ v: PROTOCOL_VERSION, id, t: 'ping' as const, p: Object.freeze({}) });
}

export function createAuthMessage(id: string, token: string): AuthMessage {
  return Object.freeze({
    v: PROTOCOL_VERSION,
    id,
    t: 'auth' as const,
    p: Object.freeze({ token }),
  });
}

export function createSnapshotMessage(
  id: string,
  vclock: VClock,
  db: string,
  coll: string,
  docId: string,
  doc: Record<string, any> | null
): SnapshotMessage {
  return Object.freeze({
    v: PROTOCOL_VERSION,
    id,
    vclock,
    t: 'snap' as const,
    p: Object.freeze({ db, coll, id: docId, doc }),
  });
}

export function createUpdateMessage(
  id: string,
  vclock: VClock,
  db: string,
  coll: string,
  docId: string,
  doc: Record<string, any>
): UpdateMessage {
  return Object.freeze({
    v: PROTOCOL_VERSION,
    id,
    vclock,
    t: 'upd' as const,
    p: Object.freeze({ db, coll, id: docId, doc }),
  });
}

export function createDeleteMessage(
  id: string,
  vclock: VClock,
  db: string,
  coll: string,
  docId: string
): DeleteMessage {
  return Object.freeze({
    v: PROTOCOL_VERSION,
    id,
    vclock,
    t: 'del' as const,
    p: Object.freeze({ db, coll, id: docId }),
  });
}

export function createPongMessage(id: string): PongMessage {
  return Object.freeze({ v: PROTOCOL_VERSION, id, t: 'pong' as const, p: Object.freeze({}) });
}

export function createErrorMessage(id: string, code: string, message: string): ErrorMessage {
  return Object.freeze({
    v: PROTOCOL_VERSION,
    id,
    t: 'err' as const,
    p: Object.freeze({ code, message }),
  });
}
