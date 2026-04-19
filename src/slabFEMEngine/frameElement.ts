/**
 * slabFEMEngine – Phase 7: 3D Euler-Bernoulli Frame Element
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Implements the local 12×12 stiffness matrix and 12×12 transformation matrix
 * for a 3D beam element lying in the horizontal X-Y plane (slab plane).
 *
 * ── DOF ordering (local and global after transformation) ─────────────────
 *   Node 1: [u1, v1, w1, θx1, θy1, θz1]
 *   Node 2: [u2, v2, w2, θx2, θy2, θz2]
 *
 *   u  = axial displacement (along beam local-x)
 *   v  = lateral displacement (local-y, horizontal perpendicular)
 *   w  = vertical displacement (local-z = global Z)
 *   θx = torsion about local-x
 *   θy = bending rotation about local-y  (convention: θy = −∂w/∂x_local)
 *   θz = bending rotation about local-z  (in-plane)
 *
 * ── Reference ────────────────────────────────────────────────────────────
 *   McGuire, Gallagher & Ziemian – "Matrix Structural Analysis", 2nd ed.
 *   Standard Euler-Bernoulli frame element (Table 4-1)
 *
 * ── Transformation ───────────────────────────────────────────────────────
 *   For a beam in the X-Y plane with direction angle α from global X:
 *     local-x = [cos α, sin α, 0]   (beam axis)
 *     local-y = [−sin α, cos α, 0]  (horizontal perpendicular)
 *     local-z = [0, 0, 1]           (vertical = global Z)
 *
 *   K_global = Tᵀ · K_local · T
 *
 * ── Coupling with slab (Phase 7) ─────────────────────────────────────────
 *   At interface nodes:
 *     UZ_slab  = UZ_beam_global   (vertical deflection)
 *     RX_slab  = RX_beam_global   (rotation about global X)
 *     RY_slab  = RY_beam_global   (rotation about global Y)
 *   These equality constraints are enforced via penalty stiffness.
 *
 * Units: mm, N, MPa, rad throughout.
 */

// ─────────────────────────────────────────────────────────────────────────────

export interface BeamFrameSection {
  /** Young's modulus (MPa) */
  E:  number;
  /** Shear modulus (MPa) */
  G:  number;
  /** Cross-section area (mm²) */
  A:  number;
  /** Moment of inertia about local y — strong axis, vertical bending (mm⁴) */
  Iy: number;
  /** Moment of inertia about local z — weak axis, in-plane bending (mm⁴) */
  Iz: number;
  /** Saint-Venant torsional constant (mm⁴) */
  J:  number;
  /** Element length (mm) */
  L:  number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local 12×12 stiffness matrix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the 12×12 Euler-Bernoulli local stiffness matrix.
 * Returns flat row-major Float64Array of length 144.
 *
 * DOF index map:
 *   0=u1  1=v1  2=w1  3=θx1  4=θy1  5=θz1
 *   6=u2  7=v2  8=w2  9=θx2  10=θy2 11=θz2
 */
export function buildLocalStiffness(s: BeamFrameSection): number[] {
  const { E, G, A, Iy, Iz, J, L } = s;
  const L2 = L * L;
  const L3 = L2 * L;

  const K = new Array(144).fill(0);

  // Helper: add value symmetrically (K is symmetric)
  const add = (i: number, j: number, v: number) => {
    K[i * 12 + j] += v;
    if (i !== j) K[j * 12 + i] += v;
  };

  // ── 1. Axial: DOF 0 (u1), 6 (u2) ──────────────────────────────────────
  const EA_L = E * A / L;
  add(0, 0,  EA_L);
  add(0, 6, -EA_L);
  add(6, 6,  EA_L);

  // ── 2. Torsion: DOF 3 (θx1), 9 (θx2) ──────────────────────────────────
  const GJ_L = G * J / L;
  add(3, 3,  GJ_L);
  add(3, 9, -GJ_L);
  add(9, 9,  GJ_L);

  // ── 3. Bending about z (in-plane): DOF 1 (v1), 5 (θz1), 7 (v2), 11 (θz2)
  //    Convention: θz = +∂v/∂x_local
  {
    const c = E * Iz / L3;
    add(1,  1,   12 * c);
    add(1,  5,    6 * c * L);
    add(1,  7,  -12 * c);
    add(1,  11,   6 * c * L);
    add(5,  5,    4 * c * L2);
    add(5,  7,   -6 * c * L);
    add(5,  11,   2 * c * L2);
    add(7,  7,   12 * c);
    add(7,  11,  -6 * c * L);
    add(11, 11,   4 * c * L2);
  }

  // ── 4. Bending about y (vertical): DOF 2 (w1), 4 (θy1), 8 (w2), 10 (θy2)
  //    Convention: θy = −∂w/∂x_local  (McGuire Table 4-1)
  //    Sign pattern: K[w,θy] = −6EIy/L²  (negative off-diagonal)
  {
    const c = E * Iy / L3;
    add(2,  2,   12 * c);
    add(2,  4,   -6 * c * L);   // negative: θy = −∂w/∂x
    add(2,  8,  -12 * c);
    add(2,  10,  -6 * c * L);   // negative
    add(4,  4,    4 * c * L2);
    add(4,  8,    6 * c * L);   // positive
    add(4,  10,   2 * c * L2);
    add(8,  8,   12 * c);
    add(8,  10,   6 * c * L);   // positive
    add(10, 10,   4 * c * L2);
  }

  return K;
}

// ─────────────────────────────────────────────────────────────────────────────
// 12×12 Transformation matrix T
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the 12×12 transformation matrix T (block-diagonal of four 3×3 R).
 *
 * Transforms global displacements to local:  d_local = T · d_global
 *
 * For a beam with axis direction [cos α, sin α, 0]:
 *   local-x = [cos α, sin α, 0]
 *   local-y = [−sin α, cos α, 0]
 *   local-z = [0, 0, 1]
 *
 * @param cosA  cos(angle from global X)
 * @param sinA  sin(angle from global X)
 */
export function buildTransformationMatrix(cosA: number, sinA: number): number[] {
  // 3×3 rotation R (local ← global)
  // Row 0: local-x in global coords = [cosA, sinA, 0]
  // Row 1: local-y in global coords = [−sinA, cosA, 0]
  // Row 2: local-z in global coords = [0, 0, 1]
  const R = [
     cosA,  sinA, 0,
    -sinA,  cosA, 0,
        0,     0, 1,
  ];

  const T = new Array(144).fill(0);

  // Four 3×3 R blocks on diagonal (translations + rotations for each node)
  for (let block = 0; block < 4; block++) {
    const off = block * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        T[(off + i) * 12 + (off + j)] = R[i * 3 + j];
      }
    }
  }

  return T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global stiffness: K_global = Tᵀ · K_local · T
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute K_global = Tᵀ · K_local · T  (12×12, flat row-major).
 *
 * Both K_local and T are flat row-major arrays of length 144.
 */
