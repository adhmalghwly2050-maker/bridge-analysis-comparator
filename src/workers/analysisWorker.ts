/**
 * Web Worker for running structural analysis off the main thread.
 * Prevents UI freezing during heavy matrix computations.
 */

import type { WorkerRequest, WorkerResponse } from '../wasm/solverTypes';
import { solveOptimized } from '../wasm/optimizedSolver';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { type, id, model, computeDiagrams } = event.data;

  if (type !== 'solve') return;

  try {
    // Report progress
    const progress: WorkerResponse = { type: 'progress', id, progress: 0.1 };
    self.postMessage(progress);

    const result = solveOptimized(model, computeDiagrams);

    const response: WorkerResponse = { type: 'result', id, result };
    self.postMessage(response);
  } catch (error: any) {
    const response: WorkerResponse = {
      type: 'error',
      id,
      error: error.message || 'Unknown solver error',
    };
    self.postMessage(response);
  }
};
