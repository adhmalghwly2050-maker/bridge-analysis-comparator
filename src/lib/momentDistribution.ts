/**
 * Moment Distribution Method (Hardy Cross) for Continuous Beam Analysis
 * 
 * Matches the Excel spreadsheet analysis method exactly.
 * Uses iterative moment distribution instead of matrix stiffness.
 * 
 * Process:
 * 1. Calculate section properties (I, A) for beams and columns
 * 2. Calculate stiffness (4EI/L or 3EI/L) for each member at each joint
 * 3. Calculate distribution factors at each joint
 * 4. Calculate Fixed End Moments (FEM) for each load case
 * 5. Perform iterative Hardy Cross moment distribution
 * 6. Generate envelope from multiple load patterns
 * 7. Calculate shears and span moments from final support moments
 */

// ======================== TYPES ========================

export interface MDNode {
  id: string;
  x: number;
  /** true = fixed support (translation restrained) */
  isSupport: boolean;
  /** Column stiffness above (4EI/L or 3EI/L), 0 if no column */
  colStiffnessAbove: number;
  /** Column stiffness below */
  colStiffnessBelow: number;
  /** End condition: 'K' = knife edge (pinned), 'E' = encastre (fixed), 'C' = cantilever */
  endCondition?: 'K' | 'E' | 'C';
}

export interface MDPointLoad {
  P: number;
  a: number; // distance from left end
}

export interface MDElement {
  id: string;
  nodeI: number;
  nodeJ: number;
  L: number; // span length (m)
  EI: number; // E * I
  w: number; // UDL (kN/m) - set per load case
  pointLoads?: MDPointLoad[];
  /** Moment release (hinge) at node I end */
  hingeI?: boolean;
  /** Moment release (hinge) at node J end */
  hingeJ?: boolean;
}

export interface MDDiagramPoint {
  x: number;
  shear: number;
  moment: number;
  deflection: number;
}

export interface MDElementResult {
  elementId: string;
  Mleft: number;   // Support moment at left end (hogging = negative)
  Mright: number;  // Support moment at right end (hogging = negative)
  Vleft: number;   // Shear at left end
  Vright: number;  // Shear at right end
  Mmid: number;    // Maximum sagging moment in span
  diagram?: MDDiagramPoint[];
}

export interface MDResult {
  nodeMoments: number[];
  elements: MDElementResult[];
  reactions: number[];
}

// ======================== DISTRIBUTION FACTORS ========================

interface JointStiffness {
  beamLeft: number;  // stiffness of beam to the left
  beamRight: number; // stiffness of beam to the right
  colAbove: number;  // column above stiffness
  colBelow: number;  // column below stiffness
  total: number;
  dfLeft: number;    // distribution factor for left beam
  dfRight: number;   // distribution factor for right beam
  dfColAbove: number;
  dfColBelow: number;
}

/**
 * Calculate member stiffness: 4EI/L for fixed far end, 3EI/L for pinned far end
 */
function memberStiffness(EI: number, L: number, farEndPinned: boolean = false): number {
  if (L <= 0) return 0;
  return farEndPinned ? (3 * EI / L) : (4 * EI / L);
}

/**
 * Calculate distribution factors at each joint (support)
 * Excel: Analysis sheet rows 11-38
 */
