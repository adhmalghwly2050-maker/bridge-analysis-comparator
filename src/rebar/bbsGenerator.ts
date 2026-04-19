/**
 * Bar Bending Schedule (BBS) Generator
 * Per BS 8666 shape codes / ACI standards with wastage
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { Beam, Column, FlexureResult, ShearResult, ColumnResult, SlabDesignResult, Slab, Story } from '@/lib/structuralEngine';
import { drawSheetBorder, drawTitleBlockISO, defaultTitleBlockConfig, type TitleBlockConfig } from '@/drawings/drawingStandards';

export interface BBSEntry {
  barMark: string;
  member: string;
  memberType: 'beam' | 'column' | 'slab';
  storyId?: string;
  diameter: number;
  length: number;
  shapeCode: string;
  quantity: number;
  totalLength: number;
  netWeight: number;
  orderWeight: number;
}

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

// Wastage factors (BBS-3)
const WASTAGE_FACTORS = {
  beam: 0.05,
  column: 0.03,
  slab: 0.08,
};

function barWeight(dia: number, lengthM: number): number {
  return (dia * dia / 162.2) * lengthM;
}

function hookLength(dia: number): number {
  return Math.max(12 * dia / 1000, 0.15);
}

// =================== SHAPE CODE SKETCHES (BBS-2) ===================

function drawShapeSketch(doc: jsPDF, x: number, y: number, shapeCode: string): void {
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  const w = 12, h = 8;
  switch (shapeCode) {
    case '00': // Straight
      doc.line(x, y + h / 2, x + w, y + h / 2);
      break;
    case '11': // L-shape
      doc.line(x, y, x, y + h);
      doc.line(x, y + h, x + w, y + h);
      break;
    case '21': // U-shape (open top)
      doc.line(x, y, x, y + h);
      doc.line(x, y + h, x + w, y + h);
      doc.line(x + w, y + h, x + w, y);
      break;
    case '37': // Hook at one end
      doc.line(x, y + h / 2, x + w - 2, y + h / 2);
      doc.line(x + w - 2, y + h / 2, x + w, y + h / 2 - 3);
      break;
    case '38': // Hooks at both ends
      doc.line(x + 2, y + h / 2 - 3, x, y + h / 2);
      doc.line(x, y + h / 2, x + w, y + h / 2);
      doc.line(x + w, y + h / 2, x + w - 2, y + h / 2 - 3);
      break;
    case '51': // Closed rectangle stirrup
      doc.rect(x + 1, y + 1, w - 2, h - 2);
      break;
    default:
      doc.line(x, y + h / 2, x + w, y + h / 2);
  }
}

// =================== BBS GENERATION ===================

export function generateBBS(
  beams: Beam[],
  columns: Column[],
  slabs: Slab[],
  beamDesigns: BeamDesignData[],
  colDesigns: ColDesignData[],
  slabDesigns: SlabDesignData[],
  filterStoryId?: string,
): BBSEntry[] {
  const entries: BBSEntry[] = [];
  let markNum = 1;

  const filtBeams = filterStoryId ? beams.filter(b => b.storyId === filterStoryId) : beams;
  const filtCols = filterStoryId ? columns.filter(c => c.storyId === filterStoryId) : columns;
  const filtSlabs = filterStoryId ? slabs.filter(s => s.storyId === filterStoryId) : slabs;

  // ========== BEAM BARS ==========
  for (const d of beamDesigns) {
    const beam = filtBeams.find(b => b.id === d.beamId);
    if (!beam) continue;
    const spanM = beam.length;
    const hook = hookLength(d.flexLeft.dia);
    const wastage = WASTAGE_FACTORS.beam;

    // Top bars (left support)
    const topLenLeft = spanM * 0.3 + hook;
    const topWeightLeft = barWeight(d.flexLeft.dia, d.flexLeft.bars * topLenLeft);
    entries.push({
      barMark: `T${markNum}`, member: d.beamId, memberType: 'beam',
      storyId: beam.storyId, diameter: d.flexLeft.dia,
      length: parseFloat(topLenLeft.toFixed(3)), shapeCode: '37',
      quantity: d.flexLeft.bars,
      totalLength: parseFloat((d.flexLeft.bars * topLenLeft).toFixed(3)),
      netWeight: parseFloat(topWeightLeft.toFixed(1)),
      orderWeight: parseFloat((topWeightLeft * (1 + wastage)).toFixed(1)),
    });

    // Top bars (right support)
    const topLenRight = spanM * 0.3 + hook;
    const topWeightRight = barWeight(d.flexRight.dia, d.flexRight.bars * topLenRight);
    entries.push({
      barMark: `T${markNum + 1}`, member: d.beamId, memberType: 'beam',
      storyId: beam.storyId, diameter: d.flexRight.dia,
      length: parseFloat(topLenRight.toFixed(3)), shapeCode: '37',
      quantity: d.flexRight.bars,
      totalLength: parseFloat((d.flexRight.bars * topLenRight).toFixed(3)),
      netWeight: parseFloat(topWeightRight.toFixed(1)),
      orderWeight: parseFloat((topWeightRight * (1 + wastage)).toFixed(1)),
    });

    // Bottom bars (full span with hooks both ends)
    const botLen = spanM + 2 * hook;
    const botWeight = barWeight(d.flexMid.dia, d.flexMid.bars * botLen);
    entries.push({
      barMark: `B${markNum}`, member: d.beamId, memberType: 'beam',
      storyId: beam.storyId, diameter: d.flexMid.dia,
      length: parseFloat(botLen.toFixed(3)), shapeCode: '38',
      quantity: d.flexMid.bars,
      totalLength: parseFloat((d.flexMid.bars * botLen).toFixed(3)),
      netWeight: parseFloat(botWeight.toFixed(1)),
      orderWeight: parseFloat((botWeight * (1 + wastage)).toFixed(1)),
    });

    // Stirrups
    const stirrupMatch = d.shear.stirrups.match(/(\d+)Φ(\d+)@(\d+)/);
    if (stirrupMatch) {
      const nLegs = parseInt(stirrupMatch[1]);
      const sDia = parseInt(stirrupMatch[2]);
      const spacing = parseInt(stirrupMatch[3]);
      const numStirrups = Math.ceil((spanM * 1000) / spacing);
      const perim = 2 * ((beam.b - 80) / 1000 + (beam.h - 80) / 1000) + 2 * hookLength(sDia);
      const stirWeight = barWeight(sDia, numStirrups * perim);
      entries.push({
        barMark: `S${markNum}`, member: d.beamId, memberType: 'beam',
        storyId: beam.storyId, diameter: sDia,
        length: parseFloat(perim.toFixed(3)), shapeCode: '51',
        quantity: numStirrups,
        totalLength: parseFloat((numStirrups * perim).toFixed(3)),
        netWeight: parseFloat(stirWeight.toFixed(1)),
        orderWeight: parseFloat((stirWeight * (1 + wastage)).toFixed(1)),
      });
    }
    markNum++;
  }

  // ========== COLUMN BARS ==========
  for (const c of colDesigns) {
    const col = filtCols.find(col => col.id === c.id);
    if (!col || col.isRemoved) continue;
    const colLenM = col.L / 1000;
    const lap = 40 * c.design.dia / 1000;
    const wastage = WASTAGE_FACTORS.column;

    const barLen = colLenM + lap;
    const mainWeight = barWeight(c.design.dia, c.design.bars * barLen);
    entries.push({
      barMark: `C${markNum}`, member: c.id, memberType: 'column',
      storyId: col.storyId, diameter: c.design.dia,
      length: parseFloat(barLen.toFixed(3)), shapeCode: '00',
      quantity: c.design.bars,
      totalLength: parseFloat((c.design.bars * barLen).toFixed(3)),
      netWeight: parseFloat(mainWeight.toFixed(1)),
      orderWeight: parseFloat((mainWeight * (1 + wastage)).toFixed(1)),
    });

    // Ties
    const tieMatch = c.design.stirrups.match(/Φ(\d+)@(\d+)/);
    if (tieMatch) {
      const tieDia = parseInt(tieMatch[1]);
      const tieSpacing = parseInt(tieMatch[2]);
      const numTies = Math.ceil((colLenM * 1000) / tieSpacing);
      const tiePerim = 2 * ((c.b - 80) / 1000 + (c.h - 80) / 1000) + 2 * hookLength(tieDia);
      const tieWeight = barWeight(tieDia, numTies * tiePerim);
      entries.push({
        barMark: `CT${markNum}`, member: c.id, memberType: 'column',
        storyId: col.storyId, diameter: tieDia,
        length: parseFloat(tiePerim.toFixed(3)), shapeCode: '51',
        quantity: numTies,
        totalLength: parseFloat((numTies * tiePerim).toFixed(3)),
        netWeight: parseFloat(tieWeight.toFixed(1)),
        orderWeight: parseFloat((tieWeight * (1 + wastage)).toFixed(1)),
      });
    }
    markNum++;
  }

  // ========== SLAB BARS ==========
  for (const s of slabDesigns) {
    const slab = filtSlabs.find(sl => sl.id === s.id);
    if (!slab) continue;
    const lx = Math.abs(slab.x2 - slab.x1);
    const ly = Math.abs(slab.y2 - slab.y1);
    const wastage = WASTAGE_FACTORS.slab;

    const shortLen = lx + 2 * hookLength(s.design.shortDir.dia);
    const shortQty = Math.ceil(ly * 1000 / s.design.shortDir.spacing);
    const shortWeight = barWeight(s.design.shortDir.dia, shortQty * shortLen);
    entries.push({
      barMark: `SL${markNum}S`, member: s.id, memberType: 'slab',
      storyId: slab.storyId, diameter: s.design.shortDir.dia,
      length: parseFloat(shortLen.toFixed(3)), shapeCode: '00',
      quantity: shortQty,
      totalLength: parseFloat((shortQty * shortLen).toFixed(3)),
      netWeight: parseFloat(shortWeight.toFixed(1)),
      orderWeight: parseFloat((shortWeight * (1 + wastage)).toFixed(1)),
    });

    const longLen = ly + 2 * hookLength(s.design.longDir.dia);
    const longQty = Math.ceil(lx * 1000 / s.design.longDir.spacing);
    const longWeight = barWeight(s.design.longDir.dia, longQty * longLen);
    entries.push({
      barMark: `SL${markNum}L`, member: s.id, memberType: 'slab',
      storyId: slab.storyId, diameter: s.design.longDir.dia,
      length: parseFloat(longLen.toFixed(3)), shapeCode: '00',
      quantity: longQty,
      totalLength: parseFloat((longQty * longLen).toFixed(3)),
      netWeight: parseFloat(longWeight.toFixed(1)),
      orderWeight: parseFloat((longWeight * (1 + wastage)).toFixed(1)),
    });
    markNum++;
  }

  return entries;
}

// =================== BBS PDF EXPORT (Enhanced with shape sketches) ===================

export function exportBBSToPDF(entries: BBSEntry[], projectName: string = 'Structural Design Studio', storyLabel?: string): void {
  const w = 420, h = 297;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [w, h] });

  drawSheetBorder(doc, w, h);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('BAR BENDING SCHEDULE', 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Project: ${projectName}`, 20, 28);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 34);
  if (storyLabel) doc.text(`Floor: ${storyLabel}`, 20, 40);

  // Summary by diameter
  const diaSummary = new Map<number, { count: number; netWeight: number; orderWeight: number }>();
  for (const e of entries) {
    const prev = diaSummary.get(e.diameter) || { count: 0, netWeight: 0, orderWeight: 0 };
    diaSummary.set(e.diameter, {
      count: prev.count + e.quantity,
      netWeight: prev.netWeight + e.netWeight,
      orderWeight: prev.orderWeight + e.orderWeight,
    });
  }

  const totalNet = entries.reduce((s, e) => s + e.netWeight, 0);
  const totalOrder = entries.reduce((s, e) => s + e.orderWeight, 0);

  // Main BBS table
  autoTable(doc, {
    startY: storyLabel ? 45 : 40,
    head: [['Bar Mark', 'Member', 'Type', 'Dia', 'Length (m)', 'Shape', 'Qty', 'Total L (m)', 'Net Wt (kg)', 'Order Wt (kg)']],
    body: entries.map(e => [
      e.barMark, e.member, e.memberType,
      `Φ${e.diameter}`, e.length.toFixed(2), e.shapeCode,
      e.quantity.toString(), e.totalLength.toFixed(2),
      e.netWeight.toFixed(1), e.orderWeight.toFixed(1),
    ]),
    foot: [[
      '', '', '', '', '', '', 'TOTAL', '',
      totalNet.toFixed(1), totalOrder.toFixed(1),
    ]],
    styles: { fontSize: 6, font: 'helvetica' },
    headStyles: { fillColor: [0, 0, 0] },
    footStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontStyle: 'bold' },
    margin: { left: 15 },
    tableWidth: w - 30,
    didDrawCell: (data: any) => {
      // Draw shape sketch in Shape column (index 5)
      if (data.section === 'body' && data.column.index === 5) {
        const entry = entries[data.row.index];
        if (entry) {
          drawShapeSketch(doc, data.cell.x + 2, data.cell.y + 1, entry.shapeCode);
        }
      }
    },
  });

  // Summary table
  const summaryY = (doc as any).lastAutoTable.finalY + 10;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('SUMMARY BY DIAMETER', 15, summaryY);

  autoTable(doc, {
    startY: summaryY + 5,
    head: [['Diameter', 'Total Bars', 'Net Weight (kg)', 'Order Weight (kg)']],
    body: [...diaSummary.entries()].sort((a, b) => a[0] - b[0]).map(([dia, d]) => [
      `Φ${dia}`, d.count.toString(), d.netWeight.toFixed(1), d.orderWeight.toFixed(1),
    ]),
    foot: [[
      'TOTAL',
      [...diaSummary.values()].reduce((s, d) => s + d.count, 0).toString(),
      totalNet.toFixed(1),
      totalOrder.toFixed(1),
    ]],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [0, 0, 0] },
    footStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontStyle: 'bold' },
    margin: { left: 15 },
    tableWidth: 200,
  });

  // Wastage note
  const noteY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.text('Note: Order weight includes wastage factors — Beams: 5%, Columns: 3%, Slabs: 8%', 15, noteY);
  doc.text(`Total Net Weight: ${totalNet.toFixed(1)} kg  |  Total Order Weight (incl. wastage): ${totalOrder.toFixed(1)} kg`, 15, noteY + 5);

  // Shape code legend
  const legendY = noteY + 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('SHAPE CODE REFERENCE (BS 8666)', 15, legendY);
  const shapes = [
    ['00', 'Straight bar'], ['11', 'L-shape (one 90° bend)'],
    ['21', 'U-shape (open top)'], ['37', 'Hook at one end'],
    ['38', 'Hooks at both ends'], ['51', 'Closed rectangle stirrup'],
  ];
  shapes.forEach(([code, desc], i) => {
    const sx = 15 + (i % 3) * 100;
    const sy = legendY + 5 + Math.floor(i / 3) * 14;
    drawShapeSketch(doc, sx, sy, code);
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.text(`${code}: ${desc}`, sx + 16, sy + 5);
  });

  drawTitleBlockISO(doc, w, h, {
    ...defaultTitleBlockConfig,
    projectName,
    drawingTitle: 'BAR BENDING SCHEDULE',
    drawingSubTitle: storyLabel || 'All Floors',
    drawingNumber: storyLabel ? `S-${storyLabel.replace(/\s/g, '')}-BBS-01` : 'S-BBS-01',
    sheetNo: '1',
    date: new Date().toLocaleDateString(),
    scale: 'N.T.S.',
    fc: 28, fy: 420,
  } as TitleBlockConfig);

  const suffix = storyLabel ? `_BBS_${storyLabel.replace(/\s/g, '_')}` : '_BBS';
  doc.save(`${projectName}${suffix}.pdf`);
}

// =================== BBS EXCEL EXPORT (Enhanced with per-floor sheets) ===================

export function exportBBSToExcel(
  entries: BBSEntry[],
  projectName: string = 'Structural Design Studio',
  stories?: Story[],
): void {
  const wb = XLSX.utils.book_new();

  const makeSheet = (data: BBSEntry[], name: string) => {
    const totalNet = data.reduce((s, e) => s + e.netWeight, 0);
    const totalOrder = data.reduce((s, e) => s + e.orderWeight, 0);
    const rows = data.map(e => ({
      'Bar Mark': e.barMark, 'Member': e.member, 'Type': e.memberType,
      'Diameter (mm)': e.diameter, 'Length (m)': e.length,
      'Shape Code': e.shapeCode, 'Quantity': e.quantity,
      'Total Length (m)': e.totalLength,
      'Net Weight (kg)': e.netWeight, 'Order Weight (kg)': e.orderWeight,
    }));
    rows.push({
      'Bar Mark': 'TOTAL', 'Member': '-', 'Type': '-' as any,
      'Diameter (mm)': 0, 'Length (m)': 0, 'Shape Code': '-',
      'Quantity': data.reduce((s, e) => s + e.quantity, 0),
      'Total Length (m)': data.reduce((s, e) => s + e.totalLength, 0),
      'Net Weight (kg)': totalNet, 'Order Weight (kg)': totalOrder,
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31));
  };

  // Per-floor sheets
  if (stories && stories.length > 0) {
    for (const story of stories) {
      const floorEntries = entries.filter(e => e.storyId === story.id);
      if (floorEntries.length > 0) {
        makeSheet(floorEntries, story.label);
      }
    }
  }

  // All floors combined
  makeSheet(entries, 'All Floors');

  // By Diameter summary sheet
  const diaSummary = new Map<number, { count: number; netWeight: number; orderWeight: number }>();
  for (const e of entries) {
    const prev = diaSummary.get(e.diameter) || { count: 0, netWeight: 0, orderWeight: 0 };
    diaSummary.set(e.diameter, {
      count: prev.count + e.quantity,
      netWeight: prev.netWeight + e.netWeight,
      orderWeight: prev.orderWeight + e.orderWeight,
    });
  }
  const diaRows = [...diaSummary.entries()].sort((a, b) => a[0] - b[0]).map(([dia, d]) => ({
    'Diameter': `Φ${dia}`, 'Total Bars': d.count,
    'Net Weight (kg)': parseFloat(d.netWeight.toFixed(1)),
    'Order Weight (kg)': parseFloat(d.orderWeight.toFixed(1)),
  }));
  const wsDia = XLSX.utils.json_to_sheet(diaRows);
  XLSX.utils.book_append_sheet(wb, wsDia, 'By Diameter');

  XLSX.writeFile(wb, `${projectName}_BBS.xlsx`);
}
