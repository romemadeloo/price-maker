/**
 * Colors for draft-vs-production, shared by every chart, badge and heatmap.
 *
 * The data is diverging: a draft is below production, equal to it, or above
 * it. So it gets a diverging pair — blue (lower) and red (higher), validated
 * for color-vision deficiency — around a neutral gray midpoint for an exact
 * match. Match is never green: green beside red fails deuteranopia. A match is
 * also marked with a ✓, so state is never carried by color alone.
 */

export const DIFF = {
  lower: '#2a78d6',
  higher: '#e34948',
  match: '#b4b2ab',
} as const;

/** Heatmap fills, light to strong by size of the gap. Dark text stays readable on all of them. */
export const HEAT = {
  match: '#f0efec',
  lower: ['#e6effc', '#cde2fb', '#9ec5f4', '#6da7ec'],
  higher: ['#fdeceb', '#fbd2d1', '#f6aeac', '#ee8988'],
} as const;

/** Bucket a percentage gap: < 0.5%, < 2%, < 5%, ≥ 5%. */
export function heatStep(pct: number | null): 0 | 1 | 2 | 3 {
  const m = Math.abs(pct ?? 0);
  return m < 0.5 ? 0 : m < 2 ? 1 : m < 5 ? 2 : 3;
}

export const HEAT_LEGEND = ['< 0.5%', '< 2%', '< 5%', '≥ 5%'] as const;
