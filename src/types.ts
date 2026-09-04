/**
 * Shared domain types.
 *
 * Design rule (spec §17, §24): the user's raw input is NEVER modified silently.
 * Every raw string the user typed/pasted is preserved on the `raw` field; parsed
 * interpretations live alongside it, and problems are reported as issues.
 */

/** A single row of the editable expected-price sheet. Values are raw strings. */
export interface SheetRow {
  id: string;
  size: string;
  baseArea: string;
  /** One entry per quantity column, index-aligned with SheetState.quantities. */
  prices: string[];
}

export interface SheetState {
  /** Raw quantity header strings, e.g. "10", "1,000". */
  quantities: string[];
  rows: SheetRow[];
}

/* ------------------------------------------------------------------ */
/* Parsing results                                                     */
/* ------------------------------------------------------------------ */

export interface ParsedQuantity {
  index: number;
  raw: string;
  /** Normalized positive integer quantity, or null when unparseable/blank. */
  value: number | null;
  error: string | null;
  /** True when another column carries the same normalized quantity. */
  duplicate: boolean;
}

export interface ParsedSize {
  raw: string;
  width: number | null;
  height: number | null;
  /** width × height, when both dimensions parsed. */
  calculatedArea: number | null;
  /** Canonical "600×610" form for display. */
  normalized: string | null;
  error: string | null;
}

export interface ParsedBaseArea {
  raw: string;
  value: number | null;
  error: string | null;
}

/** Status of one expected-price cell after parsing (before calculation). */
export type CellParseStatus = 'blank' | 'ok' | 'invalid';

export interface ParsedPriceCell {
  rowIndex: number;
  colIndex: number;
  raw: string;
  /** Normalized numeric expected price (KRW), or null when blank/invalid. */
  value: number | null;
  status: CellParseStatus;
  error: string | null;
}

export interface ParsedRow {
  id: string;
  index: number;
  size: ParsedSize;
  baseArea: ParsedBaseArea;
  cells: ParsedPriceCell[];
  /** Base area provided vs width×height (spec §4). */
  baseAreaMismatch: boolean;
  isEmpty: boolean;
  /** True when another row declares the same base area (spec §17). */
  duplicateAreaFactor: boolean;
}

export interface ParsedTable {
  quantities: ParsedQuantity[];
  rows: ParsedRow[];
}

/* ------------------------------------------------------------------ */
/* Calculation + validation results                                    */
/* ------------------------------------------------------------------ */

export type CellStatus = 'PASS' | 'FAIL' | 'NEEDS_REVIEW' | 'INVALID' | 'BLANK';

/** Full precision + validation record for a single expected-price cell. */
export interface CellResult {
  rowIndex: number;
  colIndex: number;
  rowId: string;
  sizeLabel: string;
  baseArea: number | null;
  quantity: number | null;
  expectedPrice: number | null;
  /** High-precision rate as a display string (may be truncated with an ellipsis). */
  exactRate: string | null;
  /** The EXACT string that will be written to the CSV. */
  exportRate: string | null;
  /** Decimal places used by exportRate before trailing-zero stripping. */
  decimalPlaces: number | null;
  /** ROUND(baseArea × quantity × exportRate, 0) */
  reconstructedPrice: string | null;
  /** reconstructedPrice - expectedPrice, as an exact integer string. */
  difference: string | null;
  status: CellStatus;
  message: string | null;
}

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** Optional anchor back into the grid so the UI can scroll/select it. */
  rowIndex?: number;
  colIndex?: number;
}

export interface Summary {
  totalPrices: number;
  matched: number;
  mismatched: number;
  needsReview: number;
  invalidInput: number;
  baseAreaWarnings: number;
  maxDecimalPlaces: number;
  blankCells: number;
  allValid: boolean;
}

/** One area_factor row of the generated price-per-mm² output. */
export interface RateRow {
  areaFactor: number;
  /** Index-aligned with the resolved quantity list; null = blank cell. */
  rates: (string | null)[];
  /** Source sheet row indexes that contributed to this area_factor. */
  sourceRowIndexes: number[];
}

export interface RoundTripResult {
  ran: boolean;
  passed: boolean;
  checkedCells: number;
  failures: {
    areaFactor: number;
    quantity: number;
    expected: string;
    reconstructed: string;
    difference: string;
    parsedRate: string;
  }[];
  message: string;
}

/**
 * Distinct raw strings that failed to parse, with how often each occurred.
 * A thousand rejected cells are usually the same two or three offenders, so
 * showing the values themselves beats listing a thousand identical errors.
 */
export interface InvalidSample {
  raw: string;
  count: number;
  reason: string;
  firstRowIndex: number;
  firstColIndex: number;
  /** Which column the offender sits in: a price cell, the size, or base area. */
  field: 'price' | 'size' | 'baseArea';
}

export interface EngineResult {
  parsed: ParsedTable;
  cells: CellResult[];
  /** cells indexed [rowIndex][colIndex] for O(1) grid lookup. */
  cellIndex: (CellResult | undefined)[][];
  rateRows: RateRow[];
  quantities: number[];
  summary: Summary;
  issues: Issue[];
  invalidSamples: InvalidSample[];
  csv: string;
  roundTrip: RoundTripResult;
}

export interface EngineOptions {
  /** Lowest decimal-place count the search starts at (spec §7: default 10). */
  minDecimalPlaces: number;
  /** Upper bound for the search (spec §7: 15–18). */
  maxDecimalPlaces: number;
  /** Strip trailing zeros in exported rates (0.4000000000 → 0.4). */
  stripTrailingZeros: boolean;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  minDecimalPlaces: 10,
  maxDecimalPlaces: 18,
  stripTrailingZeros: true,
};
