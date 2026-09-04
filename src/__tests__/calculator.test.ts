import { describe, expect, it } from 'vitest';
import { runEngine } from '../lib/engine';
import {
  buildRateGrid,
  calculate,
  detectPriceUnit,
  type CalculatorInput,
  type PriceUnit,
} from '../lib/calculator';
import { D, roundToWon } from '../lib/decimal';
import type { SheetState } from '../types';

function sheet(quantities: string[], rows: [string, string, ...string[]][]): SheetState {
  return {
    quantities,
    rows: rows.map(([size, baseArea, ...prices], i) => ({
      id: `r${i}`,
      size,
      baseArea,
      prices,
    })),
  };
}

/** The spec's worked example: two area_factors, five quantity columns. */
const SAMPLE = sheet(
  ['10', '20', '30', '50', '100'],
  [
    ['10*10', '100', '1,900', '3,600', '5,300', '8,600', '12,900'],
    ['25*25', '625', '2,500', '4,700', '6,900', '10,700', '16,100'],
  ],
);

const RESULT = runEngine(SAMPLE);

const BLANK: CalculatorInput = {
  width: '',
  height: '',
  baseArea: '',
  quantity: '',
  mode: 'rate',
  roundTo: 1,
};

function ask(input: Partial<CalculatorInput>) {
  return calculate({ ...BLANK, ...input }, RESULT);
}

describe('buildRateGrid', () => {
  it('sorts both axes ascending regardless of sheet order', () => {
    const scrambled = runEngine(
      sheet(
        ['100', '10', '50'],
        [
          ['25*25', '625', '16,100', '2,500', '10,700'],
          ['10*10', '100', '12,900', '1,900', '8,600'],
        ],
      ),
    );
    const grid = buildRateGrid(scrambled);

    expect(grid.areas).toEqual([100, 625]);
    expect(grid.quantities).toEqual([10, 50, 100]);
    expect(grid.rate(625, 10)).toBe('0.4');
    expect(grid.rate(100, 100)).toBe('1.29');
  });

  it('drops rows and columns that carry no rate at all', () => {
    const holes = runEngine(
      sheet(
        ['10', '20'],
        [
          ['10*10', '100', '1,900', ''],
          ['25*25', '625', '', ''],
        ],
      ),
    );
    const grid = buildRateGrid(holes);

    expect(grid.areas).toEqual([100]);
    expect(grid.quantities).toEqual([10]);
  });
});

