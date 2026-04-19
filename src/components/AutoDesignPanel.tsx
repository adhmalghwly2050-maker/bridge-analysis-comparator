import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Wand2, CheckCircle2, AlertTriangle, ArrowRight, Layers, RectangleHorizontal, Columns } from 'lucide-react';
import { runAutoDesign, type AutoDesignInput, type AutoDesignResult } from '@/lib/autoDesigner';
import type { Slab } from '@/lib/structuralEngine';

interface AutoDesignPanelProps {
  slabs: Slab[];
  onApply: (result: AutoDesignResult) => void;
}

export default function AutoDesignPanel({ slabs, onApply }: AutoDesignPanelProps) {
  const [finishLoad, setFinishLoad] = useState(2);
  const [liveLoad, setLiveLoad] = useState(2);
  const [wallLoad, setWallLoad] = useState(0);
  const [fc, setFc] = useState(21);
  const [fy, setFy] = useState(280);
  const [fyt, setFyt] = useState(280);
  const [gamma, setGamma] = useState(25);
  const [floorHeight, setFloorHeight] = useState(4000);
  const [numFloors, setNumFloors] = useState(1);
  const [result, setResult] = useState<AutoDesignResult | null>(null);

  const canRun = slabs.length > 0;

  const handleRun = () => {
    const input: AutoDesignInput = {
      slabs, finishLoad, liveLoad, wallLoad,
      fc, fy, fyt, gamma, floorHeight, numFloors,
    };
    const r = runAutoDesign(input);
    setResult(r);
  };

  const handleApply = () => {
    if (result) onApply(result);
  };

  const ParamField = ({ label, value, onChange, unit }: { label: string; value: number; onChange: (v: number) => void; unit?: string }) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label} {unit && <span className="text-[10px]">({unit})</span>}</label>
      <Input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="h-9 font-mono text-sm" />
    </div>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-accent/20">
          <Wand2 className="text-accent" size={24} />
        </div>
        <div>
          <h2 className="text-base font-bold">التصميم التلقائي</h2>
          <p className="text-xs text-muted-foreground">أدخل الأحمال فقط — سيقترح التطبيق الأبعاد والتسليح وفقاً لـ ACI 318-19</p>
        </div>
      </div>

      {/* Input Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers size={14} /> الأحمال
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <ParamField label="أحمال التشطيب" value={finishLoad} onChange={setFinishLoad} unit="kN/m²" />
            <ParamField label="الحمل الحي" value={liveLoad} onChange={setLiveLoad} unit="kN/m²" />
            <ParamField label="حمل الجدران" value={wallLoad} onChange={setWallLoad} unit="kN/m" />
            <ParamField label="عدد الطوابق" value={numFloors} onChange={setNumFloors} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <RectangleHorizontal size={14} /> خصائص المواد
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <ParamField label="f'c" value={fc} onChange={setFc} unit="MPa" />
            <ParamField label="fy" value={fy} onChange={setFy} unit="MPa" />
            <ParamField label="fyt" value={fyt} onChange={setFyt} unit="MPa" />
            <ParamField label="γ الخرسانة" value={gamma} onChange={setGamma} unit="kN/m³" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Columns size={14} /> الهندسة
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3">
            <ParamField label="ارتفاع الطابق" value={floorHeight} onChange={setFloorHeight} unit="mm" />
            <div className="p-2 rounded bg-muted text-xs text-muted-foreground">
              <p>عرض الجدران (الجسور) = <strong>200 مم</strong> (ثابت)</p>
              <p>سماكة البلاطات = <strong>موحدة</strong> لجميع البلاطات</p>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleRun} disabled={!canRun} className="w-full min-h-[44px] gap-2">
              <Wand2 size={16} /> تشغيل التصميم التلقائي
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* No slabs warning */}
      {slabs.length === 0 && (
        <Card className="border-destructive/50">
          <CardContent className="py-6 text-center">
            <AlertTriangle className="mx-auto text-destructive mb-2" size={24} />
            <p className="text-sm text-destructive">يرجى إضافة بلاطات أولاً في تبويب الإدخال</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="bg-accent/5 border-accent/30">
              <CardContent className="py-4 text-center">
                <p className="text-[10px] text-muted-foreground mb-1">سماكة البلاطة</p>
                <p className="text-2xl font-bold text-accent">{result.slabThickness} <span className="text-sm">مم</span></p>
              </CardContent>
            </Card>
            <Card className="bg-primary/5 border-primary/30">
              <CardContent className="py-4 text-center">
                <p className="text-[10px] text-muted-foreground mb-1">الجسر</p>
                <p className="text-2xl font-bold text-primary">{result.beamB}×{result.beamH} <span className="text-sm">مم</span></p>
              </CardContent>
            </Card>
            <Card className="bg-secondary/5 border-secondary/30">
              <CardContent className="py-4 text-center">
                <p className="text-[10px] text-muted-foreground mb-1">العمود</p>
                <p className="text-2xl font-bold">{result.colB}×{result.colH} <span className="text-sm">مم</span></p>
              </CardContent>
            </Card>
          </div>

          {/* Slab Details Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">تفاصيل البلاطات</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {['البلاطة', 'Lx (م)', 'Ly (م)', 'β', 'النوع', 'h_min (مم)', 'حواف منقطعة', 'h مستخدم'].map(h => (
                      <TableHead key={h} className="text-xs">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.slabDetails.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">{d.id}</TableCell>
                      <TableCell className="font-mono text-xs">{d.lx.toFixed(2)}</TableCell>
                      <TableCell className="font-mono text-xs">{d.ly.toFixed(2)}</TableCell>
                      <TableCell className="font-mono text-xs">{d.beta.toFixed(2)}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={d.isOneWay ? "secondary" : "default"} className="text-[10px]">
                          {d.isOneWay ? 'اتجاه واحد' : 'اتجاهين'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.hMin.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-xs">{d.discontinuousEdges}</TableCell>
                      <TableCell className="font-mono text-xs font-bold text-accent">{result.slabThickness}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Beam Spans Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">تفاصيل أبعاد الجسور (b = {result.beamB} مم ثابت)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {['البحر', 'h_min (بسيط)', 'h_min (طرف واحد)', 'h_min (مستمر)', 'h مستخدم'].map(h => (
                      <TableHead key={h} className="text-xs">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.beamDetails.map((bd, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{bd.label}</TableCell>
                      <TableCell className="font-mono text-xs">{bd.hMinSimple.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-xs">{bd.hMinOneEnd.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-xs">{bd.hMinBothEnds.toFixed(0)}</TableCell>
                      <TableCell className="font-mono text-xs font-bold text-primary">{bd.hUsed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Column Detail */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">تفاصيل تصميم العمود</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">Pu التقديري</p>
                  <p className="font-mono font-bold">{result.columnDetail.estimatedPu.toFixed(0)} kN</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Ag المطلوبة</p>
                  <p className="font-mono font-bold">{result.columnDetail.requiredArea.toFixed(0)} mm²</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">الأبعاد المقترحة</p>
                  <p className="font-mono font-bold">{result.columnDetail.suggestedB}×{result.columnDetail.suggestedH} mm</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">ρ المفترضة</p>
                  <p className="font-mono font-bold">{(result.columnDetail.rhoAssumed * 100).toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">ملاحظات التصميم</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {result.notes.map((note, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {note.text.includes('⚠️') ? (
                    <AlertTriangle size={14} className="text-yellow-500 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 size={14} className="text-green-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p>{note.text}</p>
                    {note.aciRef && <p className="text-[10px] text-muted-foreground">{note.aciRef}</p>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Apply Button */}
          <Button onClick={handleApply} size="lg" className="w-full min-h-[48px] gap-2 text-base">
            <ArrowRight size={18} /> تطبيق الأبعاد على النموذج
          </Button>
        </div>
      )}
    </div>
  );
}
