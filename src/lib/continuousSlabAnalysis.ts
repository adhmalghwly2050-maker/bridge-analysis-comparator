/**
 * تحليل البلاطات المستمرة حسب الكود الأمريكي ACI 318-19
 * طريقة الشريحة (1 متر) في اتجاه X و Y
 * 
 * ACI 318-19 §6.5 — Approximate methods of analysis
 * Table 6.5.2: Approximate moments for continuous beams/one-way slabs
 * Table 6.5.4: Approximate shear for continuous beams/one-way slabs
 * 
 * المبدأ: نأخذ شريحة بعرض 1 متر من البلاطات المتجاورة في اتجاه معين
 * ونحللها ككمرة مستمرة باستخدام معاملات ACI 318
 */

import type { Slab, SlabProps, MatProps } from './structuralEngine';

// ===================== TYPES =====================

export interface SlabStrip {
  /** معرف الشريحة */
  id: string;
  /** اتجاه الشريحة */
  direction: 'X' | 'Y';
  /** الإحداثي الثابت (Y للشريحة في اتجاه X، X للشريحة في اتجاه Y) */
  fixedCoord: number;
  /** البلاطات في هذه الشريحة مرتبة */
  spans: SlabSpanInfo[];
}

export interface SlabSpanInfo {
  slabId: string;
  spanLength: number; // بالمتر - البعد في اتجاه الشريحة
  perpLength: number; // بالمتر - البعد العمودي على اتجاه الشريحة
  startCoord: number;
  endCoord: number;
}

export interface ContinuousSlabResult {
  stripId: string;
  direction: 'X' | 'Y';
  fixedCoord: number;
  Wu: number; // kN/m² — الحمل المحسوب
  wuPerMeter: number; // kN/m — الحمل على شريحة 1م
  spans: SpanResult[];
  /** ملخص */
  maxPositiveMoment: number;
  maxNegativeMoment: number;
  maxShear: number;
}

export interface SpanResult {
  slabId: string;
  spanLength: number;
  /** العزوم بالـ kN.m لكل متر عرض */
  Mneg_left: number;
  Mpos: number;
  Mneg_right: number;
  /** القص بالـ kN لكل متر عرض */
  Vu_left: number;
  Vu_right: number;
  /** تفاصيل الحالة الحدودية */
  leftCondition: 'continuous' | 'discontinuous' | 'integral_with_support';
  rightCondition: 'continuous' | 'discontinuous' | 'integral_with_support';
  /** تصميم التسليح */
  As_neg_left: number; // mm²/m
  As_pos: number;      // mm²/m
  As_neg_right: number; // mm²/m
  As_min: number;      // mm²/m
}

// ===================== ACI 318-19 MOMENT COEFFICIENTS (Table 6.5.2) =====================

/**
 * معاملات العزم الموجب (Mpos = coeff × Wu × Ln²)
 */
function getPositiveMomentCoeff(
  isEndSpan: boolean,
  discontinuousEndIntegral: boolean
): number {
  if (isEndSpan) {
    // بحرة طرفية
    if (discontinuousEndIntegral) {
      // الطرف غير المستمر متصل بشكل متكامل مع الركيزة
      return 1 / 14;
    }
    // الطرف غير المستمر غير مقيد
    return 1 / 11;
  }
  // بحرة داخلية
  return 1 / 16;
}

/**
 * معاملات العزم السالب (Mneg = coeff × Wu × Ln²)
 */
function getNegativeMomentCoeff(
  position: 'exterior_face' | 'interior_face_of_exterior' | 'interior'
): number {
  switch (position) {
    case 'exterior_face':
      // وجه الركيزة الخارجية (ACI Table 6.5.2)
      // إذا كان الطرف متصل بشكل متكامل: 1/24، عادي: 0 (مفصل)
      return 1 / 24;
    case 'interior_face_of_exterior':
      // الوجه الداخلي للركيزة الخارجية (بحرتان أو أكثر)
      return 1 / 10;
    case 'interior':
      // عند الركائز الداخلية
      return 1 / 11;
  }
}

/**
 * معامل القص (Vu = coeff × Wu × Ln / 2)
 * ACI 318-19 Table 6.5.4
 */
function getShearCoeff(isFirstInteriorFace: boolean): number {
  if (isFirstInteriorFace) {
    return 1.15; // 1.15 × Wu × Ln / 2
  }
  return 1.0; // Wu × Ln / 2
}

// ===================== STRIP DETECTION =====================

/**
 * تكوين شرائح البلاطات المستمرة
 * يبحث عن البلاطات المتجاورة في اتجاه X و Y
 */
