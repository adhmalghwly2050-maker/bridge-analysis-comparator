/**
 * Level Plan View - Shows structural elements at a selected elevation.
 * Styled like ModelCanvas with pan, zoom, element selection, and long-press editing.
 */
import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { Column, Beam, Slab, Story } from '@/lib/structuralEngine';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';

export interface SupportRestraints {
  ux: boolean; uy: boolean; uz: boolean;
  rx: boolean; ry: boolean; rz: boolean;
}

interface LevelPlanViewProps {
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  stories: Story[];
  selectedElevation: number;
  onColumnSupportChange: (colId: string, endType: 'top' | 'bottom', value: 'F' | 'P') => void;
  onSupportRestraintsChange?: (posKeys: string[], restraints: SupportRestraints) => void;
  supportRestraints?: Record<string, SupportRestraints>;
  onElementLongPress?: (type: 'beam' | 'column' | 'slab', id: string) => void;
  onDeleteElement?: (type: 'beam' | 'column' | 'slab', id: string) => void;
}

interface SelectedElement {
  type: 'beam' | 'column' | 'slab';
  id: string;
}

interface EndReleaseDOF {
  ux: boolean; uy: boolean; uz: boolean;
  rx: boolean; ry: boolean; rz: boolean;
}

interface ElementEditDialog {
  open: boolean;
  type: 'beam' | 'column' | 'slab' | '';
  id: string;
  label: string;
  b: number;
  h: number;
  length: number;
  thickness: number;
  topEnd: 'F' | 'P';
  bottomEnd: 'F' | 'P';
  x: number;
  y: number;
  releaseI: EndReleaseDOF;
  releaseJ: EndReleaseDOF;
}

interface SupportDialogState {
  open: boolean;
  colId: string;
  colLabel: string;
  x: number;
  y: number;
  restraints: SupportRestraints;
  applyToAll: boolean;
}

