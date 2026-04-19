/**
 * Global Solver
 * ═══════════════════════════════════════════════════════════════
 * Solves the system KU = F using:
 * 1. Dense Cholesky factorisation (for SPD matrices)
 * 2. LDLT factorisation (fallback for semi-definite)
 * 3. Gaussian elimination with partial pivoting (final fallback)
 * 4. Conjugate Gradient with Jacobi preconditioner (for large systems)
 *
 * Includes:
 * - Matrix conditioning diagnostics
 * - Zero pivot detection
 * - Singularity warnings
 * - Instability tracing
 */

export type SolverMethod = 'cholesky' | 'cg' | 'auto';

export interface SolverConfig {
  method: SolverMethod;
  /** CG convergence tolerance (default 1e-10). */
  cgTolerance: number;
  /** CG max iterations (default 10 × n). */
  cgMaxIter?: number;
}

export interface SolverDiagnostics {
  /** Minimum diagonal value before factorisation. */
  minDiagonal: number;
  /** Maximum diagonal value. */
  maxDiagonal: number;
  /** Estimated condition number (max/min diagonal ratio). */
  conditionEstimate: number;
  /** Number of near-zero pivots detected. */
  nearZeroPivots: number;
  /** Indices of near-zero pivots. */
  zeroPivotIndices: number[];
  /** Warnings generated during solve. */
  warnings: string[];
}

const DEFAULT_CONFIG: SolverConfig = {
  method: 'auto',
  cgTolerance: 1e-10,
};

export interface SolverResult {
  /** Solution vector U. */
  U: Float64Array;
  /** Method actually used. */
  method: 'cholesky' | 'ldlt' | 'gauss' | 'cg';
  /** Number of iterations (CG only). */
  iterations?: number;
  /** Residual norm (CG only). */
  residualNorm?: number;
  /** Solver diagnostics. */
  diagnostics: SolverDiagnostics;
}

/** Threshold for considering a pivot as near-zero. */
const ZERO_PIVOT_TOL = 1e-20;
/** Condition number warning threshold. */
const COND_WARNING = 1e12;

/**
 * Analyse matrix conditioning before solve.
 */
function analyseConditioning(K: Float64Array, n: number): SolverDiagnostics {
  let minDiag = Infinity;
  let maxDiag = 0;
  const zeroPivotIndices: number[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < n; i++) {
    const d = Math.abs(K[i * n + i]);
    if (d < minDiag) minDiag = d;
    if (d > maxDiag) maxDiag = d;
    if (d < ZERO_PIVOT_TOL) {
      zeroPivotIndices.push(i);
    }
  }

  const condEst = maxDiag > 0 && minDiag > 0 ? maxDiag / minDiag : Infinity;

  if (zeroPivotIndices.length > 0) {
    warnings.push(`${zeroPivotIndices.length} near-zero diagonal entries detected at DOF indices: [${zeroPivotIndices.slice(0, 10).join(', ')}${zeroPivotIndices.length > 10 ? '...' : ''}]. Model may be unstable or underconstrained.`);
  }
  if (condEst > COND_WARNING) {
    warnings.push(`Estimated condition number ${condEst.toExponential(2)} exceeds threshold ${COND_WARNING.toExponential(0)}. Results may have poor numerical accuracy.`);
  }

  return {
    minDiagonal: minDiag,
    maxDiagonal: maxDiag,
    conditionEstimate: condEst,
    nearZeroPivots: zeroPivotIndices.length,
    zeroPivotIndices,
    warnings,
  };
}

/**
 * Solve KU = F.
 * K: n×n symmetric positive-definite matrix (flat row-major).
 * F: n-vector.
 */
