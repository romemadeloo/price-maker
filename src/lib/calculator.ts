import { D, ROUND_HALF_UP, roundToWon, type Dec } from './decimal';
import { parseBaseArea, parseNumeric } from './parse';
import { renderExactRate, solveRate } from './precision';
import { DEFAULT_ENGINE_OPTIONS, type EngineOptions, type EngineResult } from '../types';

/**
 * In-between calculator (size / quantity interpolation).
 *
 * The generated price-per-mm² table only covers the area_factors and quantities
 * that appear in the price book. Real quotes land between them: 123×123 at qty
 * 123. This module answers those, and — the part that matters — shows its
 * working: which area_factor rows and quantity columns were used, what
 * price-per-mm² came out, and whether that rate rebuilds the quote to the won.
 *
 * `staged` mode reproduces the production quotation endpoint exactly; see the
 * comment on InterpolationMode and the parity tests in calculator.test.ts.
 */

/**
 * How an in-between quote is built.
 *
 * `staged` — what the production pricing service does, in two passes:
 *
 *     1. DIMENSION.  For each bracketing quantity column, interpolate the price
 *        linearly across base_area between the two dimension bounds, then
 *        ROUND IT to the price unit. This is the price for your size at that
 *        quantity, and it is the number the quantity ladder displays.
 *     2. QUANTITY.   Interpolate linearly between those two *rounded* prices,
 *        then round again.
 *
 *    The intermediate rounding is not incidental — it is why the staged answer
 *    differs from a single bilinear blend, typically by one price unit. Doing
 *    both axes at once and rounding once at the end quietly disagrees with the
 *    quantity ladder the customer was just shown, so this is the default.
 *
 * `rate` — blends the price-per-mm² values across both axes at once and
 *    multiplies through. Kept because it answers a different question: what
 *    unit rate does this size and quantity imply? It rounds only at the end.
 */
export type InterpolationMode = 'staged' | 'rate';

export type AxisKind = 'exact' | 'interpolated' | 'below-range' | 'above-range' | 'single';

/** Where the requested value sits relative to the values the table actually has. */
export interface AxisResolution {
  label: 'area_factor' | 'quantity';
  requested: number;
  kind: AxisKind;
  lower: number | null;
  upper: number | null;
  /** Weight given to `upper`, in [0,1], as an exact decimal string. */
  weight: string;
  note: string | null;
}

/** One corner of the bracketing rectangle, and the pull it had on the answer. */
export interface Corner {
  areaFactor: number;
  quantity: number;
  /** The exact rate string from the generated table / CSV. */
  rate: string;
  /**
   * areaFactor × quantity × rate, NOT rounded — the production service
   * interpolates on the raw product, and the fractional part is a useful tell
   * that a stored rate does not quite reproduce its own price.
   */
  price: string;
  /** Product of the two axis weights, as an exact decimal string. */
  weight: string;
}

/** Stage 1: the price for the requested size at one table quantity. */
export interface DimensionStage {
  quantity: number;
  lowerAreaFactor: number;
  upperAreaFactor: number;
  /** lowerAreaFactor × quantity × its rate, unrounded. */
  lowerBoundPrice: string;
  upperBoundPrice: string;
  /** Interpolated across base_area, before the price unit is applied. */
  rawPrice: string;
  /** Rounded to the price unit — what the quantity ladder shows. */
  price: string;
}

/** Stage 2: the quantity interpolation, over the stage-1 prices. */
export interface QuantityStage {
  lowerQuantity: number;
  upperQuantity: number;
  lowerPrice: string;
  upperPrice: string;
  rawPrice: string;
  price: string;
}

/** Won granularity a quoted price is normalized to (production: `normalized_nr`). */
export const PRICE_UNITS = [1, 10, 100] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export interface CalculatorInput {
  width: string;
  height: string;
  baseArea: string;
  quantity: string;
  mode: InterpolationMode;
  /** Round each quoted price to this won unit. 1 leaves it at the exact won. */
  roundTo: PriceUnit;
}

