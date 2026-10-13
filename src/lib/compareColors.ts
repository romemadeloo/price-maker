/**
 * Colors for draft-vs-production, shared by every chart, badge and heatmap.
 *
 * A draft price is below production (blue), equal to it (green), or above it
 * (red). Green beside red is the classic color-blind trap, so this red is a
 * deep one: the set was run through the dataviz palette validator and clears
 * every check, including deuteranopia (ΔE 8.1, target ≥ 8). Each state also
 * carries an icon — ↓ ✓ ↑ — so meaning never rests on color alone.
 */

export const DIFF = {
  lower: '#2a78d6',
  match: '#22a447',
  higher: '#c62828',
} as const;

/** Heatmap fills, light to strong by size of the gap. Dark text stays readable on all of them. */
export const HEAT = {
  match: '#e3f4e7',
  lower: ['#e6effc', '#cde2fb', '#9ec5f4', '#6da7ec'],
  higher: ['#fbe9e9', '#f6cfcf', '#eda9a9', '#e07f7f'],
} as const;

/** Bucket a percentage gap: < 0.5%, < 2%, < 5%, ≥ 5%. */
export function heatStep(pct: number | null): 0 | 1 | 2 | 3 {
  const m = Math.abs(pct ?? 0);
  return m < 0.5 ? 0 : m < 2 ? 1 : m < 5 ? 2 : 3;
}

export const HEAT_LEGEND = ['< 0.5%', '< 2%', '< 5%', '≥ 5%'] as const;
