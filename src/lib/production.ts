import type { ParsedTable } from '../types';

/**
 * Production price comparison.
 *
 * The live site quotes every product through one endpoint:
 *
 *     api.musticker.com/index.php/sys/kr/pricing/quotation/<slug>?width=W&height=H
 *
 * which returns the full quantity ladder for that size. The API does not send
 * CORS headers for other origins, so the app calls it through a same-origin
 * proxy: Vite's dev/preview proxy locally, a rewrite in vercel.json when
 * deployed. Both map `/api/musticker/*` onto `/index.php/sys/kr/*`.
 *
 * Only quotation requests go out — the drafted prices themselves never leave
 * the browser.
 */

export const PRODUCTION_API_BASE = '/api/musticker';

export interface ProductionPrice {
  quantity: number;
  price: number;
  /** Production's stored rate. Null for sheet-priced products. */
  pricePerMm: number | null;
}

export interface ProductionQuote {
  width: number;
  height: number;
  /** Price unit production rounds to (`normalized_nr`). */
  normalizedNr: number | null;
  prices: ProductionPrice[];
  pricingId: number | null;
  /** Name of the production price book, e.g. "diecut/kisscut - 9/9/2026". */
  pricingName: string | null;
  /** Set for products priced per sheet rather than per sticker. */
  sheet: { name: string; width: number; height: number } | null;
}

/** One size's outcome. Errors are kept so a refused size stays visible. */
export type QuoteEntry = { ok: true; quote: ProductionQuote } | { ok: false; error: string };

/** Everything fetched for one product, persisted alongside its draft. */
export interface ProductionSnapshot {
  fetchedAt: string;
  /** When this snapshot was last written (a merge keeps fetchedAt). Decides which copy is newer when syncing. */
  savedAt?: string;
  /** Keyed by `sizeKey(width, height)`. */
  quotes: Record<string, QuoteEntry>;
}

export function sizeKey(width: number, height: number): string {
  return `${width}x${height}`;
}

