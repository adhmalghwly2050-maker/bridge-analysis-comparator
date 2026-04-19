/**
 * slabFEMEngine – Mesh Generator (Phase 1)
 *
 * Produces a structured quadrilateral mesh for each rectangular slab.
 *
 * Key constraint: beam lines MUST coincide with element edges so that
 * edge forces can be extracted exactly along the slab-beam interface.
 *
 * Algorithm
 * ---------
 * 1. Collect "required" X and Y grid lines:
 *      - Slab boundary coordinates (x1, x2, y1, y2)
 *      - Any beam that lies ON the slab boundary or passes through it
 * 2. Fill gaps between required lines with additional divisions so that
 *    no segment exceeds (slabSize / meshDensity).
 * 3. Build node grid from the resulting (xLines × yLines) intersections.
 *    ► ALWAYS call registry.getOrCreateNode() — never push a raw node directly.
 *      This guarantees that two elements meeting at the same (x,y) coordinate
 *      use EXACTLY THE SAME global node ID (the fundamental topology invariant).
 * 4. Mark nodes:
 *      - isFixed = true  → column sits at this point
 *      - beamId          → node lies on a beam line edge
 *
 * Node ID semantics
 * ─────────────────
 *   node.id       – local array index within this slab mesh (0 … nNodes-1).
 *                   Used by the existing per-slab assembler for DOF indexing.
 *   node.globalId – ID assigned by GlobalNodeRegistry.  Identical to node.id
 *                   when a private (slab-local) registry is used.  When a
 *                   SHARED registry is passed in, globalId is unique across all
 *                   slabs — two nodes at the same physical location in different
 *                   slabs will have the SAME globalId.
 */

import type { Slab, Beam, Column } from './types';
import type { FEMNode, FEMElement, SlabMesh } from './types';
import { GlobalNodeRegistry } from './nodeRegistry';

const EPS = 1e-3; // mm tolerance for coordinate matching

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mesh a single slab.
 *
 * @param slab         Slab geometry (mm coords when called from the FEM engine)
 * @param beams        All beams in the model (filtered internally by slab.id)
 * @param columns      All columns (used for node classification)
 * @param meshDensity  Divisions per metre (default 4 → ~250 mm/div)
 * @param registry     Optional shared GlobalNodeRegistry.  When provided, nodes
 *                     at coordinates already registered by a PREVIOUS slab call
 *                     will reuse the existing global ID instead of creating a
 *                     duplicate.  When omitted, a private local registry is
 *                     created — behaviour is identical to the pre-fix code.
 */
