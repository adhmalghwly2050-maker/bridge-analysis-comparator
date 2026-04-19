/**
 * Beam utilities: merge collinear beams and intersect (auto-detect beam-on-beam).
 */

import type { Beam, Column } from './structuralEngine';

const TOLERANCE = 0.05; // 5cm tolerance for alignment

function createMergedBeamId(beams: Beam[]): string {
  const maxBeamNumber = beams.reduce((max, beam) => {
    const match = /^B(\d+)$/i.exec(beam.id);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `B${maxBeamNumber + 1}`;
}

/**
 * Check if two beams are collinear (on the same line and touching/overlapping).
 */
function areCollinear(a: Beam, b: Beam): boolean {
  if (a.direction !== b.direction) return false;

  if (a.direction === 'horizontal') {
    // Same Y coordinate
    if (Math.abs(a.y1 - b.y1) > TOLERANCE) return false;
    // Must be touching or overlapping on X axis
    const aMin = Math.min(a.x1, a.x2);
    const aMax = Math.max(a.x1, a.x2);
    const bMin = Math.min(b.x1, b.x2);
    const bMax = Math.max(b.x1, b.x2);
    return aMax >= bMin - TOLERANCE && bMax >= aMin - TOLERANCE;
  } else {
    // Same X coordinate
    if (Math.abs(a.x1 - b.x1) > TOLERANCE) return false;
    const aMin = Math.min(a.y1, a.y2);
    const aMax = Math.max(a.y1, a.y2);
    const bMin = Math.min(b.y1, b.y2);
    const bMax = Math.max(b.y1, b.y2);
    return aMax >= bMin - TOLERANCE && bMax >= aMin - TOLERANCE;
  }
}

/**
 * Merge a set of collinear beams into one combined beam.
 */
function mergeBeamGroup(group: Beam[]): Beam {
  const dir = group[0].direction;
  const first = group[0];

  if (dir === 'horizontal') {
    const allX = group.flatMap(b => [b.x1, b.x2]);
    const x1 = Math.min(...allX);
    const x2 = Math.max(...allX);
    const y = group[0].y1;
    return {
      ...first,
      id: group.map(b => b.id).join('+'),
      x1, y1: y, x2, y2: y,
      length: x2 - x1,
      fromCol: '', toCol: '',
      slabs: [...new Set(group.flatMap(b => b.slabs))],
      wallLoad: Math.max(...group.map(b => b.wallLoad ?? 0)),
    };
  } else {
    const allY = group.flatMap(b => [b.y1, b.y2]);
    const y1 = Math.min(...allY);
    const y2 = Math.max(...allY);
    const x = group[0].x1;
    return {
      ...first,
      id: group.map(b => b.id).join('+'),
      x1: x, y1, x2: x, y2,
      length: y2 - y1,
      fromCol: '', toCol: '',
      slabs: [...new Set(group.flatMap(b => b.slabs))],
      wallLoad: Math.max(...group.map(b => b.wallLoad ?? 0)),
    };
  }
}

/**
 * Find groups of collinear beams from a selection.
 * Returns array of groups (each group = array of beam IDs that can be merged).
 */
export function findCollinearGroups(beams: Beam[], selectedIds: string[]): string[][] {
  const selected = beams.filter(b => selectedIds.includes(b.id));
  const used = new Set<string>();
  const groups: string[][] = [];

  for (const beam of selected) {
    if (used.has(beam.id)) continue;
    const group = [beam];
    used.add(beam.id);

    // Find all other selected beams collinear with this one (transitive)
    let changed = true;
    while (changed) {
      changed = false;
      for (const other of selected) {
        if (used.has(other.id)) continue;
        if (group.some(g => areCollinear(g, other))) {
          group.push(other);
          used.add(other.id);
          changed = true;
        }
      }
    }

    if (group.length >= 2) {
      groups.push(group.map(b => b.id));
    }
  }

  return groups;
}

/**
 * Execute merge: given beam IDs to merge, return the merged beam and the IDs to remove.
 */
export function mergeCollinearBeams(
  beams: Beam[],
  mergeIds: string[],
): { merged: Beam; removedIds: string[] } | null {
  const group = beams.filter(b => mergeIds.includes(b.id));
  if (group.length < 2) return null;
  if (!group.every(b => b.direction === group[0].direction)) return null;

  // Sort by position
  if (group[0].direction === 'horizontal') {
    group.sort((a, b) => Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2));
  } else {
    group.sort((a, b) => Math.min(a.y1, a.y2) - Math.min(b.y1, b.y2));
  }

  const merged = mergeBeamGroup(group);
  merged.id = createMergedBeamId(beams);
  // Store original beam IDs for ETABS comparison mapping
  merged.mergedFrom = group.map(b => b.id);

  return {
    merged,
    removedIds: group.map(b => b.id),
  };
}

/**
 * Intersect: Auto-detect where beams cross each other.
 * Returns pairs of { carriedBeamId, carrierBeamId, intersectPoint }
 * 
 * Logic (like ETABS):
 * - Find all points where a horizontal beam crosses a vertical beam
 * - If there's no column at that intersection, it's a beam-on-beam connection
 * - The stiffer beam (EI/L) is the carrier, the other is carried
 */
export interface IntersectResult {
  carriedBeamId: string;
  carrierBeamId: string;
  point: { x: number; y: number };
  distanceOnCarrier: number;
}

export function detectBeamIntersections(
  beams: Beam[],
  columns: Column[],
  existingRemovedColIds: string[],
): IntersectResult[] {
  const results: IntersectResult[] = [];
  const hBeams = beams.filter(b => b.direction === 'horizontal');
  const vBeams = beams.filter(b => b.direction === 'vertical');

  for (const hb of hBeams) {
    for (const vb of vBeams) {
      // Check if they share the same Z level (or both undefined)
      if ((hb.z ?? 0) !== (vb.z ?? 0)) continue;

      // Check if vertical beam's X is within horizontal beam's X range
      const hxMin = Math.min(hb.x1, hb.x2);
      const hxMax = Math.max(hb.x1, hb.x2);
      const vx = vb.x1; // vertical beam has same x1=x2

      if (vx < hxMin + TOLERANCE || vx > hxMax - TOLERANCE) continue;

      // Check if horizontal beam's Y is within vertical beam's Y range
      const vyMin = Math.min(vb.y1, vb.y2);
      const vyMax = Math.max(vb.y1, vb.y2);
      const hy = hb.y1; // horizontal beam has same y1=y2

      if (hy < vyMin + TOLERANCE || hy > vyMax - TOLERANCE) continue;

      // Intersection point
      const ix = vx;
      const iy = hy;

      // Check if there's already a column at this point
      const hasColumn = columns.some(c =>
        !c.isRemoved &&
        !existingRemovedColIds.includes(c.id) &&
        Math.abs(c.x - ix) < TOLERANCE &&
        Math.abs(c.y - iy) < TOLERANCE
      );

      if (hasColumn) continue; // Already has a support, no beam-on-beam needed

      // Also skip if it's at the end of both beams (corner = column exists)
      const isAtHEnd = Math.abs(ix - hb.x1) < TOLERANCE || Math.abs(ix - hb.x2) < TOLERANCE;
      const isAtVEnd = Math.abs(iy - vb.y1) < TOLERANCE || Math.abs(iy - vb.y2) < TOLERANCE;
      if (isAtHEnd && isAtVEnd) continue; // Both beam endpoints → likely a column joint

      // Determine carrier vs carried by stiffness (EI/L)
      const hI = (hb.b / 1000) * Math.pow(hb.h / 1000, 3) / 12;
      const vI = (vb.b / 1000) * Math.pow(vb.h / 1000, 3) / 12;
      const hStiff = hI / hb.length;
      const vStiff = vI / vb.length;

      let carrierId: string, carriedId: string, distOnCarrier: number;
      if (hStiff >= vStiff) {
        carrierId = hb.id;
        carriedId = vb.id;
        distOnCarrier = Math.abs(ix - hb.x1);
      } else {
        carrierId = vb.id;
        carriedId = hb.id;
        distOnCarrier = Math.abs(iy - vb.y1);
      }

      results.push({
        carriedBeamId: carriedId,
        carrierBeamId: carrierId,
        point: { x: ix, y: iy },
        distanceOnCarrier: distOnCarrier,
      });
    }
  }

  return results;
}
