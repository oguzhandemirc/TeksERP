import type { ActivityRoll, SessionActivityEvent, SessionActivitySummary } from "./types";

/** RollOperationType → insan-okur Türkçe etiket. */
export const operationTypeLabels: Record<string, string> = {
  KURSUN_APPLIED: "Kurşun uygulandı",
  QC2_COMPLETED: "KK2 tamamlandı",
  TAMBUR_PROCESSED: "Tambur işlendi",
  SUBCONTRACTOR_SENT: "Fasona sevk",
  SUBCONTRACTOR_RETURNED: "Fasondan dönüş",
};

/** RollEntrySource → top oluşturma etiketi. */
export const entrySourceLabels: Record<string, string> = {
  SUPPLIER_RECEIPT: "Kumaş girişi",
  MANUAL_ENTRY: "Manuel giriş",
  TAMBUR_SPLIT: "Top ayrıldı (tambur)",
  SUBCONTRACTOR_RETURN: "Fason dönüş topu",
  TAMBUR_MANUAL: "Tambur (manuel)",
  SEMI_FINISHED: "Yarı mamul girişi",
};

/** Olay satırı başlığı — top girişi / istasyon giriş-çıkış / hata / operasyon / iptal. */
export function eventLabel(
  e: Pick<SessionActivityEvent, "kind" | "operationType" | "entrySource">,
): string {
  switch (e.kind) {
    case "ROLL_CREATED":
      return entrySourceLabels[e.entrySource ?? ""] ?? "Top girişi";
    case "MOVE_IN":
      return "İstasyona giriş";
    case "MOVE_OUT":
      return "İstasyondan çıkış";
    case "ERROR":
      return "Hata girildi";
    case "ROLL_CANCELLED":
      return "İptal edildi";
    default:
      return operationTypeLabels[e.operationType ?? ""] ?? e.operationType ?? "İşlem";
  }
}

/** Movement kapanış işaretçileri (RollMovement.notes) → insan-okur rozet. */
export const movementNoteLabels: Record<string, string> = {
  CANCELLED: "İptal",
  TAMBUR_CONSUMED: "Tambur kesimi",
  REDYE_REWIND: "Redye geri sarma",
  REDYE_REWIND_IN: "Redye geri sarma",
  QC2_STEP_FINISHED: "KK2 bitişi",
};

/** Bilinen işaretçi → {label, known:true}; serbest metin → {label: metin, known:false}; boş → null. */
export function noteLabel(notes?: string | null): { label: string; known: boolean } | null {
  if (!notes) return null;
  const known = movementNoteLabels[notes];
  return known ? { label: known, known: true } : { label: notes, known: false };
}

/** Topun okunur adı — kumaş(ürün) adı + renk; yoksa barkod; o da yoksa "açık kumaş". */
export function rollLabel(r: ActivityRoll): string {
  if (r.itemName) return r.colorName ? `${r.itemName} (${r.colorName})` : r.itemName;
  return r.barcode ?? "açık kumaş";
}

/** Topun ikincil kimliği — ad varken barkodu ayrıca göstermek için (ad yoksa boş). */
export function rollSubLabel(r: ActivityRoll): string {
  return r.itemName && r.barcode ? r.barcode : "";
}

const trNum = (v: number): string => v.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 2 });

/**
 * Operasyon metadata'sının kompakt özeti — bilinen anahtarlar seçilir
 * (qty/foldType/hata sayısı gibi), bilinmeyenler gösterilmez.
 */
export function metadataSummary(md?: Record<string, unknown> | null): string {
  if (!md) return "";
  const parts: string[] = [];
  if (typeof md.totalMeters === "number") parts.push(`${trNum(md.totalMeters)} m`);
  if (typeof md.errorCount === "number" && md.errorCount > 0) parts.push(`${md.errorCount} hata`);
  if (typeof md.foldType === "string" && md.foldType) parts.push(String(md.foldType));
  if (typeof md.childRollCount === "number") parts.push(`${md.childRollCount} top`);
  if (typeof md.cutCount === "number") parts.push(`${md.cutCount} kesim`);
  if (typeof md.notes === "string" && md.notes.trim()) parts.push(md.notes.trim());
  return parts.join(" · ");
}

/** MOVE_IN/MOVE_OUT metraj/kilo özeti ("95 m · 12,3 kg"). */
export function quantitySummary(e: Pick<SessionActivityEvent, "qty" | "weight">): string {
  const parts: string[] = [];
  if (e.qty != null) parts.push(`${trNum(e.qty)} m`);
  if (e.weight != null) parts.push(`${trNum(e.weight)} kg`);
  return parts.join(" · ");
}

/** ERROR olayı özeti ("50. m · Delik") — metre noktası + hata türü. */
export function errorSummary(e: Pick<SessionActivityEvent, "errorMeter" | "errorType">): string {
  const parts: string[] = [];
  if (e.errorMeter != null) parts.push(`${trNum(e.errorMeter)}. m`);
  if (e.errorType) parts.push(e.errorType);
  return parts.join(" · ");
}

/** Olay türüne göre uygun detay metni (top girişi/operasyon/hata/hareket). */
export function eventDetail(e: SessionActivityEvent): string {
  if (e.kind === "ERROR") return errorSummary(e);
  if (e.kind === "OPERATION") return metadataSummary(e.metadata);
  // ROLL_CREATED + MOVE_IN/OUT → metraj/kilo
  return quantitySummary(e);
}

/** Özet satırı — yalnız sıfır-olmayan sayaçlar (istasyona göre kısa kalsın). */
export function summaryLine(s: SessionActivitySummary): string {
  const parts: string[] = [];
  if (s.rollCreatedCount) parts.push(`${s.rollCreatedCount} kumaş girişi`);
  if (s.moveInCount) parts.push(`${s.moveInCount} istasyon girişi`);
  if (s.errorCount) parts.push(`${s.errorCount} hata`);
  if (s.operationCount) parts.push(`${s.operationCount} işlem`);
  if (s.moveOutCount) parts.push(`${s.moveOutCount} istasyon çıkışı`);
  if (s.rollCancelledCount) parts.push(`${s.rollCancelledCount} iptal`);
  return parts.join(" · ");
}

const toDateInput = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Varsayılan tarih aralığı — son N gün (bugün dahil), <Input type="date"> değerleri. */
export function defaultRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: toDateInput(from), to: toDateInput(now) };
}
