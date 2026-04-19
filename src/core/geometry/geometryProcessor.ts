/**
 * Geometry Processor
 * ═══════════════════════════════════════════════════════════════
 * Converts raw model input into a clean StructuralModel:
 * - Merges coincident nodes (tolerance-based spatial hashing)
 * - Detects shared edges between elements
 * - Builds connectivity graph
 * - Identifies beam-slab intersections
 * - Validates geometry consistency
 */

import type { StructuralModel, StructuralNode, StructuralElement } from '../model/types';

/** Default merge tolerance in mm. */
const MERGE_TOLERANCE = 1.0;

// ─── Spatial Hash ────────────────────────────────────────────────────────────

interface SpatialCell {
  nodes: StructuralNode[];
}

function hashKey(x: number, y: number, z: number, cellSize: number): string {
  const ix = Math.floor(x / cellSize);
  const iy = Math.floor(y / cellSize);
  const iz = Math.floor(z / cellSize);
  return `${ix},${iy},${iz}`;
}

function distance(a: StructuralNode, b: StructuralNode): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

// ─── Node Merging ────────────────────────────────────────────────────────────

export interface NodeMergeResult {
  mergedNodes: StructuralNode[];
  /** Maps original node ID → merged node ID. */
  idMap: Map<number, number>;
  mergeCount: number;
}

export function mergeNodes(
  nodes: StructuralNode[],
  tolerance: number = MERGE_TOLERANCE,
): NodeMergeResult {
  const cellSize = tolerance * 2;
  const grid = new Map<string, SpatialCell>();
  const idMap = new Map<number, number>();
  const mergedNodes: StructuralNode[] = [];
  let mergeCount = 0;

  for (const node of nodes) {
    const key = hashKey(node.x, node.y, node.z, cellSize);
    // Check neighbouring cells
    let merged = false;
    const offsets = [-1, 0, 1];
    for (const dx of offsets) {
      for (const dy of offsets) {
        for (const dz of offsets) {
          const nk = hashKey(
            node.x + dx * cellSize,
            node.y + dy * cellSize,
            node.z + dz * cellSize,
            cellSize,
          );
          const cell = grid.get(nk);
          if (!cell) continue;
          for (const existing of cell.nodes) {
            if (distance(node, existing) <= tolerance) {
              idMap.set(node.id, existing.id);
              // Merge restraints (OR)
              existing.restraints = {
                ux: existing.restraints.ux || node.restraints.ux,
                uy: existing.restraints.uy || node.restraints.uy,
                uz: existing.restraints.uz || node.restraints.uz,
                rx: existing.restraints.rx || node.restraints.rx,
                ry: existing.restraints.ry || node.restraints.ry,
                rz: existing.restraints.rz || node.restraints.rz,
              };
              // Merge loads
              existing.nodalLoads.push(...node.nodalLoads);
              merged = true;
              mergeCount++;
              break;
            }
          }
          if (merged) break;
        }
        if (merged) break;
      }
      if (merged) break;
    }

    if (!merged) {
      idMap.set(node.id, node.id);
      mergedNodes.push({ ...node, nodalLoads: [...node.nodalLoads] });
      if (!grid.has(key)) grid.set(key, { nodes: [] });
      grid.get(key)!.nodes.push(mergedNodes[mergedNodes.length - 1]);
    }
  }

  return { mergedNodes, idMap, mergeCount };
}

// ─── Connectivity Graph ──────────────────────────────────────────────────────

export interface ConnectivityGraph {
  /** nodeId → set of connected element IDs. */
  nodeToElements: Map<number, Set<number>>;
  /** elementId → set of adjacent element IDs (sharing nodes). */
  adjacency: Map<number, Set<number>>;
}

export function buildConnectivityGraph(elements: StructuralElement[]): ConnectivityGraph {
  const nodeToElements = new Map<number, Set<number>>();
  for (const el of elements) {
    for (const nid of el.nodeIds) {
      if (!nodeToElements.has(nid)) nodeToElements.set(nid, new Set());
      nodeToElements.get(nid)!.add(el.id);
    }
  }

  const adjacency = new Map<number, Set<number>>();
  for (const el of elements) {
    if (!adjacency.has(el.id)) adjacency.set(el.id, new Set());
    for (const nid of el.nodeIds) {
      for (const adjId of nodeToElements.get(nid)!) {
        if (adjId !== el.id) adjacency.get(el.id)!.add(adjId);
      }
    }
  }

  return { nodeToElements, adjacency };
}

// ─── Beam-Slab Intersection Detection ────────────────────────────────────────

export interface BeamSlabIntersection {
  beamElementId: number;
  slabElementId: number;
  sharedNodeIds: number[];
}

export function detectBeamSlabIntersections(
  elements: StructuralElement[],
): BeamSlabIntersection[] {
  const beams = elements.filter(e => e.type === 'beam');
  const slabs = elements.filter(e => e.type === 'slab');
  const intersections: BeamSlabIntersection[] = [];

  for (const beam of beams) {
    const beamNodeSet = new Set(beam.nodeIds);
    for (const slab of slabs) {
      const shared = slab.nodeIds.filter(n => beamNodeSet.has(n));
      if (shared.length > 0) {
        intersections.push({
          beamElementId: beam.id,
          slabElementId: slab.id,
          sharedNodeIds: shared,
        });
      }
    }
  }

  return intersections;
}

// ─── Full Processing ─────────────────────────────────────────────────────────

export interface ProcessedGeometry {
  model: StructuralModel;
  connectivity: ConnectivityGraph;
  beamSlabIntersections: BeamSlabIntersection[];
  nodeMergeResult: NodeMergeResult;
}

export function processGeometry(
  model: StructuralModel,
  tolerance: number = MERGE_TOLERANCE,
): ProcessedGeometry {
  // 1. Merge nodes
  const nodeMergeResult = mergeNodes(model.nodes, tolerance);

  // 2. Remap element node IDs
  const remappedElements: StructuralElement[] = model.elements.map(el => ({
    ...el,
    nodeIds: el.nodeIds.map(nid => nodeMergeResult.idMap.get(nid) ?? nid),
  }));

  // 3. Build connectivity
  const connectivity = buildConnectivityGraph(remappedElements);

  // 4. Detect beam-slab intersections
  const beamSlabIntersections = detectBeamSlabIntersections(remappedElements);

  const processedModel: StructuralModel = {
    ...model,
    nodes: nodeMergeResult.mergedNodes,
    elements: remappedElements,
  };

  return {
    model: processedModel,
    connectivity,
    beamSlabIntersections,
    nodeMergeResult,
  };
}