function calculateDistributionFactors(
  nodes: MDNode[],
  elements: MDElement[]
): JointStiffness[] {
  const n = nodes.length;
  const joints: JointStiffness[] = [];

  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    
    // Beam to the left (element ending at this node)
    let beamLeftStiffness = 0;
    if (i > 0) {
      const elem = elements[i - 1];
      // Far end is pinned if it's the first node and that node is a knife edge/pinned
      const farEndPinned = (i - 1 === 0 && nodes[0].endCondition === 'K');
      beamLeftStiffness = memberStiffness(elem.EI, elem.L, farEndPinned);
    }

    // Beam to the right (element starting at this node)
    let beamRightStiffness = 0;
    if (i < n - 1) {
      const elem = elements[i];
      // Far end is pinned if it's the last node and that node is a knife edge/pinned
      const farEndPinned = (i + 1 === n - 1 && nodes[n - 1].endCondition === 'K');
      beamRightStiffness = memberStiffness(elem.EI, elem.L, farEndPinned);
    }

    const colAbove = node.colStiffnessAbove || 0;
    const colBelow = node.colStiffnessBelow || 0;

    const total = beamLeftStiffness + beamRightStiffness + colAbove + colBelow;

    joints.push({
      beamLeft: beamLeftStiffness,
      beamRight: beamRightStiffness,
      colAbove,
      colBelow,
      total,
      dfLeft: total > 0 ? beamLeftStiffness / total : 0,
      dfRight: total > 0 ? beamRightStiffness / total : 0,
      dfColAbove: total > 0 ? colAbove / total : 0,
      dfColBelow: total > 0 ? colBelow / total : 0,
    });
  }

  return joints;
}

// ======================== FIXED END MOMENTS ========================

/**
 * Fixed End Moments for UDL: wL²/12
 * Excel: Analysis sheet rows 40-55
 */
function femUDL(w: number, L: number): [number, number] {
  const fem = w * L * L / 12;
  return [fem, -fem]; // [left (clockwise), right (counter-clockwise)]
}

/**
 * Fixed End Moments for a point load at distance 'a' from left
 */
function femPointLoad(P: number, a: number, L: number): [number, number] {
  const b = L - a;
  const femL = P * a * b * b / (L * L);
  const femR = -P * a * a * b / (L * L);
  return [femL, femR];
}

/**
 * Fixed End Moment for cantilever load at tip
 * Excel: Analysis sheet row 43 - "Cant" FEM
 */
function femCantilever(w: number, L: number, Lcant: number): number {
  // Cantilever moment = w * Lcant² / 2, applied as reaction at support
  return w * Lcant * Lcant / 2;
}

/**
 * Calculate total FEM for an element with all its loads
 */
function calculateFEM(elem: MDElement): [number, number] {
  const [femL, femR] = femUDL(elem.w, elem.L);
  let totalL = femL;
  let totalR = femR;
  
  if (elem.pointLoads) {
    for (const pl of elem.pointLoads) {
      const [plL, plR] = femPointLoad(pl.P, pl.a, elem.L);
      totalL += plL;
      totalR += plR;
    }
  }

  return [totalL, totalR];
}

// ======================== MOMENT DISTRIBUTION (HARDY CROSS) ========================

/**
 * Perform Hardy Cross moment distribution iteration
 * Excel: Analysis sheet rows 57-73 (and similar for other load cases)
 * 
 * Convention: 
 * - Positive moment = clockwise (sagging at midspan)
 * - At supports: moment[joint][left] = moment at joint from left beam
 *                moment[joint][right] = moment at joint from right beam
 * 
 * @param maxCycles Maximum number of distribution cycles (Excel uses ~7-10)
 */