export interface CalculatorResult {
  ok: boolean;
  /** Fatal problems: nothing was calculated. */
  errors: string[];
  /** Non-fatal things the user should still see. */
  warnings: string[];
  /**
   * Reasons a real quotation service would refuse this request outright, even
   * though a number is shown. See `collectOutOfRange`.
   */
  outOfRange: string[];

  /** Base area the calculation actually used, and where it came from. */
  baseArea: number | null;
  baseAreaSource: 'size' | 'entered' | null;
  sizeLabel: string | null;
  /** width × height, when both were given — for the mismatch check. */
  calculatedArea: number | null;
  baseAreaMismatch: boolean;
  quantity: number | null;

  area: AxisResolution | null;
  qty: AxisResolution | null;
  corners: Corner[];
  mode: InterpolationMode;

  /** Stage 1 working — one entry per bracketing quantity. Staged mode only. */
  dimensionStage: DimensionStage[];
  /** Stage 2 working, when the quantity axis interpolated. */
  quantityStage: QuantityStage | null;

  /** The quoted price, as an exact integer string — normalized to `roundTo`. */
  price: string | null;
  /** The same price before the final normalization. */
  rawPrice: string | null;
  roundTo: PriceUnit;
  /** True when the final normalization actually moved the quote. */
  normalized: boolean;
  /** Blended rate before the won rounding — only in `rate` mode. */
  blendedRate: string | null;
  /** price ÷ (baseArea × quantity), at full precision. */
  effectiveRate: string | null;
  /** Shortest string that reproduces `price` exactly — CSV-grade. */
  exportRate: string | null;
  decimalPlaces: number | null;

  /** ROUND(baseArea × quantity × exportRate, 0) — must equal `price`. */
  reconstructed: string | null;
  difference: string | null;
  /** True when exportRate rebuilds price to ₩0 difference. */
  verified: boolean;

  /** Set when both axes hit the table exactly: the price book's own price. */
  tablePrice: string | null;
  matchesTable: boolean | null;

  /** What the other interpolation mode would have quoted, when it differs. */
  alternatePrice: string | null;
}

/* ------------------------------------------------------------------ */
/* The rate grid                                                       */
/* ------------------------------------------------------------------ */

export interface RateGrid {
  /** Ascending, deduped, and restricted to rows/columns that carry a rate. */
  areas: number[];
  quantities: number[];
  rate(area: number, quantity: number): string | null;
}

/**
 * Reshape the engine's generated rates into a sorted, sparse lookup.
 *
 * `rateRows` comes out in sheet order and `quantities` in column order; both are
 * sorted here because bracketing a requested value needs a monotonic axis.
 */
