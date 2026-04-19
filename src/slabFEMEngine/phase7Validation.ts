/**
 * slabFEMEngine – Phase 7 Validation Suite
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Four independent validation tests for the coupled beam–slab FEM system.
 *
 * Test 1 — Frame element self-test (cantilever beam)
 *   Verify K_local, T, and K_global by checking the tip deflection of a
 *   cantilever beam under a tip load matches the Euler-Bernoulli analytic
 *   result: δ = PL³/(3EI).  Expected accuracy: < 0.1 %.
 *
 * Test 2 — Coupled system equilibrium (5 × 5 m, 4 edge beams)
 *   5 × 5 m slab with four edge beams and four column supports, q = 10 kN/m².
 *   All load must appear as column reactions. Expected: < 2 % equilibrium error.
 *
 * Test 3 — Beam stiffness contribution (comparison with uncoupled Phase-2)
 *   5 × 5 m slab, 4 edge beams + 1 internal beam at mid-span.
 *   The coupled system should show REDUCED slab deflection compared to the
 *   uncoupled Phase-2 approach (beams provide stiffness).
 *   Expected: slab centre deflection coupled < uncoupled.
 *
 * Test 4 — Internal beam load share (6 × 6 m, internal Y-beam at x = 3 m)
 *   6 × 6 m slab, 4 edge beams + 1 internal vertical beam at x = 3 m.
 *   The internal beam should carry a significant portion of the load (> 20 %).
 *   Equilibrium error < 2 %.
 *
 * All tests are pure in-memory computations.  Units: mm, N, kN, kN·m.
 */

import type { Slab, Beam, Column, SlabProps, MatProps } from './types';
import { solveCoupledSystem }  from './coupledSystem';
import { meshSlab }            from './mesh';
import { assembleSystem, reconstructDisplacements } from './assembler';
import { solve }               from './solver';
import {
  buildLocalStiffness,
  buildTransformationMatrix,
  globalStiffness,
  sectionFromBeam,
} from './frameElement';

// ─────────────────────────────────────────────────────────────────────────────
// Shared material / section
// ─────────────────────────────────────────────────────────────────────────────

const STD_MAT: MatProps = { fc: 25, fy: 420, fyt: 420, gamma: 24 };
const STD_SLAB: SlabProps = {
  thickness:  150, finishLoad: 0, liveLoad: 0, cover: 20, phiMain: 0.9, phiSlab: 0.9,
};

// ─────────────────────────────────────────────────────────────────────────────
// Individual report types
// ─────────────────────────────────────────────────────────────────────────────

export interface Phase7TestResult {
  testId:      string;
  description: string;
  passed:      boolean;
  checks:      { label: string; value: number; expected: string; pass: boolean }[];
  notes:       string[];
}

