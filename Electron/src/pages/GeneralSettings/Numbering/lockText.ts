// =============================================================================
// KİLİT ROZETİ — sınıfın ADI panelde, CÜMLESİ sunucuda (2026-09-23)
// =============================================================================
// ⚠️ CÜMLELER BURADAN KALDIRILDI ve gerekçesi ÖLÇÜLDÜ: tablo satırı panelin
// kendi metnini ("Bu serinin biçimi yapısal olarak değişemez"), diyalog ise
// sunucunun metnini ("… ön ek Faz B inmeden açılmaz") gösteriyordu — aynı kilit,
// İKİ FARKLI ve ÇELİŞEN cümle (d3 ölçtü, gerçek panel). Kilit gerekçesi bir
// KARARDIR ve kararın tek kaynağı katalogla servistir; panel onu OKUR.
//
// Panelde kalan iki şey SUNUM: ① rozetin tek kelimelik sınıf adı, ② eylemin
// kimde olduğuna göre vurgu. İkisi de cümle değil, bu yüzden kopya sayılmaz.
// =============================================================================
import type { NumberSeriesRow, SeriesLockKind } from "./types";

/** Rozet — tek kelimelik SINIF ADI (cümle değil). */
const ROZET: Record<SeriesLockKind, string> = {
  YAPISAL: "Değiştirilemez",
  SAYAC: "Hazırlanmadı",
  ISTEMCI: "Güncelleme bekliyor",
};

/**
 * Eylem KİMDE — sunucudan gelir (`lockActor`). Alan yoksa (backend eski) sınıfa
 * göre türetilir: backend ÖNCE çıkar, ama panelin eski backend'e karşı sessizce
 * yanlış vurgu vermesi de kabul edilemez.
 */
const ACTOR_FALLBACK: Record<SeriesLockKind, "kimse" | "biz" | "siz"> = {
  YAPISAL: "kimse",
  SAYAC: "biz",
  ISTEMCI: "siz",
};

export function lockBadge(kind: SeriesLockKind): string {
  return ROZET[kind];
}

/** Kullanıcının KENDİ çözebileceği kilit mi? (Rozet vurgulu çizilir.) */
export function userCanResolve(row: Pick<NumberSeriesRow, "lockKind" | "lockActor">): boolean {
  if (!row.lockKind) return false;
  return (row.lockActor ?? ACTOR_FALLBACK[row.lockKind]) === "siz";
}

/**
 * Ekranda gösterilecek kilit cümlesi — NEDEN + NE ZAMAN, ikisi de sunucudan.
 * Panel burada yalnız BİRLEŞTİRİR; hiçbir metni kendisi yazmaz.
 */
export function lockSentence(row: Pick<NumberSeriesRow, "lockedReason" | "lockUnlock">): string {
  return [row.lockedReason, row.lockUnlock].filter(Boolean).join(" ");
}
