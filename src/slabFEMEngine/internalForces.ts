/**
 * slabFEMEngine – Internal Forces (Phase 1)
 *
 * After the system K·d = F is solved, this module computes the stress
 * resultants at every element's 2×2 Gauss points:
 *
 *   Mx  [kN·m/m]  bending moment about Y-axis
 *   My  [kN·m/m]  bending moment about X-axis
 *   Mxy [kN·m/m]  twisting moment
 *   Qx  [kN/m]    transverse shear force in XZ plane
 *   Qy  [kN/m]    transverse shear force in YZ plane
 *
 * Results are also smoothed to nodes by extrapolation from Gauss points
 * (inverse mapping of 2×2 Gauss positions).  The nodal values are used
 * later for the edge-force integration in Phase 2.
 *
 * Phase-1 validation helper is also exported here.
 */

import type {
  SlabMesh, SlabProps, MatProps,
  ElementForceResult, StressResultants,
} from './types';
import { stressResultants, shapeFunctionDerivatives } from './mindlinShell';
import { elemDisplacements } from './assembler';

// ─────────────────────────────────────────────────────────────────────────────

const GP2 = 1 / Math.sqrt(3);
const GAUSS_2X2: Array<{ xi: number; eta: number }> = [
  { xi: -GP2, eta: -GP2 },
  { xi:  GP2, eta: -GP2 },
  { xi:  GP2, eta:  GP2 },
  { xi: -GP2, eta:  GP2 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Public: compute resultants at Gauss points for all elements
// ─────────────────────────────────────────────────────────────────────────────

export function computeInternalForces(
  mesh:      SlabMesh,
  d_full:    number[],
  slabProps: SlabProps,
  mat:       MatProps,
): ElementForceResult[] {
  const results: ElementForceResult[] = [];

  for (const elem of mesh.elements) {
    const d_elem = elemDisplacements(elem.nodeIds, d_full);
    const xs = elem.nodeIds.map(id => mesh.nodes[id].x);
    const ys = elem.nodeIds.map(id => mesh.nodes[id].y);

    for (const gp of GAUSS_2X2) {
      const { N } = shapeFunctionDerivatives(gp.xi, gp.eta, xs, ys);

      // Global coordinates of this Gauss point
      const x = N.reduce((s, ni, i) => s + ni * xs[i], 0);
      const y = N.reduce((s, ni, i) => s + ni * ys[i], 0);

      const resultants = stressResultants(
        gp.xi, gp.eta, elem, mesh.nodes, d_elem, slabProps, mat,
      );

      results.push({ elementId: elem.id, slabId: elem.slabId, x, y, resultants });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: element-centroid resultants (xi=eta=0)
// Used for coarse visualisation and Phase-2 edge integration.
// ─────────────────────────────────────────────────────────────────────────────

export function centroidResultants(
  mesh:      SlabMesh,
  d_full:    number[],
  slabProps: SlabProps,
  mat:       MatProps,
): ElementForceResult[] {
  return mesh.elements.map(elem => {
    const d_elem = elemDisplacements(elem.nodeIds, d_full);
    const xs = elem.nodeIds.map(id => mesh.nodes[id].x);
    const ys = elem.nodeIds.map(id => mesh.nodes[id].y);
    const x  = xs.reduce((s, v) => s + v, 0) / 4;
    const y  = ys.reduce((s, v) => s + v, 0) / 4;

    return {
      elementId:  elem.id,
      slabId:     elem.slabId,
      x, y,
      resultants: stressResultants(0, 0, elem, mesh.nodes, d_elem, slabProps, mat),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: nodal resultants (extrapolated from 2×2 Gauss points)
//
// Uses the inverse of the 2×2 Gauss bilinear map:
//   The Gauss points in element space are at (±1/√3, ±1/√3).
//   The corner nodes are at (±1, ±1).
//   Extrapolation: evaluate the bilinear fit of the 4 GP values at node coords.
// ─────────────────────────────────────────────────────────────────────────────

export interface NodalResultants {
  nodeId: number;
  x: number;
  y: number;
  resultants: StressResultants;
}

export function nodalResultants(
  mesh:      SlabMesh,
  d_full:    number[],
  slabProps: SlabProps,
  mat:       MatProps,
): NodalResultants[] {
  // Accumulate (sum + count) contributions per node, then average
  type Acc = { sum: StressResultants; count: number };
  const acc = new Map<number, Acc>();

  for (const node of mesh.nodes) {
    acc.set(node.id, { sum: zeroResultants(), count: 0 });
  }

  // Extrapolation factor: from Gauss-point space (±1/√3) to node space (±1)
  // The inverse of the Gauss position is ±√3. For a bilinear element:
  //   N1(ξ,η) = (1−ξ)(1−η)/4
  // At node 0 (ξ=1, η=1) evaluated using Gauss value at GP (ξ_g,η_g):
  // The extrapolation matrix maps 4 GP values to 4 nodal values.
  // For the 2×2 Gauss layout (GP positions ξ_g = ±1/√3):
  //   Node ξ coordinates = ±1, GP ξ coordinates = ±1/√3
  //   Factor r = √3 ≈ 1.7321

  const r = Math.sqrt(3);

  // Node positions in extrapolation space: (±1, ±1) → (±r, ±r) in GP space
  // Extrapolation shape fn: N_i(ξ,η) = (1±ξ)(1±η)/4
  // applied at node coords (±r, ±r) relative to GP layout

  // Node order (same as element CCW): BL, BR, TR, TL → (−1,−1),(+1,−1),(+1,+1),(−1,+1)
  const nodeXi  = [-1,  1,  1, -1];
  const nodeEta = [-1, -1,  1,  1];
  // GP order in GAUSS_2X2: BL,BR,TR,TL → (−g,−g),(+g,−g),(+g,+g),(−g,+g)
  const gpXi    = [-1,  1,  1, -1];  // signs only
  const gpEta   = [-1, -1,  1,  1];

  for (const elem of mesh.elements) {
    const d_elem = elemDisplacements(elem.nodeIds, d_full);

    // Compute resultants at the 4 GP positions
    const gpRes: StressResultants[] = GAUSS_2X2.map(gp =>
      stressResultants(gp.xi, gp.eta, elem, mesh.nodes, d_elem, slabProps, mat),
    );

    // Extrapolate to each corner node
    for (let ni = 0; ni < 4; ni++) {
      const xi_n  = nodeXi[ni]  * r;  // node coord in extrapolation space
      const eta_n = nodeEta[ni] * r;

      // Bilinear weights based on GP signs
      const weights = GAUSS_2X2.map((_, gi) =>
        (1 + gpXi[gi] * xi_n) * (1 + gpEta[gi] * eta_n) / 4,
      );

      const extrap = weightedAvgResultants(gpRes, weights);
      const nodeId = elem.nodeIds[ni];
      const a      = acc.get(nodeId)!;
      addResultants(a.sum, extrap);
      a.count++;
    }
  }

  return mesh.nodes.map(node => {
    const a = acc.get(node.id)!;
    const r = divResultants(a.sum, Math.max(1, a.count));
    return { nodeId: node.id, x: node.x, y: node.y, resultants: r };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: find the element closest to a given (x, y) point and return its
// centroid stress resultants. Used for validation.
// ─────────────────────────────────────────────────────────────────────────────

export function resultantsAtPoint(
  x: number, y: number,
  mesh:      SlabMesh,
  d_full:    number[],
  slabProps: SlabProps,
  mat:       MatProps,
): StressResultants {
  let bestElem = mesh.elements[0];
  let bestDist = Infinity;

  for (const elem of mesh.elements) {
    const cx = elem.nodeIds.reduce((s, id) => s + mesh.nodes[id].x, 0) / 4;
    const cy = elem.nodeIds.reduce((s, id) => s + mesh.nodes[id].y, 0) / 4;
    const d  = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bestDist) { bestDist = d; bestElem = elem; }
  }

  const d_elem = elemDisplacements(bestElem.nodeIds, d_full);
  return stressResultants(0, 0, bestElem, mesh.nodes, d_elem, slabProps, mat);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function zeroResultants(): StressResultants {
  return { Mx: 0, My: 0, Mxy: 0, Qx: 0, Qy: 0 };
}

function addResultants(a: StressResultants, b: StressResultants): void {
  a.Mx  += b.Mx;  a.My  += b.My;  a.Mxy += b.Mxy;
  a.Qx  += b.Qx;  a.Qy  += b.Qy;
}

function divResultants(a: StressResultants, n: number): StressResultants {
  return { Mx: a.Mx/n, My: a.My/n, Mxy: a.Mxy/n, Qx: a.Qx/n, Qy: a.Qy/n };
}

function weightedAvgResultants(
  rs: StressResultants[],
  ws: number[],
): StressResultants {
  const out = zeroResultants();
  for (let i = 0; i < rs.length; i++) {
    out.Mx  += ws[i] * rs[i].Mx;
    out.My  += ws[i] * rs[i].My;
    out.Mxy += ws[i] * rs[i].Mxy;
    out.Qx  += ws[i] * rs[i].Qx;
    out.Qy  += ws[i] * rs[i].Qy;
  }
  return out;
}
