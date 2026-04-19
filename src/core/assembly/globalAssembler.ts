/**
 * Global Matrix Assembler
 * ═══════════════════════════════════════════════════════════════
 * Assembles the global stiffness matrix and force vector.
 *
 * Formula: K_global = Σ (T^T × K_local × T)
 *
 * For slab elements in LOAD_ONLY mode:
 * - DO NOT assemble stiffness
 * - Loads are converted via slabLoadDistributor
 */

import type { StructuralModel, StructuralNode, StructuralElement, DOF_PER_NODE } from '../model/types';
import { buildLocalFrameStiffness, computeFrameProps } from '../elements/frameElement';
import { buildShellStiffness } from '../elements/shellElement';
import { buildFrameTransformation, transformStiffness, buildShellTransformation } from '../elements/transformation';

const NDOF = 6; // DOF per node

export interface AssemblyResult {
  /** Global stiffness matrix (flat row-major, size = totalDOF × totalDOF). */
  K: Float64Array;
  /** Global force vector (size = totalDOF). */
  F: Float64Array;
  /** Total DOF count. */
  totalDOF: number;
  /** Maps node ID → global DOF start index. */
  dofMap: Map<number, number>;
  /** Node IDs in order used for DOF numbering. */
  nodeOrder: number[];
}

/**
 * Assign DOF indices to nodes.
 */
function buildDOFMap(nodes: StructuralNode[]): { dofMap: Map<number, number>; nodeOrder: number[] } {
  const dofMap = new Map<number, number>();
  const nodeOrder: number[] = [];
  let idx = 0;
  for (const node of nodes) {
    dofMap.set(node.id, idx);
    nodeOrder.push(node.id);
    idx += NDOF;
  }
  return { dofMap, nodeOrder };
}

/**
 * Assemble global stiffness matrix and force vector.
 */
export function assembleGlobalSystem(model: StructuralModel): AssemblyResult {
  const { dofMap, nodeOrder } = buildDOFMap(model.nodes);
  const totalDOF = model.nodes.length * NDOF;
  const K = new Float64Array(totalDOF * totalDOF);
  const F = new Float64Array(totalDOF);

  const nodeMap = new Map(model.nodes.map(n => [n.id, n]));
  const matMap = new Map(model.materials.map(m => [m.id, m]));
  const secMap = new Map(model.sections.map(s => [s.id, s]));

  for (const elem of model.elements) {
    const mat = matMap.get(elem.materialId);
    const sec = secMap.get(elem.sectionId);
    if (!mat) continue;

    // Skip stiffness assembly for LOAD_ONLY slabs
    if (elem.type === 'slab' && elem.slabProperties?.stiffnessMode === 'LOAD_ONLY') {
      continue;
    }

    let K_global: number[];
    let elemNodeIds: number[];

    if (elem.type === 'beam' || elem.type === 'column') {
      if (!sec || elem.nodeIds.length !== 2) continue;
      const nI = nodeMap.get(elem.nodeIds[0])!;
      const nJ = nodeMap.get(elem.nodeIds[1])!;
      const L = Math.sqrt(
        (nJ.x - nI.x) ** 2 + (nJ.y - nI.y) ** 2 + (nJ.z - nI.z) ** 2,
      );
      if (L < 1e-10) continue;

      const props = computeFrameProps(mat, sec, L);
      const K_local = buildLocalFrameStiffness(props);
      const T = buildFrameTransformation(nI, nJ);
      K_global = transformStiffness(K_local, T, 12);
      elemNodeIds = elem.nodeIds;

    } else if (elem.type === 'slab' || elem.type === 'wall') {
      if (elem.nodeIds.length !== 4 || !elem.slabProperties) continue;
      const nodes = elem.nodeIds.map(id => nodeMap.get(id)!);
      const coords = nodes.map(n => ({ x: n.x, y: n.y, z: n.z }));
      const K_local = buildShellStiffness(coords, mat, elem.slabProperties);
      const T = buildShellTransformation(nodes);
      K_global = transformStiffness(K_local, T, 24);
      elemNodeIds = elem.nodeIds;

    } else {
      continue;
    }

    // Scatter element stiffness into global matrix
    const elemDOFs: number[] = [];
    for (const nid of elemNodeIds) {
      const base = dofMap.get(nid)!;
      for (let d = 0; d < NDOF; d++) elemDOFs.push(base + d);
    }

    const elemSize = elemDOFs.length;
    for (let i = 0; i < elemSize; i++) {
      const gi = elemDOFs[i];
      for (let j = 0; j < elemSize; j++) {
        const gj = elemDOFs[j];
        K[gi * totalDOF + gj] += K_global[i * elemSize + j];
      }
    }
  }

  // Assemble force vector from nodal loads
  for (const node of model.nodes) {
    const base = dofMap.get(node.id)!;
    for (const load of node.nodalLoads) {
      F[base + 0] += load.fx;
      F[base + 1] += load.fy;
      F[base + 2] += load.fz;
      F[base + 3] += load.mx;
      F[base + 4] += load.my;
      F[base + 5] += load.mz;
    }
  }

  return { K, F, totalDOF, dofMap, nodeOrder };
}
