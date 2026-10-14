import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, priceListName, type CategoryId, type PriceList } from '../lib/products';
import { timeAgo } from '../lib/format';
import { COMPARE_SPECS, specId, specLabel, type BulkCompare } from '../hooks/useBulkCompare';
import { CheckIcon, ChevronIcon, RefreshIcon } from './icons';

export type SyncScope = 'all' | CategoryId;

interface Props {
  bulk: BulkCompare;
  /** Drafted price lists in a scope — what a sync would fetch prices for. */
  draftedIn: (scope: SyncScope) => PriceList[];
}

const SPECS_KEY = 'pricer-maker:compare-all-specs';
const SCOPE_KEY = 'pricer-maker:sync-scope';

/** The combinations a sync runs, remembered per browser. All four by default. */
function loadSpecIds(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(SPECS_KEY) ?? 'null');
    if (Array.isArray(stored)) return COMPARE_SPECS.map(specId).filter((id) => stored.includes(id));
  } catch {
    /* fall through */
  }
  return COMPARE_SPECS.map(specId);
}

function loadScope(): SyncScope {
  try {
    const stored = localStorage.getItem(SCOPE_KEY);
    if (stored && CATEGORIES.some((c) => c.id === stored)) return stored as CategoryId;
  } catch {
    /* fall through */
  }
  return 'all';
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not remembered — fine */
  }
}

const scopeName = (scope: SyncScope) =>
  scope === 'all' ? 'All products' : (CATEGORIES.find((c) => c.id === scope)?.english ?? scope);

/**
 * One button at the top of every page: fetch prices — production and dev,
 * normal and Studio Editor — for every drafted price list, or one category's.
 * The arrow opens the choices; results land in the shared database list by list.
 */
export default function SyncPrices({ bulk, draftedIn }: Props) {
  const [open, setOpen] = useState(false);
  const [scope, setScopeState] = useState<SyncScope>(loadScope);
  const [specIds, setSpecIds] = useState<string[]>(loadSpecIds);
  const root = useRef<HTMLDivElement>(null);

  const specs = COMPARE_SPECS.filter((s) => specIds.includes(specId(s)));
  const lists = draftedIn(scope);
  const jobs = lists.length * specs.length;

  const setScope = (next: SyncScope) => {
    setScopeState(next);
    remember(SCOPE_KEY, next);
  };
  const toggleSpec = (id: string) =>
    setSpecIds((ids) => {
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      remember(SPECS_KEY, JSON.stringify(next));
      return next;
    });
  const run = () => {
    setOpen(false);
    void bulk.run(lists, specs);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const p = bulk.progress;
  if (p) {
    const share = ((p.job - 1 + p.done / Math.max(1, p.total)) / p.jobs) * 100;
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-full bg-white py-1 pl-3.5 pr-1 text-xs text-slate-500 shadow-sm ring-1 ring-slate-200/70">
        <RefreshIcon width={13} height={13} className="shrink-0 animate-spin text-brand-600 [animation-duration:1.6s]" />
        <span className="min-w-0 truncate" title={`${priceListName(p.list)} · ${specLabel(p)}`}>
          Syncing <b className="tabular-nums text-slate-800">{p.job}</b>/{p.jobs} · {priceListName(p.list)} ·{' '}
          <SpecTag server={p.server} /> {p.target === 'studio' ? 'Studio Editor' : 'Price'}
        </span>
        <span className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100">
          <span className="block h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${share}%` }} />
        </span>
        <button className="rounded-full px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-100" onClick={bulk.cancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div ref={root} className="relative flex items-center gap-2">
      <div className="flex rounded-full shadow-md shadow-brand-600/25">
        <button
          className="flex items-center gap-1.5 rounded-l-full bg-brand-600 py-1.5 pl-3.5 pr-3 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={run}
          disabled={jobs === 0}
          title={`Fetch ${specs.map(specLabel).join(', ') || 'nothing — pick at least one'} for ${lists.length} drafted price list(s) in ${scopeName(scope)}`}
        >
          <RefreshIcon width={13} height={13} />
          Sync prices
          <span className="font-normal text-white/80">· {scopeName(scope)}</span>
        </button>
        <button
          className="rounded-r-full border-l border-white/25 bg-brand-600 px-2 text-white hover:bg-brand-700"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Choose what to sync"
        >
          <ChevronIcon width={13} height={13} className={`transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
        </button>
      </div>

      {bulk.result && (
        <span className="hidden text-[11px] text-slate-400 xl:inline" title="Saved to the shared database">
          {bulk.result.cancelled ? 'Stopped' : 'Synced'} {bulk.result.finished}/{bulk.result.jobs} · {timeAgo(bulk.result.at)}
          {bulk.result.skipped > 0 && ` · ${bulk.result.skipped} skipped`}
        </span>
      )}

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] rounded-2xl bg-white p-4 text-xs text-slate-600 shadow-xl ring-1 ring-slate-200">
          <div className="mb-1.5 font-semibold text-slate-800">Products</div>
          <div className="flex flex-col gap-0.5">
            {(['all', ...CATEGORIES.map((c) => c.id)] as SyncScope[]).map((s) => {
              const n = draftedIn(s).length;
              return (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left ${
                    scope === s ? 'bg-brand-50 font-semibold text-brand-700' : 'hover:bg-slate-50'
                  }`}
                >
                  {scopeName(s)}
                  <span className="tabular-nums text-slate-400">
                    {n} drafted
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mb-1.5 mt-3 font-semibold text-slate-800">Prices to fetch</div>
          <div className="grid grid-cols-2 gap-1.5">
            {COMPARE_SPECS.map((spec) => {
              const id = specId(spec);
              const on = specIds.includes(id);
              return (
                <button
                  key={id}
                  aria-pressed={on}
                  onClick={() => toggleSpec(id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-left ring-1 ${
                    on ? 'bg-brand-50 text-brand-800 ring-brand-300' : 'text-slate-500 ring-slate-200 hover:text-slate-700'
                  }`}
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                      on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {on && <CheckIcon width={10} height={10} />}
                  </span>
                  <SpecTag server={spec.server} />
                  {spec.target === 'studio' ? 'Studio Editor' : 'Price'}
                </button>
              );
            })}
          </div>

          <button className="btn btn-primary mt-4 w-full justify-center" onClick={run} disabled={jobs === 0}>
            <RefreshIcon width={13} height={13} />
            Sync {lists.length} price list{lists.length === 1 ? '' : 's'} × {specs.length}
          </button>
          <p className="mt-2 text-[11px] leading-snug text-slate-400">
            {jobs === 0
              ? lists.length === 0
                ? 'Nothing drafted here yet.'
                : 'Pick at least one kind of price.'
              : `${jobs} comparison${jobs === 1 ? '' : 's'}, one list at a time. Each is saved to the shared database as it finishes, so everyone sees it — and Cancel keeps what is done.`}
          </p>
        </div>
      )}
    </div>
  );
}

function SpecTag({ server }: { server: 'production' | 'dev' }) {
  return (
    <span
      className={`rounded px-1 text-[10px] font-semibold uppercase ${
        server === 'dev' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {server === 'dev' ? 'dev' : 'prod'}
    </span>
  );
}
