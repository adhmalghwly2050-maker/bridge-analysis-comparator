/**
 * Core Analysis Controller
 * ═══════════════════════════════════════════════════════════════
 * Main entry point for the unified structural analysis core.
 *
 * Pipeline:
 *   Model Input → Geometry Processing → Meshing → Global Assembly
 *   → Boundary Conditions → Solve KU=F → Post Processing → Results
 *
 * Feature flag: useUnifiedCore allows switching between
 * legacy solvers and the new unified core.
 */

import type { StructuralModel } from './model/types';
import type { AnalysisResult } from './postprocess/resultProcessor';
import { processGeometry } from './geometry/geometryProcessor';
import { assembleGlobalSystem } from './assembly/globalAssembler';
import { distributeSlabLoads, applySlabLoadsToForceVector } from './assembly/slabLoadDistributor';
import { processBoundaryConditions, extractReducedSystem, expandSolution } from './solver/boundaryProcessor';
import { solve } from './solver/globalSolver';
import { processResults } from './postprocess/resultProcessor';

export interface AnalysisConfig {
  /** Use the new unified core (true) or legacy solvers (false). */
  useUnifiedCore: boolean;
  /** Node merge tolerance in mm. */
  mergeTolerance?: number;
  /** Solver method: 'auto', 'cholesky', or 'cg'. */
  solverMethod?: 'auto' | 'cholesky' | 'cg';
}

const DEFAULT_CONFIG: AnalysisConfig = {
  useUnifiedCore: true,
  mergeTolerance: 1.0,
  solverMethod: 'auto',
};

/**
 * Run a complete structural analysis on the given model.
 */
export function runAnalysis(
  model: StructuralModel,
  config: Partial<AnalysisConfig> = {},
): AnalysisResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Step 1: Geometry processing (node merging, connectivity)
  const processed = processGeometry(model, cfg.mergeTolerance);

  // Step 2: Global assembly
  const assembly = assembleGlobalSystem(processed.model);

  // Step 3: Distribute loads from LOAD_ONLY slabs
  const slabLoadDist = distributeSlabLoads(processed.model);
  applySlabLoadsToForceVector(assembly.F, slabLoadDist, assembly.dofMap);

  // Step 4: Boundary conditions
  const boundary = processBoundaryConditions(
    processed.model.nodes,
    assembly.dofMap,
  );

  // Step 5: Extract reduced system
  const { Kff, Ff } = extractReducedSystem(
    assembly.K, assembly.F, assembly.totalDOF, boundary,
  );

  // Step 6: Solve KU = F
  const nFree = boundary.freeDOFs.length;
  if (nFree === 0) {
    // Fully constrained – all displacements are zero
    const U = new Float64Array(assembly.totalDOF);
    return processResults(U, processed.model, assembly, boundary);
  }

  const solverResult = solve(Kff, Ff, nFree, {
    method: cfg.solverMethod,
  });

  // Step 7: Expand to full DOF vector
  const U = expandSolution(solverResult.U, assembly.totalDOF, boundary);

  // Step 8: Post-process results
  return processResults(U, processed.model, assembly, boundary);
}

/**
 * Convenience: run analysis and return summary string.
 */
export function runAnalysisSummary(
  model: StructuralModel,
  config?: Partial<AnalysisConfig>,
): string {
  const result = runAnalysis(model, config);

  const maxDisp = result.nodalDisplacements.reduce(
    (max, d) => Math.max(max, Math.abs(d.ux), Math.abs(d.uy), Math.abs(d.uz)),
    0,
  );

  const totalReactionFz = result.reactions.reduce((sum, r) => sum + r.fz, 0);

  return [
    `=== Unified Core Analysis Results ===`,
    `Nodes: ${result.nodalDisplacements.length}`,
    `Frame elements: ${result.elementForces.length}`,
    `Shell elements: ${result.elementStresses.length}`,
    `Max displacement: ${maxDisp.toFixed(4)} mm`,
    `Total vertical reaction: ${totalReactionFz.toFixed(2)} N`,
    `Reactions count: ${result.reactions.length}`,
  ].join('\n');
}
