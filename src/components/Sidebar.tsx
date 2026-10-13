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

/**
 * The product list, in the light "Directories / Reports" style: section
 * headings in muted text, the active item lifted onto a white card.
 */
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
      {open && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={onClose} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[272px] shrink-0 flex-col bg-[#f5f6fa] transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        }`}
      >
        {/* ---------------------------------------------------- title */}
        <div className="flex items-start gap-2 px-5 pb-3 pt-6">
          <div className="min-w-0 flex-1">
            <div className="text-xl font-bold tracking-tight text-slate-900">Pricer Studio</div>
            <div className="mt-0.5 text-xs text-slate-400">
              {draftedCount} of {PRICE_LISTS.length} price lists drafted
            </div>
          </div>
          <button className="rounded-md p-1 text-slate-400 hover:bg-white lg:hidden" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Overview lives in the icon rail on wide screens; the drawer needs its own. */}
        <div className="px-3 lg:hidden">
          <NavItem active={view === 'overview'} onClick={onOverview}>
            <GridIcon className="text-slate-500" />
            <span className="flex-1">Overview</span>
          </NavItem>
        </div>

        {/* ---------------------------------------------------- search */}
        <div className="px-4 pb-1 pt-2">
          <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-slate-400 shadow-sm ring-1 ring-slate-200/70 focus-within:ring-brand-300">
            <SearchIcon width={15} height={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, colors, materials"
              className="w-full bg-transparent text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
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
              <div key={cat.id} className="mt-4">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [cat.id]: !c[cat.id] }))}
                  className="flex w-full items-center gap-1.5 px-2 pb-1.5 text-xs font-medium text-slate-400 hover:text-slate-600"
                >
                  {cat.english}
                  <span className="text-slate-300">{cat.name}</span>
                  <ChevronIcon
                    width={12}
                    height={12}
                    className={`ml-auto transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                  />
                </button>
                {!isCollapsed && (
                  <ul className="space-y-0.5">
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
                        <li key={product.slug}>
                          <NavItem
                            active={view === 'product' && product.slug === activeSlug}
                            onClick={() => onSelectProduct(product.slug)}
                          >
                            <ProductThumb product={product} size={28} />
                            <ItemLabel name={product.name} sub={product.english} />
                            <StatusBadge status={statuses[product.slug]} />
                          </NavItem>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="px-2 py-8 text-center text-xs text-slate-400">No products match.</div>}
        </nav>

        {/* ---------------------------------------------------- settings */}
        <div className="px-3 pb-4">
          <div className="card space-y-2.5 px-4 py-3.5">
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-16 shrink-0">Your name</span>
              <input
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="shown as “saved by”"
                maxLength={60}
                className="min-w-0 flex-1 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-800 ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-brand-300"
              />
            </label>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-16 shrink-0" title="Decimal places for the exported price-per-mm² rates">Rate dp</span>
              <DpInput
                label="min"
                title="Decimal places the precision search starts at"
                value={options.minDecimalPlaces}
                min={0}
                max={options.maxDecimalPlaces}
                onChange={(v) => setOptions({ ...options, minDecimalPlaces: Math.max(0, v) })}
              />
              <DpInput
                label="max"
                title="Upper bound for the precision search"
                value={options.maxDecimalPlaces}
                min={options.minDecimalPlaces}
                max={30}
                onChange={(v) => setOptions({ ...options, maxDecimalPlaces: Math.min(30, v) })}
              />
            </div>
            <SyncStatusLine sync={sync} browserSaved={saved} />
          </div>
        </div>
      </aside>
    </>
  );
}

function NavItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
        active ? 'bg-white text-slate-900 shadow-card' : 'text-slate-600 hover:bg-white/70'
      }`}
    >
      {children}
    </button>
  );
}

function ItemLabel({ name, sub }: { name: string; sub: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[13px] font-medium">{name}</div>
      <div className="truncate text-[11px] text-slate-400">{sub}</div>
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
      <div className="flex items-center gap-2.5 px-2.5 pb-1 pt-2 text-slate-600">
        <ProductThumb product={product} size={28} />
        <ItemLabel name={product.name} sub={`${product.english} · priced by ${product.variants?.[0].kind ?? 'option'}`} />
      </div>
      <ul className="ml-[22px] space-y-0.5 border-l border-slate-200 pl-2">
        {lists.map((list) => (
          <li key={list.key}>
            <NavItem active={list.key === activeKey} onClick={() => onSelect(list.key)}>
              {list.variant && <Swatches options={list.variant.options} size={10} max={4} />}
              <ItemLabel name={list.variant?.name ?? ''} sub={list.variant?.english ?? ''} />
              <StatusBadge status={statuses[list.key]} />
            </NavItem>
          </li>
        ))}
      </ul>
    </li>
  );
}

const SYNC_LABEL: Record<CloudSync['status'], { dot: string; text: string }> = {
  connecting: { dot: 'bg-slate-300 animate-pulse', text: 'Connecting to shared drafts…' },
  synced: { dot: 'bg-emerald-500', text: 'Shared — everyone sees these drafts' },
  saving: { dot: 'bg-brand-500 animate-pulse', text: 'Saving to shared drafts…' },
  offline: { dot: 'bg-amber-400', text: 'Offline — saved here, will share when back' },
  'not-configured': { dot: 'bg-amber-400', text: 'Shared storage not set up — this browser only' },
  locked: { dot: 'bg-red-500', text: 'Passcode needed for shared drafts' },
  error: { dot: 'bg-red-500', text: 'Shared drafts unavailable — saved here' },
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
    <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
      <button
        onClick={sync.syncNow}
        title={[sync.message, sync.lastSyncedAt ? `Last synced ${timeAgo(sync.lastSyncedAt)}` : null, 'Click to sync now']
          .filter(Boolean)
          .join('\n')}
        className="flex w-full items-center gap-1.5 text-left text-[11px] text-slate-500 hover:text-slate-800"
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
            className="min-w-0 flex-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-brand-300"
          />
          <button className="rounded-lg bg-brand-600 px-2.5 text-xs font-medium text-white hover:bg-brand-700">Unlock</button>
        </form>
      )}
      {!browserSaved && <div className="text-[11px] text-amber-600">This browser is not keeping a local copy.</div>}
    </div>
  );
}

/** Draft / comparison state at a glance. Differences are counted, never colored by direction here. */
function StatusBadge({ status }: { status: ProductStatus | undefined }) {
  if (status?.unsynced) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Edited here — not shared yet" />;
  }
  if (!status?.hasDraft) return null;
  const c = status.compare;
  if (!c) {
    return <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">draft</span>;
  }
  const changed = c.higher + c.lower;
  if (changed === 0) {
    return (
      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600" title="Matches production">
        ✓ match
      </span>
    );
  }
  return (
    <span
      className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white"
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
    <label className="flex flex-1 items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 ring-1 ring-slate-200" title={title}>
      <span className="text-[10px] uppercase text-slate-400">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="no-spin w-full min-w-[1.75rem] bg-transparent text-right text-xs tabular-nums text-slate-800 focus:outline-none"
      />
    </label>
  );
}
