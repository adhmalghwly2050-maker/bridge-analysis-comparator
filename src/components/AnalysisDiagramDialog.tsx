import React, { useState, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Download } from 'lucide-react';

interface DiagramData {
  elementId: string;
  elementType: 'beam' | 'column' | 'slab';
  span: number;
  // Beam data
  Mleft?: number;
  Mmid?: number;
  Mright?: number;
  Vu?: number;
  deflection?: number;
  // Reactions
  Rleft?: number;
  Rright?: number;
  // Load
  wu?: number;
  // Column data
  MxTop?: number;
  MxBot?: number;
  MyTop?: number;
  MyBot?: number;
  Pu?: number;
  colLength?: number;
  // Hinge flags — moment is released (zero) at this end
  hingeLeft?: boolean;
  hingeRight?: boolean;
  // Carrier-beam point load (produces kink in moment diagram)
  pointLoadP?: number;  // kN
  pointLoadA?: number;  // m from left end of beam
  // Carrier beam segment info — which end connects to the continuation
  isCarrierLeft?: boolean;   // true = this segment's RIGHT end connects to continuation
  isCarrierRight?: boolean;  // true = this segment's LEFT end connects to continuation (this is the A2 segment)
  // Total girder span for carrier beams (for L/240 check)
  totalGirderSpan?: number;  // m
}

interface AnalysisDiagramDialogProps {
  open: boolean;
  onClose: () => void;
  data: DiagramData | null;
}

