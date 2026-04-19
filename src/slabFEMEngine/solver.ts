/**
 * slabFEMEngine – Linear Solver (Phase 1)
 *
 * Solves  K · d = F  for symmetric positive-definite K.
 *
 * Algorithm: Gaussian elimination with partial pivoting.
 * The global stiffness matrix for a well-conditioned FEM problem is SPD
 * after boundary conditions are applied, so this is numerically stable.
 *
 * For the initial coarse meshes used here (< 2000 DOF total), a dense
 * O(n³) solver is fast enough. A sparse Cholesky factorisation can replace
 * this in a future optimisation pass without any interface changes.
 *
 * Units: any consistent set (mm / N / rad throughout this engine).
 */

export interface SolverResult {
  d:           number[];    // solution vector
  converged:   boolean;
  maxResidual: number;      // max |K·d − F| for diagnostics
}

/**
 * Solve the reduced system K_ff · d_f = F_f.
 *
 * @param K  Flat row-major n×n matrix (will be modified in place — pass a copy).
 * @param F  Right-hand side vector of length n.
 */
export function solve(K: number[], F: number[]): SolverResult {
  const n = F.length;
  // Work on copies so the caller's data is unmodified
  const A = K.slice();
  const b = F.slice();

  // ── Forward elimination with partial pivoting ─────────────────────────────
  const pivot = new Array(n).fill(0).map((_, i) => i); // row permutation

  for (let col = 0; col < n; col++) {
    // Find pivot (max absolute value in column, at or below diagonal)
    let maxVal = Math.abs(A[col * n + col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(A[row * n + col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }

    if (maxVal < 1e-14) {
      console.warn(`[slabFEMEngine] Singular or near-singular matrix at col ${col}`);
      return { d: new Array(n).fill(0), converged: false, maxResidual: Infinity };
    }

    // Swap rows col ↔ maxRow
    if (maxRow !== col) {
      for (let j = 0; j < n; j++) {
        const tmp = A[col * n + j];
        A[col  * n + j] = A[maxRow * n + j];
        A[maxRow * n + j] = tmp;
      }
      const tmp = b[col]; b[col] = b[maxRow]; b[maxRow] = tmp;
      const tmpp = pivot[col]; pivot[col] = pivot[maxRow]; pivot[maxRow] = tmpp;
    }

    // Eliminate below
    const diagInv = 1 / A[col * n + col];
    for (let row = col + 1; row < n; row++) {
      const factor = A[row * n + col] * diagInv;
      if (Math.abs(factor) < 1e-16) continue;
      A[row * n + col] = 0;
      for (let j = col + 1; j < n; j++) {
        A[row * n + j] -= factor * A[col * n + j];
      }
      b[row] -= factor * b[col];
    }
  }

  // ── Back substitution ─────────────────────────────────────────────────────
  const d = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let j = row + 1; j < n; j++) {
      sum -= A[row * n + j] * d[j];
    }
    d[row] = sum / A[row * n + row];
  }

  // ── Residual check ────────────────────────────────────────────────────────
  let maxResidual = 0;
  for (let i = 0; i < n; i++) {
    let r = F[i];
    for (let j = 0; j < n; j++) r -= K[i * n + j] * d[j];
    maxResidual = Math.max(maxResidual, Math.abs(r));
  }

  return { d, converged: maxResidual < 1e-6, maxResidual };
}
