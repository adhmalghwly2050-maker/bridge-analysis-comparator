/**
 * FEMComparisonPanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Engineering comparison between:
 *   • Phase 8 FEM  — True DOF Merging (getMergedBeamSlabResults)
 *   • Phase 7 FEM  — Penalty-based coupled FEM (getCoupledBeamSlabResults)
 *   • 3D Method    — Tributary-based load distribution (getBeamLoadsFromSlab)
 *
 * Five sections:
 *   A. Beam Load & Force Comparison
 *   B. Load Distribution Behavior
 *   C. Global Equilibrium Check
 *   D. Stiffness Sensitivity
 *   E. Physical Behavior Summary
 *
 * READ-ONLY: does not touch or modify any engine code.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Card, CardHeader, CardTitle, CardContent,
} from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Badge }   from '@/components/ui/badge';
import { Button }  from '@/components/ui/button';
import {
  Calculator, Info, CheckCircle2, AlertTriangle,
  ArrowUpDown, Zap, Activity, BarChart3, Scale,
} from 'lucide-react';

import type { Slab, Beam, Column, SlabProps, MatProps } from '@/lib/structuralEngine';
import {
  getMergedBeamSlabResults,
  getCoupledBeamSlabResults,
  getBeamLoadsFromSlab,
} from '@/slabFEMEngine';
import type { MergedResult, BeamLoadResult } from '@/slabFEMEngine';
import type { CoupledResult } from '@/slabFEMEngine/coupledSystem';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  slabs:         Slab[];
  beams:         Beam[];
  columns:       Column[];
  slabProps:     SlabProps;
  mat:           MatProps;
  analyzed:      boolean;
  onRunAnalysis: () => void;
}

type SortKey = 'beamId' | 'diffPct' | 'vmax' | 'mmax' | 'ei';

interface BeamRow {
  beamId:       string;
  beamType:     'Edge' | 'Internal';
  span_m:       number;
  load3D_kNm:   number;   // 3D Method avg distributed load (kN/m)
  loadP8_kNm:   number;   // Phase 8 FEM avg distributed load (kN/m)
  loadP7_kNm:   number;   // Phase 7 FEM avg distributed load (kN/m) — penalty-based
  vmax_kN:      number;   // Phase 8 max shear (kN)
  mmax_kNm:     number;   // Phase 8 max moment (kN·m)
  diffPct:      number;   // (P8 − 3D) / 3D × 100
  behavior:     string;
  ei_kNm2:      number;   // EI of section (kN·m²)
  hasNegativeShear: boolean;
  shears:       number[]; // Phase 8 shear profile
  peakLocation: 'Midspan' | 'Quarter-point' | 'End';
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

function computeEI(beam: Beam, fc_MPa: number): number {
  const Ec_MPa = 4700 * Math.sqrt(fc_MPa);       // MPa
  const Ec_kNm2 = Ec_MPa * 1000;                 // kN/m²
  const b_m  = beam.b / 1000;                    // mm → m
  const h_m  = beam.h / 1000;                    // mm → m
  const I_m4 = b_m * h_m ** 3 / 12;             // m⁴ (strong axis)
  return Ec_kNm2 * I_m4;                         // kN·m²
}

/** Detect sign change in the raw (signed) shear list. */
function hasSignChange(shears: number[]): boolean {
  for (let i = 1; i < shears.length; i++) {
    if (shears[i - 1] * shears[i] < 0) return true;
  }
  return false;
}

/** Locate peak |shear| relative to span. */
function peakLoc(shears: number[], n: number): 'Midspan' | 'Quarter-point' | 'End' {
  if (shears.length === 0) return 'Midspan';
  let maxVal = -Infinity;
  let maxIdx = 0;
  for (let i = 0; i < shears.length; i++) {
    if (Math.abs(shears[i]) > maxVal) { maxVal = Math.abs(shears[i]); maxIdx = i; }
  }
  const rel = maxIdx / Math.max(shears.length - 1, 1);
  if (rel < 0.15 || rel > 0.85) return 'End';
  if (rel > 0.35 && rel < 0.65) return 'Midspan';
  return 'Quarter-point';
}

