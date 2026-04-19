/**
 * Coordinate Transformation
 * ═══════════════════════════════════════════════════════════════
 * Builds transformation matrices for frame and shell elements.
 *
 * K_global = T^T × K_local × T
 *
 * For frame elements: 12×12 transformation matrix from local to global.
 * For shell elements: 24×24 transformation (4 nodes × 6 DOF).
 */

import type { StructuralNode } from '../model/types';

/**
 * Build 12×12 transformation matrix for a frame element.
 * Local axes: x = along element, y = perpendicular horizontal, z = up.
 *
 * Returns flat row-major array of length 144.
 */
export function buildFrameTransformation(
  nodeI: StructuralNode,
  nodeJ: StructuralNode,
): number[] {
  const dx = nodeJ.x - nodeI.x;
  const dy = nodeJ.y - nodeI.y;
  const dz = nodeJ.z - nodeI.z;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (L < 1e-10) throw new Error('Zero-length element');

  // Local x-axis: along element
  const lx = [dx / L, dy / L, dz / L];

  // Reference vector for local z
  let refZ = [0, 0, 1];
  // If element is vertical, use different reference
  if (Math.abs(lx[2]) > 0.999) {
    refZ = [1, 0, 0];
  }

  // Local y = refZ × lx (then normalize)
  let ly = [
    refZ[1] * lx[2] - refZ[2] * lx[1],
    refZ[2] * lx[0] - refZ[0] * lx[2],
    refZ[0] * lx[1] - refZ[1] * lx[0],
  ];
  const lyLen = Math.sqrt(ly[0] ** 2 + ly[1] ** 2 + ly[2] ** 2);
  ly = [ly[0] / lyLen, ly[1] / lyLen, ly[2] / lyLen];

  // Local z = lx × ly
  const lz = [
    lx[1] * ly[2] - lx[2] * ly[1],
    lx[2] * ly[0] - lx[0] * ly[2],
    lx[0] * ly[1] - lx[1] * ly[0],
  ];

  // 3×3 rotation matrix R
  const R = [
    lx[0], lx[1], lx[2],
    ly[0], ly[1], ly[2],
    lz[0], lz[1], lz[2],
  ];

  // Build 12×12 block-diagonal T = diag(R, R, R, R)
  const T = new Array(144).fill(0);
  for (let block = 0; block < 4; block++) {
    const offset = block * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        T[(offset + i) * 12 + (offset + j)] = R[i * 3 + j];
      }
    }
  }

  return T;
}

/**
 * Transform local stiffness to global: K_global = T^T × K_local × T.
 * Works for any square matrix size.
 */
export function transformStiffness(
  K_local: number[],
  T: number[],
  size: number,
): number[] {
  // K_global = T^T · K_local · T
  // First compute temp = K_local · T
  const temp = new Array(size * size).fill(0);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      let sum = 0;
      for (let k = 0; k < size; k++) {
        sum += K_local[i * size + k] * T[k * size + j];
      }
      temp[i * size + j] = sum;
    }
  }

  // K_global = T^T · temp
  const K_global = new Array(size * size).fill(0);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      let sum = 0;
      for (let k = 0; k < size; k++) {
        sum += T[k * size + i] * temp[k * size + j]; // T^T row i = T col i
      }
      K_global[i * size + j] = sum;
    }
  }

  return K_global;
}

/**
 * Build 24×24 transformation for a shell element.
 * For horizontal slabs, this is typically identity.
 * For inclined shells, rotates each node's 6 DOF from local to global.
 */
export function buildShellTransformation(
  nodes: StructuralNode[],
): number[] {
  // For horizontal slabs (z = const for all nodes), T = I
  const allSameZ = nodes.every(n => Math.abs(n.z - nodes[0].z) < 1.0);

  const size = 24;
  const T = new Array(size * size).fill(0);

  if (allSameZ) {
    // Identity
    for (let i = 0; i < size; i++) T[i * size + i] = 1.0;
    return T;
  }

  // General case: compute local plane normal and build rotation
  // Using first 3 nodes to define plane
  const v1 = [nodes[1].x - nodes[0].x, nodes[1].y - nodes[0].y, nodes[1].z - nodes[0].z];
  const v2 = [nodes[2].x - nodes[0].x, nodes[2].y - nodes[0].y, nodes[2].z - nodes[0].z];
  const normal = [
    v1[1] * v2[2] - v1[2] * v2[1],
    v1[2] * v2[0] - v1[0] * v2[2],
    v1[0] * v2[1] - v1[1] * v2[0],
  ];
  const nLen = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
  const lz = [normal[0] / nLen, normal[1] / nLen, normal[2] / nLen];

  const v1Len = Math.sqrt(v1[0] ** 2 + v1[1] ** 2 + v1[2] ** 2);
  const lx = [v1[0] / v1Len, v1[1] / v1Len, v1[2] / v1Len];

  const ly = [
    lz[1] * lx[2] - lz[2] * lx[1],
    lz[2] * lx[0] - lz[0] * lx[2],
    lz[0] * lx[1] - lz[1] * lx[0],
  ];

  const R = [
    lx[0], lx[1], lx[2],
    ly[0], ly[1], ly[2],
    lz[0], lz[1], lz[2],
  ];

  // Block diagonal: 4 blocks of R (each 3×3 for translations, then 3×3 for rotations)
  // Actually 4 nodes × 2 blocks (trans + rot) = 8 blocks... 
  // Simpler: 4 nodes, each with 6 DOF → 4 blocks of 6×6 where each 6×6 = diag(R, R)
  for (let node = 0; node < 4; node++) {
    const offset = node * 6;
    for (let block = 0; block < 2; block++) {
      const bo = offset + block * 3;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          T[(bo + i) * size + (bo + j)] = R[i * 3 + j];
        }
      }
    }
  }

  return T;
}
