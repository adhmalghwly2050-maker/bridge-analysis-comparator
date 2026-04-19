/**
 * Smart Beam Generation — Public API
 * ═══════════════════════════════════════════════════
 *
 * Usage:
 *
 *   import { generateBeamsFromSlabs } from '@/core/beamgen';
 *
 *   const result = generateBeamsFromSlabs(nodes, slabs, {
 *     minBeamLength: 0.3,
 *     mergeCollinear: true,
 *   });
 *
 *   console.log(result.beams);        // GeneratedBeam[]
 *   console.log(result.diagnostics);  // BeamGenDiagnostics
 */

export { generateBeamsFromSlabs, resetBeamIdCounter, DEFAULT_CONFIG } from './beamGenerator';
export { extractAndClassifyEdges, edgeKey, nodeDistance } from './edgeExtractor';
export { mergeCollinearEdges } from './collinearMerger';

export type {
  BGNode,
  BGSlab,
  BeamGenConfig,
  GeneratedBeam,
  BeamGenResult,
  BeamGenDiagnostics,
  RawEdge,
  EdgeClassification,
  BeamDirection,
} from './types';
