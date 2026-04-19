/**
 * Post Processor – Result Extraction
 * ═══════════════════════════════════════════════════════════════
 * Extracts analysis results from the global displacement vector:
 * - Nodal displacements
 * - Support reactions: R = K·U − F
 * - Element forces (frame elements)
 * - Element stresses (shell elements)
 */

import type { StructuralModel, StructuralNode, StructuralElement, Material, Section } from '../model/types';
import type { AssemblyResult } from '../assembly/globalAssembler';
import type { BoundaryResult } from '../solver/boundaryProcessor';
import { buildLocalFrameStiffness, computeFrameProps } from '../elements/frameElement';
import { buildFrameTransformation } from '../elements/transformation';

const NDOF = 6;

// ─── Result Interfaces ──────────────────────────────────────────────────────

export interface NodalDisplacement {
  nodeId: number;
  ux: number; uy: number; uz: number;
  rx: number; ry: number; rz: number;
}

export interface Reaction {
  nodeId: number;
  fx: number; fy: number; fz: number;
  mx: number; my: number; mz: number;
}

export interface FrameElementForces {
  elementId: number;
  /** Forces at node I (start) in local coordinates. */
  nodeI: { N: number; Vy: number; Vz: number; T: number; My: number; Mz: number };
  /** Forces at node J (end) in local coordinates. */
  nodeJ: { N: number; Vy: number; Vz: number; T: number; My: number; Mz: number };
}

export interface ShellElementStress {
  elementId: number;
  /** Average stress resultants at element centre. */
  Mx: number;  // kNm/m
  My: number;
  Mxy: number;
  Qx: number;  // kN/m
  Qy: number;
  Nx: number;  // kN/m (membrane)
  Ny: number;
  Nxy: number;
}

export interface AnalysisResult {
  nodalDisplacements: NodalDisplacement[];
  reactions: Reaction[];
  elementForces: FrameElementForces[];
  elementStresses: ShellElementStress[];
}

/**
 * Process results from global solution.
 */
export function processResults(
  U: Float64Array,
  model: StructuralModel,
  assembly: AssemblyResult,
  boundary: BoundaryResult,
): AnalysisResult {
  const { dofMap, K, F, totalDOF } = assembly;
  const nodeMap = new Map(model.nodes.map(n => [n.id, n]));
  const matMap = new Map(model.materials.map(m => [m.id, m]));
  const secMap = new Map(model.sections.map(s => [s.id, s]));

  // ── Nodal Displacements ──
  const nodalDisplacements: NodalDisplacement[] = model.nodes.map(node => {
    const base = dofMap.get(node.id)!;
    return {
      nodeId: node.id,
      ux: U[base + 0],
      uy: U[base + 1],
      uz: U[base + 2],
      rx: U[base + 3],
      ry: U[base + 4],
      rz: U[base + 5],
    };
  });

  // ── Reactions: R = K·U − F at fixed DOF ──
  const reactions: Reaction[] = [];
  const fixedNodeIds = new Set<number>();
  for (const dof of boundary.fixedDOFs) {
    // Find which node this DOF belongs to
    for (const node of model.nodes) {
      const base = dofMap.get(node.id)!;
      if (dof >= base && dof < base + NDOF) {
        fixedNodeIds.add(node.id);
        break;
      }
    }
  }

  for (const nodeId of fixedNodeIds) {
    const base = dofMap.get(nodeId)!;
    const r = [0, 0, 0, 0, 0, 0];
    for (let d = 0; d < NDOF; d++) {
      const gi = base + d;
      let ku = 0;
      for (let j = 0; j < totalDOF; j++) {
        ku += K[gi * totalDOF + j] * U[j];
      }
      r[d] = ku - F[gi];
    }
    reactions.push({
      nodeId,
      fx: r[0], fy: r[1], fz: r[2],
      mx: r[3], my: r[4], mz: r[5],
    });
  }

  // ── Frame Element Forces ──
  const elementForces: FrameElementForces[] = [];
  for (const elem of model.elements) {
    if (elem.type !== 'beam' && elem.type !== 'column') continue;
    if (elem.nodeIds.length !== 2) continue;

    const sec = secMap.get(elem.sectionId);
    const mat = matMap.get(elem.materialId);
    if (!sec || !mat) continue;

    const nI = nodeMap.get(elem.nodeIds[0])!;
    const nJ = nodeMap.get(elem.nodeIds[1])!;
    const L = Math.sqrt(
      (nJ.x - nI.x) ** 2 + (nJ.y - nI.y) ** 2 + (nJ.z - nI.z) ** 2,
    );
    if (L < 1e-10) continue;

    // Get element displacements in global
    const baseI = dofMap.get(elem.nodeIds[0])!;
    const baseJ = dofMap.get(elem.nodeIds[1])!;
    const u_global = new Float64Array(12);
    for (let d = 0; d < 6; d++) {
      u_global[d] = U[baseI + d];
      u_global[6 + d] = U[baseJ + d];
    }

    // Transform to local: u_local = T · u_global
    const T = buildFrameTransformation(nI, nJ);
    const u_local = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      let s = 0;
      for (let j = 0; j < 12; j++) s += T[i * 12 + j] * u_global[j];
      u_local[i] = s;
    }

    // f_local = K_local · u_local
    const props = computeFrameProps(mat, sec, L);
    const K_local = buildLocalFrameStiffness(props);
    const f_local = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      let s = 0;
      for (let j = 0; j < 12; j++) s += K_local[i * 12 + j] * u_local[j];
      f_local[i] = s;
    }

    elementForces.push({
      elementId: elem.id,
      nodeI: {
        N: f_local[0],   // axial
        Vy: f_local[1],  // shear y
        Vz: f_local[2],  // shear z
        T: f_local[3],   // torsion
        My: f_local[4],  // moment y
        Mz: f_local[5],  // moment z
      },
      nodeJ: {
        N: f_local[6],
        Vy: f_local[7],
        Vz: f_local[8],
        T: f_local[9],
        My: f_local[10],
        Mz: f_local[11],
      },
    });
  }

  // ── Shell Element Stresses (simplified centre extraction) ──
  const elementStresses: ShellElementStress[] = [];
  // For shell elements, stress recovery would require full B-matrix evaluation
  // at Gauss points. Placeholder for now with zero stresses.
  for (const elem of model.elements) {
    if (elem.type !== 'slab' && elem.type !== 'wall') continue;
    elementStresses.push({
      elementId: elem.id,
      Mx: 0, My: 0, Mxy: 0,
      Qx: 0, Qy: 0,
      Nx: 0, Ny: 0, Nxy: 0,
    });
  }

  return { nodalDisplacements, reactions, elementForces, elementStresses };
}
