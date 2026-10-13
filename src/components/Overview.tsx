import { useMemo, useState, type ReactNode } from 'react';
import { CATEGORIES, PRICE_LISTS, type CategoryId, type PriceList } from '../lib/products';
import { groupDigits } from '../lib/decimal';
import { signedPct, timeAgo } from '../lib/format';
import { DIFF } from '../lib/compareColors';
import type { ProductStatus } from '../state/workspace';
import type { CompareSummary } from '../lib/production';
import Swatches from './Swatches';
import ProductThumb from './ProductThumb';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CompareIcon, MenuIcon } from './icons';

interface Props {
  statuses: Record<string, ProductStatus>;
  onSelectProduct: (key: string) => void;
  onOpenCompare: (key: string) => void;
  onOpenNav: () => void;
}

type Filter = 'all' | CategoryId;

interface Entry {
  list: PriceList;
  status: ProductStatus;
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

type ShowTip = (e: React.MouseEvent, content: ReactNode) => void;

const pct = (n: number, of: number) => (of === 0 ? 0 : (n / of) * 100);
const fmtPct = (n: number, of: number) => `${pct(n, of).toFixed(0)}%`;
const differing = (c: CompareSummary) => c.higher + c.lower;

/**
 * Every price list's draft and how it stands against production, as a
 * dashboard: headline numbers, where drafts and production disagree, and a
 * card per drafted price list with the facts that matter.
 */
export default function Overview({ statuses, onSelectProduct, onOpenCompare, onOpenNav }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [tip, setTip] = useState<Tip | null>(null);

  const entries: Entry[] = useMemo(
    () =>
      PRICE_LISTS.filter((l) => filter === 'all' || l.product.category === filter).map((list) => ({
        list,
        status: statuses[list.key],
      })),
    [filter, statuses],
  );

  const drafted = entries.filter((e) => e.status?.hasDraft);
  const compared = drafted.filter((e) => e.status.compare);
  const unsynced = entries.filter((e) => e.status?.unsynced).length;

  const totals = compared.reduce(
    (t, e) => {
      const c = e.status.compare!;
      t.compared += c.compared;
      t.same += c.same;
      t.higher += c.higher;
      t.lower += c.lower;
      t.weighted += (c.avgDiffPct ?? 0) * c.compared;
      return t;
    },
    { compared: 0, same: 0, higher: 0, lower: 0, weighted: 0 },
  );
  const avgDiff = totals.compared ? totals.weighted / totals.compared : null;
  const listsDiffering = compared.filter((e) => differing(e.status.compare!) > 0).length;

  const matchRate = (e: Entry) => pct(e.status.compare!.same, e.status.compare!.compared);
  const byMatch = [...compared].sort((a, b) => matchRate(a) - matchRate(b));
  const attention = compared
    .filter((e) => differing(e.status.compare!) > 0)
    .sort((a, b) => differing(b.status.compare!) - differing(a.status.compare!))
    .slice(0, 5);
  const notDrafted = entries.filter((e) => !e.status?.hasDraft);

  const showTip: ShowTip = (e, content) => setTip({ x: e.clientX, y: e.clientY, content });
  const hideTip = () => setTip(null);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto" onMouseLeave={hideTip}>
      <header className="flex flex-wrap items-center gap-4 px-4 pb-2 pt-6 sm:px-7">
        <button className="btn btn-default px-2 lg:hidden" onClick={onOpenNav} aria-label="Open products">
          <MenuIcon />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Overview</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Drafted price lists, and where they differ from what production charges today.
          </p>
        </div>
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
      </header>

      <div className="space-y-5 px-4 py-4 sm:px-7">
        {/* ------------------------------------------------ row 1: chart + KPIs */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="card flex min-h-[360px] flex-col px-6 py-5">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Match with production</h2>
                <p className="text-xs text-slate-400">Each compared price list, lowest match rate first</p>
              </div>
              <Legend className="ml-auto" />
            </div>

            {byMatch.length === 0 ? (
              <Empty>
                No comparisons yet. Open a price list's <b className="mx-1">Compare to Production</b> tab and fetch
                production prices.
              </Empty>
            ) : (
              <ul className="mt-5 flex-1 space-y-3">
                {byMatch.slice(0, 10).map((e) => (
                  <li key={e.list.key}>
                    <button
                      onClick={() => onOpenCompare(e.list.key)}
                      className="grid w-full grid-cols-[minmax(0,190px)_minmax(0,1fr)_48px] items-center gap-3 text-left"
                    >
                      <ListName list={e.list} compact />
                      <DivergingBar summary={e.status.compare!} label={listLabel(e.list)} onHover={showTip} onLeave={hideTip} />
                      <span className="text-right text-sm font-semibold tabular-nums text-slate-800">
                        {matchRate(e).toFixed(0)}%
                      </span>
                    </button>
                  </li>
                ))}
                {byMatch.length > 10 && (
                  <li className="text-xs text-slate-400">+ {byMatch.length - 10} more — see the price lists below</li>
                )}
              </ul>
            )}
          </section>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
            <Kpi
              label="Price lists drafted"
              value={`${drafted.length}`}
              suffix={`/ ${entries.length}`}
              pill={
                unsynced > 0 ? (
                  <span className="delta bg-amber-50 text-amber-700">{unsynced} not shared yet</span>
                ) : (
                  <span className="delta bg-slate-100 text-slate-500">all shared</span>
                )
              }
            />
            <Kpi
              label="Prices compared"
              value={groupDigits(totals.compared)}
              pill={<span className="delta bg-slate-100 text-slate-500">{compared.length} price lists</span>}
              aside={
                <MiniBars
                  values={compared.map((e) => e.status.compare!.compared)}
                  labels={compared.map((e) => listLabel(e.list))}
                  onHover={showTip}
                  onLeave={hideTip}
                />
              }
            />
            <Kpi
              label="Match rate"
              value={totals.compared ? fmtPct(totals.same, totals.compared) : '—'}
              pill={
                <span className="delta bg-slate-100 text-slate-600">
                  <CheckIcon width={11} height={11} /> {groupDigits(totals.same)} identical
                </span>
              }
              aside={
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30">
                  <CompareIcon width={20} height={20} />
                </span>
              }
            />
            <Kpi
              label="Average difference"
              value={signedPct(avgDiff)}
              pill={
                <span className="delta bg-slate-100 text-slate-600">
                  {listsDiffering} of {compared.length} lists differ
                </span>
              }
            />
          </div>
        </div>

        {/* ------------------------------------------------ row 2: attention + donut */}
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card px-6 py-5">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-slate-900">Needs attention</h2>
              <span className="ml-auto text-xs text-slate-400">Most prices differing</span>
            </div>
            {attention.length === 0 ? (
              <Empty>{compared.length ? 'Every compared price list matches production.' : 'Nothing compared yet.'}</Empty>
            ) : (
              <ul className="mt-4 space-y-4">
                {attention.map(({ list, status }) => {
                  const c = status.compare!;
                  return (
                    <li key={list.key}>
                      <button onClick={() => onOpenCompare(list.key)} className="w-full text-left">
                        <div className="flex items-baseline gap-2">
                          <span className="text-base font-bold tabular-nums text-slate-900">{groupDigits(differing(c))}</span>
                          <span className="text-xs text-slate-400">of {groupDigits(c.compared)} differ</span>
                          <span className="ml-auto truncate text-xs text-slate-500">{listLabel(list)}</span>
                        </div>
                        <div className="mt-1.5">
                          <DivergingBar summary={c} label={listLabel(list)} onHover={showTip} onLeave={hideTip} height={6} />
                        </div>
                        <div className="mt-1 flex gap-3 text-[11px] text-slate-500">
                          <span className="inline-flex items-center gap-0.5">
                            <ArrowUpIcon width={11} height={11} style={{ color: DIFF.higher }} /> {groupDigits(c.higher)} higher
                          </span>
                          <span className="inline-flex items-center gap-0.5">
                            <ArrowDownIcon width={11} height={11} style={{ color: DIFF.lower }} /> {groupDigits(c.lower)} lower
                          </span>
                          <span className="ml-auto">avg {signedPct(c.avgDiffPct)}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card px-6 py-5">
            <h2 className="text-lg font-bold text-slate-900">Prices vs production</h2>
            {totals.compared === 0 ? (
              <Empty>Nothing compared yet.</Empty>
            ) : (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-10">
                <Donut totals={totals} onHover={showTip} onLeave={hideTip} />
                <ul className="space-y-4">
                  <LegendRow color={DIFF.match} icon={<CheckIcon width={12} height={12} />} label="Match" value={totals.same} of={totals.compared} />
                  <LegendRow color={DIFF.higher} icon={<ArrowUpIcon width={12} height={12} />} label="Draft higher" value={totals.higher} of={totals.compared} />
                  <LegendRow color={DIFF.lower} icon={<ArrowDownIcon width={12} height={12} />} label="Draft lower" value={totals.lower} of={totals.compared} />
                </ul>
              </div>
            )}
          </section>
        </div>

        {/* ------------------------------------------------ price list cards */}
        <section>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-lg font-bold text-slate-900">Price lists</h2>
            <span className="text-xs text-slate-400">{drafted.length} drafted</span>
          </div>
          {drafted.length === 0 ? (
            <div className="card">
              <Empty>No drafts yet — pick a product in the sidebar and paste its prices.</Empty>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {drafted.map((e) => (
                <ListCard
                  key={e.list.key}
                  entry={e}
                  onOpen={() => onSelectProduct(e.list.key)}
                  onCompare={() => onOpenCompare(e.list.key)}
                  onHover={showTip}
                  onLeave={hideTip}
                />
              ))}
            </div>
          )}

          {notDrafted.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-xs font-medium text-slate-400">Not drafted yet</div>
              <div className="flex flex-wrap gap-2">
                {notDrafted.map(({ list }) => (
                  <button
                    key={list.key}
                    onClick={() => onSelectProduct(list.key)}
                    className="inline-flex items-center gap-2 rounded-full bg-white py-1 pl-1.5 pr-3 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200/70 hover:text-slate-900"
                  >
                    <ProductThumb product={list.product} size={20} />
                    {listLabel(list)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

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

function listLabel(list: PriceList): string {
  return list.variant ? `${list.product.name} · ${list.variant.name}` : list.product.name;
}

function ListName({ list, compact }: { list: PriceList; compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <ProductThumb product={list.product} size={compact ? 26 : 36} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-slate-800">{list.product.name}</span>
        <span className="flex items-center gap-1 truncate text-[11px] text-slate-400">
          {list.variant ? (
            <>
              <Swatches options={list.variant.options} size={9} max={4} />
              {list.variant.name}
            </>
          ) : (
            list.product.english
          )}
        </span>
      </span>
    </span>
  );
}

function Kpi({
  label,
  value,
  suffix,
  pill,
  aside,
}: {
  label: string;
  value: string;
  suffix?: string;
  pill?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="card flex items-center gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-slate-400">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-slate-900">
          {value}
          {suffix && <span className="ml-1 text-sm font-medium text-slate-400">{suffix}</span>}
        </div>
        {pill && <div className="mt-1.5">{pill}</div>}
      </div>
      {aside}
    </div>
  );
}

/**
 * One price list's prices as a diverging bar: lower (blue) on the left, match
 * (gray) in the middle, higher (red) on the right, with 2px gaps between.
 */
function DivergingBar({
  summary,
  label,
  onHover,
  onLeave,
  height = 10,
}: {
  summary: CompareSummary;
  label: string;
  onHover: ShowTip;
  onLeave: () => void;
  height?: number;
}) {
  const segs = [
    { key: 'lower', n: summary.lower, color: DIFF.lower, name: 'Draft lower' },
    { key: 'same', n: summary.same, color: DIFF.match, name: 'Match' },
    { key: 'higher', n: summary.higher, color: DIFF.higher, name: 'Draft higher' },
  ].filter((s) => s.n > 0);

  return (
    <span className="flex w-full gap-[2px]" style={{ height }}>
      {segs.map((s, i) => (
        <span
          key={s.key}
          onMouseMove={(e) =>
            onHover(
              e,
              <>
                <div className="font-semibold">{label}</div>
                <div className="mt-0.5 text-slate-300">
                  {s.name}: {groupDigits(s.n)} of {groupDigits(summary.compared)} ({fmtPct(s.n, summary.compared)})
                </div>
              </>,
            )
          }
          onMouseLeave={onLeave}
          className={`${i === 0 ? 'rounded-l' : ''} ${i === segs.length - 1 ? 'rounded-r' : ''}`}
          style={{ flexGrow: s.n, flexBasis: 0, background: s.color, minWidth: 3 }}
        />
      ))}
    </span>
  );
}

/** Small bars for the "Prices compared" card — one per compared price list. */
function MiniBars({
  values,
  labels,
  onHover,
  onLeave,
}: {
  values: number[];
  labels: string[];
  onHover: ShowTip;
  onLeave: () => void;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values);
  return (
    <span className="flex h-12 items-end gap-[3px]">
      {values.slice(0, 12).map((v, i) => (
        <span
          key={i}
          onMouseMove={(e) => onHover(e, `${labels[i]}: ${groupDigits(v)} prices compared`)}
          onMouseLeave={onLeave}
          className="w-[7px] rounded-t-[3px]"
          style={{ height: `${Math.max(10, (v / max) * 100)}%`, background: DIFF.lower }}
        />
      ))}
    </span>
  );
}

function Donut({
  totals,
  onHover,
  onLeave,
}: {
  totals: { compared: number; same: number; higher: number; lower: number };
  onHover: ShowTip;
  onLeave: () => void;
}) {
  const size = 184;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const parts = [
    { name: 'Match', n: totals.same, color: DIFF.match },
    { name: 'Draft higher', n: totals.higher, color: DIFF.higher },
    { name: 'Draft lower', n: totals.lower, color: DIFF.lower },
  ].filter((p) => p.n > 0);
  // A 2px surface gap between slices.
  const gap = parts.length > 1 ? 2 : 0;

  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        {parts.map((p) => {
          const len = (p.n / totals.compared) * circumference;
          const dash = Math.max(0.5, len - gap);
          const circle = (
            <circle
              key={p.name}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              onMouseMove={(e) => onHover(e, `${p.name}: ${groupDigits(p.n)} (${fmtPct(p.n, totals.compared)})`)}
              onMouseLeave={onLeave}
            />
          );
          offset += len;
          return circle;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] text-slate-400">Total</span>
        <span className="text-2xl font-bold tabular-nums text-slate-900">{groupDigits(totals.compared)}</span>
        <span className="text-[11px] text-slate-400">prices</span>
      </div>
    </div>
  );
}

function LegendRow({ color, icon, label, value, of }: { color: string; icon: ReactNode; label: string; value: number; of: number }) {
  return (
    <li>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {label}
        <span className="text-slate-500">{icon}</span>
      </div>
      <div className="mt-0.5 pl-[18px] text-base font-bold tabular-nums text-slate-900">
        {groupDigits(value)} <span className="text-xs font-medium text-slate-400">{fmtPct(value, of)}</span>
      </div>
    </li>
  );
}

function Legend({ className = '' }: { className?: string }) {
  const item = (color: string, label: string, icon: ReactNode) => (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
      <span className="text-slate-400">{icon}</span>
    </span>
  );
  return (
    <div className={`flex flex-wrap items-center gap-4 text-xs text-slate-500 ${className}`}>
      {item(DIFF.lower, 'Draft lower', <ArrowDownIcon width={11} height={11} />)}
      {item(DIFF.match, 'Match', <CheckIcon width={11} height={11} />)}
      {item(DIFF.higher, 'Draft higher', <ArrowUpIcon width={11} height={11} />)}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center px-4 py-12 text-center text-sm text-slate-400">{children}</div>;
}

/** A drafted price list: what is in the draft, and how it compares. */
function ListCard({
  entry,
  onOpen,
  onCompare,
  onHover,
  onLeave,
}: {
  entry: Entry;
  onOpen: () => void;
  onCompare: () => void;
  onHover: ShowTip;
  onLeave: () => void;
}) {
  const { list, status: s } = entry;
  const c = s.compare;
  const range = (a: number | null, b: number | null) =>
    a == null || b == null ? '—' : a === b ? groupDigits(a) : `${groupDigits(a)} – ${groupDigits(b)}`;

  return (
    <article className="card flex flex-col px-5 py-4">
      <div className="flex items-start gap-3">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <ListName list={list} />
        </button>
        {s.unsynced ? (
          <span className="delta bg-amber-50 text-amber-700">not shared</span>
        ) : c ? (
          differing(c) === 0 ? (
            <span className="delta bg-slate-100 text-slate-600">✓ matches</span>
          ) : (
            <span className="delta bg-slate-800 text-white">Δ {groupDigits(differing(c))}</span>
          )
        ) : (
          <span className="delta bg-slate-100 text-slate-500">not compared</span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
        <Fact label="Rows · prices" value={`${groupDigits(s.rows)} · ${groupDigits(s.prices)}`} />
        <Fact label="Base area" value={range(s.areaMin, s.areaMax)} sub="mm²" />
        <Fact label="Quantities" value={range(s.qtyMin, s.qtyMax)} sub={`${s.columns} columns`} />
      </dl>

      {c ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums text-slate-900">{fmtPct(c.same, c.compared)}</span>
            <span className="text-xs text-slate-400">match of {groupDigits(c.compared)} compared</span>
          </div>
          <DivergingBar summary={c} label={listLabel(list)} onHover={onHover} onLeave={onLeave} height={8} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-0.5">
              <ArrowUpIcon width={11} height={11} style={{ color: DIFF.higher }} /> {groupDigits(c.higher)} higher
            </span>
            <span className="inline-flex items-center gap-0.5">
              <ArrowDownIcon width={11} height={11} style={{ color: DIFF.lower }} /> {groupDigits(c.lower)} lower
            </span>
            <span>avg {signedPct(c.avgDiffPct)}</span>
            {c.largest && <span>largest {signedPct(c.largest.diffPct)}</span>}
            {s.roundTo > 1 && <span>rounded to ₩{s.roundTo}</span>}
          </div>
        </div>
      ) : (
        <button
          onClick={onCompare}
          className="mt-4 rounded-xl border border-dashed border-slate-200 py-3 text-xs text-slate-500 hover:border-brand-300 hover:text-brand-600"
        >
          Not compared yet — fetch production prices
        </button>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
        <span>
          Edited {timeAgo(s.updatedAt)}
          {s.updatedBy ? ` by ${s.updatedBy}` : ''}
        </span>
        {s.pricingName && <span className="truncate">· {s.pricingName}</span>}
        {s.comparedAt && <span>· fetched {timeAgo(s.comparedAt)}</span>}
        <button onClick={onCompare} className="ml-auto font-medium text-brand-600 hover:text-brand-700">
          Compare →
        </button>
      </div>
    </article>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className="truncate font-semibold tabular-nums text-slate-800" title={value}>
        {value}
      </dd>
      {sub && <dd className="text-[10px] text-slate-400">{sub}</dd>}
    </div>
  );
}
