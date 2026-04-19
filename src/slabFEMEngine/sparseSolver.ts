/**
 * slabFEMEngine – Phase 9: Sparse Linear Solvers
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Provides three solver algorithms for sparse symmetric positive definite (SPD)
 * systems arising from FEM:
 *
 *   1. Sparse Cholesky decomposition (K = L · Lᵀ) — direct solver
 *      • Exact up to floating-point precision
 *      • Fill-in tracked dynamically via Map-based column storage
 *
 *   2. Preconditioned Conjugate Gradient (PCG) — iterative solver
 *      • Jacobi (diagonal) preconditioner
 *      • Memory O(n), iteration count O(√κ)
 *      • Recommended for large systems (> 5 000 DOF)
 *
 *   3. Cuthill–McKee (RCM) DOF reordering
 *      • Reduces matrix bandwidth
 *      • Applied transparently before solving, un-permuted after
 *
 * Units: mm, N, rad — same as the rest of the engine.
 */

import {
  type CSRMatrix,
  csrMatVec,
  csrDiag,
  csrBandwidth,
  permuteCSR,
  permuteVec,
  unpermuteVec,
} from './sparseMatrix';

// ─────────────────────────────────────────────────────────────────────────────
// Public interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface SparseSolverOptions {
  /** Solver algorithm. Default: 'cg'. */
  method?: 'cholesky' | 'cg';
  /** CG: maximum iterations. Default: max(3n, 500). */
  cgMaxIter?: number;
  /** CG: relative convergence tolerance ‖r‖/‖F‖ < tol. Default: 1e-10. */
  cgTolerance?: number;
  /** Apply Reverse Cuthill-McKee reordering. Default: true. */
  useCuthillMcKee?: boolean;
}

export interface SparseSolverResult {
  d:             Float64Array;
  converged:     boolean;
  maxResidual:   number;
  iterations?:   number;      // CG only
  solveTime_ms:  number;
  bandwidth:     number;
  nnz:           number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reverse Cuthill–McKee reordering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the Reverse Cuthill–McKee (RCM) permutation of a sparse symmetric
 * matrix.  RCM reduces the bandwidth and improves cache locality.
 *
 * Algorithm:
 *   1. Choose a peripheral starting node (minimum-degree node, then BFS).
 *   2. BFS from peripheral node, enqueuing neighbours sorted by degree.
 *   3. Reverse the resulting order (RCM vs CM).
 *
 * @returns perm where perm[oldIndex] = newIndex.
 */
export function cuthillMcKee(A: CSRMatrix): Int32Array {
  const n = A.n;

  // Build adjacency list (exclude self-loops)
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let p = A.rowPtr[i]; p < A.rowPtr[i + 1]; p++) {
      const j = A.colIndex[p];
      if (j !== i) adj[i].push(j);
    }
  }
  const degree = adj.map(a => a.length);

  // Find starting node: begin with global minimum degree
  let startNode = 0;
  let minDeg    = degree[0];
  for (let i = 1; i < n; i++) {
    if (degree[i] < minDeg) { minDeg = degree[i]; startNode = i; }
  }

  // BFS to find peripheral node (last node in BFS from startNode)
  {
    const vis = new Uint8Array(n);
    const q   = [startNode];
    vis[startNode] = 1;
    let last = startNode;
    while (q.length > 0) {
      const cur = q.shift()!;
      last = cur;
      for (const nb of adj[cur].sort((a, b) => degree[a] - degree[b])) {
        if (!vis[nb]) { vis[nb] = 1; q.push(nb); }
      }
    }
    startNode = last;
  }

  // Main BFS from peripheral node, enqueue by ascending degree
  const order: number[] = [];
  const visited = new Uint8Array(n);
  const queue: number[] = [startNode];
  visited[startNode] = 1;

  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const nb of adj[cur].slice().sort((a, b) => degree[a] - degree[b])) {
      if (!visited[nb]) { visited[nb] = 1; queue.push(nb); }
    }
  }

  // Handle disconnected components
  for (let i = 0; i < n; i++) {
    if (!visited[i]) order.push(i);
  }

  // Reverse (RCM) and build permutation
  order.reverse();
  const perm = new Int32Array(n);
  for (let k = 0; k < n; k++) perm[order[k]] = k;
  return perm;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sparse Cholesky  K = L · Lᵀ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Factor K into L such that K = L · Lᵀ (lower triangular).
 *
 * Uses right-looking column-by-column elimination.
 * L_cols[j] = Map<row_i → L[i,j]>  for i ≥ j.
 * Fill-in entries are created dynamically in the Map.
 */
