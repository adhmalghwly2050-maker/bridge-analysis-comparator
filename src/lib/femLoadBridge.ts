/**
 * FEM Load Bridge
 * ===============
 * Converts FEM engine's BeamLoadResult[] (Phase 3 output) into the
 * ElemSlabProfile format consumed by the 3D frame analysis engine.
 *
 * This bridges the two engines so the 3D solver can use stiffness-based
 * slab load distribution (like ETABS with zero slab stiffness) instead
 * of the simplified yield-line / tributary width method.
 *
 * Slab stiffness is ignored: beams carry ALL slab loads.
 */

import type { Beam, Slab, SlabProps, MatProps } from '@/lib/structuralEngine';
import type { FEMInputModel, BeamLoadResult } from '@/slabFEMEngine/types';
import { getBeamLoadsFromSlab } from '@/slabFEMEngine/index';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FEMSlabProfile {
  /** Factored uniform DL (beam SW + wall) — kN/m, already × 1.2 */
  uniformDL_factored: number;
  /** Service-level DL slab profile at normalised t ∈ [0,1] */
  profileDL: Array<{ t: number; wy: number }>;
  /** Service-level LL slab profile at normalised t ∈ [0,1] */
  profileLL: Array<{ t: number; wy: number }>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run the FEM slab engine and return per-beam load profiles in the format
 * expected by `build3DModelWithPatternLoading`.
 *
 * Strategy for DL/LL separation:
 *   FEM distribution shape depends on geometry (span ratios, beam positions),
 *   NOT on load magnitude. So we run FEM once with total load, then split
 *   the resulting w(x) profile proportionally:
 *     profileDL[i] = w[i] × (wDL / wTotal)
 *     profileLL[i] = w[i] × (wLL / wTotal)
 *
 * @returns Map<elemId, FEMSlabProfile> keyed by `beam_${beamId}`
 */
export function computeFEMSlabProfiles(
  beams: Beam[],
  slabs: Slab[],
  slabProps: SlabProps,
  mat: MatProps,
  columns: { id: string; x: number; y: number; b: number; h: number; L: number; isRemoved?: boolean }[],
): Map<string, FEMSlabProfile> {
  const result = new Map<string, FEMSlabProfile>();

  if (!slabs || slabs.length === 0) return result;

  // Service-level load components
  const ownWeight_kNm2 = (slabProps.thickness / 1000) * mat.gamma;
  const wDL = ownWeight_kNm2 + slabProps.finishLoad;
  const wLL = slabProps.liveLoad;
  const wTotal = wDL + wLL;
  if (wTotal < 1e-9) return result;

  const ratioDL = wDL / wTotal;
  const ratioLL = wLL / wTotal;

  // Build FEM input model
  const femModel: FEMInputModel = {
    slabs,
    beams,
    columns: columns.filter(c => !c.isRemoved).map(c => ({
      id: c.id, x: c.x, y: c.y, b: c.b, h: c.h, L: c.L,
    })),
    slabProps,
    mat,
    meshDensity: 4,
    useStressBasedTransfer: false, // reaction-based is sufficient for load distribution
  };

  // Run FEM Phase 1-3
  let femResults: BeamLoadResult[];
  try {
    femResults = getBeamLoadsFromSlab(femModel);
  } catch (err) {
    console.warn('[FEM Bridge] FEM engine failed, falling back to yield-line:', err);
    return result; // empty → caller uses yield-line fallback
  }

  console.log(`[FEM Bridge] FEM returned load profiles for ${femResults.length} beams`);

  // Convert each beam's w(x) profile to normalised t ∈ [0,1] format
  for (const br of femResults) {
    const beam = beams.find(b => b.id === br.beamId);
    if (!beam) continue;

    const beamLen = beam.length;
    if (beamLen < 1e-6) continue;

    const wPoints = br.loads.values; // { position: m, w: kN/m }

    // Convert to normalised t ∈ [0,1] and split DL/LL
    const profileDL: Array<{ t: number; wy: number }> = [];
    const profileLL: Array<{ t: number; wy: number }> = [];

    for (const pt of wPoints) {
      const t = Math.min(Math.max(pt.position / beamLen, 0), 1);
      // w is total service load intensity at this point
      // Split proportionally
      profileDL.push({ t, wy: pt.w * ratioDL });
      profileLL.push({ t, wy: pt.w * ratioLL });
    }

    // Ensure we have endpoints at t=0 and t=1
    if (profileDL.length > 0 && profileDL[0].t > 0.001) {
      profileDL.unshift({ t: 0, wy: 0 });
      profileLL.unshift({ t: 0, wy: 0 });
    }
    if (profileDL.length > 0 && profileDL[profileDL.length - 1].t < 0.999) {
      profileDL.push({ t: 1, wy: 0 });
      profileLL.push({ t: 1, wy: 0 });
    }

    // Beam self-weight + wall load (uniform DL component, factored)
    const beamSW = (beam.b / 1000) * (beam.h / 1000) * mat.gamma;
    const wallLoad = beam.wallLoad ?? 0;
    const uniformDL_factored = 1.2 * (beamSW + wallLoad);

    const elemId = `beam_${beam.id}`;
    result.set(elemId, { uniformDL_factored, profileDL, profileLL });
  }

  console.log(`[FEM Bridge] Generated ${result.size} slab profiles for 3D engine`);
  return result;
}