export function buildContinuousStrips(slabs: Slab[]): SlabStrip[] {
  const strips: SlabStrip[] = [];
  const EPS = 0.05; // tolerance for coordinate matching
  let stripId = 1;

  // Helper: collect unique coordinate values with tolerance grouping
  function uniqueCoords(values: number[]): number[] {
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    const result: number[] = [];
    for (const v of sorted) {
      if (result.length === 0 || Math.abs(v - result[result.length - 1]) > EPS) {
        result.push(v);
      }
    }
    return result;
  }

  // ── X-direction strips ──
  // For each unique Y grid line, find slabs whose Y range contains that line,
  // then form chains of horizontally adjacent slabs
  const allYCoords = slabs.flatMap(s => [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)]);
  const yLines = uniqueCoords(allYCoords);

  // For each pair of consecutive Y lines, create a strip row
  for (let yi = 0; yi < yLines.length - 1; yi++) {
    const yLow = yLines[yi];
    const yHigh = yLines[yi + 1];
    const yMid = (yLow + yHigh) / 2;

    // Find slabs that overlap this Y band
    const bandSlabs = slabs.filter(s => {
      const sYMin = Math.min(s.y1, s.y2);
      const sYMax = Math.max(s.y1, s.y2);
      return sYMin <= yLow + EPS && sYMax >= yHigh - EPS;
    });

    if (bandSlabs.length < 2) continue;

    // Sort by X and form chains of adjacent slabs
    const sorted = [...bandSlabs].sort((a, b) => Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2));
    const chains: Slab[][] = [];
    let current: Slab[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = Math.max(current[current.length - 1].x1, current[current.length - 1].x2);
      const nextStart = Math.min(sorted[i].x1, sorted[i].x2);
      if (Math.abs(prevEnd - nextStart) < EPS) {
        current.push(sorted[i]);
      } else {
        if (current.length >= 2) chains.push(current);
        current = [sorted[i]];
      }
    }
    if (current.length >= 2) chains.push(current);

    for (const chain of chains) {
      strips.push({
        id: `SX${stripId++}`,
        direction: 'X',
        fixedCoord: yMid,
        spans: chain.map(s => ({
          slabId: s.id,
          spanLength: Math.abs(s.x2 - s.x1),
          perpLength: yHigh - yLow,
          startCoord: Math.min(s.x1, s.x2),
          endCoord: Math.max(s.x1, s.x2),
        })),
      });
    }
  }

  // ── Y-direction strips ──
  const allXCoords = slabs.flatMap(s => [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)]);
  const xLines = uniqueCoords(allXCoords);

  for (let xi = 0; xi < xLines.length - 1; xi++) {
    const xLow = xLines[xi];
    const xHigh = xLines[xi + 1];
    const xMid = (xLow + xHigh) / 2;

    const bandSlabs = slabs.filter(s => {
      const sXMin = Math.min(s.x1, s.x2);
      const sXMax = Math.max(s.x1, s.x2);
      return sXMin <= xLow + EPS && sXMax >= xHigh - EPS;
    });

    if (bandSlabs.length < 2) continue;

    const sorted = [...bandSlabs].sort((a, b) => Math.min(a.y1, a.y2) - Math.min(b.y1, b.y2));
    const chains: Slab[][] = [];
    let current: Slab[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = Math.max(current[current.length - 1].y1, current[current.length - 1].y2);
      const nextStart = Math.min(sorted[i].y1, sorted[i].y2);
      if (Math.abs(prevEnd - nextStart) < EPS) {
        current.push(sorted[i]);
      } else {
        if (current.length >= 2) chains.push(current);
        current = [sorted[i]];
      }
    }
    if (current.length >= 2) chains.push(current);

    for (const chain of chains) {
      strips.push({
        id: `SY${stripId++}`,
        direction: 'Y',
        fixedCoord: xMid,
        spans: chain.map(s => ({
          slabId: s.id,
          spanLength: Math.abs(s.y2 - s.y1),
          perpLength: xHigh - xLow,
          startCoord: Math.min(s.y1, s.y2),
          endCoord: Math.max(s.y1, s.y2),
        })),
      });
    }
  }

  return strips;
}

// ===================== ANALYSIS =====================

/**
 * تحليل شريحة مستمرة بطريقة معاملات ACI 318-19 §6.5
 * 
 * الشروط المطلوبة لاستخدام هذه الطريقة (ACI 318-19 §6.5.1):
 * 1. بحرتان أو أكثر
 * 2. الأحمال موزعة بانتظام
 * 3. الحمل الحي ≤ 3 × الحمل الميت
 * 4. النسبة بين أطول وأقصر بحرة ≤ 1.2
 */
