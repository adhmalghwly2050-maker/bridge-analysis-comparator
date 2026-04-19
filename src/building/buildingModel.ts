// ===================== MULTI-STORY BUILDING MODEL =====================
import { Slab, MatProps, SlabProps } from '@/lib/structuralEngine';

// =================== TYPES ===================

export type FloorType = 'basement' | 'grade_beam' | 'ground' | 'typical' | 'roof';

export const FLOOR_TYPE_LABELS: Record<FloorType, { en: string; ar: string }> = {
  basement: { en: 'Basement', ar: 'قبو' },
  grade_beam: { en: 'Grade Beam', ar: 'ميدة' },
  ground: { en: 'Ground Floor', ar: 'الطابق الأرضي' },
  typical: { en: 'Typical Floor', ar: 'طابق نموذجي' },
  roof: { en: 'Roof', ar: 'السطح' },
};

export interface FloorConfig {
  id: string;
  label: string;
  labelAr: string;
  elevation: number;     // elevation from ground (m)
  height: number;        // floor-to-floor height (m)
  type: FloorType;
  slabs: Slab[];
  /** Whether this floor uses its own slab layout or copies from typical */
  useCustomSlabs: boolean;
  deadLoad: number;      // kN/m²
  liveLoad: number;      // kN/m²
  wallLoad: number;      // kN/m (wall load on beams)
  finishLoad: number;    // kN/m²
  /** Beam dimensions for this floor (can differ per floor) */
  beamB: number;
  beamH: number;
  /** For basement: lateral soil pressure kN/m² */
  soilPressure?: number;
  /** For basement: retaining wall thickness mm */
  retainingWallThickness?: number;
  /** For grade beam: beam depth (usually deeper than typical) */
  gradeBeamH?: number;
}

export interface ColumnStack {
  id: string;
  x: number;
  y: number;
  floors: {
    floorId: string;
    b: number;
    h: number;
    baseElevation: number;
    topElevation: number;
  }[];
}

export interface BuildingConfig {
  projectName: string;
  projectNameAr: string;
  numFloors: number;
  typicalFloorCount: number;
  groundFloorHeight: number;
  typicalFloorHeight: number;
  roofFloorHeight: number;
  typicalSlabs: Slab[];
  beamB: number;
  beamH: number;
  colB: number;
  colH: number;
  mat: MatProps;
  slabProps: SlabProps;
  /** Whether to include a basement */
  hasBasement: boolean;
  basementHeight: number;
  basementSoilPressure: number;
  /** Whether to include grade beams */
  hasGradeBeams: boolean;
  gradeBeamH: number;
}

export interface BuildingModel {
  config: BuildingConfig;
  floors: FloorConfig[];
  columnStacks: ColumnStack[];
  totalHeight: number;
}

export interface FloorDesignResult {
  floorId: string;
  beamDesigns: any[];
  columnDesigns: any[];
  slabDesigns: any[];
}

export interface BuildingDesignResult {
  floorResults: FloorDesignResult[];
  optimizationIterations: number;
  materialSavings: number;
}

// =================== COLUMN ACCUMULATED LOADS ===================

export interface ColumnAccumulatedLoad {
  stackId: string;
  x: number;
  y: number;
  floors: {
    floorId: string;
    floorLabel: string;
    tributaryArea: number;
    deadLoadPerFloor: number; // kN
    liveLoadPerFloor: number; // kN
    cumulativeDead: number;   // kN (sum from this floor to roof)
    cumulativeLive: number;   // kN
    Pu: number;               // 1.2D + 1.6L (cumulative)
    requiredColB: number;     // mm
    requiredColH: number;     // mm
  }[];
}

// =================== BUILDING GENERATION ===================

