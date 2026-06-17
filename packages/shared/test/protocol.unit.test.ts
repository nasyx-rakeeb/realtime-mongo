import { describe, it, expect } from 'vitest';
import {
  parseClientMessage,
  parseServerMessage,
  ProtocolError,
  createSubscribeMessage,
  createUnsubscribeMessage,
  createAuthMessage,
  createPingMessage,
  createSnapshotMessage,
  createUpdateMessage,
  createDeleteMessage,
  createPongMessage,
  createErrorMessage,
  ErrorCodes,
  PROTOCOL_VERSION,
} from '../src';

// ---------------------------------------------------------------------------
// parseClientMessage
// ---------------------------------------------------------------------------

describe('parseClientMessage', () => {
  describe('sub', () => {
    it('accepts a valid subscribe message', () => {
      const msg = createSubscribeMessage('m1', 'mydb', 'tasks', 'abc123');
      const parsed = parseClientMessage(msg);
      expect(parsed.t).toBe('sub');
      if (parsed.t === 'sub') {
        expect(parsed.p.db).toBe('mydb');
        expect(parsed.p.coll).toBe('tasks');
        expect(parsed.p.id).toBe('abc123');
      }
    });

    it('rejects an empty db field', () => {
      expect(() =>
        parseClientMessage({
          v: PROTOCOL_VERSION,
          id: 'm1',
          t: 'sub',
          p: { db: '', coll: 'tasks', id: 'abc' },
        })
      ).toThrow(ProtocolError);
    });

    it('rejects invalid characters in db name', () => {
      expect(() =>
        parseClientMessage({
          v: PROTOCOL_VERSION,
          id: 'm1',
          t: 'sub',
          p: { db: 'my$db', coll: 'tasks', id: 'abc' },
        })
      ).toThrow(ProtocolError);
    });

    it('rejects a db name exceeding 128 characters', () => {
      expect(() =>
        parseClientMessage({
          v: PROTOCOL_VERSION,
          id: 'm1',
          t: 'sub',
          p: { db: 'a'.repeat(129), coll: 'tasks', id: 'abc' },
        })
      ).toThrow(ProtocolError);
    });

    it('rejects invalid characters in coll name', () => {
      expect(() =>
        parseClientMessage({
          v: PROTOCOL_VERSION,
          id: 'm1',
          t: 'sub',
          p: { db: 'mydb', coll: 'tasks$', id: 'abc' },
        })
      ).toThrow(ProtocolError);
    });

    it('rejects an empty id field', () => {
      expect(() =>
        parseClientMessage({
          v: PROTOCOL_VERSION,
          id: 'm1',
          t: 'sub',
          p: { db: 'mydb', coll: 'tasks', id: '' },
        })
      ).toThrow(ProtocolError);
    });

    it('accepts dots and hyphens in db/coll names', () => {
      const msg = {
        v: PROTOCOL_VERSION,
        id: 'm1',
        t: 'sub',
        p: { db: 'my.db', coll: 'my-coll', id: 'abc' },
      };
      expect(() => parseClientMessage(msg)).not.toThrow();
    });
  });

  describe('unsub', () => {
    it('accepts a valid unsubscribe message', () => {
      const msg = createUnsubscribeMessage('m2', 'mydb', 'tasks', 'abc123');
      const parsed = parseClientMessage(msg);
      expect(parsed.t).toBe('unsub');
    });
  });

  describe('auth', () => {
    it('accepts a valid auth message', () => {
      const msg = createAuthMessage('m0', 'my.jwt.token');
      const parsed = parseClientMessage(msg);
      expect(parsed.t).toBe('auth');
      if (parsed.t === 'auth') expect(parsed.p.token).toBe('my.jwt.token');
    });

    it('rejects an empty token', () => {
      expect(() =>
        parseClientMessage({ v: PROTOCOL_VERSION, id: 'm0', t: 'auth', p: { token: '' } })
      ).toThrow(ProtocolError);
    });
  });

  describe('ping', () => {
    it('accepts a valid ping message', () => {
      const msg = createPingMessage('m3');
      expect(parseClientMessage(msg).t).toBe('ping');
    });
  });

  describe('protocol version', () => {
    it('rejects a message with an unsupported version', () => {
      expect(() => parseClientMessage({ v: 999, id: 'm1', t: 'ping', p: {} })).toThrow(
        ProtocolError
      );
    });

    it('rejects a message with a missing version', () => {
      expect(() => parseClientMessage({ id: 'm1', t: 'ping', p: {} })).toThrow(ProtocolError);
    });

    it('rejects a non-object message', () => {
      expect(() => parseClientMessage('not an object')).toThrow(ProtocolError);
      expect(() => parseClientMessage(null)).toThrow(ProtocolError);
      expect(() => parseClientMessage(42)).toThrow(ProtocolError);
    });

    it('rejects an unknown message type', () => {
      expect(() =>
        parseClientMessage({ v: PROTOCOL_VERSION, id: 'm1', t: 'unknown', p: {} })
      ).toThrow(ProtocolError);
    });
  });
});

