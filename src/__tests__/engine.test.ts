import { describe, expect, it } from 'vitest';
import { runEngine } from '../lib/engine';
import { parseRateCsv, serializeCsv } from '../lib/csv';
import { roundTripValidate } from '../lib/roundTrip';
import { DEFAULT_ENGINE_OPTIONS, type SheetState } from '../types';
import { emptySheet, sheetReducer } from '../state/sheetReducer';
import { parseClipboardMatrix } from '../lib/parse';
import { D, roundToWon } from '../lib/decimal';

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

const SAMPLE = sheet(
  ['10', '20', '30', '50', '100'],
  [
    ['10*10', '100', '1,900', '3,600', '5,300', '8,600', '12,900'],
    ['25*25', '625', '2,500', '4,700', '6,900', '10,700', '16,100'],
  ],
);

describe('runEngine — the documented worked example (spec §1)', () => {
  it('derives the expected price-per-mm² table', () => {
    const result = runEngine(SAMPLE);

    expect(result.quantities).toEqual([10, 20, 30, 50, 100]);
    expect(result.rateRows).toHaveLength(2);
    expect(result.rateRows[0].areaFactor).toBe(100);
    expect(result.rateRows[0].rates).toEqual(['1.9', '1.8', '1.7666666667', '1.72', '1.29']);
    expect(result.rateRows[1].areaFactor).toBe(625);
    expect(result.rateRows[1].rates).toEqual(['0.4', '0.376', '0.368', '0.3424', '0.2576']);
  });

  it('validates every price and reports a clean summary', () => {
    const { summary, roundTrip } = runEngine(SAMPLE);
    expect(summary.totalPrices).toBe(10);
    expect(summary.matched).toBe(10);
    expect(summary.mismatched).toBe(0);
    expect(summary.invalidInput).toBe(0);
    expect(summary.baseAreaWarnings).toBe(0);
    expect(summary.allValid).toBe(true);
    expect(roundTrip.passed).toBe(true);
    expect(roundTrip.checkedCells).toBe(10);
  });

  it('emits CSV in the documented shape (spec §12)', () => {
    const { csv } = runEngine(SAMPLE);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('area_factor,10,20,30,50,100');
    expect(lines[1]).toBe('100,1.9,1.8,1.7666666667,1.72,1.29');
    expect(lines[2]).toBe('625,0.4,0.376,0.368,0.3424,0.2576');
    expect(csv).not.toMatch(/₩/);
    // Every field must be a bare number: no currency marks, no grouping commas.
    for (const line of lines.slice(1)) {
      for (const field of line.split(',')) {
        if (field === '') continue;
        expect(field, `field "${field}"`).toMatch(/^\d+(\.\d+)?$/);
      }
    }
    for (const header of lines[0].split(',').slice(1)) {
      expect(header).toMatch(/^\d+$/);
    }
  });
});

describe('runEngine — precision-sensitive row (spec §6)', () => {
  const big = sheet(['30000'], [['600*610', '366000', '155,793,118']]);

  it('reproduces ₩155,793,118 exactly through the whole pipeline', () => {
    const result = runEngine(big);
    const cell = result.cells[0];

    expect(cell.status).toBe('PASS');
    expect(cell.reconstructedPrice).toBe('155793118');
    expect(cell.difference).toBe('0');
    expect(result.summary.allValid).toBe(true);
    expect(result.roundTrip.passed).toBe(true);

    // Re-derive straight from the serialized CSV text.
    const parsed = parseRateCsv(result.csv);
    const rate = parsed.rows[0].rates[0] as string;
    expect(roundToWon(new D(366000).times(30000).times(new D(rate))).toFixed()).toBe('155793118');
  });
});