describe('width × height', () => {
  it('derives the base area from the two dimensions', () => {
    const r = ask({ width: '25', height: '25', quantity: '10' });

    expect(r.calculatedArea).toBe(625);
    expect(r.baseArea).toBe(625);
    expect(r.baseAreaSource).toBe('size');
    expect(r.sizeLabel).toBe('25×25');
    expect(r.price).toBe('2500');
  });

  it('multiplies decimal dimensions exactly', () => {
    const r = ask({ width: '12.5', height: '12.5', quantity: '10' });
    expect(r.calculatedArea).toBe(156.25);
  });

  it('accepts a non-square size', () => {
    const r = ask({ width: '5', height: '10', quantity: '10' });
    expect(r.baseArea).toBe(50);
    expect(r.sizeLabel).toBe('5×10');
  });

  it('needs both dimensions, not one', () => {
    const r = ask({ width: '25', quantity: '10' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('Enter both a width and a height');
  });

  it('still accepts a base area with no dimensions at all', () => {
    const r = ask({ baseArea: '625', quantity: '10' });
    expect(r.price).toBe('2500');
    expect(r.baseAreaSource).toBe('entered');
    expect(r.calculatedArea).toBeNull();
  });
});

describe('exact hits go straight through the table', () => {
  it('reproduces the price book price and its published rate', () => {
    const r = ask({ width: '25', height: '25', quantity: '10' });

    expect(r.ok).toBe(true);
    expect(r.area?.kind).toBe('exact');
    expect(r.qty?.kind).toBe('exact');
    expect(r.price).toBe('2500');
    expect(r.exportRate).toBe('0.4');
    expect(r.corners).toHaveLength(1);
    expect(r.corners[0]).toMatchObject({ areaFactor: 625, quantity: 10, rate: '0.4', weight: '1' });
    expect(r.tablePrice).toBe('2500');
    expect(r.matchesTable).toBe(true);
    expect(r.alternatePrice).toBeNull();
  });

  it('agrees with the sheet on every populated cell of the price book', () => {
    for (const row of RESULT.parsed.rows) {
      if (row.isEmpty) continue;
      for (const cell of row.cells) {
        if (cell.status !== 'ok') continue;
        const quantity = RESULT.parsed.quantities[cell.colIndex].value as number;
        const r = ask({ baseArea: String(row.baseArea.value), quantity: String(quantity) });
        expect(r.matchesTable).toBe(true);
        expect(r.price).toBe(String(cell.value));
      }
    }
  });
});

describe('in-between quantity', () => {
  it('blends the two bracketing rates', () => {
    const r = ask({ width: '10', height: '10', quantity: '15' });

    expect(r.qty?.kind).toBe('interpolated');
    expect(r.qty?.lower).toBe(10);
    expect(r.qty?.upper).toBe(20);
    expect(r.qty?.weight).toBe('0.5');
    expect(r.area?.kind).toBe('exact');
    // (1.9 + 1.8) / 2 = 1.85 -> 100 x 15 x 1.85
    expect(r.blendedRate).toBe('1.85');
    expect(r.price).toBe('2775');
    expect(r.corners.map((c) => c.weight)).toEqual(['0.5', '0.5']);
  });

  it('reports what price-interpolation would have quoted instead', () => {
    const r = ask({ width: '10', height: '10', quantity: '15' });
    // (1900 + 3600) / 2
    expect(r.alternatePrice).toBe('2750');
  });

  it('staged mode collapses the dimension axis first, then the quantity axis', () => {
    const r = ask({ width: '10', height: '10', quantity: '15', mode: 'staged' });

    // Area 100 is an exact row, so stage 1 is just the table prices at qty
    // 10 and 20; stage 2 walks halfway between them.
    expect(r.dimensionStage.map((d) => [d.quantity, d.price])).toEqual([
      [10, '1900'],
      [20, '3600'],
    ]);
    expect(r.quantityStage).toMatchObject({ lowerPrice: '1900', upperPrice: '3600', price: '2750' });
    expect(r.price).toBe('2750');
    expect(r.blendedRate).toBeNull();
    expect(r.alternatePrice).toBe('2775');
  });

  it('weights an off-centre quantity proportionally', () => {
    const r = ask({ width: '10', height: '10', quantity: '12' });
    // t = 0.2 -> 1.9 x 0.8 + 1.8 x 0.2 = 1.88
    expect(r.qty?.weight).toBe('0.2');
    expect(r.blendedRate).toBe('1.88');
    expect(r.price).toBe('2256');
  });
});

describe('in-between size', () => {
  it('blends the two bracketing area_factor rows', () => {
    const r = ask({ baseArea: '362.5', quantity: '10' });

    expect(r.area?.kind).toBe('interpolated');
    expect(r.area?.lower).toBe(100);
    expect(r.area?.upper).toBe(625);
    expect(r.area?.weight).toBe('0.5');
    // (1.9 + 0.4) / 2 = 1.15 -> 362.5 x 10 x 1.15 = 4168.75 -> half-up
    expect(r.blendedRate).toBe('1.15');
    expect(r.price).toBe('4169');
  });

  it('takes the area from dimensions that fall between two rows', () => {
    const r = ask({ width: '15', height: '15', quantity: '10' });

    expect(r.baseArea).toBe(225);
    expect(r.baseAreaSource).toBe('size');
    expect(r.area?.lower).toBe(100);
    expect(r.area?.upper).toBe(625);
  });
});

describe('in-between on both axes', () => {
  it('blends all four corners of the rectangle', () => {
    const r = ask({ baseArea: '362.5', quantity: '15' });

    expect(r.corners).toHaveLength(4);
    expect(r.corners.map((c) => [c.areaFactor, c.quantity])).toEqual([
      [100, 10],
      [100, 20],
      [625, 10],
      [625, 20],
    ]);
    expect(r.corners.every((c) => c.weight === '0.25')).toBe(true);
    // (1.9 + 1.8 + 0.4 + 0.376) / 4 = 1.119 -> 362.5 x 15 x 1.119 = 6084.5625
    expect(r.blendedRate).toBe('1.119');
    expect(r.price).toBe('6085');
  });
});

describe('outside the table', () => {
  it('holds the top quantity rate and keeps scaling with volume', () => {
    const r = ask({ width: '25', height: '25', quantity: '200' });

    expect(r.qty?.kind).toBe('above-range');
    expect(r.qty?.lower).toBe(100);
    // 625 x 200 x 0.2576
    expect(r.price).toBe('32200');
    expect(r.warnings.some((w) => w.includes('Above the largest quantity'))).toBe(true);
  });

  it('holds the smallest area rate below the range', () => {
    const r = ask({ width: '5', height: '10', quantity: '10' });

    expect(r.baseArea).toBe(50);
    expect(r.area?.kind).toBe('below-range');
    // 50 x 10 x 1.9
    expect(r.price).toBe('950');
  });

  it('gives staged mode the same answer as rate mode on a held axis', () => {
    for (const [width, height, quantity] of [
      ['25', '25', '200'],
      ['25', '25', '5'],
      ['5', '10', '10'],
      ['100', '100', '10'],
    ] as const) {
      const byRate = ask({ width, height, quantity });
      const byStaged = ask({ width, height, quantity, mode: 'staged' });
      expect(byStaged.price).toBe(byRate.price);
    }
  });

  it('applies the only rate directly when the table has one row and one column', () => {
    const single = runEngine(sheet(['10'], [['25*25', '625', '2,500']]));
    const r = calculate({ ...BLANK, width: '50', height: '50', quantity: '40' }, single);

    expect(r.area?.kind).toBe('single');
    expect(r.qty?.kind).toBe('single');
    // 2500 x 40 x 0.4
    expect(r.price).toBe('40000');
  });
});

/* ------------------------------------------------------------------ */
/* Price normalization (the house ₩100 / ₩10 unit)                     */
/* ------------------------------------------------------------------ */

describe('detectPriceUnit', () => {
  it('reads ₩100 off a price book quoted in hundreds', () => {
    expect(detectPriceUnit(RESULT)).toBe(100);
  });

  it('reads ₩10 when any price is only a multiple of ten', () => {
    const tens = runEngine(sheet(['10', '20'], [['10*10', '100', '1,900', '3,650']]));
    expect(detectPriceUnit(tens)).toBe(10);
  });

  it('falls back to ₩1 for exact-won prices', () => {
    const exact = runEngine(sheet(['30000'], [['600*610', '366000', '155793118']]));
    expect(detectPriceUnit(exact)).toBe(1);
  });

  it('falls back to ₩1 when there is nothing to infer from', () => {
    expect(detectPriceUnit(runEngine(sheet(['10'], [['', '', '']])))).toBe(1);
  });
});

describe('normalizing a derived price', () => {
  it('rounds an interpolated quote to the nearest ₩100', () => {
    const r = ask({ width: '10', height: '10', quantity: '15', roundTo: 100 });

    expect(r.rawPrice).toBe('2775');
    expect(r.price).toBe('2800');
    expect(r.normalized).toBe(true);
    expect(r.roundTo).toBe(100);
  });

  it('rounds an interpolated quote to the nearest ₩10', () => {
    const r = ask({ width: '10', height: '10', quantity: '15', roundTo: 10 });
    expect(r.price).toBe('2780');
  });

  it('leaves a quote that already sits on the unit alone', () => {
    const r = ask({ width: '10', height: '10', quantity: '15', mode: 'staged', roundTo: 10 });
    expect(r.rawPrice).toBe('2750');
    expect(r.price).toBe('2750');
    expect(r.normalized).toBe(false);
  });

  it('normalizes the alternate quote too, and hides it when both agree', () => {
    const r = ask({ width: '10', height: '10', quantity: '15', roundTo: 100 });
    // 2775 -> 2800 and 2750 -> 2800: the modes agree once normalized.
    expect(r.alternatePrice).toBeNull();
  });

  it('normalizes an exact table hit too, and says so when that moves it', () => {
    // Production normalizes every quote, so an exact hit is normalized as well.
    // Detection would pick ₩1 for a book like this; overriding to ₩100 is the
    // user's call, and the warning names the price it walked away from.
    const exact = runEngine(sheet(['30000'], [['600*610', '366000', '155793118']]));
    const r = calculate({ ...BLANK, width: '600', height: '610', quantity: '30000', roundTo: 100 }, exact);

    expect(r.tablePrice).toBe('155793118');
    expect(r.price).toBe('155793100');
    expect(r.normalized).toBe(true);
    expect(r.matchesTable).toBe(false);
    expect(r.warnings.some((w) => w.includes('not a multiple of'))).toBe(true);
  });

  it('leaves an exact table hit alone at the unit the book is actually on', () => {
    const r = ask({ width: '25', height: '25', quantity: '10', roundTo: 100 });

    expect(r.price).toBe('2500');
    expect(r.normalized).toBe(false);
    expect(r.matchesTable).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it('still normalizes an extrapolated quote', () => {
    const r = ask({ width: '25', height: '25', quantity: '150', roundTo: 100 });
    // 625 x 150 x 0.2576 = 24150 -> nearest 100
    expect(r.rawPrice).toBe('24150');
    expect(r.price).toBe('24200');
  });
});

describe('validating the rate and the base area', () => {
  it('round-trips its own answer through the CSV-grade rate, at every unit', () => {
    const combos: [string, string][] = [];
    for (const area of [50, 100, 137, 225, 362.5, 500, 624, 625, 900]) {
      for (const quantity of [5, 10, 12, 15, 25, 33, 50, 75, 100, 250]) {
        combos.push([String(area), String(quantity)]);
      }
    }

    for (const [baseArea, quantity] of combos) {
      for (const mode of ['rate', 'staged'] as const) {
        for (const roundTo of [1, 10, 100] as PriceUnit[]) {
          const label = `${baseArea} x ${quantity} (${mode}, ₩${roundTo})`;
          const r = calculate({ ...BLANK, baseArea, quantity, mode, roundTo }, RESULT);

          expect(r.ok, label).toBe(true);
          expect(r.verified, label).toBe(true);
          expect(r.difference).toBe('0');
          expect(r.reconstructed).toBe(r.price);
          expect(new D(r.price as string).mod(r.roundTo).isZero(), label).toBe(true);

          // The reported export rate must rebuild the price the way a CSV
          // consumer would: parse the string, multiply, round once.
          const rebuilt = roundToWon(new D(baseArea).times(quantity).times(r.exportRate as string));
          expect(rebuilt.toFixed(), label).toBe(r.price);
        }
      }
    }
  });

  it('flags a base area that disagrees with width x height, and uses the typed one', () => {
    const r = ask({ width: '25', height: '25', baseArea: '100', quantity: '10' });

    expect(r.baseAreaMismatch).toBe(true);
    expect(r.baseArea).toBe(100);
    expect(r.calculatedArea).toBe(625);
    expect(r.baseAreaSource).toBe('entered');
    expect(r.warnings.some((w) => w.includes('does not equal width × height'))).toBe(true);
    expect(r.price).toBe('1900');
  });

  it('does not flag a base area that agrees with the dimensions', () => {
    const r = ask({ width: '25', height: '25', baseArea: '625', quantity: '10' });
    expect(r.baseAreaMismatch).toBe(false);
    expect(r.warnings).toHaveLength(0);
  });
});

describe('rejected input', () => {
  const cases: [string, Partial<CalculatorInput>, string][] = [
    ['no dimensions and no area', { quantity: '10' }, 'Enter a width and height'],
    ['no quantity', { width: '10', height: '10' }, 'Enter a quantity'],
    ['zero quantity', { width: '10', height: '10', quantity: '0' }, 'greater than 0'],
    ['negative quantity', { width: '10', height: '10', quantity: '-5' }, 'greater than 0'],
    ['unparseable width', { width: 'abc', height: '10', quantity: '10' }, 'Width: Not a number'],
    ['zero height', { width: '10', height: '0', quantity: '10' }, 'Height must be greater than 0'],
    ['unparseable area', { baseArea: 'abc', quantity: '10' }, 'Invalid base area'],
    ['zero area', { baseArea: '0', quantity: '10' }, 'greater than 0'],
  ];

  for (const [name, input, expected] of cases) {
    it(`rejects ${name}`, () => {
      const r = ask(input);
      expect(r.ok).toBe(false);
      expect(r.price).toBeNull();
      expect(r.errors.join(' | ')).toContain(expected);
    });
  }

  it('warns rather than fails on a fractional quantity', () => {
    const r = ask({ width: '10', height: '10', quantity: '12.5' });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('not a whole number'))).toBe(true);
  });

  it('reports an empty price book instead of guessing', () => {
    const blank = runEngine(sheet(['10'], [['', '', '']]));
    const r = calculate({ ...BLANK, width: '10', height: '10', quantity: '10' }, blank);

    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('No price-per-mm² table');
  });

  it('normalizes grouped and currency-marked input', () => {
    const r = ask({ width: '600', height: '610', baseArea: '366,000', quantity: '1,000' });
    expect(r.baseArea).toBe(366000);
    expect(r.quantity).toBe(1000);
    expect(r.baseAreaMismatch).toBe(false);
  });
});

describe('a sparse price book', () => {
  it('skips area rows with no rate at the quantities in play', () => {
    const sparse = runEngine(
      sheet(
        ['10', '20'],
        [
          ['10*10', '100', '1,900', '3,600'],
          ['25*25', '625', '2,500', ''],
        ],
      ),
    );

    // Quantity 15 needs both columns, so the 625 row cannot take part and the
    // area axis is left with a single usable row.
    const between = calculate({ ...BLANK, baseArea: '300', quantity: '15' }, sparse);
    expect(between.area?.kind).toBe('single');
    expect(between.area?.lower).toBe(100);
    expect(between.warnings.some((w) => w.includes('skipped'))).toBe(true);

    // Quantity 10 has both rows, so it interpolates across them.
    const atTen = calculate({ ...BLANK, baseArea: '300', quantity: '10' }, sparse);
    expect(atTen.area?.kind).toBe('interpolated');
    expect(atTen.area?.lower).toBe(100);
    expect(atTen.area?.upper).toBe(625);
  });
});
