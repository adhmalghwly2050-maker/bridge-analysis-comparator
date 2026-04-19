/**
 * Centralized state management for the structural modeler.
 * Includes undo history, wall load support, and multi-story support.
 */

import type { Slab, Column, Beam, MatProps, SlabProps, FrameResult, BeamOnBeamConnection, Story } from '@/lib/structuralEngine';
import type { ToolType } from '@/components/ToolPalette';
import type { EngineType } from '@/lib/analysisController';

export interface AppState {
  // Multi-story
  stories: Story[];
  selectedStoryId: string;
  
  slabs: Slab[];
  mat: MatProps;
  slabProps: SlabProps;
  beamB: number;
  beamH: number;
  colB: number;
  colH: number;
  colL: number;
  colLBelow: number; // Height of column below joint (foundation/lower story)
  colTopEndCondition: 'F' | 'P';
  colBottomEndCondition: 'F' | 'P';
  manualColumnsGenerated: boolean;
  manualBeamsGenerated: boolean;
  analyzed: boolean;
  frameResults: FrameResult[];
  bobConnections: BeamOnBeamConnection[];
  activeTab: string;
  mode: 'auto' | 'manual';
  activeTool: ToolType;
  pendingNode: { x: number; y: number } | null;
  selectedNodeId: number | null;
  selectedFrameId: number | null;
  selectedAreaId: number | null;
  modelVersion: number;
  removedColumnIds: string[];
  removedBeamIds: string[];
  beamOverrides: Record<string, { b?: number; h?: number; wallLoad?: number; x1?: number; y1?: number; x2?: number; y2?: number; z?: number }>;
  slabPropsOverrides: Record<number, { thickness?: number; finishLoad?: number; liveLoad?: number; cover?: number }>;
  colOverrides: Record<string, { b?: number; h?: number; L?: number; x?: number; y?: number }>;
  extraBeams: Beam[];
  extraColumns: Column[];
  modalOpen: boolean;
  selectedElement: { type: 'beam' | 'column' | 'slab'; id: string } | null;
  elemPropsOpen: boolean;
  elemPropsFrameId: number | null;
  elemPropsAreaId: number | null;
  diagramOpen: boolean;
  diagramData: any;
  // Undo
  undoStack: AppState[];
  savedMessage: string;
  supportRestraints: Record<string, { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean }>;
  frameEndReleases: Record<string, {
    nodeI: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
    nodeJ: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
  }>;
  selectedEngine: EngineType;
  /**
   * إهمال جساءة البلاطات عند التحليل.
   * عند التفعيل: البلاطات تنقل الأحمال فقط إلى الجسور (طريقة المنطقة التأثيرية)
   * والإطارات (جسور + أعمدة) تحمل كل الجساءة الإنشائية — مطابق لـ ETABS "No Slab Stiffness".
   */
  ignoreSlab: boolean;
  /** معامل تخفيض جساءة الجسور (ACI 318-19 §6.6.3) — الافتراضي 0.35 */
  beamStiffnessFactor: number;
  /** معامل تخفيض جساءة الأعمدة (ACI 318-19 §6.6.3.1.1) — الافتراضي 0.70 للأعمدة غير المتشققة */
  colStiffnessFactor: number;
  /**
   * تعديل يدوي على تصنيف الجسر الحامل/المحمول لكل عمود محذوف.
   * المفتاح: removedColumnId، القيمة: اتجاه الجسر الحامل المفروض ('horizontal' | 'vertical').
   */
  bobManualPrimary: Record<string, 'horizontal' | 'vertical'>;
}

