import { useMemo, useState, type ReactNode } from 'react';
import { CATEGORIES, PRICE_LISTS, type CategoryId, type PriceList } from '../lib/products';
import { groupDigits } from '../lib/decimal';
import { DIFF } from '../lib/compareColors';
import type { ProductStatus } from '../state/workspace';
import type { CompareSummary, Server } from '../lib/production';
import Swatches from './Swatches';
import ProductThumb from './ProductThumb';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CompareIcon, MenuIcon } from './icons';
import { timeAgo } from '../lib/format';
import { COMPARE_SPECS, specId, specLabel, type BulkCompare } from '../hooks/useBulkCompare';

interface Props {
  statuses: Record<string, ProductStatus>;
  onSelectProduct: (key: string) => void;
  onOpenCompare: (key: string) => void;
  onOpenNav: () => void;
  /** "Compare all": fetch prices for every drafted list in the chosen category. */
  bulk: BulkCompare;
  /** Which musticker server the chart shows, and compare-all fetches from. */
  server: Server;
  onServer: (server: Server) => void;
}

type Source = 'production' | 'studio';
const SPECS_KEY = 'pricer-maker:compare-all-specs';

/** The combinations "Compare all" runs, remembered per browser. All four by default. */
function loadSpecIds(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(SPECS_KEY) ?? 'null');
    if (Array.isArray(stored)) return COMPARE_SPECS.map(specId).filter((id) => stored.includes(id));
  } catch {
    /* fall through */
  }
  return COMPARE_SPECS.map(specId);
}

type Filter = 'all' | CategoryId;

