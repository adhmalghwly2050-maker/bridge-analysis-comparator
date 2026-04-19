/**
 * ETABS Full Import Panel
 * Import nodes, beams, columns, slabs from Excel files exported from ETABS.
 * Provides preview of imported data and an "Apply to Model" button.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Upload, Eye, Check, MapPin, Columns, LayoutGrid, Maximize } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { Slab, Beam, Column, Story } from '@/lib/structuralEngine';

export interface ImportedNode {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface ImportedBeam {
  id: string;
  story: string;
  nodeI: string;
  nodeJ: string;
  section?: string;
}

export interface ImportedColumn {
  id: string;
  story: string;
  nodeI: string;
  nodeJ: string;
  section?: string;
}

export interface ImportedSlab {
  id: string;
  story: string;
  nodes: string[];
  thickness?: number;
}

export interface ETABSImportedData {
  nodes: ImportedNode[];
  beams: ImportedBeam[];
  columns: ImportedColumn[];
  slabs: ImportedSlab[];
}

interface ETABSFullImportPanelProps {
  onApply: (data: ETABSImportedData) => void;
}

function parseExcel(file: File): Promise<any[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        resolve(jsonData);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export default function ETABSFullImportPanel({ onApply }: ETABSFullImportPanelProps) {
  const [nodes, setNodes] = useState<ImportedNode[]>([]);
  const [beams, setBeams] = useState<ImportedBeam[]>([]);
  const [columns, setColumns] = useState<ImportedColumn[]>([]);
  const [slabs, setSlabs] = useState<ImportedSlab[]>([]);
  const [activePreview, setActivePreview] = useState<'nodes' | 'beams' | 'columns' | 'slabs' | null>(null);
  const [importStatus, setImportStatus] = useState<Record<string, string>>({});

  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImportType, setPendingImportType] = useState<string>('');

  const handleFileSelect = useCallback(async (type: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const rows = await parseExcel(file);
      if (rows.length < 2) {
        setImportStatus(prev => ({ ...prev, [type]: 'ملف فارغ' }));
        return;
      }

      const headers = rows[0].map((h: any) => String(h).trim().toLowerCase());

      if (type === 'nodes') {
        // Expected: Joint/Point, X, Y, Z
        const imported: ImportedNode[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 3) continue;
          imported.push({
            id: String(row[0] || `N${i}`),
            x: Number(row[1]) || 0,
            y: Number(row[2]) || 0,
            z: Number(row[3]) || 0,
          });
        }
        setNodes(imported);
        setImportStatus(prev => ({ ...prev, nodes: `تم استيراد ${imported.length} نقطة` }));
      } else if (type === 'beams') {
        // Expected: Name, Story, JointI, JointJ, Section
        const imported: ImportedBeam[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 4) continue;
          imported.push({
            id: String(row[0] || `B${i}`),
            story: String(row[1] || ''),
            nodeI: String(row[2] || ''),
            nodeJ: String(row[3] || ''),
            section: row[4] ? String(row[4]) : undefined,
          });
        }
        setBeams(imported);
        setImportStatus(prev => ({ ...prev, beams: `تم استيراد ${imported.length} جسر` }));
      } else if (type === 'columns') {
        // Expected: Name, Story, JointI, JointJ, Section
        const imported: ImportedColumn[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 4) continue;
          imported.push({
            id: String(row[0] || `C${i}`),
            story: String(row[1] || ''),
            nodeI: String(row[2] || ''),
            nodeJ: String(row[3] || ''),
            section: row[4] ? String(row[4]) : undefined,
          });
        }
        setColumns(imported);
        setImportStatus(prev => ({ ...prev, columns: `تم استيراد ${imported.length} عمود` }));
      } else if (type === 'slabs') {
        // Expected: Name, Story, Node1, Node2, Node3, Node4, Thickness
        const imported: ImportedSlab[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length < 5) continue;
          const slabNodes: string[] = [];
          for (let j = 2; j < Math.min(row.length, 6); j++) {
            if (row[j]) slabNodes.push(String(row[j]));
          }
          imported.push({
            id: String(row[0] || `SL${i}`),
            story: String(row[1] || ''),
            nodes: slabNodes,
            thickness: row[6] ? Number(row[6]) : undefined,
          });
        }
        setSlabs(imported);
        setImportStatus(prev => ({ ...prev, slabs: `تم استيراد ${imported.length} بلاطة` }));
      }
    } catch (err) {
      setImportStatus(prev => ({ ...prev, [type]: 'خطأ في قراءة الملف' }));
    }

    // Reset file input
    if (e.target) e.target.value = '';
  }, []);

  const triggerImport = (type: string) => {
    setPendingImportType(type);
    setTimeout(() => fileRef.current?.click(), 100);
  };

  const totalImported = nodes.length + beams.length + columns.length + slabs.length;
  const canApply = nodes.length > 0 && (beams.length > 0 || columns.length > 0 || slabs.length > 0);

  const handleApply = () => {
    onApply({ nodes, beams, columns, slabs });
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => handleFileSelect(pendingImportType, e)}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload size={16} /> استيراد من ETABS
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            استورد بيانات النموذج من ملفات Excel المصدّرة من ETABS. كل زر يستورد نوع عنصر محدد.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="min-h-[44px] gap-2 text-xs" onClick={() => triggerImport('nodes')}>
              <MapPin size={14} /> استيراد النقاط (Nodes)
            </Button>
            <Button variant="outline" className="min-h-[44px] gap-2 text-xs" onClick={() => triggerImport('beams')}>
              <Maximize size={14} /> استيراد الجسور (Beams)
            </Button>
            <Button variant="outline" className="min-h-[44px] gap-2 text-xs" onClick={() => triggerImport('columns')}>
              <Columns size={14} /> استيراد الأعمدة (Columns)
            </Button>
            <Button variant="outline" className="min-h-[44px] gap-2 text-xs" onClick={() => triggerImport('slabs')}>
              <LayoutGrid size={14} /> استيراد البلاطات (Slabs)
            </Button>
          </div>

          {/* Import status */}
          {Object.entries(importStatus).length > 0 && (
            <div className="space-y-1 bg-muted/50 rounded p-2">
              {Object.entries(importStatus).map(([key, msg]) => (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px]">{key}</Badge>
                  <span>{msg}</span>
                </div>
              ))}
            </div>
          )}

          {/* Preview buttons */}
          {totalImported > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-muted-foreground self-center ml-1">معاينة:</span>
              {nodes.length > 0 && (
                <Button size="sm" variant={activePreview === 'nodes' ? 'default' : 'ghost'} className="h-7 text-xs"
                  onClick={() => setActivePreview(activePreview === 'nodes' ? null : 'nodes')}>
                  <Eye size={12} className="mr-1" /> النقاط ({nodes.length})
                </Button>
              )}
              {beams.length > 0 && (
                <Button size="sm" variant={activePreview === 'beams' ? 'default' : 'ghost'} className="h-7 text-xs"
                  onClick={() => setActivePreview(activePreview === 'beams' ? null : 'beams')}>
                  <Eye size={12} className="mr-1" /> الجسور ({beams.length})
                </Button>
              )}
              {columns.length > 0 && (
                <Button size="sm" variant={activePreview === 'columns' ? 'default' : 'ghost'} className="h-7 text-xs"
                  onClick={() => setActivePreview(activePreview === 'columns' ? null : 'columns')}>
                  <Eye size={12} className="mr-1" /> الأعمدة ({columns.length})
                </Button>
              )}
              {slabs.length > 0 && (
                <Button size="sm" variant={activePreview === 'slabs' ? 'default' : 'ghost'} className="h-7 text-xs"
                  onClick={() => setActivePreview(activePreview === 'slabs' ? null : 'slabs')}>
                  <Eye size={12} className="mr-1" /> البلاطات ({slabs.length})
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Tables */}
      {activePreview === 'nodes' && nodes.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">معاينة النقاط المستوردة</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto max-h-64 overflow-y-auto">
            <Table>
              <TableHeader><TableRow>
                {['المعرف', 'X', 'Y', 'Z'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {nodes.slice(0, 100).map(n => (
                  <TableRow key={n.id}>
                    <TableCell className="font-mono text-xs">{n.id}</TableCell>
                    <TableCell className="font-mono text-xs">{n.x.toFixed(3)}</TableCell>
                    <TableCell className="font-mono text-xs">{n.y.toFixed(3)}</TableCell>
                    <TableCell className="font-mono text-xs">{n.z.toFixed(3)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {nodes.length > 100 && <p className="text-xs text-muted-foreground mt-1">... و {nodes.length - 100} نقطة أخرى</p>}
          </CardContent>
        </Card>
      )}

      {activePreview === 'beams' && beams.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">معاينة الجسور المستوردة</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto max-h-64 overflow-y-auto">
            <Table>
              <TableHeader><TableRow>
                {['الاسم', 'الدور', 'نقطة I', 'نقطة J', 'المقطع'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {beams.slice(0, 100).map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.id}</TableCell>
                    <TableCell className="text-xs">{b.story}</TableCell>
                    <TableCell className="font-mono text-xs">{b.nodeI}</TableCell>
                    <TableCell className="font-mono text-xs">{b.nodeJ}</TableCell>
                    <TableCell className="text-xs">{b.section || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activePreview === 'columns' && columns.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">معاينة الأعمدة المستوردة</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto max-h-64 overflow-y-auto">
            <Table>
              <TableHeader><TableRow>
                {['الاسم', 'الدور', 'نقطة I', 'نقطة J', 'المقطع'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {columns.slice(0, 100).map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.id}</TableCell>
                    <TableCell className="text-xs">{c.story}</TableCell>
                    <TableCell className="font-mono text-xs">{c.nodeI}</TableCell>
                    <TableCell className="font-mono text-xs">{c.nodeJ}</TableCell>
                    <TableCell className="text-xs">{c.section || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activePreview === 'slabs' && slabs.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">معاينة البلاطات المستوردة</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto max-h-64 overflow-y-auto">
            <Table>
              <TableHeader><TableRow>
                {['الاسم', 'الدور', 'النقاط', 'السماكة'].map(h => <TableHead key={h} className="text-xs">{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {slabs.slice(0, 100).map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.id}</TableCell>
                    <TableCell className="text-xs">{s.story}</TableCell>
                    <TableCell className="font-mono text-xs">{s.nodes.join(', ')}</TableCell>
                    <TableCell className="font-mono text-xs">{s.thickness || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 3D Preview placeholder */}
      {totalImported > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">معاينة النموذج المستورد</CardTitle></CardHeader>
          <CardContent>
            <div className="bg-muted/30 rounded border border-border p-4 min-h-[200px] flex flex-col items-center justify-center">
              <div className="text-xs text-muted-foreground space-y-1 text-center">
                <p>النقاط: {nodes.length} | الجسور: {beams.length} | الأعمدة: {columns.length} | البلاطات: {slabs.length}</p>
                {nodes.length > 0 && (
                  <div className="mt-3 relative w-full h-48 border border-border rounded bg-background overflow-hidden">
                    <svg viewBox={`${Math.min(...nodes.map(n => n.x)) - 1} ${Math.min(...nodes.map(n => n.y)) - 1} ${Math.max(...nodes.map(n => n.x)) - Math.min(...nodes.map(n => n.x)) + 2} ${Math.max(...nodes.map(n => n.y)) - Math.min(...nodes.map(n => n.y)) + 2}`} className="w-full h-full">
                      {/* Draw beams */}
                      {beams.map(b => {
                        const ni = nodes.find(n => n.id === b.nodeI);
                        const nj = nodes.find(n => n.id === b.nodeJ);
                        if (!ni || !nj) return null;
                        return <line key={b.id} x1={ni.x} y1={ni.y} x2={nj.x} y2={nj.y} stroke="hsl(var(--primary))" strokeWidth="0.05" />;
                      })}
                      {/* Draw columns */}
                      {columns.map(c => {
                        const ni = nodes.find(n => n.id === c.nodeI);
                        if (!ni) return null;
                        return <rect key={c.id} x={ni.x - 0.15} y={ni.y - 0.15} width="0.3" height="0.3" fill="hsl(var(--destructive))" opacity="0.7" />;
                      })}
                      {/* Draw nodes */}
                      {nodes.map(n => (
                        <circle key={n.id} cx={n.x} cy={n.y} r="0.08" fill="hsl(var(--foreground))" />
                      ))}
                    </svg>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Apply button */}
      {canApply && (
        <Button className="w-full min-h-[44px] gap-2" onClick={handleApply}>
          <Check size={16} /> تطبيق على النمذجة الرئيسية
        </Button>
      )}
    </div>
  );
}