export type AppAction =
  | { type: 'SET_SLABS'; slabs: Slab[] }
  | { type: 'ADD_SLAB'; slab: Slab }
  | { type: 'REMOVE_SLAB'; index: number }
  | { type: 'UPDATE_SLAB'; index: number; key: keyof Slab; value: string }
  | { type: 'SET_MAT'; mat: Partial<MatProps> }
  | { type: 'SET_SLAB_PROPS'; props: Partial<SlabProps> }
  | { type: 'SET_BEAM_B'; value: number }
  | { type: 'SET_BEAM_H'; value: number }
  | { type: 'SET_COL_B'; value: number }
  | { type: 'SET_COL_H'; value: number }
  | { type: 'SET_COL_L'; value: number }
  | { type: 'SET_COL_L_BELOW'; value: number }
  | { type: 'SET_COL_TOP_END_CONDITION'; value: 'F' | 'P' }
  | { type: 'SET_COL_BOTTOM_END_CONDITION'; value: 'F' | 'P' }
  | { type: 'GENERATE_COLUMNS_MANUAL' }
  | { type: 'GENERATE_BEAMS_MANUAL' }
  | { type: 'RESET_MANUAL_GENERATION' }
  | { type: 'SET_ANALYZED'; value: boolean }
  | { type: 'SET_FRAME_RESULTS'; results: FrameResult[] }
  | { type: 'SET_BOB_CONNECTIONS'; connections: BeamOnBeamConnection[] }
  | { type: 'SET_ACTIVE_TAB'; tab: string }
  | { type: 'SET_MODE'; mode: 'auto' | 'manual' }
  | { type: 'SET_ACTIVE_TOOL'; tool: ToolType }
  | { type: 'SET_PENDING_NODE'; node: { x: number; y: number } | null }
  | { type: 'SELECT_NODE'; id: number | null }
  | { type: 'SELECT_FRAME'; id: number | null }
  | { type: 'SELECT_AREA'; id: number | null }
  | { type: 'INC_MODEL_VERSION' }
  | { type: 'TOGGLE_COLUMN_REMOVAL'; colId: string }
  | { type: 'TOGGLE_BEAM_REMOVAL'; beamId: string }
  | { type: 'SET_BEAM_OVERRIDE'; beamId: string; override: { b?: number; h?: number; wallLoad?: number; x1?: number; y1?: number; x2?: number; y2?: number; z?: number } }
  | { type: 'SET_COL_OVERRIDE'; colId: string; override: { b?: number; h?: number; L?: number; x?: number; y?: number } }
  | { type: 'SET_EXTRA_BEAMS'; beams: Beam[] }
  | { type: 'ADD_EXTRA_BEAM'; beam: Beam }
  | { type: 'REMOVE_EXTRA_BEAM'; id: string }
  | { type: 'UPDATE_EXTRA_BEAM'; id: string; updates: Partial<Beam> }
  | { type: 'SET_EXTRA_COLUMNS'; columns: Column[] }
  | { type: 'ADD_EXTRA_COLUMN'; column: Column }
  | { type: 'REMOVE_EXTRA_COLUMN'; id: string }
  | { type: 'UPDATE_EXTRA_COLUMN'; id: string; updates: Partial<Column> }
  | { type: 'OPEN_MODAL'; element: { type: 'beam' | 'column' | 'slab'; id: string } }
  | { type: 'CLOSE_MODAL' }
  | { type: 'OPEN_ELEM_PROPS'; frameId?: number; areaId?: number }
  | { type: 'CLOSE_ELEM_PROPS' }
  | { type: 'OPEN_DIAGRAM'; data: any }
  | { type: 'CLOSE_DIAGRAM' }
  | { type: 'APPLY_GENERATIVE'; slabs: Slab[]; beamB: number; beamH: number; colB: number; colH: number }
  | { type: 'RESET_ANALYSIS' }
  | { type: 'SET_SLAB_PROPS_OVERRIDE'; areaId: number; override: { thickness?: number; finishLoad?: number; liveLoad?: number; cover?: number } }
  | { type: 'UNDO' }
  | { type: 'SAVE_SNAPSHOT'; message?: string }
  | { type: 'CLEAR_SAVED_MESSAGE' }
  // Multi-story actions
  | { type: 'ADD_STORY' }
  | { type: 'REMOVE_STORY'; storyId: string }
  | { type: 'UPDATE_STORY'; storyId: string; updates: Partial<Story> }
  | { type: 'SELECT_STORY'; storyId: string }
  | { type: 'COPY_STORY_ELEMENTS'; fromStoryId: string; toStoryId: string }
  | { type: 'SET_STORIES'; stories: Story[] }
  | { type: 'SET_SUPPORT_RESTRAINTS'; posKey: string; restraints: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean } }
  | { type: 'SET_FRAME_END_RELEASES'; posKey: string; nodeIRestraints: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean }; nodeJRestraints: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean } }
  | { type: 'LOAD_PROJECT'; data: Partial<AppState> }
  | { type: 'RESET_TO_DEFAULT' }
  | { type: 'SET_ENGINE'; engine: EngineType }
  | { type: 'SET_IGNORE_SLAB'; value: boolean }
  | { type: 'SET_BEAM_STIFFNESS_FACTOR'; value: number }
  | { type: 'SET_COL_STIFFNESS_FACTOR'; value: number }
  | { type: 'SET_BOB_MANUAL_PRIMARY'; colId: string; direction: 'horizontal' | 'vertical' | null }
  | { type: 'MERGE_BEAMS'; mergedBeam: Beam; removedIds: string[] }
  | { type: 'ADD_VIRTUAL_REMOVED_COLUMN'; colId: string; x: number; y: number };

