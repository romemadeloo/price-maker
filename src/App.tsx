import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import SpreadsheetGrid, { type FocusRequest } from './components/SpreadsheetGrid';
import SummaryCards from './components/SummaryCards';
import ValidationTable from './components/ValidationTable';
import RateTable from './components/RateTable';
import CsvPreview from './components/CsvPreview';
import ImportDialog from './components/ImportDialog';
import { runEngine } from './lib/engine';
import { parseDelimited } from './lib/parse';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import {
  DEFAULT_QUANTITIES,
  emptySheet,
  matrixToSheet,
  nextRowId,
  sheetReducer,
} from './state/sheetReducer';
import { buildSampleSheet } from './state/sampleData';
import { DEFAULT_ENGINE_OPTIONS, type EngineOptions, type SheetState } from './types';

type Tab = 'table' | 'rates' | 'validation' | 'csv';

const TABS: { id: Tab; label: string }[] = [
  { id: 'table', label: 'Price Table' },
  { id: 'rates', label: 'Price Per mm²' },
  { id: 'validation', label: 'Validation' },
  { id: 'csv', label: 'CSV Preview' },
];

/** Wait this long after the last keystroke before recalculating (spec §20). */
const RECALC_DEBOUNCE_MS = 250;

export default function App() {
  const [sheet, dispatch] = useReducer(sheetReducer, undefined, () => emptySheet(DEFAULT_QUANTITIES, 15));
  const [tab, setTab] = useState<Tab>('table');
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [options, setOptions] = useState<EngineOptions>(DEFAULT_ENGINE_OPTIONS);
  const [recalcNonce, setRecalcNonce] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Recalculation runs off the debounced sheet so typing stays responsive; the
  // memo means an unrelated re-render never re-runs the engine.
  const [debouncedSheet, pending] = useDebouncedValue(sheet, RECALC_DEBOUNCE_MS);
  const result = useMemo(
    () => runEngine(debouncedSheet, options),
    // recalcNonce lets the Recalculate button force a fresh run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedSheet, options, recalcNonce],
  );

  const goToCell = useCallback((rowIndex: number, colIndex: number) => {
    setTab('table');
    setFocusRequest({ rowIndex, colIndex, nonce: Date.now() });
  }, []);

  const importText = useCallback(
    (text: string, mode: 'replace' | 'append') => {
      const matrix = parseDelimited(text);
      if (mode === 'replace') {
        dispatch({ type: 'replaceAll', sheet: matrixToSheet(matrix, sheet.quantities) });
      } else {
        const incoming = matrixToSheet(matrix, sheet.quantities);
        const merged: SheetState = {
          quantities: sheet.quantities,
          rows: [
            ...sheet.rows.filter(
              (r) => r.size.trim() !== '' || r.baseArea.trim() !== '' || r.prices.some((p) => p.trim() !== ''),
            ),
            ...incoming.rows.map((r) => ({
              ...r,
              id: nextRowId(),
              prices: sheet.quantities.map((_, i) => r.prices[i] ?? ''),
            })),
          ],
        };
        dispatch({ type: 'replaceAll', sheet: merged });
      }
      setTab('table');
    },
    [sheet],
  );

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    importText(text, 'replace');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const deleteSelectedRows = () => {
    if (selectedRows.length === 0) return;
    dispatch({ type: 'deleteRows', rowIndexes: selectedRows });
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Header
        onLoadSample={() => {
          dispatch({ type: 'replaceAll', sheet: buildSampleSheet() });
          setTab('table');
        }}
        onImportClick={() => setImportOpen(true)}
        onFileClick={() => fileInputRef.current?.click()}
        onClear={() => dispatch({ type: 'clearAll' })}
        options={options}
        setOptions={setOptions}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <SummaryCards summary={result.summary} roundTrip={result.roundTrip} stale={pending} />
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-4">
        {TABS.map((t) => {
          const badge =
            t.id === 'validation' && result.summary.mismatched + result.summary.invalidInput > 0
              ? result.summary.mismatched + result.summary.invalidInput
              : null;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
              {badge != null && (
                <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                  {badge.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <main className="min-h-0 flex-1 overflow-hidden p-4">
        {tab === 'table' && (
          <div className="flex h-full flex-col gap-2">
            <GridToolbar
              rowCount={sheet.rows.length}
              columnCount={sheet.quantities.length}
              selectedRowCount={selectedRows.length}
              onAddRow={() => dispatch({ type: 'addRows', count: 1 })}
              onAddManyRows={() => dispatch({ type: 'addRows', count: 100 })}
              onDeleteRows={deleteSelectedRows}
              onAddColumn={() => dispatch({ type: 'addColumn' })}
            />
            <div className="min-h-0 flex-1">
              <SpreadsheetGrid
                sheet={sheet}
                dispatch={dispatch}
                parsed={result.parsed}
                cellIndex={result.cellIndex}
                focusRequest={focusRequest}
                onSelectionChange={setSelectedRows}
              />
            </div>
          </div>
        )}

        {tab === 'rates' && <RateTable result={result} />}

        {tab === 'validation' && <ValidationTable result={result} onGoToCell={goToCell} />}

        {tab === 'csv' && (
          <CsvPreview
            result={result}
            onReset={() => dispatch({ type: 'clearAll' })}
            onRecalculate={() => setRecalcNonce((n) => n + 1)}
          />
        )}
      </main>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImport={importText} />
    </div>
  );
}

function Header({
  onLoadSample,
  onImportClick,
  onFileClick,
  onClear,
  options,
  setOptions,
}: {
  onLoadSample: () => void;
  onImportClick: () => void;
  onFileClick: () => void;
  onClear: () => void;
  options: EngineOptions;
  setOptions: (o: EngineOptions) => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight text-slate-900">Price Per mm² Generator</h1>
        <span className="text-xs text-slate-500">
          expected price ÷ (base area × quantity) — validated to the won
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-600" title="Decimal places the search starts at">
          Min dp
          <input
            type="number"
            min={0}
            max={options.maxDecimalPlaces}
            value={options.minDecimalPlaces}
            onChange={(e) =>
              setOptions({ ...options, minDecimalPlaces: Math.max(0, Number(e.target.value) || 0) })
            }
            className="w-14 rounded border border-slate-300 px-1.5 py-1 text-xs tabular-nums"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600" title="Upper bound for the precision search">
          Max dp
          <input
            type="number"
            min={options.minDecimalPlaces}
            max={30}
            value={options.maxDecimalPlaces}
            onChange={(e) =>
              setOptions({ ...options, maxDecimalPlaces: Math.min(30, Number(e.target.value) || 0) })
            }
            className="w-14 rounded border border-slate-300 px-1.5 py-1 text-xs tabular-nums"
          />
        </label>

        <span className="mx-1 h-5 w-px bg-slate-200" />

        <button className="btn btn-default" onClick={onLoadSample}>
          Load sample
        </button>
        <button className="btn btn-default" onClick={onImportClick}>
          Paste data
        </button>
        <button className="btn btn-default" onClick={onFileClick}>
          Import CSV
        </button>
        <button className="btn btn-danger" onClick={onClear}>
          Clear table
        </button>
      </div>
    </header>
  );
}

function GridToolbar({
  rowCount,
  columnCount,
  selectedRowCount,
  onAddRow,
  onAddManyRows,
  onDeleteRows,
  onAddColumn,
}: {
  rowCount: number;
  columnCount: number;
  selectedRowCount: number;
  onAddRow: () => void;
  onAddManyRows: () => void;
  onDeleteRows: () => void;
  onAddColumn: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn btn-default" onClick={onAddRow}>
        + Row
      </button>
      <button className="btn btn-default" onClick={onAddManyRows}>
        + 100 Rows
      </button>
      <button className="btn btn-danger" onClick={onDeleteRows} disabled={selectedRowCount === 0}>
        Delete {selectedRowCount > 0 ? `${selectedRowCount} ` : ''}row(s)
      </button>
      <button className="btn btn-default" onClick={onAddColumn}>
        + Quantity column
      </button>
      <span className="ml-auto text-xs text-slate-500">
        {rowCount.toLocaleString()} rows × {columnCount} quantity columns · paste with Ctrl+V, copy with Ctrl+C,
        clear with Delete
      </span>
    </div>
  );
}
