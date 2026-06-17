import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import WebSocket from 'ws';
import { createRealtimeMongo, RealtimeMongoInstance } from '@realtimemongo/server';
import { RealtimeMongoClient } from '../src';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const PORT = 18003;
const DB = 'client_test';
const COLL = 'items';

function waitFor<T>(
  fn: () => T | null | undefined,
  options: { timeout?: number; interval?: number } = {}
): Promise<T> {
  const { timeout = 5000, interval = 50 } = options;
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const check = () => {
      const result = fn();
      if (result === true || (result != null && result !== false)) return resolve(result as T);
      if (Date.now() >= deadline) return reject(new Error(`waitFor timed out after ${timeout}ms`));
      setTimeout(check, interval);
    };
    check();
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
// Snapshot delivery
// ---------------------------------------------------------------------------

describe('RealtimeMongoClient — snapshot delivery', () => {
  it('delivers the current document on subscribe', async () => {
    const docId = 'client_snap_001';
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: docId as any, title: 'Hello' });

    const client = new RealtimeMongoClient({
      url: `ws://localhost:${PORT}`,
      db: DB,
      WebSocketImpl: WebSocket,
    });

    let received: any = undefined;
    client
      .collection(COLL)
      .doc(docId)
      .onSnapshot((doc) => {
        received = doc;
      });

    await waitFor(() => received, { timeout: 5000 });
    expect(received.title).toBe('Hello');

    client.close();
  });

  it('delivers null when the document does not exist', async () => {
    const client = new RealtimeMongoClient({
      url: `ws://localhost:${PORT}`,
      db: DB,
      WebSocketImpl: WebSocket,
    });

    let received: any = 'PENDING';
    client
      .collection(COLL)
      .doc('nonexistent')
      .onSnapshot((doc) => {
        received = doc;
      });

    await waitFor(() => received !== 'PENDING', { timeout: 5000 });
    expect(received).toBeNull();

    client.close();
  });
});

// ---------------------------------------------------------------------------
// Real-time updates
// ---------------------------------------------------------------------------

describe('RealtimeMongoClient — real-time updates', () => {
  it('calls onSnapshot again when the document is updated', async () => {
    const docId = 'client_upd_001';
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: docId as any, counter: 0 });

    const client = new RealtimeMongoClient({
      url: `ws://localhost:${PORT}`,
      db: DB,
      WebSocketImpl: WebSocket,
    });

    const snapshots: any[] = [];
    client
      .collection(COLL)
      .doc(docId)
      .onSnapshot((doc) => {
        snapshots.push(doc);
      });

    await waitFor(() => snapshots.length >= 1, { timeout: 5000 });

    await mongoClient
      .db(DB)
      .collection(COLL)
      .updateOne({ _id: docId as any }, { $set: { counter: 1 } });

    await waitFor(() => snapshots.length >= 2, { timeout: 5000 });
    expect(snapshots[1].counter).toBe(1);

    client.close();
  });

  it('delivers null when the document is deleted', async () => {
    const docId = 'client_del_001';
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: docId as any, live: true });

    const client = new RealtimeMongoClient({
      url: `ws://localhost:${PORT}`,
      db: DB,
      WebSocketImpl: WebSocket,
    });

    const snapshots: any[] = [];
    client
      .collection(COLL)
      .doc(docId)
      .onSnapshot((doc) => {
        snapshots.push(doc);
      });

    await waitFor(() => snapshots.length >= 1, { timeout: 5000 });

    await mongoClient
      .db(DB)
      .collection(COLL)
      .deleteOne({ _id: docId as any });

    await waitFor(() => snapshots.length >= 2, { timeout: 5000 });
    expect(snapshots[1]).toBeNull();

    client.close();
  });
});

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

