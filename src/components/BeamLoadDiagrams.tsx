import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { FrameResult, Beam, BeamOnBeamConnection } from "@/lib/structuralEngine";

interface BeamLoadDiagramsProps {
  frameResults: FrameResult[];
  beams: Beam[];
  engineLabel: string;
  bobConnections?: BeamOnBeamConnection[];
  /** Map of beamId → which end is hinged: 'I' (left), 'J' (right), 'BOTH' */
  beamHinges?: Map<string, 'I' | 'J' | 'BOTH'>;
}

interface PointLoadInfo {
  P: number;   // kN
  a: number;   // distance from left end (m)
}

interface BeamData {
  beamId: string;
  span: number;
  Mleft: number;
  Mmid: number;
  Mright: number;
  Vu: number;
  Rleft: number;
  Rright: number;
  w: number;
  momentStations?: number[];
  pointLoads: PointLoadInfo[];
  hingeLeft: boolean;
  hingeRight: boolean;
}

function getBeamData(
  fr: FrameResult[], beams: Beam[],
  bobConnections: BeamOnBeamConnection[],
  beamHinges: Map<string, 'I' | 'J' | 'BOTH'>,
): BeamData[] {
  const beamMap = new Map(beams.map(b => [b.id, b]));
  const results: BeamData[] = [];
  for (const f of fr) {
    for (const br of f.beams) {
      const beam = beamMap.get(br.beamId);
      if (!beam) continue;
      const w = (beam.deadLoad || 0) + (beam.liveLoad || 0);
      const L = br.span;

      // Hinge info
      const hinge = beamHinges.get(br.beamId);
      const hingeLeft = hinge === 'I' || hinge === 'BOTH';
      const hingeRight = hinge === 'J' || hinge === 'BOTH';

      // Override moments to 0 at hinged ends
      const Mleft = hingeLeft ? 0 : br.Mleft;
      const Mright = hingeRight ? 0 : br.Mright;

      // Point loads from carried beams
      const pointLoads: PointLoadInfo[] = [];
      for (const conn of bobConnections) {
        if (conn.primaryBeamId === br.beamId) {
          pointLoads.push({ P: conn.reactionForce, a: conn.distanceOnPrimary });
        }
        if (conn.continuationBeamId === br.beamId) {
          // For continuation beam, distance is from the junction (which is at x=0 of continuation)
          pointLoads.push({ P: conn.reactionForce, a: 0 });
        }
      }

      // Correct Rleft formula: Rleft = wL/2 + (Mright - Mleft)/L + point load contributions
      const Rleft = br.Rleft ?? (w * L / 2 + (Mright - Mleft) / L);
      const Rright = br.Rright ?? (w * L - Rleft);

      results.push({
        beamId: br.beamId, span: L,
        Mleft, Mmid: br.Mmid, Mright,
        Vu: br.Vu, Rleft, Rright, w,
        momentStations: br.momentStations,
        pointLoads, hingeLeft, hingeRight,
      });
    }
  }
  return results;
}

// Generate shear values along the beam
function computeShearStations(bd: BeamData, n: number = 50): { x: number; V: number }[] {
  const pts: { x: number; V: number }[] = [];
  const { span: L, w, Rleft, pointLoads } = bd;
  // Sort point loads by position
  const sortedPL = [...pointLoads].sort((a, b) => a.a - b.a);
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * L;
    let V = Rleft - w * x;
    // Subtract point loads that have been passed
    for (const pl of sortedPL) {
      if (x > pl.a + 1e-6) V -= pl.P;
    }
    pts.push({ x, V });
  }
  return pts;
}

// Generate moment values along the beam
function computeMomentStations(bd: BeamData, n: number = 50): { x: number; M: number }[] {
  if (bd.momentStations && bd.momentStations.length >= 3) {
    const stations = bd.momentStations;
    const step = bd.span / (stations.length - 1);
    return stations.map((M, i) => ({ x: i * step, M }));
  }
  const pts: { x: number; M: number }[] = [];
  const { span: L, w, Rleft, Mleft, pointLoads } = bd;
  const sortedPL = [...pointLoads].sort((a, b) => a.a - b.a);
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * L;
    let M = Mleft + Rleft * x - (w * x * x) / 2;
    // Add point load moment contributions
    for (const pl of sortedPL) {
      if (x > pl.a + 1e-6) M -= pl.P * (x - pl.a);
    }
    pts.push({ x, M });
  }
  return pts;
}

