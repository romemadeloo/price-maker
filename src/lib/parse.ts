import { D } from './decimal';
import type {
  ParsedBaseArea,
  ParsedPriceCell,
  ParsedQuantity,
  ParsedRow,
  ParsedSize,
  ParsedTable,
  SheetState,
} from '../types';

/** Currency marks we accept and strip (spec §16). */
const CURRENCY = /[₩￦$€£¥]|KRW|WON/gi;
/** Regular space, NBSP, narrow NBSP, thin space, ideographic space. */
const SPACES = /[\s   　]/g;

export interface NumericParse {
  raw: string;
  value: number | null;
  blank: boolean;
  error: string | null;
  /** The cleaned numeric string, for exact Decimal construction. */
  normalized: string | null;
}

/**
 * Normalize a pasted numeric cell: "W 155,793,118" -> 155793118 (spec §16).
 * Blank stays blank — it is never coerced to zero.
 */
export function parseNumeric(raw: string | null | undefined): NumericParse {
  const original = raw == null ? '' : String(raw);
  const trimmed = original.trim();
  if (trimmed === '') {
    return { raw: original, value: null, blank: true, error: null, normalized: null };
  }

  let s = trimmed.replace(/^["']|["']$/g, '');
  s = s.replace(CURRENCY, '');
  s = s.replace(SPACES, '');
  s = s.replace(/,/g, '');
  // Accounting-style negatives: (1,900) -> -1900
  const parenNegative = /^\((.*)\)$/.exec(s);
  if (parenNegative) s = `-${parenNegative[1]}`;
  s = s.replace(/^\+/, '');

  if (s === '' || !/^-?(\d+(\.\d*)?|\.\d+)$/.test(s)) {
    return {
      raw: original,
      value: null,
      blank: false,
      error: `Not a number: "${trimmed}"`,
      normalized: null,
    };
  }

  return { raw: original, value: Number(s), blank: false, error: null, normalized: s };
}

/** Quantity header: "1,000" -> 1000. Must be a positive integer (spec §3, §17). */
export function parseQuantityHeader(raw: string, index: number): ParsedQuantity {
  const n = parseNumeric(raw);
  if (n.blank) {
    return { index, raw, value: null, error: 'Missing quantity header', duplicate: false };
  }
  if (n.error) {
    return { index, raw, value: null, error: `Invalid quantity header: "${raw.trim()}"`, duplicate: false };
  }
  const value = n.value as number;
  if (!Number.isInteger(value)) {
    return {
      index,
      raw,
      value: null,
      error: `Quantity must be a whole number: "${raw.trim()}"`,
      duplicate: false,
    };
  }
  if (value <= 0) {
    return {
      index,
      raw,
      value: null,
      error: `Quantity must be greater than 0: "${raw.trim()}"`,
      duplicate: false,
    };
  }
  return { index, raw, value, error: null, duplicate: false };
}

/**
 * Separators accepted between width and height: 10*10, 10x10, 600 x 610,
 * 600 × 610, 25 X 25, optionally suffixed with mm.
 */
const SIZE_RE =
  /^([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:mm)?\s*[x×✕╳*⨯]\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:mm|㎜)?2?$/i;

/** Parse "600 x 610" -> { width: 600, height: 610, calculatedArea: 366000 }. */
export function parseSize(raw: string | null | undefined): ParsedSize {
  const original = raw == null ? '' : String(raw);
  const trimmed = original.trim();
  if (trimmed === '') {
    return {
      raw: original,
      width: null,
      height: null,
      calculatedArea: null,
      normalized: null,
      error: 'Missing size',
    };
  }

  const cleaned = trimmed.replace(SPACES, ' ').replace(/\s+/g, ' ');
  const m = SIZE_RE.exec(cleaned);
  if (!m) {
    return {
      raw: original,
      width: null,
      height: null,
      calculatedArea: null,
      normalized: null,
      error: `Invalid size format: "${trimmed}" (expected e.g. 600*610)`,
    };
  }

  const wStr = m[1].replace(/,/g, '');
  const hStr = m[2].replace(/,/g, '');
  const width = Number(wStr);
  const height = Number(hStr);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      raw: original,
      width: null,
      height: null,
      calculatedArea: null,
      normalized: null,
      error: `Size dimensions must be greater than 0: "${trimmed}"`,
    };
  }

  // Exact multiply so decimal dimensions do not pick up float dust.
  const calculatedArea = new D(wStr).times(new D(hStr)).toNumber();
  return {
    raw: original,
    width,
    height,
    calculatedArea,
    normalized: `${width}×${height}`,
    error: null,
  };
}