describe('RealtimeMongoClient — unsubscribe', () => {
  it('stops delivering updates after calling the returned unsubscribe function', async () => {
    const docId = 'client_unsub_001';
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: docId as any, v: 0 });

    const client = new RealtimeMongoClient({
      url: `ws://localhost:${PORT}`,
      db: DB,
      WebSocketImpl: WebSocket,
    });

    const snapshots: any[] = [];
    const unsubscribe = client
      .collection(COLL)
      .doc(docId)
      .onSnapshot((doc) => {
        snapshots.push(doc);
      });

    await waitFor(() => snapshots.length >= 1, { timeout: 5000 });
    unsubscribe();

    const countBeforeWrite = snapshots.length;
    await mongoClient
      .db(DB)
      .collection(COLL)
      .updateOne({ _id: docId as any }, { $set: { v: 99 } });
    await new Promise((r) => setTimeout(r, 500));

    expect(snapshots.length).toBe(countBeforeWrite);
    client.close();
  });
});

// ---------------------------------------------------------------------------
// Multi-database access
// ---------------------------------------------------------------------------

describe('RealtimeMongoClient — multi-database access via client.db()', () => {
  it('subscribes to a document in a non-default database', async () => {
    const ALT_DB = 'alt_db_test';
    const ALT_COLL = 'alt_items';
    await mongoClient
      .db('alt_db_test')
      .createCollection(ALT_COLL)
      .catch(() => {});

    // Re-create realtime server with additional collection registered
    const altRealtime = await createRealtimeMongo({
      mongoUri: replSet.getUri(),
      collections: [`${DB}.${COLL}`, `${ALT_DB}.${ALT_COLL}`],
      port: 18004,
    });

    const docId = 'alt_db_doc_001';
    await mongoClient
      .db(ALT_DB)
      .collection(ALT_COLL)
      .insertOne({ _id: docId as any, source: 'alt' });

    const client = new RealtimeMongoClient({
      url: `ws://localhost:18004`,
      db: DB,
      WebSocketImpl: WebSocket,
    });

    let received: any = undefined;
    client
      .db(ALT_DB)
      .collection(ALT_COLL)
      .doc(docId)
      .onSnapshot((doc) => {
        received = doc;
      });

    await waitFor(() => received != null, { timeout: 5000 });
    expect(received.source).toBe('alt');

    client.close();
    await altRealtime.stop();
    await mongoClient.db(ALT_DB).dropDatabase();
  });
});

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

describe('RealtimeMongoClient — connection state', () => {
  it('transitions to connected after opening', async () => {
    const client = new RealtimeMongoClient({
      url: `ws://localhost:${PORT}`,
      db: DB,
      WebSocketImpl: WebSocket,
    });
    client.connect();

    await waitFor(() => client.connectionState === 'connected', { timeout: 5000 });
    expect(client.connectionState).toBe('connected');

    client.close();
  });

  it('emits connection state changes via onConnectionStateChange', async () => {
    const states: string[] = [];
    const client = new RealtimeMongoClient({
      url: `ws://localhost:${PORT}`,
      db: DB,
      WebSocketImpl: WebSocket,
    });
    client.onConnectionStateChange((s) => states.push(s));
    client.connect();

    await waitFor(() => states.includes('connected'), { timeout: 5000 });
    expect(states).toContain('connecting');
    expect(states).toContain('connected');

    client.close();
  });
});

// ---------------------------------------------------------------------------
// TypeScript generics
// ---------------------------------------------------------------------------

describe('RealtimeMongoClient — TypeScript generics', () => {
  it('types the snapshot callback with the provided generic', async () => {
    interface Item {
      name: string;
      qty: number;
    }
    const docId = 'typed_doc_001';
    await mongoClient
      .db(DB)
      .collection(COLL)
      .insertOne({ _id: docId as any, name: 'Widget', qty: 5 });

    const client = new RealtimeMongoClient({
      url: `ws://localhost:${PORT}`,
      db: DB,
      WebSocketImpl: WebSocket,
    });

    let received: Item | null = null;
    client
      .collection<Item>(COLL)
      .doc(docId)
      .onSnapshot((doc: Item | null) => {
        received = doc;
      });

    await waitFor(() => received != null, { timeout: 5000 });
    expect(received!.name).toBe('Widget');
    expect(received!.qty).toBe(5);

    client.close();
  });
});
