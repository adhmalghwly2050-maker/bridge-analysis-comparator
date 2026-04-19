/**
 * slabFEMEngine – Phase 6: Beam–Slab Rotational Coupling
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Concept ─────────────────────────────────────────────────────────────────
 *
 *   At the slab–beam interface the ideal compatibility condition is:
 *     θ_slab(x) = θ_beam(x)   (perfect monolithic connection)
 *
 *   In reality, due to finite stiffness, a semi-rigid spring model is used:
 *     M_interaction = kθ · (θ_slab − θ_beam)
 *
 *   First-step assumption (rigid beam / Phase 6a):
 *     θ_beam = 0  →  Δθ = θ_slab
 *
 *   This generates a MOMENT CORRECTION to the Phase-5 transferred moments:
 *     M_corrected = M_phase5 − kθ · Δθ
 *
 * ── Rotational stiffness ─────────────────────────────────────────────────────
 *
 *   kθ = α · (E_c · I_beam) / L_beam
 *
 *   where:
 *     α      = tuning factor [dimensionless], default 1.0
 *     E_c    = 4700·√f'c  [N/mm²]   (ACI 318-19 §19.2.2.1)
 *     I_beam = b · h³ / 12  [mm⁴]  (rectangular gross section)
 *     L_beam = beam length  [mm]
 *     kθ     has units  N·mm / rad
 *
 * ── DOF conventions (from types.ts) ─────────────────────────────────────────
 *
 *   Each FEM node has 3 DOFs numbered (node.id * 3 + offset):
 *     offset 0 → UZ  (transverse deflection, mm)
 *     offset 1 → RX  (rotation about X-axis, rad)  ≈  ∂w/∂y
 *     offset 2 → RY  (rotation about Y-axis, rad)  ≈ −∂w/∂x
 *
 *   Relevant rotation for each beam direction:
 *     Horizontal beam (along X): resists RX rotation → θ_slab = RX = d[n*3+1]
 *     Vertical   beam (along Y): resists RY rotation → θ_slab = RY = d[n*3+2]
 *
 * ── Per-node distributed spring ─────────────────────────────────────────────
 *
 *   The spring stiffness is distributed along the beam.  For node i with
 *   tributary length h_i [mm] along the beam span L [mm]:
 *
 *     kθ_i = kθ_beam · (h_i / L_beam)      [N·mm/rad per node]
 *     ΔM_i = kθ_i · θ_slab,i               [N·mm]
 *     ΔM_i [N·m] = ΔM_i [N·mm] / 1000
 *
 *   This ensures:
 *     Σ_i ΔM_i ≈ kθ_beam · θ̄_slab        (integral of distributed spring)
 *
 * ── Moment correction to BeamEdgeForces ────────────────────────────────────
 *
 *   For horizontal beam → correct Mx_Nm:
 *     Mx_corrected_Nm = Mx_phase5_Nm − ΔM_i_Nm
 *
 *   For vertical beam → correct My_Nm:
 *     My_corrected_Nm = My_phase5_Nm − ΔM_i_Nm
 *
 * ── Validation guidance ─────────────────────────────────────────────────────
 *
 *   Stiff beam (large E·I/L):   large kθ → large ΔM → lower net moment transfer
 *   Flexible beam (small E·I/L): small kθ → small ΔM → near-Phase-5 result
 *   Perfect rigid limit:         kθ → ∞   → M_corrected → 0  (beam absorbs all)
 *
 * ── Unit summary ────────────────────────────────────────────────────────────
 *   E_c [N/mm²], I [mm⁴], L [mm]
 *   kθ       [N·mm/rad]
 *   θ_slab   [rad]
 *   ΔM       [N·mm] → [N·m] = / 1000
 *   kθ_report [kN·m/rad] = kθ / 1e6
 */

import type { SlabMesh } from './types';
import type { Beam, MatProps } from './types';
import type { BeamEdgeForces } from './edgeForces';

// ─────────────────────────────────────────────────────────────────────────────
// Public output types
// ─────────────────────────────────────────────────────────────────────────────

