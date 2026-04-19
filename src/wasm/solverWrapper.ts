/**
 * Solver Wrapper — provides a unified API for structural analysis.
 * 
 * Priority: WASM solver → Optimized JS solver → Legacy TS fallback
 * 
 * Automatically falls back if WASM is unavailable.
 */

import type { SolverModel, SolverResult } from './solverTypes';
import { solveOptimized } from './optimizedSolver';

let wasmSolver: any = null;
let wasmLoadAttempted = false;

/**
 * Attempt to load the WASM solver module.
 * Returns true if successful, false otherwise.
 */
export async function initWasmSolver(): Promise<boolean> {
  if (wasmLoadAttempted) return wasmSolver !== null;
  wasmLoadAttempted = true;

  try {
    // Future: load actual WASM module
    // const module = await import('./solver.js');
    // wasmSolver = await module.default();
    console.log('[Solver] WASM module not yet available, using optimized JS solver');
    return false;
  } catch (e) {
    console.warn('[Solver] WASM load failed, falling back to JS solver:', e);
    return false;
  }
}

/**
 * Solve a structural model using the best available solver.
 */
export function solveStructure(
  model: SolverModel,
  computeDiagrams: boolean = false
): SolverResult {
  if (wasmSolver) {
    try {
      return solveWithWasm(model, computeDiagrams);
    } catch (e) {
      console.warn('[Solver] WASM solve failed, falling back to JS:', e);
    }
  }

  return solveOptimized(model, computeDiagrams);
}

/**
 * WASM solver path (placeholder for future C++ compiled module)
 */
function solveWithWasm(model: SolverModel, computeDiagrams: boolean): SolverResult {
  const t0 = performance.now();

  // Future implementation: serialize model to WASM memory,
  // call solver, deserialize results.
  //
  // const nodesBuf = new Float64Array(model.nodes.length * 7);
  // ... pack data ...
  // wasmSolver._solve(nodesBuf.byteOffset, elemBuf.byteOffset, ...);
  // ... unpack results ...

  throw new Error('WASM solver not implemented yet');
}

/**
 * Convert from legacy matrixStiffness types to SolverModel
 */
export function convertFromLegacy(
  nodes: { id: string; x: number; fixedDOFs: boolean[]; columnStiffness?: number; verticalSpring?: number }[],
  elements: { id: string; nodeI: number; nodeJ: number; L: number; EI: number; w: number; pointLoads?: { P: number; a: number }[] }[]
): SolverModel {
  return {
    nodes: nodes.map((n, i) => ({
      id: i,
      x: n.x,
      y: 0,
      z: 0,
      restraints: [n.fixedDOFs[0], false, false, false, n.fixedDOFs[1], false],
      springStiffness: n.columnStiffness,
      verticalSpring: n.verticalSpring,
    })),
    elements: elements.map((e) => ({
      id: parseInt(e.id) || 0,
      nodeI: e.nodeI,
      nodeJ: e.nodeJ,
      E: 1, // EI is already combined
      I: e.EI,
      A: 0,
      w: e.w,
      pointLoads: e.pointLoads,
    })),
    dofsPerNode: 2,
  };
}

/**
 * Get solver info
 */
export function getSolverInfo() {
  return {
    wasmAvailable: wasmSolver !== null,
    wasmAttempted: wasmLoadAttempted,
    currentSolver: wasmSolver ? 'wasm' : 'js-optimized',
  };
}
