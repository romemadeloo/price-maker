import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CellResult, ParsedTable, SheetState } from '../types';
import {
  COL_BASE_AREA,
  COL_SIZE,
  FIRST_PRICE_COL,
  getCellValue,
  selectionToTsv,
  sheetToTsv,
} from '../state/sheetReducer';
import type { HistoryAction } from '../state/history';
import { parseClipboardMatrix, parseNumeric } from '../lib/parse';
import { groupDigits } from '../lib/decimal';
import {
  ColumnInsertIcon,
  CopyIcon,
  CutIcon,
  EraserIcon,
  FillDownIcon,
  PasteIcon,
  RedoIcon,
  RowInsertIcon,
  TrashIcon,
  UndoIcon,
} from './icons';

/*
 * A spreadsheet in the image of Google Sheets: lettered columns, numbered
 * rows, a formula bar, range selection by drag, right-click menus to insert
 * and delete rows and columns, undo/redo, and copy/paste that round-trips with
 * Sheets and Excel. Columns A (Size) and B (Base Area) are fixed; every column
 * from C on is a quantity, whose value is typed into the frozen header row.
 */

const ROW_H = 26;
const LETTER_H = 22;
const LABEL_H = 30;
const HEADER_H = LETTER_H + LABEL_H;
const W_ROWNUM = 46;
const W_SIZE = 124;
const W_AREA = 112;
const W_QTY = 104;
const OVERSCAN = 8;
const FOOTER_H = 48;

/** Sheets' selection blue. */
const BLUE = '#1a73e8';

export interface FocusRequest {
  rowIndex: number;
  colIndex: number;
  nonce: number;
}

interface Props {
  sheet: SheetState;
  dispatch: (action: HistoryAction) => void;
  canUndo: boolean;
  canRedo: boolean;
  parsed: ParsedTable;
  cellIndex: (CellResult | undefined)[][];
  focusRequest: FocusRequest | null;
}

interface Point {
  r: number;
  c: number;
}

interface Editing {
  r: number;
  c: number;
  value: string;
  /** Where the user is typing: in the cell itself, or in the formula bar. */
  source: 'cell' | 'bar';
}

type MenuState = { x: number; y: number } | null;

