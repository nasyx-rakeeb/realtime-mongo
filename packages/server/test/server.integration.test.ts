import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import WebSocket from 'ws';
import { createRealtimeMongo, RealtimeMongoInstance } from '../src';
import { PROTOCOL_VERSION, ErrorCodes } from '@realtimemongo/shared';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const PORT = 18001;
const DB = 'integration_test';
const COLL = 'items';

function makeMessage(t: string, p: Record<string, any>, id = 'msg1'): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, id, t, p });
}

function connectWS(port = PORT): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage(ws: WebSocket, filter?: (msg: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), 5000);
    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (!filter || filter(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let replSet: MongoMemoryReplSet;
let mongoClient: MongoClient;
let realtime: RealtimeMongoInstance;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();

  mongoClient = new MongoClient(uri);
  await mongoClient.connect();

  realtime = await createRealtimeMongo({
    mongoUri: uri,
    collections: [`${DB}.${COLL}`],
    port: PORT,
  });
}, 60_000);

afterAll(async () => {
  await realtime.stop();
  await mongoClient.close();
  await replSet.stop();
});

beforeEach(async () => {
  await mongoClient.db(DB).collection(COLL).deleteMany({});
});

// ---------------------------------------------------------------------------
// Snapshot on subscribe
// ---------------------------------------------------------------------------

describe('snapshot on subscribe', () => {
  it('delivers an existing document as the initial snap', async () => {
    const docId = 'test_doc_001';
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: docId as any, value: 42 });

    const ws = await connectWS();
    ws.send(makeMessage('sub', { db: DB, coll: COLL, id: docId }));

    const snap = await waitForMessage(ws, (m) => m.t === 'snap');
    expect(snap.p.doc.value).toBe(42);
    expect(snap.p.db).toBe(DB);
    expect(snap.p.coll).toBe(COLL);
    expect(snap.p.id).toBe(docId);

    ws.close();
  });

  it('delivers a null doc when the document does not exist', async () => {
    const ws = await connectWS();
    ws.send(makeMessage('sub', { db: DB, coll: COLL, id: 'nonexistent_doc' }));

    const snap = await waitForMessage(ws, (m) => m.t === 'snap');
    expect(snap.p.doc).toBeNull();
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Real-time change delivery
// ---------------------------------------------------------------------------

describe('real-time change delivery', () => {
  it('delivers an upd message when a subscribed document is updated', async () => {
    const docId = 'realtime_update_001';
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: docId as any, counter: 0 });

    const ws = await connectWS();
    ws.send(makeMessage('sub', { db: DB, coll: COLL, id: docId }));
    await waitForMessage(ws, (m) => m.t === 'snap');

    await mongoClient
      .db(DB)
      .collection(COLL)
      .updateOne({ _id: docId as any }, { $set: { counter: 1 } });

    const upd = await waitForMessage(ws, (m) => m.t === 'upd');
    expect(upd.p.doc.counter).toBe(1);
    expect(upd.p.db).toBe(DB);
    expect(upd.p.coll).toBe(COLL);
    expect(upd.p.id).toBe(docId);

    ws.close();
  });

  it('delivers a del message when a subscribed document is deleted', async () => {
    const docId = 'realtime_delete_001';
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: docId as any, value: 1 });

    const ws = await connectWS();
    ws.send(makeMessage('sub', { db: DB, coll: COLL, id: docId }));
    await waitForMessage(ws, (m) => m.t === 'snap');

    await mongoClient
      .db(DB)
      .collection(COLL)
      .deleteOne({ _id: docId as any });

    const del = await waitForMessage(ws, (m) => m.t === 'del');
    expect(del.p.db).toBe(DB);
    expect(del.p.id).toBe(docId);

    ws.close();
  });

  it('does not deliver events after unsubscribe', async () => {
    const docId = 'unsub_test_001';
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: docId as any, val: 0 });

    const ws = await connectWS();
    ws.send(makeMessage('sub', { db: DB, coll: COLL, id: docId }, 'sub1'));
    await waitForMessage(ws, (m) => m.t === 'snap');

    ws.send(makeMessage('unsub', { db: DB, coll: COLL, id: docId }, 'unsub1'));
    await new Promise((r) => setTimeout(r, 200));

    const received: any[] = [];
    ws.on('message', (d) => received.push(JSON.parse(d.toString())));

    await mongoClient
      .db(DB)
      .collection(COLL)
      .updateOne({ _id: docId as any }, { $set: { val: 99 } });
    await new Promise((r) => setTimeout(r, 500));

    expect(received.filter((m) => m.t === 'upd')).toHaveLength(0);
    ws.close();
  });

  it('fans out to multiple subscribers for the same document', async () => {
    const docId = 'fanout_test_001';
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: docId as any, v: 0 });

    const ws1 = await connectWS();
    const ws2 = await connectWS();

    ws1.send(makeMessage('sub', { db: DB, coll: COLL, id: docId }));
    ws2.send(makeMessage('sub', { db: DB, coll: COLL, id: docId }));

    await Promise.all([
      waitForMessage(ws1, (m) => m.t === 'snap'),
      waitForMessage(ws2, (m) => m.t === 'snap'),
    ]);

    await mongoClient
      .db(DB)
      .collection(COLL)
      .updateOne({ _id: docId as any }, { $set: { v: 1 } });

    const [upd1, upd2] = await Promise.all([
      waitForMessage(ws1, (m) => m.t === 'upd'),
      waitForMessage(ws2, (m) => m.t === 'upd'),
    ]);

    expect(upd1.p.doc.v).toBe(1);
    expect(upd2.p.doc.v).toBe(1);

    ws1.close();
    ws2.close();
  });
});

