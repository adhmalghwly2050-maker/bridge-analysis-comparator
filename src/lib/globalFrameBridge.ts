/**
 * Global Frame Solver Bridge
 * ─────────────────────────────────────────────────────────────────
 * Converts the app's Beam/Column/Frame model into GFS types,
 * runs `solveGlobalFrame`, and maps results back to FrameResult[].
 *
 * This bridges the gap so the Global Frame engine and Unified Core
 * engine produce independent results instead of falling through
 * to the legacy 3D solver.
 */

import type { Beam, Column, Frame, FrameResult, MatProps, BeamOnBeamConnection, Slab, SlabProps } from '@/lib/structuralEngine';
import { calculateBeamLoads } from '@/lib/structuralEngine';
import {
  GlobalNodeRegistry,
  rectangularSection,
  solveGlobalFrame,
  type GFSElement,
  type GFSMaterial,
  type GFSNode,
  type GFSElementResult,
} from '@/lib/globalFrameSolver';
import {
  runPreAnalysisChecks,
  type ValidationNode,
  type ValidationElement,
} from '@/core/validation/preAnalysisValidator';

type EndReleaseMap = Record<string, {
  nodeI: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
  nodeJ: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
}>;

/**
 * Run the Global Frame Solver on the app model and return FrameResult[].
 */