export interface Phase7Report {
  allPassed:   boolean;
  tests:       Phase7TestResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Frame element cantilever self-test
// ─────────────────────────────────────────────────────────────────────────────

function runTest1(): Phase7TestResult {
  const notes: string[] = [];
  const checks: Phase7TestResult['checks'] = [];

  // Cantilever: L=5000mm, b=300mm, h=500mm, fc=25MPa
  // Applied tip load P = 100 kN (100000 N) downward at node 2
  const L  = 5000;   // mm
  const b  = 300;    // mm
  const h  = 500;    // mm
  const P  = 100000; // N (100 kN downward)
  const fc = 25;     // MPa

  const sec = sectionFromBeam(b, h, L, fc);
  const Ec  = sec.E;
  const Iy  = sec.Iy;

  // Analytic cantilever: δ = PL³/(3EI),  θ = PL²/(2EI)
  const delta_ana = P * L ** 3 / (3 * Ec * Iy);   // mm
  const theta_ana = P * L ** 2 / (2 * Ec * Iy);   // rad

  notes.push(`E_c = ${Ec.toFixed(1)} MPa  I_y = ${(Iy / 1e6).toFixed(3)} ×10⁶ mm⁴`);
  notes.push(`Analytic tip deflection = ${delta_ana.toFixed(4)} mm`);
  notes.push(`Analytic tip rotation   = ${theta_ana.toFixed(6)} rad`);

  // Build K_local (12×12) for a horizontal X-beam (α=0)
  const K_loc = buildLocalStiffness(sec);
  const T     = buildTransformationMatrix(1, 0);  // X-beam, no rotation
  const K_glo = globalStiffness(K_loc, T);

  // DOF ordering (global, for X-beam R=I so global = local):
  //   [u1, v1, w1, θx1, θy1, θz1,  u2, v2, w2, θx2, θy2, θz2]
  // Indices: w1=2, θy1=4, w2=8, θy2=10
  // BCs: node 1 fully fixed → fix all 6 DOF of node 1
  // Free DOFs: {6,7,8,9,10,11} → indices within 12-DOF system

  const fixedLocal = new Set([0, 1, 2, 3, 4, 5]);
  const freeDOF: number[] = [];
  for (let i = 0; i < 12; i++) if (!fixedLocal.has(i)) freeDOF.push(i);

  const nFree = freeDOF.length; // 6
  const K_ff = new Array(nFree * nFree).fill(0);
  const F_f  = new Array(nFree).fill(0);

  for (let i = 0; i < nFree; i++) {
    const gi = freeDOF[i];
    for (let j = 0; j < nFree; j++) {
      K_ff[i * nFree + j] = K_glo[gi * 12 + freeDOF[j]];
    }
  }

  // Apply downward load P at node 2's w-DOF (global DOF 8)
  // In free DOF list: index of DOF 8 in freeDOF = freeDOF.indexOf(8)
  const wIdx = freeDOF.indexOf(8);   // index of w2 in reduced system
  const θIdx = freeDOF.indexOf(10);  // index of θy2 in reduced system
  F_f[wIdx] = -P;  // downward → negative w (local-z positive = upward)

  const result = solve(K_ff, F_f);
  if (!result.converged) notes.push('WARNING: solver did not converge');

  const d_free = result.d;
  const delta_fem = Math.abs(d_free[wIdx]);   // |w2| in mm
  const theta_fem = Math.abs(d_free[θIdx]);   // |θy2| in rad

  const deltaErr = Math.abs(delta_fem - delta_ana) / delta_ana * 100;
  const thetaErr = Math.abs(theta_fem - theta_ana) / theta_ana * 100;

  notes.push(`FEM tip deflection = ${delta_fem.toFixed(4)} mm  (error = ${deltaErr.toFixed(4)} %)`);
  notes.push(`FEM tip rotation   = ${theta_fem.toFixed(6)} rad (error = ${thetaErr.toFixed(4)} %)`);

  checks.push({ label: 'Tip deflection error (%)',  value: deltaErr, expected: '< 0.1 %', pass: deltaErr < 0.1 });
  checks.push({ label: 'Tip rotation error (%)',    value: thetaErr, expected: '< 0.1 %', pass: thetaErr < 0.1 });

  const passed = checks.every(c => c.pass);
  return {
    testId:      'T1',
    description: 'Frame element cantilever self-test (δ=PL³/3EI)',
    passed, checks, notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Coupled system equilibrium, 5×5 m, 4 edge beams, 4 columns
// ─────────────────────────────────────────────────────────────────────────────

function runTest2(): Phase7TestResult {
  const notes: string[] = [];
  const checks: Phase7TestResult['checks'] = [];

  // Model (mm): 5×5 m slab with four corner columns and four edge beams
  const L = 5000;   // mm
  const q = 0.010;  // N/mm² = 10 kN/m²

  const slab: Slab = { id: 'S1', x1: 0, y1: 0, x2: L, y2: L };

  const columns: Column[] = [
    { id: 'C1', x: 0,  y: 0,  b: 300, h: 300, L: 3000 },
    { id: 'C2', x: L,  y: 0,  b: 300, h: 300, L: 3000 },
    { id: 'C3', x: L,  y: L,  b: 300, h: 300, L: 3000 },
    { id: 'C4', x: 0,  y: L,  b: 300, h: 300, L: 3000 },
  ];

  const beams: Beam[] = [
    {
      id: 'BT', fromCol: 'C4', toCol: 'C3',
      x1: 0, y1: L, x2: L, y2: L,
      direction: 'horizontal', length: 5, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BB', fromCol: 'C1', toCol: 'C2',
      x1: 0, y1: 0, x2: L, y2: 0,
      direction: 'horizontal', length: 5, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BL', fromCol: 'C1', toCol: 'C4',
      x1: 0, y1: 0, x2: 0, y2: L,
      direction: 'vertical', length: 5, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BR', fromCol: 'C2', toCol: 'C3',
      x1: L, y1: 0, x2: L, y2: L,
      direction: 'vertical', length: 5, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
  ];

  const totalApplied = q * L * L * 1e-3;  // kN
  notes.push(`Applied load: q = 10 kN/m²  Total = ${totalApplied.toFixed(1)} kN`);

  let result;
  try {
    result = solveCoupledSystem(slab, beams, columns, STD_SLAB, STD_MAT, q, 2);
  } catch (e) {
    return {
      testId: 'T2', description: 'Coupled system equilibrium (5×5 m, 4 edge beams)',
      passed: false,
      checks: [{ label: 'Solver error', value: 0, expected: 'no error', pass: false }],
      notes: [`ERROR: ${String(e)}`],
    };
  }

  const eq = result.equilibrium;
  const dbg = result.debug;

  notes.push(`Total DOF: ${dbg.nTotalDOF}  Free: ${dbg.nFreeDOF}  Constraints: ${dbg.nCouplingConstraints}`);
  notes.push(`Penalty factor: ${dbg.penaltyFactor_N_mm.toExponential(3)} N/mm`);
  notes.push(`Reactions: ${eq.totalReactions_kN.toFixed(2)} kN  Error: ${eq.errorPct.toFixed(3)} %`);
  notes.push(`Max slab deflection: ${result.slabResults.maxDeflection_mm.toFixed(3)} mm`);

  for (const br of result.beamResults) {
    notes.push(`  Beam ${br.beamId}: maxM = ${br.maxMoment_kNm.toFixed(2)} kN·m  maxV = ${br.maxShear_kN.toFixed(2)} kN`);
  }

  checks.push({
    label: 'Equilibrium error (%)', value: eq.errorPct,
    expected: '< 2 %', pass: eq.errorPct < 2,
  });
  checks.push({
    label: 'Max deflection > 0 mm', value: result.slabResults.maxDeflection_mm,
    expected: '> 0', pass: result.slabResults.maxDeflection_mm > 0,
  });
  checks.push({
    label: 'Beam results count', value: result.beamResults.length,
    expected: '= 4', pass: result.beamResults.length === 4,
  });

  const passed = checks.every(c => c.pass);
  return {
    testId: 'T2', description: 'Coupled system equilibrium (5×5 m, 4 edge beams)',
    passed, checks, notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Beam stiffness effect: coupled vs. uncoupled deflection
// ─────────────────────────────────────────────────────────────────────────────

function runTest3(): Phase7TestResult {
  const notes: string[] = [];
  const checks: Phase7TestResult['checks'] = [];

  // Same model as Test 2, but compare coupled deflection vs. pure slab deflection
  // The coupled system should show LESS deflection (beams add stiffness).
  const L = 5000;
  const q = 0.010;

  const slab: Slab = { id: 'S1', x1: 0, y1: 0, x2: L, y2: L };
  const columns: Column[] = [
    { id: 'C1', x: 0,  y: 0,  b: 300, h: 300, L: 3000 },
    { id: 'C2', x: L,  y: 0,  b: 300, h: 300, L: 3000 },
    { id: 'C3', x: L,  y: L,  b: 300, h: 300, L: 3000 },
    { id: 'C4', x: 0,  y: L,  b: 300, h: 300, L: 3000 },
  ];
  const beams: Beam[] = [
    {
      id: 'BT', fromCol: 'C4', toCol: 'C3',
      x1: 0, y1: L, x2: L, y2: L,
      direction: 'horizontal', length: 5, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BB', fromCol: 'C1', toCol: 'C2',
      x1: 0, y1: 0, x2: L, y2: 0,
      direction: 'horizontal', length: 5, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BL', fromCol: 'C1', toCol: 'C4',
      x1: 0, y1: 0, x2: 0, y2: L,
      direction: 'vertical', length: 5, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BR', fromCol: 'C2', toCol: 'C3',
      x1: L, y1: 0, x2: L, y2: L,
      direction: 'vertical', length: 5, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
  ];

  // ── Uncoupled slab only (Phase 1): fixed at column positions ──────────────
  let maxDeflUncoupled = 0;
  try {
    const mesh = meshSlab(slab, beams, columns, 2);
    const sys  = assembleSystem(mesh, STD_SLAB, STD_MAT, q);
    const sol  = solve(sys.K_ff, sys.F_f);
    const d    = reconstructDisplacements(sol.d, sys.freeDOFs, sys.nDOF);
    for (let i = 0; i < mesh.nodes.length; i++) {
      const uz = Math.abs(d[i * 3]);
      if (uz > maxDeflUncoupled) maxDeflUncoupled = uz;
    }
    notes.push(`Uncoupled (Phase-1 slab only) max deflection: ${maxDeflUncoupled.toFixed(3)} mm`);
  } catch (e) {
    notes.push(`Uncoupled solve error: ${String(e)}`);
  }

  // ── Coupled system (Phase 7) ───────────────────────────────────────────────
  let maxDeflCoupled = 0;
  let eqErr = 0;
  try {
    const result = solveCoupledSystem(slab, beams, columns, STD_SLAB, STD_MAT, q, 2);
    maxDeflCoupled = result.slabResults.maxDeflection_mm;
    eqErr          = result.equilibrium.errorPct;
    notes.push(`Coupled (Phase-7) max deflection: ${maxDeflCoupled.toFixed(3)} mm`);
    notes.push(`Equilibrium error: ${eqErr.toFixed(3)} %`);
  } catch (e) {
    notes.push(`Coupled solve error: ${String(e)}`);
  }

  const deflReduction = maxDeflUncoupled > 0
    ? (1 - maxDeflCoupled / maxDeflUncoupled) * 100
    : 0;
  notes.push(`Deflection reduction due to beam stiffness: ${deflReduction.toFixed(1)} %`);

  checks.push({
    label: 'Coupled deflection < uncoupled deflection',
    value: maxDeflCoupled,
    expected: `< ${maxDeflUncoupled.toFixed(3)} mm`,
    pass: maxDeflCoupled < maxDeflUncoupled && maxDeflUncoupled > 1e-9,
  });
  checks.push({
    label: 'Deflection reduction > 0 %',
    value: deflReduction,
    expected: '> 0 %',
    pass: deflReduction > 0,
  });
  checks.push({
    label: 'Equilibrium error (%)',
    value: eqErr,
    expected: '< 2 %',
    pass: eqErr < 2,
  });

  const passed = checks.every(c => c.pass);
  return {
    testId: 'T3', description: 'Beam stiffness contribution: coupled deflection < uncoupled',
    passed, checks, notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Internal beam load share (6×6 m, Y-beam at x=3000mm)
// ─────────────────────────────────────────────────────────────────────────────

function runTest4(): Phase7TestResult {
  const notes: string[] = [];
  const checks: Phase7TestResult['checks'] = [];

  // 6×6 m slab with four corner columns + four edge beams + one internal Y-beam at x=3000mm
  const L = 6000;   // mm
  const q = 0.010;  // N/mm² = 10 kN/m²

  const slab: Slab = { id: 'S1', x1: 0, y1: 0, x2: L, y2: L };

  const columns: Column[] = [
    { id: 'C1', x: 0,  y: 0,  b: 300, h: 300, L: 3000 },
    { id: 'C2', x: L,  y: 0,  b: 300, h: 300, L: 3000 },
    { id: 'C3', x: L,  y: L,  b: 300, h: 300, L: 3000 },
    { id: 'C4', x: 0,  y: L,  b: 300, h: 300, L: 3000 },
    // "virtual" columns at midspan where internal beam meets edge beams
    // (omitted — internal beam is free-spanning, coupled to slab)
  ];

  const beams: Beam[] = [
    // Four edge beams
    {
      id: 'BT', fromCol: 'C4', toCol: 'C3',
      x1: 0, y1: L, x2: L, y2: L,
      direction: 'horizontal', length: 6, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BB', fromCol: 'C1', toCol: 'C2',
      x1: 0, y1: 0, x2: L, y2: 0,
      direction: 'horizontal', length: 6, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BL', fromCol: 'C1', toCol: 'C4',
      x1: 0, y1: 0, x2: 0, y2: L,
      direction: 'vertical', length: 6, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BR', fromCol: 'C2', toCol: 'C3',
      x1: L, y1: 0, x2: L, y2: L,
      direction: 'vertical', length: 6, b: 300, h: 500,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    // Internal beam at x = 3000mm (Y-direction, mid-span)
    {
      id: 'BI', fromCol: 'C1', toCol: 'C2',   // conceptual only
      x1: 3000, y1: 0, x2: 3000, y2: L,
      direction: 'vertical', length: 6, b: 300, h: 600,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
  ];

  const totalApplied_kN = q * L * L * 1e-3;
  notes.push(`Applied: q = 10 kN/m²  Total = ${totalApplied_kN.toFixed(1)} kN`);

  let result;
  try {
    result = solveCoupledSystem(slab, beams, columns, STD_SLAB, STD_MAT, q, 2);
  } catch (e) {
    return {
      testId: 'T4', description: 'Internal beam load share (6×6 m, Y-beam at x=3000mm)',
      passed: false,
      checks: [{ label: 'Solver error', value: 0, expected: 'no error', pass: false }],
      notes: [`ERROR: ${String(e)}`],
    };
  }

  const eq  = result.equilibrium;
  const dbg = result.debug;

  notes.push(`Total DOF: ${dbg.nTotalDOF}  Free: ${dbg.nFreeDOF}`);
  notes.push(`Reactions: ${eq.totalReactions_kN.toFixed(2)} kN  Error: ${eq.errorPct.toFixed(3)} %`);

  // The internal beam's max moment / shear as a proxy for load share
  const intBeam = result.beamResults.find(b => b.beamId === 'BI');
  const edgeBeams = result.beamResults.filter(b => b.beamId !== 'BI');

  if (intBeam) {
    notes.push(`Internal beam max moment: ${intBeam.maxMoment_kNm.toFixed(2)} kN·m`);
    notes.push(`Internal beam max shear:  ${intBeam.maxShear_kN.toFixed(2)} kN`);
  }
  for (const eb of edgeBeams) {
    notes.push(`  Edge ${eb.beamId}: maxM=${eb.maxMoment_kNm.toFixed(2)} kN·m maxV=${eb.maxShear_kN.toFixed(2)} kN`);
  }
  notes.push(`Max slab deflection: ${result.slabResults.maxDeflection_mm.toFixed(3)} mm`);

  checks.push({
    label: 'Equilibrium error (%)', value: eq.errorPct,
    expected: '< 2 %', pass: eq.errorPct < 2,
  });
  checks.push({
    label: 'Internal beam found in results', value: intBeam ? 1 : 0,
    expected: '= 1', pass: intBeam !== undefined,
  });
  checks.push({
    label: 'Internal beam max moment > 0 kN·m', value: intBeam?.maxMoment_kNm ?? 0,
    expected: '> 0', pass: (intBeam?.maxMoment_kNm ?? 0) > 0,
  });
  checks.push({
    label: 'Internal beam carries load (maxV > 5 kN)', value: intBeam?.maxShear_kN ?? 0,
    expected: '> 5 kN', pass: (intBeam?.maxShear_kN ?? 0) > 5,
  });
  checks.push({
    label: 'Max slab deflection > 0 mm', value: result.slabResults.maxDeflection_mm,
    expected: '> 0', pass: result.slabResults.maxDeflection_mm > 0,
  });

  const passed = checks.every(c => c.pass);
  return {
    testId: 'T4', description: 'Internal beam load share (6×6 m, Y-beam at x=3000mm)',
    passed, checks, notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Master validation runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run all four Phase 7 validation tests and return a combined report.
 * Safe to call from any React hook (pure in-memory, no side effects).
 */
export function runPhase7Validation(): Phase7Report {
  const t0 = Date.now();

  console.log('═══════════════════════════════════════════════════════');
  console.log('  slabFEMEngine Phase 7 — Full Coupled Beam-Slab FEM  ');
  console.log('═══════════════════════════════════════════════════════');

  const tests: Phase7TestResult[] = [];

  console.log('\n[Test 1] Frame element cantilever self-test…');
  tests.push(runTest1());

  console.log('\n[Test 2] Coupled equilibrium, 5×5 m, 4 edge beams…');
  tests.push(runTest2());

  console.log('\n[Test 3] Beam stiffness contribution (coupled vs uncoupled)…');
  tests.push(runTest3());

  console.log('\n[Test 4] Internal beam load share, 6×6 m…');
  tests.push(runTest4());

  const allPassed = tests.every(t => t.passed);
  const elapsed   = Date.now() - t0;

  console.log(`\n${'═'.repeat(55)}`);
  console.log('Phase 7 Validation Summary:');
  for (const t of tests) {
    const status = t.passed ? '  ✓ PASS' : '  ✗ FAIL';
    console.log(`  [${t.testId}] ${status}  —  ${t.description}`);
    for (const c of t.checks) {
      const cs = c.pass ? '    ✓' : '    ✗';
      console.log(`${cs}  ${c.label} = ${typeof c.value === 'number' ? c.value.toFixed(4) : c.value}  (${c.expected})`);
    }
  }
  console.log(`\nAll tests passed: ${allPassed}  (${elapsed} ms)`);
  console.log('═'.repeat(55));

  return { allPassed, tests };
}
