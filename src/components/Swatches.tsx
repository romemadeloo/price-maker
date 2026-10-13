import type { ProductOption } from '../lib/products';

/** Overlapping dots for a variant's colors or material; hover for the names. */
export default function Swatches({
  options,
  size = 12,
  max = 5,
}: {
  options: ProductOption[];
  size?: number;
  max?: number;
}) {
  const shown = options.slice(0, max);
  return (
    <span className="inline-flex shrink-0 items-center" title={options.map((c) => c.name).join(', ')}>
      {shown.map((c, i) => (
        <span
          key={c.id}
          className="rounded-full ring-1 ring-black/15"
          style={{ width: size, height: size, background: c.swatch, marginLeft: i === 0 ? 0 : -size / 3 }}
        />
      ))}
      {options.length > max && <span className="ml-1 text-[10px] font-medium opacity-70">+{options.length - max}</span>}
    </span>
  );
}