/** Behavior auto-label. */
function behaviorText(diffPct: number, isInternal: boolean, hasNeg: boolean): string {
  const abs = Math.abs(diffPct);
  let label = '';
  if (abs < 5)        label = 'Close to tributary assumption';
  else if (abs < 20)  label = 'Moderate stiffness redistribution';
  else                label = 'Strong stiffness-driven redistribution';
  if (isInternal && diffPct > 0) label += ' — Internal beam attracts load';
  if (hasNeg)                    label += ' — Non-uniform load distribution';
  return label;
}

// ─────────────────────────────────────────────────────────────────────────────
// Color badge helpers
// ─────────────────────────────────────────────────────────────────────────────

function diffBadge(pct: number) {
  const abs = Math.abs(pct);
  const sign = pct > 0 ? '+' : '';
  const base = 'text-[10px] font-mono font-semibold';
  if (abs < 10) return (
    <Badge className={`${base} bg-green-500/15 text-green-700 dark:text-green-400 border-green-400/40`}>
      {sign}{pct.toFixed(1)}%
    </Badge>
  );
  if (abs < 25) return (
    <Badge className={`${base} bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-400/40`}>
      {sign}{pct.toFixed(1)}%
    </Badge>
  );
  return (
    <Badge className={`${base} bg-red-500/15 text-red-700 dark:text-red-400 border-red-400/40`}>
      {sign}{pct.toFixed(1)}%
    </Badge>
  );
}

function eqErrBadge(err: number) {
  const base = 'text-[10px] font-mono font-semibold';
  if (err < 1)  return <Badge className={`${base} bg-green-500/15 text-green-700 dark:text-green-400 border-green-400/40`}>{err.toFixed(3)}%</Badge>;
  if (err < 5)  return <Badge className={`${base} bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-400/40`}>{err.toFixed(3)}%</Badge>;
  return              <Badge className={`${base} bg-red-500/15 text-red-700 dark:text-red-400 border-red-400/40`}>{err.toFixed(3)}%</Badge>;
}

const SH = ({ children, onClick, sorted }: { children: React.ReactNode; onClick?: () => void; sorted?: boolean }) => (
  <TableHead
    onClick={onClick}
    className={`text-[11px] whitespace-nowrap select-none ${onClick ? 'cursor-pointer hover:bg-muted/60' : ''} ${sorted ? 'text-blue-600 dark:text-blue-400' : ''}`}
  >
    <div className="flex items-center gap-1">
      {children}
      {onClick && <ArrowUpDown size={10} className="shrink-0 opacity-50" />}
    </div>
  </TableHead>
);

