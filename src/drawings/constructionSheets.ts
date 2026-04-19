/**
 * Construction Drawing Generator — ISO 7200 / ACI 315-99 Compliant
 * Generates ready-for-construction (RFC) structural sheets with proper standards
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Slab, Column, Beam, FlexureResult, ShearResult, ColumnResult, SlabDesignResult, Story } from '@/lib/structuralEngine';
import { calculateDevelopmentLengths } from '@/lib/structuralEngine';
import {
  drawSheetBorder, drawTitleBlockISO, drawGridSystem, drawScaleBar, drawLegendBox,
  drawDashedLine, generateGeneralNotesSheet, DrawingRegister,
  defaultTitleBlockConfig, LINE_WEIGHTS, getFloorCode, makeDrawingNumber,
  type TitleBlockConfig, type ExportOptions, type DevelopmentLengths,
} from './drawingStandards';

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

function isEndSupport(beam: Beam, side: 'left' | 'right', allBeams: Beam[]): boolean {
  const colId = side === 'left' ? beam.fromCol : beam.toCol;
  const otherBeams = allBeams.filter(b => b.id !== beam.id && (b.fromCol === colId || b.toCol === colId));
  return !otherBeams.some(b => b.direction === beam.direction);
}

// =================== HELPER: DIMENSION LINE ===================

function drawDimLine(
  doc: jsPDF, x1: number, x2: number, y: number,
  text: string, color: [number, number, number] = [60, 60, 60],
) {
  if (Math.abs(x2 - x1) < 1) return;
  doc.setDrawColor(...color);
  doc.setLineWidth(0.12);
  doc.line(x1, y, x2, y);
  doc.line(x1, y - 1.5, x1, y + 1.5);
  doc.line(x2, y - 1.5, x2, y + 1.5);
  const mid = (x1 + x2) / 2;
  doc.setFontSize(5);
  doc.setTextColor(...color);
  const tw = text.length * 1.2;
  doc.text(text, mid - tw / 2, y - 2);
  doc.setTextColor(0);
}

// =================== HELPER: BEAM CROSS-SECTION ===================

function drawBeamCrossSection(
  doc: jsPDF,
  x: number, y: number, w: number, h: number,
  bMm: number, hMm: number,
  coverMm: number, stirrupDiaMm: number,
  nTopBars: number, topDia: number,
  nBotBars: number, botDia: number,
  title: string,
) {
  const scl = Math.min((w - 4) / bMm, (h - 14) / hMm);
  const sW = bMm * scl;
  const sH = hMm * scl;
  const sx = x + (w - sW) / 2;
  const sy = y + 12;

  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.rect(sx, sy, sW, sH);

  doc.setDrawColor(200);
  doc.setLineWidth(0.08);
  for (let hx = sx + 1.5; hx < sx + sW - 0.5; hx += 2) {
    doc.line(hx, sy + 0.5, hx - 1, sy + 1.5);
  }

  const stCover = coverMm * scl;
  const stDia = stirrupDiaMm * scl;
  doc.setDrawColor(0);
  doc.setLineWidth(0.25);
  doc.rect(sx + stCover, sy + stCover, sW - 2 * stCover, sH - 2 * stCover);

  const topR = (topDia * scl) / 2;
  if (nTopBars > 0) {
    const topBarY = sy + stCover + stDia + topR;
    const topAvail = sW - 2 * stCover - 2 * stDia - 2 * topR;
    const topSp = nTopBars > 1 ? topAvail / (nTopBars - 1) : 0;
    for (let i = 0; i < nTopBars; i++) {
      const bx = sx + stCover + stDia + topR + i * topSp;
      doc.setFillColor(0, 0, 0);
      (doc as any).circle(bx, topBarY, Math.max(topR, 0.6), 'F');
    }
  }

  const botR = (botDia * scl) / 2;
  if (nBotBars > 0) {
    const botBarY = sy + sH - stCover - stDia - botR;
    const botAvail = sW - 2 * stCover - 2 * stDia - 2 * botR;
    const botSp = nBotBars > 1 ? botAvail / (nBotBars - 1) : 0;
    for (let i = 0; i < nBotBars; i++) {
      const bx = sx + stCover + stDia + botR + i * botSp;
      doc.setFillColor(0, 0, 0);
      (doc as any).circle(bx, botBarY, Math.max(botR, 0.6), 'F');
    }
  }

  doc.setFontSize(3.8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  doc.text(title, x + w / 2 - title.length * 0.8, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(3.2);
  doc.text(`${bMm}`, sx + sW / 2 - 3, sy + sH + 4);
  doc.text(`${hMm}`, sx - 7, sy + sH / 2 + 1);
  doc.text(`c=${coverMm}`, sx + 1, sy + 3);
}

// =================== VERTICAL DIMENSION LINE ===================

function drawVertDimLine(
  doc: jsPDF, x: number, y1: number, y2: number,
  text: string, color: [number, number, number] = [60, 60, 60],
) {
  if (Math.abs(y2 - y1) < 1) return;
  doc.setDrawColor(...color);
  doc.setLineWidth(0.12);
  doc.line(x, y1, x, y2);
  doc.line(x - 1.5, y1, x + 1.5, y1);
  doc.line(x - 1.5, y2, x + 1.5, y2);
  const mid = (y1 + y2) / 2;
  doc.setFontSize(5);
  doc.setTextColor(...color);
  doc.text(text, x + 2, mid + 1);
  doc.setTextColor(0);
}

// =================== BEAM LONGITUDINAL ELEVATION (REDESIGNED) ===================
// Sheet layout:
//   TOP HALF: Beam elevation with rebar inside + cross-sections (left, center, right)
//   BOTTOM HALF: Bar detailing (تفريد الحديد) — bottom straight, bent, top bar each drawn separately
// Changes:
//   • Unified top bar: take max(left, right) bars, extend full span + into adjacent beams
//   • Bent bar upper straight extends into adjacent beams
//   • Bar counts shown in readable area (not on top of lines)
//   • Beam dimensions shown clearly

function drawBeamElevation(
  doc: jsPDF,
  beam: Beam,
  design: BeamDesignData,
  x: number, y: number,
  drawW: number, drawH: number,
  devLengths: DevelopmentLengths[],
  drawingNo: string,
  allBeams: Beam[],
) {
  const spanMm    = beam.length * 1000;
  const h         = beam.h;
  const b         = beam.b;
  const coverMm   = 40;
  const stirrupDiaMm = 10;
  const topDia    = Math.max(design.flexLeft.dia, design.flexRight.dia);
  const botDia    = design.flexMid.dia;

  // Unified top bars: take the larger count
  const unifiedTopBars = Math.max(design.flexLeft.bars, design.flexRight.bars);

  const d_eff = h - coverMm - stirrupDiaMm - botDia / 2;

  const dlTop = devLengths.find(d => d.dia === topDia) ?? {
    ld_straight: Math.round(0.6 * topDia * 420 / Math.sqrt(28)),
    ldh_standard_hook: Math.max(Math.round(0.24 * topDia * 420 / Math.sqrt(28)), 8 * topDia, 150),
    dia: topDia, fy: 420, fc: 28,
  } as DevelopmentLengths;
  const dlBot = devLengths.find(d => d.dia === botDia) ?? {
    ld_straight: Math.round(0.6 * botDia * 420 / Math.sqrt(28)),
    ldh_standard_hook: Math.max(Math.round(0.24 * botDia * 420 / Math.sqrt(28)), 8 * botDia, 150),
    dia: botDia, fy: 420, fc: 28,
  } as DevelopmentLengths;

  // Support types
  const leftIsEnd  = isEndSupport(beam, 'left',  allBeams);
  const rightIsEnd = isEndSupport(beam, 'right', allBeams);

  // Extension = 1/5 of adjacent beam clear span (from column face), per ACI 318-19
  const getAdjacentClearSpan = (side: 'left' | 'right'): number => {
    const colId = side === 'left' ? beam.fromCol : beam.toCol;
    const adjBeam = allBeams.find(ab => ab.id !== beam.id && (ab.fromCol === colId || ab.toCol === colId) && ab.direction === beam.direction);
    if (!adjBeam) return spanMm;
    // Adjacent clear span = beam length - half column widths at each end (approximate face-to-face)
    return adjBeam.length * 1000;
  };
  const leftAdjSpanMm  = getAdjacentClearSpan('left');
  const rightAdjSpanMm = getAdjacentClearSpan('right');
  const leftExtMm  = leftIsEnd  ? 0 : Math.max(dlTop.ld_straight, leftAdjSpanMm / 5);
  const rightExtMm = rightIsEnd ? 0 : Math.max(dlTop.ld_straight, rightAdjSpanMm / 5);

  const hookBotMm  = Math.max(12 * botDia, 150);
  const hookTopMm  = Math.max(12 * topDia, 150);
  const colWidthMm = 400;

  // Bent bar calculations
  const totalBotBars   = design.flexMid.bars;
  const hasBentBars    = totalBotBars >= 4;
  const bentBarsCount  = hasBentBars ? Math.min(2, Math.floor(totalBotBars / 2)) : 0;
  const continuousBotBars = totalBotBars - bentBarsCount;

  // ── LAYOUT: Top 55% for elevation, Bottom 45% for bar detailing ──
  const secPanelW  = 75; // wider for 3 cross-sections
  const mainAreaW  = drawW - secPanelW - 6;
  const elevAreaH  = drawH * 0.50;
  const detailAreaH = drawH * 0.45;
  const detailY    = y + elevAreaH + 8;

  // Scale calculation
  const leftReserve  = Math.max(leftExtMm + colWidthMm, colWidthMm * 1.1);
  const rightReserve = Math.max(rightExtMm + colWidthMm, colWidthMm * 1.1);
  const totalMm      = leftReserve + spanMm + rightReserve;

  const marginX = 4;
  const availW  = mainAreaW - marginX * 2;
  const availH  = elevAreaH - 30;

  const scl  = Math.min(availW / totalMm, availH / (h * 2.2), 0.16);
  const beamW = spanMm      * scl;
  const beamH = h           * scl;
  const colW  = colWidthMm  * scl;

  const ox = x + marginX + (availW - (leftReserve + spanMm + rightReserve) * scl) / 2 + leftReserve * scl;
  const oy = y + 18 + (availH - beamH) / 2;

  const cover  = coverMm     * scl;
  const stirD  = stirrupDiaMm * scl;
  const topBarY = oy + cover + stirD + (topDia * scl) / 2;
  const botBarY = oy + beamH - cover - stirD - (botDia * scl) / 2;

  // ════════════════════════════════════════════════════════════════════════════
  // PART 1: BEAM ELEVATION (top half)
  // ════════════════════════════════════════════════════════════════════════════

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.setTextColor(0);
  doc.text(`BEAM ${beam.id}  ·  b=${b} × h=${h} mm  ·  L=${beam.length.toFixed(2)} m`, x, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4);
  doc.text(`f'c=28 MPa   fy=420 MPa   cover=${coverMm}mm   d=${Math.round(d_eff)}mm`, x, y + 10);

  // Column dashed outlines
  doc.setDrawColor(160);
  doc.setLineWidth(LINE_WEIGHTS.HIDDEN);
  drawDashedLine(doc, ox - colW, oy, ox, oy);
  drawDashedLine(doc, ox - colW, oy + beamH, ox, oy + beamH);
  drawDashedLine(doc, ox - colW, oy, ox - colW, oy + beamH);
  drawDashedLine(doc, ox + beamW, oy, ox + beamW + colW, oy);
  drawDashedLine(doc, ox + beamW, oy + beamH, ox + beamW + colW, oy + beamH);
  drawDashedLine(doc, ox + beamW + colW, oy, ox + beamW + colW, oy + beamH);

  // Column centrelines
  doc.setDrawColor(130);
  drawDashedLine(doc, ox - colW / 2, oy - 6, ox - colW / 2, oy + beamH + 4);
  drawDashedLine(doc, ox + beamW + colW / 2, oy - 6, ox + beamW + colW / 2, oy + beamH + 4);

  // Adjacent beam stubs
  if (!leftIsEnd) {
    const adjPx = leftExtMm * scl;
    doc.setDrawColor(180);
    drawDashedLine(doc, ox - colW - adjPx, oy, ox - colW, oy);
    drawDashedLine(doc, ox - colW - adjPx, oy + beamH, ox - colW, oy + beamH);
    drawDashedLine(doc, ox - colW - adjPx, oy, ox - colW - adjPx, oy + beamH);
  }
  if (!rightIsEnd) {
    const adjPx = rightExtMm * scl;
    doc.setDrawColor(180);
    drawDashedLine(doc, ox + beamW + colW, oy, ox + beamW + colW + adjPx, oy);
    drawDashedLine(doc, ox + beamW + colW, oy + beamH, ox + beamW + colW + adjPx, oy + beamH);
    drawDashedLine(doc, ox + beamW + colW + adjPx, oy, ox + beamW + colW + adjPx, oy + beamH);
  }

  // Beam outline
  doc.setDrawColor(0);
  doc.setLineWidth(LINE_WEIGHTS.STRUCTURAL_ELEMENT);
  doc.rect(ox, oy, beamW, beamH);

  // ── UNIFIED TOP BAR (full span + extensions into adjacent beams) ──
  const topStartX = leftIsEnd  ? ox - Math.min((hookTopMm * 0.5) * scl, colW * 0.7)
                                : ox - colW - leftExtMm * scl;
  const topEndX   = rightIsEnd ? ox + beamW + Math.min((hookTopMm * 0.5) * scl, colW * 0.7)
                                : ox + beamW + colW + rightExtMm * scl;

  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  if (leftIsEnd) {
    doc.line(topStartX, topBarY - hookTopMm * scl * 0.3, topStartX + hookTopMm * scl * 0.15, topBarY);
  }
  doc.line(leftIsEnd ? topStartX + hookTopMm * scl * 0.15 : topStartX, topBarY, rightIsEnd ? topEndX - hookTopMm * scl * 0.15 : topEndX, topBarY);
  if (rightIsEnd) {
    doc.line(topEndX - hookTopMm * scl * 0.15, topBarY, topEndX, topBarY - hookTopMm * scl * 0.3);
  }

  // ── BOTTOM BAR (full span + hooks) ──
  const botLeftStartX  = leftIsEnd  ? ox - hookBotMm * scl * 0.5  : ox - colW * 0.65;
  const botRightEndX   = rightIsEnd ? ox + beamW + hookBotMm * scl * 0.5 : ox + beamW + colW * 0.65;

  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  if (leftIsEnd) {
    doc.line(botLeftStartX, botBarY + hookBotMm * scl * 0.5, botLeftStartX + hookBotMm * scl * 0.2, botBarY);
  }
  doc.line(leftIsEnd ? botLeftStartX + hookBotMm * scl * 0.2 : botLeftStartX, botBarY, rightIsEnd ? botRightEndX - hookBotMm * scl * 0.2 : botRightEndX, botBarY);
  if (rightIsEnd) {
    doc.line(botRightEndX - hookBotMm * scl * 0.2, botBarY, botRightEndX, botBarY + hookBotMm * scl * 0.5);
  }

  // ── BENT BARS inside beam ──
  let bentSeg1Mm = 0, bentDiagMm = 0, bentSeg3Mm = 0, bentTotalMm = 0, bentSeg5Mm = 0;
  if (hasBentBars && bentBarsCount > 0) {
    // Single color for all rebar (black)
    doc.setDrawColor(0);
    doc.setLineWidth(0.4);

    const bentTopY = topBarY + stirD * 0.3;
    const bentBotY = botBarY - stirD * 0.3;
    const risePixels = bentBotY - bentTopY;
    const riseMm     = risePixels / scl;
    const horizMm    = riseMm;
    const diagLenMm  = Math.sqrt(2) * riseMm;

    const bendDnStartPx = ox + spanMm * 0.22 * scl;
    const bendDnEndPx   = bendDnStartPx + horizMm * scl;
    const bendUpEndPx   = ox + spanMm * 0.78 * scl;
    const bendUpStartPx = bendUpEndPx - horizMm * scl;

    // Bent bar upper part extends into adjacent beam (like top bars)
    const bentLeftStartX = leftIsEnd  ? ox + 2 : ox - colW - leftExtMm * scl;
    const bentRightEndX  = rightIsEnd ? ox + beamW - 2 : ox + beamW + colW + rightExtMm * scl;

    for (let bi = 0; bi < bentBarsCount; bi++) {
      const yo = bi * 1.5;
      doc.line(bentLeftStartX, bentTopY + yo, bendDnStartPx, bentTopY + yo);
      doc.line(bendDnStartPx, bentTopY + yo, bendDnEndPx, bentBotY + yo);
      doc.line(bendDnEndPx, bentBotY + yo, bendUpStartPx, bentBotY + yo);
      doc.line(bendUpStartPx, bentBotY + yo, bendUpEndPx, bentTopY + yo);
      doc.line(bendUpEndPx, bentTopY + yo, bentRightEndX, bentTopY + yo);
    }

    // Calculate segment lengths for detailing
    const leftExtBent  = leftIsEnd  ? 0 : (colWidthMm * 0.5 + leftExtMm);
    const rightExtBent = rightIsEnd ? 0 : (colWidthMm * 0.5 + rightExtMm);
    bentSeg1Mm  = spanMm * 0.22 + leftExtBent;
    bentDiagMm  = diagLenMm;
    bentSeg3Mm  = spanMm * (0.78 - 0.22) - 2 * horizMm;
    bentSeg5Mm  = spanMm * (1 - 0.78) + rightExtBent;
    bentTotalMm = bentSeg1Mm + bentDiagMm + bentSeg3Mm + bentDiagMm + bentSeg5Mm;
  }

  // ── STIRRUPS inside beam ──
  const stirrupMatch   = design.shear.stirrups.match(/(\d+)Φ(\d+)@(\d+)/);
  const stirSpacingMm  = stirrupMatch ? parseInt(stirrupMatch[3]) : 150;
  const stirDiaMmVal   = stirrupMatch ? parseInt(stirrupMatch[2]) : 10;
  const zone1SpacMm    = Math.max(Math.floor(stirSpacingMm * 0.6 / 25) * 25, 75);
  const zone1LenMm     = d_eff;
  const zone1SpacPx    = zone1SpacMm  * scl;
  const zone2SpacPx    = stirSpacingMm * scl;
  const zone1LenPx     = zone1LenMm   * scl;
  const firstStirPx    = 50 * scl;

  doc.setDrawColor(0, 0, 180);
  doc.setLineWidth(0.15);
  for (let sx = ox + firstStirPx; sx <= ox + zone1LenPx; sx += zone1SpacPx) {
    doc.line(sx, oy + 1, sx, oy + beamH - 1);
  }
  for (let sx = ox + beamW - firstStirPx; sx >= ox + beamW - zone1LenPx; sx -= zone1SpacPx) {
    doc.line(sx, oy + 1, sx, oy + beamH - 1);
  }
  for (let sx = ox + zone1LenPx + zone2SpacPx; sx < ox + beamW - zone1LenPx; sx += zone2SpacPx) {
    doc.line(sx, oy + 1, sx, oy + beamH - 1);
  }

  // ── BEAM DIMENSIONS ──
  // h dimension (left of beam)
  const hDimX = ox - 12;
  drawVertDimLine(doc, hDimX, oy, oy + beamH, `h=${h}`, [0, 0, 0]);

  // Span dimension (below beam)
  const dimSpanY = oy + beamH + 8;
  drawDimLine(doc, ox, ox + beamW, dimSpanY, `Ln = ${beam.length.toFixed(2)} m`, [0, 0, 0]);

  // b label
  doc.setFontSize(3.5);
  doc.setTextColor(80);
  doc.text(`b=${b}`, ox + beamW / 2 - 4, oy + beamH - 1.5);
  doc.setTextColor(0);

  // ── BAR COUNTS (in readable area, right of beam) ──
  const infoX = ox + beamW + colW + 5;
  const infoY = oy + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.5);
  doc.text(`حديد علوي: ${unifiedTopBars}Φ${topDia}`, infoX, infoY);
  doc.text(`حديد سفلي: ${continuousBotBars}Φ${botDia}`, infoX, infoY + 6);
  if (bentBarsCount > 0) {
    doc.setTextColor(180, 90, 0);
    doc.text(`مكسح: ${bentBarsCount}Φ${botDia}`, infoX, infoY + 12);
    doc.setTextColor(0);
  }
  doc.setTextColor(0, 0, 160);
  doc.text(`كانات: Φ${stirDiaMmVal}@${zone1SpacMm}/${stirSpacingMm}`, infoX, infoY + 18);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'normal');

  // ── SECTION CUT MARKS (A-A left, B-B center, C-C right) ──
  const secPositions: [number, string][] = [
    [ox + colW * 0.1, 'A'],
    [ox + beamW / 2, 'B'],
    [ox + beamW - colW * 0.1, 'C'],
  ];
  doc.setDrawColor(0);
  doc.setLineWidth(0.25);
  for (const [sx, lbl] of secPositions) {
    doc.line(sx - 1.5, oy - 5, sx + 1.5, oy - 5);
    doc.line(sx, oy - 5, sx, oy);
    doc.line(sx, oy + beamH, sx, oy + beamH + 3);
    doc.setFontSize(4);
    doc.setFont('helvetica', 'bold');
    doc.text(lbl, sx - 1, oy - 6);
    doc.setFont('helvetica', 'normal');
  }

  // ── CROSS-SECTIONS (right panel - 3 sections: A-A, B-B, C-C) ──
  const secPanelX = x + mainAreaW + 4;
  const secH = (elevAreaH - 12) / 3;

  // SEC A-A (left support)
  drawBeamCrossSection(doc, secPanelX, y + 2, secPanelW - 4, secH - 2,
    b, h, coverMm, stirrupDiaMm,
    unifiedTopBars, topDia,
    design.flexMid.bars, botDia,
    'SEC A-A (LEFT)');

  // SEC B-B (midspan)
  drawBeamCrossSection(doc, secPanelX, y + secH + 2, secPanelW - 4, secH - 2,
    b, h, coverMm, stirrupDiaMm,
    0, topDia,
    Math.max(continuousBotBars, 2), botDia,
    'SEC B-B (MID)');

  // SEC C-C (right support)
  drawBeamCrossSection(doc, secPanelX, y + 2 * secH + 2, secPanelW - 4, secH - 2,
    b, h, coverMm, stirrupDiaMm,
    unifiedTopBars, topDia,
    design.flexMid.bars, botDia,
    'SEC C-C (RIGHT)');

  // ════════════════════════════════════════════════════════════════════════════
  // PART 2: BAR DETAILING (تفريد الحديد) — bottom half
  // ════════════════════════════════════════════════════════════════════════════

  // Separator line
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.line(x, detailY - 4, x + drawW, detailY - 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.text('تفريد الحديد — BAR DETAILING', x, detailY);
  doc.setFont('helvetica', 'normal');

  // Detail area layout: 3 bars stacked with spacing
  const detailStartY = detailY + 6;
  const barRowH = (detailAreaH - 12) / 3; // height allocated per bar type
  const detailMargin = 15;
  const detailW = mainAreaW - detailMargin * 2;

  // Scale for detailing (use same horizontal scale for consistency)
  // Total bar length determines scale
  const topTotalMm = (leftIsEnd ? hookTopMm : leftExtMm + colWidthMm / 2) + spanMm + (rightIsEnd ? hookTopMm : rightExtMm + colWidthMm / 2);
  const botTotalMm = (leftIsEnd ? hookBotMm : colWidthMm * 0.65) + spanMm + (rightIsEnd ? hookBotMm : colWidthMm * 0.65);
  const maxBarLen = Math.max(topTotalMm, botTotalMm, bentTotalMm || 0);
  const detailScl = (detailW - 20) / maxBarLen;

  const detailOx = x + detailMargin + 10;

  // ── ROW 1 (bottom): Straight bottom bar ──
  const row1Y = detailStartY + barRowH * 2 + barRowH / 2;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);

  const botHookPx = hookBotMm * detailScl;
  const botSpanPx = spanMm * detailScl;
  const botExtLeftPx = leftIsEnd ? 0 : colWidthMm * 0.65 * detailScl;
  const botExtRightPx = rightIsEnd ? 0 : colWidthMm * 0.65 * detailScl;
  
  let bx1 = detailOx;
  if (leftIsEnd) {
    // Hook down
    doc.line(bx1, row1Y + botHookPx * 0.5, bx1 + botHookPx * 0.15, row1Y);
    bx1 += botHookPx * 0.15;
  } else {
    bx1 = detailOx;
  }
  const bx2 = bx1 + (leftIsEnd ? 0 : botExtLeftPx) + botSpanPx + (rightIsEnd ? 0 : botExtRightPx);
  doc.line(bx1, row1Y, bx2, row1Y);
  if (rightIsEnd) {
    doc.line(bx2, row1Y, bx2 + botHookPx * 0.15, row1Y + botHookPx * 0.5);
  }

  // Label — LARGER FONT
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text(`حديد سفلي مستقيم: ${continuousBotBars}Φ${botDia}`, detailOx, row1Y - barRowH / 2 + 3);
  doc.setFont('helvetica', 'normal');

  // Dimensions
  const dimRow1Y = row1Y + 6;
  if (leftIsEnd) {
    drawDimLine(doc, detailOx, detailOx + botHookPx * 0.15, dimRow1Y, `${hookBotMm}`, [0, 0, 0]);
  }
  const mainStartX = leftIsEnd ? detailOx + botHookPx * 0.15 : detailOx;
  const mainEndX = bx2;
  drawDimLine(doc, mainStartX, mainEndX, dimRow1Y, `${Math.round(botTotalMm - (leftIsEnd ? hookBotMm : 0) - (rightIsEnd ? hookBotMm : 0))}`, [0, 0, 0]);
  if (rightIsEnd) {
    drawDimLine(doc, bx2, bx2 + botHookPx * 0.15, dimRow1Y, `${hookBotMm}`, [0, 0, 0]);
  }
  // Total length
  drawDimLine(doc, detailOx, rightIsEnd ? bx2 + botHookPx * 0.15 : bx2, dimRow1Y + 6, `إجمالي = ${Math.round(botTotalMm)} mm`, [180, 0, 0]);

  // ── ROW 2 (middle): Bent bar (if exists) ──
  if (hasBentBars && bentBarsCount > 0) {
    const row2Y = detailStartY + barRowH + barRowH / 2;
    // Single color (black) for all rebar detailing
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);

    const seg1Px = bentSeg1Mm * detailScl;
    const diagPx = bentDiagMm * detailScl * 0.5;
    const seg3Px = bentSeg3Mm * detailScl;
    const seg5Px = bentSeg5Mm * detailScl;
    const riseH  = barRowH * 0.5;

    const mx1 = detailOx;
    const mx2 = mx1 + seg1Px;
    const mx3 = mx2 + diagPx;
    const mx4 = mx3 + seg3Px;
    const mx5 = mx4 + diagPx;
    const mx6 = mx5 + seg5Px;

    // Draw bent bar shape
    doc.line(mx1, row2Y - riseH / 2, mx2, row2Y - riseH / 2);
    doc.line(mx2, row2Y - riseH / 2, mx3, row2Y + riseH / 2);
    doc.line(mx3, row2Y + riseH / 2, mx4, row2Y + riseH / 2);
    doc.line(mx4, row2Y + riseH / 2, mx5, row2Y - riseH / 2);
    doc.line(mx5, row2Y - riseH / 2, mx6, row2Y - riseH / 2);

    // Label — LARGER FONT
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(0);
    doc.text(`حديد مكسح: ${bentBarsCount}Φ${botDia}`, detailOx, row2Y - barRowH / 2 + 3);
    doc.setFont('helvetica', 'normal');

    // Segment dimensions — LARGER FONT
    const dimBentAbove = row2Y - riseH / 2 - 5;
    const dimBentBelow = row2Y + riseH / 2 + 5;
    drawDimLine(doc, mx1, mx2, dimBentAbove, `L1=${Math.round(bentSeg1Mm)}`, [0, 0, 0]);
    drawDimLine(doc, mx2, mx3, dimBentBelow, `D=${Math.round(bentDiagMm)}`, [0, 0, 0]);
    drawDimLine(doc, mx3, mx4, dimBentBelow, `L2=${Math.round(bentSeg3Mm)}`, [0, 0, 0]);
    drawDimLine(doc, mx4, mx5, dimBentBelow, `D=${Math.round(bentDiagMm)}`, [0, 0, 0]);
    drawDimLine(doc, mx5, mx6, dimBentAbove, `L3=${Math.round(bentSeg5Mm)}`, [0, 0, 0]);

    // Angle labels — larger
    doc.setFontSize(5);
    doc.setTextColor(0);
    doc.text('45°', (mx2 + mx3) / 2 - 2, row2Y);
    doc.text('45°', (mx4 + mx5) / 2 - 2, row2Y);

    // Total length BELOW the bent bar drawing
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.text(`إجمالي المكسح ≈ ${Math.round(bentTotalMm)} mm`, (mx1 + mx6) / 2 - 15, row2Y + riseH / 2 + 14);
    doc.setFont('helvetica', 'normal');
  }

  // ── ROW 3 (top): Top straight bar ──
  const row3Y = detailStartY + barRowH / 2;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);

  const topExtLeftPx  = leftIsEnd  ? hookTopMm * detailScl * 0.3 : (leftExtMm + colWidthMm / 2) * detailScl;
  const topExtRightPx = rightIsEnd ? hookTopMm * detailScl * 0.3 : (rightExtMm + colWidthMm / 2) * detailScl;
  const topSpanPx     = spanMm * detailScl;

  const tx1 = detailOx;
  const tx2 = tx1 + topExtLeftPx + topSpanPx + topExtRightPx;

  if (leftIsEnd) {
    doc.line(tx1, row3Y - hookTopMm * detailScl * 0.15, tx1 + hookTopMm * detailScl * 0.1, row3Y);
    doc.line(tx1 + hookTopMm * detailScl * 0.1, row3Y, tx2, row3Y);
  } else {
    doc.line(tx1, row3Y, tx2, row3Y);
  }
  if (rightIsEnd) {
    doc.line(tx2 - hookTopMm * detailScl * 0.1, row3Y, tx2, row3Y - hookTopMm * detailScl * 0.15);
  }

  // Label — LARGER FONT
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text(`حديد علوي: ${unifiedTopBars}Φ${topDia}`, detailOx, row3Y - barRowH / 2 + 3);
  doc.setFont('helvetica', 'normal');

  // Dimensions
  const dimTopY = row3Y + 6;
  if (!leftIsEnd) {
    drawDimLine(doc, tx1, tx1 + (leftExtMm + colWidthMm / 2) * detailScl, dimTopY, `L/5=${Math.round(leftExtMm)}`, [0, 0, 0]);
  } else {
    drawDimLine(doc, tx1, tx1 + hookTopMm * detailScl * 0.3, dimTopY, `hook=${hookTopMm}`, [0, 0, 0]);
  }
  const topMidStart = leftIsEnd ? tx1 + hookTopMm * detailScl * 0.3 : tx1 + (leftExtMm + colWidthMm / 2) * detailScl;
  const topMidEnd = rightIsEnd ? tx2 - hookTopMm * detailScl * 0.3 : tx2 - (rightExtMm + colWidthMm / 2) * detailScl;
  drawDimLine(doc, topMidStart, topMidEnd, dimTopY, `span=${Math.round(spanMm)}`, [0, 0, 0]);
  if (!rightIsEnd) {
    drawDimLine(doc, topMidEnd, tx2, dimTopY, `L/5=${Math.round(rightExtMm)}`, [0, 0, 0]);
  } else {
    drawDimLine(doc, tx2 - hookTopMm * detailScl * 0.3, tx2, dimTopY, `hook=${hookTopMm}`, [0, 0, 0]);
  }
  // Total
  drawDimLine(doc, tx1, tx2, dimTopY + 6, `إجمالي = ${Math.round(topTotalMm)} mm`, [180, 0, 0]);
}

// =================== BUILDING CROSS-SECTION ELEVATION (EXPORT-4) ===================

function drawBuildingElevation(
  doc: jsPDF,
  stories: Story[],
  columns: Column[],
  beams: Beam[],
  slabs: Slab[],
  w: number, h: number,
  config: Partial<TitleBlockConfig>,
) {
  drawSheetBorder(doc, w, h);

  const totalH = stories.reduce((s, st) => s + st.height, 0);
  const drawableH = h - 80;
  const drawableW = w - 120;
  const scaleV = drawableH / totalH;

  // Unique X positions for columns
  const colXs = [...new Set(columns.filter(c => !c.isRemoved).map(c => c.x))].sort((a, b) => a - b);
  const minColX = Math.min(...colXs);
  const maxColX = Math.max(...colXs);
  const rangeX = maxColX - minColX || 1;
  const scaleH = drawableW / (rangeX * 1000);

  const ox = 60;
  const baseY = h - 50;

  const txE = (xm: number) => ox + (xm - minColX) * 1000 * scaleH;
  const tyE = (elev: number) => baseY - elev * scaleV;

  // Draw each story
  let elevation = 0;
  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    const y1 = tyE(elevation);
    const y2 = tyE(elevation + story.height);
    const storyH = story.height;

    // Slab line
    doc.setDrawColor(0);
    doc.setLineWidth(LINE_WEIGHTS.STRUCTURAL_ELEMENT);
    doc.line(txE(minColX) - 10, y2, txE(maxColX) + 10, y2);

    // Slab fill
    doc.setFillColor(220, 220, 220);
    doc.rect(txE(minColX) - 5, y2, txE(maxColX) - txE(minColX) + 10, 2, 'F');

    // Beams (simplified as rectangles below slab)
    const storyBeams = beams.filter(b => b.storyId === story.id);
    for (const bm of storyBeams) {
      const bx1 = txE(bm.x1);
      const bx2 = txE(bm.x2);
      const beamDepth = bm.h * scaleV;
      doc.setFillColor(200, 200, 200);
      doc.rect(Math.min(bx1, bx2), y2, Math.abs(bx2 - bx1), Math.min(beamDepth, 6), 'FD');
    }

    // Columns in this story
    for (const cx of colXs) {
      const col = columns.find(c => !c.isRemoved && c.storyId === story.id && Math.abs(c.x - cx) < 0.01);
      const colW = col ? col.b * scaleH : 5;
      const x = txE(cx);
      doc.setFillColor(180, 180, 180);
      doc.rect(x - colW / 2, y2, colW, y1 - y2, 'FD');
    }

    // Story label on left
    doc.setFontSize(5);
    doc.setFont('helvetica', 'bold');
    doc.text(story.label, 15, (y1 + y2) / 2 + 1);

    // Height dimension on left
    doc.setFontSize(4);
    doc.setFont('helvetica', 'normal');
    doc.setDrawColor(0);
    doc.setLineWidth(LINE_WEIGHTS.DIMENSION);
    const dimX = 35;
    doc.line(dimX, y1, dimX, y2);
    doc.line(dimX - 1.5, y1, dimX + 1.5, y1);
    doc.line(dimX - 1.5, y2, dimX + 1.5, y2);
    doc.text(`${(storyH / 1000).toFixed(1)}m`, dimX + 2, (y1 + y2) / 2);

    // Elevation label on right
    const rightX = txE(maxColX) + 25;
    doc.text(`+${(elevation / 1000).toFixed(2)}`, rightX, y1 + 1);

    elevation += storyH;
  }

  // Top elevation
  doc.text(`+${(elevation / 1000).toFixed(2)}`, txE(maxColX) + 25, tyE(elevation) + 1);

  // Base line
  doc.setLineWidth(LINE_WEIGHTS.STRUCTURAL_ELEMENT);
  doc.line(txE(minColX) - 15, baseY, txE(maxColX) + 15, baseY);
  // Ground hatching
  for (let gx = txE(minColX) - 15; gx < txE(maxColX) + 15; gx += 3) {
    doc.line(gx, baseY, gx - 2, baseY + 3);
  }

  // Column labels at bottom
  for (let ci = 0; ci < colXs.length; ci++) {
    doc.setFontSize(5);
    doc.setFont('helvetica', 'bold');
    doc.text(`C${ci + 1}`, txE(colXs[ci]) - 2, baseY + 8);
  }

  // Total height dimension
  const totalDimX = txE(maxColX) + 40;
  doc.setLineWidth(LINE_WEIGHTS.DIMENSION);
  doc.line(totalDimX, baseY, totalDimX, tyE(elevation));
  doc.line(totalDimX - 1.5, baseY, totalDimX + 1.5, baseY);
  doc.line(totalDimX - 1.5, tyE(elevation), totalDimX + 1.5, tyE(elevation));
  doc.setFontSize(5);
  doc.text(`${(elevation / 1000).toFixed(1)}m`, totalDimX + 3, (baseY + tyE(elevation)) / 2);

  // Section indicator
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('SECTION A-A', ox, 20);

  drawTitleBlockISO(doc, w, h, {
    ...defaultTitleBlockConfig,
    ...config,
    drawingTitle: 'BUILDING CROSS-SECTION ELEVATION',
    drawingSubTitle: 'Section A-A',
    drawingNumber: 'S-EL-01',
    sheetNo: '1',
    date: new Date().toLocaleDateString(),
    scale: `1:${Math.round(totalH / drawableH)}`,
  } as TitleBlockConfig);
}

// =================== MAIN EXPORT FUNCTION ===================

export function generateConstructionSheets(
  slabs: Slab[],
  beams: Beam[],
  columns: Column[],
  beamDesigns: BeamDesignData[],
  colDesigns: ColDesignData[],
  slabDesigns: SlabDesignData[],
  projectName: string = 'Structural Design Studio',
  options?: ExportOptions,
  returnDoc: boolean = false,
): jsPDF {
  const w = 420;
  const h = 297;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [w, h] });
  const register = new DrawingRegister();

  const floorCode = options?.floorCode || 'GF';
  const storyLabel = options?.storyLabel || '';
  const fc = options?.titleBlockConfig?.fc || 28;
  const fy = options?.titleBlockConfig?.fy || 420;
  const date = new Date().toLocaleDateString();

  const tbBase: Partial<TitleBlockConfig> = {
    ...defaultTitleBlockConfig,
    ...options?.titleBlockConfig,
    projectName,
    date,
    fc, fy,
  };

  // ── SHEET ZONES (A3 = 420 × 297mm) ──
  // Drawing zone: x=15..245 (230mm wide), y=15..230 (215mm tall)
  // Table zone:   x=250..405 (155mm wide), y=15..230
  // Legend zone:  x=15..80, y=232..280
  // Title block:  bottom-right (handled by drawTitleBlockISO)
  const DRAW_ZONE = { x: 15, y: 15, w: 230, h: 215 };
  const TABLE_ZONE = { x: 252, y: 15 };
  const TABLE_WIDTH = 153;

  // Compute plan extents
  const allX = slabs.flatMap(s => [s.x1, s.x2]);
  const allY = slabs.flatMap(s => [s.y1, s.y2]);
  if (allX.length === 0) return doc;

  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const modelW = maxX - minX;
  const modelH = maxY - minY;
  const mmPerM = Math.min(DRAW_ZONE.w / modelW, DRAW_ZONE.h / modelH) * 0.85;
  const planOffsetX = DRAW_ZONE.x + (DRAW_ZONE.w - modelW * mmPerM) / 2;
  const planOffsetY = DRAW_ZONE.y + (DRAW_ZONE.h - modelH * mmPerM) / 2;
  const tx = (x: number) => (x - minX) * mmPerM + planOffsetX;
  const ty = (y: number) => (maxY - y) * mmPerM + planOffsetY;

  const gridX = [...new Set(allX)].sort((a, b) => a - b);
  const gridY = [...new Set(allY)].sort((a, b) => a - b);
  const scaleText = `1:${Math.round(1000 / mmPerM)}`;

  // Helper: draw plan grid using ISO standard
  function drawPlanGridISO() {
    drawGridSystem(doc, gridX, gridY, tx, ty, minX, maxX, minY, maxY);
  }

  function drawColumnsOnPlan() {
    for (const c of columns) {
      if (c.isRemoved) continue;
      // Draw columns with actual B×H dimensions
      const hw = (c.b / 1000) * mmPerM / 2;
      const hh = (c.h / 1000) * mmPerM / 2;
      doc.setFillColor(0, 0, 0);
      doc.setDrawColor(0);
      doc.setLineWidth(0.3);
      doc.rect(tx(c.x) - hw, ty(c.y) - hh, hw * 2, hh * 2, 'FD');
    }
  }

  // ========== SHEET 1: BEAM LAYOUT PLAN ==========
  const bsDwg = makeDrawingNumber(floorCode, 'BS', 1);
  register.add(bsDwg, `Beam Layout Plan — ${storyLabel || 'All'}`, storyLabel);

  drawSheetBorder(doc, w, h);
  drawPlanGridISO();
  drawColumnsOnPlan();

  // Beams drawn from column face to column face
  for (const b of beams) {
    // Find columns at beam ends for face-to-face drawing
    const fromCol = columns.find(c => c.id === b.fromCol || (Math.abs(c.x - b.x1) < 0.01 && Math.abs(c.y - b.y1) < 0.01));
    const toCol = columns.find(c => c.id === b.toCol || (Math.abs(c.x - b.x2) < 0.01 && Math.abs(c.y - b.y2) < 0.01));
    
    const isHoriz = Math.abs(b.y1 - b.y2) < 0.01;
    const beamThickPx = Math.max((b.b / 1000) * mmPerM, 2);
    
    // Calculate face-to-face coordinates
    let bx1 = tx(b.x1);
    let by1 = ty(b.y1);
    let bx2 = tx(b.x2);
    let by2 = ty(b.y2);
    
    if (fromCol) {
      if (isHoriz) bx1 = tx(b.x1) + (fromCol.b / 1000) * mmPerM / 2;
      else by1 = ty(b.y1) - (fromCol.h / 1000) * mmPerM / 2;
    }
    if (toCol) {
      if (isHoriz) bx2 = tx(b.x2) - (toCol.b / 1000) * mmPerM / 2;
      else by2 = ty(b.y2) + (toCol.h / 1000) * mmPerM / 2;
    }

    // Draw beam as shaded rectangle
    doc.setFillColor(180, 210, 180);
    doc.setDrawColor(0, 100, 0);
    doc.setLineWidth(0.3);
    if (isHoriz) {
      doc.rect(Math.min(bx1, bx2), by1 - beamThickPx / 2, Math.abs(bx2 - bx1), beamThickPx, 'FD');
    } else {
      doc.rect(bx1 - beamThickPx / 2, Math.min(by1, by2), beamThickPx, Math.abs(by2 - by1), 'FD');
    }

    // Label next to beam — LARGER FONT
    const mx = (bx1 + bx2) / 2;
    const my = (by1 + by2) / 2;
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 80, 0);
    const labelOffset = isHoriz ? -beamThickPx / 2 - 4 : beamThickPx / 2 + 2;
    if (isHoriz) {
      doc.text(`${b.id}`, mx - 4, my + labelOffset);
    } else {
      doc.text(`${b.id}`, bx1 + labelOffset, my);
    }
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
  }

  // Beam schedule table — updated column names with sub-columns
  const formatRebar = (bars: number, dia: number) => `${bars}@${dia}mm`;
  autoTable(doc, {
    startY: TABLE_ZONE.y + 5,
    margin: { left: TABLE_ZONE.x },
    tableWidth: TABLE_WIDTH,
    head: [
      [
        { content: 'الجسر', rowSpan: 2 },
        { content: 'B mm', rowSpan: 2 },
        { content: 'H mm', rowSpan: 2 },
        { content: 'التسليح السفلي', colSpan: 2 },
        { content: 'التسليح العلوي', colSpan: 2 },
        { content: 'الكانات', rowSpan: 2 },
      ],
      ['مستقيم', 'مكسح', 'مستقيم', 'مكسح'],
    ],
    body: beamDesigns.map(d => {
      const beam = beams.find(b => b.id === d.beamId);
      const totalBot = d.flexMid.bars;
      const hasBent = totalBot >= 4;
      const bentCount = hasBent ? Math.min(2, Math.floor(totalBot / 2)) : 0;
      const straightBot = totalBot - bentCount;
      const topBars = Math.max(d.flexLeft.bars, d.flexRight.bars);
      return [
        d.beamId,
        `${beam?.b ?? ''}`,
        `${beam?.h ?? ''}`,
        formatRebar(straightBot, d.flexMid.dia),
        bentCount > 0 ? formatRebar(bentCount, d.flexMid.dia) : '—',
        formatRebar(topBars, Math.max(d.flexLeft.dia, d.flexRight.dia)),
        bentCount > 0 ? formatRebar(bentCount, d.flexMid.dia) : '—',
        d.shear.stirrups,
      ];
    }),
    styles: { fontSize: 6.5, cellPadding: 1.5 },
    headStyles: { fillColor: [0, 0, 0], fontSize: 6.5 },
  });

  // Drawing zone border (light)
  doc.setDrawColor(200);
  doc.setLineWidth(0.15);
  doc.rect(DRAW_ZONE.x - 1, DRAW_ZONE.y - 1, DRAW_ZONE.w + 2, DRAW_ZONE.h + 2);

  // Table zone title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0);
  doc.text('BEAM SCHEDULE', TABLE_ZONE.x, TABLE_ZONE.y + 2);
  doc.setFont('helvetica', 'normal');

  drawLegendBox(doc, 15, h - 70);
  drawScaleBar(doc, DRAW_ZONE.x + DRAW_ZONE.w / 2 - 20, h - 70, Math.round(1000 / mmPerM));

  drawTitleBlockISO(doc, w, h, {
    ...tbBase,
    drawingTitle: 'BEAM LAYOUT PLAN',
    drawingSubTitle: storyLabel || 'All Floors',
    drawingNumber: bsDwg,
    sheetNo: '1',
    scale: scaleText,
  } as TitleBlockConfig);

  // ========== SHEET 2: COLUMN LAYOUT ==========
  const csDwg = makeDrawingNumber(floorCode, 'CS', 1);
  register.add(csDwg, `Column Layout Plan — ${storyLabel || 'All'}`, storyLabel);

  doc.addPage([w, h], 'landscape');
  drawSheetBorder(doc, w, h);
  drawPlanGridISO();

  for (const c of columns) {
    if (c.isRemoved) continue;
    const hw = (c.b / 1000) * mmPerM / 2;
    const hh = (c.h / 1000) * mmPerM / 2;
    // Draw column as filled rectangle with actual dimensions
    doc.setFillColor(60, 60, 60);
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(tx(c.x) - hw, ty(c.y) - hh, hw * 2, hh * 2, 'FD');
    // Column name — LARGER FONT
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(0);
    doc.text(c.id, tx(c.x) + hw + 2, ty(c.y) + 2);
    // Column dimensions label
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.text(`${c.b}×${c.h}`, tx(c.x) + hw + 2, ty(c.y) + 6);
  }

  // Column schedule — in TABLE ZONE
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('COLUMN SCHEDULE', TABLE_ZONE.x, TABLE_ZONE.y + 2);
  doc.setFont('helvetica', 'normal');

  autoTable(doc, {
    startY: TABLE_ZONE.y + 5,
    margin: { left: TABLE_ZONE.x },
    tableWidth: TABLE_WIDTH,
    head: [['العمود', 'B mm', 'H mm', 'التسليح', 'الكانات']],
    body: colDesigns.map(c => [
      c.id,
      `${c.b}`,
      `${c.h}`,
      `${c.design.bars}@${c.design.dia}mm`,
      c.design.stirrups,
    ]),
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [0, 0, 0], fontSize: 7 },
  });

  // ── GROUPED COLUMN CROSS-SECTIONS (unique rebar patterns) ──
  // Group columns by identical b, h, bars, dia, stirrups
  const colPatternMap = new Map<string, ColDesignData[]>();
  for (const cd of colDesigns) {
    const key = `${cd.b}_${cd.h}_${cd.design.bars}_${cd.design.dia}_${cd.design.stirrups}`;
    if (!colPatternMap.has(key)) colPatternMap.set(key, []);
    colPatternMap.get(key)!.push(cd);
  }

  const patternEntries = [...colPatternMap.entries()];
  const secStartY = (doc as any).lastAutoTable?.finalY ?? (TABLE_ZONE.y + 60);
  const colSecW = 50;
  const colSecH = 55;
  const colsPerRow = Math.floor(TABLE_WIDTH / colSecW);

  let secIdx = 0;
  for (const [, group] of patternEntries) {
    const rep = group[0]; // Representative column
    const row = Math.floor(secIdx / colsPerRow);
    const col = secIdx % colsPerRow;
    const sx = TABLE_ZONE.x + col * colSecW;
    const sy = secStartY + 10 + row * (colSecH + 8);

    // Draw column cross-section
    const scl = Math.min((colSecW - 8) / rep.b, (colSecH - 20) / rep.h);
    const rectW = rep.b * scl;
    const rectH = rep.h * scl;
    const rx = sx + (colSecW - rectW) / 2;
    const ry = sy + 14;

    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
    doc.rect(rx, ry, rectW, rectH);

    // Stirrup outline
    const cover = 40 * scl;
    doc.setLineWidth(0.25);
    doc.rect(rx + cover, ry + cover, rectW - 2 * cover, rectH - 2 * cover);

    // Rebar dots
    const nBars = rep.design.bars;
    const barR = Math.max(rep.design.dia * scl / 2, 0.8);
    // Distribute bars around perimeter
    const positions: [number, number][] = [];
    if (nBars <= 4) {
      positions.push([rx + cover + barR, ry + cover + barR]);
      positions.push([rx + rectW - cover - barR, ry + cover + barR]);
      positions.push([rx + cover + barR, ry + rectH - cover - barR]);
      positions.push([rx + rectW - cover - barR, ry + rectH - cover - barR]);
    } else {
      const perSide = Math.ceil(nBars / 4);
      for (let i = 0; i < nBars && i < perSide * 4; i++) {
        const side = Math.floor(i / perSide);
        const idx = i % perSide;
        const t = perSide > 1 ? idx / (perSide - 1) : 0.5;
        const innerX1 = rx + cover + barR;
        const innerX2 = rx + rectW - cover - barR;
        const innerY1 = ry + cover + barR;
        const innerY2 = ry + rectH - cover - barR;
        if (side === 0) positions.push([innerX1 + t * (innerX2 - innerX1), innerY1]);
        else if (side === 1) positions.push([innerX2, innerY1 + t * (innerY2 - innerY1)]);
        else if (side === 2) positions.push([innerX2 - t * (innerX2 - innerX1), innerY2]);
        else positions.push([innerX1, innerY2 - t * (innerY2 - innerY1)]);
      }
    }
    doc.setFillColor(0, 0, 0);
    for (const [px, py] of positions.slice(0, nBars)) {
      (doc as any).circle(px, py, barR, 'F');
    }

    // Labels
    const colIds = group.map(g => g.id).join(', ');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    doc.text(colIds.length > 20 ? colIds.substring(0, 18) + '…' : colIds, sx + 2, sy + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4.5);
    doc.text(`${rep.b}×${rep.h}  ${rep.design.bars}@${rep.design.dia}mm`, sx + 2, sy + 8);
    doc.text(rep.design.stirrups, sx + 2, sy + 12);

    secIdx++;
  }

  // Drawing zone border
  doc.setDrawColor(200);
  doc.setLineWidth(0.15);
  doc.rect(DRAW_ZONE.x - 1, DRAW_ZONE.y - 1, DRAW_ZONE.w + 2, DRAW_ZONE.h + 2);

  drawLegendBox(doc, 15, h - 70);
  drawScaleBar(doc, DRAW_ZONE.x + DRAW_ZONE.w / 2 - 20, h - 70, Math.round(1000 / mmPerM));

  drawTitleBlockISO(doc, w, h, {
    ...tbBase,
    drawingTitle: 'COLUMN LAYOUT PLAN',
    drawingSubTitle: storyLabel || 'All Floors',
    drawingNumber: csDwg,
    sheetNo: '2',
    scale: scaleText,
  } as TitleBlockConfig);

  // ========== SHEET 3: SLAB REINFORCEMENT ==========
  const slDwg = makeDrawingNumber(floorCode, 'SL', 1);
  register.add(slDwg, `Slab Reinforcement Plan — ${storyLabel || 'All'}`, storyLabel);

  doc.addPage([w, h], 'landscape');
  drawSheetBorder(doc, w, h);
  drawPlanGridISO();
  drawColumnsOnPlan();

  for (const s of slabs) {
    const sd = slabDesigns.find(d => d.id === s.id);
    if (!sd) continue;
    doc.setDrawColor(0, 0, 150);
    doc.setLineWidth(0.2);
    doc.rect(tx(s.x1), ty(s.y2), (s.x2 - s.x1) * mmPerM, (s.y2 - s.y1) * mmPerM);

    const cx = tx((s.x1 + s.x2) / 2);
    const cy = ty((s.y1 + s.y2) / 2);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 120);
    doc.text(s.id, cx - 2, cy - 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.text(`h=${sd.design.hUsed}`, cx - 4, cy - 1);
    doc.text(`${sd.design.shortDir.bars}Φ${sd.design.shortDir.dia}@${sd.design.shortDir.spacing}`, cx - 12, cy + 4);
    doc.text(`${sd.design.longDir.bars}Φ${sd.design.longDir.dia}@${sd.design.longDir.spacing}`, cx - 12, cy + 9);
  }
  doc.setTextColor(0);

  // Slab schedule — in TABLE ZONE
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('SLAB SCHEDULE', TABLE_ZONE.x, TABLE_ZONE.y + 2);
  doc.setFont('helvetica', 'normal');

  autoTable(doc, {
    startY: TABLE_ZONE.y + 5,
    margin: { left: TABLE_ZONE.x },
    tableWidth: TABLE_WIDTH,
    head: [['Slab', 'Lx', 'Ly', 'h', 'Type', 'Short', 'Long']],
    body: slabDesigns.map(s => [
      s.id, s.design.lx.toFixed(1), s.design.ly.toFixed(1),
      `${s.design.hUsed}`, s.design.isOneWay ? '1-Way' : '2-Way',
      `${s.design.shortDir.bars}Φ${s.design.shortDir.dia}@${s.design.shortDir.spacing}`,
      `${s.design.longDir.bars}Φ${s.design.longDir.dia}@${s.design.longDir.spacing}`,
    ]),
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [0, 0, 0], fontSize: 7 },
  });

  // Drawing zone border
  doc.setDrawColor(200);
  doc.setLineWidth(0.15);
  doc.rect(DRAW_ZONE.x - 1, DRAW_ZONE.y - 1, DRAW_ZONE.w + 2, DRAW_ZONE.h + 2);

  drawLegendBox(doc, 15, h - 70);
  drawScaleBar(doc, DRAW_ZONE.x + DRAW_ZONE.w / 2 - 20, h - 70, Math.round(1000 / mmPerM));

  drawTitleBlockISO(doc, w, h, {
    ...tbBase,
    drawingTitle: 'SLAB REINFORCEMENT PLAN',
    drawingSubTitle: storyLabel || 'All Floors',
    drawingNumber: slDwg,
    sheetNo: '3',
    scale: scaleText,
  } as TitleBlockConfig);

  // ========== SHEET 4+: BEAM LONGITUDINAL ELEVATIONS (EXPORT-3) ==========
  const devLengths = options?.devLengths || [];
  for (let i = 0; i < beamDesigns.length; i++) {
    const d = beamDesigns[i];
    const beam = beams.find(b => b.id === d.beamId);
    if (!beam) continue;

    const seDwg = makeDrawingNumber(floorCode, 'SE', i + 1);
    register.add(seDwg, `Beam ${beam.id} — Longitudinal Section`, storyLabel);

    doc.addPage([w, h], 'landscape');
    drawSheetBorder(doc, w, h);

    drawBeamElevation(doc, beam, d, 30, 30, 350, 200, devLengths, seDwg, beams);

    drawTitleBlockISO(doc, w, h, {
      ...tbBase,
      drawingTitle: `BEAM ${beam.id} — LONGITUDINAL SECTION`,
      drawingSubTitle: `${beam.b}×${beam.h}mm, Span ${beam.length.toFixed(2)}m`,
      drawingNumber: seDwg,
      sheetNo: `${4 + i}`,
      scale: '1:25',
    } as TitleBlockConfig);
  }

  if (returnDoc) {
    return doc;
  }
  doc.save(`${projectName}_${floorCode}_Construction.pdf`);
  return doc;
}
