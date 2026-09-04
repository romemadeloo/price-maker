import { describe, expect, it } from 'vitest';
import { runEngine } from '../lib/engine';
import { calculate, type CalculatorInput } from '../lib/calculator';
import { D, ROUND_HALF_UP, type Dec } from '../lib/decimal';
import type { SheetState } from '../types';

/**
 * Parity with the production quotation service.
 *
 * Fixture captured from
 *   api.musticker.com/.../quotation/die-cut-sticker?width=123&height=123&debug=1
 * (pricing_id 43, "Die Cut Sticker (8/24/2026)", normalized_nr = 100).
 *
 * 123×123 falls between the area_factor rows 14,400 and 15,625, and quantity
 * 123 falls between the columns 100 and 200 — so it exercises both axes at
 * once, which is exactly where a single bilinear blend drifts a price unit away
 * from the staged answer.
 */

const QUANTITIES = [10, 20, 30, 40, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000];

/** `price_per_mm` as production stores it: 8 decimal places. */
const PRODUCTION_RATES: Record<number, number[]> = {
  14400: [
    0.10208333, 0.09027778, 0.08912037, 0.08819444, 0.08347222, 0.06034722, 0.04826389, 0.04224537,
    0.03379167, 0.02125, 0.02071875, 0.02054167, 0.0204, 0.0201875,
  ],
  15625: [
    0.10048, 0.088, 0.08704, 0.08576, 0.081792, 0.076352, 0.061088, 0.05344, 0.042752, 0.0214848,
    0.0209472, 0.020768, 0.02062592, 0.02041088,
  ],
};

/** The quantity ladder the API returns for 123×123 (`data.prices`). */
const PUBLISHED_LADDER: Record<number, number> = {
  10: 15300,
  20: 26900,
  30: 39900,
  40: 52500,
  50: 62400,
  100: 106200,
  200: 169900,
  300: 223000,
  500: 297300,
  1000: 323700,
  2000: 631200,
  3000: 938600,
  5000: 1553700,
  10000: 3074900,
};

const NORMALIZED_NR = 100;

function normalize(value: Dec): string {
  return value.div(NORMALIZED_NR).toDecimalPlaces(0, ROUND_HALF_UP).times(NORMALIZED_NR).toFixed();
}

/**
 * Recover the price book the production rates were derived from: each stored
 * rate times area × quantity, put back on the ₩100 unit.
 *
 * The rates are only 8 dp, so they do NOT reproduce their own prices exactly —
 * 14,400 × 100 × 0.06034722 is ₩86,899.9968, not ₩86,900. Production gets away
 * with it because every quote is normalized to ₩100. Rebuilding the prices here
 * and re-deriving rates from them is what this app is for.
 */
function priceBook(): SheetState {
  const sizes: Record<number, string> = { 14400: '120*120', 15625: '125*125' };

  return {
    quantities: QUANTITIES.map(String),
    rows: Object.entries(PRODUCTION_RATES).map(([areaKey, rates], i) => {
      const area = Number(areaKey);
      return {
        id: `r${i}`,
        size: sizes[area],
        baseArea: String(area),
        prices: rates.map((rate, c) => normalize(new D(area).times(QUANTITIES[c]).times(rate))),
      };
    }),
  };
}

const RESULT = runEngine(priceBook());

const BASE: CalculatorInput = {
  width: '123',
  height: '123',
  baseArea: '',
  quantity: '',
  mode: 'staged',
  roundTo: NORMALIZED_NR,
};

