/**
 * Beam Continuity Engine
 * ═══════════════════════════════════════════════════════════════════
 * Ensures that beam splitting (a modeling artifact for topology) does NOT
 * break structural continuity in the FEM solution.
 *
 * CRITICAL PRINCIPLES:
 * 1. Split beams must behave as ONE continuous beam
 * 2. Internal nodes must NOT act as supports or hinges
 * 3. Beam-to-beam connections are naturally handled by shared nodes
 * 4. Load transfer emerges from the global stiffness matrix
 *
 * This module provides:
 * - Node classification (column, slab edge, internal continuity)
 * - Collinearity detection for beam segments
 * - Beam grouping into continuous physical members
 * - Support misdetection prevention
 * - DOF continuity enforcement
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type NodeClassification =
  | 'columnNode'           // Connected to a column → true structural support
  | 'slabEdgeNode'         // Boundary of slab → may or may not be support
  | 'internalContinuity'   // Created by beam splitting, collinear beams → NOT a support
  | 'beamIntersection'     // Non-collinear beams meet → beam-to-beam connection
  | 'freeEnd';             // Free end of a cantilever

export interface ClassifiedNode {
  nodeId: string;
  x: number;
  y: number;
  z: number;
  classification: NodeClassification;
  connectedBeamIds: string[];
  connectedColumnIds: string[];
  /** True if this node is at a collinear beam split point */
  isContinuityNode: boolean;
  /** Parent beam group ID (if part of a continuous beam) */
  parentGroupId?: string;
}

export interface BeamSegment {
  id: string;
  nodeI: string;
  nodeJ: string;
  directionVector: [number, number, number];
  length: number;
  /** ID of the parent continuous beam group */
  parentGroupId?: string;
}

export interface ContinuousBeamGroup {
  groupId: string;
  segmentIds: string[];
  /** Total span from first node to last node */
  totalLength: number;
  /** Ordered node IDs from start to end */
  orderedNodeIds: string[];
  /** Direction unit vector of the group */
  direction: [number, number, number];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Angular tolerance for collinearity (radians). ~1° */
const COLLINEAR_ANGLE_TOL = Math.PI / 180;

/** Coordinate tolerance for node matching (mm) */
const COORD_TOL = 0.1;

// ─── Step 1: Node Classification ─────────────────────────────────────────────

interface NodeInfo {
  id: string;
  x: number;
  y: number;
  z: number;
}

interface ElementInfo {
  id: string;
  nodeI: string;
  nodeJ: string;
  type: 'beam' | 'column';
}

/**
 * Classify all nodes in the model based on their structural role.
 * 
 * RULES:
 * - If node is connected to a column → columnNode
 * - If node is at a collinear beam split → internalContinuity (NOT a support)
 * - If node is where non-collinear beams meet → beamIntersection
 * - Otherwise → freeEnd or slabEdgeNode
 */
export function classifyNodes(
  nodes: NodeInfo[],
  elements: ElementInfo[],
): Map<string, ClassifiedNode> {
  const nodeMap = new Map<string, NodeInfo>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Build adjacency
  const nodeBeams = new Map<string, string[]>();
  const nodeColumns = new Map<string, string[]>();

  for (const elem of elements) {
    if (elem.type === 'beam') {
      (nodeBeams.get(elem.nodeI) ?? (nodeBeams.set(elem.nodeI, []), nodeBeams.get(elem.nodeI)!)).push(elem.id);
      (nodeBeams.get(elem.nodeJ) ?? (nodeBeams.set(elem.nodeJ, []), nodeBeams.get(elem.nodeJ)!)).push(elem.id);
    } else if (elem.type === 'column') {
      (nodeColumns.get(elem.nodeI) ?? (nodeColumns.set(elem.nodeI, []), nodeColumns.get(elem.nodeI)!)).push(elem.id);
      (nodeColumns.get(elem.nodeJ) ?? (nodeColumns.set(elem.nodeJ, []), nodeColumns.get(elem.nodeJ)!)).push(elem.id);
    }
  }

  // Compute beam direction vectors
  const beamDirs = new Map<string, [number, number, number]>();
  for (const elem of elements) {
    if (elem.type !== 'beam') continue;
    const nI = nodeMap.get(elem.nodeI);
    const nJ = nodeMap.get(elem.nodeJ);
    if (!nI || !nJ) continue;
    const dx = nJ.x - nI.x, dy = nJ.y - nI.y, dz = nJ.z - nI.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-6) continue;
    beamDirs.set(elem.id, [dx / L, dy / L, dz / L]);
  }

