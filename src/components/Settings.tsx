import type { EngineOptions } from '../types';
import { MenuIcon } from './icons';
import ServerUrlsForm, { type ServerUrlsProps } from './ServerUrlsForm';

interface Props extends ServerUrlsProps {
  options: EngineOptions;
  onOptions: (o: EngineOptions) => void;
  onOpenNav: () => void;
}

/**
 * Settings everyone shares: where the musticker quotation APIs live, and how
 * rates are rounded. Saved through the shared settings record, so a change
 * here applies to every browser.
 */
export default function Settings({ serverUrls, onServerUrls, options, onOptions, onOpenNav }: Props) {
  return (
    <div className="h-full min-w-0 overflow-y-auto px-4 pb-[var(--dock-clear)] pt-3 sm:px-7">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-center gap-3">
          <button className="btn btn-default px-2 lg:hidden" onClick={onOpenNav} aria-label="Open products">
            <MenuIcon />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Settings</h1>
            <p className="text-xs text-slate-400">Shared with everyone using this workspace.</p>
          </div>
        </div>

        <section className="card p-5">
          <h2 className="text-sm font-bold text-slate-900">API servers</h2>
          <p className="mb-4 mt-0.5 text-xs text-slate-500">
            Base URL of each server’s quotation API, up to <code className="font-mono">/index.php/sys/kr</code>. Must be
            https under musticker.com. Quotes go to <code className="font-mono">{'<base>'}/pricing/quotation/{'<product>'}</code>.
            Also editable from the <b>API</b> button beside the Production | Dev switch.
          </p>
          {/* Remount on outside changes so the boxes show what is saved. */}
          <ServerUrlsForm key={JSON.stringify(serverUrls)} serverUrls={serverUrls} onServerUrls={onServerUrls} />
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-bold text-slate-900">Rate precision</h2>
          <p className="mt-0.5 text-xs text-slate-500">Decimal places for exported price-per-mm² rates.</p>
          <div className="mt-3 flex gap-4 text-xs text-slate-600">
            <label className="flex items-center gap-2">
              Min
              <input
                type="number"
                min={0}
                max={options.maxDecimalPlaces}
                value={options.minDecimalPlaces}
                onChange={(e) => onOptions({ ...options, minDecimalPlaces: Math.max(0, Number(e.target.value) || 0) })}
                className="w-16 rounded-lg px-2 py-1 ring-1 ring-slate-200 focus:outline-none focus:ring-brand-300"
              />
            </label>
            <label className="flex items-center gap-2">
              Max
              <input
                type="number"
                min={options.minDecimalPlaces}
                max={30}
                value={options.maxDecimalPlaces}
                onChange={(e) => onOptions({ ...options, maxDecimalPlaces: Math.min(30, Number(e.target.value) || 0) })}
                className="w-16 rounded-lg px-2 py-1 ring-1 ring-slate-200 focus:outline-none focus:ring-brand-300"
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
