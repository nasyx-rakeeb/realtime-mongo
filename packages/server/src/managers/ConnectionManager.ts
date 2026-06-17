import {
  ClientMessage,
  ServerMessage,
  createSnapshotMessage,
  createPongMessage,
  createErrorMessage,
  ErrorCodes,
} from '@realtimemongo/shared';
import {
  IConnection,
  IConnectionManager,
  ISubscriptionManager,
  IChangeSource,
} from '../interfaces';
import { CollectionNotRegisteredError } from '../mongo/MongoChangeSource';

/**
 * Processes parsed protocol messages for a set of active connections.
 *
 * Responsible for the message lifecycle within a single connection:
 * subscribe, unsubscribe, ping/pong, and dispatching initial snapshots.
 * Auth messages are fully handled by the transport layer before reaching
 * this class.
 *
 * Error discrimination: `CollectionNotRegisteredError` is a client-caused
 * error and receives the `COLLECTION_NOT_REGISTERED` code. All other errors
 * are unexpected server failures and receive `SERVER_ERROR`.
 */
export class ConnectionManager implements IConnectionManager {
  private connections = new Map<string, IConnection>();

  constructor(
    private readonly subscriptionManager: ISubscriptionManager,
    private readonly changeSource: IChangeSource
  ) {}

  public addConnection(connection: IConnection): void {
    this.connections.set(connection.id, connection);
  }

  /**
   * Removes a connection and cleans up all its active subscriptions.
   * Called by the transport layer on WebSocket close.
   */
  public removeConnection(connectionId: string): void {
    this.connections.delete(connectionId);
    this.subscriptionManager.unsubscribeAll(connectionId);
  }

  public async handleMessage(connectionId: string, message: ClientMessage): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    try {
      if (message.t === 'sub') {
        const { db, coll, id: docId } = message.p;
        this.subscriptionManager.subscribe(connectionId, db, coll, docId);
        const { doc, vclock } = await this.changeSource.fetchSnapshot(db, coll, docId);
        connection.send(createSnapshotMessage(message.id, vclock, db, coll, docId, doc));
      } else if (message.t === 'unsub') {
        const { db, coll, id: docId } = message.p;
        this.subscriptionManager.unsubscribe(connectionId, db, coll, docId);
      } else if (message.t === 'ping') {
        connection.send(createPongMessage(message.id));
      }
      // 'auth' messages are consumed by the transport layer and never reach here.
    } catch (err) {
      if (err instanceof CollectionNotRegisteredError) {
        connection.send(
          createErrorMessage(message.id, ErrorCodes.COLLECTION_NOT_REGISTERED, err.message)
        );
      } else {
        console.error('[ConnectionManager] Unexpected error handling message:', err);
        connection.send(
          createErrorMessage(message.id, ErrorCodes.SERVER_ERROR, 'Internal server error')
        );
      }
    }
  }

  /** Sends a server-initiated message to a specific connection. Used by fan-out. */
  public sendTo(connectionId: string, message: ServerMessage): void {
    this.connections.get(connectionId)?.send(message);
  }

  /** Closes all open connections. Called during graceful server shutdown. */
  public closeAll(): void {
    for (const connection of this.connections.values()) {
      connection.close(1000, 'Server shutting down');
    }
    this.connections.clear();
  }
}
