// =============================================================================
// VADE / TARİH YARDIMCILARI
// =============================================================================
// ⚠️ `toISOString().slice(0,10)` KULLANMA — UTC'ye çevirir ve TR'de gece
// yarısından önceki saatlerde günü BİR GERİ kaydırır. Vade tarihi kâğıdın
// üzerindeki gündür; bir gün kayması "vadesi geçti/geçmedi" kararını ters
// çevirir. Yerel bileşenlerden kurulur (`StatementDialog`/`RatesPage` emsali).
//
// ⚠️ GÜN SINIRI İSTEMCİNİNDİR: backend `dueDate`'i mutlak an olarak alır ve
// ekstra yuvarlama YAPMAZ (`useReportDateRange` sözleşmesi). Bu yüzden yerel
// 00:00 / 23:59:59.999 anlarını biz üretiriz.
//
// ⚠️ BOŞ/BOZUK TARİH `undefined` DÖNER, "bir tarih" DÖNMEZ. `<input type="date">`
// kullanıcı tarafından TEMİZLENEBİLİR ve değeri "" olur; bunu sessizce bir güne
// çevirmek (eski hâli `new Date(0, 0, 1)` üretiyordu → **1 Ocak 1900**) çekin
// keşide tarihini, belge numarasının GGAAYY parçasını ve olay defterinin
// tarihini hata vermeden yüz yıl geriye atardı. Çağıran ya alanı hiç göndermez
// (backend "şimdi"yi kullanır) ya da düğmeyi kapatır.
// =============================================================================
import type { ChequeStatus } from "./service";

/** `<input type="date">` değeri — YYYY-MM-DD, yerel bileşenlerden. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * `<input type="date">` değerini YEREL güne çevirir; geçersizse `null`.
 *
 * ⚠️ `new Date("2026-08-14")` bu metni **UTC gece yarısı** sayar (ECMAScript
 * tarih-yalnız biçim kuralı) — negatif UTC farkı olan bir makinede o an BİR
 * ÖNCEKİ güne düşer ve vade bir gün geriye kayar. Bileşenlerden kurmak bu
 * belirsizliği tamamen ortadan kaldırır.
 *
 * ⚠️ Bileşenlerden kurmanın kendi tuzağı da kapatıldı: `new Date(2026, 1, 31)`
 * hata vermez, **3 Mart**'a taşar. Kurulan tarih geri okunup doğrulanır.
 */
export function parseYmdLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** Yerel günün başlangıcı (mutlak an) — boş/bozuk girdide `undefined`. */
export function dayStartIso(value: string): string | undefined {
  const d = parseYmdLocal(value);
  if (!d) return undefined;
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Yerel günün sonu (mutlak an) — boş/bozuk girdide `undefined`. */
export function dayEndIso(value: string): string | undefined {
  const d = parseYmdLocal(value);
  if (!d) return undefined;
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/** Ekranda tarih — tek biçim (`tr-TR`), listede ve defterde aynı. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("tr-TR");
}

/**
 * VADE DURUMU — yalnız CANLI çekte anlamlıdır.
 *
 * ⚠️ Tahsil edilmiş / iptal edilmiş bir çekin vadesi "geçmiş" olabilir ama bu
 * bir UYARI DEĞİLDİR: iş bitmiştir. Kapanmış satırı kırmızıya boyamak, ekranı
 * gerçek gecikmelerin görülemediği bir kırmızı denizine çevirirdi.
 */
const LIVE_STATUSES: readonly ChequeStatus[] = ["PORTFOLIO", "AT_BANK", "ENDORSED", "ISSUED"];

export type DueTone = "overdue" | "soon" | "normal" | "closed";

export function dueTone(dueDate: string, status: ChequeStatus): DueTone {
  if (!LIVE_STATUSES.includes(status)) return "closed";
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return "normal";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return "overdue";
  // 7 gün: haftalık planlama penceresi — "bu hafta ne var" sorusunun karşılığı.
  if (diffDays <= 7) return "soon";
  return "normal";
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  overdue: "font-semibold text-destructive",
  soon: "font-medium text-amber-700 dark:text-amber-500",
  normal: "",
  closed: "text-muted-foreground",
};

/** Satır sonuna eklenen kısa ibare — renk tek başına erişilebilir değil. */
export function dueHint(tone: DueTone): string {
  if (tone === "overdue") return "vadesi geçti";
  if (tone === "soon") return "bu hafta";
  return "";
}
