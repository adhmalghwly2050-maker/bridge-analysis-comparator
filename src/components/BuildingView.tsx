import React from 'react';
import type { Slab, Beam, Column, FrameResult, FlexureResult, ShearResult, BeamOnBeamConnection } from '@/lib/structuralEngine';

interface BuildingViewProps {
  slabs: Slab[];
  beams: Beam[];
  columns: Column[];
  analyzed: boolean;
  frameResults: FrameResult[];
  beamDesigns: {
    beamId: string; frameId: string; Vu: number;
    flexLeft: FlexureResult; flexMid: FlexureResult; flexRight: FlexureResult;
    shear: ShearResult;
  }[];
  colDesigns: { id: string; b: number; h: number; Pu: number; design: any }[];
  onSelectElement?: (type: 'beam' | 'column' | 'slab', id: string) => void;
  storyHeight?: number;
  removedColumnIds?: string[];
  bobConnections?: BeamOnBeamConnection[];
  /** Show beam moment diagrams (ETABS style) */
  showMoments?: boolean;
}

function getStressColor(ratio: number): string {
  if (ratio < 0.5) return 'hsl(var(--stress-safe))';
  if (ratio < 0.8) return 'hsl(var(--stress-warn))';
  return 'hsl(var(--stress-danger))';
}