function hardyCrossMomentDistribution(
  nodes: MDNode[],
  elements: MDElement[],
  joints: JointStiffness[],
  loadPerElement: number[], // UDL per element for this load case
  pointLoadsPerElement: (MDPointLoad[] | undefined)[], // point loads per element
  maxCycles: number = 15,
  tolerance: number = 0.001
): number[] {
  const n = nodes.length;
  const nElem = elements.length;

  // Support moments array: supportMoments[i] = moment at support i
  // Index mapping: for joint i, left beam moment and right beam moment
  // We track moment at each side of each joint
  
  // Moments at each end of each element
  // moments[elemIdx][0] = left end, moments[elemIdx][1] = right end
  const moments: number[][] = [];
  
  // Calculate FEM for each element
  for (let i = 0; i < nElem; i++) {
    const w = loadPerElement[i];
    const L = elements[i].L;
    const [femL, femR] = femUDL(w, L);
    let totalL = femL;
    let totalR = femR;
    
    const pls = pointLoadsPerElement[i];
    if (pls) {
      for (const pl of pls) {
        const [plL, plR] = femPointLoad(pl.P, pl.a, L);
        totalL += plL;
        totalR += plR;
      }
    }
    
    moments.push([totalL, totalR]);
  }

  // Iterative moment distribution
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    let maxUnbalance = 0;

    for (let j = 0; j < n; j++) {
      // Skip if this is a free end (no support)
      // At end nodes with knife edge support, moments are released
      if (j === 0 && nodes[0].endCondition === 'K') continue;
      if (j === n - 1 && nodes[n - 1].endCondition === 'K') continue;

      // Calculate unbalanced moment at joint j
      let unbalanced = 0;
      
      // Moment from left beam (right end of element j-1)
      if (j > 0) {
        unbalanced += moments[j - 1][1]; // right end of left beam
      }
      
      // Moment from right beam (left end of element j)
      if (j < nElem) {
        unbalanced -= moments[j][0]; // left end of right beam (sign convention)
      }

      // Actually, in Hardy Cross, the unbalanced moment is the sum of all FEMs at the joint
      // FEM convention: positive = clockwise
      // At a joint: sum of moments from all members
      // The unbalanced moment at joint j:
      //   = -(right end moment of left beam + left end moment of right beam)
      // because right-end FEM of left beam and left-end FEM of right beam act at the joint
      
      // Re-calculate: In standard Hardy Cross notation:
      // FEM at joint from beam to left = moments[j-1][1] (right end of that beam)
      // FEM at joint from beam to right = moments[j][0] (left end of that beam)
      // Unbalanced = -(sum of all moments at joint)
      let sumAtJoint = 0;
      if (j > 0) sumAtJoint += moments[j - 1][1];
      if (j < nElem) sumAtJoint += moments[j][0];
      // Add column moments (they absorb moment but don't contribute FEM)
      
      unbalanced = -sumAtJoint;
      maxUnbalance = Math.max(maxUnbalance, Math.abs(unbalanced));

      if (Math.abs(unbalanced) < tolerance) continue;

      const jt = joints[j];
      
      // Distribute to left beam
      if (j > 0 && jt.total > 0) {
        const dist = unbalanced * jt.dfLeft;
        moments[j - 1][1] += dist;
        // Carry over to far end (factor = 0.5 for fixed far end, 0 for pinned)
        const farEndPinned = (j - 1 === 0 && nodes[0].endCondition === 'K');
        if (!farEndPinned) {
          moments[j - 1][0] += dist * 0.5;
        }
      }

      // Distribute to right beam
      if (j < nElem && jt.total > 0) {
        const dist = unbalanced * jt.dfRight;
        moments[j][0] += dist;
        // Carry over to far end
        const farEndPinned = (j + 1 === n - 1 && nodes[n - 1].endCondition === 'K');
        if (!farEndPinned) {
          moments[j][1] += dist * 0.5;
        }
      }

      // Column moments absorb but don't carry over in 2D beam analysis
      // (they affect distribution factors but moments go to columns, not beams)
    }

    if (maxUnbalance < tolerance) break;
  }

  // Extract final support moments
  // supportMoments[j] = final moment at support j
  const supportMoments: number[] = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    let M = 0;
    if (j > 0) M += moments[j - 1][1]; // right end of left beam
    if (j < nElem) M += moments[j][0]; // left end of right beam
    // The support moment is the average/sum depending on convention
    // In the Excel, support moment = sum of beam-end moments at that joint
    // But actually each side independently has its moment
    // For beam design, we need moments at each end of each beam
    supportMoments[j] = M;
  }

  // Return beam-end moments (more useful for post-processing)
  // Flatten: [elem0_left, elem0_right, elem1_left, elem1_right, ...]
  const result: number[] = [];
  for (let i = 0; i < nElem; i++) {
    result.push(moments[i][0], moments[i][1]);
  }
  
  return result;
}

// ======================== SHEAR CALCULATION ========================

/**
 * Calculate elastic shears from support moments
 * Excel: Analysis sheet rows 140-148
  * V_left = wL/2 + (M_left + M_right) / L
  * Hardy Cross convention: Mleft positive=CW (hogging), Mright negative=CW (hogging)
  * Equilibrium: V_A*L = wL²/2 + Mleft + Mright  (derived from ΣM about B)
  */
