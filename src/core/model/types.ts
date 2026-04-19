/**
 * Unified Structural Model – Core Type Definitions
 * ═══════════════════════════════════════════════════
 * Phase 1: Foundation types for the global structural analysis pipeline.
 * All units: mm, N, MPa, rad unless noted.
 */

// ─── Slab Stiffness Participation Modes ──────────────────────────────────────

export type SlabStiffnessMode = 'FULL' | 'LOAD_ONLY' | 'MEMBRANE_ONLY' | 'REDUCED';

export interface SlabProperties {
  /** How the slab participates in global stiffness. */
  stiffnessMode: SlabStiffnessMode;
  /** User-defined stiffness scaling factor (only used when mode = 'REDUCED'). Range [0, 1]. */
  stiffnessFactor?: number;
  /** Slab thickness (mm). */
  thickness: number;
}

// ─── Node ────────────────────────────────────────────────────────────────────

export interface Restraints {
  ux: boolean;
  uy: boolean;
  uz: boolean;
  rx: boolean;
  ry: boolean;
  rz: boolean;
}

export interface NodalLoad {
  fx: number;  // N
  fy: number;
  fz: number;
  mx: number;  // N·mm
  my: number;
  mz: number;
  loadCaseId: string;
}

export interface StructuralNode {
  id: number;
  x: number;   // mm
  y: number;
  z: number;
  restraints: Restraints;
  nodalLoads: NodalLoad[];
  label?: string;
}

// ─── Element ─────────────────────────────────────────────────────────────────

export type ElementType = 'beam' | 'column' | 'slab' | 'wall';

export interface EndRelease {
  /** Release moment at start/end: true = pinned (moment released). */
  mx: boolean;
  my: boolean;
  mz: boolean;
}

export interface LocalAxis {
  /** Direction cosines of the local x-axis (element axis for frames). */
  xDir: [number, number, number];
  /** Direction cosines of the local y-axis. */
  yDir: [number, number, number];
  /** Direction cosines of the local z-axis. */
  zDir: [number, number, number];
}

export interface StructuralElement {
  id: number;
  type: ElementType;
  nodeIds: number[];
  materialId: string;
  sectionId: string;
  releases?: { start: EndRelease; end: EndRelease };
  localAxis?: LocalAxis;
  /** Slab-specific properties – REQUIRED when type === 'slab'. */
  slabProperties?: SlabProperties;
  label?: string;
}

// ─── Material ────────────────────────────────────────────────────────────────

export interface Material {
  id: string;
  name: string;
  /** Young's modulus (MPa). */
  E: number;
  /** Poisson's ratio. */
  nu: number;
  /** Unit weight (N/mm³). */
  gamma: number;
  /** Compressive strength fc' (MPa) – concrete. */
  fc?: number;
  /** Yield strength fy (MPa) – steel. */
  fy?: number;
}

// ─── Section ─────────────────────────────────────────────────────────────────

export interface Section {
  id: string;
  name: string;
  type: 'rectangular' | 'circular' | 'T-beam' | 'generic';
  /** Width (mm). */
  b: number;
  /** Height/depth (mm). */
  h: number;
  /** Flange width for T-beam (mm). */
  bf?: number;
  /** Flange thickness for T-beam (mm). */
  hf?: number;
  /** Cross-section area (mm²) – auto-computed if not given. */
  A?: number;
  /** Moment of inertia about strong axis (mm⁴). */
  Iy?: number;
  /** Moment of inertia about weak axis (mm⁴). */
  Iz?: number;
  /** Torsional constant J (mm⁴). */
  J?: number;
}

// ─── Load ────────────────────────────────────────────────────────────────────

export interface LoadCase {
  id: string;
  name: string;
  type: 'dead' | 'live' | 'wind' | 'seismic' | 'other';
  /** Self-weight multiplier (1.0 = include self-weight). */
  selfWeightFactor: number;
}

export interface LoadCombination {
  id: string;
  name: string;
  factors: { loadCaseId: string; factor: number }[];
}

// ─── Unified Model ──────────────────────────────────────────────────────────

export interface StructuralModel {
  nodes: StructuralNode[];
  elements: StructuralElement[];
  materials: Material[];
  sections: Section[];
  loadCases: LoadCase[];
  combinations: LoadCombination[];
}

// ─── DOF Constants ──────────────────────────────────────────────────────────

/** 6 DOF per node for 3D analysis: [ux, uy, uz, rx, ry, rz]. */
export const DOF_PER_NODE = 6;

// ─── Default Restraints ─────────────────────────────────────────────────────

export const FREE_RESTRAINTS: Restraints = {
  ux: false, uy: false, uz: false,
  rx: false, ry: false, rz: false,
};

export const FIXED_RESTRAINTS: Restraints = {
  ux: true, uy: true, uz: true,
  rx: true, ry: true, rz: true,
};

export const PINNED_RESTRAINTS: Restraints = {
  ux: true, uy: true, uz: true,
  rx: false, ry: false, rz: false,
};
