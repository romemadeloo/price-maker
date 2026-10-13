import { useMemo, useState, type FormEvent } from 'react';
import type { CloudSync } from '../hooks/useCloudSync';
import { timeAgo } from '../lib/format';
import { CATEGORIES, PRICE_LISTS, PRODUCTS, priceListsOf, type PriceList, type Product } from '../lib/products';
import Swatches from './Swatches';
import ProductThumb from './ProductThumb';
import type { ProductStatus } from '../state/workspace';
import type { EngineOptions } from '../types';
import { ChevronIcon, CloseIcon, GridIcon, SearchIcon } from './icons';

interface Props {
  view: 'overview' | 'product';
  activeSlug: string;
  statuses: Record<string, ProductStatus>;
  onSelectProduct: (slug: string) => void;
  onOverview: () => void;
  options: EngineOptions;
  setOptions: (o: EngineOptions) => void;
  saved: boolean;
  sync: CloudSync;
  userName: string;
  setUserName: (name: string) => void;
  /** Drawer state below the lg breakpoint; the sidebar is always shown above it. */
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({
  view,
  activeSlug,
  statuses,
  onSelectProduct,
  onOverview,
  options,
  setOptions,
  saved,
  sync,
  userName,
  setUserName,
  open,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /** Matching products, each with the price lists to show under it. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
    return PRODUCTS.flatMap((product) => {
      const lists = priceListsOf(product);
      if (matches(product.name, product.english, product.slug)) return [{ product, lists }];
      // Searching a color or material ("gold", "투명") finds the price list it belongs to.
      const hits = lists.filter(
        (l) => l.variant && matches(l.variant.name, l.variant.english, ...l.variant.options.map((c) => c.name)),
      );
      return hits.length > 0 ? [{ product, lists: hits }] : [];
    });
  }, [query]);

  const draftedCount = PRICE_LISTS.filter((l) => statuses[l.key]?.hasDraft).length;

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={onClose} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col bg-slate-950 text-slate-300 transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* ---------------------------------------------------- brand */}
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold text-white shadow-lg shadow-brand-900/40">
            ₩
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold tracking-tight text-white">Pricer Studio</div>
            <div className="text-[11px] text-slate-500">Draft vs production · musticker</div>
          </div>
          <button className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-white lg:hidden" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="px-3">
          <button
            onClick={onOverview}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              view === 'overview' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <GridIcon />
            Overview
            <span className="ml-auto rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-400">
              {draftedCount}/{PRICE_LISTS.length}
            </span>
          </button>
        </div>

        {/* ---------------------------------------------------- search */}
        <div className="px-3 pb-2 pt-4">
          <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-slate-500 focus-within:border-brand-500">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products"
              className="w-full bg-transparent text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none"
            />
          </label>
        </div>

        {/* ---------------------------------------------------- products */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {CATEGORIES.map((cat) => {
            const items = filtered.filter(({ product }) => product.category === cat.id);
            if (items.length === 0) return null;
            const isCollapsed = collapsed[cat.id] && !query;
            return (
              <div key={cat.id} className="mt-3">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [cat.id]: !c[cat.id] }))}
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300"
                >
                  <ChevronIcon
                    width={12}
                    height={12}
                    className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                  />
                  {cat.english}
                  <span className="font-normal normal-case tracking-normal text-slate-600">{cat.name}</span>
                </button>
                {!isCollapsed && (
                  <ul className="mt-0.5 space-y-0.5">
                    {items.map(({ product, lists }) =>
                      product.variants ? (
                        <VariantGroup
                          key={product.slug}
                          product={product}
                          lists={lists}
                          statuses={statuses}
                          activeKey={view === 'product' ? activeSlug : null}
                          onSelect={onSelectProduct}
                        />
                      ) : (
                        <ProductItem
                          key={product.slug}
                          product={product}
                          status={statuses[product.slug]}
                          active={view === 'product' && product.slug === activeSlug}
                          onClick={() => onSelectProduct(product.slug)}
                        />
                      ),
                    )}
                  </ul>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="px-2 py-6 text-center text-xs text-slate-600">No products match.</div>}
        </nav>

        {/* ---------------------------------------------------- settings */}
        <div className="border-t border-slate-800 px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Rate precision</div>
          <div className="mt-2 flex items-center gap-3">
            <DpInput
              label="Min dp"
              title="Decimal places the search starts at"
              value={options.minDecimalPlaces}
              min={0}
              max={options.maxDecimalPlaces}
              onChange={(v) => setOptions({ ...options, minDecimalPlaces: Math.max(0, v) })}
            />
            <DpInput
              label="Max dp"
              title="Upper bound for the precision search"
              value={options.maxDecimalPlaces}
              min={options.minDecimalPlaces}
              max={30}
              onChange={(v) => setOptions({ ...options, maxDecimalPlaces: Math.min(30, v) })}
            />
          </div>
          <label className="mt-3 flex items-center gap-2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-400">
            Your name
            <input
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="shown as “edited by”"
              maxLength={60}
              className="min-w-0 flex-1 bg-transparent text-right text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none"
            />
          </label>
          <SyncStatusLine sync={sync} browserSaved={saved} />
        </div>
      </aside>
    </>
  );
}

const SYNC_LABEL: Record<CloudSync['status'], { dot: string; text: string }> = {
  connecting: { dot: 'bg-slate-500 animate-pulse', text: 'Connecting to shared drafts…' },
  synced: { dot: 'bg-emerald-400', text: 'Shared — everyone sees these drafts' },
  saving: { dot: 'bg-brand-400 animate-pulse', text: 'Saving to shared drafts…' },
  offline: { dot: 'bg-amber-400', text: 'Offline — saved here, will share when back' },
  'not-configured': { dot: 'bg-amber-400', text: 'Shared storage not set up — this browser only' },
  locked: { dot: 'bg-red-400', text: 'Passcode needed for shared drafts' },
  error: { dot: 'bg-red-400', text: 'Shared drafts unavailable — saved here' },
};

function SyncStatusLine({ sync, browserSaved }: { sync: CloudSync; browserSaved: boolean }) {
  const [passcode, setPasscode] = useState('');
  const label = SYNC_LABEL[sync.status];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (passcode.trim()) sync.unlock(passcode);
    setPasscode('');
  };

  return (
    <div className="mt-3 space-y-1.5">
      <button
        onClick={sync.syncNow}
        title={[sync.message, sync.lastSyncedAt ? `Last synced ${timeAgo(sync.lastSyncedAt)}` : null, 'Click to sync now']
          .filter(Boolean)
          .join('\n')}
        className="flex w-full items-center gap-1.5 text-left text-[11px] text-slate-500 hover:text-slate-300"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${label.dot}`} />
        {label.text}
      </button>
      {sync.status === 'locked' && (
        <form onSubmit={submit} className="flex gap-1.5">
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Team passcode"
            className="min-w-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
          />
          <button className="rounded-lg bg-brand-600 px-2.5 text-xs font-medium text-white hover:bg-brand-500">Unlock</button>
        </form>
      )}
      {!browserSaved && <div className="text-[11px] text-amber-400">This browser is not keeping a local copy.</div>}
    </div>
  );
}

/** A product priced per option: its name, then one entry per price list. */
function VariantGroup({
  product,
  lists,
  statuses,
  activeKey,
  onSelect,
}: {
  product: Product;
  lists: PriceList[];
  statuses: Record<string, ProductStatus>;
  activeKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <li>
      <div className="flex items-center gap-2.5 px-2.5 pb-0.5 pt-1.5">
        <ProductThumb product={product} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-slate-300">{product.name}</div>
          <div className="truncate text-[11px] text-slate-500">
            {product.english} · priced by {product.variants?.[0].kind ?? 'option'}
          </div>
        </div>
      </div>
      <ul className="ml-6 space-y-0.5 border-l border-slate-800 pl-2">
        {lists.map((list) => {
          const active = list.key === activeKey;
          return (
            <li key={list.key}>
              <button
                onClick={() => onSelect(list.key)}
                className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors ${
                  active ? 'bg-brand-600/15 text-white ring-1 ring-inset ring-brand-500/40' : 'hover:bg-slate-900'
                }`}
              >
                {list.variant && <Swatches options={list.variant.options} size={10} max={4} />}
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-[12px] ${active ? 'font-medium text-white' : 'text-slate-300 group-hover:text-white'}`}
                  >
                    {list.variant?.name}
                  </div>
                  <div className="truncate text-[10px] text-slate-500">{list.variant?.english}</div>
                </div>
                <StatusBadge status={statuses[list.key]} />
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function ProductItem({
  product,
  status,
  active,
  onClick,
}: {
  product: Product;
  status: ProductStatus | undefined;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
          active ? 'bg-brand-600/15 text-white ring-1 ring-inset ring-brand-500/40' : 'hover:bg-slate-900'
        }`}
      >
        <ProductThumb product={product} size={30} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[13px] ${active ? 'font-medium text-white' : 'text-slate-300 group-hover:text-white'}`}>
            {product.name}
          </div>
          <div className="truncate text-[11px] text-slate-500">{product.english}</div>
        </div>
        <StatusBadge status={status} />
      </button>
    </li>
  );
}

/** Draft / comparison state at a glance. */
function StatusBadge({ status }: { status: ProductStatus | undefined }) {
  if (status?.unsynced) {
    return (
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Edited here — not shared yet" />
    );
  }
  if (!status?.hasDraft) return null;
  const c = status.compare;
  if (!c) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-inset ring-slate-700">
        draft
      </span>
    );
  }
  const changed = c.higher + c.lower;
  if (changed === 0) {
    return (
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400" title="Matches production">
        =
      </span>
    );
  }
  return (
    <span
      className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-300"
      title={`${changed.toLocaleString()} price(s) differ from production`}
    >
      Δ {changed.toLocaleString()}
    </span>
  );
}

function DpInput({
  label,
  title,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  title: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-1 items-center justify-between gap-2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-400" title={title}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-10 bg-transparent text-right text-xs tabular-nums text-slate-100 focus:outline-none"
      />
    </label>
  );
}
