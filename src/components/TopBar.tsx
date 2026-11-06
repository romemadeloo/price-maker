import { useState, type FormEvent } from 'react';
import type { CloudSync } from '../hooks/useCloudSync';
import { timeAgo } from '../lib/format';
import type { EngineOptions } from '../types';
import type { BulkCompare } from '../hooks/useBulkCompare';
import type { PriceList } from '../lib/products';
import SyncPrices, { type SyncScope } from './SyncPrices';
import type { Server } from '../lib/production';
import ApiSetter from './ApiSetter';
import type { ServerUrlsProps } from './ServerUrlsForm';

export const USER_NAME_INPUT_ID = 'pricer-user-name';

interface Props extends ServerUrlsProps {
  sync: CloudSync;
  browserSaved: boolean;
  /** Changes not in the shared database yet. */
  pendingCount: number;
  userName: string;
  setUserName: (name: string) => void;
  options: EngineOptions;
  setOptions: (o: EngineOptions) => void;
  /** "Sync prices": fetch production and dev prices for many lists at once. */
  bulk: BulkCompare;
  draftedIn: (scope: SyncScope) => PriceList[];
  /** Which musticker server every comparison and quote uses. */
  server: Server;
  onServer: (server: Server) => void;
}

/**
 * The settings that apply everywhere — who you are, rate precision, and
 * whether drafts are shared — in a slim bar across the top of every page.
 */
export default function TopBar({
  sync,
  browserSaved,
  pendingCount,
  userName,
  setUserName,
  bulk,
  draftedIn,
  server,
  onServer,
  serverUrls,
  onServerUrls,
}: Props) {
  return (
    <div className="glass relative z-20 mx-3 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-3 py-2 lg:mx-0 lg:mt-0">
      <div
        className="flex items-center gap-2 text-xs font-medium text-slate-500"
        title="Which musticker server comparisons and quotes use"
      >
        Server
        <div className="flex rounded-xl bg-white/70 p-0.5 ring-1 ring-white">
          {(
            [
              ['production', 'Production'],
              ['dev', 'Dev'],
            ] as [Server, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={server === value}
              onClick={() => onServer(value)}
              className={`rounded-[10px] px-3 py-1 text-xs font-semibold transition-colors ${
                server === value ? 'bg-brand-600 text-white shadow-md shadow-brand-600/30' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ApiSetter serverUrls={serverUrls} onServerUrls={onServerUrls} server={server} />
      <div className="flex-1" />
      <SyncStatus sync={sync} browserSaved={browserSaved} pendingCount={pendingCount} />
      <SyncPrices bulk={bulk} draftedIn={draftedIn} />


      <label className="flex items-center gap-2 rounded-full bg-white/70 py-1 pl-1 pr-3 text-xs text-slate-500 ring-1 ring-white">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-400 text-[11px] font-semibold text-white">
          {userName.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <input
          id={USER_NAME_INPUT_ID}
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="Your name"
          maxLength={60}
          size={Math.max(9, userName.length + 1)}
          title="Shown to others as “saved by”"
          className="bg-transparent text-[13px] font-medium text-slate-800 placeholder:font-normal placeholder:text-slate-400 focus:outline-none"
        />
      </label>
    </div>
  );
}

const SYNC_LABEL: Record<CloudSync['status'], { dot: string; text: string }> = {
  connecting: { dot: 'bg-slate-300 animate-pulse', text: 'Connecting…' },
  synced: { dot: 'bg-emerald-500', text: 'Saved to the shared database' },
  saving: { dot: 'bg-brand-500 animate-pulse', text: 'Saving…' },
  offline: { dot: 'bg-amber-400', text: 'Offline — saved here' },
  'not-configured': { dot: 'bg-amber-400', text: 'This browser only — shared storage not set up' },
  locked: { dot: 'bg-red-500', text: 'Passcode needed' },
  error: { dot: 'bg-red-500', text: 'Sharing unavailable — saved here' },
};

function SyncStatus({ sync, browserSaved, pendingCount }: { sync: CloudSync; browserSaved: boolean; pendingCount: number }) {
  const [passcode, setPasscode] = useState('');
  const label = SYNC_LABEL[sync.status];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (passcode.trim()) sync.unlock(passcode);
    setPasscode('');
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={sync.syncNow}
        title={[sync.message, sync.lastSyncedAt ? `Last synced ${timeAgo(sync.lastSyncedAt)}` : null, 'Click to sync now']
          .filter(Boolean)
          .join('\n')}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${label.dot}`} />
        {label.text}
        {pendingCount > 0 && sync.status !== 'saving' && (
          <span className="text-slate-400" title="Changes waiting to reach the shared database">
            · {pendingCount} waiting to save
          </span>
        )}
        {/* Only worth saying when there is unsaved work the browser could not back up. */}
        {!browserSaved && pendingCount > 0 && (
          <span
            className="text-amber-600"
            title="These changes are not in the shared database yet, and this browser could not keep a backup copy (its storage is full). They are kept while this tab stays open."
          >
            · no local backup
          </span>
        )}
      </button>
      {sync.status === 'locked' && (
        <form onSubmit={submit} className="flex gap-1.5">
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Team passcode"
            className="w-32 rounded-full bg-white px-3 py-1 text-xs ring-1 ring-slate-200 focus:outline-none focus:ring-brand-300"
          />
          <button className="rounded-full bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700">Unlock</button>
        </form>
      )}
    </div>
  );
}
