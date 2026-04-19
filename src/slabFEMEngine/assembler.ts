/**
 * slabFEMEngine – Global Stiffness Assembler (Phase 1)
 *
 * Responsibilities
 * ----------------
 * 1. Collect element stiffness matrices and scatter them into K_global.
 * 2. Assemble the consistent nodal force vector F from surface pressure.
 * 3. Apply boundary conditions (fixed DOFs) by elimination.
 * 4. Return the reduced system (K_ff, F_f, free-DOF list) ready for the solver.
 * 5. After solving, reconstruct the full displacement vector.
 * 6. Extract reaction forces at fixed DOFs (for equilibrium validation).
 *
 * Units throughout: mm, N, rad.
 */

import type { FEMNode, FEMElement, SlabMesh, SlabProps, MatProps } from './types';
import { DOF_PER_NODE }                from './types';
import { elementStiffness, elementLoadVector } from './mindlinShell';

// ─────────────────────────────────────────────────────────────────────────────

export interface AssembledSystem {
  /** Reduced stiffness matrix (free DOFs only), row-major flat. */
  K_ff:     number[];
  /** Reduced force vector (free DOFs only). */
  F_f:      number[];
  /** Global DOF indices that are free (not constrained). */
  freeDOFs: number[];
  /** Global DOF indices that are fixed (constrained to zero). */
  fixedDOFs: number[];
  /** Total number of global DOFs (= nNodes × DOF_PER_NODE). */
  nDOF:     number;
  /** The full (unreduced) force vector, for reaction extraction. */
  F_full:   number[];
  /** The full (unreduced) stiffness matrix (row-major flat). */
  K_full:   number[];
}

export function assembleSystem(
  mesh:      SlabMesh,
  slabProps: SlabProps,
  mat:       MatProps,
  q:         number,   // N/mm²  total surface pressure (dead + live)
): AssembledSystem {
  const nodes = mesh.nodes;
  const nDOF  = nodes.length * DOF_PER_NODE;

  // ── 1. Allocate global K and F ────────────────────────────────────────────
  const K_full  = new Array(nDOF * nDOF).fill(0);
  const F_full  = new Array(nDOF).fill(0);

  // ── 2. Loop elements ──────────────────────────────────────────────────────
  for (const elem of mesh.elements) {
    // Global DOF indices for this element (12 values: 4 nodes × 3 DOF)
    const gDOF = elemGlobalDOFs(elem.nodeIds);

    // Element stiffness and load
    const ke = elementStiffness(elem, nodes, slabProps, mat);    // 12×12 flat
    const fe = elementLoadVector(elem, nodes, q);                  // 12-vector

    // Scatter ke into K_full
    for (let i = 0; i < 12; i++) {
      const gi = gDOF[i];
      F_full[gi] += fe[i];
      for (let j = 0; j < 12; j++) {
        K_full[gi * nDOF + gDOF[j]] += ke[i * 12 + j];
      }
    }
  }

  // ── 3. Identify fixed and free DOFs ──────────────────────────────────────
  const fixedDOFs: number[] = [];
  const freeDOFs:  number[] = [];

  for (let n = 0; n < nodes.length; n++) {
    const base = n * DOF_PER_NODE;
    if (nodes[n].isFixed) {
      // Fix all 3 DOF (UZ, RX, RY)
      fixedDOFs.push(base, base + 1, base + 2);
    } else {
      freeDOFs.push(base, base + 1, base + 2);
    }
  }

  // ── 4. Build reduced system (elimination of fixed DOFs) ──────────────────
  // Since d_fixed = 0: K_ff · d_f = F_f − K_f_fixed · 0 = F_f
  const nFree = freeDOFs.length;
  const K_ff  = new Array(nFree * nFree).fill(0);
  const F_f   = new Array(nFree).fill(0);

  for (let i = 0; i < nFree; i++) {
    const gi = freeDOFs[i];
    F_f[i] = F_full[gi];
    for (let j = 0; j < nFree; j++) {
      K_ff[i * nFree + j] = K_full[gi * nDOF + freeDOFs[j]];
    }
  }

  return { K_ff, F_f, freeDOFs, fixedDOFs, nDOF, F_full, K_full };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstruct the full displacement vector from the solved free-DOF values.
 * Fixed DOFs remain at zero.
 */
export function reconstructDisplacements(
  d_free:   number[],
  freeDOFs: number[],
  nDOF:     number,
): number[] {
  const d_full = new Array(nDOF).fill(0);
  for (let i = 0; i < freeDOFs.length; i++) {
    d_full[freeDOFs[i]] = d_free[i];
  }
  return d_full;
}

/**
 * Extract nodal reaction forces at fixed DOFs.
 * R = K_full · d_full − F_full   (only fixed DOF entries are meaningful)
 */
export function extractReactions(
  K_full:    number[],
  d_full:    number[],
  F_full:    number[],
  fixedDOFs: number[],
  nDOF:      number,
): Map<number, number> {
  const reactions = new Map<number, number>();

  for (const gi of fixedDOFs) {
    let r = -F_full[gi];
    for (let j = 0; j < nDOF; j++) {
      r += K_full[gi * nDOF + j] * d_full[j];
    }
    reactions.set(gi, r);
  }

  return reactions;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Returns the 12 global DOF indices for the element's 4 nodes. */
export function elemGlobalDOFs(nodeIds: readonly number[]): number[] {
  const dofs: number[] = [];
  for (const nid of nodeIds) {
    const base = nid * DOF_PER_NODE;
    dofs.push(base, base + 1, base + 2);
  }
  return dofs;
}

/**
 * Extract the 12-element displacement sub-vector for a single element.
 */
export function elemDisplacements(
  nodeIds: readonly number[],
  d_full:  number[],
): number[] {
  return elemGlobalDOFs(nodeIds).map(gi => d_full[gi]);
}