export function getFrameResultsGlobalFrame(
  frames: Frame[],
  beams: Beam[],
  columns: Column[],
  mat: MatProps,
  frameEndReleases?: EndReleaseMap,
  beamOnBeamConnections?: BeamOnBeamConnection[],
  slabs?: Slab[],
  slabProps?: SlabProps,
  beamStiffnessFactor = 0.35,
  /** ACI 318-19 §6.6.3.1.1: 0.70·Ig للأعمدة (غير المتشققة)، يمكن تخفيضها إلى 0.35 عند تشقق كبير */
  colStiffnessFactor = 0.70,
): FrameResult[] {
  const beamsMap = new Map(beams.map(b => [b.id, b]));
  const E_MPa = 4700 * Math.sqrt(mat.fc) * 1000; // N/mm²
  const G_MPa = E_MPa / (2 * (1 + 0.2));
  const gfsMat: GFSMaterial = { E: E_MPa, G: G_MPa };

  const registry = new GlobalNodeRegistry(1.0); // 1mm tolerance
  const elements: GFSElement[] = [];

  // ─── Per-element D/L components for ACI envelope (matches 2D engine) ───
  // For each element we store: dead (kN/m, unfactored), live (kN/m, unfactored),
  // and a constant base load (e.g. column self-weight) that is always present
  // regardless of load pattern. Sign convention: negative = downward (global Z).
  const beamLoadComponents = new Map<string, { dead: number; live: number }>();
  const constantElementLoads = new Map<string, { wx: number; wy: number; wz: number }>();

  // Track which GFS element IDs correspond to which beam IDs
  const beamElemIdMap = new Map<string, string>(); // beamId → gfsElemId

  // ── Determine ground level ──────────────────────────────────────────
  let minZ = Infinity;
  for (const col of columns) {
    if (col.isRemoved) continue;
    const zBot = col.zBottom ?? 0;
    if (zBot < minZ) minZ = zBot;
  }

  // ── Build column elements ───────────────────────────────────────────
  const colTopNodeMap = new Map<string, string>(); // colId → GFS nodeId
  // Map column position (x,y in mm, rounded to 1mm) → column dimensions for rigid-offset lookup
  const colByPos = new Map<string, { b: number; h: number; id: string }>();
  const posKey = (x: number, y: number) => `${Math.round(x)}|${Math.round(y)}`;

  for (const col of columns) {
    if (col.isRemoved) continue;
    const zBot = col.zBottom ?? 0;
    const zTop = col.zTop ?? (zBot + col.L);
    const xMm = col.x * 1000;
    const yMm = col.y * 1000;

    const isGroundLevel = Math.abs(zBot - minZ) < 1;
    const isPinned = col.bottomEndCondition === 'P';
    const botRestraints: GFSNode['restraints'] = isGroundLevel
      ? (isPinned
        ? [true, true, true, false, false, false]
        : [true, true, true, true, true, true])
      : [false, false, false, false, false, false];

    const botNode = registry.getOrCreateNode(xMm, yMm, zBot, botRestraints);
    const topNode = registry.getOrCreateNode(xMm, yMm, zTop, [false, false, false, false, false, false]);

    colTopNodeMap.set(col.id, topNode.id);
    colByPos.set(posKey(xMm, yMm), { b: col.b, h: col.h, id: col.id });

    const sec = rectangularSection(col.b, col.h);
    const elemId = `col_${col.id}`;
    elements.push({
      id: elemId,
      nodeI: botNode.id,
      nodeJ: topNode.id,
      section: sec,
      material: gfsMat,
      stiffnessModifier: colStiffnessFactor,
      type: 'column',
    });

    // Column self-weight as distributed load (global Z, negative = downward)
    // This is a CONSTANT load (always present) — applied in every load pattern.
    const colSW = -1.2 * mat.gamma * (col.b * col.h) / 1e6; // kN/m, factored dead
    constantElementLoads.set(elemId, { wx: 0, wy: 0, wz: colSW });
  }

  // ── Build beam elements ─────────────────────────────────────────────
  // KEY FIX: Use beam coordinates directly to create/find nodes.
  // This ensures beams connect at the same nodes as columns (via coordinate
  // matching in the registry), and beam-on-beam connections share nodes
  // even when the intermediate column is removed.
  const processedBeams = new Set<string>();

  for (const frame of frames) {
    for (const beamId of frame.beamIds) {
      if (processedBeams.has(beamId)) continue;
      processedBeams.add(beamId);

      const beam = beamsMap.get(beamId);
      if (!beam) continue;

      // Use beam endpoint coordinates directly (in mm)
      const x1Mm = beam.x1 * 1000;
      const y1Mm = beam.y1 * 1000;
      const x2Mm = beam.x2 * 1000;
      const y2Mm = beam.y2 * 1000;
      const zMm = beam.z ?? 0; // beam Z is already in mm

      const isBoBSecondary = beamOnBeamConnections?.some(
        c => c.secondaryBeamIds.includes(beamId)
      );

      // getOrCreateNode will find existing column-top nodes at same coords
      // or create new ones. For non-BoB beams with no column, add pinned support.
      // First try to find existing node (created by columns) with no-restraint call
      const probeI = registry.getOrCreateNode(x1Mm, y1Mm, zMm, [false, false, false, false, false, false]);
      const probeJ = registry.getOrCreateNode(x2Mm, y2Mm, zMm, [false, false, false, false, false, false]);

      // If this is NOT a BoB secondary and no column created the node,
      // we need to check if it has any support. The registry merged it already.
      // For safety, if no column exists at this point and it's not BoB, 
      // the node should already have restraints from the column creation step.

      const nodeIId = probeI.id;
      const nodeJId = probeJ.id;

      const sec = rectangularSection(beam.b, beam.h);
      const elemId = `beam_${beamId}`;

      // End releases - use beam coordinates directly
      let releasesI: GFSElement['releasesI'];
      let releasesJ: GFSElement['releasesJ'];
      if (frameEndReleases) {
        const posKey = `${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}_${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}`;
        const posKeyRev = `${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}_${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}`;
        const rel = frameEndReleases[posKey] || frameEndReleases[posKeyRev];
        if (rel) {
          const isReversed = !!frameEndReleases[posKeyRev] && !frameEndReleases[posKey];
          const ni = isReversed ? rel.nodeJ : rel.nodeI;
          const nj = isReversed ? rel.nodeI : rel.nodeJ;
          releasesI = { Ux: ni.ux, Uy: ni.uy, Uz: ni.uz, Rx: ni.rx, Ry: ni.ry, Rz: ni.rz };
          releasesJ = { Ux: nj.ux, Uy: nj.uy, Uz: nj.uz, Rx: nj.rx, Ry: nj.ry, Rz: nj.rz };
        }
      }

      // ── Rigid End Offsets (ETABS-style) ──
      // Half-depth of the perpendicular column dimension at each beam end.
      // Beam direction → take column dimension perpendicular to beam axis.
      const dxBeam = beam.x2 - beam.x1;
      const dyBeam = beam.y2 - beam.y1;
      const lenBeam = Math.sqrt(dxBeam * dxBeam + dyBeam * dyBeam) || 1;
      const ux = dxBeam / lenBeam, uy = dyBeam / lenBeam;
      const colI = colByPos.get(posKey(x1Mm, y1Mm));
      const colJ = colByPos.get(posKey(x2Mm, y2Mm));
      const perpDepth = (c: { b: number; h: number }) => {
        // Column local axes assumed aligned with global X,Y. b is along X, h along Y.
        // Beam intersects the column through a chord; effective offset =
        // half projection of column rectangle onto beam axis.
        return 0.5 * (Math.abs(ux) * c.b + Math.abs(uy) * c.h);
      };
      const rigidOffsetI = colI ? perpDepth(colI) : 0; // mm
      const rigidOffsetJ = colJ ? perpDepth(colJ) : 0; // mm

      elements.push({
        id: elemId,
        nodeI: nodeIId,
        nodeJ: nodeJId,
        section: sec,
        material: gfsMat,
        stiffnessModifier: beamStiffnessFactor,
        type: 'beam',
        releasesI,
        releasesJ,
        rigidOffsetI,
        rigidOffsetJ,
      });

      // Beam loads: store unfactored D and L components for ACI pattern envelope
      const beamSW = (beam.b / 1000) * (beam.h / 1000) * mat.gamma;
      const wallLoad = beam.wallLoad ?? 0;
      const slabDL = beam.deadLoad ? (beam.deadLoad - beamSW - wallLoad) : 0;
      const totalDead = beamSW + wallLoad + Math.max(slabDL, 0); // kN/m, unfactored DL
      const totalLive = beam.liveLoad ?? 0;                       // kN/m, unfactored LL
      // Store components (positive magnitudes); pattern builder applies sign + factors
      beamLoadComponents.set(elemId, { dead: totalDead, live: totalLive });

      beamElemIdMap.set(beamId, elemId);
    }
  }

  // ── Split primary beams at BoB intersection points ───────────────
  // This is CRITICAL: without splitting, the secondary beam's node
  // sits on the primary beam's span but has no DOF coupling — so loads
  // from secondary beams never transfer to primary beams.
  const primarySplitMap = new Map<string, string[]>(); // beamId → [elemIdA, elemIdB]

  if (beamOnBeamConnections) {
    for (const conn of beamOnBeamConnections) {
      const primaryBeam = beamsMap.get(conn.primaryBeamId);
      if (!primaryBeam) continue;

      const primaryElemId = beamElemIdMap.get(conn.primaryBeamId);
      if (!primaryElemId) continue;

      // Find the primary element in our elements array
      const pIdx = elements.findIndex(e => e.id === primaryElemId);
      if (pIdx < 0) continue;
      const pElem = elements[pIdx];

      // Create or retrieve the split node at the BoB intersection point
      const xSplit = conn.point.x * 1000;
      const ySplit = conn.point.y * 1000;
      // Z = same as primary beam endpoints (horizontal beam)
      const pNodeI = registry.getNodeById(pElem.nodeI);
      const pNodeJ = registry.getNodeById(pElem.nodeJ);
      if (!pNodeI || !pNodeJ) continue;
      const zSplit = pNodeI.z; // beam is horizontal, same Z

      const splitNode = registry.getOrCreateNode(xSplit, ySplit, zSplit,
        [false, false, false, false, false, false]);

      // Check that split node is actually between I and J (not at endpoints)
      const dIJ = Math.sqrt((pNodeJ.x - pNodeI.x) ** 2 + (pNodeJ.y - pNodeI.y) ** 2 + (pNodeJ.z - pNodeI.z) ** 2);
      const dIS = Math.sqrt((splitNode.x - pNodeI.x) ** 2 + (splitNode.y - pNodeI.y) ** 2 + (splitNode.z - pNodeI.z) ** 2);
      const dSJ = Math.sqrt((pNodeJ.x - splitNode.x) ** 2 + (pNodeJ.y - splitNode.y) ** 2 + (pNodeJ.z - splitNode.z) ** 2);

      if (dIS < 1.0 || dSJ < 1.0) continue; // split point is at an endpoint, no split needed

      // Remove original element
      elements.splice(pIdx, 1);

      // Create two sub-elements: I→Split and Split→J
      const elemIdA = `${primaryElemId}_A`;
      const elemIdB = `${primaryElemId}_B`;

      elements.push({
        id: elemIdA,
        nodeI: pElem.nodeI,
        nodeJ: splitNode.id,
        section: pElem.section,
        material: pElem.material,
        stiffnessModifier: pElem.stiffnessModifier,
        type: pElem.type,
        releasesI: pElem.releasesI,
        // No release at split point — continuity
      });

      elements.push({
        id: elemIdB,
        nodeI: splitNode.id,
        nodeJ: pElem.nodeJ,
        section: pElem.section,
        material: pElem.material,
        stiffnessModifier: pElem.stiffnessModifier,
        type: pElem.type,
        // No release at split point — continuity
        releasesJ: pElem.releasesJ,
      });

      // Distribute load components proportionally to both segments (same w in kN/m)
      const origComp = beamLoadComponents.get(primaryElemId);
      if (origComp) {
        beamLoadComponents.delete(primaryElemId);
        beamLoadComponents.set(elemIdA, { ...origComp });
        beamLoadComponents.set(elemIdB, { ...origComp });
      }

      primarySplitMap.set(conn.primaryBeamId, [elemIdA, elemIdB]);
      beamElemIdMap.set(conn.primaryBeamId, elemIdA); // map to first segment for result retrieval

      // Also split continuation beam if present
      if (conn.continuationBeamId) {
        const contElemId = beamElemIdMap.get(conn.continuationBeamId);
        if (contElemId) {
          const cIdx = elements.findIndex(e => e.id === contElemId);
          if (cIdx >= 0) {
            const cElem = elements[cIdx];
            const cNodeI = registry.getNodeById(cElem.nodeI);
            const cNodeJ = registry.getNodeById(cElem.nodeJ);
            if (cNodeI && cNodeJ) {
              const dcIS = Math.sqrt((splitNode.x - cNodeI.x) ** 2 + (splitNode.y - cNodeI.y) ** 2 + (splitNode.z - cNodeI.z) ** 2);
              const dcSJ = Math.sqrt((cNodeJ.x - splitNode.x) ** 2 + (cNodeJ.y - splitNode.y) ** 2 + (cNodeJ.z - splitNode.z) ** 2);

              if (dcIS > 1.0 && dcSJ > 1.0) {
                elements.splice(cIdx, 1);
                const cElemIdA = `${contElemId}_A`;
                const cElemIdB = `${contElemId}_B`;

                elements.push({
                  id: cElemIdA, nodeI: cElem.nodeI, nodeJ: splitNode.id,
                  section: cElem.section, material: cElem.material,
                  stiffnessModifier: cElem.stiffnessModifier, type: cElem.type,
                  releasesI: cElem.releasesI,
                });
                elements.push({
                  id: cElemIdB, nodeI: splitNode.id, nodeJ: cElem.nodeJ,
                  section: cElem.section, material: cElem.material,
                  stiffnessModifier: cElem.stiffnessModifier, type: cElem.type,
                  releasesJ: cElem.releasesJ,
                });

                const cOrigComp = beamLoadComponents.get(contElemId);
                if (cOrigComp) {
                  beamLoadComponents.delete(contElemId);
                  beamLoadComponents.set(cElemIdA, { ...cOrigComp });
                  beamLoadComponents.set(cElemIdB, { ...cOrigComp });
                }

                primarySplitMap.set(conn.continuationBeamId, [cElemIdA, cElemIdB]);
                beamElemIdMap.set(conn.continuationBeamId, cElemIdA);
              }
            }
          }
        }
      }
    }

    // ── Now add secondary beam elements ──────────────────────────────
    for (const conn of beamOnBeamConnections) {
      for (const secBeamId of conn.secondaryBeamIds) {
        if (processedBeams.has(secBeamId)) continue;
        processedBeams.add(secBeamId);

        const beam = beamsMap.get(secBeamId);
        if (!beam) continue;

        const fromCol = columns.find(c => c.id === beam.fromCol);
        const toCol = columns.find(c => c.id === beam.toCol);
        if (!fromCol || !toCol) continue;

        const xFrom = fromCol.x * 1000, yFrom = fromCol.y * 1000;
        const xTo = toCol.x * 1000, yTo = toCol.y * 1000;
        const zFrom = fromCol.zTop ?? ((fromCol.zBottom ?? 0) + fromCol.L);
        const zTo = toCol.zTop ?? ((toCol.zBottom ?? 0) + toCol.L);

        const nodeI = registry.getOrCreateNode(xFrom, yFrom, zFrom,
          [false, false, false, false, false, false]);
        const nodeJ = registry.getOrCreateNode(xTo, yTo, zTo,
          [false, false, false, false, false, false]);

        const sec = rectangularSection(beam.b, beam.h);
        const elemId = `beam_${secBeamId}`;

        // Secondary beam has moment release at removed column end
        let relI: GFSElement['releasesI'];
        let relJ: GFSElement['releasesJ'];
        if (fromCol.isRemoved) {
          relI = { Rz: true, Ry: true };
        }
        if (toCol.isRemoved) {
          relJ = { Rz: true, Ry: true };
        }

        elements.push({
          id: elemId,
          nodeI: nodeI.id,
          nodeJ: nodeJ.id,
          section: sec,
          material: gfsMat,
          stiffnessModifier: beamStiffnessFactor,
          type: 'beam',
          releasesI: relI,
          releasesJ: relJ,
        });

        const beamSW = (beam.b / 1000) * (beam.h / 1000) * mat.gamma;
        const wallLoad = beam.wallLoad ?? 0;
        const slabDL = beam.deadLoad ? (beam.deadLoad - beamSW - wallLoad) : 0;
        const totalDead = beamSW + wallLoad + Math.max(slabDL, 0);
        const totalLive = beam.liveLoad ?? 0;
        // Store unfactored components for ACI envelope (matches 2D engine)
        beamLoadComponents.set(elemId, { dead: totalDead, live: totalLive });

        beamElemIdMap.set(secBeamId, elemId);
      }
    }
  }

  // ── Pre-Analysis Validation ──────────────────────────────────────────
  const allNodes = registry.getAllNodes();
  const validationNodes: ValidationNode[] = allNodes.map(n => ({
    id: n.id, x: n.x, y: n.y, z: n.z,
    restraints: [...n.restraints] as [boolean, boolean, boolean, boolean, boolean, boolean],
  }));
  const validationElements: ValidationElement[] = elements.map(e => ({
    id: e.id, nodeI: e.nodeI, nodeJ: e.nodeJ, type: e.type,
  }));
  const validated = runPreAnalysisChecks(validationNodes, validationElements);
  
  // Log validation report for debugging
  if (validated.report.status !== 'ok') {
    console.warn('[GFS Pre-Analysis Validation]', validated.report.status, validated.report.issues);
  }
  
  // If nodes were merged, update element references
  if (validated.report.mergedNodeMap.size > 0) {
    for (const el of elements) {
      const newI = validated.report.mergedNodeMap.get(el.nodeI);
      const newJ = validated.report.mergedNodeMap.get(el.nodeJ);
      if (newI) el.nodeI = newI;
      if (newJ) el.nodeJ = newJ;
    }
  }

  // ── Build ACI envelope load patterns ────────────────────────────────
  // Mirror the 2D engine (structuralEngine.ts ~line 1031): we generate the
  // same set of factored UDL patterns and run the GF solver once per pattern,
  // then take the envelope (most-critical Mleft/Mmid/Mright/V) at each beam.
  // This eliminates the systematic under-prediction of mid-span moments
  // caused by running only one combo (1.2D+1.6L), and makes GF results
  // directly comparable to ETABS pattern-loading envelope.
  const beamElemIds = Array.from(beamLoadComponents.keys());
  const nBeams = beamElemIds.length;
  const wMax = beamElemIds.map(id => {
    const c = beamLoadComponents.get(id)!;
    return -(1.2 * c.dead + 1.6 * c.live);
  });
  const wMin = beamElemIds.map(id => {
    const c = beamLoadComponents.get(id)!;
    return -(1.2 * c.dead);
  });
  const w14D = beamElemIds.map(id => {
    const c = beamLoadComponents.get(id)!;
    return -(1.4 * c.dead);
  });

  // Pattern list: full-load, all-dead, min-dead, alternating odd, alternating even
  const loadPatterns: number[][] = [wMax, w14D, wMin];
  if (nBeams >= 2) {
    loadPatterns.push(beamElemIds.map((_, i) => i % 2 === 0 ? wMax[i] : wMin[i]));
    loadPatterns.push(beamElemIds.map((_, i) => i % 2 === 1 ? wMax[i] : wMin[i]));
  }
  // Bit-mask patterns (capped) — same logic as 2D engine, max 8 beams to avoid explosion
  const nPatterns = Math.min(nBeams, 8);
  if (nPatterns >= 2) {
    const totalMasks = Math.pow(2, nPatterns);
    for (let mask = 1; mask < totalMasks - 1; mask++) {
      loadPatterns.push(beamElemIds.map((_, i) => {
        const bitIdx = i < nPatterns ? i : i % nPatterns;
        return ((mask >> bitIdx) & 1) ? wMax[i] : wMin[i];
      }));
    }
  }

  // ── Solve once per pattern and envelope the element results ─────────
  const nodes = registry.getAllNodes();
  const elemResultMap = new Map<string, GFSElementResult>();

  // Helper: pick the value with larger |abs| (signed envelope)
  const enve = (a: number, b: number) => Math.abs(a) >= Math.abs(b) ? a : b;

  for (let p = 0; p < loadPatterns.length; p++) {
    const pattern = loadPatterns[p];
    const patternLoads = new Map<string, { wx: number; wy: number; wz: number }>();
    // Constant loads (column SW etc.) always present
    for (const [eid, ld] of constantElementLoads) patternLoads.set(eid, { ...ld });
    // Beam loads from this pattern
    for (let i = 0; i < beamElemIds.length; i++) {
      patternLoads.set(beamElemIds[i], { wx: 0, wy: 0, wz: pattern[i] });
    }

    const patternResult = solveGlobalFrame(nodes, elements, { elementLoads: patternLoads });

    for (const er of patternResult.elementResults) {
      const prev = elemResultMap.get(er.elementId);
      if (!prev) {
        // Clone so we don't mutate solver internals
        elemResultMap.set(er.elementId, {
          ...er,
          forceI: [...er.forceI] as GFSElementResult['forceI'],
          forceJ: [...er.forceJ] as GFSElementResult['forceJ'],
        });
      } else {
        prev.momentZI  = enve(prev.momentZI,  er.momentZI);
        prev.momentZJ  = enve(prev.momentZJ,  er.momentZJ);
        prev.momentZmid = enve(prev.momentZmid, er.momentZmid);
        prev.momentYI  = enve(prev.momentYI,  er.momentYI);
        prev.momentYJ  = enve(prev.momentYJ,  er.momentYJ);
        prev.shearY    = enve(prev.shearY,    er.shearY);
        prev.shearZ    = enve(prev.shearZ,    er.shearZ);
        prev.axial     = enve(prev.axial,     er.axial);
        prev.torsion   = enve(prev.torsion,   er.torsion);
        for (let k = 0; k < 6; k++) {
          prev.forceI[k] = enve(prev.forceI[k], er.forceI[k]);
          prev.forceJ[k] = enve(prev.forceJ[k], er.forceJ[k]);
        }
      }
    }
  }

  // Build beam release lookup for zeroing released-end moments
  const beamReleaseLookup = new Map<string, { relI_mz: boolean; relJ_mz: boolean }>();
  if (frameEndReleases) {
    for (const beam of beams) {
      const fromCol = columns.find(c => c.id === beam.fromCol);
      const toCol = columns.find(c => c.id === beam.toCol);
      if (!fromCol || !toCol) continue;
      const posKey = `${fromCol.x.toFixed(3)}_${fromCol.y.toFixed(3)}_${toCol.x.toFixed(3)}_${toCol.y.toFixed(3)}`;
      const posKeyRev = `${toCol.x.toFixed(3)}_${toCol.y.toFixed(3)}_${fromCol.x.toFixed(3)}_${fromCol.y.toFixed(3)}`;
      const rel = frameEndReleases[posKey] || frameEndReleases[posKeyRev];
      if (!rel) continue;
      const isReversed = !!frameEndReleases[posKeyRev] && !frameEndReleases[posKey];
      const ni = isReversed ? rel.nodeJ : rel.nodeI;
      const nj = isReversed ? rel.nodeI : rel.nodeJ;
      beamReleaseLookup.set(beam.id, { relI_mz: ni.rz, relJ_mz: nj.rz });
    }
  }

  return frames.map((frame): FrameResult => {
    const frameBeams: FrameResult['beams'] = [];

    for (const beamId of frame.beamIds) {
      const beam = beamsMap.get(beamId);
      if (!beam) continue;

      // Check if this beam was split into two segments
      const splitIds = primarySplitMap.get(beamId);

      let er: GFSElementResult | undefined;
      let erA: GFSElementResult | undefined;
      let erB: GFSElementResult | undefined;

      if (splitIds) {
        erA = elemResultMap.get(splitIds[0]);
        erB = elemResultMap.get(splitIds[1]);
        // Use segment A as primary result for Mleft
        er = erA;
      } else {
        const elemId = beamElemIdMap.get(beamId);
        er = elemId ? elemResultMap.get(elemId) : undefined;
      }

      if (!er) {
        const fromCol = columns.find(c => c.id === beam.fromCol);
        const toCol = columns.find(c => c.id === beam.toCol);
        const isHoriz = beam.direction === 'horizontal';
        const halfColLeft = fromCol ? (isHoriz ? fromCol.b : fromCol.h) / 2000 : 0;
        const halfColRight = toCol ? (isHoriz ? toCol.b : toCol.h) / 2000 : 0;
        const clearSpan = Math.max(beam.length - halfColLeft - halfColRight, beam.length * 0.8);
        frameBeams.push({
          beamId, span: clearSpan,
          Mleft: 0, Mmid: 0, Mright: 0, Vu: 0, Rleft: 0, Rright: 0,
        });
        continue;
      }

      // For split beams: Mleft from segment A's I-end, Mright from segment B's J-end
      // Mmid = max sagging from both segments, Vu = max shear from both
      let Mleft: number;
      let Mright: number;
      let Mmid: number;
      let Vu: number;
      let Rleft: number;
      let Rright: number;

      if (splitIds && erA && erB) {
        Mleft = erA.momentZI;
        Mright = erB.momentZJ;
        // Mid-span moment: take the most critical sagging from both segments
        Mmid = Math.abs(erA.momentZmid) > Math.abs(erB.momentZmid)
          ? erA.momentZmid : erB.momentZmid;
        Vu = Math.max(Math.abs(erA.shearY), Math.abs(erB.shearY));
        Vu = Math.abs(erA.shearY) > Math.abs(erB.shearY) ? erA.shearY : erB.shearY;
        Rleft = Math.abs(erA.forceI[2]);
        Rright = Math.abs(erB.forceJ[2]);
      } else {
        Mleft = er.momentZI;
        Mright = er.momentZJ;
        Mmid = er.momentZmid;
        Vu = er.shearY;
        Rleft = Math.abs(er.forceI[2]);
        Rright = Math.abs(er.forceJ[2]);
      }

      // Enforce zero at released ends
      const rel = beamReleaseLookup.get(beamId);
      if (rel) {
        if (rel.relI_mz) Mleft = 0;
        if (rel.relJ_mz) Mright = 0;
      }

      // Compute clear span
      const fromColB = columns.find(c => c.id === beam.fromCol);
      const toColB = columns.find(c => c.id === beam.toCol);
      const isHorizB = beam.direction === 'horizontal';
      const halfColLeftB = fromColB ? (isHorizB ? fromColB.b : fromColB.h) / 2000 : 0;
      const halfColRightB = toColB ? (isHorizB ? toColB.b : toColB.h) / 2000 : 0;
      const clearSpanB = Math.max(beam.length - halfColLeftB - halfColRightB, beam.length * 0.8);

      frameBeams.push({
        beamId,
        span: clearSpanB,
        Mleft,
        Mmid,
        Mright,
        Vu,
        Rleft,
        Rright,
      });
    }

    return { frameId: frame.id, beams: frameBeams };
  });
}

