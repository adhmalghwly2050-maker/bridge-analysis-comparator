/**
 * Structural Report PDF Generator — Enhanced with intermediate variables,
 * development lengths, and governing load combinations (Part 8)
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Slab, Column, Beam, Frame, MatProps, SlabProps, FrameResult, FlexureResult, ShearResult, ColumnResult, SlabDesignResult, DeflectionResult, Story } from '@/lib/structuralEngine';
import { calculateDevelopmentLengths } from '@/lib/structuralEngine';

interface BeamDesignData {
  beamId: string;
  frameId: string;
  span: number;
  Mleft: number; Mmid: number; Mright: number; Vu: number;
  flexLeft: FlexureResult;
  flexMid: FlexureResult;
  flexRight: FlexureResult;
  shear: ShearResult;
  deflection: DeflectionResult;
  governingCombo?: string;
}

interface ColDesignData {
  id: string;
  b: number; h: number;
  Pu: number;
  design: ColumnResult;
  governingCombo?: string;
}

interface SlabDesignData {
  id: string;
  design: SlabDesignResult;
}

export function generateStructuralReport(
  slabs: Slab[],
  beams: Beam[],
  columns: Column[],
  frames: Frame[],
  frameResults: FrameResult[],
  beamDesigns: BeamDesignData[],
  colDesigns: ColDesignData[],
  slabDesigns: SlabDesignData[],
  mat: MatProps,
  slabProps: SlabProps,
  projectName: string = 'Structural Design Studio',
  stories: Story[] = [],
): void {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  const addTitle = (text: string, size: number = 14) => {
    if (y > 260) { doc.addPage(); y = margin; }
    doc.setFontSize(size);
    doc.setFont('helvetica', 'bold');
    doc.text(text, margin, y);
    y += size * 0.5 + 4;
  };

  const addText = (text: string, size: number = 10) => {
    if (y > 270) { doc.addPage(); y = margin; }
    doc.setFontSize(size);
    doc.setFont('helvetica', 'normal');
    doc.text(text, margin, y);
    y += size * 0.4 + 3;
  };

  const addLine = () => {
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 3;
  };

  const getStoryLabel = (storyId?: string) => {
    if (!storyId) return stories[0]?.label || '-';
    return stories.find(s => s.id === storyId)?.label || storyId;
  };

  // ========== COVER PAGE ==========
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text('STRUCTURAL', pageWidth / 2, 80, { align: 'center' });
  doc.text('DESIGN REPORT', pageWidth / 2, 95, { align: 'center' });
  doc.setFontSize(16);
  doc.setFont('helvetica', 'normal');
  doc.text(projectName, pageWidth / 2, 120, { align: 'center' });
  doc.setFontSize(12);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth / 2, 140, { align: 'center' });
  doc.text('Design Code: ACI 318-19', pageWidth / 2, 150, { align: 'center' });

  // ========== 1. PROJECT INFORMATION ==========
  doc.addPage(); y = margin;
  addTitle('1. PROJECT INFORMATION', 16); addLine();
  addText(`Project Name: ${projectName}`);
  addText(`Design Code: ACI 318-19`);
  addText(`Date: ${new Date().toLocaleDateString()}`);
  y += 5;
  addTitle('Material Properties', 12);
  addText(`Concrete Strength (f'c): ${mat.fc} MPa`);
  addText(`Steel Yield Strength (fy): ${mat.fy} MPa`);
  addText(`Stirrup Yield Strength (fyt): ${mat.fyt} MPa`);
  addText(`Unit Weight (γ): ${mat.gamma} kN/m³`);
  y += 5;
  addTitle('Slab Properties', 12);
  addText(`Thickness: ${slabProps.thickness} mm`);
  addText(`Finish Load: ${slabProps.finishLoad} kN/m²`);
  addText(`Live Load: ${slabProps.liveLoad} kN/m²`);
  addText(`Cover: ${slabProps.cover} mm`);

  // ========== 2. MODEL SUMMARY ==========
  y += 10;
  addTitle('2. MODEL SUMMARY', 16); addLine();
  addText(`Number of Stories: ${stories.length || 1}`);
  addText(`Number of Slabs: ${slabs.length}`);
  addText(`Number of Beams: ${beams.length}`);
  addText(`Number of Columns: ${columns.filter(c => !c.isRemoved).length}`);
  addText(`Number of Frames: ${frames.length}`);

  if (stories.length > 0) {
    y += 5;
    addTitle('Story Information', 12);
    autoTable(doc, {
      startY: y,
      head: [['Story', 'Height (mm)', 'Elevation (mm)']],
      body: stories.map(s => [s.label, s.height.toString(), s.elevation.toString()]),
      margin: { left: margin },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [41, 65, 94] },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // ========== 3. LOAD COMBINATIONS ==========
  doc.addPage(); y = margin;
  addTitle('3. LOAD CASES & COMBINATIONS', 16); addLine();
  addText('ACI 318-19 §5.3.1 Load Combinations:');
  addText('  1. 1.4D');
  addText('  2. 1.2D + 1.6L');
  addText('  3. 1.2D + 1.0L + 1.0W');
  addText('  4. 1.2D + 1.6W + 1.0L + 0.5Lr  (§5.3.1d)');
  addText('  5. 1.2D + 1.0L + 1.0E');
  addText('  6. 0.9D + 1.0W');
  addText('  7. 0.9D + 1.0E');
  y += 5;
  addText('Pattern loading considered per ACI 318-19 §6.4.3.3.');

  // ========== 4. BEAM LOADS ==========
  y += 10;
  addTitle('4. BEAM LOADS', 16); addLine();
  autoTable(doc, {
    startY: y,
    head: [['Story', 'Beam', 'DL (kN/m)', 'LL (kN/m)', '1.4D', '1.2D+1.6L', 'Slabs']],
    body: beams.map(b => [
      getStoryLabel(b.storyId), b.id,
      b.deadLoad.toFixed(2), b.liveLoad.toFixed(2),
      (1.4 * b.deadLoad).toFixed(2), (1.2 * b.deadLoad + 1.6 * b.liveLoad).toFixed(2),
      b.slabs.join(', '),
    ]),
    margin: { left: margin },
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 65, 94] },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ========== 5. ANALYSIS RESULTS ==========
  doc.addPage(); y = margin;
  addTitle('5. ANALYSIS RESULTS', 16); addLine();
  for (const fr of frameResults) {
    if (y > 230) { doc.addPage(); y = margin; }
    addTitle(`Frame ${fr.frameId}`, 12);
    autoTable(doc, {
      startY: y,
      head: [['Beam', 'Span (m)', 'M_left', 'M_mid', 'M_right', 'Vu (kN)']],
      body: fr.beams.map(b => [
        b.beamId, b.span.toFixed(1),
        b.Mleft.toFixed(2), b.Mmid.toFixed(2), b.Mright.toFixed(2), b.Vu.toFixed(2),
      ]),
      margin: { left: margin },
      styles: { fontSize: 8 },
      headStyles: { fillColor: [41, 65, 94] },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ========== 6. BEAM DESIGN (RPT-1: Intermediate Variables) ==========
  doc.addPage(); y = margin;
  addTitle('6. BEAM DESIGN RESULTS', 16); addLine();

  addTitle('6.1 Flexure Design — Intermediate Variables', 12);
  autoTable(doc, {
    startY: y,
    head: [['Beam', 'β₁', 'ρ_min', 'ρ_max', 'Ru (MPa)', 'ρ_used', 'εt', 'φ', 'As_req', 'As_prov', 'Gov. LC', 'Status']],
    body: beamDesigns.map(d => {
      const beam = beams.find(b => b.id === d.beamId);
      const h = beam?.h || 500;
      const b = beam?.b || 300;
      const dEff = h - 46;
      const beta1 = mat.fc <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (mat.fc - 28) / 7);
      const rhoMin = Math.max(0.25 * Math.sqrt(mat.fc) / mat.fy, 1.4 / mat.fy);
      const rhoMax = 0.85 * beta1 * mat.fc / mat.fy * 0.003 / (0.003 + 0.005);
      const Ru = d.flexMid.Mu * 1e6 / (0.9 * b * dEff * dEff);
      const aBar = Math.PI * d.flexMid.dia * d.flexMid.dia / 4;
      const AsProv = d.flexMid.bars * aBar;
      const a = AsProv * mat.fy / (0.85 * mat.fc * b);
      const c = a / beta1;
      const epsilonT = c > 0 ? 0.003 * (dEff - c) / c : 0.03;
      return [
        d.beamId, beta1.toFixed(3), rhoMin.toFixed(5), rhoMax.toFixed(5),
        Ru.toFixed(2), d.flexMid.rho?.toFixed(5) || '-',
        epsilonT.toFixed(4), epsilonT > 0.005 ? '0.90' : '0.65~0.90',
        d.flexMid.As.toFixed(0), AsProv.toFixed(0),
        d.governingCombo || d.flexMid.governingCombo || '-',
        epsilonT > 0.005 ? 'OK' : 'Check',
      ];
    }),
    margin: { left: margin },
    styles: { fontSize: 6 },
    headStyles: { fillColor: [41, 65, 94], fontSize: 6 },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  if (y > 200) { doc.addPage(); y = margin; }
  addTitle('6.2 Shear Design — Vc Simplified vs Detailed', 12);
  autoTable(doc, {
    startY: y,
    head: [['Beam', 'Vu (kN)', 'Vc_simp', 'Vc_det', 'Vc_used', 'Vs (kN)', 'Stirrups', 'Gov. LC']],
    body: beamDesigns.map(d => [
      d.beamId, d.Vu.toFixed(1),
      (d.shear.Vc_simplified || d.shear.Vc).toFixed(1),
      (d.shear.Vc_detailed || '-').toString(),
      d.shear.Vc.toFixed(1), d.shear.Vs.toFixed(1),
      d.shear.stirrups,
      d.governingCombo || '-',
    ]),
    margin: { left: margin },
    styles: { fontSize: 7 },
    headStyles: { fillColor: [41, 65, 94] },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  if (y > 200) { doc.addPage(); y = margin; }
  addTitle('6.3 Deflection Check', 12);
  autoTable(doc, {
    startY: y,
    head: [['Beam', 'δ (mm)', 'L/δ', 'Limit', 'Allowable (mm)', 'Status']],
    body: beamDesigns.map(d => [
      d.beamId, d.deflection.deflection.toFixed(1),
      d.deflection.deflectionRatio.toFixed(0),
      d.deflection.limitUsed || 'L/240',
      d.deflection.allowableDeflection.toFixed(1),
      d.deflection.isServiceable ? 'OK' : 'FAIL',
    ]),
    margin: { left: margin },
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 65, 94] },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ========== 7. COLUMN DESIGN (RPT-1: Intermediate Variables) ==========
  doc.addPage(); y = margin;
  addTitle('7. COLUMN DESIGN RESULTS', 16); addLine();

  autoTable(doc, {
    startY: y,
    head: [['Story', 'Col', 'b×h', 'Pu', 'kLu/r', 'Limit', 'Type', 'Cm', 'δns', 'Mu_mag', 'φPn', 'φMn', 'Rebar', 'Gov. LC', 'Status']],
    body: colDesigns.map(c => {
      const col = columns.find(cc => cc.id === c.id);
      const r = 0.3 * Math.min(c.b, c.h);
      const kLuR = col ? (0.78 * col.L / r) : 0;
      return [
        getStoryLabel(col?.storyId), c.id, `${c.b}×${c.h}`,
        c.Pu.toFixed(0), kLuR.toFixed(1),
        (c.design as any).slendernessLimit?.toFixed(0) || '34',
        c.design.checkSlenderness,
        (c.design as any).Cm?.toFixed(2) || '-',
        c.design.deltaNs?.toFixed(2) || '1.0',
        c.design.MuMagnified.toFixed(1),
        c.design.phiPn.toFixed(0), c.design.phiMn.toFixed(0),
        `${c.design.bars}Φ${c.design.dia}`,
        c.governingCombo || '-',
        c.design.adequate ? 'OK' : 'NG',
      ];
    }),
    margin: { left: margin },
    styles: { fontSize: 6 },
    headStyles: { fillColor: [41, 65, 94], fontSize: 6 },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ========== 8. SLAB DESIGN ==========
  doc.addPage(); y = margin;
  addTitle('8. SLAB DESIGN RESULTS', 16); addLine();

  autoTable(doc, {
    startY: y,
    head: [['Story', 'Slab', 'Lx', 'Ly', 'h', 'Wu', 'Short Dir', 'Long Dir', 'Type', 'Method']],
    body: slabDesigns.map(s => {
      const slab = slabs.find(sl => sl.id === s.id);
      return [
        getStoryLabel(slab?.storyId), s.id,
        s.design.lx.toFixed(1), s.design.ly.toFixed(1),
        s.design.hUsed.toString(), s.design.Wu.toFixed(2),
        `${s.design.shortDir.bars}Φ${s.design.shortDir.dia}@${s.design.shortDir.spacing}`,
        `${s.design.longDir.bars}Φ${s.design.longDir.dia}@${s.design.longDir.spacing}`,
        s.design.isOneWay ? 'One-Way' : 'Two-Way',
        s.design.usedApproximateMethod ? 'Marcus (Approx.)' : 'ACI',
      ];
    }),
    margin: { left: margin },
    styles: { fontSize: 7 },
    headStyles: { fillColor: [41, 65, 94] },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ========== 9. REINFORCEMENT SUMMARY ==========
  doc.addPage(); y = margin;
  addTitle('9. REINFORCEMENT SUMMARY', 16); addLine();

  addTitle('9.1 Beam Reinforcement', 12);
  autoTable(doc, {
    startY: y,
    head: [['Beam', 'b×h', 'Top Left', 'Bottom Mid', 'Top Right', 'Stirrups']],
    body: beamDesigns.map(d => {
      const beam = beams.find(b => b.id === d.beamId);
      return [
        d.beamId, `${beam?.b}×${beam?.h}`,
        `${d.flexLeft.bars}Φ${d.flexLeft.dia}`,
        `${d.flexMid.bars}Φ${d.flexMid.dia}`,
        `${d.flexRight.bars}Φ${d.flexRight.dia}`,
        d.shear.stirrups,
      ];
    }),
    margin: { left: margin },
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 65, 94] },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  if (y > 200) { doc.addPage(); y = margin; }
  addTitle('9.2 Column Reinforcement', 12);
  autoTable(doc, {
    startY: y,
    head: [['Column', 'b×h', 'ρ%', 'Rebar', 'Stirrups', 'Status']],
    body: colDesigns.map(c => [
      c.id, `${c.b}×${c.h}`,
      (c.design.rhoActual * 100).toFixed(1),
      `${c.design.bars}Φ${c.design.dia}`,
      c.design.stirrups,
      c.design.adequate ? 'OK' : 'FAIL',
    ]),
    margin: { left: margin },
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 65, 94] },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ========== 10. DEVELOPMENT LENGTHS (RPT-2) ==========
  doc.addPage(); y = margin;
  addTitle('10. DEVELOPMENT LENGTHS (ACI 318-19 Chapter 25)', 16); addLine();

  addText('Calculated per ACI 318-19 §25.4 and §25.5:');
  addText(`  f'c = ${mat.fc} MPa, fy = ${mat.fy} MPa`);
  addText('  Cover: as specified per element type, Ktr = 0 (conservative)');
  y += 5;

  // Compute for standard bar diameters
  const barDiameters = [10, 12, 16, 20, 25, 32];
  const devResults = barDiameters.map(dia =>
    calculateDevelopmentLengths(dia, mat.fy, mat.fc, 40, 150)
  );

  autoTable(doc, {
    startY: y,
    head: [['Bar Dia (mm)', 'ld_tens (mm)', 'ldh_hook (mm)', 'ld_comp (mm)', 'Lap-A (mm)', 'Lap-B (mm)', 'Lap-Col (mm)']],
    body: devResults.map(d => [
      `Φ${d.dia}`,
      d.ld_straight.toString(),
      d.ldh_standard_hook.toString(),
      d.ld_compression.toString(),
      d.lap_classA.toString(),
      d.lap_classB.toString(),
      d.lap_column.toString(),
    ]),
    margin: { left: margin },
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 65, 94] },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  addText('Notes:');
  addText('  - ψt = 1.0 (bottom bars), ψe = 1.0 (uncoated), λ = 1.0 (normal weight)');
  addText('  - Class A splice: 1.0 × ld, Class B splice: 1.3 × ld');
  addText('  - Column compression lap: max(40db, 300mm) per §25.5.5');
  addText('  - All values rounded up to nearest mm');

  doc.save(`${projectName}_Structural_Report.pdf`);
}
