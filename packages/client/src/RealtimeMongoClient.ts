import { ConnectionManager, ConnectionState, ReconnectConfig } from './managers/ConnectionManager';
import {
  SubscriptionManager,
  SnapshotCallback,
  ErrorCallback,
} from './managers/SubscriptionManager';
import { VClockManager } from './managers/VClockManager';
import {
  ServerMessage,
  createSubscribeMessage,
  createUnsubscribeMessage,
  createAuthMessage,
} from '@realtimemongo/shared';

/** Unsubscribe function returned by onSnapshot. Call it to stop receiving updates. */
export type Unsubscribe = () => void;

export { ConnectionState, ReconnectConfig, SnapshotCallback, ErrorCallback };

export interface RealtimeMongoClientOptions {
  /**
   * WebSocket server URL, e.g. 'ws://localhost:8080' or 'wss://api.example.com'
   */
  url: string;
  /**
   * The default database name used by client.collection(). Default: 'default'
   */
  db?: string;
  /**
   * Custom WebSocket implementation. Required in Node.js environments.
   * @example
   * import WebSocket from 'ws';
   * new RealtimeMongoClient({ url, WebSocketImpl: WebSocket });
   */
  WebSocketImpl?: any;
  /**
   * Auth token sent to the server after connecting.
   * The server must have auth.verify configured to validate it.
   */
  token?: string;
  /**
   * Reconnection configuration.
   */
  reconnect?: ReconnectConfig;
}

/**
 * A reference to a single document in a collection.
 */
export class DocumentReference<TDoc = Record<string, any>> {
  constructor(
    private readonly _client: RealtimeMongoClient,
    private readonly _db: string,
    private readonly _coll: string,
    private readonly _docId: string
  ) {}

  /**
   * Subscribes to real-time updates for this document.
   *
   * The callback is called immediately with the current document state (snapshot),
   * and again on every subsequent change.
   *
   * @param onNext - Called with the document data, or `null` if the document is deleted.
   * @param onError - Called when a subscription-level error occurs (e.g. auth failure).
   * @returns An unsubscribe function. Call it to stop listening and clean up.
   *
   * @example
   * ```ts
   * const unsubscribe = client.collection('users').doc(userId).onSnapshot(
   *   (doc) => setUser(doc),
   *   (err) => console.error('Subscription error', err)
   * );
   * // Stop listening:
   * unsubscribe();
   * ```
   */
  public onSnapshot(onNext: SnapshotCallback<TDoc>, onError?: ErrorCallback): Unsubscribe {
    return this._client._subscribe(
      this._db,
      this._coll,
      this._docId,
      onNext as SnapshotCallback,
      onError
    );
  }
}

/**
 * A reference to a collection within a specific database.
 */
export class CollectionReference<TDoc = Record<string, any>> {
  constructor(
    private readonly _client: RealtimeMongoClient,
    private readonly _db: string,
    private readonly _coll: string
  ) {}

  /**
   * Returns a reference to a specific document in this collection.
   * @param docId - The document ID (MongoDB ObjectId hex string or custom string ID)
   */
  public doc(docId: string): DocumentReference<TDoc> {
    return new DocumentReference<TDoc>(this._client, this._db, this._coll, docId);
  }
}

/**
 * A reference to a named database. Used in multi-database setups via `client.db('name')`.
 */
export class DatabaseReference {
  constructor(
    private readonly _client: RealtimeMongoClient,
    private readonly _dbName: string
  ) {}

  /**
   * Returns a CollectionReference for the specified collection in this database.
   */
  public collection<TDoc = Record<string, any>>(coll: string): CollectionReference<TDoc> {
    return new CollectionReference<TDoc>(this._client, this._dbName, coll);
  }
}

/**
 * The main realtime-mongo client.
 *
 * Connects to a `@realtimemongo/server` instance and provides real-time
 * document subscriptions with Firestore-like ergonomics.
 *
 * @example
 * ```ts
 * const client = new RealtimeMongoClient({
 *   url: 'ws://localhost:8080',
 *   db: 'mydb',
 * });
 *
 * const unsubscribe = client
 *   .collection<Task>('tasks')
 *   .doc(taskId)
 *   .onSnapshot((task) => {
 *     console.log('Task updated:', task);
 *   });
 *
 * // When done:
 * client.close();
 * ```
 */
export class RealtimeMongoClient {
  private readonly connectionManager: ConnectionManager;
  private readonly subscriptionManager: SubscriptionManager;
  private readonly vclockManager: VClockManager;
  private readonly defaultDb: string;
  private readonly token: string | undefined;

  private _connectionState: ConnectionState = 'disconnected';
  private connectionStateHandlers: Array<(state: ConnectionState) => void> = [];
  private globalErrorHandlers: Array<(error: Error) => void> = [];
  private msgIdCounter = 0;

