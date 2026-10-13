import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FullscreenButton, useFullscreen } from '../hooks/useFullscreen';
import type { EngineOptions, EngineResult } from '../types';
import { productUrl, type PriceList, type ProductOption, type Variant } from '../lib/products';
import Swatches from './Swatches';
import { DIFF, HEAT, HEAT_LEGEND, heatStep } from '../lib/compareColors';
import {
  compareDraft,
  comparisonToCsv,
  draftSizes,
  fetchProductionQuote,
  type CompareCell,
  type CompareRow,
  adjustPrice,
  STUDIO_ADJUSTMENT,
  STUDIO_PARAMS,
  type PriceAdjustment,
  type ProductionQuote,
  type ProductionSnapshot,
  type QuoteEntry,
} from '../lib/production';
import { calculate, detectPriceUnit, PRICE_UNITS, type PriceUnit } from '../lib/calculator';
import { downloadCsv } from '../lib/csv';
import { groupDigits } from '../lib/decimal';
import { parseSize } from '../lib/parse';
import { signedPct, signedWon, timeAgo, won } from '../lib/format';
import { FIRST_PRICE_COL } from '../state/sheetReducer';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, DownloadIcon, ExternalIcon, RefreshIcon } from './icons';

interface Props {
  /**
   * `production` compares against normal prices; `studio` against the Studio
   * Editor's — production's price × 0.95, rounded to ₩10 — with the same
   * discount applied to the draft.
   */
  mode?: 'production' | 'studio';
  /** The product, or one color group of it. */
  priceList: PriceList;
  result: EngineResult;
  options: EngineOptions;
  snapshot: ProductionSnapshot | null;
  onSnapshot: (snapshot: ProductionSnapshot) => void;
  /** Won unit drafted prices are rounded to before comparing; 1 = exact. */
  rounding: PriceUnit;
  onRounding: (unit: PriceUnit) => void;
  onGoToCell: (rowIndex: number, gridColIndex: number) => void;
}

type View = 'matrix' | 'list';
type Filter = 'all' | 'changed' | 'higher' | 'lower';
type Measure = 'won' | 'pct' | 'draft' | 'prod';

/** Parallel requests to production. Polite, and still quick for a few hundred sizes. */
const CONCURRENCY = 4;
const MAX_MATRIX_ROWS = 300;
const MAX_LIST_ROWS = 500;

