/**
 * slabFEMEngine – Phase 9: Sparse Matrix Infrastructure
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Implements Compressed Sparse Row (CSR) storage and a triplet (COO) builder
 * for efficient FEM matrix assembly without constructing a dense global matrix.
 *
 * ── CSR Format ────────────────────────────────────────────────────────────
 *
 *   For an n×n matrix with nnz non-zero entries:
 *
 *   values[p]    — the non-zero value at position p
 *   colIndex[p]  — the column index of the value at position p
 *   rowPtr[i]    — the index in values/colIndex where row i starts
 *   rowPtr[n]    — equals nnz (sentinel)
 *
 *   Row i occupies positions rowPtr[i] … rowPtr[i+1]−1 in values/colIndex.
 *
 * ── Triplet (COO) Builder ─────────────────────────────────────────────────
 *
 *   During element assembly, we push (i, j, value) triplets.
 *   Duplicate (i, j) pairs are summed during conversion to CSR.
 *   This is the standard FEM assembly strategy.
 *
 * Units: consistent with the rest of the engine (mm, N, rad).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core CSR interface
// ─────────────────────────────────────────────────────────────────────────────

export interface CSRMatrix {
  /** Dimension of the square matrix. */
  n: number;
  /** Non-zero values (length = nnz). */
  values: Float64Array;
  /** Column index for each value (length = nnz). */
  colIndex: Int32Array;
  /** Row pointer: row i occupies values[rowPtr[i]..rowPtr[i+1]-1] (length = n+1). */
  rowPtr: Int32Array;
  /** Total number of stored non-zero entries. */
  nnz: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Triplet (COO) accumulator — used during element-level assembly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TripletMatrix accumulates (i, j, value) entries during assembly.
 * Calling toCSR() sorts and merges duplicates, producing a CSRMatrix.
 *
 * Internally stores triplets as three parallel arrays for cache efficiency.
 */
export class TripletMatrix {
  private rowArr: number[] = [];
  private colArr: number[] = [];
  private valArr: number[] = [];

  constructor(public readonly n: number) {}

  /** Add (or accumulate) a value at position (i, j). */
  add(i: number, j: number, v: number): void {
    if (i < 0 || i >= this.n || j < 0 || j >= this.n) return;
    this.rowArr.push(i);
    this.colArr.push(j);
    this.valArr.push(v);
  }

  /** Return number of raw triplets (before merging). */
  get rawCount(): number {
    return this.rowArr.length;
  }

  /**
   * Iterate over every raw (unmerged) triplet.
   * Use this instead of accessing the internal arrays directly.
   */
  forEachEntry(cb: (i: number, j: number, v: number) => void): void {
    for (let k = 0; k < this.rowArr.length; k++) {
      cb(this.rowArr[k], this.colArr[k], this.valArr[k]);
    }
  }

  /**
   * Convert to CSR.
   * Triplets with the same (i,j) are summed.
   * Result rows are sorted by column index within each row.
   */
  toCSR(): CSRMatrix {
    const raw = this.rowArr.length;

    // Build index array and sort by (row, col)
    const idx = new Int32Array(raw);
    for (let k = 0; k < raw; k++) idx[k] = k;
    idx.sort((a, b) => {
      const dr = this.rowArr[a] - this.rowArr[b];
      return dr !== 0 ? dr : this.colArr[a] - this.colArr[b];
    });

    // Merge duplicates: walk sorted order and accumulate same (i,j)
    const mRows: number[] = [];
    const mCols: number[] = [];
    const mVals: number[] = [];

    for (let k = 0; k < raw; k++) {
      const p = idx[k];
      const ri = this.rowArr[p];
      const ci = this.colArr[p];
      const vi = this.valArr[p];
      const last = mRows.length - 1;
      if (last >= 0 && mRows[last] === ri && mCols[last] === ci) {
        mVals[last] += vi;
      } else {
        mRows.push(ri);
        mCols.push(ci);
        mVals.push(vi);
      }
    }

    const nnz = mRows.length;
    const n   = this.n;
    const values   = new Float64Array(nnz);
    const colIndex = new Int32Array(nnz);
    const rowPtr   = new Int32Array(n + 1);

    let ptr = 0;
    for (let i = 0; i < n; i++) {
      rowPtr[i] = ptr;
      while (ptr < nnz && mRows[ptr] === i) {
        values[ptr]   = mVals[ptr];
        colIndex[ptr] = mCols[ptr];
        ptr++;
      }
    }
    rowPtr[n] = nnz;

    return { n, values, colIndex, rowPtr, nnz };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSR operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sparse matrix–vector product: y = A · x.
 * A must be in CSR format; x length must equal A.n.
 */
export function csrMatVec(A: CSRMatrix, x: Float64Array): Float64Array {
  const n = A.n;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let p = A.rowPtr[i]; p < A.rowPtr[i + 1]; p++) {
      sum += A.values[p] * x[A.colIndex[p]];
    }
    y[i] = sum;
  }
  return y;
}

