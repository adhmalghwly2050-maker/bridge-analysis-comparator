/**
 * ============================================================
 * PRE-ANALYSIS VALIDATION MODULE
 * ============================================================
 *
 * Runs BEFORE global stiffness matrix assembly to ensure model
 * integrity. Validates and corrects:
 *   1. Duplicate nodes (merge within tolerance)
 *   2. Connectivity (graph analysis)
 *   3. Dangling nodes (no connected elements)
 *   4. Zero-length elements
 *   5. DOF stability (supports exist, no free rigid body motion)
 *
 * Uses spatial hashing for O(n) performance on node merging.
 */

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

export interface ValidationNode {
  id: string;
  x: number;  // mm
  y: number;  // mm
  z: number;  // mm
  /** true = restrained (support) for each DOF */
  restraints: [boolean, boolean, boolean, boolean, boolean, boolean];
}

export interface ValidationElement {
  id: string;
  nodeI: string;  // start node id
  nodeJ: string;  // end node id
  type: 'beam' | 'column';
}

export interface ValidationIssue {
  type: 'duplicate_nodes' | 'disconnected_model' | 'dangling_nodes' | 'zero_length_elements' | 'no_supports' | 'unstable_system';
  count: number;
  details?: string[];
  components?: number;
}

export interface ValidationReport {
  status: 'ok' | 'warning' | 'error';
  issues: ValidationIssue[];
  /** Mapping from old node ID → merged node ID (for nodes that were merged) */
  mergedNodeMap: Map<string, string>;
  /** Node IDs that were removed (dangling) */
  removedDanglingNodes: string[];
  /** Element IDs that are zero-length (invalid) */
  zeroLengthElementIds: string[];
  /** Number of connected components */
  connectedComponents: number;
}

export interface ValidatedModel {
  nodes: ValidationNode[];
  elements: ValidationElement[];
  report: ValidationReport;
}

// ─────────────────────────────────────────────────────────────────
// 1) DUPLICATE NODES DETECTION & MERGING (Spatial Hashing)
// ─────────────────────────────────────────────────────────────────

/**
 * Merge geometrically identical or very close nodes using spatial hashing.
 * Tolerance = modelSize * 1e-6 (auto-computed from bounding box).
 *
 * Performance: O(n) average via spatial hash buckets.
 *
 * Assumptions:
 *   - Nodes with identical coordinates (within tolerance) represent
 *     the same physical point and should share DOFs.
 *   - When merging, we keep the first encountered node and update
 *     all element references to point to it.
 *   - If two merging nodes have different restraints, we OR them
 *     (a restrained DOF in either node stays restrained).
 */
export function mergeNodes(
  nodes: ValidationNode[],
  elements: ValidationElement[],
): { nodes: ValidationNode[]; elements: ValidationElement[]; mergedMap: Map<string, string>; mergedCount: number } {
  if (nodes.length === 0) return { nodes: [], elements: [], mergedMap: new Map(), mergedCount: 0 };

  // Compute model bounding box to determine tolerance
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    if (n.z < minZ) minZ = n.z; if (n.z > maxZ) maxZ = n.z;
  }
  const modelSize = Math.sqrt(
    (maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2
  );
  // Tolerance: model_size * 1e-6, minimum 0.01 mm
  const tol = Math.max(modelSize * 1e-6, 0.01);
  const tolSq = tol * tol;

  // Spatial hash buckets
  const bucketSize = tol;
  const buckets = new Map<string, ValidationNode[]>();
  const mergedMap = new Map<string, string>(); // oldId → keptId
  const keptNodes: ValidationNode[] = [];

  function bucketKey(x: number, y: number, z: number): string {
    return `${Math.floor(x / bucketSize)},${Math.floor(y / bucketSize)},${Math.floor(z / bucketSize)}`;
  }

  for (const node of nodes) {
    const bx = Math.floor(node.x / bucketSize);
    const by = Math.floor(node.y / bucketSize);
    const bz = Math.floor(node.z / bucketSize);

    let foundMatch: ValidationNode | null = null;

    // Check 3x3x3 neighbourhood
    outer:
    for (let ix = bx - 1; ix <= bx + 1; ix++) {
      for (let iy = by - 1; iy <= by + 1; iy++) {
        for (let iz = bz - 1; iz <= bz + 1; iz++) {
          const key = `${ix},${iy},${iz}`;
          const bucket = buckets.get(key);
          if (!bucket) continue;
          for (const existing of bucket) {
            const dx = existing.x - node.x;
            const dy = existing.y - node.y;
            const dz = existing.z - node.z;
            if (dx * dx + dy * dy + dz * dz <= tolSq) {
              foundMatch = existing;
              break outer;
            }
          }
        }
      }
    }

    if (foundMatch) {
      // Merge: map this node to the existing one
      mergedMap.set(node.id, foundMatch.id);
      // OR restraints: if either node has a restrained DOF, keep it restrained
      for (let d = 0; d < 6; d++) {
        if (node.restraints[d]) {
          foundMatch.restraints[d] = true;
        }
      }
    } else {
      // New unique node — keep it
      mergedMap.set(node.id, node.id);
      keptNodes.push({ ...node, restraints: [...node.restraints] as any });
      const key = bucketKey(node.x, node.y, node.z);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(keptNodes[keptNodes.length - 1]);
    }
  }

  const mergedCount = nodes.length - keptNodes.length;

  // Update element references
  const updatedElements = elements.map(el => ({
    ...el,
    nodeI: mergedMap.get(el.nodeI) || el.nodeI,
    nodeJ: mergedMap.get(el.nodeJ) || el.nodeJ,
  }));

  return { nodes: keptNodes, elements: updatedElements, mergedMap, mergedCount };
}

