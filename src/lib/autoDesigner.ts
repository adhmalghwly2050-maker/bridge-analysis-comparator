/**
 * Auto Design Engine — ACI 318-19
 * Given loads and slab geometry, automatically suggests:
 * - Uniform slab thickness (for same-type slabs)
 * - Beam dimensions (b fixed at 200mm = wall width)
 * - Column dimensions
 * - Reinforcement for all elements
 */

import type { Slab, MatProps, SlabProps } from './structuralEngine';

// ===================== TYPES =====================
export interface AutoDesignInput {
  slabs: Slab[];
  /** kN/m² — superimposed dead load (finishes, partitions) */
  finishLoad: number;
  /** kN/m² — live load */
  liveLoad: number;
  /** kN/m — wall load on beams (default for all beams) */
  wallLoad: number;
  /** MPa */
  fc: number;
  /** MPa */
  fy: number;
  /** MPa — stirrup yield */
  fyt: number;
  /** kN/m³ — concrete unit weight */
  gamma: number;
  /** mm — floor height */
  floorHeight: number;
  /** number of floors above */
  numFloors: number;
}

export interface AutoDesignResult {
  /** Uniform slab thickness (mm) — rounded up to nearest 10mm */
  slabThickness: number;
  /** Beam width — always 200mm (wall width) */
  beamB: number;
  /** Beam depth (mm) — governed by max span */
  beamH: number;
  /** Column width (mm) */
  colB: number;
  /** Column depth (mm) */
  colH: number;
  /** Summary of sizing rationale */
  notes: AutoDesignNote[];
  /** Per-slab details */
  slabDetails: SlabAutoDetail[];
  /** Per-beam details */
  beamDetails: BeamAutoDetail[];
  /** Column sizing details */
  columnDetail: ColumnAutoDetail;
  /** Material/slab props to apply */
  matProps: MatProps;
  slabProps: SlabProps;
}

export interface AutoDesignNote {
  category: 'slab' | 'beam' | 'column' | 'general';
  text: string;
  aciRef?: string;
}

export interface SlabAutoDetail {
  id: string;
  lx: number; // m
  ly: number; // m
  beta: number;
  isOneWay: boolean;
  hMin: number; // mm
  discontinuousEdges: number;
}

export interface BeamAutoDetail {
  /** e.g. "span 5.0m" */
  label: string;
  span: number; // m
  hMinSimple: number;
  hMinOneEnd: number;
  hMinBothEnds: number;
  hUsed: number; // mm
}

export interface ColumnAutoDetail {
  estimatedPu: number; // kN per column (average)
  requiredArea: number; // mm²
  suggestedB: number;
  suggestedH: number;
  rhoAssumed: number;
}

// ===================== WALL WIDTH CONSTANT =====================
const WALL_WIDTH = 200; // mm — fixed beam width = wall width

// ===================== HELPER: count discontinuous edges =====================
function countDiscEdges(slab: Slab, allSlabs: Slab[]): number {
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
      if (edge.y1 === edge.y2) {
        return (s.y1 === edge.y1 || s.y2 === edge.y1) &&
          Math.max(s.x1, edge.x1) < Math.min(s.x2, edge.x2);
      }
      if (edge.x1 === edge.x2) {
        return (s.x1 === edge.x1 || s.x2 === edge.x1) &&
          Math.max(s.y1, edge.y1) < Math.min(s.y2, edge.y2);
      }
      return false;
    });
    if (!hasNeighbor) count++;
  }
  return count;
}

