/**
 * slabFEMEngine – Phase 9: Sparse FEM Assembler
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Replicates the Phase 8 (mergedDOFSystem) assembly logic but uses the
 * TripletMatrix COO format to scatter element stiffness directly into a
 * sparse representation WITHOUT building the dense n×n K_global.
 *
 * ── Dense vs Sparse memory comparison ────────────────────────────────────
 *
 *   Dense:  n² × 8 bytes
 *   Sparse: nnz × 12 bytes  (values + colIndex)  +  (n+1) × 4 bytes
 *
 *   For a 3 000-DOF system:
 *     Dense:  9 × 10⁶ × 8 = 72 MB
 *     Sparse: ~50 000 nnz × 12 = 0.6 MB  (typical FEM fill ≈ 0.5%)
 *
 * ── Key difference from the dense assembler ───────────────────────────────
 *
 *   1. During element scatter: push (i, j, ke[i][j]) triplets.
 *      No large pre-allocated array.
 *   2. BC application: build free-DOF index map, filter triplets,
 *      renumber to compact free-DOF indices.  No n×n extraction.
 *   3. The resulting CSR K_ff has size nFree × nFree.
 *
 * Units: mm, N, rad.
 */

import type { SlabProps, MatProps, Beam, Slab, Column } from './types';
import { meshSlab }                                      from './mesh';
import { elementStiffness, elementLoadVector }           from './mindlinShell';
import { elemGlobalDOFs }                                from './assembler';
import {
  buildLocalStiffness,
  buildTransformationMatrix,
  globalStiffness,
  sectionFromBeam,
}                                                        from './frameElement';
import { TripletMatrix, type CSRMatrix }                 from './sparseMatrix';

// ─────────────────────────────────────────────────────────────────────────────
// Output interface
// ─────────────────────────────────────────────────────────────────────────────

export interface SparseAssemblyResult {
  /** Sparse reduced stiffness matrix (free DOFs only). */
  K_ff_csr:     CSRMatrix;
  /** Reduced force vector (free DOFs only). */
  F_f:          Float64Array;
  /** Global DOF indices that are free (maps local free → global). */
  freeDOFs:     number[];
  /** Global DOF indices that are fixed. */
  fixedDOFs:    Set<number>;
  /** Total global DOF count. */
  nTotalDOF:    number;
  /** Number of free DOFs = K_ff_csr.n. */
  nFreeDOF:     number;
  /** Shared-node registry (for result recovery). */
  sharedNodeMap: Map<number, SharedEntry>;
  /** Number of slab-only DOFs = 3 × nSlabNodes. */
  nSlabDOF:     number;
  /** Full (unsorted) force vector over all DOFs (for reaction recovery). */
  F_full:       Float64Array;
}

