/**
 * slabFEMEngine – Mindlin-Reissner 4-node Shell Element (Phase 1)
 *
 * Element formulation
 * -------------------
 * • 4-node bilinear quad in the X-Y plane (slab lies flat).
 * • 3 DOF per node: [UZ, RX, RY]
 *     UZ  = vertical deflection (mm)
 *     RX  = rotation about X-axis  (rad)   → ≈ ∂w/∂y  in thin-plate limit
 *     RY  = rotation about Y-axis  (rad)   → ≈ −∂w/∂x in thin-plate limit
 * • Total element DOF = 4 × 3 = 12.
 *
 * Sign / strain convention (Bathe & Dvorkin, MITC notation)
 * ----------------------------------------------------------
 *   Bending curvatures:
 *     κx  = −∂RY/∂x              (moment Mx = Db·(κx + ν·κy))
 *     κy  =  ∂RX/∂y              (moment My = Db·(κy + ν·κx))
 *     κxy =  ∂RX/∂x − ∂RY/∂y   (twisting Mxy = Db·(1−ν)/2·κxy)
 *
 *   Transverse shear strains (Mindlin):
 *     γxz = ∂UZ/∂x + RY          (shear Qx = Ds·γxz)
 *     γyz = ∂UZ/∂y − RX          (shear Qy = Ds·γyz)
 *
 * Integration scheme (shear-locking free)
 * ----------------------------------------
 * • Bending  k_b: 2×2 full Gauss quadrature.
 * • Shear    k_s: 1×1 reduced Gauss quadrature (prevents locking).
 *
 * Units: mm, N, MPa → resulting K in N/mm, N·mm/mm, N·mm
 */

import type { FEMNode, FEMElement, Ke } from './types';
import type { SlabProps, MatProps } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Stiffness reduction factor for FEM slab analysis
//
// Per the project requirement (and consistent with ACI 318 §6.6.3.1 which
// specifies 0.25Ig for cracked slabs), the FEM engine uses 25 % of the gross
// section stiffness for ALL slab elements before assembly.
//
//   Effective Db = 0.25 × (Ec·t³/12(1-ν²))
//   Effective Ds = 0.25 × (ks·G·t)
//
// Consequence:
//   • Global stiffness matrix K = 25 % of gross → deflections increase by 4×.
//   • Moment recovery uses the SAME 0.25·Ig so computed M are consistent.
//   • For isostatic cases moments are unchanged by absolute stiffness;
//     for indeterminate cases (flat plates, multi-span) redistribution is
//     affected — this is the intended behaviour.
// ─────────────────────────────────────────────────────────────────────────────

export const SLAB_STIFFNESS_REDUCTION = 0.25;   // stiffness becomes 25 % of gross section

// ─────────────────────────────────────────────────────────────────────────────
// Public: compute element stiffness matrix (12 × 12, row-major)
// ─────────────────────────────────────────────────────────────────────────────

