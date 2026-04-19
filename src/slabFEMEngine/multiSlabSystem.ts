/**
 * slabFEMEngine – Phase 10: Connected Multi-Slab Global FEM Analysis
 * ════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Replaces the per-slab loop in getMergedBeamSlabResults (Phase 8) with a
 * single GLOBAL stiffness assembly that covers ALL slabs simultaneously.
 *
 * In Phase 8, each slab is solved in isolation:
 *   for (slab of slabs) { solve(slab) }
 *
 * This is physically incorrect for CONNECTED slabs because:
 *   1. Shared boundary nodes (on common beams/edges) are not truly shared —
 *      each slab creates its own copy of those nodes.
 *   2. There is no moment continuity across slab boundaries.
 *   3. Beams shared between two slabs get assembled TWICE and accumulated,
 *      which ignores cross-slab stiffness coupling.
 *
 * Phase 10 fixes all of this:
 *   1. Uses meshMultipleSlabs() to assign ONE globalId to every unique (x,y)
 *      position — two slabs sharing a beam edge use the SAME node IDs.
 *   2. Builds ONE global K of size (3·nGlobal + 3·nBeamNodes)².
 *   3. Assembles all slab elements from all slabs using globalId-based DOFs.
 *   4. Assembles all beam sub-elements ONCE (no duplication per slab).
 *   5. Applies boundary conditions once and solves the unified system.
 *
 * RESULT
 * ──────
 * Moment continuity is automatically satisfied at shared slab edges.
 * Beams at common boundaries see the combined loading from BOTH adjacent slabs.
 * The analysis matches the physics of a real flat plate / ribbed slab floor.
 *
 * DOF LAYOUT (same as Phase 8 but globalId-indexed)
 * ──────────────────────────────────────────────────
 *   Block A [0 … 3·nGlobal−1]:
 *     Node gid:  DOF 3·gid+0 = UZ,  3·gid+1 = RX,  3·gid+2 = RY
 *   Block B [3·nGlobal … ]:
 *     Beam-node jIdx:  DOF nSlabDOF+3·jIdx+0 = UX, +1 = UY, +2 = RZ
 *
 * Units: mm, N, MPa, rad (internal).  Output: kN, kN·m.
 */

import type { SlabProps, MatProps, Beam, Slab, Column } from './types';
import type { SlabMesh }                                 from './types';
import { meshMultipleSlabs }                             from './mesh';
import {
  elementStiffness,
  elementLoadVector,
}                                                        from './mindlinShell';
import { solve }                                         from './solver';
import {
  buildLocalStiffness,
  buildTransformationMatrix,
  globalStiffness,
  elementLocalForces,
  sectionFromBeam,
}                                                        from './frameElement';
import type {
  CoupledBeamResult,
  CoupledBeamEndForces,
  CoupledSlabResults,
  CoupledEquilibrium,
}                                                        from './coupledSystem';
import type { MergedResult, MergedDebugInfo }            from './mergedDOFSystem';

// ─────────────────────────────────────────────────────────────────────────────
// Output types
// ─────────────────────────────────────────────────────────────────────────────

export interface MultiSlabDebugInfo extends MergedDebugInfo {
  nSlabs:             number;
  nSlabElements:      number;
  nUniqueBeamNodes:   number;
  dofSavedBySharing:  number;
  slabMaxDeflections: Record<string, number>;
}

export interface PerSlabResult {
  slabId:        string;
  maxDeflMm:     number;
  globalNodeIds: number[];
}

