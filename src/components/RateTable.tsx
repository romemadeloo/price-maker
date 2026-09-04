import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EngineResult } from '../types';
import { groupDigits } from '../lib/decimal';

interface Props {
  result: EngineResult;
}

const ROW_H = 28;
const OVERSCAN = 10;

/**
 * The generated price-per-mm² table, laid out like the input sheet: one row per
 * area_factor, one column per quantity. Virtualized for large tables.
 */
export default function RateTable({ result }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  const { rateRows, quantities } = result;
  const isEmpty = rateRows.length === 0;

  // Re-attach when the table goes from the empty placeholder to real rows —
  // the scroll container does not exist until then.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isEmpty]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rateRows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);
  const visible = useMemo(() => rateRows.slice(start, end).map((r, i) => ({ row: r, index: start + i })), [
    rateRows,
    start,
    end,
  ]);

  const W_AREA = 140;
  const W_QTY = 140;
  const totalWidth = W_AREA + quantities.length * W_QTY;

  if (isEmpty) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-slate-300 bg-white text-sm text-slate-500">
        Nothing generated yet — enter expected prices in the Price Table tab.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="text-xs text-slate-500">
        {rateRows.length.toLocaleString()} area_factor row(s) × {quantities.length} quantity column(s). Values are the
        exact strings that will be written to the CSV.
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-300 bg-white"
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ width: totalWidth, position: 'relative' }}>
          <div
            className="sticky top-0 z-20 flex border-b-2 border-slate-400 bg-slate-100"
            style={{ width: totalWidth, height: 34 }}
          >
            <div
              className="sticky left-0 z-30 flex items-center border-r border-slate-300 bg-slate-200 px-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-700"
              style={{ width: W_AREA }}
            >
              area_factor
            </div>
            {quantities.map((q) => (
              <div
                key={q}
                className="flex items-center justify-end border-r border-slate-300 px-2.5 text-[11px] font-semibold tabular-nums text-slate-600"
                style={{ width: W_QTY }}
              >
                {q.toLocaleString()}
              </div>
            ))}
          </div>

          <div style={{ height: rateRows.length * ROW_H, position: 'relative' }}>
            {visible.map(({ row, index }) => (
              <div
                key={row.areaFactor}
                className="absolute flex"
                style={{ top: index * ROW_H, height: ROW_H, width: totalWidth }}
              >
                <div
                  className="sticky left-0 z-10 flex items-center border-b border-r border-slate-300 bg-slate-50 px-2.5 text-[12px] font-semibold tabular-nums text-slate-800"
                  style={{ width: W_AREA }}
                >
                  {groupDigits(row.areaFactor)}
                </div>
                {row.rates.map((rate, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-end border-b border-r border-slate-200 px-2.5 font-mono text-[11px] tabular-nums text-slate-800"
                    style={{ width: W_QTY }}
                    title={rate ?? 'blank'}
                  >
                    {rate ?? <span className="text-slate-300">—</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
