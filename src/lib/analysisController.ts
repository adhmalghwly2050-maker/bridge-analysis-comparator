/**
 * Analysis Engine Switching System
 * ─────────────────────────────────────────────────────────────────────────────
 * Architecture:  UI  →  Controller  →  Engine  →  Adapter  →  FrameResult[]  →  Renderer
 *
 * The canonical unified format is the existing FrameResult[] so that ALL
 * downstream rendering (AnalysisDiagramDialog, beam design, export) remains
 * completely unchanged.
 *
 * Five engines are supported:
 *   • legacy_2d    – 2D Matrix Stiffness (continuous beam, 2 DOF/node)
 *   • legacy_3d    – 3D Direct Stiffness (6 DOF/node, P-Delta)
 *   • global_frame – 3D + Beam Continuity Enforcement (useBeamContinuity = true)
 *   • unified_core – Full 8-stage pipeline (frames + shells), uses Global Frame path currently
 *   • fem_coupled  – Phase-8 Coupled Beam–Slab FEM (Mindlin-Reissner)
 *
 * Unit conventions:
 *   FEM end forces    →  N  and  N·mm  (internal)
 *   FEM element data  →  kN  and  kN·m  (already converted by the engine)
 *   FrameResult       →  kN  and  kN·m  (target canonical format)
 */

import type { Beam, Frame, FrameResult }    from '@/lib/structuralEngine';
import type { MergedResult }               from '@/slabFEMEngine/mergedDOFSystem';

// ─────────────────────────────────────────────────────────────────────────────
// Engine type identifier
// ─────────────────────────────────────────────────────────────────────────────

export type EngineType =
  | 'legacy_2d'
  | 'legacy_3d'
  | 'global_frame'
  | 'unified_core'
  | 'fem_coupled';

export const ENGINE_LABELS: Record<EngineType, string> = {
  legacy_2d:    '2D (Matrix Stiffness)',
  legacy_3d:    '3D Legacy',
  global_frame: 'Global Frame Solver',
  unified_core: 'Unified Core',
  fem_coupled:  'FEM (Coupled)',
};

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER: Legacy → Unified
// The legacy engine already returns FrameResult[], so this is a pass-through.
// ─────────────────────────────────────────────────────────────────────────────