// SVG diagram dimensions
const MARGIN = { top: 30, right: 40, bottom: 35, left: 55 };
const W = 600;
const H = 180;
const plotW = W - MARGIN.left - MARGIN.right;
const plotH = H - MARGIN.top - MARGIN.bottom;

function formatVal(v: number): string {
  return Math.abs(v) < 0.01 ? "0" : v.toFixed(2);
}

// ── Load Diagram SVG ──
function LoadDiagram({ bd }: { bd: BeamData }) {
  const { span: L, w, Rleft, Rright, pointLoads, hingeLeft, hingeRight } = bd;
  const beamY = 60;
  const arrowLen = 35;

  return (
    <svg viewBox={`0 0 ${W} 160`} className="w-full" style={{ maxHeight: 180 }}>
      <defs>
        <marker id="arrowUp" markerWidth="8" markerHeight="8" refX="4" refY="8" orient="auto">
          <path d="M0,8 L4,0 L8,8" fill="hsl(var(--primary))" />
        </marker>
        <marker id="arrowDown" markerWidth="8" markerHeight="8" refX="4" refY="0" orient="auto">
          <path d="M0,0 L4,8 L8,0" fill="hsl(var(--destructive))" />
        </marker>
        <marker id="arrowDownOrange" markerWidth="8" markerHeight="8" refX="4" refY="0" orient="auto">
          <path d="M0,0 L4,8 L8,0" fill="#f97316" />
        </marker>
        <linearGradient id="udlGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity="0.7" />
          <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      {/* Beam line */}
      <line x1={MARGIN.left} y1={beamY} x2={MARGIN.left + plotW} y2={beamY}
        stroke="hsl(var(--foreground))" strokeWidth={3} />

      {/* Left support - triangle for fixed, circle for hinge */}
      {hingeLeft ? (
        <g>
          <circle cx={MARGIN.left} cy={beamY} r={5} fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
          <polygon points={`${MARGIN.left},${beamY + 7} ${MARGIN.left - 8},${beamY + 18} ${MARGIN.left + 8},${beamY + 18}`}
            fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
        </g>
      ) : (
        <polygon points={`${MARGIN.left},${beamY + 2} ${MARGIN.left - 8},${beamY + 18} ${MARGIN.left + 8},${beamY + 18}`}
          fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
      )}

      {/* Right support */}
      {hingeRight ? (
        <g>
          <circle cx={MARGIN.left + plotW} cy={beamY} r={5} fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
          <polygon points={`${MARGIN.left + plotW},${beamY + 7} ${MARGIN.left + plotW - 8},${beamY + 18} ${MARGIN.left + plotW + 8},${beamY + 18}`}
            fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
        </g>
      ) : (
        <polygon points={`${MARGIN.left + plotW},${beamY + 2} ${MARGIN.left + plotW - 8},${beamY + 18} ${MARGIN.left + plotW + 8},${beamY + 18}`}
          fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
      )}

      {/* UDL arrows */}
      {w > 0 && (
        <g>
          <rect x={MARGIN.left} y={beamY - arrowLen - 5} width={plotW} height={arrowLen + 5}
            fill="url(#udlGrad)" rx={2} />
          {Array.from({ length: 12 }, (_, i) => {
            const x = MARGIN.left + (i + 0.5) * (plotW / 12);
            return (
              <line key={i} x1={x} y1={beamY - arrowLen} x2={x} y2={beamY - 2}
                stroke="hsl(var(--destructive))" strokeWidth={1.2} markerEnd="url(#arrowDown)" />
            );
          })}
          <text x={W / 2} y={beamY - arrowLen - 10} textAnchor="middle"
            className="text-[10px] fill-foreground font-semibold">
            w = {formatVal(w)} kN/m
          </text>
        </g>
      )}

      {/* Point loads from carried beams */}
      {pointLoads.map((pl, idx) => {
        const xPos = MARGIN.left + (pl.a / L) * plotW;
        const topY = beamY - arrowLen - (w > 0 ? 25 : 5);
        return (
          <g key={`pl-${idx}`}>
            <line x1={xPos} y1={topY} x2={xPos} y2={beamY - 2}
              stroke="#f97316" strokeWidth={2.5} markerEnd="url(#arrowDownOrange)" />
            <text x={xPos} y={topY - 6} textAnchor="middle"
              className="text-[9px] font-bold" fill="#f97316">
              P={formatVal(pl.P)} kN
            </text>
            <text x={xPos} y={topY - 16} textAnchor="middle"
              className="text-[8px]" fill="#f97316">
              @{formatVal(pl.a)}m
            </text>
          </g>
        );
      })}

      {/* Reaction arrows */}
      <line x1={MARGIN.left} y1={beamY + 20 + arrowLen} x2={MARGIN.left} y2={beamY + 20}
        stroke="hsl(var(--primary))" strokeWidth={2} markerEnd="url(#arrowUp)" />
      <text x={MARGIN.left} y={beamY + 20 + arrowLen + 14} textAnchor="middle"
        className="text-[10px] fill-primary font-bold">
        R = {formatVal(Rleft)} kN
      </text>

      <line x1={MARGIN.left + plotW} y1={beamY + 20 + arrowLen} x2={MARGIN.left + plotW} y2={beamY + 20}
        stroke="hsl(var(--primary))" strokeWidth={2} markerEnd="url(#arrowUp)" />
      <text x={MARGIN.left + plotW} y={beamY + 20 + arrowLen + 14} textAnchor="middle"
        className="text-[10px] fill-primary font-bold">
        R = {formatVal(Rright)} kN
      </text>

      {/* Span label */}
      <text x={W / 2} y={beamY + 14} textAnchor="middle"
        className="text-[10px] fill-muted-foreground">
        L = {formatVal(L)} m
      </text>
    </svg>
  );
}

