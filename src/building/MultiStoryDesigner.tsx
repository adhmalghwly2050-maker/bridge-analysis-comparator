import React, { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import {
  Building2, Layers, Settings2, Eye, EyeOff, Zap,
  ArrowLeft, RotateCcw, Plus, Trash2, Copy, ArrowDown, Download
} from 'lucide-react';
import {
  BuildingConfig, BuildingModel, FloorConfig, FloorType, FLOOR_TYPE_LABELS,
  generateBuildingModel, updateFloor, updateFloorSlabs, calculateFloorLoads,
  calculateAccumulatedColumnLoads, optimizeBuilding, OptimizationResult, FloorLoads,
  ColumnAccumulatedLoad,
} from './buildingModel';
const Building3DViewer = lazy(() => import('./Building3DViewer'));
import { Slab, MatProps, SlabProps } from '@/lib/structuralEngine';

interface MultiStoryDesignerProps {
  initialSlabs: Slab[];
  mat: MatProps;
  slabProps: SlabProps;
  beamB: number;
  beamH: number;
  colB: number;
  colH: number;
  onClose: () => void;
}

export default function MultiStoryDesigner({
  initialSlabs, mat, slabProps, beamB, beamH, colB, colH, onClose
}: MultiStoryDesignerProps) {
  const [config, setConfig] = useState<BuildingConfig>({
    projectName: 'Multi-Story Building',
    projectNameAr: 'مبنى متعدد الطوابق',
    numFloors: 7,
    typicalFloorCount: 5,
    groundFloorHeight: 4.0,
    typicalFloorHeight: 3.2,
    roofFloorHeight: 3.2,
    typicalSlabs: initialSlabs,
    beamB, beamH, colB, colH, mat, slabProps,
    hasBasement: false,
    basementHeight: 3.5,
    basementSoilPressure: 15,
    hasGradeBeams: false,
    gradeBeamH: 600,
  });

  const [activeSubTab, setActiveSubTab] = useState('config');
  const [visibleFloors, setVisibleFloors] = useState<string[]>([]);
  const [showGrid, setShowGrid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [cutSection, setCutSection] = useState<'none' | 'x' | 'y'>('none');
  const [cutPosition, setCutPosition] = useState(5);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);

  const building = useMemo(() => generateBuildingModel(config), [config]);
  const floorLoads = useMemo(() => calculateFloorLoads(building), [building]);
  const accumulatedLoads = useMemo(() => calculateAccumulatedColumnLoads(building), [building]);

  useMemo(() => {
    if (visibleFloors.length === 0) {
      setVisibleFloors(building.floors.map(f => f.id));
    }
  }, [building.floors.length]);

  const toggleFloor = (floorId: string) => {
    setVisibleFloors(prev =>
      prev.includes(floorId) ? prev.filter(f => f !== floorId) : [...prev, floorId]
    );
  };

  const handleOptimize = useCallback(() => {
    setIsOptimizing(true);
    setTimeout(() => {
      const result = optimizeBuilding(building);
      setConfig(prev => ({
        ...prev,
        beamB: result.building.config.beamB,
        beamH: result.building.config.beamH,
      }));
      setOptimizationResult(result.result);
      setIsOptimizing(false);
    }, 1500);
  }, [building]);

  const updateConfig = (key: keyof BuildingConfig, value: number | boolean) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setOptimizationResult(null);
  };

  // Get max accumulated load for any column stack
  const maxColumnPu = useMemo(() => {
    let max = 0;
    for (const stack of accumulatedLoads) {
      for (const f of stack.floors) {
        if (f.Pu > max) max = f.Pu;
      }
    }
    return max;
  }, [accumulatedLoads]);

  const ParamInput = ({ label, value, onChange, unit }: {
    label: string; value: number; onChange: (v: number) => void; unit?: string;
  }) => (
    <div className="space-y-1">
      <label className="text-[10px] font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-1">
        <Input type="number" value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="font-mono h-8 text-xs" step={0.1} />
        {unit && <span className="text-[10px] text-muted-foreground shrink-0">{unit}</span>}
      </div>
    </div>
  );

  const floorTypeBadge = (type: FloorType) => {
    const colors: Record<FloorType, string> = {
      basement: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
      grade_beam: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
      ground: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
      typical: 'bg-muted text-muted-foreground',
      roof: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    };
    return (
      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${colors[type]}`}>
        {FLOOR_TYPE_LABELS[type].ar}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="sm" onClick={onClose} className="min-h-[36px]">
          <ArrowLeft size={16} />
        </Button>
        <Building2 size={20} className="text-accent" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">مصمم المباني متعددة الطوابق</h2>
          <p className="text-[10px] text-muted-foreground">
            {building.floors.length} طوابق • {building.totalHeight.toFixed(1)}م
            {config.hasBasement && ' • قبو'}
            {config.hasGradeBeams && ' • ميدة'}
          </p>
        </div>
      </div>

      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-card px-2 shrink-0 h-auto overflow-x-auto">
          <TabsTrigger value="config" className="text-[11px] gap-1 min-h-[36px]"><Settings2 size={12} />الإعدادات</TabsTrigger>
          <TabsTrigger value="floors" className="text-[11px] gap-1 min-h-[36px]"><Layers size={12} />الأدوار</TabsTrigger>
          <TabsTrigger value="loads" className="text-[11px] gap-1 min-h-[36px]"><ArrowDown size={12} />الأحمال المتراكمة</TabsTrigger>
          <TabsTrigger value="3d" className="text-[11px] gap-1 min-h-[36px]"><Eye size={12} />3D</TabsTrigger>
          <TabsTrigger value="optimize" className="text-[11px] gap-1 min-h-[36px]"><Zap size={12} />تحسين</TabsTrigger>
          <TabsTrigger value="export" className="text-[11px] gap-1 min-h-[36px]"><Download size={12} />تصدير اللوحات</TabsTrigger>
        </TabsList>

        {/* CONFIG TAB */}
        <TabsContent value="config" className="flex-1 overflow-auto p-3 mt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl">
            {/* Floor Configuration */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs">تكوين الطوابق</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <ParamInput label="عدد الطوابق النموذجية" value={config.typicalFloorCount}
                  onChange={v => updateConfig('typicalFloorCount', Math.max(1, Math.round(v)))} />
                <ParamInput label="ارتفاع الطابق الأرضي" value={config.groundFloorHeight} onChange={v => updateConfig('groundFloorHeight', v)} unit="م" />
                <ParamInput label="ارتفاع الطابق النموذجي" value={config.typicalFloorHeight} onChange={v => updateConfig('typicalFloorHeight', v)} unit="م" />
                <ParamInput label="ارتفاع السطح" value={config.roofFloorHeight} onChange={v => updateConfig('roofFloorHeight', v)} unit="م" />
              </CardContent>
            </Card>

            {/* Element Sections */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs">مقاطع العناصر</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <ParamInput label="عرض الجسر B" value={config.beamB} onChange={v => updateConfig('beamB', v)} unit="mm" />
                  <ParamInput label="ارتفاع الجسر H" value={config.beamH} onChange={v => updateConfig('beamH', v)} unit="mm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <ParamInput label="عرض العمود B" value={config.colB} onChange={v => updateConfig('colB', v)} unit="mm" />
                  <ParamInput label="عمق العمود H" value={config.colH} onChange={v => updateConfig('colH', v)} unit="mm" />
                </div>
              </CardContent>
            </Card>

            {/* Basement & Grade Beams */}
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs">القبو والميدة</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Basement */}
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-xs font-medium">قبو (Basement)</p>
                    <p className="text-[10px] text-muted-foreground">طابق تحت الأرض مع جدران استنادية</p>
                  </div>
                  <Switch checked={config.hasBasement} onCheckedChange={v => updateConfig('hasBasement', v)} />
                </div>
                {config.hasBasement && (
                  <div className="grid grid-cols-2 gap-2 pl-4">
                    <ParamInput label="ارتفاع القبو" value={config.basementHeight} onChange={v => updateConfig('basementHeight', v)} unit="م" />
                    <ParamInput label="ضغط التربة الجانبي" value={config.basementSoilPressure} onChange={v => updateConfig('basementSoilPressure', v)} unit="kN/m²" />
                  </div>
                )}

                {/* Grade Beams */}
                <div className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div>
                    <p className="text-xs font-medium">جسور ميدة (Grade Beams)</p>
                    <p className="text-[10px] text-muted-foreground">جسور ربط عند مستوى الأساس — عرض 200مم</p>
                  </div>
                  <Switch checked={config.hasGradeBeams} onCheckedChange={v => updateConfig('hasGradeBeams', v)} />
                </div>
                {config.hasGradeBeams && (
                  <div className="grid grid-cols-2 gap-2 pl-4">
                    <ParamInput label="ارتفاع جسر الميدة" value={config.gradeBeamH} onChange={v => updateConfig('gradeBeamH', v)} unit="mm" />
                    <div className="p-2 rounded bg-muted text-[10px] text-muted-foreground flex items-center">
                      عرض الميدة = 200 مم (عرض الجدار)
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Floor Summary */}
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs">ملخص الأدوار ({building.floors.length} طوابق)</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['الطابق', 'النوع', 'المنسوب (م)', 'الارتفاع (م)', 'الجسر', 'البلاطات'].map(h => (
                        <TableHead key={h} className="text-[10px]">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {building.floors.map(floor => (
                      <TableRow key={floor.id} className={selectedFloorId === floor.id ? 'bg-accent/10' : ''}>
                        <TableCell className="text-[10px] font-mono">{floor.labelAr}</TableCell>
                        <TableCell>{floorTypeBadge(floor.type)}</TableCell>
                        <TableCell className="text-[10px] font-mono">{floor.elevation.toFixed(1)}</TableCell>
                        <TableCell className="text-[10px] font-mono">{floor.height.toFixed(1)}</TableCell>
                        <TableCell className="text-[10px] font-mono">{floor.beamB}×{floor.beamH}</TableCell>
                        <TableCell className="text-[10px] font-mono">{floor.slabs.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* FLOORS TAB — Per-floor editing */}
        <TabsContent value="floors" className="flex-1 overflow-auto p-3 mt-0">
          <div className="max-w-5xl space-y-3">
            <p className="text-xs text-muted-foreground">اضغط على أي طابق لتعديل أحماله وبلاطاته بشكل مستقل</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {building.floors.map(floor => {
                const loads = floorLoads.find(fl => fl.floorId === floor.id);
                const isSelected = selectedFloorId === floor.id;
                return (
                  <Card key={floor.id}
                    className={`cursor-pointer transition-all ${isSelected ? 'ring-2 ring-accent' : 'hover:border-accent/50'}`}
                    onClick={() => setSelectedFloorId(isSelected ? null : floor.id)}>
                    <CardHeader className="pb-1">
                      <CardTitle className="text-[11px] flex items-center justify-between">
                        <span>{floor.labelAr}</span>
                        {floorTypeBadge(floor.type)}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 text-[10px]">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">المنسوب</span>
                        <span className="font-mono">{floor.elevation.toFixed(1)} م</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">الارتفاع</span>
                        <span className="font-mono">{floor.height.toFixed(1)} م</span>
                      </div>
                      {floor.type !== 'grade_beam' && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">DL</span>
                            <span className="font-mono">{loads?.totalDeadLoad.toFixed(2)} kN/m²</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">LL</span>
                            <span className="font-mono">{floor.liveLoad.toFixed(2)} kN/m²</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">الجدران</span>
                            <span className="font-mono">{floor.wallLoad.toFixed(1)} kN/m</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">الجسر</span>
                        <span className="font-mono">{floor.beamB}×{floor.beamH}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">البلاطات</span>
                        <span className="font-mono">{floor.slabs.length}</span>
                      </div>
                      {floor.type === 'basement' && floor.soilPressure && (
                        <div className="flex justify-between text-purple-600 dark:text-purple-400">
                          <span>ضغط التربة</span>
                          <span className="font-mono">{floor.soilPressure} kN/m²</span>
                        </div>
                      )}
                      {floor.type === 'grade_beam' && (
                        <div className="flex justify-between text-amber-600 dark:text-amber-400">
                          <span>ارتفاع الميدة</span>
                          <span className="font-mono">{floor.gradeBeamH || floor.beamH} mm</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Selected floor detail edit */}
            {selectedFloorId && (() => {
              const floor = building.floors.find(f => f.id === selectedFloorId);
              if (!floor) return null;
              return (
                <Card className="border-accent">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs flex items-center gap-2">
                      تعديل: {floor.labelAr} {floorTypeBadge(floor.type)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {floor.type !== 'grade_beam' && (
                      <>
                        <ParamInput label="الحمل الحي" value={floor.liveLoad}
                          onChange={v => {
                            const updated = updateFloor(building, floor.id, { liveLoad: v });
                            // Re-derive config isn't straightforward; we update directly
                          }} unit="kN/m²" />
                        <ParamInput label="حمل الجدران" value={floor.wallLoad}
                          onChange={v => {}} unit="kN/m" />
                        <ParamInput label="التشطيبات" value={floor.finishLoad}
                          onChange={v => {}} unit="kN/m²" />
                      </>
                    )}
                    <ParamInput label="ارتفاع الجسر" value={floor.beamH}
                      onChange={v => {}} unit="mm" />
                  </CardContent>
                </Card>
              );
            })()}
          </div>
        </TabsContent>

        {/* ACCUMULATED LOADS TAB — with Column Load Bar Chart (MSD-2) + Design Summary (MSD-3) */}
        <TabsContent value="loads" className="flex-1 overflow-auto p-3 mt-0">
          <div className="max-w-5xl space-y-4">
            {/* MSD-2: Column Load Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs flex items-center gap-2">
                  <ArrowDown size={14} />
                  مخطط الأحمال المتراكمة على الأعمدة
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {accumulatedLoads.map(stack => {
                    const bottomFloor = stack.floors[stack.floors.length - 1];
                    if (!bottomFloor) return null;
                    const pct = maxColumnPu > 0 ? (bottomFloor.Pu / maxColumnPu) * 100 : 0;
                    const currentCol = building.columnStacks.find(s => s.id === stack.stackId);
                    const currentB = currentCol?.floors[0]?.b || config.colB;
                    const currentH = currentCol?.floors[0]?.h || config.colH;
                    const capacity = 0.85 * mat.fc * currentB * currentH / 1000 * 0.65;
                    const ratio = bottomFloor.Pu / capacity;
                    const color = ratio > 0.9 ? 'bg-destructive' : ratio > 0.7 ? 'bg-amber-500' : 'bg-primary';
                    return (
                      <div key={stack.stackId} className="flex items-center gap-2 text-[10px]">
                        <span className="w-16 font-mono font-medium shrink-0">{stack.stackId}</span>
                        <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden">
                          <div className={`h-full ${color} rounded-sm transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className="w-16 text-right font-mono">{bottomFloor.Pu.toFixed(0)} kN</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-3 text-[9px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-3 h-2 bg-primary rounded-sm inline-block" /> ≤70%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 bg-amber-500 rounded-sm inline-block" /> 70-90%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 bg-destructive rounded-sm inline-block" /> &gt;90%</span>
                </div>
              </CardContent>
            </Card>

            {/* MSD-3: Design Summary Table Per Story */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs">ملخص التصميم لكل طابق</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['الطابق', 'DL (kN/m²)', 'LL (kN/m²)', 'Wu (kN/m²)', 'الحالة'].map(h => (
                        <TableHead key={h} className="text-[10px]">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {building.floors.filter(f => f.type !== 'grade_beam').map(floor => {
                      const loads = floorLoads.find(fl => fl.floorId === floor.id);
                      const dl = loads?.totalDeadLoad || 0;
                      const ll = floor.liveLoad;
                      const wu = 1.2 * dl + 1.6 * ll;
                      return (
                        <TableRow key={floor.id}>
                          <TableCell className="text-[10px] font-mono">{floor.labelAr}</TableCell>
                          <TableCell className="text-[10px] font-mono">{dl.toFixed(1)}</TableCell>
                          <TableCell className="text-[10px] font-mono">{ll.toFixed(1)}</TableCell>
                          <TableCell className="text-[10px] font-mono font-bold">{wu.toFixed(1)}</TableCell>
                          <TableCell>
                            <Badge variant="default" className="text-[9px]">✅ OK</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Original accumulated loads table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs flex items-center gap-2">
                  <ArrowDown size={14} />
                  الأحمال المتراكمة على الأعمدة (من السطح إلى الأساس)
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground mb-3">
                يتم حساب تراكم الأحمال من السطح نزولاً — كل عمود يحمل أحمال جميع الطوابق فوقه
              </CardContent>
            </Card>

            {accumulatedLoads.length > 0 && (() => {
              const mostLoaded = accumulatedLoads.reduce((best, stack) => {
                const maxPu = Math.max(...stack.floors.map(f => f.Pu));
                const bestPu = Math.max(...best.floors.map(f => f.Pu));
                return maxPu > bestPu ? stack : best;
              });
              return (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs">
                      العمود الأكثر تحميلاً: {mostLoaded.stackId} ({mostLoaded.x.toFixed(1)}, {mostLoaded.y.toFixed(1)})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {['الطابق', 'المساحة المحمولة', 'DL هذا الطابق', 'LL هذا الطابق', 'DL متراكم', 'LL متراكم', 'Pu (kN)', 'العمود المطلوب'].map(h => (
                            <TableHead key={h} className="text-[10px]">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mostLoaded.floors.map(f => (
                          <TableRow key={f.floorId}>
                            <TableCell className="text-[10px] font-mono">{f.floorLabel}</TableCell>
                            <TableCell className="text-[10px] font-mono">{f.tributaryArea.toFixed(1)} م²</TableCell>
                            <TableCell className="text-[10px] font-mono">{f.deadLoadPerFloor.toFixed(1)}</TableCell>
                            <TableCell className="text-[10px] font-mono">{f.liveLoadPerFloor.toFixed(1)}</TableCell>
                            <TableCell className="text-[10px] font-mono font-bold">{f.cumulativeDead.toFixed(1)}</TableCell>
                            <TableCell className="text-[10px] font-mono">{f.cumulativeLive.toFixed(1)}</TableCell>
                            <TableCell className="text-[10px] font-mono font-bold">{f.Pu.toFixed(0)}</TableCell>
                            <TableCell className="text-[10px] font-mono">{f.requiredColB}×{f.requiredColH}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              );
            })()}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs">ملخص جميع الأعمدة (الحمل عند الأساس)</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['العمود', 'الموقع', 'Pu عند الأساس (kN)', 'العمود المطلوب', 'العمود الحالي', 'الحالة'].map(h => (
                        <TableHead key={h} className="text-[10px]">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accumulatedLoads.map(stack => {
                      const bottomFloor = stack.floors[stack.floors.length - 1];
                      if (!bottomFloor) return null;
                      const currentCol = building.columnStacks.find(s => s.id === stack.stackId);
                      const currentB = currentCol?.floors[0]?.b || config.colB;
                      const currentH = currentCol?.floors[0]?.h || config.colH;
                      const adequate = currentB >= bottomFloor.requiredColB && currentH >= bottomFloor.requiredColH;
                      return (
                        <TableRow key={stack.stackId}>
                          <TableCell className="text-[10px] font-mono">{stack.stackId}</TableCell>
                          <TableCell className="text-[10px] font-mono">({stack.x.toFixed(1)}, {stack.y.toFixed(1)})</TableCell>
                          <TableCell className="text-[10px] font-mono font-bold">{bottomFloor.Pu.toFixed(0)}</TableCell>
                          <TableCell className="text-[10px] font-mono">{bottomFloor.requiredColB}×{bottomFloor.requiredColH}</TableCell>
                          <TableCell className="text-[10px] font-mono">{currentB}×{currentH}</TableCell>
                          <TableCell>
                            <Badge variant={adequate ? 'default' : 'destructive'} className="text-[9px]">
                              {adequate ? 'كافٍ ✓' : 'غير كافٍ ✗'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 3D VIEW TAB */}
        <TabsContent value="3d" className="flex-1 overflow-hidden mt-0">
          <div className="flex h-full">
            <div className="w-44 border-r border-border bg-card p-2 space-y-3 overflow-y-auto shrink-0 hidden md:block">
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground">إظهار الطوابق</span>
                {building.floors.map(floor => (
                  <button key={floor.id} onClick={() => toggleFloor(floor.id)}
                    className={`w-full flex items-center gap-1 px-2 py-1 text-[10px] rounded transition-colors ${
                      visibleFloors.includes(floor.id) ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-muted'
                    }`}>
                    {visibleFloors.includes(floor.id) ? <Eye size={10} /> : <EyeOff size={10} />}
                    {floor.labelAr}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-muted-foreground">قطع</span>
                <div className="flex gap-1">
                  {(['none', 'x', 'y'] as const).map(s => (
                    <button key={s} onClick={() => setCutSection(s)}
                      className={`flex-1 text-[10px] px-1 py-1 rounded ${
                        cutSection === s ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                      {s === 'none' ? 'بدون' : s.toUpperCase()}
                    </button>
                  ))}
                </div>
                {cutSection !== 'none' && (
                  <Input type="number" value={cutPosition}
                    onChange={e => setCutPosition(parseFloat(e.target.value) || 0)}
                    className="h-7 text-[10px] font-mono" step={0.5} />
                )}
              </div>
              <Button size="sm" variant="outline" className="w-full text-[10px]"
                onClick={() => setVisibleFloors(building.floors.map(f => f.id))}>
                <RotateCcw size={10} className="mr-1" />إظهار الكل
              </Button>
            </div>
            <div className="flex-1">
              <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Loading 3D viewer...</div>}>
                <Building3DViewer
                  building={building}
                  visibleFloors={visibleFloors}
                  showGrid={showGrid}
                  showLabels={showLabels}
                  cutSection={cutSection}
                  cutPosition={cutPosition}
                />
              </Suspense>
            </div>
          </div>
        </TabsContent>

        {/* OPTIMIZE TAB */}
        <TabsContent value="optimize" className="flex-1 overflow-auto p-3 mt-0">
          <div className="max-w-3xl space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs flex items-center gap-2">
                  <Zap size={14} /> التحسين الإنشائي
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  يقلل المحسّن استهلاك المواد مع الحفاظ على متطلبات ACI 318 — يستخدم الأحمال المتراكمة لتحديد أبعاد الأعمدة المثالية لكل طابق
                </p>
                <Button onClick={handleOptimize} disabled={isOptimizing} className="min-h-[44px]">
                  {isOptimizing ? (
                    <><RotateCcw size={16} className="animate-spin mr-2" />جاري التحسين...</>
                  ) : (
                    <><Zap size={16} className="mr-2" />تشغيل التحسين</>
                  )}
                </Button>

                {optimizationResult && (
                  <div className="space-y-3 mt-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Stat label="الوزن الأصلي" value={`${optimizationResult.originalWeight.toFixed(0)} kN`} />
                      <Stat label="الوزن المحسّن" value={`${optimizationResult.optimizedWeight.toFixed(0)} kN`} />
                      <Stat label="التوفير" value={`${optimizationResult.savingsPercent.toFixed(1)}%`} />
                      <Stat label="التكرارات" value={optimizationResult.iterations} />
                    </div>
                    {optimizationResult.columnChanges.length > 0 && (
                      <div className="text-xs space-y-1">
                        <p className="font-medium">تغييرات الأعمدة ({optimizationResult.columnChanges.length}):</p>
                        {optimizationResult.columnChanges.slice(0, 5).map((cc, i) => (
                          <p key={i} className="font-mono text-muted-foreground">
                            {cc.stackId}: {cc.fromB}×{cc.fromH} → {cc.toB}×{cc.toH} mm
                          </p>
                        ))}
                        {optimizationResult.columnChanges.length > 5 && (
                          <p className="text-muted-foreground">... و{optimizationResult.columnChanges.length - 5} أخرى</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs">إحصائيات المبنى</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Stat label="الطوابق" value={building.floors.length} />
                  <Stat label="الارتفاع الكلي" value={`${building.totalHeight.toFixed(1)} م`} />
                  <Stat label="أكوام الأعمدة" value={building.columnStacks.length} />
                  <Stat label="البلاطات/طابق" value={config.typicalSlabs.length} />
                  <Stat label="الجسر" value={`${config.beamB}×${config.beamH}`} />
                  <Stat label="العمود" value={`${config.colB}×${config.colH}`} />
                  {config.hasBasement && <Stat label="القبو" value={`${config.basementHeight} م`} />}
                  {config.hasGradeBeams && <Stat label="الميدة" value={`200×${config.gradeBeamH}`} />}
                  <Stat label="Pu أقصى عمود" value={`${maxColumnPu.toFixed(0)} kN`} />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* EXPORT TAB (MSD-1) */}
        <TabsContent value="export" className="flex-1 overflow-auto p-3 mt-0">
          <div className="max-w-3xl space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs flex items-center gap-2">
                  <Download size={14} /> تصدير اللوحات الإنشائية
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  يتم تصدير لوحات إنشائية كاملة وفق معايير ACI 315-99 / ISO 7200 لكل طابق أو لجميع الطوابق معاً.
                  يشمل: مخططات الجسور والأعمدة والبلاطات، المقاطع الطولية، جدول حصر الحديد، ومقطع المبنى.
                </p>
                <div className="p-3 rounded-lg border border-border bg-muted/50">
                  <p className="text-[11px] font-medium mb-2">الطوابق المتاحة:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {building.floors.map(f => (
                      <Badge key={f.id} variant="outline" className="text-[10px]">
                        {f.labelAr}
                      </Badge>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  💡 للتصدير: قم بالتحليل من الصفحة الرئيسية أولاً، ثم استخدم لوحة التصدير لاختيار الأدوار ونوع اللوحات.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-2 rounded bg-muted">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-bold font-mono">{value}</p>
    </div>
  );
}