describe('CSV round trip (spec §14)', () => {
  it('passes for a table that validates', () => {
    const result = runEngine(SAMPLE);
    const rt = roundTripValidate(result.csv, result.cells);
    expect(rt.passed).toBe(true);
    expect(rt.failures).toHaveLength(0);
  });

  it('catches precision lost during serialization', () => {
    const result = runEngine(SAMPLE);
    // Deliberately damage the serialized rate the way a naive formatter would:
    // 1.7666666667 -> 1.77. The round trip must notice.
    const damaged = result.csv.replace('1.7666666667', '1.77');
    const rt = roundTripValidate(damaged, result.cells);

    expect(rt.passed).toBe(false);
    expect(rt.failures.length).toBeGreaterThan(0);
    const f = rt.failures[0];
    expect(f.areaFactor).toBe(100);
    expect(f.quantity).toBe(30);
    expect(f.expected).toBe('5300');
    expect(f.reconstructed).toBe('5310');
    expect(f.difference).toBe('10');
  });

  it('catches a ₩1-class error from a single missing decimal place', () => {
    const cells = runEngine(sheet(['30000'], [['600*610', '366000', '155793118']])).cells;
    // 0.0141888086 (correct) -> 0.014188809 (one place short): off by a few won.
    const damaged = serializeCsv([30000], [
      { areaFactor: 366000, rates: ['0.014188809'], sourceRowIndexes: [0] },
    ]);
    const rt = roundTripValidate(damaged, cells);

    expect(rt.passed).toBe(false);
    expect(rt.failures).toHaveLength(1);
    expect(rt.failures[0].reconstructed).toBe('155793123');
    expect(rt.failures[0].difference).toBe('5');
  });

  it('flags a rate that is missing from the CSV entirely', () => {
    const result = runEngine(SAMPLE);
    const damaged = result.csv.split('\n').filter((l) => !l.startsWith('625,')).join('\n');
    const rt = roundTripValidate(damaged, result.cells);
    expect(rt.passed).toBe(false);
    expect(rt.failures.some((f) => f.parsedRate === '(missing from CSV)')).toBe(true);
  });
});

describe('runEngine — data integrity (spec §4, §17)', () => {
  it('warns about a base area that disagrees with width × height without changing it', () => {
    const s = sheet(['10'], [['600*610', '360000', '1000']]);
    const result = runEngine(s);

    expect(result.parsed.rows[0].baseAreaMismatch).toBe(true);
    expect(result.parsed.rows[0].baseArea.value).toBe(360000); // untouched
    expect(result.summary.baseAreaWarnings).toBe(1);
    expect(result.issues.some((i) => i.code === 'BASE_AREA_MISMATCH')).toBe(true);
    // The user's own base area is what gets used.
    expect(result.rateRows[0].areaFactor).toBe(360000);
  });

  it('reports invalid prices instead of coercing them', () => {
    const s = sheet(['10', '20'], [['10*10', '100', 'abc', '']]);
    const result = runEngine(s);

    expect(result.summary.invalidInput).toBe(1);
    expect(result.summary.blankCells).toBe(1);
    expect(result.summary.allValid).toBe(false);
    expect(result.issues.some((i) => i.code === 'INVALID_PRICE')).toBe(true);
  });

  it('keeps blank cells blank in the CSV', () => {
    const s = sheet(['10', '20'], [['10*10', '100', '1900', '']]);
    const result = runEngine(s);
    expect(result.rateRows[0].rates).toEqual(['1.9', null]);
    expect(result.csv.trim().split('\n')[1]).toBe('100,1.9,');
  });

  it('detects duplicate quantity columns and duplicate area factors', () => {
    const s = sheet(
      ['10', '10'],
      [
        ['10*10', '100', '1900', '1900'],
        ['5*20', '100', '1900', '1900'],
      ],
    );
    const result = runEngine(s);
    expect(result.issues.some((i) => i.code === 'DUPLICATE_QUANTITY')).toBe(true);
    expect(result.issues.some((i) => i.code === 'DUPLICATE_AREA_FACTOR')).toBe(true);
    // One area_factor row in the output, one quantity column.
    expect(result.rateRows).toHaveLength(1);
    expect(result.quantities).toEqual([10]);
  });

  it('reports conflicting rates for a shared area_factor', () => {
    const s = sheet(
      ['10'],
      [
        ['10*10', '100', '1900'],
        ['5*20', '100', '2000'],
      ],
    );
    const result = runEngine(s);
    expect(result.issues.some((i) => i.code === 'AREA_FACTOR_CONFLICT')).toBe(true);
    expect(result.rateRows[0].rates[0]).toBe('1.9'); // first value wins, loudly
    // One area_factor cannot serve two different prices, so the round trip —
    // the last line of defence — must refuse to bless this CSV.
    expect(result.roundTrip.passed).toBe(false);
    expect(result.summary.allValid).toBe(false);
  });

  it('ignores fully empty rows', () => {
    const s = sheet(['10'], [['', '', ''], ['10*10', '100', '1900']]);
    const result = runEngine(s);
    expect(result.summary.totalPrices).toBe(1);
    expect(result.summary.allValid).toBe(true);
  });

  it('marks NEEDS REVIEW when the precision cap is too low', () => {
    const s = sheet(['30000'], [['600*610', '366000', '155793118']]);
    const result = runEngine(s, { ...DEFAULT_ENGINE_OPTIONS, minDecimalPlaces: 2, maxDecimalPlaces: 4 });
    expect(result.cells[0].status).toBe('NEEDS_REVIEW');
    expect(result.summary.mismatched).toBe(1);
    expect(result.summary.allValid).toBe(false);
  });
});