// ── Generic Diagram (Shear / Moment) ──
function DiagramSVG({ data, label, unit, flipY, colorPos, colorNeg }: {
  data: { x: number; V: number }[];
  label: string;
  unit: string;
  flipY?: boolean;
  colorPos: string;
  colorNeg: string;
}) {
  if (data.length === 0) return null;

  const xMax = data[data.length - 1].x;
  const vals = data.map(d => d.V);
  const vMin = Math.min(...vals, 0);
  const vMax = Math.max(...vals, 0);
  const range = Math.max(vMax - vMin, 0.01);
  const padding = range * 0.15;

  const scaleX = (x: number) => MARGIN.left + (x / xMax) * plotW;
  const scaleY = (v: number) => {
    const normalized = (v - (vMin - padding)) / (range + 2 * padding);
    return flipY
      ? MARGIN.top + normalized * plotH
      : MARGIN.top + (1 - normalized) * plotH;
  };
  const zeroY = scaleY(0);

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${scaleX(d.x).toFixed(1)},${scaleY(d.V).toFixed(1)}`).join(' ');
  const fillPath = `M${scaleX(0).toFixed(1)},${zeroY.toFixed(1)} ${linePath.replace(/^M/, 'L')} L${scaleX(xMax).toFixed(1)},${zeroY.toFixed(1)} Z`;

  const maxIdx = vals.indexOf(Math.max(...vals));
  const minIdx = vals.indexOf(Math.min(...vals));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H + 10 }}>
      <defs>
        <linearGradient id={`fill-${label}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorPos} stopOpacity="0.35" />
          <stop offset="100%" stopColor={colorNeg} stopOpacity="0.35" />
        </linearGradient>
      </defs>

      <text x={MARGIN.left - 5} y={14} className="text-[11px] fill-foreground font-bold">{label} ({unit})</text>

      {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
        const y = MARGIN.top + frac * plotH;
        return <line key={i} x1={MARGIN.left} y1={y} x2={MARGIN.left + plotW} y2={y}
          stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="3,3" />;
      })}

      <line x1={MARGIN.left} y1={zeroY} x2={MARGIN.left + plotW} y2={zeroY}
        stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="4,2" />

      <path d={fillPath} fill={`url(#fill-${label})`} />
      <path d={linePath} fill="none" stroke={colorPos} strokeWidth={2} strokeLinejoin="round" />

      {vMax > 0.01 && (
        <g>
          <circle cx={scaleX(data[maxIdx].x)} cy={scaleY(vMax)} r={3} fill={colorPos} />
          <text x={scaleX(data[maxIdx].x)} y={scaleY(vMax) - 8}
            textAnchor="middle" className="text-[9px] font-bold" fill={colorPos}>
            {formatVal(vMax)}
          </text>
        </g>
      )}

      {vMin < -0.01 && (
        <g>
          <circle cx={scaleX(data[minIdx].x)} cy={scaleY(vMin)} r={3} fill={colorNeg} />
          <text x={scaleX(data[minIdx].x)} y={scaleY(vMin) + 14}
            textAnchor="middle" className="text-[9px] font-bold" fill={colorNeg}>
            {formatVal(vMin)}
          </text>
        </g>
      )}

      <text x={MARGIN.left} y={H - 5} textAnchor="start" className="text-[9px] fill-muted-foreground">0</text>
      <text x={MARGIN.left + plotW} y={H - 5} textAnchor="end" className="text-[9px] fill-muted-foreground">{formatVal(xMax)} m</text>
    </svg>
  );
}

