import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { handleWorkspace } from '../../api/_lib/handler';
import { prismaStore } from '../../api/_lib/prismaStore';

/**
 * The Prisma store against a real Postgres. Skipped unless
 * PRICER_TEST_DATABASE_URL points at a disposable, migrated database — its
 * tables are emptied before every test. A local one:
 *
 *   npx prisma dev --detach
 *   DATABASE_URL=<its TCP url> node scripts/migrate.mjs
 *   PRICER_TEST_DATABASE_URL=<its TCP url> npm test
 */

const url = process.env.PRICER_TEST_DATABASE_URL;
const SHEET = { quantities: ['10'], rows: [{ size: '100*100', baseArea: '10000', prices: ['11,100'] }] };

describe.skipIf(!url)('Prisma store (Postgres)', () => {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const store = prismaStore(prisma);

  const put = async (baseVersion: number, updatedBy: string, sheet: unknown = SHEET) => {
    const res = await handleWorkspace(
      new Request('http://localhost/api/workspace?slug=die-cut-sticker&kind=draft', {
        method: 'PUT',
        body: JSON.stringify({ sheet, baseVersion, updatedBy }),
      }),
      store,
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  beforeEach(async () => {
    await prisma.draft.deleteMany();
    await prisma.snapshot.deleteMany();
  });
  afterAll(() => prisma.$disconnect());

  it('saves, versions and reads drafts back', async () => {
    expect((await put(0, 'A')).body.version).toBe(1);
    expect((await put(1, 'A')).body.version).toBe(2);

    const index = await store.readIndex();
    expect(index.versions).toEqual({ 'die-cut-sticker': 2 });
    const drafts = await store.readDrafts();
    expect(JSON.parse(drafts['die-cut-sticker']).updatedBy).toBe('A');
  });

  it('refuses a stale save and returns the winning copy', async () => {
    await put(0, 'A');
    const stale = await put(0, 'B');
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ version: 1, draft: { updatedBy: 'A' } });
  });

  it('lets exactly one of two simultaneous first saves win', async () => {
    const results = await Promise.all([put(0, 'A'), put(0, 'B')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await store.readIndex()).versions['die-cut-sticker']).toBe(1);
  });

  it('lets exactly one of two simultaneous edits of the same version win', async () => {
    await put(0, 'A');
    const results = await Promise.all([put(1, 'A'), put(1, 'B')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await store.readIndex()).versions['die-cut-sticker']).toBe(2);
  });

  it('keeps counting versions through a delete', async () => {
    await put(0, 'A');
    expect((await put(1, 'A', null)).body.version).toBe(2);
    expect(await store.readDrafts()).toEqual({});
    expect((await store.readIndex()).versions).toEqual({ 'die-cut-sticker': 2 });
  });

  it('upserts snapshots with their stamp', async () => {
    await store.writeSnapshot('die-cut-sticker', '{"a":1}', '2026-10-13T00:00:00Z');
    await store.writeSnapshot('die-cut-sticker', '{"a":2}', '2026-10-13T01:00:00Z');
    expect(await store.readSnapshots(['die-cut-sticker'])).toEqual({ 'die-cut-sticker': '{"a":2}' });
    expect((await store.readIndex()).snapshotStamps).toEqual({ 'die-cut-sticker': '2026-10-13T01:00:00Z' });
  });
});
