import { DEFAULT_ENGINE_OPTIONS, type EngineOptions, type SheetRow, type SheetState } from '../types';
import { DEFAULT_PRODUCT_SLUG, findPriceList } from '../lib/products';
import { compareDraft, type CompareSummary, type ProductionSnapshot } from '../lib/production';
import { parseNumeric, parseSheet } from '../lib/parse';
import { PRICE_UNITS, type PriceUnit } from '../lib/calculator';
import type { RemoteDraft, RemoteWorkspace } from '../lib/sync';
import { nextRowId } from './sheetReducer';

/**
 * Everything that survives a reload: one drafted price table per product, the
 * last production prices fetched for it, and the engine options.
 *
 * The shared copy lives on the server (api/workspace.ts); this localStorage
 * copy is the cache that makes the app open instantly and keeps edits made
 * while offline until they can be pushed. Every read and write is guarded:
 * private windows and blocked storage simply start empty.
 */

export interface ProductDraft {
  sheet: SheetState;
  updatedAt: string;
  /** Free-text name of whoever saved it. There are no accounts. */
  updatedBy: string | null;
}

export interface Workspace {
  activeSlug: string;
  drafts: Record<string, ProductDraft>;
  snapshots: Record<string, ProductionSnapshot>;
  options: EngineOptions;
  /** Server version each local draft is based on; 0 = never synced. */
  versions: Record<string, number>;
  /** Drafts changed (or deleted) here and not yet on the server. */
  dirty: Record<string, true>;
  /** Production snapshots fetched here and not yet on the server. */
  dirtySnapshots: Record<string, true>;
  /** Shown to others as "edited by". */
  userName: string;
  /**
   * Per product: the won unit drafted prices are rounded to before comparing
   * with production (1 = exact). A viewing preference, kept in this browser.
   */
  compareRounding: Record<string, PriceUnit>;
}

const STORAGE_KEY = 'pricer-maker:workspace:v1';

export function emptyWorkspace(): Workspace {
  return {
    activeSlug: DEFAULT_PRODUCT_SLUG,
    drafts: {},
    snapshots: {},
    options: DEFAULT_ENGINE_OPTIONS,
    versions: {},
    dirty: {},
    dirtySnapshots: {},
    userName: '',
    compareRounding: {},
  };
}

type LooseSheet = { quantities: unknown[]; rows: Partial<SheetRow>[] };

/**
 * Give stored rows fresh ids. Row ids come from a module counter that restarts
 * at every page load, so ids saved last session would collide with the next
 * row the grid adds.
 *
 * Sizes are dropped: the sheet no longer has a Size column, and a size nobody
 * can see must not go on driving warnings or the production lookup.
 */
export function hydrateSheet(sheet: LooseSheet): SheetState {
  return {
    quantities: sheet.quantities.map(String),
    rows: sheet.rows.map((r) => ({
      id: nextRowId(),
      size: '',
      baseArea: String(r.baseArea ?? ''),
      prices: sheet.quantities.map((_, i) => String(r.prices?.[i] ?? '')),
    })),
  };
}

function isSheet(value: unknown): value is LooseSheet {
  const s = value as LooseSheet;
  return !!s && Array.isArray(s.quantities) && Array.isArray(s.rows);
}

const allTrue = (keys: string[]): Record<string, true> => Object.fromEntries(keys.map((k) => [k, true as const]));

export function loadWorkspace(): Workspace {
  const base = emptyWorkspace();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return base;
  }
  if (!raw) return base;

  try {
    const stored = JSON.parse(raw) as Partial<Workspace>;
    const drafts: Record<string, ProductDraft> = {};
    for (const [slug, draft] of Object.entries(stored.drafts ?? {})) {
      if (findPriceList(slug) && isSheet(draft?.sheet)) {
        drafts[slug] = {
          sheet: hydrateSheet(draft.sheet),
          updatedAt: String(draft.updatedAt ?? ''),
          updatedBy: typeof draft.updatedBy === 'string' ? draft.updatedBy : null,
        };
      }
    }
    const snapshots = stored.snapshots && typeof stored.snapshots === 'object' ? stored.snapshots : {};

    // A cache from before sharing existed has no versions: everything in it is
    // local-only work, so mark it all for upload.
    const legacy = stored.versions == null;
    return {
      activeSlug: stored.activeSlug && findPriceList(stored.activeSlug) ? stored.activeSlug : base.activeSlug,
      drafts,
      snapshots,
      options: { ...DEFAULT_ENGINE_OPTIONS, ...(stored.options ?? {}) },
      versions: stored.versions ?? {},
      dirty: legacy ? allTrue(Object.keys(drafts)) : (stored.dirty ?? {}),
      dirtySnapshots: legacy ? allTrue(Object.keys(snapshots)) : (stored.dirtySnapshots ?? {}),
      userName: typeof stored.userName === 'string' ? stored.userName : '',
      compareRounding: Object.fromEntries(
        Object.entries(stored.compareRounding ?? {}).filter(([, unit]) => (PRICE_UNITS as readonly number[]).includes(unit)),
      ),
    };
  } catch {
    return base;
  }
}

