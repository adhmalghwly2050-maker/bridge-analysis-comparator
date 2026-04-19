/**
 * slabFEMEngine – Phase 7: Full Coupled Beam–Slab FEM System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module implements a TRUE monolithic coupled FEM system where:
 *   • Slab Mindlin-Reissner shell elements (Phase 1, 3 DOF/node)
 *   • 3D Euler-Bernoulli beam frame elements (Phase 7, 6 DOF/node)
 *   • Penalty-based compatibility constraints at slab–beam interface
 *
 * are all assembled into a SINGLE global stiffness matrix and solved
 * simultaneously — exactly like ETABS monolithic beam-slab interaction.
 *
 * ── Global DOF layout ────────────────────────────────────────────────────
 *
 *   [0 … 3·n_slab − 1]        Slab DOFs:  [UZ, RX, RY] per node
 *   [3·n_slab … 3·n_slab + 6·n_beam − 1]  Beam DOFs: [UX, UY, UZ, RX, RY, RZ] per unique beam node
 *
 * ── Penalty coupling ─────────────────────────────────────────────────────
 *
 *   At each slab mesh node that lies on a beam, we enforce:
 *     UZ_slab  = UZ_beam_global
 *     RX_slab  = RX_beam_global
 *     RY_slab  = RY_beam_global
 *
 *   Via penalty energy:  W_p = (α_p/2) · (g)²  →  K_penalty += α_p · [1, −1; −1, 1]
 *
 *   Penalty factor α_p is tuned to max(K_diag) × 1e4 to enforce the constraint
 *   to < 0.01% error without causing ill-conditioning of the Gaussian solver.
 *
 * ── Beam node identification ──────────────────────────────────────────────
 *
 *   The existing mesh generator (mesh.ts) forces grid lines at every beam
 *   position, so slab mesh nodes with beamId ≠ null are naturally located
 *   ON the beam lines.  These become the beam element nodes in Phase 7.
 *
 *   Consecutive beam-associated slab nodes (sorted by beamPos) define
 *   individual Euler-Bernoulli beam elements.
 *
 * ── Boundary conditions ───────────────────────────────────────────────────
 *
 *   Slab fixed nodes (isFixed = true, at column positions):
 *     → Slab DOFs pinned to zero.
 *   Beam nodes at column positions:
 *     → All 6 beam DOFs fixed to zero (fully clamped).
 *   The penalty constraint is automatically satisfied at fixed nodes.
 *
 * ── Output ───────────────────────────────────────────────────────────────
 *
 *   CoupledResult: beam end forces (local), slab displacements/forces,
 *   equilibrium check, and debug DOF counts.
 *
 * Units: mm, N, MPa, rad throughout.  Output forces in kN, kN·m, m.
 */

import type { SlabProps, MatProps }                                  from './types';
import type { Beam, Slab, Column }                                   from './types';
import { meshSlab }                                                   from './mesh';
import { elementStiffness, elementLoadVector }                        from './mindlinShell';
import { elemGlobalDOFs }                                             from './assembler';
import { solve }                                                      from './solver';
import {
  buildLocalStiffness,
  buildTransformationMatrix,
  globalStiffness,
  elementLocalForces,
  sectionFromBeam,
} from './frameElement';

// ─────────────────────────────────────────────────────────────────────────────
// Output types
// ─────────────────────────────────────────────────────────────────────────────

export interface CoupledBeamEndForces {
  /** Axial force at node 1 (N, tension positive) */
  N1:  number;
  /** Transverse shear in local-y at node 1 (N) */
  Vy1: number;
  /** Transverse shear in local-z (vertical) at node 1 (N) */
  Vz1: number;
  /** Torsion moment at node 1 (N·mm) */
  T1:  number;
  /** Bending moment about local-y at node 1 (N·mm) */
  My1: number;
  /** Bending moment about local-z at node 1 (N·mm) */
  Mz1: number;
  N2: number; Vy2: number; Vz2: number; T2: number; My2: number; Mz2: number;
}

export interface CoupledBeamResult {
  beamId: string;
  /** End forces in local coordinate system of the LAST element in the beam */
  endForcesLocal: CoupledBeamEndForces;
  /** Peak absolute bending moment along the beam (kN·m) */
  maxMoment_kNm: number;
  /** Peak absolute shear force along the beam (kN) */
  maxShear_kN: number;
  /** Bending moment at each beam element (My in kN·m, local, at element midpoint) */
  elementMoments_kNm: number[];
  /** Shear force at each beam element midpoint (kN) */
  elementShears_kN: number[];
}

