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
  /**
   * Products production prices differently by option. Each variant gets its
   * own price list (draft + comparison); the first is the default.
   */
  variants?: Variant[];
}

/** A production color option (`color_id`), as the product page lists it. */
export interface ProductColor {
  id: number;
  name: string;
  /** CSS background for the swatch, from production's own style. */
  swatch: string;
}

/** One group of options that production quotes from the same price book. */
export interface Variant {
  id: string;
  name: string;
  english: string;
  colors: ProductColor[];
  /**
   * Extra quotation parameters. The first color stands in for the group; the
   * Compare tab checks that every other color is priced from the same book.
   */
  params: Record<string, string>;
}

/**
 * Vinyl lettering colors, from production's featured-data. Checked against the
 * quotation endpoint on 2026-10-13: colors 1–10 quote from price book #69,
 * 11–13 from #70 (+15% / +10% on solid), 14 from #71 (+20% / +15%), and 15
 * from #8 — a legacy book that stops at 300 pieces. The font does not change
 * the price.
 */
const LETTERING_COLORS: Record<string, ProductColor[]> = {
  solid: [
    { id: 1, name: 'Black', swatch: '#000000' },
    { id: 2, name: 'White', swatch: '#FFFFFF' },
    { id: 3, name: 'Red', swatch: '#FF0000' },
    { id: 4, name: 'Orange', swatch: '#FFA500' },
    { id: 5, name: 'Yellow', swatch: '#FFFF00' },
    { id: 6, name: 'Green', swatch: '#008000' },
    { id: 7, name: 'Blue', swatch: '#0000FF' },
    { id: 8, name: 'Purple', swatch: '#800080' },
    { id: 9, name: 'Pink', swatch: '#FFC0CB' },
    { id: 10, name: 'Yellow Orange', swatch: '#FFB700' },
  ],
  metallic: [
    { id: 11, name: 'Gold', swatch: 'linear-gradient(135deg, #FFD700 0%, #FFF 50%, #FFD700 100%)' },
    { id: 12, name: 'Silver', swatch: 'linear-gradient(135deg, #C0C0C0 0%, #FFF 50%, #C0C0C0 100%)' },
    { id: 13, name: 'Bronze', swatch: 'linear-gradient(135deg, #CD7F32 0%, #FFF 49.52%, #CD7F32 100%)' },
  ],
  hologram: [
    { id: 14, name: 'Hologram', swatch: 'linear-gradient(135deg, #a5f3fc 0%, #f5d0fe 35%, #fef9c3 65%, #bfdbfe 100%)' },
  ],
  fullColor: [
    {
      id: 15,
      name: 'Full Color',
      swatch: 'conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #3b82f6, #a855f7, #ef4444)',
    },
  ],
};

function colorVariant(id: string, name: string, english: string, colors: ProductColor[]): Variant {
  return { id, name, english, colors, params: { color_id: String(colors[0].id) } };
}

const LETTERING_VARIANTS: Variant[] = [
  colorVariant('solid', '단색', 'Solid colors', LETTERING_COLORS.solid),
  colorVariant('metallic', '금·은·동', 'Gold · Silver · Bronze', LETTERING_COLORS.metallic),
  colorVariant('hologram', '홀로그램', 'Hologram', LETTERING_COLORS.hologram),
  colorVariant('full-color', '풀 컬러', 'Full color', LETTERING_COLORS.fullColor),
];

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
  {
    slug: 'vinyl-lettering',
    category: 'stickers',
    name: '글자 커팅 스티커',
    english: 'Vinyl lettering',
    variants: LETTERING_VARIANTS,
  },

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

/* ------------------------------------------------------------------ */
/* Price lists: what owns a draft                                      */
/* ------------------------------------------------------------------ */

/**
 * One drafted price table and its comparison. Most products have exactly one;
 * a product with variants has one per variant.
 *
 * `key` identifies it in storage and the API. The default (first) variant
 * keeps the bare product slug, so a product that gains variants keeps its
 * existing draft; the others are `<slug>~<variant>`.
 */
export interface PriceList {
  key: string;
  product: Product;
  variant: Variant | null;
}

export const VARIANT_SEPARATOR = '~';

export const PRICE_LISTS: PriceList[] = PRODUCTS.flatMap((product): PriceList[] =>
  product.variants
    ? product.variants.map((variant, i) => ({
        key: i === 0 ? product.slug : `${product.slug}${VARIANT_SEPARATOR}${variant.id}`,
        product,
        variant,
      }))
    : [{ key: product.slug, product, variant: null }],
);

const BY_KEY = new Map(PRICE_LISTS.map((l) => [l.key, l]));

export const DEFAULT_PRODUCT_SLUG = PRODUCTS[0].slug;

export function findPriceList(key: string): PriceList | undefined {
  return BY_KEY.get(key);
}

export function findProduct(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

export function priceListsOf(product: Product): PriceList[] {
  return PRICE_LISTS.filter((l) => l.product === product);
}

/** "글자 커팅 스티커 · 금·은·동" — for titles and confirmations. */
export function priceListName(list: PriceList): string {
  return list.variant ? `${list.product.name} · ${list.variant.name}` : list.product.name;
}

/** The product's page on the live site. */
export function productUrl(product: Product): string {
  return `https://www.musticker.com/kr/${product.category}/${product.slug}`;
}