function calculateShears(
  elem: MDElement,
  Mleft: number,  // support moment at left end (from moment distribution, HC convention)
  Mright: number, // support moment at right end (HC convention)
  w: number       // UDL for this load case
): [number, number] {
  const L = elem.L;
  
  // Correct shear formula from equilibrium with HC sign convention
  let Vleft = w * L / 2 + (Mleft + Mright) / L;
  let Vright = w * L / 2 - (Mleft + Mright) / L;
  
  // Add point load contributions
  if (elem.pointLoads) {
    for (const pl of elem.pointLoads) {
      const a = pl.a;
      const b = L - a;
      Vleft += pl.P * b / L;
      Vright += pl.P * a / L;
    }
  }

  return [Vleft, -Vright]; // Convention: positive up at left, negative at right end
}

// ======================== SPAN MOMENTS ========================

/**
 * Calculate maximum sagging moment in span
 * Excel: Analysis sheet rows 173+ "SPAN MOMENTS"
 * 
  * M(x) = -Mleft + Vleft * x - w * x² / 2 - point load contributions
  * (Negate Mleft from HC convention to structural: hogging = negative)
  * Find x where dM/dx = 0 (max moment location)
  */
function calculateSpanMoments(
  elem: MDElement,
  Mleft: number,  // HC convention (positive = CW = hogging at left end)
  Vleft: number,
  w: number,
  nStations: number = 20
): { Mmid: number; diagram?: MDDiagramPoint[] } {
  const L = elem.L;
  let maxM = 0;
  const points: MDDiagramPoint[] = [];

  for (let s = 0; s <= nStations; s++) {
    const x = (s / nStations) * L;
    
    // Moment at station x (structural convention: sagging positive)
    let M = -Mleft + Vleft * x - w * x * x / 2;
    if (elem.pointLoads) {
      for (const pl of elem.pointLoads) {
        if (x > pl.a) M -= pl.P * (x - pl.a);
      }
    }

    // Shear at station x
    let V = Vleft - w * x;
    if (elem.pointLoads) {
      for (const pl of elem.pointLoads) {
        if (x >= pl.a) V -= pl.P;
      }
    }

    // Approximate deflection
    const xi = x / L;
    const EI = elem.EI;
    const deflection = EI > 0
      ? Math.abs(-(w * L * L * L * L / (384 * EI)) * (16 * xi - 24 * xi * xi + 8 * xi * xi * xi * xi) * Math.sin(Math.PI * xi))
      : 0;

    // Track max positive (sagging) moment
    if (M > maxM) maxM = M;

    points.push({ x, shear: V, moment: M, deflection });
  }

  return { Mmid: maxM, diagram: points };
}

// ======================== MAIN ANALYSIS FUNCTION ========================

/**
 * Analyze continuous beam using Moment Distribution Method
 * Replaces analyzeByMatrixStiffness for the 2D engine
 */
