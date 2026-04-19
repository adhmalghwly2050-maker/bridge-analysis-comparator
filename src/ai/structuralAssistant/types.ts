// ===================== AI STRUCTURAL ASSISTANT TYPES =====================

export interface DetectedElement {
  id: string;
  type: 'wall' | 'column' | 'grid-line' | 'room' | 'opening';
  x: number;
  y: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  confidence: number;
  label?: string;
}

export interface DetectedGrid {
  id: string;
  direction: 'horizontal' | 'vertical';
  position: number;
  label: string;
}

export interface DetectedColumn {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface DetectedSpan {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  length: number;
  direction: 'x' | 'y';
}

export interface DetectedRoom {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
}

export interface PlanAnalysisResult {
  grids: DetectedGrid[];
  columns: DetectedColumn[];
  spans: DetectedSpan[];
  rooms: DetectedRoom[];
  walls: DetectedElement[];
  imageWidth: number;
  imageHeight: number;
  scale: number; // pixels per meter
}

export interface AIAssistantState {
  step: 'upload' | 'analyzing' | 'preview' | 'generating' | 'complete';
  uploadedImage: string | null;
  fileName: string | null;
  analysisResult: PlanAnalysisResult | null;
  error: string | null;
}

export interface GeneratedModel {
  slabs: { id: string; x1: number; y1: number; x2: number; y2: number }[];
  columnPositions: { x: number; y: number }[];
  gridSpacingX: number[];
  gridSpacingY: number[];
}
