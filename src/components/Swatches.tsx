import type { ProductColor } from '../lib/products';

/** Overlapping color dots for a variant's colors; hover for the names. */
export default function Swatches({ colors, size = 12, max = 5 }: { colors: ProductColor[]; size?: number; max?: number }) {
  const shown = colors.slice(0, max);
  return (
    <span className="inline-flex shrink-0 items-center" title={colors.map((c) => c.name).join(', ')}>
      {shown.map((c, i) => (
        <span
          key={c.id}
          className="rounded-full ring-1 ring-black/15"
          style={{ width: size, height: size, background: c.swatch, marginLeft: i === 0 ? 0 : -size / 3 }}
        />
      ))}
      {colors.length > max && <span className="ml-1 text-[10px] font-medium opacity-70">+{colors.length - max}</span>}
    </span>
  );
}
