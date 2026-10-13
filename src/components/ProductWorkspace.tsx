import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import SpreadsheetGrid, { type FocusRequest } from './SpreadsheetGrid';
import SummaryCards from './SummaryCards';
import ValidationTable from './ValidationTable';
import RateTable from './RateTable';
import CsvPreview from './CsvPreview';
import Calculator from './Calculator';
import ImportDialog from './ImportDialog';
import ProductionCompare from './ProductionCompare';
import {
  CalculatorIcon,
  ClipboardIcon,
  CompareIcon,
  ExternalIcon,
  FileIcon,
  MenuIcon,
  RateIcon,
  ShieldIcon,
  SparkIcon,
  TableIcon,
  TrashIcon,
  UploadIcon,
} from './icons';
import { runEngine } from '../lib/engine';
import { parseDelimited } from '../lib/parse';
import { CATEGORIES, priceListName, productUrl, type PriceList } from '../lib/products';
import Swatches from './Swatches';
import { compareDraft, type ProductionSnapshot } from '../lib/production';
import { timeAgo } from '../lib/format';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { DEFAULT_QUANTITIES, emptySheet, matrixToSheet, nextRowId, sheetReducer } from '../state/sheetReducer';
import { buildSampleSheet } from '../state/sampleData';
import type { EngineOptions, SheetState } from '../types';
import type { HeldDraft } from '../state/workspace';
import type { PriceUnit } from '../lib/calculator';

export type Tab = 'table' | 'rates' | 'calculator' | 'validation' | 'csv' | 'compare';

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'table', label: 'Price Table', icon: <TableIcon /> },
  { id: 'rates', label: 'Price Per mm²', icon: <RateIcon /> },
  { id: 'calculator', label: 'Calculator', icon: <CalculatorIcon /> },
  { id: 'validation', label: 'Validation', icon: <ShieldIcon /> },
  { id: 'csv', label: 'CSV Preview', icon: <FileIcon /> },
  { id: 'compare', label: 'Compare to Production', icon: <CompareIcon /> },
];

/** Wait this long after the last keystroke before recalculating (spec §20). */
const RECALC_DEBOUNCE_MS = 250;

interface Props {
  /** The product, or one color group of it, being drafted. */
  priceList: PriceList;
  /** The stored draft, or null for a product nobody has drafted yet. Read once, on mount. */
  initialSheet: SheetState | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Edited here and not on the shared server yet. */
  unsynced: boolean;
  /** Someone else saved this product first; our edits are waiting on a decision. */
  conflict: HeldDraft | null;
  /** A newer shared copy, not yet loaded because this product is open. */
  incoming: HeldDraft | null;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onDismissIncoming: () => void;
  onSaveDraft: (sheet: SheetState) => void;
  snapshot: ProductionSnapshot | null;
  onSnapshot: (snapshot: ProductionSnapshot) => void;
  /** Won unit drafted prices are rounded to before comparing; 1 = exact. */
  compareRounding: PriceUnit;
  onCompareRounding: (unit: PriceUnit) => void;
  options: EngineOptions;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onOpenNav: () => void;
}

/**
 * One price list's drafting workspace. Mounted with `key={key}`, so switching
 * lists starts from that list's stored draft with clean grid state.
 */
