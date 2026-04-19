// ===================== STRUCTURAL SYSTEM GENERATOR =====================
import type {
  GenerativeInput, GeneratedStructuralOption, GeneratedSection,
  StructuralSystemType,
} from './types';

function estimateSections(
  systemType: StructuralSystemType,
  maxSpan: number,
  numFloors: number,
  fc: number,
): GeneratedSection {
  let beamH: number, beamB: number, colB: number, colH: number, slabThickness: number;
  let ribWidth: number | undefined;
  let ribSpacing: number | undefined;
  let blockHeight: number | undefined;
  let toppingThickness: number | undefined;

  switch (systemType) {
    case 'solid-slab':
      beamH = Math.max(300, Math.ceil((maxSpan * 1000) / 12 / 50) * 50);
      beamB = Math.max(200, Math.ceil(beamH * 0.4 / 50) * 50);
      slabThickness = Math.max(120, Math.ceil((maxSpan * 1000) / 28 / 10) * 10);
      break;
    case 'hollow-block':
      beamH = Math.max(300, Math.ceil((maxSpan * 1000) / 12 / 50) * 50);
      beamB = Math.max(200, Math.ceil(beamH * 0.4 / 50) * 50);
      ribWidth = 120;
      ribSpacing = 520;
      toppingThickness = 50;
      if (maxSpan <= 4) blockHeight = 200;
      else if (maxSpan <= 5) blockHeight = 250;
      else if (maxSpan <= 6.5) blockHeight = 300;
      else blockHeight = 350;
      slabThickness = blockHeight + toppingThickness;
      break;
    case 'flat-slab':
      beamH = 0;
      beamB = 0;
      slabThickness = Math.max(180, Math.ceil((maxSpan * 1000) / 28 / 10) * 10);
      break;
    default:
      beamH = 400; beamB = 200; slabThickness = 150;
  }

  const loadFactor = numFloors * 1.3;
  const minColArea = (loadFactor * 200) / (0.65 * 0.8 * 0.85 * fc);
  const colDim = Math.max(300, Math.ceil(Math.sqrt(minColArea * 1000) / 50) * 50);
  colB = colDim;
  colH = colDim;

  if (systemType === 'flat-slab') {
    colB = Math.max(colDim, 400);
    colH = Math.max(colDim, 400);
  }

  return { beamB, beamH, colB, colH, slabThickness, ribWidth, ribSpacing, blockHeight, toppingThickness };
}

function generateGrid(input: GenerativeInput): { gridX: number[]; gridY: number[] } {
  if (input.gridSpacingX?.length && input.gridSpacingY?.length) {
    return { gridX: input.gridSpacingX, gridY: input.gridSpacingY };
  }
  const avgSpan = (input.spanRangeMin + input.spanRangeMax) / 2;
  const nBaysX = Math.max(2, Math.round(20 / avgSpan));
  const nBaysY = Math.max(2, Math.round(15 / avgSpan));
  return {
    gridX: Array.from({ length: nBaysX }, () => avgSpan),
    gridY: Array.from({ length: nBaysY }, () => avgSpan),
  };
}

function generateSlabsFromGrid(gridX: number[], gridY: number[]) {
  const slabs: { id: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  let idx = 1;
  let cumX = 0;
  for (let ix = 0; ix < gridX.length; ix++) {
    let cumY = 0;
    for (let iy = 0; iy < gridY.length; iy++) {
      slabs.push({ id: `GS${idx}`, x1: cumX, y1: cumY, x2: cumX + gridX[ix], y2: cumY + gridY[iy] });
      idx++;
      cumY += gridY[iy];
    }
    cumX += gridX[ix];
  }
  return slabs;
}

export function generateStructuralOptions(input: GenerativeInput): GeneratedStructuralOption[] {
  const { gridX, gridY } = generateGrid(input);
  const maxSpan = Math.max(...gridX, ...gridY);
  const slabs = input.planSlabs?.length ? input.planSlabs : generateSlabsFromGrid(gridX, gridY);

  const systems: { type: StructuralSystemType; label: string; labelAr: string }[] = [
    { type: 'solid-slab', label: 'Solid Slab with Drop Beams', labelAr: 'بلاطة مصمتة بجسور ساقطة' },
    { type: 'hollow-block', label: 'Hollow Block Slab (Hardi)', labelAr: 'بلاطة هردي (أعصاب وبلوك)' },
    { type: 'flat-slab', label: 'Flat Slab', labelAr: 'بلاطة مسطحة (فلات سلاب)' },
  ];

  const filtered = systems.filter(s => {
    if (s.type === 'flat-slab' && maxSpan > 9) return false;
    return true;
  });

  return filtered.map((sys, i) => {
    const sections = estimateSections(sys.type, maxSpan, input.numFloors, input.fc);
    return {
      id: `OPT-${i + 1}`,
      label: sys.label,
      labelAr: sys.labelAr,
      systemType: sys.type,
      sections,
      slabs: slabs.map(s => ({ ...s })),
      gridX: [...gridX],
      gridY: [...gridY],
      hasShearWalls: false,
      shearWallPositions: [],
    };
  });
}
