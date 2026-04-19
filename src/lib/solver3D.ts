/**
 * 3D Frame Solver — ETABS-like Direct Stiffness Method
 * 
 * Each node has 6 DOF: [ux, uy, uz, θx, θy, θz]
 * Each beam-column element has a 12×12 local stiffness matrix.
 * 
 * Coordinate system (global):
 *   X = horizontal (plan X)
 *   Y = horizontal (plan Y)  
 *   Z = vertical (up)
 * 
 * Supports:
 *   - 3D beam-column frame elements
 *   - Rigid floor diaphragms
 *   - Multiple load cases with envelope
 *   - P-Delta geometric stiffness (Phase 2)
 *   - Member end releases (pins)
 * 
 * ACI 318-19 compliant stiffness modifiers:
 *   - Beams:   0.35 Ig (cracked section — ACI 318-19 §6.6.3.1.1)
 *   - Columns: 0.65 Ig (frame interaction — 0.35 جسور · 0.65 أعمدة)
 *   - Slabs:   0.25 Ig (for lateral analysis — ACI 318-19 §6.6.3.1.1)
 */

// ======================== TYPES ========================

export interface Node3D {
  id: string;
  x: number; // mm - global X
  y: number; // mm - global Y
  z: number; // mm - global Z (elevation)
  /** Restraints: [ux, uy, uz, θx, θy, θz] — true = fixed */
  restraints: [boolean, boolean, boolean, boolean, boolean, boolean];
  /** Rigid diaphragm group ID (all nodes in same group share ux, uy, θz) */
  diaphragmId?: string;
}

export interface Element3D {
  id: string;
  type: 'beam' | 'column';
  nodeI: string; // start node ID
  nodeJ: string; // end node ID
  /** Cross-section properties */
  b: number;  // width (mm)
  h: number;  // depth (mm)
  /** Material properties */
  E: number;  // Young's modulus (MPa)
  G: number;  // Shear modulus (MPa)
  /** Distributed load in local coordinates (kN/m) */
  wLocal: { wx: number; wy: number; wz: number };
  /** ACI stiffness modifier (0.35 for beams, 0.70 for columns) */
  stiffnessModifier: number;
  /** End releases: [nodeI, nodeJ] for each DOF (translational + rotational) */
  releases?: {
    nodeI: { ux?: boolean; uy?: boolean; uz?: boolean; mx: boolean; my: boolean; mz: boolean };
    nodeJ: { ux?: boolean; uy?: boolean; uz?: boolean; mx: boolean; my: boolean; mz: boolean };
  };
  /** Local axis orientation vector (for non-vertical columns / skewed beams) */
  localYOverride?: [number, number, number];
}

export interface LoadCase3D {
  id: string;
  name: string;
  type: 'dead' | 'live' | 'wind' | 'seismic';
  /** Element loads: elementId → { wx, wy, wz } in global coords (kN/m).
   *  For elements with a non-uniform slab profile, this contains ONLY the
   *  uniform portion (beam self-weight + wall load).  The slab load is
   *  encoded in elementLoadProfiles. */
  elementLoads: Map<string, { wx: number; wy: number; wz: number }>;
  /** Nodal loads: nodeId → [Fx, Fy, Fz, Mx, My, Mz] (kN, kN.m) */
  nodalLoads?: Map<string, number[]>;
  /**
   * Non-uniform slab load profiles for BEAM elements — local Y direction (kN/m).
   * For horizontal beams, local Y = global Z (upward), so gravity loads are negative.
   *
   * When present for an element, the profile FEF is ADDED to the UDL FEF from
   * elementLoads (which already handles beam self-weight + wall as uniform load).
   *
   * Profile points: t ∈ [0,1] (normalised position I→J), wy in kN/m.
   *
   * Shapes stored:
   *   Two-way long-side  → Trapezoidal: [(0,0),(a,peak),(1-a,peak),(1,0)]
   *   Two-way short-side → Triangular:  [(0,0),(0.5,peak),(1,0)]
   *   One-way long-side  → Uniform:     [(0,peak),(1,peak)]
   */
  elementLoadProfiles?: Map<string, Array<{t: number; wy: number}>>;
}

export interface LoadCombination3D {
  name: string;
  factors: Map<string, number>; // loadCaseId → factor
}

export interface ElementResult3D {
  elementId: string;
  /** Member end forces in local coordinates [Fx, Fy, Fz, Mx, My, Mz] at each end */
  forceI: number[]; // 6 forces at node I
  forceJ: number[]; // 6 forces at node J
  /** Key values for design */
  axial: number;        // Axial force (kN) — positive = tension
  shearY: number;       // Max shear in local Y (kN)
  shearZ: number;       // Max shear in local Z (kN)
  momentYmax: number;   // Max moment about local Y (kN.m)
  momentZmax: number;   // Max moment about local Z (kN.m)
  momentZmid: number;   // Mid-span moment about local Z (kN.m) — positive moment at L/2
  torsion: number;      // Torsional moment (kN.m)
  momentYI: number;     // Moment about Y at node I
  momentYJ: number;     // Moment about Y at node J
  momentZI: number;     // Moment about Z at node I
  momentZJ: number;     // Moment about Z at node J
  /** Moment diagram at nStations+1 equally-spaced stations along the beam (kN·m, ETABS sign convention: +ve=sagging) */
  momentStations?: number[];
}

export interface SolverResult3D {
  /** Nodal displacements: nodeId → [ux, uy, uz, θx, θy, θz] */
  displacements: Map<string, number[]>;
  /** Element results */
  elements: ElementResult3D[];
  /** Reactions: nodeId → [Fx, Fy, Fz, Mx, My, Mz] */
  reactions: Map<string, number[]>;
  /** Solver info */
  totalDOF: number;
  freeDOF: number;
  solveTimeMs: number;
}

export interface Model3D {
  nodes: Node3D[];
  elements: Element3D[];
}

// ======================== SECTION PROPERTIES ========================

export interface SectionProps {
  A: number;   // Cross-sectional area (mm²)
  Iy: number;  // Moment of inertia about local Y (mm⁴)
  Iz: number;  // Moment of inertia about local Z (mm⁴)
  J: number;   // Torsional constant (mm⁴)
}

export function rectangularSection(b: number, h: number): SectionProps {
  const A = b * h;
  // Standard mechanics definitions (parameters are abstract dimensions):
  //   Iy = ∫z² dA = (dimension along local y) × (dimension along local z)³ / 12
  //      = b × h³ / 12   where b is the dimension along the LOCAL Y axis
  //                       and h is the dimension along the LOCAL Z axis.
  //   Iz = ∫y² dA = h × b³ / 12
  //
  // IMPORTANT: The caller must pass parameters in (local-y-dim, local-z-dim) order.
  //   • Beams: call as rectangularSection(elem.h, elem.b)
  //            (beam depth h is along local Y = Global Z; width b is along local Z)
  //            → Iy = h×b³/12 (minor), Iz = b×h³/12 (major ← gravity bending)
  //   • Columns: call as rectangularSection(elem.b, elem.h)
  //            (col width b is along local Y = Global X; depth h is along local Z = Global Y)
  //            → Iy = b×h³/12, Iz = h×b³/12
  const Iy = b * Math.pow(h, 3) / 12;
  const Iz = h * Math.pow(b, 3) / 12;
  
  // Torsional constant for rectangular section (Saint-Venant)
  const a = Math.max(b, h) / 2;
  const bHalf = Math.min(b, h) / 2;
  const ratio = bHalf / a;
  // Approximation: J ≈ a * b³ * (1/3 - 0.21*(b/a)*(1 - b⁴/(12*a⁴)))
  const J = a * Math.pow(2 * bHalf, 3) * (1/3 - 0.21 * ratio * (1 - Math.pow(ratio, 4) / 12));
  
  return { A, Iy, Iz, J };
}

// ======================== COORDINATE TRANSFORMATION ========================

/**
 * Compute local coordinate system for a 3D frame element.
 * Returns 3×3 rotation matrix [xLocal, yLocal, zLocal] as row vectors.
 * 
 * ETABS-Compatible Local Axis Convention:
 * 
 * For vertical columns (matching ETABS):
 *   Local 1 (X) = along element = Global Z (upward)
 *   Local 2 (Y) = perpendicular = Global X direction
 *   Local 3 (Z) = cross product = Global Y direction
 *   → M2 (momentY) = moment about Global X axis = Mx
 *   → M3 (momentZ) = moment about Global Y axis = My
 * 
 * For horizontal beams:
 *   Local 1 (X) = along element axis (I → J)
 *   Local 2 (Y) = perpendicular, using Global Z as reference
 *   Local 3 (Z) = cross product (right-hand rule)
 */
