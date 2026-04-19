/**
 * Smart Beam Generation — Main Engine
 * ═══════════════════════════════════════════════════
 * Orchestrates the full pipeline:
 *   1. Extract edges from slab polygons
 *   2. Classify edges (perimeter / internal)
 *   3. Filter short edges
 *   4. Merge collinear edges
 *   5. Generate beam elements
 *   6. Validate output
 *
 * All logic is pure — no UI, no side effects.
 */

import type {
  BGNode, BGSlab, BeamGenConfig,
  GeneratedBeam, BeamGenResult, BeamGenDiagnostics,
  BeamDirection,
} from './types';
import { extractAndClassifyEdges, nodeDistance } from './edgeExtractor';
import { mergeCollinearEdges } from './collinearMerger';

// ─── Default Config ──────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: BeamGenConfig = {
  minBeamLength: 0.1,
  collinearTolerance: 0.01,
  coordTolerance: 1e-4,
  mergeCollinear: true,
  tagDirection: true,
};

// ─── Direction Tagging ───────────────────────────────────────────────────────

/**
 * Classify beam direction based on the angle between its two nodes.
 * X: nearly horizontal (|dy| < |dx| × tan(15°))
 * Y: nearly vertical
 * DIAGONAL: anything else
 */
function classifyDirection(
  nA: BGNode,
  nB: BGNode,
): BeamDirection {
  const dx = Math.abs(nB.x - nA.x);
  const dy = Math.abs(nB.y - nA.y);
  const threshold = 0.268; // tan(15°)

  if (dx < 1e-12 && dy < 1e-12) return 'X'; // degenerate
  if (dy <= dx * threshold) return 'X';
  if (dx <= dy * threshold) return 'Y';
  return 'DIAGONAL';
}

// ─── Beam ID Generator ──────────────────────────────────────────────────────

let _beamIdCounter = 0;

/** Reset counter (useful for testing). */
export function resetBeamIdCounter(): void {
  _beamIdCounter = 0;
}

function nextBeamId(): string {
  return `beam-auto-${++_beamIdCounter}`;
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateBeams(
  beams: GeneratedBeam[],
  nodeMap: Map<string, BGNode>,
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const beam of beams) {
    // Check nodes exist
    if (!nodeMap.has(beam.startNode)) {
      errors.push(`Beam ${beam.id}: startNode "${beam.startNode}" not found`);
    }
    if (!nodeMap.has(beam.endNode)) {
      errors.push(`Beam ${beam.id}: endNode "${beam.endNode}" not found`);
    }

    // Check zero-length
    if (beam.length < 1e-12) {
      errors.push(`Beam ${beam.id}: zero-length beam`);
    }

    // Check self-referencing
    if (beam.startNode === beam.endNode) {
      errors.push(`Beam ${beam.id}: startNode === endNode`);
    }

    // Check duplicates
    const dupKey = beam.startNode < beam.endNode
      ? `${beam.startNode}::${beam.endNode}`
      : `${beam.endNode}::${beam.startNode}`;
    if (seen.has(dupKey)) {
      errors.push(`Beam ${beam.id}: duplicate of edge ${dupKey}`);
    }
    seen.add(dupKey);
  }

  return errors;
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * Generate beam elements from slab topology.
 *
 * @param nodes  All structural nodes
 * @param slabs  All slabs (arbitrary polygons with ordered nodeIds)
 * @param config Optional configuration overrides
 * @returns      Generated beams + diagnostics
 */
export function generateBeamsFromSlabs(
  nodes: BGNode[],
  slabs: BGSlab[],
  config?: Partial<BeamGenConfig>,
): BeamGenResult {
  const cfg: BeamGenConfig = { ...DEFAULT_CONFIG, ...config };

  // Build node lookup
  const nodeMap = new Map<string, BGNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // ── Step 1+2: Extract & classify edges ──────────────────────────────────
  const rawEdges = extractAndClassifyEdges(nodes, slabs);

  const diagBase = {
    totalEdgesExtracted: rawEdges.length,
    perimeterEdges: rawEdges.filter(e => e.classification === 'perimeter').length,
    internalEdges: rawEdges.filter(e => e.classification === 'internal').length,
    complexEdges: rawEdges.filter(e => e.classification === 'complex').length,
  };

  // ── Step 3: Filter short edges ──────────────────────────────────────────
  const filtered = rawEdges.filter(e => e.length >= cfg.minBeamLength);
  const skippedShort = rawEdges.length - filtered.length;

  // ── Step 4: Merge collinear edges ───────────────────────────────────────
  const { merged, mergedGroupCount } = mergeCollinearEdges(filtered, nodeMap, cfg);

  // ── Step 5: Generate beam objects ───────────────────────────────────────
  const beams: GeneratedBeam[] = [];

  for (const seg of merged) {
    const nA = nodeMap.get(seg.startNode);
    const nB = nodeMap.get(seg.endNode);
    if (!nA || !nB) continue;

    const direction: BeamDirection = cfg.tagDirection
      ? classifyDirection(nA, nB)
      : 'X';

    beams.push({
      id: nextBeamId(),
      startNode: seg.startNode,
      endNode: seg.endNode,
      length: seg.length,
      classification: seg.classification,
      direction,
      adjacentSlabIds: seg.slabIds,
      mergedFromEdges: seg.sourceEdgeKeys.length > 1 ? seg.sourceEdgeKeys : undefined,
    });
  }

  // ── Step 6: Validate ────────────────────────────────────────────────────
  const validationErrors = validateBeams(beams, nodeMap);

  const diagnostics: BeamGenDiagnostics = {
    ...diagBase,
    skippedShortEdges: skippedShort,
    mergedEdgeGroups: mergedGroupCount,
    generatedBeams: beams.length,
    validationErrors,
  };

  return { beams, diagnostics };
}
