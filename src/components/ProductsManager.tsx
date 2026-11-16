import { useState } from 'react';
import {
  CATEGORIES,
  PRODUCTS,
  priceListsOf,
  slugProblem,
  type CategoryId,
  type CustomProduct,
  type Product,
} from '../lib/products';
import ProductThumb from './ProductThumb';
import { CloseIcon, MenuIcon, TrashIcon } from './icons';

interface Props {
  onAdd: (product: CustomProduct) => void;
  onEdit: (slug: string, change: Pick<CustomProduct, 'name' | 'english' | 'category'>) => void;
  onSetActive: (slug: string, active: boolean) => void;
  onDelete: (slug: string) => void;
  onOpenProduct: (key: string) => void;
  onOpenNav: () => void;
  /** Products with a drafted price table, to warn before a delete. */
  draftedSlugs: Set<string>;
}

type Dialog = { mode: 'add' } | { mode: 'edit'; product: Product } | null;

/** "Sticker pack" → "sticker-pack" */
const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Manage the catalog: add products, rename or move them, switch them off
 * (kept, but out of the overview, comparisons and sync) or delete them.
 * Shared with everyone through the settings record.
 */
export default function ProductsManager({ onAdd, onEdit, onSetActive, onDelete, onOpenProduct, onOpenNav, draftedSlugs }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showInactive, setShowInactive] = useState(true);
  const inactiveCount = PRODUCTS.filter((p) => p.inactive).length;

  const confirmDelete = (p: Product) => {
    const lists = priceListsOf(p).length;
    const drafted = draftedSlugs.has(p.slug);
    const warn = drafted
      ? `\n\nIts drafted price ${lists > 1 ? 'tables' : 'table'} will be deleted for everyone. Consider marking it inactive instead.`
      : '';
    if (window.confirm(`Delete “${p.name}” (${p.slug})?${warn}\n\nThis cannot be undone.`)) onDelete(p.slug);
  };

  return (
    <div className="h-full min-w-0 overflow-y-auto px-4 pb-[var(--dock-clear)] pt-3 sm:px-7">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-default px-2 lg:hidden" onClick={onOpenNav} aria-label="Open products">
            <MenuIcon />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-slate-900">Products</h1>
            <p className="text-xs text-slate-400">
              {PRODUCTS.length - inactiveCount} active{inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ''}. Shared with
              everyone using this workspace.
            </p>
          </div>
          {inactiveCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
          )}
          <button className="btn btn-primary" onClick={() => setDialog({ mode: 'add' })}>
            + Add product
          </button>
        </div>

        {CATEGORIES.map((cat) => {
          const items = PRODUCTS.filter((p) => p.category === cat.id && (showInactive || !p.inactive));
          return (
            <section key={cat.id} className="card p-2">
              <h2 className="px-3 pb-1 pt-2 text-xs font-medium text-slate-400">
                {cat.english} <span className="text-slate-300">{cat.name}</span>
              </h2>
              {items.length === 0 && <div className="px-3 pb-3 text-xs text-slate-400">No products.</div>}
              <ul>
                {items.map((p) => (
                  <li
                    key={p.slug}
                    className={`flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50 ${p.inactive ? 'opacity-60' : ''}`}
                  >
                    <ProductThumb product={p} size={30} />
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onOpenProduct(priceListsOf(p)[0].key)}
                      title="Open this product's price table"
                    >
                      <span className="block truncate text-[13px] font-medium text-slate-800">{p.name}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {p.english} · <span className="font-mono">{p.slug}</span>
                      </span>
                    </button>
                    {p.custom && (
                      <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">custom</span>
                    )}
                    {p.inactive && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">inactive</span>
                    )}
                    <div className="flex items-center gap-1.5">
                      <button className="btn btn-default" onClick={() => setDialog({ mode: 'edit', product: p })}>
                        Edit
                      </button>
                      <button className="btn btn-default" onClick={() => onSetActive(p.slug, !!p.inactive)}>
                        {p.inactive ? 'Activate' : 'Deactivate'}
                      </button>
                      <button
                        className="btn btn-default px-2 text-red-600"
                        onClick={() => confirmDelete(p)}
                        aria-label={`Delete ${p.english}`}
                        title="Delete"
                      >
                        <TrashIcon width={14} height={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {dialog && (
        <ProductDialog
          key={dialog.mode === 'edit' ? dialog.product.slug : 'add'}
          dialog={dialog}
          onClose={() => setDialog(null)}
          onSave={(value) => {
            if (dialog.mode === 'add') onAdd(value);
            else onEdit(dialog.product.slug, value);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function ProductDialog({
  dialog,
  onClose,
  onSave,
}: {
  dialog: NonNullable<Dialog>;
  onClose: () => void;
  onSave: (value: CustomProduct) => void;
}) {
  const editing = dialog.mode === 'edit' ? dialog.product : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [english, setEnglish] = useState(editing?.english ?? '');
  const [category, setCategory] = useState<CategoryId>(editing?.category ?? 'stickers');
  const [slug, setSlug] = useState(editing?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(false);

  const problem = editing ? null : slug ? slugProblem(slug) : null;
  const valid = name.trim() !== '' && (editing || (slug !== '' && !problem));
  const input = 'w-full rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-brand-300';

  const submit = () => {
    if (!valid) return;
    onSave({ slug: editing?.slug ?? slug, name: name.trim(), english: english.trim() || name.trim(), category });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form
        className="flex w-full max-w-md flex-col gap-3 rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center">
          <h2 className="flex-1 text-sm font-bold text-slate-900">{editing ? 'Edit product' : 'Add product'}</h2>
          <button type="button" className="rounded-md p-1 text-slate-400 hover:bg-slate-100" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <label className="text-xs text-slate-500">
          Name
          <input
            autoFocus
            className={`${input} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="원형 스티커"
          />
        </label>
        <label className="text-xs text-slate-500">
          English name
          <input
            className={`${input} mt-1`}
            value={english}
            onChange={(e) => {
              setEnglish(e.target.value);
              if (!editing && !slugTouched) setSlug(slugify(e.target.value));
            }}
            placeholder="Circle sticker"
          />
        </label>
        <label className="text-xs text-slate-500">
          Category
          <select className={`${input} mt-1`} value={category} onChange={(e) => setCategory(e.target.value as CategoryId)}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.english} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Slug
          <input
            className={`${input} mt-1 font-mono ${editing ? 'bg-slate-50 text-slate-500' : ''}`}
            value={slug}
            disabled={!!editing}
            onChange={(e) => {
              setSlug(e.target.value.trim());
              setSlugTouched(true);
            }}
            placeholder="circle-sticker"
          />
          <span className={`mt-1 block text-[11px] ${problem ? 'text-red-600' : 'text-slate-400'}`}>
            {problem ?? (editing
              ? 'The slug identifies the product’s drafts and cannot change.'
              : 'Also the quotation path: …/pricing/quotation/<slug>. Cannot change later.')}
          </span>
        </label>

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn btn-default" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            {editing ? 'Save' : 'Add product'}
          </button>
        </div>
      </form>
    </div>
  );
}