function computeTransformationMatrix(
  xi: number, yi: number, zi: number,
  xj: number, yj: number, zj: number,
  localYOverride?: [number, number, number],
): number[][] {
  const dx = xj - xi;
  const dy = yj - yi;
  const dz = zj - zi;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  
  if (L < 1e-6) {
    return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  }
  
  // Local X axis (along element)
  const xL = [dx / L, dy / L, dz / L];
  
  // Reference vector for defining local Y
  let ref: number[];
  if (localYOverride) {
    ref = [...localYOverride];
  } else {
    // Check if element is nearly vertical
    const isVertical = Math.abs(xL[2]) > 0.999;
    if (isVertical) {
      // For vertical elements, use global X as reference
      ref = [1, 0, 0];
    } else {
      // For non-vertical elements, use global Z as reference
      ref = [0, 0, 1];
    }
  }
  
  // Local Z = xL × ref (cross product)
  const zL = [
    xL[1] * ref[2] - xL[2] * ref[1],
    xL[2] * ref[0] - xL[0] * ref[2],
    xL[0] * ref[1] - xL[1] * ref[0],
  ];
  const zLen = Math.sqrt(zL[0] * zL[0] + zL[1] * zL[1] + zL[2] * zL[2]);
  if (zLen > 1e-10) {
    zL[0] /= zLen; zL[1] /= zLen; zL[2] /= zLen;
  }
  
  // Local Y = zL × xL
  const yL = [
    zL[1] * xL[2] - zL[2] * xL[1],
    zL[2] * xL[0] - zL[0] * xL[2],
    zL[0] * xL[1] - zL[1] * xL[0],
  ];
  
  return [xL, yL, zL];
}

/**
 * Build 12×12 transformation matrix from local to global.
 * T = [R 0 0 0; 0 R 0 0; 0 0 R 0; 0 0 0 R] where R is 3×3 rotation matrix
 */
function buildTransformMatrix12(R: number[][]): Float64Array {
  const T = new Float64Array(144); // 12×12
  for (let block = 0; block < 4; block++) {
    const offset = block * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        T[(offset + i) * 12 + (offset + j)] = R[i][j];
      }
    }
  }
  return T;
}

// ======================== ELEMENT STIFFNESS MATRIX ========================

/**
 * 12×12 local stiffness matrix for 3D beam-column element.
 * DOF order: [ux, uy, uz, θx, θy, θz] at node I, then node J
 * 
 * Based on Euler-Bernoulli beam theory:
 * - Axial:   EA/L
 * - Bending: 12EI/L³, 6EI/L², 4EI/L, 2EI/L
 * - Torsion: GJ/L
 */
function elementStiffnessLocal(
  L: number,
  E: number, G: number,
  section: SectionProps,
  modifier: number = 1.0,
  ignoreTorsion: boolean = false,
): Float64Array {
  const { A, Iy, Iz, J } = section;
  
  const EA = E * A / 1e6;          // Convert to kN (mm² × MPa = N → /1000 = kN... but we work in consistent units)
  // We'll work in mm and kN throughout: 
  // E in MPa = N/mm², A in mm² → EA in N → /1000 = kN
  // EI in N.mm² → divide by 1e9 for kN.m² ... 
  // Actually let's keep everything in N and mm for the stiffness matrix, 
  // then convert forces to kN and moments to kN.m at the end.
  
  const EIy = E * Iy * modifier;  // N.mm²
  const EIz = E * Iz * modifier;  // N.mm²
  const EA_L = E * A / L;          // N/mm
  const GJ_L = ignoreTorsion ? 0 : G * J / L;  // N.mm

  const L2 = L * L;
  const L3 = L2 * L;
  
  const ke = new Float64Array(144); // 12×12
  
  // Helper to set symmetric entries
  const set = (i: number, j: number, v: number) => {
    ke[i * 12 + j] = v;
    ke[j * 12 + i] = v;
  };
  
  // Axial: DOF 0 (ux_I) and 6 (ux_J)
  ke[0 * 12 + 0] = EA_L;
  ke[6 * 12 + 6] = EA_L;
  set(0, 6, -EA_L);
  
  // Bending in XY plane (about local Z): DOF 1 (uy_I), 5 (θz_I), 7 (uy_J), 11 (θz_J)
  ke[1 * 12 + 1] = 12 * EIz / L3;
  set(1, 5, 6 * EIz / L2);
  set(1, 7, -12 * EIz / L3);
  set(1, 11, 6 * EIz / L2);
  
  ke[5 * 12 + 5] = 4 * EIz / L;
  set(5, 7, -6 * EIz / L2);
  set(5, 11, 2 * EIz / L);
  
  ke[7 * 12 + 7] = 12 * EIz / L3;
  set(7, 11, -6 * EIz / L2);
  
  ke[11 * 12 + 11] = 4 * EIz / L;
  
  // Bending in XZ plane (about local Y): DOF 2 (uz_I), 4 (θy_I), 8 (uz_J), 10 (θy_J)
  ke[2 * 12 + 2] = 12 * EIy / L3;
  set(2, 4, -6 * EIy / L2);     // Note: sign convention differs for Y-bending
  set(2, 8, -12 * EIy / L3);
  set(2, 10, -6 * EIy / L2);
  
  ke[4 * 12 + 4] = 4 * EIy / L;
  set(4, 8, 6 * EIy / L2);
  set(4, 10, 2 * EIy / L);
  
  ke[8 * 12 + 8] = 12 * EIy / L3;
  set(8, 10, 6 * EIy / L2);
  
  ke[10 * 12 + 10] = 4 * EIy / L;
  
  // Torsion: DOF 3 (θx_I) and 9 (θx_J)
  ke[3 * 12 + 3] = GJ_L;
  ke[9 * 12 + 9] = GJ_L;
  set(3, 9, -GJ_L);
  
  return ke;
}

/**
 * Fixed-end forces for uniformly distributed load in local coordinates.
 * wLocal = [wx, wy, wz] in N/mm (local axes)
 * Returns 12-element vector of fixed-end forces.
 */
function fixedEndForcesUDL(
  L: number,
  wx: number, wy: number, wz: number,
): Float64Array {
  const fef = new Float64Array(12);
  
  // Axial (wx along element axis)
  fef[0] = wx * L / 2;    // Fx at I
  fef[6] = wx * L / 2;    // Fx at J
  
  // Bending in XY plane (wy transverse load)
  fef[1] = wy * L / 2;           // Fy at I
  fef[5] = wy * L * L / 12;      // Mz at I
  fef[7] = wy * L / 2;           // Fy at J
  fef[11] = -wy * L * L / 12;    // Mz at J
  
  // Bending in XZ plane (wz transverse load)
  fef[2] = wz * L / 2;           // Fz at I
  fef[4] = -wz * L * L / 12;     // My at I
  fef[8] = wz * L / 2;           // Fz at J
  fef[10] = wz * L * L / 12;     // My at J
  
  return fef;
}

// ──────────────────────────────────────────────────────────────────────────────
// 16-point Gauss-Legendre quadrature nodes & weights on [0, 1]
// Used for non-uniform distributed-load FEF computation.
// ──────────────────────────────────────────────────────────────────────────────
const GL16_PTS: readonly number[] = [
  0.00529953325, 0.02771248844, 0.06718439876, 0.12229779581,
  0.19106187786, 0.27099161127, 0.35919822462, 0.45249374513,
  0.54750625487, 0.64080177538, 0.72900838873, 0.80893812214,
  0.87770220419, 0.93281560124, 0.97228751156, 0.99470046675,
];
const GL16_WTS: readonly number[] = [
  0.01357622974, 0.03112676197, 0.04712743581, 0.06225352393,
  0.07600592455, 0.08871109072, 0.09917359872, 0.10474107969,
  0.10474107969, 0.09917359872, 0.08871109072, 0.07600592455,
  0.06225352393, 0.04712743581, 0.03112676197, 0.01357622974,
];

