import type { SheetRow, SheetState } from '../types';
import { detectQuantityHeader } from '../lib/parse';

let idCounter = 0;
export function nextRowId(): string {
  idCounter += 1;
  return `row-${idCounter}`;
}

export function emptyRow(columnCount: number): SheetRow {
  return { id: nextRowId(), size: '', baseArea: '', prices: new Array(columnCount).fill('') };
}

export function emptySheet(quantities: string[], rowCount = 12): SheetState {
  return {
    quantities: [...quantities],
    rows: Array.from({ length: rowCount }, () => emptyRow(quantities.length)),
  };
}

/** The quantity ladder from the spec (§3), used for new/blank sheets. */
export const DEFAULT_QUANTITIES = [
  '10', '20', '30', '40', '50', '100', '200', '300', '500', '1000',
  '2000', '3000', '5000', '10000', '20000', '30000', '50000', '70000', '100000',
];

/** Grid column layout: 0 = Size, 1 = Base Area, 2+ = quantity columns. */
export const COL_SIZE = 0;
export const COL_BASE_AREA = 1;
export const FIRST_PRICE_COL = 2;

export type SheetAction =
  | { type: 'setCell'; rowIndex: number; colIndex: number; value: string }
  | { type: 'setQuantityHeader'; colIndex: number; value: string }
  | { type: 'addRows'; count: number; atIndex?: number }
  | { type: 'deleteRows'; rowIndexes: number[] }
  | { type: 'addColumn'; value?: string }
  | { type: 'deleteColumn'; colIndex: number }
  | { type: 'clearCells'; rowStart: number; rowEnd: number; colStart: number; colEnd: number }
  | { type: 'paste'; rowIndex: number; colIndex: number; matrix: string[][] }
  | { type: 'pasteQuantities'; colIndex: number; matrix: string[][] }
  | { type: 'replaceAll'; sheet: SheetState }
  | { type: 'clearAll' };

export function sheetReducer(state: SheetState, action: SheetAction): SheetState {
  switch (action.type) {
    case 'setCell': {
      const rows = state.rows.slice();
      const row = rows[action.rowIndex];
      if (!row) return state;
      const next: SheetRow = { ...row, prices: row.prices.slice() };
      if (action.colIndex === COL_SIZE) next.size = action.value;
      else if (action.colIndex === COL_BASE_AREA) next.baseArea = action.value;
      else next.prices[action.colIndex - FIRST_PRICE_COL] = action.value;
      rows[action.rowIndex] = next;
      return { ...state, rows };
    }

    case 'setQuantityHeader': {
      const quantities = state.quantities.slice();
      if (action.colIndex < 0 || action.colIndex >= quantities.length) return state;
      quantities[action.colIndex] = action.value;
      return { ...state, quantities };
    }

    case 'addRows': {
      const rows = state.rows.slice();
      const fresh = Array.from({ length: action.count }, () => emptyRow(state.quantities.length));
      if (action.atIndex == null) rows.push(...fresh);
      else rows.splice(action.atIndex, 0, ...fresh);
      return { ...state, rows };
    }

    case 'deleteRows': {
      const drop = new Set(action.rowIndexes);
      const rows = state.rows.filter((_, i) => !drop.has(i));
      // Never leave the user with nothing to type into.
      return { ...state, rows: rows.length > 0 ? rows : [emptyRow(state.quantities.length)] };
    }

    case 'addColumn': {
      const quantities = [...state.quantities, action.value ?? ''];
      const rows = state.rows.map((r) => ({ ...r, prices: [...r.prices, ''] }));
      return { quantities, rows };
    }

    case 'deleteColumn': {
      if (state.quantities.length <= 1) return state;
      const quantities = state.quantities.filter((_, i) => i !== action.colIndex);
      const rows = state.rows.map((r) => ({
        ...r,
        prices: r.prices.filter((_, i) => i !== action.colIndex),
      }));
      return { quantities, rows };
    }

    case 'clearCells': {
      const rows = state.rows.slice();
      for (let r = action.rowStart; r <= action.rowEnd; r++) {
        const row = rows[r];
        if (!row) continue;
        const next: SheetRow = { ...row, prices: row.prices.slice() };
        for (let c = action.colStart; c <= action.colEnd; c++) {
          if (c === COL_SIZE) next.size = '';
          else if (c === COL_BASE_AREA) next.baseArea = '';
          else if (c - FIRST_PRICE_COL < next.prices.length) next.prices[c - FIRST_PRICE_COL] = '';
        }
        rows[r] = next;
      }
      return { ...state, rows };
    }

    case 'paste':
      return applyPaste(state, action.rowIndex, action.colIndex, action.matrix);

    case 'pasteQuantities':
      return applyQuantityPaste(state, action.colIndex, action.matrix);

    case 'replaceAll':
      return action.sheet;

    case 'clearAll':
      return emptySheet(state.quantities);

    default:
      return state;
  }
}

/**
 * Write a pasted block into the sheet at (rowIndex, colIndex), growing rows and
 * quantity columns as needed so a paste is never silently truncated.
 */