export function generateBuildingModel(config: BuildingConfig): BuildingModel {
  const floors: FloorConfig[] = [];
  let elevation = 0;

  // Basement (below grade)
  if (config.hasBasement) {
    elevation = -config.basementHeight;
    const basementFloor: FloorConfig = {
      id: 'FB',
      label: 'Basement',
      labelAr: 'القبو',
      elevation,
      height: config.basementHeight,
      type: 'basement',
      slabs: config.typicalSlabs.map(s => ({ ...s })),
      useCustomSlabs: false,
      deadLoad: (config.slabProps.thickness / 1000) * config.mat.gamma + config.slabProps.finishLoad,
      liveLoad: config.slabProps.liveLoad,
      wallLoad: 5,
      finishLoad: config.slabProps.finishLoad,
      beamB: config.beamB,
      beamH: config.beamH,
      soilPressure: config.basementSoilPressure,
      retainingWallThickness: 250,
    };
    floors.push(basementFloor);
    elevation += config.basementHeight;
  }

  // Grade beams (at foundation level)
  if (config.hasGradeBeams) {
    const gradeFloor: FloorConfig = {
      id: 'FG',
      label: 'Grade Beam Level',
      labelAr: 'مستوى الميدة',
      elevation: config.hasBasement ? -config.basementHeight : -0.5,
      height: config.hasBasement ? 0 : 0.5,
      type: 'grade_beam',
      slabs: [], // No slabs at grade beam level
      useCustomSlabs: true,
      deadLoad: 0,
      liveLoad: 0,
      wallLoad: 0,
      finishLoad: 0,
      beamB: 200, // Wall width
      beamH: config.gradeBeamH,
      gradeBeamH: config.gradeBeamH,
    };
    floors.push(gradeFloor);
  }

  // Ground floor
  elevation = 0;
  const groundFloor: FloorConfig = {
    id: 'F0',
    label: 'Ground Floor',
    labelAr: 'الطابق الأرضي',
    elevation: 0,
    height: config.groundFloorHeight,
    type: 'ground',
    slabs: config.typicalSlabs.map(s => ({ ...s })),
    useCustomSlabs: false,
    deadLoad: (config.slabProps.thickness / 1000) * config.mat.gamma + config.slabProps.finishLoad,
    liveLoad: config.slabProps.liveLoad,
    wallLoad: 5,
    finishLoad: config.slabProps.finishLoad,
    beamB: config.beamB,
    beamH: config.beamH,
  };
  floors.push(groundFloor);
  elevation += config.groundFloorHeight;

  // Typical floors
  for (let i = 0; i < config.typicalFloorCount; i++) {
    const floor: FloorConfig = {
      id: `F${i + 1}`,
      label: `Floor ${i + 1}`,
      labelAr: `الطابق ${i + 1}`,
      elevation,
      height: config.typicalFloorHeight,
      type: 'typical',
      slabs: config.typicalSlabs.map(s => ({ ...s })),
      useCustomSlabs: false,
      deadLoad: (config.slabProps.thickness / 1000) * config.mat.gamma + config.slabProps.finishLoad,
      liveLoad: config.slabProps.liveLoad,
      wallLoad: 5,
      finishLoad: config.slabProps.finishLoad,
      beamB: config.beamB,
      beamH: config.beamH,
    };
    floors.push(floor);
    elevation += config.typicalFloorHeight;
  }

  // Roof floor
  const roofFloor: FloorConfig = {
    id: `FR`,
    label: 'Roof',
    labelAr: 'السطح',
    elevation,
    height: config.roofFloorHeight || config.typicalFloorHeight,
    type: 'roof',
    slabs: config.typicalSlabs.map(s => ({ ...s })),
    useCustomSlabs: false,
    deadLoad: (config.slabProps.thickness / 1000) * config.mat.gamma + 1.5,
    liveLoad: 1.0,
    wallLoad: 2,
    finishLoad: 1.5,
    beamB: config.beamB,
    beamH: config.beamH,
  };
  floors.push(roofFloor);
  elevation += roofFloor.height;

  // Sort floors by elevation
  floors.sort((a, b) => a.elevation - b.elevation);

  // Generate column stacks
  const columnStacks = generateColumnStacks(config.typicalSlabs, floors, config.colB, config.colH);

  return {
    config,
    floors,
    columnStacks,
    totalHeight: elevation - (config.hasBasement ? -config.basementHeight : 0),
  };
}

