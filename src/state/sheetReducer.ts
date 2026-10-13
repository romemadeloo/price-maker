import type { SheetRow, SheetState } from '../types';
import { parseNumeric, parseSize } from '../lib/parse';

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

/**
 * Grid layout: column 0 = Base Area, 1+ = quantity columns.
 *
 * The sheet used to start with a Size column. Production prices by area alone,
 * so it was dropped; `SheetRow.size` stays in the type (always blank) so stored
 * data and the engine keep their shape, and pasted or imported tables that
 * still carry a Size column have it removed on the way in (dropSizeColumn).
 *
 * Row -1 is the quantity row: the frozen header whose cells hold each column's
 * quantity. It can be selected, typed into, cleared, copied and pasted into
 * like any other row.
 */
export const COL_BASE_AREA = 0;
export const FIRST_PRICE_COL = 1;
export const QTY_ROW = -1;

export const BASE_AREA_LABEL = 'Base Area';

export type SheetAction =
  /** rowIndex QTY_ROW writes a quantity header. */
  | { type: 'setCell'; rowIndex: number; colIndex: number; value: string }
  | { type: 'setQuantityHeader'; colIndex: number; value: string }
  | { type: 'addRows'; count: number; atIndex?: number }
  | { type: 'deleteRows'; rowIndexes: number[] }
  | { type: 'addColumn'; value?: string }
  | { type: 'deleteColumn'; colIndex: number }
  /** Insert blank quantity columns before quantity index `atIndex`. */
  | { type: 'insertColumns'; atIndex: number; count: number }
  /** Delete quantity columns by quantity index; at least one always stays. */
  | { type: 'deleteColumns'; colIndexes: number[] }
  /** Copy the first row (down) or first column (right) of a range across it. */
  | { type: 'fill'; rowStart: number; rowEnd: number; colStart: number; colEnd: number; direction: 'down' | 'right' }
  /** rowStart QTY_ROW includes the quantity row. */
  | { type: 'clearCells'; rowStart: number; rowEnd: number; colStart: number; colEnd: number }
  /** rowIndex QTY_ROW pastes into the quantity row; further lines flow into the rows below. */
  | { type: 'paste'; rowIndex: number; colIndex: number; matrix: string[][] }
  | { type: 'pasteQuantities'; colIndex: number; matrix: string[][] }
  | { type: 'replaceAll'; sheet: SheetState }
  | { type: 'clearAll' };

function withQuantity(state: SheetState, quantityIndex: number, value: string): SheetState {
  if (quantityIndex < 0 || quantityIndex >= state.quantities.length) return state;
  if (state.quantities[quantityIndex] === value) return state;
  const quantities = state.quantities.slice();
  quantities[quantityIndex] = value;
  return { ...state, quantities };
}

function writeCell(row: SheetRow, colIndex: number, value: string): void {
  if (colIndex === COL_BASE_AREA) row.baseArea = value;
  else if (colIndex - FIRST_PRICE_COL < row.prices.length) row.prices[colIndex - FIRST_PRICE_COL] = value;
}

