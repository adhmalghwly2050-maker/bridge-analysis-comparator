import React, { useState, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Download, FileText, Layers, AlertCircle, Printer } from 'lucide-react';
import type { Story, Slab, Beam, Column, MatProps, SlabProps } from '@/lib/structuralEngine';
import { calculateDevelopmentLengths } from '@/lib/structuralEngine';
import { generateConstructionSheets } from '@/drawings/constructionSheets';
import { openHTMLSheetsForPrint } from '@/drawings/htmlConstructionSheets';
import { exportStructuralDrawingPDF } from '@/export/drawingExporter';
import { generateStructuralDXF, generateBeamLayoutDXF, generateColumnLayoutDXF, downloadDXF } from '@/export/dxfExporter';
import { generateBBS, exportBBSToPDF, exportBBSToExcel } from '@/rebar/bbsGenerator';
import { getFloorCode, makeDrawingNumber } from '@/drawings/drawingStandards';
import type { ExportOptions, DevelopmentLengths } from '@/drawings/drawingStandards';



interface ExportPanelProps {
  stories: Story[];
  slabs: Slab[];
  beams: Beam[];
  columns: Column[];
  beamDesigns: any[];
  colDesigns: any[];
  slabDesigns: any[];
  mat: MatProps;
  slabProps: SlabProps;
  projectName?: string;
  analyzed: boolean;
}