export function parseBaseArea(raw: string | null | undefined): ParsedBaseArea {
  const original = raw == null ? '' : String(raw);
  const n = parseNumeric(original);
  if (n.blank) return { raw: original, value: null, error: 'Missing base area' };
  if (n.error) return { raw: original, value: null, error: `Invalid base area: "${original.trim()}"` };
  const value = n.value as number;
  if (value <= 0) return { raw: original, value: null, error: `Base area must be greater than 0: ${value}` };
  return { raw: original, value, error: null };
}

export function parsePriceCell(raw: string, rowIndex: number, colIndex: number): ParsedPriceCell {
  const n = parseNumeric(raw);
  if (n.blank) {
    return { rowIndex, colIndex, raw, value: null, status: 'blank', error: null };
  }
  if (n.error) {
    return { rowIndex, colIndex, raw, value: null, status: 'invalid', error: n.error };
  }
  const value = n.value as number;
  if (value < 0) {
    return { rowIndex, colIndex, raw, value: null, status: 'invalid', error: `Negative expected price: ${value}` };
  }
  if (!new D(n.normalized as string).isInteger()) {
    return {
      rowIndex,
      colIndex,
      raw,
      value: null,
      status: 'invalid',
      error: `Expected price must be a whole won amount: "${raw.trim()}"`,
    };
  }
  return { rowIndex, colIndex, raw, value, status: 'ok', error: null };
}

/** Parse the whole sheet into its analysed form. Raw strings are preserved. */
export function parseSheet(sheet: SheetState): ParsedTable {
  const quantities = sheet.quantities.map((q, i) => parseQuantityHeader(q, i));

  // Flag duplicate quantity columns (spec §17).
  const qtyCounts = new Map<number, number>();
  for (const q of quantities) {
    if (q.value == null) continue;
    qtyCounts.set(q.value, (qtyCounts.get(q.value) ?? 0) + 1);
  }
  for (const q of quantities) {
    if (q.value != null && (qtyCounts.get(q.value) ?? 0) > 1) q.duplicate = true;
  }

  const areaSeen = new Set<number>();
  const rows: ParsedRow[] = sheet.rows.map((row, rowIndex) => {
    const size = parseSize(row.size);
    const baseArea = parseBaseArea(row.baseArea);
    const cells = sheet.quantities.map((_, colIndex) =>
      parsePriceCell(row.prices[colIndex] ?? '', rowIndex, colIndex),
    );

    const isEmpty =
      row.size.trim() === '' && row.baseArea.trim() === '' && cells.every((c) => c.status === 'blank');

    // Provided base area vs width x height (spec §4). Never auto-corrected.
    const baseAreaMismatch =
      baseArea.value != null &&
      size.calculatedArea != null &&
      !new D(baseArea.value).equals(new D(size.calculatedArea));

    let duplicateAreaFactor = false;
    if (baseArea.value != null && !isEmpty) {
      if (areaSeen.has(baseArea.value)) duplicateAreaFactor = true;
      else areaSeen.add(baseArea.value);
    }

    return {
      id: row.id,
      index: rowIndex,
      size,
      baseArea,
      cells,
      baseAreaMismatch,
      isEmpty,
      duplicateAreaFactor,
    };
  });

  return { quantities, rows };
}

/* ------------------------------------------------------------------ */
/* Delimited text (clipboard TSV / CSV import)                         */
/* ------------------------------------------------------------------ */

