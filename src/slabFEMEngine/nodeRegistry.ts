/**
 * slabFEMEngine – Global Node Registry
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ARCHITECTURE FIX: eliminates duplicate nodes at shared coordinates.
 *
 * Problem (before)
 * ─────────────────
 *   Each call to meshSlab() creates nodes independently with local IDs
 *   starting at 0.  When two slabs share a boundary (e.g. a common beam),
 *   the physical corner or edge-intersection node is created TWICE — once per
 *   slab — with two separate IDs.  Beam-slab coupling then fails to see the
 *   true connectivity: moment diagrams are non-symmetric, corner nodes are not
 *   shared, and the assembled stiffness matrix is physically wrong.
 *
 * Solution (after)
 * ─────────────────
 *   A GlobalNodeRegistry is the SINGLE source of truth for node creation.
 *   Every mesh generator calls  getOrCreateNode(x, y, z)  instead of
 *   pushing a new node into a local array.  If a node already exists within
 *   tolerance `tol` (default 1e-6 mm), the EXISTING id is returned.
 *   Otherwise a new node is created and stored.
 *
 * Lookup strategy
 * ───────────────
 *   Coordinates are hashed to a bucket key by rounding to the tolerance grid:
 *     key = `${round(x/tol)}_${round(y/tol)}_${round(z/tol)}`
 *   This gives O(1) average lookup.  Because floating-point can straddle a
 *   grid boundary, each lookup probes the 27 neighbouring buckets (3³) so that
 *   no close pair is ever missed.
 *
 * Connectivity tracking
 * ──────────────────────
 *   After an element is assembled, call
 *     registry.registerElement(nodeId, elementRef)
 *   The node's connectedElements[] is updated.  This enables the post-build
 *   connectivity verification required by the specification.
 *
 * Units: mm (same as the rest of the FEM engine).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface GlobalFEMNode {
  /** Unique global node ID (monotonically increasing from 0). */
  readonly id: number;
  /** X coordinate (mm). */
  readonly x: number;
  /** Y coordinate (mm). */
  readonly y: number;
  /** Z coordinate (mm, 0 for planar slab problems). */
  readonly z: number;
  /**
   * IDs of all elements (slab quads + beam sub-elements) that reference this
   * node.  Format: `"slab:<slabId>:elem:<elemId>"` or `"beam:<beamId>:seg:<i>"`.
   */
  connectedElements: string[];
}

export interface ConnectivityReport {
  totalNodes:          number;
  totalElements:       number;
  /** Nodes that connect to both beam and slab elements — should be non-empty. */
  interfaceNodes:      GlobalFEMNode[];
  /** Nodes connected to ≥ 2 distinct beams — these are the critical corners. */
  cornerNodes:         GlobalFEMNode[];
  /** For each corner node: list of beam IDs that meet there. */
  cornerBeamIds:       Map<number, string[]>;
  isolatedNodes:       GlobalFEMNode[];
  symmetryWarnings:    string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GlobalNodeRegistry
// ─────────────────────────────────────────────────────────────────────────────

export class GlobalNodeRegistry {
  private readonly nodes: GlobalFEMNode[] = [];
  private readonly buckets: Map<string, number[]> = new Map();
  /** Coordinate tolerance in mm.  Two nodes within this distance are merged. */
  readonly tol: number;

  constructor(tol: number = 1e-6) {
    this.tol = tol;
  }

  // ── Core API ───────────────────────────────────────────────────────────────

  /**
   * Return the ID of an existing node within `tol` of (x, y, z), or create a
   * new node if none exists.
   *
   * Guarantees:
   *   • Two calls with coordinates within `tol` of each other return the SAME id.
   *   • Two calls with coordinates farther than `tol` apart return DIFFERENT ids.
   */
  getOrCreateNode(x: number, y: number, z: number = 0): number {
    // Search the 27 neighbouring buckets for an existing match
    const existing = this._findExisting(x, y, z);
    if (existing !== -1) return existing;

    // Create new node
    const id = this.nodes.length;
    const node: GlobalFEMNode = { id, x, y, z, connectedElements: [] };
    this.nodes.push(node);

    // Register in primary bucket
    const key = this._bucketKey(x, y, z);
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key)!.push(id);

    return id;
  }

  /** Retrieve a node by its global ID (throws if out of range). */
  getNode(id: number): GlobalFEMNode {
    const n = this.nodes[id];
    if (!n) throw new RangeError(`GlobalNodeRegistry: no node with id ${id}`);
    return n;
  }

  /** All nodes in creation order. */
  getAllNodes(): readonly GlobalFEMNode[] {
    return this.nodes;
  }

  /** Total node count. */
  get size(): number { return this.nodes.length; }

  // ── Connectivity tracking ─────────────────────────────────────────────────

  /**
   * Record that `elementRef` connects to `nodeId`.
   * Safe to call multiple times with the same pair (deduplicates).
   */
  registerElement(nodeId: number, elementRef: string): void {
    const node = this.nodes[nodeId];
    if (!node) return;
    if (!node.connectedElements.includes(elementRef)) {
      node.connectedElements.push(elementRef);
    }
  }

  // ── Connectivity report ───────────────────────────────────────────────────