function ColumnDiagramCanvas({ type, data, width = 500, height = 250 }: {
  type: 'moment-x' | 'moment-y' | 'axial';
  data: DiagramData;
  width?: number;
  height?: number;
}) {
  const padX = 60;
  const padY = 30;
  const drawW = width - padX * 2;
  const drawH = height - padY * 2;
  const midX = padX + drawW / 2;

  const L = data.colLength ? data.colLength / 1000 : data.span || 3;
  const toY = (pos: number) => padY + drawH - (pos / L) * drawH;

  const posColor = 'hsl(142 71% 45%)';
  const negColor = 'hsl(0 84.2% 60.2%)';

  if (type === 'axial') {
    const Pu = data.Pu || 0;
    return (
      <svg width={width} height={height} className="bg-card border border-border rounded">
        <text x={width / 2} y={16} textAnchor="middle" className="fill-foreground text-xs font-semibold">الحمل المحوري (kN)</text>
        {/* Column line */}
        <line x1={midX} y1={padY} x2={midX} y2={padY + drawH} stroke="hsl(var(--foreground))" strokeWidth="2" />
        {/* Axial force - constant along column */}
        <rect x={midX} y={padY} width={Math.min(Math.abs(Pu) * 0.5, drawW / 3)} height={drawH} fill="hsl(var(--primary))" opacity="0.15" />
        <line x1={midX + Math.min(Math.abs(Pu) * 0.5, drawW / 3)} y1={padY} x2={midX + Math.min(Math.abs(Pu) * 0.5, drawW / 3)} y2={padY + drawH} stroke="hsl(var(--primary))" strokeWidth="1.5" />
        {/* Arrow down */}
        <line x1={midX} y1={padY - 5} x2={midX} y2={padY + 20} stroke="hsl(var(--destructive))" strokeWidth="2" markerEnd="url(#arrowDown)" />
        <text x={midX + 10} y={padY + drawH / 2} className="fill-foreground" fontSize="11" fontFamily="monospace">Pu = {Pu.toFixed(1)} kN</text>
        {/* Fixed support at bottom */}
        <line x1={midX - 15} y1={padY + drawH} x2={midX + 15} y2={padY + drawH} stroke="hsl(var(--foreground))" strokeWidth="2" />
        {[0, 1, 2, 3, 4].map(i => <line key={i} x1={midX - 15 + i * 8} y1={padY + drawH} x2={midX - 20 + i * 8} y2={padY + drawH + 8} stroke="hsl(var(--foreground))" strokeWidth="1" />)}
        <text x={width / 2} y={height - 5} textAnchor="middle" className="fill-muted-foreground" fontSize="10">L = {L.toFixed(2)} م</text>
        <defs>
          <marker id="arrowDown" viewBox="0 0 10 10" refX="5" refY="10" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 0 L 5 10 z" fill="hsl(var(--destructive))" />
          </marker>
        </defs>
      </svg>
    );
  }

  // Moment diagram for column (linear between top and bottom)
  const Mtop = type === 'moment-x' ? (data.MxTop || 0) : (data.MyTop || 0);
  const Mbot = type === 'moment-x' ? (data.MxBot || 0) : (data.MyBot || 0);
  const label = type === 'moment-x' ? 'العزوم Mx (kN·m)' : 'العزوم My (kN·m)';

  const maxVal = Math.max(Math.abs(Mtop), Math.abs(Mbot), 0.01);
  const scl = (drawW / 2 - 20) / maxVal;

  // Column moment is linear from top to bottom
  const nPts = 30;
  const points = Array.from({ length: nPts + 1 }, (_, i) => {
    const t = i / nPts;
    const y = t * L;
    const M = Mtop + (Mbot - Mtop) * t;
    return { y, M };
  });

  const curvePath = points.map((p, i) => {
    const px = midX + p.M * scl;
    const py = toY(L - p.y);
    return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
  }).join(' ');

  const posFill = `M ${midX} ${toY(L)} ${points.map(p => `L ${midX + Math.max(0, p.M) * scl} ${toY(L - p.y)}`).join(' ')} L ${midX} ${toY(0)} Z`;
  const negFill = `M ${midX} ${toY(L)} ${points.map(p => `L ${midX + Math.min(0, p.M) * scl} ${toY(L - p.y)}`).join(' ')} L ${midX} ${toY(0)} Z`;

  return (
    <svg width={width} height={height} className="bg-card border border-border rounded">
      <text x={width / 2} y={16} textAnchor="middle" className="fill-foreground text-xs font-semibold">{label}</text>
      {/* Column center line */}
      <line x1={midX} y1={padY} x2={midX} y2={padY + drawH} stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" strokeDasharray="4" />
      {/* Positive and negative fills */}
      <path d={posFill} fill={posColor} opacity="0.15" />
      <path d={negFill} fill={negColor} opacity="0.15" />
      {/* Moment curve */}
      <path d={curvePath} fill="none" stroke="hsl(var(--foreground))" strokeWidth="2" />
      {/* Top moment label */}
      {Math.abs(Mtop) > 0.01 && (
        <text x={midX + Mtop * scl + (Mtop >= 0 ? 8 : -8)} y={toY(L) + 4} textAnchor={Mtop >= 0 ? "start" : "end"} fontSize="10" fontFamily="monospace" fill={Mtop >= 0 ? posColor : negColor}>
          {Mtop.toFixed(2)}
        </text>
      )}
      {/* Bottom moment label */}
      {Math.abs(Mbot) > 0.01 && (
        <text x={midX + Mbot * scl + (Mbot >= 0 ? 8 : -8)} y={toY(0) - 4} textAnchor={Mbot >= 0 ? "start" : "end"} fontSize="10" fontFamily="monospace" fill={Mbot >= 0 ? posColor : negColor}>
          {Mbot.toFixed(2)}
        </text>
      )}
      {/* Labels: Top / Bottom */}
      <text x={padX - 5} y={toY(L) + 4} textAnchor="end" fontSize="9" className="fill-muted-foreground">أعلى</text>
      <text x={padX - 5} y={toY(0)} textAnchor="end" fontSize="9" className="fill-muted-foreground">أسفل</text>
      {/* Fixed support at bottom */}
      <line x1={midX - 15} y1={padY + drawH} x2={midX + 15} y2={padY + drawH} stroke="hsl(var(--foreground))" strokeWidth="2" />
      {[0, 1, 2, 3, 4].map(i => <line key={i} x1={midX - 15 + i * 8} y1={padY + drawH} x2={midX - 20 + i * 8} y2={padY + drawH + 8} stroke="hsl(var(--foreground))" strokeWidth="1" />)}
      {/* Span label */}
      <text x={width / 2} y={height - 5} textAnchor="middle" className="fill-muted-foreground" fontSize="10">L = {L.toFixed(2)} م</text>
      {/* Legend */}
      <rect x={padX} y={height - 18} width={8} height={8} fill={posColor} opacity="0.5" />
      <text x={padX + 12} y={height - 11} fontSize="8" fill={posColor}>موجب (+)</text>
      <rect x={padX + 60} y={height - 18} width={8} height={8} fill={negColor} opacity="0.5" />
      <text x={padX + 72} y={height - 11} fontSize="8" fill={negColor}>سالب (−)</text>
    </svg>
  );
}

