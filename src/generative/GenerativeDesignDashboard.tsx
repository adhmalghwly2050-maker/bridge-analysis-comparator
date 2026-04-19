import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Zap, BarChart3, CheckCircle2, XCircle, Trophy, Loader2,
  ArrowRight, DollarSign, Shield, Hammer, TrendingDown,
} from 'lucide-react';
import type {
  GenerativeInput, BuildingType, SeismicZone, EvaluatedOption,
  GenerativeDesignResult,
} from './types';
import { generateStructuralOptions } from './systemGenerator';
import { evaluateOptions } from './evaluator';
import { optimizeOption } from './optimizer';

interface Props {
  onApplyOption?: (option: EvaluatedOption) => void;
}

const defaultInput: GenerativeInput = {
  buildingType: 'residential',
  numFloors: 5,
  floorHeight: 3.2,
  spanRangeMin: 4,
  spanRangeMax: 6,
  seismicZone: 'low',
  windSpeed: 100,
  liveLoad: 2,
  fc: 25,
  fy: 420,
  gridSpacingX: [5, 5, 5],
  gridSpacingY: [4, 4, 5],
};

/** Re-rank options by cost after any mutation (passing options first, then by totalCost ascending) */
function rerankByCost(options: EvaluatedOption[]): EvaluatedOption[] {
  const sorted = [...options].sort((a, b) => {
    const aPassing = a.design.allPassing;
    const bPassing = b.design.allPassing;
    if (aPassing && !bPassing) return -1;
    if (!aPassing && bPassing) return 1;
    return a.cost.totalCost - b.cost.totalCost;
  });
  sorted.forEach((e, i) => { e.rank = i + 1; });
  return sorted;
}