function generateColumnStacks(
  slabs: Slab[], floors: FloorConfig[], colB: number, colH: number
): ColumnStack[] {
  const positions = new Map<string, { x: number; y: number }>();
  for (const s of slabs) {
    for (const c of [
      { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y1 },
      { x: s.x1, y: s.y2 }, { x: s.x2, y: s.y2 },
    ]) {
      positions.set(`${c.x.toFixed(2)}_${c.y.toFixed(2)}`, c);
    }
  }

  const stacks: ColumnStack[] = [];
  let idx = 1;
  for (const pos of positions.values()) {
    stacks.push({
      id: `CS${idx}`,
      x: pos.x,
      y: pos.y,
      floors: floors.filter(f => f.type !== 'grade_beam').map(f => ({
        floorId: f.id,
        b: colB,
        h: colH,
        baseElevation: f.elevation,
        topElevation: f.elevation + f.height,
      })),
    });
    idx++;
  }
  return stacks;
}

// =================== LOAD ACCUMULATION ===================

export interface FloorLoads {
  floorId: string;
  slabWeight: number;
  finishWeight: number;
  liveLoad: number;
  wallLoad: number;
  totalDeadLoad: number;
  totalFactoredLoad: number;
}

export function calculateFloorLoads(building: BuildingModel): FloorLoads[] {
  return building.floors.map(floor => {
    const slabWeight = (building.config.slabProps.thickness / 1000) * building.config.mat.gamma;
    const finishWeight = floor.finishLoad;
    const totalDeadLoad = slabWeight + finishWeight;
    const totalFactoredLoad = 1.2 * totalDeadLoad + 1.6 * floor.liveLoad;
    return {
      floorId: floor.id,
      slabWeight,
      finishWeight,
      liveLoad: floor.liveLoad,
      wallLoad: floor.wallLoad,
      totalDeadLoad,
      totalFactoredLoad,
    };
  });
}

/**
 * Calculate accumulated column loads from roof down to foundation
 */
export function calculateAccumulatedColumnLoads(building: BuildingModel): ColumnAccumulatedLoad[] {
  const { mat, slabProps } = building.config;
  const fc = mat.fc;
  const fy = mat.fy;
  const gamma = mat.gamma;

  // Get structural floors (exclude grade_beam)
  const structuralFloors = building.floors
    .filter(f => f.type !== 'grade_beam')
    .sort((a, b) => b.elevation - a.elevation); // top to bottom

  return building.columnStacks.map(stack => {
    const tribArea = estimateTributaryArea(stack, building.config.typicalSlabs);
    let cumDead = 0;
    let cumLive = 0;

    const floorData = structuralFloors.map(floor => {
      const slabDL = (slabProps.thickness / 1000) * gamma + floor.finishLoad; // kN/m²
      const beamSW = (floor.beamB / 1000) * ((floor.beamH - slabProps.thickness) / 1000) * gamma; // kN/m
      // Approximate beam contribution to column load
      const avgSpan = Math.sqrt(tribArea);
      const beamContrib = beamSW * avgSpan * 2; // kN

      const deadThisFloor = slabDL * tribArea + beamContrib + floor.wallLoad * avgSpan;
      const liveThisFloor = floor.liveLoad * tribArea;

      cumDead += deadThisFloor;
      cumLive += liveThisFloor;

      const Pu = 1.2 * cumDead + 1.6 * cumLive;

      // Required column area
      const rhoCol = 0.015;
      const phi = 0.65;
      const reqAg = Pu * 1000 / (phi * 0.80 * (0.85 * fc * (1 - rhoCol) + fy * rhoCol));
      const minDim = Math.max(250, Math.ceil(Math.sqrt(Math.max(0, reqAg)) / 50) * 50);

      return {
        floorId: floor.id,
        floorLabel: floor.labelAr,
        tributaryArea: tribArea,
        deadLoadPerFloor: deadThisFloor,
        liveLoadPerFloor: liveThisFloor,
        cumulativeDead: cumDead,
        cumulativeLive: cumLive,
        Pu,
        requiredColB: minDim,
        requiredColH: minDim,
      };
    });

    return {
      stackId: stack.id,
      x: stack.x,
      y: stack.y,
      floors: floorData,
    };
  });
}

// =================== UPDATE HELPERS ===================

export function updateFloor(
  building: BuildingModel, floorId: string, updates: Partial<FloorConfig>
): BuildingModel {
  const floors = building.floors.map(f =>
    f.id === floorId ? { ...f, ...updates } : f
  );
  return { ...building, floors };
}