interface Entry {
  list: PriceList;
  status: ProductStatus | undefined;
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

type ShowTip = (e: React.MouseEvent, content: ReactNode) => void;

const pct = (n: number, of: number) => (of === 0 ? 0 : (n / of) * 100);
const matchRate = (c: CompareSummary) => pct(c.same, c.compared);

/**
 * One chart over every price list: how much of each draft matches what
 * production charges. Compared lists come first, lowest match rate on top;
 * lists not compared or not drafted yet follow, so the whole catalog is
 * always on one page.
 */
export default function Overview({ statuses, onSelectProduct, onOpenCompare, onOpenNav, bulk, server, onServer }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [source, setSource] = useState<Source>('production');
  const [specIds, setSpecIds] = useState<string[]>(loadSpecIds);
  const toggleSpec = (id: string) =>
    setSpecIds((ids) => {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      try {
        localStorage.setItem(SPECS_KEY, JSON.stringify(next));
      } catch {
        /* not remembered — fine */
      }
      return next;
    });
  const specs = COMPARE_SPECS.filter((s) => specIds.includes(specId(s)));
  const [tip, setTip] = useState<Tip | null>(null);

  /** The comparison this chart shows for a list: production's or the Studio Editor's. */
  const summaryOf = (status: ProductStatus | undefined) => (source === 'studio' ? status?.studioCompare : status?.compare) ?? null;

  const { compared, uncompared, undrafted, drafted } = useMemo(() => {
    const entries: Entry[] = PRICE_LISTS.filter((l) => filter === 'all' || l.product.category === filter).map((list) => ({
      list,
      status: statuses[list.key],
    }));
    const summary = (e: Entry) => (source === 'studio' ? e.status?.studioCompare : e.status?.compare) ?? null;
    return {
      compared: entries.filter((e) => summary(e)).sort((a, b) => matchRate(summary(a)!) - matchRate(summary(b)!)),
      uncompared: entries.filter((e) => e.status?.hasDraft && !summary(e)),
      undrafted: entries.filter((e) => !e.status?.hasDraft),
      drafted: entries.filter((e) => e.status?.hasDraft).map((e) => e.list),
    };
  }, [filter, statuses, source]);

  const scopeName = filter === 'all' ? 'all categories' : (CATEGORIES.find((c) => c.id === filter)?.english ?? '');
  const runAll = () => void bulk.run(drafted, specs);

  const showTip: ShowTip = (e, content) => setTip({ x: e.clientX, y: e.clientY, content });
  const hideTip = () => setTip(null);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden px-4 pb-5 pt-3 sm:px-7" onMouseLeave={hideTip}>
      <section className="card flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 pb-3 pt-5">
          <button className="btn btn-default px-2 lg:hidden" onClick={onOpenNav} aria-label="Open products">
            <MenuIcon />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold text-slate-900">
              Match with {source === 'studio' ? 'the Studio Editor' : 'production'}
              {server === 'dev' && (
                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">DEV server</span>
              )}
            </h1>
            <p className="text-xs text-slate-400">
              Every price list · compared ones first, lowest match rate on top
            </p>
          </div>
          <Legend />
          <div className="pills">
            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </button>
            {CATEGORIES.map((c) => (
              <button key={c.id} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
                {c.english}
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------ what to show, and compare all */}
        <div className="mx-6 mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-slate-50 px-4 py-2.5">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Server
            <Seg
              value={server}
              onChange={onServer}
              options={[
                ['production', 'Production'],
                ['dev', 'Dev'],
              ]}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Show
            <Seg
              value={source}
              onChange={setSource}
              options={[
                ['production', 'Production'],
                ['studio', 'Studio Editor'],
              ]}
            />
          </label>

          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {bulk.progress ? (
              <>
                <span className="min-w-0 truncate">
                  Comparing <b className="tabular-nums text-slate-700">{bulk.progress.job}</b> of {bulk.progress.jobs} ·{' '}
                  {listLabel(bulk.progress.list)} · {specLabel(bulk.progress)} ·{' '}
                  <span className="tabular-nums">
                    {bulk.progress.done}/{bulk.progress.total}
                  </span>{' '}
                  sizes
                </span>
                <button className="btn btn-default" onClick={bulk.cancel}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span>Compare against</span>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Compare against">
                  {COMPARE_SPECS.map((spec) => {
                    const id = specId(spec);
                    const on = specIds.includes(id);
                    return (
                      <button
                        key={id}
                        aria-pressed={on}
                        onClick={() => toggleSpec(id)}
                        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${
                          on
                            ? 'bg-brand-50 text-brand-700 ring-brand-300'
                            : 'bg-white text-slate-500 ring-slate-200 hover:text-slate-700'
                        }`}
                      >
                        <span
                          className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                            on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'
                          }`}
                        >
                          {on && <CheckIcon width={10} height={10} />}
                        </span>
                        {spec.target === 'studio' ? 'Studio Editor' : 'Price'}
                        <span
                          className={`rounded px-1 text-[10px] font-semibold uppercase ${
                            spec.server === 'dev' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {spec.server === 'dev' ? 'dev' : 'prod'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  className="btn btn-primary"
                  onClick={runAll}
                  disabled={drafted.length === 0 || specs.length === 0}
                  title={`Fetch ${specs.map(specLabel).join(', ') || 'nothing — pick at least one'} for every drafted price list in ${scopeName}`}
                >
                  <CompareIcon width={14} height={14} />
                  Compare {drafted.length} price list{drafted.length === 1 ? '' : 's'}
                  {specs.length > 1 && <span className="font-normal opacity-80">× {specs.length}</span>}
                  <span className="font-normal opacity-80">· {scopeName}</span>
                </button>
              </>
            )}
          </div>

          {bulk.progress && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width]"
                style={{
                  width: `${(((bulk.progress.job - 1) + bulk.progress.done / Math.max(1, bulk.progress.total)) / bulk.progress.jobs) * 100}%`,
                }}
              />
            </div>
          )}
          {!bulk.progress && bulk.result && (
            <div className="w-full text-[11px] text-slate-500">
              {bulk.result.cancelled ? 'Stopped' : 'Done'} {timeAgo(bulk.result.at)} — {bulk.result.finished} of{' '}
              {bulk.result.jobs} comparison{bulk.result.jobs === 1 ? '' : 's'} saved to the shared database
              {bulk.result.skipped > 0 && ` · ${bulk.result.skipped} list(s) skipped: no row with a base area`}.
            </div>
          )}
        </div>

        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-6 pb-5">
          {compared.map(({ list, status }) => {
            const c = summaryOf(status)!;
            return (
              <Row key={list.key} list={list} onClick={() => onOpenCompare(list.key)} title="Open the comparison">
                <DivergingBar summary={c} label={listLabel(list)} onHover={showTip} onLeave={hideTip} />
                <span className="text-right">
                  <span className="block text-sm font-bold tabular-nums text-slate-900">{matchRate(c).toFixed(0)}%</span>
                  <span className="block text-[10px] tabular-nums text-slate-400">of {groupDigits(c.compared)}</span>
                </span>
              </Row>
            );
          })}

          {uncompared.map(({ list }) => (
            <Row key={list.key} list={list} onClick={() => onOpenCompare(list.key)} title="Fetch production prices for this draft">
              <span className="flex h-2.5 items-center rounded-full border border-dashed border-slate-300 px-3">
                <span className="-mt-px bg-white px-1.5 text-[10px] leading-none text-slate-400">
                  drafted · not compared {source === 'studio' ? 'with the Studio Editor ' : ''}yet
                </span>
              </span>
              <span className="whitespace-nowrap text-right text-xs font-medium text-brand-600">Compare →</span>
            </Row>
          ))}

          {undrafted.map(({ list }) => (
            <Row key={list.key} list={list} onClick={() => onSelectProduct(list.key)} title="Start drafting this price list" muted>
              <span className="h-2.5 rounded-full bg-slate-100" />
              <span className="text-right text-[11px] text-slate-400">not drafted</span>
            </Row>
          ))}
        </ul>
      </section>

      {tip && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
          style={{ left: tip.x + 14, top: tip.y + 14 }}
        >
          {tip.content}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="seg bg-white">
      {options.map(([v, label]) => (
        <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function listLabel(list: PriceList): string {
  return list.variant ? `${list.product.name} · ${list.variant.name}` : list.product.name;
}

/** Name on the left, bar in the middle, figure on the right. */
function Row({
  list,
  onClick,
  title,
  muted,
  children,
}: {
  list: PriceList;
  onClick: () => void;
  title: string;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        title={title}
        className={`grid w-full grid-cols-[minmax(0,210px)_minmax(0,1fr)_76px] items-center gap-4 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-slate-50 ${
          muted ? 'opacity-70' : ''
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <ProductThumb product={list.product} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-slate-800">{list.product.name}</span>
            <span className="flex items-center gap-1 truncate text-[11px] text-slate-400">
              {list.variant ? (
                <>
                  <Swatches options={list.variant.options} size={9} max={4} />
                  {list.variant.name}
                  <span className="text-slate-300">· {list.product.english}</span>
                </>
              ) : (
                list.product.english
              )}
            </span>
          </span>
        </span>
        {children}
      </button>
    </li>
  );
}

/**
 * One price list's prices as a bar: draft lower (blue) on the left, match
 * (green) in the middle, draft higher (red) on the right, 2px gaps between.
 */
function DivergingBar({
  summary,
  label,
  onHover,
  onLeave,
}: {
  summary: CompareSummary;
  label: string;
  onHover: ShowTip;
  onLeave: () => void;
}) {
  const segs = [
    { key: 'lower', n: summary.lower, color: DIFF.lower, name: '↓ Draft lower' },
    { key: 'same', n: summary.same, color: DIFF.match, name: '✓ Match' },
    { key: 'higher', n: summary.higher, color: DIFF.higher, name: '↑ Draft higher' },
  ].filter((s) => s.n > 0);

  return (
    <span className="flex h-2.5 w-full gap-[2px]">
      {segs.map((s, i) => (
        <span
          key={s.key}
          onMouseMove={(e) =>
            onHover(
              e,
              <>
                <div className="font-semibold">{label}</div>
                <div className="mt-0.5 text-slate-300">
                  {s.name}: {groupDigits(s.n)} of {groupDigits(summary.compared)} (
                  {pct(s.n, summary.compared).toFixed(0)}%)
                </div>
              </>,
            )
          }
          onMouseLeave={onLeave}
          className={`${i === 0 ? 'rounded-l-full' : ''} ${i === segs.length - 1 ? 'rounded-r-full' : ''}`}
          style={{ flexGrow: s.n, flexBasis: 0, background: s.color, minWidth: 3 }}
        />
      ))}
    </span>
  );
}

function Legend() {
  const item = (color: string, label: string, icon: ReactNode) => (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
      <span className="text-slate-400">{icon}</span>
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
      {item(DIFF.lower, 'Draft lower', <ArrowDownIcon width={11} height={11} />)}
      {item(DIFF.match, 'Match', <CheckIcon width={11} height={11} />)}
      {item(DIFF.higher, 'Draft higher', <ArrowUpIcon width={11} height={11} />)}
    </div>
  );
}