const defaultStoryId = 'ST1';

export const defaultSlabs: Slab[] = [
  { id: "S1", x1: 0, y1: 0, x2: 5, y2: 4, storyId: defaultStoryId },
  { id: "S2", x1: 5, y1: 0, x2: 10, y2: 4, storyId: defaultStoryId },
  { id: "S3", x1: 0, y1: 4, x2: 5, y2: 8, storyId: defaultStoryId },
  { id: "S4", x1: 5, y1: 4, x2: 10, y2: 8, storyId: defaultStoryId },
  { id: "S5", x1: 0, y1: 8, x2: 5, y2: 13, storyId: defaultStoryId },
  { id: "S6", x1: 5, y1: 8, x2: 10, y2: 13, storyId: defaultStoryId },
];

const defaultStories: Story[] = [
  { id: 'ST1', label: 'الدور الأول', height: 4000, elevation: 0 },
];

function recalcElevations(stories: Story[]): Story[] {
  let elev = 0;
  return stories.map(s => {
    const updated = { ...s, elevation: elev };
    elev += s.height;
    return updated;
  });
}

export const initialState: AppState = {
  stories: defaultStories,
  selectedStoryId: defaultStoryId,
  slabs: defaultSlabs,
  mat: { fc: 21, fy: 280, fyt: 280, gamma: 25 },
  slabProps: { thickness: 160, finishLoad: 2, liveLoad: 2, cover: 20, phiMain: 10, phiSlab: 10 },
  beamB: 200,
  beamH: 400,
  colB: 300,
  colH: 400,
  colL: 4000,
  colLBelow: 4000,
  colTopEndCondition: 'F' as const,
  colBottomEndCondition: 'F' as const,
  manualColumnsGenerated: false,
  manualBeamsGenerated: false,
  analyzed: false,
  frameResults: [],
  bobConnections: [],
  activeTab: 'projects',
  mode: 'manual',
  activeTool: 'select',
  pendingNode: null,
  selectedNodeId: null,
  selectedFrameId: null,
  selectedAreaId: null,
  modelVersion: 0,
  removedColumnIds: [],
  removedBeamIds: [],
  beamOverrides: {},
  slabPropsOverrides: {},
  colOverrides: {},
  extraBeams: [],
  extraColumns: [],
  modalOpen: false,
  selectedElement: null,
  elemPropsOpen: false,
  elemPropsFrameId: null,
  elemPropsAreaId: null,
  diagramOpen: false,
  diagramData: null,
  undoStack: [],
  savedMessage: '',
  supportRestraints: {},
  frameEndReleases: {},
  selectedEngine: 'legacy_3d',
  ignoreSlab: false,
  beamStiffnessFactor: 0.35,
  colStiffnessFactor: 0.70,
  bobManualPrimary: {},
};