describe('production parity — die-cut sticker, 123×123', () => {
  it('rebuilds a price book whose rates reproduce every price exactly', () => {
    // The point of the app: our derived rates hit the won, production's do not.
    expect(RESULT.summary.mismatched).toBe(0);
    expect(RESULT.summary.invalidInput).toBe(0);
    expect(RESULT.roundTrip.passed).toBe(true);
  });

  it('reproduces the published quantity ladder for the interpolated size', () => {
    const ladder = Object.fromEntries(
      QUANTITIES.map((q) => {
        const r = calculate({ ...BASE, quantity: String(q) }, RESULT);
        expect(r.ok, `qty ${q}`).toBe(true);
        return [q, Number(r.price)];
      }),
    );

    expect(ladder).toEqual(PUBLISHED_LADDER);
  });

  it('quotes ₩120,900 for quantity 123 — the number the site shows', () => {
    const r = calculate({ ...BASE, quantity: '123' }, RESULT);

    expect(r.baseArea).toBe(15129);
    expect(r.area?.lower).toBe(14400);
    expect(r.area?.upper).toBe(15625);
    expect(r.qty?.lower).toBe(100);
    expect(r.qty?.upper).toBe(200);
    expect(r.price).toBe('120900');
  });

  it('shows the same stage-1 and stage-2 working as the API debug payload', () => {
    const r = calculate({ ...BASE, quantity: '123' }, RESULT);

    // meta.schema.inbetween_src — the dimension pass, per quantity column.
    expect(r.dimensionStage.map((s) => [s.quantity, s.price])).toEqual([
      [100, '106200'],
      [200, '169900'],
    ]);

    // meta.schema.inbetween_qty_src.src — the quantity pass.
    expect(r.quantityStage).toMatchObject({
      lowerQuantity: 100,
      upperQuantity: 200,
      lowerPrice: '106200',
      upperPrice: '169900',
      rawPrice: '120851',
      price: '120900',
    });
  });

  it('differs from a single bilinear blend — which is the bug this fixes', () => {
    const staged = calculate({ ...BASE, quantity: '123' }, RESULT);
    const blended = calculate({ ...BASE, quantity: '123', mode: 'rate' }, RESULT);

    expect(staged.price).toBe('120900');
    // Rounding only at the end loses the ₩100 the stage-1 pass had already
    // committed to, and lands a unit low.
    expect(staged.rawPrice).toBe('120851');
    expect(blended.price).not.toBe(staged.price);
    expect(staged.alternatePrice).toBe(blended.price);
  });

  it('still validates: the reported rate rebuilds the quote to the won', () => {
    for (const quantity of ['123', '17', '250', '4321', '100', '10']) {
      const r = calculate({ ...BASE, quantity }, RESULT);
      expect(r.verified, `qty ${quantity}`).toBe(true);
      expect(r.reconstructed).toBe(r.price);
      expect(new D(r.price as string).mod(NORMALIZED_NR).isZero()).toBe(true);
    }
  });

  it('matches production on an exact size with an in-between quantity', () => {
    // ?width=125&height=125&quantity=123 -> exact_dimension: true, price 135,800.
    const r = calculate({ ...BASE, width: '125', height: '125', quantity: '123' }, RESULT);

    expect(r.area?.kind).toBe('exact');
    expect(r.dimensionStage.map((s) => s.price)).toEqual(['119300', '190900']);
    expect(r.price).toBe('135800');
    expect(r.outOfRange).toHaveLength(0);
  });

  it('matches the price book exactly on a size and quantity that are both rows', () => {
    const r = calculate({ ...BASE, width: '125', height: '125', quantity: '100' }, RESULT);

    expect(r.area?.kind).toBe('exact');
    expect(r.qty?.kind).toBe('exact');
    // 15,625 × 100 × 0.076352 = 119,300 exactly.
    expect(r.price).toBe('119300');
    expect(r.matchesTable).toBe(true);
  });
});

/**
 * Production is deliberately asymmetric about requests it cannot bracket, and
 * these three cases pin each branch. Captured from the same endpoint:
 *
 *   ?width=20&height=20      → error "No base dimension data found!"
 *   ?width=2000&height=2000  → override_dimension: true, ₩8,586,800 at qty 123
 *   ?quantity=5 / 50000      → error "Process requires quantity of (10)…"
 */
describe('production parity — outside the book', () => {
  it('extrapolates an oversized size the way production does', () => {
    // The 546,000 bound, the largest in the production table. Production pins a
    // synthetic bound at the requested area and holds this row's rate, which is
    // what our held-rate path already does.
    const book: SheetState = {
      quantities: ['100', '200'],
      rows: [
        {
          id: 'r0',
          size: '700*780',
          baseArea: '546000',
          prices: [
            normalize(new D(546000).times(100).times(0.01752198)),
            normalize(new D(546000).times(200).times(0.017337)),
          ],
        },
      ],
    };
    const engine = runEngine(book);
    const r = calculate(
      { ...BASE, width: '2000', height: '2000', quantity: '123', roundTo: NORMALIZED_NR },
      engine,
    );

    expect(r.baseArea).toBe(4000000);
    // meta.schema.inbetween_qty_src.quantities — priced at the REQUESTED area.
    expect(r.dimensionStage.map((s) => s.price)).toEqual(['7008800', '13869600']);
    expect(r.price).toBe('8586800');
    // Production quotes this, so it must not be flagged as unquotable.
    expect(r.outOfRange).toHaveLength(0);
  });

  it('flags a size below the smallest area_factor, which production refuses', () => {
    const r = calculate({ ...BASE, width: '20', height: '20', quantity: '123' }, RESULT);

    expect(r.ok).toBe(true);
    expect(r.area?.kind).toBe('below-range');
    expect(r.outOfRange).toHaveLength(1);
    expect(r.outOfRange[0]).toContain('below the smallest area_factor');
  });

  it('flags quantities outside the columns, which production refuses either way', () => {
    for (const [quantity, kind] of [
      ['5', 'below-range'],
      ['50000', 'above-range'],
    ] as const) {
      const r = calculate({ ...BASE, quantity }, RESULT);
      expect(r.ok).toBe(true);
      expect(r.qty?.kind).toBe(kind);
      expect(r.outOfRange.some((m) => m.includes('outside the book'))).toBe(true);
    }
  });

  it('flags nothing for a request that sits inside the book', () => {
    expect(calculate({ ...BASE, quantity: '123' }, RESULT).outOfRange).toHaveLength(0);
  });
});
