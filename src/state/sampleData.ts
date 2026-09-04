import { D, roundToWon } from '../lib/decimal';
import type { SheetRow, SheetState } from '../types';
import { nextRowId } from './sheetReducer';

/**
 * A demo table so the app is usable the moment it opens.
 *
 * Rows 1–3 are the worked examples from the spec, with the exact expected prices
 * it quotes. The remaining rows are generated the way a real price book is: a
 * per-quantity unit rate applied to the area and rounded to the won — which is
 * precisely what produces awkward repeating rates that need more than a handful
 * of decimal places to reverse.
 */

export const SAMPLE_QUANTITIES = [
  '10', '20', '30', '40', '50', '100', '200', '300', '500', '1,000',
  '2,000', '3,000', '5,000', '10,000', '20,000', '30,000', '50,000', '70,000', '100,000',
];

const QTY_VALUES = SAMPLE_QUANTITIES.map((q) => Number(q.replace(/,/g, '')));

/** Unit price per mm² at qty 10, tapering with volume. */
const VOLUME_FACTOR = [
  1, 0.947, 0.929, 0.921, 0.905, 0.679, 0.611, 0.578, 0.541, 0.512,
  0.478, 0.461, 0.441, 0.418, 0.397, 0.373, 0.361, 0.352, 0.344,
];

interface SampleSpec {
  size: string;
  baseArea: number;
  /** Base rate at qty 10, in won per mm². */
  baseRate: string;
}

const GENERATED: SampleSpec[] = [
  { size: '50*50', baseArea: 2500, baseRate: '0.213' },
  { size: '100*100', baseArea: 10000, baseRate: '0.1043' },
  { size: '150*200', baseArea: 30000, baseRate: '0.0717' },
  { size: '210*297', baseArea: 62370, baseRate: '0.0561' },
  { size: '297*420', baseArea: 124740, baseRate: '0.0397' },
  { size: '400*500', baseArea: 200000, baseRate: '0.0311' },
  { size: '600*610', baseArea: 366000, baseRate: '0.0243' },
  { size: '900*1200', baseArea: 1080000, baseRate: '0.0176' },
];

/** The three rows the spec walks through, with its literal expected prices. */
const LITERAL_ROWS: { size: string; baseArea: string; prices: Record<number, string> }[] = [
  {
    size: '10*10',
    baseArea: '100',
    prices: { 10: '1,900', 20: '3,600', 30: '5,300', 40: '7,000', 50: '8,600', 100: '12,900' },
  },
  {
    size: '15*15',
    baseArea: '225',
    prices: { 10: '2,100', 20: '4,000', 30: '5,800', 40: '7,600', 50: '9,300', 100: '14,000' },
  },
  {
    size: '25*25',
    baseArea: '625',
    prices: { 10: '2,500', 20: '4,700', 30: '6,900', 40: '8,800', 50: '10,700', 100: '16,100' },
  },
];

function generatedRow(spec: SampleSpec): SheetRow {
  const prices = QTY_VALUES.map((qty, i) => {
    const rate = new D(spec.baseRate).times(VOLUME_FACTOR[i]);
    const price = roundToWon(new D(spec.baseArea).times(qty).times(rate));
    return price.toFixed();
  });

  // Pin the row the spec calls out by name so the demo always exercises it.
  if (spec.baseArea === 366000) {
    const qtyIndex = QTY_VALUES.indexOf(30000);
    if (qtyIndex >= 0) prices[qtyIndex] = '155793118';
  }

  return { id: nextRowId(), size: spec.size, baseArea: String(spec.baseArea), prices };
}

export function buildSampleSheet(): SheetState {
  const rows: SheetRow[] = [
    ...LITERAL_ROWS.map((r) => ({
      id: nextRowId(),
      size: r.size,
      baseArea: r.baseArea,
      prices: QTY_VALUES.map((q) => r.prices[q] ?? ''),
    })),
    ...GENERATED.map(generatedRow),
  ];

  return { quantities: [...SAMPLE_QUANTITIES], rows };
}