/**
 * Unified Core bridge.
 * ───────────────────────────────────────────────────────────────────
 * The Unified Core engine uses the same point-based beam definition
 * approach as the Global Frame Solver: every beam endpoint is mapped
 * to a global node by its (x, y, z) coordinates via the registry,
 * so beams attach to columns purely through coordinate matching
 * (same convention as ETABS).
 *
 * The mathematical pipeline is identical to GFS today; this thin
 * wrapper is the canonical entry-point so that any future Unified
 * Core specific behaviour can be layered here without affecting GFS.
 */
export function getFrameResultsUnifiedCore(
  frames: Frame[],
  beams: Beam[],
  columns: Column[],
  mat: MatProps,
  frameEndReleases?: EndReleaseMap,
  beamOnBeamConnections?: BeamOnBeamConnection[],
  slabs?: Slab[],
  slabProps?: SlabProps,
  beamStiffnessFactor = 0.35,
  /** ACI 318-19 §6.6.3.1.1: 0.70·Ig للأعمدة */
  colStiffnessFactor = 0.70,
): FrameResult[] {
  return getFrameResultsGlobalFrame(
    frames, beams, columns, mat,
    frameEndReleases, beamOnBeamConnections,
    slabs, slabProps,
    beamStiffnessFactor, colStiffnessFactor,
  );
}
