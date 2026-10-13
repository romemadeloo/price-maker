import type { ReactNode } from 'react';
import type { RoundTripResult, Summary } from '../types';

interface Props {
  summary: Summary;
  roundTrip: RoundTripResult;
  stale: boolean;
  /** Rows that repeat an earlier row's base area. */
  duplicates?: number;
}

/** One number with a small status pill under it, as in the dashboard reference. */
function Card({ label, value, pill }: { label: string; value: string; pill?: ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</div>
      {pill && <div className="mt-1">{pill}</div>}
    </div>
  );
}

function Pill({ tone, children }: { tone: 'good' | 'bad' | 'warn' | 'neutral'; children: ReactNode }) {
  const tones = {
    good: 'bg-emerald-50 text-emerald-700',
    bad: 'bg-red-50 text-red-600',
    warn: 'bg-amber-50 text-amber-700',
    neutral: 'bg-slate-100 text-slate-500',
  };
  return <span className={`delta ${tones[tone]}`}>{children}</span>;
}

export default function SummaryCards({ summary, roundTrip, stale, duplicates = 0 }: Props) {
  const n = (v: number) => v.toLocaleString();
  const share = (v: number) => (summary.totalPrices ? `${((v / summary.totalPrices) * 100).toFixed(0)}%` : '—');

  return (
    <div className="space-y-3">
      <StatusBanner summary={summary} roundTrip={roundTrip} stale={stale} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Card label="Total prices" value={n(summary.totalPrices)} pill={<Pill tone="neutral">in the table</Pill>} />
        <Card
          label="Matched"
          value={n(summary.matched)}
          pill={<Pill tone={summary.matched > 0 ? 'good' : 'neutral'}>✓ {share(summary.matched)}</Pill>}
        />
        <Card
          label="Mismatched"
          value={n(summary.mismatched)}
          pill={summary.mismatched > 0 ? <Pill tone="bad">! needs review</Pill> : <Pill tone="good">✓ none</Pill>}
        />
        <Card
          label="Invalid input"
          value={n(summary.invalidInput)}
          pill={summary.invalidInput > 0 ? <Pill tone="bad">! fix in table</Pill> : <Pill tone="good">✓ none</Pill>}
        />
        <Card
          label="Duplicate base areas"
          value={n(duplicates)}
          pill={duplicates > 0 ? <Pill tone="warn">! merged in CSV</Pill> : <Pill tone="good">✓ none</Pill>}
        />
        <Card
          label="Max decimal precision"
          value={summary.maxDecimalPlaces > 0 ? String(summary.maxDecimalPlaces) : '—'}
          pill={<Pill tone="neutral">dp in the CSV</Pill>}
        />
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

function Banner({ tone, title, children }: { tone: 'neutral' | 'good' | 'bad'; title: string; children: ReactNode }) {
  const styles = {
    neutral: { icon: 'bg-slate-100 text-slate-500', title: 'text-slate-800', glyph: '•' },
    good: { icon: 'bg-emerald-500 text-white', title: 'text-emerald-800', glyph: '✓' },
    bad: { icon: 'bg-red-500 text-white', title: 'text-red-700', glyph: '!' },
  }[tone];

  return (
    <div className="card flex items-center gap-3 px-4 py-2.5">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${styles.icon}`}>
        {styles.glyph}
      </span>
      <div className="min-w-0 text-xs text-slate-500">
        <span className={`mr-2 text-sm font-semibold ${styles.title}`}>{title}</span>
        {children}
      </div>
    </div>
  );
}