export default function ProductWorkspace({
  priceList,
  initialSheet,
  updatedAt,
  updatedBy,
  unsynced,
  conflict,
  incoming,
  onKeepMine,
  onTakeTheirs,
  onDismissIncoming,
  onSaveDraft,
  snapshot,
  onSnapshot,
  compareRounding,
  onCompareRounding,
  options,
  tab,
  onTabChange,
  onOpenNav,
}: Props) {
  const { product, variant } = priceList;
  const [sheet, dispatch] = useReducer(sheetReducer, initialSheet, (s) => s ?? emptySheet(DEFAULT_QUANTITIES, 15));
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [importOpen, setImportOpen] = useState(false);
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

  // Persist on the same debounce as recalculation, and once more on the way
  // out so a switch mid-debounce never loses the last keystrokes.
  useEffect(() => onSaveDraft(debouncedSheet), [debouncedSheet, onSaveDraft]);
  const latest = useRef({ sheet, onSaveDraft });
  latest.current = { sheet, onSaveDraft };
  useEffect(() => () => latest.current.onSaveDraft(latest.current.sheet), []);

  const changedCount = useMemo(() => {
    if (!snapshot) return null;
    const s = compareDraft(result.parsed, snapshot, { roundTo: compareRounding }).summary;
    return s.compared > 0 ? s.higher + s.lower : null;
  }, [result.parsed, snapshot, compareRounding]);

  const goToCell = useCallback(
    (rowIndex: number, colIndex: number) => {
      onTabChange('table');
      setFocusRequest({ rowIndex, colIndex, nonce: Date.now() });
    },
    [onTabChange],
  );

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
      onTabChange('table');
    },
    [sheet, onTabChange],
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

  const clearTable = () => {
    if (window.confirm(`Clear the drafted price table for ${priceListName(priceList)}?`)) dispatch({ type: 'clearAll' });
  };

  const category = CATEGORIES.find((c) => c.id === product.category);
  const showSummary = tab !== 'compare' && tab !== 'calculator';

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* ------------------------------------------------ header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-start gap-4 px-4 pb-3 pt-4 sm:px-6">
          <button className="btn btn-default mt-1 px-2 lg:hidden" onClick={onOpenNav} aria-label="Open products">
            <MenuIcon />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span>{category?.english}</span>
              <span className="text-slate-300">/</span>
              <span className="font-mono text-[11px]">{priceList.key}</span>
            </div>
            <h1 className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xl font-semibold tracking-tight text-slate-900">
              {product.name}
              <span className="text-sm font-normal text-slate-400">{product.english}</span>
              {variant && (
                <span className="inline-flex items-center gap-1.5 self-center rounded-lg bg-brand-50 px-2 py-0.5 text-sm font-medium text-brand-800 ring-1 ring-inset ring-brand-100">
                  <Swatches colors={variant.colors} />
                  {variant.name}
                  <span className="font-normal text-brand-600">{variant.english}</span>
                </span>
              )}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>
                {updatedAt
                  ? `Saved ${timeAgo(updatedAt)}${updatedBy ? ` by ${updatedBy}` : ''}`
                  : 'No draft yet'}
              </span>
              {unsynced && (
                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                  Not shared yet
                </span>
              )}
              <a
                href={productUrl(product)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700"
              >
                View on musticker.com <ExternalIcon width={12} height={12} />
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn btn-default"
              onClick={() => {
                dispatch({ type: 'replaceAll', sheet: buildSampleSheet() });
                onTabChange('table');
              }}
            >
              <SparkIcon width={14} height={14} />
              Load sample
            </button>
            <button className="btn btn-default" onClick={() => setImportOpen(true)}>
              <ClipboardIcon width={14} height={14} />
              Paste data
            </button>
            <button className="btn btn-default" onClick={() => fileInputRef.current?.click()}>
              <UploadIcon width={14} height={14} />
              Import CSV
            </button>
            <button className="btn btn-danger" onClick={clearTable}>
              <TrashIcon width={14} height={14} />
              Clear
            </button>
          </div>
        </div>

        {/* ------------------------------------------------ tabs */}
        <nav className="flex gap-1 overflow-x-auto px-3 sm:px-5">
          {TABS.map((t) => {
            const problems = result.summary.mismatched + result.summary.invalidInput;
            const badge =
              t.id === 'validation' && problems > 0 ? (
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                  {problems.toLocaleString()}
                </span>
              ) : t.id === 'compare' && changedCount != null ? (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    changedCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {changedCount > 0 ? `Δ ${changedCount.toLocaleString()}` : '='}
                </span>
              ) : null;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? 'text-brand-700' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className={active ? 'text-brand-600' : 'text-slate-400'}>{t.icon}</span>
                {t.label}
                {badge}
                {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />}
              </button>
            );
          })}
        </nav>
      </header>

      {conflict && (
        <SyncBanner
          tone="red"
          title={`${conflict.draft?.updatedBy ?? 'Someone else'} saved this product ${
            conflict.draft ? timeAgo(conflict.draft.updatedAt) : ''
          } while you were editing.`}
          body={
            conflict.draft
              ? 'Your changes are not shared yet. Keep yours to overwrite their version, or load theirs and discard yours.'
              : 'They cleared this product. Keep yours to restore it, or accept the deletion.'
          }
          actions={
            <>
              <button className="btn btn-default" onClick={onTakeTheirs}>
                {conflict.draft ? 'Load theirs' : 'Accept deletion'}
              </button>
              <button className="btn btn-danger" onClick={onKeepMine}>
                Keep mine
              </button>
            </>
          }
        />
      )}
      {!conflict && incoming && (
        <SyncBanner
          tone="brand"
          title={
            incoming.draft
              ? `${incoming.draft.updatedBy ?? 'Someone'} updated this product ${timeAgo(incoming.draft.updatedAt)}.`
              : 'This product was cleared by someone else.'
          }
          body="Load the latest version to see their changes. Editing without loading will ask you which version to keep."
          actions={
            <>
              <button className="btn btn-ghost" onClick={onDismissIncoming}>
                Not now
              </button>
              <button className="btn btn-primary" onClick={onTakeTheirs}>
                Load latest
              </button>
            </>
          }
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {showSummary && (
        <div className="px-4 pt-4 sm:px-6">
          <SummaryCards summary={result.summary} roundTrip={result.roundTrip} stale={pending} />
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6">
        {tab === 'table' && (
          <div className="flex h-full flex-col gap-3">
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

        {tab === 'calculator' && <Calculator result={result} options={options} />}

        {tab === 'validation' && <ValidationTable result={result} onGoToCell={goToCell} />}

        {tab === 'csv' && (
          <CsvPreview
            result={result}
            onReset={() => dispatch({ type: 'clearAll' })}
            onRecalculate={() => setRecalcNonce((n) => n + 1)}
          />
        )}

        {tab === 'compare' && (
          <ProductionCompare
            priceList={priceList}
            result={result}
            options={options}
            snapshot={snapshot}
            onSnapshot={onSnapshot}
            rounding={compareRounding}
            onRounding={onCompareRounding}
            onGoToCell={goToCell}
          />
        )}
      </main>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImport={importText} />
    </div>
  );
}

function SyncBanner({
  tone,
  title,
  body,
  actions,
}: {
  tone: 'red' | 'brand';
  title: string;
  body: string;
  actions: ReactNode;
}) {
  const box = tone === 'red' ? 'border-red-200 bg-red-50' : 'border-brand-200 bg-brand-50';
  const text = tone === 'red' ? 'text-red-900' : 'text-brand-900';
  return (
    <div className={`mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 sm:mx-6 ${box}`}>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${text}`}>{title}</div>
        <div className="text-xs text-slate-600">{body}</div>
      </div>
      <div className="flex gap-2">{actions}</div>
    </div>
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
      <button className="btn btn-default" onClick={onAddColumn}>
        + Quantity column
      </button>
      <button className="btn btn-danger" onClick={onDeleteRows} disabled={selectedRowCount === 0}>
        Delete {selectedRowCount > 0 ? `${selectedRowCount} ` : ''}row(s)
      </button>
      <span className="ml-auto text-xs text-slate-500">
        {rowCount.toLocaleString()} rows × {columnCount} quantity columns · Ctrl+V paste · Ctrl+C copy · Delete clears
      </span>
    </div>
  );
}
