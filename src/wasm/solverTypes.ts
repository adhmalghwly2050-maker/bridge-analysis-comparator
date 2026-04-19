/**
 * Data transfer types for the structural solver (WASM-ready architecture).
 * These types define the compact format for passing data between
 * the UI layer and the solver engine (JS or WASM).
 */

// ==================== INPUT TYPES ====================

export interface SolverNode {
  id: number;
  x: number;
  y: number;
  z: number;
  /** [ux, uy, uz, rx, ry, rz] — true = restrained */
  restraints: boolean[];
  /** Optional rotational spring stiffness at this node */
  springStiffness?: number;
  /** Optional vertical spring stiffness */
  verticalSpring?: number;
}

export interface SolverElement {
  id: number;
  nodeI: number;
  nodeJ: number;
  /** Elastic modulus (MPa) */
  E: number;
  /** Moment of inertia (mm⁴) */
  I: number;
  /** Cross-section area (mm²) */
  A: number;
  /** Distributed load (kN/m) */
  w: number;
  /** Point loads on element */
  pointLoads?: { P: number; a: number }[];
}

export interface SolverModel {
  nodes: SolverNode[];
  elements: SolverElement[];
  /** 2 DOFs per node for 2D beam: [translation, rotation] */
  dofsPerNode: 2 | 6;
}

// ==================== OUTPUT TYPES ====================

export interface SolverElementResult {
  elementId: number;
  Vleft: number;
  Vright: number;
  Mleft: number;
  Mright: number;
  Mmid: number;
  axial?: number;
  diagram?: SolverDiagramPoint[];
}

export interface SolverDiagramPoint {
  x: number;
  shear: number;
  moment: number;
  deflection: number;
}

export interface SolverResult {
  displacements: Float64Array;
  reactions: Float64Array;
  elements: SolverElementResult[];
  solveTimeMs: number;
  solverUsed: 'wasm' | 'js-optimized' | 'js-fallback';
}

// ==================== WORKER MESSAGE TYPES ====================

export interface WorkerRequest {
  type: 'solve';
  id: string;
  model: SolverModel;
  computeDiagrams: boolean;
}

export interface WorkerResponse {
  type: 'result' | 'error' | 'progress';
  id: string;
  result?: SolverResult;
  error?: string;
  progress?: number;
}
