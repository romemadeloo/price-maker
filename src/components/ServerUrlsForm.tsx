import { useState } from 'react';
import { DEFAULT_SERVER_URLS, fetchProductionQuote, normalizeServerUrl, type Server } from '../lib/production';

export interface ServerUrlsProps {
  serverUrls: Partial<Record<Server, string>>;
  onServerUrls: (urls: Partial<Record<Server, string>>) => void;
}

const SERVERS: { id: Server; name: string; hint: string }[] = [
  { id: 'production', name: 'Production', hint: 'The live site. “Compare to Production” quotes this server.' },
  { id: 'dev', name: 'Development', hint: 'Staging, where new price books land first. “Compare to Development” quotes this server.' },
];

/** A size every sticker product quotes, for “Test”. */
const TEST = { slug: 'die-cut-sticker', width: 50, height: 50 };

type TestState = { state: 'busy' } | { state: 'ok'; text: string } | { state: 'error'; text: string };

/**
 * Edit the production and dev quotation API base URLs. Saved through the
 * shared settings record, so a change applies to every browser. Used on the
 * Settings page and in the API popover beside the Production | Dev switch.
 */
export default function ServerUrlsForm({
  serverUrls,
  onServerUrls,
  compact = false,
  onSaved,
}: ServerUrlsProps & { compact?: boolean; onSaved?: () => void }) {
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
    onSaved?.();
  };

  /** Quote one size against the URL in the box, before it is saved. */
  const test = async (server: Server) => {
    const url = parsed(server);
    if (!url) return;
    setTests((t) => ({ ...t, [server]: { state: 'busy' } }));
    try {
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
    <div>
      <div className={`flex flex-col ${compact ? 'gap-3' : 'gap-5'}`}>
        {SERVERS.map(({ id, name, hint }) => {
          const ok = parsed(id) != null;
          const isDefault = parsed(id) === DEFAULT_SERVER_URLS[id];
          const result = tests[id];
          return (
            <div key={id}>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={`server-${id}${compact ? '-pop' : ''}`} className="text-[13px] font-semibold text-slate-800">
                  {name} API
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
              {!compact && <p className="text-xs text-slate-400">{hint}</p>}
              <div className="mt-1.5 flex gap-2">
                <input
                  id={`server-${id}${compact ? '-pop' : ''}`}
                  value={inputs[id]}
                  onChange={(e) => setInputs((i) => ({ ...i, [id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && dirty && !invalid && save()}
                  spellCheck={false}
                  placeholder={DEFAULT_SERVER_URLS[id]}
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
              {ok && !compact && (
                <p className="mt-1 truncate font-mono text-[11px] text-slate-400" title="Example request">
                  {parsed(id)}/pricing/quotation/{TEST.slug}?width={TEST.width}&height={TEST.height}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className={`flex items-center justify-end gap-2 border-t border-slate-100 ${compact ? 'mt-3 pt-3' : 'mt-5 pt-4'}`}>
        {dirty && <span className="mr-auto text-xs text-amber-700">Unsaved changes</span>}
        <button
          className="btn btn-ghost"
          disabled={!dirty}
          onClick={() => setInputs({ production: current('production'), dev: current('dev') })}
        >
          Discard
        </button>
        <button className="btn btn-primary" disabled={!dirty || invalid} onClick={save}>
          Save for everyone
        </button>
      </div>
    </div>
  );
}
