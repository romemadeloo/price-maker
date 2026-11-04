import type { SheetState } from '../types';
import { parseNumeric } from './parse';
import { call } from './sync';

/**
 * Version history for drafts (api/_lib/handler.ts, kind=version[s]).
 *
 * A version is a named, frozen copy of a price list's table, marked either
 * 'draft' (work in progress) or 'actual' (the prices that are live). At most
 * one version per price list is actual. Restoring a version loads it into the
 * table as an ordinary edit, so it can be undone and is shared as usual.
 */

export type VersionStatus = 'draft' | 'actual';

export interface VersionMeta {
  id: string;
  slug: string;
  label: string;
  status: VersionStatus;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

export type StoredSheet = { quantities: string[]; rows: { size: string; baseArea: string; prices: string[] }[] };

export interface VersionWithSheet extends VersionMeta {
  sheet: StoredSheet | null;
}

const q = (slug: string, id?: string) =>
  `?kind=version&slug=${encodeURIComponent(slug)}${id ? `&id=${encodeURIComponent(id)}` : ''}`;

export async function listVersions(slug: string): Promise<VersionMeta[]> {
  return (await call<{ versions: VersionMeta[] }>(`?kind=versions&slug=${encodeURIComponent(slug)}`)).body.versions;
}

export async function getVersion(slug: string, id: string): Promise<VersionWithSheet> {
  return (await call<{ version: VersionWithSheet }>(q(slug, id))).body.version;
}

export async function createVersion(
  slug: string,
  input: { label: string; status: VersionStatus; note?: string; sheet: SheetState; createdBy: string },
): Promise<VersionMeta> {
  const sheet: StoredSheet = {
    quantities: input.sheet.quantities,
    rows: input.sheet.rows.map(({ size, baseArea, prices }) => ({ size, baseArea, prices })),
  };
  const { body } = await call<{ version: VersionMeta }>(q(slug), {
    method: 'POST',
    body: JSON.stringify({ ...input, sheet }),
  });
  return body.version;
}

export async function updateVersion(
  slug: string,
  id: string,
  patch: { label?: string; status?: VersionStatus; note?: string | null },
): Promise<void> {
  await call(q(slug, id), { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function deleteVersion(slug: string, id: string): Promise<void> {
  await call(q(slug, id), { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
/* Comparing two tables                                                */
/* ------------------------------------------------------------------ */

export interface SheetDiff {
  /** Same base area and quantity on both sides, different price. */
  changed: number;
  /** Prices only in `next`. */
  added: number;
  /** Prices only in `base`. */
  removed: number;
  /** A few changed cells, for a preview. */
  samples: { baseArea: number; quantity: number; from: number; to: number }[];
}

function cells(sheet: Pick<StoredSheet, 'quantities' | 'rows'>): Map<string, { area: number; qty: number; price: number }> {
  const out = new Map<string, { area: number; qty: number; price: number }>();
  const qtys = sheet.quantities.map((x) => parseNumeric(x).value);
  for (const row of sheet.rows) {
    const area = parseNumeric(row.baseArea).value;
    if (area == null) continue;
    row.prices.forEach((p, i) => {
      const qty = qtys[i];
      const price = parseNumeric(p).value;
      if (qty == null || price == null) return;
      out.set(`${area}|${qty}`, { area, qty, price });
    });
  }
  return out;
}

/**
 * Price by price, keyed by (base area, quantity) — so reordered rows or
 * columns are not counted as changes, only different prices are.
 */
export function diffSheets(base: Pick<StoredSheet, 'quantities' | 'rows'>, next: Pick<StoredSheet, 'quantities' | 'rows'>, maxSamples = 5): SheetDiff {
  const a = cells(base);
  const b = cells(next);
  const diff: SheetDiff = { changed: 0, added: 0, removed: 0, samples: [] };
  for (const [key, cell] of b) {
    const old = a.get(key);
    if (!old) diff.added += 1;
    else if (old.price !== cell.price) {
      diff.changed += 1;
      if (diff.samples.length < maxSamples) diff.samples.push({ baseArea: cell.area, quantity: cell.qty, from: old.price, to: cell.price });
    }
  }
  for (const key of a.keys()) if (!b.has(key)) diff.removed += 1;
  return diff;
}

export const isSameSheet = (d: SheetDiff) => d.changed === 0 && d.added === 0 && d.removed === 0;