/**
 * Fixed-end forces for a NON-UNIFORM distributed load profile in the local Y
 * direction — used to apply the actual trapezoidal / triangular slab load
 * distribution as in ETABS, instead of the equivalent UDL approximation.
 *
 * Units:
 *   L   — element length (mm, same as the rest of the solver)
 *   wy  — load intensity (kN/m, negative = downward for horizontal beams)
 *   FEF — forces in N, moments in N·mm  (1 kN/m × 1 mm = 1 N)
 *
 * Only populates DOFs:  1  (Fy_I), 5  (Mz_I), 7  (Fy_J), 11 (Mz_J)
 * (bending in the local XY plane, i.e. the vertical plane for horizontal beams)
 *
 * Integration uses 16-point Gauss-Legendre quadrature on [0, 1] → then maps
 * to [0, L] via x = t·L, dx = L·dt.
 *
 * Influence functions for a fixed–fixed beam (unit downward load at position x):
 *   Fy_I shape  = (L-x)²·(L+2x) / L³
 *   Fy_J shape  = x²·(3L-2x)   / L³
 *   Mz_I shape  = x·(L-x)²     / L²   (positive = matches code sign convention)
 *   Mz_J shape  = −x²·(L-x)    / L²
 */
function fixedEndForcesProfile(
  L: number,
  profile: ReadonlyArray<{ t: number; wy: number }>,
): Float64Array {
  const fef = new Float64Array(12);
  if (!profile || profile.length < 2) return fef;

  // Sort by t so the interpolation loop always works correctly
  const pts = [...profile].sort((a, b) => a.t - b.t);

  /** Linear interpolation of wy at normalised position t ∈ [0, 1] */
  const interp = (t: number): number => {
    if (t <= pts[0].t) return pts[0].wy;
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].wy;
    for (let i = 0; i < pts.length - 1; i++) {
      if (t >= pts[i].t && t <= pts[i + 1].t) {
        const dt = pts[i + 1].t - pts[i].t;
        if (dt < 1e-10) return pts[i].wy;
        return pts[i].wy + (pts[i + 1].wy - pts[i].wy) * (t - pts[i].t) / dt;
      }
    }
    return 0;
  };

  for (let k = 0; k < 16; k++) {
    const t  = GL16_PTS[k];
    const gw = GL16_WTS[k];
    const wy = interp(t);
    if (Math.abs(wy) < 1e-14) continue;

    const x  = t * L;
    const dx = gw * L; // integration element (change of variable: dx = L·dt)

    // Fy_I: (L-x)²·(L+2x) / L³
    fef[1]  += wy * (L - x) * (L - x) * (L + 2 * x) / (L * L * L) * dx;
    // Fy_J: x²·(3L-2x) / L³
    fef[7]  += wy * x * x * (3 * L - 2 * x) / (L * L * L) * dx;
    // Mz_I: x·(L-x)² / L²
    fef[5]  += wy * x * (L - x) * (L - x) / (L * L) * dx;
    // Mz_J: −x²·(L-x) / L²
    fef[11] += -wy * x * x * (L - x) / (L * L) * dx;
  }

  return fef;
}

/**
 * Transform element load from global to local coordinates.
 */
function globalToLocalLoad(
  R: number[][],
  wGlobal: { wx: number; wy: number; wz: number },
): { wx: number; wy: number; wz: number } {
  // R transforms local to global, so R^T transforms global to local
  return {
    wx: R[0][0] * wGlobal.wx + R[0][1] * wGlobal.wy + R[0][2] * wGlobal.wz,
    wy: R[1][0] * wGlobal.wx + R[1][1] * wGlobal.wy + R[1][2] * wGlobal.wz,
    wz: R[2][0] * wGlobal.wx + R[2][1] * wGlobal.wy + R[2][2] * wGlobal.wz,
  };
}

// ======================== MATRIX OPERATIONS ========================

/** Multiply: result = T^T × K × T (transform local stiffness to global) */
function transformStiffnessToGlobal(
  ke_local: Float64Array,
  T: Float64Array,
): Float64Array {
  const n = 12;
  // temp = K_local × T
  const temp = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += ke_local[i * n + k] * T[k * n + j];
      }
      temp[i * n + j] = sum;
    }
  }
  
  // result = T^T × temp
  const ke_global = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += T[k * n + i] * temp[k * n + j]; // T^T[i][k] = T[k][i]
      }
      ke_global[i * n + j] = sum;
    }
  }
  
  return ke_global;
}

/** Transform force vector: fGlobal = T^T × fLocal */
function transformForceToGlobal(fLocal: Float64Array, T: Float64Array): Float64Array {
  const n = 12;
  const fGlobal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < n; k++) {
      sum += T[k * n + i] * fLocal[k]; // T^T[i][k] = T[k][i]
    }
    fGlobal[i] = sum;
  }
  return fGlobal;
}

/** Transform displacement vector: dLocal = T × dGlobal */
function transformDispToLocal(dGlobal: Float64Array, T: Float64Array): Float64Array {
  const n = 12;
  const dLocal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < n; k++) {
      sum += T[i * n + k] * dGlobal[k];
    }
    dLocal[i] = sum;
  }
  return dLocal;
}

// ======================== GAUSSIAN ELIMINATION SOLVER ========================

/**
 * Solve K*d = F using Gaussian elimination with partial pivoting.
 * Operates on flat Float64Arrays for performance.
 */
function solveLinearSystem(K: Float64Array, F: Float64Array, n: number): Float64Array {
  // Build augmented matrix [K|F]
  const ncols = n + 1;
  const A = new Float64Array(n * ncols);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      A[i * ncols + j] = K[i * n + j];
    }
    A[i * ncols + n] = F[i];
  }
  
  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(A[col * ncols + col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(A[row * ncols + col]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    
    // Swap rows
    if (maxRow !== col) {
      for (let j = col; j <= n; j++) {
        const tmp = A[col * ncols + j];
        A[col * ncols + j] = A[maxRow * ncols + j];
        A[maxRow * ncols + j] = tmp;
      }
    }
    
    const pivot = A[col * ncols + col];
    if (Math.abs(pivot) < 1e-14) continue;
    
    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = A[row * ncols + col] / pivot;
      if (Math.abs(factor) < 1e-15) continue;
      for (let j = col; j <= n; j++) {
        A[row * ncols + j] -= factor * A[col * ncols + j];
      }
    }
  }
  
  // Back substitution
  const d = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = A[i * ncols + n];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i * ncols + j] * d[j];
    }
    const diag = A[i * ncols + i];
    d[i] = Math.abs(diag) > 1e-14 ? sum / diag : 0;
  }
  
  return d;
}

// ======================== RIGID DIAPHRAGM ========================

/**
 * Apply rigid diaphragm constraints.
 * All nodes in the same diaphragm group share: ux, uy, θz
 * Their displacements are expressed as:
 *   ux_i = ux_master - θz_master * (yi - y_master)
 *   uy_i = uy_master + θz_master * (xi - x_master)
 *   θz_i = θz_master
 * 
 * This is implemented via a constraint transformation matrix.
 */
interface DiaphragmGroup {
  id: string;
  masterNodeId: string;
  slaveNodeIds: string[];
  centerX: number;
  centerY: number;
}

function buildDiaphragmGroups(nodes: Node3D[]): DiaphragmGroup[] {
  const groups = new Map<string, Node3D[]>();
  
  for (const node of nodes) {
    if (node.diaphragmId) {
      const group = groups.get(node.diaphragmId) || [];
      group.push(node);
      groups.set(node.diaphragmId, group);
    }
  }
  
  const result: DiaphragmGroup[] = [];
  for (const [id, gnodes] of Array.from(groups.entries())) {
    if (gnodes.length < 2) continue;
    
    // Center of mass (simplified - equal weight)
    const cx = gnodes.reduce((s, n) => s + n.x, 0) / gnodes.length;
    const cy = gnodes.reduce((s, n) => s + n.y, 0) / gnodes.length;
    
    // Master = first node (or could be center of mass node)
    const master = gnodes[0];
    const slaves = gnodes.slice(1);
    
    result.push({
      id,
      masterNodeId: master.id,
      slaveNodeIds: slaves.map(n => n.id),
      centerX: cx,
      centerY: cy,
    });
  }
  
  return result;
}

// ======================== MAIN SOLVER ========================
// ==================== STATIC CONDENSATION ====================