export default function ProductionCompare({
  mode = 'production',
  priceList,
  result,
  options,
  snapshot,
  onSnapshot,
  rounding,
  onRounding,
  onGoToCell,
}: Props) {
  const { product, variant } = priceList;
  const studio = mode === 'studio';
  /** Everything sent with each quote: the variant's options, plus the Studio Editor flag. */
  const params = useMemo(
    () => ({ ...(variant?.params ?? {}), ...(studio ? STUDIO_PARAMS : {}) }),
    [variant, studio],
  );
  const [view, setView] = useState<View>('matrix');
  const [filter, setFilter] = useState<Filter>('all');
  // ₩ first: the size of a gap in won is what gets acted on.
  const [measure, setMeasure] = useState<Measure>('won');
  const fullscreen = useFullscreen<HTMLElement>();

  const sizes = useMemo(() => draftSizes(result.parsed), [result.parsed]);
  const comparison = useMemo(
    () => compareDraft(result.parsed, snapshot, { roundTo: rounding, adjust: studio ? STUDIO_ADJUSTMENT : null }),
    [result.parsed, snapshot, rounding, studio],
  );
  const missing = useMemo(() => sizes.filter((s) => !snapshot?.quotes[s.key]), [sizes, snapshot]);
  const { fetchSizes, progress, cancel } = useProductionFetch(product.slug, params, snapshot, onSnapshot);

  const s = comparison.summary;
  const busy = progress != null;

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      comparisonToCsv(comparison),
      `${priceList.key.replace('~', '-')}-vs-${studio ? 'studio-editor' : 'production'}-${stamp}.csv`,
    );
  };

  const [spotOpen, setSpotOpen] = useState(false);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pb-2">
      {/* ------------------------------------------------ source, rounding, actions — one compact card */}
      <section className="card px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="mr-1 text-sm font-bold text-slate-900">{studio ? 'Draft vs Studio Editor' : 'Draft vs production'}</span>
            {studio && (
              <Chip tone="violet">
                {comparison.adjustment
                  ? `−${Math.round((1 - comparison.adjustment.rate) * 100)}% · rounds to ₩${groupDigits(comparison.adjustment.normalizedBy)}`
                  : '−5% · rounds to ₩10'}
              </Chip>
            )}
            {comparison.pricingName ? (
              <Chip tone="brand">
                {comparison.pricingName}
                {comparison.pricingId != null && <span className="opacity-60">#{comparison.pricingId}</span>}
              </Chip>
            ) : (
              <span>live prices from musticker.com{studio ? ' (Studio Editor)' : ''}, per drafted size</span>
            )}
            {comparison.normalizedNr != null && !studio && <Chip>rounds to ₩{groupDigits(comparison.normalizedNr)}</Chip>}
            {comparison.sheet && (
              <Chip tone="amber">
                per {comparison.sheet.name} sheet ({comparison.sheet.width}×{comparison.sheet.height})
              </Chip>
            )}
            {snapshot && <span className="text-slate-400">· fetched {timeAgo(snapshot.fetchedAt)}</span>}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {snapshot && (
              <button
                className={`btn ${spotOpen ? 'btn-primary' : 'btn-default'}`}
                onClick={() => setSpotOpen((o) => !o)}
                aria-pressed={spotOpen}
              >
                Spot check
              </button>
            )}
            <a className="btn btn-ghost" href={productUrl(product)} target="_blank" rel="noreferrer" title="Open the live product page">
              <ExternalIcon width={14} height={14} />
            </a>
            {snapshot && (
              <button className="btn btn-default" onClick={exportCsv} disabled={s.compared === 0} title="Download the comparison as CSV">
                <DownloadIcon width={14} height={14} />
                Export
              </button>
            )}
            {snapshot && missing.length > 0 && !busy && (
              <button className="btn btn-default" onClick={() => fetchSizes(missing, 'merge')}>
                Fetch {missing.length.toLocaleString()} new
              </button>
            )}
            {busy ? (
              <button className="btn btn-default" onClick={cancel}>
                Cancel
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => fetchSizes(sizes, 'replace')} disabled={sizes.length === 0}>
                <RefreshIcon width={14} height={14} />
                {snapshot ? 'Refresh' : studio ? 'Fetch Studio Editor prices' : 'Fetch production prices'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-2.5">
          <RoundingControl
            rounding={rounding}
            onRounding={onRounding}
            // Studio prices are discounted from the normal (₩100) prices, so that is the unit to match.
            productionUnit={studio ? 100 : comparison.normalizedNr}
            rounded={s.rounded}
            label={studio ? 'Round my prices, then −5%' : 'Round my prices'}
          />
          {variant && (
            <OptionCheck slug={product.slug} variant={variant} size={sizes[0] ?? DEFAULT_CHECK_SIZE} extraParams={studio ? STUDIO_PARAMS : undefined} />
          )}
          {studio && (
            <span className="text-xs text-slate-400">
              Studio price = price × {comparison.adjustment?.rate ?? STUDIO_ADJUSTMENT.rate}, rounded to ₩
              {comparison.adjustment?.normalizedBy ?? STUDIO_ADJUSTMENT.normalizedBy} — applied to your draft the same way
            </span>
          )}
        </div>

        {busy && (
          <div className="mt-2.5">
            <div className="h-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width]"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Quoting {progress.done.toLocaleString()} of {progress.total.toLocaleString()} size(s)…
            </div>
          </div>
        )}
      </section>

      {s.rows === 0 ? (
        <EmptyState
          title="Nothing drafted yet"
          body="Enter or paste this price list's prices in the Price Table tab. Each row's base area is what gets quoted against production."
        />
      ) : !snapshot ? (
        <EmptyState
          title={`Compare ${sizes.length.toLocaleString()} size${sizes.length === 1 ? '' : 's'} against ${studio ? 'the Studio Editor' : 'production'}`}
          body={
            studio
              ? 'Each drafted size is quoted live from the Studio Editor (production’s price −5%, rounded to ₩10). Your draft gets the same discount, then the two are lined up price by price.'
              : 'Each drafted size is quoted live from musticker.com and lined up against your draft, price by price. Results are stored with this price list’s draft.'
          }
          action={
            sizes.length > 0 && !busy ? (
              <button className="btn btn-primary" onClick={() => fetchSizes(sizes, 'replace')}>
                <RefreshIcon width={14} height={14} />
                {studio ? 'Fetch Studio Editor prices' : 'Fetch production prices'}
              </button>
            ) : null
          }
        />
      ) : (
        <>
          <StatsStrip comparison={comparison} against={studio ? 'Studio Editor' : 'production'} />
          {spotOpen && (
            <SpotCheck
              priceList={priceList}
              result={result}
              options={options}
              rounding={rounding}
              params={params}
              adjustment={studio ? (comparison.adjustment ?? STUDIO_ADJUSTMENT) : null}
            />
          )}

          <section ref={fullscreen.ref} style={fullscreen.panelStyle} className={`card flex min-h-[440px] flex-1 flex-col overflow-hidden ${fullscreen.panelClass}`}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <div className="pills">
                <button aria-pressed={view === 'matrix'} onClick={() => setView('matrix')}>
                  Heatmap
                </button>
                <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
                  Differences
                </button>
              </div>
              <Seg
                value={filter}
                onChange={setFilter}
                options={[['all', 'All'], ['changed', 'Changed'], ['higher', 'Higher'], ['lower', 'Lower']]}
              />
              {view === 'matrix' && (
                <Seg
                  value={measure}
                  onChange={setMeasure}
                  options={[['won', 'Δ ₩'], ['pct', 'Δ %'], ['draft', 'Draft'], ['prod', 'Production']]}
                />
              )}
              <HeatLegend />
              <FullscreenButton modal={fullscreen} className="ml-auto lg:ml-2" />
            </div>
            <div className="min-h-0 flex-1 overflow-auto border-t border-slate-100">
              {view === 'matrix' ? (
                <Matrix comparison={comparison} filter={filter} measure={measure} onGoToCell={onGoToCell} />
              ) : (
                <DiffList comparison={comparison} filter={filter} onGoToCell={onGoToCell} />
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

function useProductionFetch(
  slug: string,
  params: Record<string, string> | undefined,
  snapshot: ProductionSnapshot | null,
  onSnapshot: (s: ProductionSnapshot) => void,
) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const fetchSizes = useCallback(
    async (sizes: { width: number; height: number; key: string }[], mode: 'replace' | 'merge') => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;

      const quotes: Record<string, QuoteEntry> = {};
      let next = 0;
      let done = 0;
      setProgress({ done, total: sizes.length });

      const worker = async () => {
        while (next < sizes.length && !ctrl.signal.aborted) {
          const size = sizes[next++];
          try {
            const quote = await fetchProductionQuote(slug, size.width, size.height, { signal: ctrl.signal, params });
            quotes[size.key] = { ok: true, quote };
          } catch (err) {
            if (ctrl.signal.aborted) return;
            quotes[size.key] = { ok: false, error: (err as Error).message };
          }
          done += 1;
          setProgress({ done, total: sizes.length });
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sizes.length) }, worker));
      if (ctrl.signal.aborted) return;

      onSnapshot(
        mode === 'merge' && snapshot
          ? { fetchedAt: snapshot.fetchedAt, quotes: { ...snapshot.quotes, ...quotes } }
          : { fetchedAt: new Date().toISOString(), quotes },
      );
      setProgress(null);
    },
    [slug, params, snapshot, onSnapshot],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
    setProgress(null);
  }, []);

  return { fetchSizes, progress, cancel };
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

/**
 * The headline numbers in one compact strip, the match/higher/lower split as a
 * diverging bar under them, and anything worth knowing as small notes.
 */
function StatsStrip({ comparison, against }: { comparison: ReturnType<typeof compareDraft>; against: string }) {
  const s = comparison.summary;
  const share = (n: number) => (s.compared === 0 ? '0%' : `${((n / s.compared) * 100).toFixed(0)}%`);
  const largest = s.largest;
  const largestRow = largest ? comparison.rows.find((r) => r.rowIndex === largest.rowIndex) : null;

  const segs = [
    { n: s.lower, color: DIFF.lower },
    { n: s.same, color: DIFF.match },
    { n: s.higher, color: DIFF.higher },
  ].filter((x) => x.n > 0);

  return (
    <section className="card px-5 py-3">
      <div className="grid grid-cols-2 gap-y-3 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x lg:divide-slate-100">
        <Stat label="Compared" value={s.compared.toLocaleString()} sub={`${s.rows.toLocaleString()} rows`} />
        <Stat
          label="Match"
          value={s.same.toLocaleString()}
          sub={share(s.same)}
          icon={<CheckIcon width={12} height={12} style={{ color: DIFF.match }} />}
        />
        <Stat
          label="Draft higher"
          value={s.higher.toLocaleString()}
          sub={share(s.higher)}
          icon={<ArrowUpIcon width={12} height={12} style={{ color: DIFF.higher }} />}
        />
        <Stat
          label="Draft lower"
          value={s.lower.toLocaleString()}
          sub={share(s.lower)}
          icon={<ArrowDownIcon width={12} height={12} style={{ color: DIFF.lower }} />}
        />
        <Stat label="Average Δ" value={signedPct(s.avgDiffPct)} sub={`draft vs ${against}`} />
        <Stat
          label="Largest gap"
          value={largest ? signedPct(largest.diffPct) : '—'}
          sub={
            largest && largestRow
              ? `${largestRow.sizeLabel} · qty ${groupDigits(largest.quantity ?? 0)} · ${signedWon(largest.diff ?? 0)}`
              : 'no differences'
          }
        />
      </div>

      {s.compared > 0 && (
        <div className="mt-3 flex h-1.5 gap-[2px]">
          {segs.map((x, i) => (
            <span
              key={i}
              className={`${i === 0 ? 'rounded-l-full' : ''} ${i === segs.length - 1 ? 'rounded-r-full' : ''}`}
              style={{ flexGrow: x.n, flexBasis: 0, background: x.color }}
            />
          ))}
        </div>
      )}

      <Notes comparison={comparison} />
    </section>
  );
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0 px-3 first:pl-0">
      <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
        {icon}
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums tracking-tight text-slate-900">{value}</div>
      {sub && (
        <div className="truncate text-[11px] text-slate-400" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** Small notes under the stats: refused sizes, unfetched rows, quantities only one side has. */
function Notes({ comparison }: { comparison: ReturnType<typeof compareDraft> }) {
  const s = comparison.summary;
  const notes: { warn?: boolean; text: string; title?: string }[] = [];

  if (s.rowsFailed > 0) {
    const first = comparison.rows.find((r) => r.state === 'error');
    notes.push({ warn: true, text: `${s.rowsFailed} size(s) refused by production`, title: first ? `${first.sizeLabel}: ${first.error}` : undefined });
  }
  if (s.rowsNotFetched > 0) notes.push({ text: `${s.rowsNotFetched} row(s) not fetched yet` });
  if (s.rowsWithoutSize > 0) notes.push({ text: `${s.rowsWithoutSize} row(s) without a usable base area` });
  if (s.notInProduction > 0) notes.push({ text: `${s.notInProduction} price(s) at quantities production doesn't sell` });
  if (comparison.productionOnlyQuantities.length > 0) {
    notes.push({
      text: `production also sells ${comparison.productionOnlyQuantities.length} quantit${comparison.productionOnlyQuantities.length === 1 ? 'y' : 'ies'} you haven't drafted`,
      title: comparison.productionOnlyQuantities.map((q) => groupDigits(q)).join(', '),
    });
  }
  if (notes.length === 0) return null;

  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {notes.map((n, i) => (
        <span
          key={i}
          title={n.title}
          className={`rounded-md px-2 py-0.5 text-[11px] ${n.warn ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-500'}`}
        >
          {n.warn ? '! ' : ''}
          {n.text}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The options a variant's price list stands for                       */
/* ------------------------------------------------------------------ */

const DEFAULT_CHECK_SIZE = { width: 100, height: 100 };

type OptionQuote = { option: ProductOption; quote: ProductionQuote | null; error: string | null };

/** Same price book and the same prices at every quantity. */
function samePricing(a: ProductionQuote, b: ProductionQuote): boolean {
  if (a.pricingId !== b.pricingId || a.prices.length !== b.prices.length) return false;
  return a.prices.every((p, i) => p.quantity === b.prices[i].quantity && p.price === b.prices[i].price);
}

/**
 * A variant's price list stands for one or more production options (colors, or
 * a material). Quote each at one size and confirm they really share a price
 * book — if production ever splits a group, this says so instead of the
 * comparison quietly covering only the first option.
 */
function OptionCheck({
  slug,
  variant,
  size,
  extraParams,
}: {
  slug: string;
  variant: Variant;
  size: { width: number; height: number };
  extraParams?: Record<string, string>;
}) {
  const [rows, setRows] = useState<OptionQuote[] | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setRows(null);
    void Promise.all(
      variant.options.map(async (option): Promise<OptionQuote> => {
        try {
          const quote = await fetchProductionQuote(slug, size.width, size.height, {
            signal: ctrl.signal,
            params: { ...variant.params, ...(extraParams ?? {}), [variant.param]: String(option.id) },
          });
          return { option, quote, error: null };
        } catch (err) {
          return { option, quote: null, error: (err as Error).message };
        }
      }),
    ).then((result) => {
      if (!ctrl.signal.aborted) setRows(result);
    });
    return () => ctrl.abort();
  }, [slug, variant, size.width, size.height, nonce, extraParams]);

  const reference = rows?.find((r) => r.quote)?.quote ?? null;
  const referenceOption = rows?.find((r) => r.quote === reference)?.option.name;
  const odd = rows?.filter((r) => !r.quote || (reference && !samePricing(r.quote, reference))) ?? [];
  const quantities = reference?.prices.map((p) => p.quantity) ?? [];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium text-slate-500">{variant.kind === 'color' ? 'Colors' : 'Material'}</span>
      {variant.options.map((option) => {
        const row = rows?.find((r) => r.option.id === option.id);
        const bad = row != null && odd.includes(row);
        return (
          <span
            key={option.id}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${bad ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-600'}`}
            title={
              row?.quote
                ? `${option.name}: ${row.quote.pricingName ?? 'unknown price book'} (#${row.quote.pricingId})`
                : (row?.error ?? 'Checking…')
            }
          >
            <Swatches options={[option]} size={10} />
            {option.name}
          </span>
        );
      })}
      {!rows ? (
        <span className="text-slate-400">checking…</span>
      ) : !reference ? (
        <span className="text-red-600">production would not quote this {variant.kind}</span>
      ) : odd.length === 0 ? (
        <span className="text-slate-500" title={`identical prices at ${size.width}×${size.height}`}>
          ✓ {variant.options.length === 1 ? '' : 'all '}#{reference.pricingId}
          {quantities.length > 0 && ` · qty ${groupDigits(quantities[0])}–${groupDigits(quantities[quantities.length - 1])}`}
        </span>
      ) : (
        <span className="text-amber-700" title={`${odd.map((r) => r.option.name).join(', ')} not priced like ${referenceOption}`}>
          ⚠ {odd.length} priced differently
        </span>
      )}
      <button
        className="ml-0.5 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        onClick={() => setNonce((n) => n + 1)}
        disabled={!rows}
        title="Recheck"
        aria-label="Recheck"
      >
        <RefreshIcon width={12} height={12} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Spot check: any size and quantity, draft vs production              */
/* ------------------------------------------------------------------ */

function SpotCheck({
  priceList,
  result,
  options,
  rounding,
  params,
  adjustment,
}: {
  priceList: PriceList;
  result: EngineResult;
  options: EngineOptions;
  rounding: PriceUnit;
  /** Sent with the production quote (variant options, Studio Editor flag). */
  params: Record<string, string>;
  /** Studio Editor discount to apply to the draft's quote, if comparing against the editor. */
  adjustment: PriceAdjustment | null;
}) {
  const { product } = priceList;
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [quantity, setQuantity] = useState('');
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'done'; draft: number | null; draftNote: string | null; production: number | null; error: string | null }
  >({ kind: 'idle' });

  // The chosen rounding, else the unit the draft is already quoted on.
  const detected = useMemo(() => detectPriceUnit(result), [result]);
  const unit = rounding > 1 ? rounding : detected;

  const onDimension = (which: 'w' | 'h', value: string) => {
    const parsed = parseSize(value);
    if (parsed.width != null && parsed.height != null) {
      setWidth(String(parsed.width));
      setHeight(String(parsed.height));
      return;
    }
    (which === 'w' ? setWidth : setHeight)(value);
  };

  const run = async () => {
    const w = Number(width);
    const h = Number(height);
    const q = Number(quantity.replace(/,/g, ''));
    if (!(w > 0 && h > 0 && q > 0)) return;
    setState({ kind: 'loading' });

    // The draft's own quote, built exactly as production builds one.
    const calc = calculate({ width, height, baseArea: '', quantity: String(q), mode: 'staged', roundTo: unit }, result, options);
    const base = calc.ok && calc.price != null ? Number(calc.price) : null;
    const draft = base != null && adjustment ? adjustPrice(base, adjustment) : base;
    const draftNote = !calc.ok
      ? (calc.errors[0] ?? 'The draft cannot price this.')
      : calc.outOfRange.length > 0
        ? 'Outside the drafted range'
        : null;

    let production: number | null = null;
    let error: string | null = null;
    try {
      const quote = await fetchProductionQuote(product.slug, w, h, { quantity: q, params });
      production = quote.prices.find((p) => p.quantity === q)?.price ?? null;
      if (production == null) error = 'Production returned no price for this quantity.';
    } catch (err) {
      error = (err as Error).message;
    }
    setState({ kind: 'done', draft, draftNote, production, error });
  };

  const diff = state.kind === 'done' && state.draft != null && state.production != null ? state.draft - state.production : null;
  const pct = diff != null && state.kind === 'done' && state.production ? (diff / state.production) * 100 : null;

  return (
    <section className="card flex flex-wrap items-end gap-x-5 gap-y-3 px-5 py-3">
      <div className="mr-1">
        <div className="text-sm font-bold text-slate-900">Spot check</div>
        <div className="text-[11px] text-slate-400">Any size &amp; quantity, priced both ways</div>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <SmallField label="Width" suffix="mm" value={width} onChange={(v) => onDimension('w', v)} placeholder="123" />
        <span className="pb-2 text-slate-300">×</span>
        <SmallField label="Height" suffix="mm" value={height} onChange={(v) => onDimension('h', v)} placeholder="123" />
        <SmallField label="Quantity" value={quantity} onChange={setQuantity} placeholder="123" />
        <button className="btn btn-default" type="submit" disabled={state.kind === 'loading'}>
          {state.kind === 'loading' ? 'Checking…' : 'Check'}
        </button>
      </form>

      {state.kind === 'done' && (
        <div className="flex flex-wrap items-end gap-5 sm:ml-auto">
          <Figure
            label={adjustment ? 'Draft −5%' : 'Draft'}
            value={state.draft != null ? won(state.draft) : '—'}
            note={state.draftNote}
          />
          <Figure
            label={adjustment ? 'Studio Editor' : 'Production'}
            value={state.production != null ? won(state.production) : '—'}
            note={state.error}
          />
          <Figure
            label="Difference"
            value={diff != null ? signedWon(diff) : '—'}
            note={pct != null ? signedPct(pct, 2) : null}
            tone={diff == null || diff === 0 ? 'neutral' : diff > 0 ? 'up' : 'down'}
          />
        </div>
      )}
    </section>
  );
}

function SmallField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <span className="mt-0.5 flex items-center rounded-lg border border-slate-200 bg-white px-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode="numeric"
          className="w-16 bg-transparent py-1.5 text-sm tabular-nums focus:outline-none"
        />
        {suffix && <span className="text-[11px] text-slate-400">{suffix}</span>}
      </span>
    </label>
  );
}

function Figure({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  note: string | null;
  tone?: 'neutral' | 'up' | 'down';
}) {
  const icon =
    tone === 'up' ? (
      <ArrowUpIcon width={12} height={12} style={{ color: DIFF.higher }} />
    ) : tone === 'down' ? (
      <ArrowDownIcon width={12} height={12} style={{ color: DIFF.lower }} />
    ) : null;
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
        {icon}
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums text-slate-900">{value}</div>
      {note && <div className="max-w-[220px] truncate text-[11px] text-slate-500" title={note}>{note}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Matrix and list                                                     */
/* ------------------------------------------------------------------ */

function cellPasses(cell: CompareCell, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'changed') return cell.status === 'higher' || cell.status === 'lower';
  return cell.status === filter;
}

const CELL_W = 68;
const CELL_H = 26;
const HEAD_W = 112;

/** A cell's fill: neutral for a match, blue/red deepening with the size of the gap. */
function heatFill(cell: CompareCell): string | undefined {
  if (cell.status === 'same') return HEAT.match;
  if (cell.status === 'higher') return HEAT.higher[heatStep(cell.diffPct)];
  if (cell.status === 'lower') return HEAT.lower[heatStep(cell.diffPct)];
  return undefined;
}

/**
 * The comparison as a heatmap: one row per drafted size, one column per
 * quantity. Matches are light green with a ✓; every difference is colored by
 * direction and deepens with its size, so where draft and production part
 * ways is visible at a glance. Each column and row carries its match rate.
 */
function Matrix({
  comparison,
  filter,
  measure,
  onGoToCell,
}: {
  comparison: ReturnType<typeof compareDraft>;
  filter: Filter;
  measure: Measure;
  onGoToCell: (rowIndex: number, gridColIndex: number) => void;
}) {
  const rows = useMemo(
    () => (filter === 'all' ? comparison.rows : comparison.rows.filter((r) => r.cells.some((c) => cellPasses(c, filter)))),
    [comparison.rows, filter],
  );
  const shown = rows.slice(0, MAX_MATRIX_ROWS);

  /** Match rate per quantity column, over cells that were compared. */
  const columnRates = useMemo(
    () =>
      comparison.quantities.map((_, i) => {
        let compared = 0;
        let same = 0;
        for (const r of comparison.rows) {
          const c = r.cells[i];
          if (c && (c.status === 'same' || c.status === 'higher' || c.status === 'lower')) {
            compared += 1;
            if (c.status === 'same') same += 1;
          }
        }
        return compared ? same / compared : null;
      }),
    [comparison],
  );

  if (shown.length === 0) return <div className="px-4 py-12 text-center text-sm text-slate-500">No prices match this filter.</div>;

  return (
    <>
      <table className="border-separate border-spacing-0 text-[11px]" style={{ fontFamily: 'Arial, Roboto, sans-serif' }}>
        <thead>
          <tr>
            <th
              className="sticky left-0 top-0 z-30 border-b border-r border-slate-200 bg-white px-2 text-left font-semibold text-slate-500"
              style={{ minWidth: HEAD_W, height: CELL_H }}
            >
              Base area / qty
            </th>
            {comparison.quantities.map((q, i) => (
              <th
                key={i}
                className="sticky top-0 z-20 border-b border-slate-200 bg-white px-1.5 text-right font-semibold tabular-nums text-slate-600"
                style={{ minWidth: CELL_W, height: CELL_H }}
              >
                {q != null ? groupDigits(q) : '?'}
              </th>
            ))}
            <th className="sticky top-0 z-20 border-b border-slate-200 bg-white px-2 text-right font-semibold text-slate-500" style={{ minWidth: 56 }}>
              Match
            </th>
          </tr>
          <tr>
            <th
              className="sticky left-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-2 text-left font-medium text-slate-400"
              style={{ top: CELL_H, height: 20 }}
            >
              match per qty
            </th>
            {columnRates.map((rate, i) => (
              <th
                key={i}
                className="sticky z-20 border-b border-slate-200 bg-slate-50 px-1.5 text-right font-medium tabular-nums text-slate-500"
                style={{ top: CELL_H, height: 20 }}
              >
                {rate == null ? '—' : `${Math.round(rate * 100)}%`}
              </th>
            ))}
            <th className="sticky z-20 border-b border-slate-200 bg-slate-50" style={{ top: CELL_H }} />
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const compared = row.cells.filter((c) => c.status === 'same' || c.status === 'higher' || c.status === 'lower');
            const same = compared.filter((c) => c.status === 'same').length;
            return (
              <tr key={row.rowIndex}>
                <RowHeader row={row} />
                {row.cells.map((cell) => {
                  const active = cellPasses(cell, filter);
                  return (
                    <td
                      key={cell.colIndex}
                      className={`border-b border-r border-white px-1.5 text-right tabular-nums ${
                        cell.status !== 'blank' ? 'cursor-pointer hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-slate-700' : ''
                      }`}
                      style={{
                        height: CELL_H,
                        background: active ? heatFill(cell) : undefined,
                        opacity: active ? 1 : 0.2,
                      }}
                      onClick={() => cell.status !== 'blank' && onGoToCell(cell.rowIndex, FIRST_PRICE_COL + cell.colIndex)}
                      title={cellTitle(row, cell)}
                    >
                      <HeatCell cell={cell} measure={measure} rowState={row.state} />
                    </td>
                  );
                })}
                <td className="border-b border-slate-100 px-2 text-right font-semibold tabular-nums text-slate-600">
                  {compared.length ? `${Math.round((same / compared.length) * 100)}%` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <div className="px-4 py-3 text-xs text-slate-500">
          Showing the first {MAX_MATRIX_ROWS.toLocaleString()} of {rows.length.toLocaleString()} rows — export for the full comparison.
        </div>
      )}
    </>
  );
}

function RowHeader({ row }: { row: CompareRow }) {
  const state = {
    ok: null,
    error: (
      <span className="text-red-600" title={row.error ?? ''}>
        refused
      </span>
    ),
    'not-fetched': <span>not fetched</span>,
    'no-size': <span>no area</span>,
  }[row.state];
  return (
    <th
      className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-2 text-left font-normal"
      style={{ minWidth: HEAD_W, height: CELL_H }}
    >
      <div className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="font-semibold tabular-nums text-slate-800">{row.baseArea != null ? groupDigits(row.baseArea) : '—'}</span>
        <span className="text-[10px] text-slate-400">{state ?? row.sizeLabel}</span>
      </div>
    </th>
  );
}

const MISSING_LABEL: Record<CompareRow['state'], string> = {
  ok: 'n/a',
  error: '!',
  'not-fetched': '·',
  'no-size': '',
};

function HeatCell({ cell, measure, rowState }: { cell: CompareCell; measure: Measure; rowState: CompareRow['state'] }) {
  if (cell.status === 'blank') return <span className="text-slate-200">·</span>;
  if (cell.production == null) return <span className="text-slate-300">{MISSING_LABEL[rowState]}</span>;
  if (measure === 'draft') return <span className="text-slate-800">{groupDigits(cell.draft ?? 0)}</span>;
  if (measure === 'prod') return <span className="text-slate-800">{groupDigits(cell.production)}</span>;
  if (cell.status === 'same') return <CheckIcon width={11} height={11} className="ml-auto" style={{ color: DIFF.match }} />;
  return (
    <span className="font-semibold text-slate-900">
      {measure === 'pct' ? signedPct(cell.diffPct) : signedWon(cell.diff ?? 0)}
    </span>
  );
}

function cellTitle(row: CompareRow, cell: CompareCell): string {
  if (cell.status === 'blank') return '';
  const parts = [`${row.baseArea != null ? `${groupDigits(row.baseArea)} mm²` : row.sizeLabel} (${row.sizeLabel}) × qty ${groupDigits(cell.quantity ?? 0)}`];
  if (cell.draftRaw != null && cell.draft !== cell.draftRaw) {
    parts.push(`Draft ${won(cell.draftRaw)} → compared as ${won(cell.draft ?? 0)}`);
  } else {
    parts.push(`Draft ${won(cell.draft ?? 0)}`);
  }
  if (cell.production != null) parts.push(`Production ${won(cell.production)}`);
  if (cell.diff != null) parts.push(cell.diff === 0 ? 'Match ✓' : `Δ ${signedWon(cell.diff)} (${signedPct(cell.diffPct, 2)})`);
  if (row.state === 'error') parts.push(`Production: ${row.error}`);
  parts.push('Click to edit in the price table');
  return parts.join('\n');
}

function DiffList({
  comparison,
  filter,
  onGoToCell,
}: {
  comparison: ReturnType<typeof compareDraft>;
  filter: Filter;
  onGoToCell: (rowIndex: number, gridColIndex: number) => void;
}) {
  const items = useMemo(() => {
    const out: { row: CompareRow; cell: CompareCell }[] = [];
    for (const row of comparison.rows) {
      for (const cell of row.cells) {
        if (cell.production == null || cell.draft == null) continue;
        if (filter === 'all' ? false : !cellPasses(cell, filter)) continue;
        if (filter === 'all' && cell.status === 'same') continue;
        out.push({ row, cell });
      }
    }
    return out.sort((a, b) => Math.abs(b.cell.diffPct ?? 0) - Math.abs(a.cell.diffPct ?? 0));
  }, [comparison.rows, filter]);

  if (items.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-sm text-slate-500">
        No differences — every compared price matches production.
      </div>
    );
  }

  return (
    <>
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="text-slate-600">
            {['Size', 'Quantity', 'Draft', 'Production', 'Δ ₩', 'Δ %'].map((h, i) => (
              <th
                key={h}
                className={`sticky top-0 border-b border-slate-200 bg-white px-4 py-2 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.slice(0, MAX_LIST_ROWS).map(({ row, cell }) => {
            // Text stays in text tokens; the arrow carries direction.
            const color = 'text-slate-900';
            const arrow =
              cell.status === 'higher' ? (
                <ArrowUpIcon width={11} height={11} className="mr-0.5 inline" style={{ color: DIFF.higher }} />
              ) : (
                <ArrowDownIcon width={11} height={11} className="mr-0.5 inline" style={{ color: DIFF.lower }} />
              );
            return (
              <tr
                key={`${row.rowIndex}-${cell.colIndex}`}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => onGoToCell(cell.rowIndex, FIRST_PRICE_COL + cell.colIndex)}
              >
                <td className="border-b border-slate-100 px-4 py-2 font-medium tabular-nums text-slate-800">{row.sizeLabel}</td>
                <td className="border-b border-slate-100 px-4 py-2 text-right tabular-nums">{groupDigits(cell.quantity ?? 0)}</td>
                <td
                  className="border-b border-slate-100 px-4 py-2 text-right font-semibold tabular-nums"
                  title={cell.draft !== cell.draftRaw ? `Drafted ${won(cell.draftRaw ?? 0)}` : undefined}
                >
                  {won(cell.draft ?? 0)}
                  {cell.draft !== cell.draftRaw && (
                    <div className="text-[10px] font-normal text-slate-400">from {won(cell.draftRaw ?? 0)}</div>
                  )}
                </td>
                <td className="border-b border-slate-100 px-4 py-2 text-right tabular-nums text-slate-500">{won(cell.production ?? 0)}</td>
                <td className={`border-b border-slate-100 px-4 py-2 text-right font-semibold tabular-nums ${color}`}>
                  {arrow}
                  {signedWon(cell.diff ?? 0)}
                </td>
                <td className={`border-b border-slate-100 px-4 py-2 text-right font-semibold tabular-nums ${color}`}>
                  {signedPct(cell.diffPct, 2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {items.length > MAX_LIST_ROWS && (
        <div className="px-4 py-3 text-xs text-slate-500">
          Showing the {MAX_LIST_ROWS.toLocaleString()} largest of {items.length.toLocaleString()} differences.
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

const ROUNDING_OPTIONS: [string, string][] = [
  ['1', 'Exact'],
  ['10', '₩10'],
  ['100', '₩100'],
];

/** How drafted prices are rounded before they are lined up against production. */
function RoundingControl({
  rounding,
  onRounding,
  productionUnit,
  rounded,
  label = 'Round my prices',
}: {
  rounding: PriceUnit;
  onRounding: (unit: PriceUnit) => void;
  productionUnit: number | null;
  rounded: number;
  label?: string;
}) {
  const matchable = productionUnit != null && (PRICE_UNITS as readonly number[]).includes(productionUnit);
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs"
      title="Drafted prices are rounded half-up before comparing — the draft itself is not changed. Rounded values show the original on hover."
    >
      <span className="font-medium text-slate-500">{label}</span>
      <Seg value={String(rounding)} onChange={(v) => onRounding(Number(v) as PriceUnit)} options={ROUNDING_OPTIONS} />
      {matchable && rounding !== productionUnit && (
        <button className="font-medium text-brand-600 hover:text-brand-700" onClick={() => onRounding(productionUnit as PriceUnit)}>
          match production (₩{groupDigits(productionUnit)})
        </button>
      )}
      {rounding > 1 && <span className="text-slate-400">{rounded.toLocaleString()} rounded</span>}
    </div>
  );
}

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Lower (blue) ← match (green, ✓) → higher (red), each arm stepped by gap size. */
function HeatLegend() {
  const ramp = (colors: readonly string[]) =>
    colors.map((c, i) => <span key={i} className="h-3 w-3" style={{ background: c }} title={HEAT_LEGEND[i]} />);
  return (
    <div className="ml-auto hidden items-center gap-2 text-[11px] text-slate-500 lg:flex">
      <span className="flex items-center gap-1">
        <ArrowDownIcon width={11} height={11} style={{ color: DIFF.lower }} /> lower
      </span>
      <span className="flex gap-px" title="≥ 5%  ·  < 5%  ·  < 2%  ·  < 0.5%">
        {ramp([...HEAT.lower].reverse())}
      </span>
      <span className="flex h-3 items-center gap-0.5 px-1" style={{ background: HEAT.match }}>
        <CheckIcon width={10} height={10} style={{ color: DIFF.match }} />
      </span>
      <span className="flex gap-px" title="< 0.5%  ·  < 2%  ·  < 5%  ·  ≥ 5%">
        {ramp(HEAT.higher)}
      </span>
      <span className="flex items-center gap-1">
        higher <ArrowUpIcon width={11} height={11} style={{ color: DIFF.higher }} />
      </span>
    </div>
  );
}

function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'amber' | 'violet' }) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-600',
    brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100',
    amber: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-100',
    violet: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-100',
  };
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ${tones[tone]}`}>{children}</span>;
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <section className="card flex flex-col items-center px-6 py-16 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <RefreshIcon width={20} height={20} />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}
