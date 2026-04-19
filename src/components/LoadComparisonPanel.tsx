/**
 * LoadComparisonPanel
 * ─────────────────────────────────────────────────────────────
 * Three comparison sections:
 *
 *  Table 1 – Beam load distribution
 *    Old method (tributary area, ACI)  vs.  FEM Phase 5/6 engine
 *    Columns: Beam ID | Old Load | FEM Load | Diff% | Max w(x) | Min w(x)
 *
 *  Table 2 – Slab moment resultants
 *    Old method (Marcus/ACI coefficient × q × lx²)  vs.  FEM center Mx/My
 *    Columns: Slab ID | lx×ly | β | Type | α_short | Mx_old | My_old |
 *             Mx_FEM | My_FEM | M_avg | Mxy_FEM | ΔMx | ΔMy
 *
 *  Section 3 – Phase 6 Rotational Coupling Results (when enabled)
 *    Per-beam: kθ, Ec, I, max|Δθ|, avg|Δθ|, M_orig, M_corr, correction%
 *
 * STRICT: this component is READ-ONLY with respect to the existing engine.
 */

import React, { useMemo, useState } from 'react';
import {
  Card, CardHeader, CardTitle, CardContent,
} from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calculator, Info, Zap, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

import type { Slab, Beam, Column, SlabProps, MatProps } from '@/lib/structuralEngine';
import { designSlab } from '@/lib/structuralEngine';
import {
  getBeamLoadsFromSlab,
  getSlabCenterMoments,
  getBeamLoadsWithCoupling,
} from '@/slabFEMEngine';
import type {
  BeamLoadResult,
  SlabMomentComparison,
  RotationalCouplingResult,
} from '@/slabFEMEngine';

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  slabs:     Slab[];
  beams:     Beam[];
  columns:   Column[];
  slabProps: SlabProps;
  mat:       MatProps;
  analyzed:  boolean;
  onRunAnalysis: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function diffBadge(pct: number) {
  const abs = Math.abs(pct);
  if (abs <= 5)  return <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-400/40 text-[10px]">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</Badge>;
  if (abs <= 15) return <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-400/40 text-[10px]">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</Badge>;
  return           <Badge className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-400/40 text-[10px]">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</Badge>;
}

