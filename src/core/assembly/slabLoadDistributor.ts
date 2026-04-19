/**
 * Slab Load Distributor
 * ═══════════════════════════════════════════════════════════════
 * For slabs in LOAD_ONLY mode: converts slab area loads into
 * equivalent beam distributed loads and nodal forces.
 *
 * Uses slab-edge load transfer:
 * - Each rectangular slab generates linear loads on its 4 edges
 *   using the usual one-way / two-way tributary distribution.
 * - Any beam collinear with a slab edge receives the matching
 *   edge load over the overlapping length only.
 */

import { buildSlabEdgeLoads, computeBeamLoadProfile, computeLineProfileStats, type PlanarSlabGeometry } from '../../lib/slabLoadTransfer';
import type { StructuralModel } from '../model/types';

export interface DistributedBeamLoad {
  beamElementId: number;
  /** Load intensity at start and end of beam (kN/m for display, N/mm internally). */
  wStart: number; // N/mm
  wEnd: number;   // N/mm
}

export interface SlabLoadDistributionResult {
  beamLoads: DistributedBeamLoad[];
  /** Equivalent nodal forces to add to the global force vector. */
  nodalForces: Map<number, { fz: number }>; // nodeId → vertical force (N)
}

/**
 * Distribute slab loads to supporting beams for LOAD_ONLY slabs.
 * Converts slab area load → beam-edge line load → equivalent nodal forces.
 */
export function distributeSlabLoads(
  model: StructuralModel,
): SlabLoadDistributionResult {
  const nodeMap = new Map(model.nodes.map(n => [n.id, n]));
  const matMap = new Map(model.materials.map(m => [m.id, m]));
  const beamLoads: DistributedBeamLoad[] = [];
  const nodalForces = new Map<number, { fz: number }>();

  const addForce = (nodeId: number, fz: number) => {
    const existing = nodalForces.get(nodeId);
    if (existing) existing.fz += fz;
    else nodalForces.set(nodeId, { fz });
  };

  const loadOnlySlabs = model.elements.filter(
    e => e.type === 'slab' && e.slabProperties?.stiffnessMode === 'LOAD_ONLY',
  );
  const beams = model.elements.filter(e => e.type === 'beam' && e.nodeIds.length === 2);

  const slabRects: PlanarSlabGeometry[] = [];
  for (const slab of loadOnlySlabs) {
    if (slab.nodeIds.length !== 4) continue;
    const mat = matMap.get(slab.materialId);
    if (!mat || !slab.slabProperties) continue;

    const nodes = slab.nodeIds.map(id => nodeMap.get(id)).filter(Boolean);
    if (nodes.length !== 4) continue;

    const xs = nodes.map(node => node!.x);
    const ys = nodes.map(node => node!.y);
    const selfWeight = mat.gamma * slab.slabProperties.thickness; // N/mm²

    slabRects.push({
      id: `slab_${slab.id}`,
      x1: Math.min(...xs),
      y1: Math.min(...ys),
      x2: Math.max(...xs),
      y2: Math.max(...ys),
      deadLoad: selfWeight,
      liveLoad: 0,
    });
  }

  const slabEdgeLoads = buildSlabEdgeLoads(slabRects, 0, 0);

  for (const beam of beams) {
    const nodeI = nodeMap.get(beam.nodeIds[0]);
    const nodeJ = nodeMap.get(beam.nodeIds[1]);
    if (!nodeI || !nodeJ) continue;

    const beamLength = Math.sqrt((nodeJ.x - nodeI.x) ** 2 + (nodeJ.y - nodeI.y) ** 2);
    if (beamLength < 1e-9) continue;

    const slabTransfer = computeBeamLoadProfile({
      id: String(beam.id),
      x1: nodeI.x,
      y1: nodeI.y,
      x2: nodeJ.x,
      y2: nodeJ.y,
      length: beamLength,
    }, slabEdgeLoads);

    const stats = computeLineProfileStats(slabTransfer.profileDL);
    if (stats.area < 1e-9) continue;

    const totalForce = stats.area * beamLength;
    const forceI = -totalForce * (1 - stats.centroidT);
    const forceJ = -totalForce * stats.centroidT;

    addForce(nodeI.id, forceI);
    addForce(nodeJ.id, forceJ);

    beamLoads.push({
      beamElementId: beam.id,
      wStart: slabTransfer.profileDL[0]?.wy ?? 0,
      wEnd: slabTransfer.profileDL[slabTransfer.profileDL.length - 1]?.wy ?? 0,
    });
  }

  return { beamLoads, nodalForces };
}

/**
 * Apply distributed slab loads to the force vector.
 */
export function applySlabLoadsToForceVector(
  F: Float64Array,
  distribution: SlabLoadDistributionResult,
  dofMap: Map<number, number>,
): void {
  for (const [nodeId, forces] of distribution.nodalForces) {
    const base = dofMap.get(nodeId);
    if (base === undefined) continue;
    F[base + 2] += forces.fz; // uz DOF (vertical)
  }
}
