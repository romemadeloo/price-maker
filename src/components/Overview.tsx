import { useMemo, useState, type ReactNode } from 'react';
import { CATEGORIES, PRICE_LISTS, type CategoryId, type PriceList } from '../lib/products';
import { groupDigits } from '../lib/decimal';
import { DIFF } from '../lib/compareColors';
import type { ProductStatus } from '../state/workspace';
import type { CompareSummary } from '../lib/production';
import Swatches from './Swatches';
import ProductThumb from './ProductThumb';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, MenuIcon } from './icons';

interface Props {
  statuses: Record<string, ProductStatus>;
  onSelectProduct: (key: string) => void;
  onOpenCompare: (key: string) => void;
  onOpenNav: () => void;
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
export default function Overview({ statuses, onSelectProduct, onOpenCompare, onOpenNav }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [tip, setTip] = useState<Tip | null>(null);

  const { compared, uncompared, undrafted } = useMemo(() => {
    const entries: Entry[] = PRICE_LISTS.filter((l) => filter === 'all' || l.product.category === filter).map((list) => ({
      list,
      status: statuses[list.key],
    }));
    return {
      compared: entries
        .filter((e) => e.status?.compare)
        .sort((a, b) => matchRate(a.status!.compare!) - matchRate(b.status!.compare!)),
      uncompared: entries.filter((e) => e.status?.hasDraft && !e.status.compare),
      undrafted: entries.filter((e) => !e.status?.hasDraft),
    };
  }, [filter, statuses]);

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
            <h1 className="text-lg font-bold text-slate-900">Match with production</h1>
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

        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-6 pb-5">
          {compared.map(({ list, status }) => {
            const c = status!.compare!;
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
                <span className="-mt-px bg-white px-1.5 text-[10px] leading-none text-slate-400">drafted · not compared yet</span>
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