// Actions that should NOT be tracked in undo (UI-only actions)
const NON_UNDOABLE_ACTIONS = new Set([
  'SET_ACTIVE_TAB', 'SET_ACTIVE_TOOL', 'SET_PENDING_NODE', 'SELECT_NODE',
  'SELECT_FRAME', 'SELECT_AREA', 'OPEN_MODAL', 'CLOSE_MODAL',
  'OPEN_ELEM_PROPS', 'CLOSE_ELEM_PROPS', 'OPEN_DIAGRAM', 'CLOSE_DIAGRAM',
  'INC_MODEL_VERSION', 'SET_ANALYZED', 'SET_FRAME_RESULTS', 'SET_BOB_CONNECTIONS',
  'UNDO', 'SAVE_SNAPSHOT', 'CLEAR_SAVED_MESSAGE', 'SET_MODE', 'SELECT_STORY',
  'LOAD_PROJECT', 'RESET_TO_DEFAULT', 'SET_ENGINE', 'SET_IGNORE_SLAB',
]);

function coreReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_SLABS':
      return { ...state, slabs: action.slabs, manualColumnsGenerated: false, manualBeamsGenerated: false, analyzed: false };
    case 'ADD_SLAB':
      return { ...state, slabs: [...state.slabs, { ...action.slab, storyId: action.slab.storyId || state.selectedStoryId }], manualColumnsGenerated: false, manualBeamsGenerated: false, analyzed: false };
    case 'REMOVE_SLAB':
      return { ...state, slabs: state.slabs.filter((_, i) => i !== action.index), manualColumnsGenerated: false, manualBeamsGenerated: false, analyzed: false };
    case 'UPDATE_SLAB': {
      const updated = [...state.slabs];
      (updated[action.index] as any)[action.key] = action.key === 'id' ? action.value : parseFloat(action.value) || 0;
      return { ...state, slabs: updated, manualColumnsGenerated: false, manualBeamsGenerated: false, analyzed: false };
    }
    case 'SET_MAT':
      return { ...state, mat: { ...state.mat, ...action.mat }, analyzed: false };
    case 'SET_SLAB_PROPS':
      return { ...state, slabProps: { ...state.slabProps, ...action.props }, analyzed: false };
    case 'SET_BEAM_B':
      return { ...state, beamB: action.value, analyzed: false };
    case 'SET_BEAM_H':
      return { ...state, beamH: action.value, analyzed: false };
    case 'SET_COL_B':
      return { ...state, colB: action.value, analyzed: false };
    case 'SET_COL_H':
      return { ...state, colH: action.value, analyzed: false };
    case 'SET_COL_L':
      return { ...state, colL: action.value, analyzed: false };
    case 'SET_COL_L_BELOW':
      return { ...state, colLBelow: action.value, analyzed: false };
    case 'SET_COL_TOP_END_CONDITION':
      return { ...state, colTopEndCondition: action.value, analyzed: false };
    case 'SET_COL_BOTTOM_END_CONDITION':
      return { ...state, colBottomEndCondition: action.value, analyzed: false };
    case 'GENERATE_COLUMNS_MANUAL':
      return { ...state, manualColumnsGenerated: true, manualBeamsGenerated: false, analyzed: false };
    case 'GENERATE_BEAMS_MANUAL':
      return { ...state, manualColumnsGenerated: true, manualBeamsGenerated: true, analyzed: false };
    case 'RESET_MANUAL_GENERATION':
      return { ...state, manualColumnsGenerated: false, manualBeamsGenerated: false, analyzed: false };
    case 'SET_ANALYZED':
      return { ...state, analyzed: action.value };
    case 'SET_FRAME_RESULTS':
      return { ...state, frameResults: action.results };
    case 'SET_BOB_CONNECTIONS':
      return { ...state, bobConnections: action.connections };
    case 'SET_ENGINE':
      return { ...state, selectedEngine: action.engine, analyzed: false };
    case 'SET_IGNORE_SLAB':
      return { ...state, ignoreSlab: action.value, analyzed: false };
    case 'SET_BEAM_STIFFNESS_FACTOR':
      return { ...state, beamStiffnessFactor: action.value, analyzed: false };
    case 'SET_COL_STIFFNESS_FACTOR':
      return { ...state, colStiffnessFactor: action.value, analyzed: false };
    case 'SET_BOB_MANUAL_PRIMARY': {
      const updated = { ...state.bobManualPrimary };
      if (action.direction === null) {
        delete updated[action.colId];
      } else {
        updated[action.colId] = action.direction;
      }
      return { ...state, bobManualPrimary: updated, analyzed: false };
    }
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.tab };
    case 'SET_MODE':
      return { ...state, mode: action.mode, activeTool: 'select', pendingNode: null };
    case 'SET_ACTIVE_TOOL':
      return { ...state, activeTool: action.tool };
    case 'SET_PENDING_NODE':
      return { ...state, pendingNode: action.node };
    case 'SELECT_NODE':
      return { ...state, selectedNodeId: action.id, selectedFrameId: null, selectedAreaId: null };
    case 'SELECT_FRAME':
      return { ...state, selectedFrameId: action.id, selectedNodeId: null, selectedAreaId: null };
    case 'SELECT_AREA':
      return { ...state, selectedAreaId: action.id, selectedNodeId: null, selectedFrameId: null };
    case 'INC_MODEL_VERSION':
      return { ...state, modelVersion: state.modelVersion + 1 };
    case 'TOGGLE_COLUMN_REMOVAL': {
      const ids = state.removedColumnIds.includes(action.colId)
        ? state.removedColumnIds.filter(id => id !== action.colId)
        : [...state.removedColumnIds, action.colId];
      return { ...state, removedColumnIds: ids, manualBeamsGenerated: false, analyzed: false };
    }
    case 'TOGGLE_BEAM_REMOVAL': {
      const ids = state.removedBeamIds.includes(action.beamId)
        ? state.removedBeamIds.filter(id => id !== action.beamId)
        : [...state.removedBeamIds, action.beamId];
      return { ...state, removedBeamIds: ids, analyzed: false };
    }
    case 'SET_BEAM_OVERRIDE':
      return { ...state, beamOverrides: { ...state.beamOverrides, [action.beamId]: { ...state.beamOverrides[action.beamId], ...action.override } }, analyzed: false };
    case 'SET_COL_OVERRIDE':
      return { ...state, colOverrides: { ...state.colOverrides, [action.colId]: { ...state.colOverrides[action.colId], ...action.override } }, manualBeamsGenerated: false, analyzed: false };
    case 'SET_EXTRA_BEAMS':
      return { ...state, extraBeams: action.beams, analyzed: false };
    case 'ADD_EXTRA_BEAM':
      return { ...state, extraBeams: [...state.extraBeams, { ...action.beam, storyId: action.beam.storyId || state.selectedStoryId }], analyzed: false };
    case 'REMOVE_EXTRA_BEAM':
      return { ...state, extraBeams: state.extraBeams.filter(b => b.id !== action.id), analyzed: false };
    case 'UPDATE_EXTRA_BEAM':
      return { ...state, extraBeams: state.extraBeams.map(b => b.id === action.id ? { ...b, ...action.updates } : b), analyzed: false };
    case 'ADD_EXTRA_COLUMN':
      return { ...state, extraColumns: [...state.extraColumns, { ...action.column, storyId: action.column.storyId || state.selectedStoryId }], manualBeamsGenerated: false, analyzed: false };
    case 'REMOVE_EXTRA_COLUMN':
      return { ...state, extraColumns: state.extraColumns.filter(c => c.id !== action.id), manualBeamsGenerated: false, analyzed: false };
    case 'UPDATE_EXTRA_COLUMN':
      return { ...state, extraColumns: state.extraColumns.map(c => c.id === action.id ? { ...c, ...action.updates } : c), manualBeamsGenerated: false, analyzed: false };
    case 'SET_EXTRA_COLUMNS':
      return { ...state, extraColumns: action.columns, manualBeamsGenerated: false, analyzed: false };
    case 'OPEN_MODAL':
      return { ...state, modalOpen: true, selectedElement: action.element };
    case 'CLOSE_MODAL':
      return { ...state, modalOpen: false, selectedElement: null };
    case 'OPEN_ELEM_PROPS':
      return { ...state, elemPropsOpen: true, elemPropsFrameId: action.frameId ?? null, elemPropsAreaId: action.areaId ?? null };
    case 'CLOSE_ELEM_PROPS':
      return { ...state, elemPropsOpen: false, elemPropsFrameId: null, elemPropsAreaId: null };
    case 'OPEN_DIAGRAM':
      return { ...state, diagramOpen: true, diagramData: action.data };
    case 'CLOSE_DIAGRAM':
      return { ...state, diagramOpen: false, diagramData: null };
    case 'APPLY_GENERATIVE':
      return { ...state, slabs: action.slabs, beamB: action.beamB, beamH: action.beamH, colB: action.colB, colH: action.colH, analyzed: false, activeTab: 'modeler' };
    case 'RESET_ANALYSIS':
      return { ...state, analyzed: false };
    case 'SET_SLAB_PROPS_OVERRIDE':
      return { ...state, slabPropsOverrides: { ...state.slabPropsOverrides, [action.areaId]: { ...state.slabPropsOverrides[action.areaId], ...action.override } }, analyzed: false };
    case 'SET_FRAME_END_RELEASES':
      return { ...state, frameEndReleases: { ...state.frameEndReleases, [action.posKey]: { nodeI: action.nodeIRestraints, nodeJ: action.nodeJRestraints } }, analyzed: false };
    case 'SET_SUPPORT_RESTRAINTS':
      return { ...state, supportRestraints: { ...state.supportRestraints, [action.posKey]: action.restraints }, analyzed: false };
    case 'SAVE_SNAPSHOT':
      return { ...state, savedMessage: action.message || 'تم الحفظ ✓' };
    case 'CLEAR_SAVED_MESSAGE':
      return { ...state, savedMessage: '' };
    
    // Multi-story actions
    case 'ADD_STORY': {
      const newId = `ST${state.stories.length + 1}`;
      const lastStory = state.stories[state.stories.length - 1];
      const newStory: Story = {
        id: newId,
        label: `الدور ${state.stories.length + 1}`,
        height: lastStory?.height || 3200,
        elevation: 0, // will be recalculated
      };
      const updatedStories = recalcElevations([...state.stories, newStory]);
      // Copy slabs from first story to new story
      const firstStorySlabs = state.slabs.filter(s => s.storyId === state.stories[0]?.id);
      const newSlabs = firstStorySlabs.map((s, i) => ({
        ...s,
        id: `${s.id}-${newId}`,
        storyId: newId,
      }));
      return { ...state, stories: updatedStories, slabs: [...state.slabs, ...newSlabs], analyzed: false };
    }
    case 'REMOVE_STORY': {
      if (state.stories.length <= 1) return state;
      const updatedStories = recalcElevations(state.stories.filter(s => s.id !== action.storyId));
      const updatedSlabs = state.slabs.filter(s => s.storyId !== action.storyId);
      const updatedExtraBeams = state.extraBeams.filter(b => b.storyId !== action.storyId);
      const updatedExtraColumns = state.extraColumns.filter(c => c.storyId !== action.storyId);
      const newSelectedStory = state.selectedStoryId === action.storyId ? updatedStories[0]?.id || '' : state.selectedStoryId;
      return { ...state, stories: updatedStories, slabs: updatedSlabs, extraBeams: updatedExtraBeams, extraColumns: updatedExtraColumns, selectedStoryId: newSelectedStory, analyzed: false };
    }
    case 'UPDATE_STORY': {
      const updated = state.stories.map(s => s.id === action.storyId ? { ...s, ...action.updates } : s);
      return { ...state, stories: recalcElevations(updated), analyzed: false };
    }
    case 'SELECT_STORY':
      return { ...state, selectedStoryId: action.storyId };
    case 'COPY_STORY_ELEMENTS': {
      const sourceSlabs = state.slabs.filter(s => s.storyId === action.fromStoryId);
      const newSlabs = sourceSlabs.map(s => ({
        ...s,
        id: `${s.id}-${action.toStoryId}`,
        storyId: action.toStoryId,
      }));
      const filteredSlabs = state.slabs.filter(s => s.storyId !== action.toStoryId);
      return { ...state, slabs: [...filteredSlabs, ...newSlabs], manualColumnsGenerated: false, manualBeamsGenerated: false, analyzed: false };
    }
    case 'SET_STORIES':
      return { ...state, stories: recalcElevations(action.stories), analyzed: false };

    case 'LOAD_PROJECT': {
      const loaded = action.data;
      return {
        ...initialState,
        ...loaded,
        manualColumnsGenerated: loaded.manualColumnsGenerated ?? false,
        manualBeamsGenerated: loaded.manualBeamsGenerated ?? false,
        analyzed: false,
        undoStack: [],
        modalOpen: false,
        selectedElement: null,
        elemPropsOpen: false,
        diagramOpen: false,
        savedMessage: 'تم تحميل المشروع ✓',
      };
    }
    case 'RESET_TO_DEFAULT':
      return { ...initialState, undoStack: [], savedMessage: 'تم إنشاء مشروع جديد ✓' };

    case 'MERGE_BEAMS': {
      // Replace merged beams: keep the merged one, remove the others
      const removedSet = new Set(action.removedIds);
      // Update extraBeams if any of the merged beams are extra
      const newExtraBeams = state.extraBeams.filter(b => !removedSet.has(b.id));
      // Add removed IDs to removedBeamIds (for auto-generated beams)
      // Don't add the merged beam's ID to removedBeamIds (it's reused for the new merged beam)
      const mergedId = action.mergedBeam.id;
      const newRemovedBeamIds = [...state.removedBeamIds, ...action.removedIds.filter(id => id !== mergedId && !state.extraBeams.some(eb => eb.id === id))];
      // Add merged beam as extra beam (replaces the originals)
      return {
        ...state,
        extraBeams: [...newExtraBeams, action.mergedBeam],
        removedBeamIds: newRemovedBeamIds,
        analyzed: false,
      };
    }
    case 'ADD_VIRTUAL_REMOVED_COLUMN': {
      // Add a virtual "removed column" for intersect points (no real column exists)
      const newExtraCols = [...state.extraColumns, {
        id: action.colId,
        x: action.x,
        y: action.y,
        b: state.colB,
        h: state.colH,
        L: state.colL,
        isRemoved: true,
      }];
      return {
        ...state,
        extraColumns: newExtraCols,
        removedColumnIds: [...state.removedColumnIds, action.colId],
        analyzed: false,
      };
    }

    default:
      return state;
  }
}

const MAX_UNDO = 30;

export function appReducer(state: AppState, action: AppAction): AppState {
  if (action.type === 'UNDO') {
    if (state.undoStack.length === 0) return state;
    const prev = state.undoStack[state.undoStack.length - 1];
    return {
      ...prev,
      undoStack: state.undoStack.slice(0, -1),
      // Preserve current UI state
      activeTab: state.activeTab,
      activeTool: state.activeTool,
      modalOpen: false,
      selectedElement: null,
      savedMessage: 'تم التراجع ✓',
    };
  }

  // For undoable actions, push current state to undo stack
  if (!NON_UNDOABLE_ACTIONS.has(action.type)) {
    const stateWithoutUndo = { ...state, undoStack: [] as AppState[], savedMessage: '' };
    const newStack = [...state.undoStack, stateWithoutUndo].slice(-MAX_UNDO);
    const newState = coreReducer(state, action);
    return { ...newState, undoStack: newStack };
  }

  return coreReducer(state, action);
}
