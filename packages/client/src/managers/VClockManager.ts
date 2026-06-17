import { VClock, isNewer } from '@realtimemongo/shared';

/**
 * Tracks the highest seen VClock for each subscribed document.
 * Used to enforce causal consistency by rejecting stale updates that
 * arrive out-of-order due to network delays or connection multiplexing.
 */
export class VClockManager {
  private clocks = new Map<string, VClock>();

  private getKey(db: string, coll: string, docId: string): string {
    return `${db}\x00${coll}\x00${docId}`;
  }

  /**
   * Compares the incoming event clock against the highest seen local clock.
   * If the incoming clock is strictly newer (or no local clock exists), the
   * local cache is updated and this returns `true`.
   * If the incoming clock is equal or older, the event is considered stale
   * and this returns `false`.
   */
  public evaluateAndCache(
    db: string,
    coll: string,
    docId: string,
    incomingVClock: VClock
  ): boolean {
    const key = this.getKey(db, coll, docId);
    const localVClock = this.clocks.get(key);

    if (!localVClock || isNewer(incomingVClock, localVClock)) {
      this.clocks.set(key, incomingVClock);
      return true;
    }

    return false;
  }

  public getClock(db: string, coll: string, docId: string): VClock | undefined {
    return this.clocks.get(this.getKey(db, coll, docId));
  }

  public removeClock(db: string, coll: string, docId: string): void {
    this.clocks.delete(this.getKey(db, coll, docId));
  }

  public clear(): void {
    this.clocks.clear();
  }
}