export default function GenerativeDesignDashboard({ onApplyOption }: Props) {
  const [input, setInput] = useState<GenerativeInput>(defaultInput);
  const [result, setResult] = useState<GenerativeDesignResult | null>(null);
  const [running, setRunning] = useState(false);
  const [optimizing, setOptimizing] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState('input');

  const updateInput = <K extends keyof GenerativeInput>(key: K, val: GenerativeInput[K]) =>
    setInput(prev => ({ ...prev, [key]: val }));

  const runGeneration = () => {
    setRunning(true);
    setTimeout(() => {
      const t0 = performance.now();
      const options = generateStructuralOptions(input);
      const evaluated = evaluateOptions(options, input); // already sorted by cost
      const t1 = performance.now();
      setResult({
        input,
        options: evaluated,
        bestOptionId: evaluated[0]?.option.id || '',
        optimizationIterations: 0,
        totalTimeMs: t1 - t0,
      });
      setSelectedId(evaluated[0]?.option.id || null);
      setSubTab('results');
      setRunning(false);
    }, 100);
  };

  const runOptimize = (optionId: string) => {
    if (!result) return;
    const evalOpt = result.options.find(o => o.option.id === optionId);
    if (!evalOpt) return;
    setOptimizing(optionId);
    setTimeout(() => {
      const optimized = optimizeOption(evalOpt.option, input);
      const updated = result.options.map(o =>
        o.option.id === optionId
          ? { ...optimized, option: { ...optimized.option, id: optionId, label: evalOpt.option.label, labelAr: evalOpt.option.labelAr } }
          : o
      );
      // Re-rank by cost after optimization
      const reranked = rerankByCost(updated);
      setResult({
        ...result,
        options: reranked,
        bestOptionId: reranked[0]?.option.id || '',
        optimizationIterations: result.optimizationIterations + 15,
      });
      setOptimizing(null);
    }, 200);
  };

  const selectedOption = result?.options.find(o => o.option.id === selectedId);

  const InputField = ({ label, value, onChange, type = 'number' }: { label: string; value: any; onChange: (v: any) => void; type?: string }) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input type={type} value={value} onChange={e => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)} className="h-9 text-sm" />
    </div>
  );

  const slabDescription = (ev: EvaluatedOption) => {
    const s = ev.option.sections;
    if (ev.option.systemType === 'hollow-block') {
      return `هردي ${s.blockHeight}mm + ${s.toppingThickness}mm = ${s.slabThickness}mm | عصب ${s.ribWidth}mm@${s.ribSpacing}mm`;
    }
    if (ev.option.systemType === 'flat-slab') {
      return `بلاطة مسطحة ${s.slabThickness}mm (بدون جسور)`;
    }
    return `مصمتة ${s.slabThickness}mm + جسور ${s.beamB}×${s.beamH}mm`;
  };

  /** Rank badge color: gold / silver / bronze */
  const rankColor = (rank: number) =>
    rank === 1 ? 'text-yellow-500' : rank === 2 ? 'text-slate-400' : 'text-amber-700';

  return (
    <div className="h-full overflow-y-auto p-3 md:p-4 pb-20 md:pb-4">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap size={20} className="text-accent" />
          <h2 className="text-lg font-bold">التصميم التوليدي / Generative Design</h2>
          <Badge variant="secondary" className="text-[10px]">مقارنة بالتكلفة · ACI 318-19</Badge>
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 p-2 text-xs text-blue-800 dark:text-blue-300">
          <Shield size={14} className="mt-0.5 shrink-0" />
          <span>
            كل نظام يُحلَّل ويُصمَّم وفق <strong>ACI 318-19</strong> أولاً. بعد التحقق من السلامة يُرتَّب حسب <strong>أقل تكلفة إجمالية</strong>.
          </span>
        </div>

        <Tabs value={subTab} onValueChange={setSubTab}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="input" className="text-xs gap-1">المدخلات</TabsTrigger>
            <TabsTrigger value="results" className="text-xs gap-1" disabled={!result}>النتائج</TabsTrigger>
            <TabsTrigger value="compare" className="text-xs gap-1" disabled={!result}>المقارنة</TabsTrigger>
            <TabsTrigger value="detail" className="text-xs gap-1" disabled={!selectedOption}>التفاصيل</TabsTrigger>
          </TabsList>

          {/* ==================== INPUT TAB ==================== */}
          <TabsContent value="input" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">نوع المبنى / Building Type</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Select value={input.buildingType} onValueChange={v => updateInput('buildingType', v as BuildingType)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="residential">سكني / Residential</SelectItem>
                      <SelectItem value="office">مكتبي / Office</SelectItem>
                      <SelectItem value="commercial">تجاري / Commercial</SelectItem>
                    </SelectContent>
                  </Select>
                  <InputField label="عدد الطوابق / Floors" value={input.numFloors} onChange={v => updateInput('numFloors', v)} />
                  <InputField label="ارتفاع الطابق (م) / Floor Height" value={input.floorHeight} onChange={v => updateInput('floorHeight', v)} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">البحور / Spans</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <InputField label="أقل بحر (م)" value={input.spanRangeMin} onChange={v => updateInput('spanRangeMin', v)} />
                  <InputField label="أقصى بحر (م)" value={input.spanRangeMax} onChange={v => updateInput('spanRangeMax', v)} />
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">المحاور X (أبعاد مفصولة بفاصلة)</label>
                    <Input className="h-9 text-sm" value={input.gridSpacingX?.join(', ') || ''} onChange={e => updateInput('gridSpacingX', e.target.value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v)))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">المحاور Y (أبعاد مفصولة بفاصلة)</label>
                    <Input className="h-9 text-sm" value={input.gridSpacingY?.join(', ') || ''} onChange={e => updateInput('gridSpacingY', e.target.value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v)))} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">الأحمال والمواد / Loads & Materials</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <InputField label="الحمل الحي (kN/m²)" value={input.liveLoad} onChange={v => updateInput('liveLoad', v)} />
                  <InputField label="f'c (MPa)" value={input.fc} onChange={v => updateInput('fc', v)} />
                  <InputField label="fy (MPa)" value={input.fy} onChange={v => updateInput('fy', v)} />
                  <Select value={input.seismicZone} onValueChange={v => updateInput('seismicZone', v as SeismicZone)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">بدون زلازل / None</SelectItem>
                      <SelectItem value="low">منخفض / Low</SelectItem>
                      <SelectItem value="moderate">متوسط / Moderate</SelectItem>
                      <SelectItem value="high">عالي / High</SelectItem>
                    </SelectContent>
                  </Select>
                  <InputField label="سرعة الرياح (km/h)" value={input.windSpeed} onChange={v => updateInput('windSpeed', v)} />
                </CardContent>
              </Card>
            </div>

            <div className="mt-4 flex justify-center">
              <Button onClick={runGeneration} disabled={running} size="lg" className="gap-2">
                {running ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
                {running ? 'جاري التوليد...' : 'مقارنة أنظمة البلاطات / Compare Slab Systems'}
              </Button>
            </div>
          </TabsContent>

          {/* ==================== RESULTS TAB ==================== */}
          <TabsContent value="results" className="mt-4">
            {result && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary">{result.options.length} أنظمة</Badge>
                  <span>⏱ {result.totalTimeMs.toFixed(0)}ms</span>
                  {result.optimizationIterations > 0 && <Badge variant="outline">{result.optimizationIterations} iterations optimized</Badge>}
                  <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                    <TrendingDown size={12} /> الترتيب: أقل تكلفة أولاً
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {result.options.map(ev => (
                    <Card
                      key={ev.option.id}
                      className={`cursor-pointer transition-all ${selectedId === ev.option.id ? 'ring-2 ring-accent' : 'hover:border-accent/50'} ${ev.rank === 1 ? 'border-yellow-400 dark:border-yellow-600' : ''}`}
                      onClick={() => { setSelectedId(ev.option.id); setSubTab('detail'); }}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm flex items-center gap-2">
                            {ev.rank === 1 && <Trophy size={14} className="text-yellow-500" />}
                            <span className={rankColor(ev.rank)}>#{ev.rank}</span>
                          </CardTitle>
                          {ev.design.allPassing
                            ? <Badge className="bg-green-600 text-white text-[10px]"><CheckCircle2 size={10} className="mr-1" />آمن ACI</Badge>
                            : <Badge variant="destructive" className="text-[10px]"><XCircle size={10} className="mr-1" />تحقق</Badge>}
                        </div>
                        <p className="text-sm font-bold">{ev.option.labelAr}</p>
                        <p className="text-[10px] text-muted-foreground">{slabDescription(ev)}</p>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {/* Cost — primary ranking criterion */}
                        <div className="flex items-center justify-between rounded-md bg-muted px-2 py-1.5">
                          <div className="flex items-center gap-1 text-xs font-medium">
                            <DollarSign size={12} className="text-green-600" />
                            <span>التكلفة الإجمالية</span>
                          </div>
                          <span className="text-sm font-bold font-mono">${ev.cost.totalCost.toFixed(0)}</span>
                        </div>

                        {/* Utilization ratios — informational */}
                        <div className="grid grid-cols-3 gap-2 text-center mt-1">
                          <div>
                            <BarChart3 size={12} className="mx-auto text-blue-500 mb-1" />
                            <div className="text-xs font-bold">{(ev.design.beamUtilization * 100).toFixed(0)}%</div>
                            <div className="text-[10px] text-muted-foreground">جسر</div>
                          </div>
                          <div>
                            <Shield size={12} className="mx-auto text-purple-500 mb-1" />
                            <div className="text-xs font-bold">{(ev.design.columnUtilization * 100).toFixed(0)}%</div>
                            <div className="text-[10px] text-muted-foreground">عمود</div>
                          </div>
                          <div>
                            <Hammer size={12} className="mx-auto text-orange-500 mb-1" />
                            <div className="text-xs font-bold">{(ev.design.slabUtilization * 100).toFixed(0)}%</div>
                            <div className="text-[10px] text-muted-foreground">بلاطة</div>
                          </div>
                          {ev.option.systemType === 'flat-slab' && (
                            <div>
                              <Shield size={12} className="mx-auto text-red-500 mb-1" />
                              <div className="text-xs font-bold">{(ev.design.punchingShearUtilization * 100).toFixed(0)}%</div>
                              <div className="text-[10px] text-muted-foreground">ثقب</div>
                            </div>
                          )}
                        </div>

                        <div className="text-[10px] text-muted-foreground flex justify-between">
                          <span>خرسانة: {ev.materials.concreteVolume.toFixed(1)} m³</span>
                          <span>حديد: {ev.materials.steelWeight.toFixed(0)} kg</span>
                        </div>

                        <div className="flex gap-2 mt-2">
                          <Button size="sm" variant="outline" className="text-xs h-7 flex-1"
                            onClick={e => { e.stopPropagation(); runOptimize(ev.option.id); }}
                            disabled={optimizing === ev.option.id}>
                            {optimizing === ev.option.id ? <Loader2 className="animate-spin mr-1" size={12} /> : <Zap size={12} className="mr-1" />}
                            تحسين التكلفة
                          </Button>
                          {onApplyOption && (
                            <Button size="sm" className="text-xs h-7 flex-1 gap-1"
                              onClick={e => { e.stopPropagation(); onApplyOption(ev); }}>
                              <ArrowRight size={12} /> تطبيق
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ==================== COMPARE TAB ==================== */}
          <TabsContent value="compare" className="mt-4">
            {result && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    مقارنة أنظمة البلاطات / Slab Systems Comparison
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <TrendingDown size={10} /> مرتَّب بالتكلفة
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">الترتيب</TableHead>
                        <TableHead className="text-xs">النظام</TableHead>
                        <TableHead className="text-xs">السماكة (mm)</TableHead>
                        <TableHead className="text-xs">الجسر (mm)</TableHead>
                        <TableHead className="text-xs">العمود (mm)</TableHead>
                        <TableHead className="text-xs">خرسانة (m³)</TableHead>
                        <TableHead className="text-xs">حديد (kg)</TableHead>
                        <TableHead className="text-xs">بلوكات</TableHead>
                        <TableHead className="text-xs font-bold text-green-700 dark:text-green-400">التكلفة ($)</TableHead>
                        <TableHead className="text-xs">جسر%</TableHead>
                        <TableHead className="text-xs">عمود%</TableHead>
                        <TableHead className="text-xs">بلاطة%</TableHead>
                        <TableHead className="text-xs">ACI</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.options.map(ev => (
                        <TableRow
                          key={ev.option.id}
                          className={`cursor-pointer ${selectedId === ev.option.id ? 'bg-accent/10' : ''} ${ev.rank === 1 ? 'bg-yellow-50 dark:bg-yellow-950/20' : ''}`}
                          onClick={() => { setSelectedId(ev.option.id); setSubTab('detail'); }}
                        >
                          <TableCell className="text-xs font-bold">
                            <span className={rankColor(ev.rank)}>
                              {ev.rank === 1 && <Trophy size={11} className="inline mr-1 text-yellow-500" />}
                              #{ev.rank}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">
                            <div>{ev.option.labelAr}</div>
                            <div className="text-[10px] text-muted-foreground">{ev.option.label}</div>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{ev.option.sections.slabThickness}</TableCell>
                          <TableCell className="text-xs font-mono">
                            {ev.option.sections.beamH > 0 ? `${ev.option.sections.beamB}×${ev.option.sections.beamH}` : '—'}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{ev.option.sections.colB}×{ev.option.sections.colH}</TableCell>
                          <TableCell className="text-xs font-mono">{ev.materials.concreteVolume.toFixed(1)}</TableCell>
                          <TableCell className="text-xs font-mono">{ev.materials.steelWeight.toFixed(0)}</TableCell>
                          <TableCell className="text-xs font-mono">{ev.materials.blockCount ? ev.materials.blockCount.toLocaleString() : '—'}</TableCell>
                          <TableCell className="text-xs font-bold font-mono text-green-700 dark:text-green-400">
                            ${ev.cost.totalCost.toFixed(0)}
                          </TableCell>
                          <TableCell className={`text-xs font-mono ${ev.design.beamUtilization > 1 ? 'text-red-500' : ''}`}>
                            {ev.option.sections.beamH > 0 ? `${(ev.design.beamUtilization * 100).toFixed(0)}%` : '—'}
                          </TableCell>
                          <TableCell className={`text-xs font-mono ${ev.design.columnUtilization > 1 ? 'text-red-500' : ''}`}>
                            {(ev.design.columnUtilization * 100).toFixed(0)}%
                          </TableCell>
                          <TableCell className={`text-xs font-mono ${ev.design.slabUtilization > 1 ? 'text-red-500' : ''}`}>
                            {(ev.design.slabUtilization * 100).toFixed(0)}%
                          </TableCell>
                          <TableCell className="text-xs">
                            {ev.design.allPassing
                              ? <CheckCircle2 size={14} className="text-green-500" />
                              : <XCircle size={14} className="text-red-500" />}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ==================== DETAIL TAB ==================== */}
          <TabsContent value="detail" className="mt-4">
            {selectedOption && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">المقاطع / Sections</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">النظام:</span><span className="font-medium">{selectedOption.option.labelAr}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">الترتيب:</span>
                      <span className={`font-bold ${rankColor(selectedOption.rank)}`}>#{selectedOption.rank}</span>
                    </div>
                    <div className="flex justify-between"><span className="text-muted-foreground">سماكة البلاطة الكلية:</span><span className="font-mono">{selectedOption.option.sections.slabThickness} mm</span></div>
                    {selectedOption.option.systemType === 'hollow-block' && (
                      <>
                        <div className="flex justify-between"><span className="text-muted-foreground">ارتفاع البلوك:</span><span className="font-mono">{selectedOption.option.sections.blockHeight} mm</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">طبقة علوية:</span><span className="font-mono">{selectedOption.option.sections.toppingThickness} mm</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">عرض العصب:</span><span className="font-mono">{selectedOption.option.sections.ribWidth} mm</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">تباعد الأعصاب:</span><span className="font-mono">{selectedOption.option.sections.ribSpacing} mm</span></div>
                      </>
                    )}
                    {selectedOption.option.sections.beamH > 0 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">الجسر الساقط:</span><span className="font-mono">{selectedOption.option.sections.beamB}×{selectedOption.option.sections.beamH} mm</span></div>
                    )}
                    {selectedOption.option.systemType === 'flat-slab' && (
                      <div className="flex justify-between"><span className="text-muted-foreground">الجسور:</span><span className="text-muted-foreground italic">بدون جسور</span></div>
                    )}
                    <div className="flex justify-between"><span className="text-muted-foreground">العمود:</span><span className="font-mono">{selectedOption.option.sections.colB}×{selectedOption.option.sections.colH} mm</span></div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">نتائج التحليل / Analysis (ACI 318-19)</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">أقصى عزم:</span><span className="font-mono">{selectedOption.analysis.maxMoment.toFixed(1)} kN.m</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">أقصى قص:</span><span className="font-mono">{selectedOption.analysis.maxShear.toFixed(1)} kN</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">الترخيم:</span><span className="font-mono">{selectedOption.analysis.maxDeflection.toFixed(2)} mm</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">الانزياح الطابقي:</span><span className="font-mono">{(selectedOption.analysis.maxDrift * 100).toFixed(2)}%</span></div>
                    <div className="flex justify-between items-center pt-1">
                      <span className="text-muted-foreground">حالة ACI 318-19:</span>
                      {selectedOption.design.allPassing
                        ? <Badge className="bg-green-600 text-white text-[10px]"><CheckCircle2 size={10} className="mr-1" />جميع الشروط مستوفاة</Badge>
                        : <Badge variant="destructive" className="text-[10px]"><XCircle size={10} className="mr-1" />يتجاوز حد التصميم</Badge>}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">نسب الاستخدام / Utilization Ratios</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {selectedOption.option.sections.beamH > 0 && (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>الجسر (φMn)</span>
                          <span className={selectedOption.design.beamUtilization > 1 ? 'text-red-500 font-bold' : ''}>
                            {(selectedOption.design.beamUtilization * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${selectedOption.design.beamUtilization > 1 ? 'bg-destructive' : 'bg-primary'}`}
                            style={{ width: `${Math.min(selectedOption.design.beamUtilization * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span>الأعمدة (φPn)</span>
                        <span className={selectedOption.design.columnUtilization > 1 ? 'text-red-500 font-bold' : ''}>
                          {(selectedOption.design.columnUtilization * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${selectedOption.design.columnUtilization > 1 ? 'bg-destructive' : 'bg-primary'}`}
                          style={{ width: `${Math.min(selectedOption.design.columnUtilization * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span>{selectedOption.option.systemType === 'hollow-block' ? 'الأعصاب (h_min)' : 'البلاطة (h_min)'}</span>
                        <span className={selectedOption.design.slabUtilization > 1 ? 'text-red-500 font-bold' : ''}>
                          {(selectedOption.design.slabUtilization * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${selectedOption.design.slabUtilization > 1 ? 'bg-destructive' : 'bg-primary'}`}
                          style={{ width: `${Math.min(selectedOption.design.slabUtilization * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                    {selectedOption.option.systemType === 'flat-slab' && (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>قص الثقب (φVc)</span>
                          <span className={selectedOption.design.punchingShearUtilization > 1 ? 'text-red-500 font-bold' : ''}>
                            {(selectedOption.design.punchingShearUtilization * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${selectedOption.design.punchingShearUtilization > 1 ? 'bg-destructive' : 'bg-primary'}`}
                            style={{ width: `${Math.min(selectedOption.design.punchingShearUtilization * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">الكميات والتكلفة / Quantities & Cost</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">خرسانة:</span><span className="font-mono">{selectedOption.materials.concreteVolume.toFixed(1)} m³</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">حديد:</span><span className="font-mono">{selectedOption.materials.steelWeight.toFixed(0)} kg</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">شدات:</span><span className="font-mono">{selectedOption.materials.formworkArea.toFixed(0)} m²</span></div>
                    {selectedOption.materials.blockCount && (
                      <div className="flex justify-between"><span className="text-muted-foreground">بلوكات:</span><span className="font-mono">{selectedOption.materials.blockCount.toLocaleString()} بلوكة</span></div>
                    )}
                    <hr className="border-border" />
                    <div className="flex justify-between"><span className="text-muted-foreground">تكلفة خرسانة:</span><span className="font-mono">${selectedOption.cost.concreteCost.toFixed(0)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">تكلفة حديد:</span><span className="font-mono">${selectedOption.cost.steelCost.toFixed(0)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">تكلفة شدات:</span><span className="font-mono">${selectedOption.cost.formworkCost.toFixed(0)}</span></div>
                    {selectedOption.cost.blockCost && (
                      <div className="flex justify-between"><span className="text-muted-foreground">تكلفة بلوكات:</span><span className="font-mono">${selectedOption.cost.blockCost.toFixed(0)}</span></div>
                    )}
                    <div className="flex justify-between font-bold text-green-700 dark:text-green-400">
                      <span className="flex items-center gap-1"><DollarSign size={13} />الإجمالي (معيار الترتيب):</span>
                      <span className="font-mono">${selectedOption.cost.totalCost.toFixed(0)}</span>
                    </div>
                  </CardContent>
                </Card>

                {onApplyOption && (
                  <div className="md:col-span-2 flex justify-center">
                    <Button size="lg" className="gap-2" onClick={() => onApplyOption(selectedOption)}>
                      <ArrowRight size={16} />
                      تطبيق هذا التصميم على النموذج / Apply to Model
                    </Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
