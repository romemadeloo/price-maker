import { describe, expect, it } from 'vitest';
import { parseSheet } from '../lib/parse';
import {
  compareDraft,
  comparisonToCsv,
  draftSizes,
  parseQuotationResponse,
  quotationUrl,
  roundPrice,
  sizeForArea,
  sizeKey,
  type ProductionSnapshot,
} from '../lib/production';
import type { SheetState } from '../types';

/**
 * Captured from the live endpoint on 2026-10-13:
 *   /pricing/quotation/die-cut-sticker?width=100&height=100
 * trimmed to the first six quantities.
 */
const LIVE_100x100 = {
  success: true,
  message: '',
  data: {
    product_variant_id: 1,
    normalized_nr: 100,
    sheet: null,
    prices: [
      { pricing_dimension_id: 16298, nr: 10, price_per_mm: 0.111, featured: 1, price: 11100 },
      { pricing_dimension_id: 16298, nr: 20, price_per_mm: 0.1, featured: 1, price: 20000 },
      { pricing_dimension_id: 16298, nr: 30, price_per_mm: 0.099, featured: 1, price: 29700 },
      { pricing_dimension_id: 16298, nr: 40, price_per_mm: 0.098, featured: 0, price: 39200 },
      { pricing_dimension_id: 16298, nr: 50, price_per_mm: 0.0922, featured: 1, price: 46100 },
      { pricing_dimension_id: 16298, nr: 100, price_per_mm: 0.0609, featured: 1, price: 60900 },
    ],
  },
  meta: { pricing_id: 48, pricing: 'diecut/kisscut - 9/9/2026', pricing_adjustment: null },
};

function snapshotOf(entries: ProductionSnapshot['quotes']): ProductionSnapshot {
  return { fetchedAt: '2026-10-13T00:00:00.000Z', quotes: entries };
}

const QUOTE_100 = parseQuotationResponse(LIVE_100x100, 100, 100);

describe('parseQuotationResponse', () => {
  it('reads the ladder, unit and price book name', () => {
    expect(QUOTE_100.normalizedNr).toBe(100);
    expect(QUOTE_100.pricingId).toBe(48);
    expect(QUOTE_100.pricingName).toBe('diecut/kisscut - 9/9/2026');
    expect(QUOTE_100.sheet).toBeNull();
    expect(QUOTE_100.prices.map((p) => [p.quantity, p.price])).toEqual([
      [10, 11100],
      [20, 20000],
      [30, 29700],
      [40, 39200],
      [50, 46100],
      [100, 60900],
    ]);
  });

  it('reads sheet-priced products, whose rates are null', () => {
    const quote = parseQuotationResponse(
      {
        success: true,
        data: {
          normalized_nr: 10,
          sheet: { id: 1, width: 148, height: 210, padding: 5, name: 'A5', stickers_per_sheet: 1 },
          prices: [{ id: 1, sheet: 5, price_per_mm: null, nr: 5, price: 2750 }],
        },
        meta: { pricing_id: 40, pricing: 'Simple Sheet - PVC (08/17/2026)' },
      },
      100,
      100,
    );
    expect(quote.sheet).toEqual({ name: 'A5', width: 148, height: 210 });
    expect(quote.prices).toEqual([{ quantity: 5, price: 2750, pricePerMm: null }]);
  });

  it('throws production’s own message when it refuses', () => {
    expect(() =>
      parseQuotationResponse({ success: false, message: 'No base dimension data found!', data: null }, 1, 1),
    ).toThrow('No base dimension data found!');
  });

  it('builds a proxied URL', () => {
    expect(quotationUrl('die-cut-sticker', 100, 100)).toBe(
      '/api/musticker/pricing/quotation/die-cut-sticker?width=100&height=100',
    );
    expect(quotationUrl('die-cut-sticker', 123, 123, 123)).toContain('quantity=123');
  });
});

describe('sizeForArea', () => {
  it('finds the squarest whole-millimetre size with exactly that area', () => {
    expect(sizeForArea(100)).toEqual({ width: 10, height: 10 });
    expect(sizeForArea(15129)).toEqual({ width: 123, height: 123 });
    expect(sizeForArea(200)).toEqual({ width: 10, height: 20 });
    expect(sizeForArea(62370)).toEqual({ width: 231, height: 270 });
    expect(sizeForArea(13)).toEqual({ width: 1, height: 13 });
  });

  it('gives up on areas that are not positive whole numbers', () => {
    expect(sizeForArea(0)).toBeNull();
    expect(sizeForArea(-4)).toBeNull();
    expect(sizeForArea(12.5)).toBeNull();
  });
});

