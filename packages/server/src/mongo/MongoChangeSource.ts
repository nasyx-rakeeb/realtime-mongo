import { MongoClient, ChangeStream, ChangeStreamDocument, Timestamp, ObjectId } from 'mongodb';
import { IChangeSource, ChangeEvent } from '../interfaces';
import { VClock } from '@realtimemongo/shared';

/**
 * Thrown when a subscription or snapshot request targets a collection that
 * has not been registered via `registerCollection`. Treated as a client error
 * (not a server error) so the correct error code is sent back to the subscriber.
 */
export class CollectionNotRegisteredError extends Error {
  constructor(db: string, coll: string) {
    super(`Collection ${db}.${coll} is not registered`);
    this.name = 'CollectionNotRegisteredError';
  }
}

/**
 * Connects to MongoDB and exposes Change Stream events as a typed event stream.
 *
 * One database-level Change Stream is opened per database. The stream watches
 * all collections in the database and filters events to registered collections
 * only, which avoids opening a stream per collection and reduces MongoDB
 * cursor overhead.
 *
 * Resume tokens are stored per database. On reconnection, the stream restarts
 * from the last known position so no change events are silently missed.
 */
export class MongoChangeSource implements IChangeSource {
  private client: MongoClient;
  private changeStreams = new Map<string, ChangeStream>();
  private resumeTokens = new Map<string, any>();
  private registeredCollections = new Set<string>();
  private handlers: ((event: ChangeEvent) => void)[] = [];
  private isClosed = false;

  constructor(uri: string) {
    this.client = new MongoClient(uri);
  }

  public async connect(): Promise<void> {
    await this.client.connect();
  }

  private getCollectionKey(db: string, coll: string): string {
    return `${db}:${coll}`;
  }

  /**
   * Registers a collection for event delivery. Idempotent — calling this
   * multiple times for the same collection has no effect.
   *
   * Triggers `watchDatabase` for the collection's database if a stream for
   * that database is not already open.
   */
  public registerCollection(db: string, coll: string): void {
    const key = this.getCollectionKey(db, coll);
    if (this.registeredCollections.has(key)) return;
    this.registeredCollections.add(key);
    this.watchDatabase(db);
  }

  /**
   * Opens a Change Stream for `db` and routes events to registered handlers.
   *
   * Reconnects with exponential backoff on error or unexpected close.
   * The backoff resets to its initial value when the stream has been healthy
   * for more than 60 seconds, preventing permanent long delays after a
   * transient infrastructure issue.
   */
  private watchDatabase(db: string, backoffMs = 1000): void {
    if (this.isClosed) return;
    if (this.changeStreams.has(db)) return;

    const database = this.client.db(db);
    const resumeToken = this.resumeTokens.get(db);
    const options: any = { fullDocument: 'updateLookup' };
    if (resumeToken) {
      options.resumeAfter = resumeToken;
    }

    try {
      const changeStream = database.watch([], options);
      const streamStartTime = Date.now();
      this.changeStreams.set(db, changeStream);

      changeStream.on('change', (change: ChangeStreamDocument) => {
        if (change._id) {
          this.resumeTokens.set(db, change._id);
        }

        const vclock = this.extractVClock(change.clusterTime);
        if (!vclock) return;

        const ns = (change as any).ns;
        if (!ns?.coll) return;

        const key = this.getCollectionKey(db, ns.coll);
        if (!this.registeredCollections.has(key)) return;

        const docId = this.parseIdToString((change as any).documentKey?._id);
        if (!docId) return;

        let event: ChangeEvent | null = null;

        if (
          change.operationType === 'insert' ||
          change.operationType === 'update' ||
          change.operationType === 'replace'
        ) {
          event = {
            type: 'update',
            db,
            coll: ns.coll,
            docId,
            doc: change.fullDocument ?? {},
            vclock,
          };
        } else if (change.operationType === 'delete') {
          event = { type: 'delete', db, coll: ns.coll, docId, vclock };
        }

        if (event) {
          for (const handler of this.handlers) {
            try {
              handler(event);
            } catch (e) {
              console.error('[MongoChangeSource] Handler error:', e);
            }
          }
        }
      });

      const scheduleReconnect = () => {
        if (this.isClosed) return;
        this.changeStreams.delete(db);
        const uptime = Date.now() - streamStartTime;
        const nextBackoff = uptime > 60_000 ? 1000 : Math.min(backoffMs * 2, 30_000);
        setTimeout(() => this.watchDatabase(db, nextBackoff), backoffMs);
      };

      changeStream.on('error', (err) => {
        console.error(`[MongoChangeSource] Change stream error for database "${db}":`, err);
        changeStream.close().catch(() => {});
        scheduleReconnect();
      });

      changeStream.on('close', scheduleReconnect);
    } catch (err) {
      console.error(`[MongoChangeSource] Failed to open stream for database "${db}":`, err);
      setTimeout(() => this.watchDatabase(db, Math.min(backoffMs * 2, 30_000)), backoffMs);
    }
  }

  /**
   * Registers a handler that receives all change events for registered collections.
   * Multiple handlers are supported and are called in registration order.
   */
  public onChange(handler: (event: ChangeEvent) => void): void {
    this.handlers.push(handler);
  }

  /**
   * Fetches the current state of a document using a causally consistent session.
   *
   * The session's `operationTime` is used as the VClock for the snapshot,
   * ensuring that any change events with an earlier timestamp are treated as
   * stale and discarded by the client's VClock manager.
   */
  public async fetchSnapshot(
    db: string,
    coll: string,
    docId: string
  ): Promise<{ doc: Record<string, any> | null; vclock: VClock }> {
    const key = this.getCollectionKey(db, coll);
    if (!this.registeredCollections.has(key)) {
      throw new CollectionNotRegisteredError(db, coll);
    }

    const session = this.client.startSession({ causalConsistency: true });
    try {
      const doc = await this.client
        .db(db)
        .collection(coll)
        .findOne({ _id: this.parseStringToId(docId) }, { session });

      const vclock = this.extractVClock(session.operationTime);
      if (!vclock) {
        throw new Error(
          '[MongoChangeSource] Missing operationTime on session. Ensure MongoDB is running as a Replica Set.'
        );
      }

      return { doc, vclock };
    } finally {
      await session.endSession();
    }
  }

  public async close(): Promise<void> {
    this.isClosed = true;
    for (const stream of this.changeStreams.values()) {
      await stream.close().catch(() => {});
    }
    this.changeStreams.clear();
    await this.client.close();
  }

  /**
   * Extracts a VClock from a MongoDB BSON Timestamp.
   * The high 32 bits represent Unix seconds; the low 32 bits represent the
   * oplog increment within that second.
   */
  private extractVClock(timestamp?: Timestamp): VClock | null {
    if (!timestamp) return null;
    return { t: timestamp.high, i: timestamp.low };
  }

  private parseIdToString(id: any): string | null {
    if (!id) return null;
    if (id instanceof ObjectId) return id.toHexString();
    return String(id);
  }

  /**
   * Converts a string ID to the appropriate MongoDB `_id` type.
   * A 24-character hex string is treated as an ObjectId; all other strings
   * are passed through as-is to support custom string primary keys.
   */
  private parseStringToId(id: string): any {
    if (ObjectId.isValid(id) && id.length === 24) {
      return new ObjectId(id);
    }
    return id;
  }
}
