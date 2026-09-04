import type { CellResult, RoundTripResult } from '../types';
import { D, roundToWon } from './decimal';
import { parseRateCsv } from './csv';

/**
 * Round-trip validation (spec §14).
 *
 * The in-memory rate passing validation is not sufficient evidence: formatting
 * and serialization are where precision usually dies. So we take the finished
 * CSV *text*, parse it back as if we were a downstream consumer, and rebuild
 * every expected price from the literal strings that came out of the file.
 *
 * Only if every price still reproduces exactly does the CSV earn "CSV VALIDATED".
 */
export function roundTripValidate(csvText: string, cells: CellResult[]): RoundTripResult {
  const parsed = parseRateCsv(csvText);
  const failures: RoundTripResult['failures'] = [];

  if (parsed.errors.length > 0) {
    return {
      ran: true,
      passed: false,
      checkedCells: 0,
      failures: [],
      message: `CSV could not be re-parsed: ${parsed.errors[0]}`,
    };
  }

  // (area_factor, quantity) -> rate string, straight from the serialized file.
  const lookup = new Map<string, string>();
  for (const row of parsed.rows) {
    parsed.quantities.forEach((qty, i) => {
      const rate = row.rates[i];
      if (rate != null) lookup.set(`${row.areaFactor}|${qty}`, rate);
    });
  }

  let checked = 0;
  for (const cell of cells) {
    if (cell.baseArea == null || cell.quantity == null || cell.expectedPrice == null) continue;
    if (cell.status === 'BLANK' || cell.status === 'INVALID') continue;

    const key = `${cell.baseArea}|${cell.quantity}`;
    const rate = lookup.get(key);
    if (rate == null) {
      failures.push({
        areaFactor: cell.baseArea,
        quantity: cell.quantity,
        expected: String(cell.expectedPrice),
        reconstructed: '—',
        difference: '—',
        parsedRate: '(missing from CSV)',
      });
      continue;
    }

    checked++;
    // Exactly what a consumer does: parse string -> multiply -> round once.
    const reconstructed = roundToWon(new D(cell.baseArea).times(cell.quantity).times(new D(rate)));
    const expected = new D(cell.expectedPrice);
    const difference = reconstructed.minus(expected);
    if (!difference.isZero()) {
      failures.push({
        areaFactor: cell.baseArea,
        quantity: cell.quantity,
        expected: expected.toFixed(),
        reconstructed: reconstructed.toFixed(),
        difference: difference.toFixed(),
        parsedRate: rate,
      });
    }
  }

  const passed = failures.length === 0 && checked > 0;
  return {
    ran: true,
    passed,
    checkedCells: checked,
    failures,
    message: passed
      ? `Re-parsed the serialized CSV and reproduced all ${checked.toLocaleString()} expected prices exactly.`
      : checked === 0 && failures.length === 0
        ? 'Nothing to round-trip: no valid price cells.'
        : `${failures.length.toLocaleString()} price(s) did not survive CSV serialization.`,
  };
}
