/**
 * slabFEMEngine – Phase 8 Validation Suite
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Five validation tests that verify the Phase 8 DOF-merging implementation
 * against mathematical requirements and against Phase 7 reference results.
 *
 * Test 1 — DOF count reduction
 *   Phase 8 must have fewer global DOFs than the Phase 7 equivalent.
 *   Expected: DOF_phase8 = DOF_phase7_equiv − 3 × nSharedNodes.
 *
 * Test 2 — Global equilibrium
 *   5×5 m slab, 4 edge beams, 4 columns, q = 10 kN/m².
 *   |ΣReactions − ΣLoads| / ΣLoads < 1 %.
 *
 * Test 3 — Result consistency vs Phase 7
 *   Run the same 5×5 m model in both Phase 7 and Phase 8.
 *   Max deflections must agree within 2 %.
 *   Max beam moments must agree within 2 %.
 *
 * Test 4 — Mesh sensitivity (stability test)
 *   Solve the same model at meshDensity = 2 and meshDensity = 3.
 *   Phase 8 deflections must converge (ratio within [0.8, 1.2]).
 *   No NaN or Infinity in the solution.
 *
 * Test 5 — Beam stiffness sensitivity
 *   Vary beam height (200 mm, 400 mm, 600 mm) at fixed span.
 *   Phase 8 slab deflection must decrease monotonically as EI increases.
 *   No oscillations or inversions.
 *
 * All tests are pure in-memory computations.  Units: mm, N, kN, kN·m.
 */

import type { Slab, Beam, Column, SlabProps, MatProps } from './types';
import { solveMergedDOFSystem } from './mergedDOFSystem';
import { solveCoupledSystem }   from './coupledSystem';

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const STD_MAT:  MatProps  = { fc: 25, fy: 420, fyt: 420, gamma: 24 };
const STD_SLAB: SlabProps = {
  thickness: 150, finishLoad: 0, liveLoad: 0, cover: 20, phiMain: 0.9, phiSlab: 0.9,
};

