import { useMemo, useState } from 'react';
import { CATEGORIES, PRICE_LISTS, PRODUCTS, priceListsOf, type PriceList, type Product } from '../lib/products';
import Swatches from './Swatches';
import ProductThumb from './ProductThumb';
import type { ProductStatus } from '../state/workspace';
import { ChevronIcon, CloseIcon, GearIcon, GridIcon, SearchIcon } from './icons';


const RAIL_KEY = 'pricer.sidebarCollapsed';

interface Props {
  view: 'overview' | 'product' | 'settings';
  activeSlug: string;
  statuses: Record<string, ProductStatus>;
  onSelectProduct: (slug: string) => void;
  onOverview: () => void;
  onSettings: () => void;
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
  onSettings,
  open,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** Icon-only rail on wide screens; remembered per browser. */
  const [rail, setRail] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleRail = () =>
    setRail((r) => {
      try {
        localStorage.setItem(RAIL_KEY, r ? '0' : '1');
      } catch {
        /* storage unavailable: still toggles for this visit */
      }
      return !r;
    });

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
        className={`glass fixed inset-y-3 left-3 z-40 flex w-[264px] shrink-0 flex-col overflow-hidden rounded-3xl transition-[transform,width] duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        } ${rail ? 'sb-rail lg:w-[76px]' : ''}`}
      >
        {/* ---------------------------------------------------- title */}
        <div className="sb-title flex items-center gap-2.5 px-5 pb-3 pt-5">
          <div className="sb-text min-w-0 flex-1">
            <div className="text-lg font-bold tracking-tight text-slate-900">Pricer Studio</div>
            <div className="mt-0.5 text-xs text-slate-400">
              {draftedCount} of {PRICE_LISTS.length} price lists drafted
            </div>
          </div>
          <button className="rounded-md p-1 text-slate-400 hover:bg-white lg:hidden" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
          <button
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/80 hover:text-slate-700 lg:flex"
            onClick={toggleRail}
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronIcon width={16} height={16} className={rail ? '' : 'rotate-180'} />
          </button>
        </div>

        {/* ---------------------------------------------------- menu */}
        <div className="space-y-0.5 px-3">
          <button className="menu-item" title="Overview" aria-current={view === 'overview' ? 'page' : undefined} onClick={onOverview}>
            <GridIcon width={16} height={16} />
            <span>Overview</span>
          </button>
        </div>

        {/* Collapsed: a search button that reopens the sidebar, then one image per product. */}
        <div className="sb-rail-only hidden px-3 pt-2">
          <button className="menu-item" title="Price lists" onClick={toggleRail}>
            <SearchIcon width={16} height={16} />
          </button>
        </div>
        <ul className="sb-rail-only hidden min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3 pt-1">
          {PRODUCTS.map((product) => {
            const lists = priceListsOf(product);
            // A product priced per option opens the list already open, else its first.
            const current = lists.find((l) => view === 'product' && l.key === activeSlug);
            const target = current ?? lists[0];
            const drafted = lists.some((l) => statuses[l.key]?.hasDraft);
            const unsynced = lists.some((l) => statuses[l.key]?.unsynced);
            return (
              <li key={product.slug}>
                <button
                  onClick={() => onSelectProduct(target.key)}
                  title={`${product.name} · ${product.english}${lists.length > 1 ? ` (${lists.length} price lists)` : ''}`}
                  aria-label={product.english}
                  aria-current={current ? 'page' : undefined}
                  className={`relative flex h-11 w-full items-center justify-center rounded-xl transition ${
                    current ? 'bg-white/90 shadow-glass ring-1 ring-brand-300' : 'hover:bg-white/70'
                  }`}
                >
                  <ProductThumb product={product} size={30} />
                  {(unsynced || drafted) && (
                    <span
                      className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-white ${
                        unsynced ? 'bg-amber-400' : 'bg-brand-500'
                      }`}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* ---------------------------------------------------- search */}
        <div className="sb-full px-4 pb-1 pt-2">
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
        <nav className="sb-full min-h-0 flex-1 overflow-y-auto px-3 pb-6">
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

        <div className="border-t border-white/70 px-3 py-2.5">
          <button className="menu-item" title="Settings" aria-current={view === 'settings' ? 'page' : undefined} onClick={onSettings}>
            <GearIcon width={16} height={16} />
            <span>Settings</span>
          </button>
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
        active ? 'bg-white/90 text-slate-900 shadow-glass ring-1 ring-brand-200' : 'text-slate-600 hover:bg-white/60'
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
      <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700" title="Matches production">
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