export default function BeamLoadDiagrams({ frameResults, beams, engineLabel, bobConnections = [], beamHinges = new Map() }: BeamLoadDiagramsProps) {
  const allBeamData = useMemo(() => getBeamData(frameResults, beams, bobConnections, beamHinges), [frameResults, beams, bobConnections, beamHinges]);
  const [selectedBeamId, setSelectedBeamId] = useState<string>("");

  const bd = useMemo(() => allBeamData.find(b => b.beamId === selectedBeamId), [allBeamData, selectedBeamId]);
  const shearData = useMemo(() => bd ? computeShearStations(bd) : [], [bd]);
  const momentData = useMemo(() => bd ? computeMomentStations(bd).map(p => ({ x: p.x, V: p.M })) : [], [bd]);

  if (allBeamData.length === 0) {
    return (
      <Card><CardContent className="py-12 text-center">
        <p className="text-muted-foreground">لا توجد نتائج تحليل. شغّل التحليل أولاً.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">رسومات أحمال الجسور</CardTitle>
            <Badge variant="outline" className="text-[10px]">{engineLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={selectedBeamId} onValueChange={setSelectedBeamId}>
            <SelectTrigger className="max-w-xs h-9 text-xs">
              <SelectValue placeholder="اختر جسراً..." />
            </SelectTrigger>
            <SelectContent>
              {allBeamData.map(b => (
                <SelectItem key={b.beamId} value={b.beamId} className="text-xs">
                  {b.beamId} — L={formatVal(b.span)}m, w={formatVal(b.w)} kN/m
                  {b.pointLoads.length > 0 ? ` + ${b.pointLoads.length} حمل مركز` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {bd && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-[10px]">
                <Badge variant="secondary">Mleft = {formatVal(bd.Mleft)} kN·m</Badge>
                <Badge variant="secondary">Mmid = {formatVal(bd.Mmid)} kN·m</Badge>
                <Badge variant="secondary">Mright = {formatVal(bd.Mright)} kN·m</Badge>
                <Badge variant="secondary">Vu = {formatVal(bd.Vu)} kN</Badge>
                {bd.hingeLeft && <Badge variant="outline" className="text-orange-600 border-orange-400">نهاية يسار محررة</Badge>}
                {bd.hingeRight && <Badge variant="outline" className="text-orange-600 border-orange-400">نهاية يمين محررة</Badge>}
                {bd.pointLoads.map((pl, i) => (
                  <Badge key={i} variant="outline" className="text-orange-600 border-orange-400">
                    P={formatVal(pl.P)} kN @ {formatVal(pl.a)}m
                  </Badge>
                ))}
              </div>

              <div className="border rounded-lg p-2 bg-card">
                <p className="text-[11px] font-semibold text-muted-foreground mb-1">الأحمال وردود الأفعال</p>
                <LoadDiagram bd={bd} />
              </div>

              <div className="border rounded-lg p-2 bg-card">
                <DiagramSVG
                  data={shearData}
                  label="قوى القص V"
                  unit="kN"
                  colorPos="#3b82f6"
                  colorNeg="#ef4444"
                />
              </div>

              <div className="border rounded-lg p-2 bg-card">
                <DiagramSVG
                  data={momentData}
                  label="العزوم M"
                  unit="kN·m"
                  flipY
                  colorPos="#8b5cf6"
                  colorNeg="#f97316"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