export function globalStiffness(K_local: number[], T: number[]): number[] {
  const n = 12;

  // Step 1: KT = K_local · T
  const KT = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const kik = K_local[i * n + k];
      if (kik === 0) continue;
      for (let j = 0; j < n; j++) {
        KT[i * n + j] += kik * T[k * n + j];
      }
    }
  }

  // Step 2: K_global = Tᵀ · KT  (Tᵀ[i,k] = T[k,i])
  const K_global = new Array(n * n).fill(0);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const tki = T[k * n + i]; // Tᵀ[i,k]
      if (tki === 0) continue;
      for (let j = 0; j < n; j++) {
        K_global[i * n + j] += tki * KT[k * n + j];
      }
    }
  }

  return K_global;
}

// ─────────────────────────────────────────────────────────────────────────────
// Element force recovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute beam element end forces in LOCAL coordinates.
 *
 *   d_local = T · d_global
 *   f_local = K_local · d_local
 *
 * @param d12_global  12-element displacement in global coords (2 beam nodes × 6 DOF)
 * @param K_local     12×12 local stiffness (flat row-major)
 * @param T           12×12 transformation matrix (flat row-major)
 * @returns 12-element force vector in local coords:
 *          [N1, Vy1, Vz1, Tx1, My1, Mz1, N2, Vy2, Vz2, Tx2, My2, Mz2]
 */
export function elementLocalForces(
  d12_global: number[],
  K_local:    number[],
  T:          number[],
): number[] {
  const n = 12;

  // d_local = T · d_global
  const d_local = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      d_local[i] += T[i * n + j] * d12_global[j];
    }
  }

  // f_local = K_local · d_local
  const f_local = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      f_local[i] += K_local[i * n + j] * d_local[j];
    }
  }

  return f_local;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section property helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute Saint-Venant torsional constant J for a solid rectangular section.
 * Approximation from Timoshenko & Goodier:
 *   J ≈ (b_min³ · b_max / 3) · (1 − 0.63 · b_min/b_max + 0.052 · (b_min/b_max)^5)
 */
export function rectangularJ(b: number, h: number): number {
  const bMin = Math.min(b, h);
  const bMax = Math.max(b, h);
  const r = bMin / bMax;
  return (bMin ** 3 * bMax / 3) * (1 - 0.63 * r + 0.052 * r ** 5);
}

/**
 * Build BeamFrameSection from beam cross-section dimensions and material.
 *
 * ── Stiffness note ────────────────────────────────────────────────────────
 * In the coupled slab-beam FEM (Phase 10), the beam element represents ONLY
 * the physical beam (rectangular downstand section).  The slab is modelled
 * separately as Mindlin shell elements, so there is no T-section effect here.
 *
 * ACI 318-19 Table 6.6.3.1.1 (Ie = 0.35 Ig for beams) applies to the
 * EQUIVALENT FRAME METHOD or direct-analysis method where beams are the sole
 * lateral/gravity load path.  In the coupled FEM, the beam and slab share the
 * stiffness organically through the global K matrix; applying the frame-only
 * modifier would under-stiffen beams relative to the slab (slab already uses
 * its own 0.25 modifier).  Therefore the gross rectangular section is used
 * here.  If the user selects "ignore slab stiffness", the beam becomes the
 * sole carrier and its gross stiffness is appropriate for that mode too.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * @param b_mm   Beam width (mm)
 * @param h_mm   Beam depth (mm)
 * @param L_mm   Beam element length (mm)
 * @param fc_MPa Concrete compressive strength (MPa) — for ACI Ec
 */
export function sectionFromBeam(
  b_mm: number,
  h_mm: number,
  L_mm: number,
  fc_MPa: number,
): BeamFrameSection {
  const Ec = 4700 * Math.sqrt(fc_MPa);  // MPa  ACI 318-19 §19.2.2.1
  const nu = 0.2;
  const G  = Ec / (2 * (1 + nu));

  const A  = b_mm * h_mm;
  const Iy = b_mm * h_mm ** 3 / 12;   // strong axis (vertical bending) — gross section
  const Iz = h_mm * b_mm ** 3 / 12;   // weak axis   (in-plane bending) — gross section
  const J  = rectangularJ(b_mm, h_mm);

  return { E: Ec, G, A, Iy, Iz, J, L: L_mm };
}
