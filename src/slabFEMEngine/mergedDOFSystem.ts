/**
 * slabFEMEngine – Phase 8: True DOF Merging (Constraint Elimination)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Replaces the Phase 7 penalty-based coupling with TRUE DOF MERGING.
 * This is the formulation used in professional FEM solvers (ETABS, SAP2000).
 *
 * ── Core Idea ─────────────────────────────────────────────────────────────
 *
 * In Phase 7, slab and beam each owned their own DOFs at shared nodes:
 *
 *   Slab side:  DOF_UZ_slab,  DOF_RX_slab,  DOF_RY_slab
 *   Beam side:  DOF_UX_beam,  DOF_UY_beam,  DOF_UZ_beam,
 *               DOF_RX_beam,  DOF_RY_beam,  DOF_RZ_beam
 *
 *   → Compatibility enforced via penalty stiffness: K_p = α·[1 −1; −1 1]
 *   → Penalty introduces ill-conditioning, result-dependence on α, and
 *     artificial stiffness.
 *
 * In Phase 8, at every shared node the slab DOFs ARE the beam DOFs:
 *
 *   UZ_slab_i  ≡  UZ_beam_j   (same global index)
 *   RX_slab_i  ≡  RX_beam_j   (same global index)
 *   RY_slab_i  ≡  RY_beam_j   (same global index)
 *
 *   → No constraint equation needed.
 *   → No penalty term needed.
 *   → System size REDUCED by 3 DOFs per shared node.
 *   → Matrix is better conditioned (no artificial large numbers).
 *
 * ── Global DOF Layout (Phase 8) ───────────────────────────────────────────
 *
 *   Block A — Slab DOFs (unchanged from Phase 7):
 *     [0 … 3·n_slab − 1]
 *     Node i: DOF 3i+0 = UZ_i,  3i+1 = RX_i,  3i+2 = RY_i
 *
 *   Block B — Extra Beam DOFs (per shared node, beam-only):
 *     [3·n_slab … 3·n_slab + 3·n_beam_nodes − 1]
 *     Shared node j (beamBlockIdx = j):
 *       DOF nSlabDOF + 3j+0 = UX_j  (axial/lateral)
 *       DOF nSlabDOF + 3j+1 = UY_j  (lateral/axial)
 *       DOF nSlabDOF + 3j+2 = RZ_j  (in-plane rotation)
 *
 * ── Beam Element DOF Scatter (12 DOFs, local → global) ───────────────────
 *
 *   For element between shared nodes A (slabIdx=siA, beamIdx=jA)
 *                                and B (slabIdx=siB, beamIdx=jB):
 *
 *   Local DOF 0  (u1  = UX_A) → nSlabDOF + 3·jA + 0
 *   Local DOF 1  (v1  = UY_A) → nSlabDOF + 3·jA + 1
 *   Local DOF 2  (w1  = UZ_A) → 3·siA + 0          ← MERGED
 *   Local DOF 3  (θx1 = RX_A) → 3·siA + 1          ← MERGED
 *   Local DOF 4  (θy1 = RY_A) → 3·siA + 2          ← MERGED
 *   Local DOF 5  (θz1 = RZ_A) → nSlabDOF + 3·jA + 2
 *   Local DOF 6  (u2  = UX_B) → nSlabDOF + 3·jB + 0
 *   Local DOF 7  (v2  = UY_B) → nSlabDOF + 3·jB + 1
 *   Local DOF 8  (w2  = UZ_B) → 3·siB + 0          ← MERGED
 *   Local DOF 9  (θx2 = RX_B) → 3·siB + 1          ← MERGED
 *   Local DOF 10 (θy2 = RY_B) → 3·siB + 2          ← MERGED
 *   Local DOF 11 (θz2 = RZ_B) → nSlabDOF + 3·jB + 2
 *
 * ── Boundary Conditions ───────────────────────────────────────────────────
 *
 *   Slab fixed nodes (columns):
 *     Fix slab DOFs 3i+0, 3i+1, 3i+2  (UZ, RX, RY auto-fix beam too)
 *   Beam shared-node at column (isFixed = true):
 *     Also fix extra beam DOFs: nSlabDOF+3j+0, nSlabDOF+3j+1, nSlabDOF+3j+2
 *
 * ── Output ───────────────────────────────────────────────────────────────
 *
 *   MergedResult: same beam/slab/equilibrium structure as CoupledResult
 *   but extended debug includes DOF reduction metrics and Phase-7 comparison.
 *
 * Units: mm, N, MPa, rad throughout.  Output forces in kN, kN·m.
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
import type { CoupledBeamEndForces, CoupledBeamResult, CoupledSlabResults, CoupledEquilibrium } from './coupledSystem';

// ─────────────────────────────────────────────────────────────────────────────
// Output types
// ─────────────────────────────────────────────────────────────────────────────

export interface MergedDebugInfo {
  /** Total slab nodes in mesh */
  nSlabNodes:            number;
  /** Total slab DOFs = 3 × nSlabNodes */
  nSlabDOF:              number;
  /** Number of shared (slab-on-beam) nodes */
  nSharedNodes:          number;
  /** Extra beam DOFs added = 3 × nSharedNodes (UX, UY, RZ only) */
  nExtraBeamDOF:         number;
  /** Total DOF count in Phase 8 = nSlabDOF + nExtraBeamDOF */
  nTotalDOF:             number;
  /** Number of free DOFs after applying BCs */
  nFreeDOF:              number;
  /** Phase 7 equivalent DOF count for comparison (nSlabDOF + 6·nSharedNodes) */
  nPhase7EquivDOF:       number;
  /** DOF reduction vs Phase 7 equivalent = 3 × nSharedNodes */
  dofReduction:          number;
  /** DOF reduction as a percentage of Phase 7 equivalent */
  dofReductionPct:       number;
  /** Estimated condition number ratio improvement (heuristic) */
  conditioningNote:      string;
  /** Phase 8 solve time (ms) */
  solveTime_ms:          number;
}