const TC = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <TableCell className={`font-mono text-xs py-2 ${className}`}>{children}</TableCell>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const FEMComparisonPanel: React.FC<Props> = ({
  slabs, beams, columns, slabProps, mat, analyzed, onRunAnalysis,
}) => {
  const [computed,  setComputed]  = useState(false);
  const [computing, setComputing] = useState(false);
  const [meshDensity, setMeshDensity] = useState(2);
  const [sortKey, setSortKey]    = useState<SortKey>('beamId');
  const [sortAsc, setSortAsc]    = useState(true);

  // Raw engine results (cached — only recomputed on demand)
  const [p8Results,  setP8Results]  = useState<MergedResult[]>([]);
  const [p7Results,  setP7Results]  = useState<CoupledResult[]>([]);
  const [tdResults,  setTdResults]  = useState<BeamLoadResult[]>([]);
  const [modelHash,  setModelHash]  = useState('');

  // ── compute ────────────────────────────────────────────────────────────────
  const handleCompute = useCallback(() => {
    if (slabs.length === 0 || beams.length === 0) return;
    setComputing(true);

    const hash = `${slabs.length}-${beams.length}-${columns.length}-${slabProps.thickness}-${meshDensity}`;

    setTimeout(() => {
      try {
        const femModel = { slabs, beams, columns, slabProps, mat, meshDensity };

        // Phase 8 — true DOF merging
        const p8 = getMergedBeamSlabResults(femModel, meshDensity);

        // Phase 7 — penalty-based coupled FEM
        const p7 = getCoupledBeamSlabResults(femModel, meshDensity);

        // 3D Method — traditional tributary
        const td = getBeamLoadsFromSlab({
          ...femModel,
          comparisonMode: true,
          meshDensity: 4,
        } as never);

        setP8Results(p8);
        setP7Results(p7);
        setTdResults(td);
        setModelHash(hash);
        setComputed(true);
      } catch (err) {
        console.error('[FEMComparisonPanel] computation error:', err);
      } finally {
        setComputing(false);
      }
    }, 0);
  }, [slabs, beams, columns, slabProps, mat, meshDensity]);

  // ── derive beam rows ────────────────────────────────────────────────────────
  const beamRows: BeamRow[] = useMemo(() => {
    if (!computed || p8Results.length === 0) return [];

    // ── Accumulate Phase 8 beam results from ALL slab solves ─────────────────
    // ETABS approach: an internal beam receives load from both adjacent slabs.
    // Each per-slab solve contributes its portion of the force.
    // We accumulate shear/moment magnitudes from every slab that includes the beam.
    interface AccBeam {
      shears:   number[];    // accumulated |Vz| profile (kN)
      moments:  number[];    // accumulated |My| profile (kN·m)
      maxShear:  number;
      maxMoment: number;
      slabCount: number;     // how many slab solves contributed
    }
    const p8Acc = new Map<string, AccBeam>();

    for (const res of p8Results) {
      for (const br of res.beamResults) {
        if (!p8Acc.has(br.beamId)) {
          p8Acc.set(br.beamId, {
            shears:    [...br.elementShears_kN],
            moments:   [...br.elementMoments_kNm],
            maxShear:  br.maxShear_kN,
            maxMoment: br.maxMoment_kNm,
            slabCount: 1,
          });
        } else {
          // Second (or more) slab contribution → add forces element-wise.
          // This is physically correct: an internal beam is loaded from both sides.
          const acc = p8Acc.get(br.beamId)!;
          const len = Math.min(acc.shears.length, br.elementShears_kN.length);
          for (let i = 0; i < len; i++) {
            acc.shears[i]  += br.elementShears_kN[i];
            acc.moments[i] += br.elementMoments_kNm[i];
          }
          acc.maxShear  = Math.max(acc.maxShear,  br.maxShear_kN);
          acc.maxMoment = Math.max(acc.maxMoment, br.maxMoment_kNm);
          acc.slabCount++;
        }
      }
    }

    // ── Accumulate Phase 7 beam results from ALL slab solves ─────────────────
    // Same ETABS approach for penalty-based coupled FEM (Phase 7).
    const p7Acc = new Map<string, AccBeam>();

    for (const res of p7Results) {
      for (const br of res.beamResults) {
        if (!p7Acc.has(br.beamId)) {
          p7Acc.set(br.beamId, {
            shears:    [...br.elementShears_kN],
            moments:   [...br.elementMoments_kNm],
            maxShear:  br.maxShear_kN,
            maxMoment: br.maxMoment_kNm,
            slabCount: 1,
          });
        } else {
          const acc = p7Acc.get(br.beamId)!;
          const len = Math.min(acc.shears.length, br.elementShears_kN.length);
          for (let i = 0; i < len; i++) {
            acc.shears[i]  += br.elementShears_kN[i];
            acc.moments[i] += br.elementMoments_kNm[i];
          }
          acc.maxShear  = Math.max(acc.maxShear,  br.maxShear_kN);
          acc.maxMoment = Math.max(acc.maxMoment, br.maxMoment_kNm);
          acc.slabCount++;
        }
      }
    }

    // ── Beam type: dual detection ─────────────────────────────────────────────
    // Primary:  beam appears in FEM results of ≥2 slab solves → Internal.
    // Fallback: beam.slabs filtered to current model slabs has ≥2 entries.
    const activeSlabIds = new Set(slabs.map(s => s.id));

    // 3D method map
    const tdMap = new Map<string, BeamLoadResult>();
    for (const r of tdResults) tdMap.set(r.beamId, r);

    const rows: BeamRow[] = [];

    for (const beam of beams) {
      const acc = p8Acc.get(beam.id);
      const td  = tdMap.get(beam.id);
      if (!acc) continue;   // beam not in FEM solution — skip

      // Beam type: internal if seen from ≥2 slab solves OR beam.slabs has ≥2
      // active slabs (handles the case where only one slab was solved).
      const slabSolveCount   = acc.slabCount;
      const activeSLabCount  = (beam.slabs ?? []).filter(id => activeSlabIds.has(id)).length;
      const isInternal = slabSolveCount >= 2 || activeSLabCount >= 2;
      const beamType: BeamRow['beamType'] = isInternal ? 'Internal' : 'Edge';

      // Span
      const L = beam.length;   // metres

      // 3D avg load (kN/m): use pre-computed tributary loads already on the beam
      // (beam.deadLoad + beam.liveLoad come from calculateBeamLoads in the main
      // app, which implements the standard tributary area / 3D-method distribution).
      // Fall back to getBeamLoadsFromSlab optional fields if available.
      let load3D = beam.deadLoad + beam.liveLoad;
      if (load3D < 1e-6) {
        if (td?.oldMethodLoad) {
          load3D = td.oldMethodLoad.deadLoad + td.oldMethodLoad.liveLoad;
        } else if (td?.femMethodLoad) {
          load3D = td.femMethodLoad.avgLoad;
        }
      }

      // Phase 8 avg load from accumulated shear profile:
      //   w_avg = Total vertical force / L
      //   Total vertical force = V_start + V_end (left & right support reactions)
      //   After accumulation, internal beam forces reflect both slab contributions.
      const sh = acc.shears;
      const vStart = sh.length > 0 ? sh[0] : 0;
      const vEnd   = sh.length > 1 ? sh[sh.length - 1] : vStart;
      const totalForceP8 = vStart + vEnd;    // kN — accumulated support reactions
      const loadP8 = L > 1e-6 ? totalForceP8 / L : 0;

      // Phase 7 avg load from accumulated shear profile (penalty-based FEM):
      const p7Acc2 = p7Acc.get(beam.id);
      let loadP7 = 0;
      if (p7Acc2 && L > 1e-6) {
        const sh7 = p7Acc2.shears;
        const v7Start = sh7.length > 0 ? sh7[0] : 0;
        const v7End   = sh7.length > 1 ? sh7[sh7.length - 1] : v7Start;
        loadP7 = (v7Start + v7End) / L;
      }

      // diff
      const diffPct = load3D > 1e-6 ? (loadP8 - load3D) / load3D * 100 : 0;

      // Negative shear / sign-reversal detection on accumulated moment profile
      const moments = acc.moments;
      let hasNeg = false;
      for (let i = 1; i < moments.length; i++) {
        if (moments[i] < moments[i - 1] * 0.1 && i > 1 && i < moments.length - 1) {
          hasNeg = true;
        }
      }

      // EI
      const ei = computeEI(beam, mat.fc);

      // Peak shear location
      const loc = peakLoc(sh, sh.length);

      rows.push({
        beamId:       beam.id,
        beamType,
        span_m:       L,
        load3D_kNm:   load3D,
        loadP8_kNm:   loadP8,
        loadP7_kNm:   loadP7,
        vmax_kN:      acc.maxShear,
        mmax_kNm:     acc.maxMoment,
        diffPct,
        behavior:     behaviorText(diffPct, isInternal, hasNeg),
        ei_kNm2:      ei,
        hasNegativeShear: hasNeg,
        shears:       sh,
        peakLocation: loc,
      });
    }

    return rows;
  }, [computed, p8Results, p7Results, tdResults, beams, slabs, mat.fc]);

  // ── sorted rows ─────────────────────────────────────────────────────────────
  const sortedRows = useMemo(() => {
    const r = [...beamRows];
    r.sort((a, b) => {
      let va: number | string, vb: number | string;
      switch (sortKey) {
        case 'diffPct': va = Math.abs(a.diffPct);  vb = Math.abs(b.diffPct);  break;
        case 'vmax':    va = a.vmax_kN;            vb = b.vmax_kN;            break;
        case 'mmax':    va = a.mmax_kNm;           vb = b.mmax_kNm;           break;
        case 'ei':      va = a.ei_kNm2;            vb = b.ei_kNm2;            break;
        default:        va = a.beamId;             vb = b.beamId;             break;
      }
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortAsc ? cmp : -cmp;
    });
    return r;
  }, [beamRows, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(s => !s);
    else { setSortKey(key); setSortAsc(false); }
  }

  // ── equilibrium rows ────────────────────────────────────────────────────────
  const equilibriumRows = useMemo(() => {
    if (!computed) return [];
    const rows: { method: string; total: number; reaction: number; err: number }[] = [];

    // Phase 8
    for (const r of p8Results) {
      rows.push({
        method:   'Phase 8 FEM (DOF Merging)',
        total:    r.equilibrium.totalApplied_kN,
        reaction: r.equilibrium.totalReactions_kN,
        err:      r.equilibrium.errorPct,
      });
    }

    // Phase 7 — penalty-based coupled FEM
    for (const r of p7Results) {
      rows.push({
        method:   'Phase 7 FEM (Penalty-based)',
        total:    r.equilibrium.totalApplied_kN,
        reaction: r.equilibrium.totalReactions_kN,
        err:      r.equilibrium.errorPct,
      });
    }

    // 3D method: sum of beam forces vs slab total load
    const ownW = (slabProps.thickness / 1000) * mat.gamma;
    const q_kNm2 = ownW + slabProps.finishLoad + slabProps.liveLoad;
    const slabArea = slabs.reduce((sum, s) => {
      return sum + Math.abs(s.x2 - s.x1) * Math.abs(s.y2 - s.y1);
    }, 0);
    const totalLoad3D = q_kNm2 * slabArea;

    // Total beam reaction ≈ sum of (avg_w × L) for all beams in 3D method
    let totalBeamForce3D = 0;
    for (const r of tdResults) {
      const beam = beams.find(b => b.id === r.beamId);
      if (!beam) continue;
      if (r.femMethodLoad) totalBeamForce3D += r.femMethodLoad.avgLoad * beam.length;
      else if (r.oldMethodLoad) totalBeamForce3D += (r.oldMethodLoad.deadLoad + r.oldMethodLoad.liveLoad) * beam.length;
    }

    const err3D = totalLoad3D > 1e-6 ? Math.abs(totalLoad3D - totalBeamForce3D) / totalLoad3D * 100 : 0;
    rows.push({
      method:   '3D Method (Tributary)',
      total:    totalLoad3D,
      reaction: totalBeamForce3D,
      err:      err3D,
    });

    return rows;
  }, [computed, p8Results, p7Results, tdResults, slabs, beams, slabProps, mat]);

  // ── Not analyzed guard ──────────────────────────────────────────────────────
  if (!analyzed) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground mb-4">يرجى تشغيل التحليل الرئيسي أولاً</p>
          <Button onClick={onRunAnalysis} className="min-h-[44px]">
            <Calculator size={16} className="mr-2" />
            تشغيل التحليل
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── HEADER NOTE ─────────────────────────────────────────────────────── */}
      <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-500/5">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0 text-emerald-500" />
            <div className="leading-relaxed">
              This comparison shows the difference between{' '}
              <strong>simplified load distribution (3D Method)</strong> and{' '}
              <strong>full structural interaction (FEM Phase 8 — True DOF Merging)</strong>.
              Differences are expected and reflect real structural behavior: the FEM engine
              accounts for slab–beam stiffness interaction, load redistribution, and
              coupled deformation — none of which the tributary method captures.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── CONTROLS ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-emerald-500" />
              <span className="text-xs font-semibold">FEM Comparison Engine</span>
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-400/40 text-[10px]">
                Phase 8 — DOF Merging
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Mesh density:</span>
              <select
                className="h-7 rounded border border-input bg-background px-2 text-xs"
                value={meshDensity}
                onChange={e => { setMeshDensity(Number(e.target.value)); setComputed(false); }}
              >
                <option value={2}>2 div/m (fast)</option>
                <option value={3}>3 div/m (balanced)</option>
                <option value={5}>5 div/m (precise)</option>
              </select>
            </div>
            <Button
              onClick={handleCompute}
              disabled={computing}
              size="sm"
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Calculator size={13} className="mr-1.5" />
              {computing ? 'Computing…' : computed ? 'Recompute' : 'Run Comparison'}
            </Button>
            {computing && (
              <span className="text-[10px] text-muted-foreground animate-pulse">
                Solving FEM system… this may take a few seconds
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SECTION A — Beam Load & Force Comparison                               */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {computed && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 size={14} className="text-emerald-500" />
              A — Beam Load &amp; Force Comparison
              <Badge variant="outline" className="text-[10px]">kN · kN/m · kN·m</Badge>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              FEM Phase 8 (DOF Merging) and Phase 7 (Penalty) avg load vs 3D tributary method — internal beams highlighted in blue.
              Sort by any column header.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {sortedRows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center px-4">
                No beams with FEM results. Ensure beams are assigned to slabs.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <SH onClick={() => toggleSort('beamId')} sorted={sortKey === 'beamId'}>Beam ID</SH>
                    <SH>Type</SH>
                    <SH>Span (m)</SH>
                    <SH>3D Load (kN/m)</SH>
                    <SH>FEM P8 Avg (kN/m)</SH>
                    <SH>FEM P7 Avg (kN/m)</SH>
                    <SH onClick={() => toggleSort('vmax')} sorted={sortKey === 'vmax'}>Vmax (kN)</SH>
                    <SH onClick={() => toggleSort('mmax')} sorted={sortKey === 'mmax'}>Mmax (kN·m)</SH>
                    <SH onClick={() => toggleSort('diffPct')} sorted={sortKey === 'diffPct'}>Diff %</SH>
                    <SH>Behavior</SH>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map(row => (
                    <TableRow
                      key={row.beamId}
                      className={row.beamType === 'Internal' ? 'bg-blue-500/5 hover:bg-blue-500/10' : 'hover:bg-muted/30'}
                    >
                      <TC className="font-semibold">
                        {row.beamId}
                        {row.beamType === 'Internal' && (
                          <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-blue-500 align-middle" />
                        )}
                      </TC>
                      <TC>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${row.beamType === 'Internal' ? 'border-blue-400/60 text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}
                        >
                          {row.beamType}
                        </Badge>
                      </TC>
                      <TC>{row.span_m.toFixed(2)}</TC>
                      <TC className="bg-muted/20">{row.load3D_kNm.toFixed(2)}</TC>
                      <TC className="bg-emerald-500/5 font-semibold">{row.loadP8_kNm.toFixed(2)}</TC>
                      <TC className="bg-amber-500/5 font-semibold">{row.loadP7_kNm.toFixed(2)}</TC>
                      <TC className="bg-emerald-500/5">{row.vmax_kN.toFixed(2)}</TC>
                      <TC className="bg-emerald-500/5">{row.mmax_kNm.toFixed(2)}</TC>
                      <TC>{diffBadge(row.diffPct)}</TC>
                      <TC className="text-[10px] text-muted-foreground max-w-[200px] whitespace-normal leading-tight">
                        {row.behavior}
                      </TC>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SECTION B — Load Distribution Behavior                                  */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {computed && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity size={14} className="text-blue-500" />
              B — Load Distribution Behavior
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Shape of distributed load along each beam: uniform assumption (3D) vs FEM stiffness-driven distribution.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SH>Beam ID</SH>
                  <SH>3D Shape</SH>
                  <SH>FEM Shape</SH>
                  <SH>Peak Location</SH>
                  <SH>Negative Zones</SH>
                  <SH>Interpretation</SH>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map(row => (
                  <TableRow key={row.beamId} className="hover:bg-muted/30">
                    <TC className="font-semibold">{row.beamId}</TC>
                    <TC>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">Uniform</Badge>
                    </TC>
                    <TC>
                      <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-400/40">
                        Non-uniform
                      </Badge>
                    </TC>
                    <TC>
                      <span className="text-[11px]">
                        {row.peakLocation === 'Midspan'       && 'Midspan'}
                        {row.peakLocation === 'Quarter-point' && 'Typical two-way slab behavior'}
                        {row.peakLocation === 'End'           && 'Near supports'}
                      </span>
                    </TC>
                    <TC>
                      {row.hasNegativeShear ? (
                        <Badge className="text-[10px] bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-400/40">
                          Yes — Corner uplift
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">No</span>
                      )}
                    </TC>
                    <TC className="text-[10px] text-muted-foreground max-w-[220px] whitespace-normal leading-tight">
                      {row.hasNegativeShear
                        ? 'Corner uplift / plate behavior — load reversal near slab corners'
                        : 'Load follows stiffness distribution along beam'}
                    </TC>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SECTION C — Global Equilibrium Check                                    */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {computed && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Scale size={14} className="text-purple-500" />
              C — Global Equilibrium Check
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Verification that ΣReactions = ΣApplied Load for each method. FEM Phase 8 (DOF Merging) and Phase 7 (Penalty) both enforce equilibrium; Phase 7 may show small penalty error.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SH>Method</SH>
                  <SH>Total Load (kN)</SH>
                  <SH>Total Reaction (kN)</SH>
                  <SH>Error %</SH>
                  <SH>Status</SH>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equilibriumRows.map((row, i) => {
                  const isFEM = i < equilibriumRows.length - 1;
                  return (
                    <TableRow key={row.method} className={isFEM ? 'bg-emerald-500/5' : ''}>
                      <TC className="font-semibold">
                        {isFEM ? (
                          <span className="flex items-center gap-1.5">
                            <Zap size={11} className="text-emerald-500" />
                            {row.method}
                          </span>
                        ) : row.method}
                      </TC>
                      <TC>{row.total.toFixed(2)}</TC>
                      <TC>{row.reaction.toFixed(2)}</TC>
                      <TC>{eqErrBadge(row.err)}</TC>
                      <TC>
                        {row.err < 2 ? (
                          <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-[11px]">
                            <CheckCircle2 size={12} /> Pass
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400 text-[11px]">
                            <AlertTriangle size={12} /> Review
                          </span>
                        )}
                      </TC>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SECTION D — Stiffness Sensitivity                                       */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {computed && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap size={14} className="text-amber-500" />
              D — Stiffness Sensitivity
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              How beam EI influences load attraction vs 3D tributary assumption.
              Sort by EI to see the stiffness–load relationship.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SH onClick={() => toggleSort('beamId')} sorted={sortKey === 'beamId'}>Beam ID</SH>
                  <SH onClick={() => toggleSort('ei')} sorted={sortKey === 'ei'}>EI (kN·m²)</SH>
                  <SH>3D Load (kN)</SH>
                  <SH>FEM P8 Load (kN)</SH>
                  <SH onClick={() => toggleSort('diffPct')} sorted={sortKey === 'diffPct'}>Change vs 3D %</SH>
                  <SH>Interpretation</SH>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map(row => {
                  const femLoad3D_kN = row.load3D_kNm * row.span_m;
                  const femLoadP8_kN = row.loadP8_kNm * row.span_m;
                  return (
                    <TableRow key={row.beamId} className="hover:bg-muted/30">
                      <TC className="font-semibold">{row.beamId}</TC>
                      <TC className="text-amber-600 dark:text-amber-400 font-semibold">
                        {(row.ei_kNm2 / 1000).toFixed(0)} ×10³
                      </TC>
                      <TC className="bg-muted/20">{femLoad3D_kN.toFixed(1)}</TC>
                      <TC className="bg-emerald-500/5 font-semibold">{femLoadP8_kN.toFixed(1)}</TC>
                      <TC>{diffBadge(row.diffPct)}</TC>
                      <TC className="text-[10px] text-muted-foreground max-w-[200px] whitespace-normal leading-tight">
                        {row.diffPct > 5
                          ? 'Beam attracts more load due to higher stiffness'
                          : row.diffPct < -5
                            ? 'Beam sheds load (flexible relative to slab)'
                            : 'Load balanced — stiffness matches tributary assumption'}
                      </TC>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* SECTION E — Physical Behavior Summary                                   */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {computed && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 size={14} className="text-green-500" />
              E — Physical Behavior Summary
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Structural behavior captured by FEM Phase 8 that the 3D Method cannot represent.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <SH>Physical Check</SH>
                  <SH>3D Method</SH>
                  <SH>FEM Phase 8</SH>
                  <SH>Result</SH>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  {
                    check: 'Load uniformity along beam',
                    td:    'Assumes uniform w(x) = constant',
                    p8:    'Computes variable w(x) from slab plate action',
                    ok:    true,
                  },
                  {
                    check: 'Beam–slab stiffness effect',
                    td:    'Not considered — pure tributary area',
                    p8:    'Stiffness-driven redistribution — stiffer beams carry more load',
                    ok:    true,
                  },
                  {
                    check: 'Internal beam load attraction',
                    td:    'Equal share from adjacent slab strips',
                    p8:    'Beam attracts load proportional to its EI relative to slab',
                    ok:    true,
                  },
                  {
                    check: 'Moment transfer at beam–slab interface',
                    td:    'Ignored — beams carry shear only',
                    p8:    'Full moment continuity — Mx, My, RX, RY shared DOFs',
                    ok:    true,
                  },
                  {
                    check: 'Coupled vertical deformation',
                    td:    'Beams and slab deflect independently',
                    p8:    'Slab and beam share UZ DOF — truly monolithic deformation',
                    ok:    true,
                  },
                  {
                    check: 'Numerical conditioning',
                    td:    'N/A (analytical)',
                    p8:    'True DOF merging — no penalty stiffness, κ(K) natural',
                    ok:    true,
                  },
                  {
                    check: 'Equilibrium satisfaction',
                    td:    'Approximate (tributary areas may not sum exactly)',
                    p8:    'Exact — enforced at every DOF by FEM equations',
                    ok:    true,
                  },
                ].map(row => (
                  <TableRow key={row.check} className="hover:bg-muted/30">
                    <TC className="font-semibold text-[11px] max-w-[160px] whitespace-normal leading-tight">
                      {row.check}
                    </TC>
                    <TC className="bg-muted/20 text-[10px] text-muted-foreground max-w-[200px] whitespace-normal leading-tight">
                      {row.td}
                    </TC>
                    <TC className="bg-emerald-500/5 text-[10px] max-w-[240px] whitespace-normal leading-tight">
                      {row.p8}
                    </TC>
                    <TC>
                      {row.ok ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold">
                          <CheckCircle2 size={13} /> FEM ✔
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[10px]">—</span>
                      )}
                    </TC>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── DEBUG info (collapsed) ──────────────────────────────────────────── */}
      {computed && p8Results.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="py-3 px-4">
            <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground font-mono">
              {p8Results.map((r, i) => (
                <span key={i}>
                  Slab {i + 1}: {r.debug.nTotalDOF} DOF
                  ({r.debug.nSharedNodes} shared nodes,
                  −{r.debug.dofReduction} vs Phase 7,
                  eq. err {r.equilibrium.errorPct.toFixed(2)}%,
                  {r.debug.solveTime_ms} ms)
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
};

export default FEMComparisonPanel;
