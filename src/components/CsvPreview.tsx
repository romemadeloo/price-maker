import { useMemo, useState } from 'react';
import type { EngineResult } from '../types';
import { downloadCsv } from '../lib/csv';
import { roundTripValidate } from '../lib/roundTrip';

interface Props {
  result: EngineResult;
  onReset: () => void;
  onRecalculate: () => void;
}

const PREVIEW_LINE_LIMIT = 1000;

export default function CsvPreview({ result, onReset, onRecalculate }: Props) {
  const [exportAnyway, setExportAnyway] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCheck, setManualCheck] = useState<string | null>(null);

  const { csv, summary, roundTrip } = result;
  const blocked = !summary.allValid;
  const canDownload = (!blocked || exportAnyway) && summary.totalPrices > 0;

  const { preview, truncated, lineCount } = useMemo(() => {
    const lines = csv.split('\n');
    const count = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    if (count <= PREVIEW_LINE_LIMIT) return { preview: csv, truncated: false, lineCount: count };
    return {
      preview: `${lines.slice(0, PREVIEW_LINE_LIMIT).join('\n')}\n…`,
      truncated: true,
      lineCount: count,
    };
  }, [csv]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  /** Re-run the round trip on demand against the CSV text shown right here. */
  const validateNow = () => {
    const rt = roundTripValidate(csv, result.cells);
    setManualCheck(
      rt.passed
        ? `✔ CSV VALIDATED — ${rt.message}`
        : `✕ ${rt.message}${rt.failures[0] ? ` First: area_factor ${rt.failures[0].areaFactor}, qty ${rt.failures[0].quantity}.` : ''}`,
    );
    setTimeout(() => setManualCheck(null), 8000);
  };

  const download = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `price-per-mm2-${stamp}.csv`);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-default" onClick={copy}>
          {copied ? '✔ Copied' : 'Copy CSV'}
        </button>
        <button
          className={canDownload ? 'btn btn-primary' : 'btn btn-default'}
          onClick={download}
          disabled={!canDownload}
          title={
            canDownload
              ? 'Download the generated CSV'
              : 'Blocked: validation failed. Tick "Export anyway" to override.'
          }
        >
          Download CSV
        </button>
        <button className="btn btn-default" onClick={validateNow}>
          Validate CSV
        </button>
        <button className="btn btn-default" onClick={onRecalculate}>
          Recalculate
        </button>
        <button className="btn btn-danger" onClick={onReset}>
          Reset
        </button>

        {blocked && (
          <label className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
            <input
              type="checkbox"
              checked={exportAnyway}
              onChange={(e) => setExportAnyway(e.target.checked)}
              className="accent-amber-600"
            />
            Export anyway
          </label>
        )}
      </div>

      {manualCheck && (
        <div
          className={`rounded-md border px-3 py-2 text-xs font-medium ${
            manualCheck.startsWith('✔')
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {manualCheck}
        </div>
      )}

      {blocked && exportAnyway && (
        <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>Warning:</strong> this CSV does not reproduce every expected price. Downloading it will export rates
          that are known to be wrong for{' '}
          {(summary.mismatched + summary.invalidInput + roundTrip.failures.length).toLocaleString()} value(s).
        </div>
      )}

      {!blocked && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          ✔ CSV VALIDATED — the serialized file was parsed back and reproduced all{' '}
          {roundTrip.checkedCells.toLocaleString()} expected prices exactly.
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {lineCount.toLocaleString()} line(s) · {result.quantities.length} quantity column(s) ·{' '}
          {(new Blob([csv]).size / 1024).toFixed(1)} KB
        </span>
        {truncated && <span>Preview limited to the first {PREVIEW_LINE_LIMIT.toLocaleString()} lines.</span>}
      </div>

      <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-300 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
        {preview}
      </pre>
    </div>
  );
}
