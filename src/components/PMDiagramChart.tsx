import React from 'react';
import type { PMPoint } from '@/lib/structuralEngine';

interface PMDiagramChartProps {
  pmDiagram: PMPoint[];
  designPu: number;
  designMu: number;
  colId?: string;
  width?: number;
  height?: number;
}

export default function PMDiagramChart({ pmDiagram, designPu, designMu, colId, width = 300, height = 250 }: PMDiagramChartProps) {
  if (!pmDiagram || pmDiagram.length < 2) return null;

  const margin = { top: 25, right: 15, bottom: 35, left: 55 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  const maxMn = Math.max(...pmDiagram.map(p => p.phiMn), designMu) * 1.15;
  const maxPn = Math.max(...pmDiagram.map(p => p.phiPn), designPu) * 1.15;
  const minPn = Math.min(...pmDiagram.map(p => p.phiPn), 0);

  const scaleX = (v: number) => margin.left + (v / maxMn) * w;
  const scaleY = (v: number) => margin.top + h - ((v - minPn) / (maxPn - minPn)) * h;

  // Build path for interaction curve
  const sorted = [...pmDiagram].sort((a, b) => a.phiMn - b.phiMn || b.phiPn - a.phiPn);
  // Create hull-like path
  const pts = pmDiagram.filter(p => p.phiMn >= 0 && p.phiPn >= minPn);
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${scaleX(p.phiMn).toFixed(1)},${scaleY(p.phiPn).toFixed(1)}`).join(' ');

  // φPn_max line
  const phiPnMax = Math.max(...pmDiagram.map(p => p.phiPn));

  // Design point
  const dpX = scaleX(designMu);
  const dpY = scaleY(designPu);

  // Check if design point is inside curve (safe)
  const isSafe = designPu <= phiPnMax;

  return (
    <svg width={width} height={height} className="bg-card border border-border rounded">
      {/* Safe region fill */}
      <path d={`${pathD} L${scaleX(0).toFixed(1)},${scaleY(minPn).toFixed(1)} Z`} fill="hsl(var(--accent))" opacity={0.15} />

      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <React.Fragment key={`g${f}`}>
          <line x1={margin.left} y1={scaleY(minPn + f * (maxPn - minPn))} x2={margin.left + w} y2={scaleY(minPn + f * (maxPn - minPn))} stroke="hsl(var(--border))" strokeWidth={0.5} />
          <line x1={scaleX(f * maxMn)} y1={margin.top} x2={scaleX(f * maxMn)} y2={margin.top + h} stroke="hsl(var(--border))" strokeWidth={0.5} />
        </React.Fragment>
      ))}

      {/* Interaction curve */}
      <path d={pathD} fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.5} />

      {/* φPn_max dashed line */}
      <line x1={margin.left} y1={scaleY(phiPnMax)} x2={margin.left + w} y2={scaleY(phiPnMax)} stroke="hsl(var(--foreground))" strokeWidth={0.8} strokeDasharray="4,3" />
      <text x={margin.left + w - 30} y={scaleY(phiPnMax) - 3} fontSize={8} fill="hsl(var(--muted-foreground))">φPn_max</text>

      {/* Design point */}
      <circle cx={dpX} cy={dpY} r={5} fill="hsl(0 84% 60%)" stroke="hsl(var(--background))" strokeWidth={1.5} />
      <text x={dpX + 8} y={dpY - 3} fontSize={8} fill="hsl(0 84% 60%)" fontWeight="bold">Design Point</text>
      <text x={dpX + 8} y={dpY + 7} fontSize={7} fill="hsl(var(--muted-foreground))">({designMu.toFixed(0)}, {designPu.toFixed(0)})</text>

      {/* Axes */}
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + h} stroke="hsl(var(--foreground))" strokeWidth={1} />
      <line x1={margin.left} y1={margin.top + h} x2={margin.left + w} y2={margin.top + h} stroke="hsl(var(--foreground))" strokeWidth={1} />
      
      {/* Labels */}
      <text x={margin.left + w / 2} y={height - 5} fontSize={9} textAnchor="middle" fill="hsl(var(--foreground))">φMn (kN·m)</text>
      <text x={12} y={margin.top + h / 2} fontSize={9} textAnchor="middle" fill="hsl(var(--foreground))" transform={`rotate(-90,12,${margin.top + h / 2})`}>φPn (kN)</text>

      {/* Axis values */}
      <text x={margin.left - 3} y={scaleY(0) + 3} fontSize={7} textAnchor="end" fill="hsl(var(--muted-foreground))">0</text>
      <text x={margin.left - 3} y={scaleY(maxPn * 0.5) + 3} fontSize={7} textAnchor="end" fill="hsl(var(--muted-foreground))">{(maxPn * 0.5).toFixed(0)}</text>
      <text x={margin.left - 3} y={scaleY(maxPn) + 3} fontSize={7} textAnchor="end" fill="hsl(var(--muted-foreground))">{maxPn.toFixed(0)}</text>
      <text x={scaleX(maxMn * 0.5)} y={margin.top + h + 12} fontSize={7} textAnchor="middle" fill="hsl(var(--muted-foreground))">{(maxMn * 0.5).toFixed(0)}</text>

      {/* Title */}
      {colId && <text x={margin.left + w / 2} y={14} fontSize={9} textAnchor="middle" fontWeight="bold" fill="hsl(var(--foreground))">PM Diagram — {colId}</text>}
    </svg>
  );
}