export interface MergedResult {
  beamResults:  CoupledBeamResult[];
  slabResults:  CoupledSlabResults;
  equilibrium:  CoupledEquilibrium;
  debug:        MergedDebugInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: shared-node registry (same as Phase 7 but semantics differ)
// ─────────────────────────────────────────────────────────────────────────────

interface SharedNodeEntry {
  /** Index of this node in the slab mesh nodes array */
  slabNodeIdx:  number;
  /** Index in the extra-beam-DOF block (each entry → 3 extra DOFs: UX, UY, RZ) */
  beamBlockIdx: number;
  /** True if this node sits at a column (all BCs applied) */
  isFixed:      boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometric beam-node collector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect all slab mesh nodes that lie on a given beam, using geometric
 * proximity rather than the node.beamId field.
 *
 * WHY: corner nodes (shared by two perpendicular beams) carry beamId of only
 * the FIRST beam that claimed them during mesh classification.  Using beamId
 * alone causes the second beam to miss its two corner nodes (19 instead of 21
 * for a 5 × 5 m slab at density 4), breaking symmetry and producing wildly
 * incorrect end moments (−40 kN·m where <10 kN·m is expected).
 *
 * The geometric check:
 *   t = ((P − A) · (B − A)) / |B − A|²    parametric projection onto beam
 *   d = |P − (A + t·(B − A))|             perpendicular distance
 *   On beam  ⟺  d < EPS_MM  and  0 ≤ t ≤ 1.
 *
 * Returns nodes sorted by parameter t (start → end of beam).
 */
const EPS_GEOM_MM = 1.0;   // 1 mm tolerance (grid spacing is 50–250 mm)

function collectBeamNodes(
  nodes:  import('./types').FEMNode[],
  beam:   import('./types').Beam,
  Lbeam:  number,
): { slabNodeIdx: number; beamPos: number }[] {

  if (Lbeam < 1e-6) return [];

  const ax = beam.x1;
  const ay = beam.y1;
  const dx = beam.x2 - beam.x1;
  const dy = beam.y2 - beam.y1;
  const L2 = Lbeam * Lbeam;

  const result: { slabNodeIdx: number; beamPos: number }[] = [];

  for (let ni = 0; ni < nodes.length; ni++) {
    const nd = nodes[ni];
    // Parametric projection: t in [0, 1] for points on the segment
    const t = ((nd.x - ax) * dx + (nd.y - ay) * dy) / L2;
    if (t < -EPS_GEOM_MM / Lbeam || t > 1 + EPS_GEOM_MM / Lbeam) continue;
    // Perpendicular distance from beam axis
    const px = ax + t * dx;
    const py = ay + t * dy;
    const dist = Math.hypot(nd.x - px, nd.y - py);
    if (dist < EPS_GEOM_MM) {
      result.push({ slabNodeIdx: ni, beamPos: Math.max(0, Math.min(1, t)) });
    }
  }

  result.sort((a, b) => a.beamPos - b.beamPos);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOF scatter helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the 12-element global DOF index array for one beam element under
 * Phase 8 merged DOF layout.
 *
 * @param siA       Slab node index for beam-node A
 * @param jA        beamBlockIdx for beam-node A
 * @param siB       Slab node index for beam-node B
 * @param jB        beamBlockIdx for beam-node B
 * @param nSlabDOF  = 3 × nSlabNodes (offset of extra beam block)
 * @returns 12-element array mapping local beam DOF → global merged DOF
 */
function beamElemGlobalDOFs(
  siA: number, jA: number,
  siB: number, jB: number,
  nSlabDOF: number,
): number[] {
  const extraA = nSlabDOF + 3 * jA;
  const extraB = nSlabDOF + 3 * jB;
  return [
    extraA + 0,       // 0: UX_A  → extra beam DOF
    extraA + 1,       // 1: UY_A  → extra beam DOF
    3 * siA + 0,      // 2: UZ_A  → MERGED with slab UZ
    3 * siA + 1,      // 3: RX_A  → MERGED with slab RX
    3 * siA + 2,      // 4: RY_A  → MERGED with slab RY
    extraA + 2,       // 5: RZ_A  → extra beam DOF
    extraB + 0,       // 6: UX_B  → extra beam DOF
    extraB + 1,       // 7: UY_B  → extra beam DOF
    3 * siB + 0,      // 8: UZ_B  → MERGED with slab UZ
    3 * siB + 1,      // 9: RX_B  → MERGED with slab RX
    3 * siB + 2,      // 10: RY_B → MERGED with slab RY
    extraB + 2,       // 11: RZ_B → extra beam DOF
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Phase 8 solver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble and solve the Phase 8 merged-DOF beam–slab FEM system.
 *
 * DOFs at shared (slab-on-beam) nodes are PHYSICALLY MERGED — the slab's
 * UZ, RX, RY become the beam's UZ, RX, RY at those nodes.  No penalty
 * stiffness is added.  The resulting system has fewer DOFs and better
 * numerical conditioning than Phase 7.
 *
 * @param slab        Single slab object (mm coords)
 * @param beams       All beams (mm coords)
 * @param columns     All columns (mm coords)
 * @param slabProps   Slab thickness and loading parameters
 * @param mat         Material properties
 * @param q_Nmm2      Applied surface pressure (N/mm²)
 * @param meshDensity Mesh divisions per metre (default 2)
 * @returns MergedResult with beam forces, slab deflections, equilibrium, and debug metrics
 */
export function solveMergedDOFSystem(
  slab:         Slab,
  beams:        Beam[],
  columns:      Column[],
  slabProps:    SlabProps,
  mat:          MatProps,
  q_Nmm2:       number,
  meshDensity:  number = 2,
): MergedResult {

  const t0 = Date.now();

  // ── 1. Generate slab mesh ─────────────────────────────────────────────────
  const mesh     = meshSlab(slab, beams, columns, meshDensity);
  const nodes    = mesh.nodes;
  const elements = mesh.elements;
  const nSlab    = nodes.length;
  const nSlabDOF = nSlab * 3;   // Block A: [UZ, RX, RY] per slab node

  console.log(`[Phase8] Slab mesh: ${nSlab} nodes, ${elements.length} elements`);

  // ── 2. Identify shared nodes (slab nodes lying on any beam) ──────────────
  //    Build registry: slabNodeIdx → SharedNodeEntry
  //    Each shared node adds 3 extra DOFs to Block B (UX, UY, RZ).
  //    UZ, RX, RY are provided by the existing slab Block A DOFs.
  const sharedNodeMap = new Map<number, SharedNodeEntry>();
  let beamBlockIdx = 0;

  for (let ni = 0; ni < nSlab; ni++) {
    const nd = nodes[ni];
    if (nd.beamId !== null && !sharedNodeMap.has(ni)) {
      sharedNodeMap.set(ni, {
        slabNodeIdx:  ni,
        beamBlockIdx: beamBlockIdx++,
        // Phase 8: only fix extra beam DOFs at actual column positions.
        // Regular beam-line nodes are elastic — their stiffness comes from
        // the assembled beam elements, not from a rigid zero-displacement BC.
        isFixed:      nd.atColumn,
      });
    }
  }

  const nSharedNodes  = beamBlockIdx;
  const nExtraBeamDOF = nSharedNodes * 3;  // UX, UY, RZ per shared node
  const nTotalDOF     = nSlabDOF + nExtraBeamDOF;

  // Phase 7 would have used 6 DOFs per shared node → for comparison
  const nPhase7EquivDOF = nSlabDOF + nSharedNodes * 6;
  const dofReduction    = nPhase7EquivDOF - nTotalDOF;   // = 3 × nSharedNodes
  const dofReductionPct = nPhase7EquivDOF > 0
    ? (dofReduction / nPhase7EquivDOF) * 100
    : 0;

  console.log(
    `[Phase8] Shared nodes: ${nSharedNodes}  ` +
    `Extra beam DOF: ${nExtraBeamDOF}  Total DOF: ${nTotalDOF}  ` +
    `(Phase7 equiv: ${nPhase7EquivDOF}, reduction: ${dofReduction} = ${dofReductionPct.toFixed(1)}%)`,
  );

  // ── 3. Allocate global K and F ────────────────────────────────────────────
  const K_full = new Array(nTotalDOF * nTotalDOF).fill(0);
  const F_full = new Array(nTotalDOF).fill(0);

  // ── 4. Assemble slab element stiffness and load (Block A DOFs only) ───────
  for (const elem of elements) {
    const gDOF = elemGlobalDOFs(elem.nodeIds);   // 12 indices in Block A (slab)
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

  // ── 5. Assemble beam element stiffness (merged DOF scatter) ───────────────
  //    NO penalty terms added.  Beam stiffness contributes directly to the
  //    slab DOFs (UZ, RX, RY columns/rows) at shared nodes.

  for (const beam of beams) {
    if (!beam.slabs.includes(slab.id)) continue;

    // Beam direction cosines (computed first so collectBeamNodes can use Lbeam)
    const dx = beam.x2 - beam.x1;
    const dy = beam.y2 - beam.y1;
    const Lbeam = Math.hypot(dx, dy);
    if (Lbeam < 1e-6) continue;
    const cosA = dx / Lbeam;
    const sinA = dy / Lbeam;

    // Collect beam nodes using GEOMETRIC PROXIMITY (not beamId) so that corner
    // nodes shared by two beams appear in BOTH beams' node lists.
    const beamNodes = collectBeamNodes(nodes, beam, Lbeam);
    if (beamNodes.length < 2) continue;

    // Assemble each sub-element between consecutive beam nodes
    for (let ei = 0; ei < beamNodes.length - 1; ei++) {
      const nA = beamNodes[ei];
      const nB = beamNodes[ei + 1];

      const entryA = sharedNodeMap.get(nA.slabNodeIdx);
      const entryB = sharedNodeMap.get(nB.slabNodeIdx);
      if (!entryA || !entryB) continue;

      // Element geometry
      const xA    = nodes[nA.slabNodeIdx].x;
      const yA    = nodes[nA.slabNodeIdx].y;
      const xB    = nodes[nB.slabNodeIdx].x;
      const yB    = nodes[nB.slabNodeIdx].y;
      const Lelem = Math.hypot(xB - xA, yB - yA);
      if (Lelem < 1e-6) continue;

      // Element stiffness (local → global transformation)
      const sec   = sectionFromBeam(beam.b, beam.h, Lelem, mat.fc);
      const K_loc = buildLocalStiffness(sec);
      const T     = buildTransformationMatrix(cosA, sinA);
      const K_glo = globalStiffness(K_loc, T);   // 12×12 global

      // Phase 8 merged DOF indices (12 values)
      const elemDOF = beamElemGlobalDOFs(
        nA.slabNodeIdx, entryA.beamBlockIdx,
        nB.slabNodeIdx, entryB.beamBlockIdx,
        nSlabDOF,
      );

      // Scatter K_glo into K_full — some global DOFs point into the slab block
      for (let i = 0; i < 12; i++) {
        const gi = elemDOF[i];
        for (let j = 0; j < 12; j++) {
          K_full[gi * nTotalDOF + elemDOF[j]] += K_glo[i * 12 + j];
        }
      }
    }
  }

  // ── 6. Build fixed DOF set ────────────────────────────────────────────────

  const fixedDOFs = new Set<number>();

  // a) Slab node BCs for Phase 8:
  //    - Column nodes (atColumn) → fully fixed (UZ, RX, RY = 0): true structural supports.
  //    - Non-beam boundary nodes (onBoundary but not on a beam) → also fixed
  //      (free slab edge without a beam is pinned against vertical displacement).
  //    - Beam-line nodes that are NOT at a column → NOT fixed here.
  //      Their stiffness contribution comes from the assembled beam elements (step 5).
  //      Forcing them to zero would zero out all beam forces (the Phase 8 zero-value bug).
  for (let ni = 0; ni < nSlab; ni++) {
    const nd = nodes[ni];
    const isRigidBC = nd.atColumn || (nd.isFixed && nd.beamId === null);
    if (isRigidBC) {
      fixedDOFs.add(ni * 3 + 0);   // UZ
      fixedDOFs.add(ni * 3 + 1);   // RX
      fixedDOFs.add(ni * 3 + 2);   // RY
    }
  }

  // b) Extra beam DOFs (UX, UY, RZ) at column-coincident shared nodes
  for (const [, entry] of sharedNodeMap) {
    if (entry.isFixed) {
      const off = nSlabDOF + entry.beamBlockIdx * 3;
      fixedDOFs.add(off + 0);  // UX
      fixedDOFs.add(off + 1);  // UY
      fixedDOFs.add(off + 2);  // RZ
    }
  }

  // c) Isolate any extra-beam DOFs with zero diagonal (no element connected)
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
    `[Phase8] Fixed DOF: ${fixedDOFs.size}  Free DOF: ${nFree}  ` +
    `(Slab fixed: ${[...fixedDOFs].filter(d => d < nSlabDOF).length}, ` +
    `Extra-beam fixed: ${[...fixedDOFs].filter(d => d >= nSlabDOF).length})`,
  );

  // ── 7. Build and solve reduced system K_ff · d = F_f ─────────────────────
  const K_ff = new Array(nFree * nFree).fill(0);
  const F_f  = new Array(nFree).fill(0);

  for (let i = 0; i < nFree; i++) {
    const gi = freeDOFs[i];
    F_f[i] = F_full[gi];
    for (let j = 0; j < nFree; j++) {
      K_ff[i * nFree + j] = K_full[gi * nTotalDOF + freeDOFs[j]];
    }
  }

  const solveResult = solve(K_ff.slice(), F_f.slice());
  const solveTime_ms = Date.now() - t0;

  if (!solveResult.converged) {
    console.warn(
      `[Phase8] Solver residual = ${solveResult.maxResidual.toExponential(3)} — ` +
      'check boundary conditions.',
    );
  }

  // Reconstruct full displacement vector
  const d_full = new Array(nTotalDOF).fill(0);
  for (let i = 0; i < nFree; i++) {
    d_full[freeDOFs[i]] = solveResult.d[i];
  }

  // ── 8. Equilibrium check ──────────────────────────────────────────────────
  const slabArea_mm2     = Math.abs(slab.x2 - slab.x1) * Math.abs(slab.y2 - slab.y1);
  const totalApplied_N   = q_Nmm2 * slabArea_mm2;
  const totalApplied_kN  = totalApplied_N * 1e-3;

  // Reactions at slab-fixed vertical DOFs (UZ = index 3i+0)
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
    `[Phase8] Equilibrium: Applied=${totalApplied_kN.toFixed(2)} kN  ` +
    `Reactions=${totalReactions_kN.toFixed(2)} kN  Error=${eqErr.toFixed(3)}%  ` +
    (eqPassed ? '✓ PASSED' : '✗ FAILED'),
  );

  // ── 9. Extract slab results ───────────────────────────────────────────────
  const slabDisp = d_full.slice(0, nSlabDOF);
  let maxDefMm = 0;
  for (let i = 0; i < nSlab; i++) {
    const uz = Math.abs(slabDisp[i * 3]);
    if (uz > maxDefMm) maxDefMm = uz;
  }

  // ── 10. Extract beam results ───────────────────────────────────────────────
  //    Force recovery: reconstruct the 12-DOF global displacement vector
  //    per beam element from the merged d_full, then apply T and K_local.
  const beamResults: CoupledBeamResult[] = [];

  for (const beam of beams) {
    if (!beam.slabs.includes(slab.id)) continue;

    const dx    = beam.x2 - beam.x1;
    const dy    = beam.y2 - beam.y1;
    const Lbeam = Math.hypot(dx, dy);
    if (Lbeam < 1e-6) continue;
    const cosA = dx / Lbeam;
    const sinA = dy / Lbeam;

    // Use geometric proximity (same fix as step 5) to capture corner nodes
    const beamNodes = collectBeamNodes(nodes, beam, Lbeam);
    if (beamNodes.length < 2) continue;

    const momentList: number[] = [];
    const shearList:  number[] = [];
    let firstEndForces: CoupledBeamEndForces | null = null;
    let lastEndForces:  CoupledBeamEndForces | null = null;

    for (let ei = 0; ei < beamNodes.length - 1; ei++) {
      const nA     = beamNodes[ei];
      const nB     = beamNodes[ei + 1];
      const entryA = sharedNodeMap.get(nA.slabNodeIdx);
      const entryB = sharedNodeMap.get(nB.slabNodeIdx);
      if (!entryA || !entryB) continue;

      const xA    = nodes[nA.slabNodeIdx].x;
      const yA    = nodes[nA.slabNodeIdx].y;
      const xB    = nodes[nB.slabNodeIdx].x;
      const yB    = nodes[nB.slabNodeIdx].y;
      const Lelem = Math.hypot(xB - xA, yB - yA);
      if (Lelem < 1e-6) continue;

      const sec   = sectionFromBeam(beam.b, beam.h, Lelem, mat.fc);
      const K_loc = buildLocalStiffness(sec);
      const T     = buildTransformationMatrix(cosA, sinA);

      // Reconstruct 12 global displacements for this element using merged layout
      const elemDOF = beamElemGlobalDOFs(
        nA.slabNodeIdx, entryA.beamBlockIdx,
        nB.slabNodeIdx, entryB.beamBlockIdx,
        nSlabDOF,
      );

      const d12: number[] = elemDOF.map(g => d_full[g]);

      // Compute local forces
      const f12 = elementLocalForces(d12, K_loc, T);

      // Structural moment convention:
      //   My2 of element i  = structural moment at the RIGHT node of element i
      //   My1 of element i  = structural moment at LEFT node, but with OPPOSITE sign
      //   (at any shared node: My2(i) = -My1(i+1) for equilibrium)
      // → Store only My2 per element for a consistent, sign-correct moment array.
      //   The left-support moment is recovered separately via firstEndForces.My1 (negated).
      momentList.push(f12[10] * 1e-6);   // My2: structural moment at element right-node (kN·m, signed)
      shearList.push(Math.abs(f12[2])   * 1e-3);   // Vz1 in kN
      shearList.push(Math.abs(f12[8])   * 1e-3);   // Vz2 in kN

      // Capture left-end forces from the FIRST element only
      if (ei === 0) {
        firstEndForces = {
          N1:  f12[0],  Vy1: f12[1],  Vz1: f12[2],  T1:  f12[3],  My1: f12[4],  Mz1: f12[5],
          N2:  f12[6],  Vy2: f12[7],  Vz2: f12[8],  T2:  f12[9],  My2: f12[10], Mz2: f12[11],
        };
      }
      // Capture right-end forces from the LAST element only
      if (ei === beamNodes.length - 2) {
        lastEndForces = {
          N1:  f12[0],  Vy1: f12[1],  Vz1: f12[2],  T1:  f12[3],  My1: f12[4],  Mz1: f12[5],
          N2:  f12[6],  Vy2: f12[7],  Vz2: f12[8],  T2:  f12[9],  My2: f12[10], Mz2: f12[11],
        };
      }
    }

    // Envelope: peak absolute moment/shear across all elements
    const maxMoment = momentList.length > 0 ? Math.max(...momentList.map(Math.abs)) : 0;
    const maxShear  = shearList.length > 0  ? Math.max(...shearList)                : 0;

    // Combined end forces:
    //   My1 / Vz1 come from the FIRST element (left-end support)
    //   My2 / Vz2 come from the LAST  element (right-end support)
    const combinedEnd: CoupledBeamEndForces = {
      N1:  firstEndForces?.N1  ?? 0,
      Vy1: firstEndForces?.Vy1 ?? 0,
      Vz1: firstEndForces?.Vz1 ?? 0,
      T1:  firstEndForces?.T1  ?? 0,
      My1: firstEndForces?.My1 ?? 0,   // LEFT support moment (signed, hogging < 0)
      Mz1: firstEndForces?.Mz1 ?? 0,
      N2:  lastEndForces?.N2   ?? 0,
      Vy2: lastEndForces?.Vy2  ?? 0,
      Vz2: lastEndForces?.Vz2  ?? 0,
      T2:  lastEndForces?.T2   ?? 0,
      My2: lastEndForces?.My2  ?? 0,   // RIGHT support moment (signed, hogging < 0)
      Mz2: lastEndForces?.Mz2  ?? 0,
    };

    beamResults.push({
      beamId: beam.id,
      endForcesLocal: combinedEnd,
      maxMoment_kNm:      maxMoment,
      maxShear_kN:        maxShear,
      elementMoments_kNm: momentList,
      elementShears_kN:   shearList,
    });
  }

  // ── 11. Log summary ───────────────────────────────────────────────────────
  console.log(
    `[Phase8] DOF reduction vs Phase7: −${dofReduction} (${dofReductionPct.toFixed(1)}%)  ` +
    `Solve time: ${solveTime_ms} ms`,
  );
  console.log('[Phase8] Beam results summary:');
  for (const br of beamResults) {
    console.log(
      `  ${br.beamId}: maxM = ${br.maxMoment_kNm.toFixed(2)} kN·m  ` +
      `maxV = ${br.maxShear_kN.toFixed(2)} kN`,
    );
  }

  // ── 12. Return result ─────────────────────────────────────────────────────
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
      nSlabNodes:       nSlab,
      nSlabDOF,
      nSharedNodes,
      nExtraBeamDOF,
      nTotalDOF,
      nFreeDOF:         nFree,
      nPhase7EquivDOF,
      dofReduction,
      dofReductionPct,
      conditioningNote:
        `Phase 8 eliminates the ${dofReduction}-DOF overcounting from Phase 7 penalty coupling. ` +
        `No α_p term is added, so max(K_diag) is not artificially inflated. ` +
        `Expected condition number improvement: ~1e4× (equal to Phase 7 penaltyMult).`,
      solveTime_ms,
    },
  };
}
