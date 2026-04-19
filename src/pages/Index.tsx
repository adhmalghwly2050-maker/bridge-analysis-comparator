import React, { useReducer, useMemo, useCallback, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Slab, Column, Beam, Frame, MatProps, SlabProps, FrameResult,
  generateColumns, generateBeams, generateFrames,
  calculateBeamLoads, analyzeFrame, designFlexure, designShear,
  designColumnETABS, designSlab, calculateColumnLoads, FlexureResult, ShearResult,
  detectBeamOnBeam, analyzeWithBeamOnBeam, BeamOnBeamConnection, ColumnResult,
  calculateDeflection, DeflectionResult, diagnoseBeam, BeamDiagnostic,
  calculateColumnLoadsBiaxial, designColumnBiaxial, BiaxialColumnResult,
  calculateFrameBentUp, FrameBentUpResult, Story,
  getJointConnectivityInfo, JointConnectivityInfo,
} from "@/lib/structuralEngine";
import { getColumnLoads3D, getFrameResults3D } from "@/lib/analyze3DColumns";
import { adaptFEMResults, ENGINE_LABELS, type EngineType } from '@/lib/analysisController';
import { getFrameResultsGlobalFrame, getFrameResultsUnifiedCore } from '@/lib/globalFrameBridge';
import { getConnectedSlabResults } from "@/slabFEMEngine";
import { ModelManager } from "@/structural/model/modelManager";
import { generateStructureFromSlabs } from "@/structural/generators/slabStructureGenerator";
import ToolPalette, { ToolType } from "@/components/ToolPalette";
import ModelCanvas from "@/components/ModelCanvas";
import PropertyPanel from "@/components/PropertyPanel";
import BuildingView from "@/components/BuildingView";
import RebarDetailModal from "@/components/RebarDetailModal";
import ElementPropertiesDialog from "@/components/ElementPropertiesDialog";
import AnalysisDiagramDialog from "@/components/AnalysisDiagramDialog";
import {
  Building2, Layers, Calculator, BarChart3, Ruler, Eye,
  Grid3X3, Settings2, Download, Bot, Building, Zap, Plus, Trash2,
  Undo2, Save, Check, Wand2, Search, Compass, Merge, Crosshair, CheckSquare, Upload
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import BottomNav, { type MainTab } from "@/components/BottomNav";
import AIAssistantPanel from "@/ai/structuralAssistant/AIAssistantPanel";
import MultiStoryDesigner from "@/building/MultiStoryDesigner";
import GenerativeDesignDashboard from "@/generative/GenerativeDesignDashboard";
import type { EvaluatedOption } from "@/generative/types";
import AutoDesignPanel from "@/components/AutoDesignPanel";
import type { AutoDesignResult } from "@/lib/autoDesigner";
import { generateStructuralDXF, generateReinforcementDXF, generateBeamLayoutDXF, generateColumnLayoutDXF, downloadDXF } from "@/export/dxfExporter";
import { generateStructuralReport } from "@/export/pdfReport";
import { exportStructuralDrawingPDF } from "@/export/drawingExporter";
import { generateAutoDrawings } from "@/drawings/autoDrawingGenerator";
import { generateConstructionSheets } from "@/drawings/constructionSheets";
import { generateBBS, exportBBSToPDF, exportBBSToExcel } from "@/rebar/bbsGenerator";
import BeamRebarDetailView from "@/components/BeamRebarDetailView";
import { findCollinearGroups, mergeCollinearBeams, detectBeamIntersections } from "@/lib/beamUtils";
import { extractRawStations, buildRawStationsCSV, downloadCSV, type EngineRawStations } from "@/lib/rawMomentStationsExporter";
import { appReducer, initialState, type AppAction } from "./indexReducer";
import { StorySelector, StoryManager } from "@/components/StorySelector";
import BeamDesignDetails from "@/components/BeamDesignDetails";
import ColumnDesignDetails from "@/components/ColumnDesignDetails";
import PMDiagramChart from "@/components/PMDiagramChart";
import ExportPanel from "@/components/ExportPanel";
import ETABSComparisonTable from "@/components/ETABSComparisonTable";
import ProjectManager from "@/components/ProjectManager";
import LevelPlanView from "@/components/LevelPlanView";
import LoadComparisonPanel from "@/components/LoadComparisonPanel";
import FEMComparisonPanel  from "@/components/FEMComparisonPanel";
import GlobalFrameSolverPanel from "@/components/GlobalFrameSolverPanel";
import AdvancedAnalysisPanel from "@/components/AdvancedAnalysisPanel";
import ETABSImportPanel from "@/components/ETABSImportPanel";
import BeamLoadDiagrams from "@/components/BeamLoadDiagrams";
import BOQPanel from "@/components/BOQPanel";
import SlabAnalysisPanel from "@/components/SlabAnalysisPanel";
import ETABSFullImportPanel from "@/components/ETABSFullImportPanel";
import type { ETABSImportedData } from "@/components/ETABSFullImportPanel";

const ParamInput = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
  <div className="space-y-1">
    <label className="property-label">{label}</label>
    <Input type="number" value={value}
      onChange={(e) => { onChange(parseFloat(e.target.value) || 0); }}
      className="font-mono h-10 text-sm" />
  </div>
);

type ReleaseDOF = 'ux' | 'uy' | 'uz' | 'rx' | 'ry' | 'rz';
type BeamEndReleaseState = Record<'nodeI' | 'nodeJ', Record<ReleaseDOF, boolean>>;

const EMPTY_BEAM_END_RELEASES: BeamEndReleaseState = {
  nodeI: { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false },
  nodeJ: { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false },
};

const RELEASE_DOF_META: { key: ReleaseDOF; etabs: string; desc: string }[] = [
  { key: 'ux', etabs: 'U1', desc: 'تحرير محوري' },
  { key: 'uy', etabs: 'U2', desc: 'تحرير قص محلي' },
  { key: 'uz', etabs: 'U3', desc: 'تحرير قص عمودي' },
  { key: 'rx', etabs: 'R1', desc: 'تحرير لَي' },
  { key: 'ry', etabs: 'R2', desc: 'تحرير عزم حول Y' },
  { key: 'rz', etabs: 'R3', desc: 'تحرير عزم حول Z' },
];

const createEmptyBeamEndReleases = (): BeamEndReleaseState => ({
  nodeI: { ...EMPTY_BEAM_END_RELEASES.nodeI },
  nodeJ: { ...EMPTY_BEAM_END_RELEASES.nodeJ },
});

const modelManager = new ModelManager();

