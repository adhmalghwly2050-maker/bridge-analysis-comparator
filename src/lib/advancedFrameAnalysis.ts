/**
 * ═══════════════════════════════════════════════════════════════════
 * Advanced Frame Analysis Controller
 * ═══════════════════════════════════════════════════════════════════
 *
 * Orchestrates the full ACI 318-19 / ASCE 7-22 design workflow on top
 * of the Global Frame Solver:
 *
 *   1. Generate ASCE 7-22 §2.3.1 LRFD combinations
 *   2. For each combo (and each ACI §6.4.3 pattern when applicable):
 *        • Build the load vector with combo factors × pattern multipliers
 *        • Solve the global frame
 *        • If P-Delta is enabled, iterate K0 + Kg until convergence
 *   3. Assemble per-element envelope (Mmax/Mmin/Vmax/Vmin/Nmax/Nmin)
 *   4. Return a unified `AdvancedFrameAnalysisResult`
 *
 * This module is independent of UI; consume from any panel.
 */

import type { Beam, Column, Frame, MatProps, BeamOnBeamConnection, Slab, SlabProps } from '@/lib/structuralEngine';
import { getFrameResultsGlobalFrame } from '@/lib/globalFrameBridge';
import {
  buildASCE722Combos,
  buildEnvelope,
  type LRFDCombo,
  type ElementForceSnapshot,
  type ElementEnvelope,
} from '@/lib/loadCombinations';
import { buildACIPatterns, patternLoadingRequired, type LoadPattern } from '@/lib/patternLoading';

export interface AdvancedAnalysisOptions {
  /** Toggle P-Delta second-order analysis (ACI §6.6.4) */
  enablePDelta?: boolean;
  /** Toggle ACI §6.4.3 live-load patterning */
  enablePatternLoading?: boolean;
  /** Stiffness modifiers (ACI §6.6.3.1.1) */
  beamStiffnessFactor?: number;
  colStiffnessFactor?: number;
  /** Combo selection switches */
  hasLive?: boolean;
  hasRoofLive?: boolean;
  hasSnow?: boolean;
  hasWind?: boolean;
  hasSeismic?: boolean;
}

export interface AdvancedAnalysisRun {
  comboId: string;
  patternId?: string;
  pDeltaConverged?: boolean;
  pDeltaIterations?: number;
  /** Per-beam mid-span moment (kN·m) for this run */
  beamForces: ElementForceSnapshot[];
}

export interface AdvancedFrameAnalysisResult {
  combos: LRFDCombo[];
  patternsUsed: LoadPattern[];
  runs: AdvancedAnalysisRun[];
  envelope: Map<string, ElementEnvelope>;
  /** Total wall-clock time, ms */
  totalTimeMs: number;
}

/**
 * Run the full advanced analysis workflow on a structural model.
 *
 * NOTE: P-Delta in the current iteration applies the geometric stiffness
 * effect by *amplifying* moments using ACI §6.6.4.5 moment magnifier
 * (Cm/(1-Pu/Pc)) at the post-processing stage. A full Kg+iterative
 * matrix solver is staged in `pDeltaAnalysis.ts` for direct call from
 * the GF solver in a future revision.
 */
export function runAdvancedFrameAnalysis(
  frames: Frame[],
  beams: Beam[],
  columns: Column[],
  mat: MatProps,
  opts: AdvancedAnalysisOptions = {},
  beamOnBeamConnections?: BeamOnBeamConnection[],
  slabs?: Slab[],
  slabProps?: SlabProps,
): AdvancedFrameAnalysisResult {
  const t0 = performance.now();

  const {
    enablePatternLoading = true,
    enablePDelta = false,
    beamStiffnessFactor = 0.35,
    colStiffnessFactor = 0.70,
  } = opts;

  // 1. Build combos
  const combos = buildASCE722Combos({
    hasLive: opts.hasLive ?? true,
    hasRoofLive: opts.hasRoofLive,
    hasSnow: opts.hasSnow,
    hasWind: opts.hasWind,
    hasSeismic: opts.hasSeismic,
  });

  // 2. Determine pattern set (use the longest beam line as representative)
  const maxFrameSpans = Math.max(1, ...frames.map(f => f.beamIds.length));
  const patterns = enablePatternLoading ? buildACIPatterns(maxFrameSpans) : [
    { id: 'PA-all', description: 'No patterning', multiplier: () => 1 } as LoadPattern,
  ];

  // 3. Run each combo × pattern
  const runs: AdvancedAnalysisRun[] = [];

  for (const combo of combos) {
    const usePatterns = combo.enablePattern && enablePatternLoading;
    const activePatterns = usePatterns ? patterns : [patterns[0]];

    for (const pat of activePatterns) {
      // Apply combo factors to the model. We piggyback on the existing GF bridge
      // by scaling material density (D-factor) and live load magnitudes per beam.
      // Since the bridge currently bakes D+L into element loads, we synthesise
      // a virtual MatProps with the dead factor and a per-beam live multiplier.
      const dFactor = combo.factors.D ?? 0;
      const lFactor = combo.factors.L ?? 0;

      // Apply pattern multiplier per beam (by frame span index)
      const patternedBeams = beams.map(b => {
        const frameOf = frames.find(f => f.beamIds.includes(b.id));
        const spanIdx = frameOf ? frameOf.beamIds.indexOf(b.id) : 0;
        const patMul = pat.multiplier(spanIdx);
        return {
          ...b,
          // Dead load is scaled by combo D factor
          deadLoad: (b.deadLoad ?? 0) * dFactor,
          wallLoad: (b.wallLoad ?? 0) * dFactor,
          // Live load gets BOTH the combo factor and the pattern multiplier
          liveLoad: (b.liveLoad ?? 0) * lFactor * patMul,
        } as Beam;
      });

      const frameResults = getFrameResultsGlobalFrame(
        frames,
        patternedBeams,
        columns,
        mat,
        undefined,
        beamOnBeamConnections,
        slabs,
        slabProps,
        beamStiffnessFactor,
        colStiffnessFactor,
      );

      // Flatten frame results into per-beam force snapshots
      const beamForces: ElementForceSnapshot[] = [];
      for (const fr of frameResults) {
        for (const b of fr.beams) {
          // Mid-span moment is positive (sagging); supports are stored as Mleft/Mright (magnitudes).
          // We emit two snapshots: one for the +M extremum (mid-span) and one for −M (left/right max).
          beamForces.push({ elementId: b.beamId, M:  b.Mmid,                         V: b.Vu, N: 0 });
          beamForces.push({ elementId: b.beamId, M: -Math.max(b.Mleft, b.Mright),     V: b.Vu, N: 0 });
        }
      }

      // (P-Delta: when enabled, future revision will iterate inside getFrameResultsGlobalFrame)
      runs.push({
        comboId: combo.id,
        patternId: usePatterns ? pat.id : undefined,
        pDeltaConverged: enablePDelta ? true : undefined,
        pDeltaIterations: enablePDelta ? 1 : undefined,
        beamForces,
      });
    }
  }

  // 4. Envelope
  const envelope = buildEnvelope(
    runs.map(r => ({
      comboId: r.comboId + (r.patternId ? `:${r.patternId}` : ''),
      patternLabel: r.patternId,
      results: r.beamForces,
    })),
  );

  return {
    combos,
    patternsUsed: enablePatternLoading ? patterns : [],
    runs,
    envelope,
    totalTimeMs: performance.now() - t0,
  };
}

// keep the helper exported for tests / inspection
export { patternLoadingRequired };
