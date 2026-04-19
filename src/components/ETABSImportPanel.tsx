/**
 * ETABSImportPanel
 * ─────────────────────────────────────────────────────────────────────────────
 * استيراد نتائج برنامج ETABS (CSV) ومقارنتها مع محركات التحليل الثلاثة:
 *   • 2D — Matrix Stiffness Method
 *   • 3D — Direct Stiffness 3D (6 DOF)
 *   • FEM — Coupled Beam-Slab FEM (Phase 8)
 *
 * تنسيق ملف CSV المطلوب:
 *   Beam, Station, M3
 *   B1, 0.0, -45.2
 *   B1, 1.5, 12.4
 *   ...
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Upload, Download, BarChart3, AlertTriangle, Info, FileText } from 'lucide-react';
import type { FrameResult, Beam } from '@/lib/structuralEngine';
import { sampleMomentAt } from '@/lib/etabsStationSampler';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ETABSRow {
  beam: string;
  station: number;
  m3: number;
}

interface ComparisonRow extends ETABSRow {
  span: number;
  m2d: number | null;
  m3d: number | null;
  mFem: number | null;
  mGF: number | null;
  mUC: number | null;
  diff2d: number | null;
  diff3d: number | null;
  diffFem: number | null;
  diffGF: number | null;
  diffUC: number | null;
}

interface Props {
  frameResults2D: FrameResult[];
  frameResults3D: FrameResult[];
  frameResultsFEM?: FrameResult[];
  frameResultsGF?: FrameResult[];
  frameResultsUC?: FrameResult[];
  beams: Beam[];
  analyzed: boolean;
  onRunAnalysis: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lagrange quadratic interpolation through:
 *   (0, Mleft), (L/2, Mmid), (L, Mright)
 * Returns moment at station x (0 ≤ x ≤ L), in kN·m.
 */
function interpolateMoment(
  x: number,
  L: number,
  Mleft: number,
  Mmid: number,
  Mright: number,
): number {
  if (L < 1e-6) return 0;
  const x0 = 0, x1 = L / 2, x2 = L;
  const L0 = ((x - x1) * (x - x2)) / ((x0 - x1) * (x0 - x2));
  const L1 = ((x - x0) * (x - x2)) / ((x1 - x0) * (x1 - x2));
  const L2 = ((x - x0) * (x - x1)) / ((x2 - x0) * (x2 - x1));
  return Mleft * L0 + Mmid * L1 + Mright * L2;
}

/** Build beam→result map from FrameResult[] */
function buildBeamMap(results: FrameResult[]): Map<string, FrameResult['beams'][number] & { frameId: string }> {
  const map = new Map<string, FrameResult['beams'][number] & { frameId: string }>();
  for (const fr of results) {
    for (const br of fr.beams) {
      map.set(br.beamId, { ...br, frameId: fr.frameId });
    }
  }
  return map;
}

/** Percentage difference: (engine − etabs) / |etabs| × 100  */
function pctDiff(engine: number, etabs: number): number {
  const base = Math.abs(etabs);
  if (base < 0.1) return 0;
  return ((engine - etabs) / base) * 100;
}

