/**
 * Global Frame Solver Panel
 * 
 * Interactive UI to demonstrate, validate, and inspect the
 * ETABS-like global frame solver.
 *
 * Tabs:
 *   1. Overview      — system summary, node/DOF/matrix info
 *   2. Validation    — run Test 1-4 and show pass/fail
 *   3. Diagnostics   — view/download the full debug_global_system.txt
 *   4. Moment Diagrams — SVG rendering of moment envelopes
 *   5. Beam Groups   — display only groups (no effect on analysis)
 *   6. Connectivity  — live connectivity map
 */

import React, { useMemo, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CheckCircle2, XCircle, AlertTriangle, Download, Play, Info,
  Layers, GitBranch, BarChart2, Network, FileText, ChevronRight,
} from 'lucide-react';

import {
  GlobalNodeRegistry,
  rectangularSection,
  solveGlobalFrame,
  detectBeamGroups,
  generateDiagnosticReport,
  buildConnectivityMap,
  runAllValidationTests,
  sampleMomentDiagram,
  generateFullSolverReport,
  type GFSElement,
  type GFSMaterial,
  type GFSLoad,
  type GFSBeamGroup,
  type GFSValidationTest,
  type GFSSolverResult,
  type GFSNode,
  type ConnectivityMap,
} from '@/lib/globalFrameSolver';

// ─────────────────────────────────────────────────────────────────
// DEMO MODEL BUILDER — Beam-on-Beam showcase
// ─────────────────────────────────────────────────────────────────

const DEFAULT_MAT: GFSMaterial = { E: 25000, G: 10000 };

function buildDemoModel() {
  /**
   * Demo: 3-storey beam grillage
   *
   *   Plan (Z = 0):
   *
   *   N1 ─────── N2 ─────── N3    ← Primary beam (X direction, span = 8m)
   *               |               ← secondary beam B1 meeting at midpoint
   *              N4 ─────── N5    ← secondary beam (Y direction, span = 6m)
   *               |
   *              N6               ← tertiary beam C (Y direction, 4m) — free end
   *
   *   All beams in horizontal plane (Z=0).
   */
  const reg = new GlobalNodeRegistry();

  // Primary beam nodes
  const N1 = reg.getOrCreateNode(0,    0, 0, [true, true, true, true, true, true]);
  const N2 = reg.getOrCreateNode(4000, 0, 0); // midpoint — shared between primary + secondary
  const N3 = reg.getOrCreateNode(8000, 0, 0, [true, true, true, true, true, true]);

  // Secondary beam nodes (perpendicular at N2)
  const N4 = N2; // SAME node — shared!
  const N5 = reg.getOrCreateNode(4000, 6000, 0, [true, true, true, true, true, true]);

  // Tertiary beam (meets secondary beam B1 from the other side at N2)
  const N6 = reg.getOrCreateNode(4000, -4000, 0, [true, true, true, true, true, true]);

  const sec300x600 = rectangularSection(300, 600);
  const sec250x500 = rectangularSection(250, 500);

  const elements: GFSElement[] = [
    // Primary beam segments
    { id: 'A1', nodeI: N1.id, nodeJ: N2.id, section: sec300x600, material: DEFAULT_MAT, stiffnessModifier: 0.35, type: 'beam' },
    { id: 'A2', nodeI: N2.id, nodeJ: N3.id, section: sec300x600, material: DEFAULT_MAT, stiffnessModifier: 0.35, type: 'beam' },
    // Secondary beam
    { id: 'B1', nodeI: N4.id, nodeJ: N5.id, section: sec250x500, material: DEFAULT_MAT, stiffnessModifier: 0.35, type: 'beam' },
    // Tertiary beam
    { id: 'C1', nodeI: N6.id, nodeJ: N2.id, section: sec250x500, material: DEFAULT_MAT, stiffnessModifier: 0.35, type: 'beam' },
  ];

  const load: GFSLoad = {
    // UDL on all beams (gravity, local Z)
    elementLoads: new Map([
      ['A1', { wx: 0, wy: 0, wz: -25 }],
      ['A2', { wx: 0, wy: 0, wz: -25 }],
      ['B1', { wx: 0, wy: 0, wz: -30 }],
      ['C1', { wx: 0, wy: 0, wz: -20 }],
    ]),
  };

  return { reg, elements, load };
}