/**
 * Split delimited text into a matrix, honouring RFC-4180 quoting so a quoted
 * field containing the delimiter or a newline stays a single cell.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  // Drop trailing blank lines produced by a terminating newline.
  while (rows.length > 1 && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

/**
 * Split text that came off the clipboard.
 *
 * Spreadsheets separate columns with a TAB, always. So for clipboard data the
 * rule is simply: no tab means one column. Commas in the text are then
 * thousands separators inside values, never delimiters.
 *
 *   "1,900"            -> one cell        (not "1" and "900")
 *   "1,900\n2,500"     -> one column      (a copied column of prices)
 *   "10*10\t100\t1,900" -> three cells
 *
 * Without this, copying a single cell or a single column of grouped won amounts
 * shreds every value at its thousands separator.
 */
export function parseClipboardMatrix(text: string): string[][] {
  if (text.includes('\t')) return parseDelimited(text, '\t');

  const lines = text.split(/\r\n|\r|\n/);
  while (lines.length > 1 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.map((line) => [line]);
}

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');

  // A tab is never part of a cell's own value — spreadsheets strip it — whereas
  // a comma very often is, as a thousands separator ("155,793,118"). So ANY tab
  // means the block is tab-separated.
  //
  // Do not "score" tabs against commas here: a wide table of grouped won amounts
  // contains more commas inside its numbers than tabs between its columns, and
  // scoring then splits every number at its thousands separator — turning
  // "1,225" into two cells, "1" and "225".
  if (sample.includes('\t')) return '\t';

  // No tabs: choose between , and ; by which one yields a consistent number of
  // columns across lines, rather than by which occurs more often.
  const comma = columnConsistency(sample, ',');
  const semi = columnConsistency(sample, ';');
  if (semi.columns > 1 && semi.score > comma.score) return ';';
  return ',';
}

/**
 * How consistently `delim` splits the sample into equal-width rows.
 * A delimiter that also appears inside values (a thousands separator) produces
 * ragged rows and therefore a poor score.
 */
function columnConsistency(sample: string, delim: string): { score: number; columns: number } {
  const lines = sample.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return { score: 0, columns: 0 };

  const counts = lines.map((l) => l.split(delim).length);
  const tally = new Map<number, number>();
  for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);

  let columns = 1;
  let best = 0;
  for (const [cols, freq] of tally) {
    if (freq > best || (freq === best && cols > columns)) {
      best = freq;
      columns = cols;
    }
  }
  // Reward agreement across lines, and having more than one column at all.
  return { score: columns > 1 ? best / counts.length : 0, columns };
}

/**
 * True when a pasted row looks like a header (Size | Base Area | 10 | 20 ...)
 * rather than a data row. Used by import to pick up quantity columns.
 */
export function looksLikeHeaderRow(cells: string[]): boolean {
  if (cells.length < 3) return false;
  const first = cells[0].trim().toLowerCase();
  const second = (cells[1] ?? '').trim().toLowerCase();
  const sizeWords = ['size', 'sizes', 'dimension', 'dimensions', '사이즈', '규격'];
  const areaWords = ['area', 'area_factor', 'basearea', '면적'];
  if (sizeWords.some((h) => first === h || first.startsWith(h))) return true;
  if (areaWords.some((h) => second.includes(h))) return true;
  // A size in the first cell means it is data, not a header.
  return false;
}

/**
 * Decide whether the first line of a pasted/imported block is a header row and,
 * if so, return the quantity labels it carries.
 *
 * Two signals: a recognisable label in the Size/Base Area position, or a row
 * whose 3rd+ cells are all positive integers while cell 1 is not a size. Shared
 * by clipboard paste and file import so both behave identically.
 */
export function detectQuantityHeader(row: string[] | undefined): string[] | null {
  if (!row || row.length < 3) return null;

  const tail = row.slice(2);
  const byLabel = looksLikeHeaderRow(row);
  const byShape =
    tail.length > 0 &&
    tail.some((c) => c.trim() !== '') &&
    tail.every((c) => {
      const t = c.trim();
      if (t === '') return true;
      const n = parseNumeric(t);
      return n.value != null && Number.isInteger(n.value) && n.value > 0;
    }) &&
    // A size like "10*10" in the first cell means this is data, not a header.
    parseSize(row[0]).error != null;

  if (!byLabel && !byShape) return null;

  const quantities = tail.map((c) => c.trim());
  while (quantities.length > 0 && quantities[quantities.length - 1] === '') quantities.pop();
  return quantities.length > 0 ? quantities : null;
}