/** A, B, …, Z, AA, AB, … */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function SpreadsheetGrid({ sheet, dispatch, canUndo, canRedo, parsed, cellIndex, focusRequest }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<'cells' | 'rows' | 'cols' | null>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [anchor, setAnchor] = useState<Point>({ r: 0, c: 0 });
  const [focus, setFocus] = useState<Point>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const [menu, setMenu] = useState<MenuState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moreRows, setMoreRows] = useState('100');

  const editingRef = useRef(editing);
  editingRef.current = editing;

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
  const wholeRows = sel.c1 === 0 && sel.c2 === colCount - 1;
  const wholeCols = sel.r1 === 0 && sel.r2 === rowCount - 1;

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

  // Rows or columns removed (delete, undo): keep the selection on the sheet.
  useEffect(() => {
    const keep = (p: Point) => {
      const q = clamp(p);
      return q.r === p.r && q.c === p.c ? p : q;
    };
    setAnchor(keep);
    setFocus(keep);
  }, [clamp]);

  const scrollCellIntoView = useCallback((p: Point) => {
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
      else if (left + W_QTY > el.scrollLeft + el.clientWidth) el.scrollLeft = left + W_QTY - el.clientWidth;
    } else {
      el.scrollLeft = 0;
    }
  }, []);

  const moveTo = useCallback(
    (p: Point, extend: boolean) => {
      const next = clamp(p);
      setFocus(next);
      if (!extend) setAnchor(next);
      scrollCellIntoView(next);
    },
    [clamp, scrollCellIntoView],
  );

  const select = useCallback((a: Point, f: Point) => {
    setAnchor(a);
    setFocus(f);
  }, []);

  const refocus = () => containerRef.current?.focus();

  // Jump to a cell requested from elsewhere (e.g. the validation table).
  useEffect(() => {
    if (!focusRequest) return;
    const p = clamp({ r: focusRequest.rowIndex, c: focusRequest.colIndex });
    select(p, p);
    setEditing(null);
    scrollCellIntoView(p);
    containerRef.current?.focus();
  }, [focusRequest, clamp, scrollCellIntoView, select]);

  // A drag that started on the grid ends wherever the mouse is released.
  useEffect(() => {
    const stop = () => {
      dragRef.current = null;
    };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((m) => (m === message ? null : m)), 2200);
  }, []);

  /* ---------------- editing ---------------- */

  const beginEdit = useCallback(
    (p: Point, initial?: string, source: Editing['source'] = 'cell') => {
      setEditing({ r: p.r, c: p.c, value: initial ?? getCellValue(sheet, p.r, p.c), source });
    },
    [sheet],
  );

  /** Write the edit back (only if it changed anything) and optionally move. */
  const commitEdit = useCallback(
    (move?: Point) => {
      const cur = editingRef.current;
      // Clear the ref first: the editor's blur fires a second commit.
      editingRef.current = null;
      if (cur && cur.value !== getCellValue(sheet, cur.r, cur.c)) {
        dispatch({ type: 'setCell', rowIndex: cur.r, colIndex: cur.c, value: cur.value });
      }
      setEditing(null);
      if (move) moveTo(move, false);
    },
    [dispatch, moveTo, sheet],
  );

  const cancelEdit = () => {
    editingRef.current = null;
    setEditing(null);
    refocus();
  };

  useEffect(() => {
    if (editing?.source === 'cell') editInputRef.current?.focus();
  }, [editing?.source, editing?.r, editing?.c]);

  /* ---------------- operations (toolbar, menu, keyboard) ---------------- */

  const nRows = sel.r2 - sel.r1 + 1;
  const nCols = sel.c2 - sel.c1 + 1;
  /** Quantity columns inside the selection, as quantity indexes. */
  const qFirst = Math.max(sel.c1, FIRST_PRICE_COL) - FIRST_PRICE_COL;
  const qLast = sel.c2 - FIRST_PRICE_COL;
  const qCount = qLast >= qFirst ? qLast - qFirst + 1 : 0;

  const copySelection = useCallback(
    async (cut: boolean) => {
      const tsv = selectionToTsv(sheet, sel.r1, sel.r2, sel.c1, sel.c2);
      try {
        await navigator.clipboard.writeText(tsv);
        if (cut) dispatch({ type: 'clearCells', rowStart: sel.r1, rowEnd: sel.r2, colStart: sel.c1, colEnd: sel.c2 });
        flash(cut ? 'Cut' : 'Copied');
      } catch {
        flash(`Use ${cut ? 'Ctrl+X' : 'Ctrl+C'} — the browser blocked clipboard access`);
      }
    },
    [sheet, sel, dispatch, flash],
  );

  const pasteText = useCallback(
    (text: string) => {
      const matrix = parseClipboardMatrix(text);
      if (matrix.length === 0) return;
      dispatch({ type: 'paste', rowIndex: sel.r1, colIndex: sel.c1, matrix });
      // Select the block that was just written.
      const width = Math.max(...matrix.map((r) => r.length));
      select({ r: sel.r1, c: sel.c1 }, { r: sel.r1 + matrix.length - 1, c: sel.c1 + width - 1 });
    },
    [dispatch, sel, select],
  );

  const pasteFromMenu = async () => {
    try {
      pasteText(await navigator.clipboard.readText());
    } catch {
      flash('Use Ctrl+V to paste — the browser blocked clipboard access');
    }
  };

  const copySheet = async () => {
    try {
      await navigator.clipboard.writeText(sheetToTsv(sheet));
      const used = sheetToTsv(sheet).split('\n').length - 1;
      flash(`Copied the whole sheet — ${plural(used, 'row')} × ${plural(colCount, 'column')}, with headers`);
    } catch {
      flash('The browser blocked clipboard access — select all (Ctrl+A) and press Ctrl+C');
    }
  };

  const insertRows = (where: 'above' | 'below') => {
    const at = where === 'above' ? sel.r1 : sel.r2 + 1;
    dispatch({ type: 'addRows', count: nRows, atIndex: at });
    select({ r: at, c: wholeRows ? 0 : sel.c1 }, { r: at + nRows - 1, c: wholeRows ? colCount - 1 : sel.c2 });
  };

  const deleteRows = () => {
    const rowIndexes = Array.from({ length: nRows }, (_, i) => sel.r1 + i);
    dispatch({ type: 'deleteRows', rowIndexes });
    const p = { r: Math.min(sel.r1, Math.max(0, rowCount - nRows - 1)), c: focus.c };
    select(p, p);
    flash(`Deleted ${plural(nRows, 'row')} — Ctrl+Z to undo`);
  };

  const insertColumns = (where: 'left' | 'right') => {
    const count = Math.max(1, qCount);
    const at = where === 'left' ? qFirst : qCount > 0 ? qLast + 1 : 0;
    dispatch({ type: 'insertColumns', atIndex: at, count });
    const c1 = FIRST_PRICE_COL + at;
    select({ r: wholeCols ? 0 : sel.r1, c: c1 }, { r: wholeCols ? rowCount - 1 : sel.r2, c: c1 + count - 1 });
  };

  const deleteColumns = () => {
    if (qCount === 0) return;
    const colIndexes = Array.from({ length: qCount }, (_, i) => qFirst + i);
    dispatch({ type: 'deleteColumns', colIndexes });
    const p = { r: focus.r, c: Math.min(FIRST_PRICE_COL + qFirst, colCount - 1 - qCount) };
    select(p, p);
    flash(`Deleted ${plural(qCount, 'column')} — Ctrl+Z to undo`);
  };

  const clearSelection = () =>
    dispatch({ type: 'clearCells', rowStart: sel.r1, rowEnd: sel.r2, colStart: sel.c1, colEnd: sel.c2 });

  /** Ctrl+D / Ctrl+R. A single row (column) fills from the one above (left), as in Sheets. */
  const fill = (direction: 'down' | 'right') => {
    if (direction === 'down') {
      const rowStart = nRows === 1 ? sel.r1 - 1 : sel.r1;
      if (rowStart < 0) return;
      dispatch({ type: 'fill', direction, rowStart, rowEnd: sel.r2, colStart: sel.c1, colEnd: sel.c2 });
    } else {
      const colStart = nCols === 1 ? sel.c1 - 1 : sel.c1;
      if (colStart < 0) return;
      dispatch({ type: 'fill', direction, rowStart: sel.r1, rowEnd: sel.r2, colStart, colEnd: sel.c2 });
    }
  };

  const undo = () => dispatch({ type: 'undo' });
  const redo = () => dispatch({ type: 'redo' });

  /* ---------------- clipboard (keyboard shortcuts) ---------------- */

  useEffect(() => {
    /**
     * Only act on clipboard events aimed at the grid itself. When focus sits in
     * a real input — a quantity header, the cell editor, the formula bar — the
     * browser's own behaviour must win.
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
      e.clipboardData?.setData('text/plain', selectionToTsv(sheet, sel.r1, sel.r2, sel.c1, sel.c2));
    };
    const onCut = (e: ClipboardEvent) => {
      if (!isOurs(e)) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', selectionToTsv(sheet, sel.r1, sel.r2, sel.c1, sel.c2));
      dispatch({ type: 'clearCells', rowStart: sel.r1, rowEnd: sel.r2, colStart: sel.c1, colEnd: sel.c2 });
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!isOurs(e)) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      pasteText(text);
    };

    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, [hasFocus, editing, sheet, sel, dispatch, pasteText]);

  /* ---------------- keyboard ---------------- */

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;

    // Keys pressed inside a real input (a quantity header, the editor, the
    // formula bar) belong to that input — including its own Ctrl+Z.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const { r, c } = focus;

    if (mod && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === 'a') {
      e.preventDefault();
      select({ r: 0, c: 0 }, { r: rowCount - 1, c: colCount - 1 });
      return;
    }
    if (mod && (key === 'd' || key === 'r')) {
      e.preventDefault();
      fill(key === 'd' ? 'down' : 'right');
      return;
    }
    if (mod && e.key === ' ') {
      e.preventDefault();
      select({ r: 0, c: sel.c1 }, { r: rowCount - 1, c: sel.c2 });
      return;
    }
    if (e.shiftKey && e.key === ' ') {
      e.preventDefault();
      select({ r: sel.r1, c: 0 }, { r: sel.r2, c: colCount - 1 });
      return;
    }

    const extend = e.shiftKey;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveTo({ r: mod ? 0 : r - 1, c }, extend);
        return;
      case 'ArrowDown':
        e.preventDefault();
        moveTo({ r: mod ? rowCount - 1 : r + 1, c }, extend);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        moveTo({ r, c: mod ? 0 : c - 1 }, extend);
        return;
      case 'ArrowRight':
        e.preventDefault();
        moveTo({ r, c: mod ? colCount - 1 : c + 1 }, extend);
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
        setMenu(null);
        setAnchor(focus);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        clearSelection();
        return;
      case 'Home':
        e.preventDefault();
        moveTo({ r: mod ? 0 : r, c: 0 }, extend);
        return;
      case 'End':
        e.preventDefault();
        moveTo({ r: mod ? rowCount - 1 : r, c: colCount - 1 }, extend);
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

    // Other Ctrl/Cmd combos (copy, paste, …) go to the clipboard listeners.
    if (mod || e.altKey) return;

    // Any printable character starts an edit with that character.
    if (e.key.length === 1) {
      e.preventDefault();
      beginEdit(focus, e.key);
    }
  };

  const onEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const cur = editingRef.current;
    if (!cur) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit({ r: cur.r + 1, c: cur.c });
      refocus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit({ r: cur.r, c: cur.c + (e.shiftKey ? -1 : 1) });
      refocus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  /* ---------------- mouse ---------------- */

  const onCellMouseDown = (e: React.MouseEvent, p: Point) => {
    if (e.button === 2) {
      // Right-click inside the selection keeps it, as Sheets does.
      const inside = p.r >= sel.r1 && p.r <= sel.r2 && p.c >= sel.c1 && p.c <= sel.c2;
      if (!inside) select(p, p);
      return;
    }
    if (editingRef.current) commitEdit();
    if (e.shiftKey) setFocus(p);
    else select(p, p);
    dragRef.current = 'cells';
    refocus();
  };

  const onRowHeaderMouseDown = (e: React.MouseEvent, r: number) => {
    const inside = wholeRows && r >= sel.r1 && r <= sel.r2;
    if (e.button === 2 && inside) return;
    if (editingRef.current) commitEdit();
    if (e.shiftKey) select({ r: anchor.r, c: 0 }, { r, c: colCount - 1 });
    else select({ r, c: 0 }, { r, c: colCount - 1 });
    dragRef.current = 'rows';
    refocus();
  };

  const onColHeaderMouseDown = (e: React.MouseEvent, c: number) => {
    const inside = wholeCols && c >= sel.c1 && c <= sel.c2;
    if (e.button === 2 && inside) return;
    if (editingRef.current) commitEdit();
    if (e.shiftKey) select({ r: 0, c: anchor.c }, { r: rowCount - 1, c });
    else select({ r: 0, c }, { r: rowCount - 1, c });
    dragRef.current = 'cols';
    refocus();
  };

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const MENU_W = 272;
    const MENU_H = 440;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
      y: Math.min(e.clientY, window.innerHeight - MENU_H - 8),
    });
  };

  /* ---------------- selection stats (status bar) ---------------- */

  const stats = useMemo(() => {
    const cells = nRows * nCols;
    if (cells < 2 || cells > 200_000) return null;
    let count = 0;
    let sum = 0;
    for (let r = sel.r1; r <= sel.r2; r++) {
      for (let c = sel.c1; c <= sel.c2; c++) {
        const n = parseNumeric(getCellValue(sheet, r, c));
        if (n.value != null) {
          count += 1;
          sum += n.value;
        }
      }
    }
    return count > 0 ? { count, sum, avg: sum / count } : null;
  }, [sheet, sel, nRows, nCols]);

  /* ---------------- cell appearance ---------------- */

  const cellTone = (r: number, c: number): { classes: string; flag: boolean } => {
    const row = parsed.rows[r];
    if (c === COL_SIZE) {
      return row && !row.isEmpty && row.size.error
        ? { classes: 'bg-amber-50 text-amber-900', flag: true }
        : { classes: 'text-slate-900', flag: false };
    }
    if (c === COL_BASE_AREA) {
      if (row && !row.isEmpty && row.baseArea.error) return { classes: 'bg-red-50 text-red-700', flag: true };
      if (row?.baseAreaMismatch) return { classes: 'bg-amber-50 text-amber-900', flag: true };
      return { classes: 'text-slate-900', flag: false };
    }
    const result = cellIndex[r]?.[c - FIRST_PRICE_COL];
    if (!result) return { classes: 'text-slate-900', flag: false };
    if (result.status === 'PASS') return { classes: 'bg-emerald-50/70 text-slate-900', flag: false };
    if (result.status === 'INVALID') return { classes: 'bg-red-50 text-red-700', flag: true };
    if (result.status === 'NEEDS_REVIEW' || result.status === 'FAIL') {
      return { classes: 'bg-red-50 font-semibold text-red-700', flag: true };
    }
    return { classes: 'text-slate-900', flag: false };
  };

  /** The selection's outline is drawn on its edge cells, so it survives frozen columns. */
  const selectionShadow = (r: number, c: number): string | undefined => {
    const shadows: string[] = [];
    const isFocus = r === focus.r && c === focus.c;
    if (isFocus) shadows.push(`inset 0 0 0 2px ${BLUE}`);
    const inSel = r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;
    if (inSel && nRows * nCols > 1) {
      if (r === sel.r1) shadows.push(`inset 0 1px 0 ${BLUE}`);
      if (r === sel.r2) shadows.push(`inset 0 -1px 0 ${BLUE}`);
      if (c === sel.c1) shadows.push(`inset 1px 0 0 ${BLUE}`);
      if (c === sel.c2) shadows.push(`inset -1px 0 0 ${BLUE}`);
    }
    return shadows.length ? shadows.join(', ') : undefined;
  };

  const stickyLeft = (c: number): number | undefined => {
    if (c === COL_SIZE) return W_ROWNUM;
    if (c === COL_BASE_AREA) return W_ROWNUM + W_SIZE;
    return undefined;
  };
  const colWidth = (c: number) => (c === COL_SIZE ? W_SIZE : c === COL_BASE_AREA ? W_AREA : W_QTY);

  const headerTone = (selected: boolean, whole: boolean) =>
    whole && selected
      ? 'bg-[#0b57d0] text-white'
      : selected
        ? 'bg-[#d3e3fd] text-slate-900 font-semibold'
        : 'bg-[#f8f9fa] text-slate-500';

  const nameBox =
    nRows * nCols === 1
      ? `${columnLetter(focus.c)}${focus.r + 1}`
      : `${columnLetter(sel.c1)}${sel.r1 + 1}:${columnLetter(sel.c2)}${sel.r2 + 1}`;

  const barValue =
    editing && editing.r === focus.r && editing.c === focus.c ? editing.value : getCellValue(sheet, focus.r, focus.c);

  /* ---------------- render ---------------- */

  const rowRange = nRows === 1 ? `row ${sel.r1 + 1}` : `rows ${sel.r1 + 1}–${sel.r2 + 1}`;
  const colRange =
    qCount === 0
      ? ''
      : qCount === 1
        ? `column ${columnLetter(FIRST_PRICE_COL + qFirst)}`
        : `columns ${columnLetter(FIRST_PRICE_COL + qFirst)}–${columnLetter(FIRST_PRICE_COL + qLast)}`;

  // Like Sheets, a whole-row selection offers row actions, a whole-column
  // selection column actions, and a cell range both.
  const showRowItems = !wholeCols || wholeRows;
  const showColItems = !wholeRows || wholeCols;
  const menuItems: (MenuItem | null)[] = [
    { label: 'Cut', hint: 'Ctrl+X', icon: <CutIcon />, onClick: () => void copySelection(true) },
    { label: 'Copy', hint: 'Ctrl+C', icon: <CopyIcon />, onClick: () => void copySelection(false) },
    { label: 'Paste', hint: 'Ctrl+V', icon: <PasteIcon />, onClick: () => void pasteFromMenu() },
    null,
    ...(showRowItems
      ? [
          { label: `Insert ${plural(nRows, 'row')} above`, icon: <RowInsertIcon />, onClick: () => insertRows('above') },
          { label: `Insert ${plural(nRows, 'row')} below`, icon: <RowInsertIcon />, onClick: () => insertRows('below') },
        ]
      : []),
    ...(showColItems
      ? [
          {
            label: `Insert ${plural(Math.max(1, qCount), 'column')} left`,
            icon: <ColumnInsertIcon />,
            onClick: () => insertColumns('left'),
            disabled: sel.c1 < FIRST_PRICE_COL,
            title: 'Size and Base Area stay the first two columns',
          },
          {
            label: `Insert ${plural(Math.max(1, qCount), 'column')} right`,
            icon: <ColumnInsertIcon />,
            onClick: () => insertColumns('right'),
          },
        ]
      : []),
    null,
    ...(showRowItems ? [{ label: `Delete ${rowRange}`, icon: <TrashIcon />, onClick: deleteRows, danger: true }] : []),
    ...(showColItems
      ? [
          {
            label: colRange ? `Delete ${colRange}` : 'Delete column',
            icon: <TrashIcon />,
            onClick: deleteColumns,
            disabled: qCount === 0 || qCount >= sheet.quantities.length,
            title: qCount === 0 ? 'Size and Base Area cannot be deleted' : 'At least one quantity column has to stay',
            danger: true,
          },
        ]
      : []),
    { label: 'Clear values', hint: 'Delete', icon: <EraserIcon />, onClick: clearSelection },
    null,
    { label: 'Fill down', hint: 'Ctrl+D', icon: <FillDownIcon />, onClick: () => fill('down'), disabled: sel.r2 === 0 },
    {
      label: 'Fill right',
      hint: 'Ctrl+R',
      icon: <FillDownIcon className="-rotate-90" />,
      onClick: () => fill('right'),
      disabled: sel.c2 === 0,
    },
    null,
    { label: 'Copy whole sheet', icon: <CopyIcon />, onClick: () => void copySheet() },
  ];

  return (
    <div
      className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
      style={{ fontFamily: 'Arial, Roboto, "Pretendard", sans-serif' }}
    >
      {/* ------------------------------------------------ toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-[#f0f4f9] px-2 py-1.5">
        <ToolButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
          <UndoIcon />
        </ToolButton>
        <ToolButton label="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
          <RedoIcon />
        </ToolButton>
        <Divider />
        <ToolButton label="Copy the whole sheet, with headers — pastes into Google Sheets or Excel" onClick={copySheet} wide>
          <CopyIcon />
          <span className="text-xs font-medium">Copy sheet</span>
        </ToolButton>
        <Divider />
        <ToolButton label={`Insert ${plural(nRows, 'row')} below`} onClick={() => insertRows('below')}>
          <RowInsertIcon />
        </ToolButton>
        <ToolButton label={`Insert ${plural(Math.max(1, qCount), 'column')} right`} onClick={() => insertColumns('right')}>
          <ColumnInsertIcon />
        </ToolButton>
        <ToolButton label={`Delete ${rowRange}`} onClick={deleteRows}>
          <TrashIcon />
        </ToolButton>
        <Divider />
        <ToolButton label="Fill down (Ctrl+D)" onClick={() => fill('down')}>
          <FillDownIcon />
        </ToolButton>
        <ToolButton label="Clear selected cells (Delete)" onClick={clearSelection}>
          <EraserIcon />
        </ToolButton>
        <span className="ml-auto truncate pl-3 text-xs text-slate-500">
          {notice ?? 'Right-click a cell, row number or column letter for more'}
        </span>
      </div>

      {/* ------------------------------------------------ formula bar */}
      <div className="flex items-stretch border-b border-slate-200 text-[13px]">
        <div className="flex w-24 shrink-0 items-center border-r border-slate-200 px-3 font-medium text-slate-700">
          {nameBox}
        </div>
        <div className="flex items-center border-r border-slate-200 px-2.5 font-serif text-sm italic text-slate-400">fx</div>
        <input
          value={barValue}
          onFocus={() => setMenu(null)}
          onChange={(e) => {
            const value = e.target.value;
            setEditing({ r: focus.r, c: focus.c, value, source: 'bar' });
          }}
          onKeyDown={onEditKeyDown}
          onBlur={() => {
            if (editingRef.current?.source === 'bar') commitEdit();
          }}
          placeholder={focus.c >= FIRST_PRICE_COL ? 'Expected price' : focus.c === COL_SIZE ? 'Size, e.g. 100*100' : 'Base area'}
          className="min-w-0 flex-1 bg-white px-3 py-1.5 tabular-nums outline-none placeholder:text-slate-300"
          aria-label="Cell contents"
        />
      </div>

      {/* ------------------------------------------------ grid */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setHasFocus(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setHasFocus(false);
        }}
        onContextMenu={openMenu}
        className="min-h-0 flex-1 outline-none"
      >
        <div
          ref={scrollRef}
          onScroll={(e) => {
            setScrollTop((e.target as HTMLDivElement).scrollTop);
            setMenu(null);
          }}
          className="h-full select-none overflow-auto bg-white"
        >
          <div style={{ width: totalWidth, position: 'relative' }}>
            {/* Frozen header: column letters, then the labelled header row. */}
            <div className="sticky top-0 z-20" style={{ width: totalWidth }}>
              <div className="flex" style={{ height: LETTER_H }}>
                <div
                  onMouseDown={() => {
                    select({ r: 0, c: 0 }, { r: rowCount - 1, c: colCount - 1 });
                    refocus();
                  }}
                  className="sticky left-0 z-30 cursor-pointer border-b border-r border-[#c4c7c5] bg-[#f8f9fa]"
                  style={{ width: W_ROWNUM }}
                  title="Select all"
                />
                {Array.from({ length: colCount }, (_, c) => {
                  const selected = c >= sel.c1 && c <= sel.c2;
                  return (
                    <div
                      key={c}
                      onMouseDown={(e) => onColHeaderMouseDown(e, c)}
                      onMouseEnter={() => {
                        if (dragRef.current === 'cols') setFocus({ r: rowCount - 1, c });
                      }}
                      className={`${stickyLeft(c) != null ? 'sticky z-30' : ''} flex cursor-pointer items-center justify-center border-b border-r border-[#c4c7c5] text-[11px] ${headerTone(selected, wholeCols)}`}
                      style={{ width: colWidth(c), left: stickyLeft(c) }}
                    >
                      {columnLetter(c)}
                    </div>
                  );
                })}
              </div>

              <div className="flex border-b-2 border-[#c4c7c5]" style={{ height: LABEL_H }}>
                <div
                  className="sticky left-0 z-30 border-r border-[#c4c7c5] bg-[#f8f9fa]"
                  style={{ width: W_ROWNUM }}
                />
                <div
                  className="sticky z-30 flex items-center border-r border-[#e2e3e3] bg-[#f1f3f4] px-2 text-[12px] font-bold text-slate-700"
                  style={{ left: W_ROWNUM, width: W_SIZE }}
                >
                  Size
                </div>
                <div
                  className="sticky z-30 flex items-center justify-end border-r border-[#e2e3e3] bg-[#f1f3f4] px-2 text-[12px] font-bold text-slate-700"
                  style={{ left: W_ROWNUM + W_SIZE, width: W_AREA }}
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
                      className={`flex items-center border-r border-[#e2e3e3] ${
                        bad ? 'bg-red-50' : dup ? 'bg-amber-50' : 'bg-[#f1f3f4]'
                      }`}
                      style={{ width: W_QTY }}
                      title={pq?.error ?? (dup ? `Duplicate quantity column: ${pq?.value}` : `Quantity ${pq?.value ?? ''}`)}
                    >
                      <input
                        value={q}
                        placeholder="qty"
                        onChange={(e) => dispatch({ type: 'setQuantityHeader', colIndex: i, value: e.target.value })}
                        onPaste={(e) => {
                          const text = e.clipboardData.getData('text/plain');
                          // A single value is an ordinary paste into this one header.
                          if (!text || !/[\t\r\n]/.test(text)) return;
                          e.preventDefault();
                          const matrix = parseClipboardMatrix(text);
                          if (matrix.length > 0) dispatch({ type: 'pasteQuantities', colIndex: i, matrix });
                        }}
                        onContextMenu={(e) => e.stopPropagation()}
                        className={`h-full w-full bg-transparent px-2 text-right text-[12px] font-bold tabular-nums outline-none placeholder:font-normal placeholder:text-slate-400 focus:bg-white focus:shadow-[inset_0_0_0_2px_#1a73e8] ${
                          bad ? 'text-red-700' : 'text-slate-700'
                        }`}
                        aria-label={`Quantity for column ${columnLetter(FIRST_PRICE_COL + i)}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Virtualized rows */}
            <div style={{ height: rowCount * ROW_H, position: 'relative' }}>
              {visibleRows.map((r) => {
                const row = sheet.rows[r];
                if (!row) return null;
                const parsedRow = parsed.rows[r];
                const rowSelected = r >= sel.r1 && r <= sel.r2;

                return (
                  <div key={row.id} className="absolute flex" style={{ top: r * ROW_H, height: ROW_H, width: totalWidth }}>
                    <div
                      onMouseDown={(e) => onRowHeaderMouseDown(e, r)}
                      onMouseEnter={() => {
                        if (dragRef.current === 'rows') setFocus({ r, c: colCount - 1 });
                      }}
                      className={`sticky left-0 z-10 flex cursor-pointer items-center justify-center border-b border-r border-[#c4c7c5] text-[11px] tabular-nums ${headerTone(rowSelected, wholeRows)}`}
                      style={{ width: W_ROWNUM, height: ROW_H }}
                    >
                      {r + 1}
                    </div>

                    {Array.from({ length: colCount }, (_, c) => {
                      const isEditing = editing?.source === 'cell' && editing.r === r && editing.c === c;
                      const left = stickyLeft(c);
                      const value = getCellValue(sheet, r, c);
                      const result = c >= FIRST_PRICE_COL ? cellIndex[r]?.[c - FIRST_PRICE_COL] : undefined;
                      const tone = cellTone(r, c);
                      const inSel = rowSelected && c >= sel.c1 && c <= sel.c2;
                      const isFocus = r === focus.r && c === focus.c;

                      const title =
                        c === COL_BASE_AREA && parsedRow?.baseAreaMismatch
                          ? `Base area mismatch: provided ${parsedRow.baseArea.value}, width × height = ${parsedRow.size.calculatedArea}`
                          : c === COL_SIZE && parsedRow?.size.error && !parsedRow.isEmpty
                            ? parsedRow.size.error
                            : (result?.message ??
                              (result?.status === 'PASS' ? `Rate ${result.exportRate} · reconstructs exactly` : undefined));

                      return (
                        <div
                          key={c}
                          onMouseDown={(e) => onCellMouseDown(e, { r, c })}
                          onMouseEnter={() => {
                            if (dragRef.current === 'cells') setFocus({ r, c });
                          }}
                          onDoubleClick={() => beginEdit({ r, c })}
                          className={`relative truncate border-b border-r border-[#e2e3e3] px-1.5 text-[13px] leading-[25px] ${
                            c === COL_SIZE ? 'text-left' : 'text-right tabular-nums'
                          } ${left != null ? 'sticky z-[5]' : ''} ${tone.classes} ${
                            left != null && !tone.classes.includes('bg-') ? 'bg-white' : ''
                          }`}
                          style={{ width: colWidth(c), height: ROW_H, left, boxShadow: selectionShadow(r, c) }}
                          title={title}
                        >
                          {inSel && !isFocus && <span className="pointer-events-none absolute inset-0 bg-[#1a73e8]/10" />}
                          {tone.flag && (
                            <span className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-red-500" />
                          )}
                          {isEditing ? (
                            <input
                              ref={editInputRef}
                              value={editing.value}
                              onChange={(e) => setEditing({ r, c, value: e.target.value, source: 'cell' })}
                              onKeyDown={onEditKeyDown}
                              onBlur={() => commitEdit()}
                              className="absolute inset-0 z-10 w-full bg-white px-1.5 text-[13px] tabular-nums outline-none"
                              style={{ textAlign: c === COL_SIZE ? 'left' : 'right', boxShadow: `inset 0 0 0 2px ${BLUE}, 0 2px 6px rgba(0,0,0,.2)` }}
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

            {/* Sheets' "Add more rows at bottom". */}
            <div className="sticky left-0 flex items-center gap-2 px-3 text-[13px] text-slate-600" style={{ height: FOOTER_H, width: 'max-content' }}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const count = Math.max(1, Math.min(10_000, Math.floor(Number(moreRows)) || 0));
                  dispatch({ type: 'addRows', count });
                }}
                className="rounded border border-[#c4c7c5] bg-white px-3 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Add
              </button>
              <input
                value={moreRows}
                onChange={(e) => setMoreRows(e.target.value.replace(/[^\d]/g, ''))}
                onContextMenu={(e) => e.stopPropagation()}
                className="w-16 rounded border border-[#c4c7c5] px-2 py-1 text-right tabular-nums outline-none focus:border-[#1a73e8]"
                aria-label="Number of rows to add"
              />
              more rows at bottom
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ status bar */}
      <div className="flex items-center gap-3 border-t border-slate-200 bg-[#f8f9fa] px-3 py-1 text-[12px] text-slate-500">
        <span>
          {plural(rowCount, 'row')} × {plural(sheet.quantities.length, 'quantity column')}
        </span>
        {stats && (
          <span className="ml-auto flex gap-4 tabular-nums text-slate-700">
            <span>Sum: {groupDigits(Math.round(stats.sum * 100) / 100)}</span>
            <span>Average: {groupDigits(Math.round(stats.avg * 100) / 100)}</span>
            <span>Count: {stats.count.toLocaleString()}</span>
          </span>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(null);
            refocus();
          }}
          items={menuItems}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function ToolButton({
  label,
  onClick,
  disabled,
  wide,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      // Keep keyboard focus on the grid so shortcuts keep working after a click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-7 items-center justify-center gap-1.5 rounded-md text-slate-700 hover:bg-[#dde3ea] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent ${
        wide ? 'px-2' : 'w-7'
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-[#c4c7c5]" />;
}

interface MenuItem {
  label: string;
  hint?: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: (MenuItem | null)[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 w-[272px] rounded-lg border border-slate-200 bg-white py-1.5 text-[13px] shadow-[0_4px_16px_rgba(0,0,0,.18)]"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        item == null ? (
          <div key={i} className="my-1.5 h-px bg-slate-200" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            title={item.disabled ? item.title : undefined}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={`flex w-full items-center gap-3 px-3.5 py-1.5 text-left hover:bg-slate-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${
              item.danger ? 'text-red-700' : 'text-slate-800'
            }`}
          >
            <span className="flex w-4 justify-center text-slate-500">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.hint && <span className="text-xs text-slate-400">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
