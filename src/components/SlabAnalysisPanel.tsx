/**
 * تبويب تحليل البلاطات المستمرة — ACI 318-19
 * يعرض نتائج التحليل بطريقة الشريحة (1م) في اتجاه X و Y
 */
import React, { useMemo, useState, type ReactElement } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Calculator, ArrowRight, Layers } from 'lucide-react';
import type { Slab, SlabProps, MatProps } from '@/lib/structuralEngine';
import { analyzeAllContinuousSlabs, type ContinuousSlabResult } from '@/lib/continuousSlabAnalysis';

interface SlabAnalysisPanelProps {
  slabs: Slab[];
  slabProps: SlabProps;
  mat: MatProps;
}

export default function SlabAnalysisPanel({ slabs, slabProps, mat }: SlabAnalysisPanelProps) {
  const [results, setResults] = useState<ContinuousSlabResult[] | null>(null);
  const [selectedStrip, setSelectedStrip] = useState<string | null>(null);

  const runAnalysis = () => {
    const r = analyzeAllContinuousSlabs(slabs, slabProps, mat);
    setResults(r);
    if (r.length > 0) setSelectedStrip(r[0].stripId);
  };

  const xStrips = results?.filter(r => r.direction === 'X') || [];
  const yStrips = results?.filter(r => r.direction === 'Y') || [];
  const activeResult = results?.find(r => r.stripId === selectedStrip);

  if (slabs.length < 2) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Layers size={32} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            يجب إدخال بلاطتين متجاورتين على الأقل لتحليل البلاطات المستمرة
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <Card className="border-teal-200 dark:border-teal-800 bg-teal-500/5">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Calculator size={16} className="text-teal-600" />
              <span className="text-sm font-semibold">تحليل البلاطات المستمرة — ACI 318-19 §6.5</span>
            </div>
            <Button onClick={runAnalysis} size="sm" className="min-h-[36px] bg-teal-600 hover:bg-teal-700">
              <Calculator size={14} className="mr-1" />
              تشغيل التحليل
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            طريقة الشريحة (عرض 1 متر) باستخدام معاملات العزم التقريبية — ACI 318-19 Table 6.5.2
          </p>
        </CardContent>
      </Card>

      {results && results.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            لم يتم اكتشاف بلاطات مستمرة (متجاورة). تأكد من أن البلاطات متصلة ببعضها.
          </CardContent>
        </Card>
      )}

      {results && results.length > 0 && (
        <Tabs defaultValue="strips" className="space-y-2">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="strips" className="text-xs">الشرائط المكتشفة</TabsTrigger>
            <TabsTrigger value="details" className="text-xs">تفاصيل النتائج</TabsTrigger>
            <TabsTrigger value="summary" className="text-xs">ملخص</TabsTrigger>
          </TabsList>

          {/* ── قائمة الشرائط ── */}
          <TabsContent value="strips" className="space-y-3">
            {xStrips.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowRight size={14} className="text-blue-500" />
                    شرائط اتجاه X ({xStrips.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {xStrips.map(s => (
                      <div
                        key={s.stripId}
                        onClick={() => setSelectedStrip(s.stripId)}
                        className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                          selectedStrip === s.stripId
                            ? 'border-teal-400 bg-teal-500/10'
                            : 'border-border hover:border-teal-300 hover:bg-muted/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{s.stripId}</Badge>
                            <span className="text-xs">Y = {s.fixedCoord.toFixed(1)}m</span>
                            <span className="text-[10px] text-muted-foreground">
                              ({s.spans.length} بحرات)
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground">
                            M⁺={s.maxPositiveMoment.toFixed(1)} | M⁻={s.maxNegativeMoment.toFixed(1)} kN.m
                          </div>
                        </div>
                        <div className="flex gap-1 mt-1">
                          {s.spans.map((sp, i) => (
                            <React.Fragment key={i}>
                              {i > 0 && <div className="w-px bg-foreground/30 self-stretch" />}
                              <div className="text-[9px] text-center flex-1 px-1 py-0.5 rounded bg-muted/50">
                                {sp.slabId} ({sp.spanLength.toFixed(1)}m)
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {yStrips.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowRight size={14} className="text-purple-500 rotate-90" />
                    شرائط اتجاه Y ({yStrips.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {yStrips.map(s => (
                      <div
                        key={s.stripId}
                        onClick={() => setSelectedStrip(s.stripId)}
                        className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                          selectedStrip === s.stripId
                            ? 'border-teal-400 bg-teal-500/10'
                            : 'border-border hover:border-teal-300 hover:bg-muted/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{s.stripId}</Badge>
                            <span className="text-xs">X = {s.fixedCoord.toFixed(1)}m</span>
                            <span className="text-[10px] text-muted-foreground">
                              ({s.spans.length} بحرات)
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-muted-foreground">
                            M⁺={s.maxPositiveMoment.toFixed(1)} | M⁻={s.maxNegativeMoment.toFixed(1)} kN.m
                          </div>
                        </div>
                        <div className="flex gap-1 mt-1">
                          {s.spans.map((sp, i) => (
                            <React.Fragment key={i}>
                              {i > 0 && <div className="w-px bg-foreground/30 self-stretch" />}
                              <div className="text-[9px] text-center flex-1 px-1 py-0.5 rounded bg-muted/50">
                                {sp.slabId} ({sp.spanLength.toFixed(1)}m)
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── تفاصيل النتائج ── */}
          <TabsContent value="details" className="space-y-3">
            {activeResult ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge className="bg-teal-500">{activeResult.stripId}</Badge>
                    شريحة {activeResult.direction} — 
                    {activeResult.direction === 'X' ? `Y = ${activeResult.fixedCoord.toFixed(1)}m` : `X = ${activeResult.fixedCoord.toFixed(1)}m`}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* معلومات الأحمال */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/50 p-2">
                      <div className="text-[10px] text-muted-foreground">Wu (kN/m²)</div>
                      <div className="text-sm font-bold font-mono">{activeResult.Wu.toFixed(2)}</div>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <div className="text-[10px] text-muted-foreground">wu/m (kN/m)</div>
                      <div className="text-sm font-bold font-mono">{activeResult.wuPerMeter.toFixed(2)}</div>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-2">
                      <div className="text-[10px] text-muted-foreground">عدد البحرات</div>
                      <div className="text-sm font-bold font-mono">{activeResult.spans.length}</div>
                    </div>
                  </div>

                  {/* BMD Diagram */}
                  <StripBMDiagram result={activeResult} />

                  {/* جدول النتائج */}
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-[10px] w-16">البلاطة</TableHead>
                          <TableHead className="text-[10px] text-center">Ln (m)</TableHead>
                          <TableHead className="text-[10px] text-center">M⁻ يسار</TableHead>
                          <TableHead className="text-[10px] text-center">M⁺</TableHead>
                          <TableHead className="text-[10px] text-center">M⁻ يمين</TableHead>
                          <TableHead className="text-[10px] text-center">Vu يسار</TableHead>
                          <TableHead className="text-[10px] text-center">Vu يمين</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeResult.spans.map((sp, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-[10px] font-mono">{sp.slabId}</TableCell>
                            <TableCell className="text-[10px] text-center font-mono">{sp.spanLength.toFixed(2)}</TableCell>
                            <TableCell className="text-[10px] text-center font-mono text-red-600">
                              {sp.Mneg_left.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-[10px] text-center font-mono text-blue-600">
                              {sp.Mpos.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-[10px] text-center font-mono text-red-600">
                              {sp.Mneg_right.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-[10px] text-center font-mono">{sp.Vu_left.toFixed(2)}</TableCell>
                            <TableCell className="text-[10px] text-center font-mono">{sp.Vu_right.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* جدول التسليح */}
                  <div className="overflow-x-auto">
                    <p className="text-xs font-semibold mb-1">التسليح المطلوب (mm²/m):</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-[10px] w-16">البلاطة</TableHead>
                          <TableHead className="text-[10px] text-center">As⁻ يسار</TableHead>
                          <TableHead className="text-[10px] text-center">As⁺</TableHead>
                          <TableHead className="text-[10px] text-center">As⁻ يمين</TableHead>
                          <TableHead className="text-[10px] text-center">As,min</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeResult.spans.map((sp, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-[10px] font-mono">{sp.slabId}</TableCell>
                            <TableCell className="text-[10px] text-center font-mono">{sp.As_neg_left.toFixed(0)}</TableCell>
                            <TableCell className="text-[10px] text-center font-mono">{sp.As_pos.toFixed(0)}</TableCell>
                            <TableCell className="text-[10px] text-center font-mono">{sp.As_neg_right.toFixed(0)}</TableCell>
                            <TableCell className="text-[10px] text-center font-mono text-muted-foreground">{sp.As_min.toFixed(0)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  اختر شريحة من تبويب "الشرائط المكتشفة" لعرض تفاصيلها
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── ملخص ── */}
          <TabsContent value="summary" className="space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">ملخص التحليل</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-blue-500/10 border border-blue-200 dark:border-blue-800 p-3">
                    <div className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">اتجاه X</div>
                    <div className="text-[10px] space-y-0.5">
                      <div>عدد الشرائط: <span className="font-mono">{xStrips.length}</span></div>
                      {xStrips.length > 0 && (
                        <>
                          <div>أقصى M⁺: <span className="font-mono text-blue-600">{Math.max(...xStrips.map(s => s.maxPositiveMoment)).toFixed(2)} kN.m</span></div>
                          <div>أقصى M⁻: <span className="font-mono text-red-600">{Math.max(...xStrips.map(s => s.maxNegativeMoment)).toFixed(2)} kN.m</span></div>
                          <div>أقصى Vu: <span className="font-mono">{Math.max(...xStrips.map(s => s.maxShear)).toFixed(2)} kN</span></div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg bg-purple-500/10 border border-purple-200 dark:border-purple-800 p-3">
                    <div className="text-xs font-semibold text-purple-700 dark:text-purple-400 mb-1">اتجاه Y</div>
                    <div className="text-[10px] space-y-0.5">
                      <div>عدد الشرائط: <span className="font-mono">{yStrips.length}</span></div>
                      {yStrips.length > 0 && (
                        <>
                          <div>أقصى M⁺: <span className="font-mono text-blue-600">{Math.max(...yStrips.map(s => s.maxPositiveMoment)).toFixed(2)} kN.m</span></div>
                          <div>أقصى M⁻: <span className="font-mono text-red-600">{Math.max(...yStrips.map(s => s.maxNegativeMoment)).toFixed(2)} kN.m</span></div>
                          <div>أقصى Vu: <span className="font-mono">{Math.max(...yStrips.map(s => s.maxShear)).toFixed(2)} kN</span></div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 p-2 rounded bg-muted/50 text-[10px] text-muted-foreground">
                  <p className="font-semibold mb-1">ملاحظات:</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    <li>التحليل باستخدام معاملات ACI 318-19 Table 6.5.2</li>
                    <li>شريحة بعرض 1 متر في كل اتجاه</li>
                    <li>العزوم بوحدة kN.m/m والتسليح بوحدة mm²/m</li>
                    <li>الشروط: أحمال موزعة، نسبة البحرات ≤ 1.2، LL ≤ 3×DL</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/** رسم مخطط العزوم (BMD) للشريحة */
function StripBMDiagram({ result }: { result: ContinuousSlabResult }) {
  const totalLength = result.spans.reduce((s, sp) => s + sp.spanLength, 0);
  const W = 320;
  const H = 120;
  const padX = 20;
  const padY = 15;
  const drawW = W - 2 * padX;
  const drawH = H - 2 * padY;

  const allMoments = result.spans.flatMap(sp => [sp.Mneg_left, sp.Mpos, sp.Mneg_right]);
  const maxM = Math.max(...allMoments.map(Math.abs), 0.1);

  const toX = (dist: number) => padX + (dist / totalLength) * drawW;
  const midY = padY + drawH / 2;
  const toY = (m: number) => midY - (m / maxM) * (drawH / 2) * 0.85;

  // Build path points
  const points: string[] = [];
  let cumDist = 0;

  for (let i = 0; i < result.spans.length; i++) {
    const sp = result.spans[i];
    const x0 = cumDist;
    const xMid = cumDist + sp.spanLength / 2;
    const x1 = cumDist + sp.spanLength;

    // سالب يسار (فوق الخط = قيمة سالبة مرسومة لأعلى)
    points.push(`${toX(x0).toFixed(1)},${toY(-sp.Mneg_left).toFixed(1)}`);
    // موجب وسط (تحت الخط)
    points.push(`${toX(xMid).toFixed(1)},${toY(sp.Mpos).toFixed(1)}`);
    // سالب يمين
    points.push(`${toX(x1).toFixed(1)},${toY(-sp.Mneg_right).toFixed(1)}`);

    cumDist = x1;
  }

  return (
    <div className="rounded border border-border bg-muted/20 p-2">
      <p className="text-[10px] font-semibold mb-1 text-center">مخطط العزوم (BMD)</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: 140 }}>
        {/* baseline */}
        <line x1={padX} y1={midY} x2={W - padX} y2={midY} stroke="currentColor" strokeWidth="0.5" opacity={0.3} />
        
        {/* supports */}
        {(() => {
          let d = 0;
          const sups: number[] = [0];
          for (const sp of result.spans) { d += sp.spanLength; sups.push(d); }
          return sups.map((s, i) => (
            <g key={i}>
              <line x1={toX(s)} y1={midY - 4} x2={toX(s)} y2={midY + 4} stroke="currentColor" strokeWidth="1.5" />
              <polygon
                points={`${toX(s)},${midY + 4} ${toX(s) - 4},${midY + 10} ${toX(s) + 4},${midY + 10}`}
                fill="currentColor" opacity={0.4}
              />
            </g>
          ));
        })()}

        {/* BMD fill */}
        {(() => {
          let cumD = 0;
          return result.spans.map((sp, i) => {
            const x0 = cumD;
            const xM = cumD + sp.spanLength / 2;
            const x1 = cumD + sp.spanLength;
            cumD = x1;

            const path = `M${toX(x0).toFixed(1)},${midY} 
              L${toX(x0).toFixed(1)},${toY(-sp.Mneg_left).toFixed(1)} 
              Q${toX(xM).toFixed(1)},${toY(sp.Mpos).toFixed(1)} ${toX(x1).toFixed(1)},${toY(-sp.Mneg_right).toFixed(1)} 
              L${toX(x1).toFixed(1)},${midY} Z`;

            return (
              <path key={i} d={path} fill="hsl(200 80% 50% / 0.15)" stroke="hsl(200 80% 50%)" strokeWidth="1.5" />
            );
          });
        })()}

        {/* moment values */}
        {(() => {
          let cumD = 0;
          const labels: ReactElement[] = [];
          for (let i = 0; i < result.spans.length; i++) {
            const sp = result.spans[i];
            const x0 = cumD;
            const xM = cumD + sp.spanLength / 2;
            const x1 = cumD + sp.spanLength;

            // negative left (only for first span or if different from prev right)
            if (i === 0) {
              labels.push(
                <text key={`nl${i}`} x={toX(x0)} y={toY(-sp.Mneg_left) - 4} textAnchor="middle"
                  fontSize="7" fill="hsl(0 70% 50%)" fontFamily="monospace">{sp.Mneg_left.toFixed(1)}</text>
              );
            }
            // positive mid
            labels.push(
              <text key={`p${i}`} x={toX(xM)} y={toY(sp.Mpos) + 10} textAnchor="middle"
                fontSize="7" fill="hsl(210 70% 50%)" fontFamily="monospace">{sp.Mpos.toFixed(1)}</text>
            );
            // negative right
            labels.push(
              <text key={`nr${i}`} x={toX(x1)} y={toY(-sp.Mneg_right) - 4} textAnchor="middle"
                fontSize="7" fill="hsl(0 70% 50%)" fontFamily="monospace">{sp.Mneg_right.toFixed(1)}</text>
            );

            cumD = x1;
          }
          return labels;
        })()}

        {/* units */}
        <text x={W - padX} y={H - 2} textAnchor="end" fontSize="7" fill="currentColor" opacity={0.5}>kN.m/m</text>
      </svg>
    </div>
  );
}
