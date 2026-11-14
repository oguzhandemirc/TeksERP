// =============================================================================
// VADE — TEK KAYNAK (S5b, 2026-11-14): "bu belgenin vadesi ne, geçti mi, yaklaştı mı"
// =============================================================================
// Cari Yaşlandırma raporundan (`reports/finance-aging.report.ts`) TAŞINDI; rapor buradan okur ve geriye uyum için
// aynı adlarla yeniden dışa açar. Vade bildirimleri (`notification-sources/finans-vade.ts`) aynı fonksiyonlardan
// karar verir — iki yüzey ayrı formül yazarsa aynı faturaya biri "gecikmiş", öteki "vadesi gelmedi" der.
// Saf fonksiyonlar: DB okumaz. Bekçi: `test_bildirim_bosluk` §0 (tanımlar yalnız bu dosyada).
// =============================================================================

const DAY_MS = 86_400_000;

// ⚠️ `notDue` (vadesi gelmemiş) BİLİNÇLİ olarak listede: gecikme merdiveni (0-30 / 31-60 / 61-90 / 90+) GECİKMİŞ GÜN
// sayar. Bu kova olmadan, bugün kesilmiş 30 gün vadeli bir fatura "0-30 gün gecikmiş" kovasına düşer ve rapor olmayan
// bir gecikmeyi ihbar eder. "Vadesiz" ise vade BİLGİSİ olmayan satırdır — ikisi farklı sorulardır.
export const AGING_BUCKETS = ["notDue", "d0_30", "d31_60", "d61_90", "d90plus", "noDueDate"] as const;
export type AgingBucketKey = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucketKey, string> = {
  notDue: "Vadesi gelmemiş",
  d0_30: "0-30 gün",
  d31_60: "31-60 gün",
  d61_90: "61-90 gün",
  d90plus: "90+ gün",
  noDueDate: "Vadesiz",
};

/** Vadenin hangi yoldan geldiği (uydurma vade basılmaz). */
export type DueSource = "DOCUMENT" | "PAYMENT_TERM" | "NONE";

/** Gecikme gününü kovaya çevirir. TEK KAYNAK — sınırlar başka yerde tekrarlanmaz. */
export function bucketOfDaysOverdue(daysOverdue: number | null): AgingBucketKey {
  if (daysOverdue === null) return "noDueDate";
  if (daysOverdue < 0) return "notDue";
  if (daysOverdue <= 30) return "d0_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90plus";
}

/** Gecikmiş kova mı (vadesi gelmemiş ve vadesiz HARİÇ) — patron bulutunun `vadesiGecti`si bununla aynı. */
export function isOverdueBucket(bucket: AgingBucketKey): boolean {
  return bucket !== "notDue" && bucket !== "noDueDate";
}

/**
 * EFEKTİF VADE: belge vadesi → tarih + cari vade günü → yok. Uydurma vade basılmaz; hangi yoldan geldiği
 * `dueSource` ile döner (gerekçe: rapor dosya başlığı "EFEKTİF VADE").
 */
export function resolveEffectiveDue(r: {
  dueDate: Date | null;
  issueDate: Date;
  paymentTermDays: number | null | undefined;
}): { effectiveDue: Date | null; dueSource: DueSource } {
  if (r.dueDate) return { effectiveDue: r.dueDate, dueSource: "DOCUMENT" };
  if (r.paymentTermDays !== null && r.paymentTermDays !== undefined) {
    return { effectiveDue: new Date(r.issueDate.getTime() + r.paymentTermDays * DAY_MS), dueSource: "PAYMENT_TERM" };
  }
  return { effectiveDue: null, dueSource: "NONE" };
}

/**
 * Gecikme günü — iki AN arasındaki mutlak fark (takvim günü sorusu değil, fabrika saat dilimine kesilmez);
 * vadesiz satırda `null`. Negatif = vadeye kalan (−1: 24 saatten az kaldı).
 */
export function daysOverdueAt(asOf: Date, effectiveDue: Date | null): number | null {
  // tz-ok: mutlak an farkı.
  return effectiveDue === null ? null : Math.floor((asOf.getTime() - effectiveDue.getTime()) / DAY_MS);
}

export type DueWindowState = "OVERDUE" | "DUE_SOON" | "NOT_DUE" | "NO_DUE";

/**
 * Vade penceresi: gecikmiş (raporun gecikmiş kovası) · `windowDays` gün içinde vadesi gelecek · daha uzak · vadesiz.
 * Kova kararından türer (ikinci sınır yazılmaz); `windowDays = 0` → "yaklaşan" kümesi boş.
 */
export function dueWindowState(daysOverdue: number | null, windowDays: number): DueWindowState {
  const bucket = bucketOfDaysOverdue(daysOverdue);
  if (bucket === "noDueDate") return "NO_DUE";
  if (isOverdueBucket(bucket)) return "OVERDUE";
  return daysOverdue! >= -windowDays ? "DUE_SOON" : "NOT_DUE";
}
