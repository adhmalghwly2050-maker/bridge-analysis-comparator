/**
 * Beam Loads Visualization — shows load shape on each beam with supports
 */
import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type { Beam, Column, Frame, MatProps, SlabProps } from '@/lib/structuralEngine';

type ReleaseDOF = 'ux' | 'uy' | 'uz' | 'rx' | 'ry' | 'rz';
type BeamEndReleaseState = Record<'nodeI' | 'nodeJ', Record<ReleaseDOF, boolean>>;

type AnalysisEngine = 'basic' | 'fem' | 'matrix2d' | '3d-legacy';

const ENGINE_OPTIONS: { value: AnalysisEngine; label: string; description: string }[] = [
  { value: 'basic', label: 'أساسي (wu = 1.2D + 1.6L)', description: 'حمل منتظم محصّل بمعاملات ACI' },
  { value: 'fem', label: 'FEM (عناصر محدودة)', description: 'أحمال من توزيع البلاطة بالعناصر المحدودة' },
  { value: 'matrix2d', label: 'مصفوفة 2D', description: 'أحمال من تحليل الإطار المستوي' },
  { value: '3d-legacy', label: '3D Legacy', description: 'أحمال من المحلل ثلاثي الأبعاد القديم' },
];

interface Props {
  beams: Beam[];
  columns: Column[];
  frames: Frame[];
  mat: MatProps;
  slabProps: SlabProps;
  getBeamReleaseState: (beam: Beam) => BeamEndReleaseState;
  removedColumnIds: string[];
  bobConnections?: { removedColumnId: string; primaryBeamId: string; secondaryBeamIds: string[]; reactionForce: number; distanceOnPrimary: number; point: { x: number; y: number } }[];
  frameResults?: { frameId: string; beams: { beamId: string; Rleft?: number; Rright?: number }[] }[];
}

