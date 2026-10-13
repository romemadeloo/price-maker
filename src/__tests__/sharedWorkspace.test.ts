import { describe, expect, it } from 'vitest';
import { handleWorkspace } from '../../api/_lib/handler';
import { memoryStore } from '../../api/_lib/store';
import type { RemoteWorkspace } from '../lib/sync';
import { emptyWorkspace, mergeRemote, staleSlugs, type Workspace } from '../state/workspace';
import type { SheetState } from '../types';

const SHEET = {
  quantities: ['10', '20'],
  rows: [{ size: '100*100', baseArea: '10000', prices: ['11,100', '20,000'] }],
};

const NOW = new Date('2026-10-13T09:00:00.000Z');

function api(store = memoryStore(), passcode: string | null = null) {
  const call = async (method: 'GET' | 'PUT', query: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await handleWorkspace(
      new Request(`http://localhost/api/workspace${query}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      store,
      { passcode, now: () => NOW },
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { store, call };
}

describe('shared workspace API', () => {
  it('saves a draft and serves it back with its version and author', async () => {
    const { call } = api();
    const put = await call('PUT', '?slug=die-cut-sticker&kind=draft', { sheet: SHEET, baseVersion: 0, updatedBy: 'Rome' });
    expect(put).toEqual({ status: 200, body: { version: 1, updatedAt: NOW.toISOString(), updatedBy: 'Rome' } });

    const get = await call('GET', '');
    expect(get.body.versions).toEqual({ 'die-cut-sticker': 1 });
    expect(get.body.drafts['die-cut-sticker']).toEqual({
      sheet: SHEET,
      updatedAt: NOW.toISOString(),
      updatedBy: 'Rome',
      version: 1,
    });
  });

  it('refuses a save based on an old version and returns what is there instead', async () => {
    const { call } = api();
    await call('PUT', '?slug=die-cut-sticker&kind=draft', { sheet: SHEET, baseVersion: 0, updatedBy: 'A' });

    // B also started from version 0, and saves second.
    const stale = await call('PUT', '?slug=die-cut-sticker&kind=draft', { sheet: SHEET, baseVersion: 0, updatedBy: 'B' });
    expect(stale.status).toBe(409);
    expect(stale.body.version).toBe(1);
    expect(stale.body.draft.updatedBy).toBe('A');

    // Re-based on version 1, B's save goes through deliberately.
    const rebased = await call('PUT', '?slug=die-cut-sticker&kind=draft', { sheet: SHEET, baseVersion: 1, updatedBy: 'B' });
    expect(rebased.body.version).toBe(2);
  });

  it('deletes a draft but keeps counting versions, so others notice', async () => {
    const { call } = api();
    await call('PUT', '?slug=die-cut-sticker&kind=draft', { sheet: SHEET, baseVersion: 0 });
    const del = await call('PUT', '?slug=die-cut-sticker&kind=draft', { sheet: null, baseVersion: 1 });
    expect(del.body.version).toBe(2);

    const get = await call('GET', '');
    expect(get.body.drafts).toEqual({});
    expect(get.body.versions).toEqual({ 'die-cut-sticker': 2 });
  });

  it('stores production snapshots and stamps them for the poll', async () => {
    const { call } = api();
    const snapshot = { fetchedAt: '2026-10-13T08:00:00.000Z', savedAt: '2026-10-13T08:00:01.000Z', quotes: {} };
    await call('PUT', '?slug=die-cut-sticker&kind=snapshot', snapshot);

    const summary = await call('GET', '?summary=1');
    expect(summary.body).toEqual({
      storage: 'memory',
      versions: {},
      snapshotStamps: { 'die-cut-sticker': snapshot.savedAt },
    });
    const full = await call('GET', '?slugs=die-cut-sticker');
    expect(full.body.snapshots['die-cut-sticker']).toEqual(snapshot);
  });

  it('rejects unknown products and malformed sheets', async () => {
    const { call } = api();
    expect((await call('PUT', '?slug=Not%20A%20Slug&kind=draft', { sheet: SHEET, baseVersion: 0 })).status).toBe(400);
    expect((await call('PUT', '?slug=die-cut-sticker&kind=draft', { sheet: { rows: 1 }, baseVersion: 0 })).status).toBe(400);
    expect((await call('PUT', '?slug=die-cut-sticker&kind=draft', { sheet: SHEET })).status).toBe(400);
  });

  it('requires the passcode only when one is configured', async () => {
    const { call } = api(memoryStore(), 'sticker');
    expect((await call('GET', '')).status).toBe(401);
    expect((await call('GET', '', undefined, { 'x-pricer-passcode': 'wrong' })).status).toBe(401);
    expect((await call('GET', '', undefined, { 'x-pricer-passcode': 'sticker' })).status).toBe(200);
  });

  it('says so when no storage is configured', async () => {
    const res = await handleWorkspace(new Request('http://localhost/api/workspace'), null);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('not-configured');
  });
});

/* ------------------------------------------------------------------ */

function remote(partial: Partial<RemoteWorkspace>): RemoteWorkspace {
  return { storage: 'memory', versions: {}, snapshotStamps: {}, drafts: {}, snapshots: {}, ...partial };
}

const theirs = (updatedBy: string, version: number) => ({
  sheet: SHEET,
  updatedAt: NOW.toISOString(),
  updatedBy,
  version,
});

function local(partial: Partial<Workspace>): Workspace {
  return { ...emptyWorkspace(), ...partial };
}

const LOCAL_SHEET: SheetState = {
  quantities: ['10'],
  rows: [{ id: 'r1', size: '50*50', baseArea: '2500', prices: ['5,000'] }],
};

describe('merging the shared workspace into the local one', () => {
  it('takes newer drafts from the server', () => {
    const { workspace } = mergeRemote(
      local({}),
      remote({ versions: { 'circle-sticker': 3 }, drafts: { 'circle-sticker': theirs('A', 3) } }),
    );
    expect(workspace.versions['circle-sticker']).toBe(3);
    expect(workspace.drafts['circle-sticker'].updatedBy).toBe('A');
    expect(workspace.drafts['circle-sticker'].sheet.rows[0].prices).toEqual(['11,100', '20,000']);
  });

  it('never overwrites unshared local edits', () => {
    const before = local({
      drafts: { 'circle-sticker': { sheet: LOCAL_SHEET, updatedAt: '', updatedBy: 'me' } },
      versions: { 'circle-sticker': 1 },
      dirty: { 'circle-sticker': true },
    });
    const { workspace } = mergeRemote(
      before,
      remote({ versions: { 'circle-sticker': 2 }, drafts: { 'circle-sticker': theirs('A', 2) } }),
    );
    expect(workspace.drafts['circle-sticker'].sheet).toBe(LOCAL_SHEET);
    expect(workspace.versions['circle-sticker']).toBe(1);
  });

  it('holds back an update to the product on screen instead of applying it', () => {
    const before = local({
      drafts: { 'circle-sticker': { sheet: LOCAL_SHEET, updatedAt: '', updatedBy: null } },
      versions: { 'circle-sticker': 1 },
    });
    const { workspace, held } = mergeRemote(
      before,
      remote({ versions: { 'circle-sticker': 2 }, drafts: { 'circle-sticker': theirs('A', 2) } }),
      { holdSlug: 'circle-sticker' },
    );
    expect(workspace.drafts['circle-sticker'].sheet).toBe(LOCAL_SHEET);
    expect(held['circle-sticker']).toMatchObject({ version: 2, draft: { updatedBy: 'A' } });
  });

  it('removes drafts deleted on the server', () => {
    const before = local({
      drafts: { 'circle-sticker': { sheet: LOCAL_SHEET, updatedAt: '', updatedBy: null } },
      versions: { 'circle-sticker': 1 },
    });
    const { workspace } = mergeRemote(before, remote({ versions: { 'circle-sticker': 2 } }));
    expect(workspace.drafts['circle-sticker']).toBeUndefined();
    expect(workspace.versions['circle-sticker']).toBe(2);
  });

  it('re-uploads a draft the server has lost', () => {
    const before = local({
      drafts: { 'circle-sticker': { sheet: LOCAL_SHEET, updatedAt: '', updatedBy: null } },
      versions: { 'circle-sticker': 4 },
    });
    const { workspace } = mergeRemote(before, remote({}));
    expect(workspace.versions['circle-sticker']).toBe(0);
    expect(workspace.dirty['circle-sticker']).toBe(true);
    expect(workspace.drafts['circle-sticker'].sheet).toBe(LOCAL_SHEET);
  });

  it('keeps whichever production snapshot was saved last', () => {
    const older = { fetchedAt: '2026-10-01T00:00:00Z', savedAt: '2026-10-01T00:00:00Z', quotes: {} };
    const newer = { fetchedAt: '2026-10-12T00:00:00Z', savedAt: '2026-10-12T00:00:00Z', quotes: {} };
    expect(mergeRemote(local({ snapshots: { 'circle-sticker': older } }), remote({ snapshots: { 'circle-sticker': newer } })).workspace.snapshots['circle-sticker']).toBe(newer);
    expect(mergeRemote(local({ snapshots: { 'circle-sticker': newer } }), remote({ snapshots: { 'circle-sticker': older } })).workspace.snapshots['circle-sticker']).toBe(newer);
  });

  it('only downloads products that changed since the last poll', () => {
    const ws = local({
      versions: { 'circle-sticker': 2, 'square-sticker': 1, 'oval-sticker': 1 },
      dirty: { 'oval-sticker': true },
      snapshots: { 'circle-sticker': { fetchedAt: 'a', savedAt: '2026-10-01', quotes: {} } },
    });
    const stale = staleSlugs(ws, {
      versions: { 'circle-sticker': 2, 'square-sticker': 2, 'oval-sticker': 5, 'clear-sticker': 1 },
      snapshotStamps: { 'circle-sticker': '2026-10-02' },
    });
    // square changed, clear is new, circle has a newer snapshot; oval is ours to push.
    expect(stale.sort()).toEqual(['circle-sticker', 'clear-sticker', 'square-sticker']);
  });
});
