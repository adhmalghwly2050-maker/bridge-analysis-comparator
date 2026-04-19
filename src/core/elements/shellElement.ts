/**
 * Mindlin-Reissner 4-Node Shell Element
 * ═══════════════════════════════════════════════════════════════
 * Flat shell element combining plate bending + membrane behaviour.
 *
 * For slab analysis in the global structural core:
 * - 6 DOF per node: [ux, uy, uz, rx, ry, rz]
 * - Total: 4 nodes × 6 DOF = 24 DOF element stiffness
 *
 * Bending DOF (plate): uz, rx, ry — Mindlin plate theory
 *   κx  = −∂RY/∂x,  κy = ∂RX/∂y,  κxy = ∂RX/∂x − ∂RY/∂y
 *   γxz = ∂UZ/∂x + RY,  γyz = ∂UZ/∂y − RX
 *
 * Membrane DOF: ux, uy — plane stress
 *   εx = ∂ux/∂x,  εy = ∂uy/∂y,  γxy = ∂ux/∂y + ∂uy/∂x
 *
 * Drilling DOF (rz): stabilised with small penalty stiffness.
 *
 * ── SLAB STIFFNESS MODES ─────────────────────────────────────
 *   FULL          → full bending + membrane + shear
 *   LOAD_ONLY     → returns zero stiffness matrix
 *   MEMBRANE_ONLY → membrane terms only, zero bending/shear
 *   REDUCED       → K = factor × K_full
 *
 * Integration: 2×2 Gauss for bending+membrane, 1×1 reduced for shear (locking-free).
 *
 * AUDIT NOTE: Assembly uses direct index assignment (not addK symmetry helper)
 * to avoid double-counting when iterating node pairs.
 */

import type { Material, SlabProperties } from '../model/types';

// Gauss points for 2-point quadrature
const GP2 = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const GW2 = [1.0, 1.0];

/**
 * Build 24×24 shell element stiffness matrix.
 * Returns flat row-major array of length 576.
 */
