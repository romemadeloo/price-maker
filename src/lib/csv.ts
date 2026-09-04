import type { RateRow } from '../types';
import { parseDelimited } from './parse';

/**
 * CSV shape (spec §12):
 *
 *   area_factor,10,20,30,...
 *   100,1.9,1.8,1.7666666667,...
 *
 * No currency symbols, no thousands separators, in headers or values.
 */
export const AREA_FACTOR_HEADER = 'area_factor';

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize the generated rates exactly as they will be downloaded. */
export function serializeCsv(quantities: number[], rateRows: RateRow[]): string {
  const header = [AREA_FACTOR_HEADER, ...quantities.map((q) => String(q))];
  const lines = [header.map(csvEscape).join(',')];

  for (const row of rateRows) {
    const cells = [String(row.areaFactor), ...row.rates.map((r) => (r == null ? '' : r))];
    lines.push(cells.map(csvEscape).join(','));
  }

  return `${lines.join('\n')}\n`;
}

export interface ParsedCsv {
  quantities: number[];
  rows: { areaFactor: number; rates: (string | null)[] }[];
  errors: string[];
}

/**
 * Parse a generated price-per-mm² CSV back into structured data.
 *
 * Rates come back as STRINGS on purpose: the round-trip check must feed the
 * literal characters from the file into Decimal, never a JS float.
 */
export function parseRateCsv(text: string): ParsedCsv {
  const errors: string[] = [];
  const matrix = parseDelimited(text, ',');
  if (matrix.length === 0 || matrix[0].length === 0) {
    return { quantities: [], rows: [], errors: ['CSV is empty'] };
  }

  const header = matrix[0].map((c) => c.trim());
  if (header[0].toLowerCase() !== AREA_FACTOR_HEADER) {
    errors.push(`First CSV column must be "${AREA_FACTOR_HEADER}", found "${header[0]}"`);
  }

  const quantities: number[] = [];
  for (let i = 1; i < header.length; i++) {
    const raw = header[i];
    if (raw === '') continue;
    if (raw.includes(',')) errors.push(`Quantity header contains a comma: "${raw}"`);
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      errors.push(`Invalid quantity header in CSV: "${raw}"`);
      quantities.push(NaN);
    } else {
      quantities.push(n);
    }
  }

  const rows: { areaFactor: number; rates: (string | null)[] }[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (line.every((c) => c.trim() === '')) continue;
    const areaRaw = (line[0] ?? '').trim();
    const areaFactor = Number(areaRaw);
    if (!Number.isFinite(areaFactor) || areaFactor <= 0) {
      errors.push(`Invalid area_factor on CSV line ${r + 1}: "${areaRaw}"`);
      continue;
    }
    const rates: (string | null)[] = [];
    for (let c = 0; c < quantities.length; c++) {
      const cell = (line[c + 1] ?? '').trim();
      if (cell === '') {
        rates.push(null);
        continue;
      }
      if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(cell)) {
        errors.push(`Non-numeric rate on CSV line ${r + 1}, column ${quantities[c]}: "${cell}"`);
        rates.push(null);
        continue;
      }
      rates.push(cell);
    }
    rows.push({ areaFactor, rates });
  }

  return { quantities, rows, errors };
}

/** Trigger a browser download of the CSV text. */
export function downloadCsv(text: string, filename: string): void {
  // BOM-free, LF line endings: what a plain CSV consumer expects.
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
