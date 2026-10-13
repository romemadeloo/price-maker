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

/** A production option — a color (`color_id`) or a material (`material_id`). */
export interface ProductOption {
  id: number;
  name: string;
  /** CSS background for the swatch; production's own style where it has one. */
  swatch: string;
}

export type VariantKind = 'color' | 'material';

/** One group of options that production quotes from the same price book. */
export interface Variant {
  id: string;
  name: string;
  english: string;
  kind: VariantKind;
  /** The quotation parameter the options are sent as. */
  param: 'color_id' | 'material_id';
  options: ProductOption[];
  /**
   * Extra quotation parameters. The first option stands in for the group; the
   * Compare tab checks that every other option is priced from the same book.
   */
  params: Record<string, string>;
}

/**
 * The lettering colors (`color_id`), from production's featured-data, grouped
 * the way production prices them. Checked against the quotation endpoint on
 * 2026-10-13 (surcharges are on the solid price, up to 10 pcs / from 50 pcs):
 *
 *   group      colors   vinyl lettering        transfer sticker
 *   solid      1–10     #69                    #72
 *   metallic   11–13    #70  +15% / +10%       #73  +15% / +10%
 *   hologram   14       #71  +20% / +15%       #74  +20% / +15%
 *   full color 15       — not sold             #75  +30% / +25%
 *
 * Full color is a transfer-sticker option only. (Production's API still
 * answers vinyl lettering color 15, from a legacy book #8, but the product
 * does not offer it.) Vinyl lettering's font does not change the price.
 */
const COLOR_GROUPS: Record<string, ProductOption[]> = {
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
    {
      id: 14,
      name: 'Hologram',
      swatch: 'linear-gradient(135deg, #B6EEE8 0%, #F5F3EA 32%, #F1B2B9 50%, #D893C1 60%, #B6EEE8 80%)',
    },
  ],
  fullColor: [
    {
      id: 15,
      name: 'Full Color',
      swatch:
        'conic-gradient(from 0deg, #ff3c3c 0deg, #ff9800 60deg, #ffe600 120deg, #1abf48 180deg, #0085ff 240deg, #7f2cff 300deg, #ff3c3c 360deg)',
    },
  ],
};

function colorVariant(id: string, name: string, english: string, options: ProductOption[]): Variant {
  return { id, name, english, kind: 'color', param: 'color_id', options, params: { color_id: String(options[0].id) } };
}

function materialVariant(id: string, name: string, english: string, option: ProductOption): Variant {
  return {
    id,
    name,
    english,
    kind: 'material',
    param: 'material_id',
    options: [option],
    params: { material_id: String(option.id) },
  };
}

/** One price list per color group. */
const SOLID = colorVariant('solid', '단색', 'Solid colors', COLOR_GROUPS.solid);
const METALLIC = colorVariant('metallic', '금·은·동', 'Gold · Silver · Bronze', COLOR_GROUPS.metallic);
const HOLOGRAM = colorVariant('hologram', '홀로그램', 'Hologram', COLOR_GROUPS.hologram);
const FULL_COLOR = colorVariant('full-color', '풀 컬러', 'Full color', COLOR_GROUPS.fullColor);

/**
 * Sheet materials (`material_id`), from production's featured-data — every
 * sheet product offers the same three. Checked against the quotation endpoint
 * on 2026-10-13, against matte at every size and quantity: clear +35%,
 * hologram +15% (production rounds sheets to ₩10).
 *
 *   material   판스티커   자유형 판스티커   shaped sheets (원형 … 둥근 사각)
 *   matte      #34        #39               #40
 *   clear      #35        #38               #41
 *   hologram   #36        #37               #42
 *
 * Asked without a material, production falls back to older books (#33, #32)
 * that still price exactly like matte; matte is sent explicitly so the
 * comparison follows the current book.
 */
