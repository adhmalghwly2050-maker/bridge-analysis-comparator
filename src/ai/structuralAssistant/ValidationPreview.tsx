import React, { useState } from 'react';
import { Check, X, Move, Trash2, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PlanAnalysisResult, GeneratedModel } from './types';

interface ValidationPreviewProps {
  analysisResult: PlanAnalysisResult;
  generatedModel: GeneratedModel;
  uploadedImage: string | null;
  onAccept: (model: GeneratedModel) => void;
  onReject: () => void;
}

export default function ValidationPreview({
  analysisResult,
  generatedModel,
  uploadedImage,
  onAccept,
  onReject,
}: ValidationPreviewProps) {
  const [model, setModel] = useState<GeneratedModel>({ ...generatedModel });
  const [selectedColumn, setSelectedColumn] = useState<number | null>(null);

  const removeColumn = (index: number) => {
    setModel(prev => ({
      ...prev,
      columnPositions: prev.columnPositions.filter((_, i) => i !== index),
    }));
    setSelectedColumn(null);
  };

  const removeSlab = (id: string) => {
    setModel(prev => ({
      ...prev,
      slabs: prev.slabs.filter(s => s.id !== id),
    }));
  };

  const updateColumnPosition = (index: number, axis: 'x' | 'y', value: number) => {
    setModel(prev => {
      const cols = [...prev.columnPositions];
      cols[index] = { ...cols[index], [axis]: value };
      return { ...prev, columnPositions: cols };
    });
  };

  // Canvas dimensions for preview
  const maxX = Math.max(...model.slabs.map(s => s.x2), ...model.columnPositions.map(c => c.x), 10);
  const maxY = Math.max(...model.slabs.map(s => s.y2), ...model.columnPositions.map(c => c.y), 10);
  const canvasScale = 40;
  const padding = 40;
  const svgWidth = maxX * canvasScale + padding * 2;
  const svgHeight = maxY * canvasScale + padding * 2;

  const toSvgX = (x: number) => x * canvasScale + padding;
  const toSvgY = (y: number) => y * canvasScale + padding;

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold text-foreground">مراجعة النموذج المُولَّد</h2>
        <h3 className="text-sm text-foreground">Review Generated Model</h3>
        <p className="text-xs text-muted-foreground mt-1">
          راجع وعدّل العناصر قبل اعتماد النموذج النهائي
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Preview Canvas */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">معاينة النموذج / Model Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border border-border rounded overflow-auto bg-card" style={{ maxHeight: '500px' }}>
                <svg width={svgWidth} height={svgHeight} className="w-full h-auto">
                  {/* Grid lines */}
                  {analysisResult.grids.map(grid => (
                    <g key={grid.id}>
                      {grid.direction === 'vertical' ? (
                        <>
                          <line
                            x1={toSvgX(grid.position)} y1={padding - 20}
                            x2={toSvgX(grid.position)} y2={svgHeight - padding + 20}
                            stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeDasharray="4,4"
                          />
                          <text
                            x={toSvgX(grid.position)} y={padding - 25}
                            textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={10}
                          >{grid.label}</text>
                        </>
                      ) : (
                        <>
                          <line
                            x1={padding - 20} y1={toSvgY(grid.position)}
                            x2={svgWidth - padding + 20} y2={toSvgY(grid.position)}
                            stroke="hsl(var(--muted-foreground))" strokeWidth={0.5} strokeDasharray="4,4"
                          />
                          <text
                            x={padding - 25} y={toSvgY(grid.position) + 4}
                            textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={10}
                          >{grid.label}</text>
                        </>
                      )}
                    </g>
                  ))}

                  {/* Slabs */}
                  {model.slabs.map(slab => (
                    <g key={slab.id}>
                      <rect
                        x={toSvgX(slab.x1)} y={toSvgY(slab.y1)}
                        width={(slab.x2 - slab.x1) * canvasScale}
                        height={(slab.y2 - slab.y1) * canvasScale}
                        fill="hsl(var(--slab-fill) / 0.15)"
                        stroke="hsl(var(--slab-fill))"
                        strokeWidth={1}
                      />
                      <text
                        x={toSvgX((slab.x1 + slab.x2) / 2)}
                        y={toSvgY((slab.y1 + slab.y2) / 2) + 4}
                        textAnchor="middle" fill="hsl(var(--slab-fill))" fontSize={11} fontWeight="bold"
                      >{slab.id}</text>
                    </g>
                  ))}

                  {/* Beams (edges of slabs) */}
                  {model.slabs.map(slab => (
                    <g key={`beams-${slab.id}`}>
                      <line x1={toSvgX(slab.x1)} y1={toSvgY(slab.y1)} x2={toSvgX(slab.x2)} y2={toSvgY(slab.y1)}
                        stroke="hsl(var(--beam))" strokeWidth={2.5} />
                      <line x1={toSvgX(slab.x2)} y1={toSvgY(slab.y1)} x2={toSvgX(slab.x2)} y2={toSvgY(slab.y2)}
                        stroke="hsl(var(--beam))" strokeWidth={2.5} />
                      <line x1={toSvgX(slab.x1)} y1={toSvgY(slab.y2)} x2={toSvgX(slab.x2)} y2={toSvgY(slab.y2)}
                        stroke="hsl(var(--beam))" strokeWidth={2.5} />
                      <line x1={toSvgX(slab.x1)} y1={toSvgY(slab.y1)} x2={toSvgX(slab.x1)} y2={toSvgY(slab.y2)}
                        stroke="hsl(var(--beam))" strokeWidth={2.5} />
                    </g>
                  ))}

                  {/* Columns */}
                  {model.columnPositions.map((col, i) => (
                    <g key={`col-${i}`} onClick={() => setSelectedColumn(i)} className="cursor-pointer">
                      <rect
                        x={toSvgX(col.x) - 6} y={toSvgY(col.y) - 6}
                        width={12} height={12}
                        fill={selectedColumn === i ? 'hsl(var(--destructive))' : 'hsl(var(--column))'}
                        stroke="hsl(var(--foreground))" strokeWidth={1}
                      />
                      <text
                        x={toSvgX(col.x)} y={toSvgY(col.y) - 10}
                        textAnchor="middle" fill="hsl(var(--column))" fontSize={8}
                      >C{i + 1}</text>
                    </g>
                  ))}
                </svg>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Controls Panel */}
        <div className="space-y-3">
          {/* Stats */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">البلاطات / Slabs</span>
                <Badge variant="secondary">{model.slabs.length}</Badge>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">الأعمدة / Columns</span>
                <Badge variant="secondary">{model.columnPositions.length}</Badge>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">الشبكة X</span>
                <Badge variant="outline">{model.gridSpacingX.map(s => s.toFixed(1)).join(' × ')} م</Badge>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">الشبكة Y</span>
                <Badge variant="outline">{model.gridSpacingY.map(s => s.toFixed(1)).join(' × ')} م</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Selected Column */}
          {selectedColumn !== null && (
            <Card>
              <CardHeader>
                <CardTitle className="text-xs flex items-center gap-1">
                  <Move size={12} />
                  عمود C{selectedColumn + 1}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">X (م)</label>
                    <Input
                      type="number"
                      value={model.columnPositions[selectedColumn]?.x || 0}
                      onChange={(e) => updateColumnPosition(selectedColumn, 'x', parseFloat(e.target.value) || 0)}
                      className="h-8 text-xs font-mono"
                      step={0.1}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Y (م)</label>
                    <Input
                      type="number"
                      value={model.columnPositions[selectedColumn]?.y || 0}
                      onChange={(e) => updateColumnPosition(selectedColumn, 'y', parseFloat(e.target.value) || 0)}
                      className="h-8 text-xs font-mono"
                      step={0.1}
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full text-xs"
                  onClick={() => removeColumn(selectedColumn)}
                >
                  <Trash2 size={12} className="mr-1" />
                  حذف العمود / Remove Column
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Slabs List */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xs">البلاطات / Slabs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 max-h-40 overflow-y-auto">
              {model.slabs.map(slab => (
                <div key={slab.id} className="flex items-center justify-between text-xs p-1 rounded hover:bg-muted">
                  <span className="font-mono">
                    {slab.id}: ({slab.x1},{slab.y1})→({slab.x2},{slab.y2})
                  </span>
                  <button
                    onClick={() => removeSlab(slab.id)}
                    className="text-destructive hover:text-destructive/80 p-1"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="space-y-2">
            <Button
              onClick={() => onAccept(model)}
              className="w-full min-h-[44px] bg-[hsl(var(--stress-safe))] hover:bg-[hsl(var(--stress-safe))]/90 text-[hsl(var(--beam-foreground))]"
            >
              <Check size={16} className="mr-2" />
              اعتماد النموذج / Accept Model
            </Button>
            <Button
              onClick={onReject}
              variant="outline"
              className="w-full min-h-[44px]"
            >
              <X size={16} className="mr-2" />
              إعادة المحاولة / Try Again
            </Button>
          </div>

          <div className="flex items-start gap-2 p-2 rounded bg-muted text-xs text-muted-foreground">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <p>
              يمكنك تعديل مواقع الأعمدة وحذف البلاطات قبل اعتماد النموذج النهائي.
              <br />
              You can adjust column positions and remove slabs before accepting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
