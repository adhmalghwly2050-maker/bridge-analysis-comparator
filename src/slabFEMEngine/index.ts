/**
 * slabFEMEngine – Public API
 * ============================================================
 *
 * This module is a COMPLETELY ISOLATED add-on engine.
 * It does NOT touch any existing analysis logic.
 * Existing code remains unchanged and fully functional.
 *
 * ── Public surface ──────────────────────────────────────────
 *
 *   getBeamLoadsFromSlab(model)   → BeamLoadResult[]
 *     Full FEM-based slab-to-beam load transfer.
 *     Phase 1: mesh + solve + internal forces.
 *     Phase 2: edge force extraction.
 *     Phase 3: beam load distribution w(x), force-conservative.
 *
 *   getSlabCenterMoments(model)   → SlabMomentComparison[]
 *     FEM center Mx/My for each slab (for comparison UI).
 *
 *   runPhase1Validation()         → ValidationReport
 *     Self-contained simply-supported slab test.
 *     Must pass before any production use.
 *
 *   runCase1Regression()          → { passed, equilibriumError_pct, notes }
 *     Phase 2+3 regression: 5×5 m slab, 4 edge beams, q=10 kN/m².
 *     Sum of beam loads must equal total applied load within 5 %.
 *
 *   runCase2Validation()          → Case2Report
 *     NEW: 6×6 m slab with internal beam at mid-span.
 *     Validates non-uniform load distribution and stiffness-based transfer.
 *
 *   runFullValidation()           → FullValidationReport
 *     Runs Phase 1 + Case 1 + Case 2 and returns combined report.
 *
 * ── Integration hook ────────────────────────────────────────
 *
 *   Set  useFEMSlabLoad: true  in the model to activate the engine.
 *   Set  comparisonMode: true  to return both methods side-by-side.
 *
 * ── Unit conventions ────────────────────────────────────────
 *   Internal computation: mm, N, rad.
 *   All OUTPUT values:    kN, m, kN/m, kN·m/m  (engineering units).
 *
 * ── Force conservation ──────────────────────────────────────
 *   Phase 3 normalizes the w(x) profile so that:
 *     ∫ w(x) dx  =  Σ F_i  (exact FEM nodal forces)
 *   The normalization scale factor is within 1–3 % of unity for meshes
 *   with ≥ 4 divisions/m.  A console warning is emitted if it exceeds 5 %.
 */

export type {
  FEMInputModel,
  BeamLoadResult,
  DistributedLoadPoint,
  NodalForce,
  ValidationReport,
  Phase1Result,
  StressResultants,
  ElementForceResult,
} from './types';

import type { FEMInputModel, BeamLoadResult, ValidationReport } from './types';
import { meshSlab, meshSummary } from './mesh';
import { assembleSystem, reconstructDisplacements, extractReactions } from './assembler';
import { solve } from './solver';
import { computeInternalForces } from './internalForces';
import { extractBeamEdgeForces, validatePhase2 } from './edgeForces';
import type { BeamEdgeForces } from './edgeForces';
import { mapEdgeForcesToBeams } from './beamMapper';
import { extractStressEdgeForces, summariseStressExtraction } from './stressEdgeTransfer';
import {
  applyRotationalCoupling,
  runPhase6Regression,
} from './rotationalCoupling';
import type { RotationalCouplingResult } from './rotationalCoupling';
import {
  runPhase1Validation,
  runCase1Regression,
  runCase2Validation,
  runCase3FreeEdgeTest,
  runCase4MeshRefinementStudy,
  runCase5MomentConsistencyTest,
  runFullValidation,
  assertPhase1Valid,
} from './validation';

export type {
  Case2Report, Case2BeamResult,
  Case3Report,
  Case4Report, Case4MeshStudyPoint,
  Case5Report,
  FullValidationReport,
} from './validation';

export {
  runPhase1Validation,
  runCase1Regression,
  runCase2Validation,
  runCase3FreeEdgeTest,
  runCase4MeshRefinementStudy,
  runCase5MomentConsistencyTest,
  runFullValidation,
  assertPhase1Valid,
};