describe('compareDraft', () => {
  const sheet: SheetState = {
    quantities: ['10', '20', '30', '1,000'],
    rows: [
      { id: 'a', size: '100*100', baseArea: '10000', prices: ['11,100', '21,000', '29,000', '250,000'] },
      { id: 'b', size: '50x50', baseArea: '2500', prices: ['5,000', '', '', ''] },
      // No size: production is asked for 30×30, which has the same area.
      { id: 'c', size: '', baseArea: '900', prices: ['1,000', '', '', ''] },
      { id: 'd', size: '', baseArea: '', prices: ['', '', '', ''] },
      { id: 'e', size: '', baseArea: '', prices: ['700', '', '', ''] },
    ],
  };
  const parsed = parseSheet(sheet);

  it('lists each drafted size once', () => {
    expect(draftSizes(parsed).map((s) => s.key)).toEqual(['100x100', '50x50', '30x30']);
  });

  it('marks every row not fetched before any snapshot exists', () => {
    const c = compareDraft(parsed, null);
    expect(c.summary.rows).toBe(4);
    expect(c.summary.compared).toBe(0);
    expect(c.rows.map((r) => r.state)).toEqual(['not-fetched', 'not-fetched', 'not-fetched', 'no-size']);
  });

  it('lines draft prices up against production, cell by cell', () => {
    const c = compareDraft(
      parsed,
      snapshotOf({
        [sizeKey(100, 100)]: { ok: true, quote: QUOTE_100 },
        [sizeKey(50, 50)]: { ok: false, error: 'No base dimension data found!' },
      }),
    );

    const row = c.rows[0];
    expect(row.state).toBe('ok');
    expect(row.cells.map((x) => [x.quantity, x.draft, x.production, x.diff, x.status])).toEqual([
      [10, 11100, 11100, 0, 'same'],
      [20, 21000, 20000, 1000, 'higher'],
      [30, 29000, 29700, -700, 'lower'],
      // The trimmed fixture stops at 100, so 1,000 is not quoted.
      [1000, 250000, null, null, 'not-in-production'],
    ]);
    expect(row.cells[1].diffPct).toBeCloseTo(5, 10);

    expect(c.rows[1]).toMatchObject({ state: 'error', error: 'No base dimension data found!' });
    expect(c.rows[2]).toMatchObject({ state: 'not-fetched', sizeLabel: '30×30', sizeFromArea: true });
    expect(c.rows[3].state).toBe('no-size');

    expect(c.summary).toMatchObject({
      compared: 3,
      same: 1,
      higher: 1,
      lower: 1,
      notInProduction: 1,
      rowsFailed: 1,
      rowsWithoutSize: 1,
      rowsNotFetched: 1,
    });
    expect(c.summary.largest?.quantity).toBe(20);
    expect(c.summary.avgDiffPct).toBeCloseTo((0 + 5 + (-700 / 29700) * 100) / 3, 10);

    // Production quotes 40, 50 and 100 too; the draft has no column for them.
    expect(c.productionOnlyQuantities).toEqual([40, 50, 100]);
    expect(c.pricingName).toBe('diecut/kisscut - 9/9/2026');
    expect(c.normalizedNr).toBe(100);
  });

  it('exports one CSV line per drafted price', () => {
    const c = compareDraft(parsed, snapshotOf({ [sizeKey(100, 100)]: { ok: true, quote: QUOTE_100 } }));
    const lines = comparisonToCsv(c).trim().split('\n');
    expect(lines[0]).toBe(
      'size,width,height,base_area,quantity,draft_price,draft_rounded,production_price,difference,difference_pct,status',
    );
    expect(lines[2]).toBe('100×100,100,100,10000,20,21000,21000,20000,1000,5.00,higher');
    // 4 prices for 100×100, 1 for 50×50 (not fetched), 1 for 30×30, 1 for the size-less row.
    expect(lines).toHaveLength(1 + 7);
  });
});

describe('rounding drafted prices before comparing', () => {
  // Unrounded drafts, as a price book derived from rates comes out.
  const sheet: SheetState = {
    quantities: ['10', '20', '30'],
    rows: [{ id: 'a', size: '100*100', baseArea: '10000', prices: ['11,140', '19,950', '29,649'] }],
  };
  const parsed = parseSheet(sheet);
  const snapshot = snapshotOf({ [sizeKey(100, 100)]: { ok: true, quote: QUOTE_100 } });

  it('rounds half-up to the unit, and leaves prices alone at 1', () => {
    expect(roundPrice(11140, 100)).toBe(11100);
    expect(roundPrice(19950, 100)).toBe(20000);
    expect(roundPrice(29649, 100)).toBe(29600);
    expect(roundPrice(29649, 10)).toBe(29650);
    expect(roundPrice(29649, 1)).toBe(29649);
  });

  it('compares exactly as drafted by default', () => {
    const c = compareDraft(parsed, snapshot);
    expect(c.roundTo).toBe(1);
    expect(c.summary).toMatchObject({ compared: 3, same: 0, rounded: 0 });
  });

  it('compares the rounded price, and keeps the original alongside', () => {
    const c = compareDraft(parsed, snapshot, { roundTo: 100 });
    expect(c.rows[0].cells.map((x) => [x.draftRaw, x.draft, x.production, x.status])).toEqual([
      [11140, 11100, 11100, 'same'],
      [19950, 20000, 20000, 'same'],
      [29649, 29600, 29700, 'lower'],
    ]);
    expect(c.summary).toMatchObject({ compared: 3, same: 2, lower: 1, rounded: 3 });
    expect(comparisonToCsv(c).split('\n')[1]).toBe('100×100,100,100,10000,10,11140,11100,11100,0,0.00,same');
  });
});
