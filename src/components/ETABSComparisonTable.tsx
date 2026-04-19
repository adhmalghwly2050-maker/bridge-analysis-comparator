/**
 * مقارنة نتائج التحليل بين الطريقة 2D و 3D مع إمكانية استيراد نتائج ETABS
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Upload, Download } from 'lucide-react';
import type {
  Beam, Column, Frame, FrameResult, Story,
} from '@/lib/structuralEngine';

interface ColLoad {
  Pu: number;
  Mx: number;
  My: number;
  MxTop?: number;
  MxBot?: number;
  MyTop?: number;
  MyBot?: number;
}

interface ETABSBeamData {
  beamId: string;
  Mleft: number;
  Mmid: number;
  Mright: number;
}

interface Props {
  frames: Frame[];
  beams: Beam[];
  columns: Column[];
  stories: Story[];
  frameResults3D: FrameResult[];
  frameResults2D: FrameResult[];
  frameResultsGF?: FrameResult[];
  frameResultsUC?: FrameResult[];
  colLoads3D: Map<string, ColLoad>;
  colLoads2D: Map<string, ColLoad>;
  etabsBeamData?: ETABSBeamData[];
  onEtabsDataChange?: (data: ETABSBeamData[]) => void;
}

interface BeamCompRow {
  beamId: string;
  frameId: string;
  storyLabel: string;
  span: number;
  m2d_left: number; m2d_mid: number; m2d_right: number; v2d: number;
  m3d_left: number; m3d_mid: number; m3d_right: number; v3d: number;
  mgf_left: number; mgf_mid: number; mgf_right: number; vgf: number;
  muc_left: number; muc_mid: number; muc_right: number; vuc: number;
}

interface ColCompRow {
  colId: string;
  bxh: string;
  storyLabel: string;
  pu2d: number; mx2d: number; my2d: number;
  pu3d: number; mx3d: number; my3d: number;
}

/** Parse ETABS CSV: expects columns Beam, Mleft, Mmid, Mright (or Station-based with 3 stations per beam) */
function parseEtabsBeamCSV(text: string): ETABSBeamData[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headerCols = lines[0].split(/[,\t;]/).map(c => c.trim().toLowerCase().replace(/['"]/g, ''));
  
  // Try format: Beam, Mleft, Mmid, Mright
  const beamCol = headerCols.findIndex(c => c === 'beam' || c === 'beamname' || c === 'beam name');
  const mlCol = headerCols.findIndex(c => c === 'mleft' || c === 'm_left' || c === 'ml');
  const mmCol = headerCols.findIndex(c => c === 'mmid' || c === 'm_mid' || c === 'mm' || c === 'mmidspan');
  const mrCol = headerCols.findIndex(c => c === 'mright' || c === 'm_right' || c === 'mr');

  if (beamCol >= 0 && mlCol >= 0 && mmCol >= 0 && mrCol >= 0) {
    const result: ETABSBeamData[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(/[,\t;]/).map(c => c.trim().replace(/['"]/g, ''));
      const beamId = cols[beamCol];
      const Mleft = parseFloat(cols[mlCol]);
      const Mmid = parseFloat(cols[mmCol]);
      const Mright = parseFloat(cols[mrCol]);
      if (beamId && !isNaN(Mleft) && !isNaN(Mmid) && !isNaN(Mright)) {
        result.push({ beamId, Mleft, Mmid, Mright });
      }
    }
    return result;
  }

  // Try station-based format: Beam, Station, M3
  const sCol = headerCols.findIndex(c => c.includes('station') || c === 'loc' || c === 'location');
  const m3Col = headerCols.findIndex(c => c === 'm3' || c === 'moment' || c === 'm' || c === 'm33' || c.startsWith('m3'));

  if (beamCol >= 0 && sCol >= 0 && m3Col >= 0) {
    // Group by beam, take first/mid/last station
    const byBeam = new Map<string, { station: number; m3: number }[]>();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(/[,\t;]/).map(c => c.trim().replace(/['"]/g, ''));
      const beamId = cols[beamCol];
      const station = parseFloat(cols[sCol]);
      const m3 = parseFloat(cols[m3Col]);
      if (!beamId || isNaN(station) || isNaN(m3)) continue;
      if (!byBeam.has(beamId)) byBeam.set(beamId, []);
      byBeam.get(beamId)!.push({ station, m3 });
    }
    const result: ETABSBeamData[] = [];
    for (const [beamId, stations] of byBeam) {
      stations.sort((a, b) => a.station - b.station);
      if (stations.length < 2) continue;
      const first = stations[0];
      const last = stations[stations.length - 1];
      // Find midpoint station
      const midStation = (first.station + last.station) / 2;
      let mid = stations[0];
      let minDist = Infinity;
      for (const s of stations) {
        const d = Math.abs(s.station - midStation);
        if (d < minDist) { minDist = d; mid = s; }
      }
      result.push({ beamId, Mleft: first.m3, Mmid: mid.m3, Mright: last.m3 });
    }
    return result;
  }

  return [];
}

const ETABSComparisonTable: React.FC<Props> = ({
  frames, beams, columns, stories,
  frameResults3D, frameResults2D, frameResultsGF, frameResultsUC,
  colLoads3D, colLoads2D,
  etabsBeamData: externalEtabsData,
  onEtabsDataChange,
}) => {
  const [localEtabsData, setLocalEtabsData] = useState<ETABSBeamData[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use external data if provided (for persistence), otherwise local
  const etabsData = externalEtabsData ?? localEtabsData;
  const setEtabsData = useCallback((data: ETABSBeamData[]) => {
    if (onEtabsDataChange) onEtabsDataChange(data);
    else setLocalEtabsData(data);
  }, [onEtabsDataChange]);

  // Build reverse merge map: oldBeamId → mergedBeamId
  const mergeReverseMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of beams) {
      if (b.mergedFrom && b.mergedFrom.length > 0) {
        for (const oldId of b.mergedFrom) {
          m.set(oldId, b.id);
        }
      }
    }
    return m;
  }, [beams]);

  // Build etabsMap: maps engine beamId → ETABSBeamData
  // Handles merged beams by combining constituent ETABS entries
  const etabsMap = useMemo(() => {
    const m = new Map<string, ETABSBeamData>();
    // Direct matches first
    for (const d of etabsData) {
      const mergedId = mergeReverseMap.get(d.beamId);
      if (!mergedId) {
        // Direct match - beam wasn't merged
        m.set(d.beamId, d);
      }
    }
    // Handle merged beams: group ETABS entries by their merged target
    const mergedGroups = new Map<string, ETABSBeamData[]>();
    for (const d of etabsData) {
      const mergedId = mergeReverseMap.get(d.beamId);
      if (mergedId) {
        if (!mergedGroups.has(mergedId)) mergedGroups.set(mergedId, []);
        mergedGroups.get(mergedId)!.push(d);
      }
    }
    // For each merged beam, find the constituent beams and combine
    for (const b of beams) {
      if (!b.mergedFrom || b.mergedFrom.length < 2) continue;
      const group = mergedGroups.get(b.id);
      if (!group || group.length === 0) continue;
      // Order by mergedFrom order (which follows spatial order)
      const ordered: ETABSBeamData[] = [];
      for (const oldId of b.mergedFrom) {
        const found = group.find(g => g.beamId === oldId);
        if (found) ordered.push(found);
      }
      if (ordered.length === 0) continue;
      // First beam's Mleft, last beam's Mright, weighted mid
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      // For mid-span moment, take the max absolute mid-span moment
      const maxMid = ordered.reduce((best, cur) =>
        Math.abs(cur.Mmid) > Math.abs(best.Mmid) ? cur : best
      );
      m.set(b.id, {
        beamId: b.id,
        Mleft: first.Mleft,
        Mmid: maxMid.Mmid,
        Mright: last.Mright,
      });
    }
    return m;
  }, [etabsData, mergeReverseMap, beams]);

  const hasEtabs = etabsData.length > 0;

  const beamsMap = useMemo(() => new Map(beams.map(b => [b.id, b])), [beams]);

  const beam3DMap = useMemo(() => {
    const map = new Map<string, FrameResult['beams'][number] & { frameId: string }>();
    for (const fr of frameResults3D) {
      for (const br of fr.beams) {
        map.set(br.beamId, { ...br, frameId: fr.frameId });
      }
    }
    return map;
  }, [frameResults3D]);

  const beam2DMap = useMemo(() => {
    const map = new Map<string, FrameResult['beams'][number]>();
    for (const fr of frameResults2D) {
      for (const br of fr.beams) {
        map.set(br.beamId, br);
      }
    }
    return map;
  }, [frameResults2D]);

  const beamGFMap = useMemo(() => {
    const map = new Map<string, FrameResult['beams'][number]>();
    if (frameResultsGF) {
      for (const fr of frameResultsGF) {
        for (const br of fr.beams) {
          map.set(br.beamId, br);
        }
      }
    }
    return map;
  }, [frameResultsGF]);

  const beamUCMap = useMemo(() => {
    const map = new Map<string, FrameResult['beams'][number]>();
    if (frameResultsUC) {
      for (const fr of frameResultsUC) {
        for (const br of fr.beams) {
          map.set(br.beamId, br);
        }
      }
    }
    return map;
  }, [frameResultsUC]);

  const hasGF = frameResultsGF && frameResultsGF.length > 0;
  const hasUC = frameResultsUC && frameResultsUC.length > 0;

  const beamRows = useMemo<BeamCompRow[]>(() => {
    const rows: BeamCompRow[] = [];
    for (const frame of frames) {
      for (const beamId of frame.beamIds) {
        const beam = beamsMap.get(beamId);
        if (!beam) continue;
        const r3 = beam3DMap.get(beamId);
        const r2 = beam2DMap.get(beamId);
        const rg = beamGFMap.get(beamId);
        const ru = beamUCMap.get(beamId);
        const storyLabel = stories.find(s => s.id === beam.storyId)?.label ?? '';
        rows.push({
          beamId,
          frameId: frame.id,
          storyLabel,
          span: r3?.span ?? r2?.span ?? beam.length,
          m2d_left: r2?.Mleft ?? 0, m2d_mid: r2?.Mmid ?? 0, m2d_right: r2?.Mright ?? 0, v2d: r2?.Vu ?? 0,
          m3d_left: r3?.Mleft ?? 0, m3d_mid: r3?.Mmid ?? 0, m3d_right: r3?.Mright ?? 0, v3d: r3?.Vu ?? 0,
          mgf_left: rg?.Mleft ?? 0, mgf_mid: rg?.Mmid ?? 0, mgf_right: rg?.Mright ?? 0, vgf: rg?.Vu ?? 0,
          muc_left: ru?.Mleft ?? 0, muc_mid: ru?.Mmid ?? 0, muc_right: ru?.Mright ?? 0, vuc: ru?.Vu ?? 0,
        });
      }
    }
    return rows;
  }, [frames, beamsMap, beam3DMap, beam2DMap, beamGFMap, beamUCMap, stories]);

  const colRows = useMemo<ColCompRow[]>(() => {
    return columns
      .filter(c => !c.isRemoved)
      .map(c => {
        const l3 = colLoads3D.get(c.id);
        const l2 = colLoads2D.get(c.id);
        const storyLabel = stories.find(s => s.id === c.storyId)?.label ?? '';
        return {
          colId: c.id, bxh: `${c.b}×${c.h}`, storyLabel,
          pu2d: l2?.Pu ?? 0, mx2d: l2?.Mx ?? 0, my2d: l2?.My ?? 0,
          pu3d: l3?.Pu ?? 0, mx3d: l3?.Mx ?? 0, my3d: l3?.My ?? 0,
        };
      });
  }, [columns, colLoads3D, colLoads2D, stories]);

  /** Compute (2D - ETABS) / ETABS as percentage */
  const etabsDiffPctNum = (engine: number, etabs: number): number | null => {
    if (Math.abs(etabs) < 0.01) return null;
    return ((Math.abs(engine) - Math.abs(etabs)) / Math.abs(etabs)) * 100;
  };

  const etabsDiffPct = (engine: number, etabs: number): string => {
    const v = etabsDiffPctNum(engine, etabs);
    return v === null ? '—' : v.toFixed(1) + '%';
  };

  const etabsDiffColor = (engine: number, etabs: number): string | undefined => {
    const pct = etabsDiffPctNum(engine, etabs);
    if (pct === null) return undefined;
    const absPct = Math.abs(pct);
    if (absPct < 5) return 'hsl(142 71% 45%)';
    if (absPct < 15) return 'hsl(45 93% 47%)';
    return 'hsl(0 84.2% 60.2%)';
  };

  const diffPctNum = (a: number, b: number): number | null => {
    if (Math.abs(a) < 0.01 && Math.abs(b) < 0.01) return null;
    const base = Math.max(Math.abs(a), Math.abs(b));
    return (Math.abs(Math.abs(b) - Math.abs(a)) / base) * 100;
  };

  const diffPct = (a: number, b: number): string => {
    const v = diffPctNum(a, b);
    return v === null ? '—' : v.toFixed(1) + '%';
  };

  const diffColor = (a: number, b: number): string | undefined => {
    const pct = diffPctNum(a, b);
    if (pct === null) return undefined;
    if (pct < 5) return 'hsl(142 71% 45%)';
    if (pct < 15) return 'hsl(45 93% 47%)';
    return 'hsl(0 84.2% 60.2%)';
  };

  // Average differences between ETABS and engines using |((engine - ETABS) / ETABS)|
  const avgDiffs = useMemo(() => {
    if (!hasEtabs) return null;
    const diffs2d: number[] = [];
    const diffs3d: number[] = [];
    const diffsGF: number[] = [];
    const diffsUC: number[] = [];
    for (const r of beamRows) {
      const etabs = etabsMap.get(r.beamId);
      if (!etabs) continue;
      for (const [eng, et] of [
        [r.m2d_left, etabs.Mleft], [r.m2d_mid, etabs.Mmid], [r.m2d_right, etabs.Mright],
      ] as [number, number][]) {
        const d = etabsDiffPctNum(eng, et);
        if (d !== null) diffs2d.push(Math.abs(d));
      }
      for (const [eng, et] of [
        [r.m3d_left, etabs.Mleft], [r.m3d_mid, etabs.Mmid], [r.m3d_right, etabs.Mright],
      ] as [number, number][]) {
        const d = etabsDiffPctNum(eng, et);
        if (d !== null) diffs3d.push(Math.abs(d));
      }
      for (const [eng, et] of [
        [r.mgf_left, etabs.Mleft], [r.mgf_mid, etabs.Mmid], [r.mgf_right, etabs.Mright],
      ] as [number, number][]) {
        const d = etabsDiffPctNum(eng, et);
        if (d !== null) diffsGF.push(Math.abs(d));
      }
      for (const [eng, et] of [
        [r.muc_left, etabs.Mleft], [r.muc_mid, etabs.Mmid], [r.muc_right, etabs.Mright],
      ] as [number, number][]) {
        const d = etabsDiffPctNum(eng, et);
        if (d !== null) diffsUC.push(Math.abs(d));
      }
    }
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    return {
      avg2d: avg(diffs2d), avg3d: avg(diffs3d), avgGF: avg(diffsGF), avgUC: avg(diffsUC),
      count2d: diffs2d.length, count3d: diffs3d.length, countGF: diffsGF.length, countUC: diffsUC.length,
    };
  }, [beamRows, etabsMap, hasEtabs]);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parsed = parseEtabsBeamCSV(text);
      if (parsed.length > 0) setEtabsData(parsed);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  }, [setEtabsData]);

  if (beamRows.length === 0 && colRows.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* وصف المنهجية */}
      <Card>
        <CardContent className="py-3 space-y-1">
          <p className="text-xs font-medium">منهجية المقارنة</p>
          <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground">
            <span><span className="font-semibold text-blue-500">2D</span>{' '}= Matrix Stiffness Method (إطارات مستوية · 2 DOF/عقدة · EI كاملة · Pattern Loading)</span>
            <span><span className="font-semibold text-emerald-500">3D</span>{' '}= Direct Stiffness 3D (6 DOF/عقدة · معاملات ACI 318-19 §6.6.3 · Pattern Loading §6.4.3)</span>
            {hasGF && <span><span className="font-semibold text-amber-500">GF</span>{' '}= Global Frame Solver (ETABS-like · عقد مشتركة · مصفوفة واحدة)</span>}
            {hasUC && <span><span className="font-semibold text-purple-500">UC</span>{' '}= Unified Core (محرك موحّد)</span>}
            {hasEtabs && <span><span className="font-semibold text-orange-500">ETABS</span>{' '}= نتائج مستوردة من برنامج ETABS</span>}
          </div>
        </CardContent>
      </Card>

      {/* جدول مقارنة الجسور */}
      {beamRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                مقارنة القوى الداخلية للجسور
                <Badge variant="outline" className="text-[10px]">2D مقابل 3D{hasEtabs ? ' مقابل ETABS' : ''}</Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                {hasEtabs && (
                  <Badge className="text-[10px] bg-green-500/15 text-green-700 dark:text-green-400 border-green-400/40">
                    ✓ تم استيراد {etabsData.length} جسر من ETABS
                  </Badge>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={handleFileImport}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} />
                  {hasEtabs ? 'إعادة استيراد ETABS' : 'استيراد نتائج ETABS'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => {
                    const rows = beamRows.map(r => {
                      const etabs = etabsMap.get(r.beamId);
                      return [
                        r.storyLabel, r.frameId, r.beamId, r.span.toFixed(2),
                        r.m2d_left.toFixed(1), r.m2d_mid.toFixed(1), r.m2d_right.toFixed(1),
                        r.m3d_left.toFixed(1), r.m3d_mid.toFixed(1), r.m3d_right.toFixed(1),
                        r.mgf_left.toFixed(1), r.mgf_mid.toFixed(1), r.mgf_right.toFixed(1),
                        r.muc_left.toFixed(1), r.muc_mid.toFixed(1), r.muc_right.toFixed(1),
                        etabs ? etabs.Mleft.toFixed(1) : '', etabs ? etabs.Mmid.toFixed(1) : '', etabs ? etabs.Mright.toFixed(1) : '',
                      ].join(',');
                    });
                    const header = 'الدور,الإطار,الجسر,البحر(م),M2D_يسار,M2D_منتصف,M2D_يمين,M3D_يسار,M3D_منتصف,M3D_يمين,MGF_يسار,MGF_منتصف,MGF_يمين,MUC_يسار,MUC_منتصف,MUC_يمين,ETABS_يسار,ETABS_منتصف,ETABS_يمين';
                    const csv = '\uFEFF' + header + '\n' + rows.join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'moments_comparison.csv'; a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download size={14} />
                  تصدير المقارنة
                </Button>
              </div>
            </div>
            {!hasEtabs && (
              <p className="text-[10px] text-muted-foreground mt-1">
                يمكنك استيراد ملف CSV من ETABS يحتوي على الأعمدة: <code className="bg-muted px-1 rounded">Beam, Mleft, Mmid, Mright</code> أو <code className="bg-muted px-1 rounded">Beam, Station, M3</code>
              </p>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">الدور</TableHead>
                  <TableHead className="text-xs">الإطار</TableHead>
                  <TableHead className="text-xs">الجسر</TableHead>
                  <TableHead className="text-xs">البحر (م)</TableHead>
                  {(() => {
                    let base = 2; // 2D, 3D
                    if (hasGF) base++;
                    if (hasUC) base++;
                    if (hasEtabs) base += 1 + 2 + (hasGF ? 1 : 0) + (hasUC ? 1 : 0); // ETABS + Δ2D + Δ3D + ΔGF? + ΔUC?
                    else base += 1; // Δ%
                    const mColSpan = base;
                    let vBase = 2 + (hasGF ? 1 : 0) + (hasUC ? 1 : 0) + 1; // 2D,3D,GF?,UC?,Δ%
                    return (
                      <>
                        <TableHead className="text-[10px] text-center" colSpan={mColSpan}>M يسار (kN·m)</TableHead>
                        <TableHead className="text-[10px] text-center" colSpan={mColSpan}>M منتصف (kN·m)</TableHead>
                        <TableHead className="text-[10px] text-center" colSpan={mColSpan}>M يمين (kN·m)</TableHead>
                        <TableHead className="text-[10px] text-center" colSpan={vBase}>Vu (kN)</TableHead>
                      </>
                    );
                  })()}
                </TableRow>
                <TableRow>
                  <TableHead /><TableHead /><TableHead /><TableHead />
                  {/* M يسار */}
                  {['2D','3D', ...(hasGF ? ['GF'] : []), ...(hasUC ? ['UC'] : []), ...(hasEtabs ? ['ETABS','Δ2D','Δ3D', ...(hasGF ? ['ΔGF'] : []), ...(hasUC ? ['ΔUC'] : [])] : ['Δ%'])].map((h, i) => (
                    <TableHead key={`l${i}`} className="text-[10px] text-center px-1">{h}</TableHead>
                  ))}
                  {/* M منتصف */}
                  {['2D','3D', ...(hasGF ? ['GF'] : []), ...(hasUC ? ['UC'] : []), ...(hasEtabs ? ['ETABS','Δ2D','Δ3D', ...(hasGF ? ['ΔGF'] : []), ...(hasUC ? ['ΔUC'] : [])] : ['Δ%'])].map((h, i) => (
                    <TableHead key={`m${i}`} className="text-[10px] text-center px-1">{h}</TableHead>
                  ))}
                  {/* M يمين */}
                  {['2D','3D', ...(hasGF ? ['GF'] : []), ...(hasUC ? ['UC'] : []), ...(hasEtabs ? ['ETABS','Δ2D','Δ3D', ...(hasGF ? ['ΔGF'] : []), ...(hasUC ? ['ΔUC'] : [])] : ['Δ%'])].map((h, i) => (
                    <TableHead key={`r${i}`} className="text-[10px] text-center px-1">{h}</TableHead>
                  ))}
                  {/* Vu */}
                  {['2D','3D', ...(hasGF ? ['GF'] : []), ...(hasUC ? ['UC'] : []),'Δ%'].map((h, i) => (
                    <TableHead key={`v${i}`} className="text-[10px] text-center px-1">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {beamRows.map(r => {
                  const etabs = etabsMap.get(r.beamId);
                  const MomentCells = ({ m2d, m3d, mgf, muc, mEtabs }: { m2d: number; m3d: number; mgf: number; muc: number; mEtabs?: number }) => (
                    <>
                      <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{m2d.toFixed(1)}</TableCell>
                      <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{m3d.toFixed(1)}</TableCell>
                      {hasGF && <TableCell className="font-mono text-xs text-center px-1 text-amber-600 dark:text-amber-400">{mgf.toFixed(1)}</TableCell>}
                      {hasUC && <TableCell className="font-mono text-xs text-center px-1 text-purple-600 dark:text-purple-400">{muc.toFixed(1)}</TableCell>}
                      {hasEtabs ? (
                        <>
                          <TableCell className="font-mono text-xs text-center px-1 text-orange-600 dark:text-orange-400">{mEtabs !== undefined ? mEtabs.toFixed(1) : '—'}</TableCell>
                          <TableCell className="font-mono text-xs text-center px-1" style={{ color: mEtabs !== undefined ? etabsDiffColor(m2d, mEtabs) : undefined }}>{mEtabs !== undefined ? etabsDiffPct(m2d, mEtabs) : '—'}</TableCell>
                          <TableCell className="font-mono text-xs text-center px-1" style={{ color: mEtabs !== undefined ? etabsDiffColor(m3d, mEtabs) : undefined }}>{mEtabs !== undefined ? etabsDiffPct(m3d, mEtabs) : '—'}</TableCell>
                          {hasGF && <TableCell className="font-mono text-xs text-center px-1" style={{ color: mEtabs !== undefined ? etabsDiffColor(mgf, mEtabs) : undefined }}>{mEtabs !== undefined ? etabsDiffPct(mgf, mEtabs) : '—'}</TableCell>}
                          {hasUC && <TableCell className="font-mono text-xs text-center px-1" style={{ color: mEtabs !== undefined ? etabsDiffColor(muc, mEtabs) : undefined }}>{mEtabs !== undefined ? etabsDiffPct(muc, mEtabs) : '—'}</TableCell>}
                        </>
                      ) : (
                        <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(m2d, m3d) }}>{diffPct(m2d, m3d)}</TableCell>
                      )}
                    </>
                  );
                  return (
                    <TableRow key={`${r.frameId}-${r.beamId}`}>
                      <TableCell className="text-xs text-muted-foreground">{r.storyLabel}</TableCell>
                      <TableCell className="font-mono text-xs">{r.frameId}</TableCell>
                      <TableCell className="font-mono text-xs font-bold">{r.beamId}</TableCell>
                      <TableCell className="font-mono text-xs">{r.span.toFixed(2)}</TableCell>
                      
                      <MomentCells m2d={r.m2d_left} m3d={r.m3d_left} mgf={r.mgf_left} muc={r.muc_left} mEtabs={etabs?.Mleft} />
                      <MomentCells m2d={r.m2d_mid} m3d={r.m3d_mid} mgf={r.mgf_mid} muc={r.muc_mid} mEtabs={etabs?.Mmid} />
                      <MomentCells m2d={r.m2d_right} m3d={r.m3d_right} mgf={r.mgf_right} muc={r.muc_right} mEtabs={etabs?.Mright} />

                      {/* Vu */}
                      <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.v2d.toFixed(1)}</TableCell>
                      <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.v3d.toFixed(1)}</TableCell>
                      {hasGF && <TableCell className="font-mono text-xs text-center px-1 text-amber-600 dark:text-amber-400">{r.vgf.toFixed(1)}</TableCell>}
                      {hasUC && <TableCell className="font-mono text-xs text-center px-1 text-purple-600 dark:text-purple-400">{r.vuc.toFixed(1)}</TableCell>}
                      <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.v2d, r.v3d) }}>{diffPct(r.v2d, r.v3d)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {/* ملخص متوسط الفارق */}
            {avgDiffs && (
              <div className="mt-3 flex flex-wrap gap-4 px-2 pb-2">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="text-muted-foreground">متوسط |الفارق|</span>
                  <Badge className="text-[10px] bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-400/40">
                    2D↔ETABS: {avgDiffs.avg2d !== null ? avgDiffs.avg2d.toFixed(1) + '%' : '—'}
                  </Badge>
                  <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-400/40">
                    3D↔ETABS: {avgDiffs.avg3d !== null ? avgDiffs.avg3d.toFixed(1) + '%' : '—'}
                  </Badge>
                  {avgDiffs.avgGF !== null && (
                    <Badge className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-400/40">
                      GF↔ETABS: {avgDiffs.avgGF.toFixed(1) + '%'}
                    </Badge>
                  )}
                  {avgDiffs.avgUC !== null && (
                    <Badge className="text-[10px] bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-400/40">
                      UC↔ETABS: {avgDiffs.avgUC.toFixed(1) + '%'}
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    ({avgDiffs.count2d} قيمة)
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* جدول مقارنة الأعمدة */}
      {colRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              مقارنة القوى الداخلية للأعمدة
              <Badge variant="outline" className="text-[10px]">2D مقابل 3D</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              2D = توزيع العزوم بنسبة الجساءة (من ردود أفعال الجسور) ·
              3D = تحليل مباشر بالإطار الفراغي
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">الدور</TableHead>
                  <TableHead className="text-xs">العمود</TableHead>
                  <TableHead className="text-xs">المقطع</TableHead>
                  <TableHead className="text-[10px] text-center" colSpan={3}>Pu (kN)</TableHead>
                  <TableHead className="text-[10px] text-center" colSpan={3}>Mx (kN·m)</TableHead>
                  <TableHead className="text-[10px] text-center" colSpan={3}>My (kN·m)</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead /><TableHead /><TableHead />
                  {['2D','3D','Δ%','2D','3D','Δ%','2D','3D','Δ%'].map((h, i) => (
                    <TableHead key={i} className="text-[10px] text-center px-1">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {colRows.map(r => (
                  <TableRow key={r.colId}>
                    <TableCell className="text-xs text-muted-foreground">{r.storyLabel}</TableCell>
                    <TableCell className="font-mono text-xs font-bold">{r.colId}</TableCell>
                    <TableCell className="font-mono text-xs">{r.bxh}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.pu2d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.pu3d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.pu2d, r.pu3d) }}>{diffPct(r.pu2d, r.pu3d)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.mx2d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.mx3d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.mx2d, r.mx3d) }}>{diffPct(r.mx2d, r.mx3d)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-blue-600 dark:text-blue-400">{r.my2d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1 text-emerald-600 dark:text-emerald-400">{r.my3d.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs text-center px-1" style={{ color: diffColor(r.my2d, r.my3d) }}>{diffPct(r.my2d, r.my3d)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* مفتاح الألوان */}
      <Card>
        <CardContent className="py-2">
          <div className="flex gap-5 text-[10px] flex-wrap">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block bg-blue-500 opacity-70" />
              قيم 2D (Matrix Stiffness)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block bg-emerald-500 opacity-70" />
              قيم 3D (المعتمدة في التصميم)
            </span>
            {hasGF && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full inline-block bg-amber-500 opacity-70" />
                قيم GF (Global Frame)
              </span>
            )}
            {hasEtabs && (
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full inline-block bg-orange-500 opacity-70" />
                قيم ETABS (مستوردة)
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: 'hsl(142 71% 45%)' }} />
              Δ &lt; 5% — فرق مقبول
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: 'hsl(45 93% 47%)' }} />
              Δ 5–15% — فرق متوسط
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: 'hsl(0 84.2% 60.2%)' }} />
              Δ &gt; 15% — فرق كبير
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ETABSComparisonTable;
