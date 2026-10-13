import { describe, expect, it } from 'vitest';
import { findPriceList, PRICE_LISTS, priceListName, PRODUCTS } from '../lib/products';
import { quotationUrl } from '../lib/production';
import { handleWorkspace } from '../../api/_lib/handler';
import { memoryStore } from '../../api/_lib/store';
import { emptyWorkspace, mergeRemote } from '../state/workspace';

describe('price lists', () => {
  const keysOf = (slug: string) => PRICE_LISTS.filter((l) => l.product.slug === slug).map((l) => l.key);

  it('gives transfer stickers one price list per color group, full color included', () => {
    expect(keysOf('transfer-sticker')).toEqual([
      'transfer-sticker',
      'transfer-sticker~metallic',
      'transfer-sticker~hologram',
      'transfer-sticker~full-color',
    ]);
  });

  it('gives vinyl lettering no full-color list — it does not sell full color', () => {
    expect(keysOf('vinyl-lettering')).toEqual([
      'vinyl-lettering',
      'vinyl-lettering~metallic',
      'vinyl-lettering~hologram',
    ]);
    expect(findPriceList('vinyl-lettering~full-color')).toBeUndefined();
  });

  const SHEETS = ['sticker-sheet', 'die-cut-sheet', 'circle-sheet', 'oval-sheet', 'square-sheet', 'rectangle-sheet', 'rounded-sheet'];

  it.each(SHEETS)('gives %s one price list per material', (slug) => {
    const lists = PRICE_LISTS.filter((l) => l.product.slug === slug);
    expect(lists.map((l) => l.key)).toEqual([slug, `${slug}~clear`, `${slug}~hologram`]);
    // Matte is sent explicitly: without it production falls back to an older book.
    expect(lists.map((l) => l.variant?.params)).toEqual([
      { material_id: '1' },
      { material_id: '2' },
      { material_id: '3' },
    ]);
    expect(lists.every((l) => l.variant?.kind === 'material')).toBe(true);
  });

  it('gives every other product exactly one list', () => {
    expect(PRICE_LISTS).toHaveLength(PRODUCTS.length - 2 - SHEETS.length + 4 + 3 + SHEETS.length * 3);
    expect(new Set(PRICE_LISTS.map((l) => l.key)).size).toBe(PRICE_LISTS.length);
  });

  it('keeps the bare slug for the default group, so existing drafts stay put', () => {
    const solid = findPriceList('vinyl-lettering');
    expect(solid?.variant?.id).toBe('solid');
    expect(findPriceList('die-cut-sticker')?.variant).toBeNull();
  });

  it.each([
    ['transfer-sticker', 15],
    ['vinyl-lettering', 14],
  ] as const)('covers %s colors 1–%i, each in exactly one group', (slug, last) => {
    const ids = PRICE_LISTS.filter((l) => l.product.slug === slug).flatMap((l) => l.variant?.options.map((c) => c.id) ?? []);
    expect(ids.sort((a, b) => a - b)).toEqual(Array.from({ length: last }, (_, i) => i + 1));
  });

  it('quotes each group with its first color', () => {
    const gold = findPriceList('vinyl-lettering~metallic')!;
    expect(gold.variant!.params).toEqual({ color_id: '11' });
    expect(priceListName(gold)).toBe('글자 커팅 스티커 · 금·은·동');
    expect(quotationUrl('vinyl-lettering', 100, 100, undefined, gold.variant!.params)).toBe(
      '/api/musticker/pricing/quotation/vinyl-lettering?width=100&height=100&color_id=11',
    );
  });

  it('stores and syncs a color group under its own key', async () => {
    const store = memoryStore();
    const res = await handleWorkspace(
      new Request('http://localhost/api/workspace?slug=vinyl-lettering~hologram&kind=draft', {
        method: 'PUT',
        body: JSON.stringify({ sheet: { quantities: ['10'], rows: [] }, baseVersion: 0 }),
      }),
      store,
    );
    expect(res.status).toBe(200);

    const remote = (await (await handleWorkspace(new Request('http://localhost/api/workspace'), store)).json()) as any;
    const { workspace } = mergeRemote(emptyWorkspace(), remote);
    expect(Object.keys(workspace.drafts)).toEqual(['vinyl-lettering~hologram']);
  });

  it('ignores keys that are not in the catalog', () => {
    const { workspace } = mergeRemote(emptyWorkspace(), {
      storage: 'memory',
      versions: { 'vinyl-lettering~neon': 1 },
      snapshotStamps: {},
      drafts: { 'vinyl-lettering~neon': { sheet: { quantities: [], rows: [] }, updatedAt: '', updatedBy: null, version: 1 } },
      snapshots: {},
    });
    expect(workspace.drafts).toEqual({});
  });
});
