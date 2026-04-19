/**
 * Matrix Stiffness Method for Continuous Beam / Frame Analysis
 *
 * Uses the Direct Stiffness Method (DSM) to solve for nodal displacements,
 * member end forces, reactions, and internal force distributions.
 *
 * Supports:
 * - Continuous beams with any number of spans
 * - Column stiffness contributions at supports
 * - Multiple load cases with envelope results
 * - Point loads (for beam-on-beam connections)
 * - Spring supports (for beam-on-beam vertical stiffness)
 * - Shear, moment, and deflection diagrams
 */

// ======================== TYPES ========================

export interface MSNode {
  id: string;
  x: number;
  fixedDOFs: boolean[];
  columnStiffness?: number;
  verticalSpring?: number;
}

export interface MSPointLoad {
  P: number;
  a: number;
}

export interface MSElement {
  id: string;
  nodeI: number;
  nodeJ: number;
  L: number;
  EI: number;
  w: number;
  pointLoads?: MSPointLoad[];
  /** Moment release (hinge) at node I end */
  hingeI?: boolean;
  /** Moment release (hinge) at node J end */
  hingeJ?: boolean;
}

export interface DiagramPoint {
  x: number;
  shear: number;
  moment: number;
  deflection: number;
}

export interface MSElementResult {
  elementId: string;
  Mleft: number;
  Mright: number;
  Vleft: number;
  Vright: number;
  Mmid: number;
  diagram?: DiagramPoint[];
}

export interface MSResult {
  nodeMoments: number[];
  elements: MSElementResult[];
  reactions: number[];
}

// ======================== LINEAR ALGEBRA HELPERS ========================

function solveLinearSystem(K: number[][], F: number[]): number[] {
  const n = K.length;
  const A = K.map((row, i) => [...row, F[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > maxVal) {
        maxVal = Math.abs(A[row][col]);
        maxRow = row;
      }
    }
    if (maxRow !== col) {
      [A[col], A[maxRow]] = [A[maxRow], A[col]];
    }
    if (Math.abs(A[col][col]) < 1e-12) {
      A[col][col] = 1;
      A[col][n] = 0;
      continue;
    }
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / A[col][col];
      for (let j = col; j <= n; j++) {
        A[row][j] -= factor * A[col][j];
      }
    }
  }

  const d = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = A[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * d[j];
    }
    d[i] = Math.abs(A[i][i]) > 1e-12 ? sum / A[i][i] : 0;
  }
  return d;
}

// ======================== ELEMENT STIFFNESS ========================

