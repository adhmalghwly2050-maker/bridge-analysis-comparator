/**
 * Support Plan View - Shows foundation plan at selected elevation.
 * Long-press on a support to change its DOF (Pinned/Fixed).
 */
import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { Column, Story } from '@/lib/structuralEngine';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SupportPlanViewProps {
  columns: Column[];
  stories: Story[];
  selectedElevation: number; // mm
  onColumnSupportChange: (colId: string, endType: 'top' | 'bottom', value: 'F' | 'P') => void;
}

interface SupportDialogState {
  open: boolean;
  colId: string;
  colLabel: string;
  x: number;
  y: number;
  topEnd: 'F' | 'P';
  bottomEnd: 'F' | 'P';
  isGround: boolean;
}

export default function SupportPlanView({
  columns, stories, selectedElevation, onColumnSupportChange,
}: SupportPlanViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewBox, setViewBox] = useState({ x: -2, y: -2, w: 16, h: 18 });
  const [dialog, setDialog] = useState<SupportDialogState>({
    open: false, colId: '', colLabel: '', x: 0, y: 0,
    topEnd: 'F', bottomEnd: 'F', isGround: false,
  });

  // Filter columns at this elevation (their zBottom or zTop matches)
  const colsAtLevel = columns.filter(c => {
    if (c.isRemoved) return false;
    const zBot = c.zBottom ?? 0;
    const zTop = c.zTop ?? (zBot + c.L);
    return Math.abs(zBot - selectedElevation) <= 1 || Math.abs(zTop - selectedElevation) <= 1;
  });

  // Deduplicate by (x, y) position
  const uniquePositions = new Map<string, Column[]>();
  for (const c of colsAtLevel) {
    const key = `${c.x.toFixed(2)}_${c.y.toFixed(2)}`;
    if (!uniquePositions.has(key)) uniquePositions.set(key, []);
    uniquePositions.get(key)!.push(c);
  }

  // Auto-fit viewbox
  useEffect(() => {
    if (colsAtLevel.length === 0) return;
    const xs = colsAtLevel.map(c => c.x);
    const ys = colsAtLevel.map(c => c.y);
    const minX = Math.min(...xs) - 2;
    const maxX = Math.max(...xs) + 2;
    const minY = Math.min(...ys) - 2;
    const maxY = Math.max(...ys) + 2;
    setViewBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }, [colsAtLevel.length, selectedElevation]);

  const isGroundLevel = selectedElevation <= 1; // mm tolerance

  const handleLongPress = useCallback((cols: Column[]) => {
    const col = cols[0];
    if (!col) return;
    setDialog({
      open: true,
      colId: col.id,
      colLabel: col.id,
      x: col.x,
      y: col.y,
      topEnd: col.topEndCondition || 'F',
      bottomEnd: col.bottomEndCondition || 'F',
      isGround: isGroundLevel,
    });
  }, [isGroundLevel]);

  const handleSupportChange = (endType: 'top' | 'bottom', value: 'F' | 'P') => {
    // Apply to ALL columns at this (x, y) position
    const key = `${dialog.x.toFixed(2)}_${dialog.y.toFixed(2)}`;
    const cols = uniquePositions.get(key) || [];
    for (const c of cols) {
      onColumnSupportChange(c.id, endType, value);
    }
    setDialog(prev => ({
      ...prev,
      [endType === 'top' ? 'topEnd' : 'bottomEnd']: value,
    }));
  };

  const getSupportSymbol = (col: Column) => {
    const isBottom = Math.abs((col.zBottom ?? 0) - selectedElevation) <= 1;
    if (!isBottom) return null; // Only show support at bottom
    const endCond = col.bottomEndCondition || 'F';
    return endCond;
  };

  return (
    <div className="relative w-full h-full min-h-[300px]">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="w-full h-full"
      >
        {/* Grid */}
        {Array.from({ length: Math.ceil(viewBox.w) + 1 }, (_, i) => {
          const x = Math.floor(viewBox.x) + i;
          return <line key={`gx${x}`} x1={x} y1={viewBox.y} x2={x} y2={viewBox.y + viewBox.h}
            stroke="#e5e7eb" strokeWidth="0.02" />;
        })}
        {Array.from({ length: Math.ceil(viewBox.h) + 1 }, (_, i) => {
          const y = Math.floor(viewBox.y) + i;
          return <line key={`gy${y}`} x1={viewBox.x} y1={y} x2={viewBox.x + viewBox.w} y2={y}
            stroke="#e5e7eb" strokeWidth="0.02" />;
        })}

        {/* Supports / Columns at this level */}
        {Array.from(uniquePositions.entries()).map(([key, cols]) => {
          const col = cols[0];
          const supportType = getSupportSymbol(col);
          const isFixed = supportType === 'F';
          const isPinned = supportType === 'P';

          return (
            <g key={key}
              style={{ cursor: 'pointer' }}
              onPointerDown={() => {
                longPressTimer.current = setTimeout(() => handleLongPress(cols), 500);
              }}
              onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
              onPointerLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
              onClick={() => handleLongPress(cols)}
            >
              {/* Column rectangle */}
              <rect
                x={col.x - 0.15} y={col.y - 0.15} width="0.3" height="0.3"
                fill={isFixed ? '#3b82f6' : isPinned ? '#f59e0b' : '#6b7280'}
                stroke="#1e293b" strokeWidth="0.03" rx="0.02"
              />

              {/* Support symbol */}
              {isGroundLevel && isFixed && (
                <>
                  {/* Fixed support: filled rectangle below */}
                  <rect x={col.x - 0.2} y={col.y + 0.18} width="0.4" height="0.08"
                    fill="#3b82f6" opacity="0.7" />
                  {/* Hash lines */}
                  {[-0.15, -0.05, 0.05, 0.15].map(dx => (
                    <line key={dx} x1={col.x + dx} y1={col.y + 0.26} x2={col.x + dx - 0.05} y2={col.y + 0.34}
                      stroke="#3b82f6" strokeWidth="0.02" />
                  ))}
                </>
              )}
              {isGroundLevel && isPinned && (
                <>
                  {/* Pinned support: triangle */}
                  <polygon
                    points={`${col.x},${col.y + 0.18} ${col.x - 0.15},${col.y + 0.35} ${col.x + 0.15},${col.y + 0.35}`}
                    fill="none" stroke="#f59e0b" strokeWidth="0.03"
                  />
                  {/* Hatch line */}
                  <line x1={col.x - 0.18} y1={col.y + 0.37} x2={col.x + 0.18} y2={col.y + 0.37}
                    stroke="#f59e0b" strokeWidth="0.02" />
                </>
              )}

              {/* Column label */}
              <text x={col.x} y={col.y - 0.25} textAnchor="middle"
                fill="#1e293b" fontSize="0.22" fontFamily="sans-serif" fontWeight="bold">
                {col.id}
              </text>

              {/* Support type label */}
              {isGroundLevel && supportType && (
                <text x={col.x} y={col.y + 0.55} textAnchor="middle"
                  fill={isFixed ? '#3b82f6' : '#f59e0b'} fontSize="0.16" fontFamily="sans-serif">
                  {isFixed ? 'Fixed' : 'Pinned'}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute top-2 right-2 bg-card/90 backdrop-blur-sm border border-border rounded p-2 text-xs space-y-1">
        <div className="font-semibold text-foreground">المنسوب: {selectedElevation / 1000} م</div>
        {isGroundLevel && (
          <>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-blue-500 rounded-sm" /> ثابت (Fixed)
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-amber-500 rounded-sm" /> مفصلي (Pinned)
            </div>
            <div className="text-muted-foreground">اضغط على الركيزة للتغيير</div>
          </>
        )}
      </div>

      {/* Support change dialog */}
      <Dialog open={dialog.open} onOpenChange={open => setDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-right">
              درجات الحرية - {dialog.colLabel} ({dialog.x}, {dialog.y})
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">اتصال أسفل العمود (الركيزة)</label>
              <div className="flex gap-2">
                <Button
                  variant={dialog.bottomEnd === 'F' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleSupportChange('bottom', 'F')}
                >
                  🔒 ثابت (Fixed)
                </Button>
                <Button
                  variant={dialog.bottomEnd === 'P' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleSupportChange('bottom', 'P')}
                >
                  📌 مفصلي (Pinned)
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {dialog.bottomEnd === 'F'
                  ? 'جميع درجات الحرية مقيدة (Ux, Uy, Uz, Rx, Ry, Rz)'
                  : 'الإزاحات مقيدة، الدورانات حرة (Ux, Uy, Uz مقيدة)'}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">اتصال أعلى العمود</label>
              <div className="flex gap-2">
                <Button
                  variant={dialog.topEnd === 'F' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleSupportChange('top', 'F')}
                >
                  🔒 ثابت (Fixed)
                </Button>
                <Button
                  variant={dialog.topEnd === 'P' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleSupportChange('top', 'P')}
                >
                  📌 مفصلي (Pinned)
                </Button>
              </div>
            </div>

            <div className="border rounded p-2 bg-muted/50 text-xs space-y-1">
              <div className="font-medium">ملخص:</div>
              <div>أسفل: <Badge variant={dialog.bottomEnd === 'F' ? 'default' : 'secondary'}>
                {dialog.bottomEnd === 'F' ? 'Fixed' : 'Pinned'}
              </Badge></div>
              <div>أعلى: <Badge variant={dialog.topEnd === 'F' ? 'default' : 'secondary'}>
                {dialog.topEnd === 'F' ? 'Fixed' : 'Pinned'}
              </Badge></div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
