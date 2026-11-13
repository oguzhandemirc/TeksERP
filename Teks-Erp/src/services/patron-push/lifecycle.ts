// Patron push belirtecinin YAŞAM SONU — tek yer. Belirteç onu yazan oturumla yaşar:
//  · oturum iptal boğazı (`SessionRegistryService.revokeSession` / `revokeAllForUser`: çıkış, parola değişimi/
//    sıfırlama, pasif, silme) anında bırakır;
//  · boğazdan geçmeyen sonlar (aynı tip yeni giriş `kick`, oturum tavanı, süre dolumu, budanan oturum, pasif kullanıcı)
//    iş turunun süpürmesinde bırakılır.
// Bırakma = BIRAKILACAK + ham silinir; buluta `birak` iş turunda gider.
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { LIVE_STATES, RELEASE_DATA } from "./states";
import { requestPatronPushRound } from "./wake";

async function release(where: Prisma.PatronPushTokenWhereInput): Promise<number> {
  const res = await prisma.patronPushToken.updateMany({ where: { ...where, cloudState: { in: [...LIVE_STATES] } }, data: RELEASE_DATA });
  if (res.count > 0) requestPatronPushRound();
  return res.count;
}

/** Tek oturum bitti (çıkış). */
export function releasePushTokensForSession(jti: string): Promise<number> {
  return release({ session: { is: { jti } } });
}

/** Kullanıcının bütün oturumları bitti (parola, pasif, silme). */
export function releasePushTokensForUser(userId: string): Promise<number> {
  return release({ userId });
}

/** Süpürme: oturumu geçersiz (iptal · süresi dolmuş · budanmış) ya da kullanıcısı pasif olan canlı belirteçler. */
export function releaseOrphanPushTokens(now: Date = new Date()): Promise<number> {
  return release({
    OR: [
      { sessionId: null },
      { session: { is: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }] } } },
      { user: { is: { isActive: false } } },
    ],
  });
}