export default function LevelPlanView({
  columns, beams, slabs, stories, selectedElevation, onColumnSupportChange, onSupportRestraintsChange, supportRestraints, onElementLongPress, onDeleteElement,
}: LevelPlanViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState({ x: -2, y: -2, w: 16, h: 18 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; vbx: number; vby: number } | null>(null);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const defaultRelease: EndReleaseDOF = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
  const [editDialog, setEditDialog] = useState<ElementEditDialog>({
    open: false, type: '', id: '', label: '', b: 200, h: 400, length: 0,
    thickness: 160, topEnd: 'F', bottomEnd: 'F', x: 0, y: 0,
    releaseI: { ...defaultRelease }, releaseJ: { ...defaultRelease },
  });
  const [supportDialog, setSupportDialog] = useState<SupportDialogState>({
    open: false, colId: '', colLabel: '', x: 0, y: 0,
    restraints: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    applyToAll: false,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isGroundLevel = selectedElevation <= 1;
  const tolerance = 100;

  // Filter elements at this elevation
  const colsAtLevel = columns.filter(c => {
    if (c.isRemoved) return false;
    const zBot = c.zBottom ?? 0;
    const zTop = c.zTop ?? (zBot + c.L);
    if (isGroundLevel) return Math.abs(zBot) <= tolerance;
    return Math.abs(zBot - selectedElevation) <= tolerance || Math.abs(zTop - selectedElevation) <= tolerance;
  });

  const uniqueColPositions = new Map<string, Column[]>();
  for (const c of colsAtLevel) {
    const key = `${c.x.toFixed(2)}_${c.y.toFixed(2)}`;
    if (!uniqueColPositions.has(key)) uniqueColPositions.set(key, []);
    uniqueColPositions.get(key)!.push(c);
  }

  const beamsAtLevel = isGroundLevel ? [] : beams.filter(b => {
    const bz = b.z ?? 0;
    return Math.abs(bz - selectedElevation) <= tolerance;
  });

  const slabsAtLevel = isGroundLevel ? [] : slabs.filter(s => {
    const story = stories.find(st => st.id === s.storyId);
    if (!story) return false;
    const slabElev = (story.elevation ?? 0) + story.height;
    return Math.abs(slabElev - selectedElevation) <= tolerance;
  });

  // Auto-fit viewbox
  useEffect(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const c of colsAtLevel) { xs.push(c.x); ys.push(c.y); }
    for (const b of beamsAtLevel) { xs.push(b.x1, b.x2); ys.push(b.y1, b.y2); }
    for (const s of slabsAtLevel) { xs.push(s.x1, s.x2); ys.push(s.y1, s.y2); }
    if (xs.length === 0) return;
    const pad = 2;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    // Flip Y: viewBox Y goes from -maxY to -minY
    setViewBox({
      x: minX,
      y: -maxY,
      w: maxX - minX,
      h: maxY - minY,
    });
  }, [colsAtLevel.length, beamsAtLevel.length, slabsAtLevel.length, selectedElevation]);

  // SVG coordinate conversion
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    return {
      x: (clientX - rect.left) * scaleX + viewBox.x,
      y: -((clientY - rect.top) * scaleY + viewBox.y), // flip Y
    };
  }, [viewBox]);

  // Pan & Zoom handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 0 || e.button === 1) {
      setPanStart({ x: e.clientX, y: e.clientY, vbx: viewBox.x, vby: viewBox.y });
      setIsPanning(true);
    }
  }, [viewBox]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning && panStart) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = (e.clientX - panStart.x) * viewBox.w / rect.width;
      const dy = (e.clientY - panStart.y) * viewBox.h / rect.height;
      setViewBox(vb => ({ ...vb, x: panStart.vbx - dx, y: panStart.vby - dy }));
    }
  }, [isPanning, panStart, viewBox]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    setViewBox(vb => ({
      x: wx - (wx - vb.x) * zoomFactor,
      y: wy - (wy - vb.y) * zoomFactor,
      w: vb.w * zoomFactor,
      h: vb.h * zoomFactor,
    }));
  }, [screenToWorld]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setPanStart({ x: touch.clientX, y: touch.clientY, vbx: viewBox.x, vby: viewBox.y });
      setIsPanning(true);
    }
  }, [viewBox]);

  const handleTouchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.sqrt((t2.clientX - t1.clientX) ** 2 + (t2.clientY - t1.clientY) ** 2);
      const zoomFactor = dist > 100 ? 0.98 : 1.02;
      setViewBox(vb => ({
        x: vb.x + vb.w * (1 - zoomFactor) / 2,
        y: vb.y + vb.h * (1 - zoomFactor) / 2,
        w: vb.w * zoomFactor,
        h: vb.h * zoomFactor,
      }));
    } else if (e.touches.length === 1 && isPanning && panStart) {
      const touch = e.touches[0];
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = (touch.clientX - panStart.x) * viewBox.w / rect.width;
      const dy = (touch.clientY - panStart.y) * viewBox.h / rect.height;
      setViewBox(vb => ({ ...vb, x: panStart.vbx - dx, y: panStart.vby - dy }));
    }
  }, [isPanning, panStart, viewBox]);

  const handleTouchEnd = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);
  }, []);

  // Long-press handling
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const handleElementPointerDown = useCallback((type: 'beam' | 'column' | 'slab', id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      // Open element properties dialog
      if (type === 'beam') {
        const beam = beamsAtLevel.find(b => b.id === id);
        if (beam) {
          setEditDialog({
            open: true, type: 'beam', id, label: id,
            b: beam.b ?? 200, h: beam.h ?? 400,
            length: Math.sqrt((beam.x2 - beam.x1) ** 2 + (beam.y2 - beam.y1) ** 2),
            thickness: 0, topEnd: 'F', bottomEnd: 'F',
            x: (beam.x1 + beam.x2) / 2, y: (beam.y1 + beam.y2) / 2,
            releaseI: { ...defaultRelease }, releaseJ: { ...defaultRelease },
          });
        }
      } else if (type === 'column') {
        const col = colsAtLevel.find(c => c.id === id);
        if (col) {
          if (isGroundLevel) {
            const sKey = `${col.x.toFixed(2)}_${col.y.toFixed(2)}_${col.zBottom ?? 0}`;
            const cur = supportRestraints?.[sKey]
              || (col.bottomEndCondition === 'F'
                ? { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }
                : { ux: true, uy: true, uz: true, rx: false, ry: false, rz: false });
            setSupportDialog({
              open: true, colId: col.id, colLabel: col.id,
              x: col.x, y: col.y,
              restraints: { ...cur }, applyToAll: false,
            });
          } else {
            setEditDialog({
              open: true, type: 'column', id, label: id,
              b: col.b ?? 300, h: col.h ?? 400, length: col.L ?? 0,
              thickness: 0,
              topEnd: col.topEndCondition || 'F',
              bottomEnd: col.bottomEndCondition || 'F',
              x: col.x, y: col.y,
              releaseI: { ...defaultRelease }, releaseJ: { ...defaultRelease },
            });
          }
        }
      } else if (type === 'slab') {
        const slab = slabsAtLevel.find(s => s.id === id);
        if (slab) {
          setEditDialog({
            open: true, type: 'slab', id, label: id,
            b: 0, h: 0,
            length: 0, thickness: 160,
            topEnd: 'F', bottomEnd: 'F',
            x: (slab.x1 + slab.x2) / 2, y: (slab.y1 + slab.y2) / 2,
            releaseI: { ...defaultRelease }, releaseJ: { ...defaultRelease },
          });
        }
      }
      // Also notify parent
      onElementLongPress?.(type, id);
    }, 500);
  }, [beamsAtLevel, colsAtLevel, slabsAtLevel, onElementLongPress]);

  const handleElementPointerUp = useCallback((type: 'beam' | 'column' | 'slab', id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // Short click = select
    if (!longPressTriggered.current) {
      if (isGroundLevel && type === 'column') {
        const col = colsAtLevel.find(c => c.id === id);
        if (col) {
          const sKey = `${col.x.toFixed(2)}_${col.y.toFixed(2)}_${col.zBottom ?? 0}`;
          const cur = supportRestraints?.[sKey]
            || (col.bottomEndCondition === 'F'
              ? { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }
              : { ux: true, uy: true, uz: true, rx: false, ry: false, rz: false });
          setSupportDialog({
            open: true, colId: col.id, colLabel: col.id,
            x: col.x, y: col.y,
            restraints: { ...cur }, applyToAll: false,
          });
        }
      } else {
        setSelectedElement(prev =>
          prev?.type === type && prev?.id === id ? null : { type, id }
        );
      }
    }
  }, [isGroundLevel, colsAtLevel]);

  const handleElementPointerLeave = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleSupportSave = () => {
    const { restraints, applyToAll, x, y } = supportDialog;
    if (applyToAll) {
      const posKeys = Array.from(uniqueColPositions.entries()).map(([_, cols]) => {
        const c = cols[0];
        return `${c.x.toFixed(2)}_${c.y.toFixed(2)}_${c.zBottom ?? 0}`;
      });
      onSupportRestraintsChange?.(posKeys, restraints);
    } else {
      const key = `${x.toFixed(2)}_${y.toFixed(2)}_${selectedElevation}`;
      onSupportRestraintsChange?.([key], restraints);
    }
    setSupportDialog(prev => ({ ...prev, open: false }));
  };

  const handleEditSave = () => {
    // Notify parent via long press handler for actual save
    if (editDialog.type && onElementLongPress) {
      onElementLongPress(editDialog.type as 'beam' | 'column' | 'slab', editDialog.id);
    }
    setConfirmDelete(false);
    setEditDialog(prev => ({ ...prev, open: false }));
  };

  const handleDeleteClick = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (editDialog.type && onDeleteElement) {
      onDeleteElement(editDialog.type as 'beam' | 'column' | 'slab', editDialog.id);
    }
    setConfirmDelete(false);
    setEditDialog(prev => ({ ...prev, open: false }));
  };

  const handleEditDialogClose = (open: boolean) => {
    if (!open) setConfirmDelete(false);
    setEditDialog(prev => ({ ...prev, open }));
  };

  // Compute grid line scale
  const gridStep = viewBox.w > 30 ? 5 : viewBox.w > 15 ? 2 : 1;

  return (
    <div className="relative w-full h-full min-h-[300px] touch-none bg-background">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        {/* Background */}
        <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h}
          fill="hsl(var(--background))" />

        {/* Grid lines */}
        {Array.from({ length: Math.ceil(viewBox.w / gridStep) + 2 }, (_, i) => {
          const x = Math.floor(viewBox.x / gridStep) * gridStep + i * gridStep;
          return <line key={`gx${x}`} x1={x} y1={viewBox.y} x2={x} y2={viewBox.y + viewBox.h}
            stroke="hsl(var(--border))" strokeWidth={0.015} opacity={0.4} />;
        })}
        {Array.from({ length: Math.ceil(viewBox.h / gridStep) + 2 }, (_, i) => {
          const y = Math.floor(viewBox.y / gridStep) * gridStep + i * gridStep;
          return <line key={`gy${y}`} x1={viewBox.x} y1={y} x2={viewBox.x + viewBox.w} y2={y}
            stroke="hsl(var(--border))" strokeWidth={0.015} opacity={0.4} />;
        })}

        {/* Axis lines */}
        <line x1={0} y1={viewBox.y} x2={0} y2={viewBox.y + viewBox.h}
          stroke="hsl(var(--muted-foreground))" strokeWidth={0.03} opacity={0.3} />
        <line x1={viewBox.x} y1={0} x2={viewBox.x + viewBox.w} y2={0}
          stroke="hsl(var(--muted-foreground))" strokeWidth={0.03} opacity={0.3} />

        {/* Slabs - Y negated for bottom-left origin */}
        {slabsAtLevel.map(s => {
          const isSelected = selectedElement?.type === 'slab' && selectedElement.id === s.id;
          const sy1 = -Math.max(s.y1, s.y2);
          const sheight = Math.abs(s.y2 - s.y1);
          const sx = Math.min(s.x1, s.x2);
          const swidth = Math.abs(s.x2 - s.x1);
          const cy = -(s.y1 + s.y2) / 2;
          return (
            <g key={s.id}>
              <rect
                x={sx} y={sy1}
                width={swidth} height={sheight}
                fill={isSelected ? 'hsl(var(--primary) / 0.15)' : 'hsl(var(--primary) / 0.06)'}
                stroke={isSelected ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.25)'}
                strokeWidth={isSelected ? 0.06 : 0.02}
                rx={0.03}
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => handleElementPointerDown('slab', s.id, e)}
                onPointerUp={(e) => handleElementPointerUp('slab', s.id, e)}
                onPointerLeave={handleElementPointerLeave}
              />
              <line x1={sx + 0.1} y1={cy}
                x2={sx + swidth - 0.1} y2={cy}
                stroke="hsl(var(--primary) / 0.12)" strokeWidth={0.01} strokeDasharray="0.15 0.1" />
              <text x={(s.x1 + s.x2) / 2} y={cy + 0.05}
                textAnchor="middle" dominantBaseline="middle"
                fill={isSelected ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
                fontSize={0.22} fontFamily="monospace" fontWeight={isSelected ? 'bold' : 'normal'}>
                {s.id}
              </text>
              <text x={(s.x1 + s.x2) / 2} y={cy + 0.35}
                textAnchor="middle" dominantBaseline="middle"
                fill="hsl(var(--muted-foreground))" fontSize={0.13} fontFamily="monospace" opacity={0.6}>
                {swidth.toFixed(1)}×{sheight.toFixed(1)}م
              </text>
            </g>
          );
        })}

        {/* Beams - Y negated */}
        {beamsAtLevel.map(b => {
          const isSelected = selectedElement?.type === 'beam' && selectedElement.id === b.id;
          const beamLen = Math.sqrt((b.x2 - b.x1) ** 2 + (b.y2 - b.y1) ** 2);
          const ny1 = -b.y1;
          const ny2 = -b.y2;
          const angle = Math.atan2(ny2 - ny1, b.x2 - b.x1);
          const perpX = -Math.sin(angle) * 0.2;
          const perpY = Math.cos(angle) * 0.2;

          return (
            <g key={b.id} style={{ cursor: 'pointer' }}
              onPointerDown={(e) => handleElementPointerDown('beam', b.id, e)}
              onPointerUp={(e) => handleElementPointerUp('beam', b.id, e)}
              onPointerLeave={handleElementPointerLeave}
            >
              <line x1={b.x1} y1={ny1} x2={b.x2} y2={ny2}
                stroke={isSelected ? 'hsl(var(--primary))' : 'hsl(210 70% 45%)'}
                strokeWidth={isSelected ? 0.12 : 0.08}
                strokeLinecap="round"
                opacity={isSelected ? 1 : 0.85}
              />
              <line x1={b.x1} y1={ny1} x2={b.x2} y2={ny2}
                stroke="transparent" strokeWidth={0.4} strokeLinecap="round" />
              <text
                x={(b.x1 + b.x2) / 2 + perpX * 0.7}
                y={(ny1 + ny2) / 2 + perpY * 0.7}
                textAnchor="middle" dominantBaseline="middle"
                fill={isSelected ? 'hsl(var(--primary))' : 'hsl(210 70% 45%)'}
                fontSize={0.18} fontFamily="monospace"
                fontWeight={isSelected ? 'bold' : 'normal'}
              >
                {b.id}
              </text>
              {isSelected && (
                <text
                  x={(b.x1 + b.x2) / 2 + perpX * 1.5}
                  y={(ny1 + ny2) / 2 + perpY * 1.5}
                  textAnchor="middle" dominantBaseline="middle"
                  fill="hsl(var(--muted-foreground))" fontSize={0.12} fontFamily="monospace"
                >
                  L={beamLen.toFixed(2)}م | {b.b ?? 200}×{b.h ?? 400}
                </text>
              )}
              <circle cx={b.x1} cy={ny1} r={0.06}
                fill={isSelected ? 'hsl(var(--primary))' : 'hsl(210 70% 45%)'} />
              <circle cx={b.x2} cy={ny2} r={0.06}
                fill={isSelected ? 'hsl(var(--primary))' : 'hsl(210 70% 45%)'} />
            </g>
          );
        })}

        {/* Columns - Y negated — drawn with actual B×H dimensions */}
        {Array.from(uniqueColPositions.entries()).map(([key, cols]) => {
          const col = cols[0];
          const endCond = col.bottomEndCondition || 'F';
          const isFixed = endCond === 'F';
          const isSelected = selectedElement?.type === 'column' && selectedElement.id === col.id;
          // Use actual column dimensions (in meters) for display
          const colBm = (col.b ?? 300) / 1000; // mm to m
          const colHm = (col.h ?? 400) / 1000;
          const colW = Math.max(colBm, 0.15); // minimum display size
          const colHt = Math.max(colHm, 0.15);
          const ny = -col.y;

          return (
            <g key={key} style={{ cursor: 'pointer' }}
              onPointerDown={(e) => handleElementPointerDown('column', col.id, e)}
              onPointerUp={(e) => handleElementPointerUp('column', col.id, e)}
              onPointerLeave={handleElementPointerLeave}
            >
              {isSelected && (
                <rect
                  x={col.x - colW / 2 - 0.06} y={ny - colHt / 2 - 0.06}
                  width={colW + 0.12} height={colHt + 0.12}
                  fill="none" stroke="hsl(var(--primary))" strokeWidth={0.04}
                  strokeDasharray="0.08 0.04" rx={0.04}
                />
              )}

              <rect
                x={col.x - colW / 2} y={ny - colHt / 2}
                width={colW} height={colHt}
                fill={isGroundLevel
                  ? (isFixed ? 'hsl(217 91% 60%)' : 'hsl(38 92% 50%)')
                  : isSelected ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'
                }
                stroke={isSelected ? 'hsl(var(--primary))' : 'hsl(var(--foreground))'}
                strokeWidth={isSelected ? 0.04 : 0.025}
                rx={0.02}
              />

              {/* Cross lines inside column */}
              <line x1={col.x - colW / 2 + 0.02} y1={ny - colHt / 2 + 0.02}
                x2={col.x + colW / 2 - 0.02} y2={ny + colHt / 2 - 0.02}
                stroke={isGroundLevel ? 'white' : isSelected ? 'hsl(var(--primary-foreground))' : 'hsl(var(--background))'}
                strokeWidth={0.015} opacity={0.5} />
              <line x1={col.x + colW / 2 - 0.02} y1={ny - colHt / 2 + 0.02}
                x2={col.x - colW / 2 + 0.02} y2={ny + colHt / 2 - 0.02}
                stroke={isGroundLevel ? 'white' : isSelected ? 'hsl(var(--primary-foreground))' : 'hsl(var(--background))'}
                strokeWidth={0.015} opacity={0.5} />

              {/* Support symbols at ground level */}
              {isGroundLevel && isFixed && (
                <>
                  <rect x={col.x - Math.max(colW / 2 + 0.05, 0.2)} y={ny + colHt / 2 + 0.03} width={Math.max(colW + 0.1, 0.4)} height={0.06}
                    fill="hsl(217 91% 60%)" opacity={0.7} />
                  {[-0.12, -0.04, 0.04, 0.12].map(dx => (
                    <line key={dx}
                      x1={col.x + dx} y1={ny + colHt / 2 + 0.09}
                      x2={col.x + dx - 0.04} y2={ny + colHt / 2 + 0.16}
                      stroke="hsl(217 91% 60%)" strokeWidth={0.02} />
                  ))}
                </>
              )}
              {isGroundLevel && !isFixed && (
                <>
                  <polygon
                    points={`${col.x},${ny + colHt / 2 + 0.03} ${col.x - 0.12},${ny + colHt / 2 + 0.18} ${col.x + 0.12},${ny + colHt / 2 + 0.18}`}
                    fill="none" stroke="hsl(38 92% 50%)" strokeWidth={0.025} />
                  <line x1={col.x - 0.14} y1={ny + colHt / 2 + 0.2}
                    x2={col.x + 0.14} y2={ny + colHt / 2 + 0.2}
                    stroke="hsl(38 92% 50%)" strokeWidth={0.02} />
                </>
              )}

              {/* Column label */}
              <text x={col.x} y={ny - colHt / 2 - 0.12} textAnchor="middle"
                fill={isSelected ? 'hsl(var(--primary))' : 'hsl(var(--foreground))'}
                fontSize={0.2} fontFamily="monospace" fontWeight="bold">
                {col.id}
              </text>

              {/* Always show dimensions to indicate orientation */}
              <text x={col.x} y={ny + colHt / 2 + (isGroundLevel ? 0.42 : 0.2)} textAnchor="middle"
                fill="hsl(var(--muted-foreground))" fontSize={0.12} fontFamily="monospace">
                {col.b ?? 300}×{col.h ?? 400}
              </text>

              {isGroundLevel && (
                <text x={col.x} y={ny + colHt / 2 + (isFixed ? 0.28 : 0.32)} textAnchor="middle"
                  fill={isFixed ? 'hsl(217 91% 60%)' : 'hsl(38 92% 50%)'} fontSize={0.14} fontFamily="sans-serif">
                  {isFixed ? 'ثابت' : 'مفصلي'}
                </text>
              )}
            </g>
          );
        })}

        {/* Grid axis labels */}
        {Array.from({ length: Math.ceil(viewBox.w / gridStep) + 2 }, (_, i) => {
          const x = Math.floor(viewBox.x / gridStep) * gridStep + i * gridStep;
          if (x % gridStep !== 0) return null;
          return (
            <text key={`lx${x}`} x={x} y={viewBox.y + viewBox.h - 0.15}
              textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={0.15}
              fontFamily="monospace" opacity={0.5}>
              {x}
            </text>
          );
        })}
        {Array.from({ length: Math.ceil(viewBox.h / gridStep) + 2 }, (_, i) => {
          const svgY = Math.floor(viewBox.y / gridStep) * gridStep + i * gridStep;
          if (svgY % gridStep !== 0) return null;
          const worldY = -svgY; // convert back to world Y
          return (
            <text key={`ly${svgY}`} x={viewBox.x + 0.15} y={svgY + 0.05}
              textAnchor="start" fill="hsl(var(--muted-foreground))" fontSize={0.15}
              fontFamily="monospace" opacity={0.5}>
              {worldY}
            </text>
          );
        })}
      </svg>

      {/* Legend panel */}
      <div className="absolute top-2 right-2 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-3 text-xs space-y-1.5 shadow-md min-w-[140px]" dir="rtl">
        <div className="font-bold text-foreground text-sm">
          المنسوب: {(selectedElevation / 1000).toFixed(1)} م
        </div>
        {isGroundLevel ? (
          <>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(217 91% 60%)' }} />
              <span>ثابت (Fixed)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(38 92% 50%)' }} />
              <span>مفصلي (Pinned)</span>
            </div>
            <div className="text-muted-foreground mt-1">اضغط على الركيزة للتغيير</div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded" style={{ background: 'hsl(210 70% 45%)' }} />
              <span>جسور: {beamsAtLevel.length}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-muted-foreground" />
              <span>أعمدة: {uniqueColPositions.size}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm border border-primary/30 bg-primary/10" />
              <span>بلاطات: {slabsAtLevel.length}</span>
            </div>
            <div className="text-muted-foreground mt-1 border-t pt-1 border-border">
              اضغط لتحديد • اضغط مطولاً للخصائص
            </div>
          </>
        )}
      </div>

      {/* Selected element info panel */}
      {selectedElement && !isGroundLevel && (
        <div className="absolute bottom-2 right-2 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-3 text-xs shadow-md" dir="rtl">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-[10px]">
              {selectedElement.type === 'beam' ? 'جسر' : selectedElement.type === 'column' ? 'عمود' : 'بلاطة'}
            </Badge>
            <span className="font-bold font-mono">{selectedElement.id}</span>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-[10px] mt-1 w-full"
            onClick={() => {
              // Trigger long press handler to open full properties
              if (onElementLongPress) {
                onElementLongPress(selectedElement.type, selectedElement.id);
              }
            }}>
            عرض/تعديل الخصائص
          </Button>
        </div>
      )}

      {/* Element properties dialog */}
      <Dialog open={editDialog.open} onOpenChange={handleEditDialogClose}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              خصائص {editDialog.type === 'beam' ? 'الجسر' : editDialog.type === 'column' ? 'العمود' : 'البلاطة'} {editDialog.label}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              تعديل خصائص وأبعاد العنصر
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(editDialog.type === 'beam' || editDialog.type === 'column') && (
              <>
                <div className="text-sm font-semibold">الأبعاد (مم)</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">العرض b</label>
                    <Input type="number" value={editDialog.b}
                      onChange={e => setEditDialog(prev => ({ ...prev, b: Number(e.target.value) }))}
                      className="h-9 font-mono text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">الارتفاع h</label>
                    <Input type="number" value={editDialog.h}
                      onChange={e => setEditDialog(prev => ({ ...prev, h: Number(e.target.value) }))}
                      className="h-9 font-mono text-sm" />
                  </div>
                </div>
                {editDialog.type === 'beam' && (
                  <div className="text-xs text-muted-foreground">
                    الطول: <span className="font-mono">{editDialog.length.toFixed(2)} م</span>
                  </div>
                )}
              </>
            )}
            {editDialog.type === 'slab' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">خصائص البلاطة</div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">السماكة (مم)</label>
                  <Input type="number" value={editDialog.thickness}
                    onChange={e => setEditDialog(prev => ({ ...prev, thickness: Number(e.target.value) }))}
                    className="h-9 font-mono text-sm" />
                </div>
              </div>
            )}
            {editDialog.type === 'column' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold">شروط الأطراف</div>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">أسفل العمود</label>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-8 text-xs"
                        variant={editDialog.bottomEnd === 'F' ? 'default' : 'outline'}
                        onClick={() => setEditDialog(prev => ({ ...prev, bottomEnd: 'F' }))}>
                        🔒 ثابت
                      </Button>
                      <Button size="sm" className="flex-1 h-8 text-xs"
                        variant={editDialog.bottomEnd === 'P' ? 'default' : 'outline'}
                        onClick={() => setEditDialog(prev => ({ ...prev, bottomEnd: 'P' }))}>
                        📌 مفصلي
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">أعلى العمود</label>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-8 text-xs"
                        variant={editDialog.topEnd === 'F' ? 'default' : 'outline'}
                        onClick={() => setEditDialog(prev => ({ ...prev, topEnd: 'F' }))}>
                        🔒 ثابت
                      </Button>
                      <Button size="sm" className="flex-1 h-8 text-xs"
                        variant={editDialog.topEnd === 'P' ? 'default' : 'outline'}
                        onClick={() => setEditDialog(prev => ({ ...prev, topEnd: 'P' }))}>
                        📌 مفصلي
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DOF Release toggles for beams and columns */}
            {(editDialog.type === 'beam' || editDialog.type === 'column') && (
              <>
                <div className="space-y-2 mt-3">
                  <div className="text-sm font-semibold">درجات تحرير الطرف I</div>
                  <div className="grid grid-cols-3 gap-2 bg-muted/50 rounded-lg p-3">
                    {(['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const).map(dof => (
                      <div key={`i-${dof}`} className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono">{dof.toUpperCase()}</span>
                        <Switch
                          checked={editDialog.releaseI[dof]}
                          onCheckedChange={v => setEditDialog(prev => ({
                            ...prev,
                            releaseI: { ...prev.releaseI, [dof]: v }
                          }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-semibold">درجات تحرير الطرف J</div>
                  <div className="grid grid-cols-3 gap-2 bg-muted/50 rounded-lg p-3">
                    {(['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const).map(dof => (
                      <div key={`j-${dof}`} className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono">{dof.toUpperCase()}</span>
                        <Switch
                          checked={editDialog.releaseJ[dof]}
                          onCheckedChange={v => setEditDialog(prev => ({
                            ...prev,
                            releaseJ: { ...prev.releaseJ, [dof]: v }
                          }))}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    تشغيل = مقيد (Restrained) • إيقاف = حر (Free)
                  </p>
                </div>
              </>
            )}
          </div>

          {confirmDelete && (
            <div className="bg-destructive/10 border border-destructive/40 rounded-lg p-3 mx-0 mb-2">
              <p className="text-sm text-destructive font-medium text-center">
                ⚠️ هل أنت متأكد من حذف {editDialog.type === 'beam' ? 'الجسر' : editDialog.type === 'column' ? 'العمود' : 'البلاطة'} {editDialog.label}؟
              </p>
              <p className="text-xs text-muted-foreground text-center mt-1">اضغط زر الحذف مرة أخرى للتأكيد</p>
            </div>
          )}
          <DialogFooter className="flex-col gap-2">
            {onDeleteElement && (
              <Button
                variant={confirmDelete ? 'destructive' : 'outline'}
                size="sm"
                className={`w-full min-h-[44px] ${confirmDelete ? '' : 'border-destructive/50 text-destructive hover:bg-destructive/10'}`}
                onClick={handleDeleteClick}
              >
                {confirmDelete ? '⚠️ تأكيد الحذف' : '🗑️ حذف العنصر'}
              </Button>
            )}
            <div className="flex gap-2 w-full">
              <Button variant="outline" size="sm" className="flex-1 min-h-[40px]" onClick={() => { setConfirmDelete(false); setEditDialog(prev => ({ ...prev, open: false })); }}>
                إلغاء
              </Button>
              <Button size="sm" className="flex-1 min-h-[40px]" onClick={handleEditSave}>
                حفظ التغييرات
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Support change dialog (ground level) */}
      <Dialog open={supportDialog.open} onOpenChange={open => setSupportDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>خصائص الركيزة - {supportDialog.colLabel}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              الموقع ({supportDialog.x.toFixed(1)}, {supportDialog.y.toFixed(1)}) - تعديل درجات الحرية
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Quick presets */}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 text-xs h-9"
                onClick={() => setSupportDialog(prev => ({
                  ...prev,
                  restraints: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }
                }))}>
                🔒 ثابت (Fixed)
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs h-9"
                onClick={() => setSupportDialog(prev => ({
                  ...prev,
                  restraints: { ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }
                }))}>
                📌 مفصلي (Pinned)
              </Button>
            </div>

            {/* Per-DOF toggles */}
            <div className="space-y-2">
              <label className="text-sm font-medium">درجات الحرية (الركيزة)</label>
              <div className="grid grid-cols-3 gap-2 bg-muted/50 rounded-lg p-3">
                {(['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const).map(dof => (
                  <div key={dof} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono">{dof.toUpperCase()}</span>
                    <Switch
                      checked={supportDialog.restraints[dof]}
                      onCheckedChange={v => setSupportDialog(prev => ({
                        ...prev,
                        restraints: { ...prev.restraints, [dof]: v }
                      }))}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                تشغيل = مقيد (Restrained) • إيقاف = حر (Free)
              </p>
            </div>

            {/* Apply to all checkbox */}
            <div className="flex items-center gap-2 border-t pt-3 border-border">
              <Checkbox
                id="apply-all-supports"
                checked={supportDialog.applyToAll}
                onCheckedChange={(v) => setSupportDialog(prev => ({ ...prev, applyToAll: !!v }))}
              />
              <label htmlFor="apply-all-supports" className="text-xs cursor-pointer">
                تعميم على جميع الركائز عند هذا المنسوب
              </label>
            </div>

            {/* Summary */}
            <div className="border rounded p-2 bg-muted/50 text-xs space-y-1 border-border">
              <div className="font-medium">ملخص الركيزة:</div>
              <div>
                {supportDialog.restraints.ux && supportDialog.restraints.uy && supportDialog.restraints.uz &&
                 supportDialog.restraints.rx && supportDialog.restraints.ry && supportDialog.restraints.rz
                  ? <Badge variant="default">ثابت (Fixed) - جميع DOFs مقيدة</Badge>
                  : supportDialog.restraints.ux && supportDialog.restraints.uy && supportDialog.restraints.uz &&
                    !supportDialog.restraints.rx && !supportDialog.restraints.ry && !supportDialog.restraints.rz
                  ? <Badge variant="secondary">مفصلي (Pinned) - الإزاحات مقيدة</Badge>
                  : <Badge variant="outline">مخصص (Custom)</Badge>
                }
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setSupportDialog(prev => ({ ...prev, open: false }))}>
              إلغاء
            </Button>
            <Button size="sm" onClick={handleSupportSave}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
