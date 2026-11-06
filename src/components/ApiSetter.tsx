import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SERVER_URLS, SERVER_HOSTS, type Server } from '../lib/production';
import { CloseIcon, GearIcon } from './icons';
import ServerUrlsForm, { type ServerUrlsProps } from './ServerUrlsForm';

/**
 * The "API" button beside the Production | Dev switch: shows which host the
 * selected server quotes, and opens a popover to set the production and dev
 * API URLs (shared with everyone, same as Settings).
 */
export default function ApiSetter({ serverUrls, onServerUrls, server }: ServerUrlsProps & { server: Server }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const custom = (['production', 'dev'] as const).some((s) => serverUrls[s] && serverUrls[s] !== DEFAULT_SERVER_URLS[s]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        className={`btn ${open ? 'btn-primary' : 'btn-default'}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={`Set the production and dev API URLs · now quoting ${SERVER_HOSTS[server]}`}
      >
        <GearIcon width={14} height={14} />
        API
        {custom && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="custom URL set" />}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="API servers"
          className="absolute right-0 top-full z-50 mt-2 w-[min(34rem,calc(100vw-2rem))] rounded-2xl bg-white p-4 shadow-xl ring-1 ring-black/5"
        >
          <div className="mb-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-slate-900">API servers</h3>
              <p className="text-xs text-slate-500">
                Base URL up to <code className="font-mono">/index.php/sys/kr</code>, https under musticker.com. Saved for everyone.
              </p>
            </div>
            <button className="btn btn-ghost px-2" onClick={() => setOpen(false)} aria-label="Close API servers">
              <CloseIcon />
            </button>
          </div>
          <ServerUrlsForm compact serverUrls={serverUrls} onServerUrls={onServerUrls} onSaved={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