export function meshSlab(
  slab:         Slab,
  beams:        Beam[],
  columns:      Column[],
  meshDensity:  number = 4,
  registry?:    GlobalNodeRegistry,
): SlabMesh {
  // Use the supplied registry or create a private one for this slab alone.
  // A private registry means globalId === id (backward-compatible behaviour).
  const reg = registry ?? new GlobalNodeRegistry(EPS);

  const x1 = Math.min(slab.x1, slab.x2);
  const x2 = Math.max(slab.x1, slab.x2);
  const y1 = Math.min(slab.y1, slab.y2);
  const y2 = Math.max(slab.y1, slab.y2);

  // Max segment length based on density (density is divisions/m → mm conversion)
  const maxSeg = Math.max(1000 / meshDensity, 100); // mm (min 100 mm)

  // ── Step 1: Collect required grid lines ──────────────────────────────────

  const xRequired = new Set<number>([x1, x2]);
  const yRequired = new Set<number>([y1, y2]);

  for (const beam of beams) {
    if (!beam.slabs.includes(slab.id)) continue;

    if (beam.direction === 'horizontal') {
      const by = beam.y1;
      if (by >= y1 - EPS && by <= y2 + EPS) {
        yRequired.add(clamp(by, y1, y2));
      }
    } else {
      const bx = beam.x1;
      if (bx >= x1 - EPS && bx <= x2 + EPS) {
        xRequired.add(clamp(bx, x1, x2));
      }
    }
  }

  // ── Step 2: Fill gaps between required lines ─────────────────────────────

  const xLines = fillDivisions(sortSet(xRequired), maxSeg);
  const yLines = fillDivisions(sortSet(yRequired), maxSeg);

  const nx = xLines.length - 1; // number of elements in X
  const ny = yLines.length - 1; // number of elements in Y

  // ── Step 3: Build node grid ───────────────────────────────────────────────
  //
  //   ► CRITICAL: use reg.getOrCreateNode() for EVERY node.
  //     The registry guarantees that two mesh generators meeting at the same
  //     physical coordinate return the SAME globalId — no duplicate nodes.

  const nodes: FEMNode[] = [];

  // localIndex maps grid position → local array index (used for element connectivity)
  const localIndex = (ix: number, iy: number) => iy * (nx + 1) + ix;

  for (let iy = 0; iy <= ny; iy++) {
    for (let ix = 0; ix <= nx; ix++) {
      const x = xLines[ix];
      const y = yLines[iy];

      // ── Classify node ────────────────────────────────────────────────────

      const atColumn = columns.some(
        c => Math.abs(c.x - x) < EPS && Math.abs(c.y - y) < EPS,
      );

      let beamId: string | null = null;
      let beamPos = 0;

      for (const beam of beams) {
        if (!beam.slabs.includes(slab.id)) continue;

        if (beam.direction === 'horizontal') {
          const by = beam.y1;
          if (Math.abs(y - by) < EPS) {
            const bx1 = Math.min(beam.x1, beam.x2);
            const bx2 = Math.max(beam.x1, beam.x2);
            if (x >= bx1 - EPS && x <= bx2 + EPS) {
              beamId  = beam.id;
              beamPos = beam.length > 0 ? (x - bx1) / (bx2 - bx1) : 0;
              break;
            }
          }
        } else {
          const bx = beam.x1;
          if (Math.abs(x - bx) < EPS) {
            const by1 = Math.min(beam.y1, beam.y2);
            const by2 = Math.max(beam.y1, beam.y2);
            if (y >= by1 - EPS && y <= by2 + EPS) {
              beamId  = beam.id;
              beamPos = beam.length > 0 ? (y - by1) / (by2 - by1) : 0;
              break;
            }
          }
        }
      }

      const onBoundary =
        Math.abs(x - x1) < EPS || Math.abs(x - x2) < EPS ||
        Math.abs(y - y1) < EPS || Math.abs(y - y2) < EPS;

      const onBeamLine = beamId !== null;

      // ── Get-or-create via registry (THE topology fix) ─────────────────────
      const gid = reg.getOrCreateNode(x, y, 0);

      const localId = localIndex(ix, iy);
      nodes.push({
        id:       localId,
        globalId: gid,
        x,
        y,
        isFixed:  atColumn || onBoundary || onBeamLine,
        atColumn,
        beamId,
        beamPos,
      });
    }
  }

  // ── Step 4: Build elements and register connectivity ──────────────────────

  const elements: FEMElement[] = [];
  let elemId = 0;

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      // CCW ordering: n0=BL, n1=BR, n2=TR, n3=TL
      const n0 = localIndex(ix,     iy    );
      const n1 = localIndex(ix + 1, iy    );
      const n2 = localIndex(ix + 1, iy + 1);
      const n3 = localIndex(ix,     iy + 1);

      const elemRef = `slab:${slab.id}:elem:${elemId}`;

      elements.push({
        id:      elemId++,
        nodeIds: [n0, n1, n2, n3],
        slabId:  slab.id,
      });

      // Register connectivity: each quad touches 4 nodes
      reg.registerElement(nodes[n0].globalId, elemRef);
      reg.registerElement(nodes[n1].globalId, elemRef);
      reg.registerElement(nodes[n2].globalId, elemRef);
      reg.registerElement(nodes[n3].globalId, elemRef);
    }
  }

  // Register beam-segment connectivity for all beam nodes in this slab.
  //
  // CRITICAL: use GEOMETRIC proximity to find beam nodes — NOT n.beamId === beam.id.
  // Reason: corner nodes (e.g. at the intersection of a horizontal and a vertical
  // boundary beam) are assigned beamId = <first beam found> by the classification
  // loop above.  That loop breaks on the first match, so a corner like (0, 0) ends
  // up with beamId='B-south' even though it physically lies on BOTH B-south and
  // B-west.  If we filter by beamId alone, B-west's node list will miss both its
  // corner nodes (giving 19 instead of 21 for a 5 × 5 slab at density 4), breaking
  // symmetry and leaving corner nodes with only one beam in their connectedElements.
  //
  // Solution: for each beam, gather ALL mesh nodes that satisfy the geometric
  // on-beam predicate, regardless of which beam "won" in the beamId assignment.
  // Sort by coordinate position along the beam axis for correct segment ordering.
  for (const beam of beams) {
    if (!beam.slabs.includes(slab.id)) continue;

    const bx1 = Math.min(beam.x1, beam.x2);
    const bx2 = Math.max(beam.x1, beam.x2);
    const by1 = Math.min(beam.y1, beam.y2);
    const by2 = Math.max(beam.y1, beam.y2);

    // Geometric predicate: is this node physically on the beam?
    function nodeOnBeam(n: FEMNode): boolean {
      if (beam.direction === 'horizontal') {
        return (
          Math.abs(n.y - beam.y1) < EPS &&
          n.x >= bx1 - EPS && n.x <= bx2 + EPS
        );
      } else {
        return (
          Math.abs(n.x - beam.x1) < EPS &&
          n.y >= by1 - EPS && n.y <= by2 + EPS
        );
      }
    }

    // Collect & sort along beam axis (x for horizontal, y for vertical)
    const beamNodes = nodes
      .filter(nodeOnBeam)
      .sort((a, b) =>
        beam.direction === 'horizontal' ? a.x - b.x : a.y - b.y,
      );

    for (let si = 0; si < beamNodes.length - 1; si++) {
      const segRef = `beam:${beam.id}:seg:${si}`;
      reg.registerElement(beamNodes[si].globalId, segRef);
      reg.registerElement(beamNodes[si + 1].globalId, segRef);
    }
  }

  return { slabId: slab.id, nodes, elements, xLines, yLines };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortSet(s: Set<number>): number[] {
  return Array.from(s).sort((a, b) => a - b);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Given a sorted list of "required" positions, insert intermediate divisions
 * so that no gap exceeds `maxSegLen`.
 */
function fillDivisions(required: number[], maxSegLen: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < required.length; i++) {
    result.push(required[i]);
    if (i < required.length - 1) {
      const gap = required[i + 1] - required[i];
      if (gap > maxSegLen + EPS) {
        const n = Math.ceil(gap / maxSegLen);
        for (let k = 1; k < n; k++) {
          result.push(required[i] + (gap * k) / n);
        }
      }
    }
  }
  return result;
}