export default function ExportPanel({
  stories, slabs, beams, columns, beamDesigns, colDesigns, slabDesigns,
  mat, slabProps, projectName = 'Structural Design Studio', analyzed,
}: ExportPanelProps) {
  const [selectedFloors, setSelectedFloors] = useState<string[]>(stories.map(s => s.id));
  const [drawingTypes, setDrawingTypes] = useState({
    beamLayout: true, columnLayout: true, slabPlan: true,
    generalNotes: true, bbs: true, beamElevation: true, buildingElevation: true,
  });
  const [format, setFormat] = useState<'pdf' | 'dxf' | 'both' | 'print'>('pdf');
  const [sheetSize, setSheetSize] = useState<'A3' | 'A4' | 'A1'>('A3');
  const [exporting, setExporting] = useState(false);

  const allSelected = selectedFloors.length === stories.length;
  const toggleFloor = (id: string) => {
    setSelectedFloors(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };
  const toggleAll = () => {
    setSelectedFloors(allSelected ? [] : stories.map(s => s.id));
  };

  // Pre-compute development lengths for all bar diameters used
  const devLengths = useMemo<DevelopmentLengths[]>(() => {
    const diameters = new Set<number>();
    beamDesigns.forEach((d: any) => {
      if (d.flexLeft?.dia) diameters.add(d.flexLeft.dia);
      if (d.flexMid?.dia) diameters.add(d.flexMid.dia);
      if (d.flexRight?.dia) diameters.add(d.flexRight.dia);
    });
    colDesigns.forEach((c: any) => {
      if (c.design?.dia) diameters.add(c.design.dia);
    });
    return Array.from(diameters).map(dia =>
      calculateDevelopmentLengths(dia, mat.fy, mat.fc, 40, 150)
    );
  }, [beamDesigns, colDesigns, mat.fy, mat.fc]);

  // Count elements per floor for display
  const floorCounts = useMemo(() => {
    const counts: Record<string, { beams: number; cols: number; slabs: number }> = {};
    stories.forEach(s => {
      counts[s.id] = {
        beams: beams.filter(b => b.storyId === s.id || (!b.storyId && stories.length === 1)).length,
        cols: columns.filter(c => c.storyId === s.id || (!c.storyId && stories.length === 1)).length,
        slabs: slabs.filter(sl => sl.storyId === s.id || (!sl.storyId && stories.length === 1)).length,
      };
    });
    return counts;
  }, [stories, beams, columns, slabs]);

  const handleExport = () => {
    if (!analyzed) return;
    setExporting(true);

    try {
      // For each selected floor, generate per-floor exports
      for (let fi = 0; fi < stories.length; fi++) {
        const story = stories[fi];
        if (!selectedFloors.includes(story.id)) continue;

        const floorCode = getFloorCode(story.label, fi);

        // Filter elements for this floor
        const filtSlabs = slabs.filter(s => s.storyId === story.id || (!s.storyId && stories.length === 1));
        const filtBeams = beams.filter(b => b.storyId === story.id || (!b.storyId && stories.length === 1));
        const filtCols = columns.filter(c => c.storyId === story.id || (!c.storyId && stories.length === 1));

        // Filter designs for this floor's elements
        const filtBeamIds = new Set(filtBeams.map(b => b.id));
        const filtColIds = new Set(filtCols.map(c => c.id));
        const filtSlabIds = new Set(filtSlabs.map(s => s.id));
        const filtBeamDesigns = beamDesigns.filter((d: any) => filtBeamIds.has(d.beamId));
        const filtColDesigns = colDesigns.filter((c: any) => filtColIds.has(c.id));
        const filtSlabDesigns = slabDesigns.filter((s: any) => filtSlabIds.has(s.id));

        const exportOptions: ExportOptions = {
          storyId: story.id,
          storyLabel: story.label,
          storyIndex: fi,
          totalStories: stories.length,
          floorCode,
          devLengths,
          titleBlockConfig: {
            projectName,
            fc: mat.fc,
            fy: mat.fy,
          },
        };

        // PDF / Print exports
        if (format === 'pdf' || format === 'both' || format === 'print') {
          // Construction sheets (beam layout, column layout, slab plan, beam elevations)
          if (drawingTypes.beamLayout || drawingTypes.columnLayout || drawingTypes.slabPlan || drawingTypes.beamElevation) {
            if (format === 'print') {
              // Use HTML-based construction sheets with full Arabic text support
              openHTMLSheetsForPrint(
                filtSlabs, filtBeams, filtCols,
                filtBeamDesigns, filtColDesigns, filtSlabDesigns,
                projectName, exportOptions
              );
            } else {
              generateConstructionSheets(
                filtSlabs, filtBeams, filtCols,
                filtBeamDesigns, filtColDesigns, filtSlabDesigns,
                projectName, exportOptions
              );
            }
          }

          // BBS per floor
          if (drawingTypes.bbs) {
            const bbs = generateBBS(filtBeams, filtCols, filtSlabs, filtBeamDesigns, filtColDesigns, filtSlabDesigns);
            exportBBSToPDF(bbs, `${projectName}_BBS_${floorCode}`);
          }
        }

        // DXF exports per floor
        if (format === 'dxf' || format === 'both') {
          if (drawingTypes.beamLayout) {
            downloadDXF(generateBeamLayoutDXF(filtBeams, filtCols, filtSlabs), `${projectName}_${floorCode}_beams.dxf`);
          }
          if (drawingTypes.columnLayout) {
            downloadDXF(generateColumnLayoutDXF(filtCols, filtSlabs), `${projectName}_${floorCode}_columns.dxf`);
          }
          downloadDXF(generateStructuralDXF(filtSlabs, filtBeams, filtCols), `${projectName}_${floorCode}_structural.dxf`);
        }
      }

      // Building elevation (once for all stories, not per-floor)
      if ((format === 'pdf' || format === 'both') && drawingTypes.buildingElevation) {
        // Building elevation uses ALL stories — generated via constructionSheets with all elements
        const allFilteredSlabs = slabs.filter(s => !s.storyId || selectedFloors.includes(s.storyId));
        const allFilteredBeams = beams.filter(b => !b.storyId || selectedFloors.includes(b.storyId));
        const allFilteredCols = columns.filter(c => !c.storyId || selectedFloors.includes(c.storyId));
        exportStructuralDrawingPDF(allFilteredSlabs, allFilteredBeams, allFilteredCols, sheetSize === 'A1' ? 'A3' : sheetSize, projectName);
      }

      // Total BBS for all selected floors combined
      if ((format === 'pdf' || format === 'both') && drawingTypes.bbs && selectedFloors.length > 1) {
        const allFilteredBeams = beams.filter(b => !b.storyId || selectedFloors.includes(b.storyId));
        const allFilteredCols = columns.filter(c => !c.storyId || selectedFloors.includes(c.storyId));
        const allFilteredSlabs = slabs.filter(s => !s.storyId || selectedFloors.includes(s.storyId));
        const allFilteredBeamDesigns = beamDesigns.filter((d: any) => allFilteredBeams.some(b => b.id === d.beamId));
        const allFilteredColDesigns = colDesigns.filter((c: any) => allFilteredCols.some(col => col.id === c.id));
        const allFilteredSlabDesigns = slabDesigns.filter((s: any) => allFilteredSlabs.some(sl => sl.id === s.id));
        const totalBbs = generateBBS(allFilteredBeams, allFilteredCols, allFilteredSlabs, allFilteredBeamDesigns, allFilteredColDesigns, allFilteredSlabDesigns);
        exportBBSToPDF(totalBbs, `${projectName}_BBS_Total`);
      }
    } finally {
      setExporting(false);
    }
  };

  const selectedCount = selectedFloors.length;
  const anyDrawingSelected = Object.values(drawingTypes).some(Boolean);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Download size={16} /> تصدير اللوحات الإنشائية
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Floor selector */}
        <div>
          <p className="text-xs font-medium mb-2">اختر الأدوار:</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={toggleAll} className={`px-2 py-1 rounded border text-[11px] transition-colors ${allSelected ? 'bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}>
              جميع الأدوار ({stories.length})
            </button>
            {stories.map((s, i) => {
              const fc = getFloorCode(s.label, i);
              const counts = floorCounts[s.id];
              const isSelected = selectedFloors.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleFloor(s.id)}
                  className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 transition-colors ${isSelected ? 'bg-primary/10 border-primary text-primary' : 'border-border hover:bg-muted'}`}
                  title={counts ? `جسور: ${counts.beams} | أعمدة: ${counts.cols} | بلاطات: ${counts.slabs}` : ''}
                >
                  {isSelected && <span className="text-primary">✓</span>}
                  {s.label} ({fc})
                </button>
              );
            })}
          </div>
          {selectedCount > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              تم اختيار {selectedCount} دور — سيتم إنشاء لوحات منفصلة لكل دور
            </p>
          )}
        </div>

        {/* Drawing types */}
        <div>
          <p className="text-xs font-medium mb-2">نوع اللوحات:</p>
          <div className="grid grid-cols-2 gap-1">
            {([
              ['beamLayout', 'مخطط الجسور + المقاطع', 'لوحة تفصيلية لتوزيع الجسور وجدول التسليح'],
              ['columnLayout', 'مخطط الأعمدة + المقاطع', 'لوحة تفصيلية لتوزيع الأعمدة وجدول التسليح'],
              ['slabPlan', 'مخطط تسليح البلاطات', 'توزيع حديد البلاطات بالاتجاهين'],
              ['generalNotes', 'لوحة الملاحظات العامة', 'ملاحظات التنفيذ وجدول أطوال التماسك'],
              ['bbs', 'جدول حصر الحديد (BBS)', 'حصر لكل دور + إجمالي المشروع'],
              ['beamElevation', 'مقطع طولي للجسور', 'رسم تفصيلي للتسليح الطولي والكانات'],
              ['buildingElevation', 'مقطع المبنى', 'القطاع الرأسي لكامل المبنى'],
            ] as [string, string, string][]).map(([key, label, desc]) => (
              <label key={key} className="flex items-center gap-2 text-[11px] cursor-pointer p-1 rounded hover:bg-muted/50" title={desc}>
                <Checkbox
                  checked={(drawingTypes as any)[key]}
                  onCheckedChange={(v) => setDrawingTypes(p => ({ ...p, [key]: !!v }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Format & Sheet size */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-medium mb-1">الصيغة:</p>
            <div className="flex gap-1 flex-wrap">
              {(['pdf', 'dxf', 'print', 'both'] as const).map(f => (
                <button key={f} onClick={() => setFormat(f)} className={`px-2 py-1 rounded border text-[11px] uppercase transition-colors ${format === f ? 'bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}>
                  {f === 'both' ? 'كلاهما' : f === 'print' ? '🖨️ طباعة' : f}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium mb-1">حجم اللوحة:</p>
            <div className="flex gap-1">
              {(['A3', 'A4', 'A1'] as const).map(s => (
                <button key={s} onClick={() => setSheetSize(s)} className={`px-2 py-1 rounded border text-[11px] transition-colors ${sheetSize === s ? 'bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Export summary */}
        {selectedCount > 0 && anyDrawingSelected && (
          <div className="bg-muted/50 rounded p-2 text-[11px] space-y-1">
            <p className="font-medium">ملخص التصدير:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
              {selectedFloors.map(fid => {
                const story = stories.find(s => s.id === fid);
                const idx = stories.findIndex(s => s.id === fid);
                return story ? (
                  <li key={fid}>
                    {story.label} ({getFloorCode(story.label, idx)})
                    {' — '}
                    {drawingTypes.beamLayout && 'جسور، '}
                    {drawingTypes.columnLayout && 'أعمدة، '}
                    {drawingTypes.slabPlan && 'بلاطات، '}
                    {drawingTypes.beamElevation && 'مقاطع طولية، '}
                    {drawingTypes.bbs && 'BBS'}
                  </li>
                ) : null;
              })}
              {drawingTypes.buildingElevation && <li>مقطع المبنى الكامل (S-EL-01)</li>}
              {drawingTypes.bbs && selectedCount > 1 && <li>جدول حصر إجمالي للمشروع</li>}
            </ul>
          </div>
        )}

        {!analyzed && (
          <div className="flex items-center gap-2 text-amber-600 text-[11px] bg-amber-50 rounded p-2">
            <AlertCircle size={14} />
            يجب تشغيل التحليل أولاً قبل التصدير
          </div>
        )}

        <Button
          className="w-full min-h-[44px]"
          disabled={!analyzed || selectedCount === 0 || !anyDrawingSelected || exporting}
          onClick={handleExport}
        >
          <Download size={16} className="mr-2" />
          {exporting ? 'جاري التصدير...' : `إنشاء وتحميل لوحات ${selectedCount} دور`}
        </Button>
      </CardContent>
    </Card>
  );
}
