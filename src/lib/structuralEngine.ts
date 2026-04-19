import { buildSlabEdgeLoads, computeBeamLoadProfile } from './slabLoadTransfer';

// ===================== TYPES =====================
export interface Story {
  id: string;
  label: string;
  height: number; // story height in mm
  elevation: number; // elevation from ground in mm (computed)
}

export interface Slab {
  id: string; x1: number; y1: number; x2: number; y2: number;
  storyId?: string;
}
export interface Column {
  id: string; x: number; y: number; b: number; h: number; L: number;
  isRemoved?: boolean;
  storyId?: string;
  zBottom?: number; // Global Z coordinate of column bottom (mm)
  zTop?: number;    // Global Z coordinate of column top (mm), = zBottom + L
  topEndCondition?: 'F' | 'P';
  bottomEndCondition?: 'F' | 'P';
  LBelow?: number;
  bBelow?: number;
  hBelow?: number;
}
export interface Beam {
  id: string; fromCol: string; toCol: string;
  x1: number; y1: number; x2: number; y2: number;
  z?: number; // Global Z coordinate of beam (mm) - at slab level
  length: number; direction: 'horizontal' | 'vertical';
  b: number; h: number;
  deadLoad: number; liveLoad: number;
  wallLoad?: number;
  slabs: string[];
  storyId?: string;
  mergedFrom?: string[]; // IDs of original beams that were merged into this one
}
export interface Frame {
  id: string; beamIds: string[]; direction: 'horizontal' | 'vertical';
  storyId?: string;
}
export interface MatProps {
  fc: number; fy: number; fyt: number; gamma: number;
  stirrupDia?: number;
}
export interface SlabProps {
  thickness: number; finishLoad: number; liveLoad: number;
  cover: number; phiMain: number; phiSlab: number;
}
export interface FrameResult {
  frameId: string;
  beams: {
    beamId: string; span: number;
    Mleft: number; Mmid: number; Mright: number;
    Vu: number;
    Rleft?: number; Rright?: number;
    momentStations?: number[];
  }[];
}
export interface FlexureResult {
  Mu: number; Ru: number; rho: number; As: number; bars: number; dia: number;
  checkSpacing: string;
  requiredSteelArea?: number;
  utilizationRatio?: number;
  compressionSteelYielded?: boolean;
  fsPrime?: number;
  rhoMin?: number;
  rhoMax?: number;
  beta1?: number;
  epsilonT?: number;
  governingCombo?: string;
}
export interface ShearResult {
  Vc: number; Vs: number; sRequired: number; sMax: number; sUsed: number;
  stirrups: string;
  stirrupLegs?: number;
  shearUtilization?: number;
  Vc_simplified?: number;
  Vc_detailed?: number;
}

// ===================== ENHANCED COLUMN TYPES =====================
export interface PMPoint {
  c: number;
  Pn: number;
  Mn: number;
  phi: number;
  phiPn: number;
  phiMn: number;
}

export interface ColumnResult {
  Pu: number; Mu: number;
  checkSlenderness: string;
  bars: number; dia: number;
  stirrups: string;
  phiPn: number; phiMn: number;
  adequate: boolean;
  rhoActual: number;
  kLu_r: number;
  deltaNs: number;
  MuMagnified: number;
  pmDiagram: PMPoint[];
  utilizationRatio: number;
  interactionRatio?: number;
  designCapacity?: number;
  safetyStatus?: string;
}

export interface SlabDesignResult {
  lx: number; ly: number; beta: number;
  isOneWay: boolean;
  hMin: number; hUsed: number;
  ownWeight: number; Wu: number;
  discontinuousEdges: number;
  shortDir: { bars: number; dia: number; spacing: number };
  longDir: { bars: number; dia: number; spacing: number };
  shortCoeff: number; longCoeff: number;
  punchingShear?: PunchingShearResult;
  usedApproximateMethod?: boolean;
}

// ===================== DEFLECTION TYPES =====================
export interface DeflectionResult {
  deflection: number;
  deflectionRatio: number;
  allowableDeflection: number;
  isServiceable: boolean;
  limitUsed: string;
  /** ACI 318-19 §24.2.4: Long-term deflection */
  immediateDeflection?: number;
  longTermDeflection?: number;
  totalDeflection?: number;
  lambdaDelta?: number;
  xi?: number;
  rhoPrime?: number;
}

// ===================== BEAM DIAGNOSTIC (ACI 318-19) =====================
export interface BeamFailureDetail {
  type: 'flexure' | 'shear' | 'deflection' | 'spacing' | 'min_depth';
  aciRef: string;
  description: string;
  currentValue: number;
  limitValue: number;
  exceedPercent: number;
  solution: string;
}

export interface BeamDiagnostic {
  beamId: string;
  isAdequate: boolean;
  failures: BeamFailureDetail[];
  overallStatus: string;
}

export function diagnoseBeam(
  beamId: string,
  beam: { b: number; h: number; length: number },
  flexLeft: FlexureResult, flexMid: FlexureResult, flexRight: FlexureResult,
  shear: ShearResult,
  deflection: DeflectionResult,
  fc: number, fy: number, fyt: number,
  span: number,
  Mu_max: number, Vu: number,
  effectiveFlangeWidth: number = 0,
  slabThickness: number = 0,
): BeamDiagnostic {
  const failures: BeamFailureDetail[] = [];
  // ACI 318-19: d = h − cover − stirrup_dia − half_bar_dia
  // Default: 40mm cover + 10mm stirrup + 6mm (half of 12mm bar) = 56mm
  // Must match designFlexure() and designShear() to avoid inconsistent checks.
  const d = beam.h - 56;
  const phi_flex = 0.9;
  const phi_shear = 0.75;

  // 1. Check minimum beam depth (ACI 318-19 Table 9.3.1.1)
  const hMinSimple = span * 1000 / 16;
  const hMinOneEnd = span * 1000 / 18.5;
  const hMinBothEnds = span * 1000 / 21;
  const hMinUsed = hMinBothEnds;
  if (beam.h < hMinUsed) {
    failures.push({
      type: 'min_depth',
      aciRef: 'ACI 318-19 Table 9.3.1.1',
      description: `عمق الجسر (${beam.h}mm) أقل من الحد الأدنى (${hMinUsed.toFixed(0)}mm)`,
      currentValue: beam.h,
      limitValue: hMinUsed,
      exceedPercent: ((hMinUsed - beam.h) / hMinUsed) * 100,
      solution: `زيادة عمق الجسر إلى ${Math.ceil(hMinUsed / 25) * 25}mm على الأقل`,
    });
  }

  // 2. Check flexure capacity (ACI 318-19 §9.5.1)
  // Must check EACH location separately:
  // - Supports (negative moment): rectangular section (flange in tension)
  // - Midspan (positive moment): T-beam section (flange in compression)
  const beta1 = fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7);
  const rhoMax = 0.85 * beta1 * fc / fy * 0.003 / (0.003 + 0.005);

  // Helper: compute φMn for given bars, dia, width
  const computePhiMn = (bars: number, dia: number, bWidth: number, isTBeam: boolean = false) => {
    const aBar = Math.PI * dia * dia / 4;
    const AsP = bars * aBar;
    if (isTBeam && effectiveFlangeWidth > 0 && slabThickness > 0) {
      const aBlock = AsP * fy / (0.85 * fc * effectiveFlangeWidth);
      if (aBlock <= slabThickness) {
        return phi_flex * AsP * fy * (d - aBlock / 2) / 1e6;
      }
    }
    return phi_flex * AsP * fy * (d - AsP * fy / (1.7 * fc * bWidth)) / 1e6;
  };

  // Check each location
  const locations = [
    { name: 'يسار', Mu: Math.abs(flexLeft.Mu), flex: flexLeft, isPositive: false },
    { name: 'منتصف', Mu: flexMid.Mu, flex: flexMid, isPositive: true },
    { name: 'يمين', Mu: Math.abs(flexRight.Mu), flex: flexRight, isPositive: false },
  ];

  for (const loc of locations) {
    if (loc.Mu <= 0) continue;
    const phiMn = computePhiMn(loc.flex.bars, loc.flex.dia, beam.b, loc.isPositive);
    if (loc.Mu > phiMn && phiMn > 0) {
      const isTSection = loc.isPositive && effectiveFlangeWidth > 0;
      failures.push({
        type: 'flexure',
        aciRef: 'ACI 318-19 §9.5.1.1',
        description: `عزم الانحناء Mu عند ${loc.name} (${loc.Mu.toFixed(1)} kN.m) > φMn (${phiMn.toFixed(1)} kN.m)${isTSection ? ' [T-beam]' : ' [مستطيل]'}`,
        currentValue: loc.Mu,
        limitValue: phiMn,
        exceedPercent: ((loc.Mu - phiMn) / phiMn) * 100,
        solution: loc.isPositive
          ? `زيادة عدد القضبان السفلية أو قطرها أو زيادة عمق الجسر (h)`
          : `زيادة عدد القضبان العلوية أو قطرها أو زيادة عمق الجسر (h)`,
      });
    }
  }

  // Check ρ_max at midspan
  if (flexMid.rho > rhoMax) {
    failures.push({
      type: 'flexure',
      aciRef: 'ACI 318-19 §9.3.3.1',
      description: `نسبة التسليح (${(flexMid.rho * 100).toFixed(2)}%) تتجاوز الحد الأقصى (${(rhoMax * 100).toFixed(2)}%)`,
      currentValue: flexMid.rho * 100,
      limitValue: rhoMax * 100,
      exceedPercent: ((flexMid.rho - rhoMax) / rhoMax) * 100,
      solution: `زيادة أبعاد المقطع (b أو h) أو استخدام تسليح مزدوج (حديد ضغط) أو زيادة f'c`,
    });
  }

  // 3. Check shear (ACI 318-19 §22.5)
  const VsMax = (2 / 3) * Math.sqrt(fc) * beam.b * d / 1000;
  const VuPhi = Math.abs(Vu) / phi_shear;
  const VcPlusVs = shear.Vc + VsMax;

  if (shear.Vs > VsMax) {
    failures.push({
      type: 'shear',
      aciRef: 'ACI 318-19 §22.5.1.2',
      description: `قوة القص المطلوبة Vs (${shear.Vs.toFixed(1)} kN) تتجاوز Vs,max (${VsMax.toFixed(1)} kN)`,
      currentValue: shear.Vs,
      limitValue: VsMax,
      exceedPercent: ((shear.Vs - VsMax) / VsMax) * 100,
      solution: `تكبير المقطع الخرساني (زيادة b أو h) أو تقليل الحمل`,
    });
  }

  if (Math.abs(Vu) > phi_shear * (shear.Vc + VsMax)) {
    failures.push({
      type: 'shear',
      aciRef: 'ACI 318-19 §9.5.1.1',
      description: `Vu (${Math.abs(Vu).toFixed(1)} kN) > φ(Vc+Vs,max) (${(phi_shear * VcPlusVs).toFixed(1)} kN)`,
      currentValue: Math.abs(Vu),
      limitValue: phi_shear * VcPlusVs,
      exceedPercent: ((Math.abs(Vu) - phi_shear * VcPlusVs) / (phi_shear * VcPlusVs)) * 100,
      solution: `تكبير المقطع أو تقليل مسافة الكانات إلى ${Math.max(75, Math.floor(shear.sRequired / 25) * 25)}mm أو استخدام كانة بقطر أكبر`,
    });
  }

  // 4. Check deflection (ACI 318-19 Table 24.2.2)
  if (!deflection.isServiceable) {
    failures.push({
      type: 'deflection',
      aciRef: 'ACI 318-19 Table 24.2.2',
      description: `الترخيم (${deflection.deflection.toFixed(1)}mm) يتجاوز الحد المسموح (${deflection.allowableDeflection.toFixed(1)}mm = ${deflection.limitUsed})`,
      currentValue: deflection.deflection,
      limitValue: deflection.allowableDeflection,
      exceedPercent: ((deflection.deflection - deflection.allowableDeflection) / deflection.allowableDeflection) * 100,
      solution: `زيادة عمق الجسر (h) أو زيادة عرض الجسر (b) أو زيادة تسليح الشد`,
    });
  }

  // 5. Check bar spacing (ACI 318-19 §25.2.1)
  if (flexMid.checkSpacing !== 'ok') {
    const clearSpacing = (beam.b - 2 * 40 - 2 * 10 - flexMid.bars * flexMid.dia) / (flexMid.bars - 1);
    const minRequired = Math.max(flexMid.dia, 25);
    failures.push({
      type: 'spacing',
      aciRef: 'ACI 318-19 §25.2.1',
      description: `المسافة الصافية بين القضبان (${clearSpacing.toFixed(0)}mm) أقل من الحد الأدنى (${minRequired}mm)`,
      currentValue: clearSpacing,
      limitValue: minRequired,
      exceedPercent: ((minRequired - clearSpacing) / minRequired) * 100,
      solution: `استخدام قطر أصغر مع عدد أكبر، أو ترتيب التسليح في طبقتين، أو زيادة عرض الجسر`,
    });
  }

  const isAdequate = failures.length === 0;
  let overallStatus = 'آمن ✓';
  if (!isAdequate) {
    const types = [...new Set(failures.map(f => f.type))];
    const typeNames: Record<string, string> = {
      flexure: 'الانحناء', shear: 'القص', deflection: 'الترخيم',
      spacing: 'التباعد', min_depth: 'العمق'
    };
    overallStatus = `تجاوز في: ${types.map(t => typeNames[t]).join('، ')}`;
  }

  return { beamId, isAdequate, failures, overallStatus };
}

// ===================== PUNCHING SHEAR TYPES =====================
export interface PunchingShearResult {
  Vu: number;
  Vc: number;
  punchingSafetyFactor: number;
  adequate: boolean;
  requiresShearReinforcement?: boolean;
  suggestedType?: string;
  Vs_required?: number;
  reference?: string;
}

// ===================== LOAD CASES & COMBINATIONS =====================
export interface LoadCase {
  name: string;
  type: 'dead' | 'live' | 'wind' | 'seismic';
  factor: number;
}

export interface LoadCombination {
  name: string;
  factors: { dead: number; live: number; wind: number; seismic: number };
}

export const ACI_LOAD_COMBINATIONS: LoadCombination[] = [
  { name: '1.4D', factors: { dead: 1.4, live: 0, wind: 0, seismic: 0 } },
  { name: '1.2D+1.6L', factors: { dead: 1.2, live: 1.6, wind: 0, seismic: 0 } },
  { name: '1.2D+1.6W+L+0.5Lr', factors: { dead: 1.2, live: 1.0, wind: 1.6, seismic: 0 } }, // ACI 318-19 §5.3.1d
  { name: '1.2D+1.0L+1.0W', factors: { dead: 1.2, live: 1.0, wind: 1.0, seismic: 0 } },
  { name: '1.2D+1.0L+1.0E', factors: { dead: 1.2, live: 1.0, wind: 0, seismic: 1.0 } },
  { name: '0.9D+1.0W', factors: { dead: 0.9, live: 0, wind: 1.0, seismic: 0 } },
  { name: '0.9D+1.0E', factors: { dead: 0.9, live: 0, wind: 0, seismic: 1.0 } },
];

/**
 * Get governing factored load from all ACI 318-19 load combinations.
 * Returns the maximum factored distributed load (wu) and the governing combination.
 * For moment/shear computation, use analyzeFrame which applies pattern loading.
 */
export function getGoverningForces(
  deadLoad: number,
  liveLoad: number,
  windLoad: number = 0,
  seismicLoad: number = 0,
  span: number = 1
): { maxWu: number; minWu: number; maxMoment: number; maxShear: number; governingCombo: string } {
  let maxWu = 0;
  let minWu = Infinity;
  let governingCombo = '';

  for (const combo of ACI_LOAD_COMBINATIONS) {
    const wu = combo.factors.dead * deadLoad +
               combo.factors.live * liveLoad +
               combo.factors.wind * windLoad +
               combo.factors.seismic * seismicLoad;

    if (Math.abs(wu) > Math.abs(maxWu)) {
      maxWu = wu;
      governingCombo = combo.name;
    }
    minWu = Math.min(minWu, wu);
  }

  // Compute approximate moment and shear from governing wu
  // Simple span: M = wuL²/8, V = wuL/2 (for continuous beams, use analyzeFrame)
  const maxMoment = Math.abs(maxWu) * span * span / 8;
  const maxShear = Math.abs(maxWu) * span / 2;

  return { maxWu, minWu, maxMoment, maxShear, governingCombo };
}

// ===================== BEAM-ON-BEAM TYPES =====================
export interface BeamOnBeamConnection {
  removedColumnId: string;
  point: { x: number; y: number };
  secondaryBeamIds: string[];
  /** The beam segment ENDING at the removed-column node (A1) */
  primaryBeamId: string;
  /**
   * The beam segment STARTING at the removed-column node (A2), when two
   * collinear segments meet at the junction. Load must reach BOTH A1 and A2.
   */
  continuationBeamId?: string;
  distanceOnPrimary: number;
  primaryDirection: 'horizontal' | 'vertical';
  reactionForce: number;
}

// ===================== STRUCTURED RESULT TYPES =====================
export interface BeamAnalysisResult {
  beamId: string;
  frameId: string;
  span: number;
  internalForces: {
    Mleft: number; Mmid: number; Mright: number; Vu: number;
  };
  controllingCombination: string;
  flexureDesign: {
    left: FlexureResult;
    mid: FlexureResult;
    right: FlexureResult;
  };
  shearDesign: ShearResult;
  deflection: DeflectionResult;
  safetyRatios: {
    flexure: number;
    shear: number;
    deflection: number;
  };
}

export interface ColumnDesignResult {
  columnId: string;
  internalForces: { Pu: number; Mu: number };
  controllingCombination: string;
  design: ColumnResult;
  safetyRatios: {
    interaction: number;
    slenderness: number;
  };
}

export interface SlabDesignResultFull {
  slabId: string;
  internalForces: { Wu: number };
  controllingCombination: string;
  design: SlabDesignResult;
  safetyRatios: {
    flexure: number;
    punchingShear: number;
  };
}

// ===================== GEOMETRY =====================
/** Round a coordinate to 3 decimal places for stable Map key construction. */
const coordKey = (v: number) => Math.round(v * 1000) / 1000;