/** Persist the workspace. Returns false when the browser refused the write. */
export function saveWorkspace(workspace: Workspace): boolean {
  try {
    // Row ids are session-local; storing them would only bloat the payload.
    const drafts = Object.fromEntries(
      Object.entries(workspace.drafts).map(([slug, d]) => [
        slug,
        {
          updatedAt: d.updatedAt,
          updatedBy: d.updatedBy,
          sheet: {
            quantities: d.sheet.quantities,
            rows: d.sheet.rows.map(({ size, baseArea, prices }) => ({ size, baseArea, prices })),
          },
        },
      ]),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...workspace, drafts }));
    return true;
  } catch {
    return false;
  }
}

/** True when no row holds anything — such a sheet is not worth saving as a draft. */
export function isBlankSheet(sheet: SheetState): boolean {
  return sheet.rows.every(
    (r) => r.size.trim() === '' && r.baseArea.trim() === '' && r.prices.every((p) => p.trim() === ''),
  );
}

/** Rows that carry anything, and how many prices they hold. */
export interface DraftStats {
  rows: number;
  prices: number;
  /** Smallest and largest base area drafted, mm². */
  areaMin: number | null;
  areaMax: number | null;
  /** Quantity columns with a value, and their range. */
  columns: number;
  qtyMin: number | null;
  qtyMax: number | null;
}

/** Rows that carry anything, how many prices they hold, and the ranges they span. */
export function draftStats(sheet: SheetState): DraftStats {
  let rows = 0;
  let prices = 0;
  let areaMin: number | null = null;
  let areaMax: number | null = null;
  for (const r of sheet.rows) {
    const filled = r.prices.filter((p) => p.trim() !== '').length;
    if (filled > 0 || r.size.trim() !== '' || r.baseArea.trim() !== '') rows += 1;
    prices += filled;
    const area = parseNumeric(r.baseArea).value;
    if (area != null && area > 0) {
      areaMin = areaMin == null ? area : Math.min(areaMin, area);
      areaMax = areaMax == null ? area : Math.max(areaMax, area);
    }
  }
  const qtys = sheet.quantities.map((q) => parseNumeric(q).value).filter((q): q is number => q != null && q > 0);
  return {
    rows,
    prices,
    areaMin,
    areaMax,
    columns: qtys.length,
    qtyMin: qtys.length ? Math.min(...qtys) : null,
    qtyMax: qtys.length ? Math.max(...qtys) : null,
  };
}

/** What the sidebar and overview show for one product. */
export interface ProductStatus extends Omit<DraftStats, 'rows' | 'prices'> {
  hasDraft: boolean;
  rows: number;
  prices: number;
  /** Rounding applied before comparing (1 = exact). */
  roundTo: number;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Edited here and not on the server yet. */
  unsynced: boolean;
  comparedAt: string | null;
  pricingName: string | null;
  /** Null until production prices have been fetched for this product. */
  compare: CompareSummary | null;
}

export function productStatus(workspace: Workspace, slug: string): ProductStatus {
  const draft = workspace.drafts[slug];
  const snapshot = workspace.snapshots[slug] ?? null;
  const unsynced = !!workspace.dirty[slug];
  if (!draft) {
    return {
      hasDraft: false,
      rows: 0,
      prices: 0,
      areaMin: null,
      areaMax: null,
      columns: 0,
      qtyMin: null,
      qtyMax: null,
      roundTo: workspace.compareRounding[slug] ?? 1,
      updatedAt: null,
      updatedBy: null,
      unsynced,
      comparedAt: snapshot?.fetchedAt ?? null,
      pricingName: null,
      compare: null,
    };
  }

  const stats = draftStats(draft.sheet);
  const comparison = snapshot
    ? compareDraft(parseSheet(draft.sheet), snapshot, { roundTo: workspace.compareRounding[slug] ?? 1 })
    : null;
  return {
    hasDraft: true,
    ...stats,
    roundTo: workspace.compareRounding[slug] ?? 1,
    updatedAt: draft.updatedAt || null,
    updatedBy: draft.updatedBy,
    unsynced,
    comparedAt: snapshot?.fetchedAt ?? null,
    pricingName: comparison?.pricingName ?? null,
    compare: comparison && comparison.summary.compared > 0 ? comparison.summary : null,
  };
}

