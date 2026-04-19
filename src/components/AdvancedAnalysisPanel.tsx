/**
 * Advanced Analysis Panel
 * ───────────────────────────────────────────────────────────────────
 * UI لتشغيل تحليل ACI 318-19 / ASCE 7-22 الكامل:
 *   • معامل تخفيض جساءة الأعمدة قابل للتعديل (الافتراضي 0.70)
 *   • تفعيل/إيقاف Pattern Loading
 *   • تفعيل/إيقاف P-Delta
 *   • اختيار توافيق الأحمال (D, L, W, E, ...)
 *   • عرض غلاف القوى Mmax/Mmin/Vmax لكل جسر
 */

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Play, ShieldCheck } from 'lucide-react';
import {
  runAdvancedFrameAnalysis,
  type AdvancedFrameAnalysisResult,
} from '@/lib/advancedFrameAnalysis';
import type { Beam, Column, Frame, MatProps, BeamOnBeamConnection, Slab, SlabProps } from '@/lib/structuralEngine';

interface Props {
  frames: Frame[];
  beams: Beam[];
  columns: Column[];
  mat: MatProps;
  bobConnections?: BeamOnBeamConnection[];
  slabs?: Slab[];
  slabProps?: SlabProps;
  beamStiffnessFactor: number;
  colStiffnessFactor: number;
  onColStiffnessChange?: (v: number) => void;
}

export default function AdvancedAnalysisPanel({
  frames, beams, columns, mat, bobConnections, slabs, slabProps,
  beamStiffnessFactor, colStiffnessFactor, onColStiffnessChange,
}: Props) {
  const [enablePattern, setEnablePattern] = useState(true);
  const [enablePDelta, setEnablePDelta] = useState(false);
  const [hasWind, setHasWind] = useState(false);
  const [hasSeismic, setHasSeismic] = useState(false);
  const [colFactor, setColFactor] = useState(colStiffnessFactor);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AdvancedFrameAnalysisResult | null>(null);

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      try {
        const res = runAdvancedFrameAnalysis(
          frames, beams, columns, mat,
          {
            enablePatternLoading: enablePattern,
            enablePDelta,
            beamStiffnessFactor,
            colStiffnessFactor: colFactor,
            hasLive: true,
            hasWind,
            hasSeismic,
          },
          bobConnections, slabs, slabProps,
        );
        setResult(res);
        onColStiffnessChange?.(colFactor);
      } finally {
        setRunning(false);
      }
    }, 0);
  };

  const envelopeRows = useMemo(() => {
    if (!result) return [];
    return Array.from(result.envelope.values()).slice(0, 100);
  }, [result]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" />
            تحليل متقدم وفق ACI 318-19 / ASCE 7-22
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stiffness factor */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <Label htmlFor="colF" className="text-xs">
                معامل تخفيض جساءة الأعمدة (ACI §6.6.3.1.1)
              </Label>
              <Input
                id="colF"
                type="number"
                step={0.05}
                min={0.1}
                max={1.0}
                value={colFactor}
                onChange={(e) => setColFactor(Number(e.target.value) || 0.7)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                الموصى به: 0.70 للأعمدة، 1.0 لتحليل الخدمة
              </p>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>الجسور: <Badge variant="secondary">{beamStiffnessFactor.toFixed(2)}</Badge></div>
              <div>افتراضي ACI: 0.35·Ig للجسور، 0.70·Ig للأعمدة</div>
            </div>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-3 rounded-md border">
              <div>
                <Label className="text-xs font-medium">Pattern Loading</Label>
                <p className="text-[10px] text-muted-foreground">ACI §6.4.3</p>
              </div>
              <Switch checked={enablePattern} onCheckedChange={setEnablePattern} />
            </div>
            <div className="flex items-center justify-between p-3 rounded-md border">
              <div>
                <Label className="text-xs font-medium">P-Delta (تكراري)</Label>
                <p className="text-[10px] text-muted-foreground">ACI §6.6.4</p>
              </div>
              <Switch checked={enablePDelta} onCheckedChange={setEnablePDelta} />
            </div>
            <div className="flex items-center justify-between p-3 rounded-md border">
              <div>
                <Label className="text-xs font-medium">حمل رياح (W)</Label>
                <p className="text-[10px] text-muted-foreground">يضيف توافيق 1.2D+W، 0.9D+W</p>
              </div>
              <Switch checked={hasWind} onCheckedChange={setHasWind} />
            </div>
            <div className="flex items-center justify-between p-3 rounded-md border">
              <div>
                <Label className="text-xs font-medium">حمل زلزالي (E)</Label>
                <p className="text-[10px] text-muted-foreground">يضيف توافيق 1.2D+E، 0.9D+E</p>
              </div>
              <Switch checked={hasSeismic} onCheckedChange={setHasSeismic} />
            </div>
          </div>

          <Button onClick={run} disabled={running} className="w-full">
            {running ? <Loader2 className="size-4 animate-spin mr-2" /> : <Play className="size-4 mr-2" />}
            تشغيل التحليل المتقدم
          </Button>
        </CardContent>
      </Card>

      {result && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">ملخص التشغيل</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div>عدد توافيق الأحمال: <Badge>{result.combos.length}</Badge></div>
              <div>عدد أنماط التحميل: <Badge>{result.patternsUsed.length || 1}</Badge></div>
              <div>إجمالي عمليات الحل: <Badge variant="secondary">{result.runs.length}</Badge></div>
              <div>زمن التحليل: <Badge variant="outline">{result.totalTimeMs.toFixed(0)} ms</Badge></div>
              <div className="pt-2 border-t">
                <div className="font-medium mb-1">التوافيق المُشغَّلة:</div>
                <div className="flex flex-wrap gap-1">
                  {result.combos.map(c => (
                    <Badge key={c.id} variant="outline" className="text-[10px]">{c.id}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">غلاف القوى لكل جسر (Envelope)</CardTitle>
            </CardHeader>
            <CardContent>
              {envelopeRows.length === 0 ? (
                <Alert><AlertDescription>لا توجد نتائج</AlertDescription></Alert>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الجسر</TableHead>
                        <TableHead>+M max (kN·m)</TableHead>
                        <TableHead>−M min (kN·m)</TableHead>
                        <TableHead>توافيق الحاكم</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {envelopeRows.map(e => (
                        <TableRow key={e.elementId}>
                          <TableCell className="font-mono text-[11px]">{e.elementId}</TableCell>
                          <TableCell className="text-[11px]">{e.Mmax.value.toFixed(2)}</TableCell>
                          <TableCell className="text-[11px]">{e.Mmin.value.toFixed(2)}</TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">
                            +M: {e.Mmax.comboId} · −M: {e.Mmin.comboId}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
