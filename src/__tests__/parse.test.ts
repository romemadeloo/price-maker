import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  parseBaseArea,
  parseClipboardMatrix,
  parseDelimited,
  parseNumeric,
  parsePriceCell,
  parseQuantityHeader,
  parseSize,
} from '../lib/parse';

describe('parseNumeric (spec §16)', () => {
  it('normalizes currency symbols and thousands separators', () => {
    expect(parseNumeric('1900').value).toBe(1900);
    expect(parseNumeric('1,900').value).toBe(1900);
    expect(parseNumeric('₩1,900').value).toBe(1900);
    expect(parseNumeric('₩ 1,900').value).toBe(1900);
    expect(parseNumeric('155,793,118').value).toBe(155793118);
    expect(parseNumeric('₩155,793,118').value).toBe(155793118);
    expect(parseNumeric('1 900').value).toBe(1900);
    expect(parseNumeric('  2500  ').value).toBe(2500);
  });

  it('keeps blanks blank instead of turning them into zero', () => {
    expect(parseNumeric('').blank).toBe(true);
    expect(parseNumeric('   ').blank).toBe(true);
    expect(parseNumeric(null).blank).toBe(true);
    expect(parseNumeric('').value).toBeNull();
    expect(parseNumeric('0').value).toBe(0);
    expect(parseNumeric('0').blank).toBe(false);
  });

  it('reports unexpected text rather than guessing', () => {
    expect(parseNumeric('abc').error).toBeTruthy();
    expect(parseNumeric('1,9x0').error).toBeTruthy();
    expect(parseNumeric('--5').error).toBeTruthy();
  });

  it('reads accounting-style negatives', () => {
    expect(parseNumeric('(1,900)').value).toBe(-1900);
  });
});

describe('parseQuantityHeader (spec §3)', () => {
  it('normalizes comma-grouped headers', () => {
    expect(parseQuantityHeader('1,000', 0).value).toBe(1000);
    expect(parseQuantityHeader('10,000', 0).value).toBe(10000);
    expect(parseQuantityHeader('100,000', 0).value).toBe(100000);
    expect(parseQuantityHeader('10', 0).value).toBe(10);
  });

  it('rejects non-positive and fractional quantities', () => {
    expect(parseQuantityHeader('0', 0).error).toBeTruthy();
    expect(parseQuantityHeader('-10', 0).error).toBeTruthy();
    expect(parseQuantityHeader('10.5', 0).error).toBeTruthy();
    expect(parseQuantityHeader('', 0).error).toBe('Missing quantity header');
  });
});

describe('parseSize (spec §4)', () => {
  it('accepts every separator form', () => {
    for (const raw of ['600*610', '600x610', '600 x 610', '600 × 610', '600X610', '600 * 610']) {
      const s = parseSize(raw);
      expect(s.error, raw).toBeNull();
      expect(s.width).toBe(600);
      expect(s.height).toBe(610);
      expect(s.calculatedArea).toBe(366000);
    }
  });

  it('computes width x height', () => {
    expect(parseSize('10*10').calculatedArea).toBe(100);
    expect(parseSize('25x25').calculatedArea).toBe(625);
    expect(parseSize('1,200 x 800').calculatedArea).toBe(960000);
  });

  it('flags missing and malformed sizes', () => {
    expect(parseSize('').error).toBe('Missing size');
    expect(parseSize('big').error).toBeTruthy();
    expect(parseSize('10*').error).toBeTruthy();
    expect(parseSize('0*10').error).toBeTruthy();
  });
});

describe('parseBaseArea / parsePriceCell (spec §17)', () => {
  it('rejects a non-positive base area', () => {
    expect(parseBaseArea('0').error).toBeTruthy();
    expect(parseBaseArea('-5').error).toBeTruthy();
    expect(parseBaseArea('').error).toBe('Missing base area');
    expect(parseBaseArea('366,000').value).toBe(366000);
  });

  it('rejects negative and non-integer expected prices', () => {
    expect(parsePriceCell('-100', 0, 0).status).toBe('invalid');
    expect(parsePriceCell('1900.5', 0, 0).status).toBe('invalid');
    expect(parsePriceCell('1900.00', 0, 0).status).toBe('ok');
    expect(parsePriceCell('nope', 0, 0).status).toBe('invalid');
    expect(parsePriceCell('', 0, 0).status).toBe('blank');
  });
});