function applyPaste(state: SheetState, rowIndex: number, colIndex: number, matrix: string[][]): SheetState {
  if (matrix.length === 0) return state;

  // Pasting a whole table at the top-left: adopt its header row as the quantity
  // columns instead of writing "Size | Base Area | 10 | 20 …" in as a data row.
  // Without this the sheet keeps its default quantity ladder and every column
  // silently lands under the wrong quantity.
  if (rowIndex === 0 && colIndex === 0) {
    const header = detectQuantityHeader(matrix[0]);
    if (header) {
      const body = matrix.slice(1);
      const rows = body.map((r) => ({
        id: nextRowId(),
        size: (r[COL_SIZE] ?? '').trim(),
        baseArea: (r[COL_BASE_AREA] ?? '').trim(),
        prices: header.map((_, i) => (r[FIRST_PRICE_COL + i] ?? '').trim()),
      }));
      if (rows.length === 0) rows.push(emptyRow(header.length));
      return { quantities: header, rows };
    }
  }

  const width = Math.max(...matrix.map((r) => r.length));
  const neededColumns = colIndex + width - FIRST_PRICE_COL;
  const quantities = state.quantities.slice();
  while (quantities.length < neededColumns) quantities.push('');

  const rows = state.rows.slice();
  const neededRows = rowIndex + matrix.length;
  while (rows.length < neededRows) rows.push(emptyRow(quantities.length));

  for (let r = 0; r < matrix.length; r++) {
    const target = rows[rowIndex + r];
    const prices = target.prices.slice();
    while (prices.length < quantities.length) prices.push('');
    const next: SheetRow = { ...target, prices };

    for (let c = 0; c < matrix[r].length; c++) {
      const value = matrix[r][c];
      const col = colIndex + c;
      if (col === COL_SIZE) next.size = value;
      else if (col === COL_BASE_AREA) next.baseArea = value;
      else next.prices[col - FIRST_PRICE_COL] = value;
    }
    rows[rowIndex + r] = next;
  }

  // Pad every other row so all rows share the column count.
  const normalized = rows.map((r) =>
    r.prices.length === quantities.length
      ? r
      : { ...r, prices: [...r.prices, ...new Array(Math.max(0, quantities.length - r.prices.length)).fill('')] },
  );

  return { quantities, rows: normalized };
}

/**
 * Paste a row of quantities into the header, starting at `colIndex`.
 *
 * Mirrors spreadsheet behaviour: the block's first line fills the quantity
 * headers, and any further lines drop into the price cells beneath, starting at
 * row 1. Columns are added as needed so a wide paste is never truncated.
 */
function applyQuantityPaste(state: SheetState, colIndex: number, matrix: string[][]): SheetState {
  if (matrix.length === 0) return state;

  const headerLine = matrix[0] ?? [];
  const width = Math.max(...matrix.map((r) => r.length));

  const quantities = state.quantities.slice();
  while (quantities.length < colIndex + width) quantities.push('');
  for (let i = 0; i < headerLine.length; i++) {
    quantities[colIndex + i] = headerLine[i].trim();
  }

  // Keep every row's price array the same width as the header.
  let rows = state.rows.map((r) =>
    r.prices.length === quantities.length
      ? r
      : { ...r, prices: [...r.prices, ...new Array(Math.max(0, quantities.length - r.prices.length)).fill('')] },
  );

  const body = matrix.slice(1);
  if (body.length > 0) {
    while (rows.length < body.length) rows.push(emptyRow(quantities.length));
    for (let r = 0; r < body.length; r++) {
      const prices = rows[r].prices.slice();
      for (let c = 0; c < body[r].length; c++) {
        const target = colIndex + c;
        if (target < prices.length) prices[target] = body[r][c];
      }
      rows[r] = { ...rows[r], prices };
    }
  }

  return { quantities, rows };
}

/**
 * Turn an imported/pasted matrix into a complete sheet.
 *
 * When the first line looks like a header (Size | Base Area | 10 | 20 | ...) its
 * quantity cells become the columns; otherwise the existing columns are kept and
 * the block is treated as pure data.
 */
export function matrixToSheet(matrix: string[][], fallbackQuantities: string[]): SheetState {
  const cleaned = matrix.filter((r) => r.some((c) => c.trim() !== ''));
  if (cleaned.length === 0) return emptySheet(fallbackQuantities);

  const header = detectQuantityHeader(cleaned[0]);
  const quantities = header ?? fallbackQuantities;
  const dataRows = header ? cleaned.slice(1) : cleaned;

  const rows: SheetRow[] = dataRows.map((r) => ({
    id: nextRowId(),
    size: (r[COL_SIZE] ?? '').trim(),
    baseArea: (r[COL_BASE_AREA] ?? '').trim(),
    prices: quantities.map((_, i) => (r[FIRST_PRICE_COL + i] ?? '').trim()),
  }));

  if (rows.length === 0) rows.push(emptyRow(quantities.length));
  return { quantities, rows };
}

/** Serialize a rectangular selection back to TSV for the clipboard. */
export function selectionToTsv(
  sheet: SheetState,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
): string {
  const lines: string[] = [];
  for (let r = rowStart; r <= rowEnd; r++) {
    const row = sheet.rows[r];
    if (!row) continue;
    const cells: string[] = [];
    for (let c = colStart; c <= colEnd; c++) {
      if (c === COL_SIZE) cells.push(row.size);
      else if (c === COL_BASE_AREA) cells.push(row.baseArea);
      else cells.push(row.prices[c - FIRST_PRICE_COL] ?? '');
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

export function getCellValue(sheet: SheetState, rowIndex: number, colIndex: number): string {
  const row = sheet.rows[rowIndex];
  if (!row) return '';
  if (colIndex === COL_SIZE) return row.size;
  if (colIndex === COL_BASE_AREA) return row.baseArea;
  return row.prices[colIndex - FIRST_PRICE_COL] ?? '';
}