export function elementStiffness(
  elem:      FEMElement,
  nodes:     FEMNode[],
  slabProps: SlabProps,
  mat:       MatProps,
): Ke {
  const t  = slabProps.thickness;          // mm
  const Ec = 4700 * Math.sqrt(mat.fc);     // MPa  (ACI 318-19 §19.2.2)
  const nu = 0.2;                          // Poisson's ratio for concrete
  const G  = Ec / (2 * (1 + nu));         // shear modulus (MPa)
  const ks = 5 / 6;                       // Mindlin shear correction factor

  // Material matrices --------------------------------------------------------
  // D_b: 3×3 bending stiffness (MPa·mm³) — reduced by 25 %
  const Db  = SLAB_STIFFNESS_REDUCTION * (Ec * t ** 3) / (12 * (1 - nu ** 2));
  const D_b = matScale(
    [[1, nu, 0], [nu, 1, 0], [0, 0, (1 - nu) / 2]],
    Db,
  );

  // D_s: 2×2 shear stiffness (MPa·mm) — reduced by 25 %
  const Ds  = SLAB_STIFFNESS_REDUCTION * ks * G * t;
  const D_s = [[Ds, 0], [0, Ds]];

  // Node coordinates (mm) ---------------------------------------------------
  const xs = elem.nodeIds.map(id => nodes[id].x);
  const ys = elem.nodeIds.map(id => nodes[id].y);

  // Initialise 12×12 element stiffness (flat row-major) ---------------------
  const ke = new Array(144).fill(0);

  // ── Bending contribution: 2×2 Gauss ─────────────────────────────────────
  const gp2 = 1 / Math.sqrt(3);
  const gaussPts2: [number, number, number][] = [
    [-gp2, -gp2, 1.0],
    [ gp2, -gp2, 1.0],
    [ gp2,  gp2, 1.0],
    [-gp2,  gp2, 1.0],
  ];

  for (const [xi, eta, w] of gaussPts2) {
    const { dNdx, dNdy, detJ } = shapeFunctionDerivatives(xi, eta, xs, ys);
    const B_b = bendingBMatrix(dNdx, dNdy);  // 3×12
    // k_b += w · Bᵀ D_b B · |J|
    addBtDB(ke, B_b, D_b, w * detJ, 3, 12);
  }

  // ── Shear contribution: 1×1 reduced Gauss ────────────────────────────────
  const gaussPts1: [number, number, number][] = [[0, 0, 4.0]];

  for (const [xi, eta, w] of gaussPts1) {
    const { N, dNdx, dNdy, detJ } = shapeFunctionDerivatives(xi, eta, xs, ys);
    const B_s = shearBMatrix(N, dNdx, dNdy);  // 2×12
    // k_s += w · Bᵀ D_s B · |J|
    addBtDB(ke, B_s, D_s, w * detJ, 2, 12);
  }

  return ke;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: consistent nodal load vector for uniform surface pressure q (N/mm²)
// Returns 12-element vector [Fz0, MX0, MY0, Fz1, ...]
// ─────────────────────────────────────────────────────────────────────────────

export function elementLoadVector(
  elem:  FEMElement,
  nodes: FEMNode[],
  q:     number,   // N/mm²  (pressure positive downward → positive Fz)
): number[] {
  const xs = elem.nodeIds.map(id => nodes[id].x);
  const ys = elem.nodeIds.map(id => nodes[id].y);

  const fe = new Array(12).fill(0);

  const gp2 = 1 / Math.sqrt(3);
  const gaussPts: [number, number, number][] = [
    [-gp2, -gp2, 1.0],
    [ gp2, -gp2, 1.0],
    [ gp2,  gp2, 1.0],
    [-gp2,  gp2, 1.0],
  ];

  for (const [xi, eta, w] of gaussPts) {
    const { N, detJ } = shapeFunctionDerivatives(xi, eta, xs, ys);
    // Only the UZ DOF (index 0, 3, 6, 9 of the 12 DOFs) gets the pressure load.
    for (let i = 0; i < 4; i++) {
      fe[i * 3 + 0] += w * N[i] * q * detJ;  // force in UZ direction
      // Moment DOFs (RX, RY) get zero from uniform pressure
    }
  }

  return fe;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: compute stress resultants at a given (ξ, η) in the element
// Returns Mx, My, Mxy [kN·m/m] and Qx, Qy [kN/m]
// Input displacements are in mm and rad.
// ─────────────────────────────────────────────────────────────────────────────

export function stressResultants(
  xi: number, eta: number,
  elem:      FEMElement,
  nodes:     FEMNode[],
  d_elem:    number[],   // 12 element DOF displacements [UZ0,RX0,RY0, ...]
  slabProps: SlabProps,
  mat:       MatProps,
): { Mx: number; My: number; Mxy: number; Qx: number; Qy: number } {
  const t  = slabProps.thickness;
  const Ec = 4700 * Math.sqrt(mat.fc);
  const nu = 0.2;
  const G  = Ec / (2 * (1 + nu));
  const ks = 5 / 6;

  // Apply the same 25 % reduction used in elementStiffness() so that moments
  // M = D_b_reduced · B · d  are consistent with the solved displacement field.
  const Db    = SLAB_STIFFNESS_REDUCTION * (Ec * t ** 3) / (12 * (1 - nu ** 2));
  const DsVal = SLAB_STIFFNESS_REDUCTION * ks * G * t;

  const xs = elem.nodeIds.map(id => nodes[id].x);
  const ys = elem.nodeIds.map(id => nodes[id].y);

  const { N, dNdx, dNdy } = shapeFunctionDerivatives(xi, eta, xs, ys);

  // Bending curvatures: κ = B_b · d
  const B_b = bendingBMatrix(dNdx, dNdy);   // 3×12
  const kappa = matVecMul(B_b, d_elem, 3, 12);  // [κx, κy, κxy]

  // Shear strains: γ = B_s · d
  const B_s = shearBMatrix(N, dNdx, dNdy);  // 2×12
  const gamma = matVecMul(B_s, d_elem, 2, 12); // [γxz, γyz]

  // Moments (N/mm per mm = N/mm → convert to kN·m/m: × 1e-3)
  //   Mx  = Db·(κx + ν·κy)    [N·mm/mm / mm = N/mm]
  //   My  = Db·(κy + ν·κx)
  //   Mxy = Db·(1-ν)/2·κxy
  // Convert to kN·m/m:  [N/mm] → [kN·m/m] : × 1e-3 (mm→m cancel, N→kN)
  const Mx  = (Db * (kappa[0] + nu * kappa[1])) * 1e-3;
  const My  = (Db * (kappa[1] + nu * kappa[0])) * 1e-3;
  const Mxy = (Db * (1 - nu) / 2 * kappa[2])    * 1e-3;

  // Shear forces [N/mm] → [kN/m]: × 1e-3 (same factor)
  const Qx = DsVal * gamma[0] * 1e-3;
  const Qy = DsVal * gamma[1] * 1e-3;

  return { Mx, My, Mxy, Qx, Qy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape functions and their global derivatives
// ─────────────────────────────────────────────────────────────────────────────

interface ShapeFnResult {
  N:    number[];   // [N1, N2, N3, N4]
  dNdx: number[];   // [∂N1/∂x, ...]
  dNdy: number[];   // [∂N1/∂y, ...]
  detJ: number;
}

export function shapeFunctionDerivatives(
  xi: number, eta: number,
  xs: number[], ys: number[],
): ShapeFnResult {
  // Bilinear shape functions
  const N = [
    (1 - xi) * (1 - eta) / 4,  // N0: (ξ=−1, η=−1)  → node 0 BL
    (1 + xi) * (1 - eta) / 4,  // N1: (ξ=+1, η=−1)  → node 1 BR
    (1 + xi) * (1 + eta) / 4,  // N2: (ξ=+1, η=+1)  → node 2 TR
    (1 - xi) * (1 + eta) / 4,  // N3: (ξ=−1, η=+1)  → node 3 TL
  ];

  // Derivatives w.r.t. ξ and η
  const dNdxi  = [-(1 - eta) / 4, (1 - eta) / 4, (1 + eta) / 4, -(1 + eta) / 4];
  const dNdeta = [-(1 - xi) / 4, -(1 + xi) / 4, (1 + xi) / 4,  (1 - xi) / 4 ];

  // Jacobian  J = [∂x/∂ξ  ∂y/∂ξ ; ∂x/∂η  ∂y/∂η]
  let J00 = 0, J01 = 0, J10 = 0, J11 = 0;
  for (let i = 0; i < 4; i++) {
    J00 += dNdxi[i]  * xs[i];
    J01 += dNdxi[i]  * ys[i];
    J10 += dNdeta[i] * xs[i];
    J11 += dNdeta[i] * ys[i];
  }
  const detJ = J00 * J11 - J01 * J10;
  if (Math.abs(detJ) < 1e-12) {
    throw new Error(`Degenerate element: detJ = ${detJ}`);
  }

  // Inverse Jacobian  J⁻¹ = (1/detJ)·[J11  −J01 ; −J10  J00]
  const invJ00 =  J11 / detJ;
  const invJ01 = -J01 / detJ;
  const invJ10 = -J10 / detJ;
  const invJ11 =  J00 / detJ;

  // ∂N/∂x = J⁻¹ · [∂N/∂ξ ; ∂N/∂η]  (row 0 of J⁻¹)
  // ∂N/∂y = J⁻¹ · [∂N/∂ξ ; ∂N/∂η]  (row 1 of J⁻¹)
  const dNdx = dNdxi.map((dxi, i) => invJ00 * dxi + invJ01 * dNdeta[i]);
  const dNdy = dNdxi.map((dxi, i) => invJ10 * dxi + invJ11 * dNdeta[i]);

  return { N, dNdx, dNdy, detJ };
}

// ─────────────────────────────────────────────────────────────────────────────
// B matrices (see sign convention at top of file)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bending B-matrix  (3 × 12).
 * DOF ordering per node i: [UZ_i, RX_i, RY_i] at positions [3i, 3i+1, 3i+2].
 *
 *  κx  = −∂RY/∂x
 *  κy  =  ∂RX/∂y
 *  κxy =  ∂RX/∂x − ∂RY/∂y
 */
function bendingBMatrix(dNdx: number[], dNdy: number[]): number[][] {
  const B = Array.from({ length: 3 }, () => new Array(12).fill(0));
  for (let i = 0; i < 4; i++) {
    const c = i * 3;
    // col c   : UZ_i → no bending contribution
    // col c+1 : RX_i
    B[1][c + 1] =  dNdy[i];   // κy  += ∂Ni/∂y · RXi
    B[2][c + 1] =  dNdx[i];   // κxy += ∂Ni/∂x · RXi
    // col c+2 : RY_i
    B[0][c + 2] = -dNdx[i];   // κx  -= ∂Ni/∂x · RYi
    B[2][c + 2] = -dNdy[i];   // κxy -= ∂Ni/∂y · RYi
  }
  return B;
}

/**
 * Shear B-matrix  (2 × 12).
 *
 *  γxz = ∂UZ/∂x + RY
 *  γyz = ∂UZ/∂y − RX
 */
function shearBMatrix(N: number[], dNdx: number[], dNdy: number[]): number[][] {
  const B = Array.from({ length: 2 }, () => new Array(12).fill(0));
  for (let i = 0; i < 4; i++) {
    const c = i * 3;
    // col c   : UZ_i
    B[0][c + 0] =  dNdx[i];   // γxz += ∂Ni/∂x · UZi
    B[1][c + 0] =  dNdy[i];   // γyz += ∂Ni/∂y · UZi
    // col c+1 : RX_i
    B[1][c + 1] = -N[i];      // γyz -= Ni · RXi
    // col c+2 : RY_i
    B[0][c + 2] =  N[i];      // γxz += Ni · RYi
  }
  return B;
}

// ─────────────────────────────────────────────────────────────────────────────
// Linear algebra helpers (small dense matrices)
// ─────────────────────────────────────────────────────────────────────────────

/** Scale a matrix by a scalar. */
function matScale(A: number[][], s: number): number[][] {
  return A.map(row => row.map(v => v * s));
}

/** Accumulate  ke += Bᵀ · D · B · scale  (B is nRow × nCol dense matrix). */
function addBtDB(
  ke:    number[],      // flat nCol×nCol output (row-major)
  B:     number[][],   // nRow × nCol
  D:     number[][],   // nRow × nRow
  scale: number,
  nRow:  number,
  nCol:  number,
): void {
  // Compute DB = D × B  (nRow × nCol)
  const DB: number[][] = Array.from({ length: nRow }, (_, r) =>
    Array.from({ length: nCol }, (_, c) =>
      D[r].reduce((s, d, k) => s + d * B[k][c], 0),
    ),
  );

  // ke += Bᵀ · DB · scale
  for (let i = 0; i < nCol; i++) {
    for (let j = 0; j < nCol; j++) {
      let sum = 0;
      for (let r = 0; r < nRow; r++) sum += B[r][i] * DB[r][j];
      ke[i * nCol + j] += sum * scale;
    }
  }
}

/** Multiply matrix M (nRow × nCol) by vector v (nCol). */
function matVecMul(M: number[][], v: number[], nRow: number, nCol: number): number[] {
  return Array.from({ length: nRow }, (_, r) =>
    M[r].reduce((s, m, c) => s + m * v[c], 0),
  );
}
