import DecimalJS from 'decimal.js';

/**
 * A dedicated Decimal constructor for all pricing math.
 *
 * We clone rather than mutate the global config so nothing else in the app (or a
 * dependency) can quietly change rounding behaviour underneath the price engine.
 *
 *  - precision 80 significant digits: a base area (up to ~9 digits) times a
 *    quantity (up to ~6 digits) times an 18-decimal rate needs ~35 significant
 *    digits to multiply out *exactly*. 80 leaves a very wide margin, so no
 *    intermediate product is ever silently rounded.
 *  - ROUND_HALF_UP matches the arithmetic convention used for KRW rounding.
 *  - toExpNeg/toExpPos are pushed far out so `toString()` never yields
 *    exponential notation. (Serialization still goes through toFixed, which is
 *    exponent-free by definition, but this keeps debug output readable too.)
 */
export const D = DecimalJS.clone({
  precision: 80,
  rounding: DecimalJS.ROUND_HALF_UP,
  toExpNeg: -50,
  toExpPos: 60,
});

export type Dec = InstanceType<typeof D>;

export const ROUND_HALF_UP = DecimalJS.ROUND_HALF_UP;
export const ROUND_DOWN = DecimalJS.ROUND_DOWN;
export const ROUND_UP = DecimalJS.ROUND_UP;

/**
 * Render a Decimal at a fixed number of decimal places, optionally removing
 * trailing zeros (0.4000000000 -> 0.4). Stripping trailing zeros never changes
 * the numeric value, so it is always safe for round-tripping.
 */
export function toPlainString(value: Dec, decimalPlaces: number, stripTrailingZeros: boolean): string {
  let s = value.toFixed(decimalPlaces);
  if (stripTrailingZeros && s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  if (s === '-0') s = '0';
  return s;
}

/** ROUND(value, 0) using half-up — the single place KRW rounding happens. */
export function roundToWon(value: Dec): Dec {
  return value.toDecimalPlaces(0, ROUND_HALF_UP);
}

/** Format an integer-valued Decimal as KRW with thousands separators. */
export function formatKrw(value: Dec | string | number, withSymbol = true): string {
  const d = new D(value as never);
  const negative = d.isNegative();
  const abs = d.abs();
  const [intPart, fracPart] = abs.toFixed().split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fracPart ? `${grouped}.${fracPart}` : grouped;
  return `${negative ? '-' : ''}${withSymbol ? '₩' : ''}${body}`;
}

/** Format a signed difference, e.g. "+₩2", "-₩1", "₩0". */
export function formatDifference(value: Dec | string): string {
  const d = new D(value as never);
  if (d.isZero()) return '₩0';
  return `${d.isPositive() ? '+' : '-'}${formatKrw(d.abs())}`;
}

/** Group the integer part of a plain number string: 366000 -> "366,000". */
export function groupDigits(value: number | string): string {
  const s = String(value);
  const [i, f] = s.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return f ? `${grouped}.${f}` : grouped;
}