export interface CoupledSlabResults {
  /** Full displacement vector (3 per slab node: UZ, RX, RY), mm / rad */
  displacements: number[];
  /** Max absolute vertical deflection in slab (mm) */
  maxDeflection_mm: number;
}

export interface CoupledEquilibrium {
  /** Total applied load (kN) */
  totalApplied_kN: number;
  /** Sum of all reaction forces at fixed DOFs (kN) */
  totalReactions_kN: number;
  /** |applied − reactions| / applied × 100  (%) */
  errorPct: number;
  passed: boolean;
}

export interface CoupledDebugInfo {
  nSlabNodes:          number;
  nSlabDOF:            number;
  nBeamNodes:          number;
  nBeamDOF:            number;
  nCouplingConstraints: number;
  nTotalDOF:           number;
  nFreeDOF:            number;
  penaltyFactor_N_mm:  number;
}

export interface CoupledResult {
  beamResults:  CoupledBeamResult[];
  slabResults:  CoupledSlabResults;
  equilibrium:  CoupledEquilibrium;
  debug:        CoupledDebugInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: beam node registry
// ─────────────────────────────────────────────────────────────────────────────

interface BeamNodeEntry {
  slabNodeId:  number;   // index into mesh.nodes[]
  beamBlockIdx: number;  // index in beam DOF block (each → 6 DOFs)
  isFixed:     boolean;  // true if this node is at a column (all 6 beam DOFs = 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main assembly function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble and solve the full coupled beam–slab FEM system.
 *
 * @param slab       Single slab object (mm coords after toMmModel)
 * @param beams      All beams (mm coords)
 * @param columns    All columns (mm coords)
 * @param slabProps  Slab thickness, loads
 * @param mat        Material properties
 * @param q_Nmm2     Applied surface pressure (N/mm²)
 * @param meshDensity Mesh divisions per metre (default 2 for coupled — denser = slower)
 * @param penaltyMult Multiplier on auto-calculated penalty stiffness (default 1e4)
 */
export function solveCoupledSystem(
  slab:         Slab,
  beams:        Beam[],
  columns:      Column[],
  slabProps:    SlabProps,
  mat:          MatProps,
  q_Nmm2:       number,
  meshDensity:  number = 2,
  penaltyMult:  number = 1e4,
): CoupledResult {

  // ── 1. Generate slab mesh ─────────────────────────────────────────────────
  const mesh = meshSlab(slab, beams, columns, meshDensity);
  const nodes   = mesh.nodes;
  const elements = mesh.elements;
  const nSlab   = nodes.length;
  const nSlabDOF = nSlab * 3;  // 3 DOF per node: [UZ, RX, RY]

  console.log(`[Phase7] Slab mesh: ${nSlab} nodes, ${elements.length} elements`);

  // ── 2. Identify beam nodes (slab nodes with beamId != null) ───────────────
  //    Build a global registry: slabNodeId → BeamNodeEntry
  //    Each unique slab node on any beam gets 6 beam DOFs.
  const beamNodeMap = new Map<number, BeamNodeEntry>();
  let beamBlockIdx = 0;

  for (let ni = 0; ni < nodes.length; ni++) {
    const nd = nodes[ni];
    if (nd.beamId !== null && !beamNodeMap.has(ni)) {
      beamNodeMap.set(ni, {
        slabNodeId:   ni,
        beamBlockIdx: beamBlockIdx++,
        isFixed:      nd.isFixed,   // fixed if column sits here
      });
    }
  }

  const nBeamNodes = beamBlockIdx;
  const nBeamDOF   = nBeamNodes * 6;
  const nTotalDOF  = nSlabDOF + nBeamDOF;

  console.log(`[Phase7] Beam nodes: ${nBeamNodes}  Beam DOF: ${nBeamDOF}  Total DOF: ${nTotalDOF}`);

  // ── 3. Allocate global K and F ────────────────────────────────────────────
  const K_full = new Array(nTotalDOF * nTotalDOF).fill(0);
  const F_full = new Array(nTotalDOF).fill(0);

  // ── 4. Add slab element stiffness and load ────────────────────────────────
  for (const elem of elements) {
    const gDOF = elemGlobalDOFs(elem.nodeIds);   // 12 slab-block DOF indices
    const ke   = elementStiffness(elem, nodes, slabProps, mat);
    const fe   = elementLoadVector(elem, nodes, q_Nmm2);

    for (let i = 0; i < 12; i++) {
      const gi = gDOF[i];
      F_full[gi] += fe[i];
      for (let j = 0; j < 12; j++) {
        K_full[gi * nTotalDOF + gDOF[j]] += ke[i * 12 + j];
      }
    }
  }

  // ── 5. Add beam element stiffness ─────────────────────────────────────────
  //    For each beam: collect its slab-mesh-nodes sorted by beamPos,
  //    form Euler-Bernoulli elements between consecutive pairs.

  const Ec = 4700 * Math.sqrt(mat.fc);  // MPa

  for (const beam of beams) {
    if (!beam.slabs.includes(slab.id)) continue;

    // Collect beam nodes (slab mesh nodes lying on this beam)
    const beamNodes: { slabNodeId: number; beamPos: number }[] = [];
    for (let ni = 0; ni < nodes.length; ni++) {
      const nd = nodes[ni];
      if (nd.beamId === beam.id) {
        beamNodes.push({ slabNodeId: ni, beamPos: nd.beamPos });
      }
    }
    if (beamNodes.length < 2) continue;

    // Sort by position along beam
    beamNodes.sort((a, b) => a.beamPos - b.beamPos);

    // Beam direction angle for transformation matrix
    const dx = beam.x2 - beam.x1;
    const dy = beam.y2 - beam.y1;
    const Lbeam = Math.hypot(dx, dy);
    if (Lbeam < 1e-6) continue;
    const cosA = dx / Lbeam;
    const sinA = dy / Lbeam;

    // Loop over beam elements (pairs of consecutive beam nodes)
    for (let ei = 0; ei < beamNodes.length - 1; ei++) {
      const nA = beamNodes[ei];
      const nB = beamNodes[ei + 1];

      const entryA = beamNodeMap.get(nA.slabNodeId);
      const entryB = beamNodeMap.get(nB.slabNodeId);
      if (!entryA || !entryB) continue;

      // Element length (from actual slab mesh node positions)
      const xA = nodes[nA.slabNodeId].x;
      const yA = nodes[nA.slabNodeId].y;
      const xB = nodes[nB.slabNodeId].x;
      const yB = nodes[nB.slabNodeId].y;
      const Lelem = Math.hypot(xB - xA, yB - yA);
      if (Lelem < 1e-6) continue;

      // Build element stiffness
      const sec = sectionFromBeam(beam.b, beam.h, Lelem, mat.fc);
      const K_loc = buildLocalStiffness(sec);
      const T     = buildTransformationMatrix(cosA, sinA);
      const K_glo = globalStiffness(K_loc, T);

      // Global DOF indices for this beam element (12 DOF: 2 nodes × 6)
      const offA = nSlabDOF + entryA.beamBlockIdx * 6;
      const offB = nSlabDOF + entryB.beamBlockIdx * 6;
      const elemDOF = [
        offA+0, offA+1, offA+2, offA+3, offA+4, offA+5,
        offB+0, offB+1, offB+2, offB+3, offB+4, offB+5,
      ];

      // Scatter into K_full
      for (let i = 0; i < 12; i++) {
        const gi = elemDOF[i];
        for (let j = 0; j < 12; j++) {
          K_full[gi * nTotalDOF + elemDOF[j]] += K_glo[i * 12 + j];
        }
      }
    }
  }

  // ── 6. Compute penalty factor from current K diagonal ─────────────────────
  let maxDiag = 1.0;
  for (let i = 0; i < nTotalDOF; i++) {
    const d = Math.abs(K_full[i * nTotalDOF + i]);
    if (d > maxDiag) maxDiag = d;
  }
  const alpha_p = maxDiag * penaltyMult;
  console.log(`[Phase7] Penalty factor α_p = ${alpha_p.toExponential(3)} N/mm (maxDiag=${maxDiag.toExponential(3)})`);

  // ── 7. Add penalty constraints at slab–beam interface ─────────────────────
  //    For each beam node (slab node with beamId != null):
  //      UZ_slab_i  = UZ_beam_j  → couple DOFs (3i+0) and (nSlabDOF + 6j+2)
  //      RX_slab_i  = RX_beam_j  → couple DOFs (3i+1) and (nSlabDOF + 6j+3)
  //      RY_slab_i  = RY_beam_j  → couple DOFs (3i+2) and (nSlabDOF + 6j+4)

  let nConstraints = 0;

  for (const [slabNi, entry] of beamNodeMap) {
    const bj = entry.beamBlockIdx;

    const dofPairs: [number, number][] = [
      [slabNi * 3 + 0,  nSlabDOF + bj * 6 + 2],  // UZ_slab  ↔ UZ_beam_global
      [slabNi * 3 + 1,  nSlabDOF + bj * 6 + 3],  // RX_slab  ↔ RX_beam_global
      [slabNi * 3 + 2,  nSlabDOF + bj * 6 + 4],  // RY_slab  ↔ RY_beam_global
    ];

    for (const [dofS, dofB] of dofPairs) {
      K_full[dofS * nTotalDOF + dofS] += alpha_p;
      K_full[dofB * nTotalDOF + dofB] += alpha_p;
      K_full[dofS * nTotalDOF + dofB] -= alpha_p;
      K_full[dofB * nTotalDOF + dofS] -= alpha_p;
      nConstraints++;
    }
  }

  console.log(`[Phase7] Penalty constraints: ${nConstraints}`);

  // ── 8. Identify fixed DOFs ────────────────────────────────────────────────
  const fixedDOFs = new Set<number>();

  // a. Slab fixed nodes (columns)
  for (let ni = 0; ni < nodes.length; ni++) {
    if (nodes[ni].isFixed) {
      fixedDOFs.add(ni * 3 + 0);
      fixedDOFs.add(ni * 3 + 1);
      fixedDOFs.add(ni * 3 + 2);
    }
  }

  // b. Beam DOFs at column-coincident nodes (all 6 fixed)
  for (const [, entry] of beamNodeMap) {
    if (entry.isFixed) {
      const off = nSlabDOF + entry.beamBlockIdx * 6;
      for (let d = 0; d < 6; d++) fixedDOFs.add(off + d);
    }
  }

  // c. Extra: beam DOFs with zero diagonal (isolated beam nodes not connected
  //    to any element — prevents singular matrix)
  for (let i = nSlabDOF; i < nTotalDOF; i++) {
    if (Math.abs(K_full[i * nTotalDOF + i]) < 1e-10) {
      fixedDOFs.add(i);
    }
  }

  // Build free DOF list
  const freeDOFs: number[] = [];
  for (let i = 0; i < nTotalDOF; i++) {
    if (!fixedDOFs.has(i)) freeDOFs.push(i);
  }
  const nFree = freeDOFs.length;

  console.log(
    `[Phase7] Fixed DOF: ${fixedDOFs.size}  Free DOF: ${nFree}  ` +
    `(Slab fixed: ${[...fixedDOFs].filter(d => d < nSlabDOF).length}, ` +
    `Beam fixed: ${[...fixedDOFs].filter(d => d >= nSlabDOF).length})`,
  );

  // ── 9. Build reduced system ───────────────────────────────────────────────
  const K_ff = new Array(nFree * nFree).fill(0);
  const F_f  = new Array(nFree).fill(0);

  for (let i = 0; i < nFree; i++) {
    const gi = freeDOFs[i];
    F_f[i] = F_full[gi];
    for (let j = 0; j < nFree; j++) {
      K_ff[i * nFree + j] = K_full[gi * nTotalDOF + freeDOFs[j]];
    }
  }

  // ── 10. Solve ─────────────────────────────────────────────────────────────
  const solveResult = solve(K_ff.slice(), F_f.slice());
  if (!solveResult.converged) {
    console.warn(
      `[Phase7] Solver residual = ${solveResult.maxResidual.toExponential(3)} — ` +
      'check boundary conditions and penalty factor.',
    );
  }

  // Reconstruct full displacement vector
  const d_full = new Array(nTotalDOF).fill(0);
  for (let i = 0; i < nFree; i++) {
    d_full[freeDOFs[i]] = solveResult.d[i];
  }

  // ── 11. Equilibrium check ─────────────────────────────────────────────────
  const slabArea_mm2 = Math.abs(slab.x2 - slab.x1) * Math.abs(slab.y2 - slab.y1);
  const totalApplied_N = q_Nmm2 * slabArea_mm2;
  const totalApplied_kN = totalApplied_N * 1e-3;

  // Sum vertical reactions at slab fixed nodes (UZ DOF = 3*n+0)
  let totalReaction_N = 0;
  for (const dof of fixedDOFs) {
    if (dof < nSlabDOF && dof % 3 === 0) {
      let r = -F_full[dof];
      for (let j = 0; j < nTotalDOF; j++) {
        r += K_full[dof * nTotalDOF + j] * d_full[j];
      }
      totalReaction_N += r;
    }
  }
  const totalReactions_kN = Math.abs(totalReaction_N * 1e-3);
  const eqErr = totalApplied_kN > 1e-6
    ? Math.abs(totalApplied_kN - totalReactions_kN) / totalApplied_kN * 100
    : 0;

  const eqPassed = eqErr < 2.0;
  console.log(
    `[Phase7] Equilibrium: Applied=${totalApplied_kN.toFixed(2)} kN  ` +
    `Reactions=${totalReactions_kN.toFixed(2)} kN  Error=${eqErr.toFixed(3)}%  ` +
    (eqPassed ? '✓ PASSED' : '✗ FAILED — review BCs or penalty'),
  );

  if (!eqPassed) {
    console.warn(
      '[Phase7] Equilibrium error > 2%. Possible causes: ' +
      'insufficient mesh density, penalty factor mismatch, or missing supports.',
    );
  }

  // ── 12. Extract slab results ──────────────────────────────────────────────
  const slabDisp = d_full.slice(0, nSlabDOF);
  let maxDefMm = 0;
  for (let i = 0; i < nSlab; i++) {
    const uz = Math.abs(slabDisp[i * 3]);
    if (uz > maxDefMm) maxDefMm = uz;
  }

  // ── 13. Extract beam results ──────────────────────────────────────────────
  const beamResults: CoupledBeamResult[] = [];

  for (const beam of beams) {
    if (!beam.slabs.includes(slab.id)) continue;

    // Collect sorted beam nodes
    const beamNodes: { slabNodeId: number; beamPos: number }[] = [];
    for (let ni = 0; ni < nodes.length; ni++) {
      const nd = nodes[ni];
      if (nd.beamId === beam.id) {
        beamNodes.push({ slabNodeId: ni, beamPos: nd.beamPos });
      }
    }
    if (beamNodes.length < 2) continue;
    beamNodes.sort((a, b) => a.beamPos - b.beamPos);

    const dx = beam.x2 - beam.x1;
    const dy = beam.y2 - beam.y1;
    const Lbeam = Math.hypot(dx, dy);
    if (Lbeam < 1e-6) continue;
    const cosA = dx / Lbeam;
    const sinA = dy / Lbeam;

    const momentList: number[] = [];
    const shearList:  number[] = [];
    let firstEndForces: CoupledBeamEndForces | null = null;
    let lastEndForces:  CoupledBeamEndForces | null = null;

    for (let ei = 0; ei < beamNodes.length - 1; ei++) {
      const nA = beamNodes[ei];
      const nB = beamNodes[ei + 1];
      const entryA = beamNodeMap.get(nA.slabNodeId);
      const entryB = beamNodeMap.get(nB.slabNodeId);
      if (!entryA || !entryB) continue;

      const xA = nodes[nA.slabNodeId].x;
      const yA = nodes[nA.slabNodeId].y;
      const xB = nodes[nB.slabNodeId].x;
      const yB = nodes[nB.slabNodeId].y;
      const Lelem = Math.hypot(xB - xA, yB - yA);
      if (Lelem < 1e-6) continue;

      const sec = sectionFromBeam(beam.b, beam.h, Lelem, mat.fc);
      const K_loc = buildLocalStiffness(sec);
      const T     = buildTransformationMatrix(cosA, sinA);

      // Extract element global displacements (12 values)
      const offA = nSlabDOF + entryA.beamBlockIdx * 6;
      const offB = nSlabDOF + entryB.beamBlockIdx * 6;
      const d12 = [
        d_full[offA+0], d_full[offA+1], d_full[offA+2],
        d_full[offA+3], d_full[offA+4], d_full[offA+5],
        d_full[offB+0], d_full[offB+1], d_full[offB+2],
        d_full[offB+3], d_full[offB+4], d_full[offB+5],
      ];

      // Compute local forces
      const f12 = elementLocalForces(d12, K_loc, T);
      // f12 = [N1, Vy1, Vz1, T1, My1, Mz1, N2, Vy2, Vz2, T2, My2, Mz2]

      // Store structural moment at the RIGHT node of each element (My2, signed).
      // My2(i) = structural moment at that node (sagging > 0, hogging < 0).
      // My1 is NOT stored: at shared nodes My2(i) = -My1(i+1), so mixing both
      // would give alternating signs for the same physical moment location.
      momentList.push(f12[10] * 1e-6);  // My2: structural moment at right node (kN·m, signed)
      shearList.push(Math.abs(f12[2]) * 1e-3);   // Vz1 in kN
      shearList.push(Math.abs(f12[8]) * 1e-3);   // Vz2 in kN

      // Capture first element for left-support forces, last element for right-support forces
      if (ei === 0) {
        firstEndForces = {
          N1:  f12[0],  Vy1: f12[1],  Vz1: f12[2],  T1:  f12[3],  My1: f12[4],  Mz1: f12[5],
          N2:  f12[6],  Vy2: f12[7],  Vz2: f12[8],  T2:  f12[9],  My2: f12[10], Mz2: f12[11],
        };
      }
      if (ei === beamNodes.length - 2) {
        lastEndForces = {
          N1:  f12[0],  Vy1: f12[1],  Vz1: f12[2],  T1:  f12[3],  My1: f12[4],  Mz1: f12[5],
          N2:  f12[6],  Vy2: f12[7],  Vz2: f12[8],  T2:  f12[9],  My2: f12[10], Mz2: f12[11],
        };
      }
    }

    // maxMoment: unsigned peak across all elements (design envelope)
    const maxMoment = momentList.length > 0 ? Math.max(...momentList.map(Math.abs)) : 0;
    const maxShear  = shearList.length > 0  ? Math.max(...shearList)                : 0;

    // Combined end forces: My1 from first element (left support), My2 from last (right support)
    const combinedEnd: CoupledBeamEndForces = {
      N1:  firstEndForces?.N1  ?? 0,
      Vy1: firstEndForces?.Vy1 ?? 0,
      Vz1: firstEndForces?.Vz1 ?? 0,
      T1:  firstEndForces?.T1  ?? 0,
      My1: firstEndForces?.My1 ?? 0,   // left-support My1 (adapter will negate for structural sign)
      Mz1: firstEndForces?.Mz1 ?? 0,
      N2:  lastEndForces?.N2   ?? 0,
      Vy2: lastEndForces?.Vy2  ?? 0,
      Vz2: lastEndForces?.Vz2  ?? 0,
      T2:  lastEndForces?.T2   ?? 0,
      My2: lastEndForces?.My2  ?? 0,   // right-support My2 (structural sign already correct)
      Mz2: lastEndForces?.Mz2  ?? 0,
    };

    beamResults.push({
      beamId: beam.id,
      endForcesLocal:     combinedEnd,
      maxMoment_kNm:      maxMoment,
      maxShear_kN:        maxShear,
      elementMoments_kNm: momentList,
      elementShears_kN:   shearList,
    });
  }

  // ── 14. Log summary ───────────────────────────────────────────────────────
  console.log('[Phase7] Beam results summary:');
  for (const br of beamResults) {
    console.log(
      `  ${br.beamId}: maxM = ${br.maxMoment_kNm.toFixed(2)} kN·m  ` +
      `maxV = ${br.maxShear_kN.toFixed(2)} kN`,
    );
  }

  // ── 15. Return result ─────────────────────────────────────────────────────
  return {
    beamResults,
    slabResults: {
      displacements: slabDisp,
      maxDeflection_mm: maxDefMm,
    },
    equilibrium: {
      totalApplied_kN,
      totalReactions_kN,
      errorPct: eqErr,
      passed:   eqPassed,
    },
    debug: {
      nSlabNodes:           nSlab,
      nSlabDOF,
      nBeamNodes,
      nBeamDOF,
      nCouplingConstraints: nConstraints,
      nTotalDOF,
      nFreeDOF:             nFree,
      penaltyFactor_N_mm:   alpha_p,
    },
  };
}
