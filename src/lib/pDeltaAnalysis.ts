/**
 * ═══════════════════════════════════════════════════════════════════
 * P-Delta Analysis — Iterative Geometric-Stiffness Method
 * ═══════════════════════════════════════════════════════════════════
 *
 * Implements second-order analysis per ACI 318-19 §6.6.4.
 *
 * APPROACH:
 *   1. Solve the linear system once → obtain axial force N_e for each element
 *   2. For each element, build the geometric stiffness matrix Kg(N_e)
 *      (string/membrane stiffening for tension, softening for compression)
 *   3. Resolve  (K + Kg) · u = F
 *   4. Recompute N_e and iterate until ‖Δu‖ / ‖u‖ < tol
 *
 * Convergence is typically reached in 2-5 iterations for service-level
 * gravity frames; sway frames near the buckling load may need 8+.
 *
 * The geometric stiffness matrix for a 12-DOF 3D frame element
 * (axial force N positive in tension) follows the standard form from
 * McGuire / Gallagher / Ziemian "Matrix Structural Analysis" (2nd ed.,
 * Eq. 8.4):
 *
 *     [ Kg ] = (N / L) · [ Geometric template ]
 *
 * Only the bending DOFs (uy, uz, θy, θz) and torsion are coupled to N.
 * Axial DOFs are unchanged by Kg (linearised geometric formulation).
 */

/**
 * Build the 12×12 element geometric-stiffness matrix in LOCAL coords
 * for an axial force N (N, tension positive) acting along the element
 * of length L (mm).
 *
 * DOF order: [ux_I, uy_I, uz_I, θx_I, θy_I, θz_I,
 *             ux_J, uy_J, uz_J, θx_J, θy_J, θz_J]
 */
export function buildElementKg(N: number, L: number): Float64Array {
  const kg = new Float64Array(144);
  if (Math.abs(N) < 1e-9 || L < 1e-9) return kg;

  const set = (i: number, j: number, v: number) => {
    kg[i * 12 + j] = v;
    if (i !== j) kg[j * 12 + i] = v;
  };

  const c = N / L;

  // Bending in local x-y plane (uy, θz)  — DOFs 1,5,7,11
  const a = 6 / 5 * c;
  const b = L / 10 * c;
  const d = 2 * L * L / 15 * c;
  const e = -L * L / 30 * c;
  set(1, 1,  a);  set(1, 5,  b);  set(1, 7, -a);  set(1, 11,  b);
  set(5, 5,  d);  set(5, 7, -b);  set(5, 11,  e);
  set(7, 7,  a);  set(7, 11, -b);
  set(11, 11, d);

  // Bending in local x-z plane (uz, θy) — DOFs 2,4,8,10
  set(2, 2,  a);  set(2, 4, -b);  set(2, 8, -a);  set(2, 10, -b);
  set(4, 4,  d);  set(4, 8,  b);  set(4, 10,  e);
  set(8, 8,  a);  set(8, 10,  b);
  set(10, 10, d);

  // Torsion (θx) — minor coupling, kept for completeness
  // (can be omitted; included as N·Ip/(A·L) but here we use 0 for simplicity)

  return kg;
}

/**
 * Iterative P-Delta convergence controller.
 *
 * The caller provides:
 *   - solveLinear(extraK)  →  runs the global solve with K_total = K0 + Kg + extraK
 *   - extractAxials(disp)  →  recovers N_e per element from displacements
 *   - assembleKg(axials)   →  returns the assembled geometric stiffness Kg
 *
 * The controller iterates until displacements stabilise.
 */
export interface PDeltaOptions {
  /** Maximum iterations before forced exit */
  maxIterations?: number;
  /** Relative displacement tolerance for convergence */
  tolerance?: number;
  /** If true, log per-iteration norm */
  verbose?: boolean;
}

export interface PDeltaResult {
  iterations: number;
  converged: boolean;
  finalNorm: number;
  /** History of (‖Δu‖ / ‖u‖) per iteration */
  history: number[];
}

/**
 * Run iterative P-Delta. The linear solver is called as a black-box.
 *
 * @param solveOnce  Function: given assembled Kg, runs the global solve and
 *                   returns the new displacement vector and element axials.
 */
export function runPDeltaIteration(
  solveOnce: (Kg: Float64Array | null) => { displacements: Float64Array; axialsByElem: Map<string, number> },
  assembleKg: (axials: Map<string, number>) => Float64Array,
  options: PDeltaOptions = {},
): PDeltaResult {
  const maxIter = options.maxIterations ?? 25;
  const tol = options.tolerance ?? 1e-3;
  const history: number[] = [];

  // Iteration 0 — pure linear solve
  let { displacements: u_prev, axialsByElem } = solveOnce(null);
  let converged = false;
  let lastNorm = Infinity;
  let iter = 0;

  for (iter = 1; iter <= maxIter; iter++) {
    const Kg = assembleKg(axialsByElem);
    const { displacements: u_curr, axialsByElem: axNew } = solveOnce(Kg);

    // Compute relative norm of the change
    let dn = 0, un = 0;
    const n = Math.min(u_prev.length, u_curr.length);
    for (let i = 0; i < n; i++) {
      const d = u_curr[i] - u_prev[i];
      dn += d * d;
      un += u_curr[i] * u_curr[i];
    }
    const norm = un > 0 ? Math.sqrt(dn / un) : 0;
    history.push(norm);
    lastNorm = norm;

    if (options.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[P-Delta] iter ${iter}  ‖Δu‖/‖u‖ = ${norm.toExponential(3)}`);
    }

    if (norm < tol) {
      converged = true;
      u_prev = u_curr;
      axialsByElem = axNew;
      break;
    }

    u_prev = u_curr;
    axialsByElem = axNew;
  }

  return { iterations: iter, converged, finalNorm: lastNorm, history };
}
