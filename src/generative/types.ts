// ===================== GENERATIVE STRUCTURAL DESIGN TYPES =====================

export type BuildingType = 'residential' | 'office' | 'commercial';
export type StructuralSystemType = 'solid-slab' | 'hollow-block' | 'flat-slab';
export type SeismicZone = 'none' | 'low' | 'moderate' | 'high';

export interface GenerativeInput {
  buildingType: BuildingType;
  numFloors: number;
  floorHeight: number;
  spanRangeMin: number;
  spanRangeMax: number;
  seismicZone: SeismicZone;
  windSpeed: number;
  liveLoad: number;
  fc: number;
  fy: number;
  planSlabs?: { id: string; x1: number; y1: number; x2: number; y2: number }[];
  gridSpacingX?: number[];
  gridSpacingY?: number[];
}

export interface GeneratedSection {
  beamB: number;
  beamH: number;
  colB: number;
  colH: number;
  slabThickness: number;
  ribWidth?: number;
  ribSpacing?: number;
  blockHeight?: number;
  toppingThickness?: number;
}

export interface GeneratedStructuralOption {
  id: string;
  label: string;
  labelAr: string;
  systemType: StructuralSystemType;
  sections: GeneratedSection;
  slabs: { id: string; x1: number; y1: number; x2: number; y2: number }[];
  gridX: number[];
  gridY: number[];
  hasShearWalls: boolean;
  shearWallPositions?: { x1: number; y1: number; x2: number; y2: number; thickness: number }[];
}

export interface AnalysisMetrics {
  maxMoment: number;
  maxShear: number;
  maxDeflection: number;
  maxDrift: number;
}

export interface DesignMetrics {
  beamUtilization: number;
  columnUtilization: number;
  slabUtilization: number;
  punchingShearUtilization: number;
  allPassing: boolean;
}

export interface MaterialQuantity {
  concreteVolume: number;
  steelWeight: number;
  formworkArea: number;
  blockCount?: number;
}

export interface CostEstimate {
  concreteCost: number;
  steelCost: number;
  formworkCost: number;
  blockCost?: number;
  totalCost: number;
  currency: string;
}

export interface PerformanceScore {
  safety: number;
  costEfficiency: number;
  materialEfficiency: number;
  constructability: number;
  overall: number;
}

export interface EvaluatedOption {
  option: GeneratedStructuralOption;
  analysis: AnalysisMetrics;
  design: DesignMetrics;
  materials: MaterialQuantity;
  cost: CostEstimate;
  score: PerformanceScore;
  rank: number;
}

export interface GenerativeDesignResult {
  input: GenerativeInput;
  options: EvaluatedOption[];
  bestOptionId: string;
  optimizationIterations: number;
  totalTimeMs: number;
}