// ===================== MAIN AUTO-DESIGN FUNCTION =====================
export function runAutoDesign(input: AutoDesignInput): AutoDesignResult {
  const { slabs, finishLoad, liveLoad, wallLoad, fc, fy, fyt, gamma, floorHeight, numFloors } = input;
  const notes: AutoDesignNote[] = [];

  // ── Step 1: Analyze all slabs ──
  const slabDetails: SlabAutoDetail[] = slabs.map(s => {
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    const lx = Math.min(dx, dy);
    const ly = Math.max(dx, dy);
    const beta = ly / lx;
    const isOneWay = beta >= 2;
    const discEdges = countDiscEdges(s, slabs);

    // ACI 318-19 Table 7.3.1.1 (one-way) / Table 8.3.1.1 (two-way)
    let hMin: number;
    const ln = lx * 1000; // clear span in mm

    if (isOneWay) {
      if (discEdges === 0) hMin = ln / 28;
      else if (discEdges >= 3) hMin = ln / 10;
      else if (discEdges === 1) hMin = ln / 24;
      else hMin = ln / 20;
    } else {
      // Two-way without beams
      if (discEdges === 0) {
        hMin = ln * (0.8 + fy / 1400) / 33;
      } else {
        hMin = ln * (0.8 + fy / 1400) / 30;
      }
    }

    // Absolute minimum
    hMin = Math.max(hMin, isOneWay ? 100 : 125);

    return { id: s.id, lx, ly, beta, isOneWay, hMin, discontinuousEdges: discEdges };
  });

  // Uniform slab thickness: take maximum of all hMin, round up to nearest 10mm
  const maxHMin = Math.max(...slabDetails.map(d => d.hMin));
  const slabThickness = Math.ceil(maxHMin / 10) * 10;

  notes.push({
    category: 'slab',
    text: `سماكة البلاطة الموحدة = ${slabThickness} مم (أقصى حد أدنى من جميع البلاطات = ${maxHMin.toFixed(0)} مم)`,
    aciRef: 'ACI 318-19 Table 7.3.1.1 / 8.3.1.1',
  });

  // ── Step 2: Beam dimensions ──
  // b = 200mm (wall width), h from ACI Table 9.3.1.1
  const beamB = WALL_WIDTH;

  // Get all unique beam spans from slab edges
  const spanSet = new Set<number>();
  for (const s of slabs) {
    spanSet.add(Math.abs(s.x2 - s.x1));
    spanSet.add(Math.abs(s.y2 - s.y1));
  }
  const spans = [...spanSet].sort((a, b) => a - b);

  const beamDetails: BeamAutoDetail[] = spans.map(span => {
    const L = span * 1000; // mm
    return {
      label: `بحر ${span.toFixed(1)} م`,
      span,
      hMinSimple: L / 16,
      hMinOneEnd: L / 18.5,
      hMinBothEnds: L / 21,
      hUsed: 0, // will be set below
    };
  });

  // Governing beam depth: use max span with "both ends continuous" as default
  // (most beams in a grid are continuous)
  const maxSpan = Math.max(...spans);
  const maxSpanMm = maxSpan * 1000;

  // ACI 318-19 Table 9.3.1.1 — minimum depth for beams not supporting partitions
  // Both ends continuous: L/21
  // One end continuous: L/18.5
  // Use L/18.5 for governing (conservative, some beams are exterior)
  let beamHCalc = maxSpanMm / 18.5;
  
  // Also check beam adequacy: h should allow at least 2 layers of bars
  // Minimum practical h = 300mm
  beamHCalc = Math.max(beamHCalc, 300);
  
  // Round up to nearest 50mm
  const beamH = Math.ceil(beamHCalc / 50) * 50;

  // Update beam details
  for (const bd of beamDetails) {
    bd.hUsed = beamH;
  }

  notes.push({
    category: 'beam',
    text: `عرض الجسر = ${beamB} مم (عرض الجدار)، ارتفاع الجسر = ${beamH} مم (من بحر حاكم = ${maxSpan.toFixed(1)} م)`,
    aciRef: 'ACI 318-19 Table 9.3.1.1',
  });

  // Check beam width adequacy (b/h ratio)
  if (beamH / beamB > 3) {
    notes.push({
      category: 'beam',
      text: `⚠️ نسبة h/b = ${(beamH / beamB).toFixed(1)} > 3 — يفضل ألا تتجاوز 3 لتفادي مشاكل الثبات الجانبي`,
      aciRef: 'ACI 318-19 §9.2.3',
    });
  }

  // ── Step 3: Column sizing ──
  // Estimate axial load on most loaded column (tributary area × floors)
  const colPoints = new Map<string, { x: number; y: number }>();
  for (const s of slabs) {
    for (const p of [
      { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y1 },
      { x: s.x1, y: s.y2 }, { x: s.x2, y: s.y2 },
    ]) {
      colPoints.set(`${p.x},${p.y}`, p);
    }
  }

  // Tributary area for each column
  let maxTribArea = 0;
  for (const [, pt] of colPoints) {
    let tribArea = 0;
    for (const s of slabs) {
      if (pt.x >= s.x1 && pt.x <= s.x2 && pt.y >= s.y1 && pt.y <= s.y2) {
        // Corner of slab — tributary = slab area / 4
        const slabArea = Math.abs(s.x2 - s.x1) * Math.abs(s.y2 - s.y1);
        tribArea += slabArea / 4;
      }
    }
    maxTribArea = Math.max(maxTribArea, tribArea);
  }

  // Service loads per floor
  const slabSW = (slabThickness / 1000) * gamma; // kN/m²
  const beamSW = (beamB / 1000) * ((beamH - slabThickness) / 1000) * gamma; // kN/m per beam (net)
  const totalDL = slabSW + finishLoad; // kN/m²
  const totalLL = liveLoad; // kN/m²

  // Factored load per floor on tributary area
  const quFloor = 1.2 * totalDL + 1.6 * totalLL; // kN/m²
  const PuPerFloor = quFloor * maxTribArea;
  const PuTotal = PuPerFloor * numFloors;

  // Add beam self-weight contribution (approximate)
  const avgBeamSpan = spans.reduce((a, b) => a + b, 0) / spans.length;
  const beamSWContrib = beamSW * avgBeamSpan * 2 * 1.2 * numFloors; // 2 beams framing into column
  const PuColumn = PuTotal + beamSWContrib;

  // Column self-weight (iterative, start with estimate)
  const colSW = 0.3 * 0.3 * (floorHeight / 1000) * gamma * numFloors * 1.2;
  const PuWithSW = PuColumn + colSW;

  // Required column area: Pu = φ × 0.80 × [0.85×fc×(Ag-As) + fy×As]
  // Assume ρ = 1.5% (mid-range)
  const rhoCol = 0.015;
  const phi = 0.65;
  const requiredAg = PuWithSW * 1000 / (phi * 0.80 * (0.85 * fc * (1 - rhoCol) + fy * rhoCol));
  const minDim = Math.max(250, Math.ceil(Math.sqrt(requiredAg) / 50) * 50);

  // Use square column if possible, otherwise rectangular
  let colB = minDim;
  let colH = minDim;

  // Minimum column dimension = 250mm (practical)
  colB = Math.max(colB, 250);
  colH = Math.max(colH, 250);

  // Ensure column at least as wide as beam for proper connection
  colB = Math.max(colB, beamB);

  const columnDetail: ColumnAutoDetail = {
    estimatedPu: PuWithSW,
    requiredArea: requiredAg,
    suggestedB: colB,
    suggestedH: colH,
    rhoAssumed: rhoCol,
  };

  notes.push({
    category: 'column',
    text: `العمود ${colB}×${colH} مم — الحمل المحوري التقديري = ${PuWithSW.toFixed(0)} kN (${numFloors} طوابق، مساحة محمولة = ${maxTribArea.toFixed(1)} م²)`,
    aciRef: 'ACI 318-19 §22.4.2',
  });

  // ── Step 4: General notes ──
  notes.push({
    category: 'general',
    text: `عرض الجدران = ${WALL_WIDTH} مم — جميع الجسور بعرض ${WALL_WIDTH} مم`,
  });

  if (slabDetails.every(d => !d.isOneWay)) {
    notes.push({
      category: 'slab',
      text: 'جميع البلاطات من نوع اتجاهين — سماكة موحدة مطبقة',
    });
  } else if (slabDetails.every(d => d.isOneWay)) {
    notes.push({
      category: 'slab',
      text: 'جميع البلاطات من نوع اتجاه واحد — سماكة موحدة مطبقة',
    });
  } else {
    notes.push({
      category: 'slab',
      text: 'بلاطات مختلطة (اتجاه واحد + اتجاهين) — سماكة موحدة محكومة بأكبر حد أدنى',
    });
  }

  return {
    slabThickness,
    beamB,
    beamH,
    colB,
    colH,
    notes,
    slabDetails,
    beamDetails,
    columnDetail,
    matProps: { fc, fy, fyt, gamma },
    slabProps: {
      thickness: slabThickness,
      finishLoad,
      liveLoad,
      cover: 20,
      phiMain: 10,
      phiSlab: 10,
    },
  };
}
