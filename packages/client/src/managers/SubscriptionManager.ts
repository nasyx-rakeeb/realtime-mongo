/** Callback invoked with the document state on every snapshot or update. */
export type SnapshotCallback<TDoc = Record<string, any>> = (doc: TDoc | null) => void;

/** Callback invoked when a subscription-level error occurs (e.g. auth denied). */
export type ErrorCallback = (error: Error) => void;

interface ActiveSubscription {
  db: string;
  coll: string;
  docId: string;
  callbacks: Set<SnapshotCallback>;
  errorCallbacks: Set<ErrorCallback>;
}

/**
 * Maintains the set of active document subscriptions and dispatches
 * incoming server messages to the correct callbacks.
 *
 * Composite keys (`db\x00coll\x00docId`) provide O(1) lookup for both
 * incoming event routing and unsubscribe cleanup. Null-byte delimiters
 * prevent key collisions between values that contain dots or slashes.
 *
 * Multiple `onSnapshot` callers on the same `(db, coll, docId)` tuple share
 * a single network subscription. The underlying `sub` message is sent only
 * when the first caller subscribes, and the `unsub` message is sent only
 * when the last caller unsubscribes.
 */
export class SubscriptionManager {
  private subscriptions = new Map<string, ActiveSubscription>();
  private onSubscribeNeeded?: (db: string, coll: string, docId: string) => void;
  private onUnsubscribeNeeded?: (db: string, coll: string, docId: string) => void;

  /**
   * Registers the transport-level send callbacks.
   * Called once during client initialization.
   */
  public setTransportHooks(
    onSub: (db: string, coll: string, docId: string) => void,
    onUnsub: (db: string, coll: string, docId: string) => void
  ): void {
    this.onSubscribeNeeded = onSub;
    this.onUnsubscribeNeeded = onUnsub;
  }

  private getKey(db: string, coll: string, docId: string): string {
    return `${db}\x00${coll}\x00${docId}`;
  }

  /**
   * Adds a callback to the subscription for `(db, coll, docId)`.
   * Sends a `sub` message over the wire only on the first caller.
   *
   * @returns An unsubscribe function that removes this specific callback.
   */
  public subscribe(
    db: string,
    coll: string,
    docId: string,
    callback: SnapshotCallback,
    onError?: ErrorCallback
  ): () => void {
    const key = this.getKey(db, coll, docId);
    let sub = this.subscriptions.get(key);
    let isFirst = false;

    if (!sub) {
      sub = { db, coll, docId, callbacks: new Set(), errorCallbacks: new Set() };
      this.subscriptions.set(key, sub);
      isFirst = true;
    }

    sub.callbacks.add(callback);
    if (onError) sub.errorCallbacks.add(onError);

    if (isFirst) {
      this.onSubscribeNeeded?.(db, coll, docId);
    }

    return () => this.removeCallback(db, coll, docId, callback, onError);
  }

  private removeCallback(
    db: string,
    coll: string,
    docId: string,
    callback: SnapshotCallback,
    onError?: ErrorCallback
  ): void {
    const key = this.getKey(db, coll, docId);
    const sub = this.subscriptions.get(key);
    if (!sub) return;

    sub.callbacks.delete(callback);
    if (onError) sub.errorCallbacks.delete(onError);

    if (sub.callbacks.size === 0) {
      this.subscriptions.delete(key);
      this.onUnsubscribeNeeded?.(db, coll, docId);
    }
  }

  /**
   * Re-sends `sub` messages for all active subscriptions.
   * Called by `ConnectionManager` after a successful reconnect.
   */
  public flushAllSubscriptions(): void {
    if (!this.onSubscribeNeeded) return;
    for (const sub of this.subscriptions.values()) {
      this.onSubscribeNeeded(sub.db, sub.coll, sub.docId);
    }
  }

  /**
   * Looks up a subscription by its composite key.
   * Used to route `snap`, `upd`, and `del` messages from the server.
   */
  public findByKey(db: string, coll: string, docId: string): ActiveSubscription | undefined {
    return this.subscriptions.get(this.getKey(db, coll, docId));
  }

  /** Dispatches a document state to all callbacks for the given key. */
  public notify(db: string, coll: string, docId: string, doc: Record<string, any> | null): void {
    const sub = this.subscriptions.get(this.getKey(db, coll, docId));
    if (!sub) return;
    for (const callback of sub.callbacks) {
      try {
        callback(doc);
      } catch (e) {
        console.error('[SubscriptionManager] onSnapshot callback threw:', e);
      }
    }
  }

  /** Dispatches an error to all error callbacks for the given key. */
  public notifyError(db: string, coll: string, docId: string, error: Error): void {
    const sub = this.subscriptions.get(this.getKey(db, coll, docId));
    if (!sub) return;
    for (const cb of sub.errorCallbacks) {
      try {
        cb(error);
      } catch (e) {
        console.error('[SubscriptionManager] onSnapshot error callback threw:', e);
      }
    }
  }

  public clear(): void {
    this.subscriptions.clear();
  }
}
