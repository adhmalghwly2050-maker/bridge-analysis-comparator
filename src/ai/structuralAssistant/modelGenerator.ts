// ===================== STRUCTURAL MODEL GENERATOR =====================
// Generates structural model from plan analysis results

import { PlanAnalysisResult, GeneratedModel } from './types';
import { Slab } from '@/lib/structuralEngine';

/**
 * Convert plan analysis results into a structural model
 * compatible with the existing ModelManager system
 */
export function generateModelFromAnalysis(
  analysis: PlanAnalysisResult
): GeneratedModel {
  const slabs: Slab[] = [];
  const columnPositions: { x: number; y: number }[] = [];

  // Generate slabs from detected rooms
  for (const room of analysis.rooms) {
    slabs.push({
      id: `S${slabs.length + 1}`,
      x1: room.x1,
      y1: room.y1,
      x2: room.x2,
      y2: room.y2,
    });
  }

  // Get column positions from detected columns or grid intersections
  if (analysis.columns.length > 0) {
    for (const col of analysis.columns) {
      columnPositions.push({ x: col.x, y: col.y });
    }
  } else {
    // Place columns at grid intersections
    const vGrids = analysis.grids
      .filter(g => g.direction === 'vertical')
      .sort((a, b) => a.position - b.position);
    const hGrids = analysis.grids
      .filter(g => g.direction === 'horizontal')
      .sort((a, b) => a.position - b.position);

    for (const vg of vGrids) {
      for (const hg of hGrids) {
        if (!columnPositions.some(p =>
          Math.abs(p.x - vg.position) < 0.1 && Math.abs(p.y - hg.position) < 0.1
        )) {
          columnPositions.push({ x: vg.position, y: hg.position });
        }
      }
    }
  }

  // Calculate grid spacings
  const vPositions = [...new Set(
    analysis.grids
      .filter(g => g.direction === 'vertical')
      .map(g => g.position)
  )].sort((a, b) => a - b);

  const hPositions = [...new Set(
    analysis.grids
      .filter(g => g.direction === 'horizontal')
      .map(g => g.position)
  )].sort((a, b) => a - b);

  const gridSpacingX = vPositions.slice(1).map((pos, i) => pos - vPositions[i]);
  const gridSpacingY = hPositions.slice(1).map((pos, i) => pos - hPositions[i]);

  return {
    slabs,
    columnPositions,
    gridSpacingX,
    gridSpacingY,
  };
}

/**
 * Apply adjustments from user validation to the generated model
 */
export function applyModelAdjustments(
  model: GeneratedModel,
  adjustments: {
    removedSlabs?: string[];
    movedColumns?: { index: number; x: number; y: number }[];
    addedSlabs?: { x1: number; y1: number; x2: number; y2: number }[];
    removedColumns?: number[];
  }
): GeneratedModel {
  let slabs = [...model.slabs];
  let columnPositions = [...model.columnPositions];

  if (adjustments.removedSlabs) {
    slabs = slabs.filter(s => !adjustments.removedSlabs!.includes(s.id));
  }

  if (adjustments.addedSlabs) {
    for (const slab of adjustments.addedSlabs) {
      slabs.push({
        id: `S${slabs.length + 1}`,
        ...slab,
      });
    }
  }

  if (adjustments.removedColumns) {
    columnPositions = columnPositions.filter((_, i) => !adjustments.removedColumns!.includes(i));
  }

  if (adjustments.movedColumns) {
    for (const adj of adjustments.movedColumns) {
      if (adj.index < columnPositions.length) {
        columnPositions[adj.index] = { x: adj.x, y: adj.y };
      }
    }
  }

  return {
    ...model,
    slabs,
    columnPositions,
  };
}
