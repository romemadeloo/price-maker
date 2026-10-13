import { groupDigits } from './decimal';

/** Display helpers for the comparison views. Integer won only. */

export function won(value: number): string {
  return `${value < 0 ? '−' : ''}₩${groupDigits(Math.abs(value))}`;
}

export function signedWon(value: number): string {
  if (value === 0) return '₩0';
  return `${value > 0 ? '+' : '−'}₩${groupDigits(Math.abs(value))}`;
}

export function signedPct(value: number | null, digits = 1): string {
  if (value == null) return '—';
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return value === 0 ? '0%' : `${value > 0 ? '+' : '−'}<0.${'0'.repeat(digits - 1)}1%`;
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(digits)}%`;
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(then).toLocaleDateString();
}