// ─────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────

const PassBadge: React.FC<{ passed: boolean }> = ({ passed }) =>
  passed
    ? <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 gap-1"><CheckCircle2 size={12} />PASS</Badge>
    : <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1"><XCircle size={12} />FAIL</Badge>;

const SectionTitle: React.FC<{ children: React.ReactNode; icon?: React.ReactNode }> = ({ children, icon }) => (
  <div className="flex items-center gap-2 mb-3">
    {icon && <span className="text-accent">{icon}</span>}
    <h3 className="font-semibold text-sm text-foreground">{children}</h3>
  </div>
);

// ─────────────────────────────────────────────────────────────────
// MOMENT DIAGRAM SVG
// ─────────────────────────────────────────────────────────────────

interface MomentDiagramProps {
  label: string;
  moments: { t: number; Mz_kNm: number }[];
  color?: string;
  positiveDown?: boolean;
}

const MomentDiagramSVG: React.FC<MomentDiagramProps> = ({
  label, moments, color = '#6366f1', positiveDown = true,
}) => {
  const W = 320, H = 90, pad = 28;
  const vals = moments.map(m => m.Mz_kNm);
  const maxAbs = Math.max(...vals.map(Math.abs), 0.001);
  const scaleY = (H - pad * 2) / 2 / maxAbs;
  const midY = H / 2;

  const pts = moments.map(({ t, Mz_kNm }) => {
    const x = pad + t * (W - pad * 2);
    const sign = positiveDown ? 1 : -1;
    const y = midY + sign * Mz_kNm * scaleY;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = `${pad},${midY} ${pts.join(' ')} ${(W - pad)},${midY}`;

  const maxM = Math.max(...vals);
  const minM = Math.min(...vals);

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center px-1">
        <span className="text-[10px] text-muted-foreground font-mono">{label}</span>
        <div className="flex gap-2 text-[10px] font-mono">
          <span className="text-red-400">max: {maxM.toFixed(1)} kN·m</span>
          <span className="text-blue-400">min: {minM.toFixed(1)} kN·m</span>
        </div>
      </div>
      <svg width={W} height={H} className="rounded border border-border/30 bg-background/40">
        {/* baseline */}
        <line x1={pad} y1={midY} x2={W - pad} y2={midY} stroke="#444" strokeWidth={1} />
        {/* fill */}
        <polygon points={polyline} fill={color} fillOpacity={0.18} />
        {/* outline */}
        <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} />
        {/* zero labels */}
        <text x={pad - 4} y={midY + 3} textAnchor="end" fontSize={8} fill="#666">0</text>
        <text x={pad - 4} y={pad + 3} textAnchor="end" fontSize={8} fill="#666">{(maxAbs).toFixed(0)}</text>
        <text x={pad - 4} y={H - pad + 3} textAnchor="end" fontSize={8} fill="#666">-{(maxAbs).toFixed(0)}</text>
      </svg>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// CONNECTIVITY MAP SVG
// ─────────────────────────────────────────────────────────────────

const ConnectivityMapSVG: React.FC<{ map: ConnectivityMap }> = ({ map }) => {
  const W = 380, H = 280, pad = 30;

  // Compute scale
  const xs = map.nodes.map(n => n.x), ys = map.nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 1), rangeY = Math.max(maxY - minY, 1);
  const scaleX = (W - pad * 2) / rangeX;
  const scaleY = (H - pad * 2) / rangeY;
  const scale = Math.min(scaleX, scaleY);

  const offX = pad + ((W - pad * 2) - rangeX * scale) / 2;
  const offY = pad + ((H - pad * 2) - rangeY * scale) / 2;

  const toScreen = (x: number, y: number) => [
    offX + (x - minX) * scale,
    H - offY - (y - minY) * scale,
  ];

  const nodePos = new Map(map.nodes.map(n => {
    const [sx, sy] = toScreen(n.x, n.y);
    return [n.id, { sx, sy, ...n }];
  }));

  return (
    <svg width={W} height={H} className="rounded border border-border/30 bg-background/40">
      {/* Elements */}
      {map.elements.map(e => {
        const nI = nodePos.get(e.nodeI), nJ = nodePos.get(e.nodeJ);
        if (!nI || !nJ) return null;
        const color = e.type === 'column' ? '#f97316' : '#6366f1';
        return (
          <g key={e.id}>
            <line x1={nI.sx} y1={nI.sy} x2={nJ.sx} y2={nJ.sy}
              stroke={color} strokeWidth={2.5} strokeLinecap="round" />
            <text
              x={(nI.sx + nJ.sx) / 2 + 4}
              y={(nI.sy + nJ.sy) / 2 - 4}
              fontSize={8} fill={color} fontFamily="monospace">
              {e.id}
            </text>
          </g>
        );
      })}
      {/* Nodes */}
      {Array.from(nodePos.values()).map(n => (
        <g key={n.id}>
          <circle cx={n.sx} cy={n.sy} r={n.degree > 1 ? 6 : 4}
            fill={n.degree > 1 ? '#f59e0b' : '#22c55e'} stroke="#1a1a1a" strokeWidth={1} />
          <text x={n.sx + 8} y={n.sy - 4} fontSize={8} fill="#aaa" fontFamily="monospace">
            {n.id}
          </text>
          <text x={n.sx + 8} y={n.sy + 6} fontSize={7} fill="#555" fontFamily="monospace">
            [{n.dofStart}–{n.dofStart + 5}]
          </text>
        </g>
      ))}
      {/* Legend */}
      <g transform={`translate(${W - 100}, 10)`}>
        <circle cx={5} cy={5} r={4} fill="#f59e0b" />
        <text x={12} y={9} fontSize={8} fill="#aaa">Shared node (≥2 elems)</text>
        <circle cx={5} cy={18} r={3} fill="#22c55e" />
        <text x={12} y={22} fontSize={8} fill="#aaa">End node</text>
        <line x1={0} y1={33} x2={10} y2={33} stroke="#6366f1" strokeWidth={2} />
        <text x={12} y={36} fontSize={8} fill="#aaa">Beam</text>
        <line x1={0} y1={45} x2={10} y2={45} stroke="#f97316" strokeWidth={2} />
        <text x={12} y={48} fontSize={8} fill="#aaa">Column</text>
      </g>
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────
// MAIN PANEL
// ─────────────────────────────────────────────────────────────────

const GlobalFrameSolverPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [isRunning, setIsRunning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Build demo model once
  const { reg, elements, load } = useMemo(() => buildDemoModel(), []);
  const nodes = reg.getAllNodes();

  // Solve with debug mode
  const result = useMemo(() => {
    return solveGlobalFrame(nodes, elements, load, true);
  }, [nodes, elements, load]);

  // Beam groups
  const beamGroups = useMemo(() => detectBeamGroups(elements, nodes), [elements, nodes]);

  // Connectivity map
  const connectivity = useMemo(() => buildConnectivityMap(nodes, elements), [nodes, elements]);

  // Diagnostic report
  const diagReport = useMemo(() => {
    return generateDiagnosticReport(nodes, elements, result, beamGroups);
  }, [nodes, elements, result, beamGroups]);

  // Validation tests
  const [testResults, setTestResults] = useState<GFSValidationTest[] | null>(null);

  const runTests = useCallback(() => {
    setIsRunning(true);
    setTimeout(() => {
      setTestResults(runAllValidationTests());
      setIsRunning(false);
    }, 50);
  }, []);

  // Moment diagram samples
  const momentData = useMemo(() => {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    return result.elementResults.map(er => {
      const elem = elements.find(e => e.id === er.elementId);
      if (!elem) return null;
      const nI = nodeMap.get(elem.nodeI)!, nJ = nodeMap.get(elem.nodeJ)!;
      const dx = nJ.x - nI.x, dy = nJ.y - nI.y, dz = nJ.z - nI.z;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const wGlobal = load.elementLoads?.get(elem.id) ?? { wx: 0, wy: 0, wz: 0 };
      // For horizontal beam: wy_local ≈ -wz_global (simplified — correct for X-direction beams)
      const wyLocal = -wGlobal.wz; // N/mm  (gravity = positive local transverse)
      const samples = sampleMomentDiagram(er, L, wyLocal);
      return { id: er.elementId, L, samples, er };
    }).filter(Boolean) as {
      id: string; L: number;
      samples: { t: number; Mz_kNm: number }[];
      er: typeof result.elementResults[0];
    }[];
  }, [result, elements, nodes, load]);

  // Download diagnostic report
  const downloadReport = useCallback(() => {
    const blob = new Blob([diagReport.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'debug_global_system.txt';
    a.click(); URL.revokeObjectURL(url);
  }, [diagReport]);

  // Export full report — runs ALL validation tests then assembles 12-section report
  const exportFullReport = useCallback(() => {
    setIsExporting(true);
    setTimeout(() => {
      try {
        // Always run fresh validation for the report
        const freshTests = runAllValidationTests();
        const reportText = generateFullSolverReport({
          nodes,
          elements,
          load,
          result,
          beamGroups,
          validationTests: freshTests,
          diagReport,
          solverVersion: '1.0.0',
        });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const blob = new Blob([reportText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `solver_full_report_${timestamp}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        // Also update testResults state so Validation tab reflects fresh run
        setTestResults(freshTests);
      } finally {
        setIsExporting(false);
      }
    }, 80);
  }, [nodes, elements, load, result, beamGroups, diagReport]);

  const passedAll = testResults?.every(t => t.passed) ?? false;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2 border-b border-border/50">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">3D Global Frame Solver</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              ETABS-like Direct Stiffness Method — K·U = F (one global system)
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant="outline" className="text-xs gap-1 hidden sm:flex">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              {nodes.length} nodes
            </Badge>
            <Badge variant="outline" className="text-xs hidden sm:flex">{result.totalDOF} DOFs</Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
              onClick={exportFullReport}
              disabled={isExporting}
            >
              <Download size={12} />
              {isExporting ? 'Generating…' : 'Export Full Report'}
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="flex-shrink-0 mx-4 mt-2 h-9 gap-0.5">
          <TabsTrigger value="overview" className="text-xs gap-1"><Info size={11} />Overview</TabsTrigger>
          <TabsTrigger value="tests" className="text-xs gap-1"><Play size={11} />Validation</TabsTrigger>
          <TabsTrigger value="moments" className="text-xs gap-1"><BarChart2 size={11} />Moments</TabsTrigger>
          <TabsTrigger value="groups" className="text-xs gap-1"><Layers size={11} />Groups</TabsTrigger>
          <TabsTrigger value="connectivity" className="text-xs gap-1"><Network size={11} />Connectivity</TabsTrigger>
          <TabsTrigger value="diagnostic" className="text-xs gap-1"><FileText size={11} />Diagnostic</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW ── */}
        <TabsContent value="overview" className="flex-1 overflow-y-auto px-4 pb-4 mt-2">
          <div className="space-y-4">
            {/* ETABS principle callout */}
            <Card className="border-accent/30 bg-accent/5">
              <CardContent className="pt-4 pb-3">
                <SectionTitle icon={<ChevronRight size={14} />}>ETABS Global System Principle</SectionTitle>
                <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground">
                  {[
                    ['K_global × U = F_global', 'One matrix, one solve — NO sequential beam analysis'],
                    ['Shared nodes', 'Two beams at same point share identical DOF indices'],
                    ['No load transfer code', 'Beam-on-beam load path emerges from stiffness interaction'],
                    ['Releases via condensation', 'Static condensation K* = K_rr − K_rc·K_cc⁻¹·K_cr'],
                    ['Beam groups: display only', 'Groups have ZERO effect on stiffness or analysis'],
                  ].map(([key, val]) => (
                    <div key={key} className="flex gap-2">
                      <span className="font-mono text-accent flex-shrink-0">{key}</span>
                      <span className="text-muted-foreground">{val}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Model summary */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Demo Model — Beam-on-Beam Grillage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Nodes', value: nodes.length },
                    { label: 'Elements', value: elements.length },
                    { label: 'Total DOF', value: result.totalDOF },
                    { label: 'Free DOF', value: result.freeDOF },
                    { label: 'Fixed DOF', value: result.fixedDOF },
                    { label: 'Matrix size', value: `${result.matrixSize}×${result.matrixSize}` },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded bg-muted/30 p-2 text-center">
                      <div className="text-lg font-bold font-mono text-accent">{value}</div>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>

                <div className="text-xs text-muted-foreground">Solve time: <span className="font-mono text-foreground">{result.solveTimeMs.toFixed(2)} ms</span></div>

                {/* Node DOF table */}
                <div>
                  <div className="text-xs font-semibold mb-1 text-foreground">Node DOF Registry</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border/30">
                          <th className="text-left pb-1">Node</th>
                          <th className="text-left pb-1">X (mm)</th>
                          <th className="text-left pb-1">Y (mm)</th>
                          <th className="text-left pb-1">Z (mm)</th>
                          <th className="text-left pb-1">DOF start</th>
                          <th className="text-left pb-1">DOF range</th>
                          <th className="text-left pb-1">Support</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nodes.map(n => (
                          <tr key={n.id} className="border-b border-border/10">
                            <td className="py-0.5 text-accent">{n.id}</td>
                            <td>{n.x}</td>
                            <td>{n.y}</td>
                            <td>{n.z}</td>
                            <td>{n.dofStart}</td>
                            <td>[{n.dofStart}–{n.dofStart + 5}]</td>
                            <td>{n.restraints.some(r => r) ? <Badge className="text-[9px] h-4 bg-orange-500/20 text-orange-400 border-orange-400/30">Fixed</Badge> : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Element table */}
                <div>
                  <div className="text-xs font-semibold mb-1 text-foreground">Element Registry</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border/30">
                          <th className="text-left pb-1">Elem</th>
                          <th className="text-left pb-1">Node I</th>
                          <th className="text-left pb-1">Node J</th>
                          <th className="text-left pb-1">Type</th>
                          <th className="text-left pb-1">b×h (mm)</th>
                          <th className="text-left pb-1">Modifier</th>
                          <th className="text-left pb-1">w (kN/m)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {elements.map(e => {
                          const w = load.elementLoads?.get(e.id);
                          return (
                            <tr key={e.id} className="border-b border-border/10">
                              <td className="py-0.5 text-accent">{e.id}</td>
                              <td>{e.nodeI}</td>
                              <td>{e.nodeJ}</td>
                              <td>{e.type}</td>
                              <td>{e.section.b}×{e.section.h}</td>
                              <td>{e.stiffnessModifier}</td>
                              <td>{w ? Math.abs(w.wz).toFixed(0) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Results summary */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Element Results Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border/30">
                        <th className="text-left pb-1">Elem</th>
                        <th className="text-right pb-1">Axial (kN)</th>
                        <th className="text-right pb-1">Shear Y (kN)</th>
                        <th className="text-right pb-1">Mz_I (kN·m)</th>
                        <th className="text-right pb-1">Mz_J (kN·m)</th>
                        <th className="text-right pb-1">Mz_mid (kN·m)</th>
                        <th className="text-right pb-1">Torsion (kN·m)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.elementResults.map(r => (
                        <tr key={r.elementId} className="border-b border-border/10">
                          <td className="py-0.5 text-accent">{r.elementId}</td>
                          <td className="text-right">{r.axial.toFixed(2)}</td>
                          <td className="text-right">{r.shearY.toFixed(2)}</td>
                          <td className="text-right text-blue-400">{r.momentZI.toFixed(2)}</td>
                          <td className="text-right text-blue-400">{r.momentZJ.toFixed(2)}</td>
                          <td className="text-right text-red-400">{r.momentZmid.toFixed(2)}</td>
                          <td className="text-right">{r.torsion.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Reactions */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm">Support Reactions</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border/30">
                      <th className="text-left pb-1">Node</th>
                      <th className="text-right pb-1">Fx (kN)</th>
                      <th className="text-right pb-1">Fy (kN)</th>
                      <th className="text-right pb-1">Fz (kN)</th>
                      <th className="text-right pb-1">Mx (kN·m)</th>
                      <th className="text-right pb-1">My (kN·m)</th>
                      <th className="text-right pb-1">Mz (kN·m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(result.reactions.entries()).map(([nodeId, r]) => (
                      <tr key={nodeId} className="border-b border-border/10">
                        <td className="py-0.5 text-accent">{nodeId}</td>
                        {r.map((v, i) => <td key={i} className={`text-right ${Math.abs(v) > 0.01 ? 'text-foreground' : 'text-muted-foreground/40'}`}>{v.toFixed(2)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 text-[10px] text-muted-foreground">
                  ΣFz = {Array.from(result.reactions.values()).reduce((s, r) => s + r[2], 0).toFixed(2)} kN
                  (should equal total applied load)
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── VALIDATION ── */}
        <TabsContent value="tests" className="flex-1 overflow-y-auto px-4 pb-4 mt-2">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Validation Test Suite</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Four tests verify correctness against classical solutions.
                </p>
              </div>
              <Button onClick={runTests} disabled={isRunning} size="sm" className="gap-1">
                <Play size={12} />
                {isRunning ? 'Running…' : 'Run All Tests'}
              </Button>
            </div>

            {testResults && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-border/50 bg-muted/20">
                {passedAll
                  ? <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
                  : <XCircle size={18} className="text-red-400 flex-shrink-0" />
                }
                <div>
                  <div className="text-sm font-semibold">
                    {testResults.filter(t => t.passed).length} / {testResults.length} tests passed
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {passedAll ? 'All validation tests passed — solver is correct.' : 'Some tests failed — check details below.'}
                  </div>
                </div>
              </div>
            )}

            {/* Test descriptions even before running */}
            {[
              {
                n: 1, name: 'Fixed-Fixed Beam UDL',
                desc: 'Single span under UDL. Verifies M_support = wL²/12, M_mid = wL²/24.',
                rule: 'Basic assembly, BC application, and moment recovery.',
              },
              {
                n: 2, name: 'Secondary Beam-on-Primary Beam',
                desc: 'UDL on secondary beam loads primary via shared node — NO explicit load transfer.',
                rule: 'Shared node → shared DOFs → automatic load path.',
              },
              {
                n: 3, name: 'Multi-Level Chain (C → B → A)',
                desc: 'Three-level beam interaction. Load at level C propagates to A in ONE solve.',
                rule: 'No iteration, no manual load propagation.',
              },
              {
                n: 4, name: 'Symmetry Check',
                desc: 'Two equal spans with equal UDL must produce equal moments and reactions.',
                rule: 'Symmetric model → symmetric results.',
              },
            ].map(test => {
              const tr = testResults?.find((_, i) => i === test.n - 1);
              return (
                <Card key={test.n} className={tr ? (tr.passed ? 'border-emerald-500/30' : 'border-red-500/30') : ''}>
                  <CardContent className="pt-4 pb-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">Test {test.n}</Badge>
                        <span className="text-sm font-semibold">{tr?.name ?? test.name}</span>
                      </div>
                      {tr ? <PassBadge passed={tr.passed} /> : <Badge variant="outline" className="text-[10px] text-muted-foreground">Not run</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{tr?.description ?? test.desc}</p>
                    <p className="text-[10px] text-accent italic">{test.rule}</p>

                    {tr && (
                      <div className="space-y-1 pt-1 border-t border-border/30">
                        {tr.details.map((d, i) => (
                          <div key={i} className={`text-[10px] font-mono ${d.startsWith('✓') ? 'text-emerald-400' : d.startsWith('❌') ? 'text-red-400' : 'text-muted-foreground'}`}>
                            {d}
                          </div>
                        ))}
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <div>
                            <div className="text-[9px] text-muted-foreground mb-1">Expected</div>
                            {Object.entries(tr.expected).map(([k, v]) => (
                              <div key={k} className="text-[10px] font-mono text-muted-foreground">{k}: {typeof v === 'number' ? v.toFixed(3) : v}</div>
                            ))}
                          </div>
                          <div>
                            <div className="text-[9px] text-muted-foreground mb-1">Actual</div>
                            {Object.entries(tr.actual).map(([k, v]) => (
                              <div key={k} className={`text-[10px] font-mono ${tr.passed ? 'text-emerald-400' : 'text-red-400'}`}>{k}: {typeof v === 'number' ? v.toFixed(3) : v}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ── MOMENT DIAGRAMS ── */}
        <TabsContent value="moments" className="flex-1 overflow-y-auto px-4 pb-4 mt-2">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Moment Diagrams (Mz)</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                ETABS sign convention: positive = sagging (tension at bottom). Sampled at 21 stations.
              </p>
            </div>
            {momentData.map(d => {
              const colors = { A1: '#6366f1', A2: '#8b5cf6', B1: '#06b6d4', C1: '#f59e0b' };
              const color = (colors as Record<string, string>)[d.id] ?? '#6366f1';
              return (
                <Card key={d.id}>
                  <CardContent className="pt-4 pb-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">{d.id}</Badge>
                        <span className="text-xs text-muted-foreground">L = {(d.L / 1000).toFixed(2)} m</span>
                      </div>
                      <div className="flex gap-3 text-[10px] font-mono">
                        <span className="text-blue-400">Mz_I = {d.er.momentZI.toFixed(2)} kN·m</span>
                        <span className="text-blue-400">Mz_J = {d.er.momentZJ.toFixed(2)} kN·m</span>
                        <span className="text-red-400">Mz_mid = {d.er.momentZmid.toFixed(2)} kN·m</span>
                      </div>
                    </div>
                    <MomentDiagramSVG
                      label={`Element ${d.id} — Mz (kN·m)`}
                      moments={d.samples}
                      color={color}
                    />
                    <div className="text-[10px] text-muted-foreground">
                      Shear Y: {d.er.shearY.toFixed(2)} kN &nbsp;|&nbsp;
                      Torsion: {d.er.torsion.toFixed(3)} kN·m &nbsp;|&nbsp;
                      Axial: {d.er.axial.toFixed(2)} kN
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ── BEAM GROUPS ── */}
        <TabsContent value="groups" className="flex-1 overflow-y-auto px-4 pb-4 mt-2">
          <div className="space-y-4">
            <Card className="border-yellow-500/30 bg-yellow-500/5">
              <CardContent className="pt-4 pb-3">
                <div className="flex gap-2">
                  <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold text-yellow-400">Design-only feature.</span>{' '}
                    Beam groups have ZERO effect on the stiffness matrix, load distribution, or analysis results.
                    They are used purely for continuous moment diagram display and span-level design checks.
                  </div>
                </div>
              </CardContent>
            </Card>

            <div>
              <h3 className="text-sm font-semibold">Detected Beam Groups</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Auto-detected: collinear, connected end-to-end elements with degree-2 intermediate nodes.
              </p>
            </div>

            {beamGroups.length === 0 ? (
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-sm text-muted-foreground text-center">
                    No multi-segment beam groups detected in the demo model.
                  </p>
                  <p className="text-xs text-muted-foreground text-center mt-1">
                    Groups form when ≥2 collinear elements meet end-to-end at a degree-2 node.
                    In this model, the primary beam (A1+A2) qualifies.
                  </p>
                </CardContent>
              </Card>
            ) : (
              beamGroups.map(g => (
                <Card key={g.groupId}>
                  <CardContent className="pt-4 pb-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge className="text-[10px] bg-cyan-500/20 text-cyan-400 border-cyan-400/30">{g.groupId}</Badge>
                        <span className="text-sm font-semibold">Continuous beam</span>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">
                        L = {(g.totalLength / 1000).toFixed(2)} m
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Segments: {g.elementIds.join(' → ')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Direction: [{g.direction.map(v => v.toFixed(2)).join(', ')}]
                    </div>
                    <div className="flex gap-2 text-[10px]">
                      <Badge variant="outline" className="text-[9px]">{g.elementIds.length} segments</Badge>
                      <Badge variant="outline" className="text-[9px]">Display only</Badge>
                      <Badge variant="outline" className="text-[9px] text-muted-foreground/50">No stiffness effect</Badge>
                    </div>
                    {/* Grouped moment envelope */}
                    <div className="pt-1 border-t border-border/20">
                      <div className="text-[10px] text-muted-foreground mb-1">Grouped moment envelope (continuous diagram)</div>
                      <div className="flex gap-0.5">
                        {g.elementIds.map(id => {
                          const d = momentData.find(m => m.id === id);
                          if (!d) return null;
                          const widthFraction = d.L / g.totalLength;
                          return (
                            <div key={id} style={{ flex: widthFraction }} className="min-w-0">
                              <MomentDiagramSVG
                                label={id}
                                moments={d.samples}
                                color="#06b6d4"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}

            {/* Single-element beams */}
            <div>
              <div className="text-xs font-semibold mb-2 text-muted-foreground">Single-Element Beams (no grouping needed)</div>
              <div className="space-y-1">
                {elements.filter(e => e.type === 'beam' && !beamGroups.some(g => g.elementIds.includes(e.id))).map(e => (
                  <div key={e.id} className="flex items-center justify-between text-xs px-3 py-1.5 rounded bg-muted/20 border border-border/20">
                    <span className="font-mono text-accent">{e.id}</span>
                    <span className="text-muted-foreground">standalone segment</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── CONNECTIVITY ── */}
        <TabsContent value="connectivity" className="flex-1 overflow-y-auto px-4 pb-4 mt-2">
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Connectivity Map</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Yellow = shared node (≥2 elements, same DOFs). Green = end node. DOF ranges shown.
              </p>
            </div>
            <ConnectivityMapSVG map={connectivity} />

            {/* Connectivity table */}
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-xs font-semibold mb-2">Node Connectivity Detail</div>
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border/30">
                      <th className="text-left pb-1">Node</th>
                      <th className="text-left pb-1">Coords (mm)</th>
                      <th className="text-left pb-1">DOF range</th>
                      <th className="text-left pb-1">Degree</th>
                      <th className="text-left pb-1">Connected elems</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connectivity.nodes.map(n => {
                      const conns = connectivity.elements.filter(e => e.nodeI === n.id || e.nodeJ === n.id);
                      return (
                        <tr key={n.id} className="border-b border-border/10">
                          <td className={`py-0.5 ${n.degree > 1 ? 'text-yellow-400' : 'text-emerald-400'}`}>{n.id}</td>
                          <td>({n.x.toFixed(0)}, {n.y.toFixed(0)}, {n.z.toFixed(0)})</td>
                          <td>[{n.dofStart}–{n.dofStart + 5}]</td>
                          <td>{n.degree}</td>
                          <td>{conns.map(e => e.id).join(', ')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* ETABS CRITICAL RULE callout */}
            <Card className="border-accent/30 bg-accent/5">
              <CardContent className="pt-3 pb-3 text-xs">
                <div className="font-semibold text-accent mb-1">CRITICAL RULE — Shared Nodes</div>
                <div className="text-muted-foreground space-y-1">
                  <p>Elements A1 and A2 share node N2 with elements B1 and C1.</p>
                  <p>They all reference the <span className="font-mono text-foreground">SAME dofStart</span> → stiffness contributions accumulate at identical global DOF positions.</p>
                  <p>Without shared nodes, each beam would have independent DOFs and would NOT interact — producing physically wrong results.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── DIAGNOSTIC ── */}
        <TabsContent value="diagnostic" className="flex-1 flex flex-col overflow-hidden px-4 pb-4 mt-2">
          <div className="space-y-3 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Diagnostic Report</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Verifies node sharing, DOF consistency, assembly completeness, and moment equilibrium.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={downloadReport} className="gap-1">
                <Download size={12} />
                debug_global_system.txt
              </Button>
            </div>

            <div className="flex items-center gap-3">
              {diagReport.passed
                ? <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold"><CheckCircle2 size={14} />All checks passed</div>
                : <div className="flex items-center gap-2 text-red-400 text-xs font-semibold"><XCircle size={14} />{diagReport.errors.length} error(s) found</div>
              }
              {diagReport.warnings.length > 0 && (
                <div className="flex items-center gap-1 text-yellow-400 text-xs">
                  <AlertTriangle size={12} />{diagReport.warnings.length} warning(s)
                </div>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1 mt-3 rounded border border-border/30">
            <pre className="p-3 text-[10px] font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {diagReport.text}
            </pre>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default GlobalFrameSolverPanel;