export interface SharedEntry {
  slabNodeIdx:  number;
  beamBlockIdx: number;
  isFixed:      boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main sparse assembler — Phase 8 DOF layout, sparse storage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble the Phase 8 merged-DOF system in sparse (CSR) format.
 *
 * This mirrors the assembly in solveMergedDOFSystem() but uses TripletMatrix
 * instead of a dense flat array.  The final CSR matrix is nFree × nFree.
 *
 * @returns SparseAssemblyResult containing K_ff_csr, F_f, and auxiliary data
 *          needed for post-processing.
 */
export function sparseAssembleMergedDOF(
  slab:        Slab,
  beams:       Beam[],
  columns:     Column[],
  slabProps:   SlabProps,
  mat:         MatProps,
  q_Nmm2:     number,
  meshDensity: number = 2,
): SparseAssemblyResult {

  // ── 1. Generate slab mesh ─────────────────────────────────────────────────
  const mesh     = meshSlab(slab, beams, columns, meshDensity);
  const nodes    = mesh.nodes;
  const elements = mesh.elements;
  const nSlab    = nodes.length;
  const nSlabDOF = nSlab * 3;

  // ── 2. Identify shared nodes ──────────────────────────────────────────────
  const sharedNodeMap = new Map<number, SharedEntry>();
  let beamBlockIdx = 0;

  for (let ni = 0; ni < nSlab; ni++) {
    const nd = nodes[ni];
    if (nd.beamId !== null && !sharedNodeMap.has(ni)) {
      sharedNodeMap.set(ni, {
        slabNodeIdx:  ni,
        beamBlockIdx: beamBlockIdx++,
        isFixed:      nd.atColumn,
      });
    }
  }

  const nSharedNodes  = beamBlockIdx;
  const nExtraBeamDOF = nSharedNodes * 3;
  const nTotalDOF     = nSlabDOF + nExtraBeamDOF;

  console.log(
    `[Phase9/sparse] Mesh: ${nSlab} nodes, ${elements.length} elements  ` +
    `Shared nodes: ${nSharedNodes}  Total DOF: ${nTotalDOF}`,
  );

  // ── 3. Full force vector (for later reaction extraction) ──────────────────
  const F_full = new Float64Array(nTotalDOF);

  // ── 4. Triplet accumulator for full K ────────────────────────────────────
  // We will filter to free-DOF pairs below; keeping as full triplets first.
  const tripFull = new TripletMatrix(nTotalDOF);

  // ── 5. Assemble slab elements → scatter into triplets ─────────────────────
  for (const elem of elements) {
    const gDOF = elemGlobalDOFs(elem.nodeIds);           // 12 global DOF indices
    const ke   = elementStiffness(elem, nodes, slabProps, mat);
    const fe   = elementLoadVector(elem, nodes, q_Nmm2);

    for (let i = 0; i < 12; i++) {
      const gi = gDOF[i];
      F_full[gi] += fe[i];
      for (let j = 0; j < 12; j++) {
        tripFull.add(gi, gDOF[j], ke[i * 12 + j]);
      }
    }
  }

  // ── 6. Assemble beam elements → scatter into triplets ─────────────────────
  for (const beam of beams) {
    if (!beam.slabs.includes(slab.id)) continue;

    // Collect beam nodes on this beam
    const beamNodes: { slabNodeIdx: number; beamPos: number }[] = [];
    for (let ni = 0; ni < nSlab; ni++) {
      if (nodes[ni].beamId === beam.id) {
        beamNodes.push({ slabNodeIdx: ni, beamPos: nodes[ni].beamPos });
      }
    }
    if (beamNodes.length < 2) continue;
    beamNodes.sort((a, b) => a.beamPos - b.beamPos);

    const dx    = beam.x2 - beam.x1;
    const dy    = beam.y2 - beam.y1;
    const Lbeam = Math.hypot(dx, dy);
    if (Lbeam < 1e-6) continue;
    const cosA = dx / Lbeam;
    const sinA = dy / Lbeam;

    for (let ei = 0; ei < beamNodes.length - 1; ei++) {
      const nA     = beamNodes[ei];
      const nB     = beamNodes[ei + 1];
      const entryA = sharedNodeMap.get(nA.slabNodeIdx);
      const entryB = sharedNodeMap.get(nB.slabNodeIdx);
      if (!entryA || !entryB) continue;

      const xA    = nodes[nA.slabNodeIdx].x;
      const yA    = nodes[nA.slabNodeIdx].y;
      const xB    = nodes[nB.slabNodeIdx].x;
      const yB    = nodes[nB.slabNodeIdx].y;
      const Lelem = Math.hypot(xB - xA, yB - yA);
      if (Lelem < 1e-6) continue;

      const sec   = sectionFromBeam(beam.b, beam.h, Lelem, mat.fc);
      const K_loc = buildLocalStiffness(sec);
      const T     = buildTransformationMatrix(cosA, sinA);
      const K_glo = globalStiffness(K_loc, T);  // 12×12 global

      // Phase 8 merged DOF indices
      const elemDOF = beamElemGlobalDOFs(
        nA.slabNodeIdx, entryA.beamBlockIdx,
        nB.slabNodeIdx, entryB.beamBlockIdx,
        nSlabDOF,
      );

      for (let i = 0; i < 12; i++) {
        const gi = elemDOF[i];
        for (let j = 0; j < 12; j++) {
          tripFull.add(gi, elemDOF[j], K_glo[i * 12 + j]);
        }
      }
    }
  }

  // ── 7. Determine fixed and free DOFs ─────────────────────────────────────
  //    Replicate Phase 8 BC logic exactly (same rules as mergedDOFSystem.ts).
  const fixedDOFs = new Set<number>();

  // (a) Slab node BCs
  for (let ni = 0; ni < nSlab; ni++) {
    const nd = nodes[ni];
    const isRigidBC = nd.atColumn || (nd.isFixed && nd.beamId === null);
    if (isRigidBC) {
      fixedDOFs.add(ni * 3 + 0);
      fixedDOFs.add(ni * 3 + 1);
      fixedDOFs.add(ni * 3 + 2);
    }
  }

  // (b) Extra beam DOFs at column-coincident shared nodes
  for (const [, entry] of sharedNodeMap) {
    if (entry.isFixed) {
      const off = nSlabDOF + entry.beamBlockIdx * 3;
      fixedDOFs.add(off + 0);
      fixedDOFs.add(off + 1);
      fixedDOFs.add(off + 2);
    }
  }

  // (c) Extra beam DOFs with no element attached — zero diagonal
  //     Scan triplets to build diagonal sums, then fix zero-diagonal extra-beam DOFs.
  const diagSum = new Float64Array(nTotalDOF);
  tripFull.forEachEntry((i, j, v) => {
    if (i === j) diagSum[i] += v;
  });
  for (let i = nSlabDOF; i < nTotalDOF; i++) {
    if (Math.abs(diagSum[i]) < 1e-10) fixedDOFs.add(i);
  }

  const freeDOFs: number[] = [];
  for (let i = 0; i < nTotalDOF; i++) {
    if (!fixedDOFs.has(i)) freeDOFs.push(i);
  }
  const nFreeDOF = freeDOFs.length;

  // ── 8. Build local free-DOF index map: globalDOF → localFreeIndex ────────
  const localIdx = new Int32Array(nTotalDOF).fill(-1);
  for (let k = 0; k < nFreeDOF; k++) localIdx[freeDOFs[k]] = k;

  // ── 9. Build sparse K_ff directly from triplets (filter + renumber) ───────
  const tripFree = new TripletMatrix(nFreeDOF);
  const F_f      = new Float64Array(nFreeDOF);

  tripFull.forEachEntry((gi, gj, v) => {
    if (fixedDOFs.has(gi) || fixedDOFs.has(gj)) return;
    const li = localIdx[gi];
    const lj = localIdx[gj];
    if (li >= 0 && lj >= 0) tripFree.add(li, lj, v);
  });

  for (let k = 0; k < nFreeDOF; k++) {
    F_f[k] = F_full[freeDOFs[k]];
  }

  const K_ff_csr = tripFree.toCSR();

  console.log(
    `[Phase9/sparse] K_ff: ${nFreeDOF}×${nFreeDOF}  nnz=${K_ff_csr.nnz}  ` +
    `fill=${((K_ff_csr.nnz / (nFreeDOF * nFreeDOF)) * 100).toFixed(4)}%  ` +
    `mem≈${((K_ff_csr.nnz * 12 + (nFreeDOF + 1) * 4) / 1024).toFixed(1)} KB`,
  );

  return {
    K_ff_csr,
    F_f,
    freeDOFs,
    fixedDOFs,
    nTotalDOF,
    nFreeDOF,
    sharedNodeMap,
    nSlabDOF,
    F_full,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Also export a simple slab-only sparse assembler (for Phases 1-5 comparison)
// ─────────────────────────────────────────────────────────────────────────────

export interface SparseSlabAssemblyResult {
  K_ff_csr: CSRMatrix;
  F_f:      Float64Array;
  freeDOFs: number[];
  nDOF:     number;
}

/**
 * Assemble only the slab (Phase 1) system in sparse format.
 * Used for direct dense-vs-sparse comparison tests.
 */
export function sparseAssembleSlab(
  slab:      Slab,
  beams:     Beam[],
  columns:   Column[],
  slabProps: SlabProps,
  mat:       MatProps,
  q_Nmm2:  number,
  meshDensity = 4,
): SparseSlabAssemblyResult {
  const mesh  = meshSlab(slab, beams, columns, meshDensity);
  const nodes = mesh.nodes;
  const nDOF  = nodes.length * 3;
  const F_full = new Float64Array(nDOF);

  const tripFull = new TripletMatrix(nDOF);

  for (const elem of mesh.elements) {
    const gDOF = elemGlobalDOFs(elem.nodeIds);
    const ke   = elementStiffness(elem, nodes, slabProps, mat);
    const fe   = elementLoadVector(elem, nodes, q_Nmm2);
    for (let i = 0; i < 12; i++) {
      const gi = gDOF[i];
      F_full[gi] += fe[i];
      for (let j = 0; j < 12; j++) {
        tripFull.add(gi, gDOF[j], ke[i * 12 + j]);
      }
    }
  }

  // Fixed DOFs: all 3 DOFs at every fixed node
  const fixedSet = new Set<number>();
  for (let ni = 0; ni < nodes.length; ni++) {
    if (nodes[ni].isFixed) {
      fixedSet.add(ni * 3);
      fixedSet.add(ni * 3 + 1);
      fixedSet.add(ni * 3 + 2);
    }
  }

  const freeDOFs: number[] = [];
  for (let i = 0; i < nDOF; i++) {
    if (!fixedSet.has(i)) freeDOFs.push(i);
  }
  const nFree    = freeDOFs.length;
  const localIdx = new Int32Array(nDOF).fill(-1);
  for (let k = 0; k < nFree; k++) localIdx[freeDOFs[k]] = k;

  const tripFree = new TripletMatrix(nFree);
  const F_f      = new Float64Array(nFree);

  tripFull.forEachEntry((gi, gj, v) => {
    if (fixedSet.has(gi) || fixedSet.has(gj)) return;
    const li = localIdx[gi];
    const lj = localIdx[gj];
    if (li >= 0 && lj >= 0) tripFree.add(li, lj, v);
  });
  for (let k = 0; k < nFree; k++) F_f[k] = F_full[freeDOFs[k]];

  return { K_ff_csr: tripFree.toCSR(), F_f, freeDOFs, nDOF };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8 merged DOF index helper (copied from mergedDOFSystem for locality)
// ─────────────────────────────────────────────────────────────────────────────

function beamElemGlobalDOFs(
  siA: number, jA: number,
  siB: number, jB: number,
  nSlabDOF: number,
): number[] {
  const extraA = nSlabDOF + 3 * jA;
  const extraB = nSlabDOF + 3 * jB;
  return [
    extraA + 0,   // UX_A
    extraA + 1,   // UY_A
    3 * siA + 0,  // UZ_A (MERGED)
    3 * siA + 1,  // RX_A (MERGED)
    3 * siA + 2,  // RY_A (MERGED)
    extraA + 2,   // RZ_A
    extraB + 0,   // UX_B
    extraB + 1,   // UY_B
    3 * siB + 0,  // UZ_B (MERGED)
    3 * siB + 1,  // RX_B (MERGED)
    3 * siB + 2,  // RY_B (MERGED)
    extraB + 2,   // RZ_B
  ];
}