export interface MultiSlabResult extends Omit<MergedResult, 'debug'> {
  debug:          MultiSlabDebugInfo;
  perSlabResults: PerSlabResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const EPS_GEOM_MM = 1.5;

/**
 * Collect all unique (by globalId) nodes that lie geometrically on a beam,
 * gathered from ALL slab meshes.  Sorted by parametric position t ∈ [0,1].
 */
function collectConnectedBeamNodes(
  slabMeshes: SlabMesh[],
  beam:       Beam,
  Lbeam:      number,
): Array<{ globalId: number; x: number; y: number; beamPos: number }> {

  if (Lbeam < 1e-6) return [];

  const ax = beam.x1;
  const ay = beam.y1;
  const dx = beam.x2 - beam.x1;
  const dy = beam.y2 - beam.y1;
  const L2 = Lbeam * Lbeam;

  const seen   = new Set<number>();
  const result: Array<{ globalId: number; x: number; y: number; beamPos: number }> = [];

  for (const mesh of slabMeshes) {
    for (const nd of mesh.nodes) {
      if (seen.has(nd.globalId)) continue;

      const t = ((nd.x - ax) * dx + (nd.y - ay) * dy) / L2;
      if (t < -EPS_GEOM_MM / Lbeam || t > 1 + EPS_GEOM_MM / Lbeam) continue;

      const px   = ax + t * dx;
      const py   = ay + t * dy;
      const dist = Math.hypot(nd.x - px, nd.y - py);

      if (dist < EPS_GEOM_MM) {
        seen.add(nd.globalId);
        result.push({
          globalId: nd.globalId,
          x:        nd.x,
          y:        nd.y,
          beamPos:  Math.max(0, Math.min(1, t)),
        });
      }
    }
  }

  result.sort((a, b) => a.beamPos - b.beamPos);
  return result;
}

/**
 * Build the 12-element global DOF index array for one beam sub-element.
 * Block A uses globalId, Block B uses beamBlockIdx.
 */
function p10BeamElemDOFs(
  gidA: number, jA: number,
  gidB: number, jB: number,
  nSlabDOF: number,
): number[] {
  const extraA = nSlabDOF + 3 * jA;
  const extraB = nSlabDOF + 3 * jB;
  return [
    extraA + 0,          // 0:  UX_A → extra beam
    extraA + 1,          // 1:  UY_A → extra beam
    3 * gidA + 0,        // 2:  UZ_A → MERGED slab UZ
    3 * gidA + 1,        // 3:  RX_A → MERGED slab RX
    3 * gidA + 2,        // 4:  RY_A → MERGED slab RY
    extraA + 2,          // 5:  RZ_A → extra beam
    extraB + 0,          // 6:  UX_B → extra beam
    extraB + 1,          // 7:  UY_B → extra beam
    3 * gidB + 0,        // 8:  UZ_B → MERGED slab UZ
    3 * gidB + 1,        // 9:  RX_B → MERGED slab RX
    3 * gidB + 2,        // 10: RY_B → MERGED slab RY
    extraB + 2,          // 11: RZ_B → extra beam
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main solver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble and solve the Phase 10 CONNECTED MULTI-SLAB FEM system.
 *
 * All slabs share ONE global stiffness matrix — no per-slab isolation.
 * Nodes at slab boundaries have continuous displacements and rotations.
 *
 * @param slabs       All slabs (mm coords)
 * @param beams       All beams (mm coords)
 * @param columns     All columns (mm coords)
 * @param slabProps   Shared slab properties
 * @param mat         Material properties
 * @param q_Nmm2      Surface pressure (N/mm²)
 * @param meshDensity Mesh divisions per metre (default 2)
 */
export function solveConnectedSlabs(
  slabs:        Slab[],
  beams:        Beam[],
  columns:      Column[],
  slabProps:    SlabProps,
  mat:          MatProps,
  q_Nmm2:       number,
  meshDensity:  number = 2,
): MultiSlabResult {

  const t0 = Date.now();

  if (slabs.length === 0) {
    throw new Error('[Phase10] No slabs provided.');
  }

  // ── 1. Shared multi-slab mesh ──────────────────────────────────────────────
  const multiMesh    = meshMultipleSlabs(slabs, beams, columns, meshDensity);
  const { slabMeshes, registry } = multiMesh;
  const nGlobal  = registry.size;
  const nSlabDOF = nGlobal * 3;

  console.log(
    `[Phase10] ${slabs.length} slabs, ${nGlobal} global nodes ` +
    `(${multiMesh.beforeCounts.reduce((a, b) => a + b, 0) - nGlobal} shared boundary nodes)`,
  );

  // ── 2. Classify global nodes ───────────────────────────────────────────────
  interface GMeta { x: number; y: number; atColumn: boolean; }
  const gmeta: GMeta[] = Array.from({ length: nGlobal }, () => ({
    x: 0, y: 0, atColumn: false,
  }));

  for (const mesh of slabMeshes) {
    for (const nd of mesh.nodes) {
      const m = gmeta[nd.globalId];
      m.x = nd.x;
      m.y = nd.y;
      if (nd.atColumn) m.atColumn = true;
    }
  }

  // ── 3. Identify beam nodes (by globalId) ───────────────────────────────────
  const beamGlobalIds = new Set<number>();

  for (const beam of beams) {
    const Lbeam = Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1);
    if (Lbeam < 1e-6) continue;
    for (const bn of collectConnectedBeamNodes(slabMeshes, beam, Lbeam)) {
      beamGlobalIds.add(bn.globalId);
    }
  }

  const beamBlockMap = new Map<number, number>();
  let beamBlockIdx = 0;
  for (const gid of beamGlobalIds) beamBlockMap.set(gid, beamBlockIdx++);

  const nSharedNodes  = beamBlockIdx;
  const nExtraBeamDOF = nSharedNodes * 3;
  const nTotalDOF     = nSlabDOF + nExtraBeamDOF;
  const nPhase7Equiv  = nSlabDOF + nSharedNodes * 6;
  const dofReduction  = nPhase7Equiv - nTotalDOF;
  const dofRedPct     = nPhase7Equiv > 0 ? dofReduction / nPhase7Equiv * 100 : 0;

  console.log(
    `[Phase10] DOF layout: slab=${nSlabDOF}  beamExtra=${nExtraBeamDOF}  total=${nTotalDOF}`,
  );

  // ── 4. Allocate K and F ────────────────────────────────────────────────────
  const K_full = new Array(nTotalDOF * nTotalDOF).fill(0);
  const F_full = new Array(nTotalDOF).fill(0);

  // ── 5. Assemble slab elements (all slabs into one K) ──────────────────────
  let totalSlabElems = 0;

  for (let si = 0; si < slabMeshes.length; si++) {
    const mesh = slabMeshes[si];

    for (const elem of mesh.elements) {
      const ke = elementStiffness(elem, mesh.nodes, slabProps, mat);
      const fe = elementLoadVector(elem, mesh.nodes, q_Nmm2);

      // Map local nodeIds → global DOFs via globalId
      const gDOF: number[] = [];
      for (const localNid of elem.nodeIds) {
        const gid = mesh.nodes[localNid].globalId;
        gDOF.push(3 * gid, 3 * gid + 1, 3 * gid + 2);
      }

      for (let i = 0; i < 12; i++) {
        const gi = gDOF[i];
        F_full[gi] += fe[i];
        for (let j = 0; j < 12; j++) {
          K_full[gi * nTotalDOF + gDOF[j]] += ke[i * 12 + j];
        }
      }
      totalSlabElems++;
    }

    console.log(
      `[Phase10] Slab ${slabs[si].id}: assembled ${mesh.elements.length} elements`,
    );
  }

  // ── 6. Assemble beam elements (ONCE per beam, all slabs considered) ────────
  for (const beam of beams) {
    const dx    = beam.x2 - beam.x1;
    const dy    = beam.y2 - beam.y1;
    const Lbeam = Math.hypot(dx, dy);
    if (Lbeam < 1e-6) continue;

    const cosA = dx / Lbeam;
    const sinA = dy / Lbeam;

    const beamNodes = collectConnectedBeamNodes(slabMeshes, beam, Lbeam);
    if (beamNodes.length < 2) continue;

    for (let ei = 0; ei < beamNodes.length - 1; ei++) {
      const nA = beamNodes[ei];
      const nB = beamNodes[ei + 1];

      const jA = beamBlockMap.get(nA.globalId);
      const jB = beamBlockMap.get(nB.globalId);
      if (jA === undefined || jB === undefined) continue;

      const Lelem = Math.hypot(nB.x - nA.x, nB.y - nA.y);
      if (Lelem < 1e-6) continue;

      const sec   = sectionFromBeam(beam.b, beam.h, Lelem, mat.fc);
      const K_loc = buildLocalStiffness(sec);
      const T     = buildTransformationMatrix(cosA, sinA);
      const K_glo = globalStiffness(K_loc, T);

      const elemDOF = p10BeamElemDOFs(
        nA.globalId, jA,
        nB.globalId, jB,
        nSlabDOF,
      );

      for (let i = 0; i < 12; i++) {
        const gi = elemDOF[i];
        for (let j = 0; j < 12; j++) {
          K_full[gi * nTotalDOF + elemDOF[j]] += K_glo[i * 12 + j];
        }
      }
    }
  }

  // ── 7. Boundary conditions ─────────────────────────────────────────────────
  const fixedDOFs = new Set<number>();

  // Slab block: fix columns and non-beam boundary nodes
  for (const mesh of slabMeshes) {
    for (const nd of mesh.nodes) {
      const isRigidBC = nd.atColumn || (nd.isFixed && nd.beamId === null);
      if (isRigidBC) {
        const gid = nd.globalId;
        fixedDOFs.add(3 * gid);
        fixedDOFs.add(3 * gid + 1);
        fixedDOFs.add(3 * gid + 2);
      }
    }
  }

  // Extra beam DOFs at column positions
  for (const [gid, jIdx] of beamBlockMap) {
    if (gmeta[gid].atColumn) {
      const off = nSlabDOF + 3 * jIdx;
      fixedDOFs.add(off);
      fixedDOFs.add(off + 1);
      fixedDOFs.add(off + 2);
    }
  }

  // Zero-diagonal orphan DOFs
  for (let i = nSlabDOF; i < nTotalDOF; i++) {
    if (Math.abs(K_full[i * nTotalDOF + i]) < 1e-10) fixedDOFs.add(i);
  }

  const freeDOFs: number[] = [];
  for (let i = 0; i < nTotalDOF; i++) {
    if (!fixedDOFs.has(i)) freeDOFs.push(i);
  }
  const nFree = freeDOFs.length;

  console.log(
    `[Phase10] Fixed=${fixedDOFs.size}  Free=${nFree}`,
  );

  // ── 8. Solve reduced system ────────────────────────────────────────────────
  const K_ff = new Array(nFree * nFree).fill(0);
  const F_f  = new Array(nFree).fill(0);

  for (let i = 0; i < nFree; i++) {
    const gi = freeDOFs[i];
    F_f[i]   = F_full[gi];
    for (let j = 0; j < nFree; j++) {
      K_ff[i * nFree + j] = K_full[gi * nTotalDOF + freeDOFs[j]];
    }
  }

  const solveResult  = solve(K_ff.slice(), F_f.slice());
  const solveTime_ms = Date.now() - t0;

  if (!solveResult.converged) {
    console.warn(
      `[Phase10] Solver residual=${solveResult.maxResidual.toExponential(3)}`,
    );
  }

  const d_full = new Array(nTotalDOF).fill(0);
  for (let i = 0; i < nFree; i++) {
    d_full[freeDOFs[i]] = solveResult.d[i];
  }

  // ── 9. Equilibrium check ───────────────────────────────────────────────────
  let totalApplied_N = 0;
  for (const slab of slabs) {
    totalApplied_N += q_Nmm2 * Math.abs(slab.x2 - slab.x1) * Math.abs(slab.y2 - slab.y1);
  }
  const totalApplied_kN = totalApplied_N * 1e-3;

  let totalReaction_N = 0;
  for (const dof of fixedDOFs) {
    if (dof < nSlabDOF && dof % 3 === 0) {
      let r = -F_full[dof];
      for (let j = 0; j < nTotalDOF; j++) r += K_full[dof * nTotalDOF + j] * d_full[j];
      totalReaction_N += r;
    }
  }
  const totalReactions_kN = Math.abs(totalReaction_N * 1e-3);
  const errorPct = totalApplied_kN > 1e-6
    ? Math.abs(totalApplied_kN - totalReactions_kN) / totalApplied_kN * 100
    : 0;
  const eqPassed = errorPct < 2.0;

  console.log(
    `[Phase10] Equilibrium: Applied=${totalApplied_kN.toFixed(2)} kN  ` +
    `Reactions=${totalReactions_kN.toFixed(2)} kN  Error=${errorPct.toFixed(3)}%  ` +
    (eqPassed ? '✓ PASSED' : '✗ FAILED'),
  );

  // ── 10. Per-slab deflection results ───────────────────────────────────────
  const perSlabResults: PerSlabResult[]         = [];
  const slabMaxDeflections: Record<string, number> = {};

  for (let si = 0; si < slabMeshes.length; si++) {
    const mesh   = slabMeshes[si];
    const slabId = slabs[si].id;
    let maxDeflMm = 0;
    const seen    = new Set<number>();
    const globalNodeIds: number[] = [];

    for (const nd of mesh.nodes) {
      const gid = nd.globalId;
      const uz  = Math.abs(d_full[3 * gid]);
      if (uz > maxDeflMm) maxDeflMm = uz;
      if (!seen.has(gid)) { seen.add(gid); globalNodeIds.push(gid); }
    }

    perSlabResults.push({ slabId, maxDeflMm, globalNodeIds });
    slabMaxDeflections[slabId] = maxDeflMm;
  }

  const globalMaxDefl = Math.max(...perSlabResults.map(r => r.maxDeflMm), 0);

  // ── 11. Extract beam results ───────────────────────────────────────────────
  const beamResults: CoupledBeamResult[] = [];

  for (const beam of beams) {
    const dx    = beam.x2 - beam.x1;
    const dy    = beam.y2 - beam.y1;
    const Lbeam = Math.hypot(dx, dy);
    if (Lbeam < 1e-6) continue;

    const cosA = dx / Lbeam;
    const sinA = dy / Lbeam;
    const T    = buildTransformationMatrix(cosA, sinA);

    const beamNodes = collectConnectedBeamNodes(slabMeshes, beam, Lbeam);
    if (beamNodes.length < 2) continue;

    const elementMoments_kNm: number[] = [];
    const elementShears_kN:   number[] = [];
    let maxMoment_kNm = 0;
    let maxShear_kN   = 0;

    let firstForces: number[] | null = null;
    let lastForces:  number[] | null = null;

    for (let ei = 0; ei < beamNodes.length - 1; ei++) {
      const nA = beamNodes[ei];
      const nB = beamNodes[ei + 1];

      const jA = beamBlockMap.get(nA.globalId);
      const jB = beamBlockMap.get(nB.globalId);
      if (jA === undefined || jB === undefined) continue;

      const Lelem = Math.hypot(nB.x - nA.x, nB.y - nA.y);
      if (Lelem < 1e-6) continue;

      const sec   = sectionFromBeam(beam.b, beam.h, Lelem, mat.fc);
      const K_loc = buildLocalStiffness(sec);

      const elemDOF    = p10BeamElemDOFs(nA.globalId, jA, nB.globalId, jB, nSlabDOF);
      const d12_global = elemDOF.map(gi => d_full[gi]);
      const forces     = elementLocalForces(d12_global, K_loc, T);
      // forces[0..5]  = N1, Vy1, Vz1, Mx1, My1, Mz1  at node A (left end)
      // forces[6..11] = N2, Vy2, Vz2, Mx2, My2, Mz2  at node B (right end)
      //
      // Sign convention (McGuire, θy = −∂w/∂x):
      //   My2 at any shared node = −My1 of the next element (equilibrium)
      //   Store My2 (index 10, signed) for a consistent sign-correct moment array.
      //   In McGuire convention:
      //     My2 < 0  at a hogging right-end support → structural hogging (negative)
      //     My2 > 0  at a sagging midspan right-end  → structural sagging (positive)
      //   This matches exactly what adaptFEMResults expects for the Mmid calculation.

      const My2_elem  = forces[10];           // signed moment at right end (N·mm)
      const Vz1_elem  = Math.abs(forces[2]);  // shear at left  end (N)
      const Vz2_elem  = Math.abs(forces[8]);  // shear at right end (N)

      // Moment array: signed My2 per element (matches Phase 8 pattern exactly)
      elementMoments_kNm.push(My2_elem / 1e6);

      // Shear array: both ends, as in Phase 8
      elementShears_kN.push(Vz1_elem / 1e3);
      elementShears_kN.push(Vz2_elem / 1e3);

      // Running maximum (absolute value)
      if (Math.abs(My2_elem) / 1e6 > maxMoment_kNm) maxMoment_kNm = Math.abs(My2_elem) / 1e6;
      if (Vz1_elem / 1e3            > maxShear_kN)   maxShear_kN   = Vz1_elem / 1e3;
      if (Vz2_elem / 1e3            > maxShear_kN)   maxShear_kN   = Vz2_elem / 1e3;

      if (ei === 0)                      firstForces = forces;
      if (ei === beamNodes.length - 2)   lastForces  = forces;
    }

    const endForcesLocal: CoupledBeamEndForces = {
      N1:  firstForces?.[0]  ?? 0,
      Vy1: firstForces?.[1]  ?? 0,
      Vz1: firstForces?.[2]  ?? 0,
      T1:  firstForces?.[3]  ?? 0,
      My1: firstForces?.[4]  ?? 0,
      Mz1: firstForces?.[5]  ?? 0,
      N2:  lastForces?.[6]   ?? 0,
      Vy2: lastForces?.[7]   ?? 0,
      Vz2: lastForces?.[8]   ?? 0,
      T2:  lastForces?.[9]   ?? 0,
      My2: lastForces?.[10]  ?? 0,
      Mz2: lastForces?.[11]  ?? 0,
    };

    beamResults.push({
      beamId: beam.id,
      endForcesLocal,
      maxMoment_kNm,
      maxShear_kN,
      elementMoments_kNm,
      elementShears_kN,
    });
  }

  // ── 12. Assemble final result ─────────────────────────────────────────────
  const slabResults: CoupledSlabResults = {
    displacements:    d_full.slice(0, nSlabDOF),
    maxDeflection_mm: globalMaxDefl,
  };

  const equilibrium: CoupledEquilibrium = {
    totalApplied_kN,
    totalReactions_kN,
    errorPct,
    passed: eqPassed,
  };

  const nBeforeSharing = multiMesh.beforeCounts.reduce((a, b) => a + b, 0);

  const debug: MultiSlabDebugInfo = {
    nSlabs:             slabs.length,
    nSlabElements:      totalSlabElems,
    nSlabNodes:         nGlobal,
    nSlabDOF,
    nSharedNodes,
    nUniqueBeamNodes:   nSharedNodes,
    nExtraBeamDOF,
    nTotalDOF,
    nFreeDOF:           nFree,
    nPhase7EquivDOF:    nPhase7Equiv,
    dofReduction,
    dofReductionPct:    dofRedPct,
    dofSavedBySharing:  nBeforeSharing - nGlobal,
    conditioningNote:   `Phase10: ${slabs.length} slabs in one global system, ${nGlobal} shared nodes`,
    solveTime_ms,
    slabMaxDeflections,
  };

  console.log(
    `[Phase10] Complete in ${solveTime_ms} ms — ` +
    `${beamResults.length} beams, max defl=${globalMaxDefl.toFixed(3)} mm`,
  );

  return { beamResults, slabResults, equilibrium, debug, perSlabResults };
}
