import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { StructuralNode, FrameElement, AreaElement } from '@/structural/model/types';
import type { ToolType } from './ToolPalette';

interface EndReleaseData {
  nodeI: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
  nodeJ: { ux: boolean; uy: boolean; uz: boolean; rx: boolean; ry: boolean; rz: boolean };
}

interface ModelCanvasProps {
  nodes: StructuralNode[];
  frames: FrameElement[];
  areas: AreaElement[];
  activeTool: ToolType;
  onCanvasClick: (x: number, y: number) => void;
  onNodeClick: (id: number) => void;
  onFrameClick: (id: number) => void;
  onAreaClick: (id: number) => void;
  onFrameLongPress?: (id: number) => void;
  onAreaLongPress?: (id: number) => void;
  selectedNodeId?: number | null;
  selectedFrameId?: number | null;
  selectedAreaId?: number | null;
  pendingNode?: { x: number; y: number } | null;
  columnLabels?: Map<number, string>;
  frameEndReleases?: Record<string, EndReleaseData>;
}

export default function ModelCanvas({
  nodes, frames, areas, activeTool,
  onCanvasClick, onNodeClick, onFrameClick, onAreaClick,
  onFrameLongPress, onAreaLongPress,
  selectedNodeId, selectedFrameId, selectedAreaId,
  pendingNode, columnLabels, frameEndReleases,
}: ModelCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [viewBox, setViewBox] = useState({ x: -2, y: -2, w: 16, h: 18 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; vbx: number; vby: number } | null>(null);

  // Compute bounds
  useEffect(() => {
    if (nodes.length === 0) return;
    const floorNodes = nodes.filter(n => Math.abs(n.z) < 0.01);
    if (floorNodes.length === 0) return;
    const xs = floorNodes.map(n => n.x);
    const ys = floorNodes.map(n => n.y);
    const minX = Math.min(...xs) - 2;
    const maxX = Math.max(...xs) + 2;
    const minY = Math.min(...ys) - 2;
    const maxY = Math.max(...ys) + 2;
    // Flip Y: SVG viewBox Y goes from -maxY to -minY (negated world coords)
    setViewBox({ x: minX, y: -maxY, w: maxX - minX, h: maxY - minY });
  }, [nodes]);

  const getNodeById = useCallback((id: number) => nodes.find(n => n.id === id), [nodes]);

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    const x = (clientX - rect.left) * scaleX + viewBox.x;
    // Flip Y: screen top = max Y, screen bottom = min Y
    const svgY = (clientY - rect.top) * scaleY + viewBox.y;
    const y = -(svgY); // negate to get world Y (bottom-up)
    return { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 };
  }, [viewBox]);

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool === 'select' || isPanning) return;
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    onCanvasClick(x, y);
  }, [activeTool, isPanning, screenToWorld, onCanvasClick]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    setMousePos({ x, y });

    if (isPanning && panStart) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = (e.clientX - panStart.x) * viewBox.w / rect.width;
      const dy = (e.clientY - panStart.y) * viewBox.h / rect.height;
      setViewBox(vb => ({ ...vb, x: panStart.vbx - dx, y: panStart.vby - dy }));
    }
  }, [screenToWorld, isPanning, panStart, viewBox]);

  // Touch handlers for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 1 && activeTool === 'select') {
      const touch = e.touches[0];
      setPanStart({ x: touch.clientX, y: touch.clientY, vbx: viewBox.x, vby: viewBox.y });
      setIsPanning(true);
    }
  }, [activeTool, viewBox]);

  const handleTouchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 2) {
      // Pinch to zoom
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.sqrt((t2.clientX - t1.clientX) ** 2 + (t2.clientY - t1.clientY) ** 2);
      // Simple zoom based on pinch distance
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

  const handleTouchEnd = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 0) {
      if (!isPanning && activeTool !== 'select') {
        // Tap to select/add
        const touch = e.changedTouches[0];
        const { x, y } = screenToWorld(touch.clientX, touch.clientY);
        onCanvasClick(x, y);
      }
      setIsPanning(false);
      setPanStart(null);
    }
  }, [isPanning, activeTool, screenToWorld, onCanvasClick]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    setViewBox(vb => {
      const newW = vb.w * zoomFactor;
      const newH = vb.h * zoomFactor;
      return {
        x: wx - (wx - vb.x) * zoomFactor,
        y: wy - (wy - vb.y) * zoomFactor,
        w: newW,
        h: newH,
      };
    });
  }, [screenToWorld]);

  // Mouse pan
  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1 || (e.button === 0 && activeTool === 'select')) {
      setPanStart({ x: e.clientX, y: e.clientY, vbx: viewBox.x, vby: viewBox.y });
      setIsPanning(true);
    }
  }, [activeTool, viewBox]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);
  }, []);

  // Floor-level nodes only for 2D view
  const floorNodes = nodes.filter(n => Math.abs(n.z) < 0.01);
  const beamFrames = frames.filter(f => f.type === 'beam');
  const columnFrames = frames.filter(f => f.type === 'column');

  return (
    <div className="canvas-container flex-1 relative touch-none">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="w-full h-full"
        onClick={handleSvgClick}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Grid */}
        {Array.from({ length: Math.ceil(viewBox.w) + 1 }, (_, i) => {
          const x = Math.floor(viewBox.x) + i;
          return (
            <line key={`gx${x}`} x1={x} y1={viewBox.y} x2={x} y2={viewBox.y + viewBox.h}
              stroke="hsl(var(--canvas-grid))" strokeWidth="0.02" />
          );
        })}
        {Array.from({ length: Math.ceil(viewBox.h) + 1 }, (_, i) => {
          const y = Math.floor(viewBox.y) + i;
          return (
            <line key={`gy${y}`} x1={viewBox.x} y1={y} x2={viewBox.x + viewBox.w} y2={y}
              stroke="hsl(var(--canvas-grid))" strokeWidth="0.02" />
          );
        })}

        {/* Area elements (slabs) - Y negated for bottom-left origin */}
        {areas.map(area => {
          const areaNodes = area.nodeIds.map(id => getNodeById(id)).filter(Boolean) as StructuralNode[];
          if (areaNodes.length < 3) return null;
          const points = areaNodes.map(n => `${n.x},${-n.y}`).join(' ');
          const isSelected = selectedAreaId === area.id;
          const cx = areaNodes.reduce((s, n) => s + n.x, 0) / areaNodes.length;
          const cy = -(areaNodes.reduce((s, n) => s + n.y, 0) / areaNodes.length);
          return (
            <g key={`a${area.id}`}
              onClick={(e) => { e.stopPropagation(); onAreaClick(area.id); }}
              onPointerDown={() => {
                longPressTimer.current = setTimeout(() => { onAreaLongPress?.(area.id); }, 500);
              }}
              onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
              onPointerLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
            >
              <polygon points={points} className="element-slab" strokeWidth={isSelected ? "0.08" : "0.04"}
                style={isSelected ? { stroke: 'hsl(var(--accent))', strokeWidth: '0.08' } : {}} />
              <text x={cx} y={cy}
                textAnchor="middle" dominantBaseline="middle"
                className="fill-muted-foreground" fontSize="0.3" fontFamily="JetBrains Mono">
                A{area.id}
              </text>
            </g>
          );
        })}

        {/* Beam elements */}
        {beamFrames.map(frame => {
          const ni = getNodeById(frame.nodeI);
          const nj = getNodeById(frame.nodeJ);
          if (!ni || !nj) return null;
          const isSelected = selectedFrameId === frame.id;
          // Check for end releases
          let hasReleaseI = false;
          let hasReleaseJ = false;
          if (frameEndReleases) {
            const posKey = `${ni.x.toFixed(3)}_${ni.y.toFixed(3)}_${nj.x.toFixed(3)}_${nj.y.toFixed(3)}`;
            const posKeyRev = `${nj.x.toFixed(3)}_${ni.y.toFixed(3)}_${ni.x.toFixed(3)}_${nj.y.toFixed(3)}`;
            const rel = frameEndReleases[posKey] || frameEndReleases[`${nj.x.toFixed(3)}_${nj.y.toFixed(3)}_${ni.x.toFixed(3)}_${ni.y.toFixed(3)}`];
            if (rel) {
              const isRev = !frameEndReleases[posKey];
              const rI = isRev ? rel.nodeJ : rel.nodeI;
              const rJ = isRev ? rel.nodeI : rel.nodeJ;
              hasReleaseI = rI.rx || rI.ry || rI.rz;
              hasReleaseJ = rJ.rx || rJ.ry || rJ.rz;
            }
          }
          return (
            <g key={`f${frame.id}`}
              onClick={(e) => { e.stopPropagation(); onFrameClick(frame.id); }}
              onPointerDown={() => {
                longPressTimer.current = setTimeout(() => { onFrameLongPress?.(frame.id); }, 500);
              }}
              onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
              onPointerLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
            >
              <line x1={ni.x} y1={-ni.y} x2={nj.x} y2={-nj.y}
                className="element-beam" strokeWidth={isSelected ? "0.12" : "0.06"}
                style={isSelected ? { stroke: 'hsl(var(--accent))', strokeWidth: '0.12' } : {}} />
              {/* Pin indicators for released ends */}
              {hasReleaseI && (
                <circle cx={ni.x} cy={-ni.y} r="0.12"
                  fill="hsl(var(--background))" stroke="hsl(var(--accent))" strokeWidth="0.03" />
              )}
              {hasReleaseJ && (
                <circle cx={nj.x} cy={-nj.y} r="0.12"
                  fill="hsl(var(--background))" stroke="hsl(var(--accent))" strokeWidth="0.03" />
              )}
              <text x={(ni.x + nj.x) / 2} y={-(ni.y + nj.y) / 2 + 0.15}
                textAnchor="middle" className="fill-foreground" fontSize="0.25" fontFamily="JetBrains Mono">
                B{frame.id}
              </text>
            </g>
          );
        })}

        {/* Nodes (rendered BEFORE columns so columns get click priority) */}
        {floorNodes.map(node => {
          const hasColumn = columnFrames.some(f => {
            const topNode = getNodeById(f.nodeJ);
            return topNode && Math.abs(topNode.x - node.x) < 0.01 && Math.abs(topNode.y - node.y) < 0.01;
          });
          const isSelected = selectedNodeId === node.id;
          const hasRestraint = node.restraints.ux || node.restraints.uy || node.restraints.uz;
          const ny = -node.y;
          return (
            <g key={`n${node.id}`} onClick={(e) => { 
              if (hasColumn) return;
              e.stopPropagation(); onNodeClick(node.id); 
            }}>
              <circle cx={node.x} cy={ny} r={isSelected ? 0.15 : 0.1}
                className="element-node"
                style={isSelected ? { stroke: 'hsl(var(--accent))', strokeWidth: '0.06', fill: 'hsl(var(--accent))' } : {}} />
              {!hasColumn && (
                <text x={node.x} y={ny + 0.2} textAnchor="middle"
                  className="fill-foreground" fontSize="0.2" fontFamily="JetBrains Mono">
                  N{node.id}
                </text>
              )}
              {hasRestraint && (
                <polygon points={`${node.x},${ny - 0.1} ${node.x - 0.12},${ny - 0.25} ${node.x + 0.12},${ny - 0.25}`}
                  fill="hsl(var(--node))" opacity="0.5" />
              )}
            </g>
          );
        })}

        {/* Column indicators (rendered AFTER nodes for click priority) */}
        {columnFrames.map(frame => {
          const topNode = getNodeById(frame.nodeJ);
          if (!topNode || Math.abs(topNode.z) > 0.01) return null;
          const isSelected = selectedFrameId === frame.id;
          const ny = -topNode.y;
          return (
            <g key={`c${frame.id}`}
              onClick={(e) => { e.stopPropagation(); onFrameClick(frame.id); }}
              style={{ cursor: 'pointer' }}
              onPointerDown={() => {
                longPressTimer.current = setTimeout(() => { onFrameLongPress?.(frame.id); }, 500);
              }}
              onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
              onPointerLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
            >
              <rect x={topNode.x - 0.25} y={ny - 0.25} width="0.5" height="0.5"
                fill="transparent" />
              <rect x={topNode.x - 0.15} y={ny - 0.15} width="0.3" height="0.3"
                className="element-column" rx="0.02"
                style={isSelected ? { stroke: 'hsl(var(--accent))', strokeWidth: '0.06' } : {}} />
              <text x={topNode.x} y={ny - 0.35} textAnchor="middle"
                className="fill-foreground" fontSize="0.18" fontFamily="JetBrains Mono">
                {columnLabels?.get(frame.id) || `C${frame.id}`}
              </text>
            </g>
          );
        })}

        {/* Pending node indicator */}
        {pendingNode && (
          <circle cx={pendingNode.x} cy={-pendingNode.y} r="0.12"
            fill="hsl(var(--accent))" opacity="0.5" stroke="hsl(var(--accent))" strokeWidth="0.04" />
        )}

        {/* Crosshair */}
        {mousePos && activeTool !== 'select' && (
          <>
            <line x1={mousePos.x} y1={viewBox.y} x2={mousePos.x} y2={viewBox.y + viewBox.h}
              stroke="hsl(var(--canvas-crosshair))" strokeWidth="0.01" strokeDasharray="0.1" />
            <line x1={viewBox.x} y1={-mousePos.y} x2={viewBox.x + viewBox.w} y2={-mousePos.y}
              stroke="hsl(var(--canvas-crosshair))" strokeWidth="0.01" strokeDasharray="0.1" />
          </>
        )}
      </svg>

      {/* Coordinate display */}
      {mousePos && (
        <div className="absolute bottom-2 left-2 md:bottom-4 md:left-4 bg-card/90 backdrop-blur-sm border border-border rounded px-2 py-1 pointer-events-none">
          <span className="font-mono text-xs text-muted-foreground">
            X: {mousePos.x.toFixed(1)} | Y: {mousePos.y.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}
