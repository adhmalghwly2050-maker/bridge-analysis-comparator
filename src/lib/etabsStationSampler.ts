/**
 * Station Sampler
 * ─────────────────────────────────────────────────────────────────
 * Given a beam result from any analysis engine, evaluates the
 * bending moment M(x) at an arbitrary station x ∈ [0, L].
 *
 * Strategy (in order of preference):
 *   1. If the engine produced `momentStations` (a dense evenly-spaced
 *      array along the beam, typically 21 points), interpolate
 *      linearly on that grid.
 *   2. Otherwise reconstruct from raw equilibrium:
 *          M(x) = Mleft + Rleft·x − wu·x²/2
 *      using the same formula as `rawMomentStationsExporter`.
 *   3. As a last resort, use Lagrange quadratic through (0, L/2, L).
 *
 * The station x is clamped to [0, L] to avoid extrapolation when ETABS
 * reports a station slightly outside the engine's span (e.g. due to
 * rigid-end offsets).
 *
 * THIS HELPER IS USED BY THE ETABS COMPARISON PANEL TO MAKE SURE THAT
 * BOTH SIDES (ETABS AND ENGINE) ARE EVALUATED AT THE EXACT SAME
 * STATIONS — i.e. the canonical station grid is the one that ETABS
 * reports for each beam.
 */

export interface SampleableBeam {
  Mleft: number;
  Mmid: number;
  Mright: number;
  Rleft?: number;
  wu?: number;
  span?: number;
  momentStations?: number[];
}

/** Lagrange quadratic through (0, Mleft), (L/2, Mmid), (L, Mright). */
function lagrangeQuad(x: number, L: number, Ml: number, Mm: number, Mr: number): number {
  if (L < 1e-9) return 0;
  const x0 = 0, x1 = L / 2, x2 = L;
  const L0 = ((x - x1) * (x - x2)) / ((x0 - x1) * (x0 - x2));
  const L1 = ((x - x0) * (x - x2)) / ((x1 - x0) * (x1 - x2));
  const L2 = ((x - x0) * (x - x1)) / ((x2 - x0) * (x2 - x1));
  return Ml * L0 + Mm * L1 + Mr * L2;
}

/** Evaluate moment at station x (m) for a beam result. Returns null on bad input. */
export function sampleMomentAt(
  br: SampleableBeam | undefined | null,
  x: number,
  L: number,
  fallbackWu?: number,
): number | null {
  if (!br || L <= 1e-9) return null;
  // Clamp station to physical span
  const xc = Math.max(0, Math.min(L, x));

  // 1) Dense engine grid (preferred — most accurate)
  if (br.momentStations && br.momentStations.length >= 2) {
    const stations = br.momentStations;
    const nSeg = stations.length - 1;
    const t = (xc / L) * nSeg;
    const i0 = Math.max(0, Math.min(nSeg - 1, Math.floor(t)));
    const i1 = i0 + 1;
    const frac = t - i0;
    return stations[i0] * (1 - frac) + stations[i1] * frac;
  }

  // 2) Reconstruct from equilibrium if we have raw quantities
  const wu = br.wu ?? fallbackWu;
  if (br.Rleft !== undefined && wu !== undefined) {
    return br.Mleft + br.Rleft * xc - 0.5 * wu * xc * xc;
  }

  // 3) Fallback — quadratic through 3 known values
  return lagrangeQuad(xc, L, br.Mleft, br.Mmid, br.Mright);
}

/**
 * Build a canonical station list for a single beam from the ETABS rows
 * supplied for that beam. Stations are sorted ascending and de-duplicated.
 */
export function canonicalStations(rows: { station: number }[]): number[] {
  const set = new Set<number>();
  for (const r of rows) {
    if (Number.isFinite(r.station)) set.add(+r.station.toFixed(4));
  }
  return Array.from(set).sort((a, b) => a - b);
}
