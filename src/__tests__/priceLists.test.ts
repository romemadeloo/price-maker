import { describe, expect, it } from 'vitest';
import { findPriceList, PRICE_LISTS, priceListName, PRODUCTS } from '../lib/products';
import { quotationUrl } from '../lib/production';
import { handleWorkspace } from '../../api/_lib/handler';
import { memoryStore } from '../../api/_lib/store';
import { emptyWorkspace, mergeRemote } from '../state/workspace';

describe('price lists', () => {
  it('gives every product one list, and vinyl lettering one per color group', () => {
    const lettering = PRICE_LISTS.filter((l) => l.product.slug === 'vinyl-lettering');
    expect(lettering.map((l) => l.key)).toEqual([
      'vinyl-lettering',
      'vinyl-lettering~metallic',
      'vinyl-lettering~hologram',
      'vinyl-lettering~full-color',
    ]);
    expect(PRICE_LISTS).toHaveLength(PRODUCTS.length - 1 + 4);
    expect(new Set(PRICE_LISTS.map((l) => l.key)).size).toBe(PRICE_LISTS.length);
  });

  it('keeps the bare slug for the default group, so existing drafts stay put', () => {
    const solid = findPriceList('vinyl-lettering');
    expect(solid?.variant?.id).toBe('solid');
    expect(findPriceList('die-cut-sticker')?.variant).toBeNull();
  });

  it('covers all 15 production colors, each in exactly one group', () => {
    const ids = PRICE_LISTS.flatMap((l) => l.variant?.colors.map((c) => c.id) ?? []);
    expect(ids.sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
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
