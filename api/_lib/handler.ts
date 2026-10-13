import type { WorkspaceStore } from './store.js';

/**
 * The shared-workspace API, written against Web Request/Response so the same
 * code serves the Vercel function and the Vite dev server.
 *
 *   GET  /api/workspace?summary=1            versions + snapshot stamps (the poll)
 *   GET  /api/workspace[?slugs=a,b]          drafts and snapshots
 *   PUT  /api/workspace?slug=x&kind=draft    { sheet | null, baseVersion, updatedBy }
 *                                            → 200 { version, updatedAt, updatedBy }
 *                                            → 409 { version, draft }  someone saved first
 *   PUT  /api/workspace?slug=x&kind=snapshot { fetchedAt, savedAt, quotes }
 *
 * There are no user accounts. If PRICER_PASSCODE is set, every request must
 * send it in `x-pricer-passcode`; if it is not set, anyone with the URL can
 * read and edit.
 */

export interface StoredSheet {
  quantities: string[];
  rows: { size: string; baseArea: string; prices: string[] }[];
}

export interface StoredDraft {
  sheet: StoredSheet;
  updatedAt: string;
  updatedBy: string | null;
}

export interface HandlerOptions {
  passcode?: string | null;
  now?: () => Date;
}

/** Product slugs as the site uses them. The client checks them against the catalog. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isSlug = (value: string) => value.length <= 64 && SLUG.test(value);

const MAX_ROWS = 20_000;
const MAX_COLUMNS = 200;
const MAX_CELL = 64;
const MAX_NAME = 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: code, message }, status);
}

function parseJson<T>(raw: string | undefined | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function cell(value: unknown): string {
  return String(value ?? '').slice(0, MAX_CELL);
}

/** Coerce a client-sent sheet into the stored shape, or null when it is not one. */
export function sanitizeSheet(value: unknown): StoredSheet | null {
  const s = value as { quantities?: unknown; rows?: unknown };
  if (!s || !Array.isArray(s.quantities) || !Array.isArray(s.rows)) return null;
  if (s.quantities.length > MAX_COLUMNS || s.rows.length > MAX_ROWS) return null;
  const quantities = s.quantities.map(cell);
  const rows = s.rows.map((r) => {
    const row = (r ?? {}) as { size?: unknown; baseArea?: unknown; prices?: unknown };
    const prices = Array.isArray(row.prices) ? row.prices : [];
    return { size: cell(row.size), baseArea: cell(row.baseArea), prices: quantities.map((_, i) => cell(prices[i])) };
  });
  return { quantities, rows };
}

function parseSlugs(param: string | null): string[] | undefined {
  if (param == null) return undefined;
  return param.split(',').filter(isSlug);
}

export async function handleWorkspace(
  request: Request,
  store: WorkspaceStore | null,
  options: HandlerOptions = {},
): Promise<Response> {
  const passcode = options.passcode || null;
  if (passcode && request.headers.get('x-pricer-passcode') !== passcode) {
    return error(401, 'passcode', 'This workspace needs the team passcode.');
  }
  if (!store) {
    return error(
      503,
      'not-configured',
      'Shared storage is not set up. Connect a Postgres database (DATABASE_URL) to enable it.',
    );
  }

  const url = new URL(request.url);
  const now = options.now ?? (() => new Date());

  try {
    if (request.method === 'GET') {
      const index = await store.readIndex();
      if (url.searchParams.get('summary') === '1') return json({ storage: store.kind, ...index });

      const slugs = parseSlugs(url.searchParams.get('slugs'));
      const [rawDrafts, rawSnapshots] = await Promise.all([store.readDrafts(slugs), store.readSnapshots(slugs)]);
      const drafts: Record<string, StoredDraft & { version: number }> = {};
      for (const [slug, raw] of Object.entries(rawDrafts)) {
        const draft = parseJson<StoredDraft>(raw);
        if (draft) drafts[slug] = { ...draft, version: index.versions[slug] ?? 0 };
      }
      const snapshots: Record<string, unknown> = {};
      for (const [slug, raw] of Object.entries(rawSnapshots)) {
        const snapshot = parseJson(raw);
        if (snapshot) snapshots[slug] = snapshot;
      }
      return json({ storage: store.kind, ...index, drafts, snapshots });
    }

    if (request.method === 'PUT') {
      const slug = url.searchParams.get('slug') ?? '';
      if (!isSlug(slug)) return error(400, 'bad-slug', `Unknown product "${slug}".`);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return error(400, 'bad-body', 'Expected a JSON body.');

      const kind = url.searchParams.get('kind');
      if (kind === 'draft') {
        const baseVersion = Number(body.baseVersion);
        if (!Number.isInteger(baseVersion) || baseVersion < 0) return error(400, 'bad-version', 'baseVersion is required.');

        let record: string | null = null;
        let draft: StoredDraft | null = null;
        if (body.sheet != null) {
          const sheet = sanitizeSheet(body.sheet);
          if (!sheet) return error(400, 'bad-sheet', 'The draft is not a price table, or it is too large.');
          const name = typeof body.updatedBy === 'string' ? body.updatedBy.trim().slice(0, MAX_NAME) : '';
          draft = { sheet, updatedAt: now().toISOString(), updatedBy: name || null };
          record = JSON.stringify(draft);
        }

        const result = await store.writeDraft(slug, record, baseVersion);
        if (!result.ok) {
          const current = parseJson<StoredDraft>(result.record);
          return json(
            { error: 'conflict', version: result.version, draft: current ? { ...current, version: result.version } : null },
            409,
          );
        }
        return json({ version: result.version, updatedAt: draft?.updatedAt ?? now().toISOString(), updatedBy: draft?.updatedBy ?? null });
      }

      if (kind === 'snapshot') {
        if (typeof body.fetchedAt !== 'string' || !body.quotes || typeof body.quotes !== 'object') {
          return error(400, 'bad-snapshot', 'Expected { fetchedAt, quotes }.');
        }
        const stamp = typeof body.savedAt === 'string' ? body.savedAt : now().toISOString();
        await store.writeSnapshot(slug, JSON.stringify({ ...body, savedAt: stamp }), stamp);
        return json({ savedAt: stamp });
      }

      return error(400, 'bad-kind', 'kind must be "draft" or "snapshot".');
    }

    return error(405, 'method', 'Use GET or PUT.');
  } catch (err) {
    return error(502, 'storage', `Shared storage failed: ${(err as Error).message}`);
  }
}