/**
 * Proper static condensation (Schur complement) for end releases.
 * Given a 12x12 element stiffness matrix and a list of released DOF indices,
 * computes K* = K_rr - K_rc * K_cc^(-1) * K_cr
 * Returns a new 12x12 matrix with condensed stiffness (released DOFs have zero rows/cols).
 */
function applyStaticCondensation(ke: Float64Array, releasedDofs: number[]): Float64Array {
  const n = 12;
  const nC = releasedDofs.length;
  const retainedDofs: number[] = [];
  const relSet = new Set(releasedDofs);
  for (let i = 0; i < n; i++) {
    if (!relSet.has(i)) retainedDofs.push(i);
  }
  const nR = retainedDofs.length;

  // Extract K_cc (nC x nC)
  const Kcc = new Float64Array(nC * nC);
  for (let i = 0; i < nC; i++) {
    for (let j = 0; j < nC; j++) {
      Kcc[i * nC + j] = ke[releasedDofs[i] * n + releasedDofs[j]];
    }
  }

  // Invert K_cc using Gaussian elimination
  const KccInv = invertMatrix(Kcc, nC);
  if (!KccInv) {
    // Fallback: just zero out rows/cols if inversion fails
    const result = new Float64Array(ke);
    for (const rd of releasedDofs) {
      for (let i = 0; i < n; i++) { result[rd * n + i] = 0; result[i * n + rd] = 0; }
    }
    return result;
  }

  // Extract K_rc (nR x nC) and K_cr (nC x nR)
  const Krc = new Float64Array(nR * nC);
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j < nC; j++) {
      Krc[i * nC + j] = ke[retainedDofs[i] * n + releasedDofs[j]];
    }
  }

  // Compute K_rc * K_cc^(-1) (nR x nC)
  const KrcKccInv = new Float64Array(nR * nC);
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j < nC; j++) {
      let sum = 0;
      for (let k = 0; k < nC; k++) {
        sum += Krc[i * nC + k] * KccInv[k * nC + j];
      }
      KrcKccInv[i * nC + j] = sum;
    }
  }

  // Compute correction: K_rc * K_cc^(-1) * K_cr (nR x nR)
  const correction = new Float64Array(nR * nR);
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j < nR; j++) {
      let sum = 0;
      for (let k = 0; k < nC; k++) {
        sum += KrcKccInv[i * nC + k] * ke[releasedDofs[k] * n + retainedDofs[j]];
      }
      correction[i * nR + j] = sum;
    }
  }

  // Build condensed 12x12: K*_rr = K_rr - correction, released DOFs = 0
  const result = new Float64Array(n * n);
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j < nR; j++) {
      result[retainedDofs[i] * n + retainedDofs[j]] =
        ke[retainedDofs[i] * n + retainedDofs[j]] - correction[i * nR + j];
    }
  }

  return result;
}

/**
 * Apply static condensation to Fixed End Forces.
 * F*_r = F_r - K_rc * K_cc^(-1) * F_c
 * Released DOF forces are set to zero.
 */
function applyStaticCondensationFEF(ke_orig: Float64Array, fef: Float64Array, releasedDofs: number[]): Float64Array {
  const n = 12;
  const nC = releasedDofs.length;
  const relSet = new Set(releasedDofs);
  const retainedDofs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!relSet.has(i)) retainedDofs.push(i);
  }
  const nR = retainedDofs.length;

  // Extract K_cc and invert
  const Kcc = new Float64Array(nC * nC);
  for (let i = 0; i < nC; i++) {
    for (let j = 0; j < nC; j++) {
      Kcc[i * nC + j] = ke_orig[releasedDofs[i] * n + releasedDofs[j]];
    }
  }
  const KccInv = invertMatrix(Kcc, nC);
  if (!KccInv) {
    // Fallback: just zero released FEF
    const result = new Float64Array(fef);
    for (const rd of releasedDofs) result[rd] = 0;
    return result;
  }

  // F_c (condensed DOF forces)
  const Fc = new Float64Array(nC);
  for (let i = 0; i < nC; i++) Fc[i] = fef[releasedDofs[i]];

  // K_cc^(-1) * F_c
  const KccInvFc = new Float64Array(nC);
  for (let i = 0; i < nC; i++) {
    let sum = 0;
    for (let j = 0; j < nC; j++) sum += KccInv[i * nC + j] * Fc[j];
    KccInvFc[i] = sum;
  }

  // F*_r = F_r - K_rc * K_cc^(-1) * F_c
  const result = new Float64Array(n);
  for (let i = 0; i < nR; i++) {
    let correction = 0;
    for (let k = 0; k < nC; k++) {
      correction += ke_orig[retainedDofs[i] * n + releasedDofs[k]] * KccInvFc[k];
    }
    result[retainedDofs[i]] = fef[retainedDofs[i]] - correction;
  }
  // Released DOFs: force = 0 (by definition)
  return result;
}

/**
 * Invert a small dense matrix using Gaussian elimination with partial pivoting.
 * Returns null if matrix is singular.
 */
function invertMatrix(A: Float64Array, n: number): Float64Array | null {
  // Augmented matrix [A | I]
  const aug = new Float64Array(n * 2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) aug[i * 2 * n + j] = A[i * n + j];
    aug[i * 2 * n + n + i] = 1;
  }

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    let maxVal = Math.abs(aug[col * 2 * n + col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row * 2 * n + col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    if (maxVal < 1e-15) return null; // Singular

    if (maxRow !== col) {
      for (let j = 0; j < 2 * n; j++) {
        const tmp = aug[col * 2 * n + j];
        aug[col * 2 * n + j] = aug[maxRow * 2 * n + j];
        aug[maxRow * 2 * n + j] = tmp;
      }
    }

    const pivot = aug[col * 2 * n + col];
    for (let j = 0; j < 2 * n; j++) aug[col * 2 * n + j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row * 2 * n + col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row * 2 * n + j] -= factor * aug[col * 2 * n + j];
      }
    }
  }

  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) inv[i * n + j] = aug[i * 2 * n + n + j];
  }
  return inv;
}


/**
 * Analyze a 3D frame model.
 * 
 * Process:
 * 1. Compute element properties (section, transformation)
 * 2. Assemble global stiffness matrix
 * 3. Apply boundary conditions
 * 4. Solve for displacements
 * 5. Compute member end forces in local coordinates
 * 6. Extract reactions
 */
