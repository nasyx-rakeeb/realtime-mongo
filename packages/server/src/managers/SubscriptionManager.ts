import { ISubscriptionManager } from '../interfaces';

/**
 * Bidirectional index mapping subscriptions between connections and documents.
 *
 * Two maps are maintained in parallel to support O(1) lookups in both
 * directions:
 * - `subscriptions`: `(db:coll:docId)` → `Set<connectionId>` — used during
 *   fan-out to find all connections that should receive a change event.
 * - `connectionMap`: `connectionId` → `Set<key>` — used when a connection
 *   closes to efficiently remove all its subscriptions without a full scan.
 */
export class SubscriptionManager implements ISubscriptionManager {
  private subscriptions = new Map<string, Set<string>>();
  private connectionMap = new Map<string, Set<string>>();

  private formatKey(db: string, coll: string, docId: string): string {
    return `${db}:${coll}:${docId}`;
  }

  public subscribe(connectionId: string, db: string, coll: string, docId: string): void {
    const key = this.formatKey(db, coll, docId);

    let connectionSet = this.subscriptions.get(key);
    if (!connectionSet) {
      connectionSet = new Set();
      this.subscriptions.set(key, connectionSet);
    }
    connectionSet.add(connectionId);

    let keySet = this.connectionMap.get(connectionId);
    if (!keySet) {
      keySet = new Set();
      this.connectionMap.set(connectionId, keySet);
    }
    keySet.add(key);
  }

  public unsubscribe(connectionId: string, db: string, coll: string, docId: string): void {
    const key = this.formatKey(db, coll, docId);

    const connectionSet = this.subscriptions.get(key);
    if (connectionSet) {
      connectionSet.delete(connectionId);
      if (connectionSet.size === 0) this.subscriptions.delete(key);
    }

    const keySet = this.connectionMap.get(connectionId);
    if (keySet) {
      keySet.delete(key);
      if (keySet.size === 0) this.connectionMap.delete(connectionId);
    }
  }

  /**
   * Removes all subscriptions for a connection.
   * Called when a WebSocket closes to avoid leaving orphaned entries.
   */
  public unsubscribeAll(connectionId: string): void {
    const keySet = this.connectionMap.get(connectionId);
    if (!keySet) return;

    for (const key of keySet) {
      const connectionSet = this.subscriptions.get(key);
      if (connectionSet) {
        connectionSet.delete(connectionId);
        if (connectionSet.size === 0) this.subscriptions.delete(key);
      }
    }

    this.connectionMap.delete(connectionId);
  }

  /** Returns the set of connection IDs subscribed to a specific document. */
  public getSubscribers(db: string, coll: string, docId: string): ReadonlySet<string> {
    return this.subscriptions.get(this.formatKey(db, coll, docId)) ?? new Set();
  }

  /** Returns internal counters for observability and diagnostics. */
  public getMetrics() {
    return {
      activeDocuments: this.subscriptions.size,
      activeConnections: this.connectionMap.size,
    };
  }
}
