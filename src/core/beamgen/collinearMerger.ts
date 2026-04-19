/**
 * Smart Beam Generation — Collinear Edge Merger
 * ═══════════════════════════════════════════════════
 * Detects collinear edges and merges them into longer beams.
 *
 * Algorithm:
 * 1. Group edges by their line direction (using angle quantisation).
 * 2. Within each direction group, further group by perpendicular offset.
 * 3. Within each colinear group, sort by projection and merge contiguous segments.
 */

import type { BGNode, RawEdge, BeamGenConfig } from './types';

interface MergedSegment {
  startNode: string;
  endNode: string;
  length: number;
  sourceEdgeKeys: string[];
  slabIds: string[];
  classification: RawEdge['classification'];
}

/**
 * Compute the angle (0..π) of an edge relative to X-axis.
 * Normalised to [0, π) so parallel lines map to the same angle.
 */
function edgeAngle(nA: BGNode, nB: BGNode): number {
  let angle = Math.atan2(nB.y - nA.y, nB.x - nA.x);
  if (angle < 0) angle += Math.PI;
  if (angle >= Math.PI - 1e-12) angle = 0;
  return angle;
}

/**
 * Perpendicular distance from origin to the infinite line through two points.
 * Used to group edges that lie on the same line.
 */
function perpendicularOffset(nA: BGNode, nB: BGNode, angle: number): number {
  // Normal direction: perpendicular to the edge
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  return nA.x * nx + nA.y * ny;
}

/**
 * Project a point onto the edge direction axis.
 */
function projectOnAxis(node: BGNode, angle: number): number {
  return node.x * Math.cos(angle) + node.y * Math.sin(angle);
}

/**
 * Quantise an angle to a bucket key for grouping.
 */
function angleKey(angle: number, tolerance: number): string {
  const bucket = Math.round(angle / tolerance);
  return `a${bucket}`;
}

function offsetKey(offset: number, tolerance: number): string {
  const bucket = Math.round(offset / tolerance);
  return `o${bucket}`;
}

/**
 * Merge unique slab IDs from a set of edges.
 */
function mergeSlabIds(edges: RawEdge[]): string[] {
  const set = new Set<string>();
  for (const e of edges) for (const s of e.slabIds) set.add(s);
  return [...set];
}

/**
 * Determine merged classification: if any source is 'internal', result is 'internal'.
 */
function mergedClassification(edges: RawEdge[]): RawEdge['classification'] {
  let hasInternal = false;
  let hasComplex = false;
  for (const e of edges) {
    if (e.classification === 'internal') hasInternal = true;
    if (e.classification === 'complex') hasComplex = true;
  }
  if (hasComplex) return 'complex';
  if (hasInternal) return 'internal';
  return 'perimeter';
}

/**
 * Merge collinear contiguous edges into longer segments.
 *
 * @returns Array of merged segments (some may be unchanged single edges).
 */