export { extractStressEdgeForces, summariseStressExtraction } from './stressEdgeTransfer';
export { runPhase6Regression } from './rotationalCoupling';
export type { RotationalCouplingResult, RotationalCouplingNodeResult } from './rotationalCoupling';

// ── Phase 10: Global Node Registry (topology fix) ───────────────────────────
export { GlobalNodeRegistry } from './nodeRegistry';
export type { GlobalFEMNode, ConnectivityReport } from './nodeRegistry';
export { meshMultipleSlabs } from './mesh';
export type { MultiSlabMesh } from './mesh';
export {
  runSymmetryTest,
  generateTopologyReport,
} from './symmetryValidation';
export type {
  SymmetryTestResult,
  BeamNodeInfo,
  CornerNodeInfo,
  MomentSymmetryCheck,
} from './symmetryValidation';

// ─────────────────────────────────────────────────────────────────────────────
// Extended result type for Phase-6 output
// ─────────────────────────────────────────────────────────────────────────────

export interface BeamLoadsWithCouplingResult {
  /** Phase-3 distributed load results (w(x) profile) — same format as getBeamLoadsFromSlab. */
  loads: BeamLoadResult[];
  /** Phase-6 rotational coupling data per beam (empty if coupling disabled). */
  coupling: RotationalCouplingResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Slab moment comparison type (FEM center moments)
// ─────────────────────────────────────────────────────────────────────────────

export interface SlabMomentComparison {
  slabId: string;
  /** Shorter span (m). */
  lx_m: number;
  /** Longer span (m). */
  ly_m: number;
  /** Aspect ratio ly/lx. */
  beta: number;
  isOneWay: boolean;
  /** FEM Mindlin-Reissner center moments (kN·m/m). */
  fem: {
    Mx: number;
    My: number;
    Mxy: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinate scaling: app stores positions in METERS, FEM engine expects MM.
// Only x/y position coordinates are scaled. Structural dimensions (b, h, L)
// and beam.length are NOT scaled — beamMapper already converts beam.length×1000.
// ─────────────────────────────────────────────────────────────────────────────

function toMmModel(model: FEMInputModel): FEMInputModel {
  return {
    ...model,
    slabs: model.slabs.map(s => ({
      ...s,
      x1: s.x1 * 1000, y1: s.y1 * 1000,
      x2: s.x2 * 1000, y2: s.y2 * 1000,
    })),
    beams: model.beams.map(b => ({
      ...b,
      x1: b.x1 * 1000, y1: b.y1 * 1000,
      x2: b.x2 * 1000, y2: b.y2 * 1000,
      // beam.length stays in METRES — beamMapper does ×1000 internally
    })),
    columns: model.columns.map(c => ({
      ...c,
      x: c.x * 1000, y: c.y * 1000,
      // c.b, c.h, c.L are already in mm — do not scale
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: shared per-slab solve (Phases 1-5)
// Stores mesh + d_full so Phase 6 can extract rotations.
// ─────────────────────────────────────────────────────────────────────────────

interface SlabSolveRecord {
  mesh:        ReturnType<typeof meshSlab>;
  d_full:      number[];
  edgeForces:  BeamEdgeForces[];
}

function _solveSlabs(
  model:               FEMInputModel,
  useStressBasedTransfer: boolean,
  stressMode:          'shear-only' | 'full',
  q_Nmm2:              number,
): SlabSolveRecord[] {
  const { slabs, beams, columns, slabProps, mat, meshDensity = 4 } = model;
  const records: SlabSolveRecord[] = [];

  for (const slab of slabs) {
    const mesh = meshSlab(slab, beams, columns, meshDensity);
    console.log(`[slabFEMEngine] ${meshSummary(mesh)}`);

    const sys = assembleSystem(mesh, slabProps, mat, q_Nmm2);

    if (sys.freeDOFs.length === 0) {
      console.warn(`[slabFEMEngine] Slab ${slab.id}: no free DOFs — check BCs.`);
      continue;
    }

    const solveResult = solve(sys.K_ff.slice(), sys.F_f.slice());

    if (!solveResult.converged) {
      console.warn(
        `[slabFEMEngine] Slab ${slab.id}: solver residual = ` +
        `${solveResult.maxResidual.toExponential(3)}`,
      );
    }

    const d_full = reconstructDisplacements(solveResult.d, sys.freeDOFs, sys.nDOF);

    // Phase 1 equilibrium log
    const reactions = extractReactions(
      sys.K_full, d_full, sys.F_full, sys.fixedDOFs, sys.nDOF,
    );
    const slabArea_mm2 = Math.abs(slab.x2 - slab.x1) * Math.abs(slab.y2 - slab.y1);
    const totalApplied_kN = q_Nmm2 * slabArea_mm2 * 1e-3;

    let totalReaction_N_raw = 0;
    for (const [dof, force] of reactions) {
      if (dof % 3 === 0) totalReaction_N_raw += force;
    }
    const totalReaction_kN = Math.abs(totalReaction_N_raw * 1e-3);
    const eqErr = Math.abs(totalApplied_kN - totalReaction_kN)
                  / Math.max(totalApplied_kN, 1e-6) * 100;

    console.log(
      `[Phase 1] Slab ${slab.id}: ` +
      `Applied=${totalApplied_kN.toFixed(2)} kN, ` +
      `Reactions=${totalReaction_kN.toFixed(2)} kN, ` +
      `Error=${eqErr.toFixed(2)} %`,
    );

    // Phase 2 or Phase 4/5
    let edgeForces: BeamEdgeForces[];

    if (useStressBasedTransfer) {
      edgeForces = extractStressEdgeForces(mesh, d_full, slabProps, mat, beams, stressMode);
      summariseStressExtraction(edgeForces, totalApplied_kN, stressMode);
    } else {
      edgeForces = extractBeamEdgeForces(
        mesh, sys.K_full, d_full, sys.F_full, sys.fixedDOFs, sys.nDOF, beams,
      );
      validatePhase2(edgeForces, totalReaction_kN);
    }

    records.push({ mesh, d_full, edgeForces });
  }

  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point (Phases 1–3, backward-compatible)
// ─────────────────────────────────────────────────────────────────────────────

export function getBeamLoadsFromSlab(model: FEMInputModel): BeamLoadResult[] {
  const {
    slabProps, mat,
    useStressBasedTransfer = false,
    stressMode = 'full',
  } = model;

  const comparisonMode = (model as FEMInputModel & { comparisonMode?: boolean })
    .comparisonMode ?? false;

  const ownWeight_kNm2 = (slabProps.thickness / 1000) * mat.gamma;
  const q_kNm2 = ownWeight_kNm2 + slabProps.finishLoad + slabProps.liveLoad;
  const q_Nmm2 = q_kNm2 * 1e-3;

  const modeLabel = !useStressBasedTransfer
    ? 'Phase 2 — reaction-based (K·d − F)'
    : stressMode === 'full'
      ? 'Phase 5 — stress-based full (Fz + Mx + My)'
      : 'Phase 4 — stress-based shear-only (Fz)';
  console.log(`[slabFEMEngine] Mode: ${modeLabel}`);

  // Scale coordinates m→mm for internal FEM computation
  const mmModel = toMmModel(model);

  const records = _solveSlabs(mmModel, useStressBasedTransfer, stressMode, q_Nmm2);
  const allEdgeForces: BeamEdgeForces[] = records.flatMap(r => r.edgeForces);

  // Mapper receives ORIGINAL beams/slabs (beam.length in m, coords in m)
  // so that beamLen_mm = beam.length*1000 and calculateBeamLoads work correctly
  return mapEdgeForcesToBeams(allEdgeForces, model.beams, {
    comparisonMode,
    slabs:     model.slabs,
    slabProps: model.slabProps,
    mat:       model.mat,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase-6 entry point: returns loads + coupling data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getBeamLoadsWithCoupling
 * ─────────────────────────
 * Runs Phases 1–5 and optionally Phase 6 (rotational coupling).
 *
 * When model.useRotationalCoupling = true AND model.useStressBasedTransfer = true
 * AND model.stressMode = 'full', Phase 6 corrects the transferred moments using
 * the rotational spring model: M_corrected = M_phase5 − kθ · Δθ.
 *
 * Returns both the Phase-3 load profiles and the Phase-6 coupling details.
 * If coupling is disabled, coupling[] will be empty and loads match Phase-5.
 */
export function getBeamLoadsWithCoupling(model: FEMInputModel): BeamLoadsWithCouplingResult {
  const {
    slabProps, mat,
    useStressBasedTransfer = true,
    stressMode             = 'full',
    useRotationalCoupling  = false,
    couplingAlpha          = 1.0,
  } = model;

  const comparisonMode = (model as FEMInputModel & { comparisonMode?: boolean })
    .comparisonMode ?? false;

  const ownWeight_kNm2 = (slabProps.thickness / 1000) * mat.gamma;
  const q_kNm2 = ownWeight_kNm2 + slabProps.finishLoad + slabProps.liveLoad;
  const q_Nmm2 = q_kNm2 * 1e-3;

  // Scale coordinates m→mm for internal FEM computation
  const mmModel = toMmModel(model);
  const mmBeams = mmModel.beams;
  const mmSlabs = mmModel.slabs;

  // Phases 1–5 per slab (using mm coords)
  const records = _solveSlabs(
    { ...mmModel, useStressBasedTransfer, stressMode },
    useStressBasedTransfer,
    stressMode,
    q_Nmm2,
  );

  let allEdgeForces: BeamEdgeForces[] = records.flatMap(r => r.edgeForces);
  const allCouplingResults: RotationalCouplingResult[] = [];

  // Phase 6: rotational coupling (only when Phase-5 moments are available)
  const hasMoments = useStressBasedTransfer && stressMode === 'full';

  if (useRotationalCoupling && hasMoments) {
    console.log(
      `[slabFEMEngine] Phase 6 — Rotational Coupling ENABLED  (α = ${couplingAlpha})`,
    );

    // Apply coupling per slab — pass mm-scaled beams so beamL_mm is correct
    const coupledEdgeForces: BeamEdgeForces[] = [];

    for (const record of records) {
      const { correctedEdgeForces, couplingResults } = applyRotationalCoupling(
        record.mesh,
        record.d_full,
        record.edgeForces,
        mmBeams,
        mat,
        couplingAlpha,
      );
      coupledEdgeForces.push(...correctedEdgeForces);
      allCouplingResults.push(...couplingResults);
    }

    allEdgeForces = coupledEdgeForces;

    const totalMaxDelta = allCouplingResults.reduce((s, r) => s + r.maxDeltaTheta_rad, 0);
    const totalBeams    = allCouplingResults.length;
    console.log(
      `[Phase 6] Total beams coupled: ${totalBeams}  ` +
      `Sum max|Δθ|: ${(totalMaxDelta * 1000).toFixed(3)} mrad`,
    );

    // Equilibrium check using mm-scaled slab areas
    const totalApplied_kN = records.reduce((s, rec) => {
      const slabObj = mmSlabs.find(sl => sl.id === rec.mesh.slabId);
      if (!slabObj) return s;
      const area_mm2 = Math.abs(slabObj.x2 - slabObj.x1) * Math.abs(slabObj.y2 - slabObj.y1);
      return s + q_Nmm2 * area_mm2 * 1e-3;
    }, 0);
    const totalBeamFz_kN = allEdgeForces.reduce((s, ef) => s + ef.totalForce_N * 1e-3, 0);
    const fzErr = totalApplied_kN > 1e-6
      ? Math.abs(totalApplied_kN - totalBeamFz_kN) / totalApplied_kN * 100 : 0;

    console.log(
      `[Phase 6] Equilibrium check (vertical forces): ` +
      `Applied = ${totalApplied_kN.toFixed(2)} kN, ` +
      `Beam Fz total = ${totalBeamFz_kN.toFixed(2)} kN, ` +
      `Error = ${fzErr.toFixed(2)} %  ` +
      `(Phase-6 does NOT alter Fz — error should match Phase-5)`,
    );

  } else if (useRotationalCoupling && !hasMoments) {
    console.warn(
      '[slabFEMEngine] Phase 6 requested but Phase-5 moments are not available. ' +
      'Set useStressBasedTransfer=true and stressMode="full" to enable coupling.',
    );
  }

  // Mapper uses ORIGINAL model beams/slabs (beam.length in m, coords in m)
  const loads = mapEdgeForcesToBeams(allEdgeForces, model.beams, {
    comparisonMode,
    slabs:     model.slabs,
    slabProps,
    mat,
  });

  return { loads, coupling: allCouplingResults };
}

// ─────────────────────────────────────────────────────────────────────────────
// Slab center moment extraction (for comparison UI)
// Returns FEM Mindlin-Reissner center Mx/My for each slab.
// The caller (LoadComparisonPanel) pairs these with the old Marcus/ACI method.
// ─────────────────────────────────────────────────────────────────────────────

export function getSlabCenterMoments(model: FEMInputModel): SlabMomentComparison[] {
  const { slabProps, mat, meshDensity = 4 } = model;

  const ownWeight_kNm2 = (slabProps.thickness / 1000) * mat.gamma;
  const q_kNm2 = ownWeight_kNm2 + slabProps.finishLoad + slabProps.liveLoad;
  const q_Nmm2 = q_kNm2 * 1e-3;

  // Scale coordinates m→mm for FEM; iterate over original slabs for IDs/spans
  const mmModel = toMmModel(model);
  const { slabs: mmSlabs, beams: mmBeams, columns: mmColumns } = mmModel;

  const results: SlabMomentComparison[] = [];

  for (let si = 0; si < model.slabs.length; si++) {
    const origSlab = model.slabs[si];
    const mmSlab   = mmSlabs[si];

    // Spans from mm-scaled coords → convert to metres for output
    const lx_mm = Math.min(Math.abs(mmSlab.x2 - mmSlab.x1), Math.abs(mmSlab.y2 - mmSlab.y1));
    const ly_mm = Math.max(Math.abs(mmSlab.x2 - mmSlab.x1), Math.abs(mmSlab.y2 - mmSlab.y1));
    const lx_m  = lx_mm / 1000;
    const ly_m  = ly_mm / 1000;
    const beta  = Math.max(lx_m > 0 ? ly_m / lx_m : 1.0, 1.0);
    const isOneWay = beta > 2;

    // ── FEM solve (mm coords) ─────────────────────────────────────────────
    const mesh = meshSlab(mmSlab, mmBeams, mmColumns, meshDensity);
    const sys  = assembleSystem(mesh, slabProps, mat, q_Nmm2);

    let femMx = 0, femMy = 0, femMxy = 0;

    if (sys.freeDOFs.length > 0) {
      const solveResult = solve(sys.K_ff.slice(), sys.F_f.slice());
      const d_full = reconstructDisplacements(solveResult.d, sys.freeDOFs, sys.nDOF);
      const forceResults = computeInternalForces(mesh, d_full, slabProps, mat);

      // Center in mm (use scaled slab coords)
      const cx_mm = (mmSlab.x1 + mmSlab.x2) / 2;
      const cy_mm = (mmSlab.y1 + mmSlab.y2) / 2;

      // Find nearest Gauss-point result to the slab centre
      let minDist = Infinity;
      for (const fr of forceResults) {
        const dist = Math.hypot(fr.x - cx_mm, fr.y - cy_mm);
        if (dist < minDist) {
          minDist = dist;
          femMx  = fr.resultants.Mx;
          femMy  = fr.resultants.My;
          femMxy = fr.resultants.Mxy;
        }
      }
    }

    results.push({
      slabId: origSlab.id,
      lx_m, ly_m, beta, isOneWay,
      fem: { Mx: Math.abs(femMx), My: Math.abs(femMy), Mxy: Math.abs(femMxy) },
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: run Phase-1 validation and return the report.
// ─────────────────────────────────────────────────────────────────────────────

export function validatePhase1(meshDensity?: number): ValidationReport {
  return runPhase1Validation(meshDensity);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 — Full Coupled Beam-Slab FEM (penalty coupling)
// ─────────────────────────────────────────────────────────────────────────────

export type {
  CoupledResult,
  CoupledBeamResult,
  CoupledBeamEndForces,
  CoupledSlabResults,
  CoupledEquilibrium,
  CoupledDebugInfo,
} from './coupledSystem';

export type {
  Phase7TestResult,
  Phase7Report,
} from './phase7Validation';

export { runPhase7Validation } from './phase7Validation';

import { solveCoupledSystem } from './coupledSystem';
import type { CoupledResult }  from './coupledSystem';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8 — True DOF Merging (Constraint Elimination)
// ─────────────────────────────────────────────────────────────────────────────

export type {
  MergedResult,
  MergedDebugInfo,
} from './mergedDOFSystem';

export type {
  Phase8TestResult,
  Phase8Report,
} from './phase8Validation';

export { runPhase8Validation } from './phase8Validation';

import { solveMergedDOFSystem } from './mergedDOFSystem';
import type { MergedResult }     from './mergedDOFSystem';

/**
 * getCoupledBeamSlabResults
 * ─────────────────────────
 * Phase 7 public entry point: full monolithic coupled FEM where
 * the slab and all beams are solved simultaneously in ONE system.
 *
 * Unlike Phases 1–6 (sequential slab→beam transfer), Phase 7 assembles a
 * single global stiffness matrix that includes both slab Mindlin-Reissner
 * shell elements and 3D Euler-Bernoulli beam frame elements.
 * Beam–slab compatibility is enforced via penalty constraints.
 *
 * Input model coordinates are in METRES (same as the rest of the app).
 * Internal computation is in mm/N/rad.  Output is in kN/kN·m.
 *
 * @param model          FEM input model (coordinates in metres)
 * @param meshDensity    Mesh divisions per metre (default 2; use 3 for finer mesh)
 * @param penaltyMult    Penalty multiplier on max K_diagonal (default 1e4)
 * @returns CoupledResult with beam forces, slab deflections, and equilibrium info
 *
 * @performance  Dense O(n³) Gaussian solver.  Approx timing vs meshDensity:
 *   density=2 →  ~627 DOF → < 5 s
 *   density=3 → ~1100 DOF → ~15 s
 */
export function getCoupledBeamSlabResults(
  model:        FEMInputModel,
  meshDensity   = 2,
  penaltyMult   = 1e4,
): CoupledResult[] {
  const { slabProps, mat } = model;

  const ownWeight_kNm2 = (slabProps.thickness / 1000) * mat.gamma;
  const q_kNm2  = ownWeight_kNm2 + slabProps.finishLoad + slabProps.liveLoad;
  const q_Nmm2  = q_kNm2 * 1e-3;

  // Scale coordinates m → mm (same convention as the rest of the engine)
  const mm = toMmModel(model);

  const results: CoupledResult[] = [];

  for (const slab of mm.slabs) {
    // Only include beams that serve this slab
    const slabBeams = mm.beams.filter(b => b.slabs.includes(slab.id));
    if (slabBeams.length === 0) {
      console.warn(`[Phase7] Slab ${slab.id} has no associated beams — skipping.`);
      continue;
    }

    console.log(
      `[Phase7] Solving slab ${slab.id}  ` +
      `(${(Math.abs(slab.x2 - slab.x1) / 1000).toFixed(1)} × ` +
      `${(Math.abs(slab.y2 - slab.y1) / 1000).toFixed(1)} m)  ` +
      `${slabBeams.length} beams  meshDensity=${meshDensity}`,
    );

    const result = solveCoupledSystem(
      slab, slabBeams, mm.columns,
      slabProps, mat, q_Nmm2,
      meshDensity, penaltyMult,
    );

    results.push(result);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8 — True DOF Merging public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getMergedBeamSlabResults
 * ─────────────────────────
 * Phase 8 public entry point: full monolithic coupled FEM using TRUE DOF
 * MERGING instead of penalty constraints.
 *
 * At every slab node that lies on a beam the slab DOFs (UZ, RX, RY) are
 * SHARED with the beam element DOFs — they map to the SAME global DOF index.
 * No penalty stiffness is added.  The resulting system has:
 *   - 3 fewer DOFs per shared node than Phase 7
 *   - Better numerical conditioning (no artificial α_p inflation)
 *   - Identical or superior results compared to Phase 7
 *
 * Input model coordinates are in METRES (same as the rest of the app).
 * Internal computation is in mm/N/rad.  Output is in kN/kN·m.
 *
 * @param model       FEM input model (coordinates in metres)
 * @param meshDensity Mesh divisions per metre (default 2; use 3 for finer)
 * @returns MergedResult[] — one entry per slab with beams, including
 *          debug metrics showing the DOF reduction vs Phase 7.
 *
 * @performance  Dense O(n³) Gaussian solver.  System is smaller than Phase 7:
 *   density=2 →  reduced by ~3×nSharedNodes DOFs vs Phase 7
 *   Solve time is proportionally faster.
 *
 * @useMergedDOF  Pass useMergedDOF: true in the model (or call this function
 *               directly) to activate Phase 8 instead of Phase 7.
 */
export function getMergedBeamSlabResults(
  model:       FEMInputModel,
  meshDensity  = 2,
): MergedResult[] {
  const { slabProps, mat } = model;

  const ownWeight_kNm2 = (slabProps.thickness / 1000) * mat.gamma;
  const q_kNm2  = ownWeight_kNm2 + slabProps.finishLoad + slabProps.liveLoad;
  const q_Nmm2  = q_kNm2 * 1e-3;

  // Scale coordinates m → mm
  const mm = toMmModel(model);

  const results: MergedResult[] = [];

  for (const slab of mm.slabs) {
    const slabBeams = mm.beams.filter(b => b.slabs.includes(slab.id));
    if (slabBeams.length === 0) {
      console.warn(`[Phase8] Slab ${slab.id} has no associated beams — skipping.`);
      continue;
    }

    console.log(
      `[Phase8] Solving slab ${slab.id}  ` +
      `(${(Math.abs(slab.x2 - slab.x1) / 1000).toFixed(1)} × ` +
      `${(Math.abs(slab.y2 - slab.y1) / 1000).toFixed(1)} m)  ` +
      `${slabBeams.length} beams  meshDensity=${meshDensity}`,
    );

    const result = solveMergedDOFSystem(
      slab, slabBeams, mm.columns,
      slabProps, mat, q_Nmm2,
      meshDensity,
    );

    results.push(result);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9 — Sparse Solver Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

export type { Phase9DebugInfo }                from './sparsePhase9';
export type { Phase9TestResult, Phase9Report } from './phase9Validation';
export { runPhase9Validation }                 from './phase9Validation';
export { solveSparsePhase9 }                   from './sparsePhase9';

// CSR / sparse-matrix utilities
export type { CSRMatrix }           from './sparseMatrix';
export { TripletMatrix, csrStats, csrBandwidth, csrMemoryBytes } from './sparseMatrix';

// Sparse solver utilities
export type { SparseSolverOptions, SparseSolverResult } from './sparseSolver';
export { cuthillMcKee, sparseSolve }           from './sparseSolver';

import { solveSparsePhase9 as _solveSparse9 } from './sparsePhase9';
import type { Phase9DebugInfo }                from './sparsePhase9';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 10 — Connected Multi-Slab Global FEM
// ─────────────────────────────────────────────────────────────────────────────

export type {
  MultiSlabResult,
  MultiSlabDebugInfo,
  PerSlabResult,
} from './multiSlabSystem';

import { solveConnectedSlabs } from './multiSlabSystem';
export { solveConnectedSlabs } from './multiSlabSystem';

/**
 * getSparseBeamSlabResults
 * ─────────────────────────
 * Phase 9 public entry point: full monolithic coupled FEM using the Phase 8
 * DOF-merging layout, BUT assembled and solved in SPARSE format.
 *
 * Key improvements over Phases 7 and 8:
 *   • No n×n dense matrix — assembly uses COO triplets → CSR.
 *   • Memory: O(nnz) ≈ 0.5–2% of O(n²) for typical FEM meshes.
 *   • Solver: PCG (CG) or sparse Cholesky, not Gaussian elimination.
 *   • Reverse Cuthill-McKee reordering reduces bandwidth before solve.
 *
 * Input/output identical to getMergedBeamSlabResults() for easy comparison.
 *
 * @param model       FEM input model (coordinates in metres)
 * @param meshDensity Mesh divisions per metre (default 2)
 * @returns MergedResult[] — same structure as Phase 8, with Phase9DebugInfo
 *          in the debug field (nnz, bandwidth, memory, solver metrics).
 */
export function getSparseBeamSlabResults(
  model:       FEMInputModel,
  meshDensity  = 2,
): (MergedResult & { debug: Phase9DebugInfo })[] {
  const { slabProps, mat, sparseSolverMethod = 'cg', useCuthillMcKee = true } = model;

  const ownWeight_kNm2 = (slabProps.thickness / 1000) * mat.gamma;
  const q_kNm2  = ownWeight_kNm2 + slabProps.finishLoad + slabProps.liveLoad;
  const q_Nmm2  = q_kNm2 * 1e-3;

  const mm = toMmModel(model);

  const results: (MergedResult & { debug: Phase9DebugInfo })[] = [];

  for (const slab of mm.slabs) {
    const slabBeams = mm.beams.filter(b => b.slabs.includes(slab.id));
    if (slabBeams.length === 0) {
      console.warn(`[Phase9] Slab ${slab.id} has no associated beams — skipping.`);
      continue;
    }

    console.log(
      `[Phase9] Solving slab ${slab.id}  ` +
      `(${(Math.abs(slab.x2 - slab.x1) / 1000).toFixed(1)} × ` +
      `${(Math.abs(slab.y2 - slab.y1) / 1000).toFixed(1)} m)  ` +
      `${slabBeams.length} beams  meshDensity=${meshDensity}  ` +
      `solver=${sparseSolverMethod}  RCM=${useCuthillMcKee}`,
    );

    const result = _solveSparse9(
      slab, slabBeams, mm.columns,
      slabProps, mat, q_Nmm2,
      meshDensity,
      {
        method:          sparseSolverMethod,
        useCuthillMcKee: useCuthillMcKee,
      },
    );

    results.push(result);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 10 — Connected Multi-Slab public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getConnectedSlabResults
 * ────────────────────────
 * Phase 10 public entry point: analyzes ALL slabs in ONE unified global FEM
 * system.  Slabs sharing a beam or edge have CONTINUOUS displacements and
 * rotations at the shared boundary — moment redistribution between adjacent
 * slabs is handled automatically by the global solver.
 *
 * Key differences vs getMergedBeamSlabResults (Phase 8):
 *   - Phase 8 : N separate K matrices, one per slab  → no continuity
 *   - Phase 10: ONE global K for all slabs combined  → full continuity
 *
 * The returned array contains exactly ONE MultiSlabResult (the whole system),
 * with beamResults covering every beam in the model.
 *
 * @param model       FEM input model (coordinates in metres)
 * @param meshDensity Mesh divisions per metre (default 2)
 */
export function getConnectedSlabResults(
  model:       FEMInputModel,
  meshDensity  = 2,
): MergedResult[] {
  const { slabProps, mat } = model;

  const ownWeight_kNm2 = (slabProps.thickness / 1000) * mat.gamma;
  const q_kNm2  = ownWeight_kNm2 + slabProps.finishLoad + slabProps.liveLoad;
  const q_Nmm2  = q_kNm2 * 1e-3;

  const mm = toMmModel(model);

  if (mm.slabs.length === 0) {
    console.warn('[Phase10] No slabs in model.');
    return [];
  }

  const activeSlab  = new Set(mm.slabs.map(s => s.id));
  const activeBeams = mm.beams.filter(b => b.slabs.some(sid => activeSlab.has(sid)));

  console.log(
    `[Phase10] getConnectedSlabResults: ${mm.slabs.length} slabs, ` +
    `${activeBeams.length} beams  meshDensity=${meshDensity}`,
  );

  const result = solveConnectedSlabs(
    mm.slabs,
    activeBeams,
    mm.columns,
    slabProps,
    mat,
    q_Nmm2,
    meshDensity,
  );

  // Return as MergedResult[] (single-element) so adaptFEMResults works unchanged
  return [result as unknown as MergedResult];
}
