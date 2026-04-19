import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface RebarDetailProps {
  open: boolean;
  onClose: () => void;
  elementType: 'beam' | 'column' | 'slab';
  elementId: string;
  dimensions: { b: number; h: number; length?: number };
  reinforcement: {
    top?: { bars: number; dia: number };
    bottom?: { bars: number; dia: number };
    stirrups?: string;
    shortDir?: { bars: number; dia: number; spacing: number };
    longDir?: { bars: number; dia: number; spacing: number };
    // 3-section beam data
    topLeft?: { bars: number; dia: number };
    topRight?: { bars: number; dia: number };
    topMid?: { bars: number; dia: number };
    bottomMid?: { bars: number; dia: number };
    bottomSupport?: { bars: number; dia: number };
    bentUpBars?: number;
    bentUpDia?: number;
  };
}

function BeamSection({ b, h, topBars, topDia, botBars, botDia, label, cover = 40 }: {
  b: number; h: number;
  topBars: number; topDia: number;
  botBars: number; botDia: number;
  label: string;
  cover?: number;
}) {
  const scale = 0.45;
  const sw = b * scale;
  const sh = h * scale;
  const ox = 70 - sw / 2;
  const oy = 12;
  const c = cover * scale;

  return (
    <svg viewBox="0 0 140 200" className="w-full">
      {/* Concrete outline */}
      <rect x={ox} y={oy} width={sw} height={sh} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
      {/* Top bars */}
      {Array.from({ length: topBars }).map((_, i) => {
        const spacing = topBars > 1 ? (sw - 2 * c) / (topBars - 1) : 0;
        const cx = topBars === 1 ? ox + sw / 2 : ox + c + i * spacing;
        const cy = oy + c;
        return <circle key={`t${i}`} cx={cx} cy={cy} r="4" fill="hsl(var(--destructive))" />;
      })}
      {/* Bottom bars */}
      {Array.from({ length: botBars }).map((_, i) => {
        const spacing = botBars > 1 ? (sw - 2 * c) / (botBars - 1) : 0;
        const cx = botBars === 1 ? ox + sw / 2 : ox + c + i * spacing;
        const cy = oy + sh - c;
        return <circle key={`b${i}`} cx={cx} cy={cy} r="4" fill="hsl(var(--accent))" />;
      })}
      {/* Dimensions */}
      <text x={70} y={oy + sh + 14} textAnchor="middle" fontSize="7" className="fill-foreground" fontFamily="JetBrains Mono">{b}×{h}</text>
      {/* Bar labels */}
      <text x={70} y={oy + sh + 24} textAnchor="middle" fontSize="7" className="fill-muted-foreground">
        ↑{topBars}Φ{topDia} ↓{botBars}Φ{botDia}
      </text>
      {/* Section label */}
      <text x={70} y={oy + sh + 36} textAnchor="middle" fontSize="8" className="fill-foreground" fontWeight="bold">{label}</text>
    </svg>
  );
}

function BeamThreeSections({ b, h, reinforcement }: {
  b: number; h: number;
  reinforcement: RebarDetailProps['reinforcement'];
}) {
  const topLeft = reinforcement.topLeft || reinforcement.top || { bars: 2, dia: 12 };
  const topMid = reinforcement.topMid || { bars: 2, dia: topLeft.dia };
  const topRight = reinforcement.topRight || reinforcement.top || { bars: 2, dia: 12 };
  const bottomMid = reinforcement.bottomMid || reinforcement.bottom || { bars: 3, dia: 16 };
  const bottomSupport = reinforcement.bottomSupport || bottomMid;

  return (
    <div>
      <div className="grid grid-cols-3 gap-1">
        <BeamSection
          b={b} h={h}
          topBars={topLeft.bars} topDia={topLeft.dia}
          botBars={bottomSupport.bars} botDia={bottomSupport.dia}
          label="ركيزة يسرى"
        />
        <BeamSection
          b={b} h={h}
          topBars={topMid.bars} topDia={topMid.dia}
          botBars={bottomMid.bars} botDia={bottomMid.dia}
          label="منتصف البحر"
        />
        <BeamSection
          b={b} h={h}
          topBars={topRight.bars} topDia={topRight.dia}
          botBars={bottomSupport.bars} botDia={bottomSupport.dia}
          label="ركيزة يمنى"
        />
      </div>
      {reinforcement.bentUpBars != null && reinforcement.bentUpBars > 0 && (
        <p className="text-center text-xs text-muted-foreground mt-2">
          تكسيح: {reinforcement.bentUpBars}Φ{reinforcement.bentUpDia}
        </p>
      )}
    </div>
  );
}