  const result = new Map<string, ClassifiedNode>();

  for (const node of nodes) {
    const beamIds = nodeBeams.get(node.id) ?? [];
    const columnIds = nodeColumns.get(node.id) ?? [];

    let classification: NodeClassification;
    let isContinuityNode = false;

    if (columnIds.length > 0) {
      // Connected to a column → structural support
      classification = 'columnNode';
    } else if (beamIds.length === 0) {
      classification = 'freeEnd';
    } else if (beamIds.length === 1) {
      classification = 'slabEdgeNode';
    } else if (beamIds.length === 2) {
      // Check if the two beams are collinear
      const collinear = areBeamsCollinear(beamIds[0], beamIds[1], beamDirs);
      if (collinear) {
        // Internal continuity node — beam split artifact
        classification = 'internalContinuity';
        isContinuityNode = true;
      } else {
        // Non-collinear beams meet → beam-to-beam connection
        classification = 'beamIntersection';
      }
    } else {
      // 3+ beams → check if any pair is collinear
      let hasCollinearPair = false;
      let hasNonCollinearPair = false;
      for (let i = 0; i < beamIds.length; i++) {
        for (let j = i + 1; j < beamIds.length; j++) {
          if (areBeamsCollinear(beamIds[i], beamIds[j], beamDirs)) {
            hasCollinearPair = true;
          } else {
            hasNonCollinearPair = true;
          }
        }
      }
      if (hasNonCollinearPair) {
        classification = 'beamIntersection';
        // Even if some beams are collinear, the node is an intersection
        // because non-collinear beams also connect here
      } else {
        classification = 'internalContinuity';
        isContinuityNode = true;
      }
    }

    result.set(node.id, {
      nodeId: node.id,
      x: node.x,
      y: node.y,
      z: node.z,
      classification,
      connectedBeamIds: beamIds,
      connectedColumnIds: columnIds,
      isContinuityNode,
    });
  }

  return result;
}

// ─── Step 3: Collinearity Detection ──────────────────────────────────────────

/**
 * Check if two beams are collinear (parallel within tolerance).
 * Two beams are collinear if the angle between their direction vectors < ~1°.
 */
export function areBeamsCollinear(
  beamIdA: string,
  beamIdB: string,
  beamDirections: Map<string, [number, number, number]>,
): boolean {
  const dA = beamDirections.get(beamIdA);
  const dB = beamDirections.get(beamIdB);
  if (!dA || !dB) return false;

  // |cos θ| = |dot product| (since both are unit vectors)
  const dot = Math.abs(dA[0] * dB[0] + dA[1] * dB[1] + dA[2] * dB[2]);
  // cos(1°) ≈ 0.99985
  return dot > Math.cos(COLLINEAR_ANGLE_TOL);
}

// ─── Step 4: Beam Grouping ───────────────────────────────────────────────────

/**
 * Group beam segments into continuous physical members.
 * 
 * Two segments join the same group if:
 * 1. They share a node
 * 2. They are collinear (angle < tolerance)
 * 3. The shared node has no column (not a structural support point)
 * 
 * Each group represents ONE physical beam for post-processing,
 * moment diagram continuity, and design purposes.
 */
