import { useMemo, useState } from 'react';
import type { CellResult, EngineResult, InvalidSample, Issue } from '../types';
import { formatDifference, formatKrw, groupDigits } from '../lib/decimal';
import { FIRST_PRICE_COL } from '../state/sheetReducer';

interface Props {
  result: EngineResult;
  onGoToCell: (rowIndex: number, gridColIndex: number) => void;
}

type Filter = 'problems' | 'all' | 'pass';

const MAX_VISIBLE = 500;

export default function ValidationTable({ result, onGoToCell }: Props) {
  const [filter, setFilter] = useState<Filter>('problems');

  const rows = useMemo(() => {
    const withValues = result.cells.filter((c) => c.status !== 'BLANK');
    if (filter === 'all') return withValues;
    if (filter === 'pass') return withValues.filter((c) => c.status === 'PASS');
    return withValues.filter((c) => c.status !== 'PASS');
  }, [result.cells, filter]);

  const shown = rows.slice(0, MAX_VISIBLE);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <InvalidValues samples={result.invalidSamples} onGoToCell={onGoToCell} />

      <IssueList issues={result.issues} onGoToCell={onGoToCell} />

      {!result.roundTrip.passed && result.roundTrip.failures.length > 0 && (
        <RoundTripFailures result={result} />
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Per-cell validation</span>
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {(['problems', 'all', 'pass'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-xs font-medium capitalize ${
                filter === f ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f === 'problems' ? 'Problems only' : f === 'pass' ? 'Passing' : 'All'}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">
          {rows.length.toLocaleString()} row(s)
          {rows.length > MAX_VISIBLE ? ` — showing the first ${MAX_VISIBLE.toLocaleString()}` : ''}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-300 bg-white">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-left">
            <tr className="border-b-2 border-slate-300">
              <Th>Size</Th>
              <Th right>Area</Th>
              <Th right>Qty</Th>
              <Th right>Expected</Th>
              <Th>Exact Price / mm²</Th>
              <Th>Export Rate</Th>
              <Th right>Dec.</Th>
              <Th right>Recalculated</Th>
              <Th right>Difference</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                  {filter === 'problems' ? 'No problems — every populated price reproduces exactly.' : 'Nothing to show.'}
                </td>
              </tr>
            )}
            {shown.map((cell) => (
              <Row key={`${cell.rowIndex}-${cell.colIndex}`} cell={cell} onGoToCell={onGoToCell} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap px-2.5 py-2 font-semibold uppercase tracking-wide text-[10px] text-slate-600 ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Row({ cell, onGoToCell }: { cell: CellResult; onGoToCell: Props['onGoToCell'] }) {
  const tone =
    cell.status === 'PASS'
      ? 'hover:bg-emerald-50'
      : cell.status === 'INVALID'
        ? 'bg-amber-50 hover:bg-amber-100'
        : 'bg-red-50 hover:bg-red-100';

  return (
    <tr
      className={`cursor-pointer border-b border-slate-200 ${tone}`}
      onClick={() => onGoToCell(cell.rowIndex, FIRST_PRICE_COL + cell.colIndex)}
      title="Click to jump to this cell in the Price Table"
    >
      <td className="whitespace-nowrap px-2.5 py-1.5 text-slate-800">{cell.sizeLabel || '—'}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-700">
        {cell.baseArea != null ? groupDigits(cell.baseArea) : '—'}
      </td>
      <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-700">
        {cell.quantity != null ? groupDigits(cell.quantity) : '—'}
      </td>
      <td className="px-2.5 py-1.5 text-right tabular-nums font-medium text-slate-900">
        {cell.expectedPrice != null ? formatKrw(cell.expectedPrice) : cell.message ?? '—'}
      </td>
      <td className="px-2.5 py-1.5 font-mono text-[11px] text-slate-500">{cell.exactRate ?? '—'}</td>
      <td className="px-2.5 py-1.5 font-mono text-[11px] font-semibold text-slate-800">{cell.exportRate ?? '—'}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-600">{cell.decimalPlaces ?? '—'}</td>
      <td className="px-2.5 py-1.5 text-right tabular-nums text-slate-900">
        {cell.reconstructedPrice != null ? formatKrw(cell.reconstructedPrice) : '—'}
      </td>
      <td
        className={`px-2.5 py-1.5 text-right tabular-nums font-semibold ${
          cell.difference === '0' ? 'text-slate-400' : 'text-red-700'
        }`}
      >
        {cell.difference != null ? formatDifference(cell.difference) : '—'}
      </td>
      <td className="px-2.5 py-1.5">
        <StatusPill status={cell.status} />
      </td>
    </tr>
  );
}

export function StatusPill({ status }: { status: CellResult['status'] }) {
  const map = {
    PASS: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    FAIL: 'bg-red-100 text-red-800 border-red-300',
    NEEDS_REVIEW: 'bg-red-100 text-red-800 border-red-300',
    INVALID: 'bg-amber-100 text-amber-800 border-amber-300',
    BLANK: 'bg-slate-100 text-slate-500 border-slate-300',
  } as const;
  const label = status === 'NEEDS_REVIEW' ? 'NEEDS REVIEW' : status;
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${map[status]}`}>{label}</span>
  );
}

/**
 * The first thing to look at when a paste goes wrong: the distinct values the
 * parser could not read, most frequent first. A misaligned paste shows up here
 * instantly as a handful of text values repeated hundreds of times.
 */
function InvalidValues({
  samples,
  onGoToCell,
}: {
  samples: InvalidSample[];
  onGoToCell: Props['onGoToCell'];
}) {
  const [expanded, setExpanded] = useState(false);
  if (samples.length === 0) return null;

  const total = samples.reduce((sum, s) => sum + s.count, 0);
  const list = expanded ? samples : samples.slice(0, 6);

  const fieldLabel = { price: 'price cell', size: 'Size column', baseArea: 'Base Area column' } as const;

  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50">
      <div className="flex items-center justify-between border-b border-amber-300 px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-amber-900">
          Unreadable values — {total.toLocaleString()} cell(s), {samples.length.toLocaleString()} distinct value(s)
        </span>
        {samples.length > 6 && (
          <button className="text-xs text-amber-800 underline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : `Show all ${samples.length}`}
          </button>
        )}
      </div>

      <p className="px-3 pt-2 text-xs text-amber-800">
        These cells could not be read as numbers, so no rate was derived for them. If the values below look like
        headings or text from another column, the paste is misaligned — the grid expects{' '}
        <strong>Size · Base Area · then one column per quantity</strong>.
      </p>

      <ul className="max-h-44 divide-y divide-amber-200 overflow-auto px-1 py-1">
        {list.map((s, i) => (
          <li
            key={i}
            className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-xs hover:bg-amber-100"
            onClick={() =>
              onGoToCell(
                s.firstRowIndex,
                s.field === 'price' ? FIRST_PRICE_COL + s.firstColIndex : s.firstColIndex,
              )
            }
            title="Click to jump to the first occurrence"
          >
            <span className="min-w-[3.5rem] rounded bg-amber-200 px-1.5 py-0.5 text-center font-bold tabular-nums text-amber-900">
              {s.count.toLocaleString()}×
            </span>
            <code className="max-w-[22rem] truncate rounded border border-amber-300 bg-white px-1.5 py-0.5 font-mono text-[11px] text-red-700">
              {s.raw === '' ? '(empty)' : s.raw}
            </code>
            <span className="text-amber-700">in the {fieldLabel[s.field]}</span>
            <span className="ml-auto truncate text-amber-600">row {s.firstRowIndex + 1}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IssueList({ issues, onGoToCell }: { issues: Issue[]; onGoToCell: Props['onGoToCell'] }) {
  const [expanded, setExpanded] = useState(false);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (errors.length === 0 && warnings.length === 0) return null;

  const list = expanded ? [...errors, ...warnings] : [...errors, ...warnings].slice(0, 8);

  return (
    <div className="rounded-lg border border-slate-300 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Data integrity — {errors.length} error(s), {warnings.length} warning(s)
        </span>
        {errors.length + warnings.length > 8 && (
          <button className="text-xs text-blue-600 hover:underline" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : `Show all ${errors.length + warnings.length}`}
          </button>
        )}
      </div>
      <ul className="max-h-44 divide-y divide-slate-100 overflow-auto">
        {list.map((issue, i) => (
          <li
            key={i}
            className={`flex items-start gap-2 px-3 py-1.5 text-xs ${
              issue.rowIndex != null ? 'cursor-pointer hover:bg-slate-50' : ''
            }`}
            onClick={() =>
              issue.rowIndex != null &&
              onGoToCell(issue.rowIndex, issue.colIndex != null ? FIRST_PRICE_COL + issue.colIndex : 0)
            }
          >
            <span className={issue.severity === 'error' ? 'text-red-600' : 'text-amber-600'}>
              {issue.severity === 'error' ? '✕' : '⚠'}
            </span>
            <span className={issue.severity === 'error' ? 'text-red-800' : 'text-amber-800'}>{issue.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoundTripFailures({ result }: { result: EngineResult }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50">
      <div className="border-b border-red-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-red-800">
        CSV round-trip failures — {result.roundTrip.failures.length}
      </div>
      <div className="max-h-44 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-red-100 text-left text-[10px] uppercase text-red-700">
            <tr>
              <th className="px-2.5 py-1.5">area_factor</th>
              <th className="px-2.5 py-1.5">Qty</th>
              <th className="px-2.5 py-1.5">Rate in CSV</th>
              <th className="px-2.5 py-1.5 text-right">Expected</th>
              <th className="px-2.5 py-1.5 text-right">Calculated</th>
              <th className="px-2.5 py-1.5 text-right">Difference</th>
            </tr>
          </thead>
          <tbody>
            {result.roundTrip.failures.slice(0, 100).map((f, i) => (
              <tr key={i} className="border-b border-red-100">
                <td className="px-2.5 py-1 tabular-nums">{groupDigits(f.areaFactor)}</td>
                <td className="px-2.5 py-1 tabular-nums">{groupDigits(f.quantity)}</td>
                <td className="px-2.5 py-1 font-mono text-[11px]">{f.parsedRate}</td>
                <td className="px-2.5 py-1 text-right tabular-nums">{formatKrw(f.expected)}</td>
                <td className="px-2.5 py-1 text-right tabular-nums">
                  {f.reconstructed === '—' ? '—' : formatKrw(f.reconstructed)}
                </td>
                <td className="px-2.5 py-1 text-right tabular-nums font-semibold text-red-700">
                  {f.difference === '—' ? '—' : formatDifference(f.difference)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
