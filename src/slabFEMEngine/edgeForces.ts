/**
 * slabFEMEngine – Edge Force Extraction (Phase 2)
 *
 * Approach: SIGNED NODAL REACTIONS with junction splitting
 * --------------------------------------------------------
 * After solving K·d = F, the force each beam node exerts on the slab equals
 * the nodal reaction at that constrained DOF:
 *
 *   R_i = (K · d_full)_i − F_applied_i        (for fixed DOF i)
 *
 * Sign convention
 * ---------------
 *   R_i < 0  →  support pushes slab UP   (beam provides upward force)
 *              →  slab pushes beam DOWN   →  gravity load on beam
 *   R_i > 0  →  support pulls slab DOWN  (Kirchhoff corner-force effect)
 *              →  slab pulls beam UP     →  negative (tie-down) on beam
 *
 * The distributed load on the beam: w(x_i) = −R_i / tributary_length_i
 *   (−R to convert from "force on slab" → "force on beam" via Newton 3rd)
 *
 * Junction splitting (beam-to-beam connections)
 * ----------------------------------------------
 * Where two beams meet (e.g. at a corner), the junction node is physically
 * shared. Its reaction is split 50 % to each beam.
 * A node is a junction endpoint if its normalised position along the beam
 * (beamPos) is 0 or 1 AND no column sits at that point.
 *
 * For nodes at column positions (`atColumn = true`): the reaction goes to
 * the column and is EXCLUDED from beam load summation.
 *
 * Phase-2 validation
 * ------------------
 * Sum of all beam loads + column reactions = total applied load.
 * Expected equilibrium error < 0.1 % (round-off only).
 */

import type { Beam, SlabMesh } from './types';
import { extractReactions }    from './assembler';

const EP = 1e-3; // tolerance for beamPos endpoint detection

// ─────────────────────────────────────────────────────────────────────────────

export interface BeamNodeReaction {
  nodeId:       number;
  posAlongBeam: number;   // mm from beam start
  tributaryLen: number;   // mm
  /** Signed reaction force on the BEAM (positive = downward load on beam). */
  Fz_N:  number;          // N
  /** Distributed load intensity: Fz_N / tributaryLen  [N/mm = kN/m]. */
  w_kNm: number;
  /**
   * Phase-5 (full moment-consistent transfer).
   * Integrated moment about global X at this node from slab→beam edge traction.
   * Units: N·m  (= kN·mm).
   * Zero for Phase-2 (reaction-based) nodes — backward-compatible.
   */
  Mx_Nm?: number;
  /**
   * Phase-5 (full moment-consistent transfer).
   * Integrated moment about global Y at this node from slab→beam edge traction.
   * Units: N·m  (= kN·mm).
   * Zero for Phase-2 (reaction-based) nodes — backward-compatible.
   */
  My_Nm?: number;
}

