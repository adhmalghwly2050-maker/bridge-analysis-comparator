/**
 * Bill of Quantities (BOQ) Panel
 * Part 1: Concrete volumes (m³) per element type
 * Part 2: Steel weights (ton) per diameter per element type
 */

import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Layers } from 'lucide-react';
import type { Story, Slab, Beam, Column, SlabProps, FlexureResult, ShearResult, ColumnResult } from '@/lib/structuralEngine';

interface BeamDesignData {
  beamId: string;
  flexLeft: FlexureResult;
  flexMid: FlexureResult;
  flexRight: FlexureResult;
  shear: ShearResult;
  span: number;
}

interface ColDesignData {
  id: string;
  b: number; h: number; L: number;
  design: ColumnResult;
}

interface SlabDesignData {
  id: string;
  x1: number; y1: number; x2: number; y2: number;
  design: {
    hUsed: number;
    shortDir: { bars: number; dia: number; spacing: number };
    longDir: { bars: number; dia: number; spacing: number };
    lx: number; ly: number;
  };
}

interface BOQPanelProps {
  stories: Story[];
  slabs: Slab[];
  beams: Beam[];
  columns: Column[];
  beamDesigns: BeamDesignData[];
  colDesigns: ColDesignData[];
  slabDesigns: SlabDesignData[];
  slabProps: SlabProps;
  analyzed: boolean;
}

// Weight per meter for rebar (kg/m) = dia² / 162.2
function rebarWeightPerMeter(dia: number): number {
  return (dia * dia) / 162.2;
}