function choleskyFactor(A: CSRMatrix): Map<number, number>[] {
  const n = A.n;

  // Initialise L columns from the lower triangle of A
  const L_cols: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (let i = 0; i < n; i++) {
    for (let p = A.rowPtr[i]; p < A.rowPtr[i + 1]; p++) {
      const j = A.colIndex[p];
      if (j <= i) L_cols[j].set(i, A.values[p]);
    }
  }

  for (let j = 0; j < n; j++) {
    // ── 1. Diagonal ──────────────────────────────────────────────────────
    const diag = L_cols[j].get(j) ?? 0;
    if (diag < 1e-30) {
      throw new Error(
        `[Cholesky] Non-positive diagonal at column ${j}: ${diag.toExponential(3)}. ` +
        `Matrix is not SPD — check boundary conditions.`,
      );
    }
    const Ljj = Math.sqrt(diag);
    L_cols[j].set(j, Ljj);

    // ── 2. Scale below-diagonal entries of column j ───────────────────
    const below: [number, number][] = [];   // [row, L[row,j]]
    for (const [row, val] of L_cols[j]) {
      if (row > j) {
        const scaled = val / Ljj;
        L_cols[j].set(row, scaled);
        below.push([row, scaled]);
      }
    }

    // ── 3. Rank-1 update: L_col[a][b] −= L[a,j] · L[b,j]  (a ≤ b) ──
    // Sorted so we visit each pair (a, b) with a ≤ b once.
    below.sort((x, y) => x[0] - y[0]);

    for (let p = 0; p < below.length; p++) {
      const [rowA, Laj] = below[p];
      for (let q = p; q < below.length; q++) {
        const [rowB, Lbj] = below[q];
        // Update L[rowB, rowA] — column rowA, row rowB (rowB ≥ rowA)
        const prev = L_cols[rowA].get(rowB) ?? 0;
        L_cols[rowA].set(rowB, prev - Laj * Lbj);
      }
    }
  }

  return L_cols;
}

/** Forward substitution: solve L · y = b. */
function forwardSub(
  L_cols: Map<number, number>[],
  n: number,
  b: Float64Array,
): Float64Array {
  // Build row-indexed: L_row[i] = [(col, val)] sorted by col ascending
  const L_row: Array<Array<[number, number]>> = Array.from({ length: n }, () => []);
  for (let j = 0; j < n; j++) {
    for (const [row, val] of L_cols[j]) L_row[row].push([j, val]);
  }
  for (const row of L_row) row.sort((a, c) => a[0] - c[0]);

  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    let Lii = 1;
    for (const [c, v] of L_row[i]) {
      if (c < i) sum -= v * y[c];
      else if (c === i) Lii = v;
    }
    y[i] = sum / Lii;
  }
  return y;
}

/** Backward substitution: solve Lᵀ · d = y. */
function backwardSub(
  L_cols: Map<number, number>[],
  n: number,
  y: Float64Array,
): Float64Array {
  const d = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum    = y[i];
    const Lii  = L_cols[i].get(i) ?? 1;
    // Lᵀ[i, row] = L[row, i] for row > i → found in L_cols[i] at key row
    for (const [row, val] of L_cols[i]) {
      if (row > i) sum -= val * d[row];
    }
    d[i] = sum / Lii;
  }
  return d;
}

/**
 * Solve K · d = F using sparse Cholesky factorisation.
 * K must be symmetric SPD.  Both triangles should be in the CSR.
 */