export function analyze3DFrame(
  model: Model3D,
  loadCase: LoadCase3D,
  options?: {
    useDiaphragm?: boolean;
    enablePDelta?: boolean;
    pDeltaMaxIterations?: number;
    pDeltaConvergenceTol?: number;
    ignoreTorsion?: boolean;
  },
): SolverResult3D {
  const t0 = performance.now();
  const { nodes, elements } = model;
  const ignoreTorsion = options?.ignoreTorsion ?? false;
  
  // Build node index map
  const nodeIndex = new Map<string, number>();
  nodes.forEach((n, i) => nodeIndex.set(n.id, i));
  
  const nNodes = nodes.length;
  const nDOF = nNodes * 6;
  
  // ---- Pre-compute element data ----
  interface ElemData {
    elem: Element3D;
    L: number;
    R: number[][];
    T: Float64Array;
    section: SectionProps;
    ke_local: Float64Array;
    ke_global: Float64Array;
    fef_local: Float64Array;
    fef_global: Float64Array;
    dofsI: number[];
    dofsJ: number[];
  }
  
  const elemDataList: ElemData[] = [];
  
  for (const elem of elements) {
    const iIdx = nodeIndex.get(elem.nodeI)!;
    const jIdx = nodeIndex.get(elem.nodeJ)!;
    const ni = nodes[iIdx];
    const nj = nodes[jIdx];
    
    const dx = nj.x - ni.x;
    const dy = nj.y - ni.y;
    const dz = nj.z - ni.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (L < 1e-3) continue; // Skip zero-length elements
    
    const R = computeTransformationMatrix(
      ni.x, ni.y, ni.z, nj.x, nj.y, nj.z,
      elem.localYOverride,
    );
    const T = buildTransformMatrix12(R);
    
    // For HORIZONTAL BEAMS: the cross-section lies in the local YZ plane where
    //   local Y = Global Z (vertical = beam depth h) and local Z = Global ±Y (horizontal = beam width b).
    //   Standard definitions:
    //     Iz = ∫y² dA = b×h³/12  (major axis — gravity bending about local Z)
    //     Iy = ∫z² dA = h×b³/12  (minor axis — lateral bending about local Y)
    //   rectangularSection(p1,p2) computes: Iy = p1×p2³/12, Iz = p2×p1³/12.
    //   So to get Iz = b×h³/12 we must pass (h, b) → Iz = b×h³/12  ✓
    //
    // For VERTICAL COLUMNS: local Y = Global X (dim b) and local Z = Global Y (dim h).
    //   Correct:  Iy = b×h³/12, Iz = h×b³/12
    //   rectangularSection(b, h) → Iy = b×h³/12  ✓   Iz = h×b³/12  ✓
    //
    // This swap fixes the previous bug where horizontal-beam gravity bending
    // was using the MINOR-AXIS inertia (h×b³/12) instead of the MAJOR-AXIS (b×h³/12),
    // causing beam stiffness to be (h/b)² ≈ 4× too small for typical beams (b=250, h=500).
    const section = elem.type === 'beam'
      ? rectangularSection(elem.h, elem.b)   // beam: pass depth first → Iz = b×h³/12 (major axis)
      : rectangularSection(elem.b, elem.h);  // column: pass width first → Iy = b×h³/12, Iz = h×b³/12
    let ke_local = elementStiffnessLocal(L, elem.E, elem.G, section, elem.stiffnessModifier, ignoreTorsion);
    let fef_needs_condensation = false;
    
    // Apply proper static condensation for end releases (ETABS-style)
    // Supports all 6 DOFs per end: U1(ux), U2(uy), U3(uz), R1(mx), R2(my), R3(mz)
    // Schur complement: K* = K_rr - K_rc * K_cc^(-1) * K_cr
    if (elem.releases) {
      const rI = elem.releases.nodeI;
      const rJ = elem.releases.nodeJ;
      
      // ETABS instability checks — skip unstable releases
      const unstable =
        (rI?.ux && rJ?.ux) ||  // U1 at both ends
        (rI?.uy && rJ?.uy) ||  // U2 at both ends
        (rI?.uz && rJ?.uz) ||  // U3 at both ends
        (rI?.mx && rJ?.mx) ||  // R1 at both ends
        (rI?.my && rJ?.my && (rI?.uz || rJ?.uz)) ||  // R2 both + U3 either
        (rI?.mz && rJ?.mz && (rI?.uy || rJ?.uy));    // R3 both + U2 either
      
      if (!unstable) {
        const releasedDofs: number[] = [];
        if (rI) {
          if (rI.ux) releasedDofs.push(0);
          if (rI.uy) releasedDofs.push(1);
          if (rI.uz) releasedDofs.push(2);
          if (rI.mx) releasedDofs.push(3);
          if (rI.my) releasedDofs.push(4);
          if (rI.mz) releasedDofs.push(5);
        }
        if (rJ) {
          if (rJ.ux) releasedDofs.push(6);
          if (rJ.uy) releasedDofs.push(7);
          if (rJ.uz) releasedDofs.push(8);
          if (rJ.mx) releasedDofs.push(9);
          if (rJ.my) releasedDofs.push(10);
          if (rJ.mz) releasedDofs.push(11);
        }
        if (releasedDofs.length > 0) {
          ke_local = applyStaticCondensation(ke_local, releasedDofs);
          fef_needs_condensation = true;
        }
      }
    }
    
    const ke_global = transformStiffnessToGlobal(ke_local, T);
    
    // Get element load from load case
    const loadGlobal = loadCase.elementLoads.get(elem.id) || { wx: 0, wy: 0, wz: 0 };
    // Add element's own wLocal (self-weight etc.)
    // First transform wLocal to global and add
    const wLocalFromElem = {
      wx: elem.wLocal.wx,
      wy: elem.wLocal.wy,
      wz: elem.wLocal.wz,
    };
    
    // Convert load case global load to local
    const lcLocal = globalToLocalLoad(R, loadGlobal);
    
    // Total local load = element's own local + load case (converted to local)
    const totalLocalW = {
      wx: wLocalFromElem.wx + lcLocal.wx,
      wy: wLocalFromElem.wy + lcLocal.wy,
      wz: wLocalFromElem.wz + lcLocal.wz,
    };
    
    // FEF in local, then transform to global
    // Convert kN/m to N/mm: × 1 (since we work in N/mm consistently)
    let fef_local = fixedEndForcesUDL(L, totalLocalW.wx, totalLocalW.wy, totalLocalW.wz);

    // ── ETABS-equivalent non-uniform slab load profile ────────────────────────
    // For horizontal beams with a trapezoidal/triangular slab tributary load,
    // the standard UDL-equivalent FEF over-estimates fixed-end support moments
    // by ~7–11%.  When a profile is supplied in the load case, we REPLACE the
    // wy-direction FEF components (DOFs 1,5,7,11) with numerically integrated
    // values from the actual non-uniform load shape.
    //
    // The profile is already in local Y units (kN/m, negative = downward) because
    // for any horizontal beam, local Y = global Z (upward) regardless of plan
    // orientation — the coordinate-system construction uses global Z as the
    // "up" reference, so lcLocal.wy = loadGlobal.wz for every horizontal beam.
    //
    // elementLoads for such an element contains ONLY the UNIFORM portion (beam
    // self-weight + wall load); the slab contribution lives entirely in the profile.
    // ──────────────────────────────────────────────────────────────────────────
    const wyProfile = loadCase.elementLoadProfiles?.get(elem.id);
    if (wyProfile && wyProfile.length >= 2 && elem.type === 'beam') {
      const fef_prof = fixedEndForcesProfile(L, wyProfile);
      // Copy the base FEF array and ADD the profile contribution to wy DOFs
      const combined = new Float64Array(fef_local);
      combined[1]  += fef_prof[1];   // Fy at I
      combined[5]  += fef_prof[5];   // Mz at I
      combined[7]  += fef_prof[7];   // Fy at J
      combined[11] += fef_prof[11];  // Mz at J
      fef_local = combined;
    }
    // Apply static condensation to FEF: F*_r = F_r - K_rc * K_cc^(-1) * F_c
    if (fef_needs_condensation && elem.releases) {
      const rI = elem.releases.nodeI;
      const rJ = elem.releases.nodeJ;
      const releasedDofs: number[] = [];
      if (rI) {
        if (rI.ux) releasedDofs.push(0);
        if (rI.uy) releasedDofs.push(1);
        if (rI.uz) releasedDofs.push(2);
        if (rI.mx) releasedDofs.push(3);
        if (rI.my) releasedDofs.push(4);
        if (rI.mz) releasedDofs.push(5);
      }
      if (rJ) {
        if (rJ.ux) releasedDofs.push(6);
        if (rJ.uy) releasedDofs.push(7);
        if (rJ.uz) releasedDofs.push(8);
        if (rJ.mx) releasedDofs.push(9);
        if (rJ.my) releasedDofs.push(10);
        if (rJ.mz) releasedDofs.push(11);
      }
      // Need original ke for FEF condensation
      const ke_orig = elementStiffnessLocal(L, elem.E, elem.G, section, elem.stiffnessModifier, ignoreTorsion);
      const condensedFef = applyStaticCondensationFEF(ke_orig, fef_local, releasedDofs);
      for (let i = 0; i < 12; i++) fef_local[i] = condensedFef[i];
    }
    const fef_global = transformForceToGlobal(fef_local, T);
    
    const dofsI = Array.from({ length: 6 }, (_, k) => iIdx * 6 + k);
    const dofsJ = Array.from({ length: 6 }, (_, k) => jIdx * 6 + k);
    
    elemDataList.push({
      elem, L, R, T, section, ke_local, ke_global,
      fef_local, fef_global, dofsI, dofsJ,
    });
  }
  
  // ---- Assemble global stiffness matrix and force vector ----
  const K_elastic = new Float64Array(nDOF * nDOF);
  const F = new Float64Array(nDOF);
  
  for (const ed of elemDataList) {
    const allDofs = [...ed.dofsI, ...ed.dofsJ];
    
    // Assemble stiffness
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        K_elastic[allDofs[i] * nDOF + allDofs[j]] += ed.ke_global[i * 12 + j];
      }
      // Assemble fixed-end forces (negative because FEF opposes applied load)
      F[allDofs[i]] -= ed.fef_global[i];
    }
  }
  
  // Apply nodal loads from load case
  if (loadCase.nodalLoads) {
    for (const [nodeId, forces] of Array.from(loadCase.nodalLoads.entries())) {
      const idx = nodeIndex.get(nodeId);
      if (idx === undefined) continue;
      for (let k = 0; k < 6 && k < forces.length; k++) {
        F[idx * 6 + k] += forces[k];
      }
    }
  }
  
  // ---- Apply boundary conditions ----
  const isFixed = new Uint8Array(nDOF);
  for (let i = 0; i < nNodes; i++) {
    const r = nodes[i].restraints;
    for (let k = 0; k < 6; k++) {
      if (r[k]) isFixed[i * 6 + k] = 1;
    }
  }
  
  // Collect free DOFs
  const freeDOFs: number[] = [];
  for (let i = 0; i < nDOF; i++) {
    if (!isFixed[i]) freeDOFs.push(i);
  }
  
  const nFree = freeDOFs.length;
  
  // ---- P-Delta Geometric Stiffness (ACI 318-19 §6.6.4) ----
  // ETABS-like iterative P-Delta analysis:
  // 1. Solve with elastic K to get initial displacements
  // 2. Compute geometric stiffness Kg from axial forces
  // 3. Re-solve with K_total = K_elastic + Kg
  // 4. Iterate until convergence
  
  const enablePDelta = options?.enablePDelta ?? false;
  const pDeltaMaxIter = options?.pDeltaMaxIterations ?? 5;
  const pDeltaTol = options?.pDeltaConvergenceTol ?? 0.01;
  
  let d = new Float64Array(nDOF);
  
  /**
   * Build geometric stiffness matrix for a single element.
   * For beam-column elements with axial force P:
   * Kg accounts for the P*Δ effect on lateral stiffness.
   * 
   * Local geometric stiffness (simplified for columns):
   * Affects lateral DOFs (uy, uz) and rotational DOFs (θy, θz)
   */
  const buildElementGeometricStiffness = (
    P: number, // Axial force in N (negative = compression)
    L_elem: number,
    T: Float64Array,
  ): Float64Array => {
    const kg_local = new Float64Array(144); // 12×12
    const L2 = L_elem * L_elem;
    
    // Geometric stiffness matrix for beam-column (consistent formulation)
    // P/L terms for lateral displacement coupling
    const PoverL = Math.abs(P) / L_elem; // Use |P| — compression causes instability
    const PL30 = Math.abs(P) * L_elem / 30;
    
    // Only apply for compressive axial force (P < 0 means compression in our convention)
    if (P >= 0) return kg_local; // Tension doesn't cause P-Delta instability
    
    const Pabs = Math.abs(P);
    
    // Lateral stiffness reduction in XY plane (DOFs 1,5,7,11)
    const set = (i: number, j: number, v: number) => {
      kg_local[i * 12 + j] += v;
      if (i !== j) kg_local[j * 12 + i] += v;
    };
    
    // uy-uy coupling (nodes I and J)
    set(1, 1, 6 * Pabs / (5 * L_elem));
    set(1, 7, -6 * Pabs / (5 * L_elem));
    set(7, 7, 6 * Pabs / (5 * L_elem));
    
    // uy-θz coupling
    set(1, 5, Pabs / 10);
    set(1, 11, -Pabs / 10);
    set(7, 5, -Pabs / 10);
    set(7, 11, Pabs / 10);
    
    // θz-θz coupling
    set(5, 5, 2 * Pabs * L_elem / 15);
    set(5, 11, -Pabs * L_elem / 30);
    set(11, 11, 2 * Pabs * L_elem / 15);
    
    // uz-uz coupling (DOFs 2,4,8,10)
    set(2, 2, 6 * Pabs / (5 * L_elem));
    set(2, 8, -6 * Pabs / (5 * L_elem));
    set(8, 8, 6 * Pabs / (5 * L_elem));
    
    // uz-θy coupling (note sign differences for Y-bending)
    set(2, 4, -Pabs / 10);
    set(2, 10, Pabs / 10);
    set(8, 4, Pabs / 10);
    set(8, 10, -Pabs / 10);
    
    // θy-θy coupling
    set(4, 4, 2 * Pabs * L_elem / 15);
    set(4, 10, -Pabs * L_elem / 30);
    set(10, 10, 2 * Pabs * L_elem / 15);
    
    // Transform to global: Kg_global = T^T × Kg_local × T
    const kg_global = new Float64Array(144);
    const temp = new Float64Array(144);
    
    // temp = Kg_local × T
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        let sum = 0;
        for (let k = 0; k < 12; k++) {
          sum += kg_local[i * 12 + k] * T[k * 12 + j];
        }
        temp[i * 12 + j] = sum;
      }
    }
    
    // Kg_global = T^T × temp
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        let sum = 0;
        for (let k = 0; k < 12; k++) {
          sum += T[k * 12 + i] * temp[k * 12 + j]; // T^T[i][k] = T[k][i]
        }
        kg_global[i * 12 + j] = sum;
      }
    }
    
    return kg_global;
  };
  
  // P-Delta iteration loop
  let pDeltaIterations = 0;
  const maxPDeltaIter = enablePDelta ? pDeltaMaxIter : 1;
  
  for (let iter = 0; iter < maxPDeltaIter; iter++) {
    pDeltaIterations = iter + 1;
    
    // Build total stiffness = K_elastic + K_geometric
    const K = new Float64Array(K_elastic);
    
    if (iter > 0 && enablePDelta) {
      // Compute axial forces from previous iteration's displacements
      for (const ed of elemDataList) {
        const allDofs = [...ed.dofsI, ...ed.dofsJ];
        
        // Get element displacements
        const de_global = new Float64Array(12);
        for (let i = 0; i < 12; i++) {
          de_global[i] = d[allDofs[i]];
        }
        
        // Transform to local
        const de_local = transformDispToLocal(de_global, ed.T);
        
        // Compute local forces
        const fe_local = new Float64Array(12);
        for (let i = 0; i < 12; i++) {
          fe_local[i] = ed.fef_local[i];
          for (let j = 0; j < 12; j++) {
            fe_local[i] += ed.ke_local[i * 12 + j] * de_local[j];
          }
        }
        
        // Axial force = average of Fx at both ends
        const axialForce = (fe_local[0] - fe_local[6]) / 2; // N (negative = compression)
        
        // Build and assemble geometric stiffness
        const kg_global = buildElementGeometricStiffness(-axialForce, ed.L, ed.T);
        
        for (let i = 0; i < 12; i++) {
          for (let j = 0; j < 12; j++) {
            K[allDofs[i] * nDOF + allDofs[j]] += kg_global[i * 12 + j];
          }
        }
      }
    }
    
    // Solve reduced system
    if (nFree > 0) {
      const Kred = new Float64Array(nFree * nFree);
      const Fred = new Float64Array(nFree);
      
      for (let i = 0; i < nFree; i++) {
        Fred[i] = F[freeDOFs[i]];
        for (let j = 0; j < nFree; j++) {
          Kred[i * nFree + j] = K[freeDOFs[i] * nDOF + freeDOFs[j]];
        }
      }
      
      const dNew = new Float64Array(nDOF);
      const dRed = solveLinearSystem(Kred, Fred, nFree);
      for (let i = 0; i < nFree; i++) {
        dNew[freeDOFs[i]] = dRed[i];
      }
      
      // Check convergence for P-Delta
      if (iter > 0 && enablePDelta) {
        let maxChange = 0;
        let maxDisp = 0;
        for (let i = 0; i < nDOF; i++) {
          const change = Math.abs(dNew[i] - d[i]);
          const disp = Math.abs(dNew[i]);
          if (change > maxChange) maxChange = change;
          if (disp > maxDisp) maxDisp = disp;
        }
        
        const relChange = maxDisp > 1e-10 ? maxChange / maxDisp : 0;
        d = dNew;
        
        if (relChange < pDeltaTol) break; // Converged
      } else {
        d = dNew;
        if (!enablePDelta) break; // No P-Delta, single iteration
      }
    } else {
      break;
    }
  }
  
  // ---- Post-processing: member end forces ----
  const displacements = new Map<string, number[]>();
  for (let i = 0; i < nNodes; i++) {
    displacements.set(nodes[i].id, Array.from(d.slice(i * 6, i * 6 + 6)));
  }
  
  const reactions = new Map<string, number[]>();
  for (let i = 0; i < nNodes; i++) {
    const r = nodes[i].restraints;
    if (r.some(v => v)) {
      const reaction = new Float64Array(6);
      // Reaction = K_row × d - F_applied
      for (let k = 0; k < 6; k++) {
        if (!r[k]) continue;
        const globalDof = i * 6 + k;
        let sum = 0;
        for (let j = 0; j < nDOF; j++) {
          sum += K_elastic[globalDof * nDOF + j] * d[j];
        }
        // Reaction includes the applied load contribution
        reaction[k] = sum + F[globalDof]; // F already has negative FEF
      }
      // Convert: forces N→kN (/1000), moments N.mm→kN.m (/1e6)
      reactions.set(nodes[i].id, [
        reaction[0] / 1000, reaction[1] / 1000, reaction[2] / 1000,
        reaction[3] / 1e6, reaction[4] / 1e6, reaction[5] / 1e6,
      ]);
    }
  }
  
  const elemResults: ElementResult3D[] = [];
  
  for (const ed of elemDataList) {
    const allDofs = [...ed.dofsI, ...ed.dofsJ];
    
    // Get global displacements for this element
    const de_global = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      de_global[i] = d[allDofs[i]];
    }
    
    // Transform to local
    const de_local = transformDispToLocal(de_global, ed.T);
    
    // Member end forces in local = ke_local × de_local + fef_local
    const fe_local = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      fe_local[i] = ed.fef_local[i];
      for (let j = 0; j < 12; j++) {
        fe_local[i] += ed.ke_local[i * 12 + j] * de_local[j];
      }
    }
    
    // ── Enforce zero forces at released DOFs (numerical safety) ──────────
    // Static condensation should yield exact zeros, but floating-point
    // arithmetic may leave tiny residuals that propagate to comparison tables.
    if (ed.elem.releases) {
      const rI = ed.elem.releases.nodeI;
      const rJ = ed.elem.releases.nodeJ;
      if (rI) {
        if (rI.ux) fe_local[0] = 0;
        if (rI.uy) fe_local[1] = 0;
        if (rI.uz) fe_local[2] = 0;
        if (rI.mx) fe_local[3] = 0;
        if (rI.my) fe_local[4] = 0;
        if (rI.mz) fe_local[5] = 0;
      }
      if (rJ) {
        if (rJ.ux) fe_local[6] = 0;
        if (rJ.uy) fe_local[7] = 0;
        if (rJ.uz) fe_local[8] = 0;
        if (rJ.mx) fe_local[9] = 0;
        if (rJ.my) fe_local[10] = 0;
        if (rJ.mz) fe_local[11] = 0;
      }
    }
    
    // Convert to engineering units: N→kN, N.mm→kN.m
    const forceI = [
      fe_local[0] / 1000,   // Fx (axial) kN
      fe_local[1] / 1000,   // Fy (shear Y) kN
      fe_local[2] / 1000,   // Fz (shear Z) kN
      fe_local[3] / 1e6,    // Mx (torsion) kN.m
      fe_local[4] / 1e6,    // My (moment Y) kN.m
      fe_local[5] / 1e6,    // Mz (moment Z) kN.m
    ];
    
    const forceJ = [
      fe_local[6] / 1000,
      fe_local[7] / 1000,
      fe_local[8] / 1000,
      fe_local[9] / 1e6,
      fe_local[10] / 1e6,
      fe_local[11] / 1e6,
    ];
    
    // ETABS-style: compute moment at multiple stations along the beam
    // to find the maximum sagging moment.
    // Internal moment M(x) = -Mz_I + Vy_I * x - ∫₀ˣ∫₀ˢ w(t) dt ds
    // For UDL only: M(x) = -Mz_I + Vy_I * x - wy * x²/2
    // For UDL + profile: must integrate profile load numerically.
    //
    // NOTE: In this local coordinate system, sagging (tension at bottom)
    // produces NEGATIVE internal moments. ETABS convention uses positive for sagging.
    // So we find the minimum (most negative) value and negate it.
    const VyI_N = fe_local[1]; // Vy at node I in N
    const MzI_Nmm = fe_local[5]; // Mz at node I in N.mm
    const loadGlobal_ed = loadCase.elementLoads.get(ed.elem.id) || { wx: 0, wy: 0, wz: 0 };
    const lcLocal_ed = globalToLocalLoad(ed.R, loadGlobal_ed);
    const wyLocal = ed.elem.wLocal.wy + lcLocal_ed.wy; // N/mm (UDL component only)

    // Check for non-uniform slab load profile (adds to UDL)
    const wyProfile_mid = loadCase.elementLoadProfiles?.get(ed.elem.id);

    // Pre-compute cumulative integrals for the profile load if present.
    // We need ∫₀ˣ w_profile(s) ds  (shear contribution)
    // and  ∫₀ˣ ∫₀ˢ w_profile(t) dt ds  (moment contribution)
    // Use trapezoidal rule on the 21 station grid.
    const nStations = 21;
    let profileShearIntegral: Float64Array | null = null;   // ∫₀ˣ w(s) ds at each station
    let profileMomentIntegral: Float64Array | null = null;  // ∫₀ˣ (x-s)·w(s) ds at each station

    if (wyProfile_mid && wyProfile_mid.length >= 2 && ed.elem.type === 'beam') {
      profileShearIntegral = new Float64Array(nStations + 1);
      profileMomentIntegral = new Float64Array(nStations + 1);

      // Sort profile points and build interpolator
      const pts = [...wyProfile_mid].sort((a, b) => a.t - b.t);
      const interpWy = (t: number): number => {
        if (t <= pts[0].t) return pts[0].wy;
        if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].wy;
        for (let i = 0; i < pts.length - 1; i++) {
          if (t >= pts[i].t && t <= pts[i + 1].t) {
            const dt = pts[i + 1].t - pts[i].t;
            if (dt < 1e-10) return pts[i].wy;
            return pts[i].wy + (pts[i + 1].wy - pts[i].wy) * (t - pts[i].t) / dt;
          }
        }
        return 0;
      };

      // Cumulative integration using trapezoidal rule
      // Profile wy is in kN/m; for N/mm multiply by 1 (1 kN/m = 1 N/mm)
      let cumShear = 0;
      let cumMoment = 0;
      for (let s = 1; s <= nStations; s++) {
        const x_prev = ((s - 1) / nStations) * ed.L;
        const x_curr = (s / nStations) * ed.L;
        const t_prev = (s - 1) / nStations;
        const t_curr = s / nStations;
        const w_prev = interpWy(t_prev);
        const w_curr = interpWy(t_curr);
        const dx = x_curr - x_prev;
        const w_avg = (w_prev + w_curr) / 2;
        cumShear += w_avg * dx;
        // Moment contribution: ∫ w(s)·(x-s) ds ≈ w_avg · dx · (x_curr - (x_prev+x_curr)/2)
        // Actually use cumulative: cumMoment += cumShear_prev * dx + w_avg * dx²/2
        cumMoment += profileShearIntegral[s - 1] * dx + w_avg * dx * dx / 2;
        profileShearIntegral[s] = cumShear;
        profileMomentIntegral[s] = cumMoment;
      }
    }

    let minMoment_Nmm = Infinity;  // Track most negative (sagging)
    const stationMoments: number[] = new Array(nStations + 1);
    for (let s = 0; s <= nStations; s++) {
      const x = (s / nStations) * ed.L;
      // Base moment from UDL
      let Mz_at_x = -MzI_Nmm + VyI_N * x - wyLocal * x * x / 2;
      // Add profile load contribution (moment from distributed profile load)
      if (profileMomentIntegral) {
        Mz_at_x -= profileMomentIntegral[s]; // profile is negative for downward
      }
      // Store as kN·m, ETABS sign: negate internal moment (sagging = +ve)
      stationMoments[s] = -Mz_at_x / 1e6;
      if (Mz_at_x < minMoment_Nmm) {
        minMoment_Nmm = Mz_at_x;
      }
    }
    // Sagging moment (ETABS +ve convention): negate the most negative internal moment
    // If all moments are positive (no sagging), use 0
    const momentZmid = minMoment_Nmm < 0 ? -minMoment_Nmm / 1e6 : 0;

    elemResults.push({
      elementId: ed.elem.id,
      forceI,
      forceJ,
      axial: -forceI[0],  // Convention: positive = tension
      shearY: Math.max(Math.abs(forceI[1]), Math.abs(forceJ[1])),
      shearZ: Math.max(Math.abs(forceI[2]), Math.abs(forceJ[2])),
      momentYmax: Math.max(Math.abs(forceI[4]), Math.abs(forceJ[4])),
      momentZmax: Math.max(Math.abs(forceI[5]), Math.abs(forceJ[5])),
      momentZmid,
      torsion: Math.max(Math.abs(forceI[3]), Math.abs(forceJ[3])),
      // ETABS sign convention for end moments:
      // Internal moment at I = -Mz_endforce_I (hogging = negative)
      // Internal moment at J = +Mz_endforce_J (hogging = negative)
      // For columns: same logic applies to both My and Mz
      momentYI: forceI[4],
      momentYJ: -forceJ[4],
      momentZI: forceI[5],
      momentZJ: -forceJ[5],
      momentStations: ed.elem.type === 'beam' ? stationMoments : undefined,
    });
  }
  
  const solveTimeMs = performance.now() - t0;
  
  return {
    displacements,
    elements: elemResults,
    reactions,
    totalDOF: nDOF,
    freeDOF: nFree,
    solveTimeMs,
  };
}

