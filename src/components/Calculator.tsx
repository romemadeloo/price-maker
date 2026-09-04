import { useMemo, useState, type ReactNode } from 'react';
import type { EngineOptions, EngineResult } from '../types';
import {
  buildRateGrid,
  calculate,
  detectPriceUnit,
  PRICE_UNITS,
  type AxisResolution,
  type CalculatorResult,
  type InterpolationMode,
  type PriceUnit,
} from '../lib/calculator';
import { parseNumeric, parseSize } from '../lib/parse';
import { D, formatDifference, formatKrw, groupDigits } from '../lib/decimal';

interface Props {
  result: EngineResult;
  options: EngineOptions;
}

/**
 * Prices a size/quantity that falls between the rows and columns of the price
 * book, and shows exactly which rates and base area produced the answer.
 */
export default function Calculator({ result, options }: Props) {
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [typedArea, setTypedArea] = useState('');
  const [areaOverridden, setAreaOverridden] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [mode, setMode] = useState<InterpolationMode>('staged');
  const [chosenUnit, setChosenUnit] = useState<PriceUnit | null>(null);

  const grid = useMemo(() => buildRateGrid(result), [result]);

  // The unit the price book itself is quoted on, until the user overrides it.
  const detectedUnit = useMemo(() => detectPriceUnit(result), [result]);
  const roundTo = chosenUnit ?? detectedUnit;

  // Base area follows width × height unless the user has typed over it. Deriving
  // it rather than syncing it through an effect means the two can never drift.
  const autoArea = useMemo(() => areaFromDimensions(width, height), [width, height]);
  const baseArea = areaOverridden ? typedArea : autoArea;

  const touched =
    width.trim() !== '' || height.trim() !== '' || baseArea.trim() !== '' || quantity.trim() !== '';

  const calc = useMemo(
    () => calculate({ width, height, baseArea, quantity, mode, roundTo }, result, options),
    [width, height, baseArea, quantity, mode, roundTo, result, options],
  );

  /** Pasting "600*610" into either dimension box fills them both. */
  const onDimension = (which: 'w' | 'h', value: string) => {
    const parsed = parseSize(value);
    if (parsed.width != null && parsed.height != null) {
      setWidth(String(parsed.width));
      setHeight(String(parsed.height));
      return;
    }
    (which === 'w' ? setWidth : setHeight)(value);
  };

  const onArea = (value: string) => {
    setTypedArea(value);
    // Clearing the box hands control back to width × height.
    setAreaOverridden(value.trim() !== '');
  };

  const overridden = areaOverridden && autoArea !== '' && autoArea !== baseArea;

  return (
    <div className="flex h-full gap-5 overflow-hidden">
      {/* ---------------------------------------------------- inputs */}
      <aside className="flex w-[352px] shrink-0 flex-col gap-4 overflow-y-auto pr-1">
        <Panel title="Specification">
          {/* items-end so the separator lines up with the inputs, not the labels. */}
          <div className="flex items-end gap-2.5">
            <Field label="Width" suffix="mm" value={width} onChange={(v) => onDimension('w', v)} placeholder="123" />
            <span className="pb-2.5 text-sm font-light text-slate-300">×</span>
            <Field label="Height" suffix="mm" value={height} onChange={(v) => onDimension('h', v)} placeholder="123" />
          </div>

          <Field
            label="Base area"
            suffix="mm²"
            value={baseArea}
            onChange={onArea}
            placeholder="15129"
            tone={overridden ? 'override' : 'derived'}
            hint={
              overridden
                ? `Overriding width × height (${groupDigits(autoArea)})`
                : autoArea !== ''
                  ? 'Derived from width × height'
                  : 'Derived from width × height, or enter it directly'
            }
            action={overridden ? { label: 'Reset', onClick: () => setAreaOverridden(false) } : undefined}
          />

          <Field label="Quantity" value={quantity} onChange={setQuantity} placeholder="123" />
        </Panel>

        <Panel title="Pricing rules">
          <Control
            label="Price unit"
            note={
              chosenUnit == null ? (
                <>
                  Detected from your price table — every price is a multiple of ₩{detectedUnit}. Applied at
                  every stage of the quote.
                </>
              ) : (
                <>
                  Overriding the detected ₩{detectedUnit}.{' '}
                  <button
                    className="font-medium text-blue-600 underline-offset-2 hover:underline"
                    onClick={() => setChosenUnit(null)}
                  >
                    Use detected
                  </button>
                </>
              )
            }
          >
            <Segmented
              options={PRICE_UNITS.map((u) => ({ value: u, label: `₩${u}` }))}
              value={roundTo}
              onChange={setChosenUnit}
            />
          </Control>

          <Control
            label="Method"
            note={
              mode === 'staged'
                ? 'Collapse the size axis and round to the unit, then the quantity axis and round again — matching the production quotation service.'
                : 'Blend the neighbouring price-per-mm² values across both axes at once, rounding only at the end.'
            }
          >
            <Segmented
              options={[
                { value: 'staged' as InterpolationMode, label: 'Staged' },
                { value: 'rate' as InterpolationMode, label: 'Blend rates' },
              ]}
              value={mode}
              onChange={setMode}
            />
          </Control>
        </Panel>

        <Panel title="Table coverage">
          <Coverage label="area_factor" values={grid.areas} requested={calc.baseArea} resolution={calc.area} />
          <Coverage label="quantity" values={grid.quantities} requested={calc.quantity} resolution={calc.qty} />
        </Panel>
      </aside>

      {/* --------------------------------------------------- results */}
      <section className="min-w-0 flex-1 overflow-y-auto pr-1">
        {!touched ? (
          <Placeholder grid={grid} />
        ) : calc.errors.length > 0 ? (
          <Notice tone="neutral" title="Nothing to calculate yet" items={calc.errors} />
        ) : (
          <Answer calc={calc} />
        )}
      </section>
    </div>
  );
}

