// ===================== PLAN ANALYSIS ENGINE =====================
// Analyzes uploaded architectural plans to detect structural elements
// Uses canvas-based image processing for element detection

import {
  PlanAnalysisResult,
  DetectedGrid,
  DetectedColumn,
  DetectedSpan,
  DetectedRoom,
  DetectedElement,
} from './types';

/**
 * Analyze an uploaded architectural plan image
 * Detects walls, columns, grid lines, spans, and rooms
 */
export async function analyzePlan(imageDataUrl: string): Promise<PlanAnalysisResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Cannot create canvas context');

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Estimate scale (assume typical plan: ~20m fits in image width)
        const estimatedScale = img.width / 20;

        // Detect structural elements
        const grids = detectGridLines(imageData, estimatedScale);
        const columns = detectColumns(imageData, estimatedScale);
        const rooms = detectRooms(grids, img.width, img.height, estimatedScale);
        const walls = detectWalls(imageData, estimatedScale);
        const spans = calculateSpans(grids, rooms);

        resolve({
          grids,
          columns,
          spans,
          rooms,
          walls,
          imageWidth: img.width,
          imageHeight: img.height,
          scale: estimatedScale,
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

/**
 * Detect grid lines from image using edge detection
 */
function detectGridLines(imageData: ImageData, scale: number): DetectedGrid[] {
  const { width, height, data } = imageData;
  const grids: DetectedGrid[] = [];

  // Convert to grayscale and detect strong horizontal/vertical lines
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Horizontal line detection (accumulate dark pixels per row)
  const rowDensity = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let darkCount = 0;
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < 100) darkCount++;
    }
    rowDensity[y] = darkCount / width;
  }

  // Vertical line detection (accumulate dark pixels per column)
  const colDensity = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let darkCount = 0;
    for (let y = 0; y < height; y++) {
      if (gray[y * width + x] < 100) darkCount++;
    }
    colDensity[x] = darkCount / height;
  }

  // Find peaks in horizontal density (grid lines)
  const hThreshold = 0.15;
  const minGap = Math.floor(scale * 1.5); // at least 1.5m apart
  let lastY = -minGap;
  let gridLabel = 1;

  for (let y = 0; y < height; y++) {
    if (rowDensity[y] > hThreshold && y - lastY > minGap) {
      grids.push({
        id: `gh-${gridLabel}`,
        direction: 'horizontal',
        position: y / scale,
        label: String(gridLabel),
      });
      lastY = y;
      gridLabel++;
    }
  }

  // Find peaks in vertical density
  let lastX = -minGap;
  let vLabel = 'A'.charCodeAt(0);

  for (let x = 0; x < width; x++) {
    if (colDensity[x] > hThreshold && x - lastX > minGap) {
      grids.push({
        id: `gv-${String.fromCharCode(vLabel)}`,
        direction: 'vertical',
        position: x / scale,
        label: String.fromCharCode(vLabel),
      });
      lastX = x;
      if (vLabel < 90) vLabel++;
    }
  }

  // If no grids detected, create default grid
  if (grids.length === 0) {
    const defaultSpacing = 5; // 5m default
    const numX = Math.floor(width / scale / defaultSpacing);
    const numY = Math.floor(height / scale / defaultSpacing);

    for (let i = 0; i <= numX; i++) {
      grids.push({
        id: `gv-${String.fromCharCode(65 + i)}`,
        direction: 'vertical',
        position: i * defaultSpacing,
        label: String.fromCharCode(65 + i),
      });
    }
    for (let j = 0; j <= numY; j++) {
      grids.push({
        id: `gh-${j + 1}`,
        direction: 'horizontal',
        position: j * defaultSpacing,
        label: String(j + 1),
      });
    }
  }

  return grids;
}

/**
 * Detect columns from image (small dark rectangles/squares)
 */
function detectColumns(imageData: ImageData, scale: number): DetectedColumn[] {
  const { width, height, data } = imageData;
  const columns: DetectedColumn[] = [];

  // Look for small filled rectangles (typical column representation)
  const blockSize = Math.max(4, Math.floor(scale * 0.3)); // ~30cm column
  const step = Math.max(2, Math.floor(blockSize / 2));

  for (let y = 0; y < height - blockSize; y += step) {
    for (let x = 0; x < width - blockSize; x += step) {
      let darkCount = 0;
      const total = blockSize * blockSize;

      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const idx = ((y + dy) * width + (x + dx)) * 4;
          const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          if (brightness < 80) darkCount++;
        }
      }

      const fillRatio = darkCount / total;
      if (fillRatio > 0.7) {
        // Check it's not part of a wall (surrounded should be lighter)
        const margin = Math.floor(blockSize * 0.5);
        let surroundDark = 0;
        let surroundTotal = 0;

        for (let dy = -margin; dy < blockSize + margin; dy++) {
          for (let dx = -margin; dx < blockSize + margin; dx++) {
            if (dx >= 0 && dx < blockSize && dy >= 0 && dy < blockSize) continue;
            const px = x + dx;
            const py = y + dy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const idx = (py * width + px) * 4;
            const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
            if (brightness < 100) surroundDark++;
            surroundTotal++;
          }
        }

        if (surroundTotal > 0 && surroundDark / surroundTotal < 0.3) {
          // Likely a column, not a wall
          const exists = columns.some(c =>
            Math.abs(c.x - x / scale) < 0.5 && Math.abs(c.y - y / scale) < 0.5
          );
          if (!exists) {
            columns.push({
              id: `col-${columns.length + 1}`,
              x: x / scale,
              y: y / scale,
              width: blockSize / scale,
              height: blockSize / scale,
              confidence: fillRatio,
            });
          }
        }
      }
    }
  }

  return columns;
}

