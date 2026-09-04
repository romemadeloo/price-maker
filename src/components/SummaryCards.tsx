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
  const tones = {
    neutral: 'border-slate-200 bg-white text-slate-900',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    bad: 'border-red-200 bg-red-50 text-red-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
  } as const;

  return (
    <div className={`rounded-lg border px-3 py-2 ${tones[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function SummaryCards({ summary, roundTrip, stale }: Props) {
  const n = (v: number) => v.toLocaleString();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Total Prices" value={n(summary.totalPrices)} />
        <Card label="Matched" value={n(summary.matched)} tone={summary.matched > 0 ? 'good' : 'neutral'} />
        <Card label="Mismatched" value={n(summary.mismatched)} tone={summary.mismatched > 0 ? 'bad' : 'good'} />
        <Card label="Invalid Input" value={n(summary.invalidInput)} tone={summary.invalidInput > 0 ? 'bad' : 'good'} />
        <Card
          label="Base Area Warnings"
          value={n(summary.baseAreaWarnings)}
          tone={summary.baseAreaWarnings > 0 ? 'warn' : 'good'}
        />
        <Card label="Max Decimal Precision" value={summary.maxDecimalPlaces > 0 ? String(summary.maxDecimalPlaces) : '—'} />
      </div>

      <StatusBanner summary={summary} roundTrip={roundTrip} stale={stale} />
    </div>
  );
}

function StatusBanner({ summary, roundTrip, stale }: Props) {
  if (stale) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-slate-600">
        <span className="h-3 w-3 animate-pulse rounded-full bg-slate-400" />
        <span className="text-sm font-medium">Recalculating…</span>
      </div>
    );
  }

  if (summary.totalPrices === 0) {
    return (
      <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        No expected prices yet — paste a table, import a CSV, or load the sample to begin.
      </div>
    );
  }

  if (summary.allValid) {
    return (
      <div className="rounded-lg border-2 border-emerald-500 bg-emerald-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">✅</span>
          <div>
            <div className="text-lg font-bold tracking-tight text-emerald-800">ALL PRICES VALIDATED</div>
            <div className="text-xs text-emerald-700">
              {summary.matched.toLocaleString()} of {summary.totalPrices.toLocaleString()} expected prices reproduce
              exactly (₩0 difference). {roundTrip.passed ? '✔ CSV VALIDATED — ' : ''}
              {roundTrip.message}
            </div>
            {summary.baseAreaWarnings > 0 && (
              <div className="mt-1 text-xs font-medium text-amber-700">
                ⚠ {summary.baseAreaWarnings.toLocaleString()} row(s) have a base area that does not equal width ×
                height. Prices still reconstruct from the base area you entered — see the Validation tab.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const parts: string[] = [];
  if (summary.mismatched > 0) parts.push(`${summary.mismatched.toLocaleString()} mismatch(es)`);
  if (summary.invalidInput > 0) parts.push(`${summary.invalidInput.toLocaleString()} invalid input(s)`);
  if (!roundTrip.passed) parts.push('CSV round-trip failed');

  return (
    <div className="rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">⚠️</span>
        <div>
          <div className="text-lg font-bold tracking-tight text-red-800">VALIDATION FAILED</div>
          <div className="text-xs text-red-700">
            {parts.join(' · ')}
            {roundTrip.failures.length > 0 ? ` · ${roundTrip.message}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