export function generateColumns(slabs: Slab[]): Column[] {
  const map = new Map<string, { x: number; y: number }>();
  for (const s of slabs) {
    for (const p of [
      { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y1 },
      { x: s.x1, y: s.y2 }, { x: s.x2, y: s.y2 },
    ]) {
      map.set(`${coordKey(p.x)},${coordKey(p.y)}`, p);
    }
  }
  const pts = [...map.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  return pts.map((p, i) => ({
    id: `C${i + 1}`, x: p.x, y: p.y, b: 300, h: 400, L: 4000,
  }));
}

/**
 * Generate beams for irregular buildings.
 * 
 * For each slab edge, find ALL columns that lie on that edge (not just corners).
 * This handles irregular buildings where intermediate columns split an edge into
 * multiple shorter beams. Each sub-segment between consecutive columns becomes a beam.
 * 
 * Beams also track which slabs they border AND the actual contact distance with
 * each slab edge (for partial-contact load distribution).
 */
export function generateBeams(slabs: Slab[], columns: Column[]): Beam[] {
  // Collect all unique slab edges with their associated slab IDs
  const edgeMap = new Map<string, { x1: number; y1: number; x2: number; y2: number; slabs: string[] }>();
  for (const s of slabs) {
    const edges = [
      { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y1 },
      { x1: s.x2, y1: s.y1, x2: s.x2, y2: s.y2 },
      { x1: s.x1, y1: s.y2, x2: s.x2, y2: s.y2 },
      { x1: s.x1, y1: s.y1, x2: s.x1, y2: s.y2 },
    ];
    for (const e of edges) {
      const [px1, py1, px2, py2] = e.x1 < e.x2 || (e.x1 === e.x2 && e.y1 < e.y2)
        ? [e.x1, e.y1, e.x2, e.y2] : [e.x2, e.y2, e.x1, e.y1];
      const key = `${coordKey(px1)},${coordKey(py1)}-${coordKey(px2)},${coordKey(py2)}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { x1: px1, y1: py1, x2: px2, y2: py2, slabs: [] });
      edgeMap.get(key)!.slabs.push(s.id);
    }
  }

  const beams: Beam[] = [];
  let id = 1;
  const EPS = 1e-6;

  for (const [, edge] of edgeMap) {
    const isHorizontal = Math.abs(edge.y1 - edge.y2) < EPS;
    const isVertical = Math.abs(edge.x1 - edge.x2) < EPS;

    // Find ALL columns on this edge (not just endpoints)
    const colsOnEdge: Column[] = [];
    for (const col of columns) {
      if (isHorizontal) {
        if (Math.abs(col.y - edge.y1) < EPS && col.x >= edge.x1 - EPS && col.x <= edge.x2 + EPS) {
          colsOnEdge.push(col);
        }
      } else if (isVertical) {
        if (Math.abs(col.x - edge.x1) < EPS && col.y >= edge.y1 - EPS && col.y <= edge.y2 + EPS) {
          colsOnEdge.push(col);
        }
      } else {
        // Diagonal/skew edge — check if column lies on the line segment
        const dx = edge.x2 - edge.x1;
        const dy = edge.y2 - edge.y1;
        const edgeLen = Math.sqrt(dx * dx + dy * dy);
        const t = ((col.x - edge.x1) * dx + (col.y - edge.y1) * dy) / (edgeLen * edgeLen);
        if (t >= -EPS && t <= 1 + EPS) {
          const projX = edge.x1 + t * dx;
          const projY = edge.y1 + t * dy;
          if (Math.abs(col.x - projX) < EPS && Math.abs(col.y - projY) < EPS) {
            colsOnEdge.push(col);
          }
        }
      }
    }

    // Sort columns along edge direction
    if (isHorizontal) {
      colsOnEdge.sort((a, b) => a.x - b.x);
    } else if (isVertical) {
      colsOnEdge.sort((a, b) => a.y - b.y);
    } else {
      colsOnEdge.sort((a, b) => {
        const da = Math.sqrt((a.x - edge.x1) ** 2 + (a.y - edge.y1) ** 2);
        const db = Math.sqrt((b.x - edge.x1) ** 2 + (b.y - edge.y1) ** 2);
        return da - db;
      });
    }

    // If fewer than 2 columns on edge, try to use edge endpoints as fallback
    if (colsOnEdge.length < 2) {
      const fc = columns.find(c => Math.abs(c.x - edge.x1) < EPS && Math.abs(c.y - edge.y1) < EPS);
      const tc = columns.find(c => Math.abs(c.x - edge.x2) < EPS && Math.abs(c.y - edge.y2) < EPS);
      const len = Math.sqrt((edge.x2 - edge.x1) ** 2 + (edge.y2 - edge.y1) ** 2);
      if (len > EPS) {
        beams.push({
          id: `B${id++}`, fromCol: fc?.id || '', toCol: tc?.id || '',
          x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
          length: len, direction: isHorizontal ? 'horizontal' : 'vertical',
          b: 200, h: 400, deadLoad: 0, liveLoad: 0, slabs: edge.slabs,
        });
      }
      continue;
    }

    // Create beam segments between consecutive columns
    for (let i = 0; i < colsOnEdge.length - 1; i++) {
      const c1 = colsOnEdge[i];
      const c2 = colsOnEdge[i + 1];
      const len = Math.sqrt((c2.x - c1.x) ** 2 + (c2.y - c1.y) ** 2);
      if (len < EPS) continue;

      beams.push({
        id: `B${id++}`, fromCol: c1.id, toCol: c2.id,
        x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y,
        length: len, direction: isHorizontal ? 'horizontal' : 'vertical',
        b: 200, h: 400, deadLoad: 0, liveLoad: 0, slabs: edge.slabs,
      });
    }
  }
  return beams;
}

export function generateFrames(beams: Beam[]): Frame[] {
  // Tolerance for floating-point coordinate comparisons (same units as coordinates)
  const COORD_TOL = 1e-4;

  // Normalise a coordinate to a stable string key (rounds to 4 decimal places)
  const coordKey = (n: number) => Math.round(n * 1e4) / 1e4;

  // Group beams by story + direction line using normalised coordinate keys
  const groups = new Map<string, Beam[]>();
  for (const b of beams) {
    const storyKey = b.storyId ?? '_';
    // Use normalised coordinate so that floating-point near-misses (e.g. 5.000000001)
    // don't create spurious extra groups splitting A1 and A2 onto different keys.
    const lineCoord = b.direction === 'horizontal' ? coordKey(b.y1) : coordKey(b.x1);
    const key = `${storyKey}-${b.direction === 'horizontal' ? 'H' : 'V'}-${lineCoord}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }
  
  // Sort groups by story elevation (bottom to top) then by direction key
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const aBeams = groups.get(a)!;
    const bBeams = groups.get(b)!;
    const aZ = aBeams[0]?.z ?? 0;
    const bZ = bBeams[0]?.z ?? 0;
    if (aZ !== bZ) return aZ - bZ;
    return a.localeCompare(b);
  });
  
  const frames: Frame[] = [];
  let fid = 1;
  for (const key of sortedKeys) {
    const gBeams = groups.get(key)!;
    const sorted = [...gBeams].sort((a, b) =>
      a.direction === 'horizontal' ? a.x1 - b.x1 : a.y1 - b.y1
    );
    let cur: Beam[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = cur[cur.length - 1];
      // Use tolerance-based connectivity check instead of strict === to avoid
      // floating-point mismatches that would split collinear segments (A1, A2)
      // into separate frames, preventing load transfer at the junction.
      const connected =
        Math.abs(prev.x2 - sorted[i].x1) < COORD_TOL &&
        Math.abs(prev.y2 - sorted[i].y1) < COORD_TOL;
      if (connected) {
        cur.push(sorted[i]);
      } else {
        frames.push({ id: `F${fid++}`, beamIds: cur.map(b => b.id), direction: cur[0].direction, storyId: cur[0].storyId });
        cur = [sorted[i]];
      }
    }
    frames.push({ id: `F${fid++}`, beamIds: cur.map(b => b.id), direction: cur[0].direction, storyId: cur[0].storyId });
  }
  return frames;
}

// ===================== LOADS =====================
/**
 * Calculate beam loads from adjacent slabs — ETABS-equivalent tributary area method.
 *
 * ─── METHODOLOGY ────────────────────────────────────────────────────────────
 * Matches ETABS "No Slab Stiffness" / Tributary Area load distribution.
 *
 * ONE-WAY SLABS  (β = ly/lx > 2)  — ACI 318-19 §8.5, Table 8.10.3
 *   The slab spans entirely in the SHORT direction (lx).
 *   All load goes to the LONG-SIDE beams (the beams the slab spans BETWEEN).
 *   Short-side beams carry ZERO slab load (same as ETABS one-way strip).
 *
 *   Long-side beam (spanning beam):
 *     W = w × lx / 2   (kN/m — full tributary half-width on each side)
 *
 *   Short-side beam:
 *     W = 0             (no load — slab spans away from this beam)
 *
 * TWO-WAY SLABS  (β = ly/lx ≤ 2)  — ACI 318-19 §8.10, yield-line theory
 *   Yield-line 45° lines from corners divide the slab into trapezoids/triangles.
 *
 *   Long-side beam (trapezoidal tributary):
 *     W_eq = w × lx × (3 − β²) / 6   [kN/m, equivalent UDL for same max moment]
 *     Derivation: trapezoidal area A = lx/2 × (ly − lx/3); equivalent UDL
 *     w_eq = w × A/ly gives the total load; the formula above redistributes
 *     it as a UDL producing the same midspan moment as the actual trapezoid.
 *     Fixed-end moment factor: FEM = w × lx × (3 − β²) / 6 × L² / 12
 *
 *   Short-side beam (triangular tributary):
 *     W_eq = w × lx / 3              [kN/m, equivalent UDL for same max moment]
 *     Derivation: triangular area A = lx²/4; equivalent UDL w_eq = 2/3 × w_peak
 *     where w_peak = w × lx/2, giving w_eq = w × lx/3.
 *
 * PARTIAL CONTACT  (irregular grids)
 *   contactRatio = overlapLength / beamLength adjusts for beams shorter than
 *   the full slab edge.  This is consistent with ETABS automatic load-to-frame.
 *
 * UNITS: w in kN/m², lx/ly in m → W in kN/m (UDL on beam).
 * ────────────────────────────────────────────────────────────────────────────
 */
export function calculateBeamLoads(
  beam: Beam, slabs: Slab[], slabProps: SlabProps, mat: MatProps
): { deadLoad: number; liveLoad: number } {
  const ownWeight = (slabProps.thickness / 1000) * mat.gamma;
  const wDL = ownWeight + slabProps.finishLoad;
  const wLL = slabProps.liveLoad;
  const beamSW = (beam.b / 1000) * (beam.h / 1000) * mat.gamma;

  const slabEdgeLoads = buildSlabEdgeLoads(slabs, wDL, wLL);
  const slabTransfer = computeBeamLoadProfile(beam, slabEdgeLoads);

  return {
    deadLoad: beamSW + slabTransfer.equivalentDL,
    liveLoad: slabTransfer.equivalentLL,
  };
}

// ===================== BEAM-ON-BEAM DETECTION =====================
export function detectBeamOnBeam(
  beams: Beam[], columns: Column[], removedColumnIds: string[],
  /** تعديل يدوي على اتجاه الجسر الحامل: المفتاح = removedColumnId، القيمة = الاتجاه المفروض */
  forcedPrimaryDirection?: Record<string, 'horizontal' | 'vertical'>
): BeamOnBeamConnection[] {
  const connections: BeamOnBeamConnection[] = [];

  for (const colId of removedColumnIds) {
    const col = columns.find(c => c.id === colId);
    if (!col) continue;

    // Match beams by fromCol/toCol ID, OR geometrically (for virtual intersect columns)
    const GEO_TOL = 0.05;
    const beamsAtCol = beams.filter(b => {
      if (b.fromCol === colId || b.toCol === colId) return true;
      // Geometric fallback: check if the column position lies on this beam
      if (b.direction === 'horizontal') {
        if (Math.abs(b.y1 - col.y) > GEO_TOL) return false;
        const xMin = Math.min(b.x1, b.x2);
        const xMax = Math.max(b.x1, b.x2);
        return col.x >= xMin - GEO_TOL && col.x <= xMax + GEO_TOL;
      } else {
        if (Math.abs(b.x1 - col.x) > GEO_TOL) return false;
        const yMin = Math.min(b.y1, b.y2);
        const yMax = Math.max(b.y1, b.y2);
        return col.y >= yMin - GEO_TOL && col.y <= yMax + GEO_TOL;
      }
    });
    const hBeams = beamsAtCol.filter(b => b.direction === 'horizontal');
    const vBeams = beamsAtCol.filter(b => b.direction === 'vertical');

    if (hBeams.length === 0 || vBeams.length === 0) continue;

    // --- Rule: If two collinear beams (same direction) meet one perpendicular beam ---
    // The collinear pair is ALWAYS primary (they form one continuous beam split for analysis)
    // The single perpendicular beam is ALWAYS secondary (carried/محمول)
    // This overrides the stiffness comparison because continuity governs.
    // Exception: user manual override always wins.
    let primaryIsHorizontal: boolean;
    if (forcedPrimaryDirection?.[colId] !== undefined) {
      // User override takes priority over all automatic rules
      primaryIsHorizontal = forcedPrimaryDirection[colId] === 'horizontal';
    } else if (hBeams.length >= 2 && vBeams.length === 1) {
      // Two horizontal (collinear) + one vertical: horizontal is primary
      primaryIsHorizontal = true;
    } else if (vBeams.length >= 2 && hBeams.length === 1) {
      // Two vertical (collinear) + one horizontal: vertical is primary
      primaryIsHorizontal = false;
    } else {
      // Equal counts or other configs: use EI/L stiffness comparison (ETABS approach)
      const hStiffness = hBeams.reduce((maxS, b) => {
        const I = (b.b / 1000) * Math.pow(b.h / 1000, 3) / 12;
        return Math.max(maxS, I / b.length);
      }, 0);
      const vStiffness = vBeams.reduce((maxS, b) => {
        const I = (b.b / 1000) * Math.pow(b.h / 1000, 3) / 12;
        return Math.max(maxS, I / b.length);
      }, 0);
      primaryIsHorizontal = hStiffness >= vStiffness;
    }
    const primaryBeams = primaryIsHorizontal ? hBeams : vBeams;
    const secondaryBeams = primaryIsHorizontal ? vBeams : hBeams;

    let primaryBeam: Beam | undefined;    // A1: ends at removed column
    let continuationBeam: Beam | undefined; // A2: starts at removed column
    let distOnPrimary = 0;

    // Helper: check if beam's "from" end is at the column (by ID or geometry)
    const isFromEnd = (b: Beam) => {
      if (b.fromCol === colId) return true;
      return Math.abs(b.x1 - col.x) < GEO_TOL && Math.abs(b.y1 - col.y) < GEO_TOL;
    };
    const isToEnd = (b: Beam) => {
      if (b.toCol === colId) return true;
      return Math.abs(b.x2 - col.x) < GEO_TOL && Math.abs(b.y2 - col.y) < GEO_TOL;
    };
    // Also check if point is interior (not at either end) — for beams that pass through
    const isInterior = (b: Beam) => !isFromEnd(b) && !isToEnd(b);

    for (const pb of primaryBeams) {
      if (isInterior(pb)) {
        // The intersection point is in the middle of this beam — this IS the primary/carrier
        primaryBeam = pb;
        continuationBeam = undefined;
        if (pb.direction === 'horizontal') {
          distOnPrimary = Math.abs(col.x - pb.x1);
        } else {
          distOnPrimary = Math.abs(col.y - pb.y1);
        }
        break;
      }
      if (isFromEnd(pb)) {
        continuationBeam = pb;
        const prevBeam = primaryBeams.find(b => isToEnd(b));
        if (prevBeam) {
          primaryBeam = prevBeam;
          distOnPrimary = prevBeam.length;
        } else {
          primaryBeam = pb;
          continuationBeam = undefined;
          distOnPrimary = 0;
        }
        break;
      }
      if (isToEnd(pb)) {
        primaryBeam = pb;
        distOnPrimary = pb.length;
        continuationBeam = primaryBeams.find(b => isFromEnd(b) && b.id !== pb.id);
        break;
      }
    }

    if (!primaryBeam) continue;

    connections.push({
      removedColumnId: colId,
      point: { x: col.x, y: col.y },
      secondaryBeamIds: secondaryBeams.map(b => b.id),
      primaryBeamId: primaryBeam.id,
      continuationBeamId: continuationBeam?.id,
      distanceOnPrimary: distOnPrimary,
      primaryDirection: primaryIsHorizontal ? 'horizontal' : 'vertical',
      reactionForce: 0,
    });
  }

  return connections;
}

// ===================== MOMENT DISTRIBUTION ANALYSIS (2D Engine) =====================
// Uses Hardy Cross moment distribution method matching the Excel spreadsheet approach
import { MSPointLoad, MSNode, MSElement, analyzeByMatrixStiffness, envelopeAnalysis as msEnvelopeAnalysis } from './matrixStiffness';
import { MDNode, MDElement, envelopeByMomentDistribution, analyzeByMomentDistribution } from './momentDistribution';