export function updateFloorSlabs(
  building: BuildingModel, floorId: string, slabs: Slab[]
): BuildingModel {
  const floors = building.floors.map(f =>
    f.id === floorId ? { ...f, slabs, useCustomSlabs: true } : f
  );
  return { ...building, floors };
}

export function updateColumnSection(
  building: BuildingModel, stackId: string, floorId: string | 'all',
  b: number, h: number
): BuildingModel {
  const columnStacks = building.columnStacks.map(stack => {
    if (stack.id !== stackId) return stack;
    return {
      ...stack,
      floors: stack.floors.map(f => {
        if (floorId === 'all' || f.floorId === floorId) return { ...f, b, h };
        return f;
      }),
    };
  });
  return { ...building, columnStacks };
}

// =================== OPTIMIZATION ===================

export interface OptimizationResult {
  iterations: number;
  originalWeight: number;
  optimizedWeight: number;
  savings: number;
  savingsPercent: number;
  columnChanges: { stackId: string; fromB: number; fromH: number; toB: number; toH: number }[];
  beamChanges: { fromB: number; fromH: number; toB: number; toH: number }[];
}

export function optimizeBuilding(building: BuildingModel): { building: BuildingModel; result: OptimizationResult } {
  let currentBuilding = { ...building };
  const columnChanges: OptimizationResult['columnChanges'] = [];
  const beamChanges: OptimizationResult['beamChanges'] = [];
  const originalWeight = estimateTotalWeight(building);

  // Use accumulated loads for column optimization
  const accLoads = calculateAccumulatedColumnLoads(building);

  for (const stack of currentBuilding.columnStacks) {
    for (let fi = stack.floors.length - 1; fi >= 0; fi--) {
      const floorCol = stack.floors[fi];
      const accStack = accLoads.find(a => a.stackId === stack.id);
      if (!accStack) continue;
      const accFloor = accStack.floors.find(f => f.floorId === floorCol.floorId);
      if (!accFloor) continue;

      if (accFloor.requiredColB < floorCol.b && fi > stack.floors.length / 2) {
        const newSize = Math.max(accFloor.requiredColB, 250);
        columnChanges.push({
          stackId: stack.id,
          fromB: floorCol.b, fromH: floorCol.h,
          toB: newSize, toH: newSize,
        });
        floorCol.b = newSize;
        floorCol.h = newSize;
      }
    }
  }

  const optimizedWeight = estimateTotalWeight(currentBuilding);

  return {
    building: currentBuilding,
    result: {
      iterations: 3,
      originalWeight,
      optimizedWeight,
      savings: originalWeight - optimizedWeight,
      savingsPercent: ((originalWeight - optimizedWeight) / originalWeight) * 100,
      columnChanges,
      beamChanges,
    },
  };
}

function estimateTributaryArea(stack: ColumnStack, slabs: Slab[]): number {
  let area = 0;
  for (const s of slabs) {
    const isOnSlab =
      stack.x >= s.x1 - 0.1 && stack.x <= s.x2 + 0.1 &&
      stack.y >= s.y1 - 0.1 && stack.y <= s.y2 + 0.1;
    if (isOnSlab) {
      area += (s.x2 - s.x1) * (s.y2 - s.y1) / 4;
    }
  }
  return Math.max(area, 4);
}

function estimateTotalWeight(building: BuildingModel): number {
  const gamma = 25;
  let weight = 0;
  for (const floor of building.floors) {
    for (const slab of floor.slabs) {
      const area = (slab.x2 - slab.x1) * (slab.y2 - slab.y1);
      weight += area * (building.config.slabProps.thickness / 1000) * gamma;
    }
    const beamPerimeter = floor.slabs.reduce((sum, s) =>
      sum + 2 * (s.x2 - s.x1) + 2 * (s.y2 - s.y1), 0) / 2;
    weight += beamPerimeter * (floor.beamB / 1000) * (floor.beamH / 1000) * gamma;
  }
  for (const stack of building.columnStacks) {
    for (const col of stack.floors) {
      const height = col.topElevation - col.baseElevation;
      weight += (col.b / 1000) * (col.h / 1000) * height * gamma;
    }
  }
  return weight;
}
