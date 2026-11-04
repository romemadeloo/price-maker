import { useState } from 'react';
import {
  DEFAULT_SERVER_URLS,
  fetchProductionQuote,
  normalizeServerUrl,
  type Server,
} from '../lib/production';
import type { EngineOptions } from '../types';
import { MenuIcon } from './icons';

interface Props {
  serverUrls: Partial<Record<Server, string>>;
  onServerUrls: (urls: Partial<Record<Server, string>>) => void;
  options: EngineOptions;
  onOptions: (o: EngineOptions) => void;
  onOpenNav: () => void;
}

const SERVERS: { id: Server; name: string; hint: string }[] = [
  { id: 'production', name: 'Production', hint: 'The live site. “Compare to Production” quotes this server.' },
  { id: 'dev', name: 'Development', hint: 'Staging, where new price books land first. “Compare to Development” quotes this server.' },
];

/** A size every sticker product quotes, for “Test”. */
const TEST = { slug: 'die-cut-sticker', width: 50, height: 50 };

type TestState = { state: 'busy' } | { state: 'ok'; text: string } | { state: 'error'; text: string };

/**
 * Settings everyone shares: where the musticker quotation APIs live, and how
 * rates are rounded. Saved through the shared settings record, so a change
 * here applies to every browser.
 */
export default function Settings({ serverUrls, onServerUrls, options, onOptions, onOpenNav }: Props) {
  const [inputs, setInputs] = useState<Record<Server, string>>(() => ({
    production: serverUrls.production ?? DEFAULT_SERVER_URLS.production,
    dev: serverUrls.dev ?? DEFAULT_SERVER_URLS.dev,
  }));
  const [tests, setTests] = useState<Partial<Record<Server, TestState>>>({});

  const current = (server: Server) => serverUrls[server] ?? DEFAULT_SERVER_URLS[server];
  const parsed = (server: Server) => normalizeServerUrl(inputs[server]);
  const dirty = SERVERS.some((s) => parsed(s.id) !== current(s.id));
  const invalid = SERVERS.some((s) => parsed(s.id) == null);

  const save = () => {
    if (invalid) return;
    const next: Partial<Record<Server, string>> = {};
    for (const { id } of SERVERS) {
      const url = parsed(id)!;
      if (url !== DEFAULT_SERVER_URLS[id]) next[id] = url;
    }
    onServerUrls(next);
    setTests({});
  };

  /** Quote one size against the URL in the box (saved or not). */
  const test = async (server: Server) => {
    const url = parsed(server);
    if (!url) return;
    setTests((t) => ({ ...t, [server]: { state: 'busy' } }));
    try {
      // Tests the URL as typed, before it is saved.
      const quote = await fetchProductionQuote(TEST.slug, TEST.width, TEST.height, { server, baseUrl: url });
      setTests((t) => ({
        ...t,
        [server]: {
          state: 'ok',
          text: `Reachable · ${quote.pricingName ?? 'price book'} · ${quote.prices.length} quantities for ${TEST.width}×${TEST.height}`,
        },
      }));
    } catch (err) {
      setTests((t) => ({ ...t, [server]: { state: 'error', text: (err as Error).message } }));
    }
  };

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
          <p className="mt-0.5 text-xs text-slate-500">
            Base URL of each server’s quotation API, up to <code className="font-mono">/index.php/sys/kr</code>. Must be
            https under musticker.com. Quotes go to <code className="font-mono">{'<base>'}/pricing/quotation/{'<product>'}</code>.
          </p>

          <div className="mt-4 flex flex-col gap-5">
            {SERVERS.map(({ id, name, hint }) => {
              const value = inputs[id];
              const ok = parsed(id) != null;
              const isDefault = parsed(id) === DEFAULT_SERVER_URLS[id];
              const result = tests[id];
              return (
                <div key={id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor={`server-${id}`} className="text-[13px] font-semibold text-slate-800">
                      {name}
                    </label>
                    {!isDefault && (
                      <button
                        className="text-xs text-brand-600 hover:text-brand-700"
                        onClick={() => setInputs((i) => ({ ...i, [id]: DEFAULT_SERVER_URLS[id] }))}
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{hint}</p>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id={`server-${id}`}
                      value={value}
                      onChange={(e) => setInputs((i) => ({ ...i, [id]: e.target.value }))}
                      spellCheck={false}
                      className={`min-w-0 flex-1 rounded-lg bg-white px-3 py-2 font-mono text-xs ring-1 focus:outline-none ${
                        ok ? 'ring-slate-200 focus:ring-brand-300' : 'ring-red-300 focus:ring-red-400'
                      }`}
                    />
                    <button className="btn btn-default" onClick={() => test(id)} disabled={!ok || result?.state === 'busy'}>
                      {result?.state === 'busy' ? 'Testing…' : 'Test'}
                    </button>
                  </div>
                  {!ok && <p className="mt-1 text-xs text-red-600">Enter an https URL under musticker.com.</p>}
                  {result && result.state !== 'busy' && (
                    <p className={`mt-1 text-xs ${result.state === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
                      {result.state === 'ok' ? '✓ ' : '✕ '}
                      {result.text}
                    </p>
                  )}
                  {ok && (
                    <p className="mt-1 truncate font-mono text-[11px] text-slate-400" title="Example request">
                      {parsed(id)}/pricing/quotation/{TEST.slug}?width={TEST.width}&height={TEST.height}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            {dirty && <span className="mr-auto text-xs text-amber-700">Unsaved changes</span>}
            <button
              className="btn btn-ghost"
              disabled={!dirty}
              onClick={() =>
                setInputs({ production: current('production'), dev: current('dev') })
              }
            >
              Discard
            </button>
            <button className="btn btn-primary" disabled={!dirty || invalid} onClick={save}>
              Save for everyone
            </button>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-bold text-slate-900">Rate precision</h2>
          <p className="mt-0.5 text-xs text-slate-500">Decimal places for exported price-per-mm² rates (also in the top bar).</p>
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