export function groupContinuousBeams(
  elements: ElementInfo[],
  nodes: NodeInfo[],
  classifiedNodes: Map<string, ClassifiedNode>,
): ContinuousBeamGroup[] {
  const nodeMap = new Map<string, NodeInfo>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const beams = elements.filter(e => e.type === 'beam');

  // Compute directions
  const dirs = new Map<string, [number, number, number]>();
  for (const b of beams) {
    const nI = nodeMap.get(b.nodeI), nJ = nodeMap.get(b.nodeJ);
    if (!nI || !nJ) continue;
    const dx = nJ.x - nI.x, dy = nJ.y - nI.y, dz = nJ.z - nI.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-6) continue;
    dirs.set(b.id, [dx / L, dy / L, dz / L]);
  }

  // Union-Find
  const parent = new Map<string, string>();
  beams.forEach(b => parent.set(b.id, b.id));

  const find = (x: string): string => {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));

  // Build adjacency: node → beam IDs
  const nodeAdj = new Map<string, { beamId: string; end: 'I' | 'J' }[]>();
  for (const b of beams) {
    for (const [nid, end] of [[b.nodeI, 'I'], [b.nodeJ, 'J']] as [string, 'I' | 'J'][]) {
      const arr = nodeAdj.get(nid) ?? [];
      arr.push({ beamId: b.id, end });
      nodeAdj.set(nid, arr);
    }
  }

  // Merge collinear beams at continuity nodes
  for (const [nodeId, adj] of nodeAdj) {
    const classified = classifiedNodes.get(nodeId);
    
    // Only merge at internal continuity nodes (no column, collinear beams)
    if (!classified || !classified.isContinuityNode) continue;

    // Find collinear pairs among beams at this node
    for (let i = 0; i < adj.length; i++) {
      for (let j = i + 1; j < adj.length; j++) {
        if (areBeamsCollinear(adj[i].beamId, adj[j].beamId, dirs)) {
          union(adj[i].beamId, adj[j].beamId);
        }
      }
    }
  }

  // Collect groups
  const grouped = new Map<string, string[]>();
  for (const b of beams) {
    const root = find(b.id);
    const arr = grouped.get(root) ?? [];
    arr.push(b.id);
    grouped.set(root, arr);
  }

  // Build ordered groups
  const groups: ContinuousBeamGroup[] = [];
  let gCount = 0;

  for (const [, ids] of grouped) {
    if (ids.length < 2) continue;

    // Sort elements into a chain
    const sorted = sortChain(ids, beams, nodeMap);
    const totalLength = sorted.reduce((sum, id) => {
      const e = beams.find(el => el.id === id)!;
      const nI = nodeMap.get(e.nodeI)!, nJ = nodeMap.get(e.nodeJ)!;
      const dx = nJ.x - nI.x, dy = nJ.y - nI.y, dz = nJ.z - nI.z;
      return sum + Math.sqrt(dx * dx + dy * dy + dz * dz);
    }, 0);

    // Build ordered node list
    const orderedNodes: string[] = [];
    for (const id of sorted) {
      const e = beams.find(el => el.id === id)!;
      if (orderedNodes.length === 0) orderedNodes.push(e.nodeI);
      orderedNodes.push(e.nodeJ);
    }

    const dir = dirs.get(ids[0]) ?? [1, 0, 0] as [number, number, number];
    const groupId = `CBG${++gCount}`;

    // Tag classified nodes with their parent group
    for (const nodeId of orderedNodes) {
      const cn = classifiedNodes.get(nodeId);
      if (cn) cn.parentGroupId = groupId;
    }

    groups.push({
      groupId,
      segmentIds: sorted,
      totalLength,
      orderedNodeIds: orderedNodes,
      direction: dir,
    });
  }

  return groups;
}

