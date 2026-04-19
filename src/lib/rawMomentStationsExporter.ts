/**
 * Raw Moment Stations Exporter
 * ─────────────────────────────────────────────────────────────────
 * يصدّر عزوم الانحناء عند 7 محطات (x=0, L/6, 2L/6, 3L/6, 4L/6, 5L/6, L)
 * لكل جسر من جميع المحركات (2D, 3D, GF, UC, FEM) **بدون أي معالجة**:
 *   - بدون قلب إشارة
 *   - بدون فرض أن منتصف الجسر موجب
 *   - بدون فرض أن العزم عند الركيزة سالب
 *   - بدون أخذ قيمة مطلقة
 *
 * منهجية الاستخراج:
 *   1) إذا كان المحرك يخزن `momentStations` (2D, 3D)، نأخذها مباشرة
 *      ونُعيد عينات عند 7 محطات بـ interpolation خطي.
 *   2) إذا لم يكن، نعيد بناء M(x) من القيم الخام (Mleft, Rleft, wu)
 *      بمعادلة التوازن:
 *          M(x) = Mleft + Rleft·x − wu·x²/2
 *      (Mleft هنا يُؤخذ كما هو من المحرك دون أي قلب)
 *
 * الإشارة الناتجة هي الإشارة التي يُنتجها المحرك مباشرة.
 */

import type { Beam, FrameResult } from '@/lib/structuralEngine';

const N_STATIONS = 7;

export interface BeamMomentStations {
  frameId:  string;
  beamId:   string;
  span_m:   number;
  /** قيم العزم (kN·m) عند 7 محطات: x = 0, L/6, 2L/6, 3L/6, 4L/6, 5L/6, L */
  M:        number[];
  /** مصدر البيانات: 'native_stations' (مأخوذة مباشرة من المحرك)
   *  أو 'reconstructed' (مُعاد بناؤها من Mleft/Rleft/wu) */
  source:   'native_stations' | 'reconstructed';
}

/**
 * Sample a moment-stations array at exactly 7 evenly-spaced locations using
 * linear interpolation. Performs **no sign manipulation**.
 */
function resampleStations(stations: number[]): number[] {
  if (stations.length === N_STATIONS) return [...stations];
  const out = new Array<number>(N_STATIONS);
  const lastIdx = stations.length - 1;
  for (let i = 0; i < N_STATIONS; i++) {
    const t  = (i / (N_STATIONS - 1)) * lastIdx;
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, lastIdx);
    const f  = t - lo;
    out[i]   = stations[lo] * (1 - f) + stations[hi] * f;
  }
  return out;
}

/**
 * Reconstruct moments at 7 stations using equilibrium from raw end-moment,
 * left reaction, and uniformly-distributed factored load. NO sign flips.
 *
 *   M(x) = Mleft + Rleft·x − wu·x²/2
 *
 * @param Mleft   end-moment at x=0 (kN·m), as produced by the engine
 * @param Rleft   reaction at left support (kN, positive upward)
 * @param wu      factored uniformly distributed load (kN/m, positive downward)
 * @param L       beam clear span (m)
 */
function reconstructStations(Mleft: number, Rleft: number, wu: number, L: number): number[] {
  const out = new Array<number>(N_STATIONS);
  for (let i = 0; i < N_STATIONS; i++) {
    const x = (i / (N_STATIONS - 1)) * L;
    out[i]  = Mleft + Rleft * x - 0.5 * wu * x * x;
  }
  return out;
}

/**
 * Extract 7-station moment data for one engine's FrameResult[].
 */
export function extractRawStations(
  results: FrameResult[],
  beams:   Beam[],
): BeamMomentStations[] {
  const beamMap = new Map(beams.map(b => [b.id, b]));
  const out: BeamMomentStations[] = [];

  for (const fr of results) {
    for (const br of fr.beams) {
      const beam = beamMap.get(br.beamId);
      const wu   = beam ? 1.2 * beam.deadLoad + 1.6 * beam.liveLoad : 0;
      const L    = br.span ?? beam?.length ?? 0;

      if (br.momentStations && br.momentStations.length >= 2) {
        out.push({
          frameId: fr.frameId,
          beamId:  br.beamId,
          span_m:  L,
          M:       resampleStations(br.momentStations),
          source:  'native_stations',
        });
      } else {
        const Rleft = br.Rleft ?? (wu * L) / 2;
        out.push({
          frameId: fr.frameId,
          beamId:  br.beamId,
          span_m:  L,
          M:       reconstructStations(br.Mleft, Rleft, wu, L),
          source:  'reconstructed',
        });
      }
    }
  }
  return out;
}

export interface EngineRawStations {
  engine: string;
  data:   BeamMomentStations[];
}

/**
 * Build a CSV string with one row per beam per engine and 7 moment columns.
 * Columns: Engine, Frame, Beam, Span(m), Source, M0, M_L/6, M_2L/6, M_3L/6, M_4L/6, M_5L/6, M_L
 */
export function buildRawStationsCSV(engines: EngineRawStations[]): string {
  const headers = [
    'Engine', 'Frame', 'Beam', 'Span(m)', 'Source',
    'M(x=0)_kNm',
    'M(x=L/6)_kNm',
    'M(x=2L/6)_kNm',
    'M(x=3L/6=mid)_kNm',
    'M(x=4L/6)_kNm',
    'M(x=5L/6)_kNm',
    'M(x=L)_kNm',
  ];
  const rows: string[] = [headers.join(',')];

  for (const eng of engines) {
    for (const r of eng.data) {
      const cells = [
        eng.engine,
        r.frameId,
        r.beamId,
        r.span_m.toFixed(3),
        r.source,
        ...r.M.map(v => v.toFixed(4)),
      ];
      rows.push(cells.join(','));
    }
  }
  return rows.join('\n');
}

/**
 * Trigger a browser download for the given CSV content.
 */
export function downloadCSV(filename: string, content: string): void {
  // Add UTF-8 BOM so Excel opens Arabic characters correctly.
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