export function solve(
  K: Float64Array,
  F: Float64Array,
  n: number,
  config: Partial<SolverConfig> = {},
): SolverResult {
  if (n === 0) {
    return {
      U: new Float64Array(0),
      method: 'cholesky',
      diagnostics: {
        minDiagonal: 0, maxDiagonal: 0, conditionEstimate: 0,
        nearZeroPivots: 0, zeroPivotIndices: [], warnings: [],
      },
    };
  }

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const diagnostics = analyseConditioning(K, n);

  const method = cfg.method === 'auto'
    ? (n > 2000 ? 'cg' : 'cholesky')
    : cfg.method;

  if (method === 'cg') {
    return solveCG(K, F, n, cfg.cgTolerance, cfg.cgMaxIter ?? n * 10, diagnostics);
  } else {
    return solveDirectWithFallback(K, F, n, diagnostics);
  }
}

/**
 * Try Cholesky → LDLT → Gauss with full diagnostics.
 */
function solveDirectWithFallback(
  K: Float64Array, F: Float64Array, n: number, diagnostics: SolverDiagnostics,
): SolverResult {
  // Try Cholesky first
  const choleskyResult = tryCholesky(K, F, n);
  if (choleskyResult) {
    return { ...choleskyResult, diagnostics };
  }

  diagnostics.warnings.push('Cholesky failed (matrix not positive-definite). Falling back to LDLT.');

  // Try LDLT
  const ldltResult = tryLDLT(K, F, n);
  if (ldltResult) {
    return { ...ldltResult, diagnostics };
  }

  diagnostics.warnings.push('LDLT failed. Falling back to Gaussian elimination with partial pivoting.');

  // Final fallback: Gauss
  return { ...solveGauss(new Float64Array(K), F, n), diagnostics };
}

/**
 * Dense Cholesky: K = L·L^T. Returns null if not SPD.
 */
function tryCholesky(K: Float64Array, F: Float64Array, n: number): Omit<SolverResult, 'diagnostics'> | null {
  const L = new Float64Array(K);

  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let k = 0; k < j; k++) sum += L[j * n + k] ** 2;
    const diag = L[j * n + j] - sum;
    if (diag <= 1e-30) return null; // Not SPD
    L[j * n + j] = Math.sqrt(diag);

    for (let i = j + 1; i < n; i++) {
      let s = 0;
      for (let k = 0; k < j; k++) s += L[i * n + k] * L[j * n + k];
      L[i * n + j] = (L[i * n + j] - s) / L[j * n + j];
    }
  }

  // Forward substitution: L·y = F
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < i; k++) s += L[i * n + k] * y[k];
    y[i] = (F[i] - s) / L[i * n + i];
  }

  // Back substitution: L^T·U = y
  const U = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = 0;
    for (let k = i + 1; k < n; k++) s += L[k * n + i] * U[k];
    U[i] = (y[i] - s) / L[i * n + i];
  }

  return { U, method: 'cholesky' };
}

/**
 * LDLT factorisation: K = L·D·L^T for symmetric matrices (may be semi-definite).
 * Returns null if factorisation fails completely.
 */
function tryLDLT(K: Float64Array, F: Float64Array, n: number): Omit<SolverResult, 'diagnostics'> | null {
  const L = new Float64Array(n * n);
  const D = new Float64Array(n);

  // Initialise L as identity
  for (let i = 0; i < n; i++) L[i * n + i] = 1.0;

  for (let j = 0; j < n; j++) {
    // D[j] = K[j,j] - Σ L[j,k]² D[k]
    let sum = 0;
    for (let k = 0; k < j; k++) {
      sum += L[j * n + k] * L[j * n + k] * D[k];
    }
    D[j] = K[j * n + j] - sum;

    if (Math.abs(D[j]) < 1e-30) {
      // Near-zero pivot: set to small value to continue
      D[j] = 1e-20;
    }

    for (let i = j + 1; i < n; i++) {
      let s = 0;
      for (let k = 0; k < j; k++) {
        s += L[i * n + k] * L[j * n + k] * D[k];
      }
      L[i * n + j] = (K[i * n + j] - s) / D[j];
    }
  }

  // Solve L·D·L^T · U = F
  // Step 1: L·y = F (forward)
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < i; k++) s += L[i * n + k] * y[k];
    y[i] = F[i] - s;
  }

  // Step 2: D·z = y
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    z[i] = Math.abs(D[i]) > 1e-30 ? y[i] / D[i] : 0;
  }

  // Step 3: L^T·U = z (backward)
  const U = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = 0;
    for (let k = i + 1; k < n; k++) s += L[k * n + i] * U[k];
    U[i] = z[i] - s;
  }

  return { U, method: 'ldlt' };
}

