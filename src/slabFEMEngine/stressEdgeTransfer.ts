/**
 * slabFEMEngine – Phase 4 / Phase 5: Stress-Based Edge Load Transfer
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── Phase 4 (shear-only mode) ───────────────────────────────────────────────
 *
 *   Force traction:
 *     t_z = −(Qx·nx + Qy·ny)          [kN/m]
 *
 *   Nodal forces (1-D Gauss integration along each element edge):
 *     f_edge = ∫ Nᵀ · t_z  dL         [N]
 *
 * ── Phase 5 (full moment-consistent mode — default) ─────────────────────────
 *
 *   In addition to the shear force above, the full moment tensor M is
 *   projected onto the edge normal n to yield distributed moment tractions:
 *
 *     Moment traction vector:  m = M · n
 *       mx_traction = Mx·nx + Mxy·ny     [kNm/m]
 *       my_traction = Mxy·nx + My·ny     [kNm/m]
 *
 *   where the Mindlin-Reissner moment tensor is:
 *       M = [ Mx   Mxy ]
 *           [ Mxy  My  ]
 *
 *   The slab imposes these tractions ON the beam (Newton 3rd, outward normal):
 *       mx_beam = −mx_traction,   my_beam = −my_traction
 *
 *   Nodal moments (same 1-D Gauss integration):
 *       Mx_Nm(node) = ∫ N · mx_beam  dL     [kNm/m × mm = N·m]
 *       My_Nm(node) = ∫ N · my_beam  dL     [N·m]
 *
 * ── Unit algebra ─────────────────────────────────────────────────────────────
 *   Force:   [kN/m] × [mm] = kN × mm/m = kN × 10⁻³ = 1 N        ✓
 *   Moment:  [kNm/m] × [mm] = kNm × 10⁻³ = 1 N·m = 1 kN·mm      ✓
 *
 * ── Stress Smoothing ─────────────────────────────────────────────────────────
 *   Raw Gauss-point stresses are smoothed to nodes by simple nodal averaging:
 *   each node accumulates stresses from surrounding elements and divides by
 *   the contribution count.
 *
 * ── Sign Convention ──────────────────────────────────────────────────────────
 *   t_z > 0  → downward load on beam  (gravity direction, consistent with Phase 2)
 *   t_z = −(Q·n)  because Q·n is the traction the SLAB receives from outside;
 *     if the beam pushes slab UP: Q·n < 0 → −(Q·n) > 0 on beam ✓
 *
 *   mx_beam = −(Mx·nx + Mxy·ny)   (beam receives the reaction of the slab moment)
 *   my_beam = −(Mxy·nx + My·ny)
 *
 * ── Output Format ────────────────────────────────────────────────────────────
 *   Returns BeamEdgeForces[] — same interface as Phase 2.
 *   Phase-5 fields Mx_Nm / My_Nm are populated per BeamNodeReaction.
 *   Phase 3 (beamMapper) remains completely unchanged.
 *
 * ── stressMode parameter ─────────────────────────────────────────────────────
 *   "shear-only"  → Phase 4 behaviour: Fz only, Mx_Nm = My_Nm = 0
 *   "full"        → Phase 5 behaviour: Fz + Mx + My  (default)
 */

import type { SlabMesh, FEMNode, Beam, SlabProps, MatProps } from './types';
import type { BeamEdgeForces, BeamNodeReaction }             from './edgeForces';
import { computeInternalForces }                             from './internalForces';
import type { ElementForceResult }                           from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

interface NodeStress {
  Qx:    number;   // kN/m
  Qy:    number;   // kN/m
  Mx:    number;   // kNm/m
  My:    number;   // kNm/m
  Mxy:   number;   // kNm/m
  count: number;
}

/** Per-position accumulator for a single beam. */
interface PosAccum {
  Fz_N:   number;   // N
  Mx_Nm:  number;   // N·m
  My_Nm:  number;   // N·m
}

const EPS = 1e-3; // mm — coordinate matching tolerance

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 – Stress smoothing: Gauss-point → nodes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For each element:
 *   • 4 Gauss points provide Qx, Qy, Mx, My, Mxy at physical coordinates.
 *   • We assign the ELEMENT AVERAGE to all 4 corner nodes.
 *   • After all elements, each node divides by contribution count.
 *
 * This is Nodal Averaging — the minimum valid smoothing for stable extraction.
 */