// ─────────────────────────────────────────────────────────────────
// 2) BUILD CONNECTIVITY (adjacency list)
// ─────────────────────────────────────────────────────────────────

/**
 * Build an adjacency list from elements.
 * Each node maps to a set of connected node IDs.
 */
export function buildConnectivity(
  nodes: ValidationNode[],
  elements: ValidationElement[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  // Initialize all nodes (even isolated ones)
  for (const n of nodes) {
    if (!adj.has(n.id)) adj.set(n.id, new Set());
  }
  for (const el of elements) {
    if (!adj.has(el.nodeI)) adj.set(el.nodeI, new Set());
    if (!adj.has(el.nodeJ)) adj.set(el.nodeJ, new Set());
    adj.get(el.nodeI)!.add(el.nodeJ);
    adj.get(el.nodeJ)!.add(el.nodeI);
  }
  return adj;
}

// ─────────────────────────────────────────────────────────────────
// 3) FIND DISCONNECTED COMPONENTS (BFS)
// ─────────────────────────────────────────────────────────────────

/**
 * Perform BFS to find connected components in the model graph.
 * Returns array of components, each being a set of node IDs.
 *
 * Assumption: Only nodes connected by elements are considered
 * part of the structural model.
 */
export function findDisconnectedComponents(
  adj: Map<string, Set<string>>,
): Set<string>[] {
  const visited = new Set<string>();
  const components: Set<string>[] = [];

  for (const nodeId of adj.keys()) {
    if (visited.has(nodeId)) continue;
    // BFS from this unvisited node
    const component = new Set<string>();
    const queue: string[] = [nodeId];
    visited.add(nodeId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.add(current);
      const neighbors = adj.get(current);
      if (neighbors) {
        for (const nb of neighbors) {
          if (!visited.has(nb)) {
            visited.add(nb);
            queue.push(nb);
          }
        }
      }
    }
    components.push(component);
  }

  return components;
}

// ─────────────────────────────────────────────────────────────────
// 4) DETECT DANGLING (UNCONNECTED) NODES
// ─────────────────────────────────────────────────────────────────

/**
 * Detect nodes that are not connected to any element.
 * Returns the IDs of dangling nodes.
 */
export function detectDanglingNodes(
  nodes: ValidationNode[],
  elements: ValidationElement[],
): string[] {
  const connectedNodeIds = new Set<string>();
  for (const el of elements) {
    connectedNodeIds.add(el.nodeI);
    connectedNodeIds.add(el.nodeJ);
  }
  return nodes.filter(n => !connectedNodeIds.has(n.id)).map(n => n.id);
}

// ─────────────────────────────────────────────────────────────────
// 5) ZERO-LENGTH ELEMENT CHECK
// ─────────────────────────────────────────────────────────────────

/**
 * Detect elements whose two nodes are at the same location (zero length).
 * Uses the same tolerance logic as mergeNodes.
 */
export function validateElements(
  nodes: ValidationNode[],
  elements: ValidationElement[],
): string[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Compute tolerance from model size
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    if (n.z < minZ) minZ = n.z; if (n.z > maxZ) maxZ = n.z;
  }
  const modelSize = Math.sqrt(
    (maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2
  );
  const tol = Math.max(modelSize * 1e-6, 0.01);

  const zeroLengthIds: string[] = [];
  for (const el of elements) {
    const nI = nodeMap.get(el.nodeI);
    const nJ = nodeMap.get(el.nodeJ);
    if (!nI || !nJ) {
      zeroLengthIds.push(el.id); // invalid reference = treat as error
      continue;
    }
    const dx = nJ.x - nI.x;
    const dy = nJ.y - nI.y;
    const dz = nJ.z - nI.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < tol) {
      zeroLengthIds.push(el.id);
    }
  }
  return zeroLengthIds;
}

// ─────────────────────────────────────────────────────────────────
// 6) DOF STABILITY / MECHANISM CHECK
// ─────────────────────────────────────────────────────────────────

/**
 * Basic stability check:
 *   - At least one support must exist (node with at least one restrained DOF)
 *   - Minimum 3 translational restraints to prevent rigid body motion in 3D
 *     (or 6 total to fully prevent rigid body motion)
 *
 * Assumption: A fully restrained support provides 6 DOF constraints.
 * Minimum for 3D stability: 6 independent restraints (3 translations + 3 rotations).
 * For practical structures, we check that at least 3 translational DOFs are restrained.
 */