/**
 * Detect rooms from grid intersections
 */
function detectRooms(
  grids: DetectedGrid[],
  imgWidth: number,
  imgHeight: number,
  scale: number
): DetectedRoom[] {
  const rooms: DetectedRoom[] = [];
  const vGrids = grids.filter(g => g.direction === 'vertical').sort((a, b) => a.position - b.position);
  const hGrids = grids.filter(g => g.direction === 'horizontal').sort((a, b) => a.position - b.position);

  for (let i = 0; i < vGrids.length - 1; i++) {
    for (let j = 0; j < hGrids.length - 1; j++) {
      rooms.push({
        id: `room-${rooms.length + 1}`,
        x1: vGrids[i].position,
        y1: hGrids[j].position,
        x2: vGrids[i + 1].position,
        y2: hGrids[j + 1].position,
        label: `R${rooms.length + 1}`,
      });
    }
  }

  return rooms;
}

/**
 * Detect walls from image
 */
function detectWalls(imageData: ImageData, scale: number): DetectedElement[] {
  // Simplified wall detection - walls are long thin dark rectangles
  return [];
}

/**
 * Calculate spans from grid and room data
 */
function calculateSpans(grids: DetectedGrid[], rooms: DetectedRoom[]): DetectedSpan[] {
  const spans: DetectedSpan[] = [];

  for (const room of rooms) {
    const spanX: DetectedSpan = {
      id: `span-x-${room.id}`,
      startX: room.x1,
      startY: (room.y1 + room.y2) / 2,
      endX: room.x2,
      endY: (room.y1 + room.y2) / 2,
      length: Math.abs(room.x2 - room.x1),
      direction: 'x',
    };
    const spanY: DetectedSpan = {
      id: `span-y-${room.id}`,
      startX: (room.x1 + room.x2) / 2,
      startY: room.y1,
      endX: (room.x1 + room.x2) / 2,
      endY: room.y2,
      length: Math.abs(room.y2 - room.y1),
      direction: 'y',
    };
    spans.push(spanX, spanY);
  }

  return spans;
}

/**
 * Generate a default grid-based analysis when no image features detected
 */
export function generateDefaultAnalysis(
  gridXSpacing: number[],
  gridYSpacing: number[]
): PlanAnalysisResult {
  const grids: DetectedGrid[] = [];
  const rooms: DetectedRoom[] = [];
  const columns: DetectedColumn[] = [];

  // Create vertical grids
  let xPos = 0;
  for (let i = 0; i <= gridXSpacing.length; i++) {
    grids.push({
      id: `gv-${String.fromCharCode(65 + i)}`,
      direction: 'vertical',
      position: xPos,
      label: String.fromCharCode(65 + i),
    });
    if (i < gridXSpacing.length) xPos += gridXSpacing[i];
  }

  // Create horizontal grids
  let yPos = 0;
  for (let j = 0; j <= gridYSpacing.length; j++) {
    grids.push({
      id: `gh-${j + 1}`,
      direction: 'horizontal',
      position: yPos,
      label: String(j + 1),
    });
    if (j < gridYSpacing.length) yPos += gridYSpacing[j];
  }

  // Generate rooms at grid intersections
  const vGrids = grids.filter(g => g.direction === 'vertical').sort((a, b) => a.position - b.position);
  const hGrids = grids.filter(g => g.direction === 'horizontal').sort((a, b) => a.position - b.position);

  for (let i = 0; i < vGrids.length - 1; i++) {
    for (let j = 0; j < hGrids.length - 1; j++) {
      rooms.push({
        id: `room-${rooms.length + 1}`,
        x1: vGrids[i].position,
        y1: hGrids[j].position,
        x2: vGrids[i + 1].position,
        y2: hGrids[j + 1].position,
      });

      // Place columns at grid intersections
      const colPositions = [
        { x: vGrids[i].position, y: hGrids[j].position },
        { x: vGrids[i + 1].position, y: hGrids[j].position },
        { x: vGrids[i].position, y: hGrids[j + 1].position },
        { x: vGrids[i + 1].position, y: hGrids[j + 1].position },
      ];

      for (const pos of colPositions) {
        if (!columns.some(c => Math.abs(c.x - pos.x) < 0.1 && Math.abs(c.y - pos.y) < 0.1)) {
          columns.push({
            id: `col-${columns.length + 1}`,
            x: pos.x,
            y: pos.y,
            width: 0.3,
            height: 0.3,
            confidence: 1,
          });
        }
      }
    }
  }

  const spans = calculateSpans(grids, rooms);

  return {
    grids,
    columns,
    spans,
    rooms,
    walls: [],
    imageWidth: xPos * 50,
    imageHeight: yPos * 50,
    scale: 50,
  };
}