function beamStiffnessMatrix(EI: number, L: number, hingeI: boolean = false, hingeJ: boolean = false): number[][] {
  const L2 = L * L;
  const L3 = L2 * L;

  // Both ends hinged: no bending stiffness (statically determinate)
  if (hingeI && hingeJ) {
    return [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
  }
  // Hinge at node I: modified stiffness (3EI/L formulation)
  if (hingeI) {
    return [
      [3 * EI / L3, 0, -3 * EI / L3, 3 * EI / L2],
      [0, 0, 0, 0],
      [-3 * EI / L3, 0, 3 * EI / L3, -3 * EI / L2],
      [3 * EI / L2, 0, -3 * EI / L2, 3 * EI / L],
    ];
  }
  // Hinge at node J: modified stiffness (3EI/L formulation)
  if (hingeJ) {
    return [
      [3 * EI / L3, 3 * EI / L2, -3 * EI / L3, 0],
      [3 * EI / L2, 3 * EI / L, -3 * EI / L2, 0],
      [-3 * EI / L3, -3 * EI / L2, 3 * EI / L3, 0],
      [0, 0, 0, 0],
    ];
  }
  // Normal (both ends fixed): standard 4EI/L formulation
  return [
    [12 * EI / L3, 6 * EI / L2, -12 * EI / L3, 6 * EI / L2],
    [6 * EI / L2, 4 * EI / L, -6 * EI / L2, 2 * EI / L],
    [-12 * EI / L3, -6 * EI / L2, 12 * EI / L3, -6 * EI / L2],
    [6 * EI / L2, 2 * EI / L, -6 * EI / L2, 4 * EI / L],
  ];
}

function fixedEndForces(w: number, L: number, hingeI: boolean = false, hingeJ: boolean = false): number[] {
  if (hingeI && hingeJ) {
    // Simply supported: no fixed-end moments
    return [w * L / 2, 0, w * L / 2, 0];
  }
  if (hingeI) {
    // Propped cantilever: hinge at I, fixed at J
    return [3 * w * L / 8, 0, 5 * w * L / 8, -w * L * L / 8];
  }
  if (hingeJ) {
    // Propped cantilever: fixed at I, hinge at J
    return [5 * w * L / 8, w * L * L / 8, 3 * w * L / 8, 0];
  }
  return [
    w * L / 2,
    w * L * L / 12,
    w * L / 2,
    -w * L * L / 12,
  ];
}

function pointLoadFixedEndForces(P: number, a: number, L: number, hingeI: boolean = false, hingeJ: boolean = false): number[] {
  const b = L - a;
  const L3 = L * L * L;
  const L2 = L * L;
  if (hingeI && hingeJ) {
    return [P * b / L, 0, P * a / L, 0];
  }
  if (hingeI) {
    // Hinge at I: FEM_J = -Pab(2L-b)/(2L²), FEM_I = 0
    const RJ = P * a * (3 * L2 - a * a) / (2 * L3);
    const RI = P - RJ;
    return [RI, 0, RJ, -P * a * b * (2 * L - b) / (2 * L2)];
  }
  if (hingeJ) {
    const RI = P * b * (3 * L2 - b * b) / (2 * L3);
    const RJ = P - RI;
    return [RI, P * a * b * (2 * L - a) / (2 * L2), RJ, 0];
  }
  return [
    P * b * b * (3 * a + b) / L3,
    P * a * b * b / L2,
    P * a * a * (a + 3 * b) / L3,
    -P * a * a * b / L2,
  ];
}

function combinedFixedEndForces(elem: MSElement): number[] {
  const fef = fixedEndForces(elem.w, elem.L, elem.hingeI, elem.hingeJ);
  if (elem.pointLoads) {
    for (const pl of elem.pointLoads) {
      const plFef = pointLoadFixedEndForces(pl.P, pl.a, elem.L, elem.hingeI, elem.hingeJ);
      for (let i = 0; i < 4; i++) {
        fef[i] += plFef[i];
      }
    }
  }
  return fef;
}

// ======================== INTERNAL FORCE DIAGRAMS ========================

/**
 * Generate shear, moment, and deflection diagrams for a beam element
 */
function generateDiagram(
  elem: MSElement,
  Vleft: number,
  Mleft: number,
  nPoints: number = 21
): DiagramPoint[] {
  const points: DiagramPoint[] = [];
  const { L, w, EI } = elem;

  for (let i = 0; i <= nPoints; i++) {
    const x = (i / nPoints) * L;

    // Shear: V(x) = Vleft - w*x - ΣP(x > a)
    let V = Vleft - w * x;
    if (elem.pointLoads) {
      for (const pl of elem.pointLoads) {
        if (x >= pl.a) V -= pl.P;
      }
    }

    // Moment: M(x) = Mleft + Vleft*x - w*x²/2 - ΣP*(x-a)
    let M = Mleft + Vleft * x - w * x * x / 2;
    if (elem.pointLoads) {
      for (const pl of elem.pointLoads) {
        if (x > pl.a) M -= pl.P * (x - pl.a);
      }
    }

    // Deflection using double integration (approximate)
    // δ(x) ≈ M(x) * L² / (8 * EI) * shape function
    const xi = x / L;
    const deflection = EI > 0
      ? -(w * L * L * L * L / (384 * EI)) * (16 * xi - 24 * xi * xi + 8 * xi * xi * xi * xi)
        * Math.sin(Math.PI * xi)
      : 0;

    points.push({ x, shear: V, moment: M, deflection: Math.abs(deflection) });
  }

  return points;
}

// ======================== ASSEMBLY & SOLVE ========================

export function analyzeByMatrixStiffness(
  nodes: MSNode[],
  elements: MSElement[],
  computeDiagrams: boolean = false
): MSResult {
  const nNodes = nodes.length;
  const nDOF = nNodes * 2;

  const K: number[][] = Array.from({ length: nDOF }, () => new Array(nDOF).fill(0));
  const F: number[] = new Array(nDOF).fill(0);

  for (const elem of elements) {
    const ke = beamStiffnessMatrix(elem.EI, elem.L, elem.hingeI, elem.hingeJ);
    const fef = combinedFixedEndForces(elem);

    const dofs = [
      elem.nodeI * 2,
      elem.nodeI * 2 + 1,
      elem.nodeJ * 2,
      elem.nodeJ * 2 + 1,
    ];

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        K[dofs[i]][dofs[j]] += ke[i][j];
      }
      F[dofs[i]] -= fef[i];
    }
  }

  for (let i = 0; i < nNodes; i++) {
    if (nodes[i].columnStiffness) {
      const rotDOF = i * 2 + 1;
      K[rotDOF][rotDOF] += nodes[i].columnStiffness!;
    }
    if (nodes[i].verticalSpring) {
      const transDOF = i * 2;
      K[transDOF][transDOF] += nodes[i].verticalSpring!;
    }
  }

  const freeDOFs: boolean[] = new Array(nDOF).fill(true);
  for (let i = 0; i < nNodes; i++) {
    if (nodes[i].fixedDOFs[0]) freeDOFs[i * 2] = false;
    if (nodes[i].fixedDOFs[1]) freeDOFs[i * 2 + 1] = false;
  }

  const freeIndices = freeDOFs.map((f, i) => f ? i : -1).filter(i => i >= 0);
  const nFree = freeIndices.length;

  if (nFree === 0) {
    return buildResults(nodes, elements, new Array(nDOF).fill(0), computeDiagrams);
  }

  const Kred: number[][] = Array.from({ length: nFree }, () => new Array(nFree).fill(0));
  const Fred: number[] = new Array(nFree).fill(0);

  for (let i = 0; i < nFree; i++) {
    Fred[i] = F[freeIndices[i]];
    for (let j = 0; j < nFree; j++) {
      Kred[i][j] = K[freeIndices[i]][freeIndices[j]];
    }
  }

  const dRed = solveLinearSystem(Kred, Fred);
  const d = new Array(nDOF).fill(0);
  for (let i = 0; i < nFree; i++) {
    d[freeIndices[i]] = dRed[i];
  }

  return buildResults(nodes, elements, d, computeDiagrams);
}