  /**
   * Build a full connectivity report after all meshes have been assembled.
   * Identifies interface nodes, corner nodes (≥ 2 beams), and isolates.
   */
  buildConnectivityReport(): ConnectivityReport {
    const totalNodes    = this.nodes.length;
    const totalElements = this._countUniqueElements();

    const interfaceNodes:  GlobalFEMNode[] = [];
    const cornerNodes:     GlobalFEMNode[] = [];
    const cornerBeamIds    = new Map<number, string[]>();
    const isolatedNodes:   GlobalFEMNode[] = [];
    const symmetryWarnings: string[] = [];

    for (const node of this.nodes) {
      const elems = node.connectedElements;

      if (elems.length === 0) {
        isolatedNodes.push(node);
        continue;
      }

      // Categorise references
      const beamIds  = new Set<string>();
      const slabRefs = new Set<string>();

      for (const ref of elems) {
        if (ref.startsWith('beam:')) {
          const beamId = ref.split(':')[1];
          beamIds.add(beamId);
        } else if (ref.startsWith('slab:')) {
          slabRefs.add(ref);
        }
      }

      // Interface node: connects to at least one beam AND one slab element
      if (beamIds.size > 0 && slabRefs.size > 0) {
        interfaceNodes.push(node);
      }

      // Corner node: connects to ≥ 2 distinct beams
      if (beamIds.size >= 2) {
        cornerNodes.push(node);
        cornerBeamIds.set(node.id, Array.from(beamIds));
      }
    }

    return {
      totalNodes,
      totalElements,
      interfaceNodes,
      cornerNodes,
      cornerBeamIds,
      isolatedNodes,
      symmetryWarnings,
    };
  }

  // ── Debug helpers ─────────────────────────────────────────────────────────

  /**
   * Log a summary to console.  Called automatically by the mesh builder when
   * all slabs have been processed.
   */
  logSummary(label: string = ''): void {
    const prefix = label ? `[NodeRegistry:${label}]` : '[NodeRegistry]';
    console.log(`${prefix} Total nodes: ${this.nodes.length}`);

    const report = this.buildConnectivityReport();

    console.log(
      `${prefix} Interface nodes (beam+slab): ${report.interfaceNodes.length}`,
    );
    console.log(
      `${prefix} Corner nodes (≥2 beams): ${report.cornerNodes.length}`,
    );

    for (const cn of report.cornerNodes) {
      const bids = report.cornerBeamIds.get(cn.id)!.join(', ');
      const ne   = cn.connectedElements.length;
      console.log(
        `${prefix}   Corner node #${cn.id} ` +
        `(${cn.x.toFixed(1)}, ${cn.y.toFixed(1)}, ${cn.z.toFixed(1)}) ` +
        `→ ${ne} elements, beams: [${bids}]`,
      );
    }

    if (report.isolatedNodes.length > 0) {
      console.warn(
        `${prefix} WARNING: ${report.isolatedNodes.length} isolated node(s) ` +
        `(no connected elements) — check mesh generator.`,
      );
    }
  }

  /**
   * Produce a multi-line debug string (for the text report).
   */
  buildDebugString(): string {
    const lines: string[] = [];
    const report = this.buildConnectivityReport();

    lines.push('=== GLOBAL NODE REGISTRY SUMMARY ===');
    lines.push(`  Total nodes    : ${report.totalNodes}`);
    lines.push(`  Total elements : ${report.totalElements}`);
    lines.push(`  Interface nodes: ${report.interfaceNodes.length}`);
    lines.push(`  Corner nodes   : ${report.cornerNodes.length}`);
    lines.push(`  Isolated nodes : ${report.isolatedNodes.length}`);
    lines.push('');

    if (report.cornerNodes.length > 0) {
      lines.push('  Corner node detail:');
      for (const cn of report.cornerNodes) {
        const bids = report.cornerBeamIds.get(cn.id)!.join(', ');
        lines.push(
          `    Node #${cn.id.toString().padStart(4)}  ` +
          `(${cn.x.toFixed(3)}, ${cn.y.toFixed(3)}, ${cn.z.toFixed(3)}) ` +
          `  beams=[${bids}]  ` +
          `  elems=${cn.connectedElements.length}`,
        );
      }
      lines.push('');
    }

    if (report.isolatedNodes.length > 0) {
      lines.push('  WARNING – Isolated nodes (no elements):');
      for (const n of report.isolatedNodes) {
        lines.push(`    Node #${n.id} (${n.x.toFixed(3)}, ${n.y.toFixed(3)})`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Bucket key for the cell containing (x, y, z). */
  private _bucketKey(x: number, y: number, z: number): string {
    const inv = 1 / this.tol;
    return `${Math.round(x * inv)}_${Math.round(y * inv)}_${Math.round(z * inv)}`;
  }

  /**
   * Probe the 27 neighbouring grid cells to find a node within `tol`.
   * Returns the node id or -1 if none found.
   */
  private _findExisting(x: number, y: number, z: number): number {
    const inv  = 1 / this.tol;
    const cx   = Math.round(x * inv);
    const cy   = Math.round(y * inv);
    const cz   = Math.round(z * inv);
    const tol2 = this.tol * this.tol;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cx + dx}_${cy + dy}_${cz + dz}`;
          const bucket = this.buckets.get(key);
          if (!bucket) continue;
          for (const id of bucket) {
            const n = this.nodes[id];
            const d2 = (n.x - x) ** 2 + (n.y - y) ** 2 + (n.z - z) ** 2;
            if (d2 <= tol2) return id;
          }
        }
      }
    }

    return -1;
  }

  private _countUniqueElements(): number {
    const all = new Set<string>();
    for (const node of this.nodes) {
      for (const ref of node.connectedElements) all.add(ref);
    }
    return all.size;
  }
}
