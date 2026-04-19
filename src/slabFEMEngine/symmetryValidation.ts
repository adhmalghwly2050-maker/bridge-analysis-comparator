/**
 * slabFEMEngine – Symmetry Validation & Node-Topology Report
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Implements the mandatory tests described in the architecture specification:
 *
 *   1. runSymmetryTest()
 *      ─ Re-runs a symmetric 5 × 5 m slab with 4 boundary beams.
 *      ─ Verifies that every beam has the SAME number of nodes.
 *      ─ Verifies that the moment diagrams of opposite beams are mirror images
 *        (symmetry error < 2 % of peak).
 *      ─ Checks corner connectivity (each corner node must connect to both beams
 *        meeting there).
 *
 *   2. generateTopologyReport()
 *      ─ Builds the full text report required by the specification:
 *          A. Node registry implementation summary
 *          B. Before vs After node counts
 *          C. Corner node connectivity detail
 *          D. Symmetry validation results
 *
 * Units: mm internally, m/kN in all output text.
 */

import { meshMultipleSlabs } from './mesh';
import { assembleSystem, reconstructDisplacements } from './assembler';
import { solve }             from './solver';
import { computeInternalForces } from './internalForces';
import { GlobalNodeRegistry } from './nodeRegistry';

import type { Slab, Beam, Column, SlabProps, MatProps } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Test geometry: symmetric 5 × 5 m slab, 4 boundary beams, 4 corner columns
// ─────────────────────────────────────────────────────────────────────────────

const L = 5000; // mm  (5 m)
const B = 300;  // mm  beam width
const H = 500;  // mm  beam height

function buildSymmetric5x5Model(): {
  slabs:     Slab[];
  beams:     Beam[];
  columns:   Column[];
  slabProps: SlabProps;
  mat:       MatProps;
} {
  const slabId = 'slab-sym';

  const slabs: Slab[] = [{
    id: slabId,
    x1: 0, y1: 0,
    x2: L, y2: L,
    direction: 'two-way',
  } as Slab];

  const beams: Beam[] = [
    {
      id: 'B-south', direction: 'horizontal',
      x1: 0,  y1: 0,  x2: L,  y2: 0,
      b: B, h: H, length: L / 1000,
      slabs: [slabId],
    } as Beam,
    {
      id: 'B-north', direction: 'horizontal',
      x1: 0,  y1: L,  x2: L,  y2: L,
      b: B, h: H, length: L / 1000,
      slabs: [slabId],
    } as Beam,
    {
      id: 'B-west', direction: 'vertical',
      x1: 0,  y1: 0,  x2: 0,  y2: L,
      b: B, h: H, length: L / 1000,
      slabs: [slabId],
    } as Beam,
    {
      id: 'B-east', direction: 'vertical',
      x1: L,  y1: 0,  x2: L,  y2: L,
      b: B, h: H, length: L / 1000,
      slabs: [slabId],
    } as Beam,
  ];

  const columns: Column[] = [
    { id: 'C1', x: 0, y: 0, b: 300, h: 300, L: 3000 } as Column,
    { id: 'C2', x: L, y: 0, b: 300, h: 300, L: 3000 } as Column,
    { id: 'C3', x: L, y: L, b: 300, h: 300, L: 3000 } as Column,
    { id: 'C4', x: 0, y: L, b: 300, h: 300, L: 3000 } as Column,
  ];

  const slabProps: SlabProps = {
    thickness:  150,
    finishLoad: 0,
    liveLoad:   0,
    cover:      20,
    phiMain:    0.9,
    phiSlab:    0.9,
  };

  const mat: MatProps = {
    fc: 25, fy: 420, fyt: 420, gamma: 24,
  };

  return { slabs, beams, columns, slabProps, mat };
}

// ─────────────────────────────────────────────────────────────────────────────
// Symmetry test result types
// ─────────────────────────────────────────────────────────────────────────────

export interface BeamNodeInfo {
  beamId:      string;
  nodeCount:   number;
  /** Global IDs of nodes on this beam (from registry). */
  globalIds:   number[];
}

export interface CornerNodeInfo {
  globalId:   number;
  x_mm:       number;
  y_mm:       number;
  beamIds:    string[];
  slabElems:  number;
  totalElems: number;
  /** True iff this corner connects to ALL beams that meet at this coordinate. */
  fullyConnected: boolean;
}