export interface BeamEdgeForces {
  beamId:       string;
  reactions:    BeamNodeReaction[];
  /** Sum of Fz_N across all reactions (net downward load on beam in N). */
  totalForce_N: number;
  /**
   * Phase-5: sum of |Mx_Nm| across all reactions (N·m).
   * Zero when moments are not computed (Phase 2 / shear-only mode).
   */
  totalMomentMx_Nm?: number;
  /**
   * Phase-5: sum of |My_Nm| across all reactions (N·m).
   * Zero when moments are not computed (Phase 2 / shear-only mode).
   */
  totalMomentMy_Nm?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns physical span length (mm) from beam geometry. */
function beamSpan(beam: Beam): number {
  if (beam.direction === 'horizontal') {
    return Math.abs(beam.x2 - beam.x1);
  } else {
    return Math.abs(beam.y2 - beam.y1);
  }
}

/** Returns the [start_x, start_y, end_x, end_y] endpoints of the beam (mm). */
function beamEndpoints(beam: Beam): [number, number, number, number] {
  if (beam.direction === 'horizontal') {
    const x1 = Math.min(beam.x1, beam.x2);
    const x2 = Math.max(beam.x1, beam.x2);
    return [x1, beam.y1, x2, beam.y1];
  } else {
    const y1 = Math.min(beam.y1, beam.y2);
    const y2 = Math.max(beam.y1, beam.y2);
    return [beam.x1, y1, beam.x1, y2];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: extract beam loads from solved displacement field
// ─────────────────────────────────────────────────────────────────────────────

export function extractBeamEdgeForces(
  mesh:      SlabMesh,
  K_full:    number[],
  d_full:    number[],
  F_full:    number[],
  fixedDOFs: number[],
  nDOF:      number,
  beams:     Beam[],
): BeamEdgeForces[] {
  // ── Step 1: Get reactions at ALL fixed DOFs ───────────────────────────────
  const allReactions = extractReactions(K_full, d_full, F_full, fixedDOFs, nDOF);

  // Build fast lookup: nodeId → signed reaction at UZ DOF  [N]
  const nodeR = new Map<number, number>();
  for (const node of mesh.nodes) {
    const uzDOF = node.id * 3;
    if (allReactions.has(uzDOF)) {
      nodeR.set(node.id, allReactions.get(uzDOF)!);
    }
  }

  // Build fast lookup: (x,y) → node for junction endpoint search
  const xyToNode = new Map<string, typeof mesh.nodes[0]>();
  for (const node of mesh.nodes) {
    xyToNode.set(coordKey(node.x, node.y), node);
  }

  // ── Step 2: Per-beam assembly ─────────────────────────────────────────────
  const results: BeamEdgeForces[] = [];

  for (const beam of beams) {
    const span_mm = beamSpan(beam);
    if (span_mm < EP) continue;

    const [sx, sy, ex, ey] = beamEndpoints(beam);

    // Collect contribution records: { posAlongBeam, factor, nodeId }
    type Contrib = { pos: number; factor: number; nodeId: number };
    const contribs: Contrib[] = [];

    // ── 2a: Nodes assigned to this beam (beamId === beam.id) ──────────────
    for (const node of mesh.nodes) {
      if (node.beamId !== beam.id) continue;
      if (node.atColumn) continue;          // column → excluded

      const isEndpoint = node.beamPos < EP || node.beamPos > 1 - EP;
      const factor     = isEndpoint ? 0.5 : 1.0;
      const posAlong   = node.beamPos * span_mm;

      contribs.push({ pos: posAlong, factor, nodeId: node.id });
    }

    // ── 2b: Junction nodes at THIS beam's endpoints assigned to other beams ──
    //   These nodes have beamId !== beam.id but sit geometrically at our endpoints.
    for (const [ep_x, ep_y] of [[sx, sy], [ex, ey]] as [number, number][]) {
      const jNode = xyToNode.get(coordKey(ep_x, ep_y));
      if (!jNode)          continue;   // no node at this endpoint (fine)
      if (jNode.atColumn)  continue;   // column node → excluded
      if (jNode.beamId === beam.id) continue;  // already captured in step 2a

      // Determine position along the beam
      const pos = ep_x === sx && ep_y === sy ? 0 : span_mm;
      contribs.push({ pos, factor: 0.5, nodeId: jNode.id });
    }

    if (contribs.length === 0) continue;

    // Sort by position along beam
    contribs.sort((a, b) => a.pos - b.pos);

    // ── 2c: Compute tributary lengths and reactions ────────────────────────
    const reactions: BeamNodeReaction[] = contribs.map((c, idx) => {
      const posL = idx === 0
        ? c.pos : (c.pos + contribs[idx - 1].pos) / 2;
      const posR = idx === contribs.length - 1
        ? c.pos : (c.pos + contribs[idx + 1].pos) / 2;
      const tribLen = posR - posL;

      const R_i   = nodeR.get(c.nodeId) ?? 0;  // N, support force on slab
      // Force on BEAM = -R_i (Newton's 3rd law):
      //   R_i < 0 (upward on slab) → -R_i > 0 (downward load on beam) ✓
      //   R_i > 0 (corner tension) → -R_i < 0 (upward pull on beam)
      const Fz_N  = -R_i * c.factor;            // N, positive = downward on beam
      const w_kNm = tribLen > EP ? Fz_N / tribLen : 0;  // N/mm = kN/m

      return {
        nodeId:       c.nodeId,
        posAlongBeam: c.pos,
        tributaryLen: tribLen,
        Fz_N,
        w_kNm,
      };
    });

    const totalForce_N = reactions.reduce((s, r) => s + r.Fz_N, 0);

    results.push({ beamId: beam.id, reactions, totalForce_N });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase-2 validation
// ─────────────────────────────────────────────────────────────────────────────

export interface Phase2ValidationResult {
  totalApplied_kN:      number;
  totalBeamForces_kN:   number;
  equilibriumError_pct: number;
  beamBreakdown: Array<{ beamId: string; force_kN: number; nodeCount: number }>;
  passed:  boolean;
  notes:   string[];
}

/**
 * Phase-2 validation.
 *
 * Validates that the sum of beam + junction loads equals the total applied load.
 * Note: if corner-force tie-down effects exist, the signed sum should still
 * equal the applied load (upward reaction − downward tie-down = applied load).
 */
export function validatePhase2(
  edgeForces:      BeamEdgeForces[],
  totalApplied_kN: number,
): Phase2ValidationResult {
  const notes: string[] = [];

  const beamBreakdown = edgeForces.map(ef => ({
    beamId:    ef.beamId,
    force_kN:  ef.totalForce_N * 1e-3,
    nodeCount: ef.reactions.length,
  }));

  const totalBeamForces_kN = beamBreakdown.reduce((s, b) => s + b.force_kN, 0);

  // Equilibrium: sum of all beam loads = total applied (signed reactions cancel correctly)
  const eqErr = totalApplied_kN > 1e-6
    ? Math.abs(totalApplied_kN - totalBeamForces_kN) / totalApplied_kN * 100
    : 0;

  notes.push(
    `[Phase 2] Applied = ${totalApplied_kN.toFixed(2)} kN, ` +
    `Beam loads total = ${totalBeamForces_kN.toFixed(2)} kN, ` +
    `Error = ${eqErr.toFixed(4)} %`,
  );
  beamBreakdown.forEach(b =>
    notes.push(`  Beam ${b.beamId}: ${b.force_kN.toFixed(2)} kN (${b.nodeCount} nodes)`),
  );

  const passed = eqErr < 1.0;
  notes.push(passed ? 'Phase 2 equilibrium PASSED ✓' : `FAIL: error ${eqErr.toFixed(2)} % > 1 %`);

  console.group('[slabFEMEngine] Phase 2 Validation');
  notes.forEach(n => console.log(n));
  console.groupEnd();

  return {
    totalApplied_kN,
    totalBeamForces_kN,
    equilibriumError_pct: eqErr,
    beamBreakdown,
    passed,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function coordKey(x: number, y: number): string {
  return `${Math.round(x * 100)},${Math.round(y * 100)}`;
}