describe('runEngine — scale', () => {
  it('handles a wide, tall table and validates every cell', () => {
    const quantities = ['10', '20', '30', '40', '50', '100', '200', '300', '500', '1,000', '2,000', '3,000', '5,000', '10,000', '20,000', '30,000', '50,000', '70,000', '100,000'];
    const rows: [string, string, ...string[]][] = [];
    const seenAreas = new Set<number>();
    for (let i = 1; rows.length < 153; i++) {
      const w = 10 + i;
      const h = 20 + (i % 37);
      const area = w * h;
      // Distinct area_factor per row, so each row owns its own CSV line.
      if (seenAreas.has(area)) continue;
      seenAreas.add(area);
      const prices = quantities.map((q, k) =>
        String(Math.round(area * Number(q.replace(/,/g, '')) * (1.9 - k * 0.03)) + (i % 7)),
      );
      rows.push([`${w}*${h}`, String(area), ...prices]);
    }
    const result = runEngine(sheet(quantities, rows));

    expect(result.summary.totalPrices).toBe(153 * 19);
    expect(result.summary.mismatched).toBe(0);
    expect(result.summary.invalidInput).toBe(0);
    expect(result.roundTrip.passed).toBe(true);
    expect(result.summary.allValid).toBe(true);
    expect(result.summary.maxDecimalPlaces).toBeGreaterThanOrEqual(10);
  });
});

describe('paste alignment (header row handling)', () => {
  it('adopts the quantity header when a full table is pasted at the top-left', () => {
    const start = emptySheet(['10', '20', '30'], 3);
    const matrix = [
      ['Size', 'Base Area', '100', '500', '1,000'],
      ['10*10', '100', '19000', '95000', '190000'],
      ['25*25', '625', '118750', '593750', '1187500'],
    ];
    const next = sheetReducer(start, { type: 'paste', rowIndex: 0, colIndex: 0, matrix });

    // Columns come from the pasted header, not the sheet's previous ladder.
    expect(next.quantities).toEqual(['100', '500', '1,000']);
    // The header row is NOT written in as data.
    expect(next.rows).toHaveLength(2);
    expect(next.rows[0].size).toBe('10*10');
    expect(next.rows[0].prices).toEqual(['19000', '95000', '190000']);

    const result = runEngine(next);
    expect(result.summary.invalidInput).toBe(0);
    expect(result.summary.allValid).toBe(true);
    expect(result.quantities).toEqual([100, 500, 1000]);
  });

  it('does not eat a data row that merely starts at the top-left', () => {
    const start = emptySheet(['10', '20'], 3);
    const matrix = [
      ['10*10', '100', '1900', '3600'],
      ['25*25', '625', '2500', '4700'],
    ];
    const next = sheetReducer(start, { type: 'paste', rowIndex: 0, colIndex: 0, matrix });
    expect(next.quantities).toEqual(['10', '20']);
    expect(next.rows[0].size).toBe('10*10');
    expect(next.rows[1].size).toBe('25*25');
  });

  it('reports misaligned text as grouped unreadable values', () => {
    // An extra leading column pushes text into the price cells.
    const s = sheet(
      ['10', '20'],
      [
        ['Category A', '10*10', '100', '1900'],
        ['Category A', '25*25', '625', '2500'],
      ] as [string, string, ...string[]][],
    );
    const result = runEngine(s);

    expect(result.summary.invalidInput).toBeGreaterThan(0);
    expect(result.invalidSamples.length).toBeGreaterThan(0);
    // The offending values are grouped and counted, not listed one per cell.
    const sizes = result.invalidSamples.filter((v) => v.field === 'size');
    expect(sizes[0].raw).toBe('Category A');
    expect(sizes[0].count).toBe(2);
  });

  it('caps the issue list when a paste goes badly wrong', () => {
    const rows: [string, string, ...string[]][] = [];
    for (let i = 0; i < 200; i++) rows.push(['10*10', '100', 'N/A', 'N/A']);
    const result = runEngine(sheet(['10', '20'], rows));

    expect(result.summary.invalidInput).toBe(400);
    expect(result.issues.filter((i) => i.code === 'INVALID_PRICE').length).toBeLessThanOrEqual(50);
    // …but the aggregate still accounts for every one of them.
    const na = result.invalidSamples.find((v) => v.raw === 'N/A');
    expect(na?.count).toBe(400);
  });
});

