// Fason sevkinde beklenen dönüş (F6 `expectedReturnAt`) — ÜÇ durum: alan YOK (sunucu varsayılanı: firma > süreç türü
// > ayar; hiçbiri yoksa termin yok = bugünkü), tarih, açık `null` (termin yok). Eski backend alanı yok sayar.
import { factoryDayEndIso, factoryDayKey } from "@/lib/factory-time";

export type ExpectedReturnChoice = { mode: "DEFAULT" } | { mode: "DATE"; day: string } | { mode: "NONE" };

export const DEFAULT_EXPECTED_RETURN: ExpectedReturnChoice = { mode: "DEFAULT" };

/**
 * Gövde parçası. Gün, fabrika gününün SON anı olarak gider: sunucu "geçmiş fabrika günü"nü reddeder; bugünü seçmek
 * meşrudur ve anın kendisi değil günü sayılır. Boş tarih = varsayılan (alan gönderilmez).
 */
export function expectedReturnBody(c: ExpectedReturnChoice): { expectedReturnAt?: string | null } {
  if (c.mode === "NONE") return { expectedReturnAt: null };
  if (c.mode === "DATE" && /^\d{4}-\d{2}-\d{2}$/.test(c.day)) return { expectedReturnAt: factoryDayEndIso(c.day) };
  return {};
}

/** Seçilebilir en erken gün = bugün (fabrika günü). */
export const minExpectedReturnDay = (): string => factoryDayKey();

/** Geçmiş gün seçilmişse true — buton kapanır, sunucuya 400 için gidilmez. */
export function isPastExpectedReturn(c: ExpectedReturnChoice, today = factoryDayKey()): boolean {
  return c.mode === "DATE" && /^\d{4}-\d{2}-\d{2}$/.test(c.day) && c.day < today;
}
