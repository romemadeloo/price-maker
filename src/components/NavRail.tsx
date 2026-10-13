import type { ReactNode } from 'react';
import type { CloudSync } from '../hooks/useCloudSync';
import { CompareIcon, GridIcon, TableIcon } from './icons';
import { USER_NAME_INPUT_ID } from './TopBar';

export type RailTarget = 'overview' | 'table' | 'compare';

/**
 * The slim icon rail on the far left: brand mark, the three places you go
 * most, and who you are (with the sharing status as a dot).
 */
export default function NavRail({
  active,
  onNavigate,
  userName,
  sync,
}: {
  active: RailTarget | null;
  onNavigate: (target: RailTarget) => void;
  userName: string;
  sync: CloudSync;
}) {
  const initial = userName.trim().charAt(0).toUpperCase() || '?';
  const dot =
    sync.status === 'synced'
      ? 'bg-emerald-500'
      : sync.status === 'saving' || sync.status === 'connecting'
        ? 'bg-brand-500'
        : 'bg-amber-400';

  return (
    <div className="hidden w-[72px] shrink-0 flex-col items-center border-r border-slate-100 bg-white py-5 lg:flex">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-base font-bold text-white shadow-lg shadow-brand-600/30">
        ₩
      </div>

      <nav className="mt-10 flex flex-col items-center gap-3">
        <RailButton label="Overview" active={active === 'overview'} onClick={() => onNavigate('overview')}>
          <GridIcon width={20} height={20} />
        </RailButton>
        <RailButton label="Price table" active={active === 'table'} onClick={() => onNavigate('table')}>
          <TableIcon width={20} height={20} />
        </RailButton>
        <RailButton label="Compare to production" active={active === 'compare'} onClick={() => onNavigate('compare')}>
          <CompareIcon width={20} height={20} />
        </RailButton>
      </nav>

      <button
        onClick={() => document.getElementById(USER_NAME_INPUT_ID)?.focus()}
        className="relative mt-auto flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-400 text-sm font-semibold text-white"
        title={`${userName.trim() || 'Set your name (top right)'} · ${sync.status}`}
        aria-label="Edit your name"
      >
        {initial}
        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${dot}`} />
      </button>
    </div>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
        active ? 'bg-brand-50 text-brand-600' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