/** Sort beam elements into a chain from one end to the other */
function sortChain(
  ids: string[],
  elements: ElementInfo[],
  nodeMap: Map<string, NodeInfo>,
): string[] {
  const elemsMap = new Map(ids.map(id => [id, elements.find(e => e.id === id)!]));

  // Count node appearances within the group
  const nodeCount = new Map<string, number>();
  for (const [, elem] of elemsMap) {
    nodeCount.set(elem.nodeI, (nodeCount.get(elem.nodeI) ?? 0) + 1);
    nodeCount.set(elem.nodeJ, (nodeCount.get(elem.nodeJ) ?? 0) + 1);
  }

  // Find an endpoint (degree 1 node)
  let startNode = '';
  for (const [nid, count] of nodeCount) {
    if (count === 1) { startNode = nid; break; }
  }
  if (!startNode) startNode = elemsMap.values().next().value!.nodeI;

  // Walk the chain
  const sorted: string[] = [];
  const used = new Set<string>();
  let current = startNode;

  while (sorted.length < ids.length) {
    let found = false;
    for (const [id, elem] of elemsMap) {
      if (used.has(id)) continue;
      if (elem.nodeI === current || elem.nodeJ === current) {
        sorted.push(id);
        used.add(id);
        current = elem.nodeI === current ? elem.nodeJ : elem.nodeI;
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  return sorted;
}

// ─── Step 5: Support Misdetection Prevention ─────────────────────────────────

/**
 * Determines whether a node should have restraints (be treated as a support).
 * 
 * CORRECTED LOGIC:
 * - A node is a support ONLY if it connects to a column OR is at a fixed boundary
 * - Internal beam-split nodes are NEVER supports
 * - Beam-to-beam intersection nodes are NOT supports (load transfer via stiffness matrix)
 */
export function shouldNodeBeRestrained(
  nodeId: string,
  classifiedNodes: Map<string, ClassifiedNode>,
): boolean {
  const cn = classifiedNodes.get(nodeId);
  if (!cn) return false;

  switch (cn.classification) {
    case 'columnNode':
      return true; // Connected to column → support
    case 'internalContinuity':
      return false; // Beam split artifact → NOT a support
    case 'beamIntersection':
      return false; // Beam-to-beam → NOT a support (stiffness matrix handles it)
    case 'slabEdgeNode':
      return false; // Edge node without column → not a support
    case 'freeEnd':
      return false;
    default:
      return false;
  }
}

// ─── Step 6: DOF Continuity Enforcement ──────────────────────────────────────

/**
 * Ensure that internal continuity nodes have NO releases applied.
 * 
 * At INTERNAL CONTINUITY NODES:
 * - All 6 DOFs (UX, UY, UZ, RX, RY, RZ) must be continuous
 * - No end releases, no partial fixity, no springs
 * - The beam behaves as if it was never split
 */
export function enforceBeamContinuity<T extends {
  id: string;
  nodeI: string;
  nodeJ: string;
  releases?: {
    nodeI: { ux?: boolean; uy?: boolean; uz?: boolean; mx: boolean; my: boolean; mz: boolean };
    nodeJ: { ux?: boolean; uy?: boolean; uz?: boolean; mx: boolean; my: boolean; mz: boolean };
  };
}>(
  elements: T[],
  classifiedNodes: Map<string, ClassifiedNode>,
): T[] {
  return elements.map(elem => {
    const cnI = classifiedNodes.get(elem.nodeI);
    const cnJ = classifiedNodes.get(elem.nodeJ);

    let releases = elem.releases;

    // If nodeI is an internal continuity node, clear releases at that end
    if (cnI?.isContinuityNode && releases) {
      releases = {
        ...releases,
        nodeI: { ux: false, uy: false, uz: false, mx: false, my: false, mz: false },
      };
    }

    // If nodeJ is an internal continuity node, clear releases at that end
    if (cnJ?.isContinuityNode && releases) {
      releases = {
        ...releases,
        nodeJ: { ux: false, uy: false, uz: false, mx: false, my: false, mz: false },
      };
    }

    return { ...elem, releases };
  });
}

// ─── Step 7: Solver Integration ──────────────────────────────────────────────

/**
 * Validate that the model has no duplicate nodes at the same coordinates.
 * This ensures the global stiffness matrix is correctly assembled.
 */
export function validateNodeUniqueness(
  nodes: NodeInfo[],
): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();

  for (const n of nodes) {
    const key = `${Math.round(n.x / COORD_TOL) * COORD_TOL},${Math.round(n.y / COORD_TOL) * COORD_TOL},${Math.round(n.z / COORD_TOL) * COORD_TOL}`;
    const existing = seen.get(key);
    if (existing && existing !== n.id) {
      errors.push(`Duplicate nodes at (${n.x}, ${n.y}, ${n.z}): ${existing} and ${n.id}`);
    }
    seen.set(key, n.id);
  }

  return errors;
}

// ─── Main Integration Function ───────────────────────────────────────────────

/**
 * Process a model to ensure beam continuity is preserved.
 * Call this BEFORE assembling the global stiffness matrix.
 * 
 * Returns:
 * - classifiedNodes: node classification map
 * - beamGroups: continuous beam groups for post-processing
 * - processedElements: elements with corrected releases
 * - validationErrors: any detected issues
 */
export function processBeamContinuity<T extends {
  id: string;
  nodeI: string;
  nodeJ: string;
  type: 'beam' | 'column';
  releases?: {
    nodeI: { ux?: boolean; uy?: boolean; uz?: boolean; mx: boolean; my: boolean; mz: boolean };
    nodeJ: { ux?: boolean; uy?: boolean; uz?: boolean; mx: boolean; my: boolean; mz: boolean };
  };
}>(
  nodes: NodeInfo[],
  elements: T[],
): {
  classifiedNodes: Map<string, ClassifiedNode>;
  beamGroups: ContinuousBeamGroup[];
  processedElements: T[];
  validationErrors: string[];
} {
  // Step 1: Classify nodes
  const classifiedNodes = classifyNodes(nodes, elements);

  // Step 4: Group continuous beams
  const beamGroups = groupContinuousBeams(elements, nodes, classifiedNodes);

  // Step 6: Enforce DOF continuity
  const processedElements = enforceBeamContinuity(elements, classifiedNodes);

  // Step 7: Validate node uniqueness
  const validationErrors = validateNodeUniqueness(nodes);

  return { classifiedNodes, beamGroups, processedElements, validationErrors };
}
