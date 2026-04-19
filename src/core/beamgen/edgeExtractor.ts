/**
 * Smart Beam Generation — Edge Extraction & Classification
 * ═══════════════════════════════════════════════════════════
 * Step 1: Extract all edges from slab polygons.
 * Step 2: Classify each edge as perimeter / internal / complex.
 */

import type { BGNode, BGSlab, RawEdge, EdgeClassification } from './types';

/**
 * Normalize an edge key so (A,B) and (B,A) produce the same string.
 */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Compute Euclidean distance between two nodes (2D, ignoring z).
 */
export function nodeDistance(
  a: BGNode,
  b: BGNode,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Extract all edges from a set of slabs and classify them.
 *
 * Complexity: O(S × E) where S = slabs, E = avg edges per slab.
 * For typical structural models this is effectively O(n).
 */
export function extractAndClassifyEdges(
  nodes: BGNode[],
  slabs: BGSlab[],
): RawEdge[] {
  const nodeMap = new Map<string, BGNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Accumulate edge → slab references
  const edgeMap = new Map<string, { nodeA: string; nodeB: string; slabIds: string[] }>();

  for (const slab of slabs) {
    const ids = slab.nodeIds;
    const count = ids.length;
    if (count < 3) continue; // degenerate polygon

    for (let i = 0; i < count; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % count];
      const key = edgeKey(a, b);

      const existing = edgeMap.get(key);
      if (existing) {
        existing.slabIds.push(slab.id);
      } else {
        edgeMap.set(key, { nodeA: a, nodeB: b, slabIds: [slab.id] });
      }
    }
  }

  // Build classified edge array
  const result: RawEdge[] = [];

  for (const [key, data] of edgeMap) {
    const nA = nodeMap.get(data.nodeA);
    const nB = nodeMap.get(data.nodeB);
    if (!nA || !nB) continue;

    const length = nodeDistance(nA, nB);
    const count = data.slabIds.length;

    let classification: EdgeClassification;
    if (count === 1) classification = 'perimeter';
    else if (count === 2) classification = 'internal';
    else classification = 'complex';

    // Normalize node order: smaller id first
    const [normA, normB] = data.nodeA < data.nodeB
      ? [data.nodeA, data.nodeB]
      : [data.nodeB, data.nodeA];

    result.push({
      key,
      nodeA: normA,
      nodeB: normB,
      slabIds: data.slabIds,
      length,
      classification,
    });
  }

  return result;
}
