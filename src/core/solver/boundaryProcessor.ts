/**
 * Boundary Processor
 * ═══════════════════════════════════════════════════════════════
 * Applies supports, restraints, and releases to the global system.
 * Prepares the reduced (free-DOF) system for solving.
 *
 * Method: Penalty method for fixed DOF (large number on diagonal).
 * Alternative: partition method (separate free/fixed DOF).
 * We use partition for better numerical accuracy.
 */

import type { StructuralNode, Restraints } from '../model/types';

const NDOF = 6;

export interface BoundaryResult {
  /** Indices of free (unconstrained) DOF in the global system. */
  freeDOFs: number[];
  /** Indices of fixed (constrained) DOF. */
  fixedDOFs: number[];
  /** Maps global DOF index → position in reduced system. */
  freeMap: Map<number, number>;
}

/**
 * Identify free and fixed DOF from node restraints.
 */
export function processBoundaryConditions(
  nodes: StructuralNode[],
  dofMap: Map<number, number>,
): BoundaryResult {
  const freeDOFs: number[] = [];
  const fixedDOFs: number[] = [];

  const restraintOrder: (keyof Restraints)[] = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];

  for (const node of nodes) {
    const base = dofMap.get(node.id)!;
    for (let d = 0; d < NDOF; d++) {
      const dofIdx = base + d;
      if (node.restraints[restraintOrder[d]]) {
        fixedDOFs.push(dofIdx);
      } else {
        freeDOFs.push(dofIdx);
      }
    }
  }

  // Build free map
  const freeMap = new Map<number, number>();
  freeDOFs.forEach((dof, idx) => freeMap.set(dof, idx));

  return { freeDOFs, fixedDOFs, freeMap };
}

/**
 * Extract reduced stiffness matrix and force vector (free DOF only).
 */
export function extractReducedSystem(
  K: Float64Array,
  F: Float64Array,
  totalDOF: number,
  boundary: BoundaryResult,
): { Kff: Float64Array; Ff: Float64Array } {
  const nFree = boundary.freeDOFs.length;
  const Kff = new Float64Array(nFree * nFree);
  const Ff = new Float64Array(nFree);

  for (let i = 0; i < nFree; i++) {
    const gi = boundary.freeDOFs[i];
    Ff[i] = F[gi];
    for (let j = 0; j < nFree; j++) {
      const gj = boundary.freeDOFs[j];
      Kff[i * nFree + j] = K[gi * totalDOF + gj];
    }
  }

  return { Kff, Ff };
}

/**
 * Expand reduced solution back to full DOF vector.
 * Fixed DOF get zero displacement.
 */
export function expandSolution(
  Uf: Float64Array,
  totalDOF: number,
  boundary: BoundaryResult,
): Float64Array {
  const U = new Float64Array(totalDOF);
  for (let i = 0; i < boundary.freeDOFs.length; i++) {
    U[boundary.freeDOFs[i]] = Uf[i];
  }
  return U;
}
