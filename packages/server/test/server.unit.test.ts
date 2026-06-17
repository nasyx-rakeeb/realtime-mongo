import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucket, DEFAULT_RATE_LIMIT_CONFIG } from '../src/transport/RateLimiter';
import { SubscriptionManager } from '../src/managers/SubscriptionManager';
import { ConnectionManager } from '../src/managers/ConnectionManager';
import {
  createSubscribeMessage,
  createUnsubscribeMessage,
  createPingMessage,
  createSnapshotMessage,
  ErrorCodes,
  ServerMessage,
} from '@realtimemongo/shared';

// ---------------------------------------------------------------------------
// TokenBucket (rate limiter)
// ---------------------------------------------------------------------------

describe('TokenBucket', () => {
  it('allows messages within the configured rate', () => {
    const bucket = new TokenBucket({ capacity: 10, refillRate: 10 });
    for (let i = 0; i < 10; i++) {
      expect(bucket.tryConsume()).toBe(true);
    }
  });

  it('blocks messages that exceed the rate', () => {
    const bucket = new TokenBucket({ capacity: 3, refillRate: 3 });
    bucket.tryConsume();
    bucket.tryConsume();
    bucket.tryConsume();
    expect(bucket.tryConsume()).toBe(false);
  });

  it('refills tokens after the interval elapses', () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket({ capacity: 2, refillRate: 4 });
    bucket.tryConsume();
    bucket.tryConsume();
    expect(bucket.tryConsume()).toBe(false);
    vi.advanceTimersByTime(500);
    expect(bucket.tryConsume()).toBe(true);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// SubscriptionManager (server)
// ---------------------------------------------------------------------------

describe('SubscriptionManager (server)', () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    manager = new SubscriptionManager();
  });

  it('adds a subscriber and returns it via getSubscribers', () => {
    manager.subscribe('conn1', 'db', 'coll', 'doc1');
    expect(manager.getSubscribers('db', 'coll', 'doc1').has('conn1')).toBe(true);
  });

  it('supports multiple subscribers for the same document', () => {
    manager.subscribe('conn1', 'db', 'coll', 'doc1');
    manager.subscribe('conn2', 'db', 'coll', 'doc1');
    expect(manager.getSubscribers('db', 'coll', 'doc1').size).toBe(2);
  });

  it('removes a specific subscriber on unsubscribe', () => {
    manager.subscribe('conn1', 'db', 'coll', 'doc1');
    manager.subscribe('conn2', 'db', 'coll', 'doc1');
    manager.unsubscribe('conn1', 'db', 'coll', 'doc1');
    const subs = manager.getSubscribers('db', 'coll', 'doc1');
    expect(subs.has('conn1')).toBe(false);
    expect(subs.has('conn2')).toBe(true);
  });

  it('removes all subscriptions for a connection on unsubscribeAll', () => {
    manager.subscribe('conn1', 'db', 'coll', 'doc1');
    manager.subscribe('conn1', 'db', 'coll', 'doc2');
    manager.subscribe('conn2', 'db', 'coll', 'doc1');
    manager.unsubscribeAll('conn1');
    expect(manager.getSubscribers('db', 'coll', 'doc1').has('conn1')).toBe(false);
    expect(manager.getSubscribers('db', 'coll', 'doc2').has('conn1')).toBe(false);
    expect(manager.getSubscribers('db', 'coll', 'doc1').has('conn2')).toBe(true);
  });

  it('returns an empty set for an unknown document', () => {
    expect(manager.getSubscribers('db', 'coll', 'nonexistent').size).toBe(0);
  });

  it('is idempotent for duplicate subscriptions from the same connection', () => {
    manager.subscribe('conn1', 'db', 'coll', 'doc1');
    manager.subscribe('conn1', 'db', 'coll', 'doc1');
    expect(manager.getSubscribers('db', 'coll', 'doc1').size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ConnectionManager (server) — unit tests with mock IConnection
// ---------------------------------------------------------------------------

describe('ConnectionManager (server)', () => {
  function makeConnection(id: string) {
    const sent: ServerMessage[] = [];
    return {
      id,
      send: (msg: ServerMessage) => {
        sent.push(msg);
      },
      close: vi.fn(),
      sent,
    };
  }

  function makeChangeSource(doc: Record<string, any> | null = { value: 1 }) {
    return {
      onChange: vi.fn(),
      fetchSnapshot: vi.fn().mockResolvedValue({ doc, vclock: { t: 1, i: 1 } }),
      close: vi.fn(),
    };
  }

  it('sends a snap message on subscribe', async () => {
    const subscriptionManager = new SubscriptionManager();
    const changeSource = makeChangeSource({ title: 'Test' });
    const manager = new ConnectionManager(subscriptionManager, changeSource as any);

    const conn = makeConnection('conn1');
    manager.addConnection(conn);
    await manager.handleMessage('conn1', createSubscribeMessage('m1', 'db', 'tasks', 'doc1'));

    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0].t).toBe('snap');
  });

  it('sends a snap with null doc when the document does not exist', async () => {
    const subscriptionManager = new SubscriptionManager();
    const changeSource = makeChangeSource(null);
    const manager = new ConnectionManager(subscriptionManager, changeSource as any);

    const conn = makeConnection('conn1');
    manager.addConnection(conn);
    await manager.handleMessage('conn1', createSubscribeMessage('m1', 'db', 'tasks', 'doc1'));

    expect(conn.sent[0].t).toBe('snap');
    if (conn.sent[0].t === 'snap') expect(conn.sent[0].p.doc).toBeNull();
  });

  it('sends COLLECTION_NOT_REGISTERED when collection is unregistered', async () => {
    const { CollectionNotRegisteredError } = await import('../src/mongo/MongoChangeSource');
    const subscriptionManager = new SubscriptionManager();
    const changeSource = {
      onChange: vi.fn(),
      fetchSnapshot: vi.fn().mockRejectedValue(new CollectionNotRegisteredError('db', 'unknown')),
      close: vi.fn(),
    };
    const manager = new ConnectionManager(subscriptionManager, changeSource as any);

    const conn = makeConnection('conn1');
    manager.addConnection(conn);
    await manager.handleMessage('conn1', createSubscribeMessage('m1', 'db', 'unknown', 'doc1'));

    expect(conn.sent[0].t).toBe('err');
    if (conn.sent[0].t === 'err') {
      expect(conn.sent[0].p.code).toBe(ErrorCodes.COLLECTION_NOT_REGISTERED);
    }
  });

  it('sends SERVER_ERROR for unexpected fetch failures', async () => {
    const subscriptionManager = new SubscriptionManager();
    const changeSource = {
      onChange: vi.fn(),
      fetchSnapshot: vi.fn().mockRejectedValue(new Error('Mongo network error')),
      close: vi.fn(),
    };
    const manager = new ConnectionManager(subscriptionManager, changeSource as any);

    const conn = makeConnection('conn1');
    manager.addConnection(conn);
    await manager.handleMessage('conn1', createSubscribeMessage('m1', 'db', 'tasks', 'doc1'));

    expect(conn.sent[0].t).toBe('err');
    if (conn.sent[0].t === 'err') expect(conn.sent[0].p.code).toBe(ErrorCodes.SERVER_ERROR);
  });

  it('sends a pong in response to a ping', async () => {
    const subscriptionManager = new SubscriptionManager();
    const changeSource = makeChangeSource();
    const manager = new ConnectionManager(subscriptionManager, changeSource as any);

    const conn = makeConnection('conn1');
    manager.addConnection(conn);
    await manager.handleMessage('conn1', createPingMessage('m5'));

    expect(conn.sent[0].t).toBe('pong');
    if (conn.sent[0].t === 'pong') expect(conn.sent[0].id).toBe('m5');
  });

  it('cleans up subscriptions when a connection is removed', async () => {
    const subscriptionManager = new SubscriptionManager();
    const changeSource = makeChangeSource();
    const manager = new ConnectionManager(subscriptionManager, changeSource as any);

    const conn = makeConnection('conn1');
    manager.addConnection(conn);
    await manager.handleMessage('conn1', createSubscribeMessage('m1', 'db', 'tasks', 'doc1'));

    expect(subscriptionManager.getSubscribers('db', 'tasks', 'doc1').has('conn1')).toBe(true);
    manager.removeConnection('conn1');
    expect(subscriptionManager.getSubscribers('db', 'tasks', 'doc1').has('conn1')).toBe(false);
  });

  it('does nothing when a message arrives for an unknown connection', async () => {
    const manager = new ConnectionManager(new SubscriptionManager(), makeChangeSource() as any);
    await expect(
      manager.handleMessage('nonexistent', createPingMessage('m1'))
    ).resolves.not.toThrow();
  });
});
