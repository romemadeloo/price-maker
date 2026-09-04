import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CellResult, ParsedTable, SheetState } from '../types';
import {
  COL_BASE_AREA,
  COL_SIZE,
  FIRST_PRICE_COL,
  getCellValue,
  selectionToTsv,
  type SheetAction,
} from '../state/sheetReducer';
import { parseClipboardMatrix } from '../lib/parse';

const ROW_H = 30;
const HEADER_H = 36;
const W_ROWNUM = 52;
const W_SIZE = 132;
const W_AREA = 124;
const W_QTY = 116;
const OVERSCAN = 8;

export interface FocusRequest {
  rowIndex: number;
  colIndex: number;
  nonce: number;
}

interface Props {
  sheet: SheetState;
  dispatch: (action: SheetAction) => void;
  parsed: ParsedTable;
  cellIndex: (CellResult | undefined)[][];
  focusRequest: FocusRequest | null;
  onSelectionChange?: (rows: number[]) => void;
}

interface Point {
  r: number;
  c: number;
}

export default function SpreadsheetGrid({
  sheet,
  dispatch,
  parsed,
  cellIndex,
  focusRequest,
  onSelectionChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [anchor, setAnchor] = useState<Point>({ r: 0, c: 0 });
  const [focus, setFocus] = useState<Point>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null);
  const [hasFocus, setHasFocus] = useState(false);

  const colCount = FIRST_PRICE_COL + sheet.quantities.length;
  const rowCount = sheet.rows.length;
  const totalWidth = W_ROWNUM + W_SIZE + W_AREA + sheet.quantities.length * W_QTY;

  const sel = useMemo(
    () => ({
      r1: Math.min(anchor.r, focus.r),
      r2: Math.max(anchor.r, focus.r),
      c1: Math.min(anchor.c, focus.c),
      c2: Math.max(anchor.c, focus.c),
    }),
    [anchor, focus],
  );

  useEffect(() => {
    if (!onSelectionChange) return;
    const rows: number[] = [];
    for (let r = sel.r1; r <= sel.r2; r++) rows.push(r);
    onSelectionChange(rows);
  }, [sel, onSelectionChange]);

  /* ---------------- viewport measurement + virtualization ---------------- */

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endRow = Math.min(rowCount, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);
  const visibleRows = useMemo(() => {
    const out: number[] = [];
    for (let r = startRow; r < endRow; r++) out.push(r);
    return out;
  }, [startRow, endRow]);

  /* ---------------- selection helpers ---------------- */

  const clamp = useCallback(
    (p: Point): Point => ({
      r: Math.max(0, Math.min(rowCount - 1, p.r)),
      c: Math.max(0, Math.min(colCount - 1, p.c)),
    }),
    [rowCount, colCount],
  );

  const scrollCellIntoView = useCallback(
    (p: Point) => {
      const el = scrollRef.current;
      if (!el) return;
      const top = p.r * ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + el.clientHeight - HEADER_H) {
        el.scrollTop = top + ROW_H - el.clientHeight + HEADER_H;
      }

      const frozen = W_ROWNUM + W_SIZE + W_AREA;
      if (p.c >= FIRST_PRICE_COL) {
        const left = frozen + (p.c - FIRST_PRICE_COL) * W_QTY;
        if (left < el.scrollLeft + frozen) el.scrollLeft = left - frozen;
        else if (left + W_QTY > el.scrollLeft + el.clientWidth) {
          el.scrollLeft = left + W_QTY - el.clientWidth;
        }
      } else {
        el.scrollLeft = 0;
      }
    },
    [],
  );

  const moveTo = useCallback(
    (p: Point, extend: boolean) => {
      const next = clamp(p);
      setFocus(next);
      if (!extend) setAnchor(next);
      scrollCellIntoView(next);
    },
    [clamp, scrollCellIntoView],
  );

  // Jump to a cell requested from elsewhere (e.g. the validation table).
  useEffect(() => {
    if (!focusRequest) return;
    const p = clamp({ r: focusRequest.rowIndex, c: focusRequest.colIndex });
    setAnchor(p);
    setFocus(p);
    setEditing(null);
    scrollCellIntoView(p);
    containerRef.current?.focus();
  }, [focusRequest, clamp, scrollCellIntoView]);

  /* ---------------- editing ---------------- */

  const beginEdit = useCallback(
    (p: Point, initial?: string) => {
      setEditing({ r: p.r, c: p.c, value: initial ?? getCellValue(sheet, p.r, p.c) });
    },
    [sheet],
  );

  const commitEdit = useCallback(
    (move?: Point) => {
      setEditing((cur) => {
        if (cur) dispatch({ type: 'setCell', rowIndex: cur.r, colIndex: cur.c, value: cur.value });
        return null;
      });
      if (move) moveTo(move, false);
    },
    [dispatch, moveTo],
  );

  useEffect(() => {
    if (editing) editInputRef.current?.focus();
  }, [editing]);

  /* ---------------- clipboard ---------------- */

  useEffect(() => {
    /**
     * Only act on clipboard events aimed at the grid itself. When focus sits in
     * a real input — a quantity header, the cell editor — the browser's own
     * behaviour (or that input's handler) must win, or copying inside a header
     * would silently yank the grid selection instead.
     */
    const isOurs = (e: ClipboardEvent) => {
      if (!hasFocus || editing) return false;
      const t = e.target as HTMLElement | null;
      if (!t) return true;
      const tag = t.tagName;
      return tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !t.isContentEditable;
    };

    const onCopy = (e: ClipboardEvent) => {
      if (!isOurs(e)) return;
      e.preventDefault();
      const tsv = selectionToTsv(sheet, sel.r1, sel.r2, sel.c1, sel.c2);
      e.clipboardData?.setData('text/plain', tsv);
    };

    const onCut = (e: ClipboardEvent) => {
      if (!isOurs(e)) return;
      e.preventDefault();
      const tsv = selectionToTsv(sheet, sel.r1, sel.r2, sel.c1, sel.c2);
      e.clipboardData?.setData('text/plain', tsv);
      dispatch({ type: 'clearCells', rowStart: sel.r1, rowEnd: sel.r2, colStart: sel.c1, colEnd: sel.c2 });
    };

    const onPaste = (e: ClipboardEvent) => {
      if (!isOurs(e)) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      const matrix = parseClipboardMatrix(text);
      if (matrix.length === 0) return;
      dispatch({ type: 'paste', rowIndex: sel.r1, colIndex: sel.c1, matrix });
      // Select the block that was just written.
      const height = matrix.length;
      const width = Math.max(...matrix.map((r) => r.length));
      setAnchor({ r: sel.r1, c: sel.c1 });
      setFocus({ r: sel.r1 + height - 1, c: sel.c1 + width - 1 });
    };

    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, [hasFocus, editing, sheet, sel, dispatch]);

  /* ---------------- keyboard ---------------- */

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;

    // Keys pressed inside a real input — a quantity header, the cell editor —
    // belong to that input. Without this the grid swallows every character,
    // Ctrl+A selects cells instead of the field's text, and Delete wipes the
    // selected range while the caret is sitting in a header.
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }

    const extend = e.shiftKey;
    const { r, c } = focus;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveTo({ r: r - 1, c }, extend);
        return;
      case 'ArrowDown':
        e.preventDefault();
        moveTo({ r: r + 1, c }, extend);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        moveTo({ r, c: c - 1 }, extend);
        return;
      case 'ArrowRight':
        e.preventDefault();
        moveTo({ r, c: c + 1 }, extend);
        return;
      case 'Tab':
        e.preventDefault();
        moveTo({ r, c: c + (e.shiftKey ? -1 : 1) }, false);
        return;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        beginEdit(focus);
        return;
      case 'Escape':
        e.preventDefault();
        setAnchor(focus);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        dispatch({ type: 'clearCells', rowStart: sel.r1, rowEnd: sel.r2, colStart: sel.c1, colEnd: sel.c2 });
        return;
      case 'Home':
        e.preventDefault();
        moveTo({ r, c: 0 }, extend);
        return;
      case 'End':
        e.preventDefault();
        moveTo({ r, c: colCount - 1 }, extend);
        return;
      case 'PageDown':
        e.preventDefault();
        moveTo({ r: r + Math.floor(viewportH / ROW_H), c }, extend);
        return;
      case 'PageUp':
        e.preventDefault();
        moveTo({ r: r - Math.floor(viewportH / ROW_H), c }, extend);
        return;
      default:
        break;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setFocus({ r: rowCount - 1, c: colCount - 1 });
      return;
    }

    // Ctrl/Cmd combos (copy, paste, …) are handled by the clipboard listeners.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Any printable character starts an edit with that character.
    if (e.key.length === 1) {
      e.preventDefault();
      beginEdit(focus, e.key);
    }
  };

  const onEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!editing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit({ r: editing.r + 1, c: editing.c });
      containerRef.current?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit({ r: editing.r, c: editing.c + (e.shiftKey ? -1 : 1) });
      containerRef.current?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(null);
      containerRef.current?.focus();
    }
  };

  /* ---------------- cell appearance ---------------- */

  const cellClasses = (r: number, c: number): string => {
    const row = parsed.rows[r];
    const inSel = r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;
    const isFocus = r === focus.r && c === focus.c;

    let base = 'border-b border-r border-slate-200 px-2 text-[12px] leading-[28px] truncate';

    if (c === COL_SIZE) {
      base += ' text-slate-800';
      if (row && !row.isEmpty && row.size.error) base += ' bg-amber-50 text-amber-900';
    } else if (c === COL_BASE_AREA) {
      base += ' text-right tabular-nums text-slate-800';
      if (row && !row.isEmpty && row.baseArea.error) base += ' bg-red-50 text-red-800';
      else if (row?.baseAreaMismatch) base += ' bg-amber-50 text-amber-900';
    } else {
      base += ' text-right tabular-nums';
      const result = cellIndex[r]?.[c - FIRST_PRICE_COL];
      if (result) {
        if (result.status === 'PASS') base += ' bg-emerald-50/60 text-slate-900';
        else if (result.status === 'INVALID') base += ' bg-red-100 text-red-800 ring-1 ring-inset ring-red-400';
        else if (result.status === 'NEEDS_REVIEW' || result.status === 'FAIL') {
          base += ' bg-red-100 text-red-900 ring-1 ring-inset ring-red-500 font-semibold';
        } else base += ' text-slate-800';
      } else {
        base += ' text-slate-800';
      }
    }

    if (inSel) base += ' bg-blue-100/50';
    if (isFocus) base += ' outline outline-2 -outline-offset-2 outline-blue-600 z-[5]';
    return base;
  };

  const stickyLeft = (c: number): number | undefined => {
    if (c === COL_SIZE) return W_ROWNUM;
    if (c === COL_BASE_AREA) return W_ROWNUM + W_SIZE;
    return undefined;
  };

  const colWidth = (c: number) => (c === COL_SIZE ? W_SIZE : c === COL_BASE_AREA ? W_AREA : W_QTY);

  /* ---------------- render ---------------- */

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setHasFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setHasFocus(false);
      }}
      className="h-full outline-none"
    >
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        className="h-full overflow-auto border border-slate-300 bg-white"
      >
        <div style={{ width: totalWidth, position: 'relative' }}>
          {/* Sticky header */}
          <div
            className="sticky top-0 z-20 flex border-b-2 border-slate-400 bg-slate-100"
            style={{ width: totalWidth, height: HEADER_H }}
          >
            <div
              className="sticky left-0 z-30 flex items-center justify-center border-r border-slate-300 bg-slate-200 text-[11px] font-semibold text-slate-500"
              style={{ width: W_ROWNUM, height: HEADER_H }}
            >
              #
            </div>
            <div
              className="sticky z-30 flex items-center border-r border-slate-300 bg-slate-100 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600"
              style={{ left: W_ROWNUM, width: W_SIZE, height: HEADER_H }}
            >
              Size
            </div>
            <div
              className="sticky z-30 flex items-center justify-end border-r border-slate-300 bg-slate-100 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600"
              style={{ left: W_ROWNUM + W_SIZE, width: W_AREA, height: HEADER_H }}
            >
              Base Area
            </div>

            {sheet.quantities.map((q, i) => {
              const pq = parsed.quantities[i];
              const bad = pq?.error != null;
              const dup = pq?.duplicate ?? false;
              return (
                <div
                  key={i}
                  className={`group relative flex items-center border-r border-slate-300 ${
                    bad ? 'bg-red-100' : dup ? 'bg-amber-100' : 'bg-slate-100'
                  }`}
                  style={{ width: W_QTY, height: HEADER_H }}
                  title={pq?.error ?? (dup ? `Duplicate quantity column: ${pq?.value}` : `Quantity ${pq?.value}`)}
                >
                  <input
                    value={q}
                    onChange={(e) => dispatch({ type: 'setQuantityHeader', colIndex: i, value: e.target.value })}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData('text/plain');
                      // A single value with no tab/newline is an ordinary paste
                      // into this one header — let the browser handle it.
                      if (!text || !/[\t\r\n]/.test(text)) return;
                      e.preventDefault();
                      const matrix = parseClipboardMatrix(text);
                      if (matrix.length === 0) return;
                      dispatch({ type: 'pasteQuantities', colIndex: i, matrix });
                    }}
                    className={`w-full bg-transparent px-2 text-right text-[12px] font-semibold tabular-nums outline-none focus:bg-white ${
                      bad ? 'text-red-800' : 'text-slate-700'
                    }`}
                    aria-label={`Quantity column ${i + 1}`}
                  />
                  <button
                    onClick={() => dispatch({ type: 'deleteColumn', colIndex: i })}
                    className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded text-[10px] text-slate-400 hover:bg-red-100 hover:text-red-700 group-hover:flex"
                    title="Delete this quantity column"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {/* Virtualized rows */}
          <div style={{ height: rowCount * ROW_H, position: 'relative' }}>
            {visibleRows.map((r) => {
              const row = sheet.rows[r];
              if (!row) return null;
              const parsedRow = parsed.rows[r];
              const rowSelected = r >= sel.r1 && r <= sel.r2;

              return (
                <div
                  key={row.id}
                  className="absolute flex"
                  style={{ top: r * ROW_H, height: ROW_H, width: totalWidth }}
                >
                  <div
                    onMouseDown={() => {
                      setAnchor({ r, c: 0 });
                      setFocus({ r, c: colCount - 1 });
                      containerRef.current?.focus();
                    }}
                    className={`sticky left-0 z-10 flex cursor-pointer select-none items-center justify-center border-b border-r border-slate-300 text-[11px] tabular-nums ${
                      rowSelected ? 'bg-blue-200 text-blue-900' : 'bg-slate-100 text-slate-500'
                    }`}
                    style={{ width: W_ROWNUM, height: ROW_H }}
                    title="Click to select this row"
                  >
                    {r + 1}
                  </div>

                  {Array.from({ length: colCount }, (_, c) => {
                    const isEditing = editing?.r === r && editing?.c === c;
                    const left = stickyLeft(c);
                    const value = getCellValue(sheet, r, c);
                    const result = c >= FIRST_PRICE_COL ? cellIndex[r]?.[c - FIRST_PRICE_COL] : undefined;

                    const title =
                      c === COL_BASE_AREA && parsedRow?.baseAreaMismatch
                        ? `Base area mismatch: provided ${parsedRow.baseArea.value}, width × height = ${parsedRow.size.calculatedArea}`
                        : c === COL_SIZE && parsedRow?.size.error && !parsedRow.isEmpty
                          ? parsedRow.size.error
                          : result?.message ??
                            (result?.status === 'PASS' ? `Rate ${result.exportRate} · reconstructs exactly` : undefined);

                    return (
                      <div
                        key={c}
                        onMouseDown={(e) => {
                          if (editing) commitEdit();
                          const p = { r, c };
                          if (e.shiftKey) setFocus(p);
                          else {
                            setAnchor(p);
                            setFocus(p);
                          }
                          containerRef.current?.focus();
                        }}
                        onDoubleClick={() => beginEdit({ r, c })}
                        className={`relative ${left != null ? 'sticky z-10 bg-white' : ''} ${cellClasses(r, c)}`}
                        style={{ width: colWidth(c), height: ROW_H, left }}
                        title={title}
                      >
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            value={editing.value}
                            onChange={(e) => setEditing({ r, c, value: e.target.value })}
                            onKeyDown={onEditKeyDown}
                            onBlur={() => commitEdit()}
                            className="absolute inset-0 w-full border-2 border-blue-600 bg-white px-2 text-right text-[12px] tabular-nums outline-none"
                            style={{ textAlign: c === COL_SIZE ? 'left' : 'right' }}
                          />
                        ) : (
                          value
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