/**
 * Extract the diagonal of a CSR matrix.
 * Returns a Float64Array of length n where diag[i] = A[i,i].
 */
export function csrDiag(A: CSRMatrix): Float64Array {
  const n    = A.n;
  const diag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let p = A.rowPtr[i]; p < A.rowPtr[i + 1]; p++) {
      if (A.colIndex[p] === i) {
        diag[i] = A.values[p];
        break;
      }
    }
  }
  return diag;
}

/**
 * Compute the bandwidth of a CSR matrix:
 *   bandwidth = max |i − j|  for all (i, j) with A[i,j] ≠ 0.
 */
export function csrBandwidth(A: CSRMatrix): number {
  let bw = 0;
  for (let i = 0; i < A.n; i++) {
    for (let p = A.rowPtr[i]; p < A.rowPtr[i + 1]; p++) {
      const diff = Math.abs(i - A.colIndex[p]);
      if (diff > bw) bw = diff;
    }
  }
  return bw;
}

/**
 * Estimate memory usage for a CSRMatrix in bytes.
 * values: 8 bytes/entry, colIndex: 4 bytes/entry, rowPtr: 4 bytes/(n+1).
 */
export function csrMemoryBytes(A: CSRMatrix): number {
  return A.nnz * 8 + A.nnz * 4 + (A.n + 1) * 4;
}

/**
 * Apply a permutation to a CSR matrix: return B where B[perm[i], perm[j]] = A[i, j].
 * perm[i] maps old index i to new index perm[i].
 * This is used after Cuthill-McKee reordering.
 */
export function permuteCSR(A: CSRMatrix, perm: Int32Array): CSRMatrix {
  const n   = A.n;
  // Inverse permutation: invPerm[perm[i]] = i
  const invPerm = new Int32Array(n);
  for (let i = 0; i < n; i++) invPerm[perm[i]] = i;

  // Build new triplets in permuted order
  const trip = new TripletMatrix(n);
  for (let i = 0; i < n; i++) {
    const pi = perm[i];
    for (let p = A.rowPtr[i]; p < A.rowPtr[i + 1]; p++) {
      const pj = perm[A.colIndex[p]];
      trip.add(pi, pj, A.values[p]);
    }
  }
  return trip.toCSR();
}

/**
 * Apply a permutation to a right-hand-side vector.
 * Returns b_new where b_new[perm[i]] = b[i].
 */
export function permuteVec(b: Float64Array, perm: Int32Array): Float64Array {
  const n    = b.length;
  const bNew = new Float64Array(n);
  for (let i = 0; i < n; i++) bNew[perm[i]] = b[i];
  return bNew;
}

/**
 * Un-permute a solution vector from permuted to original ordering.
 * Returns d where d[i] = d_perm[perm[i]].
 */
export function unpermuteVec(dPerm: Float64Array, perm: Int32Array): Float64Array {
  const n = dPerm.length;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = dPerm[perm[i]];
  return d;
}

/**
 * Print diagnostic statistics for a CSR matrix.
 */
export function csrStats(A: CSRMatrix, label = 'CSR'): void {
  const bw  = csrBandwidth(A);
  const mem = csrMemoryBytes(A);
  const fill = (A.nnz / (A.n * A.n)) * 100;
  console.log(
    `[${label}] n=${A.n}  nnz=${A.nnz}  ` +
    `bandwidth=${bw}  fill=${fill.toFixed(4)}%  ` +
    `memory≈${(mem / 1024).toFixed(1)} KB`,
  );
}