export function solveCholesky(K: CSRMatrix, F: Float64Array): SparseSolverResult {
  const t0 = performance.now();
  const n  = K.n;

  let L_cols: Map<number, number>[];
  try {
    L_cols = choleskyFactor(K);
  } catch (err) {
    console.error('[SparseCholesky] Factorisation failed:', err);
    return {
      d: new Float64Array(n), converged: false, maxResidual: Infinity,
      solveTime_ms: performance.now() - t0, bandwidth: 0, nnz: K.nnz,
    };
  }

  const y   = forwardSub(L_cols, n, F);
  const d   = backwardSub(L_cols, n, y);
  const Kd  = csrMatVec(K, d);
  let maxRes = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.abs(Kd[i] - F[i]);
    if (r > maxRes) maxRes = r;
  }

  return {
    d,
    converged:    maxRes < 1.0,    // 1 N tolerance (units: N, mm)
    maxResidual:  maxRes,
    solveTime_ms: performance.now() - t0,
    bandwidth:    0,
    nnz:          K.nnz,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Preconditioned Conjugate Gradient (PCG) with Jacobi preconditioner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Solve K · d = F using PCG (Jacobi preconditioner).
 *
 * PCG update rule (Hestenes-Stiefel):
 *   d₀ = 0,  r₀ = F,  z₀ = M⁻¹·r₀,  p₀ = z₀
 *   α_k   = (rₖᵀzₖ) / (pₖᵀKpₖ)
 *   d_{k+1} = dₖ + α_k · pₖ
 *   r_{k+1} = rₖ − α_k · K·pₖ
 *   z_{k+1} = M⁻¹ · r_{k+1}
 *   β_k   = (r_{k+1}ᵀz_{k+1}) / (rₖᵀzₖ)
 *   p_{k+1} = z_{k+1} + β_k · pₖ
 */
export function solveCG(
  K: CSRMatrix,
  F: Float64Array,
  opts?: Partial<SparseSolverOptions>,
): SparseSolverResult {
  const t0      = performance.now();
  const n       = K.n;
  const maxIter = opts?.cgMaxIter   ?? Math.max(3 * n, 500);
  const tol     = opts?.cgTolerance ?? 1e-10;

  // Jacobi preconditioner M⁻¹ = 1/diag(K)
  const diag = csrDiag(K);
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    Minv[i] = Math.abs(diag[i]) > 1e-30 ? 1 / diag[i] : 1;
  }

  // ‖F‖ for relative tolerance
  let normF = 0;
  for (let i = 0; i < n; i++) normF += F[i] * F[i];
  normF = Math.sqrt(normF);
  if (normF < 1e-30) {
    return {
      d: new Float64Array(n), converged: true, maxResidual: 0,
      iterations: 0, solveTime_ms: performance.now() - t0, bandwidth: 0, nnz: K.nnz,
    };
  }

  const d = new Float64Array(n);   // d₀ = 0
  const r = new Float64Array(F);   // r₀ = F
  const z = new Float64Array(n);
  const p = new Float64Array(n);

  for (let i = 0; i < n; i++) { z[i] = Minv[i] * r[i]; p[i] = z[i]; }
  let rz   = innerProduct(r, z);

  let iter      = 0;
  let normR     = Math.sqrt(innerProduct(r, r));
  let converged = normR / normF < tol;

  while (!converged && iter < maxIter) {
    const Kp  = csrMatVec(K, p);
    const pKp = innerProduct(p, Kp);
    if (Math.abs(pKp) < 1e-50) break;

    const alpha = rz / pKp;
    for (let i = 0; i < n; i++) {
      d[i] += alpha * p[i];
      r[i] -= alpha * Kp[i];
    }

    normR = Math.sqrt(innerProduct(r, r));
    if (normR / normF < tol) { converged = true; iter++; break; }

    let rzNew = 0;
    for (let i = 0; i < n; i++) { z[i] = Minv[i] * r[i]; rzNew += r[i] * z[i]; }

    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];

    iter++;
  }

  if (!converged) {
    console.warn(
      `[PCG] No convergence in ${maxIter} iters.  ‖r‖/‖F‖=${(normR / normF).toExponential(3)}`,
    );
  }

  // Max residual
  const Kd = csrMatVec(K, d);
  let maxRes = 0;
  for (let i = 0; i < n; i++) {
    const ri = Math.abs(Kd[i] - F[i]);
    if (ri > maxRes) maxRes = ri;
  }

  return {
    d, converged, maxResidual: maxRes,
    iterations: iter,
    solveTime_ms: performance.now() - t0,
    bandwidth: 0,
    nnz: K.nnz,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch (with optional RCM reordering)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unified sparse solve entry point.
 * Applies RCM reordering (default), calls Cholesky or CG, un-permutes result.
 */
export function sparseSolve(
  K: CSRMatrix,
  F: Float64Array,
  opts?: SparseSolverOptions,
): SparseSolverResult {
  const method  = opts?.method          ?? 'cg';
  const useCMK  = opts?.useCuthillMcKee ?? true;

  let Ks   = K;
  let Fs   = F;
  let perm: Int32Array | null = null;
  let bw   = 0;

  if (useCMK) {
    perm = cuthillMcKee(K);
    Ks   = permuteCSR(K, perm);
    Fs   = permuteVec(F, perm);
    bw   = csrBandwidth(Ks);
    console.log(
      `[Phase9] RCM reordering: bandwidth ${csrBandwidth(K)} → ${bw}`,
    );
  }

  let result: SparseSolverResult;
  if (method === 'cholesky') {
    result = solveCholesky(Ks, Fs);
  } else {
    result = solveCG(Ks, Fs, opts);
  }

  if (perm !== null) {
    result = {
      ...result,
      d:         unpermuteVec(result.d, perm),
      bandwidth: bw,
    };
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function innerProduct(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
