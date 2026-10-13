import type { ReactNode } from 'react';
import type { RoundTripResult, Summary } from '../types';

interface Props {
  summary: Summary;
  roundTrip: RoundTripResult;
  stale: boolean;
}

function Card({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'bad' | 'warn';
}) {
  const dot = {
    neutral: 'bg-slate-300',
    good: 'bg-emerald-500',
    bad: 'bg-red-500',
    warn: 'bg-amber-400',
  } as const;
  const text = {
    neutral: 'text-slate-900',
    good: 'text-slate-900',
    bad: 'text-red-700',
    warn: 'text-amber-700',
  } as const;

  return (
    <div className="card px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} />
        {label}
      </div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums tracking-tight ${text[tone]}`}>{value}</div>
    </div>
  );
}

export default function SummaryCards({ summary, roundTrip, stale }: Props) {
  const n = (v: number) => v.toLocaleString();

  return (
    <div className="space-y-3">
      <StatusBanner summary={summary} roundTrip={roundTrip} stale={stale} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Card label="Total prices" value={n(summary.totalPrices)} />
        <Card label="Matched" value={n(summary.matched)} tone={summary.matched > 0 ? 'good' : 'neutral'} />
        <Card label="Mismatched" value={n(summary.mismatched)} tone={summary.mismatched > 0 ? 'bad' : 'good'} />
        <Card label="Invalid input" value={n(summary.invalidInput)} tone={summary.invalidInput > 0 ? 'bad' : 'good'} />
        <Card
          label="Base area warnings"
          value={n(summary.baseAreaWarnings)}
          tone={summary.baseAreaWarnings > 0 ? 'warn' : 'good'}
        />
        <Card label="Max decimal precision" value={summary.maxDecimalPlaces > 0 ? String(summary.maxDecimalPlaces) : '—'} />
      </div>
    </div>
  );
}

function StatusBanner({ summary, roundTrip, stale }: Props) {
  if (stale) {
    return (
      <Banner tone="neutral" title="Recalculating…">
        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
      </Banner>
    );
  }

  if (summary.totalPrices === 0) {
    return (
      <Banner tone="neutral" title="No expected prices yet">
        Paste a table, import a CSV, or load the sample to begin.
      </Banner>
    );
  }

  if (summary.allValid) {
    return (
      <Banner tone="good" title="All prices validated">
        {summary.matched.toLocaleString()} of {summary.totalPrices.toLocaleString()} expected prices reproduce exactly
        (₩0 difference). {roundTrip.passed ? '✔ CSV validated — ' : ''}
        {roundTrip.message}
        {summary.baseAreaWarnings > 0 && (
          <span className="font-medium text-amber-700">
            {' '}
            ⚠ {summary.baseAreaWarnings.toLocaleString()} row(s) have a base area that does not equal width × height —
            see Validation.
          </span>
        )}
      </Banner>
    );
  }

  const parts: string[] = [];
  if (summary.mismatched > 0) parts.push(`${summary.mismatched.toLocaleString()} mismatch(es)`);
  if (summary.invalidInput > 0) parts.push(`${summary.invalidInput.toLocaleString()} invalid input(s)`);
  if (!roundTrip.passed) parts.push('CSV round-trip failed');

  return (
    <Banner tone="bad" title="Validation failed">
      {parts.join(' · ')}
      {roundTrip.failures.length > 0 ? ` · ${roundTrip.message}` : ''}
    </Banner>
  );
}

function Banner({
  tone,
  title,
  children,
}: {
  tone: 'neutral' | 'good' | 'bad';
  title: string;
  children: ReactNode;
}) {
  const styles = {
    neutral: { box: 'border-slate-200 bg-white', icon: 'bg-slate-100 text-slate-500', title: 'text-slate-800', glyph: '•' },
    good: { box: 'border-emerald-200 bg-emerald-50/70', icon: 'bg-emerald-500 text-white', title: 'text-emerald-900', glyph: '✓' },
    bad: { box: 'border-red-200 bg-red-50/70', icon: 'bg-red-500 text-white', title: 'text-red-900', glyph: '!' },
  }[tone];

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${styles.box}`}>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${styles.icon}`}>
        {styles.glyph}
      </span>
      <div className="min-w-0 text-xs text-slate-600">
        <span className={`mr-2 text-sm font-semibold ${styles.title}`}>{title}</span>
        {children}
      </div>
    </div>
  );
}