  constructor(options: RealtimeMongoClientOptions) {
    this.defaultDb = options.db ?? 'default';
    this.token = options.token;

    this.vclockManager = new VClockManager();
    this.subscriptionManager = new SubscriptionManager();

    this.connectionManager = new ConnectionManager({
      url: options.url,
      WebSocketImpl: options.WebSocketImpl,
      reconnect: options.reconnect,
      onStateChange: (state) => {
        this._connectionState = state;
        for (const handler of this.connectionStateHandlers) {
          try {
            handler(state);
          } catch (e) {
            console.error('onConnectionStateChange callback error:', e);
          }
        }
      },
      onOpen: () => {
        if (this.token) {
          this.connectionManager.send(createAuthMessage(this.nextMsgId(), this.token));
        }
        this.subscriptionManager.flushAllSubscriptions();
      },
      onMessage: (msg: ServerMessage) => this.handleServerMessage(msg),
    });

    this.subscriptionManager.setTransportHooks(
      (db, coll, docId) => {
        // Connect lazily on first subscription. If already reconnecting,
        // flushAllSubscriptions() in onOpen will handle re-sending this sub.
        this.connectionManager.connect();
        if (this.connectionManager.isConnected()) {
          this.connectionManager.send(createSubscribeMessage(this.nextMsgId(), db, coll, docId));
        }
      },
      (db, coll, docId) => {
        if (this.connectionManager.isConnected()) {
          this.connectionManager.send(createUnsubscribeMessage(this.nextMsgId(), db, coll, docId));
        }
        this.vclockManager.removeClock(db, coll, docId);
      }
    );
  }

  private nextMsgId(): string {
    return `m${++this.msgIdCounter}`;
  }

  /**
   * Returns a CollectionReference using the default database.
   *
   * @example
   * ```ts
   * client.collection<User>('users').doc(userId).onSnapshot(cb);
   * ```
   */
  public collection<TDoc = Record<string, any>>(coll: string): CollectionReference<TDoc> {
    return new CollectionReference<TDoc>(this, this.defaultDb, coll);
  }

  /**
   * Returns a DatabaseReference for the specified database name.
   * Use this for multi-database setups.
   *
   * @example
   * ```ts
   * client.db('analytics').collection('events').doc(id).onSnapshot(cb);
   * ```
   */
  public db(dbName: string): DatabaseReference {
    return new DatabaseReference(this, dbName);
  }

  /**
   * The current connection state.
   */
  public get connectionState(): ConnectionState {
    return this._connectionState;
  }

  /**
   * Explicitly opens the WebSocket connection.
   * This is optional; the client will automatically connect when the first
   * subscription is created via `collection().doc().onSnapshot()`.
   */
  public connect(): void {
    this.connectionManager.connect();
  }

  /**
   * Registers a callback for connection state changes.
   *
   * @param callback - Called whenever the state changes.
   * @returns An unsubscribe function.
   *
   * @example
   * ```ts
   * const unsub = client.onConnectionStateChange((state) => {
   *   console.log('Connection state:', state);
   * });
   * ```
   */
  public onConnectionStateChange(callback: (state: ConnectionState) => void): Unsubscribe {
    this.connectionStateHandlers.push(callback);
    return () => {
      this.connectionStateHandlers = this.connectionStateHandlers.filter((h) => h !== callback);
    };
  }

  /**
   * Registers a global error handler.
   * Called when the server sends an error that has no specific subscription context.
   *
   * @param callback - Called with an Error object.
   * @returns An unsubscribe function.
   */
  public onError(callback: (error: Error) => void): Unsubscribe {
    this.globalErrorHandlers.push(callback);
    return () => {
      this.globalErrorHandlers = this.globalErrorHandlers.filter((h) => h !== callback);
    };
  }

  /**
   * @internal Used by {@link DocumentReference}. Not part of the public API.
   * Use `collection().doc().onSnapshot()` instead.
   */
  public _subscribe(
    db: string,
    coll: string,
    docId: string,
    callback: SnapshotCallback,
    onError?: ErrorCallback
  ): Unsubscribe {
    return this.subscriptionManager.subscribe(db, coll, docId, callback, onError);
  }

  private handleServerMessage(msg: ServerMessage): void {
    if (msg.t === 'snap' || msg.t === 'upd') {
      const { db, coll, id: docId, doc } = msg.p;
      if (this.vclockManager.evaluateAndCache(db, coll, docId, msg.vclock)) {
        this.subscriptionManager.notify(db, coll, docId, msg.t === 'upd' ? doc : (doc ?? null));
      }
    } else if (msg.t === 'del') {
      const { db, coll, id: docId } = msg.p;
      if (this.vclockManager.evaluateAndCache(db, coll, docId, msg.vclock)) {
        this.subscriptionManager.notify(db, coll, docId, null);
      }
    } else if (msg.t === 'err') {
      const error = new Error(`[${msg.p.code}] ${msg.p.message}`);
      (error as any).code = msg.p.code;
      for (const handler of this.globalErrorHandlers) {
        try {
          handler(error);
        } catch (e) {
          console.error('[RealtimeMongoClient] onError callback threw:', e);
        }
      }
    }
    // 'pong' messages require no action — they are echoes of client ping messages.
  }

  /**
   * Closes the WebSocket connection and clears all subscriptions and clocks.
   * After calling this, the client cannot be reused.
   */
  public close(): void {
    this.connectionManager.close();
    this.subscriptionManager.clear();
    this.vclockManager.clear();
    this.connectionStateHandlers = [];
    this.globalErrorHandlers = [];
  }
}