export function sheetReducer(state: SheetState, action: SheetAction): SheetState {
  switch (action.type) {
    case 'setCell': {
      if (action.rowIndex === QTY_ROW) return withQuantity(state, action.colIndex - FIRST_PRICE_COL, action.value);
      const rows = state.rows.slice();
      const row = rows[action.rowIndex];
      if (!row) return state;
      const next: SheetRow = { ...row, prices: row.prices.slice() };
      writeCell(next, action.colIndex, action.value);
      rows[action.rowIndex] = next;
      return { ...state, rows };
    }

    case 'setQuantityHeader':
      return withQuantity(state, action.colIndex, action.value);

    case 'addRows': {
      const rows = state.rows.slice();
      const fresh = Array.from({ length: action.count }, () => emptyRow(state.quantities.length));
      if (action.atIndex == null) rows.push(...fresh);
      else rows.splice(Math.max(0, action.atIndex), 0, ...fresh);
      return { ...state, rows };
    }

    case 'deleteRows': {
      const drop = new Set(action.rowIndexes.filter((i) => i >= 0));
      if (drop.size === 0) return state;
      const rows = state.rows.filter((_, i) => !drop.has(i));
      // Never leave the user with nothing to type into.
      return { ...state, rows: rows.length > 0 ? rows : [emptyRow(state.quantities.length)] };
    }

    case 'addColumn': {
      const quantities = [...state.quantities, action.value ?? ''];
      const rows = state.rows.map((r) => ({ ...r, prices: [...r.prices, ''] }));
      return { quantities, rows };
    }

    case 'deleteColumn':
      return sheetReducer(state, { type: 'deleteColumns', colIndexes: [action.colIndex] });

    case 'insertColumns': {
      if (action.count <= 0) return state;
      const at = Math.max(0, Math.min(state.quantities.length, action.atIndex));
      const blanks = new Array<string>(action.count).fill('');
      const quantities = [...state.quantities.slice(0, at), ...blanks, ...state.quantities.slice(at)];
      const rows = state.rows.map((r) => ({
        ...r,
        prices: [...r.prices.slice(0, at), ...blanks, ...r.prices.slice(at)],
      }));
      return { quantities, rows };
    }

    case 'deleteColumns': {
      const drop = new Set(action.colIndexes.filter((i) => i >= 0 && i < state.quantities.length));
      if (drop.size === 0) return state;
      // Keep one column to type into, as with rows.
      if (drop.size >= state.quantities.length) drop.delete(Math.min(...drop));
      const quantities = state.quantities.filter((_, i) => !drop.has(i));
      const rows = state.rows.map((r) => ({ ...r, prices: r.prices.filter((_, i) => !drop.has(i)) }));
      return { quantities, rows };
    }

    case 'fill': {
      const { colStart, colEnd, direction } = action;
      // The quantity row is never a fill source or target for prices.
      const rowStart = Math.max(0, action.rowStart);
      const rowEnd = action.rowEnd;
      if (direction === 'down' ? rowEnd <= rowStart : colEnd <= colStart) return state;
      const rows = state.rows.slice();
      for (let r = rowStart; r <= rowEnd; r++) {
        const row = rows[r];
        if (!row) continue;
        const next: SheetRow = { ...row, prices: row.prices.slice() };
        for (let c = colStart; c <= colEnd; c++) {
          const value = direction === 'down' ? getCellValue(state, rowStart, c) : getCellValue(state, r, colStart);
          writeCell(next, c, value);
        }
        rows[r] = next;
      }
      return { ...state, rows };
    }

    case 'clearCells': {
      let next = state;
      if (action.rowStart === QTY_ROW) {
        const quantities = state.quantities.slice();
        for (let c = Math.max(action.colStart, FIRST_PRICE_COL); c <= action.colEnd; c++) {
          if (c - FIRST_PRICE_COL < quantities.length) quantities[c - FIRST_PRICE_COL] = '';
        }
        next = { ...state, quantities };
      }
      if (action.rowEnd < 0) return next;
      const rows = next.rows.slice();
      for (let r = Math.max(0, action.rowStart); r <= action.rowEnd; r++) {
        const row = rows[r];
        if (!row) continue;
        const cleared: SheetRow = { ...row, prices: row.prices.slice() };
        for (let c = action.colStart; c <= action.colEnd; c++) writeCell(cleared, c, '');
        rows[r] = cleared;
      }
      return { ...next, rows };
    }

    case 'paste':
      return applyPaste(state, action.rowIndex, action.colIndex, action.matrix);

    case 'pasteQuantities':
      return applyPaste(state, QTY_ROW, FIRST_PRICE_COL + action.colIndex, action.matrix);

    case 'replaceAll':
      return action.sheet;

    case 'clearAll':
      return emptySheet(state.quantities);

    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* Getting tables in: the legacy Size column and header rows           */
/* ------------------------------------------------------------------ */

const SIZE_WORDS = ['size', 'sizes', 'dimension', 'dimensions', '사이즈', '규격'];
const AREA_WORDS = ['area', 'area factor', 'basearea', '면적'];

const isSizeLabel = (cell: string | undefined) => {
  const t = (cell ?? '').trim().toLowerCase();
  return t !== '' && SIZE_WORDS.some((w) => t === w || t.startsWith(w));
};

/**
 * Remove a leading Size column from a pasted/imported block, if it has one:
 * either its header says "Size", or its first column holds sizes ("600*610").
 * Tables made for the old layout keep working.
 */
export function dropSizeColumn(matrix: string[][]): string[][] {
  if (matrix.length === 0) return matrix;
  if (isSizeLabel(matrix[0][0])) return matrix.map((r) => r.slice(1));

  const firsts = matrix.map((r) => (r[0] ?? '').trim()).filter((v) => v !== '');
  if (firsts.length === 0) return matrix;
  const sizes = firsts.filter((v) => {
    const p = parseSize(v);
    return p.width != null && p.height != null && parseNumeric(v).value == null;
  });
  return sizes.length * 2 > firsts.length ? matrix.map((r) => r.slice(1)) : matrix;
}

/**
 * The quantities, if this line (in the Base Area | qty… layout) is a header:
 * a "Base Area"-style label first, or a non-number first followed by positive
 * whole numbers.
 */
export function quantityHeaderOf(line: string[] | undefined): string[] | null {
  if (!line || line.length < 2) return null;
  const first = line[0].trim().toLowerCase();
  const tail = line.slice(1).map((c) => c.trim());
  const byLabel = first !== '' && AREA_WORDS.some((w) => first.replace(/[\s_]+/g, ' ').includes(w));
  const byShape =
    first !== '' &&
    parseNumeric(first).value == null &&
    tail.some((c) => c !== '') &&
    tail.every((c) => {
      if (c === '') return true;
      const n = parseNumeric(c);
      return n.value != null && Number.isInteger(n.value) && n.value > 0;
    });
  if (!byLabel && !byShape) return null;

  const quantities = tail.slice();
  while (quantities.length > 0 && quantities[quantities.length - 1] === '') quantities.pop();
  return quantities.length > 0 ? quantities : null;
}

/** Write a block of data rows at (rowIndex, colIndex), growing rows and columns to fit. */
function writeBlock(state: SheetState, rowIndex: number, colIndex: number, matrix: string[][]): SheetState {
  if (matrix.length === 0) return state;
  const width = Math.max(...matrix.map((r) => r.length));
  const quantities = state.quantities.slice();
  while (quantities.length < colIndex + width - FIRST_PRICE_COL) quantities.push('');

  const rows = state.rows.slice();
  while (rows.length < rowIndex + matrix.length) rows.push(emptyRow(quantities.length));

  for (let r = 0; r < matrix.length; r++) {
    const target = rows[rowIndex + r];
    const prices = target.prices.slice();
    while (prices.length < quantities.length) prices.push('');
    const next: SheetRow = { ...target, prices };
    matrix[r].forEach((value, c) => writeCell(next, colIndex + c, value));
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
 * Paste a block at (rowIndex, colIndex), never silently truncating it.
 *
 * - Into the quantity row: its first line fills the quantities (a cell landing
 *   on the Base Area label is skipped), further lines fill the rows below.
 * - A whole table with a header line, pasted at the top-left (the quantity
 *   row's first cell, or the first data cell), replaces the sheet.
 */
function applyPaste(state: SheetState, rowIndex: number, colIndex: number, input: string[][]): SheetState {
  if (input.length === 0) return state;
  const matrix = colIndex === COL_BASE_AREA ? dropSizeColumn(input) : input;
  if (matrix.length === 0 || matrix.every((r) => r.length === 0)) return state;

  if (colIndex === COL_BASE_AREA && (rowIndex === QTY_ROW || rowIndex === 0)) {
    const header = quantityHeaderOf(matrix[0]);
    if (header && (rowIndex === QTY_ROW || matrix.length > 1)) {
      const body = matrix.slice(1);
      if (body.length > 0) return tableToSheet(header, body);
      // Just a header line: new quantities, existing prices kept by position.
      return {
        quantities: header,
        rows: state.rows.map((r) => ({ ...r, prices: header.map((_, i) => r.prices[i] ?? '') })),
      };
    }
  }

  if (rowIndex === QTY_ROW) {
    const quantities = state.quantities.slice();
    matrix[0].forEach((value, j) => {
      const q = colIndex + j - FIRST_PRICE_COL;
      if (q < 0) return; // landed on the Base Area label
      while (quantities.length <= q) quantities.push('');
      quantities[q] = value.trim();
    });
    const widened: SheetState = {
      quantities,
      rows: state.rows.map((r) =>
        r.prices.length >= quantities.length
          ? r
          : { ...r, prices: [...r.prices, ...new Array(quantities.length - r.prices.length).fill('')] },
      ),
    };
    return writeBlock(widened, 0, colIndex, matrix.slice(1));
  }

  return writeBlock(state, rowIndex, colIndex, matrix);
}

function tableToSheet(quantities: string[], body: string[][]): SheetState {
  const rows: SheetRow[] = body.map((r) => ({
    id: nextRowId(),
    size: '',
    baseArea: (r[COL_BASE_AREA] ?? '').trim(),
    prices: quantities.map((_, i) => (r[FIRST_PRICE_COL + i] ?? '').trim()),
  }));
  if (rows.length === 0) rows.push(emptyRow(quantities.length));
  return { quantities, rows };
}

/**
 * Turn an imported/pasted matrix into a complete sheet.
 *
 * A leading Size column is dropped. When the first line is a header
 * (Base Area | 10 | 20 | ...) its quantities become the columns; otherwise the
 * existing columns are kept and the block is treated as pure data.
 */
export function matrixToSheet(matrix: string[][], fallbackQuantities: string[]): SheetState {
  const cleaned = dropSizeColumn(matrix.filter((r) => r.some((c) => c.trim() !== '')));
  if (cleaned.length === 0) return emptySheet(fallbackQuantities);

  const header = quantityHeaderOf(cleaned[0]);
  return tableToSheet(header ?? fallbackQuantities, header ? cleaned.slice(1) : cleaned);
}

/* ------------------------------------------------------------------ */
/* Getting tables out                                                  */
/* ------------------------------------------------------------------ */

/**
 * The whole table as TSV — the quantity row (Base Area | quantities), then
 * every row up to the last one holding anything. Pastes straight into Google
 * Sheets or Excel, and back into this grid (the header is recognised).
 */
export function sheetToTsv(sheet: SheetState): string {
  let last = sheet.rows.length - 1;
  const blank = (r: SheetRow) => r.baseArea.trim() === '' && r.prices.every((p) => p.trim() === '');
  while (last >= 0 && blank(sheet.rows[last])) last--;
  return selectionToTsv(sheet, QTY_ROW, last, 0, FIRST_PRICE_COL + sheet.quantities.length - 1);
}

/** Serialize a rectangular selection (QTY_ROW allowed) to TSV for the clipboard. */
export function selectionToTsv(
  sheet: SheetState,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
): string {
  const lines: string[] = [];
  for (let r = rowStart; r <= rowEnd; r++) {
    if (r !== QTY_ROW && !sheet.rows[r]) continue;
    const cells: string[] = [];
    for (let c = colStart; c <= colEnd; c++) cells.push(getCellValue(sheet, r, c));
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

export function getCellValue(sheet: SheetState, rowIndex: number, colIndex: number): string {
  if (rowIndex === QTY_ROW) {
    return colIndex === COL_BASE_AREA ? BASE_AREA_LABEL : (sheet.quantities[colIndex - FIRST_PRICE_COL] ?? '');
  }
  const row = sheet.rows[rowIndex];
  if (!row) return '';
  if (colIndex === COL_BASE_AREA) return row.baseArea;
  return row.prices[colIndex - FIRST_PRICE_COL] ?? '';
}