// ---------------------------------------------------------------------------
// parseServerMessage
// ---------------------------------------------------------------------------

describe('parseServerMessage', () => {
  const vclock = { t: 1719216000, i: 1 };

  it('accepts a valid snap message', () => {
    const msg = createSnapshotMessage('ev1', vclock, 'mydb', 'tasks', 'abc123', { title: 'Hello' });
    const parsed = parseServerMessage(msg);
    expect(parsed.t).toBe('snap');
    if (parsed.t === 'snap') {
      expect(parsed.p.db).toBe('mydb');
      expect(parsed.p.coll).toBe('tasks');
      expect(parsed.p.id).toBe('abc123');
      expect(parsed.p.doc).toEqual({ title: 'Hello' });
    }
  });

  it('accepts a snap message with null doc', () => {
    const msg = createSnapshotMessage('ev1', vclock, 'mydb', 'tasks', 'abc123', null);
    const parsed = parseServerMessage(msg);
    if (parsed.t === 'snap') expect(parsed.p.doc).toBeNull();
  });

  it('accepts a valid upd message', () => {
    const msg = createUpdateMessage('ev2', vclock, 'mydb', 'tasks', 'abc123', { done: true });
    expect(parseServerMessage(msg).t).toBe('upd');
  });

  it('accepts a valid del message', () => {
    const msg = createDeleteMessage('ev3', vclock, 'mydb', 'tasks', 'abc123');
    expect(parseServerMessage(msg).t).toBe('del');
  });

  it('accepts a valid pong message', () => {
    expect(parseServerMessage(createPongMessage('m3')).t).toBe('pong');
  });

  it('accepts a valid err message', () => {
    const msg = createErrorMessage('m1', ErrorCodes.SERVER_ERROR, 'Internal error');
    const parsed = parseServerMessage(msg);
    expect(parsed.t).toBe('err');
    if (parsed.t === 'err') {
      expect(parsed.p.code).toBe(ErrorCodes.SERVER_ERROR);
      expect(parsed.p.message).toBe('Internal error');
    }
  });

  it('rejects an unsupported protocol version', () => {
    expect(() =>
      parseServerMessage({
        v: 0,
        id: 'e1',
        t: 'snap',
        vclock,
        p: { db: 'x', coll: 'x', id: 'x', doc: null },
      })
    ).toThrow(ProtocolError);
  });
});

// ---------------------------------------------------------------------------
// Factory function immutability
// ---------------------------------------------------------------------------

describe('factory function immutability', () => {
  it('createSubscribeMessage returns a frozen object', () => {
    const msg = createSubscribeMessage('m1', 'db', 'coll', 'id');
    expect(Object.isFrozen(msg)).toBe(true);
    expect(Object.isFrozen(msg.p)).toBe(true);
  });

  it('createSnapshotMessage returns a frozen object', () => {
    const msg = createSnapshotMessage('e1', { t: 1, i: 1 }, 'db', 'coll', 'id', null);
    expect(Object.isFrozen(msg)).toBe(true);
  });
});