export function analyzeFrame(
  frame: Frame, beamsMap: Map<string, Beam>,
  columns: Column[], mat: MatProps,
  removedColumnIds: string[] = [],
  additionalPointLoads?: Map<string, MSPointLoad[]>,
  /** Set of beam IDs that should have moment releases: 'I' = start end, 'J' = end end, 'BOTH' = both ends */
  secondaryBeamHinges?: Map<string, 'I' | 'J' | 'BOTH'>,
  /** Beam-on-beam connections for determining carrier vs carried role at each junction */
  beamOnBeamConnections?: BeamOnBeamConnection[],
  /** معامل تخفيض جساءة الجسور (الافتراضي 0.35 حسب ACI 318-19 §6.6.3) */
  beamStiffnessFactor: number = 0.35,
  /** معامل تخفيض جساءة الأعمدة (الافتراضي 0.70·Ig حسب ACI 318-19 §6.6.3.1.1) */
  colStiffnessFactor: number = 0.70,
): FrameResult {
  const frameBeams = frame.beamIds.map(id => beamsMap.get(id)!);
  const n = frameBeams.length;

  // Build nodes with column stiffness for moment distribution
  const nodes: MDNode[] = [];
  for (let i = 0; i <= n; i++) {
    const beam = i < n ? frameBeams[i] : frameBeams[n - 1];
    const colId = i < n ? beam.fromCol : beam.toCol;
    const col = columns.find(c => c.id === colId);
    const isRemovedCol = removedColumnIds.includes(colId);

    // Determine if this node acts as a support for THIS frame's beams.
    // At a removed column junction:
    //   - If beams in this frame are SECONDARY (carried): isSupport = TRUE
    //     (the carrier beam provides support at this point)
    //   - If beams in this frame are PRIMARY (carrier): isSupport = FALSE
    //     (no real support; merge will combine the collinear segments)
    //   - If no connection info: default to isSupport = !isRemovedCol
    let isNodeSupport = !isRemovedCol;
    let colStiffnessBelow = 0;
    let colStiffnessAbove = 0;

    if (isRemovedCol && beamOnBeamConnections) {
      const conn = beamOnBeamConnections.find(c => c.removedColumnId === colId);
      if (conn) {
        // Check if any beam in this frame is a secondary (carried) beam at this junction
        const frameBeamIdSet = new Set(frame.beamIds);
        const isSecondaryFrame = conn.secondaryBeamIds.some(sid => frameBeamIdSet.has(sid));
        if (isSecondaryFrame) {
          // This frame's beams are CARRIED → the junction IS a support for them
          isNodeSupport = true;
        }
        // else: this frame's beams are PRIMARY (carrier) → no support, will be merged
      }
    }

    if (col && !isRemovedCol) {
      const Ec = 4700 * Math.sqrt(mat.fc) * 1000;

      // Use correct moment of inertia based on frame direction:
      // For horizontal frame (beams along X) → column bends about Y-axis → Iy = h * b³ / 12
      // For vertical frame (beams along Y) → column bends about X-axis → Ix = b * h³ / 12
      const frameDir = frame.direction;
      const colBm = col.b / 1000;
      const colHm = col.h / 1000;
      const Ic_below = frameDir === 'horizontal'
        ? colHm * Math.pow(colBm, 3) / 12   // Iy for bending about Y-axis
        : colBm * Math.pow(colHm, 3) / 12;  // Ix for bending about X-axis
      const Lc_below = col.L / 1000;
      const farEndFactorBelow = col.bottomEndCondition === 'P' ? 3 : 4;
      colStiffnessBelow = farEndFactorBelow * Ec * (colStiffnessFactor * Ic_below) / Lc_below;

      // Column above stiffness (if exists)
      if (col.LBelow && col.LBelow > 0) {
        const bAbove = (col.bBelow || col.b) / 1000;
        const hAbove = (col.hBelow || col.h) / 1000;
        const Ic_above = frameDir === 'horizontal'
          ? hAbove * Math.pow(bAbove, 3) / 12
          : bAbove * Math.pow(hAbove, 3) / 12;
        const Lc_above = col.LBelow / 1000;
        const farEndFactorAbove = col.topEndCondition === 'P' ? 3 : 4;
        colStiffnessAbove = farEndFactorAbove * Ec * (colStiffnessFactor * Ic_above) / Lc_above;
      }
    }

    const x = i === 0 ? 0 : nodes[i - 1].x + frameBeams[i - 1].length;
    
    // Determine end condition for first and last supports
    let endCondition: 'K' | 'E' | undefined;
    if (i === 0 || i === n) {
      // For carried (secondary) beams at a removed-column junction:
      // do NOT force knife-edge and provide rotational stiffness from
      // the primary (carrying) beam so that moments are NOT auto-released.
      const isCarriedEndAtRemovedCol =
        isRemovedCol &&
        beamOnBeamConnections?.some(c => {
          if (c.removedColumnId !== colId) return false;
          const frameBeamIdSet = new Set(frame.beamIds);
          return c.secondaryBeamIds.some(sid => frameBeamIdSet.has(sid));
        });

      if (isCarriedEndAtRemovedCol) {
        // Provide torsional stiffness of the primary beam as rotational restraint
        // so that moments are NOT released at the carried beam's end.
        const conn = beamOnBeamConnections?.find(c => c.removedColumnId === colId);
        if (conn) {
          const primaryBeam = beamsMap.get(conn.primaryBeamId);
          if (primaryBeam) {
            const Ec = 4700 * Math.sqrt(mat.fc) * 1000;
            const bP = primaryBeam.b / 1000;
            const hP = primaryBeam.h / 1000;
            const LP = primaryBeam.length;
            // Torsional stiffness GJ/L: G ≈ E/2.4, J ≈ b*h³/3 (approximate)
            const minDim = Math.min(bP, hP);
            const maxDim = Math.max(bP, hP);
            const J = minDim * Math.pow(maxDim, 3) * (1/3 - 0.21 * maxDim / minDim * (1 - Math.pow(maxDim, 4) / (12 * Math.pow(minDim, 4))));
            const G = Ec / 2.4;
            const torsionalStiffness = Math.abs(G * J / LP);
            // Use the larger of torsional stiffness and a minimum based on beam flexural stiffness
            const I_primary = (primaryBeam.b / 1000) * Math.pow(primaryBeam.h / 1000, 3) / 12;
            const flexStiffness = 4 * Ec * beamStiffnessFactor * I_primary / LP;
            colStiffnessBelow = Math.max(torsionalStiffness, flexStiffness * 0.5);
          }
        }
        // endCondition stays undefined → treated as semi-rigid
      } else {
        // If the column provides rotational stiffness at this edge,
        // do NOT force knife-edge — let moment distribution account for
        // the column restraint so that edge moments are non-zero.
        const hasColumnStiffness = colStiffnessBelow > 0 || colStiffnessAbove > 0;
        if (hasColumnStiffness) {
          // endCondition stays undefined → semi-rigid joint with column stiffness
        } else {
          // No column stiffness → true pinned (knife edge)
          endCondition = 'K';
        }
      }
    }

    nodes.push({
      id: `N${i}`,
      x,
      isSupport: isNodeSupport,
      colStiffnessAbove,
      colStiffnessBelow,
      endCondition,
    });
  }

  const E = 4700 * Math.sqrt(mat.fc) * 1000;

  // ─── Build analysis elements using clear span (face-to-face) ───
  // ACI 318-19: effective beam length is measured from column face to column face
  const analysisElements: { id: string; L: number; EI: number; pointLoads?: MSPointLoad[]; hingeI: boolean; hingeJ: boolean; halfColLeft: number; halfColRight: number }[] = [];
  for (let i = 0; i < n; i++) {
    const b = frameBeams[i];
    const I_beam = (b.b / 1000) * (b.h / 1000) ** 3 / 12;
    const beamEI = E * (beamStiffnessFactor * I_beam);
    const hinge = secondaryBeamHinges?.get(b.id);

    // Compute half-column widths in beam direction (meters)
    const fromCol = columns.find(c => c.id === b.fromCol);
    const toCol = columns.find(c => c.id === b.toCol);
    const isHoriz = b.direction === 'horizontal';
    const halfColLeft = fromCol ? (isHoriz ? fromCol.b : fromCol.h) / 2000 : 0;
    const halfColRight = toCol ? (isHoriz ? toCol.b : toCol.h) / 2000 : 0;
    // Clear span (face-to-face), minimum 80% of center-to-center per ACI
    const clearSpan = Math.max(b.length - halfColLeft - halfColRight, b.length * 0.8);

    // Adjust point load positions for clear span
    let adjustedPointLoads = additionalPointLoads?.get(b.id);
    if (adjustedPointLoads && halfColLeft > 0) {
      adjustedPointLoads = adjustedPointLoads.map(pl => ({
        ...pl,
        a: Math.max(0, Math.min(pl.a - halfColLeft, clearSpan)),
      }));
    }

    analysisElements.push({
      id: b.id,
      L: clearSpan,
      EI: beamEI,
      pointLoads: adjustedPointLoads,
      hingeI: hinge === 'I' || hinge === 'BOTH',
      hingeJ: hinge === 'J' || hinge === 'BOTH',
      halfColLeft,
      halfColRight,
    });
  }

  // Check for free internal nodes (carrier beams at removed-column junctions)
  const hasFreeInternalNodes = nodes.some((nd, idx) =>
    idx > 0 && idx < n && !nd.isSupport && nd.colStiffnessAbove === 0 && nd.colStiffnessBelow === 0
  );

  // Force matrix stiffness path when any element has a hinge (moment distribution ignores hinges)
  const hasAnyHinge = analysisElements.some(ae => ae.hingeI || ae.hingeJ);

  // ACI load combinations for pattern loading
  const wMax_orig = frameBeams.map(b => 1.2 * b.deadLoad + 1.6 * b.liveLoad);
  const wMin_orig = frameBeams.map(b => 1.2 * b.deadLoad);
  const w14D_orig = frameBeams.map(b => 1.4 * b.deadLoad);

  const loadCases: number[][] = [wMax_orig, w14D_orig, wMin_orig];
  const oddOrig = frameBeams.map((_, i) => i % 2 === 0 ? wMax_orig[i] : wMin_orig[i]);
  const evenOrig = frameBeams.map((_, i) => i % 2 === 1 ? wMax_orig[i] : wMin_orig[i]);
  loadCases.push(oddOrig, evenOrig);

  const nPatterns = Math.min(n, 8);
  const totalPatterns = Math.pow(2, nPatterns);
  for (let mask = 1; mask < totalPatterns; mask++) {
    if (mask === totalPatterns - 1) continue;
    loadCases.push(frameBeams.map((_, i) => {
      const bitIdx = i < nPatterns ? i : i % nPatterns;
      return ((mask >> bitIdx) & 1) ? wMax_orig[i] : wMin_orig[i];
    }));
  }

  // ─── Dispatch: Matrix Stiffness (free nodes) or Moment Distribution (all supported) ───
  const results: FrameResult = { frameId: frame.id, beams: [] };

  if (hasFreeInternalNodes || hasAnyHinge) {
    // ─── Matrix Stiffness path ───
    // Each beam stays as a separate element. Junction node is free (no translational
    // constraint) — the bending stiffness of adjacent elements provides equilibrium.
    // Point loads from carried beams are applied at the junction node via element pointLoads.
    const msNodes: MSNode[] = nodes.map((nd) => {
      const isKnifeEdge = nd.endCondition === 'K';
      return {
        id: nd.id,
        x: nd.x,
        fixedDOFs: [nd.isSupport, false],
        columnStiffness: isKnifeEdge ? 0 : (nd.colStiffnessAbove + nd.colStiffnessBelow),
      };
    });

    const msElements: MSElement[] = analysisElements.map((ae, i) => ({
      id: ae.id,
      nodeI: i,
      nodeJ: i + 1,
      L: ae.L,
      EI: ae.EI,
      w: 0,
      pointLoads: ae.pointLoads,
      hingeI: ae.hingeI,
      hingeJ: ae.hingeJ,
    }));

    const envelope = msEnvelopeAnalysis(msNodes, msElements, loadCases, true);

    for (let i = 0; i < n; i++) {
      const er = envelope.elements[i];
      // Extract momentStations from diagram (20 evenly-spaced stations)
      let momentStations: number[] | undefined;
      if (er.diagram && er.diagram.length > 0) {
        const nSt = 20;
        const L = analysisElements[i].L; // use clear span
        momentStations = new Array(nSt + 1);
        for (let s = 0; s <= nSt; s++) {
          const x = (s / nSt) * L;
          // Find nearest diagram points and interpolate
          let lo = 0;
          for (let d = 0; d < er.diagram.length - 1; d++) {
            if (er.diagram[d + 1].x >= x) { lo = d; break; }
            lo = d;
          }
          const hi = Math.min(lo + 1, er.diagram.length - 1);
          if (lo === hi || Math.abs(er.diagram[hi].x - er.diagram[lo].x) < 1e-12) {
            momentStations[s] = er.diagram[lo].moment;
          } else {
            const t = (x - er.diagram[lo].x) / (er.diagram[hi].x - er.diagram[lo].x);
            momentStations[s] = er.diagram[lo].moment * (1 - t) + er.diagram[hi].moment * t;
          }
        }
      }
      results.beams.push({
        beamId: frameBeams[i].id,
        span: analysisElements[i].L, // clear span (face-to-face)
        Mleft: er.Mleft,
        Mmid: er.Mmid,
        Mright: er.Mright,
        Vu: Math.max(Math.abs(er.Vleft), Math.abs(er.Vright)),
        Rleft: Math.abs(er.Vleft),
        Rright: Math.abs(er.Vright),
        momentStations,
      });
    }
  } else {
    // ─── Moment Distribution path ───
    // All internal nodes are supports — no merging needed.
    const mdElements: MDElement[] = analysisElements.map((ae, i) => ({
      id: ae.id,
      nodeI: i,
      nodeJ: i + 1,
      L: ae.L,
      EI: ae.EI,
      w: 0,
      pointLoads: ae.pointLoads,
      hingeI: ae.hingeI,
      hingeJ: ae.hingeJ,
    }));

    const envelope = envelopeByMomentDistribution(nodes, mdElements, loadCases, true);

    for (let i = 0; i < n; i++) {
      const er = envelope.elements[i];
      // Extract momentStations from diagram (20 evenly-spaced stations)
      let momentStations: number[] | undefined;
      if (er.diagram && er.diagram.length > 0) {
        const nSt = 20;
        const L = analysisElements[i].L; // use clear span
        momentStations = new Array(nSt + 1);
        for (let s = 0; s <= nSt; s++) {
          const x = (s / nSt) * L;
          let lo = 0;
          for (let d = 0; d < er.diagram.length - 1; d++) {
            if (er.diagram[d + 1].x >= x) { lo = d; break; }
            lo = d;
          }
          const hi = Math.min(lo + 1, er.diagram.length - 1);
          if (lo === hi || Math.abs(er.diagram[hi].x - er.diagram[lo].x) < 1e-12) {
            momentStations[s] = er.diagram[lo].moment;
          } else {
            const t = (x - er.diagram[lo].x) / (er.diagram[hi].x - er.diagram[lo].x);
            momentStations[s] = er.diagram[lo].moment * (1 - t) + er.diagram[hi].moment * t;
          }
        }
      }
      results.beams.push({
        beamId: frameBeams[i].id,
        span: analysisElements[i].L, // clear span (face-to-face)
        Mleft: er.Mleft,
        Mmid: er.Mmid,
        Mright: er.Mright,
        Vu: Math.max(Math.abs(er.Vleft), Math.abs(er.Vright)),
        Rleft: Math.abs(er.Vleft),
        Rright: Math.abs(er.Vright),
        momentStations,
      });
    }
  }

  // Analysis already uses clear span (face-to-face) — moments are directly at column face
  // No post-processing reduction needed

  return results;
}

/**
 * Beam-on-Beam analysis with iterative convergence.
 * 
 * IMPROVED: Always uses exact reactions from the matrix stiffness analysis.
 * No approximate formulas - the concentrated load on the carrying beam comes
 * directly from the analysis results (Rleft/Rright) of the secondary beam.
 * 
 * The position of the concentrated load on the primary beam is calculated
 * precisely from coordinates: |x - x1| or |y - y1| depending on direction.
 * 
 * Iterations:
 * 1. Analyze all frames (secondary beams get their reactions)
 * 2. Extract Rleft/Rright at the removed-column end of each secondary beam
 * 3. Apply those reactions as point loads at the exact position on the primary beam
 * 4. Re-analyze frames with point loads
 * 5. Check convergence (< 1% change in reactions)
 */
