import { describe, it, expect } from 'vitest';
import { isNewer, VClock } from '../src';

describe('VClock ordering', () => {
  describe('isNewer', () => {
    it('returns true when the incoming clock has a greater t', () => {
      const a: VClock = { t: 2, i: 1 };
      const b: VClock = { t: 1, i: 9 };
      expect(isNewer(a, b)).toBe(true);
    });

    it('returns true when t is equal and incoming i is greater', () => {
      const a: VClock = { t: 5, i: 3 };
      const b: VClock = { t: 5, i: 2 };
      expect(isNewer(a, b)).toBe(true);
    });

    it('returns false when clocks are identical', () => {
      const a: VClock = { t: 5, i: 3 };
      expect(isNewer(a, a)).toBe(false);
    });

    it('returns false when the incoming clock is older (lower t)', () => {
      const a: VClock = { t: 1, i: 9 };
      const b: VClock = { t: 2, i: 1 };
      expect(isNewer(a, b)).toBe(false);
    });

    it('returns false when t is equal and incoming i is not greater', () => {
      const a: VClock = { t: 5, i: 2 };
      const b: VClock = { t: 5, i: 3 };
      expect(isNewer(a, b)).toBe(false);
    });

    it('handles zero-value clocks', () => {
      const zero: VClock = { t: 0, i: 0 };
      const one: VClock = { t: 0, i: 1 };
      expect(isNewer(one, zero)).toBe(true);
      expect(isNewer(zero, one)).toBe(false);
    });

    it('handles large oplog increment values', () => {
      const a: VClock = { t: 1719216000, i: 999999 };
      const b: VClock = { t: 1719216000, i: 999998 };
      expect(isNewer(a, b)).toBe(true);
    });
  });
});
