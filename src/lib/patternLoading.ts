/**
 * ═══════════════════════════════════════════════════════════════════
 * Pattern Loading for Live Loads — ACI 318-19 §6.4.3
 * ═══════════════════════════════════════════════════════════════════
 *
 * ACI 318-19 §6.4.3 requires considering the following live-load
 * arrangements when L > 0.75·D (or always for continuous beams when
 * the engineer wants the worst envelope):
 *
 *   Pattern A — All spans loaded with full L  (max +M at all midspans)
 *   Pattern B — Alternate spans loaded        (max +M at loaded mids,
 *                                              max −M at adjacent supports)
 *   Pattern C — Two adjacent spans loaded     (max −M at the support
 *                                              between them)
 *
 * This module produces a list of "pattern masks": for each pattern,
 * an array of spanIndex → loadFactor (1 or 0). The caller multiplies
 * these by the live-load magnitude per beam element when assembling
 * the load vector for one solve.
 */

export interface LoadPattern {
  /** Short label, e.g. "PA-all", "PB-odd", "PC-supp-2" */
  id: string;
  description: string;
  /** spanIndex → multiplier (0 = unloaded, 1 = fully loaded) */
  multiplier: (spanIndex: number) => number;
}

/**
 * Build the canonical ACI 318-19 §6.4.3 patterns for an N-span continuous beam.
 *
 * @param nSpans number of continuous spans in the frame line
 * @returns ordered list of patterns to run as separate analyses
 */
export function buildACIPatterns(nSpans: number): LoadPattern[] {
  const patterns: LoadPattern[] = [];

  // Pattern A — all spans loaded
  patterns.push({
    id: 'PA-all',
    description: 'All spans loaded — max midspan moments',
    multiplier: () => 1,
  });

  if (nSpans < 2) return patterns;

  // Pattern B — alternating spans (two variants: odd-loaded and even-loaded)
  patterns.push({
    id: 'PB-odd',
    description: 'Odd spans loaded — max +M at odd mids, max −M at adjacent supports',
    multiplier: (i) => (i % 2 === 0 ? 1 : 0),
  });
  patterns.push({
    id: 'PB-even',
    description: 'Even spans loaded — max +M at even mids',
    multiplier: (i) => (i % 2 === 1 ? 1 : 0),
  });

  // Pattern C — two adjacent spans loaded at each interior support
  for (let s = 0; s < nSpans - 1; s++) {
    patterns.push({
      id: `PC-supp-${s + 1}`,
      description: `Spans ${s + 1} and ${s + 2} loaded — max −M at support ${s + 1}`,
      multiplier: (i) => (i === s || i === s + 1 ? 1 : 0),
    });
  }

  return patterns;
}

/**
 * Decide whether ACI §6.4.3 pattern loading is required for a given
 * beam. ACI allows skipping pattern analysis when L_unfactored ≤ 0.75 D.
 *
 *   "It shall be permitted to assume the following arrangements …"
 *   ACI 318-19 §6.4.3.2 (effectively a permission, not a mandate).
 *
 * Most U.S. design offices apply patterns whenever L is non-trivial, so
 * the default in this codebase is `alwaysApply = true`.
 */
export function patternLoadingRequired(
  unfactoredDead: number,
  unfactoredLive: number,
  alwaysApply = true,
): boolean {
  if (alwaysApply) return unfactoredLive > 0;
  return unfactoredLive > 0.75 * unfactoredDead;
}