export function mergeCollinearEdges(
  edges: RawEdge[],
  nodeMap: Map<string, BGNode>,
  config: BeamGenConfig,
): { merged: MergedSegment[]; mergedGroupCount: number } {
  if (!config.mergeCollinear || edges.length === 0) {
    return {
      merged: edges.map(e => ({
        startNode: e.nodeA,
        endNode: e.nodeB,
        length: e.length,
        sourceEdgeKeys: [e.key],
        slabIds: [...e.slabIds],
        classification: e.classification,
      })),
      mergedGroupCount: 0,
    };
  }

  const tol = config.collinearTolerance;
  const coordTol = config.coordTolerance;

  // ── Step 1: Group by angle ────────────────────────────────────────────────
  const angleGroups = new Map<string, RawEdge[]>();

  for (const edge of edges) {
    const nA = nodeMap.get(edge.nodeA);
    const nB = nodeMap.get(edge.nodeB);
    if (!nA || !nB) continue;

    const angle = edgeAngle(nA, nB);
    const aKey = angleKey(angle, tol);
    let group = angleGroups.get(aKey);
    if (!group) { group = []; angleGroups.set(aKey, group); }
    group.push(edge);
  }

  // ── Step 2: Within each angle group, sub-group by offset ──────────────────
  const result: MergedSegment[] = [];
  let mergedGroupCount = 0;

  for (const [, group] of angleGroups) {
    if (group.length === 1) {
      const e = group[0];
      result.push({
        startNode: e.nodeA,
        endNode: e.nodeB,
        length: e.length,
        sourceEdgeKeys: [e.key],
        slabIds: [...e.slabIds],
        classification: e.classification,
      });
      continue;
    }

    // Compute representative angle from first edge
    const refA = nodeMap.get(group[0].nodeA)!;
    const refB = nodeMap.get(group[0].nodeB)!;
    const angle = edgeAngle(refA, refB);

    // Sub-group by perpendicular offset
    const offsetGroups = new Map<string, RawEdge[]>();
    for (const edge of group) {
      const nA = nodeMap.get(edge.nodeA)!;
      const nB = nodeMap.get(edge.nodeB)!;
      const avgOffset = (perpendicularOffset(nA, nB, angle) + perpendicularOffset(nB, nA, angle)) / 2;
      // Use a coarser tolerance for offset grouping
      const oKey = offsetKey(avgOffset, coordTol * 10);
      let og = offsetGroups.get(oKey);
      if (!og) { og = []; offsetGroups.set(oKey, og); }
      og.push(edge);
    }

    // ── Step 3: Within each colinear group, sort & merge contiguous ────────
    for (const [, colinearEdges] of offsetGroups) {
      if (colinearEdges.length === 1) {
        const e = colinearEdges[0];
        result.push({
          startNode: e.nodeA,
          endNode: e.nodeB,
          length: e.length,
          sourceEdgeKeys: [e.key],
          slabIds: [...e.slabIds],
          classification: e.classification,
        });
        continue;
      }

      // Build a list of (node, projection) pairs and sort by projection
      type NodeProj = { nodeId: string; proj: number };
      const projections: { edge: RawEdge; projA: number; projB: number }[] = [];

      for (const edge of colinearEdges) {
        const nA = nodeMap.get(edge.nodeA)!;
        const nB = nodeMap.get(edge.nodeB)!;
        const pA = projectOnAxis(nA, angle);
        const pB = projectOnAxis(nB, angle);
        projections.push({
          edge,
          projA: Math.min(pA, pB),
          projB: Math.max(pA, pB),
        });
      }

      // Sort by start projection
      projections.sort((a, b) => a.projA - b.projA);

      // Merge contiguous segments (segments that share an endpoint)
      let currentStart = projections[0].projA;
      let currentEnd = projections[0].projB;
      let currentEdges: RawEdge[] = [projections[0].edge];

      const flushSegment = () => {
        if (currentEdges.length === 0) return;

        if (currentEdges.length === 1) {
          const e = currentEdges[0];
          result.push({
            startNode: e.nodeA,
            endNode: e.nodeB,
            length: e.length,
            sourceEdgeKeys: [e.key],
            slabIds: [...e.slabIds],
            classification: e.classification,
          });
        } else {
          mergedGroupCount++;
          // Find the nodes at the extremes
          let minProj = Infinity, maxProj = -Infinity;
          let startNode = '', endNode = '';

          for (const edge of currentEdges) {
            const nA = nodeMap.get(edge.nodeA)!;
            const nB = nodeMap.get(edge.nodeB)!;
            const pA = projectOnAxis(nA, angle);
            const pB = projectOnAxis(nB, angle);
            if (pA < minProj) { minProj = pA; startNode = edge.nodeA; }
            if (pB < minProj) { minProj = pB; startNode = edge.nodeB; }
            if (pA > maxProj) { maxProj = pA; endNode = edge.nodeA; }
            if (pB > maxProj) { maxProj = pB; endNode = edge.nodeB; }
          }

          const sN = nodeMap.get(startNode)!;
          const eN = nodeMap.get(endNode)!;
          const dx = eN.x - sN.x;
          const dy = eN.y - sN.y;
          const length = Math.sqrt(dx * dx + dy * dy);

          result.push({
            startNode,
            endNode,
            length,
            sourceEdgeKeys: currentEdges.map(e => e.key),
            slabIds: mergeSlabIds(currentEdges),
            classification: mergedClassification(currentEdges),
          });
        }
      };

      for (let i = 1; i < projections.length; i++) {
        const seg = projections[i];
        // Check if this segment is contiguous with current (shares endpoint)
        if (seg.projA <= currentEnd + coordTol * 10) {
          // Contiguous — extend
          currentEnd = Math.max(currentEnd, seg.projB);
          currentEdges.push(seg.edge);
        } else {
          // Gap — flush current and start new
          flushSegment();
          currentStart = seg.projA;
          currentEnd = seg.projB;
          currentEdges = [seg.edge];
        }
      }
      flushSegment();
    }
  }

  return { merged: result, mergedGroupCount };
}