// ======================== POST-PROCESSING ========================

function buildResults(
  nodes: MSNode[],
  elements: MSElement[],
  d: number[],
  computeDiagrams: boolean = false
): MSResult {
  const reactions: number[] = new Array(nodes.length).fill(0);
  const nodeMoments: number[] = new Array(nodes.length).fill(0);
  const elemResults: MSElementResult[] = [];

  for (const elem of elements) {
    const ke = beamStiffnessMatrix(elem.EI, elem.L, elem.hingeI, elem.hingeJ);
    const fef = combinedFixedEndForces(elem);

    const dofs = [
      elem.nodeI * 2,
      elem.nodeI * 2 + 1,
      elem.nodeJ * 2,
      elem.nodeJ * 2 + 1,
    ];

    const de = dofs.map(i => d[i]);
    const fe: number[] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      fe[i] = fef[i];
      for (let j = 0; j < 4; j++) {
        fe[i] += ke[i][j] * de[j];
      }
    }

    const Vleft = fe[0];
    // Display convention: hogging moments at supports are negative
    const Mleft = -fe[1];
    const Vright = -fe[2];
    const Mright = fe[3];

    // ETABS-style: compute moment at multiple stations to find actual max positive (sagging) moment
    // ETABS divides each beam into ~20 output stations
    const nStations = 20;
    let Mmid = 0;
    for (let s = 0; s <= nStations; s++) {
      const x = (s / nStations) * elem.L;
      let M = Mleft + Vleft * x - elem.w * x * x / 2;
      if (elem.pointLoads) {
        for (const pl of elem.pointLoads) {
          if (x > pl.a) M -= pl.P * (x - pl.a);
        }
      }
      // Track max positive (sagging) moment — ETABS sign convention:
      // positive = tension at bottom (sagging), negative = tension at top (hogging)
      if (M > Mmid) Mmid = M;
    }

    reactions[elem.nodeI] += fe[0];
    reactions[elem.nodeJ] += fe[2];
    nodeMoments[elem.nodeI] = Math.max(nodeMoments[elem.nodeI], Math.abs(Mleft));
    nodeMoments[elem.nodeJ] = Math.max(nodeMoments[elem.nodeJ], Math.abs(Mright));

    const result: MSElementResult = {
      elementId: elem.id,
      Mleft,
      Mright,
      Vleft,
      Vright,
      Mmid,
    };

    if (computeDiagrams) {
      result.diagram = generateDiagram(elem, Vleft, Mleft);
    }

    elemResults.push(result);
  }

  return { nodeMoments, elements: elemResults, reactions };
}