// ---------------------------------------------------------------------------
// Protocol validation
// ---------------------------------------------------------------------------

describe('protocol validation', () => {
  it('returns INVALID_MESSAGE for malformed JSON', async () => {
    const ws = await connectWS();
    ws.send('not valid json{{{');
    const err = await waitForMessage(ws, (m) => m.t === 'err');
    expect(err.p.code).toBe(ErrorCodes.INVALID_MESSAGE);
    ws.close();
  });

  it('returns INVALID_MESSAGE for an unknown message type', async () => {
    const ws = await connectWS();
    ws.send(JSON.stringify({ v: PROTOCOL_VERSION, id: 'm1', t: 'hack', p: {} }));
    const err = await waitForMessage(ws, (m) => m.t === 'err');
    expect(err.p.code).toBe(ErrorCodes.INVALID_MESSAGE);
    ws.close();
  });

  it('returns COLLECTION_NOT_REGISTERED for an unregistered collection', async () => {
    const ws = await connectWS();
    ws.send(makeMessage('sub', { db: DB, coll: 'unregistered_coll', id: 'doc1' }));
    const err = await waitForMessage(ws, (m) => m.t === 'err');
    expect(err.p.code).toBe(ErrorCodes.COLLECTION_NOT_REGISTERED);
    ws.close();
  });

  it('responds to ping with pong echoing the message id', async () => {
    const ws = await connectWS();
    ws.send(makeMessage('ping', {}, 'ping_42'));
    const pong = await waitForMessage(ws, (m) => m.t === 'pong');
    expect(pong.id).toBe('ping_42');
    ws.close();
  });

  it('closes connection after too many invalid messages', async () => {
    const ws = await connectWS();
    const closePromise = waitForClose(ws);

    for (let i = 0; i < 10; i++) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('bad json!!!' + i);
      }
    }

    const { code } = await closePromise;
    expect(code).toBe(1008);
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('authentication', () => {
  let authRealtime: RealtimeMongoInstance;
  const AUTH_PORT = 18002;

  beforeAll(async () => {
    authRealtime = await createRealtimeMongo({
      mongoUri: replSet.getUri(),
      collections: [`${DB}.${COLL}`],
      port: AUTH_PORT,
      transport: {
        auth: {
          verify: async (token) => {
            if (token === 'valid_token') return 'user_123';
            throw new Error('Invalid token');
          },
          timeoutMs: 500,
        },
      },
    });
  });

  afterAll(async () => {
    await authRealtime.stop();
  });

  it('closes the connection if no auth message is sent within the timeout', async () => {
    const ws = await connectWS(AUTH_PORT);
    const { code } = await waitForClose(ws);
    expect(code).toBe(1008);
  }, 3000);

  it('closes the connection on an invalid token', async () => {
    const ws = await connectWS(AUTH_PORT);
    ws.send(makeMessage('auth', { token: 'bad_token' }, 'auth1'));
    const err = await waitForMessage(ws, (m) => m.t === 'err');
    expect(err.p.code).toBe(ErrorCodes.AUTH_FAILED);
    const { code } = await waitForClose(ws);
    expect(code).toBe(1008);
  });

  it('rejects a sub message sent before auth', async () => {
    const ws = await connectWS(AUTH_PORT);
    ws.send(makeMessage('sub', { db: DB, coll: COLL, id: 'doc1' }));
    const err = await waitForMessage(ws, (m) => m.t === 'err');
    expect(err.p.code).toBe(ErrorCodes.AUTH_REQUIRED);
    ws.close();
  });

  it('allows subscriptions after a valid auth message', async () => {
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: 'auth_doc_1' as any, ok: true });

    const ws = await connectWS(AUTH_PORT);
    ws.send(makeMessage('auth', { token: 'valid_token' }, 'auth1'));
    await new Promise((r) => setTimeout(r, 100));

    ws.send(makeMessage('sub', { db: DB, coll: COLL, id: 'auth_doc_1' }));
    const snap = await waitForMessage(ws, (m) => m.t === 'snap');
    expect(snap.p.doc.ok).toBe(true);
    ws.close();
  });
});
