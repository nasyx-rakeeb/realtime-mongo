/**
 * Token Bucket Rate Limiter configuration.
 */
export interface RateLimitConfig {
  /** Maximum number of burst tokens available. Default: 50. */
  capacity: number;
  /** Number of tokens replenished per second. Default: 10. */
  refillRate: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  capacity: 50,
  refillRate: 10,
};

/**
 * A fast, synchronous Token Bucket rate limiter.
 *
 * Chosen for WebSocket transports because it allows short bursts of traffic
 * (e.g. sending multiple concurrent `sub` messages on page load) while
 * strictly enforcing a long-term average message rate to prevent CPU exhaustion.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG) {
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Attempts to consume a single token.
   * @returns `true` if successful, `false` if the bucket is empty (rate limited).
   */
  public tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const timePassedMs = now - this.lastRefill;

    if (timePassedMs > 0) {
      const newTokens = (timePassedMs / 1000) * this.refillRate;
      this.tokens = Math.min(this.capacity, this.tokens + newTokens);
      this.lastRefill = now;
    }
  }
}