export function analyzeWithBeamOnBeam(
  frames: Frame[], beamsMap: Map<string, Beam>,
  columns: Column[], mat: MatProps,
  removedColumnIds: string[], connections: BeamOnBeamConnection[],
  maxIterations: number = 10,
  convergenceTol: number = 0.01,
  /** تحرير نهايات يدوي فقط (من محرر الإصدارات) — لا يوجد تحرير تلقائي للجسور المحمولة */
  userDefinedHinges?: Map<string, 'I' | 'J' | 'BOTH'>,
  beamStiffnessFactor: number = 0.35,
  /** ACI 318-19 §6.6.3.1.1: 0.70·Ig للأعمدة */
  colStiffnessFactor: number = 0.70,
): { frameResults: FrameResult[]; connections: BeamOnBeamConnection[]; iterations: number; converged: boolean } {

  // Only user-defined hinges are used — no automatic hinge assignment for secondary (carried) beams.
  // The user controls end releases via the end-release editor (frameEndReleases state).
  const secondaryBeamHinges: Map<string, 'I' | 'J' | 'BOTH'> = userDefinedHinges ?? new Map();

  let currentResults: FrameResult[] = frames.map(f =>
    analyzeFrame(f, beamsMap, columns, mat, removedColumnIds, undefined, secondaryBeamHinges, connections, beamStiffnessFactor, colStiffnessFactor)
  );
  
  let prevReactions = new Map<string, number>();
  let updatedConnections = [...connections];
  let converged = false;
  let iteration = 0;

  for (iteration = 1; iteration <= maxIterations; iteration++) {
    // Step 1: Extract EXACT reactions from analysis for each secondary beam
    updatedConnections = connections.map(conn => {
      let totalReaction = 0;
      for (const secBeamId of conn.secondaryBeamIds) {
        for (const fr of currentResults) {
          const beamResult = fr.beams.find(b => b.beamId === secBeamId);
          if (!beamResult) continue;
          const beam = beamsMap.get(secBeamId);
          if (!beam) continue;
          
          const isAtStart = beam.fromCol === conn.removedColumnId;
          // Use ONLY the exact reaction from analysis — no approximation
          if (isAtStart) {
            totalReaction += beamResult.Rleft ?? 0;
          } else {
            totalReaction += beamResult.Rright ?? 0;
          }
        }
      }
      
      // Compute exact position on primary beam from coordinates
      const primaryBeam = beamsMap.get(conn.primaryBeamId);
      let distOnPrimary = conn.distanceOnPrimary;
      if (primaryBeam) {
        // Always measure from the minimum coordinate (true left/bottom end)
        // to handle beams drawn in any direction (right-to-left or bottom-to-top)
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

    // Step 2: Check convergence
    if (iteration > 1) {
      let maxChange = 0;
      for (const conn of updatedConnections) {
        const prev = prevReactions.get(conn.removedColumnId) || 0;
        const change = prev > 0 ? Math.abs(conn.reactionForce - prev) / prev : 0;
        maxChange = Math.max(maxChange, change);
      }
      if (maxChange < convergenceTol) {
        converged = true;
        break;
      }
    }

    prevReactions = new Map();
    for (const conn of updatedConnections) {
      prevReactions.set(conn.removedColumnId, conn.reactionForce);
    }

    // Step 3: Build point loads from exact reactions.
    // When A1 and A2 are in the SAME frame (the normal case after frame-grouping fixes),
    // the point load on A1 at a=A1.length correctly transfers as a nodal force to the
    // shared junction node and A2 sees the effect automatically.
    // When they are in DIFFERENT frames (edge-case fallback), we also add a zero-position
    // load to A2's frame so neither segment is missed.
    const beamFrameMap = new Map<string, string>(); // beamId → frameId
    for (const f of frames) {
      for (const bid of f.beamIds) beamFrameMap.set(bid, f.id);
    }

    const pointLoadsMap = new Map<string, MSPointLoad[]>();
    for (const conn of updatedConnections) {
      // Always add load to primary beam (A1) at distanceOnPrimary (= A1.length when
      // the junction is at the right end of A1, which is the common case)
      const existingPrimary = pointLoadsMap.get(conn.primaryBeamId) || [];
      existingPrimary.push({ P: conn.reactionForce, a: conn.distanceOnPrimary });
      pointLoadsMap.set(conn.primaryBeamId, existingPrimary);

      // If a continuation beam (A2) exists AND is in a different frame from A1,
      // apply the same concentrated force at position 0 (the junction IS the left
      // end of A2). This prevents A2's analysis from completely ignoring the load
      // when frame-splitting occurs.
      if (conn.continuationBeamId) {
        const a1Frame = beamFrameMap.get(conn.primaryBeamId);
        const a2Frame = beamFrameMap.get(conn.continuationBeamId);
        if (a1Frame !== a2Frame) {
          const existingCont = pointLoadsMap.get(conn.continuationBeamId) || [];
          existingCont.push({ P: conn.reactionForce, a: 0 });
          pointLoadsMap.set(conn.continuationBeamId, existingCont);
        }
      }
    }

    // Step 4: Re-analyze with point loads and hinges
    // Note: Primary (carrier) beam does NOT get hinges - it behaves as one continuous beam
    // The point load from the carried beam is just a concentrated force on it
    currentResults = frames.map(f => {
      const hasPointLoads = f.beamIds.some(id => pointLoadsMap.has(id));
      return analyzeFrame(f, beamsMap, columns, mat, removedColumnIds, hasPointLoads ? pointLoadsMap : undefined, secondaryBeamHinges, updatedConnections, beamStiffnessFactor, colStiffnessFactor);
    });
  }

  // Final pass with converged reactions (same dual-application logic as the iteration)
  {
    const beamFrameMap = new Map<string, string>();
    for (const f of frames) {
      for (const bid of f.beamIds) beamFrameMap.set(bid, f.id);
    }

    const pointLoadsMap = new Map<string, MSPointLoad[]>();
    for (const conn of updatedConnections) {
      const existingPrimary = pointLoadsMap.get(conn.primaryBeamId) || [];
      existingPrimary.push({ P: conn.reactionForce, a: conn.distanceOnPrimary });
      pointLoadsMap.set(conn.primaryBeamId, existingPrimary);

      if (conn.continuationBeamId) {
        const a1Frame = beamFrameMap.get(conn.primaryBeamId);
        const a2Frame = beamFrameMap.get(conn.continuationBeamId);
        if (a1Frame !== a2Frame) {
          const existingCont = pointLoadsMap.get(conn.continuationBeamId) || [];
          existingCont.push({ P: conn.reactionForce, a: 0 });
          pointLoadsMap.set(conn.continuationBeamId, existingCont);
        }
      }
    }

    const finalResults: FrameResult[] = frames.map(f => {
      const hasPointLoads = f.beamIds.some(id => pointLoadsMap.has(id));
      return hasPointLoads
        ? analyzeFrame(f, beamsMap, columns, mat, removedColumnIds, pointLoadsMap, secondaryBeamHinges, updatedConnections, beamStiffnessFactor, colStiffnessFactor)
        : currentResults[frames.indexOf(f)];
    });

    return { frameResults: finalResults, connections: updatedConnections, iterations: iteration, converged };
  }
}

// ===================== DEFLECTION CALCULATION =====================
/**
 * Calculate immediate deflection and serviceability check
 * ACI 318-19 §24.2.3 & Table 24.2.2
 * 
 * End condition coefficients for δ = K × w × L⁴ / (E × I):
 * - Simply supported: K = 5/384
 * - One end continuous: K ≈ 1/185 ≈ 2.08/384
 * - Both ends continuous: K = 1/384
 * 
 * Service midspan moment for Ie calculation:
 * - Simply supported: Ma = wL²/8
 * - One end continuous: Ma ≈ wL²/14.2
 * - Both ends continuous: Ma ≈ wL²/16
 */
export type DeflectionCase = 'A' | 'B' | 'C' | 'D';

export const DEFLECTION_LIMITS: Record<DeflectionCase, { ratio: number; description: string }> = {
  A: { ratio: 180, description: 'Flat roofs, no brittle finish' },
  B: { ratio: 240, description: 'Floors, no brittle finish' },
  C: { ratio: 360, description: 'Floors supporting plaster/brittle finish' },
  D: { ratio: 480, description: 'Floors + roof, brittle finish critical' },
};

export function calculateDeflection(
  span: number, // meters
  b: number, // mm
  h: number, // mm
  fc: number, // MPa
  deadLoad: number, // kN/m (service)
  liveLoad: number, // kN/m (service)
  As: number = 0, // mm² (actual steel area)
  endCondition: 'simple' | 'one-end' | 'both-ends' = 'both-ends',
  deflectionCase: DeflectionCase = 'B',
  AsPrime: number = 0, // mm² — compression steel area for long-term deflection
  sustainedLoadFraction: number = 1.0, // fraction of dead load that is sustained (default 100%)
  durationMonths: number = 60, // duration of sustained load in months (default 5 years)
  /** Total girder length (m) for carrier beams split into segments. Used for L/240 check instead of segment span. */
  totalGirderSpan?: number,
): DeflectionResult {
  const L = span * 1000; // mm
  const d = h - 56; // effective depth: h − 40(cover) − 10(stirrup) − 6(half bar) = h − 56mm
  const Ec = 4700 * Math.sqrt(fc); // MPa
  const Ig = b * h * h * h / 12; // mm⁴

  // Cracking moment (ACI 318-19 §24.2.3.5)
  const fr = 0.62 * Math.sqrt(fc); // MPa - modulus of rupture
  const yt = h / 2;
  const Mcr = fr * Ig / yt / 1e6; // kN.m

  // Service moment at midspan based on end condition
  const momentCoeff: Record<string, number> = {
    'simple': 1 / 8,       // wL²/8
    'one-end': 1 / 14.2,   // propped cantilever
    'both-ends': 1 / 16,   // fixed-fixed (accounts for partial fixity)
  };
  const wService = deadLoad + liveLoad; // kN/m (unfactored)
  const Ma = wService * span * span * momentCoeff[endCondition]; // kN.m

  // Effective moment of inertia (ACI 318-19 Eq. 24.2.3.5a)
  let Ie: number;
  if (Ma <= Mcr || Ma <= 0) {
    Ie = Ig;
  } else {
    // Cracked moment of inertia Icr
    const n = 200000 / Ec; // modular ratio
    const rho = As > 0 ? As / (b * d) : 0.005; // default 0.5%
    const AsEff = rho * b * d;
    const k = Math.sqrt(2 * rho * n + (rho * n) ** 2) - rho * n;
    const kd = k * d;
    const Icr = b * kd * kd * kd / 3 + n * AsEff * (d - kd) * (d - kd);

    // Bischoff's equation (ACI 318-19 §24.2.3.5a):
    const ratio = (2 / 3) * Mcr / Ma;
    const ratioSq = ratio * ratio;
    Ie = Icr / (1 - ratioSq * (1 - Icr / Ig));
    Ie = Math.min(Ie, Ig);
    Ie = Math.max(Ie, Icr);
  }

  // Deflection coefficient based on end condition
  const deflCoeff: Record<string, number> = {
    'simple': 5 / 384,       // Simply supported
    'one-end': 2.08 / 384,   // One end continuous (≈ 1/185)
    'both-ends': 1 / 384,    // Both ends continuous
  };
  const K_coeff = deflCoeff[endCondition];

  // ========== ACI 318-19 §24.2.3: Immediate deflections ==========
  // Split into dead and live components separately to avoid double-counting in long-term calc.
  // ACI correct approach:
  //   δ_immediate_dead = K × wD × L⁴ / (Ec × Ie)
  //   δ_immediate_live = K × wL × L⁴ / (Ec × Ie)
  //   δ_long_term      = λΔ × δ_sustained_immediate   (sustained dead only)
  //   δ_total          = δ_immediate_dead + δ_immediate_live + δ_long_term
  const deltaImmediateDead = (K_coeff * deadLoad  * Math.pow(L, 4)) / (Ec * Ie);
  const deltaImmediateLive = (K_coeff * liveLoad  * Math.pow(L, 4)) / (Ec * Ie);
  const deltaImmediate = deltaImmediateDead + deltaImmediateLive;

  // ========== ACI 318-19 §24.2.4: Long-term deflection ==========
  // λΔ = ξ / (1 + 50ρ')  where ρ' = As'/(b*d)
  // ξ depends on duration of sustained load:
  //   5 years or more: ξ = 2.0
  //   12 months: ξ = 1.4
  //   6 months: ξ = 1.2
  //   3 months: ξ = 1.0
  let xi: number;
  if (durationMonths >= 60) xi = 2.0;
  else if (durationMonths >= 12) xi = 1.4 + (2.0 - 1.4) * (durationMonths - 12) / (60 - 12);
  else if (durationMonths >= 6) xi = 1.2 + (1.4 - 1.2) * (durationMonths - 6) / (12 - 6);
  else if (durationMonths >= 3) xi = 1.0 + (1.2 - 1.0) * (durationMonths - 3) / (6 - 3);
  else xi = 1.0;

  const rhoPrime = AsPrime > 0 ? AsPrime / (b * d) : 0;
  const lambdaDelta = xi / (1 + 50 * rhoPrime);

  // Long-term: applied only to SUSTAINED dead load component — NOT to live or total immediate
  const wSustained = deadLoad * sustainedLoadFraction;
  const deltaSustainedImmediate = (K_coeff * wSustained * Math.pow(L, 4)) / (Ec * Ie);
  const deltaLongTerm = lambdaDelta * deltaSustainedImmediate;

  // Total = immediate (DL + LL) + long-term (sustained DL only) — no double-counting
  const deltaTotal = deltaImmediate + deltaLongTerm;

  // Allowable deflection (ACI 318-19 Table 24.2.2)
  // For carrier beams (girders) split into segments, use TOTAL girder length for serviceability check
  // This matches ETABS behavior: deflection limit is based on the full girder span, not individual segments
  const limitMap: Record<string, number> = { A: 180, B: 240, C: 360, D: 480 };
  const allowableRatio = limitMap[deflectionCase] || 240;
  const L_for_limit = totalGirderSpan ? totalGirderSpan * 1000 : L;
  const allowable = L_for_limit / allowableRatio;
  const deltaRatio = L_for_limit / (deltaTotal > 0 ? deltaTotal : 1);

  return {
    deflection: deltaTotal,
    deflectionRatio: deltaRatio,
    allowableDeflection: allowable,
    isServiceable: deltaTotal <= allowable,
    limitUsed: `L/${allowableRatio}`,
    immediateDeflection: deltaImmediate,
    longTermDeflection: deltaLongTerm,
    totalDeflection: deltaTotal,
    lambdaDelta,
    xi,
    rhoPrime,
  };
}

// ===================== BEAM DESIGN =====================
export function designFlexure(
  Mu: number, b: number, h: number, fc: number, fy: number, cover: number = 40,
  slabExists: boolean = false, slabThickness: number = 0, slabWidth: number = 0,
  minBars: number = 2
): FlexureResult {
  const d = h - cover - 10 - 6;
  const phi = 0.9;
  const beta1 = fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7);
  const rhoMin = Math.max(0.25 * Math.sqrt(fc) / fy, 1.4 / fy);
  const rhoMax = 0.85 * beta1 * fc / fy * 0.003 / (0.003 + 0.005);

  // T-beam check: if slab exists and moment is positive (sagging)
  let bEffective = b;
  if (slabExists && Mu > 0 && slabWidth > 0) {
    // ACI 318-19 §6.3.2.1: Effective flange width for T-beams
    // slabWidth = pre-computed effective flange width from caller:
    //   min(span/4, bw + 16*hf, centre-to-centre spacing)
    // Do NOT recompute here — the caller (Index.tsx) already applies all three ACI limits.
    bEffective = Math.max(slabWidth, b); // Cannot be less than web width
    // Check if neutral axis is within flange; if so, design as rectangular section with bEffective.
    // If NA falls below flange, fall back to web width bw (conservative for T-beam action).
    const hf = slabThickness;
    if (hf > 0 && bEffective > b) {
      const MnFlange = 0.85 * fc * bEffective * hf * (d - hf / 2) / 1e6;
      if (Math.abs(Mu) > phi * MnFlange) {
        // NA below flange — design as rectangular section using web width only
        bEffective = b;
      }
    }
  }

  const Mu_Nmm = Math.abs(Mu) * 1e6;
  const Ru = Mu_Nmm / (bEffective * d * d);
  let rho = 0.85 * fc / fy * (1 - Math.sqrt(1 - 2 * Ru / (phi * 0.85 * fc)));
  if (isNaN(rho) || rho < 0) rho = rhoMin;
  rho = Math.max(rho, rhoMin);

  // Check if doubly reinforced beam is needed
  let As: number;
  if (rho > rhoMax) {
    // Doubly reinforced: limit tension steel, add compression steel
    rho = rhoMax;
    As = rho * b * d;
    const MnSingly = phi * As * fy * (d - As * fy / (1.7 * fc * b)) / 1e6;
    const Mu_remaining = Math.abs(Mu) - MnSingly;
    if (Mu_remaining > 0) {
      const As2 = Mu_remaining * 1e6 / (phi * fy * (d - cover)) ;
      As += As2;
    }
  } else {
    As = rho * b * d;
  }

  const AsMin = rhoMin * b * d;
  const AsUsed = Math.max(As, AsMin);

  // ACI 318-19 §25.2.1: Clear spacing >= max(db, 25mm, 4/3 * max aggregate size ≈ 33mm)
  // Strategy: Calculate max number of bars that fit in one layer for each diameter,
  // then pick the most economical diameter that provides enough area.
  const diameters = [10, 12, 14, 16]; // Min 10mm, max 16mm for beams per project spec
  const stirrupDia = 10; // mm
  // ACI 318-19 §9.6.1.2: If required As < AsMin, use AsMin governed design.
  // Preferred solution: 4 bars Φ12 (minimum practical for beams) instead of 2 bars.
  // This provides better ductility and confinement.
  const governedByMin = As < AsMin;
  // When governed by minimum steel, prefer 4 bars Φ12 as the starting point
  const effectiveMinBars = governedByMin ? Math.max(minBars, 4) : minBars;
  let bestDia = 12;
  let bestN = effectiveMinBars;
  let bestScore = Infinity;
  let bestLayers = 1;

  for (const dia of diameters) {
    const aBar = Math.PI * dia * dia / 4;
    const nRequired = Math.max(effectiveMinBars, Math.ceil(AsUsed / aBar));
    if (nRequired < effectiveMinBars) continue;

    // ACI §25.2.1: min clear = max(db, 25mm, 4/3 * dg) where dg ≈ 25mm
    const minClear = Math.max(dia, 25, 33);

    // Available width for bars in one layer
    const availableWidth = b - 2 * cover - 2 * stirrupDia;

    // Max bars per layer: n * dia + (n-1) * minClear <= availableWidth
    const maxBarsPerLayer = Math.max(2, Math.floor((availableWidth + minClear) / (dia + minClear)));

    if (nRequired <= maxBarsPerLayer) {
      // Fits in one layer — check actual clear spacing
      const clearSpacing = (availableWidth - nRequired * dia) / (nRequired - 1);
      if (clearSpacing >= minClear) {
        const wasteRatio = (nRequired * aBar - AsUsed) / AsUsed;
        const score = wasteRatio + (nRequired > 5 ? 0.3 : 0);
        if (score < bestScore) {
          bestScore = score;
          bestDia = dia;
          bestN = nRequired;
          bestLayers = 1;
        }
      }
    } else if (nRequired <= maxBarsPerLayer * 2) {
      // Needs two layers
      const nPerLayer1 = Math.min(nRequired, maxBarsPerLayer);
      const nPerLayer2 = nRequired - nPerLayer1;
      const clearSpacing1 = nPerLayer1 > 1 ? (availableWidth - nPerLayer1 * dia) / (nPerLayer1 - 1) : availableWidth;
      const clearSpacing2 = nPerLayer2 > 1 ? (availableWidth - nPerLayer2 * dia) / (nPerLayer2 - 1) : availableWidth;

      if (clearSpacing1 >= minClear && clearSpacing2 >= minClear) {
        const wasteRatio = (nRequired * aBar - AsUsed) / AsUsed;
        const score = wasteRatio + 0.5; // penalize two layers
        if (score < bestScore) {
          bestScore = score;
          bestDia = dia;
          bestN = nRequired;
          bestLayers = 2;
        }
      }
    }
  }

  // Final fallback: use largest diameter with minimum bars
  if (bestScore === Infinity) {
    for (let i = diameters.length - 1; i >= 0; i--) {
      const dia = diameters[i];
      const aBar = Math.PI * dia * dia / 4;
      const n = Math.max(minBars, Math.ceil(AsUsed / aBar));
      if (n >= minBars) {
        bestDia = dia;
        bestN = n;
        bestLayers = Math.ceil(n / Math.max(2, Math.floor((b - 2 * cover - 2 * stirrupDia + Math.max(dia, 25, 33)) / (dia + Math.max(dia, 25, 33)))));
        break;
      }
    }
  }

  const availWidth = b - 2 * cover - 2 * stirrupDia;
  const barsInFirstLayer = bestLayers > 1 ? Math.min(bestN, Math.floor((availWidth + Math.max(bestDia, 25, 33)) / (bestDia + Math.max(bestDia, 25, 33)))) : bestN;
  const clearSpacing = barsInFirstLayer > 1 ? (availWidth - barsInFirstLayer * bestDia) / (barsInFirstLayer - 1) : availWidth;
  const minClearRequired = Math.max(bestDia, 25, 33);
  const checkSpacing = clearSpacing >= minClearRequired ? 'ok' : `طبقتين (${bestLayers} layers)`;

  // Utilization ratio
  const aBar = Math.PI * bestDia * bestDia / 4;
  const AsProvided = bestN * aBar;
  const utilizationRatio = AsUsed / AsProvided;

  return {
    Mu: Math.abs(Mu), Ru, rho, As: AsUsed, bars: bestN, dia: bestDia,
    checkSpacing,
    requiredSteelArea: AsUsed,
    utilizationRatio,
  };
}

export function designShear(
  Vu: number, b: number, h: number, fc: number, fyt: number, cover: number = 40,
  stirrupDia: number = 10,
  wu: number = 0,        // Factored distributed load (kN/m) — used for critical-section reduction
  supportWidth: number = 300, // Approximate column/support width (mm), default 300mm
  As: number = 0,        // Actual tensile steel area (mm²) — for accurate ρw calculation
): ShearResult {
  const d = h - cover - 10 - 6;
  const phi = 0.75;

  // ACI 318-19 §9.4.3.2: Design shear at critical section d from face of support
  let VuDesign = Math.abs(Vu);
  if (wu > 0) {
    const distToFace = supportWidth / 2;            // mm from node to support face
    const distToCritical = (distToFace + d) / 1000; // m from node to critical section
    VuDesign = Math.max(0, Math.abs(Vu) - wu * distToCritical);
  }

  // ACI 318-19 §22.5.5.1: Vc simplified
  const Vc_simplified = (1 / 6) * Math.sqrt(fc) * b * d / 1000; // kN

  // ACI Table 22.5.5.1 detailed Vc (using actual ρw — ETABS-matched)
  // ρw = As / (bw × d) — use actual steel area when available
  const rhoW = As > 0 ? As / (b * d) : 0.005;
  // ACI 318-19 Table 22.5.5.1(b): Vc = [0.66λ(ρw)^(1/3)√f'c + Nu/(6Ag)] × bw × d
  // For gravity-only (Nu=0): Vc = 0.66*(ρw)^(1/3)*√f'c * bw * d
  const Vc_detailed = (0.66 * Math.pow(rhoW, 1/3) * Math.sqrt(fc)) * b * d / 1000;
  
  // ACI 318-19 §22.5.5.1.3: Size effect factor λs
  // λs = √(2/(1 + 0.004d)) ≤ 1.0  (applies when Av,min not satisfied)
  const lambdaS = Math.min(1.0, Math.sqrt(2 / (1 + 0.004 * d)));
  
  // Vc with size effect (used if minimum stirrups not provided)
  const Vc_withSizeEffect = (1 / 6) * lambdaS * Math.sqrt(fc) * b * d / 1000;
  
  const Vc = Math.max(Vc_simplified, Vc_detailed);

  // Maximum shear capacity: Vs_max = 2/3 * √f'c * bw * d (ACI 318-19 §22.5.1.2)
  const VsMax = (2 / 3) * Math.sqrt(fc) * b * d / 1000;

  // Use critical-section shear for stirrup design
  const VuPhi = VuDesign / phi;
  const Vs = Math.max(0, VuPhi - Vc);

  // Number of stirrup legs — ETABS uses b/s_max_transverse spacing
  const nLegs = b > 350 ? 4 : 2;
  const Av = nLegs * Math.PI * stirrupDia * stirrupDia / 4;

  // Required stirrup spacing: Av*fyt*d / Vs
  let sReq = Vs > 0 ? Av * fyt * d / (Vs * 1000) : 9999;

  // Maximum stirrup spacing (ACI 318-19 §9.7.6.2.2)
  let sMax: number;
  if (Vs <= (1 / 3) * Math.sqrt(fc) * b * d / 1000) {
    sMax = Math.min(d / 2, 600);
  } else {
    sMax = Math.min(d / 4, 300);
  }

  // Minimum stirrup requirement (ACI 318-19 §9.6.3.3)
  const AvMin = Math.max(
    0.062 * Math.sqrt(fc) * b / fyt,
    0.35 * b / fyt
  );
  const sMinReq = Av / AvMin;
  sMax = Math.min(sMax, sMinReq);

  const sUsed = Math.min(sReq, sMax);
  const sRound = Math.floor(sUsed / 25) * 25;
  const sFinal = Math.max(sRound, 75);

  const shearUtilization = Vc > 0 ? Vs / VsMax : 0;

  return {
    Vc, Vs, sRequired: sReq, sMax, sUsed: sFinal,
    stirrups: `${nLegs}Φ${stirrupDia}@${sFinal}mm`,
    stirrupLegs: nLegs,
    shearUtilization,
    Vc_simplified,
    Vc_detailed,
  };
}

// ===================== ENHANCED COLUMN DESIGN (ETABS-LIKE) =====================

function generatePMDiagram(
  b: number, h: number, fc: number, fy: number,
  nBars: number, barDia: number, cover: number = 40
): PMPoint[] {
  const Es = 200000;
  const ecu = 0.003;
  const beta1 = fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7);
  const Ag = b * h;
  const aBar = Math.PI * barDia * barDia / 4;

  const dPrime = cover + 8 + barDia / 2;
  const dMax = h - dPrime;

  const barPositions: number[] = [];
  if (nBars <= 4) {
    barPositions.push(dPrime, dPrime, dMax, dMax);
  } else {
    const nSide = nBars - 4;
    const perSide = Math.ceil(nSide / 2);
    barPositions.push(dPrime, dPrime);
    for (let i = 1; i <= perSide; i++) {
      const d = dPrime + i * (dMax - dPrime) / (perSide + 1);
      barPositions.push(d);
      if (barPositions.length < nBars - 2) barPositions.push(d);
    }
    barPositions.push(dMax, dMax);
  }

  while (barPositions.length > nBars) barPositions.pop();
  while (barPositions.length < nBars) barPositions.push(h / 2);

  const points: PMPoint[] = [];
  const cValues = [
    h * 100, h * 10, h * 5, h * 3, h * 2, h * 1.5,
    h, h * 0.9, h * 0.8, h * 0.7, h * 0.6, h * 0.5,
    h * 0.4, h * 0.35, h * 0.3, h * 0.25, h * 0.2,
    h * 0.15, h * 0.1, h * 0.05, h * 0.02, h * 0.01,
    0, -h * 0.5, -h,
  ];

  for (const c of cValues) {
    const a = beta1 * c;
    let Cc = 0;
    if (c > 0) {
      const aEff = Math.min(a, h);
      Cc = 0.85 * fc * aEff * b / 1000;
    }

    let Fs = 0;
    let Ms = 0;
    const centroid = h / 2;

    for (const di of barPositions) {
      let strain: number;
      if (c > 0) {
        strain = ecu * (c - di) / c;
      } else {
        strain = -fy / Es;
      }
      let stress = strain * Es;
      stress = Math.max(-fy, Math.min(fy, stress));
      const force = stress * aBar / 1000;
      Fs += force;
      Ms += force * (centroid - di) / 1000;
    }

    const aEff = c > 0 ? Math.min(a, h) : 0;
    const Mc = Cc * (centroid - aEff / 2) / 1000;

    const Pn = Cc + Fs;
    const Mn = Math.abs(Mc + Ms);

    const dt = Math.max(...barPositions);
    let et: number;
    if (c > 0) {
      et = ecu * (dt - c) / c;
    } else {
      et = fy / Es + 0.01;
    }

    const ey = fy / Es;
    let phi: number;
    if (et <= ey) {
      phi = 0.65;
    } else if (et >= 0.005) {
      phi = 0.90;
    } else {
      phi = 0.65 + (et - ey) * (0.90 - 0.65) / (0.005 - ey);
    }

    const P0 = 0.85 * fc * (Ag - nBars * aBar) / 1000 + fy * nBars * aBar / 1000;
    const PnCapped = Math.min(Pn, 0.80 * P0);

    points.push({
      c, Pn: PnCapped, Mn, phi,
      phiPn: phi * PnCapped,
      phiMn: phi * Mn,
    });
  }

  points.sort((a, b) => b.phiPn - a.phiPn);
  return points;
}

function checkPMCapacity(
  Pu: number, Mu: number, pmDiagram: PMPoint[]
): { adequate: boolean; ratio: number; phiPn: number; phiMn: number } {
  if (pmDiagram.length < 2) {
    return { adequate: false, ratio: 999, phiPn: 0, phiMn: 0 };
  }

  let minRatio = Infinity;
  let bestPhiPn = 0;
  let bestPhiMn = 0;

  for (let i = 0; i < pmDiagram.length - 1; i++) {
    const p1 = pmDiagram[i];
    const p2 = pmDiagram[i + 1];

    if ((p1.phiPn >= Pu && p2.phiPn <= Pu) || (p1.phiPn <= Pu && p2.phiPn >= Pu)) {
      const t = Math.abs(p1.phiPn - p2.phiPn) > 0.01
        ? (Pu - p2.phiPn) / (p1.phiPn - p2.phiPn) : 0.5;
      const phiMnAtPu = p2.phiMn + t * (p1.phiMn - p2.phiMn);
      const ratio = phiMnAtPu > 0 ? Math.abs(Mu) / phiMnAtPu : (Math.abs(Mu) > 0 ? 999 : 0);

      if (ratio < minRatio) {
        minRatio = ratio;
        bestPhiPn = Pu;
        bestPhiMn = phiMnAtPu;
      }
    }
  }

  const maxPhiPn = Math.max(...pmDiagram.map(p => p.phiPn));
  if (Pu > maxPhiPn) {
    return { adequate: false, ratio: Pu / maxPhiPn, phiPn: maxPhiPn, phiMn: 0 };
  }

  if (minRatio === Infinity) {
    minRatio = Pu / maxPhiPn;
    bestPhiPn = maxPhiPn;
    bestPhiMn = pmDiagram[Math.floor(pmDiagram.length / 2)]?.phiMn || 0;
  }

  return { adequate: minRatio <= 1.0, ratio: minRatio, phiPn: bestPhiPn, phiMn: bestPhiMn };
}

function momentMagnification(
  Pu: number, Mu: number, b: number, h: number,
  fc: number, fy: number, Lu: number, k: number = 1.0,
  M1: number = 0, M2: number = 0
): { deltaNs: number; MuMagnified: number } {
  const Ec = 4700 * Math.sqrt(fc);
  const Ig = b * h * h * h / 12;
  const betaDns = 0.6;
  const EI = 0.4 * Ec * Ig / (1 + betaDns);
  const Pc = Math.PI * Math.PI * EI / (k * Lu * k * Lu);
  const PcKN = Pc / 1000;
  // ACI 318-19 §6.6.4.5.3: Cm = 0.6 − 0.4·(M1/M2)
  //   M1/M2 is NEGATIVE for single curvature → Cm > 0.6 (more magnification)
  //   M1/M2 is POSITIVE for double curvature → Cm < 0.6 (less magnification)
  // M1 may be passed as a signed value (negative = single curvature per ACI).
  let Cm = 1.0;
  if (M2 !== 0) {
    Cm = Math.max(0.4, 0.6 - 0.4 * (M1 / M2));
  }
  const denominator = 1 - Pu / (0.75 * PcKN);
  let deltaNs = denominator > 0 ? Cm / denominator : 10.0;
  deltaNs = Math.max(deltaNs, 1.0);
  const MuMagnified = deltaNs * Math.max(Mu, Pu * (15 + 0.03 * h) / 1000);
  return { deltaNs, MuMagnified };
}

export function designColumnETABS(
  Pu: number, Mu: number,
  b: number, h: number, fc: number, fy: number,
  Lu: number
): ColumnResult {
  const Ag = b * h;
  const r = 0.3 * Math.min(b, h);
  const k = 1.0;
  const kLu_r = k * Lu / r;
  // ACI 318-19 §6.2.5: Slenderness limit = 34 - 12*(M1/M2) for non-sway, max 40
  const slendernessLimit = 34; // Conservative default when M1/M2 unknown (single curvature ratio=0)
  const isSlender = kLu_r > slendernessLimit;
  const checkSlender = isSlender ? 'نحيف' : 'قصير';

  let deltaNs = 1.0;
  let MuMagnified = Math.max(Mu, Pu * (15 + 0.03 * h) / 1000);

  if (isSlender) {
    const mag = momentMagnification(Pu, Mu, b, h, fc, fy, Lu, k);
    deltaNs = mag.deltaNs;
    MuMagnified = mag.MuMagnified;
  }

  const rhoTrials = [0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04];
  const diameters = [14, 16, 18, 20, 22]; // Min 14mm, max 22mm for columns per project spec

  let bestResult: ColumnResult | null = null;

  for (const rho of rhoTrials) {
    const AsReq = rho * Ag;
    for (const dia of diameters) {
      const aBar = Math.PI * dia * dia / 4;
      const nBars = Math.max(4, Math.ceil(AsReq / aBar));
      const nBarsEven = nBars % 2 === 0 ? nBars : nBars + 1;
      if (nBarsEven > 20) continue;

      const pmDiagram = generatePMDiagram(b, h, fc, fy, nBarsEven, dia);
      const check = checkPMCapacity(Pu, MuMagnified, pmDiagram);

      if (check.adequate) {
          const rhoActual = nBarsEven * aBar / Ag;
          // ACI 318-19 §10.7.6.1.2: tie spacing = min(16*db_long, 48*db_tie, min(b,h))
          const stirrupDiaCol = 8; // mm
          const stirrupSpacing = Math.min(16 * dia, 48 * stirrupDiaCol, Math.min(b, h));

        bestResult = {
          Pu, Mu: MuMagnified,
          checkSlenderness: checkSlender,
          bars: nBarsEven, dia,
          stirrups: `Φ8@${stirrupSpacing}mm`,
          phiPn: check.phiPn,
          phiMn: check.phiMn,
          adequate: true,
          rhoActual, kLu_r, deltaNs, MuMagnified,
          pmDiagram, utilizationRatio: check.ratio,
          interactionRatio: check.ratio,
          designCapacity: check.phiPn,
          safetyStatus: check.ratio <= 1.0 ? 'آمن' : 'غير آمن',
        };
        break;
      }
    }
    if (bestResult) break;
  }

  if (!bestResult) {
    const dia = 22; // max column diameter per project spec
    const aBar = Math.PI * dia * dia / 4;
    const nBars = Math.max(4, Math.ceil(0.04 * Ag / aBar));
    const nBarsEven = nBars % 2 === 0 ? nBars : nBars + 1;
    const pmDiagram = generatePMDiagram(b, h, fc, fy, nBarsEven, dia);
    const check = checkPMCapacity(Pu, MuMagnified, pmDiagram);
    const rhoActual = nBarsEven * aBar / Ag;

    bestResult = {
      Pu, Mu: MuMagnified,
      checkSlenderness: checkSlender,
      bars: nBarsEven, dia,
      stirrups: `Φ8@${Math.min(16 * dia, Math.min(b, h), 300)}mm`,
      phiPn: check.phiPn, phiMn: check.phiMn,
      adequate: check.adequate,
      rhoActual, kLu_r, deltaNs, MuMagnified,
      pmDiagram, utilizationRatio: check.ratio,
      interactionRatio: check.ratio,
      designCapacity: check.phiPn,
      safetyStatus: check.ratio <= 1.0 ? 'آمن' : 'غير آمن',
    };
  }

  return bestResult;
}

export function designColumnBasic(
  Pu: number, b: number, h: number, fc: number, fy: number, Lu?: number
): ColumnResult {
  return designColumnETABS(Pu, 0, b, h, fc, fy, Lu || 4000);
}

// ===================== PUNCHING SHEAR =====================
/**
 * ACI 318-19 §22.6.5: Punching shear check for slab-column connection
 */
export function checkPunchingShear(
  Vu: number, // factored shear (kN)
  colB: number, // column width (mm)
  colH: number, // column depth (mm)
  slabD: number, // effective slab depth (mm)
  fc: number, // MPa
  isInterior: boolean = true
): PunchingShearResult {
  // Critical section perimeter at d/2 from column face
  const b0 = isInterior
    ? 2 * (colB + slabD) + 2 * (colH + slabD)
    : (colB + slabD / 2) + 2 * (colH + slabD); // edge column (simplified)

  // Beta ratio
  const beta = Math.max(colB, colH) / Math.min(colB, colH);

  // alpha_s: 40 for interior, 30 for edge, 20 for corner
  const alphaS = isInterior ? 40 : 30;

  // ACI 318-19 §22.6.5.2 with size effect factor λs (§22.5.5.1.3)
  const lambdaS = Math.min(1.0, Math.sqrt(2 / (1 + 0.004 * slabD)));
  const vc1 = 0.33 * lambdaS * Math.sqrt(fc); // 0.33λs√f'c
  const vc2 = 0.17 * (1 + 2 / beta) * lambdaS * Math.sqrt(fc);
  const vc3 = (1 / 12) * (alphaS * slabD / b0 + 2) * lambdaS * Math.sqrt(fc);

  const vc = Math.min(vc1, vc2, vc3);
  const phi = 0.75;
  const Vc = phi * vc * b0 * slabD / 1000; // kN

  const safetyFactor = Vc / (Math.abs(Vu) > 0 ? Math.abs(Vu) : 1);

  return {
    Vu: Math.abs(Vu),
    Vc,
    punchingSafetyFactor: safetyFactor,
    adequate: safetyFactor >= 1.0,
  };
}

// ===================== ENHANCED SLAB DESIGN (ACI 318-19) =====================

/**
 * Two-way slab moment coefficients — Marcus / Traditional Coefficient Method
 * (NOT ACI 318-19 Direct Design Method; used as an engineering approximation
 *  for beamed two-way slabs.  ACI 318-19 §8.10 (DDM) or §8.11 (EFM) are the
 *  code-prescribed methods for flat plates / flat slabs without beams.
 *  For beamed two-way slabs the coefficient approach gives results consistent
 *  with classical elastic theory and is widely accepted in practice.)
 *
 * Returns positive-moment coefficients for short (Ca) and long (Cb) directions.
 * Values based on panel edge conditions and aspect ratio β = la/lb ≥ 1.
 */
function getSlabCoefficients(
  beta: number,
  discontinuousEdges: number
): { shortCoeff: number; longCoeff: number } {
  // Panel types by number of discontinuous (free / simply-supported) edges:
  // Case 1: All edges continuous (interior panel)
  // Case 2: One edge discontinuous
  // Case 3: Two adjacent edges discontinuous (corner)
  // Case 4: Two opposite edges discontinuous
  // Case 5: Three edges discontinuous
  // Case 6: Four edges discontinuous (isolated)

  // Coefficients table [ratio index][case] for short direction (Ca)
  // ratio: 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0
  const caPos: Record<number, number[]> = {
    0: [0.036, 0.040, 0.045, 0.050, 0.056, 0.061, 0.055], // β=1.0
    1: [0.040, 0.045, 0.050, 0.056, 0.061, 0.068, 0.062], // β=1.1
    2: [0.045, 0.050, 0.056, 0.061, 0.068, 0.074, 0.068], // β=1.2
    3: [0.050, 0.056, 0.061, 0.068, 0.074, 0.080, 0.074], // β=1.3
    4: [0.056, 0.061, 0.068, 0.074, 0.080, 0.085, 0.079], // β=1.4
    5: [0.061, 0.068, 0.074, 0.080, 0.085, 0.089, 0.083], // β=1.5
    6: [0.065, 0.073, 0.079, 0.084, 0.089, 0.093, 0.086], // β=1.6
    7: [0.069, 0.077, 0.083, 0.088, 0.093, 0.096, 0.089], // β=1.7
    8: [0.072, 0.080, 0.086, 0.091, 0.095, 0.098, 0.091], // β=1.8
    9: [0.075, 0.083, 0.088, 0.093, 0.097, 0.100, 0.093], // β=1.9
    10: [0.077, 0.085, 0.090, 0.095, 0.098, 0.101, 0.094], // β=2.0
  };

  const cbPos: Record<number, number[]> = {
    0: [0.036, 0.033, 0.029, 0.026, 0.024, 0.022, 0.020], // β=1.0
    1: [0.033, 0.029, 0.026, 0.024, 0.022, 0.020, 0.017], // β=1.1
    2: [0.029, 0.026, 0.024, 0.022, 0.020, 0.017, 0.015], // β=1.2
    3: [0.026, 0.024, 0.022, 0.020, 0.017, 0.015, 0.013], // β=1.3
    4: [0.024, 0.022, 0.020, 0.017, 0.015, 0.013, 0.011], // β=1.4
    5: [0.022, 0.020, 0.017, 0.015, 0.013, 0.011, 0.009], // β=1.5
    6: [0.020, 0.017, 0.015, 0.013, 0.011, 0.009, 0.007], // β=1.6
    7: [0.017, 0.015, 0.013, 0.011, 0.009, 0.007, 0.006], // β=1.7
    8: [0.015, 0.013, 0.011, 0.009, 0.007, 0.006, 0.005], // β=1.8
    9: [0.013, 0.011, 0.009, 0.007, 0.006, 0.005, 0.004], // β=1.9
    10: [0.011, 0.009, 0.007, 0.006, 0.005, 0.004, 0.003], // β=2.0
  };

  // Map discontinuous edges to case index (0-6)
  let caseIdx: number;
  if (discontinuousEdges === 0) caseIdx = 0;       // All continuous (interior)
  else if (discontinuousEdges === 1) caseIdx = 1;   // One edge disc.
  else if (discontinuousEdges === 2) caseIdx = 2;   // Two edges disc.
  else if (discontinuousEdges === 3) caseIdx = 4;   // Three edges disc.
  else caseIdx = 6;                                  // Four edges disc.

  // Clamp and interpolate beta
  const clampedBeta = Math.min(Math.max(beta, 1.0), 2.0);
  const ratioIdx = (clampedBeta - 1.0) / 0.1;
  const lo = Math.floor(ratioIdx);
  const hi = Math.min(lo + 1, 10);
  const frac = ratioIdx - lo;

  const caLo = caPos[lo]?.[caseIdx] ?? 0.050;
  const caHi = caPos[hi]?.[caseIdx] ?? 0.050;
  const cbLo = cbPos[lo]?.[caseIdx] ?? 0.025;
  const cbHi = cbPos[hi]?.[caseIdx] ?? 0.025;

  return {
    shortCoeff: caLo + frac * (caHi - caLo),
    longCoeff: cbLo + frac * (cbHi - cbLo),
  };
}

function countDiscontinuousEdges(slab: Slab, allSlabs: Slab[]): number {
  let count = 0;
  const edges = [
    { x1: slab.x1, y1: slab.y1, x2: slab.x2, y2: slab.y1 },
    { x1: slab.x1, y1: slab.y2, x2: slab.x2, y2: slab.y2 },
    { x1: slab.x1, y1: slab.y1, x2: slab.x1, y2: slab.y2 },
    { x1: slab.x2, y1: slab.y1, x2: slab.x2, y2: slab.y2 },
  ];
  for (const edge of edges) {
    const hasNeighbor = allSlabs.some(s => {
      if (s.id === slab.id) return false;
      return (
        (s.x1 === edge.x1 && s.y1 === edge.y1 && s.x2 === edge.x2 && s.y2 === edge.y2) ||
        (s.x2 === edge.x1 && s.y2 === edge.y1 && s.x1 === edge.x2 && s.y1 === edge.y2) ||
        (edge.y1 === edge.y2 && (s.y1 === edge.y1 || s.y2 === edge.y1) &&
          Math.max(s.x1, edge.x1) < Math.min(s.x2, edge.x2)) ||
        (edge.x1 === edge.x2 && (s.x1 === edge.x1 || s.x2 === edge.x1) &&
          Math.max(s.y1, edge.y1) < Math.min(s.y2, edge.y2))
      );
    });
    if (!hasNeighbor) count++;
  }
  return count;
}

/**
 * ACI 318-19 Table 7.3.1.1 (one-way) and Table 8.3.1.1/8.3.1.2 (two-way)
 * Minimum slab thickness
 */
function getMinSlabThickness(
  lx: number, _ly: number, _beta: number, isOneWay: boolean,
  discontinuousEdges: number
): number {
  const ln = lx * 1000; // mm
  const fy = 420; // MPa

  if (isOneWay) {
    // ACI 318-19 Table 7.3.1.1
    if (discontinuousEdges === 0) return ln / 28;       // Both ends continuous
    if (discontinuousEdges >= 3) return ln / 10;         // Cantilever
    if (discontinuousEdges === 1) return ln / 24;        // One end continuous
    return ln / 20;                                       // Simply supported
  }

  // Two-way slab — ACI 318-19 Table 8.3.1.1 (without beams)
  // With drop panels: /36 and /33, without: /33 and /30
  if (discontinuousEdges === 0) {
    return ln * (0.8 + fy / 1400) / 33; // Interior panel
  } else {
    return ln * (0.8 + fy / 1400) / 30; // Exterior/edge panel
  }
}

/**
 * ACI 318-19 §6.5.2 Moment coefficients for one-way continuous slabs
 * Returns Wu*ln²/coefficient based on continuity conditions
 */
function getOneWaySlabMoments(
  Wu: number, ln: number, discontinuousEdges: number
): { negativeMoment: number; positiveMoment: number } {
  // ACI 318-19 §6.5.2 approximate moment coefficients
  if (discontinuousEdges === 0) {
    // Interior span (both ends continuous) — ACI §6.5.2: Wu*ln²/11 at interior supports
    return {
      negativeMoment: Wu * ln * ln / 11, // -Mu at interior supports (ACI §6.5.2)
      positiveMoment: Wu * ln * ln / 16, // +Mu at midspan
    };
  } else if (discontinuousEdges === 1) {
    // End span (one end continuous)
    return {
      negativeMoment: Wu * ln * ln / 10,  // -Mu at continuous support
      positiveMoment: Wu * ln * ln / 14,  // +Mu at midspan (end span)
    };
  } else if (discontinuousEdges >= 3) {
    // Cantilever
    return {
      negativeMoment: Wu * ln * ln / 2,
      positiveMoment: 0,
    };
  } else {
    // Simply supported or two disc. edges
    return {
      negativeMoment: 0,
      positiveMoment: Wu * ln * ln / 8,
    };
  }
}

export function designSlab(
  slab: Slab, props: SlabProps, mat: MatProps, allSlabs: Slab[],
  columns?: Column[]
): SlabDesignResult {
  const lx = Math.min(Math.abs(slab.x2 - slab.x1), Math.abs(slab.y2 - slab.y1));
  const ly = Math.max(Math.abs(slab.x2 - slab.x1), Math.abs(slab.y2 - slab.y1));
  const beta = ly / lx;
  const isOneWay = beta > 2;

  const discontinuousEdges = countDiscontinuousEdges(slab, allSlabs);
  const hMin = getMinSlabThickness(lx, ly, beta, isOneWay, discontinuousEdges);
  const hUsed = Math.max(Math.ceil(hMin / 10) * 10, props.thickness);

  const ownWeight = (hUsed / 1000) * mat.gamma;
  const Wu = 1.2 * (ownWeight + props.finishLoad) + 1.6 * props.liveLoad;

  const d = hUsed - props.cover - props.phiSlab / 2;

  // ACI 318-19 §7.6.1.1 (one-way) and §8.6.1.1 (two-way) — minimum reinforcement for slabs
  // For fy ≥ 420 MPa: As,min = 0.0018 * b * h
  // For fy < 420 MPa: As,min = 0.0020 * b * h
  const shrinkageRatio = mat.fy >= 420 ? 0.0018 : 0.0020;
  const AsMinPerM = shrinkageRatio * 1000 * hUsed; // mm²/m

  let shortAs: number, longAs: number;
  let shortCoeff: number, longCoeff: number;

  if (isOneWay) {
    // ACI 318-19 §6.5.2 — One-way slab using approximate moment coefficients
    const moments = getOneWaySlabMoments(Wu, lx, discontinuousEdges);
    const Mu = Math.max(moments.negativeMoment, moments.positiveMoment);
    shortCoeff = Mu / (Wu * lx * lx); // effective coefficient for reporting

    const Mu_Nmm = Mu * 1e6;
    const Ru = Mu_Nmm / (1000 * d * d);
    let rho = 0.85 * mat.fc / mat.fy * (1 - Math.sqrt(1 - 2 * Ru / (0.9 * 0.85 * mat.fc)));
    if (isNaN(rho) || rho < 0) rho = 0;
    const AsCalc = rho * 1000 * d;
    shortAs = Math.max(AsCalc, AsMinPerM);

    longCoeff = 0;
    longAs = AsMinPerM; // Shrinkage & temperature reinforcement
  } else {
    // Two-way slab — ACI moment coefficients method
    const coeffs = getSlabCoefficients(beta, discontinuousEdges);
    shortCoeff = coeffs.shortCoeff;
    longCoeff = coeffs.longCoeff;

    const MuShort = shortCoeff * Wu * lx * lx;
    const MuLong = longCoeff * Wu * lx * lx;

    const RuShort = MuShort * 1e6 / (1000 * d * d);
    let rhoShort = 0.85 * mat.fc / mat.fy * (1 - Math.sqrt(1 - 2 * RuShort / (0.9 * 0.85 * mat.fc)));
    if (isNaN(rhoShort) || rhoShort < 0) rhoShort = 0;
    shortAs = Math.max(rhoShort * 1000 * d, AsMinPerM);

    const RuLong = MuLong * 1e6 / (1000 * d * d);
    let rhoLong = 0.85 * mat.fc / mat.fy * (1 - Math.sqrt(1 - 2 * RuLong / (0.9 * 0.85 * mat.fc)));
    if (isNaN(rhoLong) || rhoLong < 0) rhoLong = 0;
    longAs = Math.max(rhoLong * 1000 * d, AsMinPerM);
  }

  // ACI 318-19 §7.7.2.3 (one-way) and §8.7.2.2 (two-way) — maximum bar spacing
  // s_max = min(2h, 450 mm) for primary reinforcement
  // s_max = min(5h, 450 mm) for shrinkage/temperature
  const maxSpacingPrimary = Math.min(2 * hUsed, 450);
  const maxSpacingTemp = Math.min(5 * hUsed, 450);

  const selectBars = (As: number, isPrimary: boolean): { bars: number; dia: number; spacing: number } => {
    const slabDiameters = [8, 10]; // Min 8mm, max 10mm for slabs per project spec
    const maxSpacing = isPrimary ? maxSpacingPrimary : maxSpacingTemp;
    let bestDia = props.phiSlab;
    let bestBars = 3;
    let bestSpacing = 200;
    let bestScore = Infinity;

    for (const dia of slabDiameters) {
      const aBar = Math.PI * dia * dia / 4;
      const nBarsFromAs = Math.max(Math.ceil(As / aBar), 3);
      const spacingFromAs = Math.floor(1000 / nBarsFromAs);

      // Also check max spacing requirement
      const nBarsFromSpacing = Math.ceil(1000 / maxSpacing);
      const nBars = Math.max(nBarsFromAs, nBarsFromSpacing);
      const spacing = Math.min(Math.floor(1000 / nBars), maxSpacing);

      if (spacing < 75) continue; // too dense, try larger diameter
      const actualAs = nBars * aBar;
      const waste = (actualAs - As) / Math.max(As, 1);
      if (waste < bestScore) {
        bestScore = waste;
        bestDia = dia;
        bestBars = nBars;
        bestSpacing = spacing;
      }
    }

    return { bars: bestBars, dia: bestDia, spacing: bestSpacing };
  };

  // Punching shear check if columns are provided
  let punchingShear: PunchingShearResult | undefined;
  if (columns && columns.length > 0 && !isOneWay) {
    const slabCorners = [
      { x: slab.x1, y: slab.y1 }, { x: slab.x2, y: slab.y1 },
      { x: slab.x1, y: slab.y2 }, { x: slab.x2, y: slab.y2 },
    ];
    for (const corner of slabCorners) {
      const col = columns.find(c => Math.abs(c.x - corner.x) < 0.01 && Math.abs(c.y - corner.y) < 0.01);
      if (col) {
        const tributaryArea = (lx / 2) * (ly / 2);
        const Vu = Wu * tributaryArea;
        const result = checkPunchingShear(Vu, col.b, col.h, d, mat.fc, true);
        if (!punchingShear || result.punchingSafetyFactor < punchingShear.punchingSafetyFactor) {
          punchingShear = result;
        }
      }
    }
  }

  return {
    lx, ly, beta, isOneWay,
    hMin, hUsed, ownWeight, Wu,
    discontinuousEdges,
    shortDir: selectBars(shortAs, true),
    longDir: selectBars(longAs, !isOneWay),
    shortCoeff, longCoeff,
    punchingShear,
    usedApproximateMethod: !isOneWay, // Two-way slabs use Marcus coefficients
  };
}

// ===================== COLUMN LOADS (BIAXIAL) =====================

/**
 * Calculate column loads with separate Mx and My per ACI 318-19.
 * Mx comes from horizontal frame moments, My from vertical frame moments.
 */
export function calculateColumnLoads(
  columns: Column[], beams: Beam[], frameResults: FrameResult[]
): Map<string, { Pu: number; Mu: number }> {
  const biaxial = calculateColumnLoadsBiaxial(columns, beams, frameResults);
  const loads = new Map<string, { Pu: number; Mu: number }>();
  for (const [id, val] of biaxial) {
    loads.set(id, { Pu: val.Pu, Mu: Math.max(val.Mx, val.My) });
  }
  return loads;
}

/**
 * Find columns connected above and below a joint at position (x, y, z) using global Z coordinates.
 * 
 * At a joint (beam-column node), we match columns by comparing:
 *   - If column.zTop matches joint Z → column is BELOW the joint (its top connects here)
 *   - If column.zBottom matches joint Z → column is ABOVE the joint (its bottom connects here)
 * 
 * Then compute stiffness distribution: K = factor × I / L
 *   factor = 1.0 for Fixed far end, 0.75 for Pinned far end
 */
function findColumnsAtJoint(
  x: number, y: number, z: number,
  allColumns: Column[],
  tolerance: number = 1, // mm tolerance for Z matching
): { colAbove: Column | null; colBelow: Column | null } {
  let colAbove: Column | null = null;
  let colBelow: Column | null = null;

  for (const c of allColumns) {
    if (c.isRemoved) continue;
    // Match x,y position (plan coordinates in meters, tolerance 0.01m)
    if (Math.abs(c.x - x) > 0.01 || Math.abs(c.y - y) > 0.01) continue;
    
    const cZBot = c.zBottom ?? 0;
    const cZTop = c.zTop ?? (cZBot + c.L);

    // If column's TOP matches joint Z → this column is BELOW the joint
    if (Math.abs(cZTop - z) <= tolerance) {
      colBelow = c;
    }
    // If column's BOTTOM matches joint Z → this column is ABOVE the joint
    if (Math.abs(cZBot - z) <= tolerance) {
      colAbove = c;
    }
  }

  return { colAbove, colBelow };
}

function getColumnDistributionAtJoint(
  colAbove: Column | null,
  colBelow: Column | null,
  endCondTop: 'F' | 'P',
  endCondBot: 'F' | 'P',
): { distributionTop: number; distributionBot: number } {
  // Column ABOVE the joint
  let K_above = 0;
  if (colAbove) {
    const I = (colAbove.b) * Math.pow(colAbove.h, 3) / 12;
    const factor = endCondTop === 'F' ? 1.0 : 0.75;
    K_above = colAbove.L > 0 ? factor * I / colAbove.L : 0;
  }

  // Column BELOW the joint
  let K_below = 0;
  if (colBelow) {
    const I = (colBelow.b) * Math.pow(colBelow.h, 3) / 12;
    const factor = endCondBot === 'F' ? 1.0 : 0.75;
    K_below = colBelow.L > 0 ? factor * I / colBelow.L : 0;
  }

  const sumK = K_above + K_below;
  if (sumK <= 0) return { distributionTop: 0.5, distributionBot: 0.5 };
  return {
    distributionTop: K_above / sumK,
    distributionBot: K_below / sumK,
  };
}

export function calculateColumnLoadsBiaxial(
  columns: Column[], beams: Beam[], frameResults: FrameResult[],
  stories?: Story[],
): Map<string, { Pu: number; Mx: number; My: number; MxTop: number; MxBot: number; MyTop: number; MyBot: number }> {
  const loads = new Map<string, { Pu: number; Mx: number; My: number; MxTop: number; MxBot: number; MyTop: number; MyBot: number }>();
  for (const c of columns) loads.set(c.id, { Pu: 0, Mx: 0, My: 0, MxTop: 0, MxBot: 0, MyTop: 0, MyBot: 0 });

  // Helper: pick value with larger absolute magnitude (preserving sign)
  const pickMax = (cur: number, incoming: number) =>
    Math.abs(incoming) > Math.abs(cur) ? incoming : cur;

  // Cache joint info: for each (x, y, z) joint → columns above/below + distribution
  const jointCache = new Map<string, {
    colAbove: Column | null; colBelow: Column | null;
    distTop: number; distBot: number;
  }>();

  const getJointInfo = (col: Column, beamZ: number) => {
    const key = `${col.x.toFixed(3)}_${col.y.toFixed(3)}_${beamZ}`;
    let info = jointCache.get(key);
    if (!info) {
      const { colAbove, colBelow } = findColumnsAtJoint(col.x, col.y, beamZ, columns);
      const dist = getColumnDistributionAtJoint(
        colAbove, colBelow,
        col.topEndCondition || 'F',
        col.bottomEndCondition || 'F',
      );
      info = { colAbove, colBelow, distTop: dist.distributionTop, distBot: dist.distributionBot };
      jointCache.set(key, info);
    }
    return info;
  };

  for (const fr of frameResults) {
    for (let i = 0; i < fr.beams.length; i++) {
      const br = fr.beams[i];
      const beam = beams.find(b => b.id === br.beamId);
      if (!beam) continue;

      const wu = 1.2 * beam.deadLoad + 1.6 * beam.liveLoad;
      const L = beam.length;
      const Vleft = wu * L / 2 + (Math.abs(br.Mleft) - Math.abs(br.Mright)) / L;
      const Vright = wu * L - Vleft;

      const fromCol = columns.find(c => c.id === beam.fromCol);
      const toCol = columns.find(c => c.id === beam.toCol);

      const beamZ = beam.z ?? 0;

      // ETABS sign convention for column moments (local axis 1 = upward):
      // At a joint, equilibrium: Σ(beam end moments) + Σ(column end moments) = 0
      // Total column moment at joint = -Mbeam
      //
      // For column BELOW joint (beam at its TOP, j-end):
      //   Internal moment at j-end (top) = +Mbeam × dist  (sign flip for j-end convention)
      // For column ABOVE joint (beam at its BOTTOM, i-end):
      //   Internal moment at i-end (bottom) = -Mbeam × dist
      //
      // This naturally produces OPPOSITE signs at top vs bottom for gravity hogging
      // moments → double curvature, matching ETABS behavior.

      const assignMomentAtJoint = (
        colAtEnd: Column | undefined,
        Mbeam: number, V: number,
        jointInfo: { colAbove: Column | null; colBelow: Column | null; distTop: number; distBot: number }
      ) => {
        if (!colAtEnd) return;

        // Find all columns at this joint and assign to correct ends
        const { colAbove, colBelow, distTop, distBot } = jointInfo;

        // Column BELOW the joint: beam is at its TOP (j-end)
        // Internal moment at top = +Mbeam × distBot (j-end sign convention)
        if (colBelow) {
          const colLoads = loads.get(colBelow.id);
          if (colLoads) {
            colLoads.Pu += Math.abs(V);
            const Mcol = Mbeam * distBot; // j-end: same sign as beam moment
            if (beam.direction === 'horizontal') {
              colLoads.Mx = pickMax(colLoads.Mx, Math.abs(Mcol));
              colLoads.MxTop = pickMax(colLoads.MxTop, Mcol);
            } else {
              colLoads.My = pickMax(colLoads.My, Math.abs(Mcol));
              colLoads.MyTop = pickMax(colLoads.MyTop, Mcol);
            }
          }
        }

        // Column ABOVE the joint: beam is at its BOTTOM (i-end)
        // Internal moment at bottom = -Mbeam × distTop (i-end: negate for equilibrium)
        if (colAbove) {
          const colLoads = loads.get(colAbove.id);
          if (colLoads) {
            // Only add Pu if this column wasn't already counted from below
            if (!colBelow || colAbove.id !== colBelow.id) {
              colLoads.Pu += Math.abs(V);
            }
            const Mcol = -Mbeam * distTop; // i-end: negated
            if (beam.direction === 'horizontal') {
              colLoads.Mx = pickMax(colLoads.Mx, Math.abs(Mcol));
              colLoads.MxBot = pickMax(colLoads.MxBot, Mcol);
            } else {
              colLoads.My = pickMax(colLoads.My, Math.abs(Mcol));
              colLoads.MyBot = pickMax(colLoads.MyBot, Mcol);
            }
          }
        }
      };

      // Left end of beam
      if (fromCol) {
        const jointInfo = getJointInfo(fromCol, beamZ);
        assignMomentAtJoint(fromCol, br.Mleft, Vleft, jointInfo);
      }

      // Right end of beam
      if (toCol) {
        const jointInfo = getJointInfo(toCol, beamZ);
        assignMomentAtJoint(toCol, br.Mright, Vright, jointInfo);
      }
    }
  }

  // Accumulate Pu from upper stories to lower stories (like ETABS tributary method)
  // Sort columns by zTop descending (top stories first)
  const sortedCols = [...columns].filter(c => !c.isRemoved).sort((a, b) => {
    const aTop = a.zTop ?? (a.zBottom ?? 0) + a.L;
    const bTop = b.zTop ?? (b.zBottom ?? 0) + b.L;
    return bTop - aTop; // descending
  });

  for (const upperCol of sortedCols) {
    const upperLoads = loads.get(upperCol.id);
    if (!upperLoads) continue;
    const upperZBot = upperCol.zBottom ?? 0;
    
    // Find the column directly below: same (x, y) position, zTop matches upperCol.zBottom
    const lowerCol = columns.find(c => 
      !c.isRemoved &&
      c.id !== upperCol.id &&
      Math.abs(c.x - upperCol.x) < 0.01 &&
      Math.abs(c.y - upperCol.y) < 0.01 &&
      Math.abs((c.zTop ?? ((c.zBottom ?? 0) + c.L)) - upperZBot) <= 1
    );
    
    if (lowerCol) {
      const lowerLoads = loads.get(lowerCol.id);
      if (lowerLoads) {
        lowerLoads.Pu += upperLoads.Pu;
      }
    }
  }

  return loads;
}

// ===================== JOINT CONNECTIVITY INFO =====================

export interface JointConnectivityInfo {
  frameId: string;
  jointColId: string;
  jointX: number;
  jointY: number;
  jointZ: number;
  colAboveId: string | null;
  colAboveB: number | null;
  colAboveH: number | null;
  colAboveL: number | null;
  colAboveZBot: number | null;
  colAboveZTop: number | null;
  colBelowId: string | null;
  colBelowB: number | null;
  colBelowH: number | null;
  colBelowL: number | null;
  colBelowZBot: number | null;
  colBelowZTop: number | null;
  distributionTop: number;
  distributionBot: number;
}

export function getJointConnectivityInfo(
  columns: Column[], beams: Beam[], frameResults: FrameResult[],
): JointConnectivityInfo[] {
  const results: JointConnectivityInfo[] = [];
  const seen = new Set<string>();

  for (const fr of frameResults) {
    for (const br of fr.beams) {
      const beam = beams.find(b => b.id === br.beamId);
      if (!beam) continue;
      const beamZ = beam.z ?? 0;

      for (const colId of [beam.fromCol, beam.toCol]) {
        const key = `${fr.frameId}-${colId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const col = columns.find(c => c.id === colId);
        if (!col) continue;

        const { colAbove, colBelow } = findColumnsAtJoint(col.x, col.y, beamZ, columns);
        const dist = getColumnDistributionAtJoint(
          colAbove, colBelow,
          col.topEndCondition || 'P',
          col.bottomEndCondition || 'P',
        );

        results.push({
          frameId: fr.frameId,
          jointColId: colId,
          jointX: col.x,
          jointY: col.y,
          jointZ: beamZ,
          colAboveId: colAbove?.id ?? null,
          colAboveB: colAbove?.b ?? null,
          colAboveH: colAbove?.h ?? null,
          colAboveL: colAbove?.L ?? null,
          colAboveZBot: colAbove?.zBottom ?? null,
          colAboveZTop: colAbove?.zTop ?? null,
          colBelowId: colBelow?.id ?? null,
          colBelowB: colBelow?.b ?? null,
          colBelowH: colBelow?.h ?? null,
          colBelowL: colBelow?.L ?? null,
          colBelowZBot: colBelow?.zBottom ?? null,
          colBelowZTop: colBelow?.zTop ?? null,
          distributionTop: dist.distributionTop,
          distributionBot: dist.distributionBot,
        });
      }
    }
  }
  return results;
}

// ===================== BIAXIAL COLUMN DESIGN (Bresler Reciprocal Method) =====================

/**
 * ACI 318-19 Biaxial column design using Bresler Reciprocal Load Method.
 * 1/Pn = 1/Pnx + 1/Pny - 1/P0
 * Also performs slenderness check in both X and Y directions.
 */
export interface BiaxialColumnResult extends ColumnResult {
  Mx: number;
  My: number;
  MxMagnified: number;
  MyMagnified: number;
  kLu_rx: number;
  kLu_ry: number;
  deltaNsX: number;
  deltaNsY: number;
  isSlenderX: boolean;
  isSlenderY: boolean;
  breslerRatio: number;
  phiPnx: number;
  phiPny: number;
  P0: number;
  biaxialAdequate: boolean;
  slendernessStatusX: string;
  slendernessStatusY: string;
  requiredBForNonSlender: number;
  requiredHForNonSlender: number;
  suggestRotation: boolean;
  rotationReason: string;
  wasRotated: boolean;
  originalB: number;
  originalH: number;
  // Enhanced ACI 318 fields
  slendernessLimit: number;
  confinementLo: number;
  confinementSpacing: number;
  hoopsDetail: string;
  compressionControlled: boolean;
  balancedPb: number;
  balancedMb: number;
}

/**
 * ACI 318-19 Enhanced Biaxial column design.
 * Phase 1: ψ-based K factor, 34-12(M1/M2) slenderness, confinement per Ch.18
 * Phase 2: Auto-rotation so larger dimension faces larger moment
 */
export function designColumnBiaxial(
  Pu: number, Mx: number, My: number,
  b: number, h: number, fc: number, fy: number,
  Lu: number,
  beamStiffnessX?: { EIL1: number; EIL2: number },
  beamStiffnessY?: { EIL1: number; EIL2: number },
  MxTop?: number, MxBot?: number, MyTop?: number, MyBot?: number,
  isSeismic: boolean = false,
): BiaxialColumnResult {
  const originalB = b;
  const originalH = h;

  // Phase 2: Auto-rotation - place larger dimension to face larger moment
  let wasRotated = false;
  let rotationReason = '';
  if (b !== h) {
    const maxDim = Math.max(b, h);
    const minDim = Math.min(b, h);
    if (Mx > My && h < b) {
      // When bending is stronger about X-axis, orient h as the larger dimension
      [b, h] = [minDim, maxDim];
      wasRotated = true;
      rotationReason = `تدوير تلقائي: البعد الأكبر (${maxDim}mm) يواجه Mx=${Mx.toFixed(1)} الأكبر`;
    } else if (My > Mx && b < h) {
      // When bending is stronger about Y-axis, orient b as the larger dimension
      [b, h] = [maxDim, minDim];
      wasRotated = true;
      rotationReason = `تدوير تلقائي: البعد الأكبر (${maxDim}mm) يواجه My=${My.toFixed(1)} الأكبر`;
    } else if (Mx > My && h >= b) {
      rotationReason = 'الوضع الحالي مثالي';
    } else if (My > Mx && b >= h) {
      rotationReason = 'الوضع الحالي مثالي';
    }
  }

  // Phase 1: Enhanced K-factor via ψ (stiffness ratio)
  const Ec = 4700 * Math.sqrt(fc);
  const IxCol = b * Math.pow(h, 3) / 12;
  const IyCol = h * Math.pow(b, 3) / 12;
  const EIxCol_L = Ec * IxCol / Lu;
  const EIyCol_L = Ec * IyCol / Lu;

  // Calculate ψ for each direction
  // ψ = Σ(EI/L)columns / Σ(EI/L)beams at each end
  let kx = 1.0, ky = 1.0;
  const sumBeamX = (beamStiffnessX?.EIL1 || 0) + (beamStiffnessX?.EIL2 || 0);
  const sumBeamY = (beamStiffnessY?.EIL1 || 0) + (beamStiffnessY?.EIL2 || 0);

  // ETABS-matched K-factor using Jackson & Moreland alignment chart
  // Non-sway (braced) frames: exact formula from ACI R6.6.4.4.3
  // K = smaller root of: (ψA*ψB/4)*(π/K)² + (ψA+ψB)/2*(1-π/K/tan(π/K)) + tan(π/(2K))/(π/(2K)) - 1 = 0
  // Approximation (ACI Commentary):
  //   For non-sway: K = 0.7 + 0.05*(ψA + ψB) ≤ 1.0  when ψA,ψB ≤ 2
  //                 K = 0.85 + 0.05*ψ_min        ≤ 1.0  when ψA or ψB > 2
  // For sway (unbraced) frames:
  //   K = (20 - ψm)/(20) * √(1 + ψm)  for ψm < 2
  //   K = 0.9 * √(1 + ψm)              for ψm ≥ 2
  // where ψm = average of ψ at top and bottom
  
  // Use ψ_top and ψ_bottom separately for more accuracy (ETABS approach)
  // ψ_top = Σ(EI/L)_columns_above_and_below / Σ(EI/L)_beams_framing_at_top
  // ψ_bottom = similar for bottom joint
  // Simplified: assume symmetric → ψ_top ≈ ψ_bottom
  
  const computeK_nonsway = (psiA: number, psiB: number): number => {
    if (psiA <= 2 && psiB <= 2) {
      return Math.min(1.0, Math.max(0.5, 0.7 + 0.05 * (psiA + psiB)));
    } else {
      const psiMin = Math.min(psiA, psiB);
      return Math.min(1.0, Math.max(0.5, 0.85 + 0.05 * psiMin));
    }
  };
  
  if (sumBeamX > 0) {
    const psiX = (2 * EIxCol_L) / sumBeamX;
    kx = computeK_nonsway(psiX, psiX);
  }
  if (sumBeamY > 0) {
    const psiY = (2 * EIyCol_L) / sumBeamY;
    ky = computeK_nonsway(psiY, psiY);
  }

  // ACI 318-19 §6.2.5.1: r = 0.3h for bending about x-axis, r = 0.3b for bending about y-axis
  const rx = 0.3 * h;
  const ry = 0.3 * b;
  const kLu_rx = kx * Lu / rx;
  const kLu_ry = ky * Lu / ry;

  // ACI 318-19 §6.2.5.1(b): Slenderness limit = 34 + 12*(M1/M2), max 40, min 22
  //   M1 = smaller absolute end moment, M2 = larger absolute end moment
  //   M1/M2 is NEGATIVE for single curvature → limit < 34 (conservative)
  //   M1/M2 is POSITIVE for double curvature → limit > 34, up to 40 (less conservative)
  // Curvature detection: if MxTop and MxBot have SAME sign → single curvature (M1/M2 < 0)
  //                      if MxTop and MxBot have OPPOSITE signs → double curvature (M1/M2 > 0)
  const mxTop = MxTop ?? Mx;
  const mxBot = MxBot ?? 0;
  const myTop = MyTop ?? My;
  const myBot = MyBot ?? 0;

  // Determine signed M1/M2 ratio per ACI convention
  const computeSignedRatio = (mTop: number, mBot: number): number => {
    const absTop = Math.abs(mTop);
    const absBot = Math.abs(mBot);
    if (absTop === 0 && absBot === 0) return 0;
    const M2abs = Math.max(absTop, absBot);
    const M1abs = Math.min(absTop, absBot);
    const ratio = M1abs / M2abs;
    // Same sign → single curvature → ratio is negative per ACI
    // Opposite signs → double curvature → ratio is positive per ACI
    const sameSign = (mTop >= 0 && mBot >= 0) || (mTop <= 0 && mBot <= 0);
    return sameSign ? -ratio : ratio;
  };

  const ratioX = computeSignedRatio(mxTop, mxBot);
  const ratioY = computeSignedRatio(myTop, myBot);

  // ACI 318-19 §6.2.5.1(b): limit = 34 + 12*(M1/M2), bounded [22, 40]
  const slendernessLimitX = Math.max(22, Math.min(40, 34 + 12 * ratioX));
  const slendernessLimitY = Math.max(22, Math.min(40, 34 + 12 * ratioY));

  const isSlenderX = kLu_rx > slendernessLimitX;
  const isSlenderY = kLu_ry > slendernessLimitY;

  const requiredBForNonSlender = Math.ceil((kx * Lu) / (0.3 * slendernessLimitX) / 10) * 10;
  const requiredHForNonSlender = Math.ceil((ky * Lu) / (0.3 * slendernessLimitY) / 10) * 10;

  const suggestRotation = wasRotated;

  // ACI 318-19 §6.6.4.5.3: Cm = 0.6 - 0.4*(M1/M2) with same sign convention
  // M1 = smaller abs moment, M2 = larger abs moment, ratio is signed as above
  const M1x = Math.min(Math.abs(mxTop), Math.abs(mxBot));
  const M2x = Math.max(Math.abs(mxTop), Math.abs(mxBot));
  const M1y = Math.min(Math.abs(myTop), Math.abs(myBot));
  const M2y = Math.max(Math.abs(myTop), Math.abs(myBot));

  // Moment magnification
  let deltaNsX = 1.0;
  let MxMagnified = Math.max(Math.abs(Mx), Pu * (15 + 0.03 * h) / 1000);
  if (isSlenderX) {
    // Pass signed ratio for Cm calculation
    const signedM1x = M2x > 0 ? ratioX * M2x : 0; // reconstruct signed M1
    const magX = momentMagnification(Pu, Math.abs(Mx), b, h, fc, fy, Lu, kx, signedM1x, M2x);
    deltaNsX = magX.deltaNs;
    MxMagnified = magX.MuMagnified;
  }

  let deltaNsY = 1.0;
  let MyMagnified = Math.max(Math.abs(My), Pu * (15 + 0.03 * b) / 1000);
  if (isSlenderY) {
    const signedM1y = M2y > 0 ? ratioY * M2y : 0;
    const magY = momentMagnification(Pu, Math.abs(My), h, b, fc, fy, Lu, ky, signedM1y, M2y);
    deltaNsY = magY.deltaNs;
    MyMagnified = magY.MuMagnified;
  }

  // Confinement / tie-spacing design
  const stirrupDia = 10;
  const Ash = Math.PI * stirrupDia * stirrupDia / 4 * 2; // 2-leg hoop
  let Lo: number;
  let sConfinement: number;
  let sOutside: number;

  if (isSeismic) {
    // ACI 318-19 §18.7.5.1 — Special Moment Frames (SMF) seismic confinement
    Lo = Math.max(h, b, Lu / 6, 450);
    // Max spacing in Lo zone: min(b/4, 6*db_long, sx)
    // sx = 100 + (350 − hx)/3, hx = max c-c spacing between hoop legs
    const hx = Math.max(b, h) - 2 * 40; // approximate hoop leg spacing
    const sx = 100 + (350 - Math.min(hx, 350)) / 3;
    sConfinement = Math.min(Math.floor(Math.min(b, h) / 4), 6 * 16, Math.floor(sx));
    // Outside Lo: min(6*db, 150mm)
    sOutside = Math.min(6 * 16, 150);
  } else {
    // ACI 318-19 §25.7.2.2 — Standard (non-seismic) tie spacing
    // No special Lo zone required for Ordinary / Intermediate frames
    Lo = 0; // Not applicable
    // Tie spacing: min(16*db_long, 48*db_tie, min(b, h))
    sConfinement = Math.min(16 * 16, 48 * stirrupDia, Math.min(b, h));
    sOutside = sConfinement; // Uniform spacing throughout
  }

  const Ag = b * h;
  const rhoTrials = [0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04];
  const diameters = [14, 16, 18, 20, 22, 25, 30];

  let bestResult: BiaxialColumnResult | null = null;

  // Calculate balanced condition for reporting
  const Es = 200000;
  const beta1 = fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7);
  const dPrimeDefault = 60;
  const dMaxDefault = h - dPrimeDefault;
  const cb = dMaxDefault * 0.003 / (0.003 + fy / Es);
  const ab = beta1 * cb;
  const balancedPb = (0.85 * fc * ab * b / 1000);
  const balancedMb = balancedPb * (h / 2 - ab / 2) / 1000;
  const compressionControlled = Pu > 0.1 * 0.65 * (0.85 * fc * Ag / 1000);

  for (const rho of rhoTrials) {
    const AsReq = rho * Ag;
    for (const dia of diameters) {
      const aBar = Math.PI * dia * dia / 4;
      const nBars = Math.max(4, Math.ceil(AsReq / aBar));
      const nBarsEven = nBars % 2 === 0 ? nBars : nBars + 1;
      if (nBarsEven > 20) continue;

      const pmX = generatePMDiagram(b, h, fc, fy, nBarsEven, dia);
      const pmY = generatePMDiagram(h, b, fc, fy, nBarsEven, dia);
      const checkX = checkPMCapacity(Pu, MxMagnified, pmX);
      const checkY = checkPMCapacity(Pu, MyMagnified, pmY);

      const P0 = 0.85 * fc * (Ag - nBarsEven * aBar) / 1000 + fy * nBarsEven * aBar / 1000;
      const phiP0 = 0.65 * 0.80 * P0;
      const phiPnx = checkX.phiPn > 0 ? checkX.phiPn : phiP0;
      const phiPny = checkY.phiPn > 0 ? checkY.phiPn : phiP0;

      let breslerRatio: number;
      if (Pu < 0.1 * phiP0) {
        const alpha = 1.24;
        const mxRatio = checkX.phiMn > 0 ? MxMagnified / checkX.phiMn : 0;
        const myRatio = checkY.phiMn > 0 ? MyMagnified / checkY.phiMn : 0;
        breslerRatio = Math.pow(mxRatio, alpha) + Math.pow(myRatio, alpha);
      } else {
        if (phiPnx > 0 && phiPny > 0 && phiP0 > 0) {
          const reciprocal = 1 / phiPnx + 1 / phiPny - 1 / phiP0;
          const phiPnBiaxial = reciprocal > 0 ? 1 / reciprocal : 0;
          breslerRatio = phiPnBiaxial > 0 ? Pu / phiPnBiaxial : 999;
        } else {
          breslerRatio = 999;
        }
      }

      const biaxialAdequate = breslerRatio <= 1.0;

      if (biaxialAdequate) {
        const rhoActual = nBarsEven * aBar / Ag;
        const stirrupSpacing = Math.min(sConfinement, 16 * dia, Math.min(b, h), 300);
        const overallRatio = Math.max(checkX.ratio, checkY.ratio, breslerRatio);

        bestResult = {
          Pu, Mu: Math.max(MxMagnified, MyMagnified),
          Mx, My, MxMagnified, MyMagnified,
          checkSlenderness: isSlenderX || isSlenderY ? 'نحيف' : 'قصير',
          bars: nBarsEven, dia,
          stirrups: `Φ${stirrupDia}@${stirrupSpacing}mm`,
          phiPn: Math.min(phiPnx, phiPny),
          phiMn: Math.min(checkX.phiMn, checkY.phiMn),
          adequate: biaxialAdequate,
          rhoActual, kLu_r: Math.max(kLu_rx, kLu_ry),
          deltaNs: Math.max(deltaNsX, deltaNsY),
          MuMagnified: Math.max(MxMagnified, MyMagnified),
          pmDiagram: pmX,
          utilizationRatio: overallRatio,
          interactionRatio: breslerRatio,
          designCapacity: Math.min(phiPnx, phiPny),
          safetyStatus: biaxialAdequate ? 'آمن' : 'غير آمن',
          kLu_rx, kLu_ry, deltaNsX, deltaNsY,
          isSlenderX, isSlenderY, breslerRatio,
          phiPnx, phiPny, P0: phiP0,
          biaxialAdequate,
          slendernessStatusX: isSlenderX ? `نحيف (${kLu_rx.toFixed(1)}>${slendernessLimitX.toFixed(0)})` : `قصير (${kLu_rx.toFixed(1)}<${slendernessLimitX.toFixed(0)})`,
          slendernessStatusY: isSlenderY ? `نحيف (${kLu_ry.toFixed(1)}>${slendernessLimitY.toFixed(0)})` : `قصير (${kLu_ry.toFixed(1)}<${slendernessLimitY.toFixed(0)})`,
          requiredBForNonSlender, requiredHForNonSlender, suggestRotation, rotationReason,
          wasRotated, originalB, originalH,
          slendernessLimit: Math.max(slendernessLimitX, slendernessLimitY),
          confinementLo: Lo,
          confinementSpacing: stirrupSpacing,
          hoopsDetail: isSeismic
            ? `Φ${stirrupDia}@${stirrupSpacing}mm داخل Lo=${Lo}mm (§18.7.5.1) + Φ${stirrupDia}@${sOutside}mm خارج Lo`
            : `Φ${stirrupDia}@${stirrupSpacing}mm موحد (§25.7.2.2)`,
          compressionControlled,
          balancedPb, balancedMb,
        };
        break;
      }
    }
    if (bestResult) break;
  }

  if (!bestResult) {
    const dia = 25;
    const aBar = Math.PI * dia * dia / 4;
    const nBars = Math.max(4, Math.ceil(0.04 * Ag / aBar));
    const nBarsEven = nBars % 2 === 0 ? nBars : nBars + 1;
    const pmX = generatePMDiagram(b, h, fc, fy, nBarsEven, dia);
    const pmY = generatePMDiagram(h, b, fc, fy, nBarsEven, dia);
    const checkX = checkPMCapacity(Pu, MxMagnified, pmX);
    const checkY = checkPMCapacity(Pu, MyMagnified, pmY);
    const P0 = 0.85 * fc * (Ag - nBarsEven * aBar) / 1000 + fy * nBarsEven * aBar / 1000;
    const phiP0 = 0.65 * 0.80 * P0;
    const phiPnx = checkX.phiPn > 0 ? checkX.phiPn : phiP0;
    const phiPny = checkY.phiPn > 0 ? checkY.phiPn : phiP0;
    const reciprocal = 1 / phiPnx + 1 / phiPny - 1 / phiP0;
    const breslerRatio = reciprocal > 0 ? Pu / (1 / reciprocal) : 999;
    const rhoActual = nBarsEven * aBar / Ag;
    const stirrupSpacing = Math.min(sConfinement, 16 * dia, Math.min(b, h), 300);

    bestResult = {
      Pu, Mu: Math.max(MxMagnified, MyMagnified),
      Mx, My, MxMagnified, MyMagnified,
      checkSlenderness: isSlenderX || isSlenderY ? 'نحيف' : 'قصير',
      bars: nBarsEven, dia,
      stirrups: `Φ${stirrupDia}@${stirrupSpacing}mm`,
      phiPn: Math.min(phiPnx, phiPny), phiMn: Math.min(checkX.phiMn, checkY.phiMn),
      adequate: breslerRatio <= 1.0,
      rhoActual, kLu_r: Math.max(kLu_rx, kLu_ry),
      deltaNs: Math.max(deltaNsX, deltaNsY),
      MuMagnified: Math.max(MxMagnified, MyMagnified),
      pmDiagram: pmX, utilizationRatio: Math.max(checkX.ratio, checkY.ratio, breslerRatio),
      interactionRatio: breslerRatio,
      designCapacity: Math.min(phiPnx, phiPny),
      safetyStatus: breslerRatio <= 1.0 ? 'آمن' : 'غير آمن - يجب تكبير المقطع',
      kLu_rx, kLu_ry, deltaNsX, deltaNsY,
      isSlenderX, isSlenderY, breslerRatio,
      phiPnx, phiPny, P0: phiP0,
      biaxialAdequate: breslerRatio <= 1.0,
      slendernessStatusX: isSlenderX ? `نحيف (${kLu_rx.toFixed(1)}>${slendernessLimitX.toFixed(0)})` : `قصير (${kLu_rx.toFixed(1)}<${slendernessLimitX.toFixed(0)})`,
      slendernessStatusY: isSlenderY ? `نحيف (${kLu_ry.toFixed(1)}>${slendernessLimitY.toFixed(0)})` : `قصير (${kLu_ry.toFixed(1)}<${slendernessLimitY.toFixed(0)})`,
      requiredBForNonSlender, requiredHForNonSlender, suggestRotation, rotationReason,
      wasRotated, originalB, originalH,
      slendernessLimit: Math.max(slendernessLimitX, slendernessLimitY),
      confinementLo: Lo,
      confinementSpacing: stirrupSpacing,
      hoopsDetail: isSeismic
        ? `Φ${stirrupDia}@${stirrupSpacing}mm داخل Lo=${Lo}mm (§18.7.5.1) + Φ${stirrupDia}@${sOutside}mm خارج Lo`
        : `Φ${stirrupDia}@${stirrupSpacing}mm موحد (§25.7.2.2)`,
      compressionControlled,
      balancedPb, balancedMb,
    };
  }

  return bestResult;
}

// ===================== BENT-UP BARS (تكسيح الحديد) =====================

/**
 * ACI 318-19 Bent-up bars system for beams.
 * 
 * Rules:
 * - At least 1/3 of positive moment reinforcement must extend to support (§9.7.3.8.2)
 * - Bars are bent alternately (every other bar)
 * - Bend point: 0.15L from end support (exterior span), 0.25L from interior support
 * - Bent bars contribute to negative moment resistance at supports
 * - Bent bars also contribute to shear resistance: Vs = Av*fy*sin(α), α=45°
 * - Development length must be provided after bend point (Chapter 25)
 */
export interface BentUpBarResult {
  /** Number of bottom bars that are bent up */
  bentBarsCount: number;
  /** Area of bent bars (mm²) */
  bentBarsArea: number;
  /** Remaining straight bottom bars */
  remainingBottomBars: number;
  /** Bend point distance from left support (m) */
  bendPointLeft: number;
  /** Bend point distance from right support (m) */
  bendPointRight: number;
  /** Bent bar contribution to shear (kN) - Vs = Av*fy*sin(45°) */
  shearContribution: number;
  /** Bent bar diameter */
  bentDia: number;
  /** Is this an exterior (end) or interior span */
  isExteriorLeft: boolean;
  isExteriorRight: boolean;
}

export interface FrameBentUpResult {
  frameId: string;
  beams: {
    beamId: string;
    bentUp: BentUpBarResult;
    /** Required top bars at left support (from negative moment) */
    requiredTopLeft: number;
    /** Required top bars at right support (from negative moment) */
    requiredTopRight: number;
    /** Bent bars contributing at left support (from this beam + adjacent) */
    bentContributionLeft: number;
    /** Bent bars contributing at right support (from this beam + adjacent) */
    bentContributionRight: number;
    /** Final additional top bars needed at left support */
    additionalTopLeft: number;
    /** Final additional top bars needed at right support */
    additionalTopRight: number;
    /** Final top bar count for this beam (max of left and right additional) */
    finalTopBars: number;
    /** Top bar diameter */
    topDia: number;
    /** Bottom bar count (original) */
    originalBottomBars: number;
    /** Bottom bar diameter */
    bottomDia: number;
  }[];
}

export function calculateBentUpBars(
  bottomBars: number,
  bottomDia: number,
  span: number,
  isExteriorLeft: boolean,
  isExteriorRight: boolean,
  fy: number
): BentUpBarResult {
  // ACI §9.7.3.8.2: at least 1/3 of positive moment steel must remain straight to support
  const minStraight = Math.ceil(bottomBars / 3);
  // Bend every other bar - alternate bars
  const maxBentBars = bottomBars - minStraight;
  const bentBarsCount = Math.max(0, Math.floor(maxBentBars));

  const aBar = Math.PI * bottomDia * bottomDia / 4;
  const bentBarsArea = bentBarsCount * aBar;

  // Bend points per ACI
  const bendPointLeft = isExteriorLeft ? 0.15 * span : 0.25 * span;
  const bendPointRight = isExteriorRight ? 0.15 * span : 0.25 * span;

  // Shear contribution: Vs = Av * fy * sin(45°) per ACI §22.5.10.5
  const shearContribution = bentBarsArea * fy * Math.sin(Math.PI / 4) / 1000; // kN

  return {
    bentBarsCount,
    bentBarsArea,
    remainingBottomBars: bottomBars - bentBarsCount,
    bendPointLeft,
    bendPointRight,
    shearContribution,
    bentDia: bottomDia,
    isExteriorLeft,
    isExteriorRight,
  };
}

/**
 * Calculate bent-up bar system for an entire frame.
 * 
 * Logic per user requirements:
 * 1. For each beam, calculate how many bars can be bent up
 * 2. Bent bars from beam pass over its supports
 * 3. At each support, bent bars from left beam + right beam contribute to negative moment
 * 4. Required additional top bars = required_negative_As - bent_contribution_As
 * 5. If diameters differ between top and bottom, calculate as area and convert
 * 6. Final top bars per beam = max(additional at left support, additional at right support)
 */
export function calculateFrameBentUp(
  frame: Frame,
  beamsMap: Map<string, Beam>,
  frameResult: FrameResult,
  mat: MatProps,
  allFrames: Frame[],
  /** Set of secondary (carried) beam IDs - these should NOT have bent-up bars */
  secondaryBeamIds?: Set<string>
): FrameBentUpResult {
  const frameBeams = frame.beamIds.map(id => beamsMap.get(id)!);
  const n = frameBeams.length;

  // First: design each beam's flexure to get bar counts
  const beamFlexures = frameResult.beams.map(br => {
    const beam = beamsMap.get(br.beamId)!;
    const flexLeft = designFlexure(Math.abs(br.Mleft), beam.b, beam.h, mat.fc, mat.fy);
    const flexMid = designFlexure(br.Mmid, beam.b, beam.h, mat.fc, mat.fy, 40, false, 0, 0, 4);
    const flexRight = designFlexure(Math.abs(br.Mright), beam.b, beam.h, mat.fc, mat.fy);
    return { br, beam, flexLeft, flexMid, flexRight };
  });

  // Determine exterior/interior for each beam position
  const isExteriorLeft = (i: number) => i === 0;
  const isExteriorRight = (i: number) => i === n - 1;

  // Calculate bent-up bars for each beam
  // Secondary (carried) beams: bars run straight — no bent-up bars (تكسيح)
  // Reason: carried beam ends at a hinge (beam-on-beam connection), so bars cannot be bent
  // over the support and provide continuity. Bottom bars remain straight through the full span.
  const bentResults = beamFlexures.map((bf, i) => {
    const isSecondary = secondaryBeamIds?.has(bf.br.beamId) ?? false;
    if (isSecondary) {
      // Return zero bent-up result for secondary beams
      return {
        bentBarsCount: 0,
        bentBarsArea: 0,
        remainingBottomBars: bf.flexMid.bars,
        bendPointLeft: 0,
        bendPointRight: 0,
        shearContribution: 0,
        bentDia: bf.flexMid.dia,
        isExteriorLeft: isExteriorLeft(i),
        isExteriorRight: isExteriorRight(i),
      } as BentUpBarResult;
    }
    return calculateBentUpBars(
      bf.flexMid.bars, bf.flexMid.dia,
      bf.br.span, isExteriorLeft(i), isExteriorRight(i),
      mat.fy
    );
  });

  // Now calculate contributions at each support
  // Support j is between beam j-1 and beam j (for j=0 it's left end, j=n is right end)
  const result: FrameBentUpResult = { frameId: frame.id, beams: [] };

  for (let i = 0; i < n; i++) {
    const bf = beamFlexures[i];
    const bent = bentResults[i];
    const topDia = bf.flexLeft.dia; // top bar diameter

    // Required top bars at left and right supports (from negative moment)
    const requiredTopLeftAs = bf.flexLeft.As;
    const requiredTopRightAs = bf.flexRight.As;

    // Bent contribution at LEFT support of beam i:
    // - Bent bars from this beam (going up at left)
    // - Bent bars from beam i-1 (going up at right, passing over this support)
    const bentFromThisLeft = bent.bentBarsArea;
    const bentFromPrevRight = i > 0 ? bentResults[i - 1].bentBarsArea : 0;
    const bentContributionLeftAs = bentFromThisLeft + bentFromPrevRight;

    // Bent contribution at RIGHT support of beam i:
    // - Bent bars from this beam (going up at right)
    // - Bent bars from beam i+1 (going up at left, passing over this support)
    const bentFromThisRight = bent.bentBarsArea;
    const bentFromNextLeft = i < n - 1 ? bentResults[i + 1].bentBarsArea : 0;
    const bentContributionRightAs = bentFromThisRight + bentFromNextLeft;

    // Additional top bars needed (as area)
    const additionalTopLeftAs = Math.max(0, requiredTopLeftAs - bentContributionLeftAs);
    const additionalTopRightAs = Math.max(0, requiredTopRightAs - bentContributionRightAs);

    // Convert area to bar count using top bar diameter
    const aBarTop = Math.PI * topDia * topDia / 4;
    const additionalTopLeft = Math.ceil(additionalTopLeftAs / aBarTop);
    const additionalTopRight = Math.ceil(additionalTopRightAs / aBarTop);

    // Convert contribution areas to equivalent bar counts for display
    const bentContributionLeftBars = Math.floor(bentContributionLeftAs / aBarTop);
    const bentContributionRightBars = Math.floor(bentContributionRightAs / aBarTop);

    // Final top bars = max of what's needed at left and right
    const finalTopBars = Math.max(additionalTopLeft, additionalTopRight, 2); // minimum 2 top bars

    result.beams.push({
      beamId: bf.br.beamId,
      bentUp: bent,
      requiredTopLeft: Math.ceil(requiredTopLeftAs / aBarTop),
      requiredTopRight: Math.ceil(requiredTopRightAs / aBarTop),
      bentContributionLeft: bentContributionLeftBars,
      bentContributionRight: bentContributionRightBars,
      additionalTopLeft,
      additionalTopRight,
      finalTopBars,
      topDia,
      originalBottomBars: bf.flexMid.bars,
      bottomDia: bf.flexMid.dia,
    });
  }

  return result;
}

// ===================== DEVELOPMENT LENGTH CALCULATION (ACI 318-19 Chapter 25) =====================

export interface DevelopmentLengths {
  ld_straight: number;
  ldh_standard_hook: number;
  ld_compression: number;
  lap_classA: number;
  lap_classB: number;
  lap_column: number;
  dia: number;
  fy: number;
  fc: number;
}

export function calculateDevelopmentLengths(
  dia: number, fy: number, fc: number,
  cover: number = 40, spacing: number = 150,
  useEpoxyCoated: boolean = false,
): DevelopmentLengths {
  const psi_t = 1.0;
  const psi_e = useEpoxyCoated ? 1.5 : 1.0;
  const psi_s = dia <= 20 ? 0.8 : 1.0;
  const lambda = 1.0;

  const cb = Math.min(cover + dia / 2, spacing / 2);
  const Ktr = 0;
  const confinement = Math.min((cb + Ktr) / dia, 2.5);

  const ld_basic = (fy * psi_t * psi_e * psi_s) /
    (1.1 * lambda * Math.sqrt(fc) * confinement) * dia;
  const ld_straight = Math.max(ld_basic, 300);

  const ldh = Math.max(
    (0.24 * psi_e * fy) / (lambda * Math.sqrt(fc)) * dia,
    8 * dia,
    150
  );

  const ld_comp = Math.max(
    (0.24 * fy) / (lambda * Math.sqrt(fc)) * dia,
    0.043 * fy * dia,
    200
  );

  return {
    ld_straight: Math.ceil(ld_straight),
    ldh_standard_hook: Math.ceil(ldh),
    ld_compression: Math.ceil(ld_comp),
    lap_classA: Math.ceil(1.0 * ld_straight),
    lap_classB: Math.ceil(1.3 * ld_straight),
    lap_column: Math.max(40 * dia, 300),
    dia, fy, fc,
  };
}

export function generateDevelopmentLengthTable(
  usedDiameters: number[], fy: number, fc: number,
  cover: number = 40, spacing: number = 150,
): DevelopmentLengths[] {
  const uniqueDias = [...new Set(usedDiameters)].sort((a, b) => a - b);
  return uniqueDias.map(dia => calculateDevelopmentLengths(dia, fy, fc, cover, spacing));
}
