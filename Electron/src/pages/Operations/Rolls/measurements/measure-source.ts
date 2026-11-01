// Ölçüm kaynağı etiketleri + top izi `measurements` sözleşmesi (backend `helpers/roll-measurements.helper.ts` aynası; D4-B4).
// NULL = kaynak bildirilmemiş (eski tablet / eski kayıt) → "Bilinmiyor"; uydurma kaynak gösterilmez.

export interface RollMeterReadingView {
  id: string;
  phase: string;
  meters: number;
  source: string;
  stepId: string;
  stationName: string | null;
  machineName: string | null;
  createdAt: string;
  createdByName: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface RollVarianceView {
  id: string;
  kind: string;
  qty: number;
  source: string;
  measureSource: string | null;
  reasonCode: string | null;
  createdAt: string;
  reversedAt: string | null;
}

export interface RollMeasurements {
  readings: RollMeterReadingView[];
  variances: RollVarianceView[];
}

export const MEASURE_SOURCE_LABEL: Record<string, string> = {
  MACHINE: "Makine",
  OPERATOR: "Operatör",
  SUPERVISOR: "Süpervizör",
  SIMULATED: "Simülasyon",
  INFERRED: "Türetilmiş",
};

export function measureSourceLabel(source: string | null | undefined): string {
  if (source == null) return "Bilinmiyor";
  return MEASURE_SOURCE_LABEL[source] ?? source;
}

export function measureSourceClass(source: string | null | undefined): string {
  if (source === "SIMULATED") return "border border-dashed border-destructive bg-destructive/10 text-destructive";
  if (source === "MACHINE") return "bg-success/15 text-success";
  if (source == null) return "bg-muted text-muted-foreground";
  return "bg-secondary text-secondary-foreground";
}

export const METER_PHASE_LABEL: Record<string, string> = { IN: "Giriş", OUT: "Çıkış", CUT: "Tambur kesim" };
const METER_PHASE_SUFFIX: Record<string, string> = { IN: "giriş", OUT: "çıkış" };

/** Okumanın FAZ etiketi — giriş/çıkış okumanın KENDİ istasyonundan ("Etek çıkış"); istasyon bilinmiyorsa nötr. */
export function meterPhaseLabel(r: Pick<RollMeterReadingView, "phase" | "stationName">): string {
  const base = METER_PHASE_LABEL[r.phase];
  if (!base) return r.phase;
  const station = r.stationName?.trim();
  if (r.phase === "CUT" || !station) return base;
  return `${station} ${METER_PHASE_SUFFIX[r.phase] ?? base}`;
}

export const VARIANCE_KIND_LABEL: Record<string, string> = {
  SCRAP: "Fire",
  OVERAGE: "Aşım",
  RECORD_CORRECTION: "Kayıt düzeltmesi",
};

/** Düzeltme yalnız AKTİF Tambur kesim okumasında (backend: CUT dışı 400, damgalı okuma 409). */
export function isCorrectableReading(r: RollMeterReadingView): boolean {
  return r.phase === "CUT" && r.revokedAt === null;
}

/** Damgalı okuma: düzeltme ucunun sebep öneki (`TAMBUR_METER_CORRECTION`) → "Düzeltildi", diğer damga (iptal/geri alma) → "Geri alındı". */
export function readingStatusLabel(r: RollMeterReadingView): string {
  if (r.revokedAt === null) return "Geçerli";
  return (r.revokeReason ?? "").startsWith("TAMBUR_METER_CORRECTION") ? "Düzeltildi" : "Geri alındı";
}

/** Kolon görünürlük tercihi anahtarı — `prefs.tableVisibility[ROLL_MEASUREMENTS_TABLE_KEY]` (useDataTable emsali). */
export const ROLL_MEASUREMENTS_TABLE_KEY = "roll-measurements";
export const MEASURE_SOURCE_COLUMN = "measureSource";

/** Ölçüm kolonu varsayılan GİZLİ (opt-in); yalnız açıkça `true` tercih görünür kılar. */
export function isMeasureColumnVisible(visibility: Record<string, Record<string, boolean>> | undefined): boolean {
  return visibility?.[ROLL_MEASUREMENTS_TABLE_KEY]?.[MEASURE_SOURCE_COLUMN] === true;
}