// ======================== ENVELOPE ANALYSIS ========================

export function envelopeAnalysis(
  nodes: MSNode[],
  elements: MSElement[],
  loadCases: number[][],
  computeDiagrams: boolean = false
): MSResult {
  const cases: MSResult[] = loadCases.map(loads => {
    const elems = elements.map((e, i) => ({ ...e, w: loads[i] }));
    return analyzeByMatrixStiffness(nodes, elems, computeDiagrams);
  });

  const nNodes = nodes.length;
  const nElems = elements.length;

  const nodeMoments = new Array(nNodes).fill(0);
  const reactions = new Array(nNodes).fill(0);
  const elemResults: MSElementResult[] = [];

  for (let i = 0; i < nNodes; i++) {
    nodeMoments[i] = Math.max(...cases.map(c => Math.abs(c.nodeMoments[i])));
    // Keep max absolute reaction with sign
    const reactionValues = cases.map(c => c.reactions[i]);
    reactions[i] = reactionValues.reduce((best, v) => Math.abs(v) > Math.abs(best) ? v : best, 0);
  }

  for (let i = 0; i < nElems; i++) {
    // For support moments (Mleft, Mright): keep value with max absolute, preserving sign
    const mleftValues = cases.map(c => c.elements[i].Mleft);
    const mrightValues = cases.map(c => c.elements[i].Mright);
    const vleftValues = cases.map(c => c.elements[i].Vleft);
    const vrightValues = cases.map(c => c.elements[i].Vright);

    // ── DIAGRAM ENVELOPE (FIX 2026-04-18) ──────────────────────────
    // Build a true station-by-station envelope across load cases so the
    // summary Mmid stays consistent with the value the 7-station raw
    // exporter reads from the diagram at x=L/2.
    let envelopeDiagram: DiagramPoint[] | undefined;
    if (computeDiagrams) {
      const diagrams = cases
        .map(c => c.elements[i].diagram)
        .filter((d): d is DiagramPoint[] => Array.isArray(d) && d.length > 0);
      if (diagrams.length > 0) {
        const nSt = diagrams[0].length;
        envelopeDiagram = new Array<DiagramPoint>(nSt);
        for (let s = 0; s < nSt; s++) {
          let maxM = -Infinity;
          let bestPt: DiagramPoint = diagrams[0][s];
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

    const result: MSElementResult = {
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