// ======================== ENVELOPE ANALYSIS ========================

/**
 * Run multiple load cases and compute envelope (max/min) of member forces.
 */
export function envelopeAnalysis3D(
  model: Model3D,
  loadCases: LoadCase3D[],
  combinations: LoadCombination3D[],
): {
  results: Map<string, SolverResult3D>;
  envelope: Map<string, ElementResult3D>;
  governingCombos: Map<string, string>;
} {
  // Solve each load case independently
  const caseResults = new Map<string, SolverResult3D>();
  for (const lc of loadCases) {
    caseResults.set(lc.id, analyze3DFrame(model, lc));
  }
  
  // Apply combinations and find envelope
  const envelope = new Map<string, ElementResult3D>();
  const governingCombos = new Map<string, string>();
  
  for (const combo of combinations) {
    // Superpose RAW forces (forceI, forceJ) for this combination, then derive max values
    const combinedForces = new Map<string, { forceI: number[]; forceJ: number[]; elemData: ElementResult3D }>();
    
    for (const [lcId, factor] of Array.from(combo.factors.entries())) {
      const result = caseResults.get(lcId);
      if (!result) continue;
      
      for (const er of result.elements) {
        const existing = combinedForces.get(er.elementId);
        if (!existing) {
          combinedForces.set(er.elementId, {
            forceI: er.forceI.map(v => v * factor),
            forceJ: er.forceJ.map(v => v * factor),
            elemData: er,
          });
        } else {
          for (let k = 0; k < 6; k++) {
            existing.forceI[k] += er.forceI[k] * factor;
            existing.forceJ[k] += er.forceJ[k] * factor;
          }
        }
      }
    }
    
    // Now derive design values from superposed raw forces
    for (const [elemId, combined] of Array.from(combinedForces.entries())) {
      const { forceI, forceJ } = combined;
      
      // Compute midspan moment from superposed end forces
      // Need element length - find from model
      const elemDef = model.elements.find(e => e.id === elemId);
      let momentZmid = 0;
      if (elemDef) {
        const ni = model.nodes.find(n => n.id === elemDef.nodeI);
        const nj = model.nodes.find(n => n.id === elemDef.nodeJ);
        if (ni && nj) {
          const dx = nj.x - ni.x, dy = nj.y - ni.y, dz = nj.z - ni.z;
          const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
          // For beams: M(x) = -MzI + VyI*x - wy*x²/2
          // We only have end forces after superposition, so approximate:
          // MzI = forceI[5], VyI = forceI[1], MzJ = forceJ[5]
          // Sample at stations to find max positive moment
          const VyI = forceI[1]; // kN
          const MzI = forceI[5]; // kN.m
          const nStations = 21;
          // Approximate wy from equilibrium: VyI + VyJ = wy*L → wy ≈ (VyI + VyJ)/L (but VyJ sign is reversed)
          const wyApprox = (forceI[1] - forceJ[1]) / (L / 1000); // kN/m
          let maxPos = -Infinity;
          for (let s = 0; s <= nStations; s++) {
            const x = (s / nStations) * (L / 1000); // meters
            const Mz = -MzI + VyI * x - wyApprox * x * x / 2;
            if (Mz > maxPos) maxPos = Mz;
          }
          momentZmid = maxPos > 0 ? maxPos : 0;
        }
      }
      
      const combinedResult: ElementResult3D = {
        elementId: elemId,
        forceI: [...forceI],
        forceJ: [...forceJ],
        axial: -forceI[0],
        shearY: Math.max(Math.abs(forceI[1]), Math.abs(forceJ[1])),
        shearZ: Math.max(Math.abs(forceI[2]), Math.abs(forceJ[2])),
        momentYmax: Math.max(Math.abs(forceI[4]), Math.abs(forceJ[4])),
        momentZmax: Math.max(Math.abs(forceI[5]), Math.abs(forceJ[5])),
        momentZmid,
        torsion: Math.max(Math.abs(forceI[3]), Math.abs(forceJ[3])),
        momentYI: forceI[4],
        momentYJ: -forceJ[4],
        momentZI: forceI[5],
        momentZJ: -forceJ[5],
      };
      
      // Update envelope: keep max absolute values across combinations
      const prev = envelope.get(elemId);
      if (!prev) {
        envelope.set(elemId, combinedResult);
        governingCombos.set(elemId, combo.name);
        continue;
      }
      
      const prevMax = Math.abs(prev.axial) + prev.shearY + prev.momentYmax + prev.momentZmax;
      const currMax = Math.abs(combinedResult.axial) + combinedResult.shearY + combinedResult.momentYmax + combinedResult.momentZmax;
      
      if (currMax > prevMax) {
        envelope.set(elemId, combinedResult);
        governingCombos.set(elemId, combo.name);
      }
      
      // Keep individual max values
      const env = envelope.get(elemId)!;
      env.shearY = Math.max(env.shearY, combinedResult.shearY);
      env.shearZ = Math.max(env.shearZ, combinedResult.shearZ);
      env.momentYmax = Math.max(env.momentYmax, combinedResult.momentYmax);
      env.momentZmax = Math.max(env.momentZmax, combinedResult.momentZmax);
      env.momentZmid = Math.max(env.momentZmid ?? 0, combinedResult.momentZmid);
      env.torsion = Math.max(env.torsion, combinedResult.torsion);
    }
  }
  
  return { results: caseResults, envelope, governingCombos };
}

