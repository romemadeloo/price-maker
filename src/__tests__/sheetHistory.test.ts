import { describe, expect, it } from 'vitest';
import { historyReducer, initHistory, type HistoryAction, type SheetHistory } from '../state/history';
import { sheetReducer, sheetToTsv } from '../state/sheetReducer';
import { columnLetter } from '../components/SpreadsheetGrid';
import type { SheetState } from '../types';

const SHEET: SheetState = {
  quantities: ['10', '20', '30'],
  rows: [
    { id: 'a', size: '10*10', baseArea: '100', prices: ['1,900', '3,600', '5,300'] },
    { id: 'b', size: '15*15', baseArea: '225', prices: ['2,100', '4,000', '5,800'] },
    { id: 'c', size: '', baseArea: '', prices: ['', '', ''] },
  ],
};

const run = (actions: HistoryAction[], start: SheetHistory = initHistory(SHEET)) => actions.reduce(historyReducer, start);

describe('undo / redo', () => {
  it('undoes and redoes edits in order', () => {
    const h = run([
      { type: 'setCell', rowIndex: 0, colIndex: 2, value: '2,000' },
      { type: 'deleteRows', rowIndexes: [1] },
    ]);
    expect(h.present.rows).toHaveLength(2);

    const once = run([{ type: 'undo' }], h);
    expect(once.present.rows).toHaveLength(3);
    expect(once.present.rows[0].prices[0]).toBe('2,000');

    const twice = run([{ type: 'undo' }], once);
    expect(twice.present).toBe(SHEET);
    expect(run([{ type: 'undo' }], twice)).toBe(twice); // nothing left

    const again = run([{ type: 'redo' }, { type: 'redo' }], twice);
    expect(again.present).toEqual(h.present);
  });

  it('drops the redo stack after a new edit', () => {
    const h = run([{ type: 'setCell', rowIndex: 0, colIndex: 0, value: 'x' }, { type: 'undo' }, { type: 'clearAll' }]);
    expect(h.future).toHaveLength(0);
    expect(run([{ type: 'redo' }], h)).toBe(h);
  });

  it('makes Load sample / Clear undoable', () => {
    const h = run([{ type: 'clearAll' }, { type: 'undo' }]);
    expect(h.present).toBe(SHEET);
  });

  it('treats typing in one quantity header as a single step', () => {
    const h = run([
      { type: 'setQuantityHeader', colIndex: 0, value: '1' },
      { type: 'setQuantityHeader', colIndex: 0, value: '10' },
      { type: 'setQuantityHeader', colIndex: 0, value: '100' },
    ]);
    expect(h.past).toHaveLength(1);
    expect(run([{ type: 'undo' }], h).present.quantities[0]).toBe('10');
  });

  it('records nothing for an action that changes nothing', () => {
    const h = run([{ type: 'deleteColumns', colIndexes: [] }]);
    expect(h.past).toHaveLength(0);
  });
});

describe('row and column operations', () => {
  it('inserts quantity columns at a position, in every row', () => {
    const next = sheetReducer(SHEET, { type: 'insertColumns', atIndex: 1, count: 2 });
    expect(next.quantities).toEqual(['10', '', '', '20', '30']);
    expect(next.rows[0].prices).toEqual(['1,900', '', '', '3,600', '5,300']);
  });

  it('deletes several quantity columns but always keeps one', () => {
    const two = sheetReducer(SHEET, { type: 'deleteColumns', colIndexes: [0, 2] });
    expect(two.quantities).toEqual(['20']);
    expect(two.rows[1].prices).toEqual(['4,000']);

    const all = sheetReducer(SHEET, { type: 'deleteColumns', colIndexes: [0, 1, 2] });
    expect(all.quantities).toHaveLength(1);
  });

  it('inserts rows above a position', () => {
    const next = sheetReducer(SHEET, { type: 'addRows', count: 2, atIndex: 1 });
    expect(next.rows.map((r) => r.size)).toEqual(['10*10', '', '', '15*15', '']);
  });

  it('fills down from the first row and right from the first column', () => {
    const down = sheetReducer(SHEET, { type: 'fill', direction: 'down', rowStart: 0, rowEnd: 2, colStart: 2, colEnd: 3 });
    expect(down.rows.map((r) => r.prices.slice(0, 2))).toEqual([
      ['1,900', '3,600'],
      ['1,900', '3,600'],
      ['1,900', '3,600'],
    ]);

    const right = sheetReducer(SHEET, { type: 'fill', direction: 'right', rowStart: 1, rowEnd: 1, colStart: 2, colEnd: 4 });
    expect(right.rows[1].prices).toEqual(['2,100', '2,100', '2,100']);
  });

  it('copies the whole sheet with headers, without trailing empty rows', () => {
    expect(sheetToTsv(SHEET)).toBe(
      ['Size\tBase Area\t10\t20\t30', '10*10\t100\t1,900\t3,600\t5,300', '15*15\t225\t2,100\t4,000\t5,800'].join('\n'),
    );
  });

  it('letters columns the way spreadsheets do', () => {
    expect([0, 1, 2, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'B', 'C', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});