export function adaptLegacyResults(legacyResults: FrameResult[]): FrameResult[] {
  return legacyResults;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER: FEM MergedResult[] (Phase 8) → FrameResult[]
//
// Uses Phase 8 (getMergedBeamSlabResults) — true DOF merging, no penalty.
// Beam-line slab DOFs are physically shared with beam DOFs, giving correct
// non-zero displacements and moments.
//
// Mapping table:
//   CoupledBeamResult field           → FrameResult beam field
//   ─────────────────────────────────────────────────────────
//   endForcesLocal.My1 (N·mm ÷ 1e6)  → Mleft  (kN·m, signed — from first element)
//   endForcesLocal.My2 (N·mm ÷ 1e6)  → Mright (kN·m, signed — from last element)
//   max positive central element moment → Mmid  (kN·m, positive = sagging)
//   maxShear_kN                        → Vu    (kN, absolute)
//   |endForcesLocal.Vz1| (N ÷ 1000)   → Rleft  (kN, positive)
//   |endForcesLocal.Vz2| (N ÷ 1000)   → Rright (kN, positive)
//
// Sign convention: hogging (supports) < 0, sagging (midspan) > 0.
// Diagram shows negative above the beam line, positive below.
//
// Internal beams shared across ≥2 slab solves have forces accumulated
// element-wise (summed). maxShear uses Math.max (envelope).
// ─────────────────────────────────────────────────────────────────────────────

interface BeamAccumulator {
  elementMoments: number[];  // kN·m, accumulated from all slab solves
  elementShears:  number[];  // kN,   accumulated from all slab solves
  maxMoment:  number;        // kN·m, envelope max across slab solves
  maxShear:   number;        // kN,   envelope max across slab solves
  My1_Nmm:    number;        // N·mm, accumulated end moment at start node
  My2_Nmm:    number;        // N·mm, accumulated end moment at end node
  Vz1_N:      number;        // N,    accumulated shear at start node
  Vz2_N:      number;        // N,    accumulated shear at end node
}

export function adaptFEMResults(
  coupledResults: MergedResult[],
  beams: Beam[],
  frames: Frame[],
  /** Optional: beam release lookup to enforce zero moments at released ends */
  beamReleaseLookup?: Map<string, { relI_mz: boolean; relJ_mz: boolean }>,
): FrameResult[] {

  // ── 1. Accumulate forces across all per-slab solves ──────────────────────
  const acc = new Map<string, BeamAccumulator>();

  for (const slabResult of coupledResults) {
    for (const br of slabResult.beamResults) {
      const existing = acc.get(br.beamId);
      if (!existing) {
        acc.set(br.beamId, {
          elementMoments: [...br.elementMoments_kNm],
          elementShears:  [...br.elementShears_kN],
          maxMoment: br.maxMoment_kNm,
          maxShear:  br.maxShear_kN,
          My1_Nmm:   br.endForcesLocal.My1,
          My2_Nmm:   br.endForcesLocal.My2,
          Vz1_N:     br.endForcesLocal.Vz1,
          Vz2_N:     br.endForcesLocal.Vz2,
        });
      } else {
        // Add element-wise spatial contributions from this slab
        const len = Math.min(existing.elementMoments.length, br.elementMoments_kNm.length);
        for (let i = 0; i < len; i++) {
          existing.elementMoments[i] += br.elementMoments_kNm[i];
          existing.elementShears[i]  += br.elementShears_kN[i];
        }
        // Envelope the scalar peaks
        existing.maxMoment = Math.max(existing.maxMoment, br.maxMoment_kNm);
        existing.maxShear  = Math.max(existing.maxShear,  br.maxShear_kN);
        // Accumulate support forces
        existing.My1_Nmm += br.endForcesLocal.My1;
        existing.My2_Nmm += br.endForcesLocal.My2;
        existing.Vz1_N   += br.endForcesLocal.Vz1;
        existing.Vz2_N   += br.endForcesLocal.Vz2;
      }
    }
  }

  // ── 2. Map frames → FrameResult[] ────────────────────────────────────────
  return frames.map(frame => ({
    frameId: frame.id,
    beams: frame.beamIds.map(beamId => {
      const beam = beams.find(b => b.id === beamId);
      const a    = acc.get(beamId);

      // Beam not in any FEM slab solve — return zeroed result
      if (!beam || !a) {
        return {
          beamId,
          span:   beam?.length ?? 0,
          Mleft:  0,
          Mmid:   0,
          Mright: 0,
          Vu:     0,
          Rleft:  0,
          Rright: 0,
        };
      }

      const n = a.elementMoments.length;

      // ── End moments (N·mm → kN·m, signed) ────────────────────────────────
      //
      // Sign convention clarification:
      //   In the Euler-Bernoulli element (McGuire, θy = −∂w/∂x):
      //     My1 > 0  at a fixed left support  → hogging in structural terms
      //     My2 < 0  at a fixed right support → hogging in structural terms
      //   So My1 and My2 carry OPPOSITE sign polarities for the same physical state.
      //
      //   Structural convention:  sagging > 0,  hogging < 0
      //     Mleft  = −My1  (negate to match structural sign)
      //     Mright =  My2  (already structural sign-correct)
      let Mleft  = -a.My1_Nmm / 1e6;   // negate My1 → structural left-end moment
      let Mright =  a.My2_Nmm / 1e6;   // My2 is direct structural right-end moment

      // ── Enforce zero moments at released ends ──────────────────────────
      const rel = beamReleaseLookup?.get(beamId);
      if (rel) {
        if (rel.relI_mz) Mleft  = 0;
        if (rel.relJ_mz) Mright = 0;
      }

      // ── Midspan moment: maximum value in central 50% of elements ──────────
      // elementMoments stores My2 per element (one value each), so n equals
      // the number of sub-elements.  The central 50% covers approximately the
      // mid-span region where positive (sagging) moments peak.
      // If no positive moment exists (fully hogging beam), fall back to
      // the absolute peak from the envelope (always positive by design).
      let Mmid = 0;
      if (n > 0) {
        const lo = Math.floor(n * 0.25);
        const hi = Math.ceil(n * 0.75);
        const central = a.elementMoments.slice(lo, hi);
        const maxCentral = central.length > 0 ? Math.max(...central) : -Infinity;
        // Use the maximum positive midspan moment; if all central elements are
        // hogging, fall back to the unsigned peak (for design envelope purposes).
        Mmid = maxCentral > 0 ? maxCentral : Math.max(a.maxMoment, 0);
      } else {
        Mmid = Math.max(a.maxMoment, 0);
      }

      // ── Shear and reactions ───────────────────────────────────────────────
      const Vu     = a.maxShear;
      const Rleft  = Math.abs(a.Vz1_N) / 1000;   // N → kN
      const Rright = Math.abs(a.Vz2_N) / 1000;   // N → kN

      return { beamId, span: beam.length, Mleft, Mmid, Mright, Vu, Rleft, Rright };
    }),
  }));
}
