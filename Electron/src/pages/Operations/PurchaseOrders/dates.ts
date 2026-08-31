// =============================================================================
// TARİH YARDIMCILARI — TEK KAYNAKTAN
// =============================================================================
// ⚠️ KOPYALAMAK YERİNE YENİDEN İHRAÇ EDİLİYOR. Gün sınırı kuralı (yerel 00:00 /
// 23:59:59.999) ve iki tuzağı — `toISOString().slice(0,10)`'un günü BİR GERİ
// kaydırması, `new Date("2026-08-14")`'ün metni UTC gece yarısı sayması — Paket
// C'de bir kez çözüldü ve gerekçesiyle `Finance/Cheques/dates.ts` başlığında
// yazılı. İkinci bir kopya çıkarmak, iki dosyanın gün gelip AYRIŞMASI demekti:
// aynı ekranda "vadesi geçti" diyen iki filtre farklı gün sınırı kullanırdı.
//
// Ekranın kendi sorusu (`beklenen tarih geçti mi`) burada, ortak olan orada.
// =============================================================================
export { dayEndIso, dayStartIso, fmtDate, parseYmdLocal, ymd } from "@/pages/Finance/Cheques/dates";

import type { PurchaseOrderStatus } from "./service";

/** Beklenen tarihin tonu — yalnız İŞİ BİTMEMİŞ siparişte anlamlı. */
export type ExpectedTone = "overdue" | "soon" | "normal" | "closed" | "none";

/**
 * ⚠️ TARİHSİZ SİPARİŞ "GECİKMİŞ" SAYILMAZ (`none`). Backend'in `overdueOnly`
 * süzgeci de aynı kuralı uygular: bilgi yokluğunu suçlamaya çevirmek, hiç termin
 * girilmemiş her siparişi kırmızıya boyayıp gerçek gecikmeleri görünmez yapardı.
 *
 * ⚠️ TAMAMLANMIŞ/İPTAL siparişin beklenen tarihi geçmiş olabilir ama bu bir
 * UYARI DEĞİLDİR: iş bitmiştir. Kapanmış satırı kırmızıya boyamak ekranı, gerçek
 * gecikmelerin seçilemediği bir kırmızı denizine çevirirdi (`dueTone` emsali).
 */
export function expectedTone(
  expectedDate: string | null | undefined,
  status: PurchaseOrderStatus,
): ExpectedTone {
  if (status === "CLOSED" || status === "CANCELLED") return "closed";
  if (!expectedDate) return "none";
  const d = new Date(expectedDate);
  if (Number.isNaN(d.getTime())) return "none";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return "overdue";
  // 7 gün: haftalık planlama penceresi — "bu hafta ne gelecek" sorusunun karşılığı.
  if (diffDays <= 7) return "soon";
  return "normal";
}

export const EXPECTED_TONE_CLASS: Record<ExpectedTone, string> = {
  overdue: "font-semibold text-destructive",
  soon: "font-medium text-amber-700 dark:text-amber-500",
  normal: "",
  closed: "text-muted-foreground",
  none: "text-muted-foreground",
};

/** Renk tek başına erişilebilir değil — yanına kısa ibare basılır. */
export function expectedHint(tone: ExpectedTone): string {
  if (tone === "overdue") return "termin geçti";
  if (tone === "soon") return "bu hafta";
  if (tone === "none") return "termin yok";
  return "";
}