function smoothStressesToNodes(
  mesh:         SlabMesh,
  gaussResults: ElementForceResult[],
): Map<number, NodeStress> {
  const acc = new Map<number, NodeStress>();

  const initNode = (): NodeStress => ({ Qx: 0, Qy: 0, Mx: 0, My: 0, Mxy: 0, count: 0 });
  const ensure = (id: number) => {
    if (!acc.has(id)) acc.set(id, initNode());
    return acc.get(id)!;
  };

  const byElem = new Map<number, ElementForceResult[]>();
  for (const r of gaussResults) {
    const list = byElem.get(r.elementId) ?? [];
    list.push(r);
    byElem.set(r.elementId, list);
  }

  for (const elem of mesh.elements) {
    const gpList = byElem.get(elem.id);
    if (!gpList || gpList.length === 0) continue;

    let avgQx = 0, avgQy = 0, avgMx = 0, avgMy = 0, avgMxy = 0;
    for (const gp of gpList) {
      avgQx  += gp.resultants.Qx;
      avgQy  += gp.resultants.Qy;
      avgMx  += gp.resultants.Mx;
      avgMy  += gp.resultants.My;
      avgMxy += gp.resultants.Mxy;
    }
    const n = gpList.length;
    avgQx /= n; avgQy /= n; avgMx /= n; avgMy /= n; avgMxy /= n;

    for (const nodeId of elem.nodeIds) {
      const nd = ensure(nodeId);
      nd.Qx  += avgQx;
      nd.Qy  += avgQy;
      nd.Mx  += avgMx;
      nd.My  += avgMy;
      nd.Mxy += avgMxy;
      nd.count++;
    }
  }

  for (const [, nd] of acc) {
    if (nd.count > 0) {
      nd.Qx  /= nd.count;
      nd.Qy  /= nd.count;
      nd.Mx  /= nd.count;
      nd.My  /= nd.count;
      nd.Mxy /= nd.count;
    }
  }

  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 – Edge detection helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 4 edges per element, CCW node order: n0=(xmin,ymin), n1=(xmax,ymin),
 *   n2=(xmax,ymax), n3=(xmin,ymax)
 *   0 → bottom (n0→n1), outward n = (0, −1)
 *   1 → right  (n1→n2), outward n = (+1, 0)
 *   2 → top    (n2→n3), outward n = (0, +1)
 *   3 → left   (n3→n0), outward n = (−1, 0)
 */
const EDGE_DEF = [
  { iA: 0, iB: 1, nx:  0, ny: -1 },   // bottom
  { iA: 1, iB: 2, nx:  1, ny:  0 },   // right
  { iA: 2, iB: 3, nx:  0, ny:  1 },   // top
  { iA: 3, iB: 0, nx: -1, ny:  0 },   // left
] as const;

function edgeLiesOnBeam(na: FEMNode, nb: FEMNode, beam: Beam): boolean {
  if (beam.direction === 'horizontal') {
    const by = beam.y1;
    return Math.abs(na.y - by) < EPS && Math.abs(nb.y - by) < EPS
        && Math.min(na.x, nb.x) >= Math.min(beam.x1, beam.x2) - EPS
        && Math.max(na.x, nb.x) <= Math.max(beam.x1, beam.x2) + EPS;
  } else {
    const bx = beam.x1;
    return Math.abs(na.x - bx) < EPS && Math.abs(nb.x - bx) < EPS
        && Math.min(na.y, nb.y) >= Math.min(beam.y1, beam.y2) - EPS
        && Math.max(na.y, nb.y) <= Math.max(beam.y1, beam.y2) + EPS;
  }
}

function posAlongBeam(node: FEMNode, beam: Beam): number {
  return beam.direction === 'horizontal'
    ? node.x - Math.min(beam.x1, beam.x2)
    : node.y - Math.min(beam.y1, beam.y2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Steps 3 + 4 – 1-D Gauss integration (generalised)
// ─────────────────────────────────────────────────────────────────────────────

const GP1D = 1 / Math.sqrt(3);
const GAUSS_1D = [
  { xi: -GP1D, w: 1.0 },
  { xi:  GP1D, w: 1.0 },
] as const;

/**
 * General 2-point Gauss integration of a linearly varying quantity q(ξ) = Na*qa + Nb*qb
 * along an edge of length L_mm, using shape functions N1=(1−ξ)/2, N2=(1+ξ)/2.
 *
 * Returns equivalent nodal contributions:
 *   qa_node = ∫ N1 · q(ξ)  (L/2) dξ
 *   qb_node = ∫ N2 · q(ξ)  (L/2) dξ
 *
 * Units: [unit_of_q × mm]  → force [N] when q in kN/m; moment [N·m] when q in kNm/m.
 */
function integrate1D(
  qa: number, qb: number, L_mm: number,
): { qa_node: number; qb_node: number } {
  let qa_node = 0, qb_node = 0;
  const half = L_mm / 2;

  for (const gp of GAUSS_1D) {
    const N1 = (1 - gp.xi) / 2;
    const N2 = (1 + gp.xi) / 2;
    const q  = N1 * qa + N2 * qb;
    qa_node += N1 * q * gp.w * half;
    qb_node += N2 * q * gp.w * half;
  }

  return { qa_node, qb_node };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: Phase-4/5 entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * extractStressEdgeForces
 * ─────────────────────────
 * Phase 4 / Phase 5 slab→beam load transfer.
 *
 * @param mesh       - FEM mesh of the slab
 * @param d_full     - full displacement vector (all DOFs)
 * @param slabProps  - slab cross-section properties
 * @param mat        - material properties
 * @param beams      - beams adjacent to this slab
 * @param stressMode - "shear-only" (Phase 4, Fz only) or "full" (Phase 5, Fz+Mx+My)
 *
 * Returns BeamEdgeForces[] in the same format as Phase 2.
 * When stressMode = "full": Mx_Nm / My_Nm fields are populated on each node.
 * When stressMode = "shear-only": Mx_Nm = My_Nm = 0 (backward-compatible).
 */
export function extractStressEdgeForces(
  mesh:       SlabMesh,
  d_full:     number[],
  slabProps:  SlabProps,
  mat:        MatProps,
  beams:      Beam[],
  stressMode: 'shear-only' | 'full' = 'full',
): BeamEdgeForces[] {

  const includeMoments = stressMode === 'full';

  // ── Step 1: compute Gauss-point stresses ─────────────────────────────────
  const gaussResults = computeInternalForces(mesh, d_full, slabProps, mat);

  // ── Step 1b: smooth to nodes ──────────────────────────────────────────────
  const nodeStress = smoothStressesToNodes(mesh, gaussResults);

  // Fast lookup
  const nodeById = new Map<number, FEMNode>();
  for (const nd of mesh.nodes) nodeById.set(nd.id, nd);

  // ── Step 2–4: accumulate per beam ──────────────────────────────────────────
  // beamId → (posAlongBeam_mm → PosAccum)
  const beamAcc = new Map<string, Map<number, PosAccum>>();

  for (const beam of beams) {
    if (!beam.slabs.includes(mesh.slabId)) continue;
    beamAcc.set(beam.id, new Map<number, PosAccum>());
  }

  if (beamAcc.size === 0) return [];

  for (const elem of mesh.elements) {
    const nodeIds = elem.nodeIds;

    for (const edgeDef of EDGE_DEF) {
      const idA = nodeIds[edgeDef.iA];
      const idB = nodeIds[edgeDef.iB];
      const na  = nodeById.get(idA)!;
      const nb  = nodeById.get(idB)!;

      const L_mm = Math.hypot(nb.x - na.x, nb.y - na.y);
      if (L_mm < EPS) continue;

      const nx = edgeDef.nx;
      const ny = edgeDef.ny;

      for (const [beamId, posMap] of beamAcc) {
        const beam = beams.find(b => b.id === beamId)!;
        if (!edgeLiesOnBeam(na, nb, beam)) continue;

        // ── Smoothed stresses at edge endpoints ────────────────────────────
        const sa = nodeStress.get(idA) ?? { Qx: 0, Qy: 0, Mx: 0, My: 0, Mxy: 0, count: 0 };
        const sb = nodeStress.get(idB) ?? { Qx: 0, Qy: 0, Mx: 0, My: 0, Mxy: 0, count: 0 };

        // ── Shear traction t_z = −(Q · n)  [kN/m] ─────────────────────────
        //   Positive = downward load on beam (consistent with Phase 2 sign).
        const tz_a = -(sa.Qx * nx + sa.Qy * ny);
        const tz_b = -(sb.Qx * nx + sb.Qy * ny);

        // ── Force integration → nodal forces [N] ──────────────────────────
        const { qa_node: fa, qb_node: fb } = integrate1D(tz_a, tz_b, L_mm);

        // ── Moment traction m = −(M · n)  [kNm/m] ─────────────────────────
        //   The slab boundary moment traction (outward normal) is:
        //     m_vec = M · n  where  M = [ Mx   Mxy ]
        //                                [ Mxy  My  ]
        //   The beam receives the reaction: m_beam = −m_vec (Newton 3rd).
        //   mx_beam = −(Mx·nx + Mxy·ny)
        //   my_beam = −(Mxy·nx + My·ny)
        let mxa_kNmm = 0, mxb_kNmm = 0;
        let mya_kNmm = 0, myb_kNmm = 0;

        if (includeMoments) {
          mxa_kNmm = -(sa.Mx * nx + sa.Mxy * ny);
          mxb_kNmm = -(sb.Mx * nx + sb.Mxy * ny);
          mya_kNmm = -(sa.Mxy * nx + sa.My * ny);
          myb_kNmm = -(sb.Mxy * nx + sb.My * ny);
        }

        // ── Moment integration → nodal moments [N·m] ─────────────────────
        //   Unit: [kNm/m × mm] = [kNm × 10⁻³] = [N·m]   ✓
        const { qa_node: mxa_node, qb_node: mxb_node } = integrate1D(mxa_kNmm, mxb_kNmm, L_mm);
        const { qa_node: mya_node, qb_node: myb_node } = integrate1D(mya_kNmm, myb_kNmm, L_mm);

        // ── Accumulate by position along beam ─────────────────────────────
        const posA = posAlongBeam(na, beam);
        const posB = posAlongBeam(nb, beam);

        const accA: PosAccum = posMap.get(posA) ?? { Fz_N: 0, Mx_Nm: 0, My_Nm: 0 };
        accA.Fz_N  += fa;
        accA.Mx_Nm += mxa_node;
        accA.My_Nm += mya_node;
        posMap.set(posA, accA);

        const accB: PosAccum = posMap.get(posB) ?? { Fz_N: 0, Mx_Nm: 0, My_Nm: 0 };
        accB.Fz_N  += fb;
        accB.Mx_Nm += mxb_node;
        accB.My_Nm += myb_node;
        posMap.set(posB, accB);
      }
    }
  }

  // ── Step 5: build BeamEdgeForces[] ────────────────────────────────────────
  const results: BeamEdgeForces[] = [];

  for (const [beamId, posMap] of beamAcc) {
    if (posMap.size === 0) continue;
    const beam = beams.find(b => b.id === beamId)!;

    const span_mm = beam.direction === 'horizontal'
      ? Math.abs(beam.x2 - beam.x1)
      : Math.abs(beam.y2 - beam.y1);

    const reactions: BeamNodeReaction[] = [];

    for (const [pos_mm, accum] of posMap) {
      const tribLen = span_mm / Math.max(posMap.size, 1);
      reactions.push({
        nodeId:       -1,
        posAlongBeam: pos_mm,
        tributaryLen: tribLen,
        Fz_N:         accum.Fz_N,
        w_kNm:        tribLen > EPS ? accum.Fz_N / tribLen : 0,
        Mx_Nm:        accum.Mx_Nm,
        My_Nm:        accum.My_Nm,
      });
    }

    reactions.sort((a, b) => a.posAlongBeam - b.posAlongBeam);

    const totalForce_N    = reactions.reduce((s, r) => s + r.Fz_N, 0);
    const totalMomentMx_Nm = reactions.reduce((s, r) => s + Math.abs(r.Mx_Nm ?? 0), 0);
    const totalMomentMy_Nm = reactions.reduce((s, r) => s + Math.abs(r.My_Nm ?? 0), 0);

    results.push({ beamId, reactions, totalForce_N, totalMomentMx_Nm, totalMomentMy_Nm });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug summary helper
// ─────────────────────────────────────────────────────────────────────────────

export function summariseStressExtraction(
  results:         BeamEdgeForces[],
  totalApplied_kN: number,
  stressMode:      'shear-only' | 'full' = 'full',
): void {
  const totalBeam_kN = results.reduce((s, r) => s + r.totalForce_N * 1e-3, 0);
  const err = totalApplied_kN > 1e-6
    ? Math.abs(totalApplied_kN - totalBeam_kN) / totalApplied_kN * 100
    : 0;

  const tag = stressMode === 'full' ? 'Phase 5 — Full (Fz+Mx+My)' : 'Phase 4 — Shear-Only (Fz)';
  console.group(`[slabFEMEngine] ${tag}`);
  console.log(`  Mode:             ${stressMode}`);
  console.log(`  Applied load:     ${totalApplied_kN.toFixed(2)} kN`);
  console.log(`  Beam loads total: ${totalBeam_kN.toFixed(2)} kN`);
  console.log(`  Equil. error:     ${err.toFixed(2)} %`);

  for (const r of results) {
    const mxTotal_kNm = (r.totalMomentMx_Nm ?? 0) * 1e-3;
    const myTotal_kNm = (r.totalMomentMy_Nm ?? 0) * 1e-3;
    console.log(
      `  Beam ${r.beamId}: ` +
      `Fz=${( r.totalForce_N * 1e-3).toFixed(2)} kN  ` +
      `ΣMx=${mxTotal_kNm.toFixed(3)} kNm  ` +
      `ΣMy=${myTotal_kNm.toFixed(3)} kNm  ` +
      `(${r.reactions.length} nodes)`,
    );
  }

  console.groupEnd();
}
