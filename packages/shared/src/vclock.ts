import { z } from 'zod';

/**
 * A vector clock derived from MongoDB's `clusterTime` (a BSON Timestamp).
 *
 * `t` — Unix seconds (high 32 bits of the oplog timestamp).
 * `i` — Ordinal increment within that second (low 32 bits).
 *
 * Two events from the same Replica Set are causally ordered by comparing
 * `(t, i)` lexicographically. Events from different replica sets are not
 * directly comparable and should be treated as concurrent.
 */
export const VClockSchema = z.object({
  t: z.number().int().nonnegative(),
  i: z.number().int().nonnegative(),
});

export type VClock = Readonly<z.infer<typeof VClockSchema>>;

/**
 * Returns `true` if `incoming` is strictly newer than `current`.
 *
 * A null or undefined `current` is treated as "no prior event seen",
 * so any incoming clock is considered newer.
 */
export function isNewer(incoming: VClock, current: VClock | null | undefined): boolean {
  if (!current) return true;
  if (incoming.t > current.t) return true;
  if (incoming.t === current.t && incoming.i > current.i) return true;
  return false;
}
