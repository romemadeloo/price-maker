import { afterEach, describe, expect, it } from 'vitest';
import { handleWorkspace, MAX_VERSIONS } from '../../api/_lib/handler';
import { memoryStore } from '../../api/_lib/store';
import { allowedUpstream, handleUpstream } from '../../api/_lib/upstream';
import {
  configureServers,
  DEFAULT_SERVER_URLS,
  normalizeServerUrl,
  quotationUrl,
  SERVER_HOSTS,
} from '../lib/production';
import { diffSheets, isSameSheet } from '../lib/versions';
import { emptyWorkspace, mergeRemote, SETTINGS_KEY, settingsRecord, withSettings } from '../state/workspace';

const SHEET = {
  quantities: ['10', '20'],
  rows: [{ size: '', baseArea: '10000', prices: ['11,100', '20,000'] }],
};

function api(store = memoryStore()) {
  let tick = 0;
  const call = async (method: string, query: string, body?: unknown) => {
    const res = await handleWorkspace(
      new Request(`http://localhost/api/workspace${query}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      store,
      // Each call a second later, so "newest first" is well defined.
      { now: () => new Date(Date.UTC(2026, 10, 4, 0, 0, tick++)) },
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { store, call };
}

describe('draft versions API', () => {
  it('saves, lists newest first, and reads a version back', async () => {
    const { call } = api();
    const a = await call('POST', '?kind=version&slug=die-cut-sticker', { label: 'v1', status: 'draft', sheet: SHEET, createdBy: 'Ana' });
    expect(a.status).toBe(201);
    expect(a.body.version).toMatchObject({ label: 'v1', status: 'draft', createdBy: 'Ana' });
    await call('POST', '?kind=version&slug=die-cut-sticker', { label: 'v2', sheet: SHEET });

    const list = await call('GET', '?kind=versions&slug=die-cut-sticker');
    expect(list.body.versions.map((v: any) => v.label)).toEqual(['v2', 'v1']);
    expect(list.body.versions[0].record).toBeUndefined();

    const one = await call('GET', `?kind=version&slug=die-cut-sticker&id=${a.body.version.id}`);
    expect(one.body.version.sheet).toEqual(SHEET);
  });

  it('keeps at most one actual version per product', async () => {
    const { call } = api();
    const v1 = (await call('POST', '?kind=version&slug=die-cut-sticker', { label: 'v1', status: 'actual', sheet: SHEET })).body.version;
    const v2 = (await call('POST', '?kind=version&slug=die-cut-sticker', { label: 'v2', status: 'actual', sheet: SHEET })).body.version;
    await call('POST', '?kind=version&slug=kiss-cut-sticker', { label: 'other', status: 'actual', sheet: SHEET });

    const statuses = async () =>
      Object.fromEntries((await call('GET', '?kind=versions&slug=die-cut-sticker')).body.versions.map((v: any) => [v.label, v.status]));
    expect(await statuses()).toEqual({ v1: 'draft', v2: 'actual' });

    expect((await call('PATCH', `?kind=version&slug=die-cut-sticker&id=${v1.id}`, { status: 'actual' })).status).toBe(200);
    expect(await statuses()).toEqual({ v1: 'actual', v2: 'draft' });
    // Another product's actual is untouched.
    expect((await call('GET', '?kind=versions&slug=kiss-cut-sticker')).body.versions[0].status).toBe('actual');
    void v2;
  });

  it('deletes, and refuses bad input', async () => {
    const { call } = api();
    const v = (await call('POST', '?kind=version&slug=die-cut-sticker', { label: 'v1', sheet: SHEET })).body.version;
    expect((await call('DELETE', `?kind=version&slug=die-cut-sticker&id=${v.id}`)).status).toBe(200);
    expect((await call('DELETE', `?kind=version&slug=die-cut-sticker&id=${v.id}`)).status).toBe(404);

    expect((await call('POST', '?kind=version&slug=die-cut-sticker', { label: '', sheet: SHEET })).status).toBe(400);
    expect((await call('POST', '?kind=version&slug=die-cut-sticker', { label: 'x', status: 'live', sheet: SHEET })).status).toBe(400);
    expect((await call('POST', '?kind=version&slug=die-cut-sticker', { label: 'x', sheet: { nope: 1 } })).status).toBe(400);
    expect((await call('POST', '?kind=version&slug=die-cut-sticker@dev', { label: 'x', sheet: SHEET })).status).toBe(400);
  });

  it('caps versions per product', async () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_VERSIONS; i++) {
      await store.addVersion({ id: `id${i}`, slug: 'die-cut-sticker', label: `v${i}`, status: 'draft', note: null, record: '{}', createdAt: '2026-01-01T00:00:00Z', createdBy: null });
    }
    const { call } = api(store);
    const res = await call('POST', '?kind=version&slug=die-cut-sticker', { label: 'one more', sheet: SHEET });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('too-many');
  });
});

describe('diffSheets', () => {
  it('compares by base area and quantity, not by position', () => {
    const base = SHEET;
    const reordered = { quantities: ['20', '10'], rows: [{ size: '', baseArea: '10,000', prices: ['20000', '11100'] }] };
    expect(isSameSheet(diffSheets(base, reordered))).toBe(true);

    const next = {
      quantities: ['10', '20', '30'],
      rows: [
        { size: '', baseArea: '10000', prices: ['11,000', '20,000', '29,000'] },
        { size: '', baseArea: '20000', prices: ['15,000', '', ''] },
      ],
    };
    const d = diffSheets(base, next);
    expect(d).toMatchObject({ changed: 1, added: 2, removed: 0 });
    expect(d.samples[0]).toEqual({ baseArea: 10000, quantity: 10, from: 11100, to: 11000 });
    expect(diffSheets(next, base)).toMatchObject({ changed: 1, added: 0, removed: 2 });
  });
});

describe('server URLs', () => {
  afterEach(() => configureServers({}));

  it('normalizes and only accepts https musticker.com URLs', () => {
    expect(normalizeServerUrl(' https://dev-8-api.musticker.com/index.php/sys/kr/ ')).toBe('https://dev-8-api.musticker.com/index.php/sys/kr');
    expect(normalizeServerUrl('http://dev-8-api.musticker.com/x')).toBeNull();
    expect(normalizeServerUrl('https://evil.com/index.php')).toBeNull();
    expect(normalizeServerUrl('https://musticker.com.evil.com/')).toBeNull();
    expect(normalizeServerUrl('https://api.musticker.com/x?y=1')).toBeNull();
    expect(normalizeServerUrl('not a url')).toBeNull();
  });

  it('uses the static rewrite for defaults and the upstream proxy otherwise', () => {
    expect(quotationUrl('die-cut-sticker', 10, 10, undefined, {}, 'dev')).toBe('/api/musticker-dev/pricing/quotation/die-cut-sticker?width=10&height=10');

    configureServers({ dev: 'https://dev-8-api.musticker.com/index.php/sys/kr' });
    expect(SERVER_HOSTS.dev).toBe('dev-8-api.musticker.com');
    const url = new URL(quotationUrl('die-cut-sticker', 10, 10, undefined, { color_id: '3' }, 'dev'), 'http://x');
    expect(url.pathname).toBe('/api/upstream');
    expect(url.searchParams.get('__base')).toBe('https://dev-8-api.musticker.com/index.php/sys/kr');
    expect(url.searchParams.get('__path')).toBe('pricing/quotation/die-cut-sticker');
    expect(url.searchParams.get('color_id')).toBe('3');
    // Production is unaffected.
    expect(quotationUrl('die-cut-sticker', 10, 10)).toBe('/api/musticker/pricing/quotation/die-cut-sticker?width=10&height=10');

    // An invalid URL falls back to the default.
    configureServers({ dev: 'https://evil.com' });
    expect(SERVER_HOSTS.dev).toBe(new URL(DEFAULT_SERVER_URLS.dev).host);
  });

  it('shares server URLs through the settings record', () => {
    const mine = withSettings(emptyWorkspace(), { serverUrls: { dev: 'https://dev-8-api.musticker.com/index.php/sys/kr' } });
    expect(mine.dirtySnapshots[SETTINGS_KEY]).toBe(true);
    const record = settingsRecord(mine);

    const theirs = mergeRemote(emptyWorkspace(), {
      storage: 'memory',
      versions: {},
      snapshotStamps: { [SETTINGS_KEY]: record.savedAt! },
      drafts: {},
      snapshots: { [SETTINGS_KEY]: record },
    }).workspace;
    expect(theirs.serverUrls).toEqual({ dev: 'https://dev-8-api.musticker.com/index.php/sys/kr' });
  });
});

describe('upstream proxy', () => {
  const request = (query: string) => new Request(`http://localhost/api/upstream?${query}`);
  const q = (base: string, path = 'pricing/quotation/die-cut-sticker') =>
    `${new URLSearchParams({ __base: base, __path: path })}&width=10&height=10`;

  it('allows only https musticker.com hosts, plus configured extras', () => {
    expect(allowedUpstream('https://dev-8-api.musticker.com/index.php/sys/kr')).not.toBeNull();
    expect(allowedUpstream('https://example.com/')).toBeNull();
    expect(allowedUpstream('https://example.com/', 'example.com')).not.toBeNull();
    expect(allowedUpstream('http://api.musticker.com/')).toBeNull();
  });

  it('forwards quotation requests and their query', async () => {
    let seen = '';
    const fake = (async (url: string) => {
      seen = url;
      return new Response('{"success":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const res = await handleUpstream(request(q('https://dev-8-api.musticker.com/index.php/sys/kr')), { fetch: fake });
    expect(res.status).toBe(200);
    expect(seen).toBe('https://dev-8-api.musticker.com/index.php/sys/kr/pricing/quotation/die-cut-sticker?width=10&height=10');
  });

  it('refuses other hosts and paths, and reports unreachable hosts', async () => {
    expect((await handleUpstream(request(q('https://example.com')))).status).toBe(400);
    expect((await handleUpstream(request(q('https://api.musticker.com', 'admin/users')))).status).toBe(400);
    const failing = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    }) as unknown as typeof fetch;
    const res = await handleUpstream(request(q('https://gone.musticker.com')), { fetch: failing });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('ENOTFOUND');
  });
});