/** Build the standard 5×5 m model (mm coords). */
function make5x5Model(beamH = 500): { slab: Slab; beams: Beam[]; columns: Column[] } {
  const L = 5000;

  const slab: Slab = { id: 'S1', x1: 0, y1: 0, x2: L, y2: L };

  const columns: Column[] = [
    { id: 'C1', x: 0, y: 0, b: 300, h: 300, L: 3000 },
    { id: 'C2', x: L, y: 0, b: 300, h: 300, L: 3000 },
    { id: 'C3', x: L, y: L, b: 300, h: 300, L: 3000 },
    { id: 'C4', x: 0, y: L, b: 300, h: 300, L: 3000 },
  ];

  const beams: Beam[] = [
    {
      id: 'BT', fromCol: 'C4', toCol: 'C3',
      x1: 0, y1: L, x2: L, y2: L,
      direction: 'horizontal', length: 5, b: 300, h: beamH,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BB', fromCol: 'C1', toCol: 'C2',
      x1: 0, y1: 0, x2: L, y2: 0,
      direction: 'horizontal', length: 5, b: 300, h: beamH,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BL', fromCol: 'C1', toCol: 'C4',
      x1: 0, y1: 0, x2: 0, y2: L,
      direction: 'vertical', length: 5, b: 300, h: beamH,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
    {
      id: 'BR', fromCol: 'C2', toCol: 'C3',
      x1: L, y1: 0, x2: L, y2: L,
      direction: 'vertical', length: 5, b: 300, h: beamH,
      deadLoad: 0, liveLoad: 0, slabs: ['S1'],
    },
  ];

  return { slab, beams, columns };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report types
// ─────────────────────────────────────────────────────────────────────────────

export interface Phase8TestResult {
  testId:      string;
  description: string;
  passed:      boolean;
  checks:      { label: string; value: number; expected: string; pass: boolean }[];
  notes:       string[];
}

export interface Phase8Report {
  allPassed: boolean;
  tests:     Phase8TestResult[];
  /** Elapsed time for the entire validation run (ms) */
  elapsed_ms: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — DOF count reduction
// ─────────────────────────────────────────────────────────────────────────────

function runTest1(): Phase8TestResult {
  const notes: string[] = [];
  const checks: Phase8TestResult['checks'] = [];

  const { slab, beams, columns } = make5x5Model();
  const q = 0.010;

  let result;
  try {
    result = solveMergedDOFSystem(slab, beams, columns, STD_SLAB, STD_MAT, q, 2);
  } catch (e) {
    return {
      testId: 'T1', description: 'DOF count reduction vs Phase 7',
      passed: false,
      checks: [{ label: 'Solver error', value: 0, expected: 'no error', pass: false }],
      notes: [`ERROR: ${String(e)}`],
    };
  }

  const dbg = result.debug;

  notes.push(`Phase 8 DOF total:      ${dbg.nTotalDOF}`);
  notes.push(`Phase 7 equiv DOF:      ${dbg.nPhase7EquivDOF}`);
  notes.push(`DOF reduction:          ${dbg.dofReduction}  (= 3 × ${dbg.nSharedNodes} shared nodes)`);
  notes.push(`DOF reduction %:        ${dbg.dofReductionPct.toFixed(1)} %`);
  notes.push(`Free DOF (Phase 8):     ${dbg.nFreeDOF}`);
  notes.push(`Solve time:             ${dbg.solveTime_ms} ms`);
  notes.push(dbg.conditioningNote);

  const expectedReduction = 3 * dbg.nSharedNodes;

  checks.push({
    label: 'Phase8 DOF < Phase7 equiv DOF',
    value: dbg.nTotalDOF,
    expected: `< ${dbg.nPhase7EquivDOF}`,
    pass: dbg.nTotalDOF < dbg.nPhase7EquivDOF,
  });
  checks.push({
    label: 'DOF reduction = 3 × nSharedNodes',
    value: dbg.dofReduction,
    expected: `= ${expectedReduction}`,
    pass: dbg.dofReduction === expectedReduction,
  });
  checks.push({
    label: 'nSharedNodes > 0',
    value: dbg.nSharedNodes,
    expected: '> 0',
    pass: dbg.nSharedNodes > 0,
  });
  checks.push({
    label: 'DOF reduction > 0 %',
    value: dbg.dofReductionPct,
    expected: '> 0 %',
    pass: dbg.dofReductionPct > 0,
  });

  const passed = checks.every(c => c.pass);
  return {
    testId: 'T1', description: 'DOF count reduction vs Phase 7 equivalent',
    passed, checks, notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Global equilibrium
// ─────────────────────────────────────────────────────────────────────────────

function runTest2(): Phase8TestResult {
  const notes: string[] = [];
  const checks: Phase8TestResult['checks'] = [];

  const { slab, beams, columns } = make5x5Model();
  const q = 0.010;
  const L = 5000;

  const totalApplied_kN = q * L * L * 1e-3;
  notes.push(`Applied load: q = 10 kN/m²  Total = ${totalApplied_kN.toFixed(1)} kN`);

  let result;
  try {
    result = solveMergedDOFSystem(slab, beams, columns, STD_SLAB, STD_MAT, q, 2);
  } catch (e) {
    return {
      testId: 'T2', description: 'Global equilibrium (5×5 m, 4 edge beams, < 1 % error)',
      passed: false,
      checks: [{ label: 'Solver error', value: 0, expected: 'no error', pass: false }],
      notes: [`ERROR: ${String(e)}`],
    };
  }

  const eq  = result.equilibrium;
  const dbg = result.debug;

  notes.push(`Reactions:          ${eq.totalReactions_kN.toFixed(3)} kN`);
  notes.push(`Equilibrium error:  ${eq.errorPct.toFixed(4)} %`);
  notes.push(`Max slab deflection: ${result.slabResults.maxDeflection_mm.toFixed(4)} mm`);
  notes.push(`Total DOF: ${dbg.nTotalDOF}  Free: ${dbg.nFreeDOF}`);

  for (const br of result.beamResults) {
    notes.push(`  Beam ${br.beamId}: maxM=${br.maxMoment_kNm.toFixed(2)} kN·m  maxV=${br.maxShear_kN.toFixed(2)} kN`);
  }

  checks.push({
    label: 'Equilibrium error < 1 %',
    value: eq.errorPct,
    expected: '< 1 %',
    pass: eq.errorPct < 1,
  });
  checks.push({
    label: 'Max deflection > 0 mm',
    value: result.slabResults.maxDeflection_mm,
    expected: '> 0',
    pass: result.slabResults.maxDeflection_mm > 0,
  });
  checks.push({
    label: 'Beam results count = 4',
    value: result.beamResults.length,
    expected: '= 4',
    pass: result.beamResults.length === 4,
  });
  checks.push({
    label: 'Solution is finite (no NaN)',
    value: isFinite(eq.totalReactions_kN) ? 1 : 0,
    expected: '= 1',
    pass: isFinite(eq.totalReactions_kN) && isFinite(result.slabResults.maxDeflection_mm),
  });

  const passed = checks.every(c => c.pass);
  return {
    testId: 'T2', description: 'Global equilibrium (5×5 m, 4 edge beams, < 1 % error)',
    passed, checks, notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Result consistency: Phase 8 vs Phase 7
// ─────────────────────────────────────────────────────────────────────────────

function runTest3(): Phase8TestResult {
  const notes: string[] = [];
  const checks: Phase8TestResult['checks'] = [];

  const { slab, beams, columns } = make5x5Model();
  const q = 0.010;

  // ── Phase 7 reference ──
  let p7deflection = 0;
  let p7maxMoment  = 0;
  try {
    const r7 = solveCoupledSystem(slab, beams, columns, STD_SLAB, STD_MAT, q, 2);
    p7deflection = r7.slabResults.maxDeflection_mm;
    p7maxMoment  = Math.max(...r7.beamResults.map(b => b.maxMoment_kNm), 0);
    notes.push(`Phase 7 max deflection: ${p7deflection.toFixed(4)} mm`);
    notes.push(`Phase 7 max moment:     ${p7maxMoment.toFixed(4)} kN·m`);
    notes.push(`Phase 7 DOF (penalty):  ${r7.debug.nTotalDOF}`);
  } catch (e) {
    notes.push(`Phase 7 solve error: ${String(e)}`);
    // Still run Phase 8 and report partial results
  }

  // ── Phase 8 solution ──
  let p8deflection = 0;
  let p8maxMoment  = 0;
  let p8dofTotal   = 0;
  try {
    const r8 = solveMergedDOFSystem(slab, beams, columns, STD_SLAB, STD_MAT, q, 2);
    p8deflection = r8.slabResults.maxDeflection_mm;
    p8maxMoment  = Math.max(...r8.beamResults.map(b => b.maxMoment_kNm), 0);
    p8dofTotal   = r8.debug.nTotalDOF;
    notes.push(`Phase 8 max deflection: ${p8deflection.toFixed(4)} mm`);
    notes.push(`Phase 8 max moment:     ${p8maxMoment.toFixed(4)} kN·m`);
    notes.push(`Phase 8 DOF (merged):   ${p8dofTotal}`);
  } catch (e) {
    return {
      testId: 'T3', description: 'Result consistency: Phase 8 vs Phase 7 (< 2 % difference)',
      passed: false,
      checks: [{ label: 'Phase 8 solver error', value: 0, expected: 'no error', pass: false }],
      notes: [...notes, `ERROR: ${String(e)}`],
    };
  }

  const deflErr = p7deflection > 1e-9
    ? Math.abs(p8deflection - p7deflection) / p7deflection * 100
    : 0;
  const momErr = p7maxMoment > 1e-9
    ? Math.abs(p8maxMoment - p7maxMoment) / p7maxMoment * 100
    : 0;

  notes.push(`Deflection difference:  ${deflErr.toFixed(3)} %`);
  notes.push(`Max moment difference:  ${momErr.toFixed(3)} %`);
  notes.push(`DOF reduction:          ${p7deflection > 0 ? 'Phase8 smaller system' : 'n/a'}`);

  checks.push({
    label: 'Deflection agreement < 2 %',
    value: deflErr,
    expected: '< 2 %',
    pass: deflErr < 2,
  });
  checks.push({
    label: 'Max moment agreement < 2 %',
    value: momErr,
    expected: '< 2 %',
    pass: momErr < 2,
  });
  checks.push({
    label: 'Phase 8 max deflection > 0',
    value: p8deflection,
    expected: '> 0',
    pass: p8deflection > 0,
  });
  checks.push({
    label: 'Phase 8 max moment > 0 kN·m',
    value: p8maxMoment,
    expected: '> 0',
    pass: p8maxMoment > 0,
  });

  const passed = checks.every(c => c.pass);
  return {
    testId: 'T3', description: 'Result consistency: Phase 8 vs Phase 7 (< 2 % difference)',
    passed, checks, notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Mesh sensitivity / stability
// ─────────────────────────────────────────────────────────────────────────────

function runTest4(): Phase8TestResult {
  const notes: string[] = [];
  const checks: Phase8TestResult['checks'] = [];

  const { slab, beams, columns } = make5x5Model();
  const q = 0.010;

  let def2 = 0;
  let def3 = 0;
  let finite2 = true;
  let finite3 = true;

  try {
    const r2 = solveMergedDOFSystem(slab, beams, columns, STD_SLAB, STD_MAT, q, 2);
    def2 = r2.slabResults.maxDeflection_mm;
    finite2 = isFinite(def2) && !isNaN(def2);
    notes.push(`meshDensity=2: maxDefl=${def2.toFixed(4)} mm  DOF=${r2.debug.nTotalDOF}`);
  } catch (e) {
    notes.push(`meshDensity=2 error: ${String(e)}`);
    finite2 = false;
  }

  try {
    const r3 = solveMergedDOFSystem(slab, beams, columns, STD_SLAB, STD_MAT, q, 3);
    def3 = r3.slabResults.maxDeflection_mm;
    finite3 = isFinite(def3) && !isNaN(def3);
    notes.push(`meshDensity=3: maxDefl=${def3.toFixed(4)} mm  DOF=${r3.debug.nTotalDOF}`);
  } catch (e) {
    notes.push(`meshDensity=3 error: ${String(e)}`);
    finite3 = false;
  }

  const ratio = def2 > 1e-9 ? def3 / def2 : 0;
  notes.push(`Convergence ratio (def3/def2): ${ratio.toFixed(4)} (expected 0.8 – 1.2)`);

  checks.push({
    label: 'meshDensity=2 solution finite',
    value: finite2 ? 1 : 0,
    expected: '= 1',
    pass: finite2,
  });
  checks.push({
    label: 'meshDensity=3 solution finite',
    value: finite3 ? 1 : 0,
    expected: '= 1',
    pass: finite3,
  });
  checks.push({
    label: 'Mesh convergence ratio in [0.8, 1.2]',
    value: ratio,
    expected: '0.8 – 1.2',
    pass: ratio >= 0.8 && ratio <= 1.2,
  });
  checks.push({
    label: 'Both solutions positive deflection',
    value: Math.min(def2, def3),
    expected: '> 0',
    pass: def2 > 0 && def3 > 0,
  });

  const passed = checks.every(c => c.pass);
  return {
    testId: 'T4', description: 'Mesh sensitivity: stable convergence as mesh refines',
    passed, checks, notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Beam stiffness sensitivity (monotonic deflection response)
// ─────────────────────────────────────────────────────────────────────────────

function runTest5(): Phase8TestResult {
  const notes: string[] = [];
  const checks: Phase8TestResult['checks'] = [];

  const q = 0.010;
  const heights = [200, 400, 600];   // mm: low EI → high EI
  const deflections: number[] = [];

  for (const h of heights) {
    const { slab, beams, columns } = make5x5Model(h);
    try {
      const r = solveMergedDOFSystem(slab, beams, columns, STD_SLAB, STD_MAT, q, 2);
      deflections.push(r.slabResults.maxDeflection_mm);
      notes.push(`beamH=${h} mm: maxDefl=${r.slabResults.maxDeflection_mm.toFixed(4)} mm`);
    } catch (e) {
      deflections.push(NaN);
      notes.push(`beamH=${h} mm: ERROR — ${String(e)}`);
    }
  }

  // Monotonically decreasing deflection as beam height increases
  let monotonic = true;
  for (let i = 1; i < deflections.length; i++) {
    if (isNaN(deflections[i]) || deflections[i] >= deflections[i - 1]) {
      monotonic = false;
    }
  }

  const allFinite = deflections.every(d => isFinite(d) && !isNaN(d) && d > 0);

  notes.push(
    `Deflections [h=200, 400, 600]: ${deflections.map(d => d.toFixed(4)).join(', ')} mm`,
  );
  notes.push(
    monotonic
      ? '✓ Monotonically decreasing — beam EI correctly stiffens the system.'
      : '✗ Deflection did not decrease monotonically with increasing beam EI.',
  );

  checks.push({
    label: 'All solutions finite and positive',
    value: allFinite ? 1 : 0,
    expected: '= 1',
    pass: allFinite,
  });
  checks.push({
    label: 'Deflection decreases as beam EI increases (monotonic)',
    value: monotonic ? 1 : 0,
    expected: '= 1',
    pass: monotonic,
  });
  checks.push({
    label: 'Largest beam (h=600) deflection < smallest beam (h=200)',
    value: deflections[2] ?? 0,
    expected: `< ${(deflections[0] ?? 0).toFixed(4)} mm`,
    pass: (deflections[2] ?? Infinity) < (deflections[0] ?? 0),
  });

  const passed = checks.every(c => c.pass);
  return {
    testId: 'T5', description: 'Beam stiffness sensitivity: monotonic deflection response',
    passed, checks, notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Master runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run all five Phase 8 validation tests and return a combined report.
 * Safe to call from any React hook (pure in-memory, no side effects).
 */
export function runPhase8Validation(): Phase8Report {
  const t0 = Date.now();

  console.log('═══════════════════════════════════════════════════════');
  console.log(' slabFEMEngine Phase 8 — True DOF Merging Validation  ');
  console.log('═══════════════════════════════════════════════════════');

  const tests: Phase8TestResult[] = [];

  console.log('\n[Test 1] DOF count reduction…');
  tests.push(runTest1());

  console.log('\n[Test 2] Global equilibrium (5×5 m, 4 edge beams)…');
  tests.push(runTest2());

  console.log('\n[Test 3] Result consistency vs Phase 7…');
  tests.push(runTest3());

  console.log('\n[Test 4] Mesh sensitivity / stability…');
  tests.push(runTest4());

  console.log('\n[Test 5] Beam stiffness sensitivity (monotonic response)…');
  tests.push(runTest5());

  const allPassed  = tests.every(t => t.passed);
  const elapsed_ms = Date.now() - t0;

  console.log(`\n${'═'.repeat(55)}`);
  console.log('Phase 8 Validation Summary:');
  for (const t of tests) {
    const status = t.passed ? '  ✓ PASS' : '  ✗ FAIL';
    console.log(`  [${t.testId}] ${status}  —  ${t.description}`);
    for (const c of t.checks) {
      const cs = c.pass ? '    ✓' : '    ✗';
      console.log(
        `${cs}  ${c.label} = ${typeof c.value === 'number' ? c.value.toFixed(4) : c.value}` +
        `  (${c.expected})`,
      );
    }
  }
  console.log(`\nAll tests passed: ${allPassed}  (${elapsed_ms} ms)`);
  console.log('═'.repeat(55));

  return { allPassed, tests, elapsed_ms };
}
