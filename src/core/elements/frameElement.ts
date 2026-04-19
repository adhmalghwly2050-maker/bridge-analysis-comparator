/**
 * 3D Frame Element Stiffness (Beam-Column)
 * ═══════════════════════════════════════════════════════════════
 * Euler-Bernoulli 12×12 local stiffness matrix for a 3D frame element.
 *
 * DOF per node: [ux, uy, uz, rx, ry, rz] — 6 DOF × 2 nodes = 12 DOF total.
 *
 * Reference: McGuire, Gallagher & Ziemian, "Matrix Structural Analysis", 2nd ed.
 *
 * K_local structure (symmetric):
 *   Axial:    EA/L
 *   Bending (strong axis, about y): EIy terms — 12EIy/L³, 6EIy/L², 4EIy/L, 2EIy/L
 *   Bending (weak axis, about z):   EIz terms — analogous
 *   Torsion:  GJ/L
 */

import type { Material, Section } from '../model/types';

export interface FrameSectionProps {
  E: number;   // MPa
  G: number;   // MPa
  A: number;   // mm²
  Iy: number;  // mm⁴ (strong axis)
  Iz: number;  // mm⁴ (weak axis)
  J: number;   // mm⁴ (torsion)
  L: number;   // mm
}

/**
 * Compute section properties from Material + Section definitions.
 */
export function computeFrameProps(
  mat: Material, sec: Section, length: number,
): FrameSectionProps {
  const b = sec.b;
  const h = sec.h;
  const A = sec.A ?? b * h;
  const Iy = sec.Iy ?? (b * h ** 3) / 12;
  const Iz = sec.Iz ?? (h * b ** 3) / 12;
  const J = sec.J ?? computeTorsionJ(b, h);
  const G = mat.E / (2 * (1 + mat.nu));

  return { E: mat.E, G, A, Iy, Iz, J, L: length };
}

/**
 * Approximate torsional constant for rectangular section.
 * J ≈ a·b³ (1/3 − 0.21·b/a·(1 − b⁴/(12a⁴)))  where a ≥ b.
 */
function computeTorsionJ(b: number, h: number): number {
  const a = Math.max(b, h);
  const bMin = Math.min(b, h);
  return a * bMin ** 3 * (1 / 3 - 0.21 * (bMin / a) * (1 - bMin ** 4 / (12 * a ** 4)));
}

/**
 * Build 12×12 local stiffness matrix (row-major flat array, length 144).
 */
export function buildLocalFrameStiffness(p: FrameSectionProps): number[] {
  const { E, G, A, Iy, Iz, J, L } = p;
  const L2 = L * L;
  const L3 = L2 * L;
  const K = new Array(144).fill(0);

  const set = (i: number, j: number, v: number) => {
    K[i * 12 + j] = v;
    K[j * 12 + i] = v;
  };

  // Axial: DOF 0 (u1), 6 (u2)
  const ea_l = E * A / L;
  set(0, 0, ea_l);
  set(0, 6, -ea_l);
  set(6, 6, ea_l);

  // Torsion: DOF 3 (θx1), 9 (θx2)
  const gj_l = G * J / L;
  set(3, 3, gj_l);
  set(3, 9, -gj_l);
  set(9, 9, gj_l);

  // Bending in XZ plane (strong axis, Iy): DOF 2 (w1), 4 (θy1), 8 (w2), 10 (θy2)
  const c1y = 12 * E * Iy / L3;
  const c2y = 6 * E * Iy / L2;
  const c3y = 4 * E * Iy / L;
  const c4y = 2 * E * Iy / L;

  set(2, 2, c1y);
  set(2, 4, c2y);
  set(2, 8, -c1y);
  set(2, 10, c2y);
  set(4, 4, c3y);
  set(4, 8, -c2y);
  set(4, 10, c4y);
  set(8, 8, c1y);
  set(8, 10, -c2y);
  set(10, 10, c3y);

  // Bending in XY plane (weak axis, Iz): DOF 1 (v1), 5 (θz1), 7 (v2), 11 (θz2)
  const c1z = 12 * E * Iz / L3;
  const c2z = 6 * E * Iz / L2;
  const c3z = 4 * E * Iz / L;
  const c4z = 2 * E * Iz / L;

  set(1, 1, c1z);
  set(1, 5, -c2z);
  set(1, 7, -c1z);
  set(1, 11, -c2z);
  set(5, 5, c3z);
  set(5, 7, c2z);
  set(5, 11, c4z);
  set(7, 7, c1z);
  set(7, 11, c2z);
  set(11, 11, c3z);

  return K;
}