export interface MomentSymmetryCheck {
  /** Pair of beams that should be mirror images (e.g. B-south / B-north). */
  beamA:      string;
  beamB:      string;
  maxMomentA: number;   // kN·m/m (peak |Mx| or |My| along beam line)
  maxMomentB: number;
  /** Relative error in peak moment between the two beams (%). */
  symmetryError_pct: number;
  passed: boolean;
}

export interface SymmetryTestResult {
  passed:           boolean;
  /** True iff all 4 beams have the same node count. */
  nodeCountsEqual:  boolean;
  beamNodeInfo:     BeamNodeInfo[];
  cornerNodes:      CornerNodeInfo[];
  momentChecks:     MomentSymmetryCheck[];
  /** Total unique global nodes (with shared registry). */
  globalNodeCount:  number;
  /** Total nodes that would exist without registry sharing (sum across slabs). */
  localNodeCount:   number;
  /** Number of duplicate nodes eliminated by the registry. */
  savedNodes:       number;
  notes:            string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Core symmetry test
// ─────────────────────────────────────────────────────────────────────────────

export function runSymmetryTest(meshDensity: number = 4): SymmetryTestResult {
  const notes: string[] = [];
  const { slabs, beams, columns, slabProps, mat } = buildSymmetric5x5Model();

  // ── 1. Build mesh with shared registry ────────────────────────────────────
  const multiMesh = meshMultipleSlabs(slabs, beams, columns, meshDensity);
  const registry  = multiMesh.registry;
  const mesh      = multiMesh.slabMeshes[0]; // single slab in this test

  const globalNodeCount = multiMesh.afterCount;
  const localNodeCount  = multiMesh.beforeCounts.reduce((s, c) => s + c, 0);
  const savedNodes      = localNodeCount - globalNodeCount;

  notes.push(
    `Mesh: ${mesh.xLines.length - 1} × ${mesh.yLines.length - 1} elements, ` +
    `${mesh.nodes.length} slab nodes, ${globalNodeCount} global nodes.`,
  );
  notes.push(
    `Node deduplication: ${localNodeCount} local → ` +
    `${globalNodeCount} global (saved ${savedNodes}).`,
  );

  // ── 2. Solve for displacements ─────────────────────────────────────────────
  const q_Nmm2 = 10e-3;  // 10 kN/m² expressed in N/mm²
  const sys = assembleSystem(mesh, slabProps, mat, q_Nmm2);
  let d_full: number[] = new Array(sys.nDOF).fill(0);

  if (sys.freeDOFs.length > 0) {
    const sr = solve(sys.K_ff.slice(), sys.F_f.slice());
    d_full   = reconstructDisplacements(sr.d, sys.freeDOFs, sys.nDOF);
  } else {
    notes.push('WARNING: no free DOFs — all nodes fixed. Check boundary conditions.');
  }

  // ── 3. Compute internal forces ─────────────────────────────────────────────
  const forceResults = computeInternalForces(mesh, d_full, slabProps, mat);

  // ── 4. Beam node counts ────────────────────────────────────────────────────
  //
  // IMPORTANT: use geometric proximity (same as beam-segment registration),
  // NOT n.beamId === beam.id.  Corner nodes carry beamId = <first-assigned beam>
  // so filtering by beamId would miss corners from the perpendicular beam and
  // produce counts of 19 instead of 21 for a symmetric 5 × 5 mesh (density 4).
  const beamNodeInfo: BeamNodeInfo[] = [];

  for (const beam of beams) {
    const bx1 = Math.min(beam.x1, beam.x2);
    const bx2 = Math.max(beam.x1, beam.x2);
    const by1 = Math.min(beam.y1, beam.y2);
    const by2 = Math.max(beam.y1, beam.y2);
    const EPS_B = 1e-3;

    const bNodes = mesh.nodes.filter(n => {
      if (beam.direction === 'horizontal') {
        return (
          Math.abs(n.y - beam.y1) < EPS_B &&
          n.x >= bx1 - EPS_B && n.x <= bx2 + EPS_B
        );
      } else {
        return (
          Math.abs(n.x - beam.x1) < EPS_B &&
          n.y >= by1 - EPS_B && n.y <= by2 + EPS_B
        );
      }
    });

    const gids = bNodes.map(n => n.globalId).sort((a, b) => a - b);
    beamNodeInfo.push({
      beamId:    beam.id,
      nodeCount: bNodes.length,
      globalIds: gids,
    });
  }

  const counts      = beamNodeInfo.map(b => b.nodeCount);
  const nodeCountsEqual = counts.every(c => c === counts[0]);

  if (nodeCountsEqual) {
    notes.push(`✓ All 4 beams have identical node count: ${counts[0]} nodes each.`);
  } else {
    notes.push(`✗ ASYMMETRY: beam node counts differ: ${counts.join(', ')}.`);
  }

  // ── 5. Corner node connectivity ────────────────────────────────────────────
  const connReport   = registry.buildConnectivityReport();
  const cornerNodes: CornerNodeInfo[] = [];

  const cornerCoords = [
    { x: 0, y: 0 }, { x: L, y: 0 },
    { x: L, y: L }, { x: 0, y: L },
  ];

  for (const cc of cornerCoords) {
    // Find the node at this corner in the mesh
    const EPS_CORNER = 1e-3;
    const meshNode = mesh.nodes.find(
      n => Math.abs(n.x - cc.x) < EPS_CORNER && Math.abs(n.y - cc.y) < EPS_CORNER,
    );
    if (!meshNode) {
      notes.push(`WARNING: no mesh node found at corner (${cc.x}, ${cc.y}).`);
      continue;
    }

    const gn = registry.getNode(meshNode.globalId);

    const beamIds: string[]  = [];
    let slabElems = 0;
    for (const ref of gn.connectedElements) {
      if (ref.startsWith('beam:')) {
        const bid = ref.split(':')[1];
        if (!beamIds.includes(bid)) beamIds.push(bid);
      }
      if (ref.startsWith('slab:')) slabElems++;
    }

    // How many beams SHOULD meet at this corner?
    // Each corner touches exactly 2 boundary beams.
    const expectedBeams = 2;
    const fullyConnected = beamIds.length >= expectedBeams;

    if (fullyConnected) {
      notes.push(
        `✓ Corner (${(cc.x / 1000).toFixed(0)}, ${(cc.y / 1000).toFixed(0)}) m: ` +
        `globalId=${meshNode.globalId}, beams=[${beamIds.join(', ')}], ` +
        `slabElems=${slabElems}.`,
      );
    } else {
      notes.push(
        `✗ Corner (${(cc.x / 1000).toFixed(0)}, ${(cc.y / 1000).toFixed(0)}) m: ` +
        `MISSING BEAM CONNECTIVITY — only ${beamIds.length} of ${expectedBeams} beams ` +
        `registered. beams=[${beamIds.join(', ')}].`,
      );
    }

    cornerNodes.push({
      globalId:       meshNode.globalId,
      x_mm:           cc.x,
      y_mm:           cc.y,
      beamIds,
      slabElems,
      totalElems:     gn.connectedElements.length,
      fullyConnected,
    });
  }

  // ── 6. Moment symmetry check ───────────────────────────────────────────────
  //  Extract peak |My| along horizontal beams (south vs north) and
  //  peak |Mx| along vertical beams (west vs east).

  function peakMomentAlongBeam(beamDef: Beam, component: 'Mx' | 'My'): number {
    // Use geometric proximity to find ALL nodes on this beam (including corner nodes
    // whose beamId may be assigned to a different beam by the first-match classifier).
    const bx1 = Math.min(beamDef.x1, beamDef.x2);
    const bx2 = Math.max(beamDef.x1, beamDef.x2);
    const by1 = Math.min(beamDef.y1, beamDef.y2);
    const by2 = Math.max(beamDef.y1, beamDef.y2);
    const EPS_B = 1e-3;

    const beamNodeSet = new Set(
      mesh.nodes
        .filter(n => {
          if (beamDef.direction === 'horizontal') {
            return Math.abs(n.y - beamDef.y1) < EPS_B &&
              n.x >= bx1 - EPS_B && n.x <= bx2 + EPS_B;
          } else {
            return Math.abs(n.x - beamDef.x1) < EPS_B &&
              n.y >= by1 - EPS_B && n.y <= by2 + EPS_B;
          }
        })
        .map(n => n.id),
    );

    let peak = 0;
    for (const fr of forceResults) {
      const elem = mesh.elements[fr.elementId];
      const touchesBeam = elem.nodeIds.some(nid => beamNodeSet.has(nid));
      if (touchesBeam) {
        // resultants are already in kN·m/m (as per types.ts StressResultants doc)
        const v = Math.abs(fr.resultants[component]);
        if (v > peak) peak = v;
      }
    }
    return peak;
  }

  const momentChecks: MomentSymmetryCheck[] = [];

  function addCheck(
    idA: string, idB: string, comp: 'Mx' | 'My',
  ): void {
    const beamA = beams.find(b => b.id === idA)!;
    const beamB = beams.find(b => b.id === idB)!;
    const pA  = peakMomentAlongBeam(beamA, comp);
    const pB  = peakMomentAlongBeam(beamB, comp);
    const ref = Math.max(pA, pB, 1e-6);
    const err = Math.abs(pA - pB) / ref * 100;
    const ok  = err < 2.0;

    if (ok) {
      notes.push(
        `✓ Moment symmetry ${idA}/${idB} (${comp}): ` +
        `peak ${pA.toFixed(4)} vs ${pB.toFixed(4)} kN·m/m  ` +
        `(error ${err.toFixed(2)} %).`,
      );
    } else {
      notes.push(
        `✗ Moment symmetry FAILED ${idA}/${idB} (${comp}): ` +
        `${pA.toFixed(4)} vs ${pB.toFixed(4)} kN·m/m  ` +
        `(error ${err.toFixed(2)} % > 2 %).`,
      );
    }

    momentChecks.push({
      beamA: idA, beamB: idB,
      maxMomentA: pA,
      maxMomentB: pB,
      symmetryError_pct: err,
      passed: ok,
    });
  }

  addCheck('B-south', 'B-north', 'My');
  addCheck('B-west',  'B-east',  'Mx');

  // ── 7. Overall pass/fail ───────────────────────────────────────────────────
  const allCornersOk   = cornerNodes.every(c => c.fullyConnected);
  const allMomentsOk   = momentChecks.every(m => m.passed);
  const passed         = nodeCountsEqual && allCornersOk && allMomentsOk;

  if (passed) {
    notes.push('✓ OVERALL: Symmetry test PASSED.');
  } else {
    notes.push('✗ OVERALL: Symmetry test FAILED — review items above.');
  }

  return {
    passed,
    nodeCountsEqual,
    beamNodeInfo,
    cornerNodes,
    momentChecks,
    globalNodeCount,
    localNodeCount,
    savedNodes,
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full text report generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the complete text report as specified:
 *   A. Node registry implementation
 *   B. Before vs After node counts
 *   C. Corner node connectivity
 *   D. Symmetry validation results
 */
export function generateTopologyReport(meshDensity: number = 4): string {
  const lines: string[] = [];

  const HR  = '═'.repeat(72);
  const hr  = '─'.repeat(72);

  lines.push(HR);
  lines.push('  FEM NODE TOPOLOGY ARCHITECTURE FIX — VALIDATION REPORT');
  lines.push(`  Generated: ${new Date().toISOString()}`);
  lines.push(HR);
  lines.push('');

  // ── A. Implementation summary ────────────────────────────────────────────
  lines.push('A. NODE REGISTRY IMPLEMENTATION');
  lines.push(hr);
  lines.push('');
  lines.push('  Function : GlobalNodeRegistry.getOrCreateNode(x, y, z)');
  lines.push('  Location : src/slabFEMEngine/nodeRegistry.ts');
  lines.push('');
  lines.push('  Node structure:');
  lines.push('    { id, x, y, z, connectedElements[] }');
  lines.push('');
  lines.push('  Lookup algorithm:');
  lines.push('    1. Hash coordinate to grid cell key  round(x/tol) _ round(y/tol) _ round(z/tol)');
  lines.push('    2. Probe 27 neighbouring cells (3×3×3) to handle grid-boundary floating-point');
  lines.push('    3. If existing node within tol (1e-6 mm) → return its id');
  lines.push('    4. Otherwise → create new node, store in bucket, return new id');
  lines.push('');
  lines.push('  Changes to mesh.ts:');
  lines.push('    • meshSlab() now accepts optional GlobalNodeRegistry parameter');
  lines.push('    • Every grid intersection calls reg.getOrCreateNode(x, y, 0)');
  lines.push('    • Local node.id = slab-local array index (existing DOF indexing unchanged)');
  lines.push('    • node.globalId = registry-assigned ID (cross-slab unique)');
  lines.push('    • After each element is built, reg.registerElement() records connectivity');
  lines.push('    • meshMultipleSlabs() creates ONE registry for ALL slabs');
  lines.push('');
  lines.push('  Backward compatibility:');
  lines.push('    • When no registry is passed, a private local registry is created');
  lines.push('    • In that case globalId === id — all callers work unchanged');
  lines.push('');

  // ── Run the symmetry test to populate B, C, D ─────────────────────────────
  const result = runSymmetryTest(meshDensity);

  // ── B. Before vs After node counts ────────────────────────────────────────
  lines.push('B. BEFORE vs AFTER NODE COUNTS');
  lines.push(hr);
  lines.push('');
  lines.push(`  Model: symmetric 5 × 5 m slab, 4 boundary beams, meshDensity = ${meshDensity}`);
  lines.push('');
  lines.push(`  BEFORE (independent per-slab mesh, no registry sharing):`);
  lines.push(`    Nodes created by slab-1 mesh : ${result.localNodeCount}`);
  lines.push('');
  lines.push(`  AFTER  (shared GlobalNodeRegistry across all slabs):`);
  lines.push(`    Unique global nodes          : ${result.globalNodeCount}`);
  lines.push(`    Duplicate nodes eliminated   : ${result.savedNodes}`);
  lines.push('');
  lines.push('  Beam node counts:');

  for (const bi of result.beamNodeInfo) {
    lines.push(`    ${bi.beamId.padEnd(12)}: ${bi.nodeCount} nodes  globalIds=[${bi.globalIds.slice(0, 5).join(', ')}${bi.globalIds.length > 5 ? '…' : ''}]`);
  }

  const allSame = result.nodeCountsEqual
    ? '✓ ALL IDENTICAL (required for symmetry)'
    : '✗ COUNTS DIFFER (symmetry broken)';
  lines.push(`    ${allSame}`);
  lines.push('');

  // ── C. Corner node connectivity ────────────────────────────────────────────
  lines.push('C. CORNER NODE CONNECTIVITY');
  lines.push(hr);
  lines.push('');
  lines.push('  Requirement: each corner node must connect to exactly 2 beams + slab elements');
  lines.push('');
  lines.push(`  ${'Corner'.padEnd(18)} ${'globalId'.padEnd(10)} ${'Beams'.padEnd(28)} ${'SlabElems'.padEnd(12)} Status`);
  lines.push(`  ${'-'.repeat(18)} ${'-'.repeat(10)} ${'-'.repeat(28)} ${'-'.repeat(12)} ------`);

  for (const cn of result.cornerNodes) {
    const coord  = `(${(cn.x_mm / 1000).toFixed(0)}, ${(cn.y_mm / 1000).toFixed(0)}) m`;
    const bids   = cn.beamIds.join(', ');
    const status = cn.fullyConnected ? '✓ OK' : '✗ MISSING';
    lines.push(
      `  ${coord.padEnd(18)} ${cn.globalId.toString().padEnd(10)} ` +
      `${bids.padEnd(28)} ${cn.slabElems.toString().padEnd(12)} ${status}`,
    );
  }
  lines.push('');

  // ── D. Symmetry validation results ────────────────────────────────────────
  lines.push('D. SYMMETRY VALIDATION RESULTS');
  lines.push(hr);
  lines.push('');

  for (const mc of result.momentChecks) {
    const status = mc.passed ? '✓ PASS' : '✗ FAIL';
    const label = mc.maxMomentA < 1e-6 && mc.maxMomentB < 1e-6
      ? '(both ≈ 0 — all boundary DOFs fixed, interior elems not adjacent to beam)'
      : '';
    lines.push(
      `  ${mc.beamA} / ${mc.beamB}:  ` +
      `peak=${mc.maxMomentA.toFixed(4)} vs ${mc.maxMomentB.toFixed(4)} kN·m/m  ` +
      `error=${mc.symmetryError_pct.toFixed(2)}%  ${status}  ${label}`,
    );
  }
  lines.push('');

  lines.push('  Node count symmetry:');
  lines.push(`    ${result.nodeCountsEqual ? '✓ PASS' : '✗ FAIL'}`);
  lines.push('');

  lines.push('  Corner connectivity:');
  const allCornerOk = result.cornerNodes.every(c => c.fullyConnected);
  lines.push(`    ${allCornerOk ? '✓ PASS — all corners correctly connected' : '✗ FAIL — corners have missing beam connections'}`);
  lines.push('');

  lines.push(hr);
  const overallStatus = result.passed ? '✓  ALL TESTS PASSED' : '✗  ONE OR MORE TESTS FAILED';
  lines.push(`  OVERALL RESULT: ${overallStatus}`);
  lines.push(hr);
  lines.push('');

  lines.push('E. DEBUG LOG (from runSymmetryTest)');
  lines.push(hr);
  for (const note of result.notes) {
    lines.push(`  ${note}`);
  }
  lines.push('');

  return lines.join('\n');
}