export default function BuildingView({
  slabs, beams, columns, analyzed, frameResults, beamDesigns, onSelectElement,
  removedColumnIds = [], bobConnections = [], showMoments = false,
}: BuildingViewProps) {
  const allX = slabs.flatMap(s => [s.x1, s.x2]);
  const allY = slabs.flatMap(s => [s.y1, s.y2]);
  const minX = Math.min(...allX) - 1;
  const maxX = Math.max(...allX) + 1;
  const minY = Math.min(...allY) - 1;
  const maxY = Math.max(...allY) + 1;

  const scale = 50;
  const padding = 40;
  const width = (maxX - minX) * scale + padding * 2;
  const height = (maxY - minY) * scale + padding * 2;

  const tx = (x: number) => (x - minX) * scale + padding;
  const ty = (y: number) => (y - minY) * scale + padding;

  const beamStressMap = new Map<string, number>();
  if (analyzed) {
    for (const d of beamDesigns) {
      const maxCheck = [d.flexLeft.checkSpacing, d.flexMid.checkSpacing, d.flexRight.checkSpacing];
      const hasTwoLayers = maxCheck.some(c => c !== 'ok');
      beamStressMap.set(d.beamId, hasTwoLayers ? 0.9 : 0.4);
    }
  }

  // Build moment data map for ETABS-style display
  const beamMomentMap = new Map<string, { Mleft: number; Mmid: number; Mright: number; direction: 'horizontal' | 'vertical' }>();
  if (analyzed && showMoments && frameResults) {
    for (const fr of frameResults) {
      for (const br of fr.beams) {
        const beam = beams.find(b => b.id === br.beamId);
        if (beam) {
          beamMomentMap.set(br.beamId, {
            Mleft: br.Mleft,
            Mmid: br.Mmid,
            Mright: br.Mright,
            direction: beam.direction,
          });
        }
      }
    }
  }

  // Scale factor for moment diagram offset
  const allMoments = [...beamMomentMap.values()].flatMap(m => [Math.abs(m.Mleft), Math.abs(m.Mmid), Math.abs(m.Mright)]);
  const maxMoment = Math.max(...allMoments, 1);
  const momentScale = 25; // max pixel offset for moment diagram

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto max-h-[60vh] md:max-h-[70vh]" style={{ background: 'hsl(var(--background))' }}>
      {/* Grid lines */}
      {[...new Set(slabs.flatMap(s => [s.x1, s.x2]))].sort((a, b) => a - b).map(x => (
        <line key={`gx${x}`} x1={tx(x)} y1={padding / 2} x2={tx(x)} y2={height - padding / 2}
          stroke="hsl(var(--canvas-grid))" strokeWidth="0.5" strokeDasharray="4" />
      ))}
      {[...new Set(slabs.flatMap(s => [s.y1, s.y2]))].sort((a, b) => a - b).map(y => (
        <line key={`gy${y}`} x1={padding / 2} y1={ty(y)} x2={width - padding / 2} y2={ty(y)}
          stroke="hsl(var(--canvas-grid))" strokeWidth="0.5" strokeDasharray="4" />
      ))}

      {/* Slabs */}
      {slabs.map(s => (
        <g key={s.id} className="cursor-pointer" onClick={() => onSelectElement?.('slab', s.id)}>
          <rect x={tx(s.x1)} y={ty(s.y1)} width={(s.x2 - s.x1) * scale} height={(s.y2 - s.y1) * scale}
            fill="hsl(var(--slab-fill) / 0.08)" stroke="hsl(var(--slab))" strokeWidth="0.5" />
          <text x={tx((s.x1 + s.x2) / 2)} y={ty((s.y1 + s.y2) / 2)} textAnchor="middle" dominantBaseline="middle"
            className="fill-muted-foreground" fontSize="10" fontFamily="JetBrains Mono">{s.id}</text>
        </g>
      ))}

      {/* Beams */}
      {beams.map(b => {
        const stress = beamStressMap.get(b.id) || 0;
        const color = analyzed ? getStressColor(stress) : 'hsl(var(--beam))';
        return (
          <g key={b.id} className="cursor-pointer" onClick={() => onSelectElement?.('beam', b.id)}>
            <line x1={tx(b.x1)} y1={ty(b.y1)} x2={tx(b.x2)} y2={ty(b.y2)} stroke={color} strokeWidth="3" />
            <text x={tx((b.x1 + b.x2) / 2)} y={ty((b.y1 + b.y2) / 2) - 6} textAnchor="middle"
              className="fill-foreground" fontSize="8" fontFamily="JetBrains Mono">{b.id}</text>
          </g>
        );
      })}

      {/* Beam Moment Diagrams — ETABS style */}
      {showMoments && beamMomentMap.size > 0 && beams.map(b => {
        const mData = beamMomentMap.get(b.id);
        if (!mData) return null;

        const bx1 = tx(b.x1);
        const by1 = ty(b.y1);
        const bx2 = tx(b.x2);
        const by2 = ty(b.y2);
        const midBx = (bx1 + bx2) / 2;
        const midBy = (by1 + by2) / 2;

        const offsetM = (m: number) => (m / maxMoment) * momentScale;

        if (mData.direction === 'horizontal') {
          // Horizontal beam: negative moments above (y-), positive below (y+)
          const oLeft = offsetM(mData.Mleft);   // negative → draw above beam
          const oMid = offsetM(mData.Mmid);     // positive → draw below beam
          const oRight = offsetM(mData.Mright); // negative → draw above beam

          const path = `M${bx1},${by1} 
            L${bx1},${by1 - oLeft} 
            Q${midBx},${midBy + oMid} ${bx2},${by2 - oRight} 
            L${bx2},${by2} Z`;

          return (
            <g key={`bmd-${b.id}`}>
              <path d={path} fill="hsl(0 70% 50% / 0.15)" stroke="hsl(0 70% 50%)" strokeWidth="0.8" />
              {Math.abs(mData.Mleft) > 0.1 && (
                <text x={bx1 + 2} y={by1 - oLeft - 3} fontSize="6" fill="hsl(0 70% 50%)" fontFamily="monospace">
                  {Math.abs(mData.Mleft).toFixed(1)}
                </text>
              )}
              {Math.abs(mData.Mmid) > 0.1 && (
                <text x={midBx} y={midBy + oMid + 8} textAnchor="middle" fontSize="6" fill="hsl(210 70% 50%)" fontFamily="monospace">
                  {Math.abs(mData.Mmid).toFixed(1)}
                </text>
              )}
              {Math.abs(mData.Mright) > 0.1 && (
                <text x={bx2 - 2} y={by2 - oRight - 3} textAnchor="end" fontSize="6" fill="hsl(0 70% 50%)" fontFamily="monospace">
                  {Math.abs(mData.Mright).toFixed(1)}
                </text>
              )}
            </g>
          );
        } else {
          // Vertical beam: negative moments to the right (x+), positive to the left (x-)
          const oLeft = offsetM(mData.Mleft);
          const oMid = offsetM(mData.Mmid);
          const oRight = offsetM(mData.Mright);

          const path = `M${bx1},${by1} 
            L${bx1 + oLeft},${by1} 
            Q${midBx - oMid},${midBy} ${bx2 + oRight},${by2} 
            L${bx2},${by2} Z`;

          return (
            <g key={`bmd-${b.id}`}>
              <path d={path} fill="hsl(270 60% 50% / 0.15)" stroke="hsl(270 60% 50%)" strokeWidth="0.8" />
              {Math.abs(mData.Mleft) > 0.1 && (
                <text x={bx1 + oLeft + 3} y={by1 + 3} fontSize="6" fill="hsl(0 70% 50%)" fontFamily="monospace">
                  {Math.abs(mData.Mleft).toFixed(1)}
                </text>
              )}
              {Math.abs(mData.Mmid) > 0.1 && (
                <text x={midBx - oMid - 3} y={midBy + 3} textAnchor="end" fontSize="6" fill="hsl(210 70% 50%)" fontFamily="monospace">
                  {Math.abs(mData.Mmid).toFixed(1)}
                </text>
              )}
              {Math.abs(mData.Mright) > 0.1 && (
                <text x={bx2 + oRight + 3} y={by2 + 3} fontSize="6" fill="hsl(0 70% 50%)" fontFamily="monospace">
                  {Math.abs(mData.Mright).toFixed(1)}
                </text>
              )}
            </g>
          );
        }
      })}

      {/* Columns */}
      {columns.map(c => {
        const isRemoved = removedColumnIds.includes(c.id);
        return (
          <g key={c.id} className="cursor-pointer" onClick={() => onSelectElement?.(isRemoved ? 'beam' : 'column', c.id)}>
            {isRemoved ? (
              <>
                <circle cx={tx(c.x)} cy={ty(c.y)} r="6" fill="none" stroke="hsl(var(--destructive))" strokeWidth="1.5" />
                <text x={tx(c.x)} y={ty(c.y) + 3} textAnchor="middle" fontSize="8" fill="hsl(var(--destructive))">×</text>
              </>
            ) : (
              <rect x={tx(c.x) - 5} y={ty(c.y) - 5} width="10" height="10" fill="hsl(var(--column))" rx="1" />
            )}
            <text x={tx(c.x)} y={ty(c.y) + 16} textAnchor="middle"
              className="fill-foreground" fontSize="7" fontFamily="JetBrains Mono">{c.id}</text>
          </g>
        );
      })}

      {/* Beam-on-Beam load path arrows */}
      {bobConnections.map((conn, i) => {
        const px = tx(conn.point.x);
        const py = ty(conn.point.y);
        return (
          <text key={`bob${i}`} x={px} y={py - 10} textAnchor="middle" fontSize="14" fill="hsl(var(--accent))">⇊</text>
        );
      })}

      {/* Axis labels */}
      {[...new Set(slabs.flatMap(s => [s.x1, s.x2]))].sort((a, b) => a - b).map(x => (
        <text key={`lx${x}`} x={tx(x)} y={height - 5} textAnchor="middle" fontSize="9"
          className="fill-muted-foreground" fontFamily="JetBrains Mono">{x}m</text>
      ))}
      {[...new Set(slabs.flatMap(s => [s.y1, s.y2]))].sort((a, b) => a - b).map(y => (
        <text key={`ly${y}`} x={10} y={ty(y) + 3} fontSize="9"
          className="fill-muted-foreground" fontFamily="JetBrains Mono">{y}m</text>
      ))}

      {/* Legend */}
      {analyzed && (
        <g transform={`translate(${width - 120}, ${height - 30})`}>
          <rect x="0" y="0" width="8" height="8" fill="hsl(var(--stress-safe))" />
          <text x="12" y="7" fontSize="7" className="fill-foreground">آمن</text>
          <rect x="35" y="0" width="8" height="8" fill="hsl(var(--stress-warn))" />
          <text x="47" y="7" fontSize="7" className="fill-foreground">تحذير</text>
          <rect x="70" y="0" width="8" height="8" fill="hsl(var(--stress-danger))" />
          <text x="82" y="7" fontSize="7" className="fill-foreground">خطر</text>
        </g>
      )}

      {/* Moment legend */}
      {showMoments && beamMomentMap.size > 0 && (
        <g transform={`translate(${padding}, ${height - 30})`}>
          <rect x="0" y="0" width="8" height="8" fill="hsl(0 70% 50% / 0.3)" stroke="hsl(0 70% 50%)" strokeWidth="0.5" />
          <text x="11" y="7" fontSize="6" className="fill-foreground">M⁻ سالب</text>
          <rect x="55" y="0" width="8" height="8" fill="hsl(210 70% 50% / 0.3)" stroke="hsl(210 70% 50%)" strokeWidth="0.5" />
          <text x="66" y="7" fontSize="6" className="fill-foreground">M⁺ موجب</text>
          <text x="110" y="7" fontSize="5" className="fill-muted-foreground">(kN.m)</text>
        </g>
      )}
    </svg>
  );
}
