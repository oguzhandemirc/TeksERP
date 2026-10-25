// InspectionPanel'in saf katmanı: tipler, doğrulama, cetvel kümeleme (KQ-D3).
// Bileşenden ayrı tutulur ki jest doğrudan sınasın ve dosyalar lint sınırında kalsın.
import type { DefectType } from '../../types/models';

export type InspectionSizeClass = 'S1' | 'S2' | 'S3' | 'S4';

export interface InspectionDefect {
  id: string;
  startMeter: number;
  defectTypeId: string | null;
  errorType: string | null;
}

/** Önceki adımın hatası — gri, salt-okunur, künyeli ("KK Masa 2 · Ayşe · 13:40"). */
export interface InspectionPriorDefect extends InspectionDefect {
  origin?: string | null;
}

export interface InspectionDefectInput {
  meter: number | null;
  defectTypeId: string;
  sizeClass?: InspectionSizeClass;
}

export const SIZE_CLASSES: { code: InspectionSizeClass; label: string }[] = [
  { code: 'S1', label: '1 puan' },
  { code: 'S2', label: '2 puan' },
  { code: 'S3', label: '3 puan' },
  { code: 'S4', label: '4 puan' },
];

/** Kayıt hatasının operatör metni: mükerrer 409 → "zaten kayıtlı"; diğerleri null (konak genel metni basar). */
export function inspectionSaveErrorText(err: unknown): string | null {
  const e = err as { status?: number; details?: { code?: string } } | null;
  if (e?.status === 409 && e?.details?.code === 'DUPLICATE_ROLL_ERROR') {
    return 'Bu hata zaten kayıtlı';
  }
  return null;
}

/** Girdi doğrulaması (saf): metre sayı, top boyunu aşmaz, aynı metre + tip mükerrer değil. */
export function validateDefectInput(
  meterInput: string,
  defectTypeId: string,
  ownDefects: InspectionDefect[],
  maxMeter?: number,
): { ok: true; meter: number } | { ok: false; title: string; detail: string } {
  const meter = parseFloat(meterInput);
  if (!Number.isFinite(meter) || meter < 0) {
    return { ok: false, title: 'Önce hata metresini gir', detail: 'Metre alanına sayı yaz, sonra hata tipine bas' };
  }
  // Backend reportError ile birebir: çevrimdışı iyimser eklemede de geçerli olsun.
  if (maxMeter !== undefined && meter > maxMeter) {
    return {
      ok: false,
      title: 'Metraj kumaş boyunu aşıyor',
      detail: `Hata metresi (${meter}) topun metrajını (${maxMeter.toFixed(1)} mt) aşamaz`,
    };
  }
  // Decimal(12,3) → 0.0005 tolerans; aynı metrede FARKLI tip serbest.
  const duplicate = ownDefects.some(
    (d) => d.defectTypeId === defectTypeId && Math.abs(d.startMeter - meter) < 0.0005,
  );
  if (duplicate) {
    return { ok: false, title: 'Bu hata zaten eklenmiş', detail: `${meter}. metrede bu hata tipi zaten kayıtlı` };
  }
  return { ok: true, meter };
}

// Metre değeri — tamsa ondalıksız, değilse tek ondalık (47, 47.5).
export function fmtMeter(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// Cetvel sağ ucu = topun boyu; topu aşan hata metresi cetveli uzatır.
export function rulerMaxFor(maxMeter: number | undefined, defects: InspectionDefect[]): number {
  let m = maxMeter && maxMeter > 0 ? maxMeter : 0;
  for (const d of defects) if (d.startMeter > m) m = d.startMeter;
  return Math.max(m, 1);
}

export function isCriticalDefect(e: InspectionDefect, defectTypes: DefectType[]): boolean {
  return defectTypes.find((d) => d.name === e.errorType)?.severity === 'CRITICAL';
}

export interface RulerMarker {
  x: number;
  defects: InspectionDefect[];
  critical: boolean;
  prior: boolean;
  meterMin: number;
  meterMax: number;
  label: string;
  showLabel: boolean;
}

// Dokunma alanları (28px) çakışmasın: 30px'ten yakın tik'ler tek küme.
const MIN_GAP = 30;

interface RulerScale {
  width: number;
  rulerMax: number;
  defectTypes: DefectType[];
}

function clusterDefects(list: InspectionDefect[], prior: boolean, { width, rulerMax, defectTypes }: RulerScale): RulerMarker[] {
  const out: RulerMarker[] = [];
  for (const e of [...list].sort((a, b) => a.startMeter - b.startMeter)) {
    const x = (Math.min(e.startMeter, rulerMax) / rulerMax) * width;
    const crit = isCriticalDefect(e, defectTypes);
    const last = out[out.length - 1];
    if (last && x - last.x < MIN_GAP) {
      last.x = (last.x * last.defects.length + x) / (last.defects.length + 1);
      last.defects.push(e);
      last.critical = last.critical || crit;
      last.meterMin = Math.min(last.meterMin, e.startMeter);
      last.meterMax = Math.max(last.meterMax, e.startMeter);
    } else {
      out.push({ x, defects: [e], critical: crit, prior, meterMin: e.startMeter, meterMax: e.startMeter, label: '', showLabel: false });
    }
  }
  return out;
}

/** Cetvel işaretleri: önceki + bu adım ayrı kümelenir; etiket (tek = metre, küme = min–max) soldan sağa çakışmasız. */
export function buildRulerMarkers(
  ownDefects: InspectionDefect[],
  priorDefects: InspectionDefect[],
  scale: RulerScale,
): RulerMarker[] {
  if (scale.width <= 0) return [];
  const all = [
    ...clusterDefects(priorDefects, true, scale),
    ...clusterDefects(ownDefects, false, scale),
  ].sort((a, b) => a.x - b.x);
  let lastEnd = -Infinity;
  for (const m of all) {
    m.label =
      m.defects.length > 1 && m.meterMin !== m.meterMax
        ? `${fmtMeter(m.meterMin)}–${fmtMeter(m.meterMax)}`
        : fmtMeter(m.meterMin);
    const halfW = (m.label.length * 5.5) / 2 + 2;
    if (m.x - halfW >= lastEnd) {
      m.showLabel = true;
      lastEnd = m.x + halfW;
    }
  }
  return all;
}