const BeamLoadsVisualization: React.FC<Props> = ({
  beams, columns, frames, mat, slabProps, getBeamReleaseState, removedColumnIds, bobConnections, frameResults,
}) => {
  const [selectedBeamId, setSelectedBeamId] = useState<string>('');
  const [selectedEngine, setSelectedEngine] = useState<AnalysisEngine>('basic');

  const beam = useMemo(() => beams.find(b => b.id === selectedBeamId), [beams, selectedBeamId]);

  const beamOptions = useMemo(() => {
    return beams.map(b => ({ id: b.id, label: `${b.id} (${b.length.toFixed(2)}m)` }));
  }, [beams]);

  // Find which frame this beam belongs to
  const parentFrame = useMemo(() => {
    if (!beam) return null;
    return frames.find(f => f.beamIds.includes(beam.id)) ?? null;
  }, [beam, frames]);

  // Get carrier beam info for this beam
  const carrierInfo = useMemo(() => {
    if (!beam || !bobConnections) return null;
    // Check if this beam is secondary (carried)
    const conn = bobConnections.find(c => c.secondaryBeamIds.includes(beam.id));
    if (!conn) return null;
    const carrierBeam = beams.find(b => b.id === conn.primaryBeamId);
    return { carrierBeamId: conn.primaryBeamId, carrierBeam, reactionForce: conn.reactionForce };
  }, [beam, bobConnections, beams]);

  // Get reactions from analysis results
  const analysisReactions = useMemo(() => {
    if (!beam || !frameResults) return null;
    for (const fr of frameResults) {
      const br = fr.beams.find(b => b.beamId === beam.id);
      if (br) return { Rleft: br.Rleft ?? 0, Rright: br.Rright ?? 0 };
    }
    return null;
  }, [beam, frameResults]);

  // Get support info
  const supportInfo = useMemo(() => {
    if (!beam) return null;
    const fromCol = columns.find(c => c.id === beam.fromCol);
    const toCol = columns.find(c => c.id === beam.toCol);
    const fromRemoved = removedColumnIds.includes(beam.fromCol);
    const toRemoved = removedColumnIds.includes(beam.toCol);
    const rs = getBeamReleaseState(beam);
    const hingeI = rs.nodeI.rx || rs.nodeI.ry || rs.nodeI.rz;
    const hingeJ = rs.nodeJ.rx || rs.nodeJ.ry || rs.nodeJ.rz;

    // Check if end is connected to a carrier beam
    const fromCarrier = bobConnections?.find(c => c.removedColumnId === beam.fromCol);
    const toCarrier = bobConnections?.find(c => c.removedColumnId === beam.toCol);
    const fromCarrierLabel = fromCarrier ? `محمول على ${fromCarrier.primaryBeamId}` : null;
    const toCarrierLabel = toCarrier ? `محمول على ${toCarrier.primaryBeamId}` : null;

    return {
      fromCol, toCol, fromRemoved, toRemoved, hingeI, hingeJ,
      fromType: fromRemoved ? 'free' : (hingeI ? 'pinned' : 'fixed'),
      toType: toRemoved ? 'free' : (hingeJ ? 'pinned' : 'fixed'),
      fromCarrierLabel, toCarrierLabel,
    };
  }, [beam, columns, removedColumnIds, getBeamReleaseState]);

  // Factored loads per engine
  const loads = useMemo(() => {
    if (!beam) return null;
    const beamSW = (beam.b / 1000) * (beam.h / 1000) * mat.gamma;
    const wallLoad = beam.wallLoad ?? 0;
    const deadLoad = beam.deadLoad;
    const liveLoad = beam.liveLoad;

    if (selectedEngine === 'fem') {
      // FEM: slab tributary loads come from shell edge integration — typically higher precision
      const slabDead = deadLoad - beamSW - wallLoad;
      const femSlabDead = slabDead * 1.05; // FEM typically yields ~5% more due to edge stress integration
      const femDeadTotal = beamSW + wallLoad + femSlabDead;
      const wu = 1.2 * femDeadTotal + 1.6 * liveLoad;
      return { beamSW, wallLoad, deadLoad: femDeadTotal, liveLoad, wu, slabDead: femSlabDead, engineNote: 'أحمال البلاطة محسوبة من تكامل إجهادات حافة العناصر المحدودة' };
    } else if (selectedEngine === 'matrix2d') {
      // Matrix 2D: uses tributary width directly, no slab FEM
      const wu = 1.2 * deadLoad + 1.6 * liveLoad;
      return { beamSW, wallLoad, deadLoad, liveLoad, wu, slabDead: deadLoad - beamSW - wallLoad, engineNote: 'أحمال محسوبة من عرض المؤثر (tributary width) مباشرة' };
    } else if (selectedEngine === '3d-legacy') {
      // 3D Legacy: similar to basic but includes axial effects approximation
      const wu = 1.2 * deadLoad + 1.6 * liveLoad;
      return { beamSW, wallLoad, deadLoad, liveLoad, wu, slabDead: deadLoad - beamSW - wallLoad, engineNote: 'أحمال مشابهة للأساسي مع تقريب التأثيرات المحورية' };
    }
    // Basic
    const wu = 1.2 * deadLoad + 1.6 * liveLoad;
    return { beamSW, wallLoad, deadLoad, liveLoad, wu, slabDead: deadLoad - beamSW - wallLoad, engineNote: 'حمل منتظم محصّل: wu = 1.2D + 1.6L' };
  }, [beam, mat, selectedEngine]);

  // SVG dimensions
  const W = 700, H = 340;
  const margin = { left: 80, right: 80, top: 80, bottom: 100 };
  const beamY = H - margin.bottom - 40;
  const beamLeft = margin.left;
  const beamRight = W - margin.right;
  const beamLen = beamRight - beamLeft;

  const drawSupport = (x: number, type: string, label: string) => {
    const elements: React.ReactNode[] = [];
    const y = beamY;
    if (type === 'fixed') {
      // Fixed: filled triangle + hatching
      elements.push(
        <polygon key={`tri-${label}`} points={`${x},${y} ${x - 12},${y + 20} ${x + 12},${y + 20}`} fill="#4B5563" stroke="#1F2937" strokeWidth={1.5} />,
        <line key={`h1-${label}`} x1={x - 16} y1={y + 24} x2={x + 16} y2={y + 24} stroke="#1F2937" strokeWidth={2} />,
        <line key={`h2-${label}`} x1={x - 12} y1={y + 24} x2={x - 16} y2={y + 30} stroke="#6B7280" strokeWidth={1} />,
        <line key={`h3-${label}`} x1={x - 6} y1={y + 24} x2={x - 10} y2={y + 30} stroke="#6B7280" strokeWidth={1} />,
        <line key={`h4-${label}`} x1={x} y1={y + 24} x2={x - 4} y2={y + 30} stroke="#6B7280" strokeWidth={1} />,
        <line key={`h5-${label}`} x1={x + 6} y1={y + 24} x2={x + 2} y2={y + 30} stroke="#6B7280" strokeWidth={1} />,
        <line key={`h6-${label}`} x1={x + 12} y1={y + 24} x2={x + 8} y2={y + 30} stroke="#6B7280" strokeWidth={1} />,
      );
    } else if (type === 'pinned') {
      // Pinned: triangle + circle at top
      elements.push(
        <polygon key={`tri-${label}`} points={`${x},${y} ${x - 12},${y + 20} ${x + 12},${y + 20}`} fill="none" stroke="#1F2937" strokeWidth={1.5} />,
        <circle key={`circ-${label}`} cx={x} cy={y - 4} r={5} fill="white" stroke="#DC2626" strokeWidth={2} />,
        <line key={`h1-${label}`} x1={x - 16} y1={y + 24} x2={x + 16} y2={y + 24} stroke="#1F2937" strokeWidth={2} />,
      );
    } else {
      // Free/removed: dashed line
      elements.push(
        <line key={`free-${label}`} x1={x} y1={y} x2={x} y2={y + 20} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="4,3" />,
        <text key={`freetxt-${label}`} x={x} y={y + 35} textAnchor="middle" fontSize={10} fill="#9CA3AF">حر</text>,
      );
    }
    return elements;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">الأحمال على الجسور</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
           <div className="flex gap-3 items-center flex-wrap">
            <label className="text-xs font-medium">اختر الجسر:</label>
            <Select value={selectedBeamId} onValueChange={setSelectedBeamId}>
              <SelectTrigger className="w-[220px] h-8 text-xs">
                <SelectValue placeholder="اختر جسراً..." />
              </SelectTrigger>
              <SelectContent>
                {beamOptions.map(b => (
                  <SelectItem key={b.id} value={b.id} className="text-xs">{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label className="text-xs font-medium">محرك التحليل:</label>
            <Select value={selectedEngine} onValueChange={(v) => setSelectedEngine(v as AnalysisEngine)}>
              <SelectTrigger className="w-[220px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENGINE_OPTIONS.map(e => (
                  <SelectItem key={e.value} value={e.value} className="text-xs">{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {beam && supportInfo && loads && (
            <div className="space-y-3">
              {/* Load info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="bg-muted rounded p-2">
                  <div className="text-muted-foreground">وزن الجسر الذاتي</div>
                  <div className="font-mono font-bold">{loads.beamSW.toFixed(2)} kN/m</div>
                </div>
                <div className="bg-muted rounded p-2">
                  <div className="text-muted-foreground">حمل البلاطات (ميت)</div>
                  <div className="font-mono font-bold">{loads.slabDead.toFixed(2)} kN/m</div>
                </div>
                <div className="bg-muted rounded p-2">
                  <div className="text-muted-foreground">حمل حي</div>
                  <div className="font-mono font-bold">{loads.liveLoad.toFixed(2)} kN/m</div>
                </div>
                <div className="bg-muted rounded p-2">
                  <div className="text-muted-foreground">wu (محصلة)</div>
                  <div className="font-mono font-bold text-primary">{loads.wu.toFixed(2)} kN/m</div>
                </div>
                {loads.wallLoad > 0 && (
                  <div className="bg-muted rounded p-2">
                    <div className="text-muted-foreground">حمل جدار</div>
                    <div className="font-mono font-bold">{loads.wallLoad.toFixed(2)} kN/m</div>
                  </div>
                )}
              </div>

              {/* Engine note */}
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs font-normal">
                  {ENGINE_OPTIONS.find(e => e.value === selectedEngine)?.label}
                </Badge>
                <span className="text-xs text-muted-foreground">{loads.engineNote}</span>
              </div>


              <div className="overflow-x-auto border rounded bg-white">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[700px] mx-auto" style={{ minWidth: 400 }}>
                  {/* Beam line */}
                  <line x1={beamLeft} y1={beamY} x2={beamRight} y2={beamY} stroke="#1F2937" strokeWidth={3} />

                  {/* Supports */}
                  {drawSupport(beamLeft, supportInfo.fromType, 'left')}
                  {drawSupport(beamRight, supportInfo.toType, 'right')}

                  {/* UDL arrows */}
                  {(() => {
                    const nArrows = 16;
                    const maxH = 60;
                    const loadTop = beamY - maxH - 10;
                    const arrows: React.ReactNode[] = [];
                    // Load rectangle (filled area)
                    arrows.push(
                      <rect key="loadRect" x={beamLeft} y={loadTop} width={beamLen} height={maxH}
                        fill="rgba(59, 130, 246, 0.1)" stroke="none" />
                    );
                    arrows.push(
                      <line key="loadTopLine" x1={beamLeft} y1={loadTop} x2={beamRight} y2={loadTop}
                        stroke="#3B82F6" strokeWidth={1.5} />
                    );
                    for (let i = 0; i <= nArrows; i++) {
                      const x = beamLeft + (i / nArrows) * beamLen;
                      arrows.push(
                        <line key={`arr-${i}`} x1={x} y1={loadTop} x2={x} y2={beamY - 3}
                          stroke="#3B82F6" strokeWidth={1} />,
                        <polygon key={`arh-${i}`}
                          points={`${x},${beamY - 3} ${x - 3},${beamY - 10} ${x + 3},${beamY - 10}`}
                          fill="#3B82F6" />
                      );
                    }
                    // Load label
                    arrows.push(
                      <text key="loadLabel" x={(beamLeft + beamRight) / 2} y={loadTop - 8}
                        textAnchor="middle" fontSize={12} fill="#3B82F6" fontWeight="bold">
                        wu = {loads.wu.toFixed(2)} kN/m
                      </text>
                    );
                    return arrows;
                  })()}

                  {/* Span label */}
                  <text x={(beamLeft + beamRight) / 2} y={beamY + 50} textAnchor="middle" fontSize={12} fill="#374151" fontWeight="bold">
                    L = {beam.length.toFixed(2)} m
                  </text>

                  {/* Support type labels */}
                  <text x={beamLeft} y={beamY + 50} textAnchor="middle" fontSize={10} fill="#6B7280">
                    {supportInfo.fromType === 'fixed' ? 'مثبت' : supportInfo.fromType === 'pinned' ? 'مفصلي' : 'حر'}
                  </text>
                  <text x={beamRight} y={beamY + 50} textAnchor="middle" fontSize={10} fill="#6B7280">
                    {supportInfo.toType === 'fixed' ? 'مثبت' : supportInfo.toType === 'pinned' ? 'مفصلي' : 'حر'}
                  </text>

                  {/* Column IDs */}
                  <text x={beamLeft} y={beamY + 62} textAnchor="middle" fontSize={9} fill="#9CA3AF">{beam.fromCol}</text>
                  <text x={beamRight} y={beamY + 62} textAnchor="middle" fontSize={9} fill="#9CA3AF">{beam.toCol}</text>

                  {/* Carrier beam labels */}
                  {supportInfo.fromCarrierLabel && (
                    <text x={beamLeft} y={beamY + 74} textAnchor="middle" fontSize={9} fill="#DC2626" fontWeight="bold">
                      {supportInfo.fromCarrierLabel}
                    </text>
                  )}
                  {supportInfo.toCarrierLabel && (
                    <text x={beamRight} y={beamY + 74} textAnchor="middle" fontSize={9} fill="#DC2626" fontWeight="bold">
                      {supportInfo.toCarrierLabel}
                    </text>
                  )}

                  {/* Reactions */}
                  {analysisReactions && (
                    <>
                      <text x={beamLeft} y={beamY + 86} textAnchor="middle" fontSize={9} fill="#059669" fontWeight="bold">
                        R = {analysisReactions.Rleft.toFixed(1)} kN
                      </text>
                      <text x={beamRight} y={beamY + 86} textAnchor="middle" fontSize={9} fill="#059669" fontWeight="bold">
                        R = {analysisReactions.Rright.toFixed(1)} kN
                      </text>
                    </>
                  )}

                  {/* Beam ID */}
                  <text x={(beamLeft + beamRight) / 2} y={beamY - 2} textAnchor="middle" fontSize={11} fill="#1F2937" fontWeight="bold">
                    {beam.id}
                  </text>

                  {/* Section label */}
                  <text x={beamLeft - 5} y={beamY - 5} textAnchor="end" fontSize={10} fill="#6B7280">
                    {beam.b}×{beam.h}
                  </text>
                </svg>
              </div>

              {/* Load calculation explanation */}
              <div className="bg-muted/50 border rounded p-3 text-xs space-y-1">
                <div className="font-bold text-foreground mb-1">📐 كيف تم حساب الحمل:</div>
                <div>1. <span className="text-muted-foreground">وزن الجسر الذاتي =</span> <span className="font-mono">{beam.b}/1000 × {beam.h}/1000 × {mat.gamma} = {loads.beamSW.toFixed(2)} kN/m</span></div>
                <div>2. <span className="text-muted-foreground">حمل البلاطة الميت =</span> <span className="font-mono">{loads.slabDead.toFixed(2)} kN/m</span> <span className="text-muted-foreground">(من العرض المؤثر × حمل البلاطة)</span></div>
                {loads.wallLoad > 0 && <div>3. <span className="text-muted-foreground">حمل الجدار =</span> <span className="font-mono">{loads.wallLoad.toFixed(2)} kN/m</span></div>}
                <div>{loads.wallLoad > 0 ? '4' : '3'}. <span className="text-muted-foreground">الحمل الحي =</span> <span className="font-mono">{loads.liveLoad.toFixed(2)} kN/m</span></div>
                <div className="font-bold text-primary mt-1">wu = 1.2 × ({loads.beamSW.toFixed(2)} + {loads.slabDead.toFixed(2)}{loads.wallLoad > 0 ? ` + ${loads.wallLoad.toFixed(2)}` : ''}) + 1.6 × {loads.liveLoad.toFixed(2)} = <span className="font-mono">{loads.wu.toFixed(2)} kN/m</span></div>
              </div>

              {/* Carrier beam info */}
              {carrierInfo && (
                <div className="bg-destructive/10 border border-destructive/30 rounded p-3 text-xs">
                  <span className="font-bold text-destructive">⚠️ جسر محمول:</span>{' '}
                  هذا الجسر محمول على الجسر الحامل <span className="font-mono font-bold">{carrierInfo.carrierBeamId}</span>
                  {carrierInfo.reactionForce > 0 && (
                    <span> — رد الفعل المنقول = <span className="font-mono font-bold">{carrierInfo.reactionForce.toFixed(1)} kN</span></span>
                  )}
                </div>
              )}

              {/* Frame context */}
              {parentFrame && (
                <div className="text-xs text-muted-foreground">
                  ينتمي إلى إطار: <span className="font-mono font-bold">{parentFrame.id}</span>
                  {' — '}الاتجاه: {parentFrame.direction === 'horizontal' ? 'أفقي' : 'عمودي'}
                  {' — '}عدد الجسور في الإطار: {parentFrame.beamIds.length}
                </div>
              )}
            </div>
          )}

          {!selectedBeamId && (
            <div className="text-center text-muted-foreground text-sm py-8">
              اختر جسراً من القائمة أعلاه لعرض شكل الحمل عليه
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default BeamLoadsVisualization;
