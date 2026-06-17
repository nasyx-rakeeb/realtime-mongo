import { ServerMessage, createUpdateMessage, createDeleteMessage } from '@realtimemongo/shared';
import {
  IChangeStreamManager,
  IChangeSource,
  ISubscriptionManager,
  IConnectionManager,
} from '../interfaces';

/**
 * Bridges MongoDB change events to connected WebSocket clients.
 *
 * Listens to the shared `MongoChangeSource` event stream, determines which
 * connections are subscribed to the changed document via `SubscriptionManager`,
 * formats the appropriate protocol message (`upd` or `del`), and broadcasts
 * it via `ConnectionManager`.
 */
export class ChangeStreamManager implements IChangeStreamManager {
  private eventIdCounter = 0;

  constructor(
    private readonly changeSource: IChangeSource,
    private readonly subscriptionManager: ISubscriptionManager,
    private readonly connectionManager: IConnectionManager
  ) {}

  private generateEventId(): string {
    return `ev_${Date.now()}_${++this.eventIdCounter}`;
  }

  /**
   * Registers the event listener on the MongoDB change source.
   * This should be called exactly once during server startup.
   */
  public start(): void {
    this.changeSource.onChange((event) => {
      const { db, coll, docId } = event;

      const subscribers = this.subscriptionManager.getSubscribers(db, coll, docId);
      if (subscribers.size === 0) return;

      const eventId = this.generateEventId();
      let message: ServerMessage;

      if (event.type === 'update') {
        message = createUpdateMessage(eventId, event.vclock, db, coll, docId, event.doc);
      } else {
        message = createDeleteMessage(eventId, event.vclock, db, coll, docId);
      }

      for (const connectionId of subscribers) {
        this.connectionManager.sendTo(connectionId, message);
      }
    });
  }

  /**
   * Stops the ChangeStreamManager.
   *
   * Note: This does NOT close the underlying MongoDB connection. The lifecycle
   * of the database client is the responsibility of the caller (`factory.ts`).
   */
  public stop(): void {
    // The change source's onChange handlers are stateless synchronous callbacks;
    // stopping the flow of events is achieved by closing the MongoChangeSource.
  }
}
