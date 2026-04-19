/**
 * HTML-based Construction Drawing Generator — ISO 7200 / ACI 315-99 Compliant
 * Generates construction sheets as HTML with full Arabic text support,
 * matching the jsPDF-based constructionSheets.ts layout exactly.
 * 
 * Uses html2canvas to convert to images for PDF export or opens print dialog.
 */

import type { Slab, Column, Beam, FlexureResult, ShearResult, ColumnResult, SlabDesignResult } from '@/lib/structuralEngine';
import { getFloorCode, makeDrawingNumber, type TitleBlockConfig, type ExportOptions, type DevelopmentLengths } from './drawingStandards';

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

// ─── SVG helpers for drawing zone ───

function svgGridSystem(
  gridX: number[], gridY: number[],
  tx: (x: number) => number, ty: (y: number) => number,
  minX: number, maxX: number, minY: number, maxY: number,
): string {
  const xLabels = gridX.map((_, i) => String.fromCharCode(65 + i));
  const yLabels = gridY.map((_, i) => (i + 1).toString());
  let svg = '';
  
  // Grid lines
  for (let i = 0; i < gridX.length; i++) {
    const x = tx(gridX[i]);
    svg += `<line x1="${x}" y1="${ty(minY - 0.3)}" x2="${x}" y2="${ty(maxY + 0.3)}" stroke="#FFA03C" stroke-width="0.3" />`;
    // Grid bubble
    const by = ty(maxY + 0.3) - 30;
    svg += `<circle cx="${x}" cy="${by}" r="14" fill="white" stroke="black" stroke-width="1" />`;
    svg += `<text x="${x}" y="${by + 4}" text-anchor="middle" font-size="10" font-weight="bold" font-family="Arial">${xLabels[i]}</text>`;
  }
  for (let i = 0; i < gridY.length; i++) {
    const y = ty(gridY[i]);
    svg += `<line x1="${tx(minX - 0.3)}" y1="${y}" x2="${tx(maxX + 0.3)}" y2="${y}" stroke="#FFA03C" stroke-width="0.3" />`;
    const bx = tx(minX - 0.3) - 30;
    svg += `<circle cx="${bx}" cy="${y}" r="14" fill="white" stroke="black" stroke-width="1" />`;
    svg += `<text x="${bx}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="bold" font-family="Arial">${yLabels[i]}</text>`;
  }
  return svg;
}

function svgColumns(
  columns: Column[], tx: (x: number) => number, ty: (y: number) => number, mmPerM: number,
  filled: boolean = true, showLabels: boolean = false,
): string {
  let svg = '';
  for (const c of columns) {
    if ((c as any).isRemoved) continue;
    const hw = (c.b / 1000) * mmPerM / 2;
    const hh = (c.h / 1000) * mmPerM / 2;
    const cx = tx(c.x) - hw;
    const cy = ty(c.y) - hh;
    const fill = filled ? '#3C3C3C' : '#000';
    svg += `<rect x="${cx}" y="${cy}" width="${hw * 2}" height="${hh * 2}" fill="${fill}" stroke="black" stroke-width="1" />`;
    if (showLabels) {
      svg += `<text x="${tx(c.x) + hw + 6}" y="${ty(c.y) + 3}" font-size="8" font-weight="bold" font-family="Arial">${c.id}</text>`;
      svg += `<text x="${tx(c.x) + hw + 6}" y="${ty(c.y) + 14}" font-size="6" font-family="Arial">${c.b}×${c.h}</text>`;
    }
  }
  return svg;
}

