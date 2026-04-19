// ===================== STRUCTURAL OPTION EVALUATOR =====================
// ACI 318-19 compliant — خطوة بخطوة لكل نظام بلاطة
import type {
  GenerativeInput, GeneratedStructuralOption, EvaluatedOption,
  AnalysisMetrics, DesignMetrics, MaterialQuantity, CostEstimate, PerformanceScore,
} from './types';

const CONCRETE_COST_PER_M3 = 120;  // USD/m³
const STEEL_COST_PER_KG   = 1.2;   // USD/kg
const FORMWORK_COST_PER_M2 = 25;   // USD/m²
const BLOCK_COST_EACH      = 0.8;  // USD/block
const FINISH_LOAD          = 2.0;  // kN/m² (طبقات تشطيب + حواجز خفيفة)

// ─────────────────────────────────────────────────────────────────────────────
// 1. ANALYSIS — تحليل الأحمال والقوى الداخلية
// ─────────────────────────────────────────────────────────────────────────────
function analyzeOption(
  opt: GeneratedStructuralOption,
  input: GenerativeInput,
): AnalysisMetrics {
  const { gridX, gridY } = opt;
  const maxSpan  = Math.max(...gridX, ...gridY); // البحر الأقصى بالمتر
  const avgSpanX = gridX.reduce((s, v) => s + v, 0) / gridX.length;
  const avgSpanY = gridY.reduce((s, v) => s + v, 0) / gridY.length;

  // ── الحمل الذاتي للبلاطة ──
  // هردي: وزن وحدة ≈ 18 kN/m³ (فراغات البلوك تخفف الوزن)
  // مصمتة / فلات سلاب: 25 kN/m³
  const slabSW = opt.systemType === 'hollow-block'
    ? (opt.sections.slabThickness / 1000) * 18
    : (opt.sections.slabThickness / 1000) * 25;

  // ── الحمل الميت الكلي والحمل الحي ──
  const DL = slabSW + FINISH_LOAD;
  const LL = input.liveLoad;

  // ── تركيبة الحمل المصحح — ACI 318-19 §5.3.1 ──
  // Wu = max( 1.4D , 1.2D + 1.6L )
  const w = Math.max(1.4 * DL, 1.2 * DL + 1.6 * LL); // kN/m²

  // ─────────────── عزوم القص والانحناء لكل نظام ───────────────

  let maxMoment: number; // kN·m (governing design moment)
  let maxShear : number; // kN   (governing design shear)
  let beamMoment = 0;   // kN·m (بخصوص الجسر الساقط — للأنظمة التي بها جسور)

  if (opt.systemType === 'flat-slab') {
    // ── بلاطة مسطحة (Flat Slab / Flat Plate) ──────────────────────────────
    // العزم الاستاتيكي الكلي — ACI 318-19 §8.10.3.1:
    //   M₀ = wu × l₂ × ln² / 8    (l₂ = البحر العرضي، ln = البحر الصافي)
    // نستخدم avgSpanY كـ l₂ وmaxSpan كـ ln (للبقر الحرجة):
    const M0 = w * avgSpanY * maxSpan * maxSpan / 8;
    // العزم السلبي الحاكم = 0.65 × M₀  — ACI 318-19 §8.10.4.1
    maxMoment = 0.65 * M0;
    // قص الثقب حول الأعمدة — ACI 318-19 §22.6.4.1:
    //   Vu ≈ wu × (l₁ × l₂ − (col + d)²)  تقريبياً:
    maxShear = w * avgSpanX * avgSpanY; // حمل كل عمود داخلي

  } else if (opt.systemType === 'hollow-block') {
    // ── بلاطة هردي (أعصاب + جسور ساقطة) ────────────────────────────────────
    // a) عزم الأعصاب (ribs) — ACI 318-19 §9.6.2 + معاملات التقريب §6.5:
    //    wRib = wu × تباعد الأعصاب
    const ribSpacingM = (opt.sections.ribSpacing || 520) / 1000; // m
    const wRib = w * ribSpacingM; // kN/m لكل عصب
    // مستمر على طرفين (أغلب حالات الهردي): M = wL²/10
    const ribMoment = wRib * maxSpan * maxSpan / 10; // kN·m/rib

    // b) عزم الجسور الساقطة — نفس طريقة البلاطة المصمتة:
    //    الجسر يحمل نصف بحر الألواح من كل جانب
    const tributaryW = avgSpanY; // m (البحر العرضي المتوسط)
    const wBeam      = w * tributaryW / 2; // kN/m (نصف المساحة المسؤولة)
    beamMoment = wBeam * maxSpan * maxSpan / 10; // kN·m — ACI coeff. for continuous

    // الحاكم للعرض = عزم الجسر الساقط (أكبر)
    maxMoment = Math.max(ribMoment, beamMoment);
    maxShear  = wBeam * maxSpan / 2; // قص الجسر

  } else {
    // ── بلاطة مصمتة مع جسور ساقطة (Solid Slab + Drop Beams) ─────────────
    // الجسور تحمل أحمال البلاطة ثنائية الاتجاه:
    //   W_beam = wu × (l_transverse / 2)  كل جانب → المجموع = wu × l_transverse
    // نستخدم البحر العرضي المتوسط avgSpanY:
    const tributaryW = avgSpanY; // m
    const wBeam      = w * tributaryW / 2; // kN/m على الجسر
    beamMoment = wBeam * maxSpan * maxSpan / 10; // ACI approx. coeff. §6.5 (مستمر)
    maxMoment  = beamMoment;
    maxShear   = wBeam * maxSpan / 2;
  }

  // ─────────────── ترخيم تقريبي — ACI 318-19 §24.2 ───────────────
  // Ec = 4700√f'c (MPa)
  const Ec = 4700 * Math.sqrt(input.fc);

  let I_eff: number; // mm⁴ (مقطع فعّال مصحح لكسر)
  let wDefl: number; // N/mm (حمل التشوه المكافئ)
  const Lmm = maxSpan * 1000; // mm

  if (opt.systemType === 'hollow-block') {
    const bEff = opt.sections.ribSpacing || 520; // mm
    I_eff = (bEff * Math.pow(opt.sections.slabThickness, 3) / 12) * 0.45;
    const ribSpacingM = (opt.sections.ribSpacing || 520) / 1000;
    wDefl = w * ribSpacingM; // kN/m → N/mm (same numerically)
  } else if (opt.systemType === 'flat-slab') {
    // شريط عرض 1م — ACI §6.6.3.1.2: Ie مُصحح = 0.25 Ig للبلاطات ثنائية الاتجاه
    I_eff = (1000 * Math.pow(opt.sections.slabThickness, 3) / 12) * 0.25;
    wDefl = w; // kN/m² × 1m = kN/m = N/mm
  } else {
    // جسر — ACI §6.6.3.1.1: Ie = 0.35 Ig
    I_eff = ((opt.sections.beamB || 300) * Math.pow(opt.sections.beamH || 500, 3) / 12) * 0.35;
    const tributaryW = avgSpanY;
    wDefl = w * tributaryW / 2; // kN/m = N/mm
  }
  // δ = 5wL⁴ / (384EI)  — حد أعلى (بسيط الارتكاز)
  const maxDeflection = (5 * wDefl * Math.pow(Lmm, 4)) / (384 * Ec * I_eff);

  // انجراف طابقي تقديري (مبسط — ليس تحليل عرضي كامل)
  const storyDrift = opt.systemType === 'flat-slab' ? 0.008 : 0.005;
  const maxDrift   = storyDrift * (input.seismicZone === 'high' ? 1.5 : 1.0);

  return { maxMoment, maxShear, maxDeflection, maxDrift };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DESIGN CHECK — التحقق من الكود الأمريكي ACI 318-19
// ─────────────────────────────────────────────────────────────────────────────
function designCheck(
  opt: GeneratedStructuralOption,
  analysis: AnalysisMetrics,
  input: GenerativeInput,
): DesignMetrics {
  const { beamB, beamH, colB, colH, slabThickness } = opt.sections;
  const fc = input.fc;
  const fy = input.fy;
  const maxSpanX = Math.max(...opt.gridX);
  const maxSpanY = Math.max(...opt.gridY);
  const maxSpan  = Math.max(maxSpanX, maxSpanY);
  const minSpan  = Math.min(maxSpanX, maxSpanY);

  // ── A) فحص الجسور الساقطة — ACI 318-19 §22.2 + §9.5.1.1 ──────────────
  let beamUtil = 0;
  if (beamH > 0) {
    // d = h − (40 cover + 10 stirrup + 8 half-bar) = h − 58 ≈ h − 60
    const d = beamH - 60; // mm

    // β₁ — ACI 318-19 §22.2.2.3
    const beta1 = fc <= 28
      ? 0.85
      : Math.max(0.65, 0.85 - 0.05 * (fc - 28) / 7);

    // ρ_max عند εt = 0.005 (tension-controlled) — ACI 318-19 §21.2.2
    const rhoMax = 0.85 * beta1 * fc / fy * (0.003 / (0.003 + 0.005));

    // نصميم بـ ρ = ρ_max (أقصى استفادة من المقطع)
    const As = rhoMax * beamB * d;               // mm²
    const a  = As * fy / (0.85 * fc * beamB);   // mm (عمق كتلة الضغط)

    // φMn = φ × As × fy × (d − a/2)   — φ = 0.9 tension-controlled §21.2.1
    // الوحدات: N·mm → kN·m بالقسمة على 1,000,000
    const phiMn = 0.9 * As * fy * (d - a / 2) / 1e6; // kN·m

    beamUtil = Math.min(1.5, analysis.maxMoment / Math.max(phiMn, 1));
  }

  // ── B) فحص الأعمدة — ACI 318-19 §22.4.2.1 ────────────────────────────
  // منطقة النفوذ: بحر متوسط × بحر عرضي متوسط
  const avgSpanX = opt.gridX.reduce((s, v) => s + v, 0) / opt.gridX.length;
  const avgSpanY = opt.gridY.reduce((s, v) => s + v, 0) / opt.gridY.length;
  const tribArea = avgSpanX * avgSpanY; // m²

  const slabSW = opt.systemType === 'hollow-block'
    ? (slabThickness / 1000) * 18
    : (slabThickness / 1000) * 25;
  const DL = slabSW + FINISH_LOAD;
  const Wu = Math.max(1.4 * DL, 1.2 * DL + 1.6 * input.liveLoad); // kN/m²

  // Pu على العمود الداخلي = Wu × A_trib × عدد الطوابق
  const Pu = Wu * tribArea * input.numFloors; // kN

  // φPn,max = φ × 0.80 × [0.85f'c(Ag−Ast) + fy×Ast]  — §22.4.2.1, φ=0.65 tied §21.2.1
  // ρg = 2% (قيمة متوسطة عملية)
  const Ag  = colB * colH;
  const Ast = 0.02 * Ag;
  const phiPn = 0.65 * 0.80 * (0.85 * fc * (Ag - Ast) + fy * Ast) / 1000; // kN

  const colUtil = Math.min(1.5, Pu / Math.max(phiPn, 1));

  // ── C) فحص سماكة البلاطة — ACI 318-19 ────────────────────────────────
  let slabUtil: number;

  if (opt.systemType === 'flat-slab') {
    // ═══ بلاطة مسطحة بدون جسور — ACI 318-19 Table 8.3.1.1 ═══
    // لوحات داخلية: h_min = ln × (0.8 + fy/1400) / 33
    // الحد الأدنى المطلق: 125 mm  — ACI §8.3.1.1
    const hMin = Math.max(125, maxSpan * 1000 * (0.8 + fy / 1400) / 33);
    slabUtil = hMin / slabThickness;

  } else if (opt.systemType === 'hollow-block') {
    // ═══ بلاطة هردي (أعصاب أحادية الاتجاه) — ACI 318-19 Table 9.3.1.1 ═══
    // مستمر من جهة واحدة: L/21 — مستمر من الجهتين: L/24
    // نستخدم L/21 (أكثر تحفظاً، نهاية مستمرة من طرف واحد)
    const hMin = maxSpan * 1000 * (0.8 + fy / 1400) / 21;
    slabUtil = hMin / slabThickness;

  } else {
    // ═══ بلاطة مصمتة مع جسور ساقطة (TWO-WAY) — ACI 318-19 §8.3.1.2 ═══
    const hs  = slabThickness; // mm
    const Ib  = beamB * Math.pow(beamH, 3) / 12; // mm⁴
    const Is  = avgSpanY * 1000 * Math.pow(hs, 3) / 12; // mm⁴ (l₂ محول لـ mm)
    const alphaf = Is > 0 ? Ib / Is : 2.5;

    const beta = Math.max(maxSpanX, maxSpanY) / Math.max(minSpan, 0.01); // نسبة البحور

    let hMin: number;
    if (alphaf > 2.0) {
      // ACI §8.3.1.2(c): h_min = ln(0.8+fy/1400)/(36+9β) ≥ 90mm
      hMin = Math.max(90, maxSpan * 1000 * (0.8 + fy / 1400) / (36 + 9 * beta));
    } else if (alphaf >= 0.2) {
      // ACI §8.3.1.2(b): h_min = ln(0.8+fy/1400)/(36+5β(αfm−0.2)) ≥ 120mm
      hMin = Math.max(120, maxSpan * 1000 * (0.8 + fy / 1400) / (36 + 5 * beta * (alphaf - 0.2)));
    } else {
      hMin = 120;
    }

    slabUtil = hMin / slabThickness;
  }

  // ── D) فحص قص الثقب (Punching Shear) للبلاطات المسطحة — ACI 318-19 §22.6.5.2 ──
  let punchingUtil = 0;
  if (opt.systemType === 'flat-slab') {
    const d = slabThickness - 40; // mm (غطاء + نصف قطر)
    // محيط المقطع الحرج — ACI §22.6.4.1: b₀ = 2(c₁+d) + 2(c₂+d)
    const b0 = 2 * (colB + d) + 2 * (colH + d); // mm
    // β_c = نسبة الضلع الطويل / القصير للعمود
    const betaC = Math.max(colB, colH) / Math.min(colB, colH);
    // αs = 40 للأعمدة الداخلية، 30 للطرفية، 20 للركنية — §22.6.5.2
    const alphaS = 40; // عمود داخلي (أسوأ حالة للتقييم العام)

    // φVc = φ × min من ثلاث قيم — ACI §22.6.5.2(a,b,c):
    //   (a) 0.33λ√f'c × b₀d
    //   (b) (0.17 + 0.33/β_c)λ√f'c × b₀d
    //   (c) (0.083αs×d/b₀ + 0.17)λ√f'c × b₀d
    // λ = 1.0 (خرسانة عادية الوزن)
    const sqrtFc = Math.sqrt(fc); // √f'c (MPa)
    const Vc_a = 0.33 * sqrtFc * b0 * d / 1000; // kN
    const Vc_b = (0.17 + 0.33 / betaC) * sqrtFc * b0 * d / 1000; // kN
    const Vc_c = (0.083 * alphaS * d / b0 + 0.17) * sqrtFc * b0 * d / 1000; // kN
    const phiVc = 0.75 * Math.min(Vc_a, Vc_b, Vc_c); // φ = 0.75 for shear §21.2.1

    // Vu = حمل العمود الداخلي = wu × (l₁ × l₂ − (c₁+d)(c₂+d))
    const Vu = Wu * (avgSpanX * avgSpanY - ((colB + d) / 1000) * ((colH + d) / 1000)); // kN

    punchingUtil = Math.min(2.0, Vu / Math.max(phiVc, 1));
  }

  const allPassing =
    beamUtil  <= 1.0 &&
    colUtil   <= 1.0 &&
    slabUtil  <= 1.0 &&
    punchingUtil <= 1.0 &&
    analysis.maxDrift <= 0.02;

  return {
    beamUtilization:  beamUtil,
    columnUtilization: colUtil,
    slabUtilization:   slabUtil,
    punchingShearUtilization: punchingUtil,
    allPassing,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MATERIAL QUANTITIES — حساب الكميات
// ─────────────────────────────────────────────────────────────────────────────
function calculateMaterials(
  opt: GeneratedStructuralOption,
  input: GenerativeInput,
): MaterialQuantity {
  const { beamB, beamH, colB, colH, slabThickness } = opt.sections;
  const numFloors    = input.numFloors;
  const totalSlabArea = opt.slabs.reduce((sum, s) =>
    sum + (s.x2 - s.x1) * (s.y2 - s.y1), 0); // m²

  // ── حجم خرسانة البلاطة ──
  let slabConc: number;
  let blockCount: number | undefined;

  if (opt.systemType === 'hollow-block') {
    // خرسانة الأعصاب فقط (الفراغات مملوءة بالبلوك)
    const ribW   = (opt.sections.ribWidth       || 120) / 1000; // m
    const ribSp  = (opt.sections.ribSpacing     || 520) / 1000; // m
    const blockH = (opt.sections.blockHeight    || 250) / 1000; // m
    const topping = (opt.sections.toppingThickness || 50) / 1000; // m

    const ribsPerMeter = 1 / ribSp;
    const ribConc      = totalSlabArea * ribsPerMeter * ribW * blockH;
    const toppingConc  = totalSlabArea * topping;
    slabConc = (ribConc + toppingConc) * numFloors;

    // عدد البلوكات
    const blockLength = 0.4; // m
    blockCount = Math.ceil(totalSlabArea * (ribsPerMeter / blockLength) * numFloors);

  } else {
    // بلاطة مصمتة أو فلات سلاب
    slabConc = totalSlabArea * (slabThickness / 1000) * numFloors;
  }

  // ── حجم خرسانة الجسور الساقطة ──
  // الجزء البارز تحت البلاطة فقط = (beamH − slabThickness)
  let beamConc = 0;
  const beamDrop = beamH - slabThickness; // mm (الجزء الظاهر تحت البلاطة)
  if (beamH > 0 && beamDrop > 0) {
    // مجموع أطوال الجسور = نصف محيط كل لوح (الضلعان المتقابلان مشتركان مع الألواح المجاورة)
    const totalBeamLength = opt.slabs.reduce((sum, s) =>
      sum + 2 * (s.x2 - s.x1) + 2 * (s.y2 - s.y1), 0) / 2; // m
    beamConc = totalBeamLength * (beamB / 1000) * (beamDrop / 1000) * numFloors;
  }

  // ── حجم خرسانة الأعمدة ──
  const nCols = new Set(opt.slabs.flatMap(s => [
    `${s.x1}_${s.y1}`, `${s.x2}_${s.y1}`, `${s.x1}_${s.y2}`, `${s.x2}_${s.y2}`,
  ])).size;
  const colConc = nCols * (colB / 1000) * (colH / 1000) * input.floorHeight * numFloors;

  const concreteVolume = slabConc + beamConc + colConc;

  // ── وزن الحديد — معاملات موزونة (kg/m² من مساحة الطابق) ──
  // هذا أدق من kg/m³ خرسانة لأن الحديد يعتمد على مساحة البلاطة لا الخرسانة
  //   بلاطة مصمتة: ~85 kg/m²  (سلاح بلاطة + جسور)
  //   هردي:         ~65 kg/m²  (أعصاب + جسور، ضغط أقل)
  //   فلات سلاب:    ~95 kg/m²  (تسليح ثنائي كثيف، بدون جسور)
  const steelPerM2 = opt.systemType === 'flat-slab'  ? 95
    : opt.systemType === 'hollow-block' ? 65 : 85; // kg/m²
  const steelWeight = totalSlabArea * steelPerM2 * numFloors;

  // ── مساحة الشدات ──
  // أرضية البلاطة + جانبا الجسر الظاهر (beamDrop فقط، ليس كامل الجسر)
  let formworkArea = totalSlabArea * numFloors;
  if (beamH > 0 && beamDrop > 0) {
    // مساحة الجانبين للجسور = 2 × طول الجسر × عمق البروز
    const totalBeamLength = opt.slabs.reduce((sum, s) =>
      sum + 2 * (s.x2 - s.x1) + 2 * (s.y2 - s.y1), 0) / 2;
    formworkArea += totalBeamLength * 2 * (beamDrop / 1000) * numFloors;
  }

  return { concreteVolume, steelWeight, formworkArea, blockCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. COST ESTIMATE — تقدير التكلفة
// ─────────────────────────────────────────────────────────────────────────────
function estimateCost(materials: MaterialQuantity): CostEstimate {
  const concreteCost = materials.concreteVolume * CONCRETE_COST_PER_M3;
  const steelCost    = materials.steelWeight    * STEEL_COST_PER_KG;
  const formworkCost = materials.formworkArea   * FORMWORK_COST_PER_M2;
  const blockCost    = (materials.blockCount || 0) * BLOCK_COST_EACH;
  return {
    concreteCost, steelCost, formworkCost,
    blockCost:  blockCost > 0 ? blockCost : undefined,
    totalCost:  concreteCost + steelCost + formworkCost + blockCost,
    currency: 'USD',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PERFORMANCE SCORES — للعرض فقط (التصنيف يعتمد على التكلفة)
// ─────────────────────────────────────────────────────────────────────────────
function scoreOption(
  design: DesignMetrics,
  materials: MaterialQuantity,
  cost: CostEstimate,
  _analysis: AnalysisMetrics,
  systemType: string,
): PerformanceScore {
  const maxUtil = Math.max(design.beamUtilization, design.columnUtilization, design.slabUtilization, design.punchingShearUtilization);
  const safety            = Math.max(0, Math.min(100, (2 - maxUtil) * 50));
  const costEfficiency    = Math.max(0, Math.min(100, 100 - cost.totalCost / 500));
  const materialEfficiency = Math.max(0, Math.min(100, 100 - materials.concreteVolume * 0.5));
  const constructability  = systemType === 'solid-slab' ? 85
    : systemType === 'hollow-block' ? 70 : 80;
  const overall = costEfficiency * 0.5 + materialEfficiency * 0.3 + constructability * 0.2;
  return { safety, costEfficiency, materialEfficiency, constructability, overall };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. EVALUATE + RANK BY COST — التقييم والترتيب بالتكلفة
// ─────────────────────────────────────────────────────────────────────────────
export function evaluateOptions(
  options: GeneratedStructuralOption[],
  input: GenerativeInput,
): EvaluatedOption[] {
  const evaluated = options.map(opt => {
    const analysis  = analyzeOption(opt, input);
    const design    = designCheck(opt, analysis, input);
    const materials = calculateMaterials(opt, input);
    const cost      = estimateCost(materials);
    const score     = scoreOption(design, materials, cost, analysis, opt.systemType);
    return { option: opt, analysis, design, materials, cost, score, rank: 0 };
  });

  // الترتيب: الناجحة أولاً (ACI 318-19)، ثم بأقل تكلفة
  evaluated.sort((a, b) => {
    if (a.design.allPassing && !b.design.allPassing) return -1;
    if (!a.design.allPassing && b.design.allPassing) return 1;
    return a.cost.totalCost - b.cost.totalCost;
  });

  evaluated.forEach((e, i) => { e.rank = i + 1; });
  return evaluated;
}
