/**
 * Smart Beam Generation — Types
 * ═══════════════════════════════════════════════════
 * Pure data types for the beam-from-slabs extraction engine.
 */

// ─── Input Types ─────────────────────────────────────────────────────────────

export interface BGNode {
  id: string;
  x: number;   // any consistent unit (m or mm)
  y: number;
  z: number;
}

export interface BGSlab {
  id: string;
  /** Ordered polygon node IDs (3+ nodes, closed implicitly). */
  nodeIds: string[];
  thickness?: number;
}

export interface BeamGenConfig {
  /** Minimum beam length — edges shorter than this are skipped. Default 0.1 */
  minBeamLength: number;
  /** Collinearity angle tolerance in radians. Default 0.01 (~0.57°) */
  collinearTolerance: number;
  /** Geometric coordinate tolerance for node matching. Default 1e-4 */
  coordTolerance: number;
  /** Whether to merge collinear edges into longer beams. Default true */
  mergeCollinear: boolean;
  /** Whether to tag beam direction (X/Y/DIAGONAL). Default true */
  tagDirection: boolean;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

export type EdgeClassification = 'perimeter' | 'internal' | 'complex';
export type BeamDirection = 'X' | 'Y' | 'DIAGONAL';

export interface RawEdge {
  /** Normalized key: "minId::maxId" */
  key: string;
  nodeA: string;
  nodeB: string;
  /** IDs of slabs that share this edge. */
  slabIds: string[];
  length: number;
  classification: EdgeClassification;
}

// ─── Output Types ────────────────────────────────────────────────────────────

export interface GeneratedBeam {
  id: string;
  startNode: string;
  endNode: string;
  length: number;
  classification: EdgeClassification;
  direction: BeamDirection;
  /** IDs of slabs adjacent to this beam. */
  adjacentSlabIds: string[];
  /** If this beam was created by merging collinear edges, their keys. */
  mergedFromEdges?: string[];
}

export interface BeamGenDiagnostics {
  totalEdgesExtracted: number;
  perimeterEdges: number;
  internalEdges: number;
  complexEdges: number;
  skippedShortEdges: number;
  mergedEdgeGroups: number;
  generatedBeams: number;
  validationErrors: string[];
}

export interface BeamGenResult {
  beams: GeneratedBeam[];
  diagnostics: BeamGenDiagnostics;
}
