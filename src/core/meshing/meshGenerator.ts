/**
 * Mesh Generator
 * ═══════════════════════════════════════════════════════════════
 * Generates FEM mesh for slab elements (4-node quad subdivision).
 * Frame elements (beams/columns) use their native 2-node representation.
 *
 * Approach:
 * - For each slab element defined by its corner nodes, subdivide into
 *   an nx × ny grid of 4-node quadrilateral elements.
 * - Mesh density is controlled by target element size.
 */

import type { StructuralModel, StructuralNode, StructuralElement } from '../model/types';
import { FREE_RESTRAINTS } from '../model/types';

export interface MeshConfig {
  /** Target element size in mm. Default 500. */
  targetSize: number;
  /** Minimum divisions per edge. Default 2. */
  minDivisions: number;
}

const DEFAULT_CONFIG: MeshConfig = {
  targetSize: 500,
  minDivisions: 2,
};

export interface MeshResult {
  /** New nodes created by meshing (includes original corner nodes). */
  nodes: StructuralNode[];
  /** New sub-elements from slab meshing + original frame elements. */
  elements: StructuralElement[];
  /** Maps original slab element ID → array of sub-element IDs. */
  slabSubElements: Map<number, number[]>;
}

let nextNodeId = 100000;
let nextElemId = 200000;

function resetIds(): void {
  nextNodeId = 100000;
  nextElemId = 200000;
}

/**
 * Subdivide a quadrilateral slab into an nx × ny mesh.
 * Assumes slab has 4 corner nodes ordered CCW.
 */
function meshQuadSlab(
  slab: StructuralElement,
  cornerNodes: StructuralNode[],
  config: MeshConfig,
): { nodes: StructuralNode[]; elements: StructuralElement[] } {
  if (cornerNodes.length !== 4) {
    throw new Error(`Slab ${slab.id}: expected 4 corner nodes, got ${cornerNodes.length}`);
  }

  const [n0, n1, n2, n3] = cornerNodes;

  // Compute edge lengths for division count
  const edgeLen01 = Math.sqrt((n1.x - n0.x) ** 2 + (n1.y - n0.y) ** 2 + (n1.z - n0.z) ** 2);
  const edgeLen03 = Math.sqrt((n3.x - n0.x) ** 2 + (n3.y - n0.y) ** 2 + (n3.z - n0.z) ** 2);

  const nx = Math.max(config.minDivisions, Math.ceil(edgeLen01 / config.targetSize));
  const ny = Math.max(config.minDivisions, Math.ceil(edgeLen03 / config.targetSize));

  // Generate grid nodes using bilinear interpolation
  const gridNodes: StructuralNode[][] = [];
  const allNodes: StructuralNode[] = [];

  for (let j = 0; j <= ny; j++) {
    gridNodes[j] = [];
    const eta = j / ny;
    for (let i = 0; i <= nx; i++) {
      const xi = i / nx;

      // Bilinear interpolation: P = (1-xi)(1-eta)·n0 + xi(1-eta)·n1 + xi·eta·n2 + (1-xi)·eta·n3
      const x = (1 - xi) * (1 - eta) * n0.x + xi * (1 - eta) * n1.x + xi * eta * n2.x + (1 - xi) * eta * n3.x;
      const y = (1 - xi) * (1 - eta) * n0.y + xi * (1 - eta) * n1.y + xi * eta * n2.y + (1 - xi) * eta * n3.y;
      const z = (1 - xi) * (1 - eta) * n0.z + xi * (1 - eta) * n1.z + xi * eta * n2.z + (1 - xi) * eta * n3.z;

      // Reuse corner nodes at corners
      let node: StructuralNode;
      if (i === 0 && j === 0) node = n0;
      else if (i === nx && j === 0) node = n1;
      else if (i === nx && j === ny) node = n2;
      else if (i === 0 && j === ny) node = n3;
      else {
        node = {
          id: nextNodeId++,
          x, y, z,
          restraints: { ...FREE_RESTRAINTS },
          nodalLoads: [],
        };
      }

      gridNodes[j][i] = node;
      allNodes.push(node);
    }
  }

  // Generate quad elements
  const elements: StructuralElement[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      elements.push({
        id: nextElemId++,
        type: 'slab',
        nodeIds: [
          gridNodes[j][i].id,
          gridNodes[j][i + 1].id,
          gridNodes[j + 1][i + 1].id,
          gridNodes[j + 1][i].id,
        ],
        materialId: slab.materialId,
        sectionId: slab.sectionId,
        slabProperties: slab.slabProperties,
      });
    }
  }

  return { nodes: allNodes, elements };
}

/**
 * Generate mesh for the entire structural model.
 * Slab elements are subdivided; frame elements pass through unchanged.
 */
export function generateMesh(
  model: StructuralModel,
  config: Partial<MeshConfig> = {},
): MeshResult {
  resetIds();
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const nodeMap = new Map(model.nodes.map(n => [n.id, n]));

  const resultNodes: Map<number, StructuralNode> = new Map();
  const resultElements: StructuralElement[] = [];
  const slabSubElements = new Map<number, number[]>();

  // Add all original nodes
  for (const n of model.nodes) {
    resultNodes.set(n.id, n);
  }

  for (const elem of model.elements) {
    if (elem.type === 'slab' && elem.nodeIds.length === 4) {
      const corners = elem.nodeIds.map(id => nodeMap.get(id)!);
      const meshResult = meshQuadSlab(elem, corners, cfg);

      for (const n of meshResult.nodes) {
        if (!resultNodes.has(n.id)) resultNodes.set(n.id, n);
      }
      resultElements.push(...meshResult.elements);
      slabSubElements.set(elem.id, meshResult.elements.map(e => e.id));
    } else {
      // Frame elements pass through
      resultElements.push(elem);
    }
  }

  return {
    nodes: Array.from(resultNodes.values()),
    elements: resultElements,
    slabSubElements,
  };
}