const Index = () => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const {
    stories, selectedStoryId,
    slabs, mat, slabProps, beamB, beamH, colB, colH, colL, colLBelow, colTopEndCondition, colBottomEndCondition,
    analyzed, frameResults, bobConnections, selectedEngine, ignoreSlab, beamStiffnessFactor, colStiffnessFactor,
    activeTab, mode, activeTool, pendingNode,
    selectedNodeId, selectedFrameId, selectedAreaId,
    removedColumnIds, removedBeamIds, beamOverrides, colOverrides, slabPropsOverrides, extraBeams, extraColumns, supportRestraints, frameEndReleases,
    modalOpen, selectedElement, elemPropsOpen, elemPropsFrameId, elemPropsAreaId,
    diagramOpen, diagramData, savedMessage, bobManualPrimary,
  } = state;

  // Main bottom navigation tab
  const [mainTab, setMainTab] = React.useState<MainTab>('inputs');
  const [releaseEditorBeamId, setReleaseEditorBeamId] = React.useState<string | null>(null);
  const [releaseEditorData, setReleaseEditorData] = React.useState<BeamEndReleaseState>(createEmptyBeamEndReleases);

  // Duplicate check state
  const [dupCheckResult, setDupCheckResult] = React.useState<{ message: string; count: number; items: string[] } | null>(null);

  // FEM analysis error state
  const [femError, setFemError] = React.useState<string | null>(null);

  // Pre-analysis validation state
  const [validationReport, setValidationReport] = React.useState<import('@/core/validation/preAnalysisValidator').ValidationReport | null>(null);
  const [validationRunning, setValidationRunning] = React.useState(false);
  const [showViewMoments, setShowViewMoments] = React.useState(false);
  const [viewMomentEngine, setViewMomentEngine] = React.useState<'active' | '2d' | '3d' | 'gf'>('active');

  // Modeler elevation filter state
  const [modelerElevation, setModelerElevation] = React.useState<number>(0);

  // Beam selection for merge/intersect
  const [selectedBeamIds, setSelectedBeamIds] = React.useState<Set<string>>(new Set());

  // ETABS beam data for comparison table persistence
  const [etabsCompBeamData, setEtabsCompBeamData] = React.useState<{ beamId: string; Mleft: number; Mmid: number; Mright: number }[]>([]);

  // Available elevations from stories
  const availableElevations = useMemo(() => {
    const elevs = new Set<number>();
    elevs.add(0); // ground level
    for (const s of stories) {
      elevs.add(s.elevation ?? 0);
      elevs.add((s.elevation ?? 0) + s.height);
    }
    return [...elevs].sort((a, b) => a - b);
  }, [stories]);

  // Helper: filter slabs by selected story
  const isAllStories = selectedStoryId === '__ALL__';
  const storyFilteredSlabs = useMemo(() =>
    isAllStories ? slabs : slabs.filter(s => s.storyId === selectedStoryId),
    [slabs, selectedStoryId, isAllStories]
  );
  
  // Get story label for an element
  const getStoryLabel = useCallback((storyId?: string) => {
    if (!storyId) return stories[0]?.label || 'الدور 1';
    return stories.find(s => s.id === storyId)?.label || storyId;
  }, [stories]);

  // Handler for changing individual column support conditions
  // Legacy support change callback (kept for prop compatibility)
  const handleColumnSupportChange = useCallback((_colId: string, _endType: 'top' | 'bottom', _value: 'F' | 'P') => {
    // No-op: replaced by per-DOF support restraints
  }, []);

  // Per-DOF support restraints change
  const handleSupportRestraintsChange = useCallback((posKeys: string[], restraints: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean }) => {
    for (const key of posKeys) {
      dispatch({ type: 'SET_SUPPORT_RESTRAINTS', posKey: key, restraints });
    }
  }, []);

  useEffect(() => {
    if (savedMessage) {
      const t = setTimeout(() => dispatch({ type: 'CLEAR_SAVED_MESSAGE' }), 2000);
      return () => clearTimeout(t);
    }
  }, [savedMessage]);

  // Keyboard shortcut: Ctrl+Z for undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (mode === 'auto') {
      modelManager.clear();
      const beamSection = modelManager.createSection('B-default', beamB, beamH, 'beam');
      const colSection = modelManager.createSection('C-default', colB, colH, 'column');
      generateStructureFromSlabs(
        modelManager,
        slabs.map(s => ({ id: s.id, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
        beamSection, colSection, slabProps.thickness, colL / 1000
      );
      // Reapply persisted frame end releases to modelManager nodes
      if (frameEndReleases) {
        for (const frame of modelManager.getAllFrames()) {
          const ni = modelManager.getNode(frame.nodeI);
          const nj = modelManager.getNode(frame.nodeJ);
          if (ni && nj) {
            const posKey = `${ni.x.toFixed(3)}_${ni.y.toFixed(3)}_${nj.x.toFixed(3)}_${nj.y.toFixed(3)}`;
            const posKeyRev = `${nj.x.toFixed(3)}_${nj.y.toFixed(3)}_${ni.x.toFixed(3)}_${ni.y.toFixed(3)}`;
            const rel = frameEndReleases[posKey] || frameEndReleases[posKeyRev];
            if (rel) {
              const isRev = !!frameEndReleases[posKeyRev] && !frameEndReleases[posKey];
              modelManager.setNodeRestraints(frame.nodeI, isRev ? rel.nodeJ : rel.nodeI);
              modelManager.setNodeRestraints(frame.nodeJ, isRev ? rel.nodeI : rel.nodeJ);
            }
          }
        }
      }
      dispatch({ type: 'INC_MODEL_VERSION' });
    }
  }, [slabs, beamB, beamH, colB, colH, colL, slabProps.thickness, mode, frameEndReleases]);

  const columns = useMemo(() => {
    // Get unique column positions from slabs (ignoring storyId for position extraction)
    const uniqueSlabs = slabs.filter((s, i, arr) => {
      // Use first occurrence of each slab position pattern per story
      return true; // keep all slabs, generateColumns deduplicates by position
    });
    const baseCols = generateColumns(uniqueSlabs);
    
    // Create a column instance for EACH story with sequential naming from bottom up
    const allCols: Column[] = [];
    // Sort stories by elevation (bottom to top) for sequential naming
    const sortedStories = [...stories].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
    let colSeq = 1;
    for (const story of sortedStories) {
      const storyElev = story.elevation ?? 0; // mm
      const storyHeight = story.height ?? colL;
      for (const c of baseCols) {
        const colId = `C${colSeq}`;
        const legacyId = stories.length > 1 ? `${c.id}_${story.id}` : c.id;
        const ov = colOverrides[c.id] || colOverrides[legacyId] || colOverrides[colId];
        const colHeight = ov?.L ?? storyHeight;
        // Derive bottom end condition from per-support DOF restraints
        const supportKey = `${c.x.toFixed(2)}_${c.y.toFixed(2)}_${storyElev}`;
        const sr = supportRestraints?.[supportKey];
        const bottomEnd: 'F' | 'P' = sr
          ? ((sr.ux && sr.uy && sr.uz && sr.rx && sr.ry && sr.rz) ? 'F' : 'P')
          : colBottomEndCondition as 'F' | 'P';
        const colX = ov?.x ?? c.x;
        const colY = ov?.y ?? c.y;
        allCols.push({
          ...c,
          id: colId,
          storyId: story.id,
          x: colX, y: colY,
          b: ov?.b ?? colB,
          h: ov?.h ?? colH,
          L: colHeight,
          LBelow: colLBelow,
          zBottom: storyElev,
          zTop: storyElev + colHeight,
          isRemoved: removedColumnIds.includes(c.id) || removedColumnIds.includes(colId) || removedColumnIds.includes(legacyId),
          topEndCondition: colTopEndCondition as 'F' | 'P',
          bottomEndCondition: bottomEnd,
        });
        colSeq++;
      }
    }
    // Add extra columns
    for (const c of extraColumns) {
      allCols.push({
        ...c,
        zBottom: c.zBottom ?? 0,
        zTop: c.zTop ?? (c.L || 0),
      });
    }
    return allCols;
  }, [slabs, colB, colH, colL, colLBelow, removedColumnIds, colOverrides, extraColumns, colTopEndCondition, colBottomEndCondition, stories, selectedStoryId, supportRestraints]);

  const beams = useMemo(() => {
    // Deduplicate slabs by position to generate base beam topology (avoid multi-story duplication)
    const uniqueSlabsByPos = new Map<string, Slab>();
    for (const s of slabs) {
      const key = `${s.x1},${s.y1}-${s.x2},${s.y2}`;
      if (!uniqueSlabsByPos.has(key)) uniqueSlabsByPos.set(key, s);
    }
    const deduplicatedSlabs = [...uniqueSlabsByPos.values()];
    const baseCols = generateColumns(deduplicatedSlabs);
    const baseBeams = generateBeams(deduplicatedSlabs, baseCols);
    
    // Build a map from deduplicated slab ID -> story-specific slab IDs
    const slabsByStory = new Map<string, Slab[]>(); // storyId -> slabs
    for (const s of slabs) {
      const storyId = s.storyId || stories[0]?.id || '';
      if (!slabsByStory.has(storyId)) slabsByStory.set(storyId, []);
      slabsByStory.get(storyId)!.push(s);
    }
    
    // Create beam instances for each story with sequential naming from bottom up
    const allBeams: Beam[] = [];
    const sortedStoriesForBeams = [...stories].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
    let beamSeq = 1;
    // Build a map from (baseColId, storyId) -> sequential colId for proper references
    const colIdMap = new Map<string, string>();
    let colMapSeq = 1;
    for (const story of sortedStoriesForBeams) {
      for (const c of baseCols) {
        colIdMap.set(`${c.id}_${story.id}`, `C${colMapSeq}`);
        colMapSeq++;
      }
    }
    for (const story of sortedStoriesForBeams) {
      const storyElev = story.elevation ?? 0;
      const storyHeight = story.height ?? colL;
      const beamZ = storyElev + storyHeight; // Beam at top of story (slab level)
      
      // Get slabs for this story to properly reference them
      const storySlabs = slabsByStory.get(story.id) || [];
      
      for (const b of baseBeams) {
        const beamId = `B${beamSeq}`;
        const fromColId = colIdMap.get(`${b.fromCol}_${story.id}`) ?? b.fromCol;
        const toColId = colIdMap.get(`${b.toCol}_${story.id}`) ?? b.toCol;
        const legacyBeamId = stories.length > 1 ? `${b.id}_${story.id}` : b.id;
        const ov = beamOverrides[b.id] || beamOverrides[legacyBeamId] || beamOverrides[beamId];
        
        // Map base beam slab references to this story's slab IDs (match by position)
        const storySlabIds: string[] = [];
        for (const basSlabId of b.slabs) {
          const baseSlab = deduplicatedSlabs.find(s => s.id === basSlabId);
          if (!baseSlab) continue;
          const matchingSlab = storySlabs.find(s =>
            s.x1 === baseSlab.x1 && s.y1 === baseSlab.y1 &&
            s.x2 === baseSlab.x2 && s.y2 === baseSlab.y2
          );
          if (matchingSlab) storySlabIds.push(matchingSlab.id);
        }
        
        const beamX1 = ov?.x1 ?? b.x1;
        const beamY1 = ov?.y1 ?? b.y1;
        const beamX2 = ov?.x2 ?? b.x2;
        const beamY2 = ov?.y2 ?? b.y2;
        const beamZval = ov?.z ?? beamZ;
        const dx = beamX2 - beamX1;
        const dy = beamY2 - beamY1;
        const beamLength = Math.sqrt(dx * dx + dy * dy);
        allBeams.push({
          ...b,
          id: beamId,
          fromCol: fromColId,
          toCol: toColId,
          storyId: story.id,
          x1: beamX1, y1: beamY1, x2: beamX2, y2: beamY2,
          length: beamLength > 0 ? beamLength : b.length,
          b: ov?.b ?? beamB,
          h: ov?.h ?? beamH,
          z: beamZval,
          slabs: storySlabIds.length > 0 ? storySlabIds : b.slabs,
        });
        beamSeq++;
      }
    }
    // Add extra beams
    for (const eb of extraBeams) {
      allBeams.push({ ...eb, z: eb.z ?? 0 });
    }
    return allBeams;
  }, [slabs, columns, beamB, beamH, beamOverrides, extraBeams, stories, selectedStoryId, colL]);

  // Build model nodes map for looking up node IDs by coordinates
  const modelNodesMap = useMemo(() => {
    const nodeMap = new Map<string, string>();
    const tol = 0.001;
    const getKey = (x: number, y: number, z: number) =>
      `${Math.round(x / tol) * tol},${Math.round(y / tol) * tol},${Math.round(z / tol) * tol}`;
    let seq = 1;
    for (const c of columns.filter(cc => !cc.isRemoved)) {
      const zTop = (c.zTop ?? 0) / 1000;
      const zBot = (c.zBottom ?? 0) / 1000;
      if (!nodeMap.has(getKey(c.x, c.y, zTop))) nodeMap.set(getKey(c.x, c.y, zTop), `N${seq++}`);
      if (!nodeMap.has(getKey(c.x, c.y, zBot))) nodeMap.set(getKey(c.x, c.y, zBot), `N${seq++}`);
    }
    for (const b of beams.filter(bb => !removedBeamIds.includes(bb.id))) {
      const bz = (b.z ?? 0) / 1000;
      if (!nodeMap.has(getKey(b.x1, b.y1, bz))) nodeMap.set(getKey(b.x1, b.y1, bz), `N${seq++}`);
      if (!nodeMap.has(getKey(b.x2, b.y2, bz))) nodeMap.set(getKey(b.x2, b.y2, bz), `N${seq++}`);
    }
    return { map: nodeMap, getKey };
  }, [columns, beams, removedBeamIds]);

  const getBeamNodeId = useCallback((x: number, y: number, z: number) => {
    const key = modelNodesMap.getKey(x, y, (z ?? 0) / 1000);
    return modelNodesMap.map.get(key) || '—';
  }, [modelNodesMap]);

  const toggleBeamSelection = useCallback((id: string) => {
    setSelectedBeamIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const selectAllBeams = useCallback(() => {
    const activeBeamIds = beams.filter(b => !removedBeamIds.includes(b.id)).map(b => b.id);
    setSelectedBeamIds(new Set(activeBeamIds));
  }, [beams, removedBeamIds]);
  const clearBeamSelection = useCallback(() => setSelectedBeamIds(new Set()), []);

  const handleMergeBeams = useCallback(() => {
    const groups = findCollinearGroups(beams, [...selectedBeamIds]);
    if (groups.length === 0) return;
    for (const group of groups) {
      const result = mergeCollinearBeams(beams, group);
      if (result) {
        dispatch({ type: 'MERGE_BEAMS', mergedBeam: result.merged, removedIds: result.removedIds });
      }
    }
    setSelectedBeamIds(new Set());
  }, [beams, selectedBeamIds]);

  const handleIntersect = useCallback(() => {
    const activeBeams = beams.filter(b => !removedBeamIds.includes(b.id));
    const intersections = detectBeamIntersections(activeBeams, columns, removedColumnIds);
    if (intersections.length === 0) return;
    let vcIdx = 1;
    for (const int of intersections) {
      const vcId = `VC${Date.now()}_${vcIdx++}`;
      dispatch({ type: 'ADD_VIRTUAL_REMOVED_COLUMN', colId: vcId, x: int.point.x, y: int.point.y });
    }
    setSelectedBeamIds(new Set());
  }, [beams, columns, removedColumnIds, removedBeamIds]);
  const beamsWithLoads = useMemo(() => {
    return beams
      .filter(b => !removedBeamIds.includes(b.id))
      .map(b => {
        const loads = calculateBeamLoads(b, slabs, slabProps, mat);
        const wallLoad = beamOverrides[b.id]?.wallLoad || b.wallLoad || 0;
        return { ...b, deadLoad: loads.deadLoad + wallLoad, liveLoad: loads.liveLoad, wallLoad };
      });
  }, [beams, slabs, slabProps, mat, beamOverrides, removedBeamIds]);

  const frames = useMemo(() => generateFrames(beamsWithLoads), [beamsWithLoads]);

  const detectedConnections = useMemo(() => {
    if (removedColumnIds.length === 0) return [];
    return detectBeamOnBeam(beamsWithLoads, columns, removedColumnIds, bobManualPrimary);
  }, [beamsWithLoads, columns, removedColumnIds, bobManualPrimary]);

  const runAnalysis = () => {
    setFemError(null);

    const buildAnalyzedConnections = (results: FrameResult[]) => {
      if (detectedConnections.length === 0) return [];

      return detectedConnections.map(conn => {
        let totalReaction = 0;

        for (const secBeamId of conn.secondaryBeamIds) {
          const beamResult = results.flatMap(fr => fr.beams).find(b => b.beamId === secBeamId);
          const beam = beamsWithLoads.find(b => b.id === secBeamId);
          if (!beamResult || !beam) continue;

          const isAtStart = beam.fromCol === conn.removedColumnId;
          totalReaction += isAtStart ? (beamResult.Rleft ?? 0) : (beamResult.Rright ?? 0);
        }

        const primaryBeam = beamsWithLoads.find(b => b.id === conn.primaryBeamId);
        let distOnPrimary = conn.distanceOnPrimary;
        if (primaryBeam) {
          if (conn.primaryDirection === 'horizontal') {
            const xMin = Math.min(primaryBeam.x1, primaryBeam.x2);
            distOnPrimary = Math.abs(conn.point.x - xMin);
          } else {
            const yMin = Math.min(primaryBeam.y1, primaryBeam.y2);
            distOnPrimary = Math.abs(conn.point.y - yMin);
          }
        }

        return { ...conn, reactionForce: totalReaction, distanceOnPrimary: distOnPrimary };
      });
    };

    // ── FEM (Coupled Beam–Slab) engine path — فقط عند عدم إهمال جساءة البلاطات ──
    if (selectedEngine === 'fem_coupled' && !ignoreSlab) {
      if (slabs.length === 0) {
        setFemError('يتطلب محرك FEM وجود بلاطات معرّفة في النموذج');
        return;
      }
      if (columns.length === 0) {
        setFemError('يتطلب محرك FEM وجود أعمدة (ركائز) في النموذج');
        return;
      }
      try {
        const femModel = {
          slabs,
          beams: beamsWithLoads,
          columns,
          slabProps,
          mat,
          meshDensity: 2,
        };
        const coupledResults = getConnectedSlabResults(femModel, 2);
        if (coupledResults.length === 0) {
          setFemError('لم يُنتج محرك FEM نتائج — تحقق من إعدادات النموذج');
          return;
        }
        let femFrameResults = adaptFEMResults(coupledResults, beamsWithLoads, frames);

        // ── إذا كانت توجد جسور محمولة: استعمل محرك 3D للإطارات المتأثرة ──────
        // محرك FEM لا يعالج اتصالات الجسر الحامل/المحمول بشكل صحيح (يُعطي صفراً)
        // لذا: FEM للإطارات النظيفة، 3D للإطارات التي تحتوي جسوراً محمولة
        if (detectedConnections.length > 0) {
          const secondaryBeamIdSet = new Set(detectedConnections.flatMap(c => c.secondaryBeamIds));
          const hasBobFrame = frames.some(f => f.beamIds.some(bid => secondaryBeamIdSet.has(bid)));
          if (hasBobFrame) {
            const results3D = getFrameResults3D(frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, false, beamStiffnessFactor, colStiffnessFactor);
            // دمج: الإطارات التي تحتوي جسوراً محمولة → 3D، الباقي → FEM
            femFrameResults = femFrameResults.map((femRes, idx) => {
              const frame = frames[idx];
              if (!frame) return femRes;
              const hasSec = frame.beamIds.some(bid => secondaryBeamIdSet.has(bid));
              return hasSec ? (results3D[idx] ?? femRes) : femRes;
            });
          }
        }

        dispatch({ type: 'SET_FRAME_RESULTS', results: femFrameResults });
        dispatch({ type: 'SET_BOB_CONNECTIONS', connections: [] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'خطأ غير معروف في محرك FEM';
        setFemError(`فشل تحليل FEM: ${msg}`);
        return;
      }
      dispatch({ type: 'SET_ANALYZED', value: true });
      return;
    }

    // ── FEM + إهمال جساءة البلاطات: تحليل إطار نقي (كـ ETABS "No Slab Stiffness") ──
    // البلاطات تُستخدم فقط لنقل الأحمال إلى الجسور عبر المنطقة التأثيرية
    // الجسور والأعمدة تحمل كل الجساءة الإنشائية — بدون مساهمة البلاطات
    if (selectedEngine === 'fem_coupled' && ignoreSlab) {
      // ينتقل إلى مسار المحرك 3D أدناه تلقائياً (نفس المنطق)
      // لا يوجد return هنا — يكمل التنفيذ إلى المسار التالي
    }

    // ── Build 2D hinge map from user-defined end releases (frameEndReleases → rz = rotation in 2D) ──
    const build2DHingeMap = (): Map<string, 'I' | 'J' | 'BOTH'> => {
      const hingeMap = new Map<string, 'I' | 'J' | 'BOTH'>();
      for (const beam of beamsWithLoads) {
        const rs = getBeamReleaseState(beam);
        const hasHingeI = rs.nodeI.rx || rs.nodeI.ry || rs.nodeI.rz;
        const hasHingeJ = rs.nodeJ.rx || rs.nodeJ.ry || rs.nodeJ.rz;
        if (hasHingeI && hasHingeJ) hingeMap.set(beam.id, 'BOTH');
        else if (hasHingeI) hingeMap.set(beam.id, 'I');
        else if (hasHingeJ) hingeMap.set(beam.id, 'J');
      }
      return hingeMap;
    };

    // ── Legacy 2D engine path (Matrix Stiffness Method) ─────────────────────
    if (selectedEngine === 'legacy_2d') {
      const bMap = new Map(beamsWithLoads.map(b => [b.id, b]));
      const beamHinges2D = build2DHingeMap();
      if (removedColumnIds.length > 0 && detectedConnections.length > 0) {
        const result = analyzeWithBeamOnBeam(frames, bMap, columns, mat, removedColumnIds, detectedConnections, 10, 0.01, beamHinges2D, beamStiffnessFactor, colStiffnessFactor);
        dispatch({ type: 'SET_FRAME_RESULTS', results: result.frameResults });
        dispatch({ type: 'SET_BOB_CONNECTIONS', connections: result.connections });
        if (!result.converged) {
          console.warn(`Beam-on-Beam 2D: لم يتقارب التحليل بعد ${result.iterations} تكرارات`);
        }
      } else {
        const results2D = frames.map(f => analyzeFrame(f, bMap, columns, mat, removedColumnIds, undefined, beamHinges2D, undefined, beamStiffnessFactor, colStiffnessFactor));
        dispatch({ type: 'SET_FRAME_RESULTS', results: results2D });
        dispatch({ type: 'SET_BOB_CONNECTIONS', connections: [] });
      }
      dispatch({ type: 'SET_ANALYZED', value: true });
      return;
    }

    // ── Global Frame engine path ─────────────────────────────────────────
    if (selectedEngine === 'global_frame' || selectedEngine === 'unified_core') {
      try {
        const resultsGF = getFrameResultsGlobalFrame(frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor);
        dispatch({ type: 'SET_FRAME_RESULTS', results: resultsGF });
        dispatch({ type: 'SET_BOB_CONNECTIONS', connections: buildAnalyzedConnections(resultsGF) });
      } catch (err) {
        console.warn('Global Frame analysis failed, falling back to 3D:', err);
        const results3D = getFrameResults3D(frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, false, beamStiffnessFactor, colStiffnessFactor);
        dispatch({ type: 'SET_FRAME_RESULTS', results: results3D });
        dispatch({ type: 'SET_BOB_CONNECTIONS', connections: buildAnalyzedConnections(results3D) });
      }
      dispatch({ type: 'SET_ANALYZED', value: true });
      return;
    }

    // ── Legacy 3D engine path ────────────────────────────────────────────────
    const bMap = new Map(beamsWithLoads.map(b => [b.id, b]));
    try {
      const results3D = getFrameResults3D(frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, false, beamStiffnessFactor, colStiffnessFactor);
      dispatch({ type: 'SET_FRAME_RESULTS', results: results3D });
      dispatch({ type: 'SET_BOB_CONNECTIONS', connections: buildAnalyzedConnections(results3D) });
    } catch (err) {
      console.warn('3D frame analysis failed, falling back to 2D:', err);
      const beamHinges2D = build2DHingeMap();
      if (removedColumnIds.length > 0 && detectedConnections.length > 0) {
        const result = analyzeWithBeamOnBeam(frames, bMap, columns, mat, removedColumnIds, detectedConnections, 10, 0.01, beamHinges2D, beamStiffnessFactor, colStiffnessFactor);
        dispatch({ type: 'SET_FRAME_RESULTS', results: result.frameResults });
        dispatch({ type: 'SET_BOB_CONNECTIONS', connections: result.connections });
      } else {
        const results2D = frames.map(f => analyzeFrame(f, bMap, columns, mat, removedColumnIds, undefined, beamHinges2D, undefined, beamStiffnessFactor, colStiffnessFactor));
        dispatch({ type: 'SET_FRAME_RESULTS', results: results2D });
        dispatch({ type: 'SET_BOB_CONNECTIONS', connections: [] });
      }
    }
    dispatch({ type: 'SET_ANALYZED', value: true });
  };

  const getBeamReleaseKey = useCallback((beam: Beam) => (
    `${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}_${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}`
  ), []);

  const getBeamReleaseState = useCallback((beam: Beam): BeamEndReleaseState => {
    const posKey = getBeamReleaseKey(beam);
    const posKeyRev = `${beam.x2.toFixed(3)}_${beam.y2.toFixed(3)}_${beam.x1.toFixed(3)}_${beam.y1.toFixed(3)}`;
    const rel = frameEndReleases[posKey] || frameEndReleases[posKeyRev];

    if (!rel) return createEmptyBeamEndReleases();

    const isReversed = !!frameEndReleases[posKeyRev] && !frameEndReleases[posKey];
    return isReversed
      ? { nodeI: { ...rel.nodeJ }, nodeJ: { ...rel.nodeI } }
      : { nodeI: { ...rel.nodeI }, nodeJ: { ...rel.nodeJ } };
  }, [frameEndReleases, getBeamReleaseKey]);

  const openBeamReleaseEditor = useCallback((beam: Beam) => {
    setReleaseEditorBeamId(beam.id);
    setReleaseEditorData(getBeamReleaseState(beam));
  }, [getBeamReleaseState]);

  const handleReleaseEditorToggle = useCallback((end: 'nodeI' | 'nodeJ', dof: ReleaseDOF, checked: boolean) => {
    setReleaseEditorData(prev => ({
      ...prev,
      [end]: { ...prev[end], [dof]: checked },
    }));
  }, []);

  const resetReleaseEditorEnd = useCallback((end: 'nodeI' | 'nodeJ') => {
    setReleaseEditorData(prev => ({
      ...prev,
      [end]: { ...EMPTY_BEAM_END_RELEASES[end] },
    }));
  }, []);

  const saveBeamReleaseEditor = useCallback(() => {
    if (!releaseEditorBeamId) return;
    const beam = beams.find(item => item.id === releaseEditorBeamId);
    if (!beam) return;

    dispatch({
      type: 'SET_FRAME_END_RELEASES',
      posKey: getBeamReleaseKey(beam),
      nodeIRestraints: releaseEditorData.nodeI,
      nodeJRestraints: releaseEditorData.nodeJ,
    });
    dispatch({ type: 'RESET_ANALYSIS' });
    setReleaseEditorBeamId(null);
  }, [releaseEditorBeamId, beams, releaseEditorData, getBeamReleaseKey]);

  const releaseEditorBeam = useMemo(
    () => beams.find(beam => beam.id === releaseEditorBeamId) || null,
    [beams, releaseEditorBeamId]
  );

  const releaseEditorWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (releaseEditorData.nodeI.ux && releaseEditorData.nodeJ.ux) warnings.push('لا يمكن تحرير U1 من الطرفين معاً لأنه يسبب عدم استقرار.');
    if (releaseEditorData.nodeI.uy && releaseEditorData.nodeJ.uy) warnings.push('لا يمكن تحرير U2 من الطرفين معاً لأنه يسبب عدم استقرار.');
    if (releaseEditorData.nodeI.uz && releaseEditorData.nodeJ.uz) warnings.push('لا يمكن تحرير U3 من الطرفين معاً لأنه يسبب عدم استقرار.');
    if (releaseEditorData.nodeI.rx && releaseEditorData.nodeJ.rx) warnings.push('لا يمكن تحرير R1 من الطرفين معاً لأنه يسبب عدم استقرار.');
    if (releaseEditorData.nodeI.ry && releaseEditorData.nodeJ.ry && (releaseEditorData.nodeI.uz || releaseEditorData.nodeJ.uz)) warnings.push('تحرير R2 من الطرفين مع U3 قد يجعل الجسر غير مستقر.');
    if (releaseEditorData.nodeI.rz && releaseEditorData.nodeJ.rz && (releaseEditorData.nodeI.uy || releaseEditorData.nodeJ.uy)) warnings.push('تحرير R3 من الطرفين مع U2 قد يجعل الجسر غير مستقر.');
    return warnings;
  }, [releaseEditorData]);

  const beamDesigns = useMemo(() => {
    if (!analyzed) return [];
    const designs: {
      beamId: string; frameId: string; span: number;
      Mleft: number; Mmid: number; Mright: number; Vu: number;
      Rleft: number; Rright: number;
      flexLeft: FlexureResult; flexMid: FlexureResult; flexRight: FlexureResult;
      shear: ShearResult;
      deflection: DeflectionResult;
      mergedCarrierIds?: string[]; // IDs of merged carrier beam segments
    }[] = [];

    // Track which beams have been merged as part of a carrier group
    const mergedBeamIds = new Set<string>();

    // First pass: identify carrier beam pairs and merge them
    for (const conn of bobConnections) {
      if (!conn.continuationBeamId) continue;
      const primaryId = conn.primaryBeamId;
      const contId = conn.continuationBeamId;
      mergedBeamIds.add(primaryId);
      mergedBeamIds.add(contId);

      // Find analysis results for both segments
      let primaryResult: typeof frameResults[0]['beams'][0] | undefined;
      let contResult: typeof frameResults[0]['beams'][0] | undefined;
      let primaryFrame: typeof frameResults[0] | undefined;
      for (const fr of frameResults) {
        for (const br of fr.beams) {
          if (br.beamId === primaryId) { primaryResult = br; primaryFrame = fr; }
          if (br.beamId === contId) { contResult = br; }
        }
      }
      if (!primaryResult || !contResult || !primaryFrame) continue;

      const beamA = beamsWithLoads.find(b => b.id === primaryId);
      const beamB = beamsWithLoads.find(b => b.id === contId);
      if (!beamA || !beamB) continue;

      // Merge: use envelope of both segments
      const totalSpan = primaryResult.span + contResult.span;
      const envMleft = Math.max(Math.abs(primaryResult.Mleft), Math.abs(contResult.Mleft));
      const envMright = Math.max(Math.abs(primaryResult.Mright), Math.abs(contResult.Mright));
      const envMmid = Math.max(primaryResult.Mmid, contResult.Mmid);
      const envVu = Math.max(
        Math.max(Math.abs(primaryResult.Rleft || 0), Math.abs(primaryResult.Rright || 0)),
        Math.max(Math.abs(contResult.Rleft || 0), Math.abs(contResult.Rright || 0))
      );

      // Use the larger cross-section for design
      const designBeam = beamA.b * beamA.h >= beamB.b * beamB.h ? beamA : beamB;

      // T-beam effective flange width
      const hasSlabs = designBeam.slabs.length > 0;
      let effectiveFlangeWidth = 0;
      if (hasSlabs) {
        const adjacentSlabWidths: number[] = [];
        for (const slabId of designBeam.slabs) {
          const slab = slabs.find(s => s.id === slabId);
          if (!slab) continue;
          if (designBeam.direction === 'horizontal') {
            adjacentSlabWidths.push(Math.abs(slab.y2 - slab.y1));
          } else {
            adjacentSlabWidths.push(Math.abs(slab.x2 - slab.x1));
          }
        }
        const ccSpacing = adjacentSlabWidths.reduce((a, b) => a + b, 0);
        effectiveFlangeWidth = Math.min(
          totalSpan * 1000 / 4,
          designBeam.b + 16 * slabProps.thickness,
          ccSpacing * 1000
        );
      }

      const flexLeft = designFlexure(envMleft, designBeam.b, designBeam.h, mat.fc, mat.fy);
      const flexMid = designFlexure(envMmid, designBeam.b, designBeam.h, mat.fc, mat.fy, 40,
        hasSlabs, slabProps.thickness, effectiveFlangeWidth, 4);
      const flexRight = designFlexure(envMright, designBeam.b, designBeam.h, mat.fc, mat.fy);
      const wuBeam = 1.2 * designBeam.deadLoad + 1.6 * designBeam.liveLoad;
      const AsForShear = Math.max(flexLeft.As, flexMid.As, flexRight.As);
      const shear = designShear(envVu, designBeam.b, designBeam.h, mat.fc, mat.fyt, 40, mat.stirrupDia || 10, wuBeam, 300, AsForShear);
      const AsPrimeForDefl = flexMid.As * 0.3;
      const deflection = calculateDeflection(totalSpan, designBeam.b, designBeam.h, mat.fc, designBeam.deadLoad, designBeam.liveLoad, flexMid.As, 'both-ends', 'B', AsPrimeForDefl, 1.0, 60);

      // Push ONE merged design entry for the primary beam ID
      designs.push({
        beamId: primaryId, frameId: primaryFrame.frameId, span: totalSpan,
        Mleft: primaryResult.Mleft, Mmid: envMmid, Mright: contResult.Mright,
        Vu: envVu,
        Rleft: primaryResult.Rleft || 0, Rright: contResult.Rright || 0,
        flexLeft, flexMid, flexRight, shear, deflection,
        mergedCarrierIds: [primaryId, contId],
      });
    }

    // Second pass: design non-carrier beams normally
    for (const fr of frameResults) {
      const numBeams = fr.beams.length;
      for (let bi = 0; bi < numBeams; bi++) {
        const br = fr.beams[bi];
        if (mergedBeamIds.has(br.beamId)) continue; // already merged
        const beam = beamsWithLoads.find(b => b.id === br.beamId);
        if (!beam) continue;

        const hasSlabs = beam.slabs.length > 0;
        let effectiveFlangeWidth = 0;
        if (hasSlabs) {
          const adjacentSlabWidths: number[] = [];
          for (const slabId of beam.slabs) {
            const slab = slabs.find(s => s.id === slabId);
            if (!slab) continue;
            if (beam.direction === 'horizontal') {
              adjacentSlabWidths.push(Math.abs(slab.y2 - slab.y1));
            } else {
              adjacentSlabWidths.push(Math.abs(slab.x2 - slab.x1));
            }
          }
          const ccSpacing = adjacentSlabWidths.reduce((a, b) => a + b, 0);
          effectiveFlangeWidth = Math.min(
            br.span * 1000 / 4,
            beam.b + 16 * slabProps.thickness,
            ccSpacing * 1000
          );
        }

        const flexLeft = designFlexure(Math.abs(br.Mleft), beam.b, beam.h, mat.fc, mat.fy);
        const flexMid = designFlexure(br.Mmid, beam.b, beam.h, mat.fc, mat.fy, 40,
          hasSlabs, slabProps.thickness, effectiveFlangeWidth, 4);
        const flexRight = designFlexure(Math.abs(br.Mright), beam.b, beam.h, mat.fc, mat.fy);
        const wuBeam = 1.2 * beam.deadLoad + 1.6 * beam.liveLoad;
        const AsForShear = Math.max(flexLeft.As, flexMid.As, flexRight.As);
        const shear = designShear(br.Vu, beam.b, beam.h, mat.fc, mat.fyt, 40, mat.stirrupDia || 10, wuBeam, 300, AsForShear);
        const isExteriorLeft = bi === 0;
        const isExteriorRight = bi === numBeams - 1;
        const endCondition: 'simple' | 'one-end' | 'both-ends' = 
          (isExteriorLeft && isExteriorRight) ? 'simple' :
          (isExteriorLeft || isExteriorRight) ? 'one-end' : 'both-ends';
        const AsPrimeForDefl = flexMid.As * 0.3;
        const deflection = calculateDeflection(br.span, beam.b, beam.h, mat.fc, beam.deadLoad, beam.liveLoad, flexMid.As, endCondition, 'B', AsPrimeForDefl, 1.0, 60);
        designs.push({
          beamId: br.beamId, frameId: fr.frameId, span: br.span,
          Mleft: br.Mleft, Mmid: br.Mmid, Mright: br.Mright, Vu: br.Vu,
          Rleft: br.Rleft || 0, Rright: br.Rright || 0,
          flexLeft, flexMid, flexRight, shear, deflection,
        });
      }
    }
    return designs;
  }, [frameResults, beamsWithLoads, mat, analyzed, bobConnections, slabs, slabProps]);

  // Beam diagnostics - detailed ACI 318-19 compliance check
  const beamDiagnostics = useMemo<Map<string, BeamDiagnostic>>(() => {
    const map = new Map<string, BeamDiagnostic>();
    for (const d of beamDesigns) {
      const beam = beamsWithLoads.find(b => b.id === d.beamId);
      if (!beam) continue;
      // ACI 318-19: each section designed independently; Mu_max for reporting only
      const Mu_max = Math.max(Math.abs(d.Mleft), Math.abs(d.Mmid), Math.abs(d.Mright));

      // Calculate effective flange width for T-beam diagnosis
      let effFlangeW = 0;
      if (beam.slabs.length > 0) {
        const adjacentWidths: number[] = [];
        for (const slabId of beam.slabs) {
          const slab = slabs.find(s => s.id === slabId);
          if (!slab) continue;
          if (beam.direction === 'horizontal') {
            adjacentWidths.push(Math.abs(slab.y2 - slab.y1));
          } else {
            adjacentWidths.push(Math.abs(slab.x2 - slab.x1));
          }
        }
        const ccSpacing = adjacentWidths.reduce((a, b) => a + b, 0);
        effFlangeW = Math.min(d.span * 1000 / 4, beam.b + 16 * slabProps.thickness, ccSpacing * 1000);
      }

      const diag = diagnoseBeam(
        d.beamId,
        { b: beam.b, h: beam.h, length: beam.length },
        d.flexLeft, d.flexMid, d.flexRight,
        d.shear, d.deflection,
        mat.fc, mat.fy, mat.fyt,
        d.span, Mu_max, d.Vu,
        effFlangeW, slabProps.thickness,
      );
      map.set(d.beamId, diag);
    }
    return map;
  }, [beamDesigns, beamsWithLoads, mat]);

  const colLoads = useMemo(() => {
    if (!analyzed) return new Map<string, { Pu: number; Mu: number }>();
    return calculateColumnLoads(columns, beamsWithLoads, frameResults);
  }, [analyzed, columns, beamsWithLoads, frameResults]);

  // 2D frame results (kept only for comparison/fallback paths)
  // MUST match runAnalysis logic for legacy_2d to produce consistent results
  const frameResults2D = useMemo(() => {
    if (!analyzed) return [] as FrameResult[];
    const bMap = new Map(beamsWithLoads.map(b => [b.id, b]));
    const beamHinges2D = new Map<string, 'I' | 'J' | 'BOTH'>();
    for (const beam of beamsWithLoads) {
      const rs = getBeamReleaseState(beam);
      const hasHingeI = rs.nodeI.rx || rs.nodeI.ry || rs.nodeI.rz;
      const hasHingeJ = rs.nodeJ.rx || rs.nodeJ.ry || rs.nodeJ.rz;
      if (hasHingeI && hasHingeJ) beamHinges2D.set(beam.id, 'BOTH');
      else if (hasHingeI) beamHinges2D.set(beam.id, 'I');
      else if (hasHingeJ) beamHinges2D.set(beam.id, 'J');
    }
    // Use beam-on-beam analysis when applicable (same as runAnalysis)
    if (removedColumnIds.length > 0 && detectedConnections.length > 0) {
      const result = analyzeWithBeamOnBeam(frames, bMap, columns, mat, removedColumnIds, detectedConnections, 10, 0.01, beamHinges2D, beamStiffnessFactor, colStiffnessFactor);
      return result.frameResults;
    }
    return frames.map(f => analyzeFrame(f, bMap, columns, mat, removedColumnIds, undefined, beamHinges2D, undefined, beamStiffnessFactor, colStiffnessFactor));
  }, [analyzed, frames, beamsWithLoads, columns, mat, getBeamReleaseState, removedColumnIds, detectedConnections, beamStiffnessFactor, colStiffnessFactor]);

  // Beam hinge map for diagram rendering
  const beamHingesMap = useMemo(() => {
    const m = new Map<string, 'I' | 'J' | 'BOTH'>();
    for (const beam of beamsWithLoads) {
      const rs = getBeamReleaseState(beam);
      const hi = rs.nodeI.rx || rs.nodeI.ry || rs.nodeI.rz;
      const hj = rs.nodeJ.rx || rs.nodeJ.ry || rs.nodeJ.rz;
      if (hi && hj) m.set(beam.id, 'BOTH');
      else if (hi) m.set(beam.id, 'I');
      else if (hj) m.set(beam.id, 'J');
    }
    return m;
  }, [beamsWithLoads, getBeamReleaseState]);


  // 3D frame results for comparison — MUST use same params as runAnalysis
  const frameResults3DRaw = useMemo(() => {
    if (!analyzed || frames.length === 0) return [] as FrameResult[];
    try {
      return getFrameResults3D(frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, false, beamStiffnessFactor, colStiffnessFactor);
    } catch {
      return [] as FrameResult[];
    }
  }, [analyzed, frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor]);

  // Global Frame results for comparison
  const frameResultsGF = useMemo(() => {
    if (!analyzed || frames.length === 0) return [] as FrameResult[];
    try {
      return getFrameResultsGlobalFrame(frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor);
    } catch {
      return [] as FrameResult[];
    }
  }, [analyzed, frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor]);

  // Unified Core results for comparison
  const frameResultsUC = useMemo(() => {
    if (!analyzed || frames.length === 0) return [] as FrameResult[];
    try {
      return getFrameResultsUnifiedCore(frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor);
    } catch {
      return [] as FrameResult[];
    }
  }, [analyzed, frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor]);

  // 2D column loads (kept for comparison/fallback)
  const colLoadsBiaxial = useMemo(() => {
    if (!analyzed) return new Map<string, { Pu: number; Mx: number; My: number; MxTop: number; MxBot: number; MyTop: number; MyBot: number }>();
    return calculateColumnLoadsBiaxial(columns, beamsWithLoads, frameResults2D, stories);
  }, [analyzed, columns, beamsWithLoads, frameResults2D, stories]);

  // 3D column loads — PRIMARY results for design
  const colLoads3D = useMemo(() => {
    if (!analyzed || frames.length === 0) return new Map();
    try {
      return getColumnLoads3D(frames, beamsWithLoads, columns, mat, frameEndReleases, detectedConnections, slabs, slabProps, true, beamStiffnessFactor, colStiffnessFactor);
    } catch {
      // Fallback to 2D if 3D fails
      return colLoadsBiaxial;
    }
  }, [analyzed, frames, beamsWithLoads, columns, mat, colLoadsBiaxial, frameEndReleases, detectedConnections, slabs, slabProps, beamStiffnessFactor, colStiffnessFactor]);

  const jointConnectivity = useMemo(() => {
    if (!analyzed) return [] as JointConnectivityInfo[];
    return getJointConnectivityInfo(columns, beamsWithLoads, frameResults);
  }, [analyzed, columns, beamsWithLoads, frameResults]);

  const colDesigns = useMemo(() => {
    return columns.filter(c => !c.isRemoved).map(c => {
      const loads = colLoads3D.get(c.id) || { Pu: 0, Mx: 0, My: 0, MxTop: 0, MxBot: 0, MyTop: 0, MyBot: 0 };
      return {
        ...c, Pu: loads.Pu, Mx: loads.Mx, My: loads.My,
        Mu: Math.max(loads.Mx, loads.My),
        design: designColumnBiaxial(
          loads.Pu, loads.Mx, loads.My, c.b, c.h, mat.fc, mat.fy, c.L,
          undefined, undefined,
          loads.MxTop, loads.MxBot, loads.MyTop, loads.MyBot,
        ),
      };
    });
  }, [columns, colLoads3D, mat]);

  // Bent-up bars calculation
  const bentUpResults = useMemo(() => {
    if (!analyzed) return [] as FrameBentUpResult[];
    const bMap = new Map(beamsWithLoads.map(b => [b.id, b]));
    // Collect all secondary (carried) beam IDs from detected connections
    // Secondary beams must NOT have bent-up bars (they sit on hinges, bars run straight)
    const secBeamIds = new Set<string>();
    for (const conn of detectedConnections) {
      for (const id of conn.secondaryBeamIds) secBeamIds.add(id);
    }
    return frames.map(f => {
      const fr = frameResults.find(r => r.frameId === f.id);
      if (!fr) return null;
      return calculateFrameBentUp(f, bMap, fr, mat, frames, secBeamIds);
    }).filter(Boolean) as FrameBentUpResult[];
  }, [analyzed, frames, beamsWithLoads, frameResults, mat, detectedConnections]);

  const slabDesigns = useMemo(() =>
    slabs.map(s => ({ ...s, design: designSlab(s, slabProps, mat, slabs, columns) })),
    [slabs, slabProps, mat, columns]
  );

  const handleCanvasClick = useCallback((x: number, y: number) => {
    if (activeTool === 'node') {
      modelManager.createNode(x, y, 0);
      dispatch({ type: 'INC_MODEL_VERSION' });
    } else if (activeTool === 'beam' || activeTool === 'column') {
      if (!pendingNode) {
        dispatch({ type: 'SET_PENDING_NODE', node: { x, y } });
      } else {
        const ni = modelManager.createNode(pendingNode.x, pendingNode.y, 0);
        if (activeTool === 'beam') {
          const nj = modelManager.createNode(x, y, 0);
          const sections = modelManager.getAllSections();
          const beamSec = sections.find(s => s.type === 'beam') || modelManager.createSection('B', beamB, beamH, 'beam');
          modelManager.createBeam(ni.id, nj.id, beamSec.id);
        } else {
          const nj = modelManager.createNode(x, y, -(colL / 1000));
          const sections = modelManager.getAllSections();
          const colSec = sections.find(s => s.type === 'column') || modelManager.createSection('C', colB, colH, 'column');
          modelManager.createColumn(nj.id, ni.id, colSec.id);
        }
        dispatch({ type: 'SET_PENDING_NODE', node: null });
        dispatch({ type: 'INC_MODEL_VERSION' });
      }
    } else if (activeTool === 'delete') {
      const nearest = modelManager.getAllNodes().find(n =>
        Math.abs(n.x - x) < 0.3 && Math.abs(n.y - y) < 0.3
      );
      if (nearest) {
        modelManager.deleteNode(nearest.id);
        dispatch({ type: 'INC_MODEL_VERSION' });
      }
    }
  }, [activeTool, pendingNode, beamB, beamH, colB, colH, colL]);

  const handleNodeClick = useCallback((id: number) => {
    dispatch({ type: 'SELECT_NODE', id });
    if (activeTool === 'delete') {
      modelManager.deleteNode(id);
      dispatch({ type: 'SELECT_NODE', id: null });
      dispatch({ type: 'INC_MODEL_VERSION' });
    }
  }, [activeTool]);

  const handleFrameClick = useCallback((id: number) => {
    dispatch({ type: 'SELECT_FRAME', id });
    if (activeTool === 'delete') {
      modelManager.deleteElement(id);
      dispatch({ type: 'SELECT_FRAME', id: null });
      dispatch({ type: 'INC_MODEL_VERSION' });
    }
  }, [activeTool]);

  const handleAreaClick = useCallback((id: number) => {
    dispatch({ type: 'SELECT_AREA', id });
    if (activeTool === 'delete') {
      modelManager.deleteArea(id);
      dispatch({ type: 'SELECT_AREA', id: null });
      dispatch({ type: 'INC_MODEL_VERSION' });
    }
  }, [activeTool]);

  const handleNodeRestraintChange = useCallback((nodeId: number, restraints: any) => {
    modelManager.setNodeRestraints(nodeId, restraints);
    dispatch({ type: 'INC_MODEL_VERSION' });
  }, []);

  const handleFrameLongPress = useCallback((id: number) => {
    dispatch({ type: 'OPEN_ELEM_PROPS', frameId: id });
  }, []);

  const handleAreaLongPress = useCallback((id: number) => {
    dispatch({ type: 'OPEN_ELEM_PROPS', areaId: id });
  }, []);

  const handleElemPropsSave = useCallback((data: any) => {
    if (data.frameId != null) {
      modelManager.updateFrameSection(data.frameId, data.b, data.h);
      if (data.nodeIRestraints) {
        const frame = modelManager.getFrame(data.frameId);
        if (frame) {
          modelManager.setNodeRestraints(frame.nodeI, data.nodeIRestraints);
          modelManager.setNodeRestraints(frame.nodeJ, data.nodeJRestraints);
          // Persist end releases in state keyed by node positions so they survive model rebuilds
          const nodeI = modelManager.getNode(frame.nodeI);
          const nodeJ = modelManager.getNode(frame.nodeJ);
          if (nodeI && nodeJ) {
            const posKey = `${nodeI.x.toFixed(3)}_${nodeI.y.toFixed(3)}_${nodeJ.x.toFixed(3)}_${nodeJ.y.toFixed(3)}`;
            dispatch({ type: 'SET_FRAME_END_RELEASES', posKey, nodeIRestraints: data.nodeIRestraints, nodeJRestraints: data.nodeJRestraints });
          }
        }
      }
    }
    if (data.areaId != null && data.thickness != null) {
      modelManager.updateAreaThickness(data.areaId, data.thickness);
    }
    if (data.areaId != null) {
      const override: any = {};
      if (data.thickness != null) override.thickness = data.thickness;
      if (data.finishLoad != null) override.finishLoad = data.finishLoad;
      if (data.liveLoad != null) override.liveLoad = data.liveLoad;
      if (data.cover != null) override.cover = data.cover;
      if (Object.keys(override).length > 0) {
        dispatch({ type: 'SET_SLAB_PROPS_OVERRIDE', areaId: data.areaId, override });
      }
    }
    dispatch({ type: 'INC_MODEL_VERSION' });
    dispatch({ type: 'RESET_ANALYSIS' });
  }, []);

  const handleLevelElementDelete = useCallback((type: 'beam' | 'column' | 'slab', id: string) => {
    if (type === 'beam') {
      const isExtra = extraBeams.some(eb => eb.id === id);
      if (isExtra) {
        dispatch({ type: 'REMOVE_EXTRA_BEAM', id });
      } else if (!removedBeamIds.includes(id)) {
        dispatch({ type: 'TOGGLE_BEAM_REMOVAL', beamId: id });
      }
    } else if (type === 'column') {
      const isExtra = extraColumns.some(ec => ec.id === id);
      if (isExtra) {
        dispatch({ type: 'REMOVE_EXTRA_COLUMN', id });
      } else if (!removedColumnIds.includes(id)) {
        dispatch({ type: 'TOGGLE_COLUMN_REMOVAL', colId: id });
      }
    } else if (type === 'slab') {
      const idx = slabs.findIndex(s => s.id === id);
      if (idx !== -1) {
        dispatch({ type: 'REMOVE_SLAB', index: idx });
      }
    }
    dispatch({ type: 'RESET_ANALYSIS' });
  }, [extraBeams, extraColumns, slabs, removedBeamIds, removedColumnIds]);

  const handleElemPropsDelete = useCallback((data: { frameId?: number; areaId?: number }) => {
    if (data.frameId != null) {
      modelManager.deleteElement(data.frameId);
    }
    if (data.areaId != null) {
      modelManager.deleteArea(data.areaId);
    }
    dispatch({ type: 'CLOSE_ELEM_PROPS' });
    dispatch({ type: 'INC_MODEL_VERSION' });
    dispatch({ type: 'RESET_ANALYSIS' });
  }, []);

  const checkAndRemoveDuplicates = useCallback(() => {
    const EPS = 0.011;
    const items: string[] = [];

    const getNum = (id: string) => parseInt(id.replace(/\D/g, '') || '0', 10);

    // ---- فحص البلاطات المكررة ----
    const slabGroups = new Map<string, typeof slabs>();
    for (const s of slabs) {
      const x1 = Math.min(s.x1, s.x2), y1 = Math.min(s.y1, s.y2);
      const x2 = Math.max(s.x1, s.x2), y2 = Math.max(s.y1, s.y2);
      const key = `${s.storyId || ''}|${x1.toFixed(2)},${y1.toFixed(2)},${x2.toFixed(2)},${y2.toFixed(2)}`;
      if (!slabGroups.has(key)) slabGroups.set(key, []);
      slabGroups.get(key)!.push(s);
    }
    const slabIndicesToRemove: number[] = [];
    for (const [, group] of slabGroups) {
      if (group.length > 1) {
        const sorted = [...group].sort((a, b) => getNum(a.id) - getNum(b.id));
        const toRemove = sorted.slice(0, -1);
        for (const s of toRemove) {
          const idx = slabs.indexOf(s);
          if (idx !== -1) slabIndicesToRemove.push(idx);
          items.push(`بلاطة ${s.id} (مكررة مع ${sorted[sorted.length - 1].id})`);
        }
      }
    }
    const sortedSlabIndices = [...slabIndicesToRemove].sort((a, b) => b - a);
    for (const idx of sortedSlabIndices) {
      dispatch({ type: 'REMOVE_SLAB', index: idx });
    }

    // ---- فحص الجسور المكررة ----
    const beamGroups = new Map<string, typeof beamsWithLoads>();
    for (const b of beamsWithLoads) {
      const x1 = Math.min(b.x1, b.x2), y1 = Math.min(b.y1, b.y2);
      const x2 = Math.max(b.x1, b.x2), y2 = Math.max(b.y1, b.y2);
      const key = `${b.storyId || ''}|${x1.toFixed(2)},${y1.toFixed(2)},${x2.toFixed(2)},${y2.toFixed(2)}`;
      if (!beamGroups.has(key)) beamGroups.set(key, []);
      beamGroups.get(key)!.push(b);
    }
    for (const [, group] of beamGroups) {
      if (group.length > 1) {
        const sorted = [...group].sort((a, b) => getNum(a.id) - getNum(b.id));
        const toRemove = sorted.slice(0, -1);
        for (const b of toRemove) {
          const isExtra = extraBeams.some(eb => eb.id === b.id);
          if (isExtra) {
            dispatch({ type: 'REMOVE_EXTRA_BEAM', id: b.id });
          } else if (!removedBeamIds.includes(b.id)) {
            dispatch({ type: 'TOGGLE_BEAM_REMOVAL', beamId: b.id });
          }
          items.push(`جسر ${b.id} (مكرر مع ${sorted[sorted.length - 1].id})`);
        }
      }
    }

    // ---- فحص الأعمدة المكررة ----
    const colGroups = new Map<string, typeof columns>();
    for (const c of columns.filter(c2 => !c2.isRemoved)) {
      const key = `${c.storyId || ''}|${c.x.toFixed(2)},${c.y.toFixed(2)}`;
      if (!colGroups.has(key)) colGroups.set(key, []);
      colGroups.get(key)!.push(c);
    }
    for (const [, group] of colGroups) {
      if (group.length > 1) {
        const sorted = [...group].sort((a, b) => getNum(a.id) - getNum(b.id));
        const toRemove = sorted.slice(0, -1);
        for (const c of toRemove) {
          const isExtra = extraColumns.some(ec => ec.id === c.id);
          if (isExtra) {
            dispatch({ type: 'REMOVE_EXTRA_COLUMN', id: c.id });
          } else if (!removedColumnIds.includes(c.id)) {
            dispatch({ type: 'TOGGLE_COLUMN_REMOVAL', colId: c.id });
          }
          items.push(`عمود ${c.id} (مكرر مع ${sorted[sorted.length - 1].id})`);
        }
      }
    }

    // ---- فحص النقاط المكررة في ModelManager ----
    const allNodes = modelManager.getAllNodes();
    const nodeDups: number[] = [];
    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const ni = allNodes[i], nj = allNodes[j];
        const dist = Math.sqrt((ni.x - nj.x) ** 2 + (ni.y - nj.y) ** 2 + (ni.z - nj.z) ** 2);
        if (dist < EPS && !nodeDups.includes(ni.id)) {
          nodeDups.push(ni.id);
          items.push(`نقطة N${ni.id} مكررة مع N${nj.id}`);
        }
      }
    }
    for (const nid of nodeDups) {
      modelManager.deleteNode(nid);
    }
    if (nodeDups.length > 0) dispatch({ type: 'INC_MODEL_VERSION' });

    const count = items.length;
    if (count === 0) {
      setDupCheckResult({ message: '✅ لا توجد عناصر مكررة في النموذج', count: 0, items: [] });
    } else {
      dispatch({ type: 'RESET_ANALYSIS' });
      dispatch({ type: 'INC_MODEL_VERSION' });
      setDupCheckResult({ message: `تم حذف ${count} عنصر مكرر بنجاح`, count, items });
    }
  }, [slabs, beamsWithLoads, columns, extraBeams, extraColumns, removedBeamIds, removedColumnIds]);

  const handleAnalysisElementClick = useCallback((beamId: string) => {
    const design = beamDesigns.find(d => d.beamId === beamId);
    const beam = beamsWithLoads.find(b => b.id === beamId);
    if (!design || !beam) return;
    const wu = 1.2 * beam.deadLoad + 1.6 * beam.liveLoad;

    // Determine moment release (hinge) status at each end — يدوي فقط من محرر الإصدارات
    let hingeLeft = false;
    let hingeRight = false;
    const releaseState = getBeamReleaseState(beam);
    if (releaseState.nodeI.rz) hingeLeft  = true;
    if (releaseState.nodeJ.rz) hingeRight = true;

    // Carrier-beam point load (from BOB connections on this beam as primary)
    const carrierConn = bobConnections.find(c => c.primaryBeamId === beamId);
    const contConn = bobConnections.find(c => c.continuationBeamId === beamId);
    // Determine if this beam is part of a carrier girder split into segments
    const isCarrierLeft = !!(carrierConn && carrierConn.continuationBeamId); // A1: right end connects to A2
    const isCarrierRight = !!contConn; // A2: left end connects to A1

    // Calculate total girder span for carrier beams
    let totalGirderSpan: number | undefined;
    if (carrierConn && carrierConn.continuationBeamId) {
      const contBeam = beamsWithLoads.find(b => b.id === carrierConn.continuationBeamId);
      if (contBeam) totalGirderSpan = design.span + contBeam.length / 1000;
    } else if (contConn) {
      const primaryBeam = beamsWithLoads.find(b => b.id === contConn.primaryBeamId);
      if (primaryBeam) totalGirderSpan = primaryBeam.length / 1000 + design.span;
    }

    dispatch({
      type: 'OPEN_DIAGRAM',
      data: {
        elementId: beamId,
        elementType: 'beam' as const,
        span: design.span,
        Mleft: hingeLeft  ? 0 : design.Mleft,
        Mmid:  design.Mmid,
        Mright: hingeRight ? 0 : design.Mright,
        Vu: design.Vu,
        deflection: design.deflection.deflection,
        wu,
        Rleft:  design.Rleft,
        Rright: design.Rright,
        hingeLeft,
        hingeRight,
        isCarrierLeft,
        isCarrierRight,
        totalGirderSpan,
        // Point-load info for carrier beams (distanceOnPrimary is in metres)
        ...(carrierConn ? {
          pointLoadP: carrierConn.reactionForce,
          pointLoadA: carrierConn.distanceOnPrimary,
        } : {}),
      },
    });
  }, [beamDesigns, beamsWithLoads, detectedConnections, bobConnections, getBeamReleaseState]);

  const currentNodes = modelManager.getAllNodes();
  const currentFrames = modelManager.getAllFrames();
  const currentAreas = modelManager.getAllAreas();
  const modelStats = modelManager.getStats();

  // Handle long-press from LevelPlanView (maps string element IDs to frame/area numeric IDs)
  const handleLevelElementLongPress = useCallback((type: 'beam' | 'column' | 'slab', id: string) => {
    if (type === 'slab') {
      const area = currentAreas.find(a => a.label === id || `A${a.id}` === id);
      if (area) dispatch({ type: 'OPEN_ELEM_PROPS', areaId: area.id });
    } else {
      const frame = currentFrames.find(f => {
        if (f.type === type) {
          const label = type === 'beam' ? `B${f.id}` : `C${f.id}`;
          return f.label === id || label === id || f.id.toString() === id;
        }
        return false;
      });
      if (frame) dispatch({ type: 'OPEN_ELEM_PROPS', frameId: frame.id });
    }
  }, [currentFrames, currentAreas]);

  // Build mapping from ModelManager column frame IDs to column labels (C1, C2...)
  // Filter by selected story so labels update when switching stories
  const columnLabels = useMemo(() => {
    const labelMap = new Map<number, string>();
    const columnFrames = currentFrames.filter(f => f.type === 'column');
    // Filter columns by selected story (or all)
    const storyCols = isAllStories ? columns : columns.filter(c => c.storyId === selectedStoryId);
    for (const frame of columnFrames) {
      const topNode = currentNodes.find(n => n.id === frame.nodeJ);
      if (!topNode) continue;
      const matchingCol = storyCols.find(c => 
        Math.abs(c.x - topNode.x) < 0.01 && Math.abs(c.y - topNode.y) < 0.01
      );
      if (matchingCol) {
        labelMap.set(frame.id, matchingCol.id);
      }
    }
    return labelMap;
  }, [currentFrames, currentNodes, columns, selectedStoryId, isAllStories]);

  const handleSelectElement = (type: 'beam' | 'column' | 'slab', id: string) => {
    dispatch({ type: 'OPEN_MODAL', element: { type, id } });
  };

  // Helper: get bent-up-adjusted top bars for a beam
  const getBentUpData = (beamId: string) => {
    for (const fr of bentUpResults) {
      const b = fr.beams.find(bb => bb.beamId === beamId);
      if (b) return b;
    }
    return null;
  };

  const getModalData = () => {
    if (!selectedElement) return null;
    const { type, id } = selectedElement;
    if (type === 'beam') {
      const beam = beamsWithLoads.find(b => b.id === id);
      const design = beamDesigns.find(d => d.beamId === id);
      if (!beam) return null;
      const bent = getBentUpData(id);
      const topDia = design ? design.flexLeft.dia : 12;
      // Use bent-up adjusted bars if available
      const topLeftBars = bent ? Math.max(bent.additionalTopLeft, 2) : (design ? design.flexLeft.bars : 3);
      const topRightBars = bent ? Math.max(bent.additionalTopRight, 2) : (design ? design.flexRight.bars : 3);
      const finalTopBars = bent ? bent.finalTopBars : Math.max(topLeftBars, topRightBars);
      const bottomMidBars = design ? design.flexMid.bars : 3;
      const bottomDia = design ? design.flexMid.dia : 12;
      const remainingBottom = bent ? bent.bentUp.remainingBottomBars : bottomMidBars;
      return {
        dimensions: { b: beam.b, h: beam.h, length: beam.length * 1000 },
        reinforcement: design ? {
          top: { bars: finalTopBars, dia: topDia },
          bottom: { bars: bottomMidBars, dia: bottomDia },
          topLeft: { bars: topLeftBars, dia: topDia },
          topRight: { bars: topRightBars, dia: topDia },
          topMid: { bars: 2, dia: topDia },
          bottomMid: { bars: bottomMidBars, dia: bottomDia },
          bottomSupport: { bars: remainingBottom, dia: bottomDia },
          bentUpBars: bent ? bent.bentUp.bentBarsCount : 0,
          bentUpDia: bent ? bent.bentUp.bentDia : 0,
          stirrups: design.shear.stirrups,
        } : { top: { bars: 3, dia: 12 }, bottom: { bars: 3, dia: 12 }, stirrups: 'Φ10@200mm' },
      };
    }
    if (type === 'column') {
      const col = colDesigns.find(c => c.id === id);
      if (!col) return null;
      return {
        dimensions: { b: col.b, h: col.h, length: col.L },
        reinforcement: { top: { bars: col.design.bars, dia: col.design.dia }, stirrups: col.design.stirrups },
      };
    }
    if (type === 'slab') {
      const slab = slabDesigns.find(s => s.id === id);
      if (!slab) return null;
      return {
        dimensions: { b: Math.abs(slab.x2 - slab.x1) * 1000, h: Math.abs(slab.y2 - slab.y1) * 1000 },
        reinforcement: { shortDir: slab.design.shortDir, longDir: slab.design.longDir },
      };
    }
    return null;
  };

  const modalData = getModalData();

  // ParamInput moved outside component to prevent focus loss

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <AppHeader 
        title="Structural Master"
        leftSlot={
          <div className="w-9 h-9 rounded-xl bg-primary-foreground/20 flex items-center justify-center shrink-0">
            <Building2 size={18} />
          </div>
        }
        rightSlot={
          <div className="flex items-center gap-2">
            <button className="w-8 h-8 rounded-lg bg-primary-foreground/10 flex items-center justify-center">
              <Search size={16} />
            </button>
            <div className="w-8 h-8 rounded-full bg-primary-foreground/20 flex items-center justify-center text-xs font-bold">
              <Compass size={16} />
            </div>
          </div>
        }
      />

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={tab => dispatch({ type: 'SET_ACTIVE_TAB', tab })} className="h-full flex flex-col">
          
          {/* Sub-tabs within each main section */}
          {mainTab === 'reports' && (
            <TabsList className="w-full justify-start rounded-none border-b border-border bg-card px-2 overflow-x-auto shrink-0 h-auto">
              <TabsTrigger value="design" className="text-xs gap-1 min-h-[40px]"><Ruler size={14} />التصميم</TabsTrigger>
              <TabsTrigger value="results" className="text-xs gap-1 min-h-[40px]"><BarChart3 size={14} />النتائج</TabsTrigger>
              <TabsTrigger value="export" className="text-xs gap-1 min-h-[40px]"><Download size={14} />التصدير</TabsTrigger>
            </TabsList>
          )}
          {mainTab === 'inputs' && (
            <TabsList className="w-full justify-start rounded-none border-b border-border bg-card px-2 overflow-x-auto shrink-0 h-auto">
              <TabsTrigger value="input" className="text-xs gap-1 min-h-[40px]"><Settings2 size={14} />المدخلات</TabsTrigger>
              <TabsTrigger value="slabs" className="text-xs gap-1 min-h-[40px]"><Layers size={14} />الإدخال</TabsTrigger>
              <TabsTrigger value="building" className="text-xs gap-1 min-h-[40px]"><Building size={14} />مبنى متعدد</TabsTrigger>
            </TabsList>
          )}
          {mainTab === 'modeling' && (
            <TabsList className="w-full justify-start rounded-none border-b border-border bg-card px-2 overflow-x-auto shrink-0 h-auto">
              <TabsTrigger value="modeler" className="text-xs gap-1 min-h-[40px]"><Grid3X3 size={14} />النمذجة</TabsTrigger>
              <TabsTrigger value="view" className="text-xs gap-1 min-h-[40px]"><Eye size={14} />العرض</TabsTrigger>
              <TabsTrigger value="analysis" className="text-xs gap-1 min-h-[40px]"><Calculator size={14} />التحليل</TabsTrigger>
            </TabsList>
          )}

          {/* MODELER TAB */}
          <TabsContent value="modeler" className="flex-1 overflow-hidden mt-0">
            <div className="flex flex-col h-full">
              {/* Level filter bar */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 shrink-0">
                <Layers size={14} className="text-muted-foreground" />
                <label className="text-xs font-medium text-muted-foreground">فلتر المنسوب:</label>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={modelerElevation}
                  onChange={e => setModelerElevation(Number(e.target.value))}
                >
                  <option value={-1}>الكل (مسقط أفقي)</option>
                  {availableElevations.map(elev => (
                    <option key={elev} value={elev}>
                      المنسوب {(elev / 1000).toFixed(1)} م
                      {elev === 0 ? ' (الأرض / الركائز)' : ''}
                    </option>
                  ))}
                </select>
                {modelerElevation >= 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {modelerElevation === 0 ? 'مسقط الأساسات' : `المنسوب ${(modelerElevation / 1000).toFixed(1)} م`}
                  </Badge>
                )}
              </div>

              {/* Show support plan view when ground level or specific elevation selected */}
              {modelerElevation >= 0 ? (
                <div className="flex-1 overflow-hidden">
                  <LevelPlanView
                    columns={columns}
                    beams={beamsWithLoads}
                    slabs={slabs}
                    stories={stories}
                    selectedElevation={modelerElevation}
                    onColumnSupportChange={handleColumnSupportChange}
                    onSupportRestraintsChange={handleSupportRestraintsChange}
                    supportRestraints={supportRestraints}
                    onElementLongPress={handleLevelElementLongPress}
                    onDeleteElement={handleLevelElementDelete}
                  />
                </div>
              ) : (
                <div className="flex flex-1 overflow-hidden">
                  <ToolPalette
                    activeTool={activeTool}
                    onToolChange={tool => dispatch({ type: 'SET_ACTIVE_TOOL', tool })}
                    mode={mode}
                    onModeChange={(m) => dispatch({ type: 'SET_MODE', mode: m })}
                  />
                  <ModelCanvas
                    nodes={currentNodes}
                    frames={currentFrames}
                    areas={currentAreas}
                    activeTool={activeTool}
                    onCanvasClick={handleCanvasClick}
                    onNodeClick={handleNodeClick}
                    onFrameClick={handleFrameClick}
                    onAreaClick={handleAreaClick}
                    onFrameLongPress={handleFrameLongPress}
                    onAreaLongPress={handleAreaLongPress}
                    selectedNodeId={selectedNodeId}
                    selectedFrameId={selectedFrameId}
                    selectedAreaId={selectedAreaId}
                    pendingNode={pendingNode}
                    columnLabels={columnLabels}
                    frameEndReleases={frameEndReleases}
                  />
                  <PropertyPanel
                    selectedNode={selectedNodeId ? currentNodes.find(n => n.id === selectedNodeId) : null}
                    selectedFrame={selectedFrameId ? currentFrames.find(f => f.id === selectedFrameId) : null}
                    selectedArea={selectedAreaId ? currentAreas.find(a => a.id === selectedAreaId) : null}
                    onNodeRestraintChange={handleNodeRestraintChange}
                    modelStats={modelStats}
                  />
                </div>
              )}
            </div>
          </TabsContent>

          {/* INPUT TAB - with sub-tabs for original + auto-design */}
          <TabsContent value="input" className="flex-1 overflow-hidden mt-0">
            <Tabs defaultValue="input-main" className="h-full flex flex-col">
              <TabsList className="w-full justify-start rounded-none border-b border-border bg-muted/30 px-2 shrink-0 h-auto">
                <TabsTrigger value="input-main" className="text-[11px] gap-1 min-h-[36px]"><Settings2 size={12} />المدخلات</TabsTrigger>
                <TabsTrigger value="input-auto" className="text-[11px] gap-1 min-h-[36px] text-accent"><Wand2 size={12} />تصميم تلقائي</TabsTrigger>
              </TabsList>
              <TabsContent value="input-main" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <div className="space-y-4 max-w-4xl">
                  {/* Story Management */}
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">إدارة الأدوار</CardTitle></CardHeader>
                    <CardContent>
                      <StoryManager
                        stories={stories}
                        selectedStoryId={selectedStoryId}
                        onSelectStory={id => dispatch({ type: 'SELECT_STORY', storyId: id })}
                        onAddStory={() => dispatch({ type: 'ADD_STORY' })}
                        onRemoveStory={id => dispatch({ type: 'REMOVE_STORY', storyId: id })}
                        onUpdateStory={(id, updates) => dispatch({ type: 'UPDATE_STORY', storyId: id, updates })}
                        onCopyElements={(from, to) => dispatch({ type: 'COPY_STORY_ELEMENTS', fromStoryId: from, toStoryId: to })}
                      />
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">خصائص المواد</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3">
                      <ParamInput label="f'c (MPa)" value={mat.fc} onChange={v => dispatch({ type: 'SET_MAT', mat: { fc: v } })} />
                      <ParamInput label="fy (MPa)" value={mat.fy} onChange={v => dispatch({ type: 'SET_MAT', mat: { fy: v } })} />
                      <ParamInput label="fyt (MPa)" value={mat.fyt} onChange={v => dispatch({ type: 'SET_MAT', mat: { fyt: v } })} />
                      <ParamInput label="γ (kN/m³)" value={mat.gamma} onChange={v => dispatch({ type: 'SET_MAT', mat: { gamma: v } })} />
                    </CardContent>
                    <CardFooter className="pt-2">
                      <Button size="sm" className="w-full h-9 text-xs" onClick={() => dispatch({ type: 'SAVE_SNAPSHOT', message: 'تم حفظ خصائص المواد ✓' })}>
                        <Save size={14} className="mr-1" />حفظ التغييرات
                      </Button>
                    </CardFooter>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">خصائص البلاطة</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3">
                      <ParamInput label="السماكة (مم)" value={slabProps.thickness} onChange={v => dispatch({ type: 'SET_SLAB_PROPS', props: { thickness: v } })} />
                      <ParamInput label="أحمال التشطيب (kN/m²)" value={slabProps.finishLoad} onChange={v => dispatch({ type: 'SET_SLAB_PROPS', props: { finishLoad: v } })} />
                      <ParamInput label="الحمل الحي (kN/m²)" value={slabProps.liveLoad} onChange={v => dispatch({ type: 'SET_SLAB_PROPS', props: { liveLoad: v } })} />
                      <ParamInput label="الغطاء (مم)" value={slabProps.cover} onChange={v => dispatch({ type: 'SET_SLAB_PROPS', props: { cover: v } })} />
                    </CardContent>
                    <CardFooter className="pt-2">
                      <Button size="sm" className="w-full h-9 text-xs" onClick={() => dispatch({ type: 'SAVE_SNAPSHOT', message: 'تم حفظ خصائص البلاطة ✓' })}>
                        <Save size={14} className="mr-1" />حفظ التغييرات
                      </Button>
                    </CardFooter>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">أبعاد العناصر</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-3">
                      <ParamInput label="عرض الجسر (مم)" value={beamB} onChange={v => dispatch({ type: 'SET_BEAM_B', value: v })} />
                      <ParamInput label="ارتفاع الجسر (مم)" value={beamH} onChange={v => dispatch({ type: 'SET_BEAM_H', value: v })} />
                      <ParamInput label="عرض العمود (مم)" value={colB} onChange={v => dispatch({ type: 'SET_COL_B', value: v })} />
                      <ParamInput label="عمق العمود (مم)" value={colH} onChange={v => dispatch({ type: 'SET_COL_H', value: v })} />
                    </CardContent>
                    <CardFooter className="pt-2">
                      <Button size="sm" className="w-full h-9 text-xs" onClick={() => dispatch({ type: 'SAVE_SNAPSHOT', message: 'تم حفظ أبعاد العناصر ✓' })}>
                        <Save size={14} className="mr-1" />حفظ التغييرات
                      </Button>
                    </CardFooter>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">ملخص</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p>{stories.length} أدوار</p>
                      <p>{columns.filter(c => !c.isRemoved).length} أعمدة (لكل دور)</p>
                      <p>{beams.length} جسور (لكل دور)</p>
                      <p>{frames.length} إطارات (لكل دور)</p>
                      <Button onClick={runAnalysis} className="w-full min-h-[44px] mt-2">
                        <Calculator size={16} className="mr-2" />تشغيل التحليل (جميع الأدوار)
                      </Button>
                    </CardContent>
                  </Card>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="input-auto" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <AutoDesignPanel
                  slabs={slabs}
                  onApply={(result: AutoDesignResult) => {
                    dispatch({ type: 'SET_SLAB_PROPS', props: { thickness: result.slabThickness, finishLoad: result.slabProps.finishLoad, liveLoad: result.slabProps.liveLoad } });
                    dispatch({ type: 'SET_BEAM_B', value: result.beamB });
                    dispatch({ type: 'SET_BEAM_H', value: result.beamH });
                    dispatch({ type: 'SET_COL_B', value: result.colB });
                    dispatch({ type: 'SET_COL_H', value: result.colH });
                    dispatch({ type: 'SET_MAT', mat: result.matProps });
                    dispatch({ type: 'SET_COL_L', value: result.slabProps.thickness > 0 ? state.colL : 4000 });
                    dispatch({ type: 'SAVE_SNAPSHOT', message: 'تم تطبيق التصميم التلقائي ✓' });
                  }}
                />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* SLABS / INPUT TAB - with sub-tabs for original + generative + ai-assistant */}
          <TabsContent value="slabs" className="flex-1 overflow-hidden mt-0">
            <Tabs defaultValue="slabs-main" className="h-full flex flex-col">
              <TabsList className="w-full justify-start rounded-none border-b border-border bg-muted/30 px-2 shrink-0 h-auto">
                <TabsTrigger value="slabs-main" className="text-[11px] gap-1 min-h-[36px]"><Layers size={12} />الإدخال</TabsTrigger>
                <TabsTrigger value="slabs-generative" className="text-[11px] gap-1 min-h-[36px] text-accent"><Zap size={12} />تصميم توليدي</TabsTrigger>
                <TabsTrigger value="slabs-ai" className="text-[11px] gap-1 min-h-[36px] text-accent"><Bot size={12} />المساعد الذكي</TabsTrigger>
                <TabsTrigger value="slabs-etabs-import" className="text-[11px] gap-1 min-h-[36px] text-accent"><Upload size={12} />استيراد من ETABS</TabsTrigger>
              </TabsList>
              <TabsContent value="slabs-main" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <div className="space-y-4 max-w-5xl">
                  {/* Story filter for this tab */}
                  <StorySelector
                    stories={stories}
                    selectedStoryId={selectedStoryId}
                    onSelectStory={id => dispatch({ type: 'SELECT_STORY', storyId: id })}
                    onAddStory={() => dispatch({ type: 'ADD_STORY' })}
                    onRemoveStory={id => dispatch({ type: 'REMOVE_STORY', storyId: id })}
                    onUpdateStory={(id, updates) => dispatch({ type: 'UPDATE_STORY', storyId: id, updates })}
                    onCopyElements={(from, to) => dispatch({ type: 'COPY_STORY_ELEMENTS', fromStoryId: from, toStoryId: to })}
                    compact
                  />
                  
                  {/* Slabs table */}
                  <Card>
                    <CardHeader className="pb-2 flex-row items-center justify-between">
                      <CardTitle className="text-sm">إحداثيات البلاطات (م) - {isAllStories ? 'جميع الأدوار' : getStoryLabel(selectedStoryId)}</CardTitle>
                      <Button onClick={() => dispatch({ type: 'ADD_SLAB', slab: { id: `S${slabs.length + 1}`, x1: 0, y1: 0, x2: 5, y2: 4, storyId: selectedStoryId === '__ALL__' ? stories[0]?.id : selectedStoryId } })} size="sm" variant="outline" className="min-h-[44px] gap-1"><Plus size={14} /> إضافة بلاطة</Button>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {[...(isAllStories ? ['الدور'] : []),'الاسم','X1','Y1','X2','Y2','المنسوب Z (م)','Lx','Ly','النوع','حذف'].map(h => (
                              <TableHead key={h} className="text-xs">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {storyFilteredSlabs.map((s) => {
                            const i = slabs.indexOf(s);
                            const sd = slabDesigns.find(sd => sd.id === s.id)?.design;
                            return (
                              <TableRow key={`${s.storyId}-${s.id}`}>
                                {isAllStories && <TableCell className="text-xs font-medium text-muted-foreground">{getStoryLabel(s.storyId)}</TableCell>}
                                <TableCell><Input value={s.id} onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'id', value: e.target.value })} className="h-10 w-16 font-mono text-xs" /></TableCell>
                                <TableCell><Input type="number" value={s.x1} onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'x1', value: e.target.value })} className="h-10 w-16 font-mono text-xs" /></TableCell>
                                <TableCell><Input type="number" value={s.y1} onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'y1', value: e.target.value })} className="h-10 w-16 font-mono text-xs" /></TableCell>
                                <TableCell><Input type="number" value={s.x2} onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'x2', value: e.target.value })} className="h-10 w-16 font-mono text-xs" /></TableCell>
                                <TableCell><Input type="number" value={s.y2} onChange={e => dispatch({ type: 'UPDATE_SLAB', index: i, key: 'y2', value: e.target.value })} className="h-10 w-16 font-mono text-xs" /></TableCell>
                                <TableCell className="font-mono text-xs">{((stories.find(st => st.id === s.storyId)?.elevation ?? 0) + (stories.find(st => st.id === s.storyId)?.height ?? colL)).toFixed(0)}</TableCell>
                                <TableCell className="font-mono text-xs">{sd?.lx.toFixed(1)}</TableCell>
                                <TableCell className="font-mono text-xs">{sd?.ly.toFixed(1)}</TableCell>
                                <TableCell className="text-xs">{sd?.isOneWay ? 'اتجاه واحد' : 'اتجاهين'}</TableCell>
                                <TableCell><Button onClick={() => dispatch({ type: 'REMOVE_SLAB', index: i })} variant="ghost" size="sm" className="text-destructive h-10 w-10 p-0"><Trash2 size={14} /></Button></TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {/* Generate Beams Button */}
                  <Card>
                    <CardContent className="py-3">
                      <Button 
                        onClick={() => dispatch({ type: 'GENERATE_BEAMS_MANUAL' })} 
                        className="w-full min-h-[44px] gap-2"
                        variant="outline"
                      >
                        <Wand2 size={16} />إنشاء الجسور تلقائياً
                      </Button>
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        ينشئ الجسور بناءً على مواقع الأعمدة والبلاطات الحالية
                      </p>
                    </CardContent>
                  </Card>

                  {/* Beams table - Editable with Wall Loads */}
                  <Card>
                    <CardHeader className="pb-2 space-y-2">
                      <div className="flex flex-row items-center justify-between">
                        <CardTitle className="text-sm">الجسور ({beams.length})</CardTitle>
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
                          const id = `BM${extraBeams.length + 1}`;
                          dispatch({ type: 'ADD_EXTRA_BEAM', beam: {
                            id, fromCol: '', toCol: '', x1: 0, y1: 0, x2: 5, y2: 0,
                            length: 5, direction: 'horizontal', b: beamB, h: beamH,
                            deadLoad: 0, liveLoad: 0, wallLoad: 0, slabs: [],
                          }});
                        }}><Plus size={14} className="mr-1" />إضافة جسر</Button>
                      </div>
                      {/* Merge & Intersect toolbar */}
                      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                        <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={selectAllBeams}>
                          <CheckSquare size={12} />تحديد الكل
                        </Button>
                        {selectedBeamIds.size > 0 && (
                          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={clearBeamSelection}>
                            إلغاء التحديد ({selectedBeamIds.size})
                          </Button>
                        )}
                        <Button
                          size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                          disabled={selectedBeamIds.size < 2}
                          onClick={handleMergeBeams}
                        >
                          <Merge size={12} />دمج المستقيمة
                        </Button>
                        <Button
                          size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                          onClick={handleIntersect}
                        >
                          <Crosshair size={12} />Intersect
                        </Button>
                        {selectedBeamIds.size > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
                            محدد: {selectedBeamIds.size} جسر
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {['✓','الجسر','عقدة البداية','عقدة النهاية','X1','Y1','X2','Y2','المنسوب Z','الطول','العرض','الارتفاع','حمل جدار (kN/m)','تحرير الأطراف','حذف'].map(h => (
                              <TableHead key={h} className="text-xs">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {beams.filter(b => !removedBeamIds.includes(b.id)).map(b => {
                            const isExtra = extraBeams.some(eb => eb.id === b.id);
                            const wallLoad = beamOverrides[b.id]?.wallLoad || b.wallLoad || 0;
                            const releaseState = getBeamReleaseState(b);
                            const hasRelease = Object.values(releaseState.nodeI).some(Boolean) || Object.values(releaseState.nodeJ).some(Boolean);
                            const releasedEndsCount = Number(Object.values(releaseState.nodeI).some(Boolean)) + Number(Object.values(releaseState.nodeJ).some(Boolean));
                            return (
                            <TableRow key={b.id} className={selectedBeamIds.has(b.id) ? 'bg-primary/10' : ''}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedBeamIds.has(b.id)}
                                  onCheckedChange={() => toggleBeamSelection(b.id)}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-xs">{b.id}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{getBeamNodeId(b.x1, b.y1, b.z ?? 0)}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{getBeamNodeId(b.x2, b.y2, b.z ?? 0)}</TableCell>
                              <TableCell>
                                <Input type="number" value={b.x1} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { x1: val } });
                                    else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { x1: val } });
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={b.y1} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { y1: val } });
                                    else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { y1: val } });
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={b.x2} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { x2: val } });
                                    else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { x2: val } });
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={b.y2} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { y2: val } });
                                    else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { y2: val } });
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={b.z ?? 0} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { z: val } });
                                    else dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { z: val } });
                                  }} />
                              </TableCell>
                              <TableCell className="font-mono text-xs">{b.length.toFixed(2)}</TableCell>
                              <TableCell>
                                <Input type="number" value={b.b} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { b: val } });
                                    } else {
                                      dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { b: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={b.h} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { h: val } });
                                    } else {
                                      dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { h: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={wallLoad} className="h-8 w-20 font-mono text-xs"
                                  placeholder="0"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_BEAM', id: b.id, updates: { wallLoad: val } });
                                    } else {
                                      dispatch({ type: 'SET_BEAM_OVERRIDE', beamId: b.id, override: { wallLoad: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <div className="flex min-w-[150px] items-center gap-2">
                                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => openBeamReleaseEditor(b)}>
                                    تحرير
                                  </Button>
                                  <Badge variant={hasRelease ? 'default' : 'outline'} className="text-[10px] whitespace-nowrap">
                                    {hasRelease ? `محرر ${releasedEndsCount}/2` : 'بدون تحرير'}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Button onClick={() => {
                                    if (isExtra) {
                                      dispatch({ type: 'REMOVE_EXTRA_BEAM', id: b.id });
                                    } else {
                                      dispatch({ type: 'TOGGLE_BEAM_REMOVAL', beamId: b.id });
                                    }
                                  }}
                                    variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0"><Trash2 size={14} /></Button>
                              </TableCell>
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {/* ── Nodes Table (derived from model) ── */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">نقاط النموذج (العقد)</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      {(() => {
                        // Build unique nodes from columns and beams
                        const nodeMap = new Map<string, { id: string; x: number; y: number; z: number; elements: string[] }>();
                        const tol = 0.001; // m tolerance
                        const getKey = (x: number, y: number, z: number) =>
                          `${Math.round(x / tol) * tol},${Math.round(y / tol) * tol},${Math.round(z / tol) * tol}`;

                        // Add nodes from active columns
                        for (const c of columns.filter(cc => !cc.isRemoved)) {
                          const zTop = ((c.zTop ?? 0) / 1000);
                          const zBot = ((c.zBottom ?? 0) / 1000);
                          const keyTop = getKey(c.x, c.y, zTop);
                          const keyBot = getKey(c.x, c.y, zBot);
                          if (!nodeMap.has(keyTop)) nodeMap.set(keyTop, { id: `N-${nodeMap.size + 1}`, x: c.x, y: c.y, z: zTop, elements: [] });
                          nodeMap.get(keyTop)!.elements.push(c.id);
                          if (!nodeMap.has(keyBot)) nodeMap.set(keyBot, { id: `N-${nodeMap.size + 1}`, x: c.x, y: c.y, z: zBot, elements: [] });
                          nodeMap.get(keyBot)!.elements.push(c.id);
                        }

                        // Add nodes from active beams
                        for (const b of beams.filter(bb => !removedBeamIds.includes(bb.id))) {
                          const bz = ((b.z ?? 0) / 1000);
                          const key1 = getKey(b.x1, b.y1, bz);
                          const key2 = getKey(b.x2, b.y2, bz);
                          if (!nodeMap.has(key1)) nodeMap.set(key1, { id: `N-${nodeMap.size + 1}`, x: b.x1, y: b.y1, z: bz, elements: [] });
                          nodeMap.get(key1)!.elements.push(b.id);
                          if (!nodeMap.has(key2)) nodeMap.set(key2, { id: `N-${nodeMap.size + 1}`, x: b.x2, y: b.y2, z: bz, elements: [] });
                          nodeMap.get(key2)!.elements.push(b.id);
                        }

                        const modelNodes = [...nodeMap.values()];
                        // Re-number
                        modelNodes.forEach((n, i) => { n.id = `N${i + 1}`; });

                        return (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {['العقدة', 'X (م)', 'Y (م)', 'Z (م)', 'العناصر المتصلة'].map(h => (
                                  <TableHead key={h} className="text-xs">{h}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {modelNodes.map(n => (
                                <TableRow key={n.id}>
                                  <TableCell className="font-mono text-xs font-semibold">{n.id}</TableCell>
                                  <TableCell className="font-mono text-xs">{n.x.toFixed(2)}</TableCell>
                                  <TableCell className="font-mono text-xs">{n.y.toFixed(2)}</TableCell>
                                  <TableCell className="font-mono text-xs">{n.z.toFixed(2)}</TableCell>
                                  <TableCell className="text-xs">{n.elements.join(', ')}</TableCell>
                                </TableRow>
                              ))}
                              {modelNodes.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                                    لا توجد نقاط — أضف بلاطات وأعمدة أولاً
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  {/* Columns table - Editable */}
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">الأعمدة ({columns.filter(c => !c.isRemoved).length})</CardTitle>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
                        const id = `CM${extraColumns.length + 1}`;
                        dispatch({ type: 'ADD_EXTRA_COLUMN', column: { id, x: 0, y: 0, b: colB, h: colH, L: colL } });
                      }}><Plus size={14} className="mr-1" />إضافة عمود</Button>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                             {['العمود','X','Y','Z أسفل','Z أعلى','العرض','العمق','الارتفاع','الحالة','إزالة/استعادة','حذف'].map(h => (
                               <TableHead key={h} className="text-xs">{h}</TableHead>
                             ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {columns.map(c => {
                            const isExtra = extraColumns.some(ec => ec.id === c.id);
                            return (
                            <TableRow key={c.id} className={c.isRemoved ? 'opacity-40' : ''}>
                              <TableCell className="font-mono text-xs">{c.id}</TableCell>
                              <TableCell>
                                <Input type="number" value={c.x} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { x: val } });
                                    else dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { x: val } });
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={c.y} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { y: val } });
                                    else dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { y: val } });
                                  }} />
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {(c.zBottom ?? 0).toFixed(0)}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {(c.zTop ?? 0).toFixed(0)}
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={c.b} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { b: val } });
                                    } else {
                                      dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { b: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={c.h} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { h: val } });
                                    } else {
                                      dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { h: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Input type="number" value={c.L} className="h-8 w-16 font-mono text-xs"
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isExtra) {
                                      dispatch({ type: 'UPDATE_EXTRA_COLUMN', id: c.id, updates: { L: val } });
                                    } else {
                                      dispatch({ type: 'SET_COL_OVERRIDE', colId: c.id, override: { L: val } });
                                    }
                                  }} />
                              </TableCell>
                              <TableCell>
                                <Badge variant={c.isRemoved ? "destructive" : "default"} className="text-[10px]">
                                  {c.isRemoved ? 'محذوف' : 'فعال'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {!isExtra && (
                                  <Button onClick={() => dispatch({ type: 'TOGGLE_COLUMN_REMOVAL', colId: c.id })} variant="ghost" size="sm" className="h-8 text-xs">
                                    {c.isRemoved ? 'استعادة' : 'إزالة'}
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell>
                                {isExtra && (
                                  <Button onClick={() => dispatch({ type: 'REMOVE_EXTRA_COLUMN', id: c.id })}
                                    variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0"><Trash2 size={14} /></Button>
                                )}
                              </TableCell>
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
              <TabsContent value="slabs-generative" className="flex-1 overflow-hidden mt-0">
                <GenerativeDesignDashboard
                  onApplyOption={(ev: EvaluatedOption) => {
                    dispatch({
                      type: 'APPLY_GENERATIVE',
                      slabs: (ev.option.slabs?.length ? ev.option.slabs : slabs) as Slab[],
                      beamB: ev.option.sections.beamB,
                      beamH: ev.option.sections.beamH,
                      colB: ev.option.sections.colB,
                      colH: ev.option.sections.colH,
                    });
                  }}
                />
              </TabsContent>
              <TabsContent value="slabs-ai" className="flex-1 overflow-hidden mt-0">
                <AIAssistantPanel
                  onModelGenerated={(newSlabs) => {
                    dispatch({ type: 'SET_SLABS', slabs: newSlabs });
                    dispatch({ type: 'SET_MODE', mode: 'auto' });
                    dispatch({ type: 'SET_ACTIVE_TAB', tab: 'modeler' });
                  }}
                  onClose={() => dispatch({ type: 'SET_ACTIVE_TAB', tab: 'modeler' })}
                />
              </TabsContent>
              <TabsContent value="slabs-etabs-import" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <ETABSFullImportPanel onApply={(data) => {
                  // Convert imported ETABS data to app model
                  const nodeMap = new Map(data.nodes.map(n => [n.id, n]));
                  
                  // Create stories from unique story names
                  const storyNames = new Set<string>();
                  data.beams.forEach(b => storyNames.add(b.story));
                  data.columns.forEach(c => storyNames.add(c.story));
                  data.slabs.forEach(s => storyNames.add(s.story));
                  
                  // Convert slabs using node coordinates
                  const newSlabs: Slab[] = [];
                  for (const s of data.slabs) {
                    if (s.nodes.length >= 4) {
                      const coords = s.nodes.map(nId => nodeMap.get(nId)).filter(Boolean);
                      if (coords.length >= 4) {
                        const xs = coords.map(c => c!.x);
                        const ys = coords.map(c => c!.y);
                        newSlabs.push({
                          id: s.id,
                          x1: Math.min(...xs), y1: Math.min(...ys),
                          x2: Math.max(...xs), y2: Math.max(...ys),
                          storyId: stories[0]?.id,
                        });
                      }
                    }
                  }
                  
                  if (newSlabs.length > 0) {
                    dispatch({ type: 'SET_SLABS', slabs: newSlabs });
                    dispatch({ type: 'SET_MODE', mode: 'auto' });
                    dispatch({ type: 'SAVE_SNAPSHOT', message: `تم استيراد ${newSlabs.length} بلاطة و ${data.beams.length} جسر من ETABS ✓` });
                  }
                }} />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* VIEW TAB */}
          <TabsContent value="view" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm">العرض ثنائي الأبعاد</CardTitle>
                  {analyzed && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showViewMoments}
                          onChange={e => setShowViewMoments(e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-[11px]">عرض العزوم</span>
                      </label>
                      {showViewMoments && (
                        <select
                          className="h-7 rounded border border-input bg-background px-2 text-[11px] min-w-[140px]"
                          value={viewMomentEngine}
                          onChange={e => setViewMomentEngine(e.target.value as 'active' | '2d' | '3d' | 'gf')}
                        >
                          <option value="active">المحرك النشط ({ENGINE_LABELS[selectedEngine]})</option>
                          <option value="2d">2D — صلابة المصفوفة</option>
                          <option value="3d">3D — إطارات ثلاثية</option>
                          <option value="gf">Global Frame — إطار عام</option>
                        </select>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!analyzed && <Button onClick={runAnalysis} className="mb-3 min-h-[44px]">تشغيل التحليل</Button>}
                <BuildingView
                  slabs={slabs} beams={beamsWithLoads} columns={columns}
                  analyzed={analyzed}
                  frameResults={
                    !showViewMoments ? frameResults :
                    viewMomentEngine === '2d' ? frameResults2D :
                    viewMomentEngine === '3d' ? frameResults3DRaw :
                    viewMomentEngine === 'gf' ? frameResultsGF :
                    frameResults
                  }
                  beamDesigns={beamDesigns} colDesigns={colDesigns}
                  onSelectElement={handleSelectElement}
                  removedColumnIds={removedColumnIds} bobConnections={bobConnections}
                  showMoments={showViewMoments}
                />
                {analyzed && showViewMoments && (
                  <div className="mt-2 p-2 rounded bg-muted/50 text-[10px] text-muted-foreground">
                    <p><strong>محرك العزوم: {
                      viewMomentEngine === '2d' ? '2D — صلابة المصفوفة' :
                      viewMomentEngine === '3d' ? '3D — إطارات ثلاثية' :
                      viewMomentEngine === 'gf' ? 'Global Frame — إطار عام' :
                      ENGINE_LABELS[selectedEngine]
                    }</strong></p>
                    <p>• الجسور الأفقية: M⁻ فوق الجسر، M⁺ تحت الجسر</p>
                    <p>• الجسور العمودية: M⁻ يمين الجسر، M⁺ يسار الجسر</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ANALYSIS TAB */}
          <TabsContent value="analysis" className="flex-1 overflow-hidden mt-0">
            <Tabs defaultValue="analysis-main" className="flex-1 flex flex-col h-full overflow-hidden">
              <TabsList className="w-full justify-start rounded-none border-b border-border bg-muted/30 px-2 shrink-0 h-auto overflow-x-auto flex-nowrap">
                <TabsTrigger value="analysis-main" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap"><Calculator size={12} />التحليل الرئيسي</TabsTrigger>
                <TabsTrigger value="analysis-compare" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-blue-600 dark:text-blue-400"><BarChart3 size={12} />مقارنة توزيع الأحمال</TabsTrigger>
                <TabsTrigger value="analysis-fem-compare" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-emerald-600 dark:text-emerald-400"><BarChart3 size={12} />Comparison</TabsTrigger>
                <TabsTrigger value="analysis-etabs-import" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-orange-600 dark:text-orange-400"><BarChart3 size={12} />مقارنة ETABS</TabsTrigger>
                <TabsTrigger value="analysis-beam-loads" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-purple-600 dark:text-purple-400"><Ruler size={12} />أحمال الجسور</TabsTrigger>
                <TabsTrigger value="analysis-slab" className="text-[11px] gap-1 min-h-[36px] shrink-0 whitespace-nowrap text-teal-600 dark:text-teal-400"><Layers size={12} />تحليل البلاطات</TabsTrigger>
              </TabsList>
              <TabsContent value="analysis-main" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
            {/* ── Analysis Engine Selector ──────────────────────────────── */}
            <Card className="mb-3 border-blue-200 dark:border-blue-800 bg-blue-500/5">
              <CardContent className="py-3 px-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Zap size={14} className="text-blue-500 shrink-0" />
                  <span className="text-xs font-semibold text-foreground">محرك التحليل</span>
                  <select
                    className="h-8 rounded border border-input bg-background px-2 text-xs flex-1 min-w-[160px] max-w-[240px]"
                    value={selectedEngine}
                    onChange={e => {
                      dispatch({ type: 'SET_ENGINE', engine: e.target.value as EngineType });
                      setFemError(null);
                    }}
                  >
                    <option value="legacy_2d">2D — طريقة صلابة المصفوفة (كلاسيكي)</option>
                    <option value="legacy_3d">3D (Legacy) — إطارات ثلاثية الأبعاد</option>
                    <option value="global_frame">Global Frame — إطار عام مع استمرارية الجسور</option>
                    <option value="unified_core">Unified Core — خط أنابيب كامل (إطارات + قشريات)</option>
                    <option value="fem_coupled">FEM (Coupled) — جسور-بلاطات مقترن</option>
                  </select>
                  <Badge
                    className={`text-[10px] shrink-0 ${
                      selectedEngine === 'fem_coupled'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-400/40'
                        : selectedEngine === 'legacy_2d'
                          ? 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-400/40'
                          : selectedEngine === 'global_frame'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-400/40'
                            : selectedEngine === 'unified_core'
                              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-400/40'
                              : 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-400/40'
                    }`}
                  >
                    {ENGINE_LABELS[selectedEngine]}
                  </Badge>
                  {selectedEngine === 'fem_coupled' && !ignoreSlab && (
                    <span className="text-[10px] text-muted-foreground">
                      يتطلب وجود بلاطات وأعمدة — يستغرق وقتاً أطول
                    </span>
                  )}
                </div>

                {/* ── زر إهمال جساءة البلاطات ── */}
                <div className="mt-3 pt-3 border-t border-border/50">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative mt-0.5">
                      <input
                        type="checkbox"
                        checked={ignoreSlab}
                        onChange={e => dispatch({ type: 'SET_IGNORE_SLAB', value: e.target.checked })}
                        className="sr-only"
                      />
                      <div
                        onClick={() => dispatch({ type: 'SET_IGNORE_SLAB', value: !ignoreSlab })}
                        className={`w-9 h-5 rounded-full transition-colors cursor-pointer flex items-center px-0.5 ${
                          ignoreSlab
                            ? 'bg-amber-500'
                            : 'bg-muted border border-border'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                          ignoreSlab ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">
                          إهمال جساءة البلاطات
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                          ignoreSlab
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-400/40'
                            : 'bg-muted text-muted-foreground border border-border'
                        }`}>
                          {ignoreSlab ? 'مُفعّل' : 'غير مُفعّل'}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                        {ignoreSlab
                          ? '⚠️ البلاطات تنقل الأحمال فقط — الجسور والأعمدة تحمل كل الجساءة (مطابق لـ ETABS "No Slab Stiffness")'
                          : 'البلاطات تُشارك في الجساءة الإنشائية للإطار (التحليل الكامل المقترن)'}
                      </p>
                      {ignoreSlab && selectedEngine === 'fem_coupled' && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 font-medium">
                          ↳ سيُستخدم محرك 3D (إطار نقي) مع أحمال المنطقة التأثيرية
                        </p>
                      )}
                    </div>
                  </label>

                  {/* معاملات تخفيض الجساءة — قابلة للتعديل */}
                  <div className="mt-2 rounded-md bg-blue-500/5 border border-blue-200/50 dark:border-blue-800/50 px-3 py-2">
                    <p className="text-[10px] text-blue-700 dark:text-blue-400 font-semibold mb-1">
                      معاملات تخفيض الجساءة (ACI 318-19 §6.6.3):
                    </p>
                    <div className="grid grid-cols-3 gap-1 text-[10px] text-center">
                      <div className="rounded bg-background border border-border px-1 py-1">
                        <input
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="1.0"
                          value={beamStiffnessFactor}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v >= 0.1 && v <= 1.0) dispatch({ type: 'SET_BEAM_STIFFNESS_FACTOR', value: v });
                          }}
                          className="w-full text-center font-bold text-foreground bg-transparent border-none outline-none text-[11px] p-0"
                        />
                        <div className="text-muted-foreground">جسور</div>
                      </div>
                      <div className="rounded bg-background border border-border px-1 py-1">
                        <input
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="1.0"
                          value={colStiffnessFactor}
                          onChange={e => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v >= 0.1 && v <= 1.0) dispatch({ type: 'SET_COL_STIFFNESS_FACTOR', value: v });
                          }}
                          className="w-full text-center font-bold text-foreground bg-transparent border-none outline-none text-[11px] p-0"
                        />
                        <div className="text-muted-foreground">أعمدة</div>
                      </div>
                      <div className={`rounded border px-1 py-1 ${ignoreSlab ? 'bg-amber-500/10 border-amber-400/40' : 'bg-background border-border'}`}>
                        <div className={`font-bold ${ignoreSlab ? 'text-amber-600 dark:text-amber-400 line-through' : 'text-foreground'}`}>
                          {ignoreSlab ? '0' : '0.25'}
                        </div>
                        <div className="text-muted-foreground">بلاطات</div>
                      </div>
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-1">
                      غيّر القيم أعلاه للتحكم بجساءة الجسور والأعمدة عند التحليل
                    </p>
                  </div>
                </div>

                {femError && (
                  <div className="mt-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
                    ⚠️ {femError}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── تصدير عزوم 7 محطات (خام) من جميع المحركات ────────────── */}
            <Card className="mb-3 border-indigo-200 dark:border-indigo-800 bg-indigo-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Download size={14} className="text-indigo-500" />
                  تصدير عزوم 7 محطات (خام بدون معالجة)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  يصدّر العزوم عند 7 محطات (0, L/6, 2L/6, L/2, 4L/6, 5L/6, L) لكل جسر
                  من جميع المحركات (2D, 3D, GF, UC, FEM) <b>كما أنتجها المحرك تماماً</b> —
                  بدون قلب إشارة، وبدون فرض موجب في الوسط أو سالب عند الركيزة، وبدون قيمة مطلقة.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!analyzed}
                  onClick={() => {
                    const engines: EngineRawStations[] = [];
                    if (frameResults2D.length)    engines.push({ engine: '2D',  data: extractRawStations(frameResults2D,    beamsWithLoads) });
                    if (frameResults3DRaw.length) engines.push({ engine: '3D',  data: extractRawStations(frameResults3DRaw, beamsWithLoads) });
                    if (frameResultsGF.length)    engines.push({ engine: 'GF',  data: extractRawStations(frameResultsGF,    beamsWithLoads) });
                    if (frameResultsUC.length)    engines.push({ engine: 'UC',  data: extractRawStations(frameResultsUC,    beamsWithLoads) });
                    if (selectedEngine === 'fem_coupled' && frameResults.length) {
                      engines.push({ engine: 'FEM', data: extractRawStations(frameResults, beamsWithLoads) });
                    }
                    const csv = buildRawStationsCSV(engines);
                    const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    downloadCSV(`raw_moment_stations_${ts}.csv`, csv);
                  }}
                  className="w-full min-h-[40px]"
                >
                  <Download size={14} className="mr-2" />
                  تصدير CSV — عزوم 7 محطات لكل جسر (كل المحركات)
                </Button>
                {!analyzed && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                    ⚠️ يجب تشغيل التحليل أولاً
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Duplicate Check Card - always visible */}
            <Card className="mb-3 border-orange-200 dark:border-orange-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Search size={14} className="text-orange-500" />
                  فحص تكرار العناصر
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  يفحص هذا الأداء وجود جسور أو أعمدة أو بلاطات أو نقاط متكررة (نفس الإحداثيات)، ويحذف العنصر الأقدم تسمية تلقائياً ويُبقي الأحدث.
                </p>
                {dupCheckResult && (
                  <div className={`rounded-lg p-3 text-xs space-y-1 ${dupCheckResult.count === 0 ? 'bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400' : 'bg-orange-500/10 border border-orange-500/30 text-orange-800 dark:text-orange-300'}`}>
                    <p className="font-semibold">{dupCheckResult.message}</p>
                    {dupCheckResult.items.length > 0 && (
                      <ul className="mt-1 space-y-0.5 list-disc list-inside text-[11px] text-muted-foreground">
                        {dupCheckResult.items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <Button
                  onClick={checkAndRemoveDuplicates}
                  variant="outline"
                  className="w-full min-h-[44px] border-orange-300 text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-700 dark:hover:bg-orange-950"
                >
                  <Search size={14} className="mr-2" />
                  فحص التكرارات وحذفها
                </Button>
              </CardContent>
            </Card>

            {/* ── بطاقة التحقق من النموذج (Pre-Analysis Validation) ── */}
            <Card className="mb-3 border-teal-200 dark:border-teal-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckSquare size={14} className="text-teal-500" />
                  التحقق من سلامة النموذج
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  يفحص: العقد المكررة، العناصر الصفرية الطول، الاتصالية، الاستقرار، والعقد المعلقة.
                </p>
                {validationReport && (
                  <div className={`rounded-lg p-3 text-xs space-y-2 ${
                    validationReport.status === 'ok'
                      ? 'bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400'
                      : validationReport.status === 'warning'
                        ? 'bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300'
                        : 'bg-destructive/10 border border-destructive/30 text-destructive'
                  }`}>
                    <p className="font-semibold">
                      {validationReport.status === 'ok' ? '✅ النموذج سليم — جاهز للتحليل' :
                       validationReport.status === 'warning' ? '⚠️ النموذج به تحذيرات' :
                       '❌ النموذج به أخطاء تمنع التحليل'}
                    </p>
                    <div className="text-[10px] text-muted-foreground">
                      العقد المدمجة: {validationReport.mergedNodeMap.size > 0 ?
                        [...validationReport.mergedNodeMap.entries()].filter(([k, v]) => k !== v).length : 0}
                      {' | '}المكونات المتصلة: {validationReport.connectedComponents}
                    </div>
                    {validationReport.issues.map((issue, i) => (
                      <div key={i} className="mt-1">
                        <span className="font-medium">
                          {issue.type === 'duplicate_nodes' && `🔗 عقد مكررة: ${issue.count}`}
                          {issue.type === 'dangling_nodes' && `⚡ عقد معلقة: ${issue.count}`}
                          {issue.type === 'zero_length_elements' && `📏 عناصر صفرية الطول: ${issue.count}`}
                          {issue.type === 'disconnected_model' && `🔌 نموذج غير متصل: ${issue.components} أجزاء`}
                          {issue.type === 'no_supports' && `🏗️ لا توجد مساند`}
                          {issue.type === 'unstable_system' && `⚠️ تحذير استقرار`}
                        </span>
                        {issue.details && issue.details.length > 0 && (
                          <ul className="mt-0.5 space-y-0.5 list-disc list-inside text-[10px]">
                            {issue.details.slice(0, 5).map((d, j) => <li key={j}>{d}</li>)}
                            {issue.details.length > 5 && <li>... و{issue.details.length - 5} أخرى</li>}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  onClick={() => {
                    setValidationRunning(true);
                    import('@/core/validation/preAnalysisValidator').then(({ runPreAnalysisChecks }) => {
                      const vNodes = [];
                      const vElements = [];
                      // Build validation nodes from columns
                      for (const c of columns.filter(cc => !cc.isRemoved)) {
                        const zBot = c.zBottom ?? 0;
                        const zTop = c.zTop ?? (zBot + c.L);
                        vNodes.push({ id: `${c.id}_bot`, x: c.x * 1000, y: c.y * 1000, z: zBot, restraints: [true, true, true, true, true, true] as [boolean,boolean,boolean,boolean,boolean,boolean] });
                        vNodes.push({ id: `${c.id}_top`, x: c.x * 1000, y: c.y * 1000, z: zTop, restraints: [false, false, false, false, false, false] as [boolean,boolean,boolean,boolean,boolean,boolean] });
                        vElements.push({ id: `col_${c.id}`, nodeI: `${c.id}_bot`, nodeJ: `${c.id}_top`, type: 'column' as const });
                      }
                      // Build validation elements from beams
                      for (const b of beams.filter(bb => !removedBeamIds.includes(bb.id))) {
                        const zMm = b.z ?? 0;
                        const niId = `beam_${b.id}_I`;
                        const njId = `beam_${b.id}_J`;
                        vNodes.push({ id: niId, x: b.x1 * 1000, y: b.y1 * 1000, z: zMm, restraints: [false, false, false, false, false, false] as [boolean,boolean,boolean,boolean,boolean,boolean] });
                        vNodes.push({ id: njId, x: b.x2 * 1000, y: b.y2 * 1000, z: zMm, restraints: [false, false, false, false, false, false] as [boolean,boolean,boolean,boolean,boolean,boolean] });
                        vElements.push({ id: `beam_${b.id}`, nodeI: niId, nodeJ: njId, type: 'beam' as const });
                      }
                      const result = runPreAnalysisChecks(vNodes, vElements);
                      setValidationReport(result.report);
                      setValidationRunning(false);
                    });
                  }}
                  disabled={validationRunning}
                  variant="outline"
                  className="w-full min-h-[44px] border-teal-300 text-teal-700 hover:bg-teal-50 dark:text-teal-400 dark:border-teal-700 dark:hover:bg-teal-950"
                >
                  <CheckSquare size={14} className="mr-2" />
                  {validationRunning ? 'جارٍ الفحص...' : 'فحص سلامة النموذج'}
                </Button>
              </CardContent>
            </Card>

            {(detectedConnections.length > 0 || (analyzed && bobConnections.length > 0)) && (
              <Card className="border-indigo-200 dark:border-indigo-800 bg-indigo-500/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <span className="text-indigo-500">⇅</span>
                    اتصالات الجسور الحاملة / المحمولة
                    <span className="text-[10px] font-normal text-muted-foreground">
                      ({detectedConnections.length} اتصال مكتشف)
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {detectedConnections.map((conn, i) => {
                    const analyzedConn = bobConnections.find(c => c.removedColumnId === conn.removedColumnId);
                    const primaryBeam = beamsWithLoads.find(b => b.id === conn.primaryBeamId);
                    const contBeam = conn.continuationBeamId ? beamsWithLoads.find(b => b.id === conn.continuationBeamId) : undefined;
                    const isManualOverride = bobManualPrimary[conn.removedColumnId] !== undefined;

                    // Determine criterion label
                    const criterion = (() => {
                      if (isManualOverride) return 'تعيين يدوي ✎';
                      const hB = beamsWithLoads.filter(b =>
                        (b.fromCol === conn.removedColumnId || b.toCol === conn.removedColumnId) && b.direction === 'horizontal'
                      );
                      const vB = beamsWithLoads.filter(b =>
                        (b.fromCol === conn.removedColumnId || b.toCol === conn.removedColumnId) && b.direction === 'vertical'
                      );
                      if (conn.primaryDirection === 'horizontal' && hB.length >= 2 && vB.length === 1) return 'استمرارية (2 أفقي + 1 رأسي)';
                      if (conn.primaryDirection === 'vertical' && vB.length >= 2 && hB.length === 1) return 'استمرارية (2 رأسي + 1 أفقي)';
                      return 'صلابة EI/L';
                    })();

                    // Collect beams at this column for SVG
                    const hBeamsAtCol = beamsWithLoads.filter(b =>
                      (b.fromCol === conn.removedColumnId || b.toCol === conn.removedColumnId) && b.direction === 'horizontal'
                    );
                    const vBeamsAtCol = beamsWithLoads.filter(b =>
                      (b.fromCol === conn.removedColumnId || b.toCol === conn.removedColumnId) && b.direction === 'vertical'
                    );
                    const primaryIsH = conn.primaryDirection === 'horizontal';

                    return (
                      <div key={i} className="rounded-lg border border-indigo-200/60 dark:border-indigo-800/60 bg-background p-3 space-y-3">

                        {/* ── SVG diagram + text info side-by-side ── */}
                        <div className="flex gap-3 items-start flex-wrap">

                          {/* SVG cross diagram */}
                          <div className="shrink-0">
                            <svg width="110" height="110" viewBox="0 0 110 110" className="rounded border border-border bg-muted/30">
                              {/* Horizontal beam arm(s) */}
                              {hBeamsAtCol.map((hb, hi) => {
                                const isCarrier = primaryIsH;
                                const color = isCarrier ? '#22c55e' : '#ef4444';
                                const strokeW = isCarrier ? 5 : 3;
                                // slight vertical offset for multiple beams
                                const yOff = (hi - (hBeamsAtCol.length - 1) / 2) * 6;
                                return (
                                  <g key={hb.id}>
                                    <line x1={5} y1={55 + yOff} x2={105} y2={55 + yOff} stroke={color} strokeWidth={strokeW} strokeLinecap="round" />
                                    <text x={8} y={55 + yOff - 3} fontSize={7} fill={color} fontWeight="bold">{hb.id}</text>
                                  </g>
                                );
                              })}
                              {/* Vertical beam arm(s) */}
                              {vBeamsAtCol.map((vb, vi) => {
                                const isCarrier = !primaryIsH;
                                const color = isCarrier ? '#22c55e' : '#ef4444';
                                const strokeW = isCarrier ? 5 : 3;
                                const xOff = (vi - (vBeamsAtCol.length - 1) / 2) * 6;
                                return (
                                  <g key={vb.id}>
                                    <line x1={55 + xOff} y1={5} x2={55 + xOff} y2={105} stroke={color} strokeWidth={strokeW} strokeLinecap="round" />
                                    <text x={55 + xOff + 3} y={14} fontSize={7} fill={color} fontWeight="bold">{vb.id}</text>
                                  </g>
                                );
                              })}
                              {/* Removed column dot at intersection */}
                              <circle cx={55} cy={55} r={6} fill="#6366f1" stroke="white" strokeWidth={1.5} />
                              <text x={55} y={55 + 3.5} textAnchor="middle" fontSize={6} fill="white" fontWeight="bold">✕</text>
                              {/* Legend labels */}
                              <text x={55} y={106} textAnchor="middle" fontSize={6} fill="#6366f1">{conn.removedColumnId}</text>
                              {/* Carrier/carried corner labels */}
                              <text x={4} y={108} fontSize={6} fill="#22c55e">حامل</text>
                              <text x={75} y={108} fontSize={6} fill="#ef4444">محمول</text>
                            </svg>
                          </div>

                          {/* Text details */}
                          <div className="flex-1 min-w-0 space-y-2">
                            {/* Header */}
                            <div className="flex items-center justify-between flex-wrap gap-1">
                              <span className="text-[10px] text-muted-foreground leading-relaxed">
                                عمود محذوف: <span className="font-mono font-bold text-foreground">{conn.removedColumnId}</span>
                                <span className="mx-1 opacity-40">·</span>
                                ({conn.point.x.toFixed(1)}، {conn.point.y.toFixed(1)}) م
                                <br />
                                معيار: <span className={`font-semibold ${isManualOverride ? 'text-violet-600 dark:text-violet-400' : ''}`}>{criterion}</span>
                              </span>
                              {analyzedConn && analyzedConn.reactionForce > 0 && (
                                <span className="text-[10px] font-bold bg-amber-500/15 border border-amber-400/40 text-amber-700 dark:text-amber-400 rounded px-2 py-0.5">
                                  حِمل منقول: {analyzedConn.reactionForce.toFixed(1)} kN
                                </span>
                              )}
                            </div>

                            {/* Manual override flip button */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] text-muted-foreground">الجسر الحامل:</span>
                              <button
                                onClick={() => {
                                  const currentForced = bobManualPrimary[conn.removedColumnId];
                                  if (currentForced === undefined) {
                                    // First flip: override to opposite of auto
                                    dispatch({ type: 'SET_BOB_MANUAL_PRIMARY', colId: conn.removedColumnId, direction: primaryIsH ? 'vertical' : 'horizontal' });
                                  } else if (currentForced !== conn.primaryDirection as 'horizontal' | 'vertical') {
                                    // Second flip: back to auto (remove override)
                                    dispatch({ type: 'SET_BOB_MANUAL_PRIMARY', colId: conn.removedColumnId, direction: null });
                                  } else {
                                    // Flip to opposite
                                    dispatch({ type: 'SET_BOB_MANUAL_PRIMARY', colId: conn.removedColumnId, direction: currentForced === 'horizontal' ? 'vertical' : 'horizontal' });
                                  }
                                }}
                                className={`inline-flex items-center gap-1 text-[10px] font-bold rounded border px-2 py-0.5 transition-colors cursor-pointer
                                  ${isManualOverride
                                    ? 'bg-violet-500/15 border-violet-400/50 text-violet-700 dark:text-violet-400 hover:bg-violet-500/25'
                                    : 'bg-muted border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                                  }`}
                                title="اضغط لتبديل الجسر الحامل / المحمول يدوياً"
                              >
                                <span>{primaryIsH ? 'أفقي ↔' : 'رأسي ↕'}</span>
                                {isManualOverride ? <span>· يدوي ✎</span> : <span>· تلقائي</span>}
                              </button>
                              {isManualOverride && (
                                <button
                                  onClick={() => dispatch({ type: 'SET_BOB_MANUAL_PRIMARY', colId: conn.removedColumnId, direction: null })}
                                  className="text-[9px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                                >
                                  إعادة تعيين تلقائي
                                </button>
                              )}
                            </div>

                            {/* Primary beam row */}
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-16 text-[10px] font-bold rounded bg-green-500/15 border border-green-400/40 text-green-700 dark:text-green-400 px-1 py-0.5">
                                حامل ✓
                              </span>
                              <div className="flex-1 min-w-0">
                                <span className="font-mono text-xs font-bold text-foreground">{conn.primaryBeamId}</span>
                                {primaryBeam && (
                                  <span className="text-[10px] text-muted-foreground mr-2">
                                    {conn.primaryDirection === 'horizontal' ? 'أفقي' : 'رأسي'} —
                                    بحر {(primaryBeam.length / 1000).toFixed(2)} م —
                                    {primaryBeam.b}×{primaryBeam.h} مم
                                  </span>
                                )}
                                {analyzedConn && analyzedConn.reactionForce > 0 && (
                                  <span className="text-[10px] text-muted-foreground mr-2">
                                    @ {(conn.distanceOnPrimary / 1000).toFixed(2)} م من الطرف
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Continuation beam */}
                            {contBeam && (
                              <div className="flex items-start gap-2">
                                <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-16 text-[10px] font-bold rounded bg-green-500/10 border border-green-400/30 text-green-600 dark:text-green-500 px-1 py-0.5">
                                  حامل A2
                                </span>
                                <div className="flex-1 min-w-0">
                                  <span className="font-mono text-xs font-bold text-foreground">{conn.continuationBeamId}</span>
                                  <span className="text-[10px] text-muted-foreground mr-2">
                                    استمرار — {(contBeam.length / 1000).toFixed(2)} م — {contBeam.b}×{contBeam.h} مم
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Secondary beams */}
                            {conn.secondaryBeamIds.map(sid => {
                              const sb = beamsWithLoads.find(b => b.id === sid);
                              const isHingedAtI = sb?.fromCol === conn.removedColumnId;
                              return (
                                <div key={sid} className="flex items-start gap-2">
                                  <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-16 text-[10px] font-bold rounded bg-red-500/15 border border-red-400/40 text-red-700 dark:text-red-400 px-1 py-0.5">
                                    محمول ⭕
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <span className="font-mono text-xs font-bold text-foreground">{sid}</span>
                                    {sb && (
                                      <span className="text-[10px] text-muted-foreground mr-2">
                                        {sb.direction === 'horizontal' ? 'أفقي' : 'رأسي'} —
                                        {(sb.length / 1000).toFixed(2)} م —
                                        {sb.b}×{sb.h} مم —
                                        مفصلة عند {isHingedAtI ? 'البداية (I)' : 'النهاية (J)'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!analyzed && (
                    <p className="text-[10px] text-muted-foreground text-center pt-1">
                      شغّل التحليل لحساب قيم ردود الأفعال المنقولة
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {!analyzed ? (
              <Card><CardContent className="py-12 text-center">
                <p className="text-muted-foreground mb-4">يرجى تشغيل التحليل أولاً</p>
                <Button onClick={runAnalysis} className="min-h-[44px]">تشغيل التحليل</Button>
              </CardContent></Card>
            ) : (
              <div className="space-y-4">
                {/* ── مؤشر وضع التحليل ── */}
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] border ${
                  ignoreSlab
                    ? 'bg-amber-500/10 border-amber-400/40 text-amber-700 dark:text-amber-400'
                    : selectedEngine === 'fem_coupled'
                      ? 'bg-emerald-500/10 border-emerald-400/40 text-emerald-700 dark:text-emerald-400'
                      : selectedEngine === 'legacy_2d'
                        ? 'bg-violet-500/10 border-violet-400/40 text-violet-700 dark:text-violet-400'
                        : 'bg-blue-500/10 border-blue-400/40 text-blue-700 dark:text-blue-400'
                }`}>
                  <Zap size={12} className="shrink-0" />
                  <span className="font-semibold">
                    {ignoreSlab
                      ? 'تحليل إطار نقي — جساءة البلاطات مُهملة'
                      : selectedEngine === 'fem_coupled'
                        ? 'تحليل FEM مقترن (جسور + بلاطات)'
                        : selectedEngine === 'legacy_2d'
                          ? 'تحليل 2D — طريقة صلابة المصفوفة'
                          : 'تحليل 3D — إطارات ثلاثية الأبعاد'}
                  </span>
                  <span className="opacity-70 mr-auto text-[10px]">
                    {ignoreSlab
                      ? '0.35 جسور · 0.65 أعمدة · 0 بلاطات'
                      : '0.35 جسور · 0.65 أعمدة · 0.25 بلاطات'}
                  </span>
                </div>

                {/* Story filter for analysis */}
                <StorySelector
                  stories={stories} selectedStoryId={selectedStoryId}
                  onSelectStory={id => dispatch({ type: 'SELECT_STORY', storyId: id })}
                  onAddStory={() => dispatch({ type: 'ADD_STORY' })}
                  onRemoveStory={id => dispatch({ type: 'REMOVE_STORY', storyId: id })}
                  onUpdateStory={(id, updates) => dispatch({ type: 'UPDATE_STORY', storyId: id, updates })}
                  onCopyElements={(from, to) => dispatch({ type: 'COPY_STORY_ELEMENTS', fromStoryId: from, toStoryId: to })}
                  compact
                />

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">الأحمال على الجسور (kN/m)</CardTitle>
                    {/* Beam-on-beam diagnostic banner */}
                    {bobConnections.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {bobConnections.map((c, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5 font-mono">
                            <span className="font-bold">{c.primaryBeamId}</span>
                            <span className="opacity-60">←</span>
                            <span>{c.secondaryBeamIds.join('+')}</span>
                            {c.reactionForce > 0 && <span className="text-amber-600 font-bold ml-1">{c.reactionForce.toFixed(1)} kN</span>}
                          </span>
                        ))}
                      </div>
                    ) : detectedConnections.length > 0 ? (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        🔄 تم اكتشاف {detectedConnections.length} اتصال جسر-على-جسر، تشغيل التحليل لحساب الأحمال...
                      </p>
                    ) : removedColumnIds.length === 0 ? (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        ⚠️ لا توجد اتصالات جسر-على-جسر — لاكتشافها يجب حذف عمود عند نقطة تقاطع جسرين متعاكسين
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        ℹ️ {removedColumnIds.length} عمود محذوف — لم يُكتشف أي تقاطع جسرين متعاكسين عنده
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','الجسر','DL','LL','1.4D','1.2D+1.6L','البلاطات','أحمال مركزة من جسور (kN)'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story => 
                          (isAllStories || story.id === selectedStoryId) &&
                          beamsWithLoads.filter(b => b.storyId === story.id).map(b => {
                            const pointLoads = bobConnections.filter(c => c.primaryBeamId === b.id);
                            return (
                              <TableRow key={`${story.id}-${b.id}`}>
                                <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                                <TableCell className="font-mono text-xs">{b.id}</TableCell>
                                <TableCell className="font-mono text-xs">{b.deadLoad.toFixed(2)}</TableCell>
                                <TableCell className="font-mono text-xs">{b.liveLoad.toFixed(2)}</TableCell>
                                <TableCell className="font-mono text-xs">{(1.4 * b.deadLoad).toFixed(2)}</TableCell>
                                <TableCell className="font-mono text-xs">{(1.2 * b.deadLoad + 1.6 * b.liveLoad).toFixed(2)}</TableCell>
                                <TableCell className="text-xs">{b.slabs.join(', ') || '—'}</TableCell>
                                <TableCell className="text-xs">
                                  {pointLoads.length === 0 ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <div className="flex flex-col gap-1">
                                      {pointLoads.map((c, i) => (
                                        <span key={i} className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 font-mono">
                                          <span className="text-amber-600 font-bold">{c.reactionForce.toFixed(1)} kN</span>
                                          <span className="text-muted-foreground">من</span>
                                          <span className="text-blue-600 font-semibold">{c.secondaryBeamIds.join('+')}</span>
                                          <span className="text-muted-foreground">@ {c.distanceOnPrimary.toFixed(2)}م</span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                {/* زر تصدير عزوم الجسور إلى Excel */}
                {frameResults.length > 0 && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        import('xlsx').then(XLSX => {
                          const data: any[] = [];
                          for (const fr of frameResults) {
                            for (const b of fr.beams) {
                              const bBeam = beamsWithLoads.find(bw => bw.id === b.beamId);
                              const story = bBeam ? stories.find(s => s.id === bBeam.storyId) : null;
                              data.push({
                                'الإطار': fr.frameId,
                                'الدور': story?.label ?? '',
                                'الجسر': b.beamId,
                                'البحر (م)': +b.span.toFixed(2),
                                'M يسار (kN·m)': +b.Mleft.toFixed(2),
                                'M منتصف (kN·m)': +b.Mmid.toFixed(2),
                                'M يمين (kN·m)': +b.Mright.toFixed(2),
                                'Vu (kN)': +b.Vu.toFixed(2),
                              });
                            }
                          }
                          const ws = XLSX.utils.json_to_sheet(data);
                          const wb = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb, ws, 'عزوم الجسور');
                          XLSX.writeFile(wb, 'beam_moments.xlsx');
                        });
                      }}
                    >
                      <Download size={14} />
                      تصدير العزوم إلى Excel
                    </Button>
                  </div>
                )}
                {frameResults.map(fr => (
                  <Card key={fr.frameId}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">إطار {fr.frameId} <span className="text-muted-foreground text-xs">(اضغط على جسر لعرض الرسومات)</span></CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow>
                          {['الجسر','البحر','M علوي يسار','M سفلي أقصى','M علوي يمين','Vu','📊'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                        </TableRow></TableHeader>
                        <TableBody>
                          {fr.beams.map(b => {
                            const midMoment = b.Mmid;
                            // Determine hinge status for this beam (same logic as handleAnalysisElementClick)
                            const bBeam = beamsWithLoads.find(bw => bw.id === b.beamId);
                            let bHingeLeft = false, bHingeRight = false;
                            if (bBeam) {
                              for (const conn of detectedConnections) {
                                if (conn.secondaryBeamIds.includes(b.beamId)) {
                                  if (bBeam.fromCol === conn.removedColumnId) bHingeLeft  = true;
                                  if (bBeam.toCol   === conn.removedColumnId) bHingeRight = true;
                                }
                              }
                              const rs = getBeamReleaseState(bBeam);
                              if (rs.nodeI.rz) bHingeLeft  = true;
                              if (rs.nodeJ.rz) bHingeRight = true;
                            }
                            const displayMleft  = bHingeLeft  ? 0 : b.Mleft;
                            const displayMright = bHingeRight ? 0 : b.Mright;
                            return (
                            <TableRow key={b.beamId} className="cursor-pointer hover:bg-accent/10" onClick={() => handleAnalysisElementClick(b.beamId)}>
                              <TableCell className="font-mono text-xs">{b.beamId}</TableCell>
                              <TableCell className="font-mono text-xs">{b.span.toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs" style={{ color: displayMleft < 0 ? 'hsl(0 84.2% 60.2%)' : 'hsl(142 71% 45%)' }}>
                                {bHingeLeft ? <span title="مفصلة — عزم = 0">0.00 ⭕</span> : displayMleft.toFixed(2)}
                              </TableCell>
                              <TableCell className="font-mono text-xs font-bold" style={{ color: midMoment > 0 ? 'hsl(142 71% 45%)' : 'hsl(0 84.2% 60.2%)' }}>{midMoment.toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs" style={{ color: displayMright < 0 ? 'hsl(0 84.2% 60.2%)' : 'hsl(142 71% 45%)' }}>
                                {bHingeRight ? <span title="مفصلة — عزم = 0">0.00 ⭕</span> : displayMright.toFixed(2)}
                              </TableCell>
                              <TableCell className="font-mono text-xs">{b.Vu.toFixed(2)}</TableCell>
                              <TableCell><Badge variant="outline" className="text-[10px] cursor-pointer">رسومات</Badge></TableCell>
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))}

                {/* Column Analysis Results - Biaxial - Multi-story */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">نتائج تحليل الأعمدة (ثنائي المحور) - جميع الأدوار</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','العمود','b×h','Pu (kN)','Mx أعلى','Mx أسفل','My أعلى','My أسفل','النحافة X','النحافة Y','الارتفاع'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map((story, storyIdx) => 
                          (isAllStories || story.id === selectedStoryId) &&
                          colDesigns.filter(c => c.storyId === story.id).map(c => {
                            const storiesAbove = stories.length - storyIdx;
                            const accumulatedPu = c.Pu * storiesAbove;
                            const loads = colLoads3D.get(c.id);
                            return (
                            <TableRow key={`${story.id}-${c.id}`} className="cursor-pointer hover:bg-accent/10" onClick={() => {
                              const loads = colLoads3D.get(c.id);
                              dispatch({
                                type: 'OPEN_DIAGRAM',
                                data: {
                                  elementId: c.id,
                                  elementType: 'column' as const,
                                  span: (story.height || 3000) / 1000,
                                  colLength: story.height || 3000,
                                  MxTop: loads?.MxTop || 0,
                                  MxBot: loads?.MxBot || 0,
                                  MyTop: loads?.MyTop || 0,
                                  MyBot: loads?.MyBot || 0,
                                  Pu: accumulatedPu,
                                },
                              });
                            }}>
                              <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                              <TableCell className="font-mono text-xs">{c.id}</TableCell>
                              <TableCell className="font-mono text-xs">{c.b}×{c.h}</TableCell>
                              <TableCell className="font-mono text-xs font-bold">{accumulatedPu.toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs">{(loads?.MxTop || 0).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs">{(loads?.MxBot || 0).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs">{(loads?.MyTop || 0).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs">{(loads?.MyBot || 0).toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs">{c.design.slendernessStatusX}</TableCell>
                              <TableCell className="font-mono text-xs">{c.design.slendernessStatusY}</TableCell>
                              <TableCell className="font-mono text-xs">{story.height}</TableCell>
                            </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Joint Connectivity - Column Above/Below at each joint */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">تفاصيل اتصال الأعمدة بالركائز (العمود العلوي والسفلي)</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الفريم','الركيزة','X','Y','Z','العمود العلوي','b×h علوي','طول علوي','Z علوي','العمود السفلي','b×h سفلي','طول سفلي','Z سفلي','نسبة علوي','نسبة سفلي'].map((h, i) => <TableHead key={`${h}-${i}`} className="text-xs whitespace-nowrap">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {jointConnectivity.map((j, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-xs font-bold">{j.frameId}</TableCell>
                            <TableCell className="font-mono text-xs">{j.jointColId}</TableCell>
                            <TableCell className="font-mono text-xs">{j.jointX.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-xs">{j.jointY.toFixed(2)}</TableCell>
                            <TableCell className="font-mono text-xs">{j.jointZ.toFixed(0)}</TableCell>
                            <TableCell className="font-mono text-xs text-blue-600 dark:text-blue-400">{j.colAboveId ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colAboveB && j.colAboveH ? `${j.colAboveB}×${j.colAboveH}` : '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colAboveL?.toFixed(0) ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colAboveZBot != null && j.colAboveZTop != null ? `${j.colAboveZBot.toFixed(0)}→${j.colAboveZTop.toFixed(0)}` : '—'}</TableCell>
                            <TableCell className="font-mono text-xs text-orange-600 dark:text-orange-400">{j.colBelowId ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colBelowB && j.colBelowH ? `${j.colBelowB}×${j.colBelowH}` : '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colBelowL?.toFixed(0) ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{j.colBelowZBot != null && j.colBelowZTop != null ? `${j.colBelowZBot.toFixed(0)}→${j.colBelowZTop.toFixed(0)}` : '—'}</TableCell>
                            <TableCell className="font-mono text-xs font-bold">{(j.distributionTop * 100).toFixed(1)}%</TableCell>
                            <TableCell className="font-mono text-xs font-bold">{(j.distributionBot * 100).toFixed(1)}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                {/* ETABS Comparison Table */}
                <ETABSComparisonTable
                  frames={frames}
                  beams={beamsWithLoads}
                  columns={columns}
                  stories={stories}
                  frameResults3D={frameResults3DRaw}
                  frameResults2D={frameResults2D}
                  frameResultsGF={frameResultsGF}
                  frameResultsUC={frameResultsUC}
                  colLoads3D={colLoads3D}
                  colLoads2D={colLoadsBiaxial}
                  etabsBeamData={etabsCompBeamData}
                  onEtabsDataChange={setEtabsCompBeamData}
                />
              </div>
            )}
              </TabsContent>

              <TabsContent value="analysis-compare" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <LoadComparisonPanel
                  slabs={storyFilteredSlabs}
                  beams={beamsWithLoads}
                  columns={columns}
                  slabProps={slabProps}
                  mat={mat}
                  analyzed={analyzed}
                  onRunAnalysis={runAnalysis}
                />
              </TabsContent>
              <TabsContent value="analysis-fem-compare" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <FEMComparisonPanel
                  slabs={storyFilteredSlabs}
                  beams={beamsWithLoads}
                  columns={columns}
                  slabProps={slabProps}
                  mat={mat}
                  analyzed={analyzed}
                  onRunAnalysis={runAnalysis}
                />
              </TabsContent>
              <TabsContent value="analysis-etabs-import" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <ETABSImportPanel
                  frameResults2D={frameResults2D}
                  frameResults3D={frameResults3DRaw}
                  frameResultsFEM={selectedEngine === 'fem_coupled' ? frameResults : undefined}
                  frameResultsGF={frameResultsGF}
                  frameResultsUC={frameResultsUC}
                  beams={beamsWithLoads}
                  analyzed={analyzed}
                  onRunAnalysis={runAnalysis}
                />
              </TabsContent>
              <TabsContent value="analysis-beam-loads" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <BeamLoadDiagrams
                  frameResults={frameResults}
                  beams={beamsWithLoads}
                  engineLabel={ENGINE_LABELS[selectedEngine]}
                  bobConnections={bobConnections}
                  beamHinges={beamHingesMap}
                />
              </TabsContent>
              <TabsContent value="analysis-slab" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
                <SlabAnalysisPanel slabs={slabs} slabProps={slabProps} mat={mat} />
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* DESIGN TAB */}
          <TabsContent value="design" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
            {!analyzed ? (
              <Card><CardContent className="py-12 text-center">
                <p className="text-muted-foreground">يرجى تشغيل التحليل أولاً</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-4">
                {/* Design source selector */}
                <Card className="border-blue-200 dark:border-blue-800 bg-blue-500/5">
                  <CardContent className="py-3 px-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Zap size={14} className="text-blue-500 shrink-0" />
                      <span className="text-xs font-semibold">مصدر نتائج التصميم</span>
                      <select
                        className="h-8 rounded border border-input bg-background px-2 text-xs flex-1 min-w-[160px] max-w-[240px]"
                        value={selectedEngine}
                        onChange={e => {
                          dispatch({ type: 'SET_ENGINE', engine: e.target.value as any });
                        }}
                      >
                        {(Object.entries(ENGINE_LABELS) as [string, string][]).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                        <option value="etabs_import">استيراد من ETABS</option>
                      </select>
                      {selectedEngine === 'etabs_import' as any && (
                        <Badge variant="outline" className="text-xs">سيتم استخدام نتائج ETABS المستوردة</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
                
                {/* Story filter for design */}
                <StorySelector
                  stories={stories} selectedStoryId={selectedStoryId}
                  onSelectStory={id => dispatch({ type: 'SELECT_STORY', storyId: id })}
                  onAddStory={() => dispatch({ type: 'ADD_STORY' })}
                  onRemoveStory={id => dispatch({ type: 'REMOVE_STORY', storyId: id })}
                  onUpdateStory={(id, updates) => dispatch({ type: 'UPDATE_STORY', storyId: id, updates })}
                  onCopyElements={(from, to) => dispatch({ type: 'COPY_STORY_ELEMENTS', fromStoryId: from, toStoryId: to })}
                  compact
                />
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">تصميم الجسور - الانحناء والتشوه والتشخيص</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','الجسر','علوي يسار','سفلي أقصى','علوي يمين','δ (mm)','L/δ','L كلي (م)','الحالة','التشخيص'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story => 
                          (isAllStories || story.id === selectedStoryId) &&
                          beamDesigns.filter(d => {
                            const beam = beamsWithLoads.find(b => b.id === d.beamId);
                            return beam?.storyId === story.id;
                          }).map(d => {
                          const bent = getBentUpData(d.beamId);
                          const topLeftBars = bent ? Math.max(bent.additionalTopLeft, 2) : d.flexLeft.bars;
                          const topRightBars = bent ? Math.max(bent.additionalTopRight, 2) : d.flexRight.bars;
                          const diag = beamDiagnostics.get(d.beamId);
                          return (
                          <React.Fragment key={`${story.id}-${d.beamId}`}>
                          <TableRow className="cursor-pointer" onClick={() => handleSelectElement('beam', d.beamId)}>
                            <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                            <TableCell className="font-mono text-xs">{d.beamId}</TableCell>
                            <TableCell className="font-mono text-xs">{topLeftBars}Φ{d.flexLeft.dia}</TableCell>
                            <TableCell className="font-mono text-xs">{d.flexMid.bars}Φ{d.flexMid.dia}</TableCell>
                            <TableCell className="font-mono text-xs">{topRightBars}Φ{d.flexRight.dia}</TableCell>
                            <TableCell className="font-mono text-xs">{d.deflection.deflection.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs">{d.deflection.deflectionRatio.toFixed(0)}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {(() => {
                                // Show total girder length if this is a carrier beam segment
                                const carrierConn2 = bobConnections.find(c => c.primaryBeamId === d.beamId);
                                const contConn2 = bobConnections.find(c => c.continuationBeamId === d.beamId);
                                if (carrierConn2 && carrierConn2.continuationBeamId) {
                                  const contB = beamsWithLoads.find(b => b.id === carrierConn2.continuationBeamId);
                                  if (contB) return <span className="text-accent font-bold">{(d.span + contB.length / 1000).toFixed(2)}</span>;
                                }
                                if (contConn2) {
                                  const primB = beamsWithLoads.find(b => b.id === contConn2.primaryBeamId);
                                  if (primB) return <span className="text-accent font-bold">{(primB.length / 1000 + d.span).toFixed(2)}</span>;
                                }
                                return <span className="text-muted-foreground">—</span>;
                              })()}
                            </TableCell>
                            <TableCell>
                              <Badge variant={diag?.isAdequate ? "default" : "destructive"} className="text-[10px]">
                                {diag?.isAdequate ? 'آمن ✓' : 'تجاوز ✗'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs max-w-[200px]">
                              {diag && !diag.isAdequate && (
                                <span className="text-destructive font-medium">{diag.overallStatus}</span>
                              )}
                            </TableCell>
                          </TableRow>
                          {diag && !diag.isAdequate && diag.failures.map((f, idx) => (
                            <TableRow key={`${d.beamId}-fail-${idx}`} className="bg-destructive/5 border-0">
                              <TableCell colSpan={9} className="py-1 px-4">
                                <div className="flex flex-col gap-0.5 text-[11px]">
                                  <div className="flex items-start gap-2">
                                    <Badge variant="outline" className="text-[9px] shrink-0 border-destructive text-destructive">
                                      {f.aciRef}
                                    </Badge>
                                    <span className="text-destructive">{f.description} (تجاوز {f.exceedPercent.toFixed(0)}%)</span>
                                  </div>
                                  <div className="text-muted-foreground mr-2">
                                    💡 <strong>الحل:</strong> {f.solution}
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                          </React.Fragment>
                          );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">تصميم القص</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','الجسر','Vu','Vc','Vs','الكانات'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story =>
                          (isAllStories || story.id === selectedStoryId) &&
                          beamDesigns.filter(d => {
                            const beam = beamsWithLoads.find(b => b.id === d.beamId);
                            return beam?.storyId === story.id;
                          }).map(d => (
                            <TableRow key={`${story.id}-${d.beamId}`}>
                              <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                              <TableCell className="font-mono text-xs">{d.beamId}</TableCell>
                              <TableCell className="font-mono text-xs">{d.Vu.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{d.shear.Vc.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{d.shear.Vs.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{d.shear.stirrups}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">تصميم الأعمدة (Bresler - ثنائي المحور)</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','العمود','Pu','Mx المضخم','My المضخم','Bresler','النحافة','الحالة','التسليح'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map((story, storyIdx) =>
                          (isAllStories || story.id === selectedStoryId) &&
                          colDesigns.filter(c => c.storyId === story.id).map(c => {
                            const storiesAbove = stories.length - storyIdx;
                            const accPu = c.Pu * storiesAbove;
                            return (
                          <TableRow key={`${story.id}-${c.id}`} className="cursor-pointer" onClick={() => handleSelectElement('column', c.id)}>
                            <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                            <TableCell className="font-mono text-xs">{c.id}</TableCell>
                            <TableCell className="font-mono text-xs font-bold">{accPu.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs">{c.design.MxMagnified.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs">{c.design.MyMagnified.toFixed(1)}</TableCell>
                            <TableCell className="font-mono text-xs">{c.design.breslerRatio.toFixed(2)}</TableCell>
                            <TableCell className="text-xs">
                              {c.design.checkSlenderness}
                              {c.design.isSlenderX && (
                                <span className="block text-destructive text-[10px] mt-0.5">
                                  X: نحيف (kLu/r={c.design.kLu_rx.toFixed(1)}) → B المطلوب ≥ {c.design.requiredBForNonSlender}mm {c.b >= c.design.requiredBForNonSlender ? '✓' : `(الحالي ${c.b}mm)`}
                                </span>
                              )}
                              {c.design.isSlenderY && (
                                <span className="block text-destructive text-[10px] mt-0.5">
                                  Y: نحيف (kLu/r={c.design.kLu_ry.toFixed(1)}) → H المطلوب ≥ {c.design.requiredHForNonSlender}mm {c.h >= c.design.requiredHForNonSlender ? '✓' : `(الحالي ${c.h}mm)`}
                                </span>
                              )}
                              {c.design.suggestRotation && (
                                <span className="block text-accent text-[10px] mt-0.5 font-semibold">
                                  💡 {c.design.rotationReason}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={c.design.biaxialAdequate ? "default" : "destructive"} className="text-[10px]">
                                {c.design.biaxialAdequate ? 'آمن' : 'غير آمن'}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{c.design.bars}Φ{c.design.dia}</TableCell>
                          </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Bent-Up Bars Table */}
                {bentUpResults.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">تكسيح الحديد (Bent-up Bars) - ACI 318-19</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    {bentUpResults.map(fr => (
                      <div key={fr.frameId} className="mb-4">
                        <p className="text-xs font-semibold mb-1 text-primary">{fr.frameId}</p>
                        <Table>
                          <TableHeader><TableRow>
                            {['الجسر','سفلي أصلي','مكسح','سفلي متبقي','علوي مطلوب L','علوي مطلوب R','مساهمة تكسيح L','مساهمة تكسيح R','علوي إضافي','علوي نهائي'].map(h => <TableHead key={h} className="text-[10px]">{h}</TableHead>)}
                          </TableRow></TableHeader>
                          <TableBody>
                            {fr.beams.map(b => (
                              <TableRow key={b.beamId}>
                                <TableCell className="font-mono text-xs">{b.beamId}</TableCell>
                                <TableCell className="font-mono text-xs">{b.originalBottomBars}Φ{b.bottomDia}</TableCell>
                                <TableCell className="font-mono text-xs">{b.bentUp.bentBarsCount}Φ{b.bentUp.bentDia}</TableCell>
                                <TableCell className="font-mono text-xs">{b.bentUp.remainingBottomBars}Φ{b.bottomDia}</TableCell>
                                <TableCell className="font-mono text-xs">{b.requiredTopLeft}</TableCell>
                                <TableCell className="font-mono text-xs">{b.requiredTopRight}</TableCell>
                                <TableCell className="font-mono text-xs">{b.bentContributionLeft}</TableCell>
                                <TableCell className="font-mono text-xs">{b.bentContributionRight}</TableCell>
                                <TableCell className="font-mono text-xs">{Math.max(b.additionalTopLeft, b.additionalTopRight)}</TableCell>
                                <TableCell className="font-mono text-xs font-bold">{b.finalTopBars}Φ{b.topDia}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                )}

                {/* Slab Punching Shear */}
                {slabDesigns.some(s => s.design.punchingShear) && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">فحص الثقب (Punching Shear)</CardTitle></CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow>
                          {['البلاطة','Vu','Vc','معامل الأمان','الحالة'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                        </TableRow></TableHeader>
                        <TableBody>
                          {slabDesigns.filter(s => s.design.punchingShear).map(s => (
                            <TableRow key={s.id}>
                              <TableCell className="font-mono text-xs">{s.id}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.punchingShear!.Vu.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.punchingShear!.Vc.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.punchingShear!.punchingSafetyFactor.toFixed(2)}</TableCell>
                              <TableCell>
                                <Badge variant={s.design.punchingShear!.adequate ? "default" : "destructive"} className="text-[10px]">
                                  {s.design.punchingShear!.adequate ? 'آمن' : 'غير آمن'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          {/* RESULTS TAB */}
          <TabsContent value="results" className="flex-1 overflow-y-auto p-3 md:p-4 mt-0 pb-20 md:pb-4">
            {!analyzed ? (
              <Card><CardContent className="py-12 text-center">
                <p className="text-muted-foreground">يرجى تشغيل التحليل أولاً</p>
              </CardContent></Card>
            ) : (
              <div className="space-y-4">
                {/* Story filter for results */}
                <StorySelector
                  stories={stories} selectedStoryId={selectedStoryId}
                  onSelectStory={id => dispatch({ type: 'SELECT_STORY', storyId: id })}
                  onAddStory={() => dispatch({ type: 'ADD_STORY' })}
                  onRemoveStory={id => dispatch({ type: 'REMOVE_STORY', storyId: id })}
                  onUpdateStory={(id, updates) => dispatch({ type: 'UPDATE_STORY', storyId: id, updates })}
                  onCopyElements={(from, to) => dispatch({ type: 'COPY_STORY_ELEMENTS', fromStoryId: from, toStoryId: to })}
                  compact
                />

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">نتائج البلاطات</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','البلاطة','Lx','Ly','h','Wu','تسليح قصير','تسليح طويل'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story =>
                          (isAllStories || story.id === selectedStoryId) &&
                          slabDesigns.map(s => (
                            <TableRow key={`${story.id}-${s.id}`} className="cursor-pointer" onClick={() => handleSelectElement('slab', s.id)}>
                              <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                              <TableCell className="font-mono text-xs">{s.id}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.lx.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.ly.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.hUsed}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.Wu.toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.shortDir.bars}Φ{s.design.shortDir.dia}</TableCell>
                              <TableCell className="font-mono text-xs">{s.design.longDir.bars}Φ{s.design.longDir.dia}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">ملخص تسليح الجسور</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','الجسر','b×h','علوي يسار','سفلي وسط','علوي يمين','الكانات'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map(story =>
                          (isAllStories || story.id === selectedStoryId) &&
                          beamDesigns.map(d => {
                            const beam = beamsWithLoads.find(b => b.id === d.beamId);
                            const bent = getBentUpData(d.beamId);
                            const topLeftBars = bent ? Math.max(bent.additionalTopLeft, 2) : d.flexLeft.bars;
                            const topRightBars = bent ? Math.max(bent.additionalTopRight, 2) : d.flexRight.bars;
                            return (
                              <TableRow key={`${story.id}-${d.beamId}`} className="cursor-pointer" onClick={() => handleSelectElement('beam', d.beamId)}>
                                <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                                <TableCell className="font-mono text-xs">{d.beamId}</TableCell>
                                <TableCell className="font-mono text-xs">{beam?.b}×{beam?.h}</TableCell>
                                <TableCell className="font-mono text-xs">{topLeftBars}Φ{d.flexLeft.dia}</TableCell>
                                <TableCell className="font-mono text-xs">{d.flexMid.bars}Φ{d.flexMid.dia}</TableCell>
                                <TableCell className="font-mono text-xs">{topRightBars}Φ{d.flexRight.dia}</TableCell>
                                <TableCell className="font-mono text-xs">{d.shear.stirrups}</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">ملخص تسليح الأعمدة</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        {['الدور','العمود','b×h','Pu','Mu','ρ%','الحالة','التسليح','الكانات'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
                      </TableRow></TableHeader>
                      <TableBody>
                        {stories.map((story, storyIdx) =>
                          (isAllStories || story.id === selectedStoryId) &&
                          colDesigns.map(c => {
                            const storiesAbove = stories.length - storyIdx;
                            const accPu = c.Pu * storiesAbove;
                            return (
                              <TableRow key={`${story.id}-${c.id}`} className="cursor-pointer" onClick={() => handleSelectElement('column', c.id)}>
                                <TableCell className="text-xs font-medium text-muted-foreground">{story.label}</TableCell>
                                <TableCell className="font-mono text-xs">{c.id}</TableCell>
                                <TableCell className="font-mono text-xs">{c.b}×{c.h}</TableCell>
                                <TableCell className="font-mono text-xs font-bold">{accPu.toFixed(1)}</TableCell>
                                <TableCell className="font-mono text-xs">{c.design.MuMagnified.toFixed(1)}</TableCell>
                                <TableCell className="font-mono text-xs">{(c.design.rhoActual * 100).toFixed(1)}</TableCell>
                                <TableCell>
                                  <Badge variant={c.design.adequate ? "default" : "destructive"} className="text-[10px]">
                                    {c.design.adequate ? 'كافي' : 'غير كافي'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs">{c.design.bars}Φ{c.design.dia}</TableCell>
                                <TableCell className="font-mono text-xs">{c.design.stirrups}</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* EXPORT TAB */}
          <TabsContent value="export" className="flex-1 overflow-auto p-4">
            <div className="max-w-5xl space-y-6">
              {/* BOQ - Bill of Quantities */}
              <BOQPanel
                stories={stories}
                slabs={slabs}
                beams={beamsWithLoads}
                columns={columns}
                beamDesigns={beamDesigns as any}
                colDesigns={colDesigns}
                slabDesigns={slabs.map(s => ({ ...s, design: designSlab(s, slabProps, mat, slabs, columns) })) as any}
                slabProps={slabProps}
                analyzed={analyzed}
              />
              {/* Main Export Panel with Floor Selector */}
              <ExportPanel
                stories={stories}
                slabs={slabs}
                beams={beamsWithLoads}
                columns={columns}
                beamDesigns={beamDesigns as any}
                colDesigns={colDesigns}
                slabDesigns={slabs.map(s => ({ ...s, design: designSlab(s, slabProps, mat, slabs, columns) }))}
                mat={mat}
                slabProps={slabProps}
                projectName="Structural Design Studio"
                analyzed={analyzed}
              />

              {/* Additional quick export buttons */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm">تقرير PDF</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <Button className="w-full min-h-[44px]" disabled={!analyzed} onClick={() => {
                      const slabDesignsData = slabs.map(s => ({ ...s, design: designSlab(s, slabProps, mat, slabs, columns) }));
                      generateStructuralReport(slabs, beamsWithLoads, columns, frames, frameResults, beamDesigns as any, colDesigns, slabDesignsData, mat, slabProps, 'Structural Design Studio', stories);
                    }}>تقرير التصميم الإنشائي</Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-sm">تصدير DXF</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <Button className="w-full min-h-[44px]" variant="outline" onClick={() => downloadDXF(generateStructuralDXF(slabs, beamsWithLoads, columns), 'structural_plan.dxf')}>مخطط إنشائي</Button>
                    <Button className="w-full min-h-[44px]" variant="outline" onClick={() => downloadDXF(generateBeamLayoutDXF(beamsWithLoads, columns, slabs), 'beam_layout.dxf')}>مخطط الجسور</Button>
                    <Button className="w-full min-h-[44px]" variant="outline" onClick={() => downloadDXF(generateColumnLayoutDXF(columns, slabs), 'column_layout.dxf')}>مخطط الأعمدة</Button>
                    <Button className="w-full min-h-[44px]" variant="outline" disabled={!analyzed} onClick={() => {
                      const rebarData = beamDesigns.map(d => {
                        const beam = beamsWithLoads.find(b => b.id === d.beamId);
                        return beam ? { beamId: d.beamId, b: beam.b, h: beam.h, x1: beam.x1, y1: beam.y1, x2: beam.x2, y2: beam.y2, topBars: Math.max(d.flexLeft.bars, d.flexRight.bars), topDia: d.flexLeft.dia, botBars: d.flexMid.bars, botDia: d.flexMid.dia, stirrups: d.shear.stirrups } : null;
                      }).filter(Boolean) as any[];
                      downloadDXF(generateReinforcementDXF(slabs, beamsWithLoads, columns, rebarData), 'reinforcement.dxf');
                    }}>مخطط التسليح</Button>
                  </CardContent>
                </Card>
              </div>

              {/* Beam Rebar Detail Views */}
              {analyzed && beamDesigns.length > 0 && (
                <div className="mt-6 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">تفاصيل تسليح الجسور</h3>
                  {beamDesigns.map(d => {
                    const beam = beamsWithLoads.find(b => b.id === d.beamId);
                    if (!beam) return null;
                    const bent = getBentUpData(d.beamId);
                    return (
                      <BeamRebarDetailView
                        key={d.beamId}
                        beamId={d.beamId}
                        b={beam.b}
                        h={beam.h}
                        span={d.span}
                        flexLeft={d.flexLeft}
                        flexMid={d.flexMid}
                        flexRight={d.flexRight}
                        shear={d.shear}
                        hasBentBars={!!bent}
                        additionalTopLeft={bent?.additionalTopLeft}
                        additionalTopRight={bent?.additionalTopRight}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          {/* MULTI-STORY BUILDING TAB */}
          <TabsContent value="building" className="flex-1 overflow-hidden mt-0">
            <MultiStoryDesigner
              initialSlabs={slabs}
              mat={mat}
              slabProps={slabProps}
              beamB={beamB}
              beamH={beamH}
              colB={colB}
              colH={colH}
              onClose={() => dispatch({ type: 'SET_ACTIVE_TAB', tab: 'modeler' })}
            />
          </TabsContent>

          {/* GLOBAL FRAME SOLVER TAB */}
          <TabsContent value="solver" className="flex-1 overflow-auto mt-0 p-3 space-y-4">
            <AdvancedAnalysisPanel
              frames={frames}
              beams={beamsWithLoads}
              columns={columns}
              mat={mat}
              bobConnections={detectedConnections}
              slabs={slabs}
              slabProps={slabProps}
              beamStiffnessFactor={beamStiffnessFactor}
              colStiffnessFactor={colStiffnessFactor}
              onColStiffnessChange={(v) => dispatch({ type: 'SET_COL_STIFFNESS_FACTOR', value: v })}
            />
            <GlobalFrameSolverPanel />
          </TabsContent>

          {/* PROJECTS TAB */}
          <TabsContent value="projects" className="flex-1 overflow-hidden mt-0">
            <ProjectManager
              currentState={state}
              onLoadProject={(data) => dispatch({ type: 'LOAD_PROJECT', data })}
              onNewProject={() => dispatch({ type: 'RESET_TO_DEFAULT' })}
              storyCount={stories.length}
              slabCount={slabs.length}
            />
          </TabsContent>

          {/* GENERATIVE TAB */}
          <TabsContent value="generative" className="flex-1 overflow-hidden mt-0">
            <GenerativeDesignDashboard
              onApplyOption={(ev: EvaluatedOption) => {
                dispatch({
                  type: 'APPLY_GENERATIVE',
                  slabs: (ev.option.slabs?.length ? ev.option.slabs : slabs) as Slab[],
                  beamB: ev.option.sections.beamB,
                  beamH: ev.option.sections.beamH,
                  colB: ev.option.sections.colB,
                  colH: ev.option.sections.colH,
                });
                setMainTab('modeling');
                dispatch({ type: 'SET_ACTIVE_TAB', tab: 'modeler' });
              }}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Rebar Detail Modal */}
      {selectedElement && modalData && (
        <RebarDetailModal
          open={modalOpen}
          onClose={() => dispatch({ type: 'CLOSE_MODAL' })}
          elementType={selectedElement.type}
          elementId={selectedElement.id}
          dimensions={modalData.dimensions}
          reinforcement={modalData.reinforcement}
        />
      )}

      <Dialog open={!!releaseEditorBeamId} onOpenChange={(open) => !open && setReleaseEditorBeamId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">تحرير أطراف الجسر {releaseEditorBeam?.id}</DialogTitle>
            <DialogDescription>
              عدّل Releases للجسر مباشرة من تبويب الإدخال، وأي حفظ هنا يلغي نتائج التحليل السابقة حتى تعيد التشغيل بالقيم الجديدة.
            </DialogDescription>
          </DialogHeader>

          {releaseEditorBeam && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground md:grid-cols-3">
                <div>من ({releaseEditorBeam.x1.toFixed(2)}, {releaseEditorBeam.y1.toFixed(2)})</div>
                <div>إلى ({releaseEditorBeam.x2.toFixed(2)}, {releaseEditorBeam.y2.toFixed(2)})</div>
                <div>المنسوب Z: {((releaseEditorBeam.z ?? 0) / 1000).toFixed(2)} م</div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {([
                  { key: 'nodeI' as const, title: 'الطرف I (بداية الجسر)' },
                  { key: 'nodeJ' as const, title: 'الطرف J (نهاية الجسر)' },
                ]).map(({ key, title }) => (
                  <div key={key} className="space-y-3 rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                      <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => resetReleaseEditorEnd(key)}>
                        تصفير الطرف
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {RELEASE_DOF_META.map(({ key: dof, etabs, desc }) => (
                        <label key={`${key}-${dof}`} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                          <div className="space-y-0.5">
                            <div className="font-mono text-xs text-foreground">{etabs}</div>
                            <div className="text-[11px] text-muted-foreground">{desc}</div>
                          </div>
                          <Checkbox
                            checked={releaseEditorData[key][dof]}
                            onCheckedChange={(checked) => handleReleaseEditorToggle(key, dof, checked === true)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {releaseEditorWarnings.length > 0 && (
                <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                  {releaseEditorWarnings.map((warning) => (
                    <p key={warning} className="text-xs font-medium text-destructive">⚠ {warning}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReleaseEditorBeamId(null)}>إلغاء</Button>
            <Button type="button" onClick={saveBeamReleaseEditor}>حفظ التحرير</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Element Properties Dialog (long-press) */}
      <ElementPropertiesDialog
        open={elemPropsOpen}
        onClose={() => dispatch({ type: 'CLOSE_ELEM_PROPS' })}
        frame={elemPropsFrameId != null ? currentFrames.find(f => f.id === elemPropsFrameId) : null}
        area={elemPropsAreaId != null ? currentAreas.find(a => a.id === elemPropsAreaId) : null}
        nodeI={elemPropsFrameId != null ? (() => { const f = currentFrames.find(fr => fr.id === elemPropsFrameId); return f ? currentNodes.find(n => n.id === f.nodeI) : null; })() : null}
        nodeJ={elemPropsFrameId != null ? (() => { const f = currentFrames.find(fr => fr.id === elemPropsFrameId); return f ? currentNodes.find(n => n.id === f.nodeJ) : null; })() : null}
        slabProps={elemPropsAreaId != null ? { ...slabProps, ...(slabPropsOverrides[elemPropsAreaId] || {}) } : null}
        onSave={handleElemPropsSave}
        onDelete={handleElemPropsDelete}
      />

      {/* Analysis Diagram Dialog */}
      <AnalysisDiagramDialog
        open={diagramOpen}
        onClose={() => dispatch({ type: 'CLOSE_DIAGRAM' })}
        data={diagramData}
      />

      {/* Bottom Navigation */}
      <BottomNav 
        activeTab={mainTab} 
        onTabChange={(tab) => {
          setMainTab(tab);
          // Auto-switch to first sub-tab of the section
          if (tab === 'reports') dispatch({ type: 'SET_ACTIVE_TAB', tab: 'design' });
          else if (tab === 'inputs') dispatch({ type: 'SET_ACTIVE_TAB', tab: 'input' });
          else if (tab === 'modeling') dispatch({ type: 'SET_ACTIVE_TAB', tab: 'modeler' });
          else if (tab === 'projects') dispatch({ type: 'SET_ACTIVE_TAB', tab: 'projects' });
          else if (tab === 'solver') dispatch({ type: 'SET_ACTIVE_TAB', tab: 'solver' });
        }}
      />
    </div>
  );
};

export default Index;
