/**
 * Drawing Standards - ACI 315-99 / ISO 7200 Compliance
 * Shared utilities for all drawing generators
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Development length interface (mirrors structuralEngine)
export interface DevelopmentLengths {
  ld_straight: number;
  ldh_standard_hook: number;
  ld_compression: number;
  lap_classA: number;
  lap_classB: number;
  lap_column: number;
  dia: number;
  fy: number;
  fc: number;
}

// =================== TITLE BLOCK CONFIG ===================

export interface TitleBlockConfig {
  firmName: string;
  projectName: string;
  projectLocation: string;
  clientName: string;
  drawingTitle: string;
  drawingSubTitle: string;
  drawingNumber: string;
  revision: string;
  date: string;
  scale: string;
  sheetNo: string;
  designedBy: string;
  drawnBy: string;
  checkedBy: string;
  approvedBy: string;
  designCode: string;
  fc: number;
  fy: number;
  registrationNo?: string;
}

export const defaultTitleBlockConfig: Partial<TitleBlockConfig> = {
  firmName: 'Structural Design Studio',
  projectLocation: '',
  clientName: '',
  drawingSubTitle: '',
  revision: 'R0',
  designedBy: 'ENG.',
  drawnBy: 'ENG.',
  checkedBy: '-',
  approvedBy: '-',
  designCode: 'ACI 318-19',
};

// =================== LINE WEIGHTS ===================

export const LINE_WEIGHTS = {
  BORDER_OUTER: 1.0,
  BORDER_INNER: 0.35,
  STRUCTURAL_ELEMENT: 0.5,
  DIMENSION: 0.25,
  GRID: 0.13,
  SECTION_CUT: 0.7,
  CENTERLINE: 0.18,
  HIDDEN: 0.18,
  TEXT_LEADER: 0.18,
} as const;

// =================== DRAWING NUMBER SYSTEM ===================

export type FloorCode = 'B1' | 'GF' | '1F' | '2F' | '3F' | '4F' | '5F' | '6F' | '7F' | '8F' | '9F' | 'RF' | 'FD';
export type TypeCode = 'PL' | 'SE' | 'CS' | 'BS' | 'SL' | 'EL' | 'BBS' | 'NT';

export function getFloorCode(storyLabel: string, storyIndex: number): string {
  const label = storyLabel.toLowerCase();
  if (label.includes('basement') || label.includes('قبو')) return 'B1';
  if (label.includes('ground') || label.includes('أرضي')) return 'GF';
  if (label.includes('roof') || label.includes('سطح')) return 'RF';
  if (label.includes('foundation') || label.includes('أساس')) return 'FD';
  return `${storyIndex}F`;
}

export function makeDrawingNumber(floorCode: string | null, typeCode: TypeCode, seq: number): string {
  const seqStr = seq.toString().padStart(2, '0');
  if (floorCode) return `S-${floorCode}-${typeCode}-${seqStr}`;
  return `S-${typeCode}-${seqStr}`;
}

// =================== DRAWING REGISTER ===================

export class DrawingRegister {
  private register: Map<string, { title: string; floor: string; date: string }> = new Map();

  add(drawingNo: string, title: string, floor: string): void {
    this.register.set(drawingNo, { title, floor, date: new Date().toLocaleDateString() });
  }

  generateIndexSheet(doc: jsPDF, w: number, h: number, config: Partial<TitleBlockConfig>): void {
    drawSheetBorder(doc, w, h);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('DRAWING INDEX', 20, 25);

    autoTable(doc, {
      startY: 35,
      margin: { left: 20 },
      tableWidth: w - 40,
      head: [['No.', 'Drawing Number', 'Title', 'Floor', 'Date']],
      body: [...this.register.entries()].map(([no, d], i) => [
        (i + 1).toString(), no, d.title, d.floor, d.date,
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [0, 0, 0], fontSize: 7 },
    });

    drawTitleBlockISO(doc, w, h, {
      ...defaultTitleBlockConfig,
      ...config,
      drawingTitle: 'DRAWING INDEX',
      drawingSubTitle: 'List of All Drawings',
      drawingNumber: 'S-IDX-01',
      sheetNo: '1',
      date: new Date().toLocaleDateString(),
      scale: 'N.T.S.',
    } as TitleBlockConfig);
  }

  getEntries() { return this.register; }
}

// =================== SHEET BORDER ===================

export function drawSheetBorder(doc: jsPDF, w: number, h: number): void {
  doc.setDrawColor(0);
  doc.setLineWidth(LINE_WEIGHTS.BORDER_OUTER);
  doc.rect(5, 5, w - 10, h - 10);
  doc.setLineWidth(LINE_WEIGHTS.BORDER_INNER);
  doc.rect(10, 10, w - 20, h - 20);
}

// =================== ISO 7200 TITLE BLOCK ===================

export function drawTitleBlockISO(doc: jsPDF, sheetW: number, sheetH: number, config: TitleBlockConfig): void {
  const tbW = 200;
  const tbH = 45;
  const tbX = sheetW - tbW - 12;
  const tbY = sheetH - tbH - 12;

  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.rect(tbX, tbY, tbW, tbH);

  // Vertical divider: left 120mm, right 80mm
  const divX = tbX + 120;
  doc.line(divX, tbY, divX, tbY + tbH);

  // Horizontal rows: 3 rows of 15mm each
  doc.line(tbX, tbY + 15, tbX + tbW, tbY + 15);
  doc.line(tbX, tbY + 30, tbX + tbW, tbY + 30);

  doc.setFontSize(6);
  doc.setFont('helvetica', 'bold');

  // Row 1 - Left: Firm/Project/Location/Client
  doc.text(config.firmName || '', tbX + 2, tbY + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5);
  doc.text(`PROJECT: ${config.projectName}`, tbX + 2, tbY + 8);
  doc.text(`LOCATION: ${config.projectLocation || ''}`, tbX + 2, tbY + 11);
  doc.text(`CLIENT: ${config.clientName || ''}`, tbX + 2, tbY + 14);

  // Row 1 - Right: Stamp box
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5);
  doc.text('[STAMP / SEAL]', divX + 20, tbY + 6);
  if (config.registrationNo) {
    doc.setFont('helvetica', 'normal');
    doc.text(`REG. NO.: ${config.registrationNo}`, divX + 5, tbY + 12);
  }

  // Row 2 - Left: Drawing Title/Scale/Sheet
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(config.drawingTitle, tbX + 2, tbY + 20);
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.text(config.drawingSubTitle || '', tbX + 2, tbY + 24);
  doc.text(`SCALE: ${config.scale}   SHEET: ${config.sheetNo}`, tbX + 2, tbY + 28);

  // Row 2 - Right: DWG NO/Revision/Date
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.text(`DWG NO: ${config.drawingNumber}`, divX + 5, tbY + 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5);
  doc.text(`REVISION: ${config.revision}`, divX + 5, tbY + 24);
  doc.text(`DATE: ${config.date}`, divX + 5, tbY + 28);

  // Row 3 - Left: Designed/Drawn/Checked/Approved
  doc.setFontSize(4.5);
  doc.text(`DESIGNED: ${config.designedBy}`, tbX + 2, tbY + 33);
  doc.text(`DRAWN: ${config.drawnBy}`, tbX + 2, tbY + 37);
  doc.text(`CHECKED: ${config.checkedBy}`, tbX + 50, tbY + 33);
  doc.text(`APPROVED: ${config.approvedBy}`, tbX + 50, tbY + 37);

  // Row 3 - Right: Design Code/Material
  doc.setFont('helvetica', 'bold');
  doc.text(`CODE: ${config.designCode}`, divX + 5, tbY + 33);
  doc.setFont('helvetica', 'normal');
  doc.text(`f'c=${config.fc}MPa  fy=${config.fy}MPa`, divX + 5, tbY + 37);
}

// =================== GRID SYSTEM (Alpha-Numeric) ===================

export function generateGridLabels(gridX: number[], gridY: number[]): { xLabels: string[]; yLabels: string[] } {
  return {
    xLabels: gridX.map((_, i) => String.fromCharCode(65 + i)),
    yLabels: gridY.map((_, i) => (i + 1).toString()),
  };
}

export function drawGridBubble(doc: jsPDF, x: number, y: number, label: string, radius: number = 5): void {
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  (doc as any).circle(x, y, radius, 'FD');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  const offsetX = label.length > 1 ? -2 : -1.2;
  doc.text(label, x + offsetX, y + 2);
}

export function drawGridSystem(
  doc: jsPDF,
  gridX: number[], gridY: number[],
  tx: (x: number) => number, ty: (y: number) => number,
  minX: number, maxX: number, minY: number, maxY: number,
): { xLabels: string[]; yLabels: string[] } {
  const { xLabels, yLabels } = generateGridLabels(gridX, gridY);

  // Orange transparent thin lines for column axis grid
  doc.setDrawColor(255, 160, 60);
  doc.setLineWidth(0.08);
  for (let i = 0; i < gridX.length; i++) {
    const x = gridX[i];
    doc.line(tx(x), ty(minY - 0.3), tx(x), ty(maxY + 0.3));
    drawGridBubble(doc, tx(x), ty(maxY + 0.3) - 8, xLabels[i]);
  }
  for (let i = 0; i < gridY.length; i++) {
    const y = gridY[i];
    doc.line(tx(minX - 0.3), ty(y), tx(maxX + 0.3), ty(y));
    drawGridBubble(doc, tx(minX - 0.3) - 8, ty(y), yLabels[i]);
  }

  return { xLabels, yLabels };
}

// =================== SCALE BAR ===================

export function drawScaleBar(doc: jsPDF, x: number, y: number, scale: number, numDivisions: number = 4): void {
  const barUnitMm = 1000 / scale;
  doc.setDrawColor(0);
  doc.setLineWidth(0.2);

  for (let i = 0; i < numDivisions; i++) {
    const rx = x + i * barUnitMm;
    if (i % 2 === 0) doc.setFillColor(0, 0, 0);
    else doc.setFillColor(255, 255, 255);
    doc.rect(rx, y, barUnitMm, 3, 'FD');
  }
  doc.setFontSize(4);
  doc.setTextColor(0);
  doc.text('0', x - 1, y + 6);
  for (let i = 1; i <= numDivisions; i++) {
    doc.text(`${i}m`, x + i * barUnitMm - 2, y + 6);
  }
  doc.setFontSize(5);
  doc.text(`Scale 1:${scale}`, x, y - 2);
}

// =================== LEGEND BOX ===================

export function drawLegendBox(doc: jsPDF, x: number, y: number): void {
  const w = 55;
  const h = 40;

  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);

  doc.setFontSize(5);
  doc.setFont('helvetica', 'bold');
  doc.text('LEGEND / SYMBOLS', x + 8, y + 5);
  doc.line(x, y + 7, x + w, y + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4);
  const items = [
    ['■', 'Column (RC)'],
    ['══', 'Beam (RC) — width × depth'],
    ['□', 'Slab panel'],
    ['←→', 'Dimension line'],
    ['●', 'Rebar (filled circle)'],
    ['○', 'Rebar (open - beyond cut)'],
    ['⊞', 'Stirrup / tie'],
    ['Φ', 'Bar diameter'],
    ['@', 'Spacing (center-to-center)'],
  ];

  items.forEach(([sym, desc], i) => {
    doc.text(sym, x + 3, y + 11 + i * 3.3);
    doc.text(desc, x + 10, y + 11 + i * 3.3);
  });
}

// =================== DASHED LINE ===================

export function drawDashedLine(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, dashLen: number = 2, gapLen: number = 1): void {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;
  const nx = dx / len, ny = dy / len;
  let pos = 0;
  let drawing = true;
  while (pos < len) {
    const segLen = Math.min(drawing ? dashLen : gapLen, len - pos);
    if (drawing) {
      doc.line(
        x1 + nx * pos, y1 + ny * pos,
        x1 + nx * (pos + segLen), y1 + ny * (pos + segLen)
      );
    }
    pos += segLen;
    drawing = !drawing;
  }
}

// =================== GENERAL NOTES SHEET ===================

export function generateGeneralNotesSheet(
  doc: jsPDF, w: number, h: number,
  config: TitleBlockConfig,
  devLengths: DevelopmentLengths[],
): void {
  drawSheetBorder(doc, w, h);

  let y = 20;
  const indent = 25;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('GENERAL NOTES', 20, y);
  y += 8;

  const section = (title: string) => {
    if (y > h - 60) return;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 15, y);
    y += 5;
  };
  const note = (text: string) => {
    if (y > h - 60) return;
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.text(text, indent, y);
    y += 4;
  };

  section('SECTION A — DESIGN BASIS:');
  note('A1. This structure is designed in accordance with ACI 318-19 "Building Code Requirements for Structural Concrete".');
  note('A2. Load combinations per ACI 318-19 §5.3.1.');
  note('A3. Structural analysis performed using matrix stiffness method.');
  note('A4. Pattern loading considered per ACI 318-19 §6.4.3.3.');
  y += 2;

  section('SECTION B — MATERIAL SPECIFICATIONS:');
  note(`B1. Concrete: f'c = ${config.fc} MPa (${Math.round(config.fc * 145.038)} psi), Normal weight (24 kN/m3).`);
  note(`B2. Reinforcing steel: fy = ${config.fy} MPa, Grade ${config.fy <= 420 ? '60' : '75'}, Deformed bars.`);
  note(`B3. Stirrups/Ties: fyt = ${config.fy} MPa.`);
  note('B4. Concrete cover: Beams = 40mm, Columns = 40mm, Slabs = 20mm, Footings = 75mm.');
  y += 2;

  section('SECTION C — REINFORCEMENT NOTES:');
  note('C1. All reinforcement to be placed per ACI 318-19 requirements.');
  note('C2. Development lengths per ACI 318-19 Chapter 25:');
  y += 2;

  // Development length table
  if (devLengths.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: indent },
      tableWidth: 200,
      head: [['Bar Dia (mm)', 'ld_tens (mm)', 'ldh_hook (mm)', 'ld_comp (mm)', 'Lap-A (mm)', 'Lap-B (mm)']],
      body: devLengths.map(d => [
        `Φ${d.dia}`,
        d.ld_straight.toString(),
        d.ldh_standard_hook.toString(),
        d.ld_compression.toString(),
        d.lap_classA.toString(),
        d.lap_classB.toString(),
      ]),
      styles: { fontSize: 5, cellPadding: 1.5 },
      headStyles: { fillColor: [0, 0, 0], fontSize: 5 },
    });
    y = (doc as any).lastAutoTable.finalY + 5;
  }

  note('C3. All bar splices to be Class B unless shown otherwise.');
  note('C4. Provide standard hooks at all bar ends unless shown as "CONT."');
  note('C5. Place column vertical bars on inside of ties.');
  note('C6. Maintain minimum 25mm clear space between parallel bars.');
  y += 2;

  section('SECTION D — CONSTRUCTION NOTES:');
  note('D1. Contractor to verify all dimensions on site. DO NOT SCALE DRAWINGS.');
  note('D2. Report any discrepancies immediately to the engineer of record.');
  note('D3. All concrete to be vibrated during placement. Maximum slump 100mm.');
  note('D4. Curing: minimum 7 days wet curing for all concrete elements.');
  note('D5. Formwork removal: beams and slabs min. 28 days (or as directed).');
  note('D6. No construction loads to be placed on concrete < 14 days old.');
  note('D7. Verify rebar placement and cover before concrete pour (inspection).');
  y += 2;

  section('SECTION E — ABBREVIATIONS:');
  note('T.O.S. = Top of Slab    B.O.B. = Bottom of Beam    T.O.W. = Top of Wall    EW = Each Way');
  note('CLR = Clear    SIM = Similar    TYP = Typical    UNO = Unless Noted Otherwise');
  note('N.T.S. = Not to Scale    DWG = Drawing    dia / Φ = Diameter    @ = At / Spacing');

  drawTitleBlockISO(doc, w, h, config);
}

// =================== EXPORT OPTIONS ===================

export interface ExportOptions {
  storyId?: string;
  storyLabel?: string;
  storyIndex?: number;
  totalStories?: number;
  drawingNumberBase?: string;
  floorCode?: string;
  devLengths?: DevelopmentLengths[];
  titleBlockConfig?: Partial<TitleBlockConfig>;
}