export function quotationUrl(
  slug: string,
  width: number,
  height: number,
  quantity?: number,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({ width: String(width), height: String(height), ...extra });
  if (quantity != null) params.set('quantity', String(quantity));
  return `${PRODUCTION_API_BASE}/pricing/quotation/${encodeURIComponent(slug)}?${params}`;
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Read the endpoint's JSON into a ProductionQuote, or throw with its message. */
export function parseQuotationResponse(json: unknown, width: number, height: number): ProductionQuote {
  const body = json as {
    success?: boolean;
    message?: string;
    data?: {
      normalized_nr?: unknown;
      prices?: { nr?: unknown; price?: unknown; price_per_mm?: unknown }[];
      sheet?: { name?: string; width?: unknown; height?: unknown } | null;
    };
    meta?: { pricing_id?: unknown; pricing?: unknown } | null;
  };

  if (!body || typeof body !== 'object') throw new Error('Unexpected response from production.');
  if (body.success === false) throw new Error(body.message || 'Production refused this size.');
  if (!body.data || !Array.isArray(body.data.prices)) {
    throw new Error(body.message || 'Production returned no prices for this size.');
  }

  const prices: ProductionPrice[] = [];
  for (const p of body.data.prices) {
    const quantity = num(p.nr);
    const price = num(p.price);
    if (quantity == null || price == null) continue;
    prices.push({ quantity, price, pricePerMm: num(p.price_per_mm) });
  }
  prices.sort((a, b) => a.quantity - b.quantity);

  const sheet = body.data.sheet;
  return {
    width,
    height,
    normalizedNr: num(body.data.normalized_nr),
    prices,
    pricingId: num(body.meta?.pricing_id),
    pricingName: typeof body.meta?.pricing === 'string' ? body.meta.pricing : null,
    sheet:
      sheet && typeof sheet === 'object'
        ? { name: String(sheet.name ?? ''), width: num(sheet.width) ?? 0, height: num(sheet.height) ?? 0 }
        : null,
  };
}

export async function fetchProductionQuote(
  slug: string,
  width: number,
  height: number,
  /** `params`: a variant's extra options, e.g. { color_id: '11' }. */
  options: { quantity?: number; signal?: AbortSignal; params?: Record<string, string> } = {},
): Promise<ProductionQuote> {
  let response: Response;
  try {
    response = await fetch(quotationUrl(slug, width, height, options.quantity, options.params), {
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error('Could not reach the production API.');
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Production API answered ${response.status} without JSON.`);
  }
  return parseQuotationResponse(json, width, height);
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export type CompareStatus = 'same' | 'higher' | 'lower' | 'not-in-production' | 'blank';

export interface CompareCell {
  rowIndex: number;
  colIndex: number;
  quantity: number | null;
  /** The drafted price as entered. */
  draftRaw: number | null;
  /** The drafted price after the comparison's rounding — what is compared. */
  draft: number | null;
  production: number | null;
  /** draft − production, in won. */
  diff: number | null;
  /** diff ÷ production × 100. */
  diffPct: number | null;
  status: CompareStatus;
}

export type CompareRowState = 'ok' | 'error' | 'not-fetched' | 'no-size';

export interface CompareRow {
  rowIndex: number;
  sizeLabel: string;
  width: number | null;
  height: number | null;
  baseArea: number | null;
  key: string | null;
  /** True when the size was worked out from the base area, the row having none. */
  sizeFromArea: boolean;
  state: CompareRowState;
  error: string | null;
  cells: CompareCell[];
}

export interface CompareSummary {
  rows: number;
  /** Cells that have both a draft and a production price. */
  compared: number;
  same: number;
  higher: number;
  lower: number;
  /** Draft prices at a quantity production does not quote. */
  notInProduction: number;
  rowsWithoutSize: number;
  rowsFailed: number;
  rowsNotFetched: number;
  /** Drafted prices the rounding actually changed. */
  rounded: number;
  /** Mean of diffPct over compared cells. */
  avgDiffPct: number | null;
  /** The compared cell with the largest |diffPct|. */
  largest: CompareCell | null;
}

export interface Comparison {
  rows: CompareRow[];
  quantities: (number | null)[];
  /** Quantities production quotes that no draft column covers. */
  productionOnlyQuantities: number[];
  summary: CompareSummary;
  pricingName: string | null;
  pricingId: number | null;
  normalizedNr: number | null;
  sheet: ProductionQuote['sheet'];
  /** Won unit drafted prices were rounded to before comparing; 1 = exact. */
  roundTo: number;
}

/**
 * Round a drafted price to the nearest multiple of `unit`, half-up — the same
 * rule production applies to its own quotes. A unit of 1 leaves it untouched.
 */
export function roundPrice(price: number, unit: number): number {
  if (unit <= 1) return price;
  return Math.round(price / unit) * unit;
}

/**
 * A width × height with exactly this area, as close to square as whole
 * millimetres allow: 100 → 10×10, 200 → 10×20, 15,129 → 123×123.
 *
 * Production prices by area alone — 10×10 and 5×20 quote identically, as do
 * 123×123 and 41×369 (checked against the live endpoint) — so any such pair
 * asks it the right question. Null when the area is not a positive integer.
 */
export function sizeForArea(area: number): { width: number; height: number } | null {
  if (!Number.isInteger(area) || area <= 0) return null;
  for (let w = Math.floor(Math.sqrt(area)); w >= 1; w--) {
    if (area % w === 0) return { width: w, height: area / w };
  }
  return null;
}

type QuerySize = { width: number; height: number; key: string; fromArea: boolean };

/** What to ask production for a row: its size, or failing that its base area. */
function querySize(row: ParsedTable['rows'][number]): QuerySize | null {
  const { width, height } = row.size;
  if (width != null && height != null) return { width, height, key: sizeKey(width, height), fromArea: false };
  const derived = row.baseArea.value != null ? sizeForArea(row.baseArea.value) : null;
  return derived ? { ...derived, key: sizeKey(derived.width, derived.height), fromArea: true } : null;
}

/** Unique sizes in the draft that production can be asked about. */
export function draftSizes(parsed: ParsedTable): { width: number; height: number; key: string }[] {
  const seen = new Map<string, { width: number; height: number; key: string }>();
  for (const row of parsed.rows) {
    if (row.isEmpty) continue;
    const size = querySize(row);
    if (size && !seen.has(size.key)) seen.set(size.key, { width: size.width, height: size.height, key: size.key });
  }
  return [...seen.values()];
}

/**
 * Line every drafted price up against production's price for the same size and
 * quantity. Pure: the quotes come from a snapshot, so the comparison is
 * reproducible and testable without the network.
 */
export function compareDraft(
  parsed: ParsedTable,
  snapshot: ProductionSnapshot | null,
  options: { roundTo?: number } = {},
): Comparison {
  const roundTo = options.roundTo ?? 1;
  const quantities = parsed.quantities.map((q) => q.value);
  const draftQuantities = new Set(quantities.filter((q): q is number => q != null));
  const productionOnly = new Set<number>();

  let pricingName: string | null = null;
  let pricingId: number | null = null;
  let normalizedNr: number | null = null;
  let sheet: ProductionQuote['sheet'] = null;

  const summary: CompareSummary = {
    rows: 0,
    compared: 0,
    same: 0,
    higher: 0,
    lower: 0,
    notInProduction: 0,
    rowsWithoutSize: 0,
    rowsFailed: 0,
    rowsNotFetched: 0,
    rounded: 0,
    avgDiffPct: null,
    largest: null,
  };
  let pctTotal = 0;

  const rows: CompareRow[] = [];
  for (const row of parsed.rows) {
    if (row.isEmpty) continue;
    summary.rows += 1;

    const size = querySize(row);
    const width = size?.width ?? null;
    const height = size?.height ?? null;
    const key = size?.key ?? null;
    const entry = key ? snapshot?.quotes[key] : undefined;

    let state: CompareRowState;
    let error: string | null = null;
    let byQuantity: Map<number, number> | null = null;

    if (!key) {
      state = 'no-size';
      summary.rowsWithoutSize += 1;
    } else if (!entry) {
      state = 'not-fetched';
      summary.rowsNotFetched += 1;
    } else if (!entry.ok) {
      state = 'error';
      error = entry.error;
      summary.rowsFailed += 1;
    } else {
      state = 'ok';
      const quote = entry.quote;
      byQuantity = new Map(quote.prices.map((p) => [p.quantity, p.price]));
      for (const p of quote.prices) if (!draftQuantities.has(p.quantity)) productionOnly.add(p.quantity);
      pricingName ??= quote.pricingName;
      pricingId ??= quote.pricingId;
      normalizedNr ??= quote.normalizedNr;
      sheet ??= quote.sheet;
    }

    const cells: CompareCell[] = row.cells.map((cell, colIndex) => {
      const quantity = quantities[colIndex] ?? null;
      const draftRaw = cell.status === 'ok' ? cell.value : null;
      const draft = draftRaw == null ? null : roundPrice(draftRaw, roundTo);
      if (draftRaw != null && draft !== draftRaw) summary.rounded += 1;
      const production = byQuantity && quantity != null ? (byQuantity.get(quantity) ?? null) : null;
      const base = { rowIndex: row.index, colIndex, quantity, draftRaw, draft, production };

      if (draft == null) return { ...base, diff: null, diffPct: null, status: 'blank' as const };
      if (production == null) {
        if (state === 'ok') summary.notInProduction += 1;
        return { ...base, diff: null, diffPct: null, status: 'not-in-production' as const };
      }

      const diff = draft - production;
      const diffPct = production === 0 ? null : (diff / production) * 100;
      const status = diff === 0 ? 'same' : diff > 0 ? 'higher' : 'lower';
      const result: CompareCell = { ...base, diff, diffPct, status };

      summary.compared += 1;
      summary[status] += 1;
      if (diffPct != null) {
        pctTotal += diffPct;
        if (summary.largest?.diffPct == null || Math.abs(diffPct) > Math.abs(summary.largest.diffPct)) {
          summary.largest = result;
        }
      }
      return result;
    });

    rows.push({
      rowIndex: row.index,
      sizeLabel: row.size.normalized ?? (size?.fromArea ? `${size.width}×${size.height}` : row.size.raw.trim() || '—'),
      width,
      height,
      sizeFromArea: size?.fromArea ?? false,
      baseArea: row.baseArea.value,
      key,
      state,
      error,
      cells,
    });
  }

  if (summary.compared > 0) summary.avgDiffPct = pctTotal / summary.compared;

  return {
    rows,
    quantities,
    productionOnlyQuantities: [...productionOnly].sort((a, b) => a - b),
    summary,
    pricingName,
    pricingId,
    normalizedNr,
    sheet,
    roundTo,
  };
}

/** The comparison as CSV, one line per drafted price. */
export function comparisonToCsv(comparison: Comparison): string {
  const lines = [
    'size,width,height,base_area,quantity,draft_price,draft_rounded,production_price,difference,difference_pct,status',
  ];
  for (const row of comparison.rows) {
    for (const cell of row.cells) {
      if (cell.status === 'blank') continue;
      lines.push(
        [
          row.sizeLabel,
          row.width ?? '',
          row.height ?? '',
          row.baseArea ?? '',
          cell.quantity ?? '',
          cell.draftRaw ?? '',
          cell.draft ?? '',
          cell.production ?? '',
          cell.diff ?? '',
          cell.diffPct == null ? '' : cell.diffPct.toFixed(2),
          row.state === 'ok' ? cell.status : row.state,
        ].join(','),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
