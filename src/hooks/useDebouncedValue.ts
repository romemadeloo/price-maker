import { useEffect, useRef, useState } from 'react';

/**
 * Hold a value steady for `delay` ms of quiet.
 *
 * The engine runs off this rather than off live sheet state, so typing into a
 * large table does not trigger a full recalculation per keystroke (spec §20).
 * The first value passes through immediately so initial render is not delayed.
 */
export function useDebouncedValue<T>(value: T, delay: number): [T, boolean] {
  const [debounced, setDebounced] = useState(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return [debounced, debounced !== value];
}
