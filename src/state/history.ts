import type { SheetState } from '../types';
import { sheetReducer, type SheetAction } from './sheetReducer';

/**
 * Undo / redo for the price table.
 *
 * Every sheet action that changes the table pushes the previous state onto
 * `past`. States share every row they did not touch, so a long history costs
 * little. Typing into a quantity header is one entry per header, not one per
 * keystroke.
 */

export interface SheetHistory {
  past: SheetState[];
  present: SheetState;
  future: SheetState[];
  /** Consecutive actions with the same key collapse into one undo step. */
  lastKey: string | null;
}

export type HistoryAction = SheetAction | { type: 'undo' } | { type: 'redo' };

/** How many steps back Ctrl+Z can go. */
export const HISTORY_LIMIT = 200;

export function initHistory(present: SheetState): SheetHistory {
  return { past: [], present, future: [], lastKey: null };
}

function coalesceKey(action: SheetAction): string | null {
  return action.type === 'setQuantityHeader' ? `header:${action.colIndex}` : null;
}

export function historyReducer(history: SheetHistory, action: HistoryAction): SheetHistory {
  if (action.type === 'undo') {
    const previous = history.past[history.past.length - 1];
    if (!previous) return history;
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
      lastKey: null,
    };
  }

  if (action.type === 'redo') {
    const [next, ...rest] = history.future;
    if (!next) return history;
    return { past: [...history.past, history.present], present: next, future: rest, lastKey: null };
  }

  const present = sheetReducer(history.present, action);
  if (present === history.present) return history;

  const key = coalesceKey(action);
  if (key != null && key === history.lastKey) return { ...history, present, future: [] };

  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
    lastKey: key,
  };
}