function diffColor(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground';
  const abs = Math.abs(pct);
  if (abs < 10) return 'text-green-600 dark:text-green-400';
  if (abs < 25) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function fmtPct(pct: number | null): string {
  if (pct === null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/** Parse CSV text → ETABSRow[] */
function parseCSV(text: string): ETABSRow[] {
  const rows: ETABSRow[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Find header row
  let headerIdx = -1;
  let beamCol = -1, stationCol = -1, m3Col = -1;

  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const cols = lines[i].split(/[,\t;]/).map(c => c.trim().toLowerCase().replace(/['"]/g, ''));
    const bIdx = cols.findIndex(c => c === 'beam' || c === 'beamname' || c === 'beam name');
    const sIdx = cols.findIndex(c => c.includes('station') || c === 'loc' || c === 'location');
    const mIdx = cols.findIndex(c => c === 'm3' || c === 'moment' || c === 'm' || c === 'm33' || c === 'm2' || c.startsWith('m3'));
    if (bIdx >= 0 && sIdx >= 0 && mIdx >= 0) {
      headerIdx = i;
      beamCol = bIdx;
      stationCol = sIdx;
      m3Col = mIdx;
      break;
    }
  }

  if (headerIdx < 0) return [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = lines[i].split(/[,\t;]/).map(c => c.trim().replace(/['"]/g, ''));
    if (cols.length < Math.max(beamCol, stationCol, m3Col) + 1) continue;
    const beam = cols[beamCol];
    const station = parseFloat(cols[stationCol]);
    const m3 = parseFloat(cols[m3Col]);
    if (!beam || isNaN(station) || isNaN(m3)) continue;
    rows.push({ beam, station, m3 });
  }

  return rows;
}

/** Export comparison table to CSV */
function exportToCSV(rows: ComparisonRow[], hasGF: boolean, hasUC: boolean): void {
  const cols = ['Beam', 'Station (m)', 'ETABS M3 (kN·m)', '2D M (kN·m)', '3D M (kN·m)', 'FEM M (kN·m)'];
  if (hasGF) cols.push('GF M (kN·m)');
  if (hasUC) cols.push('UC M (kN·m)');
  cols.push('Δ2D%', 'Δ3D%', 'ΔFEM%');
  if (hasGF) cols.push('ΔGF%');
  if (hasUC) cols.push('ΔUC%');
  const header = cols.join(',');
  const lines = rows.map(r => {
    const c = [
      r.beam,
      r.station.toFixed(3),
      r.m3.toFixed(2),
      r.m2d !== null ? r.m2d.toFixed(2) : '',
      r.m3d !== null ? r.m3d.toFixed(2) : '',
      r.mFem !== null ? r.mFem.toFixed(2) : '',
    ];
    if (hasGF) c.push(r.mGF !== null ? r.mGF.toFixed(2) : '');
    if (hasUC) c.push(r.mUC !== null ? r.mUC.toFixed(2) : '');
    c.push(
      r.diff2d !== null ? fmtPct(r.diff2d) : '',
      r.diff3d !== null ? fmtPct(r.diff3d) : '',
      r.diffFem !== null ? fmtPct(r.diffFem) : '',
    );
    if (hasGF) c.push(r.diffGF !== null ? fmtPct(r.diffGF) : '');
    if (hasUC) c.push(r.diffUC !== null ? fmtPct(r.diffUC) : '');
    return c.join(',');
  });
  const blob = new Blob(['\uFEFF' + header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'etabs_comparison.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const DiffBadge: React.FC<{ pct: number | null }> = ({ pct }) => {
  if (pct === null) return <span className="text-muted-foreground text-xs">—</span>;
  const abs = Math.abs(pct);
  const sign = pct > 0 ? '+' : '';
  const label = `${sign}${pct.toFixed(1)}%`;
  if (abs < 10) return <Badge className="text-[10px] bg-green-500/15 text-green-700 dark:text-green-400 border-green-400/40">{label}</Badge>;
  if (abs < 25) return <Badge className="text-[10px] bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-400/40">{label}</Badge>;
  return <Badge className="text-[10px] bg-red-500/15 text-red-700 dark:text-red-400 border-red-400/40">{label}</Badge>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const ETABSImportPanel: React.FC<Props> = ({
  frameResults2D,
  frameResults3D,
  frameResultsFEM,
  frameResultsGF,
  frameResultsUC,
  beams,
  analyzed,
  onRunAnalysis,
}) => {
  const [etabsData, setEtabsData] = useState<ETABSRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedBeam, setSelectedBeam] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build beam maps from engine results
  const map2D  = useMemo(() => buildBeamMap(frameResults2D),  [frameResults2D]);
  const map3D  = useMemo(() => buildBeamMap(frameResults3D),  [frameResults3D]);
  const mapFEM = useMemo(() => frameResultsFEM ? buildBeamMap(frameResultsFEM) : null, [frameResultsFEM]);
  const mapGF  = useMemo(() => frameResultsGF  ? buildBeamMap(frameResultsGF)  : null, [frameResultsGF]);
  const mapUC  = useMemo(() => frameResultsUC  ? buildBeamMap(frameResultsUC)  : null, [frameResultsUC]);
  const hasGF = !!frameResultsGF && frameResultsGF.length > 0;
  const hasUC = !!frameResultsUC && frameResultsUC.length > 0;

  // Build beamId → span map from the model
  const beamSpanMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of beams) m.set(b.id, b.length);
    return m;
  }, [beams]);

  // Build reverse merge map: old beam ID → { mergedBeamId, offsetInMerged }
  // so ETABS data referencing old names gets mapped to the merged beam
  const mergeMap = useMemo(() => {
    const m = new Map<string, { mergedId: string; offset: number; oldLength: number }>();
    for (const b of beams) {
      if (!b.mergedFrom || b.mergedFrom.length === 0) continue;
      // We need to figure out each original beam's offset within the merged beam
      // The merged beam spans from min to max coords; originals were sorted by position during merge
      // We'll reconstruct offsets from the beamSpanMap or from the original beam data
      // Since originals are removed, we can approximate using the ETABS data stations
      // But better: store the merge info. For now, map all old IDs to the merged beam with offset 0
      // and let the station remapping happen based on ETABS data grouping
      for (const oldId of b.mergedFrom) {
        m.set(oldId, { mergedId: b.id, offset: 0, oldLength: 0 });
      }
    }
    return m;
  }, [beams]);

  // Compute comparison rows
  const comparisonRows = useMemo<ComparisonRow[]>(() => {
    if (etabsData.length === 0) return [];

    // Group ETABS rows by beam to detect merged beam station ranges
    const etabsByBeam = new Map<string, ETABSRow[]>();
    for (const row of etabsData) {
      const arr = etabsByBeam.get(row.beam) || [];
      arr.push(row);
      etabsByBeam.set(row.beam, arr);
    }

    // For merged beams: compute offset of each original beam within the merged span
    // based on ETABS station ranges
    const mergeOffsets = new Map<string, number>();
    for (const b of beams) {
      if (!b.mergedFrom || b.mergedFrom.length < 2) continue;
      // Collect max station of each original beam from ETABS data
      let runningOffset = 0;
      for (const oldId of b.mergedFrom) {
        mergeOffsets.set(oldId, runningOffset);
        const oldRows = etabsByBeam.get(oldId);
        if (oldRows && oldRows.length > 0) {
          const maxStation = Math.max(...oldRows.map(r => r.station));
          runningOffset += maxStation;
        }
      }
    }

    // Pre-compute factored UDL per beam (used as fallback when an engine
    // doesn't provide momentStations — same formula as rawMomentStationsExporter).
    const wuMap = new Map<string, number>();
    for (const b of beams) {
      wuMap.set(b.id, 1.2 * b.deadLoad + 1.6 * b.liveLoad);
    }

    return etabsData.map(row => {
      // Check if this ETABS beam was merged into another
      const mergeInfo = mergeMap.get(row.beam);
      const engineBeamId = mergeInfo ? mergeInfo.mergedId : row.beam;
      const stationOffset = mergeInfo ? (mergeOffsets.get(row.beam) ?? 0) : 0;
      const adjustedStation = row.station + stationOffset;

      const r2d = map2D.get(engineBeamId);
      const r3d = map3D.get(engineBeamId);
      const rFem = mapFEM?.get(engineBeamId);
      const rGF = mapGF?.get(engineBeamId);
      const rUC = mapUC?.get(engineBeamId);
      const span =
        r3d?.span ?? r2d?.span ?? beamSpanMap.get(engineBeamId) ?? 0;
      const wuFallback = wuMap.get(engineBeamId);

      // Evaluate every engine at the SAME ETABS station — that is the
      // unified-stations comparison principle: for each beam, the canonical
      // station grid is whatever ETABS provides.
      const m2d  = sampleMomentAt(r2d,  adjustedStation, span, wuFallback);
      const m3d  = sampleMomentAt(r3d,  adjustedStation, span, wuFallback);
      const mFem = sampleMomentAt(rFem, adjustedStation, span, wuFallback);
      const mGF  = sampleMomentAt(rGF,  adjustedStation, span, wuFallback);
      const mUC  = sampleMomentAt(rUC,  adjustedStation, span, wuFallback);

      return {
        ...row,
        beam: mergeInfo ? `${row.beam}→${engineBeamId}` : row.beam,
        span,
        m2d,
        m3d,
        mFem,
        mGF,
        mUC,
        diff2d:  m2d  !== null ? pctDiff(m2d,  row.m3) : null,
        diff3d:  m3d  !== null ? pctDiff(m3d,  row.m3) : null,
        diffFem: mFem !== null ? pctDiff(mFem, row.m3) : null,
        diffGF:  mGF  !== null ? pctDiff(mGF,  row.m3) : null,
        diffUC:  mUC  !== null ? pctDiff(mUC,  row.m3) : null,
      };
    });
  }, [etabsData, map2D, map3D, mapFEM, mapGF, mapUC, beamSpanMap, mergeMap, beams]);

  // Unique beam list from ETABS data
  const beamList = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const r of comparisonRows) {
      if (!seen.has(r.beam)) { seen.add(r.beam); list.push(r.beam); }
    }
    return list;
  }, [comparisonRows]);

  // Chart data for selected beam
  const chartData = useMemo(() => {
    const beam = selectedBeam ?? beamList[0];
    if (!beam) return [];
    const rows = comparisonRows.filter(r => r.beam === beam);
    rows.sort((a, b) => a.station - b.station);
    return rows.map(r => ({
      station: +r.station.toFixed(3),
      ETABS:   +r.m3.toFixed(2),
      '2D':    r.m2d  !== null ? +r.m2d.toFixed(2)  : null,
      '3D':    r.m3d  !== null ? +r.m3d.toFixed(2)  : null,
      FEM:     r.mFem !== null ? +r.mFem.toFixed(2) : null,
      ...(hasGF ? { GF: r.mGF !== null ? +r.mGF.toFixed(2) : null } : {}),
      ...(hasUC ? { UC: r.mUC !== null ? +r.mUC.toFixed(2) : null } : {}),
    }));
  }, [comparisonRows, selectedBeam, beamList, hasGF, hasUC]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const stats = (key: 'diff2d' | 'diff3d' | 'diffFem' | 'diffGF' | 'diffUC') => {
      const vals = comparisonRows.map(r => r[key]).filter((v): v is number => v !== null);
      if (vals.length === 0) return null;
      const avg = vals.reduce((a, b) => a + Math.abs(b), 0) / vals.length;
      const max = Math.max(...vals.map(Math.abs));
      return { avg, max };
    };
    return {
      d2d: stats('diff2d'),
      d3d: stats('diff3d'),
      dFem: stats('diffFem'),
      dGF: hasGF ? stats('diffGF') : null,
      dUC: hasUC ? stats('diffUC') : null,
    };
  }, [comparisonRows, hasGF, hasUC]);

  // ── File import ─────────────────────────────────────────────────────────────
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);

    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length === 0) {
        setError('لم يتم التعرف على تنسيق الملف. تأكد من وجود الأعمدة: Beam, Station, M3');
        setEtabsData([]);
      } else {
        setEtabsData(rows);
        setSelectedBeam(null);
      }
    };
    reader.readAsText(file, 'UTF-8');

    // Reset so same file can be re-imported
    e.target.value = '';
  }, []);

  // ── Not analyzed guard ──────────────────────────────────────────────────────
  if (!analyzed) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground mb-4">يرجى تشغيل التحليل الرئيسي أولاً لتفعيل المقارنة مع ETABS</p>
          <Button onClick={onRunAnalysis} className="min-h-[44px]">
            <BarChart3 size={16} className="mr-2" />
            تشغيل التحليل
          </Button>
        </CardContent>
      </Card>
    );
  }

  const activeBeam = selectedBeam ?? beamList[0] ?? null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── INFO HEADER ─────────────────────────────────────────────────────── */}
      <Card className="border-orange-200 dark:border-orange-800 bg-orange-500/5">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0 text-orange-500" />
            <div className="leading-relaxed">
              استورد ملف CSV من برنامج <strong>ETABS</strong> يحتوي على نتائج العزوم على طول الجسور.
              يجب أن يحتوي الملف على الأعمدة: <code className="bg-muted px-1 rounded">Beam</code>، <code className="bg-muted px-1 rounded">Station</code>، <code className="bg-muted px-1 rounded">M3</code>.
              سيتم مقارنة القيم مع نتائج المحركات الثلاثة (2D / 3D / FEM) باستخدام تحويل إحداثي لاغرانج.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── IMPORT CONTROLS ──────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="py-4 px-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="default"
              className="min-h-[40px] gap-2"
            >
              <Upload size={15} />
              استيراد ملف ETABS (CSV)
            </Button>

            {fileName && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText size={13} className="text-orange-500" />
                <span>{fileName}</span>
                <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-400/40 text-[10px]">
                  {etabsData.length} قراءة
                </Badge>
              </div>
            )}

            {comparisonRows.length > 0 && (
              <Button
                onClick={() => exportToCSV(comparisonRows, hasGF, hasUC)}
                variant="outline"
                className="min-h-[40px] gap-2 ml-auto"
              >
                <Download size={15} />
                تصدير المقارنة CSV
              </Button>
            )}
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle size={13} />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── FORMAT HINT ─────────────────────────────────────────────────────── */}
      {etabsData.length === 0 && !error && (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center">
            <p className="text-xs text-muted-foreground mb-2 font-semibold">تنسيق الملف المطلوب (CSV)</p>
            <pre className="text-[11px] bg-muted rounded p-3 inline-block text-left ltr">
{`Beam,Station,M3
B1,0.00,-45.20
B1,0.75,12.40
B1,1.50,38.60
B1,2.25,12.40
B1,3.00,-45.20
B2,0.00,-32.10
...`}
            </pre>
            <p className="text-[10px] text-muted-foreground mt-2">
              يمكن استخدام فاصلة (,) أو علامة tab أو فاصلة منقوطة (;) كفاصل بين الأعمدة
            </p>
          </CardContent>
        </Card>
      )}

      {comparisonRows.length > 0 && (
        <>
          {/* ── SUMMARY CARDS ─────────────────────────────────────────────── */}
          <div className={`grid gap-3 ${hasGF && hasUC ? 'grid-cols-2 md:grid-cols-5' : hasGF || hasUC ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3'}`}>
            {([
              { label: 'محرك 2D',  stats: summaryStats.d2d, color: 'blue' },
              { label: 'محرك 3D',  stats: summaryStats.d3d, color: 'emerald' },
              { label: 'محرك FEM', stats: summaryStats.dFem, color: 'violet' },
              ...(hasGF ? [{ label: 'محرك GF', stats: summaryStats.dGF, color: 'amber' }] : []),
              ...(hasUC ? [{ label: 'محرك UC', stats: summaryStats.dUC, color: 'purple' }] : []),
            ] as { label: string; stats: { avg: number; max: number } | null; color: string }[]).map(({ label, stats, color }) => (
              <Card key={label} className={`border-${color}-200 dark:border-${color}-800 bg-${color}-500/5`}>
                <CardContent className="py-3 px-4 text-center">
                  <p className={`text-xs font-semibold text-${color}-700 dark:text-${color}-400 mb-1`}>{label}</p>
                  {stats ? (
                    <>
                      <p className="text-[11px] text-muted-foreground">متوسط |Δ| مع ETABS</p>
                      <p className={`text-lg font-bold text-${color}-600 dark:text-${color}-400`}>{stats.avg.toFixed(1)}%</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">أقصى |Δ|: {stats.max.toFixed(1)}%</p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">غير متاح</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── BEAM SELECTOR + CHART ──────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="text-sm">مخطط توزيع العزوم على طول الجسر</CardTitle>
                <select
                  className="h-7 rounded border border-input bg-background px-2 text-xs ml-auto"
                  value={activeBeam ?? ''}
                  onChange={e => setSelectedBeam(e.target.value)}
                >
                  {beamList.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="station"
                    label={{ value: 'Station (m)', position: 'insideBottomRight', offset: -5, fontSize: 11 }}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    label={{ value: 'M (kN·m)', angle: -90, position: 'insideLeft', offset: 5, fontSize: 11 }}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(val: number) => (val !== null ? val.toFixed(2) + ' kN·m' : '—')}
                    labelFormatter={(l: number) => `Station: ${l} m`}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                  <Line dataKey="ETABS" stroke="hsl(25, 95%, 53%)"  strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
                  <Line dataKey="2D"    stroke="hsl(217, 91%, 60%)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />
                  <Line dataKey="3D"    stroke="hsl(142, 71%, 45%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />
                  <Line dataKey="FEM"   stroke="hsl(270, 80%, 60%)" strokeWidth={1.5} dot={false} strokeDasharray="2 2" connectNulls />
                  {hasGF && <Line dataKey="GF" stroke="hsl(38, 92%, 50%)"  strokeWidth={1.5} dot={false} strokeDasharray="6 2" connectNulls />}
                  {hasUC && <Line dataKey="UC" stroke="hsl(271, 76%, 53%)" strokeWidth={1.5} dot={false} strokeDasharray="3 3" connectNulls />}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* ── COMPARISON TABLE ──────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                جدول المقارنة التفصيلي
                <Badge variant="outline" className="text-[10px]">{comparisonRows.length} قراءة</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs sticky left-0 bg-background z-10">الجسر</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Station (m)</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-orange-600 dark:text-orange-400">ETABS M3 (kN·m)</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-blue-600 dark:text-blue-400">2D M (kN·m)</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-emerald-600 dark:text-emerald-400">3D M (kN·m)</TableHead>
                    <TableHead className="text-xs whitespace-nowrap text-violet-600 dark:text-violet-400">FEM M (kN·m)</TableHead>
                    {hasGF && <TableHead className="text-xs whitespace-nowrap text-amber-600 dark:text-amber-400">GF M (kN·m)</TableHead>}
                    {hasUC && <TableHead className="text-xs whitespace-nowrap text-purple-600 dark:text-purple-400">UC M (kN·m)</TableHead>}
                    <TableHead className="text-xs text-center">Δ 2D</TableHead>
                    <TableHead className="text-xs text-center">Δ 3D</TableHead>
                    <TableHead className="text-xs text-center">Δ FEM</TableHead>
                    {hasGF && <TableHead className="text-xs text-center">Δ GF</TableHead>}
                    {hasUC && <TableHead className="text-xs text-center">Δ UC</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparisonRows.map((r, i) => (
                    <TableRow
                      key={i}
                      className={`cursor-pointer transition-colors ${r.beam === activeBeam ? 'bg-muted/40' : 'hover:bg-muted/20'}`}
                      onClick={() => setSelectedBeam(r.beam)}
                    >
                      <TableCell className="font-mono text-xs font-bold sticky left-0 bg-background">{r.beam}</TableCell>
                      <TableCell className="font-mono text-xs">{r.station.toFixed(3)}</TableCell>
                      <TableCell className="font-mono text-xs text-orange-600 dark:text-orange-400">{r.m3.toFixed(2)}</TableCell>
                      <TableCell className="font-mono text-xs text-blue-600 dark:text-blue-400">
                        {r.m2d !== null ? r.m2d.toFixed(2) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
                        {r.m3d !== null ? r.m3d.toFixed(2) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-violet-600 dark:text-violet-400">
                        {r.mFem !== null ? r.mFem.toFixed(2) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      {hasGF && (
                        <TableCell className="font-mono text-xs text-amber-600 dark:text-amber-400">
                          {r.mGF !== null ? r.mGF.toFixed(2) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      )}
                      {hasUC && (
                        <TableCell className="font-mono text-xs text-purple-600 dark:text-purple-400">
                          {r.mUC !== null ? r.mUC.toFixed(2) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      )}
                      <TableCell className="text-center"><DiffBadge pct={r.diff2d} /></TableCell>
                      <TableCell className="text-center"><DiffBadge pct={r.diff3d} /></TableCell>
                      <TableCell className="text-center"><DiffBadge pct={r.diffFem} /></TableCell>
                      {hasGF && <TableCell className="text-center"><DiffBadge pct={r.diffGF} /></TableCell>}
                      {hasUC && <TableCell className="text-center"><DiffBadge pct={r.diffUC} /></TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* ── COLOR LEGEND ──────────────────────────────────────────────── */}
          <Card>
            <CardContent className="py-2 px-4">
              <div className="flex flex-wrap gap-4 text-[10px]">
                <span className="flex items-center gap-1.5">
                  <span className="w-8 h-0.5 inline-block" style={{ backgroundColor: 'hsl(25,95%,53%)', borderTop: '2.5px solid' }} />
                  ETABS (مرجع)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-8 h-0.5 inline-block" style={{ backgroundColor: 'hsl(217,91%,60%)', borderTop: '1.5px dashed' }} />
                  محرك 2D
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-8 h-0.5 inline-block" style={{ backgroundColor: 'hsl(142,71%,45%)', borderTop: '1.5px dashed' }} />
                  محرك 3D
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-8 h-0.5 inline-block" style={{ backgroundColor: 'hsl(270,80%,60%)', borderTop: '1.5px dashed' }} />
                  محرك FEM
                </span>
                <span className="flex items-center gap-1 ml-auto">
                  <span className="w-2.5 h-2.5 rounded-full inline-block bg-green-500" /> Δ &lt; 10%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full inline-block bg-yellow-500" /> Δ 10–25%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full inline-block bg-red-500" /> Δ &gt; 25%
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default ETABSImportPanel;
