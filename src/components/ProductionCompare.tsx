import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EngineOptions, EngineResult } from '../types';
import { productUrl, type PriceList, type ProductOption, type Variant } from '../lib/products';
import Swatches from './Swatches';
import {
  compareDraft,
  comparisonToCsv,
  draftSizes,
  fetchProductionQuote,
  type CompareCell,
  type CompareRow,
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
type Measure = 'won' | 'pct';

/** Parallel requests to production. Polite, and still quick for a few hundred sizes. */
const CONCURRENCY = 4;
const MAX_MATRIX_ROWS = 300;
const MAX_LIST_ROWS = 500;

export default function ProductionCompare({
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
  const [view, setView] = useState<View>('matrix');
  const [filter, setFilter] = useState<Filter>('all');
  const [measure, setMeasure] = useState<Measure>('pct');

  const sizes = useMemo(() => draftSizes(result.parsed), [result.parsed]);
  const comparison = useMemo(
    () => compareDraft(result.parsed, snapshot, { roundTo: rounding }),
    [result.parsed, snapshot, rounding],
  );
  const missing = useMemo(() => sizes.filter((s) => !snapshot?.quotes[s.key]), [sizes, snapshot]);
  const { fetchSizes, progress, cancel } = useProductionFetch(product.slug, variant?.params, snapshot, onSnapshot);

  const s = comparison.summary;
  const busy = progress != null;

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(comparisonToCsv(comparison), `${priceList.key.replace('~', '-')}-vs-production-${stamp}.csv`);
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pb-2">
      {/* ------------------------------------------------ source + actions */}
      <section className="card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-900">Draft vs production</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            {comparison.pricingName ? (
              <Chip tone="brand">
                {comparison.pricingName}
                {comparison.pricingId != null && <span className="opacity-60">#{comparison.pricingId}</span>}
              </Chip>
            ) : (
              <span>Live prices from musticker.com, per drafted size.</span>
            )}
            {comparison.normalizedNr != null && <Chip>rounds to ₩{groupDigits(comparison.normalizedNr)}</Chip>}
            {comparison.sheet && (
              <Chip tone="amber">
                priced per {comparison.sheet.name} sheet ({comparison.sheet.width}×{comparison.sheet.height})
              </Chip>
            )}
            {snapshot && <span>· fetched {timeAgo(snapshot.fetchedAt)}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a className="btn btn-ghost" href={productUrl(product)} target="_blank" rel="noreferrer">
            <ExternalIcon width={14} height={14} />
            Live page
          </a>
          {snapshot && (
            <button className="btn btn-default" onClick={exportCsv} disabled={s.compared === 0}>
              <DownloadIcon width={14} height={14} />
              Export
            </button>
          )}
          {snapshot && missing.length > 0 && !busy && (
            <button className="btn btn-default" onClick={() => fetchSizes(missing, 'merge')}>
              Fetch {missing.length.toLocaleString()} new size{missing.length === 1 ? '' : 's'}
            </button>
          )}
          {busy ? (
            <button className="btn btn-default" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => fetchSizes(sizes, 'replace')} disabled={sizes.length === 0}>
              <RefreshIcon width={14} height={14} />
              {snapshot ? 'Refresh production prices' : 'Fetch production prices'}
            </button>
          )}
        </div>

        <RoundingControl
          rounding={rounding}
          onRounding={onRounding}
          productionUnit={comparison.normalizedNr}
          rounded={s.rounded}
        />

        {busy && (
          <div className="w-full">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
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

      {variant && <OptionCheck slug={product.slug} variant={variant} size={sizes[0] ?? DEFAULT_CHECK_SIZE} />}

      {s.rows === 0 ? (
        <EmptyState
          title="Nothing drafted yet"
          body="Enter or paste this price list's prices in the Price Table tab. Each row's size (e.g. 100*100) is what gets quoted against production."
        />
      ) : !snapshot ? (
        <EmptyState
          title={`Compare ${sizes.length.toLocaleString()} size${sizes.length === 1 ? '' : 's'} against production`}
          body="Each drafted size is quoted live from musticker.com and lined up against your draft, price by price. Results are stored with this price list's draft."
          action={
            sizes.length > 0 && !busy ? (
              <button className="btn btn-primary" onClick={() => fetchSizes(sizes, 'replace')}>
                <RefreshIcon width={14} height={14} />
                Fetch production prices
              </button>
            ) : null
          }
        />
      ) : (
        <>
          <Kpis comparison={comparison} />
          <Notices comparison={comparison} />
          <SpotCheck priceList={priceList} result={result} options={options} rounding={rounding} />

          <section className="card flex min-h-[420px] flex-1 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <Seg value={view} onChange={setView} options={[['matrix', 'Matrix'], ['list', 'Differences']]} />
              <Seg
                value={filter}
                onChange={setFilter}
                options={[['all', 'All'], ['changed', 'Changed'], ['higher', 'Draft higher'], ['lower', 'Draft lower']]}
              />
              <Seg value={measure} onChange={setMeasure} options={[['pct', 'Δ %'], ['won', 'Δ ₩']]} />
              <Legend />
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
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

function Kpis({ comparison }: { comparison: ReturnType<typeof compareDraft> }) {
  const s = comparison.summary;
  const share = (n: number) => (s.compared === 0 ? 0 : (n / s.compared) * 100);
  const largest = s.largest;
  const largestRow = largest ? comparison.rows.find((r) => r.rowIndex === largest.rowIndex) : null;

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Prices compared" value={s.compared.toLocaleString()} sub={`${s.rows.toLocaleString()} drafted row(s)`} />
      <Kpi
        label="Match production"
        value={s.same.toLocaleString()}
        sub={`${share(s.same).toFixed(0)}% of compared`}
        tone="good"
        icon={<CheckIcon width={14} height={14} />}
      />
      <Kpi
        label="Draft higher"
        value={s.higher.toLocaleString()}
        sub={`${share(s.higher).toFixed(0)}% of compared`}
        tone="up"
        icon={<ArrowUpIcon width={14} height={14} />}
      />
      <Kpi
        label="Draft lower"
        value={s.lower.toLocaleString()}
        sub={`${share(s.lower).toFixed(0)}% of compared`}
        tone="down"
        icon={<ArrowDownIcon width={14} height={14} />}
      />
      <Kpi label="Average Δ" value={signedPct(s.avgDiffPct)} sub="draft vs production" />
      <Kpi
        label="Largest gap"
        value={largest ? signedPct(largest.diffPct) : '—'}
        sub={
          largest && largestRow
            ? `${largestRow.sizeLabel} · qty ${groupDigits(largest.quantity ?? 0)} · ${signedWon(largest.diff ?? 0)}`
            : 'no differences'
        }
      />
      {s.compared > 0 && (
        <div className="col-span-full flex h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="bg-emerald-500" style={{ width: `${share(s.same)}%` }} title={`${s.same} match`} />
          <div className="bg-amber-400" style={{ width: `${share(s.higher)}%` }} title={`${s.higher} higher`} />
          <div className="bg-sky-500" style={{ width: `${share(s.lower)}%` }} title={`${s.lower} lower`} />
        </div>
      )}
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'good' | 'up' | 'down';
  icon?: ReactNode;
}) {
  const accent = {
    neutral: 'text-slate-400',
    good: 'text-emerald-600 bg-emerald-50',
    up: 'text-amber-600 bg-amber-50',
    down: 'text-sky-600 bg-sky-50',
  }[tone];
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-500">{label}</span>
        {icon && <span className={`rounded-md p-1 ${accent}`}>{icon}</span>}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-slate-500" title={sub}>{sub}</div>}
    </div>
  );
}

function Notices({ comparison }: { comparison: ReturnType<typeof compareDraft> }) {
  const s = comparison.summary;
  const notes: { tone: 'info' | 'warn'; text: ReactNode }[] = [];

  if (s.rowsFailed > 0) {
    const first = comparison.rows.find((r) => r.state === 'error');
    notes.push({
      tone: 'warn',
      text: (
        <>
          Production refused {s.rowsFailed.toLocaleString()} size(s)
          {first ? ` — e.g. ${first.sizeLabel}: “${first.error}”` : ''}.
        </>
      ),
    });
  }
  if (s.rowsNotFetched > 0) {
    notes.push({
      tone: 'info',
      text: `${s.rowsNotFetched.toLocaleString()} row(s) were added after the last fetch and have no production price yet.`,
    });
  }
  if (s.rowsWithoutSize > 0) {
    notes.push({
      tone: 'info',
      text: `${s.rowsWithoutSize.toLocaleString()} row(s) have neither a size nor a whole-number base area, so production cannot be asked about them.`,
    });
  }
  if (s.notInProduction > 0) {
    notes.push({
      tone: 'info',
      text: `${s.notInProduction.toLocaleString()} drafted price(s) sit at a quantity production does not quote.`,
    });
  }
  if (comparison.productionOnlyQuantities.length > 0) {
    notes.push({
      tone: 'info',
      text: (
        <>
          Production also quotes quantities your draft has no column for:{' '}
          <span className="font-medium tabular-nums">
            {comparison.productionOnlyQuantities.map((q) => groupDigits(q)).join(', ')}
          </span>
          .
        </>
      ),
    });
  }

  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {notes.map((n, i) => (
        <li
          key={i}
          className={`rounded-lg border px-3 py-2 text-xs ${
            n.tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600'
          }`}
        >
          {n.text}
        </li>
      ))}
    </ul>
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
function OptionCheck({ slug, variant, size }: { slug: string; variant: Variant; size: { width: number; height: number } }) {
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
            params: { ...variant.params, [variant.param]: String(option.id) },
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
  }, [slug, variant, size.width, size.height, nonce]);

  const reference = rows?.find((r) => r.quote)?.quote ?? null;
  const referenceOption = rows?.find((r) => r.quote === reference)?.option.name;
  const odd = rows?.filter((r) => !r.quote || (reference && !samePricing(r.quote, reference))) ?? [];
  const quantities = reference?.prices.map((p) => p.quantity) ?? [];

  return (
    <section className="card px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="text-sm font-semibold text-slate-900">
          {variant.kind === 'color' ? 'Colors in this price list' : 'Material'}
          <span className="ml-2 font-normal text-slate-500">
            {variant.name} · {variant.english}
          </span>
        </div>
        <button className="btn btn-ghost ml-auto" onClick={() => setNonce((n) => n + 1)} disabled={!rows}>
          <RefreshIcon width={14} height={14} />
          Recheck
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {variant.options.map((option) => {
          const row = rows?.find((r) => r.option.id === option.id);
          const bad = row != null && odd.includes(row);
          return (
            <span
              key={option.id}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ring-1 ring-inset ${
                bad ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-slate-50 text-slate-700 ring-slate-200'
              }`}
              title={
                row?.quote
                  ? `${row.quote.pricingName ?? 'Unknown price book'} (#${row.quote.pricingId})`
                  : (row?.error ?? 'Checking…')
              }
            >
              <Swatches options={[option]} size={12} />
              {option.name}
              {row?.quote && <span className="text-[10px] text-slate-400">#{row.quote.pricingId}</span>}
              {!row && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-300" />}
            </span>
          );
        })}
      </div>

      <div className="mt-2 text-xs">
        {!rows ? (
          <span className="text-slate-500">
            Quoting {variant.options.length === 1 ? 'it' : `each ${variant.kind}`} at {size.width}×{size.height}…
          </span>
        ) : !reference ? (
          <span className="text-red-700">Production would not quote this {variant.kind}: {rows[0]?.error}</span>
        ) : odd.length === 0 ? (
          <span className="text-emerald-700">
            ✓ {variant.options.length === 1 ? 'Priced' : `All ${variant.options.length} ${variant.kind}s are priced`} from{' '}
            <span className="font-medium">{reference.pricingName}</span> (#{reference.pricingId}), identical at{' '}
            {size.width}×{size.height}
            {quantities.length > 0 && (
              <span className="text-slate-500">
                {' '}
                · quantities {groupDigits(quantities[0])}–{groupDigits(quantities[quantities.length - 1])}
              </span>
            )}
            .
          </span>
        ) : (
          <span className="text-amber-800">
            ⚠ {odd.map((r) => r.option.name).join(', ')} {odd.length === 1 ? 'is' : 'are'} not priced like{' '}
            {referenceOption} ({reference.pricingName}). This price list is compared using {referenceOption}'s prices.
          </span>
        )}
      </div>
    </section>
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
}: {
  priceList: PriceList;
  result: EngineResult;
  options: EngineOptions;
  rounding: PriceUnit;
}) {
  const { product, variant } = priceList;
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
    const draft = calc.ok && calc.price != null ? Number(calc.price) : null;
    const draftNote = !calc.ok
      ? (calc.errors[0] ?? 'The draft cannot price this.')
      : calc.outOfRange.length > 0
        ? 'Outside the drafted range'
        : null;

    let production: number | null = null;
    let error: string | null = null;
    try {
      const quote = await fetchProductionQuote(product.slug, w, h, { quantity: q, params: variant?.params });
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
    <section className="card flex flex-wrap items-end gap-x-5 gap-y-3 px-5 py-4">
      <div className="mr-2">
        <div className="text-sm font-semibold text-slate-900">Spot check</div>
        <div className="text-xs text-slate-500">Any size &amp; quantity, interpolated the production way</div>
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
          <Figure label="Draft" value={state.draft != null ? won(state.draft) : '—'} note={state.draftNote} />
          <Figure label="Production" value={state.production != null ? won(state.production) : '—'} note={state.error} />
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
  const color = tone === 'up' ? 'text-amber-600' : tone === 'down' ? 'text-sky-600' : 'text-slate-900';
  return (
    <div>
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
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

/** Tint by direction, deeper as the gap grows. */
function tint(cell: CompareCell): string {
  if (cell.status === 'same') return 'bg-emerald-50/60';
  if (cell.status !== 'higher' && cell.status !== 'lower') return '';
  const mag = Math.abs(cell.diffPct ?? 0);
  if (cell.status === 'higher') return mag >= 10 ? 'bg-amber-200/70' : mag >= 3 ? 'bg-amber-100' : 'bg-amber-50';
  return mag >= 10 ? 'bg-sky-200/70' : mag >= 3 ? 'bg-sky-100' : 'bg-sky-50';
}

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

  if (shown.length === 0) return <div className="px-4 py-12 text-center text-sm text-slate-500">No prices match this filter.</div>;

  return (
    <>
      <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600">
              Size
            </th>
            {comparison.quantities.map((q, i) => (
              <th
                key={i}
                className="sticky top-0 z-20 min-w-[112px] border-b border-slate-200 bg-slate-50 px-3 py-2 text-right font-semibold tabular-nums text-slate-600"
              >
                {q != null ? groupDigits(q) : '?'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.rowIndex}>
              <RowHeader row={row} />
              {row.cells.map((cell) => (
                <td
                  key={cell.colIndex}
                  className={`border-b border-slate-100 px-3 py-1.5 text-right align-top ${
                    cellPasses(cell, filter) ? tint(cell) : 'opacity-25'
                  } ${cell.status !== 'blank' ? 'cursor-pointer hover:ring-1 hover:ring-inset hover:ring-brand-300' : ''}`}
                  onClick={() => cell.status !== 'blank' && onGoToCell(cell.rowIndex, FIRST_PRICE_COL + cell.colIndex)}
                  title={cellTitle(row, cell)}
                >
                  <MatrixCell cell={cell} measure={measure} rowState={row.state} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <div className="px-4 py-3 text-xs text-slate-500">
          Showing the first {MAX_MATRIX_ROWS.toLocaleString()} of {rows.length.toLocaleString()} rows — export for the
          full comparison.
        </div>
      )}
    </>
  );
}

function RowHeader({ row }: { row: CompareRow }) {
  const state = {
    ok: null,
    error: <span className="text-[10px] font-medium text-red-600" title={row.error ?? ''}>refused</span>,
    'not-fetched': <span className="text-[10px] text-slate-400">not fetched</span>,
    'no-size': <span className="text-[10px] text-slate-400">no size</span>,
  }[row.state];
  return (
    <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-1.5 text-left align-top font-normal">
      <div className="font-semibold tabular-nums text-slate-800">
        {row.sizeLabel}
        {row.sizeFromArea && (
          <span
            className="ml-1 rounded bg-slate-100 px-1 py-px text-[9px] font-medium text-slate-500"
            title="This row has no size, so production was asked for this size, which has the same area. Production prices by area alone."
          >
            from area
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] tabular-nums text-slate-400">
        {row.baseArea != null && <span>{groupDigits(row.baseArea)} mm²</span>}
        {state}
      </div>
    </th>
  );
}

const MISSING_LABEL: Record<CompareRow['state'], string> = {
  ok: 'no prod. qty',
  error: 'refused',
  'not-fetched': 'not fetched',
  'no-size': '',
};

function MatrixCell({ cell, measure, rowState }: { cell: CompareCell; measure: Measure; rowState: CompareRow['state'] }) {
  if (cell.status === 'blank') return <span className="text-slate-300">—</span>;
  return (
    <div className="leading-tight">
      <div
        className={`font-semibold tabular-nums text-slate-900 ${
          cell.draft !== cell.draftRaw ? 'underline decoration-slate-300 decoration-dotted underline-offset-2' : ''
        }`}
      >
        {groupDigits(cell.draft ?? 0)}
      </div>
      {cell.production != null ? (
        <div className="mt-0.5 flex items-center justify-end gap-1 tabular-nums">
          <span className="text-[10px] text-slate-400">{groupDigits(cell.production)}</span>
          <DeltaBadge cell={cell} measure={measure} />
        </div>
      ) : (
        <div className="mt-0.5 h-[15px] text-[10px] text-slate-400">{MISSING_LABEL[rowState]}</div>
      )}
    </div>
  );
}

function DeltaBadge({ cell, measure }: { cell: CompareCell; measure: Measure }) {
  if (cell.status === 'same') return <CheckIcon width={11} height={11} className="text-emerald-600" />;
  if (cell.diff == null) return null;
  const color = cell.status === 'higher' ? 'text-amber-700' : 'text-sky-700';
  return (
    <span className={`text-[10px] font-semibold ${color}`}>
      {measure === 'pct' ? signedPct(cell.diffPct) : signedWon(cell.diff)}
    </span>
  );
}

function cellTitle(row: CompareRow, cell: CompareCell): string {
  if (cell.status === 'blank') return '';
  const parts = [`${row.sizeLabel} × ${groupDigits(cell.quantity ?? 0)}`];
  if (cell.draftRaw != null && cell.draft !== cell.draftRaw) {
    parts.push(`Draft ${won(cell.draftRaw)} → rounded ${won(cell.draft ?? 0)}`);
  } else {
    parts.push(`Draft ${won(cell.draft ?? 0)}`);
  }
  if (cell.production != null) parts.push(`Production ${won(cell.production)}`);
  if (cell.diff != null) parts.push(`Δ ${signedWon(cell.diff)} (${signedPct(cell.diffPct, 2)})`);
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
                className={`sticky top-0 border-b border-slate-200 bg-slate-50 px-4 py-2 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.slice(0, MAX_LIST_ROWS).map(({ row, cell }) => {
            const color = cell.status === 'higher' ? 'text-amber-700' : 'text-sky-700';
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
}: {
  rounding: PriceUnit;
  onRounding: (unit: PriceUnit) => void;
  productionUnit: number | null;
  rounded: number;
}) {
  const matchable = productionUnit != null && (PRICE_UNITS as readonly number[]).includes(productionUnit);
  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3">
      <span className="text-xs font-medium text-slate-700">Round my prices to</span>
      <Seg
        value={String(rounding)}
        onChange={(v) => onRounding(Number(v) as PriceUnit)}
        options={ROUNDING_OPTIONS}
      />
      {matchable && rounding !== productionUnit && (
        <button
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
          onClick={() => onRounding(productionUnit as PriceUnit)}
        >
          Match production (₩{groupDigits(productionUnit)})
        </button>
      )}
      <span className="text-xs text-slate-500">
        {rounding === 1
          ? 'Compared exactly as drafted.'
          : `${rounded.toLocaleString()} drafted price(s) rounded half-up to the nearest ₩${groupDigits(rounding)} before comparing — dotted values; hover for the original. Your draft is not changed.`}
      </span>
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

function Legend() {
  return (
    <div className="ml-auto hidden items-center gap-3 text-[11px] text-slate-500 lg:flex">
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" /> match
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm bg-amber-200" /> draft higher
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm bg-sky-200" /> draft lower
      </span>
      <span className="text-slate-400">small number = production</span>
    </div>
  );
}

function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'amber' }) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-600',
    brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100',
    amber: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-100',
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