describe('pasting into the quantity header row', () => {
  it('spreads a copied quantity row across columns, growing as needed', () => {
    const start = emptySheet(['10', '20'], 2);
    const matrix = [['10', '20', '30', '50', '100', '1,000']];
    const next = sheetReducer(start, { type: 'pasteQuantities', colIndex: 0, matrix });

    expect(next.quantities).toEqual(['10', '20', '30', '50', '100', '1,000']);
    // Every row is widened to match the header.
    for (const row of next.rows) expect(row.prices).toHaveLength(6);
  });

  it('writes into the columns from the one that was pasted into', () => {
    const start = emptySheet(['10', '20', '30'], 2);
    const next = sheetReducer(start, {
      type: 'pasteQuantities',
      colIndex: 1,
      matrix: [['500', '1,000']],
    });
    expect(next.quantities).toEqual(['10', '500', '1,000']);
  });

  it('drops the rows beneath a multi-line paste into the price cells', () => {
    const start = emptySheet(['10', '20'], 3);
    const next = sheetReducer(start, {
      type: 'pasteQuantities',
      colIndex: 0,
      matrix: [
        ['10', '30'],
        ['1900', '5300'],
        ['2500', '6900'],
      ],
    });

    expect(next.quantities).toEqual(['10', '30']);
    expect(next.rows[0].prices).toEqual(['1900', '5300']);
    expect(next.rows[1].prices).toEqual(['2500', '6900']);
    expect(next.rows[2].prices).toEqual(['', '']);
  });

  it('produces a validating sheet when sizes are filled in afterwards', () => {
    let s = emptySheet(['10'], 2);
    s = sheetReducer(s, { type: 'pasteQuantities', colIndex: 0, matrix: [['10', '20', '30']] });
    s = sheetReducer(s, { type: 'setCell', rowIndex: 0, colIndex: 0, value: '10*10' });
    s = sheetReducer(s, { type: 'setCell', rowIndex: 0, colIndex: 1, value: '100' });
    s = sheetReducer(s, { type: 'setCell', rowIndex: 0, colIndex: 2, value: '1,900' });
    s = sheetReducer(s, { type: 'setCell', rowIndex: 0, colIndex: 3, value: '3,600' });
    s = sheetReducer(s, { type: 'setCell', rowIndex: 0, colIndex: 4, value: '5,300' });

    const result = runEngine(s);
    expect(result.quantities).toEqual([10, 20, 30]);
    expect(result.rateRows[0].rates).toEqual(['1.9', '1.8', '1.7666666667']);
    expect(result.summary.allValid).toBe(true);
  });
});

describe('a single copied cell is never split', () => {
  it('keeps "1,900" as one value instead of "1" and "900"', () => {
    expect(parseClipboardMatrix('1,900')).toEqual([['1,900']]);
    expect(parseClipboardMatrix('155,793,118')).toEqual([['155,793,118']]);
    expect(parseClipboardMatrix('600*610')).toEqual([['600*610']]);
  });

  it('still splits a genuine multi-cell block', () => {
    expect(parseClipboardMatrix('10*10\t100\t1,900')).toEqual([['10*10', '100', '1,900']]);
    expect(parseClipboardMatrix('1,900\n2,500')).toEqual([['1,900'], ['2,500']]);
  });
});