function ColumnCrossSection({ b, h, bars, dia, cover = 40 }: {
  b: number; h: number; bars: number; dia: number; cover?: number;
}) {
  const scale = 0.5;
  const sw = b * scale;
  const sh = h * scale;
  const ox = 150 - sw / 2;
  const oy = 40;
  const c = cover * scale;

  const positions: [number, number][] = [];
  positions.push([ox + c, oy + c]);
  positions.push([ox + sw - c, oy + c]);
  positions.push([ox + sw - c, oy + sh - c]);
  positions.push([ox + c, oy + sh - c]);

  const remaining = bars - 4;
  if (remaining > 0) {
    const perSide = Math.ceil(remaining / 2);
    for (let i = 1; i <= perSide; i++) {
      const y = oy + c + (i * (sh - 2 * c) / (perSide + 1));
      positions.push([ox + c, y]);
      if (positions.length < bars) positions.push([ox + sw - c, y]);
    }
  }

  return (
    <svg viewBox="0 0 300 280" className="w-full max-w-[300px] mx-auto">
      <rect x={ox} y={oy} width={sw} height={sh} fill="none" stroke="hsl(var(--foreground))" strokeWidth="2" />
      {positions.slice(0, bars).map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="5" fill="hsl(var(--accent))" />
      ))}
      <text x={150} y={oy + sh + 25} textAnchor="middle" fontSize="10" className="fill-foreground" fontFamily="JetBrains Mono">{b}×{h} mm</text>
      <text x={150} y={oy + sh + 40} textAnchor="middle" fontSize="9" className="fill-muted-foreground">{bars}Φ{dia}</text>
    </svg>
  );
}

export default function RebarDetailModal({ open, onClose, elementType, elementId, dimensions, reinforcement }: RebarDetailProps) {
  const { b, h, length = 3000 } = dimensions;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            {elementType === 'beam' ? 'جسر' : elementType === 'column' ? 'عمود' : 'بلاطة'} {elementId}
            <span className="text-muted-foreground ml-2">{b}×{h}mm</span>
            {elementType === 'beam' && <span className="text-muted-foreground ml-1"> × {length.toFixed(0)}mm</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {elementType === 'beam' && (reinforcement.topLeft || reinforcement.top) && (
            <BeamThreeSections b={b} h={h} reinforcement={reinforcement} />
          )}

          {elementType === 'column' && reinforcement.top && (
            <ColumnCrossSection b={b} h={h} bars={reinforcement.top.bars} dia={reinforcement.top.dia} />
          )}

          {elementType === 'slab' && reinforcement.shortDir && reinforcement.longDir && (
            <div className="space-y-2 text-sm">
              <p>اتجاه قصير: <strong className="font-mono">{reinforcement.shortDir.bars}Φ{reinforcement.shortDir.dia}@{reinforcement.shortDir.spacing}mm</strong></p>
              <p>اتجاه طويل: <strong className="font-mono">{reinforcement.longDir.bars}Φ{reinforcement.longDir.dia}@{reinforcement.longDir.spacing}mm</strong></p>
            </div>
          )}

          <div className="space-y-1 text-xs border-t border-border pt-3">
            {reinforcement.top && (
              <p>تسليح علوي (إجمالي): <strong className="font-mono">{reinforcement.top.bars}Φ{reinforcement.top.dia}</strong></p>
            )}
            {reinforcement.bottom && (
              <p>تسليح سفلي: <strong className="font-mono">{reinforcement.bottom.bars}Φ{reinforcement.bottom.dia}</strong></p>
            )}
            {reinforcement.stirrups && (
              <p>كانات: <strong className="font-mono">{reinforcement.stirrups}</strong></p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
