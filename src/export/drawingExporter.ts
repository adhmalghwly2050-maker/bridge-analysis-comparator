/**
 * Drawing Exporter - PDF Sheet Export
 * Exports structural drawings to A4/A3 PDF sheets
 */

import jsPDF from 'jspdf';
import type { Slab, Column, Beam } from '@/lib/structuralEngine';

type SheetSize = 'A4' | 'A3';

interface DrawingConfig {
  sheetSize: SheetSize;
  scale: number;
  title: string;
  projectName: string;
  drawingNumber: string;
  date: string;
}

const SHEET_DIMENSIONS: Record<SheetSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
};

function drawTitleBlock(doc: jsPDF, config: DrawingConfig) {
  const { w, h } = SHEET_DIMENSIONS[config.sheetSize];
  const tbW = 80;
  const tbH = 30;
  const tbX = w - tbW - 5;
  const tbY = h - tbH - 5;

  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.rect(tbX, tbY, tbW, tbH);
  doc.line(tbX, tbY + 10, tbX + tbW, tbY + 10);
  doc.line(tbX, tbY + 20, tbX + tbW, tbY + 20);
  doc.line(tbX + 40, tbY, tbX + 40, tbY + tbH);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('PROJECT:', tbX + 2, tbY + 4);
  doc.text('DRAWING:', tbX + 2, tbY + 14);
  doc.text('DATE:', tbX + 2, tbY + 24);
  doc.text('SCALE:', tbX + 42, tbY + 4);
  doc.text('DWG NO:', tbX + 42, tbY + 14);
  doc.text('SHEET:', tbX + 42, tbY + 24);

  doc.setFont('helvetica', 'normal');
  doc.text(config.projectName, tbX + 18, tbY + 4);
  doc.text(config.title, tbX + 18, tbY + 14);
  doc.text(config.date, tbX + 18, tbY + 24);
  doc.text(`1:${config.scale}`, tbX + 56, tbY + 4);
  doc.text(config.drawingNumber, tbX + 56, tbY + 14);
  doc.text('1 of 1', tbX + 56, tbY + 24);

  // Border
  doc.setLineWidth(1);
  doc.rect(5, 5, w - 10, h - 10);
  doc.setLineWidth(0.3);
  doc.rect(10, 10, w - 20, h - 20);
}

function getAutoScale(
  modelW: number, modelH: number,
  sheetSize: SheetSize,
): number {
  const sheet = SHEET_DIMENSIONS[sheetSize];
  const drawableW = sheet.w - 40;
  const drawableH = sheet.h - 60;
  
  const idealScale = 1000 / Math.min(drawableW / modelW, drawableH / modelH);
  
  // Pick smallest standard scale that fits (= largest drawing)
  const standardScales = [10, 20, 25, 50, 75, 100, 150, 200];
  for (const s of standardScales) {
    if (s >= idealScale) return s;
  }
  return 200;
}

export function exportStructuralDrawingPDF(
  slabs: Slab[],
  beams: Beam[],
  columns: Column[],
  sheetSize: SheetSize = 'A3',
  projectName: string = 'Structural Design Studio',
): void {
  const sheet = SHEET_DIMENSIONS[sheetSize];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [sheet.w, sheet.h] });

  // Calculate model bounds
  const allX = slabs.flatMap(s => [s.x1, s.x2]);
  const allY = slabs.flatMap(s => [s.y1, s.y2]);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const modelW = maxX - minX;
  const modelH = maxY - minY;

  const scale = getAutoScale(modelW, modelH, sheetSize);
  const mmPerM = 1000 / scale;
  const offsetX = 20;
  const offsetY = 20;

  const tx = (x: number) => (x - minX) * mmPerM + offsetX;
  const ty = (y: number) => (maxY - y) * mmPerM + offsetY; // flip Y: origin bottom-left

  // Grid lines
  doc.setDrawColor(200);
  doc.setLineWidth(0.1);
  const gridX = [...new Set(allX)].sort((a, b) => a - b);
  const gridY = [...new Set(allY)].sort((a, b) => a - b);
  for (const x of gridX) {
    doc.line(tx(x), ty(minY - 0.5), tx(x), ty(maxY + 0.5));
    doc.setFontSize(7);
    doc.text(`${x}m`, tx(x) - 3, ty(maxY) - 5);
  }
  for (const y of gridY) {
    doc.line(tx(minX - 0.5), ty(y), tx(maxX + 0.5), ty(y));
    doc.text(`${y}m`, tx(minX - 0.5) - 5, ty(y) + 1);
  }

  // Slabs
  doc.setDrawColor(150);
  doc.setLineWidth(0.15);
  for (const s of slabs) {
    doc.rect(tx(s.x1), ty(s.y2), (s.x2 - s.x1) * mmPerM, (s.y2 - s.y1) * mmPerM);
    doc.setFontSize(7);
    doc.text(s.id, tx((s.x1 + s.x2) / 2) - 3, ty((s.y1 + s.y2) / 2));
  }

  // Beams
  doc.setDrawColor(0, 150, 0);
  doc.setLineWidth(0.4);
  for (const b of beams) {
    doc.line(tx(b.x1), ty(b.y1), tx(b.x2), ty(b.y2));
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 100, 0);
    doc.text(`${b.id} ${b.b}x${b.h}`, tx((b.x1 + b.x2) / 2), ty((b.y1 + b.y2) / 2) - 1);
    doc.setFont('helvetica', 'normal');
  }

  // Columns
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(200, 0, 0);
  doc.setLineWidth(0.3);
  for (const c of columns) {
    if (c.isRemoved) continue;
    const hw = (c.b / 1000) * mmPerM / 2;
    const hh = (c.h / 1000) * mmPerM / 2;
    doc.setFillColor(200, 0, 0);
    doc.rect(tx(c.x) - hw, ty(c.y) - hh, hw * 2, hh * 2, 'F');
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text(c.id, tx(c.x) - 3, ty(c.y) + hh + 4);
    doc.setFont('helvetica', 'normal');
  }

  // Title block
  drawTitleBlock(doc, {
    sheetSize,
    scale,
    title: 'STRUCTURAL PLAN',
    projectName,
    drawingNumber: 'S-001',
    date: new Date().toLocaleDateString(),
  });

  doc.save(`${projectName}_Drawing_${sheetSize}.pdf`);
}