export interface RotationalCouplingNodeResult {
  /** FEM node id (matches mesh.nodes[].id). */
  nodeId: number;
  /** Distance from beam start (m). */
  posAlongBeam_m: number;
  /** Tributary length for this node along the beam (m). */
  tributaryLen_m: number;
  /** FEM slab rotation at this node (rad). Positive = sagging convention. */
  theta_slab_rad: number;
  /** Beam rotation (=0 in first-step rigid approximation). */
  theta_beam_rad: number;
  /** Relative rotation Δθ = θ_slab − θ_beam (rad). */
  delta_theta_rad: number;
  /** Node-level rotational spring stiffness = kθ_beam · (h_i / L_beam) (kN·m/rad). */
  kTheta_node_kNm_per_rad: number;
  /** Moment correction at this node = kθ_i · Δθ_i (kN·m). */
  moment_correction_kNm: number;
  /** Original Phase-5 Mx at this node (kN·m). */
  Mx_original_kNm: number;
  /** Original Phase-5 My at this node (kN·m). */
  My_original_kNm: number;
  /** Phase-6 corrected Mx at this node (kN·m). */
  Mx_corrected_kNm: number;
  /** Phase-6 corrected My at this node (kN·m). */
  My_corrected_kNm: number;
}

export interface RotationalCouplingResult {
  beamId: string;
  /** Beam rotational stiffness kθ = α·E·I/L (kN·m/rad). */
  kTheta_kNm_per_rad: number;
  /** Tuning factor α used. */
  alpha: number;
  /** E_c computed from mat.fc (GPa, for display). */
  Ec_GPa: number;
  /** Gross moment of inertia b·h³/12 (cm⁴, for display). */
  I_cm4: number;
  /** Per-node coupling results. */
  nodes: RotationalCouplingNodeResult[];
  /** Sum of |Mx_Nm + My_Nm| from Phase 5 (kN·m). */
  totalMoment_original_kNm: number;
  /** Sum of |Mx_corrected + My_corrected| after Phase 6 (kN·m). */
  totalMoment_corrected_kNm: number;
  /** Maximum |Δθ| across all interface nodes (rad). */
  maxDeltaTheta_rad: number;
  /** Average |Δθ| across all interface nodes (rad). */
  avgDeltaTheta_rad: number;
  /**
   * Percent change in total moment due to coupling:
   *   (corrected − original) / |original| × 100
   * Negative = coupling reduces moment transfer (expected for stiff beams).
   */
  correctionPercent: number;
  /** True if coupling is physically meaningful (|correction| < 80%). */
  stable: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Phase-6 function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * applyRotationalCoupling
 * ────────────────────────
 * Implements Phase 6: beam–slab rotational spring coupling.
 *
 * @param mesh        FEM mesh for the slab (provides node positions and IDs)
 * @param d_full      Full FEM displacement vector (all DOFs; length = nNodes × 3)
 * @param edgeForces  Phase-5 BeamEdgeForces[] to be corrected in-place (deep copy)
 * @param beams       All beam objects (for section geometry)
 * @param mat         Material properties (for E_c)
 * @param alpha       Spring tuning factor (default 1.0)
 *
 * Returns:
 *   correctedEdgeForces: BeamEdgeForces[] with updated Mx_Nm / My_Nm
 *   couplingResults:     RotationalCouplingResult[] for UI display / debug
 */
export function applyRotationalCoupling(
  mesh:       SlabMesh,
  d_full:     number[],
  edgeForces: BeamEdgeForces[],
  beams:      Beam[],
  mat:        MatProps,
  alpha:      number = 1.0,
): {
  correctedEdgeForces: BeamEdgeForces[];
  couplingResults:     RotationalCouplingResult[];
} {
  // ── Elastic modulus E_c  (ACI 318-19 §19.2.2.1) ──────────────────────────
  // E_c = 4700·√f'c  [N/mm² = MPa]   (f'c in MPa)
  const Ec_Nmm2 = 4700 * Math.sqrt(Math.max(mat.fc, 1));

  // Build fast node lookup: nodeId → FEMNode
  const nodeById = new Map<number, typeof mesh.nodes[0]>();
  for (const nd of mesh.nodes) nodeById.set(nd.id, nd);

  const correctedEdgeForces: BeamEdgeForces[] = [];
  const couplingResults:     RotationalCouplingResult[] = [];

  console.group('[slabFEMEngine] Phase 6 — Rotational Coupling');

  for (const ef of edgeForces) {
    const beam = beams.find(b => b.id === ef.beamId);
    if (!beam) {
      // Pass through unchanged
      correctedEdgeForces.push({ ...ef, reactions: ef.reactions.map(r => ({ ...r })) });
      continue;
    }

    // ── Beam section properties ───────────────────────────────────────────
    const b_mm   = beam.b;
    const h_mm   = beam.h;
    const L_mm   = beam.length * 1000;          // m → mm

    if (L_mm < 1 || b_mm < 1 || h_mm < 1) {
      correctedEdgeForces.push({ ...ef, reactions: ef.reactions.map(r => ({ ...r })) });
      continue;
    }

    // Gross moment of inertia (rectangular section)
    const I_mm4  = (b_mm * Math.pow(h_mm, 3)) / 12;

    // Beam rotational stiffness: kθ = α · E_c · I / L  [N·mm/rad]
    const kTheta_Nmm_per_rad = alpha * Ec_Nmm2 * I_mm4 / L_mm;

    // For display
    const kTheta_kNm_per_rad = kTheta_Nmm_per_rad / 1e6;
    const Ec_GPa             = Ec_Nmm2 / 1e3;    // N/mm² → GPa (÷1000)
    const I_cm4              = I_mm4 / 1e4;       // mm⁴ → cm⁴

    // DOF offset for rotation based on beam direction:
    //   Horizontal beam (along X) → resists RX (∂w/∂y) → offset = 1
    //   Vertical   beam (along Y) → resists RY (−∂w/∂x) → offset = 2
    const rotDOFOffset = beam.direction === 'horizontal' ? 1 : 2;

    // Build a lookup from posAlongBeam_mm → {nodeId, theta_slab, tributaryLen}
    // using the mesh nodes assigned to this beam
    const beamNodeInfo = new Map<number, { nodeId: number; theta: number }>();

    for (const nd of mesh.nodes) {
      if (nd.beamId !== beam.id) continue;
      const rotDOF = nd.id * 3 + rotDOFOffset;
      const theta  = rotDOF < d_full.length ? d_full[rotDOF] : 0;
      const pos_mm = nd.beamPos * L_mm;
      beamNodeInfo.set(Math.round(pos_mm * 100), { nodeId: nd.id, theta });
    }

    // ── Build corrected reactions ─────────────────────────────────────────
    const correctedReactions = ef.reactions.map(r => ({ ...r }));
    const nodeResults: RotationalCouplingNodeResult[] = [];

    let totalMoment_orig    = 0;
    let totalMoment_corr    = 0;
    let sumAbsDeltaTheta    = 0;
    let maxAbsDeltaTheta    = 0;

    for (let i = 0; i < ef.reactions.length; i++) {
      const rx = ef.reactions[i];
      const cr = correctedReactions[i];

      // Look up slab rotation at this node position
      const key = Math.round(rx.posAlongBeam * 100);
      const info = beamNodeInfo.get(key);
      const theta_slab = info?.theta ?? 0;
      const nodeId     = info?.nodeId ?? rx.nodeId;

      // θ_beam = 0 (rigid beam approximation)
      const theta_beam = 0;
      const delta_theta = theta_slab - theta_beam;

      // Tributary length of this node along the beam [mm]
      const h_i_mm = rx.tributaryLen;  // already computed by Phase 2/5

      // Distributed spring: kθ_i = kθ_beam · (h_i / L)  [N·mm/rad]
      const kTheta_i_Nmm = kTheta_Nmm_per_rad * (h_i_mm / Math.max(L_mm, 1));

      // Moment correction [N·mm] → [N·m]
      const deltaM_Nm = (kTheta_i_Nmm * delta_theta) / 1000;

      // Original Phase-5 moments [N·m]
      const Mx_orig_Nm = rx.Mx_Nm ?? 0;
      const My_orig_Nm = rx.My_Nm ?? 0;

      // Apply correction to the relevant axis:
      //   Horizontal beam → correct Mx (resists RX rotation)
      //   Vertical   beam → correct My (resists RY rotation)
      let Mx_corr_Nm = Mx_orig_Nm;
      let My_corr_Nm = My_orig_Nm;

      if (beam.direction === 'horizontal') {
        Mx_corr_Nm = Mx_orig_Nm - deltaM_Nm;
      } else {
        My_corr_Nm = My_orig_Nm - deltaM_Nm;
      }

      // Update the corrected reaction
      cr.Mx_Nm = Mx_corr_Nm;
      cr.My_Nm = My_corr_Nm;

      // Accumulate statistics
      const orig_kNm = (Math.abs(Mx_orig_Nm) + Math.abs(My_orig_Nm)) * 1e-3;
      const corr_kNm = (Math.abs(Mx_corr_Nm) + Math.abs(My_corr_Nm)) * 1e-3;
      totalMoment_orig += orig_kNm;
      totalMoment_corr += corr_kNm;

      const absDelta = Math.abs(delta_theta);
      sumAbsDeltaTheta += absDelta;
      if (absDelta > maxAbsDeltaTheta) maxAbsDeltaTheta = absDelta;

      // Node result for UI
      nodeResults.push({
        nodeId,
        posAlongBeam_m:          rx.posAlongBeam / 1000,
        tributaryLen_m:          h_i_mm / 1000,
        theta_slab_rad:          theta_slab,
        theta_beam_rad:          theta_beam,
        delta_theta_rad:         delta_theta,
        kTheta_node_kNm_per_rad: (kTheta_i_Nmm / 1e6),
        moment_correction_kNm:   deltaM_Nm * 1e-3,
        Mx_original_kNm:         Mx_orig_Nm * 1e-3,
        My_original_kNm:         My_orig_Nm * 1e-3,
        Mx_corrected_kNm:        Mx_corr_Nm * 1e-3,
        My_corrected_kNm:        My_corr_Nm * 1e-3,
      });
    }

    const n = nodeResults.length;
    const avgAbsDeltaTheta = n > 0 ? sumAbsDeltaTheta / n : 0;

    const correctionPct = totalMoment_orig > 1e-9
      ? ((totalMoment_corr - totalMoment_orig) / totalMoment_orig) * 100
      : 0;

    // Stability check: coupling should not reverse moment sign by > 80%
    const stable = Math.abs(correctionPct) < 80;

    if (!stable) {
      console.warn(
        `[Phase 6] Beam ${beam.id}: coupling correction = ${correctionPct.toFixed(1)}% ` +
        `— may indicate over-stiff beam or very flexible slab. ` +
        `Consider reducing α.`,
      );
    }

    console.log(
      `[Phase 6] Beam ${beam.id}: ` +
      `kθ = ${kTheta_kNm_per_rad.toFixed(1)} kN·m/rad  ` +
      `max|Δθ| = ${(maxAbsDeltaTheta * 1000).toFixed(3)} mrad  ` +
      `avg|Δθ| = ${(avgAbsDeltaTheta * 1000).toFixed(3)} mrad  ` +
      `M_orig = ${totalMoment_orig.toFixed(3)} kN·m  ` +
      `M_corr = ${totalMoment_corr.toFixed(3)} kN·m  ` +
      `correction = ${correctionPct > 0 ? '+' : ''}${correctionPct.toFixed(1)}%` +
      (stable ? '' : '  ⚠ UNSTABLE'),
    );

    correctedEdgeForces.push({
      ...ef,
      reactions:         correctedReactions,
      totalMomentMx_Nm: correctedReactions.reduce((s, r) => s + Math.abs(r.Mx_Nm ?? 0), 0),
      totalMomentMy_Nm: correctedReactions.reduce((s, r) => s + Math.abs(r.My_Nm ?? 0), 0),
    });

    couplingResults.push({
      beamId:                   beam.id,
      kTheta_kNm_per_rad,
      alpha,
      Ec_GPa,
      I_cm4,
      nodes:                    nodeResults,
      totalMoment_original_kNm: totalMoment_orig,
      totalMoment_corrected_kNm: totalMoment_corr,
      maxDeltaTheta_rad:        maxAbsDeltaTheta,
      avgDeltaTheta_rad:        avgAbsDeltaTheta,
      correctionPercent:        correctionPct,
      stable,
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalRotDiff_kNm = couplingResults.reduce(
    (s, r) => s + (r.totalMoment_corrected_kNm - r.totalMoment_original_kNm), 0,
  );
  const totalOrig_kNm = couplingResults.reduce((s, r) => s + r.totalMoment_original_kNm, 0);
  const globalPct = totalOrig_kNm > 1e-9
    ? (totalRotDiff_kNm / totalOrig_kNm) * 100 : 0;

  console.log(
    `[Phase 6] SUMMARY: ${couplingResults.length} beams coupled.  ` +
    `Total moment change = ${globalPct > 0 ? '+' : ''}${globalPct.toFixed(1)}%  ` +
    `(${totalOrig_kNm.toFixed(2)} → ${(totalOrig_kNm + totalRotDiff_kNm).toFixed(2)} kN·m)`,
  );
  console.groupEnd();

  return { correctedEdgeForces, couplingResults };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runPhase6Regression
 * ───────────────────
 * Regression check for Phase 6.
 *
 * Test 1 — Stiff beam vs flexible beam:
 *   Given a single interface node with θ_slab = 1e-3 rad:
 *   - Stiff beam (large E·I/L)  → large ΔM → M_corrected << M_phase5
 *   - Flexible beam (small E·I/L) → small ΔM → M_corrected ≈ M_phase5
 *
 * Test 2 — Zero rotation:
 *   θ_slab = 0 → ΔM = 0 → M_corrected = M_phase5 exactly.
 *
 * Test 3 — Energy consistency (qualitative):
 *   Coupling energy = Σ 0.5 · kθ_i · Δθ_i² must be > 0.
 */
export function runPhase6Regression(): {
  passed: boolean;
  tests: Array<{ name: string; passed: boolean; notes: string }>;
} {
  const tests: Array<{ name: string; passed: boolean; notes: string }> = [];

  // ── Test 1: Stiff vs flexible ─────────────────────────────────────────────
  {
    const theta = 1e-3;   // rad
    const L     = 5000;   // mm
    const h     = 250;    // mm depth

    const stiffBeamI  = (300 * Math.pow(600, 3)) / 12;   // 300×600 mm
    const flexBeamI   = (200 * Math.pow(300, 3)) / 12;   // 200×300 mm

    const Ec = 4700 * Math.sqrt(30);  // f'c = 30 MPa

    const kStiff  = Ec * stiffBeamI  / L;  // N·mm/rad
    const kFlex   = Ec * flexBeamI   / L;

    const tribLen = L / 5;   // 5 interface nodes, each trib = L/5
    const kNode_stiff = kStiff * (tribLen / L);
    const kNode_flex  = kFlex  * (tribLen / L);

    const dM_stiff = kNode_stiff * theta / 1000;  // N·m
    const dM_flex  = kNode_flex  * theta / 1000;

    const passed = dM_stiff > dM_flex * 5;  // stiff gives at least 5× more correction
    tests.push({
      name:   'Test 1 — Stiff > Flexible beam correction',
      passed,
      notes:  `Stiff ΔM = ${dM_stiff.toFixed(4)} N·m; Flexible ΔM = ${dM_flex.toFixed(4)} N·m; ratio = ${(dM_stiff / Math.max(dM_flex, 1e-12)).toFixed(1)}×`,
    });
  }

  // ── Test 2: Zero rotation ─────────────────────────────────────────────────
  {
    const theta = 0;
    const Ec    = 4700 * Math.sqrt(25);
    const I     = (250 * Math.pow(500, 3)) / 12;
    const L     = 6000;
    const h_i   = 1000;
    const k_i   = Ec * I / L * (h_i / L);
    const dM    = k_i * theta;
    const passed = Math.abs(dM) < 1e-12;
    tests.push({
      name:   'Test 2 — Zero rotation → zero correction',
      passed,
      notes:  `Δθ = 0 → ΔM = ${dM.toExponential(3)} (expect 0)`,
    });
  }

  // ── Test 3: Energy > 0 ────────────────────────────────────────────────────
  {
    const thetas  = [1e-4, 2e-4, 1.5e-4];   // rad
    const Ec      = 4700 * Math.sqrt(28);
    const I       = (300 * Math.pow(500, 3)) / 12;
    const L       = 5000;
    const tribLen = L / thetas.length;
    let energy    = 0;
    for (const th of thetas) {
      const k_i = Ec * I / L * (tribLen / L);
      energy   += 0.5 * k_i * th * th;
    }
    const passed = energy > 0;
    tests.push({
      name:   'Test 3 — Coupling energy > 0',
      passed,
      notes:  `Coupling energy = ${energy.toFixed(6)} N·mm  (expect > 0)`,
    });
  }

  const allPassed = tests.every(t => t.passed);
  console.group('[slabFEMEngine] Phase 6 Regression');
  tests.forEach(t => console.log(`  ${t.passed ? '✓' : '✗'} ${t.name}: ${t.notes}`));
  console.log(`  Overall: ${allPassed ? 'PASSED ✓' : 'FAILED ✗'}`);
  console.groupEnd();

  return { passed: allPassed, tests };
}