function svgBeamsOnPlan(
  beams: Beam[], columns: Column[],
  tx: (x: number) => number, ty: (y: number) => number, mmPerM: number,
): string {
  let svg = '';
  for (const b of beams) {
    const isHoriz = Math.abs(b.y1 - b.y2) < 0.01;
    const beamThickPx = Math.max((b.b / 1000) * mmPerM, 6);
    
    let bx1 = tx(b.x1), by1 = ty(b.y1), bx2 = tx(b.x2), by2 = ty(b.y2);
    
    const fromCol = columns.find(c => c.id === (b as any).fromCol || (Math.abs(c.x - b.x1) < 0.01 && Math.abs(c.y - b.y1) < 0.01));
    const toCol = columns.find(c => c.id === (b as any).toCol || (Math.abs(c.x - b.x2) < 0.01 && Math.abs(c.y - b.y2) < 0.01));
    
    if (fromCol) {
      if (isHoriz) bx1 += (fromCol.b / 1000) * mmPerM / 2;
      else by1 -= (fromCol.h / 1000) * mmPerM / 2;
    }
    if (toCol) {
      if (isHoriz) bx2 -= (toCol.b / 1000) * mmPerM / 2;
      else by2 += (toCol.h / 1000) * mmPerM / 2;
    }

    if (isHoriz) {
      svg += `<rect x="${Math.min(bx1, bx2)}" y="${by1 - beamThickPx / 2}" width="${Math.abs(bx2 - bx1)}" height="${beamThickPx}" fill="#B4D2B4" stroke="#006400" stroke-width="1" />`;
    } else {
      svg += `<rect x="${bx1 - beamThickPx / 2}" y="${Math.min(by1, by2)}" width="${beamThickPx}" height="${Math.abs(by2 - by1)}" fill="#B4D2B4" stroke="#006400" stroke-width="1" />`;
    }

    const mx = (bx1 + bx2) / 2;
    const my = (by1 + by2) / 2;
    const labelOffset = isHoriz ? -beamThickPx / 2 - 10 : beamThickPx / 2 + 5;
    if (isHoriz) {
      svg += `<text x="${mx}" y="${my + labelOffset}" font-size="7" font-weight="bold" fill="#005000" font-family="Arial">${b.id}</text>`;
    } else {
      svg += `<text x="${mx + labelOffset}" y="${my}" font-size="7" font-weight="bold" fill="#005000" font-family="Arial">${b.id}</text>`;
    }
  }
  return svg;
}