export function buildRateGrid(result: EngineResult): RateGrid {
  const firstColumnFor = new Map<number, number>();
  result.quantities.forEach((q, i) => {
    if (!firstColumnFor.has(q)) firstColumnFor.set(q, i);
  });

  const cells = new Map<string, string>();
  for (const row of result.rateRows) {
    for (const [quantity, col] of firstColumnFor) {
      const rate = row.rates[col];
      if (rate != null) cells.set(`${row.areaFactor}|${quantity}`, rate);
    }
  }

  // Drop entirely blank rows/columns: they cannot contribute a corner, and
  // leaving them in would let the bracket land on a hole.
  const allQuantities = [...firstColumnFor.keys()];
  const areas = [...new Set(result.rateRows.map((r) => r.areaFactor))]
    .filter((a) => allQuantities.some((q) => cells.has(`${a}|${q}`)))
    .sort((a, b) => a - b);
  const quantities = allQuantities
    .filter((q) => areas.some((a) => cells.has(`${a}|${q}`)))
    .sort((a, b) => a - b);

  return {
    areas,
    quantities,
    rate: (area, quantity) => cells.get(`${area}|${quantity}`) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Price normalization                                                 */
/* ------------------------------------------------------------------ */

/**
 * The coarsest won unit that divides every expected price in the book.
 *
 * Price books are quoted on a round unit — production sends it as
 * `normalized_nr` — and an interpolated quote that ignores it looks wrong next
 * to the table it came from. Reading the unit off the user's own data beats
 * asking them to remember it. Falls back to ₩1 when there is nothing to infer
 * from, or when the prices genuinely are exact-won.
 */
export function detectPriceUnit(result: EngineResult): PriceUnit {
  let seen = false;
  let unit: PriceUnit = 100;

  for (const cell of result.cells) {
    const price = cell.expectedPrice;
    if (price == null) continue;
    seen = true;
    while (unit > 1 && price % unit !== 0) {
      unit = unit === 100 ? 10 : 1;
    }
    if (unit === 1) return 1;
  }

  return seen ? unit : 1;
}

/**
 * Round to the nearest multiple of `unit`, half-up — the house pricing rule.
 *
 * A ₩1 unit still rounds: it means "the exact won", not "leave the fraction on".
 * Every stage of a staged quote passes through here, so skipping the rounding
 * would carry sub-won dust from one stage into the next and end on a price no
 * rate can reproduce.
 */
function normalizeTo(price: Dec, unit: PriceUnit): Dec {
  if (unit <= 1) return roundToWon(price);
  return price.div(unit).toDecimalPlaces(0, ROUND_HALF_UP).times(unit);
}

/* ------------------------------------------------------------------ */
/* Axis resolution                                                     */
/* ------------------------------------------------------------------ */

/**
 * Locate `requested` on an ascending axis of table values.
 *
 * Exactly on a value is a plain lookup. Between two is an interpolation with a
 * weight. Outside the range — or on an axis with a single value — the nearest
 * edge is held, and the caller applies that edge's *rate* to the requested
 * value so the answer still scales.
 */
function bracket(label: AxisResolution['label'], values: number[], requested: number): AxisResolution {
  const name = label === 'area_factor' ? 'area_factor' : 'quantity';
  const base = { label, requested, weight: '0', note: null as string | null };

  const first = values[0];
  const last = values[values.length - 1];

  if (values.length === 1) {
    if (first === requested) return { ...base, kind: 'exact', lower: first, upper: first };
    return {
      ...base,
      kind: 'single',
      lower: first,
      upper: first,
      note: `The table has only one ${name} (${first.toLocaleString()}); its rate is applied to your value directly.`,
    };
  }

  if (requested <= first) {
    if (requested === first) return { ...base, kind: 'exact', lower: first, upper: first };
    return {
      ...base,
      kind: 'below-range',
      lower: first,
      upper: first,
      note: `Below the smallest ${name} in the table (${first.toLocaleString()}); its rate is held and applied to your value.`,
    };
  }
  if (requested >= last) {
    if (requested === last) return { ...base, kind: 'exact', lower: last, upper: last };
    return {
      ...base,
      kind: 'above-range',
      lower: last,
      upper: last,
      note: `Above the largest ${name} in the table (${last.toLocaleString()}); its rate is held and applied to your value.`,
    };
  }

  for (let i = 0; i < values.length - 1; i++) {
    const lo = values[i];
    const hi = values[i + 1];
    if (requested === lo) return { ...base, kind: 'exact', lower: lo, upper: lo };
    if (requested > lo && requested < hi) {
      const t = new D(requested).minus(lo).div(new D(hi).minus(lo));
      return {
        ...base,
        kind: 'interpolated',
        lower: lo,
        upper: hi,
        weight: renderExactRate(t),
        note: `Between ${name} ${lo.toLocaleString()} and ${hi.toLocaleString()}.`,
      };
    }
  }

  // requested === last is handled above, so this is the only case left.
  return { ...base, kind: 'exact', lower: last, upper: last };
}

interface AxisPoint {
  value: number;
  weight: Dec;
}

/** The one or two table values this axis draws from, with their weights. */
function axisPoints(res: AxisResolution): AxisPoint[] {
  if (res.kind === 'interpolated' && res.lower != null && res.upper != null) {
    const t = new D(res.requested).minus(res.lower).div(new D(res.upper).minus(res.lower));
    return [
      { value: res.lower, weight: new D(1).minus(t) },
      { value: res.upper, weight: t },
    ];
  }
  return [{ value: res.lower as number, weight: new D(1) }];
}

/** True when the axis had to hold an edge rate rather than sit inside the table. */
function isHeld(kind: AxisKind): boolean {
  return kind === 'below-range' || kind === 'above-range' || kind === 'single';
}

/**
 * Which held axes a real quotation service would refuse rather than extrapolate.
 *
 * Verified against the production endpoint, which is deliberately asymmetric:
 *
 *   size  BELOW the smallest area_factor  → refused, "No base dimension data
 *         found!" — there is no lower bound whose rate could be held.
 *   size  ABOVE the largest              → quoted. It pins a bound at the
 *         requested area and holds the largest row's rate, which is exactly
 *         what this calculator does, so it is not flagged.
 *   qty   outside the columns either way → refused, "Process requires quantity
 *         of (N) but the bound contains 1".
 *
 * We still show a number — the point of the tool is to explore the book — but a
 * quote that could never be sold has to say so rather than look ordinary.
 */
function collectOutOfRange(
  areaRes: AxisResolution,
  qtyRes: AxisResolution,
  baseArea: number,
  quantity: number,
): string[] {
  const out: string[] = [];
  const areaFloor = areaRes.lower as number;
  const qtyFloor = qtyRes.lower as number;

  if (areaRes.kind === 'below-range' || (areaRes.kind === 'single' && baseArea < areaFloor)) {
    out.push(
      `Base area ${baseArea.toLocaleString()} mm² is below the smallest area_factor in the book ` +
        `(${areaFloor.toLocaleString()}). A quotation service has no lower bound to price from here and ` +
        `would refuse the request.`,
    );
  }

  if (qtyRes.kind !== 'exact' && qtyRes.kind !== 'interpolated') {
    const columns = qtyRes.kind === 'above-range' ? 'largest' : 'smallest';
    out.push(
      `Quantity ${quantity.toLocaleString()} is outside the book's quantity columns ` +
        `(${columns} is ${qtyFloor.toLocaleString()}). A quotation service would refuse the request rather ` +
        `than extrapolate the volume curve.`,
    );
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* The calculation                                                     */
/* ------------------------------------------------------------------ */

function unanswered(input: CalculatorInput, errors: string[], warnings: string[] = []): CalculatorResult {
  return {
    ok: false,
    errors,
    warnings,
    outOfRange: [],
    baseArea: null,
    baseAreaSource: null,
    sizeLabel: null,
    calculatedArea: null,
    baseAreaMismatch: false,
    quantity: null,
    area: null,
    qty: null,
    corners: [],
    mode: input.mode,
    dimensionStage: [],
    quantityStage: null,
    price: null,
    rawPrice: null,
    roundTo: input.roundTo,
    normalized: false,
    blendedRate: null,
    effectiveRate: null,
    exportRate: null,
    decimalPlaces: null,
    reconstructed: null,
    difference: null,
    verified: false,
    tablePrice: null,
    matchesTable: null,
    alternatePrice: null,
  };
}

export function calculate(
  input: CalculatorInput,
  result: EngineResult,
  options: EngineOptions = DEFAULT_ENGINE_OPTIONS,
): CalculatorResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const mode = input.mode;
  const unit = input.roundTo;

  /* ---- what are we pricing? -------------------------------------- */

  const width = parseDimension(input.width, 'Width', errors);
  const height = parseDimension(input.height, 'Height', errors);
  if ((width == null) !== (height == null) && errors.length === 0) {
    errors.push('Enter both a width and a height.');
  }

  // Exact multiply so decimal dimensions do not pick up float dust.
  const calculatedArea = width != null && height != null ? new D(width).times(height).toNumber() : null;

  const entered = input.baseArea.trim() !== '' ? parseBaseArea(input.baseArea) : null;
  if (entered?.error) errors.push(entered.error);
  if (calculatedArea == null && entered == null) {
    errors.push('Enter a width and height, or a base area.');
  }

  // The user's own base area wins over width × height, exactly as it does in the
  // sheet (spec §4): a disagreement is reported, never silently corrected.
  const baseArea = entered?.value ?? calculatedArea;
  const baseAreaSource: CalculatorResult['baseAreaSource'] =
    entered?.value != null ? 'entered' : calculatedArea != null ? 'size' : null;

  const baseAreaMismatch =
    entered?.value != null &&
    calculatedArea != null &&
    !new D(entered.value).equals(new D(calculatedArea));

  if (baseAreaMismatch) {
    warnings.push(
      `Base area ${(entered?.value as number).toLocaleString()} does not equal width × height ` +
        `(${(calculatedArea as number).toLocaleString()}). The entered base area is used.`,
    );
  }

  const qtyParse = parseNumeric(input.quantity);
  let quantity: number | null = null;
  if (qtyParse.blank) errors.push('Enter a quantity.');
  else if (qtyParse.error) errors.push(qtyParse.error);
  else if ((qtyParse.value as number) <= 0) errors.push('Quantity must be greater than 0.');
  else {
    quantity = qtyParse.value as number;
    if (!Number.isInteger(quantity)) {
      warnings.push(`Quantity ${quantity} is not a whole number — the table's quantities all are.`);
    }
  }

  const grid = buildRateGrid(result);
  if (grid.areas.length === 0 || grid.quantities.length === 0) {
    errors.push('No price-per-mm² table to price against yet — fill in the Price Table tab first.');
  }

  if (errors.length > 0 || baseArea == null || quantity == null) {
    return unanswered(input, errors, warnings);
  }

  /* ---- which rows and columns does it fall between? --------------- */

  const qtyRes = bracket('quantity', grid.quantities, quantity);
  const qtyPts = axisPoints(qtyRes);

  // Only area rows carrying a rate at *every* quantity we draw from can give a
  // complete rectangle; bracketing over the others would reach across a hole.
  const usableAreas = grid.areas.filter((a) => qtyPts.every((p) => grid.rate(a, p.value) != null));
  if (usableAreas.length === 0) {
    const cols = qtyPts.map((p) => p.value.toLocaleString()).join(' and ');
    return unanswered(input, [`No area_factor row has a rate at quantity ${cols}.`], warnings);
  }
  if (usableAreas.length < grid.areas.length) {
    const skipped = grid.areas.length - usableAreas.length;
    warnings.push(`${skipped} area_factor row(s) skipped: no rate at every quantity this calculation uses.`);
  }

  const areaRes = bracket('area_factor', usableAreas, baseArea);
  const areaPts = axisPoints(areaRes);

  const areaDec = new D(baseArea);
  const qtyDec = new D(quantity);

  const corners: Corner[] = [];
  for (const a of areaPts) {
    for (const q of qtyPts) {
      const rate = grid.rate(a.value, q.value) as string;
      corners.push({
        areaFactor: a.value,
        quantity: q.value,
        rate,
        price: new D(a.value).times(q.value).times(rate).toFixed(),
        weight: renderExactRate(a.weight.times(q.weight)),
      });
    }
  }

  /* ---- build the quote ------------------------------------------- */

  const ctx: BuildContext = { grid, areaRes, areaPts, qtyRes, qtyPts, areaDec, qtyDec, unit };
  const staged = buildStaged(ctx);
  const blended = buildBlendedRate(ctx, corners);

  const chosen = mode === 'staged' ? staged : blended;
  const other = mode === 'staged' ? blended : staged;
  const price = chosen.price;

  /* ---- what price-per-mm² does that imply, and does it hold up? ---- */

  // The same solver the CSV export uses, so the rate reported here is a string a
  // downstream consumer could drop into the rate table and get this price back.
  const solution = solveRate(
    baseArea,
    quantity,
    price,
    options.minDecimalPlaces,
    options.maxDecimalPlaces,
    options.stripTrailingZeros,
  );

  if (!solution.ok) {
    warnings.push(
      `No rate within ${options.maxDecimalPlaces} decimal places reproduces ₩${price.toFixed()} exactly ` +
        `(off by ${solution.difference.toFixed()}).`,
    );
  }

  if (isHeld(areaRes.kind)) warnings.push(areaRes.note as string);
  if (isHeld(qtyRes.kind)) warnings.push(qtyRes.note as string);

  const outOfRange = collectOutOfRange(areaRes, qtyRes, baseArea, quantity);

  const bothExact = areaRes.kind === 'exact' && qtyRes.kind === 'exact';
  const tablePrice = bothExact ? roundToWon(new D(corners[0].price)).toFixed() : null;

  if (tablePrice != null && tablePrice !== price.toFixed()) {
    warnings.push(
      `This size and quantity is a row in the price book at ₩${tablePrice}, but that is not a multiple of ` +
        `₩${unit}; normalizing moves it to ₩${price.toFixed()}.`,
    );
  }

  return {
    ok: true,
    errors,
    warnings,
    outOfRange,
    baseArea,
    baseAreaSource,
    sizeLabel: width != null && height != null ? `${width}×${height}` : null,
    calculatedArea,
    baseAreaMismatch,
    quantity,
    area: areaRes,
    qty: qtyRes,
    corners,
    mode,
    dimensionStage: mode === 'staged' ? staged.dimensionStage : [],
    quantityStage: mode === 'staged' ? staged.quantityStage : null,
    price: price.toFixed(),
    rawPrice: chosen.rawPrice.toFixed(),
    roundTo: unit,
    normalized: !price.equals(chosen.rawPrice),
    blendedRate: mode === 'rate' ? blended.blendedRate : null,
    effectiveRate: renderExactRate(price.div(areaDec.times(qtyDec))),
    exportRate: solution.exportRate,
    decimalPlaces: solution.decimalPlaces,
    reconstructed: solution.reconstructed.toFixed(),
    difference: solution.difference.toFixed(),
    verified: solution.difference.isZero(),
    tablePrice,
    matchesTable: tablePrice == null ? null : tablePrice === price.toFixed(),
    alternatePrice: other.price.equals(price) ? null : other.price.toFixed(),
  };
}

/* ------------------------------------------------------------------ */
/* The two build strategies                                            */
/* ------------------------------------------------------------------ */

interface BuildContext {
  grid: RateGrid;
  areaRes: AxisResolution;
  areaPts: AxisPoint[];
  qtyRes: AxisResolution;
  qtyPts: AxisPoint[];
  areaDec: Dec;
  qtyDec: Dec;
  unit: PriceUnit;
}

interface Quote {
  rawPrice: Dec;
  price: Dec;
  blendedRate: string | null;
  dimensionStage: DimensionStage[];
  quantityStage: QuantityStage | null;
}

/**
 * The production algorithm: collapse the dimension axis first, round to the
 * price unit, then collapse the quantity axis over those rounded prices and
 * round again.
 *
 * The stage-1 rounding is load-bearing. It is what makes the quote agree with
 * the quantity ladder the customer is shown, and it is worth roughly one price
 * unit against a single blend of the same four corners.
 */
function buildStaged(ctx: BuildContext): Quote {
  const { grid, areaRes, areaPts, qtyRes, qtyPts, areaDec, qtyDec, unit } = ctx;

  // ---- stage 1: price for the requested size, at each bracketing quantity.
  const dimensionStage: DimensionStage[] = qtyPts.map((q) => {
    const boundPrice = (a: number) => new D(a).times(q.value).times(grid.rate(a, q.value) as string);

    let raw: Dec;
    let lower: Dec;
    let upper: Dec;

    if (areaRes.kind === 'interpolated') {
      const lo = areaPts[0].value;
      const hi = areaPts[1].value;
      lower = boundPrice(lo);
      upper = boundPrice(hi);
      // lower + (base_area - lower_area) × (upper - lower) / (upper_area - lower_area)
      const boundDiff = upper.minus(lower).div(new D(hi).minus(lo));
      raw = lower.plus(areaDec.minus(lo).times(boundDiff));
    } else {
      // Exact, or held at an edge: apply that row's rate to the requested area.
      const a = areaPts[0].value;
      lower = boundPrice(a);
      upper = lower;
      raw = areaDec.times(q.value).times(grid.rate(a, q.value) as string);
    }

    return {
      quantity: q.value,
      lowerAreaFactor: areaPts[0].value,
      upperAreaFactor: areaPts[areaPts.length - 1].value,
      lowerBoundPrice: lower.toFixed(),
      upperBoundPrice: upper.toFixed(),
      rawPrice: raw.toFixed(),
      price: normalizeTo(raw, unit).toFixed(),
    };
  });

  // ---- stage 2: collapse the quantity axis over the stage-1 prices.
  let rawPrice: Dec;
  let quantityStage: QuantityStage | null = null;

  if (qtyRes.kind === 'interpolated') {
    const loQty = qtyPts[0].value;
    const hiQty = qtyPts[1].value;
    const loPrice = new D(dimensionStage[0].price);
    const hiPrice = new D(dimensionStage[1].price);
    const boundDiff = hiPrice.minus(loPrice).div(new D(hiQty).minus(loQty));
    rawPrice = loPrice.plus(qtyDec.minus(loQty).times(boundDiff));

    quantityStage = {
      lowerQuantity: loQty,
      upperQuantity: hiQty,
      lowerPrice: loPrice.toFixed(),
      upperPrice: hiPrice.toFixed(),
      rawPrice: rawPrice.toFixed(),
      price: normalizeTo(rawPrice, unit).toFixed(),
    };
  } else {
    // Exact, or held at an edge: scale the stage-1 price by requested ÷ column,
    // which is the same as holding that column's rate.
    const only = dimensionStage[0];
    rawPrice = new D(only.price).times(qtyDec).div(only.quantity);
  }

  return { rawPrice, price: normalizeTo(rawPrice, unit), blendedRate: null, dimensionStage, quantityStage };
}

/**
 * Blend the price-per-mm² across both axes at once, then multiply through and
 * round once. Answers "what unit rate does this size and quantity imply?".
 */
function buildBlendedRate(ctx: BuildContext, corners: Corner[]): Quote {
  const { areaPts, qtyPts, areaDec, qtyDec, unit } = ctx;

  let rate = new D(0);
  let i = 0;
  for (const a of areaPts) {
    for (const q of qtyPts) {
      rate = rate.plus(a.weight.times(q.weight).times(corners[i].rate));
      i++;
    }
  }

  const rawPrice = roundToWon(areaDec.times(qtyDec).times(rate));
  return {
    rawPrice,
    price: normalizeTo(rawPrice, unit),
    blendedRate: renderExactRate(rate),
    dimensionStage: [],
    quantityStage: null,
  };
}

/** A width or height: a positive number of millimetres, or nothing at all. */
function parseDimension(raw: string, label: string, errors: string[]): number | null {
  if (raw.trim() === '') return null;
  const n = parseNumeric(raw);
  if (n.error) {
    errors.push(`${label}: ${n.error}`);
    return null;
  }
  if ((n.value as number) <= 0) {
    errors.push(`${label} must be greater than 0.`);
    return null;
  }
  return n.value as number;
}
