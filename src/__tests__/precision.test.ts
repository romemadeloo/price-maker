import { describe, expect, it } from 'vitest';
import { reconstructPrice, solveRate } from '../lib/precision';
import { D, roundToWon } from '../lib/decimal';

/**
 * These tests exist to protect the one property the whole app is for:
 * the EXPORTED decimal string must rebuild the expected price to the won.
 */

describe('solveRate — simple case (spec §23)', () => {
  it('area 625 x qty 10 -> 2500 gives 0.4 and reconstructs exactly', () => {
    const r = solveRate(625, 10, 2500);
    expect(r.exportRate).toBe('0.4');
    expect(r.reconstructed.toFixed()).toBe('2500');
    expect(r.difference.toFixed()).toBe('0');
    expect(r.ok).toBe(true);
  });

  it('strips trailing zeros without losing value', () => {
    expect(solveRate(625, 20, 4700).exportRate).toBe('0.376');
    expect(solveRate(100, 10, 1900).exportRate).toBe('1.9');
    expect(solveRate(100, 20, 3600).exportRate).toBe('1.8');
  });
});

describe('solveRate — repeating decimal (spec §23)', () => {
  it('area 225 x qty 30 -> 5800 exports enough precision to rebuild 5800', () => {
    const r = solveRate(225, 30, 5800);
    // 5800 / 6750 = 0.859259259259...
    expect(r.exactDisplay.startsWith('0.8592592592592592592')).toBe(true);
    expect(r.exportRate).toBe('0.8592592593');
    expect(r.reconstructed.toFixed()).toBe('5800');
    expect(r.difference.isZero()).toBe(true);
    expect(r.ok).toBe(true);
    // And the exported string alone must be enough.
    expect(reconstructPrice(225, 30, r.exportRate).toFixed()).toBe('5800');
  });

  it('handles a 1/3-style repeating rate', () => {
    const r = solveRate(100, 30, 5300);
    expect(reconstructPrice(100, 30, r.exportRate).toFixed()).toBe('5300');
    expect(r.ok).toBe(true);
  });
});

describe('solveRate — large precision-sensitive price (spec §6, §23)', () => {
  it('area 366000 x qty 30000 -> 155,793,118 reconstructs to the exact won', () => {
    const r = solveRate(366000, 30000, 155793118);

    expect(r.exactDisplay.startsWith('0.01418880856')).toBe(true);
    expect(r.reconstructed.toFixed()).toBe('155793118');
    expect(r.difference.toFixed()).toBe('0');
    expect(r.ok).toBe(true);

    // Explicitly NOT the values the spec calls out as regressions.
    expect(r.reconstructed.toFixed()).not.toBe('155793120');
    expect(r.reconstructed.toFixed()).not.toBe('155793119');
    expect(r.reconstructed.toFixed()).not.toBe('155793117');

    // The exported string on its own must do the job.
    expect(reconstructPrice(366000, 30000, r.exportRate).toFixed()).toBe('155793118');
  });
});

describe('solveRate — insufficient precision is detected (spec §23 error test)', () => {
  it('a deliberately truncated rate produces a detectable won-level mismatch', () => {
    const area = 366000;
    const qty = 30000;
    const expected = 155793118;

    // Truncate the exact rate to 8 decimal places — below what this cell needs.
    const exact = new D(expected).div(new D(area).times(qty));
    const truncated = exact.toDecimalPlaces(8, 1 /* ROUND_DOWN */).toFixed(8);
    const rebuilt = roundToWon(new D(area).times(qty).times(new D(truncated)));

    expect(rebuilt.toFixed()).not.toBe('155793118');
    const diff = rebuilt.minus(expected);
    expect(diff.isZero()).toBe(false);
    // The kind of off-by-a-few-won error the spec wants surfaced.
    expect(diff.abs().lessThan(200)).toBe(true);
  });

  it('capping the search below the required precision reports NEEDS REVIEW', () => {
    const r = solveRate(366000, 30000, 155793118, 2, 5);
    expect(r.ok).toBe(false);
    expect(r.difference.isZero()).toBe(false);
    expect(r.decimalPlaces).toBe(5);
  });

  it('still passes when the search starts low but is allowed to grow', () => {
    const r = solveRate(366000, 30000, 155793118, 2, 18);
    expect(r.ok).toBe(true);
    expect(reconstructPrice(366000, 30000, r.exportRate).toFixed()).toBe('155793118');
  });
});

describe('solveRate — no premature rounding across a wide sweep', () => {
  it('reproduces every price in a large deterministic sweep', () => {
    const areas = [100, 225, 400, 625, 366000, 123457, 999983, 1, 7];
    const quantities = [10, 20, 30, 40, 50, 100, 300, 1000, 3000, 10000, 30000, 70000, 100000];

    let checked = 0;
    for (const area of areas) {
      for (const qty of quantities) {
        // A spread of awkward prices, including primes and near-boundary values.
        for (const price of [1, 7, 1900, 155793118, 2907, 99999999, area * qty + 1]) {
          const r = solveRate(area, qty, price);
          expect(r.ok, `area=${area} qty=${qty} price=${price} rate=${r.exportRate}`).toBe(true);
          expect(reconstructPrice(area, qty, r.exportRate).toFixed()).toBe(String(price));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(700);
  });

  it('never emits exponential notation, even for tiny rates', () => {
    const r = solveRate(999983, 100000, 1);
    expect(r.exportRate).not.toMatch(/[eE]/);
    expect(reconstructPrice(999983, 100000, r.exportRate).toFixed()).toBe('1');
  });
});

describe('solveRate — guards', () => {
  it('rejects a zero divisor', () => {
    expect(() => solveRate(0, 10, 100)).toThrow();
    expect(() => solveRate(100, 0, 100)).toThrow();
  });

  it('handles a zero expected price', () => {
    const r = solveRate(625, 10, 0);
    expect(r.exportRate).toBe('0');
    expect(r.ok).toBe(true);
  });
});