const SHEET_MATERIALS: Variant[] = [
  materialVariant('matte', '무광 화이트', 'Matte white', { id: 1, name: 'Matte white', swatch: '#F8FAFC' }),
  materialVariant('clear', '투명', 'Clear', {
    id: 2,
    name: 'Clear',
    swatch: 'repeating-conic-gradient(#cbd5e1 0% 25%, #ffffff 0% 50%) 50% / 6px 6px',
  }),
  materialVariant('hologram', '홀로그램', 'Hologram', {
    id: 3,
    name: 'Hologram',
    swatch: COLOR_GROUPS.hologram[0].swatch,
  }),
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
  {
    slug: 'sticker-sheet',
    category: 'stickers',
    name: '판스티커',
    english: 'Sticker sheet',
    variants: SHEET_MATERIALS,
  },
  { slug: 'clear-sticker', category: 'stickers', name: '투명 스티커', english: 'Clear sticker' },
  { slug: 'hologram-sticker', category: 'stickers', name: '홀로그램 스티커', english: 'Hologram sticker' },
  {
    slug: 'transfer-sticker',
    category: 'stickers',
    name: '풀 컬러 레터링 스티커',
    english: 'Full-color lettering',
    variants: [SOLID, METALLIC, HOLOGRAM, FULL_COLOR],
  },
  {
    slug: 'vinyl-lettering',
    category: 'stickers',
    name: '글자 커팅 스티커',
    english: 'Vinyl lettering',
    // No full color: that is a transfer-sticker option.
    variants: [SOLID, METALLIC, HOLOGRAM],
  },

  { slug: 'die-cut-roll', category: 'roll-stickers', name: '자유형 롤 스티커', english: 'Die-cut roll' },
  { slug: 'clear-roll', category: 'roll-stickers', name: '투명 롤 스티커', english: 'Clear roll' },
  { slug: 'circle-roll', category: 'roll-stickers', name: '원형 롤 스티커', english: 'Circle roll' },
  { slug: 'square-roll', category: 'roll-stickers', name: '정사각형 롤 스티커', english: 'Square roll' },
  { slug: 'rectangle-roll', category: 'roll-stickers', name: '직사각형 롤 스티커', english: 'Rectangle roll' },
  { slug: 'rounded-roll', category: 'roll-stickers', name: '둥근 사각 롤 스티커', english: 'Rounded-corner roll' },
  { slug: 'oval-roll', category: 'roll-stickers', name: '타원형 롤 스티커', english: 'Oval roll' },
  { slug: 'paper-roll', category: 'roll-stickers', name: '종이 롤 스티커', english: 'Paper roll' },

  {
    slug: 'die-cut-sheet',
    category: 'sheet-stickers',
    name: '자유형 판스티커',
    english: 'Die-cut sheet',
    variants: SHEET_MATERIALS,
  },
  {
    slug: 'circle-sheet',
    category: 'sheet-stickers',
    name: '원형 판스티커',
    english: 'Circle sheet',
    variants: SHEET_MATERIALS,
  },
  {
    slug: 'oval-sheet',
    category: 'sheet-stickers',
    name: '타원형 판스티커',
    english: 'Oval sheet',
    variants: SHEET_MATERIALS,
  },
  {
    slug: 'square-sheet',
    category: 'sheet-stickers',
    name: '정사각형 판스티커',
    english: 'Square sheet',
    variants: SHEET_MATERIALS,
  },
  {
    slug: 'rectangle-sheet',
    category: 'sheet-stickers',
    name: '직사각형 판스티커',
    english: 'Rectangle sheet',
    variants: SHEET_MATERIALS,
  },
  {
    slug: 'rounded-sheet',
    category: 'sheet-stickers',
    name: '둥근 사각 판스티커',
    english: 'Rounded-corner sheet',
    variants: SHEET_MATERIALS,
  },
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

/**
 * Each product's illustration, as production's featured-data names it
 * (`product.image`). Served from the live site rather than copied in, so it
 * always matches what customers see.
 */
const PRODUCT_IMAGES: Record<string, string> = {
  'die-cut-sticker': 'stickers/die-cut',
  'circle-sticker': 'stickers/circle',
  'rectangle-sticker': 'stickers/rectangle',
  'square-sticker': 'stickers/square',
  'oval-sticker': 'stickers/oval',
  'rounded-sticker': 'stickers/rounded',
  'kiss-cut-sticker': 'stickers/kiss-cut',
  'sticker-sheet': 'stickers/sheet',
  'clear-sticker': 'stickers/clear',
  'hologram-sticker': 'stickers/hologram',
  'transfer-sticker': 'stickers/transfer',
  'vinyl-lettering': 'stickers/vinyl-lettering',
  'die-cut-roll': 'roll-stickers/die-cut-labels',
  'clear-roll': 'roll-stickers/clear-labels',
  'circle-roll': 'roll-stickers/circle-labels',
  'square-roll': 'roll-stickers/square-labels',
  'rectangle-roll': 'roll-stickers/rectangle-labels',
  'rounded-roll': 'roll-stickers/rounded-labels',
  'oval-roll': 'roll-stickers/oval-labels',
  'paper-roll': 'roll-stickers/paper-labels',
  'die-cut-sheet': 'sheet-stickers/die-cut-sheet',
  'circle-sheet': 'sheet-stickers/circle-sheet',
  'oval-sheet': 'sheet-stickers/oval-sheet',
  'square-sheet': 'sheet-stickers/square-sheet',
  'rectangle-sheet': 'sheet-stickers/rectangle-sheet',
  'rounded-sheet': 'sheet-stickers/rounded-sheet',
};

export function productImageUrl(product: Product): string | null {
  const path = PRODUCT_IMAGES[product.slug];
  return path ? `https://www.musticker.com/illustrations/products/${path}.svg` : null;
}

/** The product's page on the live site. */
export function productUrl(product: Product): string {
  return `https://www.musticker.com/kr/${product.category}/${product.slug}`;
}
