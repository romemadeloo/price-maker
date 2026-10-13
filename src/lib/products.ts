/**
 * The musticker.com product catalog, as listed on the live site.
 *
 * `slug` is the product's URL slug and also the path segment the production
 * quotation endpoint takes (`/pricing/quotation/<slug>`). Several products share
 * one production price book — every die-cut-shaped sticker quotes off the same
 * "diecut/kisscut" pricing — but each keeps its own draft here, because the
 * point is to be able to diverge.
 */

export type CategoryId = 'stickers' | 'roll-stickers' | 'sheet-stickers';

export interface Category {
  id: CategoryId;
  name: string;
  english: string;
}

export interface Product {
  slug: string;
  category: CategoryId;
  /** Korean name, exactly as the site shows it. */
  name: string;
  english: string;
}

export const CATEGORIES: Category[] = [
  { id: 'stickers', name: '스티커', english: 'Stickers' },
  { id: 'roll-stickers', name: '롤 스티커', english: 'Roll stickers' },
  { id: 'sheet-stickers', name: '판스티커', english: 'Sheet stickers' },
];

export const PRODUCTS: Product[] = [
  { slug: 'die-cut-sticker', category: 'stickers', name: '자유형 조각스티커', english: 'Die-cut sticker' },
  { slug: 'circle-sticker', category: 'stickers', name: '원형 스티커', english: 'Circle sticker' },
  { slug: 'rectangle-sticker', category: 'stickers', name: '직사각형 스티커', english: 'Rectangle sticker' },
  { slug: 'square-sticker', category: 'stickers', name: '정사각형 스티커', english: 'Square sticker' },
  { slug: 'oval-sticker', category: 'stickers', name: '타원형 스티커', english: 'Oval sticker' },
  { slug: 'rounded-sticker', category: 'stickers', name: '둥근 사각 스티커', english: 'Rounded-corner sticker' },
  { slug: 'kiss-cut-sticker', category: 'stickers', name: '도무송 스티커', english: 'Kiss-cut sticker' },
  { slug: 'sticker-sheet', category: 'stickers', name: '판스티커', english: 'Sticker sheet' },
  { slug: 'clear-sticker', category: 'stickers', name: '투명 스티커', english: 'Clear sticker' },
  { slug: 'hologram-sticker', category: 'stickers', name: '홀로그램 스티커', english: 'Hologram sticker' },
  { slug: 'transfer-sticker', category: 'stickers', name: '풀 컬러 레터링 스티커', english: 'Full-color lettering' },
  { slug: 'vinyl-lettering', category: 'stickers', name: '글자 커팅 스티커', english: 'Vinyl lettering' },

  { slug: 'die-cut-roll', category: 'roll-stickers', name: '자유형 롤 스티커', english: 'Die-cut roll' },
  { slug: 'clear-roll', category: 'roll-stickers', name: '투명 롤 스티커', english: 'Clear roll' },
  { slug: 'circle-roll', category: 'roll-stickers', name: '원형 롤 스티커', english: 'Circle roll' },
  { slug: 'square-roll', category: 'roll-stickers', name: '정사각형 롤 스티커', english: 'Square roll' },
  { slug: 'rectangle-roll', category: 'roll-stickers', name: '직사각형 롤 스티커', english: 'Rectangle roll' },
  { slug: 'rounded-roll', category: 'roll-stickers', name: '둥근 사각 롤 스티커', english: 'Rounded-corner roll' },
  { slug: 'oval-roll', category: 'roll-stickers', name: '타원형 롤 스티커', english: 'Oval roll' },
  { slug: 'paper-roll', category: 'roll-stickers', name: '종이 롤 스티커', english: 'Paper roll' },

  { slug: 'die-cut-sheet', category: 'sheet-stickers', name: '자유형 판스티커', english: 'Die-cut sheet' },
  { slug: 'circle-sheet', category: 'sheet-stickers', name: '원형 판스티커', english: 'Circle sheet' },
  { slug: 'oval-sheet', category: 'sheet-stickers', name: '타원형 판스티커', english: 'Oval sheet' },
  { slug: 'square-sheet', category: 'sheet-stickers', name: '정사각형 판스티커', english: 'Square sheet' },
  { slug: 'rectangle-sheet', category: 'sheet-stickers', name: '직사각형 판스티커', english: 'Rectangle sheet' },
  { slug: 'rounded-sheet', category: 'sheet-stickers', name: '둥근 사각 판스티커', english: 'Rounded-corner sheet' },
];

export const DEFAULT_PRODUCT_SLUG = PRODUCTS[0].slug;

export function findProduct(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

/** The product's page on the live site. */
export function productUrl(product: Product): string {
  return `https://www.musticker.com/kr/${product.category}/${product.slug}`;
}
