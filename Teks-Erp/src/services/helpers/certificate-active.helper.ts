// =============================================================================
// K4P-SERT — sertifika etkinlik ve süre dolumu yüklemi (TEK KAYNAK)
// =============================================================================
// "Etkin sertifika" ve "süresi yaklaşan sertifika" sorusunu panel listesi, özet şeridi ve bildirim
// kaynağı (`notification-sources/kalite.ts`) AYNI yüklemden sorar — boğaz-ikiz: Prisma parçası ↔
// bellek-içi yüklem. `expiresOn` karşılaştırması başka dosyada yazılmaz (`test_sertifika_suresi_tek_kaynak`).
// Gün ölçüsü fabrika takvim günüdür (`factoryDayKeyUtcMidnight`); `expiresOn` `@db.Date` UTC gece yarısıdır.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { factoryDayKeyUtcMidnight } from "../../constants/time";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Etkin = iptal edilmemiş ∧ yenileyeni yok. */
export const ACTIVE_CERTIFICATE_WHERE = {
  revokedAt: null,
  renewedBy: { is: null },
} as const satisfies Prisma.CertificateWhereInput;

/** Bellek ikizi — `renewedBy` ilişkisinin yüklenmiş olması gerekir (yoksa yenilenmiş sertifika etkin görünürdü). */
export function isActiveCertificate(c: { revokedAt: Date | null; renewedBy: { id: string } | null }): boolean {
  return c.revokedAt === null && c.renewedBy === null;
}

/** Bugünün fabrika günü (UTC gece yarısı anahtarı) — `expiresOn` ile aynı uzay. */
export function certificateToday(at: Date = new Date()): Date {
  return factoryDayKeyUtcMidnight(at);
}

/** Etkin ∧ `expiresOn − bugün ≤ days` (süresi geçmiş dahil). */
export function certificateExpiryWhere(today: Date, days: number): Prisma.CertificateWhereInput {
  return { ...ACTIVE_CERTIFICATE_WHERE, expiresOn: { lte: new Date(today.getTime() + days * DAY_MS) } };
}

/** Bellek ikizi: `certificateExpiryWhere` ile aynı cevap. */
export function isCertificateExpiring(
  c: { revokedAt: Date | null; renewedBy: { id: string } | null; expiresOn: Date },
  today: Date,
  days: number,
): boolean {
  return isActiveCertificate(c) && certificateDaysLeft(c.expiresOn, today) <= days;
}

/** Kalan gün (negatif = süresi geçti). İki taraf da UTC gece yarısı → tam sayı. */
export function certificateDaysLeft(expiresOn: Date, today: Date): number {
  return Math.round((expiresOn.getTime() - today.getTime()) / DAY_MS);
}

/** Düzenleme günü geçerlilik sonundan sonra mı (DB CHECK `certificates_dates_ck` ikizi). */
export function isIssuedAfterExpiry(issuedOn: Date, expiresOn: Date): boolean {
  return issuedOn.getTime() > expiresOn.getTime();
}