function pctColor(pct: number) {
  const abs = Math.abs(pct);
  if (abs <= 5)  return 'text-green-600 dark:text-green-400';
  if (abs <= 15) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function correctionBadge(pct: number) {
  const abs = Math.abs(pct);
  if (abs <= 5)  return <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 text-[10px]">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</Badge>;
  if (abs <= 20) return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-400/40 text-[10px]">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</Badge>;
  return           <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-400/40 text-[10px]">{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</Badge>;
}

function fmt(v: number, dec = 2) { return v.toFixed(dec); }
function fmtRad(v: number) {
  return v < 0.001 ? `${(v * 1000).toFixed(3)} mrad` : `${v.toFixed(5)} rad`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const LoadComparisonPanel: React.FC<Props> = ({
  slabs, beams, columns, slabProps, mat, analyzed, onRunAnalysis,
}) => {
  const [computed,  setComputed]  = useState(false);
  const [computing, setComputing] = useState(false);

  const [beamResults,     setBeamResults]     = useState<BeamLoadResult[]>([]);
  const [slabResults,     setSlabResults]     = useState<SlabMomentComparison[]>([]);
  const [couplingResults, setCouplingResults] = useState<RotationalCouplingResult[]>([]);

  // Phase 6 controls
  const [useCoupling,  setUseCoupling]  = useState(false);
  const [couplingAlpha, setCouplingAlpha] = useState(1.0);
  const [showCouplingDetail, setShowCouplingDetail] = useState(false);

  // ── Compute on demand ────────────────────────────────────────────────────
  const handleCompute = () => {
    if (slabs.length === 0 || beams.length === 0) return;
    setComputing(true);

    setTimeout(() => {
      try {
        const femModel = { slabs, beams, columns, slabProps, mat, meshDensity: 4 };

        let br: BeamLoadResult[];
        let coupling: RotationalCouplingResult[] = [];

        if (useCoupling) {
          const result = getBeamLoadsWithCoupling({
            ...femModel,
            comparisonMode:         true,
            useStressBasedTransfer: true,
            stressMode:             'full',
            useRotationalCoupling:  true,
            couplingAlpha,
          } as never);
          br       = result.loads;
          coupling = result.coupling;
        } else {
          br = getBeamLoadsFromSlab({ ...femModel, comparisonMode: true } as never);
        }

        const sr = getSlabCenterMoments(femModel);

        setBeamResults(br);
        setSlabResults(sr);
        setCouplingResults(coupling);
        setComputed(true);
      } catch (err) {
        console.error('[LoadComparisonPanel] FEM error:', err);
      } finally {
        setComputing(false);
      }
    }, 0);
  };

  const handleReset = () => {
    setComputed(false);
    setBeamResults([]);
    setSlabResults([]);
    setCouplingResults([]);
  };

  // ── Old-method slab moments ───────────────────────────────────────────────
  const slabMomentRows = useMemo(() => {
    if (!computed) return [];
    const q_service = (slabProps.thickness / 1000) * mat.gamma + slabProps.finishLoad + slabProps.liveLoad;

    return slabResults.map(sr => {
      const slab = slabs.find(s => s.id === sr.slabId)!;
      if (!slab) return null;

      const ds = designSlab(slab, slabProps, mat, slabs);
      const oldMx = ds.shortCoeff * q_service * sr.lx_m * sr.lx_m;
      const oldMy = ds.isOneWay ? 0 : (ds.longCoeff * q_service * sr.lx_m * sr.lx_m);

      const diffMx = oldMx > 1e-4 ? ((sr.fem.Mx - oldMx) / oldMx) * 100 : 0;
      const diffMy = oldMy > 1e-4 ? ((sr.fem.My - oldMy) / oldMy) * 100 : 0;

      const M_avg_fem = (sr.fem.Mx + sr.fem.My) / 2;
      const M_avg_old = (oldMx + oldMy) / 2;

      return {
        ...sr,
        shortCoeff: ds.shortCoeff,
        longCoeff:  ds.longCoeff,
        oldMx, oldMy,
        diffMx, diffMy,
        M_avg_fem, M_avg_old,
      };
    }).filter(Boolean) as (SlabMomentComparison & {
      shortCoeff: number; longCoeff: number;
      oldMx: number; oldMy: number;
      diffMx: number; diffMy: number;
      M_avg_fem: number; M_avg_old: number;
    })[];
  }, [computed, slabResults, slabs, slabProps, mat]);

  // ── Beam comparison rows ──────────────────────────────────────────────────
  const beamRows = useMemo(() => {
    if (!computed) return [];
    return beamResults.map(br => {
      const beam = beams.find(b => b.id === br.beamId);
      if (!beam || !br.oldMethodLoad || !br.femMethodLoad) return null;

      const oldTotal = (br.oldMethodLoad.deadLoad + br.oldMethodLoad.liveLoad) * beam.length;
      const femTotal = trapz(
        br.loads.values.map(p => p.position),
        br.loads.values.map(p => p.w),
      );

      const wValues  = br.loads.values.map(p => p.w);
      const femMax   = Math.max(...wValues);
      const femMin   = Math.min(...wValues);

      const diff = br.differencePercent ?? (oldTotal > 1e-6 ? ((femTotal - oldTotal) / oldTotal) * 100 : 0);

      return {
        beamId:   br.beamId,
        span:     beam.length,
        oldDL:    br.oldMethodLoad.deadLoad,
        oldLL:    br.oldMethodLoad.liveLoad,
        oldTotal,
        femAvg:   br.femMethodLoad.avgLoad,
        femPeak:  br.femMethodLoad.peakLoad,
        femMax,
        femMin,
        femTotal,
        diff,
      };
    }).filter(Boolean) as {
      beamId: string; span: number;
      oldDL: number; oldLL: number; oldTotal: number;
      femAvg: number; femPeak: number;
      femMax: number; femMin: number;
      femTotal: number; diff: number;
    }[];
  }, [computed, beamResults, beams]);

  // ── Coupling summary stats ─────────────────────────────────────────────────
  const couplingSummary = useMemo(() => {
    if (!couplingResults.length) return null;
    const totalOrig = couplingResults.reduce((s, r) => s + r.totalMoment_original_kNm, 0);
    const totalCorr = couplingResults.reduce((s, r) => s + r.totalMoment_corrected_kNm, 0);
    const globalPct = totalOrig > 1e-9 ? ((totalCorr - totalOrig) / totalOrig) * 100 : 0;
    const allStable = couplingResults.every(r => r.stable);
    const maxKTheta = Math.max(...couplingResults.map(r => r.kTheta_kNm_per_rad));
    const maxDelta  = Math.max(...couplingResults.map(r => r.maxDeltaTheta_rad));
    return { totalOrig, totalCorr, globalPct, allStable, maxKTheta, maxDelta };
  }, [couplingResults]);

  // ── Excel export: Beam Load Comparison ────────────────────────────────────
  const exportBeamLoads = () => {
    const header = [
      'الجسر', 'البحر (م)',
      'DL قديم (kN/m)', 'LL قديم (kN/m)', 'مجموع قديم (kN)',
      'FEM متوسط (kN/m)', 'FEM ذروة (kN/m)', 'مجموع FEM (kN)',
      'Max w(x) (kN/m)', 'Min w(x) (kN/m)', 'الفرق (%)',
    ];
    const rows = beamRows.map(r => [
      r.beamId,
      +r.span.toFixed(2),
      +r.oldDL.toFixed(2),
      +r.oldLL.toFixed(2),
      +r.oldTotal.toFixed(2),
      +r.femAvg.toFixed(2),
      +r.femPeak.toFixed(2),
      +r.femTotal.toFixed(2),
      +r.femMax.toFixed(2),
      +r.femMin.toFixed(2),
      +r.diff.toFixed(1),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = header.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'توزيع الأحمال على الجسور');
    XLSX.writeFile(wb, 'مقارنة_توزيع_الأحمال_على_الجسور.xlsx');
  };

  // ── Excel export: Slab Moment Comparison ──────────────────────────────────
  const exportSlabMoments = () => {
    const header = [
      'البلاطة', 'lx (م)', 'ly (م)', 'β', 'النوع',
      'α قصير', 'Mx قديم (kN·م/م)', 'My قديم (kN·م/م)',
      'Mx FEM (kN·م/م)', 'My FEM (kN·م/م)', 'M_avg FEM (kN·م/م)',
      'Mxy FEM (kN·م/م)', 'M_avg مرجع (kN·م/م)',
      'Δ Mx (%)', 'Δ My (%)',
    ];
    const rows = slabMomentRows.map(row => {
      return [
        row.slabId,
        +row.lx_m.toFixed(2),
        +row.ly_m.toFixed(2),
        +row.beta.toFixed(3),
        row.isOneWay ? 'أحادية' : 'ثنائية',
        +row.shortCoeff.toFixed(4),
        +row.oldMx.toFixed(3),
        +row.oldMy.toFixed(3),
        +row.fem.Mx.toFixed(3),
        +row.fem.My.toFixed(3),
        +row.M_avg_fem.toFixed(3),
        +row.fem.Mxy.toFixed(3),
        row.M_avg_old > 1e-4 ? +row.M_avg_old.toFixed(3) : '',
        +row.diffMx.toFixed(1),
        row.oldMy > 1e-4 ? +row.diffMy.toFixed(1) : '',
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = header.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'عزوم البلاطات');
    XLSX.writeFile(wb, 'مقارنة_عزوم_البلاطات_عند_المنتصف.xlsx');
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

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

  return (
    <div className="space-y-4">

      {/* Header note */}
      <Card className="border-blue-200 dark:border-blue-800">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0 text-blue-500" />
            <div>
              تقارن هذه الصفحة بين <strong>الطريقة التقليدية (نظام الأحمال المناطقي — Marcus/ACI)</strong> المستخدمة في التطبيق
              و<strong>محرك FEM الجديد (Mindlin-Reissner)</strong>.
              {' '}<strong>Phase 6</strong> يضيف التكافؤ الدوراني بين البلاطة والجسر عبر نموذج الزنبرك الدوراني
              {' '}M = kθ · Δθ.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Phase 6 controls */}
      <Card className={useCoupling ? 'border-purple-300 dark:border-purple-700' : ''}>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Zap size={14} className={useCoupling ? 'text-purple-500' : 'text-muted-foreground'} />
              <span className="text-xs font-medium">Phase 6 — التكافؤ الدوراني</span>
            </div>
            <Button
              variant={useCoupling ? 'default' : 'outline'}
              size="sm"
              className={`text-xs h-7 ${useCoupling ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
              onClick={() => { setUseCoupling(!useCoupling); setComputed(false); setBeamResults([]); setSlabResults([]); setCouplingResults([]); }}
            >
              {useCoupling ? 'مفعّل' : 'تفعيل'}
            </Button>
            {useCoupling && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">α =</span>
                <input
                  type="number"
                  min={0.1} max={10} step={0.1}
                  value={couplingAlpha}
                  onChange={e => { setCouplingAlpha(Number(e.target.value)); setComputed(false); }}
                  className="w-20 h-7 px-2 text-xs rounded border border-input bg-background font-mono"
                />
                <span className="text-[10px] text-muted-foreground">kθ = α·E·I/L</span>
              </div>
            )}
          </div>
          {useCoupling && (
            <p className="text-[10px] text-purple-600 dark:text-purple-400 mt-2">
              يعمل الآن بـ Phase 5 (Fz + Mx + My) + Phase 6 (تصحيح العزوم بالتكافؤ الدوراني).
              kθ = α · E_c · I / L حيث Ec = 4700√f'c، I = b·h³/12
            </p>
          )}
        </CardContent>
      </Card>

      {/* Compute trigger */}
      {!computed ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              {useCoupling
                ? 'اضغط لتشغيل محرك FEM مع التكافؤ الدوراني (Phase 6)'
                : 'اضغط لتشغيل محرك FEM وعرض جداول المقارنة'}
            </p>
            <Button onClick={handleCompute} disabled={computing} className="min-h-[44px]">
              <Calculator size={16} className="mr-2" />
              {computing ? 'جاري الحساب…' : useCoupling ? 'تشغيل FEM + Phase 6' : 'تشغيل المقارنة بمحرك FEM'}
            </Button>
            {computing && (
              <p className="text-xs text-muted-foreground mt-3 animate-pulse">
                جاري حل نظام المعادلات… قد يستغرق بضع ثوانٍ
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" size="sm" onClick={handleReset}>
          إعادة الحساب
        </Button>
      )}

      {/* ── TABLE 1: Beam Load Comparison ─────────────────────────────────── */}
      {computed && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                مقارنة توزيع الأحمال على الجسور
                <Badge variant="outline" className="text-[10px]">kN/m · kN</Badge>
                {useCoupling && (
                  <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-400/40 text-[10px]">Phase 6</Badge>
                )}
              </CardTitle>
              {beamRows.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 text-green-700 dark:text-green-400 border-green-400/50 hover:bg-green-500/10"
                  onClick={exportBeamLoads}
                >
                  <Download size={13} />
                  تصدير Excel
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              الطريقة التقليدية: حمل موزع ثابت (DL + LL) × البحر.
              محرك FEM: حمل موزع متغير w(x){useCoupling ? ' مع تصحيح التكافؤ الدوراني' : ''}.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {beamRows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                لا توجد جسور متصلة ببلاطات — لا يمكن إجراء مقارنة FEM
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">الجسر</TableHead>
                    <TableHead className="text-xs">البحر (م)</TableHead>
                    {/* Old method */}
                    <TableHead className="text-xs bg-muted/40">DL قديم (kN/m)</TableHead>
                    <TableHead className="text-xs bg-muted/40">LL قديم (kN/m)</TableHead>
                    <TableHead className="text-xs bg-muted/40 font-semibold">مجموع قديم (kN)</TableHead>
                    {/* FEM */}
                    <TableHead className="text-xs bg-blue-500/10">FEM متوسط (kN/m)</TableHead>
                    <TableHead className="text-xs bg-blue-500/10">FEM ذروة (kN/m)</TableHead>
                    <TableHead className="text-xs bg-blue-500/10 font-semibold">مجموع FEM (kN)</TableHead>
                    {/* New: Max / Min w(x) */}
                    <TableHead className="text-xs bg-green-500/10">Max w(x)</TableHead>
                    <TableHead className="text-xs bg-green-500/10">Min w(x)</TableHead>
                    {/* Diff */}
                    <TableHead className="text-xs">الفرق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {beamRows.map(row => (
                    <TableRow key={row.beamId} className={Math.abs(row.diff) > 15 ? 'bg-red-500/5' : ''}>
                      <TableCell className="font-mono text-xs font-semibold">{row.beamId}</TableCell>
                      <TableCell className="font-mono text-xs">{fmt(row.span)}</TableCell>
                      {/* Old */}
                      <TableCell className="font-mono text-xs bg-muted/20">{fmt(row.oldDL)}</TableCell>
                      <TableCell className="font-mono text-xs bg-muted/20">{fmt(row.oldLL)}</TableCell>
                      <TableCell className="font-mono text-xs bg-muted/20 font-semibold">{fmt(row.oldTotal)}</TableCell>
                      {/* FEM */}
                      <TableCell className="font-mono text-xs bg-blue-500/5">{fmt(row.femAvg)}</TableCell>
                      <TableCell className="font-mono text-xs bg-blue-500/5">{fmt(row.femPeak)}</TableCell>
                      <TableCell className="font-mono text-xs bg-blue-500/5 font-semibold">{fmt(row.femTotal)}</TableCell>
                      {/* Max/Min w(x) */}
                      <TableCell className={`font-mono text-xs bg-green-500/5 ${row.femMax > row.oldDL + row.oldLL ? 'text-orange-600 dark:text-orange-400 font-semibold' : ''}`}>
                        {fmt(row.femMax)}
                      </TableCell>
                      <TableCell className="font-mono text-xs bg-green-500/5 text-muted-foreground">
                        {fmt(row.femMin)}
                      </TableCell>
                      {/* Diff */}
                      <TableCell>{diffBadge(row.diff)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── TABLE 2: Slab Moment Comparison ───────────────────────────────── */}
      {computed && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                مقارنة عزوم البلاطات عند المنتصف
                <Badge variant="outline" className="text-[10px]">kN·م/م</Badge>
              </CardTitle>
              {slabMomentRows.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 text-green-700 dark:text-green-400 border-green-400/50 hover:bg-green-500/10"
                  onClick={exportSlabMoments}
                >
                  <Download size={13} />
                  تصدير Excel
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              الطريقة التقليدية: معامل Marcus/ACI × q<sub>service</sub> × lx².
              محرك FEM: عزوم Mx/My عند أقرب نقطة غاوس للمنتصف. M_avg = (|Mx| + |My|) / 2.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {slabMomentRows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">لا توجد بلاطات للمقارنة</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">البلاطة</TableHead>
                    <TableHead className="text-xs">lx × ly (م)</TableHead>
                    <TableHead className="text-xs">β</TableHead>
                    <TableHead className="text-xs">النوع</TableHead>
                    {/* Old */}
                    <TableHead className="text-xs bg-muted/40">α<sub>قصير</sub></TableHead>
                    <TableHead className="text-xs bg-muted/40">Mx قديم</TableHead>
                    <TableHead className="text-xs bg-muted/40">My قديم</TableHead>
                    {/* FEM */}
                    <TableHead className="text-xs bg-blue-500/10">Mx FEM</TableHead>
                    <TableHead className="text-xs bg-blue-500/10">My FEM</TableHead>
                    <TableHead className="text-xs bg-blue-500/10 font-semibold">M_avg FEM</TableHead>
                    <TableHead className="text-xs bg-blue-500/10">Mxy FEM</TableHead>
                    {/* Ref analytical */}
                    <TableHead className="text-xs bg-amber-500/10">M_avg مرجع</TableHead>
                    {/* Diff */}
                    <TableHead className="text-xs">Δ Mx</TableHead>
                    <TableHead className="text-xs">Δ My</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slabMomentRows.map(row => {
                    const diffMavg = row.M_avg_old > 1e-4
                      ? ((row.M_avg_fem - row.M_avg_old) / row.M_avg_old) * 100
                      : 0;
                    return (
                      <TableRow key={row.slabId} className={Math.abs(row.diffMx) > 15 || Math.abs(row.diffMy) > 15 ? 'bg-red-500/5' : ''}>
                        <TableCell className="font-mono text-xs font-semibold">{row.slabId}</TableCell>
                        <TableCell className="font-mono text-xs">{fmt(row.lx_m)} × {fmt(row.ly_m)}</TableCell>
                        <TableCell className="font-mono text-xs">{fmt(row.beta)}</TableCell>
                        <TableCell className="text-xs">
                          {row.isOneWay
                            ? <Badge variant="outline" className="text-[10px] border-orange-400/50 text-orange-600">أحادية</Badge>
                            : <Badge variant="outline" className="text-[10px] border-blue-400/50 text-blue-600">ثنائية</Badge>}
                        </TableCell>
                        {/* Old */}
                        <TableCell className="font-mono text-xs bg-muted/20">{row.shortCoeff.toFixed(4)}</TableCell>
                        <TableCell className="font-mono text-xs bg-muted/20">{fmt(row.oldMx, 3)}</TableCell>
                        <TableCell className="font-mono text-xs bg-muted/20">{fmt(row.oldMy, 3)}</TableCell>
                        {/* FEM */}
                        <TableCell className="font-mono text-xs bg-blue-500/5 font-semibold">{fmt(row.fem.Mx, 3)}</TableCell>
                        <TableCell className="font-mono text-xs bg-blue-500/5 font-semibold">{fmt(row.fem.My, 3)}</TableCell>
                        <TableCell className="font-mono text-xs bg-blue-500/5 font-bold text-blue-700 dark:text-blue-300">{fmt(row.M_avg_fem, 3)}</TableCell>
                        <TableCell className="font-mono text-xs bg-blue-500/5 text-muted-foreground">{fmt(row.fem.Mxy, 3)}</TableCell>
                        {/* Reference analytical (old M_avg) */}
                        <TableCell className="font-mono text-xs bg-amber-500/5">
                          {row.M_avg_old > 1e-4 ? (
                            <span className={pctColor(diffMavg)}>{fmt(row.M_avg_old, 3)}</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        {/* Diffs */}
                        <TableCell>
                          {row.oldMx > 1e-4
                            ? <span className={`text-xs font-mono ${pctColor(row.diffMx)}`}>{row.diffMx > 0 ? '+' : ''}{row.diffMx.toFixed(1)}%</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell>
                          {row.oldMy > 1e-4
                            ? <span className={`text-xs font-mono ${pctColor(row.diffMy)}`}>{row.diffMy > 0 ? '+' : ''}{row.diffMy.toFixed(1)}%</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>

          {/* Legend */}
          <div className="px-4 pb-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-green-500/20 border border-green-500/40" /> فرق ≤ 5% (ممتاز)</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-yellow-500/20 border border-yellow-500/40" /> فرق 5–15% (مقبول)</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-500/20 border border-red-500/40" /> فرق &gt; 15% (مراجعة)</span>
          </div>
        </Card>
      )}

      {/* ── SECTION 3: Phase 6 Coupling Results ────────────────────────────── */}
      {computed && couplingResults.length > 0 && (
        <Card className="border-purple-200 dark:border-purple-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap size={14} className="text-purple-500" />
                نتائج التكافؤ الدوراني — Phase 6
                <Badge variant="outline" className="text-[10px] border-purple-400/50 text-purple-700 dark:text-purple-300">
                  α = {couplingAlpha}
                </Badge>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6 px-2"
                onClick={() => setShowCouplingDetail(!showCouplingDetail)}
              >
                {showCouplingDetail ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {showCouplingDetail ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
              </Button>
            </div>

            {/* Summary bar */}
            {couplingSummary && (
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <span className="flex items-center gap-1">
                  {couplingSummary.allStable
                    ? <CheckCircle2 size={12} className="text-green-500" />
                    : <AlertTriangle size={12} className="text-yellow-500" />}
                  {couplingSummary.allStable ? 'مستقر' : 'يُستحسن مراجعة α'}
                </span>
                <span className="text-muted-foreground">
                  ΔM_global = <strong className={pctColor(couplingSummary.globalPct)}>{couplingSummary.globalPct > 0 ? '+' : ''}{couplingSummary.globalPct.toFixed(1)}%</strong>
                </span>
                <span className="text-muted-foreground">
                  M_orig = <strong>{fmt(couplingSummary.totalOrig, 3)} kN·م</strong>
                </span>
                <span className="text-muted-foreground">
                  M_corr = <strong>{fmt(couplingSummary.totalCorr, 3)} kN·م</strong>
                </span>
                <span className="text-muted-foreground">
                  max kθ = <strong>{fmt(couplingSummary.maxKTheta, 0)} kN·م/rad</strong>
                </span>
                <span className="text-muted-foreground">
                  max|Δθ| = <strong>{fmtRad(couplingSummary.maxDelta)}</strong>
                </span>
              </div>
            )}
          </CardHeader>

          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">الجسر</TableHead>
                  <TableHead className="text-xs bg-purple-500/10">kθ (kN·م/rad)</TableHead>
                  <TableHead className="text-xs bg-purple-500/10">Ec (GPa)</TableHead>
                  <TableHead className="text-xs bg-purple-500/10">I (cm⁴)</TableHead>
                  <TableHead className="text-xs">max|Δθ|</TableHead>
                  <TableHead className="text-xs">avg|Δθ|</TableHead>
                  <TableHead className="text-xs bg-muted/40">M أصلي (kN·م)</TableHead>
                  <TableHead className="text-xs bg-green-500/10">M مصحح (kN·م)</TableHead>
                  <TableHead className="text-xs">التصحيح</TableHead>
                  <TableHead className="text-xs">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {couplingResults.map(cr => (
                  <TableRow key={cr.beamId} className={!cr.stable ? 'bg-yellow-500/5' : ''}>
                    <TableCell className="font-mono text-xs font-semibold">{cr.beamId}</TableCell>
                    <TableCell className="font-mono text-xs bg-purple-500/5">{fmt(cr.kTheta_kNm_per_rad, 0)}</TableCell>
                    <TableCell className="font-mono text-xs bg-purple-500/5">{fmt(cr.Ec_GPa, 1)}</TableCell>
                    <TableCell className="font-mono text-xs bg-purple-500/5">{fmt(cr.I_cm4, 0)}</TableCell>
                    <TableCell className="font-mono text-xs">{fmtRad(cr.maxDeltaTheta_rad)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{fmtRad(cr.avgDeltaTheta_rad)}</TableCell>
                    <TableCell className="font-mono text-xs bg-muted/20">{fmt(cr.totalMoment_original_kNm, 3)}</TableCell>
                    <TableCell className="font-mono text-xs bg-green-500/5 font-semibold">{fmt(cr.totalMoment_corrected_kNm, 3)}</TableCell>
                    <TableCell>{correctionBadge(cr.correctionPercent)}</TableCell>
                    <TableCell>
                      {cr.stable
                        ? <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-green-400/40 text-[10px]">مستقر ✓</Badge>
                        : <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-400/40 text-[10px]">⚠ راجع α</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>

          {/* Per-node detail (collapsed by default) */}
          {showCouplingDetail && (
            <CardContent className="pt-0">
              {couplingResults.map(cr => (
                <div key={cr.beamId} className="mb-4">
                  <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 mb-1">
                    الجسر {cr.beamId} — تفاصيل العقد (kθ = {fmt(cr.kTheta_kNm_per_rad, 0)} kN·م/rad)
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px]">الموضع (م)</TableHead>
                        <TableHead className="text-[10px]">θ_slab (mrad)</TableHead>
                        <TableHead className="text-[10px]">Δθ (mrad)</TableHead>
                        <TableHead className="text-[10px]">kθ_عقدة (kN·م/rad)</TableHead>
                        <TableHead className="text-[10px]">ΔM (kN·م)</TableHead>
                        <TableHead className="text-[10px]">Mx_أصلي</TableHead>
                        <TableHead className="text-[10px]">Mx_مصحح</TableHead>
                        <TableHead className="text-[10px]">My_أصلي</TableHead>
                        <TableHead className="text-[10px]">My_مصحح</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cr.nodes.map((nd, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-[10px]">{fmt(nd.posAlongBeam_m, 3)}</TableCell>
                          <TableCell className="font-mono text-[10px]">{(nd.theta_slab_rad * 1000).toFixed(4)}</TableCell>
                          <TableCell className="font-mono text-[10px]">{(nd.delta_theta_rad * 1000).toFixed(4)}</TableCell>
                          <TableCell className="font-mono text-[10px]">{fmt(nd.kTheta_node_kNm_per_rad, 2)}</TableCell>
                          <TableCell className="font-mono text-[10px] font-semibold">{fmt(nd.moment_correction_kNm, 4)}</TableCell>
                          <TableCell className="font-mono text-[10px] bg-muted/20">{fmt(nd.Mx_original_kNm, 4)}</TableCell>
                          <TableCell className="font-mono text-[10px] bg-green-500/5">{fmt(nd.Mx_corrected_kNm, 4)}</TableCell>
                          <TableCell className="font-mono text-[10px] bg-muted/20">{fmt(nd.My_original_kNm, 4)}</TableCell>
                          <TableCell className="font-mono text-[10px] bg-green-500/5">{fmt(nd.My_corrected_kNm, 4)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </CardContent>
          )}

          {/* Engineering note */}
          <div className="px-4 pb-3 text-[10px] text-muted-foreground space-y-1">
            <p>• <strong>kθ كبير</strong> (جسر صلب) → تصحيح عزم كبير → انخفاض في العزم المنقول من البلاطة</p>
            <p>• <strong>kθ صغير</strong> (جسر مرن) → تصحيح صغير → نتيجة قريبة من Phase 5</p>
            <p>• <strong>Δθ</strong> = فرق الدوران بين البلاطة (FEM) والجسر (≈ 0 تقريب صلب)</p>
            <p>• التصحيح يُطبَّق على Mx للجسور الأفقية وعلى My للجسور الرأسية</p>
          </div>
        </Card>
      )}

      {/* Legend */}
      {computed && (
        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground px-1">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-green-500/20 border border-green-500/40" /> فرق ≤ 5%</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-yellow-500/20 border border-yellow-500/40" /> فرق 5–15%</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-500/20 border border-red-500/40" /> فرق &gt; 15% — مراجعة</span>
        </div>
      )}
    </div>
  );
};

export default LoadComparisonPanel;

// ─────────────────────────────────────────────────────────────────────────────
// Local helper – trapezoidal integration
// ─────────────────────────────────────────────────────────────────────────────

function trapz(x: number[], y: number[]): number {
  let s = 0;
  for (let i = 0; i < x.length - 1; i++) {
    s += 0.5 * (y[i] + y[i + 1]) * (x[i + 1] - x[i]);
  }
  return s;
}