export function analyzeByMomentDistribution(
  nodes: MDNode[],
  elements: MDElement[],
  computeDiagrams: boolean = false
): MDResult {
  const nNodes = nodes.length;
  const nElem = elements.length;

  // Step 1: Calculate distribution factors
  const joints = calculateDistributionFactors(nodes, elements);

  // Step 2: Calculate FEM and perform moment distribution
  const loadPerElement = elements.map(e => e.w);
  const pointLoadsPerElement = elements.map(e => e.pointLoads);
  
  const beamEndMoments = hardyCrossMomentDistribution(
    nodes, elements, joints, loadPerElement, pointLoadsPerElement
  );

  // Step 3: Extract results
  const nodeMoments: number[] = new Array(nNodes).fill(0);
  const reactions: number[] = new Array(nNodes).fill(0);
  const elemResults: MDElementResult[] = [];

  for (let i = 0; i < nElem; i++) {
    const elem = elements[i];
    const w = elem.w;
    
    // Support moments from moment distribution
    // Convention: hogging at supports is negative for display
    const Mleft_raw = beamEndMoments[i * 2];     // left end moment
    const Mright_raw = beamEndMoments[i * 2 + 1]; // right end moment
    
    // Display convention matching ETABS: hogging = negative
    const Mleft = -Math.abs(Mleft_raw) * Math.sign(Mleft_raw);
    const Mright = Math.abs(Mright_raw) * Math.sign(Mright_raw);

    // Calculate shears
    const [Vleft, Vright] = calculateShears(elem, Mleft_raw, Mright_raw, w);

    // Calculate span moments and diagrams
    const spanResult = calculateSpanMoments(elem, Mleft_raw, Vleft, w, computeDiagrams ? 21 : 20);

    // Update node moments (max absolute)
    nodeMoments[i] = Math.max(nodeMoments[i], Math.abs(Mleft_raw));
    if (i + 1 < nNodes) {
      nodeMoments[i + 1] = Math.max(nodeMoments[i + 1], Math.abs(Mright_raw));
    }

    // Reactions = shears at supports
    reactions[i] += Math.abs(Vleft);
    reactions[i + 1] += Math.abs(Vright);

    const result: MDElementResult = {
      elementId: elem.id,
      Mleft: -Mleft_raw,   // Negate: HC positive CW (hogging) → structural negative (hogging)
      Mright: Mright_raw,  // Already correct: HC negative CW at right = structural negative (hogging)
      Vleft,
      Vright,
      Mmid: spanResult.Mmid,
    };

    if (computeDiagrams) {
      result.diagram = spanResult.diagram;
    }

    elemResults.push(result);
  }

  return { nodeMoments, elements: elemResults, reactions };
}

// ======================== ENVELOPE ANALYSIS ========================

/**
 * Envelope analysis with multiple load patterns
 * Excel: Analysis sheet - Dead only, All spans, Odd spans, Even spans
 * 
 * Load patterns (matching Excel):
 * 1. All spans loaded (1.2D + 1.6L on all spans)
 * 2. Dead only (1.2D on all spans)  
 * 3. Odd spans loaded (1.2D + 1.6L on odd, 1.2D on even)
 * 4. Even spans loaded (1.2D + 1.6L on even, 1.2D on odd)
 * 5. All 2^n pattern combinations for thoroughness
 */
export function envelopeByMomentDistribution(
  nodes: MDNode[],
  elements: MDElement[],
  loadCases: number[][],
  computeDiagrams: boolean = false
): MDResult {
  const nNodes = nodes.length;
  const nElem = elements.length;

  // Run moment distribution for each load case
  const cases: MDResult[] = loadCases.map(loads => {
    const elems = elements.map((e, i) => ({ ...e, w: loads[i] }));
    return analyzeByMomentDistribution(nodes, elems, computeDiagrams);
  });

  // Build envelope
  const nodeMoments = new Array(nNodes).fill(0);
  const reactions = new Array(nNodes).fill(0);
  const elemResults: MDElementResult[] = [];

  for (let i = 0; i < nNodes; i++) {
    nodeMoments[i] = Math.max(...cases.map(c => Math.abs(c.nodeMoments[i])));
    const reactionValues = cases.map(c => c.reactions[i]);
    reactions[i] = reactionValues.reduce((best, v) => Math.abs(v) > Math.abs(best) ? v : best, 0);
  }

  for (let i = 0; i < nElem; i++) {
    const mleftValues = cases.map(c => c.elements[i].Mleft);
    const mrightValues = cases.map(c => c.elements[i].Mright);
    const vleftValues = cases.map(c => c.elements[i].Vleft);
    const vrightValues = cases.map(c => c.elements[i].Vright);

    // ── DIAGRAM ENVELOPE (FIX 2026-04-18) ──────────────────────────
    // Build a true station-by-station envelope across load cases so
    // Mmid (used in summary tables) is consistent with the value the
    // 7-station raw exporter reads from the diagram at x=L/2.
    let envelopeDiagram: MDDiagramPoint[] | undefined;
    if (computeDiagrams) {
      const diagrams = cases
        .map(c => c.elements[i].diagram)
        .filter((d): d is MDDiagramPoint[] => Array.isArray(d) && d.length > 0);
      if (diagrams.length > 0) {
        const nSt = diagrams[0].length;
        envelopeDiagram = new Array<MDDiagramPoint>(nSt);
        for (let s = 0; s < nSt; s++) {
          let maxM = -Infinity;
          let bestPt: MDDiagramPoint = diagrams[0][s];
          for (const d of diagrams) {
            const pt = d[s];
            if (!pt) continue;
            if (pt.moment > maxM) {
              maxM = pt.moment;
              bestPt = pt;
            }
          }
          envelopeDiagram[s] = bestPt;
        }
      }
    }

    let envelopeMmid = 0;
    if (envelopeDiagram) {
      for (const pt of envelopeDiagram) {
        if (pt.moment > envelopeMmid) envelopeMmid = pt.moment;
      }
    } else {
      const mmidValues = cases.map(c => c.elements[i].Mmid);
      envelopeMmid = Math.max(0, ...mmidValues);
    }

    const result: MDElementResult = {
      elementId: elements[i].id,
      Mleft: mleftValues.reduce((best, v) => Math.abs(v) > Math.abs(best) ? v : best, 0),
      Mright: mrightValues.reduce((best, v) => Math.abs(v) > Math.abs(best) ? v : best, 0),
      Vleft: vleftValues.reduce((best, v) => Math.abs(v) > Math.abs(best) ? v : best, 0),
      Vright: vrightValues.reduce((best, v) => Math.abs(v) > Math.abs(best) ? v : best, 0),
      Mmid: envelopeMmid,
    };

    if (envelopeDiagram) {
      result.diagram = envelopeDiagram;
    }

    elemResults.push(result);
  }

  return { nodeMoments, elements: elemResults, reactions };
}