describe('parseDelimited', () => {
  it('splits tab-separated clipboard data', () => {
    const m = parseDelimited('Size\tBase Area\t10\n10*10\t100\t1,900\n');
    expect(m).toEqual([
      ['Size', 'Base Area', '10'],
      ['10*10', '100', '1,900'],
    ]);
  });

  it('honours RFC-4180 quoting', () => {
    const m = parseDelimited('a,"b,c",d\n1,"say ""hi""",3\n', ',');
    expect(m[0]).toEqual(['a', 'b,c', 'd']);
    expect(m[1]).toEqual(['1', 'say "hi"', '3']);
  });

  it('detects the delimiter', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  it('handles CRLF line endings', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('detectDelimiter — grouped numbers must not shred a TSV paste', () => {
  const QTY = ['10','20','30','40','50','100','200','300','500','1,000','2,000','3,000','5,000','10,000','20,000','30,000','50,000','70,000','100,000'];

  function wideTsv(rows: number): string {
    const line = (n: number) =>
      ['600*610', '366000', ...QTY.map((_, i) => (12345678 + i * n).toLocaleString('en-US'))].join('\t');
    return [`Size\tBase Area\t${QTY.join('\t')}`, ...Array.from({ length: rows }, (_, i) => line(i + 1))].join('\n');
  }

  it('picks TAB even when commas inside the numbers outnumber the tabs', () => {
    const text = wideTsv(4);
    const commas = (text.match(/,/g) ?? []).length;
    const tabs = (text.match(/\t/g) ?? []).length;
    expect(commas).toBeGreaterThan(tabs); // the condition that used to break it

    expect(detectDelimiter(text)).toBe('\t');
  });

  it('keeps every row the full width instead of splitting numbers at the comma', () => {
    const matrix = parseDelimited(wideTsv(4));
    expect(matrix).toHaveLength(5);
    for (const row of matrix) expect(row).toHaveLength(2 + QTY.length);
    // "1,000" stays one header cell, not "1" and "000".
    expect(matrix[0][11]).toBe('1,000');
    expect(matrix[1][2]).toBe('12,345,678');
  });

  it('does not split a grouped size/base-area pair in half', () => {
    // The exact failure mode: 1,225 -> "1" + "225".
    const text = 'Size\tBase Area\t10\n35*35\t1,225\t2,500\n40*40\t1,600\t3,000';
    const matrix = parseDelimited(text);
    expect(matrix[1]).toEqual(['35*35', '1,225', '2,500']);
    expect(matrix[2]).toEqual(['40*40', '1,600', '3,000']);
  });

  it('still reads a genuine comma CSV', () => {
    expect(detectDelimiter('area_factor,10,20\n100,1.9,1.8')).toBe(',');
    expect(parseDelimited('area_factor,10,20\n100,1.9,1.8')[1]).toEqual(['100', '1.9', '1.8']);
  });

  it('still reads a quoted CSV with grouped numbers', () => {
    const m = parseDelimited('Size,Base Area,10\n35*35,"1,225","2,500"');
    expect(m[1]).toEqual(['35*35', '1,225', '2,500']);
  });
});

describe('parseClipboardMatrix — spreadsheet clipboard rules', () => {
  it('treats a lone value as one cell', () => {
    expect(parseClipboardMatrix('1,900')).toEqual([['1,900']]);
    expect(parseClipboardMatrix('155,793,118')).toEqual([['155,793,118']]);
  });

  it('treats a tab-free multi-line block as a single column', () => {
    expect(parseClipboardMatrix('1,900\n2,500\n5,300')).toEqual([['1,900'], ['2,500'], ['5,300']]);
    // A copied column of sizes.
    expect(parseClipboardMatrix('10*10\r\n25*25')).toEqual([['10*10'], ['25*25']]);
  });

  it('splits on tabs when they are present', () => {
    expect(parseClipboardMatrix('10*10\t100\t1,900')).toEqual([['10*10', '100', '1,900']]);
    expect(parseClipboardMatrix('Size\tBase Area\t1,000\n10*10\t100\t190,000')).toEqual([
      ['Size', 'Base Area', '1,000'],
      ['10*10', '100', '190,000'],
    ]);
  });

  it('ignores a single trailing newline', () => {
    expect(parseClipboardMatrix('1,900\n2,500\n')).toEqual([['1,900'], ['2,500']]);
  });
});
