/**
 * ═══════════════════════════════════════════════════════════════════
 * LRFD Load Combinations — ASCE 7-22 §2.3.1
 * ═══════════════════════════════════════════════════════════════════
 *
 * Generates the seven primary strength-design (LRFD) load combinations
 * and provides an envelope post-processor that returns the worst force
 * per element across all active combinations.
 *
 * Reference: ASCE/SEI 7-22 §2.3.1 "Basic Combinations"
 *
 *   1.   1.4 D
 *   2.   1.2 D + 1.6 L + 0.5 (Lr or S or R)
 *   3.   1.2 D + 1.6 (Lr or S or R) + (L or 0.5 W)
 *   4.   1.2 D + 1.0 W + L + 0.5 (Lr or S or R)
 *   5.   1.2 D + 1.0 E + L + 0.2 S
 *   6.   0.9 D + 1.0 W
 *   7.   0.9 D + 1.0 E
 *
 * Notation used throughout:
 *   D  = Dead       Lr = Roof live    W = Wind
 *   L  = Live       S  = Snow         E = Seismic
 */

export type LoadCase = 'D' | 'L' | 'Lr' | 'S' | 'W' | 'E';

export interface LRFDCombo {
  /** Short name for tables / UI */
  id: string;
  /** Human description */
  description: string;
  /** Factor for each load case (missing = 0) */
  factors: Partial<Record<LoadCase, number>>;
  /**
   * If true, this combination is a "pattern combo" and should be expanded
   * by the pattern-loading module (ACI 318-19 §6.4.3).
   */
  enablePattern?: boolean;
}

/**
 * Build the standard ASCE 7-22 LRFD strength combinations.
 * Combos referencing absent cases (e.g. seismic if not provided) are
 * filtered out by the caller.
 */
export function buildASCE722Combos(opts: {
  hasLive?: boolean;
  hasRoofLive?: boolean;
  hasSnow?: boolean;
  hasWind?: boolean;
  hasSeismic?: boolean;
} = {}): LRFDCombo[] {
  const { hasLive = true, hasRoofLive = false, hasSnow = false, hasWind = false, hasSeismic = false } = opts;

  const combos: LRFDCombo[] = [
    { id: '1.4D',                    description: '1.4 D',                              factors: { D: 1.4 } },
    { id: '1.2D+1.6L',               description: '1.2 D + 1.6 L',                       factors: { D: 1.2, L: 1.6 }, enablePattern: true },
  ];

  if (hasRoofLive || hasSnow) {
    const rs: LoadCase = hasSnow ? 'S' : 'Lr';
    combos.push({ id: `1.2D+1.6L+0.5${rs}`, description: `1.2 D + 1.6 L + 0.5 ${rs}`,    factors: { D: 1.2, L: 1.6, [rs]: 0.5 } });
    combos.push({ id: `1.2D+1.6${rs}+L`,    description: `1.2 D + 1.6 ${rs} + 1.0 L`,    factors: { D: 1.2, [rs]: 1.6, L: 1.0 } });
  }

  if (hasWind) {
    combos.push({ id: '1.2D+1.0W+L',      description: '1.2 D + 1.0 W + 1.0 L',         factors: { D: 1.2, W: 1.0, L: 1.0 } });
    combos.push({ id: '0.9D+1.0W',        description: '0.9 D + 1.0 W',                 factors: { D: 0.9, W: 1.0 } });
  }

  if (hasSeismic) {
    combos.push({ id: '1.2D+1.0E+L',      description: '1.2 D + 1.0 E + 1.0 L',         factors: { D: 1.2, E: 1.0, L: 1.0 } });
    combos.push({ id: '0.9D+1.0E',        description: '0.9 D + 1.0 E',                 factors: { D: 0.9, E: 1.0 } });
  }

  if (!hasLive) {
    // Drop pure-live combos
    return combos.filter(c => !(c.factors.L && !c.factors.D));
  }

  return combos;
}

// ─────────────────────────────────────────────────────────────────
// ENVELOPE
// ─────────────────────────────────────────────────────────────────

export interface ElementForcePoint {
  /** Combo id that produced this extremum */
  comboId: string;
  /** Pattern label if applicable */
  patternLabel?: string;
  value: number;
}

export interface ElementEnvelope {
  elementId: string;
  /** Maximum (signed positive) values */
  Mmax: ElementForcePoint;
  /** Minimum (most negative) values */
  Mmin: ElementForcePoint;
  Vmax: ElementForcePoint;
  Vmin: ElementForcePoint;
  Nmax: ElementForcePoint;   // axial (tension +)
  Nmin: ElementForcePoint;   // axial (compression -)
}

export interface ElementForceSnapshot {
  elementId: string;
  /** Mid-span (or extremum) bending moment, kN·m. Signed. */
  M: number;
  /** Maximum shear magnitude, kN. */
  V: number;
  /** Axial force, kN (tension +). */
  N: number;
}

/**
 * Combine per-combo element results into a single envelope per element.
 * Each `runs` entry is one combo's full set of element results.
 */
export function buildEnvelope(
  runs: { comboId: string; patternLabel?: string; results: ElementForceSnapshot[] }[],
): Map<string, ElementEnvelope> {
  const env = new Map<string, ElementEnvelope>();

  const init = (id: string): ElementEnvelope => ({
    elementId: id,
    Mmax: { comboId: '', value: -Infinity },
    Mmin: { comboId: '', value:  Infinity },
    Vmax: { comboId: '', value: -Infinity },
    Vmin: { comboId: '', value:  Infinity },
    Nmax: { comboId: '', value: -Infinity },
    Nmin: { comboId: '', value:  Infinity },
  });

  for (const run of runs) {
    for (const r of run.results) {
      const e = env.get(r.elementId) ?? init(r.elementId);
      const tag = (v: number) => ({ comboId: run.comboId, patternLabel: run.patternLabel, value: v });
      if (r.M > e.Mmax.value) e.Mmax = tag(r.M);
      if (r.M < e.Mmin.value) e.Mmin = tag(r.M);
      if (r.V > e.Vmax.value) e.Vmax = tag(r.V);
      if (r.V < e.Vmin.value) e.Vmin = tag(r.V);
      if (r.N > e.Nmax.value) e.Nmax = tag(r.N);
      if (r.N < e.Nmin.value) e.Nmin = tag(r.N);
      env.set(r.elementId, e);
    }
  }

  return env;
}