// ─── Utility: mesh info string ────────────────────────────────────────────────

export function meshSummary(mesh: SlabMesh): string {
  return (
    `Slab ${mesh.slabId}: ` +
    `${mesh.xLines.length - 1} × ${mesh.yLines.length - 1} elements, ` +
    `${mesh.nodes.length} nodes`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-slab mesh builder with shared registry
// ─────────────────────────────────────────────────────────────────────────────

export interface MultiSlabMesh {
  /** Per-slab mesh objects (node.id is slab-local, node.globalId is global). */
  slabMeshes:  SlabMesh[];
  /** The shared registry used to build all meshes. */
  registry:    GlobalNodeRegistry;
  /**
   * Before-registry node count (one independent count per slab).
   * before[i] = nodes that would have been created for slab i in isolation.
   */
  beforeCounts: number[];
  /**
   * After-registry global node count.  If any nodes are shared across slabs,
   * this will be LESS than sum(beforeCounts).
   */
  afterCount:  number;
}

/**
 * Mesh ALL slabs using a single shared GlobalNodeRegistry.
 *
 * Any two nodes at the same (x, y) coordinate — even if they belong to
 * different slabs — are assigned the SAME globalId.  This is the prerequisite
 * for a physically correct multi-slab global stiffness assembly.
 *
 * @param slabs       All slabs in the model
 * @param beams       All beams (filtered per slab internally)
 * @param columns     All columns
 * @param meshDensity Divisions per metre
 * @returns           MultiSlabMesh with shared registry and per-slab meshes
 */
export function meshMultipleSlabs(
  slabs:       Slab[],
  beams:       Beam[],
  columns:     Column[],
  meshDensity: number = 4,
): MultiSlabMesh {
  const registry     = new GlobalNodeRegistry(EPS);
  const slabMeshes:   SlabMesh[] = [];
  const beforeCounts: number[] = [];

  for (const slab of slabs) {
    // Count nodes that a private registry would have created (for reporting)
    const privateReg = new GlobalNodeRegistry(EPS);
    const privMesh   = meshSlab(slab, beams, columns, meshDensity, privateReg);
    beforeCounts.push(privMesh.nodes.length);

    // Mesh with the SHARED registry
    const mesh = meshSlab(slab, beams, columns, meshDensity, registry);
    slabMeshes.push(mesh);
  }

  registry.logSummary('multiSlab');

  return {
    slabMeshes,
    registry,
    beforeCounts,
    afterCount: registry.size,
  };
}