// ======================== HELPER: CREATE ACI LOAD COMBINATIONS ========================

export function createACICombinations(
  deadCaseId: string,
  liveCaseId: string,
  windCaseId?: string,
  seismicCaseId?: string,
): LoadCombination3D[] {
  const combos: LoadCombination3D[] = [];
  
  // 1.4D
  combos.push({
    name: '1.4D',
    factors: new Map([[deadCaseId, 1.4]]),
  });
  
  // 1.2D + 1.6L
  combos.push({
    name: '1.2D+1.6L',
    factors: new Map([[deadCaseId, 1.2], [liveCaseId, 1.6]]),
  });
  
  // 1.2D + 1.0L
  combos.push({
    name: '1.2D+1.0L',
    factors: new Map([[deadCaseId, 1.2], [liveCaseId, 1.0]]),
  });
  
  if (windCaseId) {
    // 1.2D + 1.0L + 1.0W
    combos.push({
      name: '1.2D+1.0L+1.0W',
      factors: new Map([[deadCaseId, 1.2], [liveCaseId, 1.0], [windCaseId, 1.0]]),
    });
    // 0.9D + 1.0W
    combos.push({
      name: '0.9D+1.0W',
      factors: new Map([[deadCaseId, 0.9], [windCaseId, 1.0]]),
    });
  }
  
  if (seismicCaseId) {
    // 1.2D + 1.0L + 1.0E
    combos.push({
      name: '1.2D+1.0L+1.0E',
      factors: new Map([[deadCaseId, 1.2], [liveCaseId, 1.0], [seismicCaseId, 1.0]]),
    });
    // 0.9D + 1.0E
    combos.push({
      name: '0.9D+1.0E',
      factors: new Map([[deadCaseId, 0.9], [seismicCaseId, 1.0]]),
    });
  }
  
  return combos;
}