// ======================== WEIGHT ESTIMATION SERVICE ========================

export interface RebarWeightItem {
  location: string;
  count: number;
  type: string; // 'T' for top, 'B' for bottom
  diameter: number;
  length: number;
  unitWeight: number; // kg/m
  totalWeight: number; // kg
}

export interface RebarWeightResult {
  items: RebarWeightItem[];
  topSteelWeight: number;
  bottomSteelWeight: number;
  linkWeight: number;
  totalWeight: number;
  weightPerMeter: number; // kg/m of beam
}

/**
 * Unit weight of reinforcing bar (kg/m)
 * Formula: diameter² * π / 4 * 7850 / 1e6
 */
function rebarUnitWeight(dia: number): number {
  return dia * dia * Math.PI / 4 * 7850 / 1e6;
}

/**
 * Calculate bar cut length based on location and span
 * Matches Excel Weight sheet logic
 */
function barCutLength(
  location: 'support' | 'span',
  spanLength: number, // mm
  lapMultiplier: number = 1.4,
  anchorage: number = 0
): number {
  if (location === 'support') {
    // Support bar extends 0.3L each side + lap
    return Math.round(spanLength * 0.3 * 2 + anchorage);
  }
  // Span bar = full span length
  return Math.round(spanLength * lapMultiplier);
}

/**
 * Estimate reinforcement weight for a continuous beam
 * Matches Excel "Weight" sheet
 */
