import type { ReactNode } from 'react';
import { CATEGORIES, PRODUCTS } from '../lib/products';
import { signedPct, timeAgo } from '../lib/format';
import type { ProductStatus } from '../state/workspace';
import { ChevronIcon, MenuIcon } from './icons';

interface Props {
  statuses: Record<string, ProductStatus>;
  onSelectProduct: (slug: string) => void;
  onOpenNav: () => void;
}

/** Every product's draft and how it stands against production, on one page. */
export default function Overview({ statuses, onSelectProduct, onOpenNav }: Props) {
  const all = PRODUCTS.map((p) => statuses[p.slug]);
  const drafted = all.filter((s) => s?.hasDraft).length;
  const compared = all.filter((s) => s?.compare).length;
  const differing = all.filter((s) => s?.compare && s.compare.higher + s.compare.lower > 0).length;
  const matching = compared - differing;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex items-start gap-4 px-4 py-5 sm:px-6">
          <button className="btn btn-default mt-1 px-2 lg:hidden" onClick={onOpenNav} aria-label="Open products">
            <MenuIcon />
          </button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Overview</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Drafted price books for every musticker product, and how each compares with what production charges today.
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-5 px-4 py-5 sm:px-6">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Products drafted" value={`${drafted}`} sub={`of ${PRODUCTS.length} in the catalog`} />
          <Stat label="Compared with production" value={`${compared}`} sub={`${drafted - compared} draft(s) not compared yet`} />
          <Stat label="Differ from production" value={`${differing}`} sub="at least one price changed" tone="amber" />
          <Stat label="Match production" value={`${matching}`} sub="every compared price identical" tone="emerald" />
        </section>

        {CATEGORIES.map((cat) => (
          <section key={cat.id} className="card overflow-hidden">
            <div className="flex items-baseline gap-2 border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">{cat.english}</h2>
              <span className="text-xs text-slate-400">{cat.name}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Draft</th>
                    <th className="px-3 py-2 font-medium">Production pricing</th>
                    <th className="px-3 py-2 text-right font-medium">Compared</th>
                    <th className="px-3 py-2 font-medium">vs production</th>
                    <th className="px-3 py-2 text-right font-medium">Avg Δ</th>
                    <th className="w-8 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {PRODUCTS.filter((p) => p.category === cat.id).map((p) => {
                    const s = statuses[p.slug];
                    return (
                      <tr
                        key={p.slug}
                        onClick={() => onSelectProduct(p.slug)}
                        className="group cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-5 py-2.5">
                          <div className="whitespace-nowrap font-medium text-slate-900">{p.name}</div>
                          <div className="whitespace-nowrap text-xs text-slate-500">{p.english}</div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {s?.hasDraft ? (
                            <>
                              <div className="tabular-nums">
                                {s.rows.toLocaleString()} rows · {s.prices.toLocaleString()} prices
                              </div>
                              <div className="text-slate-400">
                                edited {timeAgo(s.updatedAt)}
                                {s.updatedBy ? ` by ${s.updatedBy}` : ''}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400">Not drafted</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {s?.pricingName ?? <span className="text-slate-300">—</span>}
                          {s?.comparedAt && s.hasDraft && <div className="text-slate-400">fetched {timeAgo(s.comparedAt)}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">
                          {s?.compare ? s.compare.compared.toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-2.5">{s?.compare ? <MixBar s={s} /> : <span className="text-xs text-slate-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-right text-xs font-semibold tabular-nums text-slate-700">
                          {s?.compare ? signedPct(s.compare.avgDiffPct) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-slate-300 group-hover:text-slate-500">
                          <ChevronIcon />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function MixBar({ s }: { s: ProductStatus }) {
  const c = s.compare!;
  const pct = (n: number) => `${(n / c.compared) * 100}%`;
  return (
    <div className="w-44">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-emerald-500" style={{ width: pct(c.same) }} />
        <div className="bg-amber-400" style={{ width: pct(c.higher) }} />
        <div className="bg-sky-500" style={{ width: pct(c.lower) }} />
      </div>
      <div className="mt-1 flex gap-2 text-[11px] tabular-nums text-slate-500">
        <span className="text-emerald-700">{c.same} =</span>
        <span className="text-amber-700">{c.higher} ↑</span>
        <span className="text-sky-700">{c.lower} ↓</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'slate',
}: {
  label: string;
  value: ReactNode;
  sub: string;
  tone?: 'slate' | 'amber' | 'emerald';
}) {
  const bar = { slate: 'bg-brand-500', amber: 'bg-amber-400', emerald: 'bg-emerald-500' }[tone];
  return (
    <div className="card relative overflow-hidden px-4 py-3.5">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}