/** width × height as an exact plain string, or '' when either is unusable. */
function areaFromDimensions(width: string, height: string): string {
  const w = parseNumeric(width);
  const h = parseNumeric(height);
  if (w.normalized == null || h.normalized == null) return '';
  if ((w.value as number) <= 0 || (h.value as number) <= 0) return '';
  return new D(w.normalized).times(h.normalized).toFixed();
}

/* ================================================================== */
/* The answer                                                          */
/* ================================================================== */

function Answer({ calc }: { calc: CalculatorResult }) {
  const interpolated = calc.area?.kind !== 'exact' || calc.qty?.kind !== 'exact';

  return (
    <div className="flex flex-col gap-4 pb-2">
      {calc.outOfRange.length > 0 && (
        <Notice tone="danger" title="Outside the quotable range" items={calc.outOfRange} />
      )}

      {/* -------------------------------------------------- the quote */}
      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-6 px-5 pb-4 pt-4">
          <div className="min-w-0">
            <Label>Quote</Label>
            <div className="mt-1 text-[40px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
              {formatKrw(calc.price as string)}
            </div>
            {calc.normalized && calc.roundTo > 1 && (
              <div className="mt-1.5 text-xs text-slate-500 tabular-nums">
                from {formatKrw(calc.rawPrice as string)}, normalized to the nearest ₩{calc.roundTo}
              </div>
            )}
          </div>

          <div className="text-right">
            <Label>Price per mm²</Label>
            <div className="mt-1 font-mono text-xl leading-none tracking-tight text-slate-900 tabular-nums">
              {calc.exportRate}
            </div>
            <div className="mt-1.5 text-[11px] text-slate-400 tabular-nums">
              {calc.decimalPlaces} dp · exact {calc.effectiveRate}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-slate-100 sm:grid-cols-4">
          <Stat label="Size">{calc.sizeLabel ? `${calc.sizeLabel} mm` : '—'}</Stat>
          <Stat label="Base area">{groupDigits(calc.baseArea as number)} mm²</Stat>
          <Stat label="Quantity">{(calc.quantity as number).toLocaleString()}</Stat>
          <Stat label="Method">{calc.mode === 'staged' ? 'Staged' : 'Blend rates'}</Stat>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <Badge
            tone={calc.verified ? 'good' : 'bad'}
            label={
              calc.verified
                ? `Rebuilds exactly — ${groupDigits(calc.baseArea as number)} × ${(calc.quantity as number).toLocaleString()} × ${calc.exportRate} = ${formatKrw(calc.reconstructed as string)}`
                : `Rebuilds to ${formatKrw(calc.reconstructed as string)} — off by ${formatDifference(calc.difference as string)}`
            }
          />
          {calc.matchesTable === true && <Badge tone="good" label="Exact match with the price book" />}
          {interpolated && (
            <Badge
              tone="muted"
              label={`Interpolated from ${calc.corners.length} table value${calc.corners.length === 1 ? '' : 's'}`}
            />
          )}
          <Badge
            tone={calc.baseAreaMismatch ? 'warn' : 'muted'}
            label={
              calc.baseAreaMismatch
                ? `Base area ≠ width × height (${groupDigits(calc.calculatedArea as number)})`
                : calc.baseAreaSource === 'size'
                  ? 'Base area from width × height'
                  : 'Base area as entered'
            }
          />
        </div>

        {calc.alternatePrice != null && (
          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
            {calc.mode === 'staged' ? 'Blending the rates' : 'The staged method'} instead would quote{' '}
            <span className="font-semibold tabular-nums text-slate-900">{formatKrw(calc.alternatePrice)}</span>
            <span className="tabular-nums text-slate-400">
              {' '}
              ({formatDifference(new D(calc.alternatePrice).minus(calc.price as string).toFixed())})
            </span>
          </div>
        )}
      </article>

      {calc.warnings.length > 0 && <Notice tone="warn" title="Worth checking" items={calc.warnings} />}

      {/* ------------------------------------------------- the working */}
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <Label>How the answer was reached</Label>

        <div className="mt-2.5 space-y-1 text-[13px] leading-relaxed text-slate-700">
          <AxisLine res={calc.area} />
          <AxisLine res={calc.qty} />
        </div>

        {calc.dimensionStage.length > 0 && <Stages calc={calc} />}

        {calc.blendedRate != null && (
          <div className="mt-4">
            <SubLabel>Blend</SubLabel>
            <Formula>
              rate = {calc.blendedRate}
              {'\n'}price = ROUND({groupDigits(calc.baseArea as number)} ×{' '}
              {(calc.quantity as number).toLocaleString()} × {calc.blendedRate}, 0) ={' '}
              {formatKrw(calc.rawPrice as string)}
              {calc.normalized && `\non ₩${calc.roundTo} = ${formatKrw(calc.price as string)}`}
            </Formula>
          </div>
        )}

        <div className="mt-4">
          <SubLabel>Table values in play</SubLabel>
          <Table
            head={['area_factor', 'Quantity', 'Price per mm²', 'Price there', 'Weight']}
            align={['left', 'right', 'left', 'right', 'right']}
          >
            {calc.corners.map((c) => (
              <tr key={`${c.areaFactor}|${c.quantity}`} className="border-b border-slate-50 last:border-0">
                <Td>{groupDigits(c.areaFactor)}</Td>
                <Td align="right">{c.quantity.toLocaleString()}</Td>
                <Td mono>{c.rate}</Td>
                <Td align="right" muted>
                  {formatKrw(c.price)}
                </Td>
                <Td align="right" mono muted>
                  {c.weight}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      </article>
    </div>
  );
}

/**
 * The two passes of a staged quote, laid out the way the production debug
 * payload is (`inbetween_src` then `inbetween_qty_src`) so the two can be read
 * side by side when a quote is being chased down.
 */
function Stages({ calc }: { calc: CalculatorResult }) {
  const unit = calc.roundTo;
  const first = calc.dimensionStage[0];
  const spansAreas = first.lowerAreaFactor !== first.upperAreaFactor;

  return (
    <div className="mt-4 space-y-4">
      <div>
        <SubLabel>Stage 1 · your size, at each bracketing quantity</SubLabel>
        <Table
          head={[
            'Quantity',
            `At ${groupDigits(first.lowerAreaFactor)}`,
            ...(spansAreas ? [`At ${groupDigits(first.upperAreaFactor)}`, 'Interpolated'] : []),
            `On ₩${unit}`,
          ]}
          align={spansAreas ? ['left', 'right', 'right', 'right', 'right'] : ['left', 'right', 'right']}
        >
          {calc.dimensionStage.map((s) => (
            <tr key={s.quantity} className="border-b border-slate-50 last:border-0">
              <Td>{s.quantity.toLocaleString()}</Td>
              <Td align="right" muted>
                {formatKrw(s.lowerBoundPrice)}
              </Td>
              {spansAreas && (
                <>
                  <Td align="right" muted>
                    {formatKrw(s.upperBoundPrice)}
                  </Td>
                  <Td align="right" muted>
                    {formatKrw(s.rawPrice)}
                  </Td>
                </>
              )}
              <Td align="right" strong>
                {formatKrw(s.price)}
              </Td>
            </tr>
          ))}
        </Table>
      </div>

      {calc.quantityStage && (
        <div>
          <SubLabel>Stage 2 · across quantity, over those rounded prices</SubLabel>
          <Formula>
            {formatKrw(calc.quantityStage.lowerPrice)} at {calc.quantityStage.lowerQuantity.toLocaleString()}
            {'  →  '}
            {formatKrw(calc.quantityStage.upperPrice)} at {calc.quantityStage.upperQuantity.toLocaleString()}
            {'\n'}
            {formatKrw(calc.quantityStage.lowerPrice)} + ({(calc.quantity as number).toLocaleString()} −{' '}
            {calc.quantityStage.lowerQuantity.toLocaleString()}) ×{' '}
            {new D(calc.quantityStage.upperPrice)
              .minus(calc.quantityStage.lowerPrice)
              .div(calc.quantityStage.upperQuantity - calc.quantityStage.lowerQuantity)
              .toFixed()}
            {'  =  '}
            {formatKrw(calc.quantityStage.rawPrice)}
            {'\n'}on ₩{unit} = {formatKrw(calc.quantityStage.price)}
          </Formula>
        </div>
      )}
    </div>
  );
}

function AxisLine({ res }: { res: AxisResolution | null }) {
  if (!res) return null;
  const name = res.label === 'area_factor' ? 'Base area' : 'Quantity';
  const subject = (
    <span className="font-semibold text-slate-900">
      {name} {res.requested.toLocaleString()}
    </span>
  );

  if (res.kind === 'exact') return <p>{subject} is a row in the table — used directly.</p>;

  if (res.kind === 'interpolated') {
    return (
      <p>
        {subject} sits between <Num>{(res.lower as number).toLocaleString()}</Num> and{' '}
        <Num>{(res.upper as number).toLocaleString()}</Num> — <Num>{res.weight}</Num> of the way up.
      </p>
    );
  }

  return (
    <p>
      {subject} — {res.note}
    </p>
  );
}

function Coverage({
  label,
  values,
  requested,
  resolution,
}: {
  label: string;
  values: number[];
  requested: number | null;
  resolution: AxisResolution | null;
}) {
  if (values.length === 0) return null;
  const shown = values.length > 12 ? [...values.slice(0, 6), NaN, ...values.slice(-5)] : values;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <SubLabel>{label}</SubLabel>
        <span className="text-[11px] tabular-nums text-slate-400">
          {values[0].toLocaleString()} – {values[values.length - 1].toLocaleString()}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {shown.map((v) =>
          Number.isNaN(v) ? (
            <span key="gap" className="px-0.5 text-[11px] text-slate-300">
              ⋯
            </span>
          ) : (
            <span
              key={v}
              className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums transition-colors ${
                requested === v
                  ? 'bg-blue-600 font-medium text-white'
                  : resolution?.lower === v || resolution?.upper === v
                    ? 'bg-blue-50 font-medium text-blue-700 ring-1 ring-inset ring-blue-200'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {v.toLocaleString()}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

function Placeholder({ grid }: { grid: { areas: number[]; quantities: number[] } }) {
  const empty = grid.areas.length === 0;
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60">
      <div className="max-w-sm px-8 text-center">
        <p className="text-sm font-medium text-slate-700">
          {empty ? 'No price book loaded' : 'Enter a size and quantity'}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          {empty ? (
            <>Add expected prices in the Price Table tab, and this will price anything against them.</>
          ) : (
            <>
              {grid.areas.length.toLocaleString()} area_factor rows ×{' '}
              {grid.quantities.length.toLocaleString()} quantity columns available. Values in between are
              interpolated; values above the largest hold the nearest rate.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Presentational primitives                                           */
/* ================================================================== */

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400">{children}</div>
  );
}

function SubLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{children}</div>
  );
}

function Num({ children }: { children: ReactNode }) {
  return <span className="font-medium tabular-nums text-slate-900">{children}</span>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-2.5">
        <Label>{title}</Label>
      </header>
      <div className="flex flex-col gap-3.5 p-4">{children}</div>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-r border-slate-100 px-5 py-3 last:border-r-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-medium tabular-nums text-slate-800">{children}</div>
    </div>
  );
}

function Control({ label, note, children }: { label: string; note: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-slate-700">{label}</div>
      {children}
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{note}</p>
    </div>
  );
}

function Field({
  label,
  suffix,
  hint,
  value,
  onChange,
  placeholder,
  action,
  tone,
}: {
  label: string;
  suffix?: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  action?: { label: string; onClick: () => void };
  tone?: 'derived' | 'override';
}) {
  return (
    <label className="block flex-1">
      <span className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-slate-700">{label}</span>
        {action && (
          <button
            className="text-[11px] font-medium text-blue-600 underline-offset-2 hover:underline"
            onClick={(e) => {
              e.preventDefault();
              action.onClick();
            }}
          >
            {action.label}
          </button>
        )}
      </span>

      <span className="relative block">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          inputMode="decimal"
          className={`h-9 w-full rounded-md border bg-white px-2.5 text-sm tabular-nums text-slate-900
                      placeholder:text-slate-300 outline-none transition-colors
                      focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${
                        tone === 'override' ? 'border-amber-300 bg-amber-50/40' : 'border-slate-300'
                      } ${suffix ? 'pr-9' : ''}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-slate-400">
            {suffix}
          </span>
        )}
      </span>

      {hint && <span className="mt-1 block text-[11px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded px-2.5 py-1.5 text-xs font-medium transition-all ${
            value === o.value
              ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const BADGE_TONES = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  bad: 'border-red-200 bg-red-50 text-red-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  muted: 'border-slate-200 bg-white text-slate-600',
} as const;

const BADGE_MARKS = { good: '✓', bad: '✕', warn: '!', muted: '·' } as const;

function Badge({ tone, label }: { tone: keyof typeof BADGE_TONES; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${BADGE_TONES[tone]}`}
    >
      <span aria-hidden className="font-semibold">
        {BADGE_MARKS[tone]}
      </span>
      {label}
    </span>
  );
}

const NOTICE_TONES = {
  danger: { box: 'border-red-200 bg-red-50', title: 'text-red-900', body: 'text-red-800' },
  warn: { box: 'border-amber-200 bg-amber-50', title: 'text-amber-900', body: 'text-amber-800' },
  neutral: { box: 'border-slate-200 bg-white', title: 'text-slate-800', body: 'text-slate-600' },
} as const;

function Notice({
  tone,
  title,
  items,
}: {
  tone: keyof typeof NOTICE_TONES;
  title: string;
  items: string[];
}) {
  const c = NOTICE_TONES[tone];
  return (
    <div className={`rounded-xl border px-5 py-3.5 ${c.box}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${c.title}`}>{title}</div>
      <ul className={`mt-1.5 space-y-1 text-xs leading-relaxed ${c.body}`}>
        {items.map((m, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="select-none opacity-50">
              —
            </span>
            <span>{m}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Table({
  head,
  align,
  children,
}: {
  head: string[];
  align: ('left' | 'right')[];
  children: ReactNode;
}) {
  return (
    <div className="mt-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200">
            {head.map((h, i) => (
              <th
                key={h}
                className={`whitespace-nowrap pb-1.5 pr-4 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400 last:pr-0 ${
                  align[i] === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({
  children,
  align = 'left',
  mono,
  muted,
  strong,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap py-2 pr-4 tabular-nums last:pr-0 ${align === 'right' ? 'text-right' : 'text-left'} ${
        mono ? 'font-mono text-xs' : ''
      } ${strong ? 'font-semibold text-slate-900' : muted ? 'text-slate-500' : 'text-slate-800'}`}
    >
      {children}
    </td>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-slate-600 ring-1 ring-inset ring-slate-100">
      {children}
    </pre>
  );
}
