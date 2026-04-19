/**
 * Automatic Drawing Generator
 * Generates structural drawings from the model automatically
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Slab, Column, Beam, FlexureResult, ShearResult, ColumnResult, SlabDesignResult } from '@/lib/structuralEngine';

interface BeamDesignData {
  beamId: string;
  flexLeft: FlexureResult;
  flexMid: FlexureResult;
  flexRight: FlexureResult;
  shear: ShearResult;
}

interface ColDesignData {
  id: string;
  b: number; h: number;
  design: ColumnResult;
}

interface SlabDesignData {
  id: string;
  design: SlabDesignResult;
}

// =================== HELPER FUNCTIONS ===================

function drawTitleBlock(doc: jsPDF, x: number, y: number, w: number, h: number, config: {
  title: string; projectName: string; drawingNo: string; scale: string; date: string;
}) {
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, h);
  doc.line(x, y + h / 3, x + w, y + h / 3);
  doc.line(x, y + 2 * h / 3, x + w, y + 2 * h / 3);
  doc.line(x + w / 2, y, x + w / 2, y + h);

  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');
  doc.text(config.projectName, x + 2, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.text(config.title, x + 2, y + h / 3 + 4);
  doc.text(`Date: ${config.date}`, x + 2, y + 2 * h / 3 + 4);
  doc.text(`Scale: ${config.scale}`, x + w / 2 + 2, y + 4);
  doc.text(`Dwg: ${config.drawingNo}`, x + w / 2 + 2, y + h / 3 + 4);
}

// =================== BEAM REINFORCEMENT DRAWINGS ===================

function drawBeamSection(
  doc: jsPDF, cx: number, cy: number, 
  b: number, h: number,
  topBars: number, topDia: number,
  botBars: number, botDia: number,
  stirrups: string,
  label: string,
  sectionScale: number = 0.15
) {
  const sw = b * sectionScale;
  const sh = h * sectionScale;
  const ox = cx - sw / 2;
  const oy = cy - sh / 2;
  const cover = 40 * sectionScale;

  // Section outline
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.rect(ox, oy, sw, sh);

  // Top bars
  const barR = topDia * sectionScale * 0.5;
  for (let i = 0; i < topBars; i++) {
    const spacing = (sw - 2 * cover) / Math.max(topBars - 1, 1);
    const bx = ox + cover + i * spacing;
    const by = oy + cover;
    doc.setFillColor(0, 0, 0);
    (doc as any).circle(bx, by, barR, 'F');
  }

  // Bottom bars
  for (let i = 0; i < botBars; i++) {
    const spacing = (sw - 2 * cover) / Math.max(botBars - 1, 1);
    const bx = ox + cover + i * spacing;
    const by = oy + sh - cover;
    doc.setFillColor(0, 0, 0);
    (doc as any).circle(bx, by, barR, 'F');
  }

  // Stirrup outline
  doc.setDrawColor(0, 0, 200);
  doc.setLineWidth(0.15);
  doc.rect(ox + cover * 0.6, oy + cover * 0.6, sw - cover * 1.2, sh - cover * 1.2);

  // Labels
  doc.setFontSize(5);
  doc.setTextColor(0);
  doc.text(label, cx - 5, oy - 3);
  doc.text(`${b}×${h}mm`, cx - 5, oy + sh + 5);
  doc.text(`T: ${topBars}Φ${topDia}`, cx - 8, oy + sh + 9);
  doc.text(`B: ${botBars}Φ${botDia}`, cx - 8, oy + sh + 13);
  doc.text(stirrups, cx - 8, oy + sh + 17);
}

// =================== COLUMN REINFORCEMENT DRAWINGS ===================

function drawColumnSection(
  doc: jsPDF, cx: number, cy: number,
  b: number, h: number,
  bars: number, dia: number,
  stirrups: string,
  label: string,
  sectionScale: number = 0.12
) {
  const sw = b * sectionScale;
  const sh = h * sectionScale;
  const ox = cx - sw / 2;
  const oy = cy - sh / 2;
  const cover = 40 * sectionScale;

  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.rect(ox, oy, sw, sh);

  // Bar positions (corners + distributed)
  const positions: [number, number][] = [];
  positions.push([ox + cover, oy + cover]);
  positions.push([ox + sw - cover, oy + cover]);
  positions.push([ox + sw - cover, oy + sh - cover]);
  positions.push([ox + cover, oy + sh - cover]);

  const remaining = bars - 4;
  if (remaining > 0) {
    const perSide = Math.ceil(remaining / 2);
    for (let i = 1; i <= perSide; i++) {
      const dy = oy + cover + i * (sh - 2 * cover) / (perSide + 1);
      positions.push([ox + cover, dy]);
      if (positions.length < bars) positions.push([ox + sw - cover, dy]);
    }
  }

  const barR = dia * sectionScale * 0.5;
  for (let i = 0; i < Math.min(bars, positions.length); i++) {
    doc.setFillColor(0, 0, 0);
    (doc as any).circle(positions[i][0], positions[i][1], barR, 'F');
  }

  // Stirrup
  doc.setDrawColor(0, 0, 200);
  doc.setLineWidth(0.15);
  doc.rect(ox + cover * 0.6, oy + cover * 0.6, sw - cover * 1.2, sh - cover * 1.2);

  doc.setFontSize(5);
  doc.setTextColor(0);
  doc.text(label, cx - 4, oy - 3);
  doc.text(`${b}×${h}`, cx - 4, oy + sh + 5);
  doc.text(`${bars}Φ${dia}`, cx - 4, oy + sh + 9);
  doc.text(stirrups, cx - 6, oy + sh + 13);
}

// =================== MAIN GENERATOR ===================

export function generateAutoDrawings(
  slabs: Slab[],
  beams: Beam[],
  columns: Column[],
  beamDesigns: BeamDesignData[],
  colDesigns: ColDesignData[],
  slabDesigns: SlabDesignData[],
  projectName: string = 'Structural Design Studio',
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [420, 297] });

  // Calculate layout areas
  const allX = slabs.flatMap(s => [s.x1, s.x2]);
  const allY = slabs.flatMap(s => [s.y1, s.y2]);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const modelW = maxX - minX;
  const modelH = maxY - minY;

  // Use left ~55% of sheet for plan, leave right for sections
  const planDrawableW = 200;
  const planDrawableH = 240;
  const mmPerM = Math.min(planDrawableW / modelW, planDrawableH / modelH);
  const planOffsetX = 15 + (planDrawableW - modelW * mmPerM) / 2;
  const planOffsetY = 15 + (planDrawableH - modelH * mmPerM) / 2;
  const tx = (x: number) => (x - minX) * mmPerM + planOffsetX;
  const ty = (y: number) => (maxY - y + minY) * mmPerM + planOffsetY;

  // ========== SHEET 1: BEAM LAYOUT PLAN ==========
  // Plan view (left side)
  doc.setDrawColor(200);
  doc.setLineWidth(0.1);
  const gridX = [...new Set(allX)].sort((a, b) => a - b);
  const gridY = [...new Set(allY)].sort((a, b) => a - b);
  for (const x of gridX) {
    doc.line(tx(x), ty(minY - 0.3), tx(x), ty(maxY + 0.3));
    doc.setFontSize(5);
    doc.text(`${x}`, tx(x) - 1.5, ty(maxY + 0.3) - 2);
  }
  for (const y of gridY) {
    doc.line(tx(minX - 0.3), ty(y), tx(maxX + 0.3), ty(y));
    doc.text(`${y}`, tx(minX - 0.3) - 4, ty(y) + 0.5);
  }

  // Beams
  doc.setDrawColor(0, 130, 0);
  doc.setLineWidth(0.4);
  for (const b of beams) {
    doc.line(tx(b.x1), ty(b.y1), tx(b.x2), ty(b.y2));
    doc.setFontSize(4);
    doc.setTextColor(0, 80, 0);
    doc.text(`${b.id} ${b.b}x${b.h}`, tx((b.x1 + b.x2) / 2) - 3, ty((b.y1 + b.y2) / 2) - 1);
  }

  // Columns
  doc.setTextColor(0);
  for (const c of columns) {
    if (c.isRemoved) continue;
    const hw = (c.b / 1000) * mmPerM / 2;
    const hh = (c.h / 1000) * mmPerM / 2;
    doc.setFillColor(180, 0, 0);
    doc.rect(tx(c.x) - hw, ty(c.y) - hh, hw * 2, hh * 2, 'F');
    doc.setFontSize(3.5);
    doc.text(c.id, tx(c.x) - 2, ty(c.y) + hh + 3);
  }

  // Beam sections (right side)
  const sectStartX = 230;
  let sectY = 25;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('BEAM REINFORCEMENT SECTIONS', sectStartX, sectY);
  sectY += 10;

  let colIdx = 0;
  for (const d of beamDesigns) {
    const beam = beams.find(b => b.id === d.beamId);
    if (!beam) continue;
    const cx = sectStartX + (colIdx % 3) * 60 + 20;
    const cy = sectY + Math.floor(colIdx / 3) * 55 + 15;
    if (cy > 250) break;

    drawBeamSection(doc, cx, cy, beam.b, beam.h,
      Math.max(d.flexLeft.bars, d.flexRight.bars), d.flexLeft.dia,
      d.flexMid.bars, d.flexMid.dia,
      d.shear.stirrups, d.beamId
    );
    colIdx++;
  }

  // Dimensions
  doc.setDrawColor(0);
  doc.setLineWidth(0.15);
  for (let i = 0; i < gridX.length - 1; i++) {
    const y = ty(minY) + 8;
    doc.line(tx(gridX[i]), y, tx(gridX[i + 1]), y);
    doc.setFontSize(4);
    doc.text(`${(gridX[i + 1] - gridX[i]).toFixed(1)}m`, (tx(gridX[i]) + tx(gridX[i + 1])) / 2 - 3, y + 3);
  }

  // Title block
  drawTitleBlock(doc, 340, 267, 70, 22, {
    title: 'BEAM LAYOUT & SECTIONS',
    projectName,
    drawingNo: 'S-001',
    scale: `1:${Math.round(1000 / mmPerM)}`,
    date: new Date().toLocaleDateString(),
  });

  // ========== SHEET 2: COLUMN LAYOUT ==========
  doc.addPage([420, 297], 'landscape');

  // Plan with columns
  doc.setDrawColor(200);
  doc.setLineWidth(0.1);
  for (const x of gridX) {
    doc.line(tx(x), ty(minY - 0.3), tx(x), ty(maxY + 0.3));
    doc.setFontSize(5);
    doc.text(`${x}`, tx(x) - 1.5, ty(maxY + 0.3) - 2);
  }
  for (const y of gridY) {
    doc.line(tx(minX - 0.3), ty(y), tx(maxX + 0.3), ty(y));
    doc.text(`${y}`, tx(minX - 0.3) - 4, ty(y) + 0.5);
  }

  for (const c of columns) {
    if (c.isRemoved) continue;
    const hw = (c.b / 1000) * mmPerM / 2;
    const hh = (c.h / 1000) * mmPerM / 2;
    doc.setFillColor(180, 0, 0);
    doc.rect(tx(c.x) - hw, ty(c.y) - hh, hw * 2, hh * 2, 'F');
    doc.setFontSize(4);
    doc.setTextColor(0);
    doc.text(`${c.id} ${c.b}x${c.h}`, tx(c.x) - 3, ty(c.y) + hh + 3);
  }

  // Column sections (right side)
  const colSectStartX = 230;
  let colSectY = 25;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  doc.text('COLUMN REINFORCEMENT SECTIONS', colSectStartX, colSectY);
  colSectY += 10;

  let cIdx = 0;
  for (const c of colDesigns) {
    const cx = colSectStartX + (cIdx % 3) * 60 + 20;
    const cy = colSectY + Math.floor(cIdx / 3) * 50 + 15;
    if (cy > 250) break;

    drawColumnSection(doc, cx, cy, c.b, c.h,
      c.design.bars, c.design.dia,
      c.design.stirrups, c.id
    );
    cIdx++;
  }

  drawTitleBlock(doc, 340, 267, 70, 22, {
    title: 'COLUMN LAYOUT & SECTIONS',
    projectName,
    drawingNo: 'S-002',
    scale: `1:${Math.round(1000 / mmPerM)}`,
    date: new Date().toLocaleDateString(),
  });

  // ========== SHEET 3: SLAB REINFORCEMENT ==========
  doc.addPage([420, 297], 'landscape');

  // Plan with slab reinforcement
  doc.setDrawColor(200);
  doc.setLineWidth(0.1);
  for (const x of gridX) doc.line(tx(x), ty(minY - 0.3), tx(x), ty(maxY + 0.3));
  for (const y of gridY) doc.line(tx(minX - 0.3), ty(y), tx(maxX + 0.3), ty(y));

  for (const s of slabs) {
    const sd = slabDesigns.find(d => d.id === s.id);
    if (!sd) continue;
    doc.setDrawColor(100, 100, 200);
    doc.setLineWidth(0.2);
    doc.rect(tx(s.x1), ty(s.y2), (s.x2 - s.x1) * mmPerM, (s.y2 - s.y1) * mmPerM);
    
    const cx = tx((s.x1 + s.x2) / 2);
    const cy = ty((s.y1 + s.y2) / 2);
    doc.setFontSize(4);
    doc.setTextColor(0, 0, 150);
    doc.text(s.id, cx - 2, cy - 4);
    doc.text(`Short: ${sd.design.shortDir.bars}Φ${sd.design.shortDir.dia}@${sd.design.shortDir.spacing}`, cx - 10, cy);
    doc.text(`Long: ${sd.design.longDir.bars}Φ${sd.design.longDir.dia}@${sd.design.longDir.spacing}`, cx - 10, cy + 4);
    doc.text(`h=${sd.design.hUsed}mm`, cx - 4, cy + 8);
  }

  // Slab schedule table
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 170,
    margin: { left: 230 },
    head: [['Slab', 'Lx', 'Ly', 'h', 'Short Dir', 'Long Dir']],
    body: slabDesigns.map(s => [
      s.id,
      `${s.design.lx.toFixed(1)}m`,
      `${s.design.ly.toFixed(1)}m`,
      `${s.design.hUsed}mm`,
      `${s.design.shortDir.bars}Φ${s.design.shortDir.dia}@${s.design.shortDir.spacing}`,
      `${s.design.longDir.bars}Φ${s.design.longDir.dia}@${s.design.longDir.spacing}`,
    ]),
    styles: { fontSize: 6 },
    headStyles: { fillColor: [41, 65, 94] },
  });

  drawTitleBlock(doc, 340, 267, 70, 22, {
    title: 'SLAB REINFORCEMENT PLAN',
    projectName,
    drawingNo: 'S-003',
    scale: `1:${Math.round(1000 / mmPerM)}`,
    date: new Date().toLocaleDateString(),
  });

  doc.save(`${projectName}_Structural_Drawings.pdf`);
}