export function analyzeContinuousStrip(
  strip: SlabStrip,
  slabProps: SlabProps,
  mat: MatProps,
): ContinuousSlabResult {
  const n = strip.spans.length;

  // حساب الأحمال
  const ownWeight = (slabProps.thickness / 1000) * mat.gamma; // kN/m²
  const wDL = ownWeight + slabProps.finishLoad;
  const wLL = slabProps.liveLoad;
  const Wu = 1.2 * wDL + 1.6 * wLL; // kN/m²
  const wuPerMeter = Wu * 1.0; // kN/m لشريحة عرض 1م

  // الحد الأدنى لتسليح البلاطات
  const d = slabProps.thickness - slabProps.cover - slabProps.phiSlab / 2;
  const shrinkageRatio = mat.fy >= 420 ? 0.0018 : 0.0020;
  const AsMin = shrinkageRatio * 1000 * slabProps.thickness; // mm²/m

  const spanResults: SpanResult[] = [];

  for (let i = 0; i < n; i++) {
    const span = strip.spans[i];
    const Ln = span.spanLength; // الطول الصافي (م)
    const isFirstSpan = i === 0;
    const isLastSpan = i === n - 1;
    const isEndSpan = isFirstSpan || isLastSpan;
    const isInteriorSpan = !isEndSpan;

    // ── تحديد حالة الأطراف ──
    const leftCondition: SpanResult['leftCondition'] = isFirstSpan ? 'integral_with_support' : 'continuous';
    const rightCondition: SpanResult['rightCondition'] = isLastSpan ? 'integral_with_support' : 'continuous';

    // ── العزم الموجب ──
    const posCoeff = getPositiveMomentCoeff(isEndSpan, true);
    const Mpos = posCoeff * wuPerMeter * Ln * Ln;

    // ── العزم السالب الأيسر ──
    let Mneg_left: number;
    if (isFirstSpan) {
      // الوجه الخارجي — متصل بالركيزة
      Mneg_left = getNegativeMomentCoeff('exterior_face') * wuPerMeter * Ln * Ln;
    } else if (i === 1) {
      // الوجه الداخلي للركيزة الخارجية
      // نأخذ أكبر قيمة من البحرتين المجاورتين
      const LnPrev = strip.spans[i - 1].spanLength;
      const LnMax = Math.max(Ln, LnPrev);
      Mneg_left = getNegativeMomentCoeff('interior_face_of_exterior') * wuPerMeter * LnMax * LnMax;
    } else {
      const LnPrev = strip.spans[i - 1].spanLength;
      const LnMax = Math.max(Ln, LnPrev);
      Mneg_left = getNegativeMomentCoeff('interior') * wuPerMeter * LnMax * LnMax;
    }

    // ── العزم السالب الأيمن ──
    let Mneg_right: number;
    if (isLastSpan) {
      Mneg_right = getNegativeMomentCoeff('exterior_face') * wuPerMeter * Ln * Ln;
    } else if (i === n - 2) {
      const LnNext = strip.spans[i + 1].spanLength;
      const LnMax = Math.max(Ln, LnNext);
      Mneg_right = getNegativeMomentCoeff('interior_face_of_exterior') * wuPerMeter * LnMax * LnMax;
    } else {
      const LnNext = strip.spans[i + 1].spanLength;
      const LnMax = Math.max(Ln, LnNext);
      Mneg_right = getNegativeMomentCoeff('interior') * wuPerMeter * LnMax * LnMax;
    }

    // ── القص ──
    const isFirstInteriorLeft = i === 1;
    const isFirstInteriorRight = i === n - 2;
    const Vu_left = getShearCoeff(isFirstInteriorLeft) * wuPerMeter * Ln / 2;
    const Vu_right = getShearCoeff(isFirstInteriorRight) * wuPerMeter * Ln / 2;

    // ── حساب التسليح ──
    const calcAs = (Mu: number): number => {
      if (Mu <= 0) return AsMin;
      const Mu_Nmm = Math.abs(Mu) * 1e6;
      const Ru = Mu_Nmm / (1000 * d * d);
      let rho = 0.85 * mat.fc / mat.fy * (1 - Math.sqrt(1 - 2 * Ru / (0.9 * 0.85 * mat.fc)));
      if (isNaN(rho) || rho < 0) rho = 0;
      return Math.max(rho * 1000 * d, AsMin);
    };

    spanResults.push({
      slabId: span.slabId,
      spanLength: Ln,
      Mneg_left,
      Mpos,
      Mneg_right,
      Vu_left,
      Vu_right,
      leftCondition,
      rightCondition,
      As_neg_left: calcAs(Mneg_left),
      As_pos: calcAs(Mpos),
      As_neg_right: calcAs(Mneg_right),
      As_min: AsMin,
    });
  }

  return {
    stripId: strip.id,
    direction: strip.direction,
    fixedCoord: strip.fixedCoord,
    Wu,
    wuPerMeter,
    spans: spanResults,
    maxPositiveMoment: Math.max(...spanResults.map(s => s.Mpos)),
    maxNegativeMoment: Math.max(...spanResults.map(s => Math.max(s.Mneg_left, s.Mneg_right))),
    maxShear: Math.max(...spanResults.map(s => Math.max(s.Vu_left, s.Vu_right))),
  };
}

/**
 * تحليل جميع الشرائح المستمرة
 */
export function analyzeAllContinuousSlabs(
  slabs: Slab[],
  slabProps: SlabProps,
  mat: MatProps,
): ContinuousSlabResult[] {
  const strips = buildContinuousStrips(slabs);
  return strips.map(strip => analyzeContinuousStrip(strip, slabProps, mat));
}
