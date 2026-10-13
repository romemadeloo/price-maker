import { useRef, useState, type ReactNode } from 'react';
import { CompareIcon, GridIcon, SparkIcon, TableIcon } from './icons';

export type RailTarget = 'overview' | 'table' | 'compare' | 'studio';

const ITEMS: { target: RailTarget; label: string; icon: ReactNode }[] = [
  { target: 'overview', label: 'Overview', icon: <GridIcon width={22} height={22} /> },
  { target: 'table', label: 'Price table', icon: <TableIcon width={22} height={22} /> },
  { target: 'compare', label: 'Compare to production', icon: <CompareIcon width={22} height={22} /> },
  { target: 'studio', label: 'Compare to Studio Editor', icon: <SparkIcon width={22} height={22} /> },
];

/** Resting icon size, how much the one under the pointer grows, and how far the swell reaches. */
const BASE = 44;
const GROW = 0.5;
const REACH = 90;

/**
 * A macOS-style dock, floating at the bottom centre of the window: plain icons
 * that swell upward as the pointer passes (neighbours a little), a label above
 * the hovered one, and a dot under wherever you are.
 */
export default function NavRail({
  active,
  onNavigate,
}: {
  active: RailTarget | null;
  onNavigate: (target: RailTarget) => void;
}) {
  const [pointerX, setPointerX] = useState<number | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Size of item i given the pointer: full swell under it, fading out over REACH px. */
  const sizeOf = (i: number) => {
    const el = itemRefs.current[i];
    if (pointerX == null || !el) return BASE;
    const rect = el.getBoundingClientRect();
    const distance = Math.abs(pointerX - (rect.left + rect.width / 2));
    return BASE * (1 + GROW * Math.max(0, 1 - distance / REACH));
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center">
      <nav
        onMouseMove={(e) => setPointerX(e.clientX)}
        onMouseLeave={() => setPointerX(null)}
        className="pointer-events-auto flex items-end gap-2 rounded-[22px] bg-white/70 px-2.5 pb-2 pt-2 shadow-[0_10px_30px_rgba(15,23,42,0.16)] ring-1 ring-black/5 backdrop-blur-xl"
        aria-label="Sections"
      >
        {ITEMS.map((item, i) => {
          const size = sizeOf(i);
          return (
            <button
              key={item.target}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              onClick={() => onNavigate(item.target)}
              aria-label={item.label}
              aria-current={active === item.target ? 'page' : undefined}
              className="group relative flex items-center justify-center transition-[width,height] duration-150 ease-out"
              style={{ width: size, height: size }}
            >
              <span
                style={{ transform: `scale(${size / BASE})` }}
                className={`transition-[transform,color] duration-150 ${
                  active === item.target ? 'text-brand-600' : 'text-slate-500 group-hover:text-slate-800'
                }`}
              >
                {item.icon}
              </span>

              {/* "Running" dot, like the dock's indicator. */}
              {active === item.target && (
                <span className="absolute -bottom-[7px] left-1/2 h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-slate-700" />
              )}

              {/* Label above the hovered tile. */}
              <span className="pointer-events-none absolute bottom-full z-50 mb-2.5 whitespace-nowrap rounded-md bg-slate-900/85 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg backdrop-blur transition-opacity group-hover:opacity-100">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