export function estimateRebarWeight(
  spans: { length: number; topBars: { count: number; dia: number }[]; bottomBars: { count: number; dia: number }[] }[],
  linkDia: number,
  linkSpacing: number,
  linkLegs: number,
  beamWidth: number,
  beamDepth: number,
  cover: number
): RebarWeightResult {
  const items: RebarWeightItem[] = [];
  let topTotal = 0;
  let bottomTotal = 0;
  let linkTotal = 0;

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const L = span.length;

    // Support bars (at left support)
    for (const bar of span.topBars) {
      const cutLen = barCutLength('support', L);
      const uw = rebarUnitWeight(bar.dia);
      const wt = bar.count * uw * cutLen / 1000;
      items.push({
        location: `Support ${i + 1}`,
        count: bar.count,
        type: 'T',
        diameter: bar.dia,
        length: cutLen,
        unitWeight: uw,
        totalWeight: wt,
      });
      topTotal += wt;
    }

    // Span bars
    for (const bar of span.bottomBars) {
      const cutLen = barCutLength('span', L);
      const uw = rebarUnitWeight(bar.dia);
      const wt = bar.count * uw * cutLen / 1000;
      items.push({
        location: `Span ${i + 1}`,
        count: bar.count,
        type: 'B',
        diameter: bar.dia,
        length: cutLen,
        unitWeight: uw,
        totalWeight: wt,
      });
      bottomTotal += wt;
    }

    // Links
    const linkPerimeter = 2 * ((beamWidth - 2 * cover) + (beamDepth - 2 * cover));
    const nLinks = Math.ceil(L / linkSpacing);
    const linkUW = rebarUnitWeight(linkDia);
    const linkWt = nLinks * linkLegs * linkUW * linkPerimeter / 1000;
    linkTotal += linkWt;
  }

  const totalBeamLength = spans.reduce((s, sp) => s + sp.length, 0);

  return {
    items,
    topSteelWeight: topTotal,
    bottomSteelWeight: bottomTotal,
    linkWeight: linkTotal,
    totalWeight: topTotal + bottomTotal + linkTotal,
    weightPerMeter: totalBeamLength > 0 ? (topTotal + bottomTotal + linkTotal) / (totalBeamLength / 1000) : 0,
  };
}

// ======================== BAR BENDING SCHEDULE SERVICE ========================

export interface BarScheduleItem {
  mark: string;
  type: string;
  diameter: number;
  count: number;
  length: number;
  shapeCode: string;
  a: number;
  b: number;
  c: number;
  d: number;
  totalLength: number;
  weight: number;
}

/**
 * Generate bar bending schedule
 * Matches Excel "Bar" sheet
 */
export function generateBarSchedule(
  spans: { 
    length: number; 
    topBars: { count: number; dia: number }[];
    bottomBars: { count: number; dia: number }[];
    linkDia: number;
    linkSpacing: number;
    linkLegs: number;
  }[],
  beamWidth: number,
  beamDepth: number,
  cover: number
): BarScheduleItem[] {
  const schedule: BarScheduleItem[] = [];
  let markCounter = 1;

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const L = span.length;

    // Top bars at support
    for (const bar of span.topBars) {
      if (bar.count <= 0) continue;
      const cutLen = barCutLength('support', L);
      schedule.push({
        mark: `${markCounter++}`,
        type: 'T1',
        diameter: bar.dia,
        count: bar.count,
        length: cutLen,
        shapeCode: '20', // straight bar
        a: cutLen,
        b: 0,
        c: 0,
        d: 0,
        totalLength: bar.count * cutLen,
        weight: bar.count * rebarUnitWeight(bar.dia) * cutLen / 1000,
      });
    }

    // Bottom bars in span
    for (const bar of span.bottomBars) {
      if (bar.count <= 0) continue;
      const cutLen = barCutLength('span', L);
      schedule.push({
        mark: `${markCounter++}`,
        type: 'B1',
        diameter: bar.dia,
        count: bar.count,
        length: cutLen,
        shapeCode: '20',
        a: cutLen,
        b: 0,
        c: 0,
        d: 0,
        totalLength: bar.count * cutLen,
        weight: bar.count * rebarUnitWeight(bar.dia) * cutLen / 1000,
      });
    }

    // Links
    const linkW = beamWidth - 2 * cover;
    const linkH = beamDepth - 2 * cover;
    const nLinks = Math.ceil(L / span.linkSpacing);
    const linkLength = 2 * (linkW + linkH) + 2 * 10 * span.linkDia; // + hook allowance
    schedule.push({
      mark: `${markCounter++}`,
      type: 'L',
      diameter: span.linkDia,
      count: nLinks * span.linkLegs,
      length: linkLength,
      shapeCode: '51', // closed link
      a: linkW,
      b: linkH,
      c: 0,
      d: 0,
      totalLength: nLinks * span.linkLegs * linkLength,
      weight: nLinks * span.linkLegs * rebarUnitWeight(span.linkDia) * linkLength / 1000,
    });
  }

  return schedule;
}
