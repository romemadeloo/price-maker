import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon, ExpandIcon } from '../components/icons';

/**
 * Open a table in a modal over the page, sized as a share of the window —
 * 100% fills it edge to edge, smaller sizes float centred over a dimmed page.
 *
 * The panel element itself is lifted (fixed) rather than copied into a
 * dialog, so the table keeps its state: selection, scroll, an edit in
 * progress. Esc, a click on the backdrop or ✕ closes it. The chosen size is
 * remembered in this browser.
 */

export const MODAL_SIZES = [100, 90, 80, 70, 60, 50] as const;
export type ModalSize = (typeof MODAL_SIZES)[number];

const SIZE_KEY = 'pricer-maker:modal-size';
const DEFAULT_SIZE: ModalSize = 90;

function loadSize(): ModalSize {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return (MODAL_SIZES as readonly number[]).includes(n) ? (n as ModalSize) : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}

export function useFullscreen<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [isFull, setIsFull] = useState(false);
  const [size, setSizeState] = useState<ModalSize>(loadSize);

  const setSize = useCallback((next: ModalSize) => {
    setSizeState(next);
    try {
      localStorage.setItem(SIZE_KEY, String(next));
    } catch {
      // Not remembered; the default comes back next time.
    }
  }, []);

  const close = useCallback(() => setIsFull(false), []);
  const toggle = useCallback(() => setIsFull((open) => !open), []);

  useEffect(() => {
    if (!isFull) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc inside a cell editor cancels the edit, not the modal.
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFull, close]);

  /** Classes for the panel while open: lifted over the page, a card unless it fills the window. */
  const panelClass = isFull
    ? `fixed z-[60] !m-0 !max-h-none bg-white ${
        size === 100 ? '!rounded-none !border-0 !shadow-none' : '!rounded-2xl shadow-[0_24px_64px_rgba(15,23,42,0.35)]'
      }`
    : '';

  /** Position and size for the panel while open. */
  const panelStyle: CSSProperties | undefined = isFull
    ? size === 100
      ? { top: 0, left: 0, width: '100vw', height: '100vh' }
      : { top: `${(100 - size) / 2}vh`, left: `${(100 - size) / 2}vw`, width: `${size}vw`, height: `${size}vh` }
    : undefined;

  return { ref, isFull, size, setSize, toggle, close, panelClass, panelStyle };
}

/**
 * The expand button in each table's toolbar. While open it becomes the
 * modal's controls — the size picker and ✕ — and draws the backdrop.
 */
export function FullscreenButton({
  modal,
  className = '',
}: {
  modal: Pick<ReturnType<typeof useFullscreen>, 'isFull' | 'size' | 'setSize' | 'toggle' | 'close'>;
  className?: string;
}) {
  if (!modal.isFull) {
    return (
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={modal.toggle}
        title="Open larger"
        aria-label="Open larger"
        className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 ${className}`}
      >
        <ExpandIcon width={15} height={15} />
        <span className="hidden sm:inline">Expand</span>
      </button>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {/* The dimmed page behind the modal; a click on it closes. */}
      {modal.size < 100 &&
        createPortal(
          <div className="fixed inset-0 z-[59] bg-slate-900/45 backdrop-blur-[2px]" onMouseDown={modal.close} aria-hidden="true" />,
          document.body,
        )}
      <span className="text-[11px] font-medium text-slate-500">Size</span>
      <span className="inline-flex overflow-hidden rounded-lg border border-brand-500" role="group" aria-label="Modal size">
        {MODAL_SIZES.map((s) => (
          <button
            key={s}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => modal.setSize(s)}
            aria-pressed={modal.size === s}
            className={`border-l border-brand-500 px-2 py-0.5 text-[11px] font-medium tabular-nums first:border-l-0 ${
              modal.size === s ? 'bg-brand-600 text-white' : 'text-brand-600 hover:bg-brand-50'
            }`}
          >
            {s}%
          </button>
        ))}
      </span>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={modal.close}
        title="Close (Esc)"
        aria-label="Close"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        <CloseIcon width={15} height={15} />
      </button>
    </span>
  );
}