export function buildShellStiffness(
  nodeCoords: { x: number; y: number; z: number }[],
  mat: Material,
  slabProps: SlabProperties,
): number[] {
  const n = 24;
  const K = new Array(n * n).fill(0);

  // LOAD_ONLY mode: zero stiffness (loads transferred separately)
  if (slabProps.stiffnessMode === 'LOAD_ONLY') {
    return K;
  }

  const t = slabProps.thickness;
  const E = mat.fc ? 4700 * Math.sqrt(mat.fc) : mat.E;
  const nu = mat.nu;
  const G = E / (2 * (1 + nu));

  const includeBending = slabProps.stiffnessMode !== 'MEMBRANE_ONLY';
  const factor = slabProps.stiffnessMode === 'REDUCED'
    ? (slabProps.stiffnessFactor ?? 1.0)
    : 1.0;

  // ── Membrane constitutive: plane stress ──
  // Dm = Et/(1-ν²) × [[1,ν,0],[ν,1,0],[0,0,(1-ν)/2]]
  const Dm_coeff = E * t / (1 - nu * nu);
  const Dm = [
    Dm_coeff, Dm_coeff * nu, 0,
    Dm_coeff * nu, Dm_coeff, 0,
    0, 0, Dm_coeff * (1 - nu) / 2,
  ];

  // ── Bending constitutive ──
  // Db = Et³/(12(1-ν²)) × [[1,ν,0],[ν,1,0],[0,0,(1-ν)/2]]
  const Db_coeff = E * t * t * t / (12 * (1 - nu * nu));
  const Db = [
    Db_coeff, Db_coeff * nu, 0,
    Db_coeff * nu, Db_coeff, 0,
    0, 0, Db_coeff * (1 - nu) / 2,
  ];

  // ── Shear constitutive ──
  const ks = 5 / 6; // shear correction factor for Mindlin plate
  const Ds_coeff = ks * G * t;

  // Node coordinates in element (4 nodes)
  const x = nodeCoords.map(nd => nd.x);
  const y = nodeCoords.map(nd => nd.y);

  // Shape function derivatives in natural coordinates
  // 4-node isoparametric quad: N_i = (1 ± ξ)(1 ± η)/4
  function shapeFuncDerivs(xi: number, eta: number) {
    const dNdxi = [
      -(1 - eta) / 4, (1 - eta) / 4, (1 + eta) / 4, -(1 + eta) / 4,
    ];
    const dNdeta = [
      -(1 - xi) / 4, -(1 + xi) / 4, (1 + xi) / 4, (1 - xi) / 4,
    ];
    return { dNdxi, dNdeta };
  }

  function shapeFunc(xi: number, eta: number) {
    return [
      (1 - xi) * (1 - eta) / 4,
      (1 + xi) * (1 - eta) / 4,
      (1 + xi) * (1 + eta) / 4,
      (1 - xi) * (1 + eta) / 4,
    ];
  }

  // Jacobian: J = [∂x/∂ξ, ∂y/∂ξ; ∂x/∂η, ∂y/∂η]
  function jacobian(dNdxi: number[], dNdeta: number[]) {
    let J11 = 0, J12 = 0, J21 = 0, J22 = 0;
    for (let i = 0; i < 4; i++) {
      J11 += dNdxi[i] * x[i];
      J12 += dNdxi[i] * y[i];
      J21 += dNdeta[i] * x[i];
      J22 += dNdeta[i] * y[i];
    }
    const detJ = J11 * J22 - J12 * J21;
    return {
      detJ,
      invJ: [J22 / detJ, -J12 / detJ, -J21 / detJ, J11 / detJ],
    };
  }

  // ── 2×2 Gauss integration (membrane + bending) ──
  for (let gi = 0; gi < 2; gi++) {
    for (let gj = 0; gj < 2; gj++) {
      const xi = GP2[gi];
      const eta = GP2[gj];
      const w = GW2[gi] * GW2[gj];

      const { dNdxi, dNdeta } = shapeFuncDerivs(xi, eta);
      const { detJ, invJ } = jacobian(dNdxi, dNdeta);

      // dN/dx, dN/dy in physical coords via inverse Jacobian
      const dNdx: number[] = [];
      const dNdy: number[] = [];
      for (let i = 0; i < 4; i++) {
        dNdx[i] = invJ[0] * dNdxi[i] + invJ[1] * dNdeta[i];
        dNdy[i] = invJ[2] * dNdxi[i] + invJ[3] * dNdeta[i];
      }

      const wdetJ = w * Math.abs(detJ);

      // ── Membrane: Bm^T · Dm · Bm ──
      // Bm(a) = [[dNa/dx, 0], [0, dNa/dy], [dNa/dy, dNa/dx]]
      // on DOF [ux(0), uy(1)]
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
          const ai = a * 6;
          const bi2 = b * 6;

          // K(ux_a, ux_b)
          const k00 = (dNdx[a] * Dm[0] * dNdx[b] + dNdy[a] * Dm[8] * dNdy[b]) * wdetJ;
          // K(ux_a, uy_b)
          const k01 = (dNdx[a] * Dm[1] * dNdy[b] + dNdy[a] * Dm[8] * dNdx[b]) * wdetJ;
          // K(uy_a, uy_b)
          const k11 = (dNdy[a] * Dm[4] * dNdy[b] + dNdx[a] * Dm[8] * dNdx[b]) * wdetJ;

          K[(ai + 0) * n + (bi2 + 0)] += k00;
          K[(ai + 0) * n + (bi2 + 1)] += k01;
          K[(ai + 1) * n + (bi2 + 0)] += (dNdy[a] * Dm[1] * dNdx[b] + dNdx[a] * Dm[8] * dNdy[b]) * wdetJ;
          K[(ai + 1) * n + (bi2 + 1)] += k11;
        }
      }

      // ── Bending: Bb^T · Db · Bb (only if bending included) ──
      if (includeBending) {
        // Bb(a) = [[0, -dNa/dx], [dNa/dy, 0], [dNa/dx, -dNa/dy]]
        // on DOF [rx(3), ry(4)]
        // κx = -∂θy/∂x, κy = ∂θx/∂y, κxy = ∂θx/∂x - ∂θy/∂y
        for (let a = 0; a < 4; a++) {
          for (let b = 0; b < 4; b++) {
            const ai = a * 6;
            const bi2 = b * 6;

            // Bb(a)^T·Db·Bb(b) components:
            // (rx_a, rx_b): row1·D·row1 + row2·D·row2 for rx terms
            // Bb[0,rx]=0, Bb[1,rx]=dNa/dy, Bb[2,rx]=dNa/dx
            // Bb[0,ry]=-dNa/dx, Bb[1,ry]=0, Bb[2,ry]=-dNa/dy

            // K(rx_a, rx_b) = dNa/dy*Db[4]*dNb/dy + dNa/dx*Db[8]*dNb/dx
            const rxrx = (dNdy[a] * Db[4] * dNdy[b] + dNdx[a] * Db[8] * dNdx[b]) * wdetJ;
            // K(rx_a, ry_b) = dNa/dy*Db[3]*(-dNb/dx) + dNa/dx*Db[8]*(-dNb/dy)
            const rxry = (dNdy[a] * Db[3] * (-dNdx[b]) + dNdx[a] * Db[8] * (-dNdy[b])) * wdetJ;
            // K(ry_a, rx_b) = (-dNa/dx)*Db[1]*dNb/dy + (-dNa/dy)*Db[8]*dNb/dx
            const ryrx = ((-dNdx[a]) * Db[1] * dNdy[b] + (-dNdy[a]) * Db[8] * dNdx[b]) * wdetJ;
            // K(ry_a, ry_b) = (-dNa/dx)*Db[0]*(-dNb/dx) + (-dNa/dy)*Db[8]*(-dNb/dy)
            const ryry = (dNdx[a] * Db[0] * dNdx[b] + dNdy[a] * Db[8] * dNdy[b]) * wdetJ;

            K[(ai + 3) * n + (bi2 + 3)] += rxrx;
            K[(ai + 3) * n + (bi2 + 4)] += rxry;
            K[(ai + 4) * n + (bi2 + 3)] += ryrx;
            K[(ai + 4) * n + (bi2 + 4)] += ryry;
          }
        }
      }
    }
  }

  // ── 1×1 Reduced integration for transverse shear (if bending included) ──
  if (includeBending) {
    const xi = 0, eta = 0;
    const { dNdxi, dNdeta } = shapeFuncDerivs(xi, eta);
    const { detJ, invJ } = jacobian(dNdxi, dNdeta);
    const N = shapeFunc(xi, eta);

    const dNdx: number[] = [];
    const dNdy: number[] = [];
    for (let i = 0; i < 4; i++) {
      dNdx[i] = invJ[0] * dNdxi[i] + invJ[1] * dNdeta[i];
      dNdy[i] = invJ[2] * dNdxi[i] + invJ[3] * dNdeta[i];
    }

    const wdetJ = 4.0 * Math.abs(detJ); // weight = 2×2 = 4 for single point

    // Bs for node i:
    //   γxz = ∂uz/∂x + θy → Bs_xz = [dNi/dx, 0, Ni] on [uz(2), rx(3), ry(4)]
    //   γyz = ∂uz/∂y − θx → Bs_yz = [dNi/dy, -Ni, 0]
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        const ai = a * 6;
        const bi2 = b * 6;

        // K(uz_a, uz_b) = Ds*(dNa/dx*dNb/dx + dNa/dy*dNb/dy)
        const uzuz = Ds_coeff * (dNdx[a] * dNdx[b] + dNdy[a] * dNdy[b]) * wdetJ;
        // K(uz_a, rx_b) = Ds*(-dNa/dy*Nb) from γyz
        const uzrx = Ds_coeff * (dNdy[a] * (-N[b])) * wdetJ;
        // K(uz_a, ry_b) = Ds*(dNa/dx*Nb) from γxz
        const uzry = Ds_coeff * (dNdx[a] * N[b]) * wdetJ;
        // K(rx_a, uz_b) = Ds*(-Na*dNb/dy) from γyz
        const rxuz = Ds_coeff * ((-N[a]) * dNdy[b]) * wdetJ;
        // K(rx_a, rx_b) = Ds*(Na*Nb) from γyz
        const rxrx = Ds_coeff * (N[a] * N[b]) * wdetJ;
        // K(rx_a, ry_b) = 0 (no cross-term)
        // K(ry_a, uz_b) = Ds*(Na*dNb/dx) from γxz
        const ryuz = Ds_coeff * (N[a] * dNdx[b]) * wdetJ;
        // K(ry_a, ry_b) = Ds*(Na*Nb) from γxz
        const ryry = Ds_coeff * (N[a] * N[b]) * wdetJ;

        K[(ai + 2) * n + (bi2 + 2)] += uzuz;
        K[(ai + 2) * n + (bi2 + 3)] += uzrx;
        K[(ai + 2) * n + (bi2 + 4)] += uzry;
        K[(ai + 3) * n + (bi2 + 2)] += rxuz;
        K[(ai + 3) * n + (bi2 + 3)] += rxrx;
        K[(ai + 4) * n + (bi2 + 2)] += ryuz;
        K[(ai + 4) * n + (bi2 + 4)] += ryry;
      }
    }
  }

  // ── Drilling DOF (rz) stabilisation ──
  // Small penalty: α·Km_trace / 1000
  let trace = 0;
  for (let i = 0; i < n; i++) trace += Math.abs(K[i * n + i]);
  const alpha = trace / (n * 1000);
  for (let a = 0; a < 4; a++) {
    const rz = a * 6 + 5;
    K[rz * n + rz] += alpha;
  }

  // ── Apply stiffness reduction for REDUCED mode ──
  if (slabProps.stiffnessMode === 'REDUCED') {
    for (let i = 0; i < n * n; i++) K[i] *= factor;
  }

  return K;
}