function DiagramCanvas({ type, data, width = 500, height = 180 }: {
  type: 'moment' | 'shear' | 'deflection' | 'reactions';
  data: DiagramData;
  width?: number;
  height?: number;
}) {
  const padX = 50;
  const padY = 30;
  const drawW = width - padX * 2;
  const drawH = height - padY * 2;
  const midY = padY + drawH / 2;

  const L = data.span || 5;
  const toX = (pos: number) => padX + (pos / L) * drawW;

  // Effective end moments (clamped to zero at released ends)
  const Ml = data.hingeLeft ? 0 : (data.Mleft || 0);
  const Mr = data.hingeRight ? 0 : (data.Mright || 0);
  const Mm = data.Mmid || 0;
  const w  = data.wu || 0;
  const Rl = data.Rleft || 0;
  const hasPointLoad = data.pointLoadP !== undefined && data.pointLoadA !== undefined;

  /**
   * Exact beam mechanics formula when a concentrated load P is present.
   * M(x) = Ml + Rl*x - w*x²/2 - P*(x-a)·H(x-a)
   * For standard beams uses a Hermite polynomial (normalized t = x/L).
   */
  const getMomentAt = (x: number) => {
    if (hasPointLoad) {
      let M = Ml + Rl * x - w * x * x / 2;
      if (x > data.pointLoadA!) M -= data.pointLoadP! * (x - data.pointLoadA!);
      return M;
    }
    const t = x / L;
    return Ml * (1 - 3 * t + 2 * t * t) + Mm * (4 * t - 4 * t * t) + Mr * (-t + 2 * t * t);
  };

  /**
   * Exact shear formula; uses jump at point load location.
   * For standard beams uses a linear approximation.
   */
  const getShearAt = (x: number) => {
    if (hasPointLoad) {
      let V = Rl - w * x;
      if (x >= data.pointLoadA!) V -= data.pointLoadP!;
      return V;
    }
    const Vu = data.Vu || 0;
    const t = x / L;
    return Vu * (1 - 2 * t);
  };

  const getDeflectionAt = (x: number) => {
    const dMax = data.deflection || 0;
    const t = x / L;
    // For carrier beam segments: max deflection is NOT at midspan
    // The end connected to continuation has zero slope (continuous) so deflection shape shifts
    if (data.isCarrierLeft) {
      // A1 segment: left end is supported (column), right end connects to A2 (no real support)
      // Shape is like cantilever-like from right: max deflection near the connection point (right end)
      // Use cubic shape: δ(x) = dMax * t² * (3 - 2*t) — max near right end
      return -dMax * t * t * (3 - 2 * t);
    }
    if (data.isCarrierRight) {
      // A2 segment: left end connects to A1 (no real support), right end is supported (column)
      // Shape: max deflection near the connection point (left end)
      const tInv = 1 - t;
      return -dMax * tInv * tInv * (3 - 2 * tInv);
    }
    // Standard beam: symmetric parabola
    return -dMax * 4 * t * (1 - t);
  };

  // --- Hinge / point-load indicator positions ---
  const HINGE_R = 5;
  const posColor = 'hsl(142 71% 45%)';
  const negColor = 'hsl(0 84.2% 60.2%)';

  // ===================== MOMENT DIAGRAM =====================
  if (type === 'moment') {
    // Include the exact kink position in the sample set
    const nPts = 50;
    let xSamples = Array.from({ length: nPts + 1 }, (_, i) => (i / nPts) * L);
    if (hasPointLoad && data.pointLoadA! > 0 && data.pointLoadA! < L) {
      xSamples = [...xSamples, data.pointLoadA!];
      xSamples.sort((a, b) => a - b);
    }

    const points = xSamples.map(x => ({ x, val: getMomentAt(x) }));
    const maxVal = Math.max(...points.map(p => Math.abs(p.val)), 0.01);
    const scl = (drawH / 2 - 5) / maxVal;

    const curvePath = points.map((p, i) => {
      const px = toX(p.x);
      const py = midY - p.val * scl;
      return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
    }).join(' ');

    const posFill = `M ${toX(0)} ${midY} ${points.map(p => `L ${toX(p.x)} ${midY - Math.max(0, p.val) * scl}`).join(' ')} L ${toX(L)} ${midY} Z`;
    const negFill = `M ${toX(0)} ${midY} ${points.map(p => `L ${toX(p.x)} ${midY - Math.min(0, p.val) * scl}`).join(' ')} L ${toX(L)} ${midY} Z`;

    const minP = points.reduce((a, b) => a.val < b.val ? a : b);
    const maxP = points.reduce((a, b) => a.val > b.val ? a : b);

    // Support symbols — triangle + hinge circle when released
    const leftSupport = (
      <>
        <polygon points={`${padX},${midY} ${padX - 6},${midY + 10} ${padX + 6},${midY + 10}`} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1" />
        {data.hingeLeft && (
          <>
            <circle cx={padX} cy={midY} r={HINGE_R} fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
            <text x={padX} y={midY - HINGE_R - 4} textAnchor="middle" fontSize="8" fill="hsl(var(--muted-foreground))">رز=0</text>
          </>
        )}
      </>
    );
    const rightSupport = (
      <>
        <polygon points={`${toX(L)},${midY} ${toX(L) - 6},${midY + 10} ${toX(L) + 6},${midY + 10}`} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1" />
        {data.hingeRight && (
          <>
            <circle cx={toX(L)} cy={midY} r={HINGE_R} fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
            <text x={toX(L)} y={midY - HINGE_R - 4} textAnchor="middle" fontSize="8" fill="hsl(var(--muted-foreground))">رز=0</text>
          </>
        )}
      </>
    );

    return (
      <svg width={width} height={height} className="bg-card border border-border rounded">
        <text x={width / 2} y={16} textAnchor="middle" className="fill-foreground text-xs font-semibold">العزوم (kN·m)</text>
        <line x1={padX} y1={midY} x2={padX + drawW} y2={midY} stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" strokeDasharray="4" />
        <path d={posFill} fill={posColor} opacity="0.15" />
        <path d={negFill} fill={negColor} opacity="0.15" />
        <path d={curvePath} fill="none" stroke="hsl(var(--foreground))" strokeWidth="2" />
        {leftSupport}
        {rightSupport}
        {/* Point load marker (carrier beam) */}
        {hasPointLoad && data.pointLoadA! > 0 && data.pointLoadA! < L && (
          <>
            <line x1={toX(data.pointLoadA!)} y1={padY} x2={toX(data.pointLoadA!)} y2={midY} stroke="hsl(var(--destructive))" strokeWidth="1" strokeDasharray="3" />
            <polygon points={`${toX(data.pointLoadA!)},${midY - 2} ${toX(data.pointLoadA!) - 5},${padY + 5} ${toX(data.pointLoadA!) + 5},${padY + 5}`} fill="hsl(var(--destructive))" opacity="0.6" />
            <text x={toX(data.pointLoadA!)} y={padY - 2} textAnchor="middle" fontSize="9" fill="hsl(var(--destructive))" fontFamily="monospace">P={data.pointLoadP!.toFixed(1)}kN</text>
          </>
        )}
        {Math.abs(maxP.val) > 0.01 && (
          <text x={toX(maxP.x)} y={midY - maxP.val * scl - 6} textAnchor="middle" fontSize="10" fontFamily="monospace" fill={maxP.val > 0 ? posColor : negColor}>
            {maxP.val.toFixed(2)}
          </text>
        )}
        {Math.abs(minP.val) > 0.01 && minP !== maxP && (
          <text x={toX(minP.x)} y={midY - minP.val * scl + 14} textAnchor="middle" fontSize="10" fontFamily="monospace" fill={minP.val > 0 ? posColor : negColor}>
            {minP.val.toFixed(2)}
          </text>
        )}
        {/* Hinge end-moment labels (zero) */}
        {data.hingeLeft && (
          <text x={padX + 3} y={midY - 8} fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="monospace">0.00</text>
        )}
        {data.hingeRight && (
          <text x={toX(L) - 3} y={midY - 8} textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="monospace">0.00</text>
        )}
        <text x={width / 2} y={height - 5} textAnchor="middle" className="fill-muted-foreground" fontSize="10">L = {L.toFixed(2)} م</text>
        <rect x={padX} y={height - 18} width={8} height={8} fill={posColor} opacity="0.5" />
        <text x={padX + 12} y={height - 11} fontSize="8" fill={posColor}>موجب (شد سفلي)</text>
        <rect x={padX + 90} y={height - 18} width={8} height={8} fill={negColor} opacity="0.5" />
        <text x={padX + 102} y={height - 11} fontSize="8" fill={negColor}>سالب (شد علوي)</text>
      </svg>
    );
  }

  // ===================== SHEAR DIAGRAM =====================
  if (type === 'shear') {
    const shearColor = 'hsl(var(--destructive))';
    const nPts = 50;
    let xSamples = Array.from({ length: nPts + 1 }, (_, i) => (i / nPts) * L);

    // Add points around the jump discontinuity for a sharp visual step
    if (hasPointLoad && data.pointLoadA! > 0 && data.pointLoadA! < L) {
      const eps = L * 0.001;
      xSamples = [...xSamples, data.pointLoadA! - eps, data.pointLoadA! + eps];
      xSamples.sort((a, b) => a - b);
    }

    const points = xSamples.map(x => ({ x, val: getShearAt(x) }));
    const maxVal = Math.max(...points.map(p => Math.abs(p.val)), 0.01);
    const scale = (drawH / 2 - 5) / maxVal;

    const pathData = points.map((p, i) => {
      const px = toX(p.x);
      const py = midY - p.val * scale;
      return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
    }).join(' ');

    const fillPath = `M ${toX(0)} ${midY} ${points.map(p => `L ${toX(p.x)} ${midY - p.val * scale}`).join(' ')} L ${toX(L)} ${midY} Z`;

    const minP = points.reduce((a, b) => a.val < b.val ? a : b);
    const maxP = points.reduce((a, b) => a.val > b.val ? a : b);

    return (
      <svg width={width} height={height} className="bg-card border border-border rounded">
        <text x={width / 2} y={16} textAnchor="middle" className="fill-foreground text-xs font-semibold">قوى القص (kN)</text>
        <line x1={padX} y1={midY} x2={padX + drawW} y2={midY} stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" strokeDasharray="4" />
        <path d={fillPath} fill={shearColor} opacity="0.15" />
        <path d={pathData} fill="none" stroke={shearColor} strokeWidth="2" />
        <polygon points={`${padX},${midY} ${padX - 6},${midY + 10} ${padX + 6},${midY + 10}`} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1" />
        <polygon points={`${toX(L)},${midY} ${toX(L) - 6},${midY + 10} ${toX(L) + 6},${midY + 10}`} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1" />
        {/* Point load jump marker */}
        {hasPointLoad && data.pointLoadA! > 0 && data.pointLoadA! < L && (
          <line x1={toX(data.pointLoadA!)} y1={padY} x2={toX(data.pointLoadA!)} y2={padY + drawH} stroke="hsl(var(--destructive))" strokeWidth="0.8" strokeDasharray="3" opacity="0.5" />
        )}
        {Math.abs(maxP.val) > 0.01 && (
          <text x={toX(maxP.x)} y={midY - maxP.val * scale - 6} textAnchor="middle" className="fill-foreground" fontSize="10" fontFamily="monospace">
            {maxP.val.toFixed(2)}
          </text>
        )}
        {Math.abs(minP.val) > 0.01 && minP !== maxP && (
          <text x={toX(minP.x)} y={midY - minP.val * scale + 14} textAnchor="middle" className="fill-foreground" fontSize="10" fontFamily="monospace">
            {minP.val.toFixed(2)}
          </text>
        )}
        <text x={padX + drawW / 2} y={height - 5} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
          L = {L.toFixed(2)} م
        </text>
      </svg>
    );
  }

  // ===================== DEFLECTION DIAGRAM =====================
  if (type === 'deflection') {
    const deflColor = 'hsl(var(--accent))';
    const nPts = 50;
    const points = Array.from({ length: nPts + 1 }, (_, i) => {
      const x = (i / nPts) * L;
      return { x, val: getDeflectionAt(x) };
    });
    const maxVal = Math.max(...points.map(p => Math.abs(p.val)), 0.01);
    const scale = (drawH / 2 - 5) / maxVal;

    const pathData = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x)} ${midY - p.val * scale}`).join(' ');
    const fillPath = `M ${toX(0)} ${midY} ${points.map(p => `L ${toX(p.x)} ${midY - p.val * scale}`).join(' ')} L ${toX(L)} ${midY} Z`;
    const minP = points.reduce((a, b) => a.val < b.val ? a : b);

    // Check if carrier beam segment — show total girder length
    const isCarrier = data.isCarrierLeft || data.isCarrierRight;
    // Total girder length info comes from the data.totalGirderSpan if provided
    const totalGirderL = (data as any).totalGirderSpan;

    return (
      <svg width={width} height={height} className="bg-card border border-border rounded">
        <text x={width / 2} y={16} textAnchor="middle" className="fill-foreground text-xs font-semibold">التشوه (mm)</text>
        <line x1={padX} y1={midY} x2={padX + drawW} y2={midY} stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" strokeDasharray="4" />
        <path d={fillPath} fill={deflColor} opacity="0.15" />
        <path d={pathData} fill="none" stroke={deflColor} strokeWidth="2" />
        <polygon points={`${padX},${midY} ${padX - 6},${midY + 10} ${padX + 6},${midY + 10}`} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1" />
        <polygon points={`${toX(L)},${midY} ${toX(L) - 6},${midY + 10} ${toX(L) + 6},${midY + 10}`} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1" />
        {/* Max deflection label */}
        {Math.abs(minP.val) > 0.01 && (
          <text x={toX(minP.x)} y={midY - minP.val * scale + 14} textAnchor="middle" className="fill-foreground" fontSize="10" fontFamily="monospace">
            {Math.abs(minP.val).toFixed(2)} mm
          </text>
        )}
        {/* Carrier beam indicator — show connection point */}
        {isCarrier && (
          <>
            {data.isCarrierLeft && (
              <text x={toX(L) - 5} y={padY + 8} textAnchor="end" fontSize="8" fill="hsl(var(--accent))">← اتصال</text>
            )}
            {data.isCarrierRight && (
              <text x={padX + 5} y={padY + 8} textAnchor="start" fontSize="8" fill="hsl(var(--accent))">اتصال →</text>
            )}
          </>
        )}
        <text x={padX + drawW / 2} y={height - 5} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
          L = {L.toFixed(2)} م
          {totalGirderL ? `  |  L الكلي = ${totalGirderL.toFixed(2)} م  |  L/240 = ${(totalGirderL * 1000 / 240).toFixed(1)} mm` : ''}
        </text>
        {/* Allowable deflection line if carrier */}
        {totalGirderL && (
          <>
            {(() => {
              const allowable = totalGirderL * 1000 / 240;
              if (allowable > 0 && maxVal > 0) {
                const lineY = midY + allowable * scale;
                if (lineY < midY + drawH / 2) {
                  return (
                    <>
                      <line x1={padX} y1={lineY} x2={padX + drawW} y2={lineY} stroke="hsl(var(--destructive))" strokeWidth="0.8" strokeDasharray="4" opacity="0.6" />
                      <text x={padX + drawW - 5} y={lineY - 3} textAnchor="end" fontSize="8" fill="hsl(var(--destructive))" opacity="0.7">
                        L/240 = {allowable.toFixed(1)} mm
                      </text>
                    </>
                  );
                }
              }
              return null;
            })()}
          </>
        )}
      </svg>
    );
  }

  // ===================== REACTIONS DIAGRAM =====================
  const reactionColor = 'hsl(var(--primary))';
  const Rl2 = data.Rleft ?? (w * L / 2 + (hasPointLoad ? data.pointLoadP! * (L - data.pointLoadA!) / L : 0));
  const Rr2 = data.Rright ?? (w * L / 2 + (hasPointLoad ? data.pointLoadP! * data.pointLoadA! / L : 0));

  return (
    <svg width={width} height={height} className="bg-card border border-border rounded">
      <text x={width / 2} y={16} textAnchor="middle" className="fill-foreground text-xs font-semibold">ردود الأفعال (kN)</text>
      <line x1={padX} y1={midY} x2={padX + drawW} y2={midY} stroke="hsl(var(--foreground))" strokeWidth="2" />
      {/* Distributed load arrows */}
      {w > 0 && Array.from({ length: 8 }, (_, i) => {
        const ax = padX + (i / 7) * drawW;
        return <line key={i} x1={ax} y1={padY} x2={ax} y2={midY - 15} stroke="hsl(var(--muted-foreground))" strokeWidth="1" markerEnd="url(#arrowDn)" opacity="0.5" />;
      })}
      {w > 0 && <line x1={padX} y1={padY} x2={padX + drawW} y2={padY} stroke="hsl(var(--muted-foreground))" strokeWidth="1" />}
      {w > 0 && <text x={width / 2} y={padY - 4} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="monospace">w={w.toFixed(1)} kN/m</text>}
      {/* Point load arrow */}
      {hasPointLoad && data.pointLoadA! >= 0 && data.pointLoadA! <= L && (
        <>
          <line x1={toX(data.pointLoadA!)} y1={padY} x2={toX(data.pointLoadA!)} y2={midY - 5} stroke="hsl(var(--destructive))" strokeWidth="2" markerEnd="url(#arrowDn)" />
          <text x={toX(data.pointLoadA!)} y={padY - 3} textAnchor="middle" fontSize="9" fill="hsl(var(--destructive))" fontFamily="monospace">P={data.pointLoadP!.toFixed(1)}</text>
        </>
      )}
      {/* Left reaction */}
      <line x1={padX} y1={midY + 40} x2={padX} y2={midY + 5} stroke={reactionColor} strokeWidth="2" markerEnd="url(#arrow)" />
      <text x={padX} y={midY + 55} textAnchor="middle" className="fill-foreground" fontSize="11" fontFamily="monospace">{Rl2.toFixed(1)}</text>
      {/* Right reaction */}
      <line x1={padX + drawW} y1={midY + 40} x2={padX + drawW} y2={midY + 5} stroke={reactionColor} strokeWidth="2" markerEnd="url(#arrow)" />
      <text x={padX + drawW} y={midY + 55} textAnchor="middle" className="fill-foreground" fontSize="11" fontFamily="monospace">{Rr2.toFixed(1)}</text>
      {/* Support triangles */}
      <polygon points={`${padX},${midY} ${padX - 8},${midY + 12} ${padX + 8},${midY + 12}`} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
      <polygon points={`${padX + drawW},${midY} ${padX + drawW - 8},${midY + 12} ${padX + drawW + 8},${midY + 12}`} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
      <text x={padX + drawW / 2} y={height - 5} textAnchor="middle" className="fill-muted-foreground" fontSize="10">L = {L.toFixed(2)} م</text>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={reactionColor} />
        </marker>
        <marker id="arrowDn" viewBox="0 0 10 10" refX="5" refY="10" markerWidth="4" markerHeight="4" orient="auto">
          <path d="M 0 0 L 10 0 L 5 10 z" fill="hsl(var(--muted-foreground))" />
        </marker>
      </defs>
    </svg>
  );
}

export default function AnalysisDiagramDialog({ open, onClose, data }: AnalysisDiagramDialogProps) {
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const containerRef = useRef<HTMLDivElement>(null);

  if (!data) return null;

  const isColumn = data.elementType === 'column';

  const handleExportPDF = async () => {
    try {
      const { default: jsPDF } = await import('jspdf');
      const doc = new jsPDF('p', 'mm', 'a4');
      doc.setFontSize(14);
      doc.text(`Analysis Diagrams - ${data.elementType === 'beam' ? 'Beam' : 'Column'} ${data.elementId}`, 20, 20);
      doc.setFontSize(10);
      doc.text(`Length: ${data.span?.toFixed(2)} m`, 20, 30);
      doc.save(`analysis_${data.elementId}.pdf`);
    } catch {
      // fallback
    }
  };

  const colTypes: ('moment-x' | 'moment-y' | 'axial')[] = ['moment-x', 'moment-y', 'axial'];
  const beamTypes: ('moment' | 'shear' | 'deflection' | 'reactions')[] = ['moment', 'shear', 'deflection', 'reactions'];

  const filteredColTypes = activeFilter === 'all' ? colTypes : colTypes.filter(t => t === activeFilter);
  const filteredBeamTypes = activeFilter === 'all' ? beamTypes : beamTypes.filter(t => t === activeFilter);

  const badgeParts = [`L=${data.span?.toFixed(2)}م`];
  if (data.hingeLeft) badgeParts.push('دوران يسار');
  if (data.hingeRight) badgeParts.push('دوران يمين');
  if (data.pointLoadP) badgeParts.push(`P=${data.pointLoadP.toFixed(1)}kN`);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2 flex-wrap">
            رسومات التحليل - {data.elementId}
            {badgeParts.map((bp, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">{bp}</Badge>
            ))}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isColumn ? 'عرض رسومات العزوم والحمل المحوري للعمود' : 'عرض رسومات العزوم والقص والتشوه وردود الأفعال'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeFilter} onValueChange={v => setActiveFilter(v)}>
          <TabsList className="w-full">
            <TabsTrigger value="all" className="text-xs">الكل</TabsTrigger>
            {isColumn ? (
              <>
                <TabsTrigger value="moment-x" className="text-xs">عزم Mx</TabsTrigger>
                <TabsTrigger value="moment-y" className="text-xs">عزم My</TabsTrigger>
                <TabsTrigger value="axial" className="text-xs">محوري</TabsTrigger>
              </>
            ) : (
              <>
                <TabsTrigger value="moment" className="text-xs">العزوم</TabsTrigger>
                <TabsTrigger value="shear" className="text-xs">القص</TabsTrigger>
                <TabsTrigger value="deflection" className="text-xs">التشوه</TabsTrigger>
                <TabsTrigger value="reactions" className="text-xs">ردود الأفعال</TabsTrigger>
              </>
            )}
          </TabsList>
        </Tabs>

        <div ref={containerRef} className="space-y-3">
          {isColumn ? (
            filteredColTypes.map(t => (
              <ColumnDiagramCanvas key={t} type={t} data={data} />
            ))
          ) : (
            filteredBeamTypes.map(t => (
              <DiagramCanvas key={t} type={t} data={data} />
            ))
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handleExportPDF} className="min-h-[44px] gap-1">
            <Download size={14} /> تصدير PDF
          </Button>
          <Button variant="outline" size="sm" onClick={onClose} className="min-h-[44px]">إغلاق</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
