import { D, Dec, ROUND_DOWN, ROUND_HALF_UP, ROUND_UP, roundToWon, toPlainString } from './decimal';

/**
 * PRECISION-SENSITIVE CODE — read before editing (spec §5, §6, §7, §15).
 *
 * The expected price is the source of truth. We derive a price-per-mm² rate from
 * it and must be able to rebuild the expected price *from the exact decimal
 * string we write into the CSV* — not from an unrounded in-memory value.
 *
 * Sequence, per cell:
 *   1. exact  = expectedPrice / (baseArea × quantity)      [80 sig digits]
 *   2. export = a decimal string with just enough places
 *   3. recon  = ROUND(baseArea × quantity × export, 0)     [half-up, whole won]
 *   4. pass   = recon === expectedPrice                     [exact integer compare]
 *
 * Everything runs on decimal.js. No JS float arithmetic touches these numbers.
 */

export interface RateSolution {
  /** expectedPrice / (baseArea × quantity), carrying full working precision. */
  exact: Dec;
  /** Human-readable exact rate; ends with '…' when digits were elided. */
  exactDisplay: string;
  /** The EXACT string that will be serialized into the CSV. */
  exportRate: string;
  /** Decimal places the search settled on (before trailing-zero stripping). */
  decimalPlaces: number;
  /** ROUND(baseArea × quantity × exportRate, 0) */
  reconstructed: Dec;
  /** reconstructed - expectedPrice */
  difference: Dec;
  /** True when the exported string reproduces the expected price exactly. */
  ok: boolean;
}

/** How many decimals of the exact rate we surface in the UI before eliding. */
const EXACT_DISPLAY_DP = 20;

/**
 * Find the smallest decimal-place count (starting at `minDecimalPlaces`) whose
 * rounded rate reproduces `expectedPrice` exactly.
 *
 * At each decimal-place count we try three roundings of the exact rate:
 * half-up first (the spec's `round(exactRate, dp)`), then down and up. The two
 * directed roundings cost nothing and rescue the cases where the nearest value
 * lands just past the half-won boundary while a neighbour one ulp away lands
 * inside it — so we can settle on a shorter, still-exact representation instead
 * of spilling into extra digits.
 *
 * If nothing in [min, max] works, we return the most precise candidate with
 * ok=false so the caller can surface NEEDS REVIEW rather than shipping a
 * silently wrong rate.
 */
export function solveRate(
  baseArea: Dec | number | string,
  quantity: Dec | number | string,
  expectedPrice: Dec | number | string,
  minDecimalPlaces = 10,
  maxDecimalPlaces = 18,
  stripTrailingZeros = true,
): RateSolution {
  const area = new D(baseArea as never);
  const qty = new D(quantity as never);
  const expected = new D(expectedPrice as never);

  // baseArea × quantity — the divisor, and the multiplier used to rebuild the
  // price. Exact: both operands are integers well inside our 80-digit budget.
  const divisor = area.times(qty);
  if (divisor.isZero() || divisor.isNegative()) {
    throw new Error('baseArea × quantity must be greater than zero');
  }

  const exact = expected.div(divisor);
  const exactDisplay = renderExactRate(exact);

  const from = Math.max(0, Math.min(minDecimalPlaces, maxDecimalPlaces));
  const to = Math.max(from, maxDecimalPlaces);

  for (let dp = from; dp <= to; dp++) {
    // Half-up matches the spec's pseudo-code; down/up are the cheap neighbours.
    const candidates = [
      exact.toDecimalPlaces(dp, ROUND_HALF_UP),
      exact.toDecimalPlaces(dp, ROUND_DOWN),
      exact.toDecimalPlaces(dp, ROUND_UP),
    ];

    const seen = new Set<string>();
    for (const candidate of candidates) {
      // Validate the *serialized* string, not the in-memory Decimal (spec §6):
      // re-parsing it is what a CSV consumer will actually do.
      const exportRate = toPlainString(candidate, dp, stripTrailingZeros);
      if (seen.has(exportRate)) continue;
      seen.add(exportRate);

      const parsedBack = new D(exportRate);
      const reconstructed = roundToWon(divisor.times(parsedBack));
      const difference = reconstructed.minus(expected);

      if (difference.isZero()) {
        return {
          exact,
          exactDisplay,
          exportRate,
          decimalPlaces: dp,
          reconstructed,
          difference,
          ok: true,
        };
      }
    }
  }

  // Nothing in range reproduced the price: fall back to the highest precision we
  // are willing to emit and flag it. (Reachable only for pathological inputs —
  // e.g. an expected price that no rate can produce, like a non-integer target.)
  const fallback = exact.toDecimalPlaces(to, ROUND_HALF_UP);
  const exportRate = toPlainString(fallback, to, stripTrailingZeros);
  const reconstructed = roundToWon(divisor.times(new D(exportRate)));
  return {
    exact,
    exactDisplay,
    exportRate,
    decimalPlaces: to,
    reconstructed,
    difference: reconstructed.minus(expected),
    ok: false,
  };
}

/**
 * Rebuild a price from an exported rate string exactly the way a consumer of the
 * CSV would: parse the string, multiply, round once to the won.
 */
export function reconstructPrice(
  baseArea: Dec | number | string,
  quantity: Dec | number | string,
  exportRate: string,
): Dec {
  const area = new D(baseArea as never);
  const qty = new D(quantity as never);
  const rate = new D(exportRate);
  return roundToWon(area.times(qty).times(rate));
}

/**
 * Render a rate for display: up to EXACT_DISPLAY_DP decimals, suffixed with '…'
 * when digits had to be elided so a truncated value is never mistaken for exact.
 */
export function renderExactRate(exact: Dec): string {
  const shown = toPlainString(exact, EXACT_DISPLAY_DP, true);
  return new D(shown).equals(exact) ? shown : `${shown}…`;
}