export default function BOQPanel({
  stories, slabs, beams, columns, beamDesigns, colDesigns, slabDesigns, slabProps, analyzed,
}: BOQPanelProps) {

  // =================== CONCRETE VOLUMES ===================
  const concreteData = useMemo(() => {
    // Slabs: area × thickness (convert mm to m)
    let slabVolume = 0;
    for (const s of slabs) {
      const area = Math.abs(s.x2 - s.x1) * Math.abs(s.y2 - s.y1); // m²
      const thickness = slabProps.thickness / 1000; // mm → m
      slabVolume += area * thickness;
    }
    // Multiply by number of stories if slabs are shared
    slabVolume *= stories.length > 0 ? Math.max(stories.length, 1) : 1;

    // Beams: b × h × length (mm → m)
    let beamVolume = 0;
    for (const b of beams) {
      const length = b.length; // already in meters
      const bm = b.b / 1000; // mm → m
      const hm = b.h / 1000;
      // Subtract slab thickness from beam height to avoid double counting
      const effectiveH = Math.max(hm - slabProps.thickness / 1000, hm * 0.5);
      beamVolume += bm * effectiveH * length;
    }

    // Columns: b × h × L (mm → m)
    let colVolume = 0;
    for (const c of columns) {
      if (c.isRemoved) continue;
      const bm = c.b / 1000;
      const hm = c.h / 1000;
      const Lm = c.L / 1000;
      colVolume += bm * hm * Lm;
    }
    // Multiply columns by stories
    colVolume *= stories.length > 0 ? Math.max(stories.length, 1) : 1;

    const total = slabVolume + beamVolume + colVolume;

    return { slabVolume, beamVolume, colVolume, total };
  }, [slabs, beams, columns, slabProps, stories]);

  // =================== STEEL QUANTITIES ===================
  const steelData = useMemo(() => {
    if (!analyzed) return null;

    // Collect all diameters used
    const diaSet = new Set<number>();
    // Per element type: { [dia]: totalWeight_kg }
    const beamSteel: Record<number, number> = {};
    const colSteel: Record<number, number> = {};
    const slabSteel: Record<number, number> = {};

    // Helper to add weight
    const addWeight = (target: Record<number, number>, dia: number, lengthM: number, qty: number = 1) => {
      diaSet.add(dia);
      const w = rebarWeightPerMeter(dia) * lengthM * qty;
      target[dia] = (target[dia] || 0) + w;
    };

    // Beams steel
    for (const d of beamDesigns) {
      const beam = beams.find(b => b.id === d.beamId);
      if (!beam) continue;
      const spanM = d.span || beam.length;

      // Top bars (left and right zones ~ span/4 each)
      if (d.flexLeft?.dia) {
        addWeight(beamSteel, d.flexLeft.dia, spanM * 0.4, d.flexLeft.bars);
      }
      if (d.flexRight?.dia) {
        addWeight(beamSteel, d.flexRight.dia, spanM * 0.4, d.flexRight.bars);
      }
      // Bottom bars (full span + anchorage)
      if (d.flexMid?.dia) {
        addWeight(beamSteel, d.flexMid.dia, spanM + 0.6, d.flexMid.bars);
      }
      // Stirrups
      if (d.shear?.sUsed && d.shear.sUsed > 0) {
        const stirrupDia = 10; // default stirrup dia
        const numStirrups = Math.ceil((spanM * 1000) / d.shear.sUsed);
        const perimeterM = 2 * ((beam.b - 80) / 1000 + (beam.h - 80) / 1000) + 0.2; // perimeter + hooks
        const legs = d.shear.stirrupLegs || 2;
        addWeight(beamSteel, stirrupDia, perimeterM * legs / 2, numStirrups);
      }
    }

    // Multiply beam steel by stories
    const storyMultiplier = stories.length > 0 ? Math.max(stories.length, 1) : 1;
    for (const dia of Object.keys(beamSteel)) {
      beamSteel[Number(dia)] *= storyMultiplier;
    }

    // Column steel
    for (const c of colDesigns) {
      if (!c.design) continue;
      const Lm = c.L / 1000;
      // Main bars
      if (c.design.dia && c.design.bars) {
        addWeight(colSteel, c.design.dia, Lm + 0.8, c.design.bars); // +0.8 for lap splice
      }
      // Stirrups (parse from string like "Φ8@200")
      const stirMatch = c.design.stirrups?.match(/Φ(\d+)@(\d+)/);
      if (stirMatch) {
        const sDia = parseInt(stirMatch[1]);
        const sSpacing = parseInt(stirMatch[2]);
        const numStirrups = Math.ceil((Lm * 1000) / sSpacing);
        const perimeterM = 2 * ((c.b - 80) / 1000 + (c.h - 80) / 1000) + 0.2;
        addWeight(colSteel, sDia, perimeterM, numStirrups);
      }
    }
    // Multiply column steel by stories
    for (const dia of Object.keys(colSteel)) {
      colSteel[Number(dia)] *= storyMultiplier;
    }

    // Slab steel
    for (const s of slabDesigns) {
      if (!s.design) continue;
      const lx = s.design.lx; // m
      const ly = s.design.ly; // m
      const area = lx * ly;

      // Short direction bars
      if (s.design.shortDir?.dia) {
        const spacing = s.design.shortDir.spacing / 1000; // mm → m
        const numBars = spacing > 0 ? Math.ceil(ly / spacing) : s.design.shortDir.bars;
        addWeight(slabSteel, s.design.shortDir.dia, lx + 0.3, numBars); // +0.3 for anchorage
      }
      // Long direction bars
      if (s.design.longDir?.dia) {
        const spacing = s.design.longDir.spacing / 1000;
        const numBars = spacing > 0 ? Math.ceil(lx / spacing) : s.design.longDir.bars;
        addWeight(slabSteel, s.design.longDir.dia, ly + 0.3, numBars);
      }
    }
    // Multiply slab steel by stories
    for (const dia of Object.keys(slabSteel)) {
      slabSteel[Number(dia)] *= storyMultiplier;
    }

    // Merge all diameters
    const allDias = Array.from(diaSet).sort((a, b) => a - b);

    // Compute totals per element
    const beamTotal = Object.values(beamSteel).reduce((a, b) => a + b, 0);
    const colTotal = Object.values(colSteel).reduce((a, b) => a + b, 0);
    const slabTotal = Object.values(slabSteel).reduce((a, b) => a + b, 0);

    // Per-diameter totals
    const diaTotals: Record<number, number> = {};
    for (const dia of allDias) {
      diaTotals[dia] = (beamSteel[dia] || 0) + (colSteel[dia] || 0) + (slabSteel[dia] || 0);
    }

    const grandTotal = beamTotal + colTotal + slabTotal;

    return { allDias, beamSteel, colSteel, slabSteel, beamTotal, colTotal, slabTotal, diaTotals, grandTotal };
  }, [analyzed, beamDesigns, colDesigns, slabDesigns, beams, stories, slabs]);

  return (
    <div className="space-y-6">
      {/* Part 1: Concrete Quantities */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers size={16} /> جدول كميات الخرسانة
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">العنصر</TableHead>
                <TableHead className="text-xs">الوحدة</TableHead>
                <TableHead className="text-xs">الكمية</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="text-xs font-medium">البلاطات</TableCell>
                <TableCell className="text-xs">م³</TableCell>
                <TableCell className="font-mono text-xs font-bold">{concreteData.slabVolume.toFixed(2)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-xs font-medium">الجسور</TableCell>
                <TableCell className="text-xs">م³</TableCell>
                <TableCell className="font-mono text-xs font-bold">{concreteData.beamVolume.toFixed(2)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-xs font-medium">الأعمدة</TableCell>
                <TableCell className="text-xs">م³</TableCell>
                <TableCell className="font-mono text-xs font-bold">{concreteData.colVolume.toFixed(2)}</TableCell>
              </TableRow>
              <TableRow className="bg-muted/50 font-bold">
                <TableCell className="text-xs font-bold">الإجمالي</TableCell>
                <TableCell className="text-xs">م³</TableCell>
                <TableCell className="font-mono text-xs font-bold text-primary">{concreteData.total.toFixed(2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Part 2: Steel Quantities */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers size={16} /> جدول كميات حديد التسليح
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!analyzed || !steelData ? (
            <p className="text-xs text-muted-foreground text-center py-4">يجب تشغيل التحليل أولاً لحساب كميات الحديد</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">العنصر</TableHead>
                  {steelData.allDias.map(dia => (
                    <TableHead key={dia} className="text-xs text-center">Φ{dia} (طن)</TableHead>
                  ))}
                  <TableHead className="text-xs text-center font-bold">الإجمالي (طن)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs font-medium">الجسور</TableCell>
                  {steelData.allDias.map(dia => (
                    <TableCell key={dia} className="font-mono text-xs text-center">
                      {((steelData.beamSteel[dia] || 0) / 1000).toFixed(3)}
                    </TableCell>
                  ))}
                  <TableCell className="font-mono text-xs text-center font-bold">
                    {(steelData.beamTotal / 1000).toFixed(3)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs font-medium">الأعمدة</TableCell>
                  {steelData.allDias.map(dia => (
                    <TableCell key={dia} className="font-mono text-xs text-center">
                      {((steelData.colSteel[dia] || 0) / 1000).toFixed(3)}
                    </TableCell>
                  ))}
                  <TableCell className="font-mono text-xs text-center font-bold">
                    {(steelData.colTotal / 1000).toFixed(3)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs font-medium">البلاطات</TableCell>
                  {steelData.allDias.map(dia => (
                    <TableCell key={dia} className="font-mono text-xs text-center">
                      {((steelData.slabSteel[dia] || 0) / 1000).toFixed(3)}
                    </TableCell>
                  ))}
                  <TableCell className="font-mono text-xs text-center font-bold">
                    {(steelData.slabTotal / 1000).toFixed(3)}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell className="text-xs font-bold">الإجمالي</TableCell>
                  {steelData.allDias.map(dia => (
                    <TableCell key={dia} className="font-mono text-xs text-center font-bold text-primary">
                      {((steelData.diaTotals[dia] || 0) / 1000).toFixed(3)}
                    </TableCell>
                  ))}
                  <TableCell className="font-mono text-xs text-center font-bold text-primary">
                    {(steelData.grandTotal / 1000).toFixed(3)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