/**
 * Gaussian elimination with partial pivoting (final fallback).
 */
function solveGauss(K: Float64Array, F: Float64Array, n: number): Omit<SolverResult, 'diagnostics'> {
  const A = new Float64Array(K);
  const b = new Float64Array(F);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxVal = Math.abs(A[col * n + col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(A[row * n + col]);
      if (val > maxVal) { maxVal = val; maxRow = row; }
    }

    if (maxRow !== col) {
      for (let j = 0; j < n; j++) {
        const tmp = A[col * n + j]; A[col * n + j] = A[maxRow * n + j]; A[maxRow * n + j] = tmp;
      }
      const tb = b[col]; b[col] = b[maxRow]; b[maxRow] = tb;
    }

    const pivot = A[col * n + col];
    if (Math.abs(pivot) < 1e-30) continue;

    for (let row = col + 1; row < n; row++) {
      const fac = A[row * n + col] / pivot;
      for (let j = col; j < n; j++) A[row * n + j] -= fac * A[col * n + j];
      b[row] -= fac * b[col];
    }
  }

  const U = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = 0;
    for (let j = i + 1; j < n; j++) s += A[i * n + j] * U[j];
    const d = A[i * n + i];
    U[i] = Math.abs(d) > 1e-30 ? (b[i] - s) / d : 0;
  }

  return { U, method: 'gauss' };
}

/**
 * Preconditioned Conjugate Gradient with Jacobi preconditioner.
 */
function solveCG(
  K: Float64Array, F: Float64Array, n: number,
  tol: number, maxIter: number, diagnostics: SolverDiagnostics,
): SolverResult {
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = K[i * n + i];
    Minv[i] = d > 1e-30 ? 1 / d : 1;
  }

  const U = new Float64Array(n);
  const r = new Float64Array(F);
  const z = new Float64Array(n);
  const p = new Float64Array(n);

  for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
  p.set(z);

  let rz = dot(r, z, n);
  let iter = 0;
  const normF = Math.sqrt(dot(F, F, n));
  const threshold = tol * (normF > 0 ? normF : 1);

  while (iter < maxIter) {
    const Ap = matvec(K, p, n);
    const pAp = dot(p, Ap, n);
    if (Math.abs(pAp) < 1e-30) break;
    const alpha = rz / pAp;

    for (let i = 0; i < n; i++) {
      U[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }

    const residualNorm = Math.sqrt(dot(r, r, n));
    iter++;

    if (residualNorm < threshold) {
      return { U, method: 'cg', iterations: iter, residualNorm, diagnostics };
    }

    for (let i = 0; i < n; i++) z[i] = Minv[i] * r[i];
    const rzNew = dot(r, z, n);
    const beta = rzNew / rz;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rz = rzNew;
  }

  diagnostics.warnings.push(`CG did not converge within ${maxIter} iterations. Residual: ${Math.sqrt(dot(r, r, n)).toExponential(2)}`);
  return { U, method: 'cg', iterations: iter, residualNorm: Math.sqrt(dot(r, r, n)), diagnostics };
}

function dot(a: Float64Array, b: Float64Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function matvec(A: Float64Array, x: Float64Array, n: number): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i * n + j] * x[j];
    y[i] = s;
  }
  return y;
}