function svgSlabsOnPlan(
  slabs: Slab[], slabDesigns: SlabDesignData[],
  tx: (x: number) => number, ty: (y: number) => number, mmPerM: number,
): string {
  let svg = '';
  for (const s of slabs) {
    const sd = slabDesigns.find(d => d.id === s.id);
    if (!sd) continue;
    const x = tx(s.x1);
    const y = ty(s.y2);
    const w = (s.x2 - s.x1) * mmPerM;
    const h = (s.y2 - s.y1) * mmPerM;
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000096" stroke-width="0.7" />`;
    
    const cx = tx((s.x1 + s.x2) / 2);
    const cy = ty((s.y1 + s.y2) / 2);
    svg += `<text x="${cx}" y="${cy - 16}" text-anchor="middle" font-size="7" font-weight="bold" fill="#000078" font-family="Arial">${s.id}</text>`;
    svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="6" fill="#000078" font-family="Arial">h=${sd.design.hUsed}</text>`;
    svg += `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="5.5" fill="#000078" font-family="Arial">${sd.design.shortDir.bars}Φ${sd.design.shortDir.dia}@${sd.design.shortDir.spacing}</text>`;
    svg += `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="5.5" fill="#000078" font-family="Arial">${sd.design.longDir.bars}Φ${sd.design.longDir.dia}@${sd.design.longDir.spacing}</text>`;
  }
  return svg;
}

function svgScaleBar(x: number, y: number, scale: number): string {
  const barUnitPx = 1000 / scale * 3; // scaled for SVG
  let svg = '';
  for (let i = 0; i < 4; i++) {
    const rx = x + i * barUnitPx;
    const fill = i % 2 === 0 ? '#000' : '#fff';
    svg += `<rect x="${rx}" y="${y}" width="${barUnitPx}" height="${8}" fill="${fill}" stroke="black" stroke-width="0.5" />`;
  }
  svg += `<text x="${x}" y="${y + 18}" font-size="5" font-family="Arial">0</text>`;
  for (let i = 1; i <= 4; i++) {
    svg += `<text x="${x + i * barUnitPx - 5}" y="${y + 18}" font-size="5" font-family="Arial">${i}m</text>`;
  }
  svg += `<text x="${x}" y="${y - 4}" font-size="6" font-family="Arial">Scale 1:${scale}</text>`;
  return svg;
}

function svgLegendBox(x: number, y: number): string {
  const w = 160;
  const h = 110;
  let svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" stroke="black" stroke-width="1" />`;
  svg += `<text x="${x + 25}" y="${y + 14}" font-size="7" font-weight="bold" font-family="Arial">LEGEND / SYMBOLS</text>`;
  svg += `<line x1="${x}" y1="${y + 18}" x2="${x + w}" y2="${y + 18}" stroke="black" stroke-width="0.5" />`;
  
  const items = [
    ['■', 'Column (RC)'],
    ['══', 'Beam (RC) — width × depth'],
    ['□', 'Slab panel'],
    ['←→', 'Dimension line'],
    ['●', 'Rebar (filled circle)'],
    ['Φ', 'Bar diameter'],
    ['@', 'Spacing (center-to-center)'],
  ];
  items.forEach(([sym, desc], i) => {
    svg += `<text x="${x + 8}" y="${y + 32 + i * 12}" font-size="6" font-family="Arial">${sym}</text>`;
    svg += `<text x="${x + 30}" y="${y + 32 + i * 12}" font-size="6" font-family="Arial">${desc}</text>`;
  });
  return svg;
}

// ─── Title Block (ISO 7200) as HTML ───

function htmlTitleBlock(config: Partial<TitleBlockConfig>): string {
  return `
  <div style="position:absolute; bottom:36px; right:36px; width:600px; height:135px; border:1.5px solid #000; font-family:Arial,sans-serif; font-size:9px; display:grid; grid-template-rows:1fr 1fr 1fr; grid-template-columns:360px 240px;">
    <!-- Row 1 Left -->
    <div style="border-bottom:1px solid #000; border-right:1px solid #000; padding:3px 6px;">
      <div style="font-weight:bold; font-size:10px;">${config.firmName || 'Structural Design Studio'}</div>
      <div>PROJECT: ${config.projectName || ''}</div>
      <div>LOCATION: ${config.projectLocation || ''}</div>
      <div>CLIENT: ${config.clientName || ''}</div>
    </div>
    <!-- Row 1 Right -->
    <div style="border-bottom:1px solid #000; padding:3px 6px; text-align:center;">
      <div style="font-weight:bold; margin-top:8px;">[STAMP / SEAL]</div>
      ${config.registrationNo ? `<div>REG. NO.: ${config.registrationNo}</div>` : ''}
    </div>
    <!-- Row 2 Left -->
    <div style="border-bottom:1px solid #000; border-right:1px solid #000; padding:3px 6px;">
      <div style="font-weight:bold; font-size:11px;">${config.drawingTitle || ''}</div>
      <div>${config.drawingSubTitle || ''}</div>
      <div>SCALE: ${config.scale || 'N.T.S.'}   SHEET: ${config.sheetNo || '1'}</div>
    </div>
    <!-- Row 2 Right -->
    <div style="border-bottom:1px solid #000; padding:3px 6px;">
      <div style="font-weight:bold;">DWG NO: ${config.drawingNumber || ''}</div>
      <div>REVISION: ${config.revision || 'R0'}</div>
      <div>DATE: ${config.date || new Date().toLocaleDateString()}</div>
    </div>
    <!-- Row 3 Left -->
    <div style="border-right:1px solid #000; padding:3px 6px; font-size:8px;">
      <div>DESIGNED: ${config.designedBy || 'ENG.'}    CHECKED: ${config.checkedBy || '-'}</div>
      <div>DRAWN: ${config.drawnBy || 'ENG.'}    APPROVED: ${config.approvedBy || '-'}</div>
    </div>
    <!-- Row 3 Right -->
    <div style="padding:3px 6px;">
      <div style="font-weight:bold;">CODE: ${config.designCode || 'ACI 318-19'}</div>
      <div>f'c=${config.fc || 28}MPa  fy=${config.fy || 420}MPa</div>
    </div>
  </div>`;
}

// ─── Sheet border ───

function htmlSheetBorder(): string {
  return `
    <div style="position:absolute; top:15px; left:15px; right:15px; bottom:15px; border:3px solid #000;"></div>
    <div style="position:absolute; top:30px; left:30px; right:30px; bottom:30px; border:1px solid #000;"></div>`;
}

// ─── Schedule tables (Arabic headers) ───

function htmlBeamScheduleTable(beams: Beam[], beamDesigns: BeamDesignData[]): string {
  const formatRebar = (bars: number, dia: number) => `${bars}@${dia}mm`;
  
  let rows = '';
  for (const d of beamDesigns) {
    const beam = beams.find(b => b.id === d.beamId);
    const totalBot = d.flexMid.bars;
    const hasBent = totalBot >= 4;
    const bentCount = hasBent ? Math.min(2, Math.floor(totalBot / 2)) : 0;
    const straightBot = totalBot - bentCount;
    const topBars = Math.max(d.flexLeft.bars, d.flexRight.bars);
    const topDia = Math.max(d.flexLeft.dia, d.flexRight.dia);
    
    rows += `<tr>
      <td>${d.beamId}</td>
      <td>${beam?.b ?? ''}</td>
      <td>${beam?.h ?? ''}</td>
      <td>${formatRebar(straightBot, d.flexMid.dia)}</td>
      <td>${bentCount > 0 ? formatRebar(bentCount, d.flexMid.dia) : '—'}</td>
      <td>${formatRebar(topBars, topDia)}</td>
      <td>${bentCount > 0 ? formatRebar(bentCount, d.flexMid.dia) : '—'}</td>
      <td>${d.shear.stirrups}</td>
    </tr>`;
  }

  return `
  <div style="font-weight:bold; font-size:11px; margin-bottom:4px; font-family:Arial;">BEAM SCHEDULE / جدول الجسور</div>
  <table style="width:100%; border-collapse:collapse; font-size:9px; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    <thead>
      <tr>
        <th rowspan="2" style="border:1px solid #000; background:#000; color:#fff; padding:3px;">الجسر</th>
        <th rowspan="2" style="border:1px solid #000; background:#000; color:#fff; padding:3px;">B mm</th>
        <th rowspan="2" style="border:1px solid #000; background:#000; color:#fff; padding:3px;">H mm</th>
        <th colspan="2" style="border:1px solid #000; background:#000; color:#fff; padding:3px;">التسليح السفلي</th>
        <th colspan="2" style="border:1px solid #000; background:#000; color:#fff; padding:3px;">التسليح العلوي</th>
        <th rowspan="2" style="border:1px solid #000; background:#000; color:#fff; padding:3px;">الكانات</th>
      </tr>
      <tr>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:2px; font-size:8px;">مستقيم</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:2px; font-size:8px;">مكسح</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:2px; font-size:8px;">مستقيم</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:2px; font-size:8px;">مكسح</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function htmlColumnScheduleTable(colDesigns: ColDesignData[]): string {
  let rows = '';
  for (const c of colDesigns) {
    rows += `<tr>
      <td>${c.id}</td>
      <td>${c.b}</td>
      <td>${c.h}</td>
      <td>${c.design.bars}@${c.design.dia}mm</td>
      <td>${c.design.stirrups}</td>
    </tr>`;
  }

  return `
  <div style="font-weight:bold; font-size:11px; margin-bottom:4px; font-family:Arial;">COLUMN SCHEDULE / جدول الأعمدة</div>
  <table style="width:100%; border-collapse:collapse; font-size:9px; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    <thead>
      <tr>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">العمود</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">B mm</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">H mm</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">التسليح</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">الكانات</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function htmlSlabScheduleTable(slabDesigns: SlabDesignData[]): string {
  let rows = '';
  for (const s of slabDesigns) {
    rows += `<tr>
      <td>${s.id}</td>
      <td>${s.design.lx.toFixed(1)}</td>
      <td>${s.design.ly.toFixed(1)}</td>
      <td>${s.design.hUsed}</td>
      <td>${s.design.isOneWay ? 'باتجاه واحد' : 'باتجاهين'}</td>
      <td>${s.design.shortDir.bars}Φ${s.design.shortDir.dia}@${s.design.shortDir.spacing}</td>
      <td>${s.design.longDir.bars}Φ${s.design.longDir.dia}@${s.design.longDir.spacing}</td>
    </tr>`;
  }

  return `
  <div style="font-weight:bold; font-size:11px; margin-bottom:4px; font-family:Arial;">SLAB SCHEDULE / جدول البلاطات</div>
  <table style="width:100%; border-collapse:collapse; font-size:9px; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    <thead>
      <tr>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">البلاطة</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">Lx</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">Ly</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">h</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">النوع</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">الاتجاه القصير</th>
        <th style="border:1px solid #000; background:#000; color:#fff; padding:3px;">الاتجاه الطويل</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ─── Column cross-section SVG ───

function svgColumnCrossSection(cd: ColDesignData, x: number, y: number, w: number, h: number): string {
  const scl = Math.min((w - 20) / cd.b, (h - 40) / cd.h);
  const rectW = cd.b * scl;
  const rectH = cd.h * scl;
  const rx = x + (w - rectW) / 2;
  const ry = y + 30;
  
  let svg = '';
  // Outer rectangle
  svg += `<rect x="${rx}" y="${ry}" width="${rectW}" height="${rectH}" fill="none" stroke="black" stroke-width="1.2" />`;
  
  // Stirrup outline
  const cover = 40 * scl;
  svg += `<rect x="${rx + cover}" y="${ry + cover}" width="${rectW - 2 * cover}" height="${rectH - 2 * cover}" fill="none" stroke="black" stroke-width="0.7" />`;
  
  // Rebar dots
  const nBars = cd.design.bars;
  const barR = Math.max(cd.design.dia * scl / 2, 2);
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
  
  for (const [px, py] of positions.slice(0, nBars)) {
    svg += `<circle cx="${px}" cy="${py}" r="${barR}" fill="black" />`;
  }
  
  // Label
  svg += `<text x="${x + 5}" y="${y + 12}" font-size="7" font-weight="bold" font-family="Arial">${cd.id}</text>`;
  svg += `<text x="${x + 5}" y="${y + 22}" font-size="6" font-family="Arial">${cd.b}×${cd.h}  ${cd.design.bars}@${cd.design.dia}mm</text>`;
  svg += `<text x="${x + 5}" y="${ry + rectH + 16}" font-size="6" font-family="Arial">${cd.design.stirrups}</text>`;
  
  return svg;
}

// ─── Main sheet generator ───

function generateSheetHTML(
  sheetContent: string,
  svgDrawingZone: string,
  svgDrawW: number,
  svgDrawH: number,
  tableContent: string,
  titleBlockConfig: Partial<TitleBlockConfig>,
  extraSvgBottom?: string,
): string {
  // A3 landscape: 420mm × 297mm → use pixel ratio for screen
  // We use 1260 × 891 px (3x mm for good resolution)
  const sheetW = 1260;
  const sheetH = 891;
  const drawZoneW = 690; // ~55% of sheet for drawing
  const drawZoneH = 645; // drawing zone height
  const tableZoneX = 756; // right side for tables
  const tableZoneW = 460;

  return `
  <div class="sheet-page" style="position:relative; width:${sheetW}px; height:${sheetH}px; background:white; overflow:hidden; page-break-after:always; font-family:'Segoe UI',Arial,Tahoma,sans-serif;">
    ${htmlSheetBorder()}
    
    <!-- Drawing Zone -->
    <div style="position:absolute; top:45px; left:45px; width:${drawZoneW}px; height:${drawZoneH}px; border:0.5px solid #ccc;">
      <svg viewBox="0 0 ${svgDrawW} ${svgDrawH}" width="${drawZoneW}" height="${drawZoneH}" xmlns="http://www.w3.org/2000/svg">
        ${svgDrawingZone}
      </svg>
    </div>
    
    <!-- Table Zone -->
    <div style="position:absolute; top:45px; left:${tableZoneX}px; width:${tableZoneW}px; max-height:${drawZoneH}px; overflow:hidden; direction:rtl;">
      ${tableContent}
    </div>
    
    <!-- Legend (bottom left) -->
    <div style="position:absolute; bottom:190px; left:45px;">
      <svg width="170" height="120" xmlns="http://www.w3.org/2000/svg">
        ${svgLegendBox(0, 0)}
      </svg>
    </div>
    
    ${extraSvgBottom || ''}
    
    <!-- Title Block -->
    ${htmlTitleBlock(titleBlockConfig)}
  </div>`;
}

// ─── Main export function ───

export function generateHTMLConstructionSheets(
  slabs: Slab[],
  beams: Beam[],
  columns: Column[],
  beamDesigns: BeamDesignData[],
  colDesigns: ColDesignData[],
  slabDesigns: SlabDesignData[],
  projectName: string = 'Structural Design Studio',
  options?: ExportOptions,
): string {
  const floorCode = options?.floorCode || 'GF';
  const storyLabel = options?.storyLabel || '';
  const fc = options?.titleBlockConfig?.fc || 28;
  const fy = options?.titleBlockConfig?.fy || 420;
  const date = new Date().toLocaleDateString();

  const tbBase: Partial<TitleBlockConfig> = {
    firmName: 'Structural Design Studio',
    projectName,
    projectLocation: '',
    clientName: '',
    drawingSubTitle: '',
    revision: 'R0',
    designedBy: 'ENG.',
    drawnBy: 'ENG.',
    checkedBy: '-',
    approvedBy: '-',
    designCode: 'ACI 318-19',
    ...options?.titleBlockConfig,
    date,
    fc, fy,
  };

  // Compute plan extents
  const allX = slabs.flatMap(s => [s.x1, s.x2]);
  const allY = slabs.flatMap(s => [s.y1, s.y2]);
  if (allX.length === 0) return '<p>لا توجد بيانات للتصدير</p>';

  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const modelW = maxX - minX;
  const modelH = maxY - minY;

  // SVG coordinate system - use 690×645 viewbox matching drawing zone
  const svgW = 690;
  const svgH = 645;
  const mmPerM = Math.min((svgW - 80) / modelW, (svgH - 80) / modelH) * 0.85;
  const planOffsetX = 50 + ((svgW - 80) - modelW * mmPerM) / 2;
  const planOffsetY = 40 + ((svgH - 80) - modelH * mmPerM) / 2;
  const tx = (x: number) => (x - minX) * mmPerM + planOffsetX;
  const ty = (y: number) => (maxY - y) * mmPerM + planOffsetY;

  const gridX = Array.from(new Set(allX)).sort((a, b) => a - b);
  const gridY = Array.from(new Set(allY)).sort((a, b) => a - b);
  const scaleVal = Math.round(1000 / mmPerM);
  const scaleText = `1:${scaleVal}`;

  const gridSvg = svgGridSystem(gridX, gridY, tx, ty, minX, maxX, minY, maxY);

  let sheetsHTML = '';

  // ═══════════════════════════════════════════════════
  // SHEET 1: BEAM LAYOUT PLAN
  // ═══════════════════════════════════════════════════
  const bsDwg = makeDrawingNumber(floorCode, 'BS', 1);
  const beamPlanSvg = gridSvg
    + svgColumns(columns, tx, ty, mmPerM, true, false)
    + svgBeamsOnPlan(beams, columns, tx, ty, mmPerM)
    + svgScaleBar(svgW / 2 - 60, svgH - 35, scaleVal);

  sheetsHTML += generateSheetHTML(
    'beam-layout',
    beamPlanSvg,
    svgW, svgH,
    htmlBeamScheduleTable(beams, beamDesigns),
    {
      ...tbBase,
      drawingTitle: 'BEAM LAYOUT PLAN / مخطط الجسور',
      drawingSubTitle: storyLabel || 'All Floors',
      drawingNumber: bsDwg,
      sheetNo: '1',
      scale: scaleText,
    },
  );

  // ═══════════════════════════════════════════════════
  // SHEET 2: COLUMN LAYOUT PLAN
  // ═══════════════════════════════════════════════════
  const csDwg = makeDrawingNumber(floorCode, 'CS', 1);
  const colPlanSvg = gridSvg
    + svgColumns(columns, tx, ty, mmPerM, true, true)
    + svgScaleBar(svgW / 2 - 60, svgH - 35, scaleVal);

  // Column cross-sections SVG
  const colPatternMap = new Map<string, ColDesignData[]>();
  for (const cd of colDesigns) {
    const key = `${cd.b}_${cd.h}_${cd.design.bars}_${cd.design.dia}_${cd.design.stirrups}`;
    if (!colPatternMap.has(key)) colPatternMap.set(key, []);
    colPatternMap.get(key)!.push(cd);
  }

  let colSectionsSvg = '';
  const patternEntries = Array.from(colPatternMap.entries());
  const secW = 140;
  const secH = 150;
  const colsPerRow = 3;
  let secIdx = 0;
  for (const [, group] of patternEntries) {
    const rep = group[0];
    const row = Math.floor(secIdx / colsPerRow);
    const col = secIdx % colsPerRow;
    const sx = col * secW;
    const sy = row * (secH + 15);
    colSectionsSvg += svgColumnCrossSection(rep, sx, sy, secW, secH);
    secIdx++;
  }

  const colSecSvgH = Math.ceil(patternEntries.length / colsPerRow) * (secH + 15);
  const colTableAndSections = htmlColumnScheduleTable(colDesigns)
    + `<div style="margin-top:12px;">
        <div style="font-weight:bold; font-size:10px; margin-bottom:4px; font-family:Arial;">COLUMN SECTIONS / مقاطع الأعمدة</div>
        <svg viewBox="0 0 ${colsPerRow * secW} ${colSecSvgH}" width="100%" height="${Math.min(colSecSvgH, 350)}px" xmlns="http://www.w3.org/2000/svg">
          ${colSectionsSvg}
        </svg>
      </div>`;

  sheetsHTML += generateSheetHTML(
    'column-layout',
    colPlanSvg,
    svgW, svgH,
    colTableAndSections,
    {
      ...tbBase,
      drawingTitle: 'COLUMN LAYOUT PLAN / مخطط الأعمدة',
      drawingSubTitle: storyLabel || 'All Floors',
      drawingNumber: csDwg,
      sheetNo: '2',
      scale: scaleText,
    },
  );

  // ═══════════════════════════════════════════════════
  // SHEET 3: SLAB REINFORCEMENT PLAN
  // ═══════════════════════════════════════════════════
  const slDwg = makeDrawingNumber(floorCode, 'SL', 1);
  const slabPlanSvg = gridSvg
    + svgColumns(columns, tx, ty, mmPerM, true, false)
    + svgSlabsOnPlan(slabs, slabDesigns, tx, ty, mmPerM)
    + svgScaleBar(svgW / 2 - 60, svgH - 35, scaleVal);

  sheetsHTML += generateSheetHTML(
    'slab-plan',
    slabPlanSvg,
    svgW, svgH,
    htmlSlabScheduleTable(slabDesigns),
    {
      ...tbBase,
      drawingTitle: 'SLAB REINFORCEMENT PLAN / مخطط تسليح البلاطات',
      drawingSubTitle: storyLabel || 'All Floors',
      drawingNumber: slDwg,
      sheetNo: '3',
      scale: scaleText,
    },
  );

  // ═══════════════════════════════════════════════════
  // SHEET 4: GENERAL NOTES
  // ═══════════════════════════════════════════════════
  const ntDwg = makeDrawingNumber(floorCode, 'NT', 1);
  const devLengths = options?.devLengths || [];
  
  let devLengthRows = '';
  for (const dl of devLengths) {
    devLengthRows += `<tr>
      <td>${dl.dia}</td>
      <td>${dl.ld_straight}</td>
      <td>${dl.ldh_standard_hook}</td>
      <td>${dl.ld_compression}</td>
      <td>${dl.lap_classA}</td>
      <td>${dl.lap_classB}</td>
      <td>${dl.lap_column}</td>
    </tr>`;
  }

  const generalNotesHTML = `
  <div class="sheet-page" style="position:relative; width:1260px; height:891px; background:white; overflow:hidden; page-break-after:always; font-family:'Segoe UI',Arial,Tahoma,sans-serif; direction:rtl;">
    ${htmlSheetBorder()}
    
    <div style="position:absolute; top:50px; left:50px; right:50px; bottom:200px; padding:10px;">
      <h2 style="text-align:center; font-size:16px; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:12px;">ملاحظات عامة — GENERAL NOTES</h2>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; font-size:10px;">
        <div>
          <h3 style="font-size:12px; color:#1a56db; border-right:3px solid #1a56db; padding-right:6px;">مواد البناء</h3>
          <ul style="list-style:disc; padding-right:20px; line-height:1.8;">
            <li>مقاومة الخرسانة المميزة f'c = ${fc} ميغاباسكال</li>
            <li>إجهاد خضوع حديد التسليح fy = ${fy} ميغاباسكال</li>
            <li>إجهاد خضوع حديد الكانات fyt = ${fy} ميغاباسكال</li>
            <li>الغطاء الخرساني: 40 مم للجسور والأعمدة، ${options?.titleBlockConfig?.fc ? '20' : '20'} مم للبلاطات</li>
            <li>جميع الأبعاد بالمليمتر ما لم يذكر خلاف ذلك</li>
          </ul>
          
          <h3 style="font-size:12px; color:#1a56db; border-right:3px solid #1a56db; padding-right:6px; margin-top:12px;">معايير التصميم</h3>
          <ul style="list-style:disc; padding-right:20px; line-height:1.8;">
            <li>التصميم وفق الكود الأمريكي ACI 318-19</li>
            <li>الرسومات وفق معيار ACI 315-99</li>
            <li>لوحة العنوان وفق معيار ISO 7200</li>
            <li>حالات التحميل: 1.2D + 1.6L (حرجة) | 1.4D | 0.9D + 1.0E</li>
          </ul>
        </div>
        
        <div>
          <h3 style="font-size:12px; color:#1a56db; border-right:3px solid #1a56db; padding-right:6px;">ملاحظات التنفيذ</h3>
          <ul style="list-style:disc; padding-right:20px; line-height:1.8;">
            <li>يجب التحقق من أطوال التماسك والوصلات حسب الكود</li>
            <li>يجب توفير أكبر إقصاء ممكن لعناصر الأعمدة في المناطق الحرجة</li>
            <li>لا يجوز قطع أكثر من نصف حديد التسليح عند نفس المقطع</li>
            <li>يجب أن تكون مسافة الوصل لا تقل عن ld حسب الجدول أدناه</li>
            <li>يجب فحص الخرسانة بعد 7 أيام و 28 يوماً</li>
            <li>البلاطات: تسليح أدنى في الاتجاه الرئيسي والثانوي</li>
            <li>أقصى مسافة بين الكانات في المنطقة الحرجة: d/4 أو 8db أو 300 مم (الأقل)</li>
          </ul>
        </div>
      </div>
      
      ${devLengths.length > 0 ? `
      <div style="margin-top:16px;">
        <h3 style="font-size:12px; color:#1a56db; border-right:3px solid #1a56db; padding-right:6px;">جدول أطوال التماسك (مم) — Development Lengths</h3>
        <table style="width:100%; border-collapse:collapse; font-size:9px; margin-top:6px;">
          <thead>
            <tr>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">القطر Φ</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">ld مستقيم</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">ldh خطاف</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">ld ضغط</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">وصل A</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">وصل B</th>
              <th style="border:1px solid #000; background:#000; color:#fff; padding:4px;">وصل عمود</th>
            </tr>
          </thead>
          <tbody>${devLengthRows}</tbody>
        </table>
      </div>` : ''}
    </div>
    
    ${htmlTitleBlock({
      ...tbBase,
      drawingTitle: 'GENERAL NOTES / ملاحظات عامة',
      drawingSubTitle: storyLabel || 'All Floors',
      drawingNumber: ntDwg,
      sheetNo: '4',
      scale: 'N.T.S.',
    })}
  </div>`;

  sheetsHTML += generalNotesHTML;

  // Wrap everything in a printable HTML document
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <title>${projectName} - ${floorCode} - لوحات إنشائية</title>
  <style>
    @page { size: A3 landscape; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #e0e0e0; font-family: 'Segoe UI', 'Arial', 'Tahoma', sans-serif; direction: ltr; }
    .sheet-page { margin: 10px auto; box-shadow: 0 2px 10px rgba(0,0,0,0.3); }
    table td, table th { border: 1px solid #333; padding: 3px 5px; text-align: center; }
    @media print {
      body { background: white; }
      .sheet-page { margin: 0; box-shadow: none; page-break-after: always; }
    }
  </style>
</head>
<body>
  ${sheetsHTML}
</body>
</html>`;
}

// ─── Open in new window for printing ───

export function openHTMLSheetsForPrint(
  slabs: Slab[],
  beams: Beam[],
  columns: Column[],
  beamDesigns: BeamDesignData[],
  colDesigns: ColDesignData[],
  slabDesigns: SlabDesignData[],
  projectName: string,
  options?: ExportOptions,
): void {
  const htmlContent = generateHTMLConstructionSheets(
    slabs, beams, columns, beamDesigns, colDesigns, slabDesigns, projectName, options,
  );
  
  const blob = new Blob([htmlContent], { type: 'text/html; charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const printWindow = window.open(blobUrl, '_blank');
  if (printWindow) {
    printWindow.addEventListener('load', () => {
      setTimeout(() => {
        printWindow.print();
        URL.revokeObjectURL(blobUrl);
      }, 800);
    });
  }
}