function checkStability(nodes: ValidationNode[]): { stable: boolean; details: string[] } {
  const details: string[] = [];
  let totalRestrainedTranslations = 0;
  let totalRestrainedRotations = 0;
  let supportCount = 0;

  for (const n of nodes) {
    const hasAnyRestraint = n.restraints.some(r => r);
    if (hasAnyRestraint) supportCount++;
    // Translations: indices 0,1,2 (Ux, Uy, Uz)
    for (let d = 0; d < 3; d++) {
      if (n.restraints[d]) totalRestrainedTranslations++;
    }
    // Rotations: indices 3,4,5 (Rx, Ry, Rz)
    for (let d = 3; d < 6; d++) {
      if (n.restraints[d]) totalRestrainedRotations++;
    }
  }

  if (supportCount === 0) {
    details.push('No supports found — model has free rigid body motion');
    return { stable: false, details };
  }

  if (totalRestrainedTranslations < 3) {
    details.push(`Only ${totalRestrainedTranslations} translational DOFs restrained — need at least 3 for 3D stability`);
    return { stable: false, details };
  }

  // Warning if no rotational restraints (possible mechanism for some configurations)
  if (totalRestrainedRotations === 0) {
    details.push('No rotational restraints — possible mechanism for some load cases');
  }

  return { stable: true, details };
}

// ─────────────────────────────────────────────────────────────────
// 7) MAIN ENTRY POINT: runPreAnalysisChecks
// ─────────────────────────────────────────────────────────────────

/**
 * Execute the full pre-analysis validation pipeline:
 *   1. Merge duplicate nodes
 *   2. Rebuild element connectivity
 *   3. Remove dangling nodes
 *   4. Check zero-length elements
 *   5. Connectivity check (graph)
 *   6. Stability check
 *
 * Returns a validated model with cleaned nodes/elements and a report.
 * Does NOT modify solver logic — only prepares data for assembly.
 */
export function runPreAnalysisChecks(
  inputNodes: ValidationNode[],
  inputElements: ValidationElement[],
): ValidatedModel {
  const issues: ValidationIssue[] = [];
  let status: 'ok' | 'warning' | 'error' = 'ok';

  // ── Step 1: Merge duplicate nodes ──────────────────────────────
  const merged = mergeNodes(inputNodes, inputElements);
  let { nodes, elements } = merged;
  if (merged.mergedCount > 0) {
    issues.push({
      type: 'duplicate_nodes',
      count: merged.mergedCount,
      details: [`Merged ${merged.mergedCount} duplicate node(s) within tolerance`],
    });
    status = 'warning';
  }

  // ── Step 2: Rebuild connectivity ───────────────────────────────
  const adj = buildConnectivity(nodes, elements);

  // ── Step 3: Remove dangling nodes ──────────────────────────────
  const danglingIds = detectDanglingNodes(nodes, elements);
  if (danglingIds.length > 0) {
    issues.push({
      type: 'dangling_nodes',
      count: danglingIds.length,
      details: danglingIds.map(id => `Node ${id} is not connected to any element`),
    });
    status = 'warning';
    // Remove dangling nodes from the working set
    const danglingSet = new Set(danglingIds);
    nodes = nodes.filter(n => !danglingSet.has(n.id));
  }

  // ── Step 4: Check zero-length elements ─────────────────────────
  const zeroLengthIds = validateElements(nodes, elements);
  if (zeroLengthIds.length > 0) {
    issues.push({
      type: 'zero_length_elements',
      count: zeroLengthIds.length,
      details: zeroLengthIds.map(id => `Element ${id} has zero or near-zero length`),
    });
    status = 'error'; // Fatal — cannot assemble stiffness matrix
  }

  // ── Step 5: Connectivity check (graph) ─────────────────────────
  // Rebuild adjacency after removing dangling nodes
  const adjClean = buildConnectivity(nodes, elements);
  const components = findDisconnectedComponents(adjClean);
  const numComponents = components.length;
  if (numComponents > 1) {
    issues.push({
      type: 'disconnected_model',
      count: numComponents,
      components: numComponents,
      details: components.map((comp, i) =>
        `Component ${i + 1}: ${comp.size} node(s) — [${[...comp].slice(0, 5).join(', ')}${comp.size > 5 ? '...' : ''}]`
      ),
    });
    status = 'error';
  }

  // ── Step 6: Stability check ────────────────────────────────────
  const stability = checkStability(nodes);
  if (!stability.stable) {
    issues.push({
      type: 'no_supports',
      count: 1,
      details: stability.details,
    });
    status = 'error';
  } else if (stability.details.length > 0) {
    // Warnings from stability check
    issues.push({
      type: 'unstable_system',
      count: 0,
      details: stability.details,
    });
    if (status === 'ok') status = 'warning';
  }

  return {
    nodes,
    elements,
    report: {
      status,
      issues,
      mergedNodeMap: merged.mergedMap,
      removedDanglingNodes: danglingIds,
      zeroLengthElementIds: zeroLengthIds,
      connectedComponents: numComponents,
    },
  };
}