/* ------------------------------------------------------------------ */
/* Merging what the server has                                         */
/* ------------------------------------------------------------------ */

/** A server copy waiting on the user: newer than the draft on screen, or one that beat our save. */
export interface HeldDraft {
  /** Null when the server copy is a deletion. */
  draft: RemoteDraft | null;
  version: number;
}

export function draftFromRemote(remote: RemoteDraft): ProductDraft {
  return { sheet: hydrateSheet(remote.sheet), updatedAt: remote.updatedAt, updatedBy: remote.updatedBy };
}

function snapshotStamp(snapshot: ProductionSnapshot | undefined): string {
  return snapshot?.savedAt ?? snapshot?.fetchedAt ?? '';
}

/**
 * Products whose server copy differs from ours and that we have no unsynced
 * changes to — the ones worth downloading after a cheap index poll.
 */
export function staleSlugs(
  workspace: Workspace,
  index: { versions: Record<string, number>; snapshotStamps: Record<string, string> },
): string[] {
  const out = new Set<string>();
  for (const slug of new Set([...Object.keys(index.versions), ...Object.keys(workspace.versions)])) {
    if (workspace.dirty[slug]) continue;
    if ((index.versions[slug] ?? 0) !== (workspace.versions[slug] ?? 0)) out.add(slug);
  }
  for (const [slug, stamp] of Object.entries(index.snapshotStamps)) {
    if (!workspace.dirtySnapshots[slug] && stamp > snapshotStamp(workspace.snapshots[slug])) out.add(slug);
  }
  return [...out].filter((slug) => findPriceList(slug));
}

/**
 * Fold a server read into the local workspace.
 *
 * `slugs` are the products the read covered (all of them when omitted).
 * Local unsynced edits always win here — they are pushed next, and the server
 * reports a conflict if it moved on meanwhile. A newer server draft for
 * `holdSlug` (the product open on screen) is not applied under the user's
 * cursor; it is returned in `held` so the UI can offer it instead.
 */
export function mergeRemote(
  workspace: Workspace,
  remote: RemoteWorkspace,
  options: { slugs?: string[]; holdSlug?: string | null } = {},
): { workspace: Workspace; held: Record<string, HeldDraft> } {
  const covered =
    options.slugs ??
    [...new Set([...Object.keys(remote.versions), ...Object.keys(remote.drafts), ...Object.keys(workspace.versions)])];
  const drafts = { ...workspace.drafts };
  const versions = { ...workspace.versions };
  const dirty = { ...workspace.dirty };
  const snapshots = { ...workspace.snapshots };
  const held: Record<string, HeldDraft> = {};
  let changed = false;

  for (const slug of covered) {
    if (!findPriceList(slug) || workspace.dirty[slug]) continue;
    const remoteVersion = remote.versions[slug] ?? 0;
    const localVersion = workspace.versions[slug] ?? 0;
    if (remoteVersion === localVersion) continue;

    if (remoteVersion < localVersion) {
      // The server lost data we had (storage was reset). Re-upload ours.
      versions[slug] = remoteVersion;
      if (drafts[slug]) dirty[slug] = true;
      changed = true;
      continue;
    }

    const incoming = remote.drafts[slug] ?? null;
    if (slug === options.holdSlug) {
      held[slug] = { draft: incoming, version: remoteVersion };
      continue;
    }
    if (incoming) drafts[slug] = draftFromRemote(incoming);
    else delete drafts[slug];
    versions[slug] = remoteVersion;
    changed = true;
  }

  for (const [slug, snapshot] of Object.entries(remote.snapshots)) {
    if (!findPriceList(slug) || workspace.dirtySnapshots[slug]) continue;
    if (snapshotStamp(snapshot) > snapshotStamp(snapshots[slug])) {
      snapshots[slug] = snapshot;
      changed = true;
    }
  }

  return { workspace: changed ? { ...workspace, drafts, versions, dirty, snapshots } : workspace, held };
}
