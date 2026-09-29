// Patron bulutu hakkı — TEK kaynak. Kira (`patronBulutBitis` · `esitlemeAraligiDk`) ve iç API
// (`patronBulutBitis` · `saklamaAy`) bu dosyayı çağırır: iki yüzey aynı kurulum için farklı bitiş ya da
// aralık söyleyemez (bekçi: test_bulut_kira_alanlari).
import type { Hak, Kurulum } from "@prisma/client";

export const CLOUD_MODULE_KEY = "patron-bulut";

/** Eşitleme aralığı sınırları (dk) — portal girişi reddeder, kira basımı kıstırır. */
export const SYNC_MINUTES_MIN = 1;
export const SYNC_MINUTES_MAX = 60;
export const SYNC_MINUTES_DEFAULT = 5;
/** Buluttaki geçmişin saklama seçenekleri (ay); `null` = tüm geçmiş. */
export const CLOUD_RETENTION_MONTHS = [3, 13, 25] as const;
export const CLOUD_RETENTION_DEFAULT = 13;

type CloudHak = Pick<Hak, "aktif" | "guncelSurum" | "moduller" | "bakimBitis" | "gecerlilikBitis">;

/**
 * Patron bulutu hakkının bitişi. Hak imzalı ve `patron-bulut` modülünü taşıyor, modül yaptırımla
 * donmamış olmalı; bitiş bakım ve (varsa) geçerlilik bitişinin ERKENİ (ticari model kararı gelene dek).
 */
export function cloudEntitlementUntil(hak: CloudHak | null, frozenModules: readonly string[]): Date | null {
  if (!hak || !hak.aktif || hak.guncelSurum < 1 || !hak.moduller.includes(CLOUD_MODULE_KEY)) return null;
  if (frozenModules.includes(CLOUD_MODULE_KEY)) return null;
  const ends = [hak.bakimBitis.getTime(), ...(hak.gecerlilikBitis ? [hak.gecerlilikBitis.getTime()] : [])];
  return new Date(Math.min(...ends));
}

/** Kiraya basılan eşitleme aralığı: kurulum ayarı 1–60'a kıstırılır (DB CHECK'i de aynı sınır). */
export function leaseSyncMinutes(installation: Pick<Kurulum, "esitlemeAraligiDk">): number {
  const v = installation.esitlemeAraligiDk;
  if (!Number.isFinite(v)) return SYNC_MINUTES_DEFAULT;
  return Math.min(SYNC_MINUTES_MAX, Math.max(SYNC_MINUTES_MIN, Math.trunc(v)));
}

/** İç API'ye giden saklama süresi (ay; `null` = tüm geçmiş). Doğrulama iç API'nin KATI şemasında (fazla/yanlış = 500). */
export function cloudRetentionMonths(installation: Pick<Kurulum, "bulutSaklamaAy">): number | null {
  return installation.bulutSaklamaAy;
}

/** Kiranın bulut alanları — issueLease bunu çağırır. */
export function leaseCloudFields(
  installation: Pick<Kurulum, "esitlemeAraligiDk">,
  hak: CloudHak | null,
  frozenModules: readonly string[],
): { patronBulutBitis: string | null; esitlemeAraligiDk: number } {
  const until = cloudEntitlementUntil(hak, frozenModules);
  return { patronBulutBitis: until ? until.toISOString() : null, esitlemeAraligiDk: leaseSyncMinutes(installation) };
}
