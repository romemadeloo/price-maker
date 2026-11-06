import type { ReactNode } from 'react';
import type { RoundTripResult, Summary } from '../types';

interface Props {
  summary: Summary;
  roundTrip: RoundTripResult;
  stale: boolean;
  /** Rows that repeat an earlier row's base area. */
  duplicates?: number;
}

type Tone = 'good' | 'bad' | 'warn' | 'neutral';

/** One figure in the strip: small label, the number, coloured when it needs attention. */
function Stat({ label, value, tone = 'neutral', note }: { label: string; value: string; tone?: Tone; note?: string }) {
  const tones: Record<Tone, string> = {
    good: 'text-emerald-600',
    bad: 'text-red-600',
    warn: 'text-amber-600',
    neutral: 'text-slate-900',
  };
  return (
    <div className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap" title={note}>
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${tones[tone]}`}>{value}</span>
      {note && <span className={`text-[10px] font-semibold ${tones[tone]}`}>{note}</span>}
    </div>
  );
}

/**
 * Validation status and the headline counts in one slim strip, so the sheet
 * below keeps as much height as possible.
 */
export default function SummaryCards({ summary, roundTrip, stale, duplicates = 0 }: Props) {
  const n = (v: number) => v.toLocaleString();
  const share = summary.totalPrices ? `${((summary.matched / summary.totalPrices) * 100).toFixed(0)}%` : undefined;

  return (
    <div className="card flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3 py-2 xl:flex-nowrap">
      <Status summary={summary} roundTrip={roundTrip} stale={stale} />
      <span className="hidden h-4 w-px shrink-0 bg-slate-200 sm:block" />
      <Stat label="Total" value={n(summary.totalPrices)} />
      <Stat label="Matched" value={n(summary.matched)} tone={summary.matched > 0 ? 'good' : 'neutral'} note={share} />
      <Stat label="Mismatched" value={n(summary.mismatched)} tone={summary.mismatched > 0 ? 'bad' : 'neutral'} />
      <Stat label="Invalid" value={n(summary.invalidInput)} tone={summary.invalidInput > 0 ? 'bad' : 'neutral'} />
      <Stat label="Duplicate areas" value={n(duplicates)} tone={duplicates > 0 ? 'warn' : 'neutral'} />
      <Stat label="Max dp" value={summary.maxDecimalPlaces > 0 ? String(summary.maxDecimalPlaces) : '—'} />
    </div>
  );
}

function Status({ summary, roundTrip, stale }: Props) {
  if (stale) {
    return (
      <Badge tone="neutral" title="Recalculating…">
        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
      </Badge>
    );
  }

  if (summary.totalPrices === 0) {
    return (
      <Badge tone="neutral" title="No expected prices yet">
        Paste a table, import a CSV, or load the sample to begin.
      </Badge>
    );
  }

  if (summary.allValid) {
    return (
      <Badge tone="good" title="All prices validated">
        {roundTrip.passed ? 'CSV validated' : roundTrip.message}
      </Badge>
    );
  }

  const parts: string[] = [];
  if (summary.mismatched > 0) parts.push(`${summary.mismatched.toLocaleString()} mismatch(es)`);
  if (summary.invalidInput > 0) parts.push(`${summary.invalidInput.toLocaleString()} invalid input(s)`);
  if (!roundTrip.passed) parts.push('CSV round-trip failed');

  return (
    <Badge tone="bad" title="Validation failed">
      {parts.join(' · ')}
      {roundTrip.failures.length > 0 ? ` · ${roundTrip.message}` : ''}
    </Badge>
  );
}

function Badge({ tone, title, children }: { tone: 'neutral' | 'good' | 'bad'; title: string; children: ReactNode }) {
  const styles = {
    neutral: { icon: 'bg-slate-100 text-slate-500', title: 'text-slate-800', glyph: '•' },
    good: { icon: 'bg-emerald-500 text-white', title: 'text-emerald-700', glyph: '✓' },
    bad: { icon: 'bg-red-500 text-white', title: 'text-red-700', glyph: '!' },
  }[tone];

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-500">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${styles.icon}`}>
        {styles.glyph}
      </span>
      <span className={`whitespace-nowrap text-[13px] font-semibold ${styles.title}`}>{title}</span>
      <span className="min-w-0 truncate" title={typeof children === 'string' ? children : undefined}>{children}</span>
    </div>
  );
}
