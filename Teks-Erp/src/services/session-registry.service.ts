// =============================================================================
// TeksERP - Session Registry Service
// =============================================================================
// JWT jti tabanlı oturum defteri: anlık iptal + aynı cihaz-tipi (electron/mobil)
// oturum politikası. AuthService.issueToken login yolunda openLoginSession'ı çağırır.
//
// Kurallar:
//  - 1 Electron + 1 mobil HER ZAMAN serbest — politika yalnız AYNI deviceType'ın
//    2. girişine uygulanır (cross-type asla çakışmaz).
//  - 'kick' (default): aynı (userId,deviceType) aktif oturumları revoke et, sonra
//    yeni satır oluştur (tek tx — atomik). Eski cihaz bir sonraki istekte 401.
//  - 'notify': aktif same-type varsa ve confirmKick!=true → 409 SESSION_EXISTS
//    (mevcut oturum bilgisiyle). confirmKick=true → ikisi de açık kalır.
//  - 'off': sessizce yeni satır (çoklu same-type serbest).
//  - Teklik ('kick') UYGULAMA katmanında sağlanır — (userId,deviceType) partial-unique
//    YOK (off/notify çoklu aktif gerektirir). Bkz. schema.prisma Session model yorumu.
// =============================================================================

import prisma from "../lib/prisma";
import { ClientType } from "@prisma/client";
import { AppError } from "../utils/app-error";
import type { SameTypeSessionPolicy } from "./system-setting.service";

export interface OpenLoginSessionInput {
  userId: string;
  deviceType: ClientType;
  /** Serbest cihaz kimliği (x-device-id ya da req.device.deviceId) — kayıtsız client
   *  de login yapabildiği için FK DEĞİL; null olabilir (Electron/web). */
  deviceId: string | null;
  /** JWT jti (jwt.sign jwtid) — Session satırının anahtarı. */
  jti: string;
  /** Token bitiş anı (JWT exp ile hizalı) — süresi geçen satır aktif sayılmaz. */
  expiresAt: Date;
  policy: SameTypeSessionPolicy;
  /** 'notify' politikasında kullanıcı "ikisi de açık kalsın" onayı verdiyse true. */
  confirmKick?: boolean;
}

/** Mevcut oturum özeti — 409 SESSION_EXISTS payload'ında client'a döner. */
export interface ExistingSessionInfo {
  deviceType: ClientType;
  createdAt: Date;
  deviceId: string | null;
}

export class SessionRegistryService {
  /**
   * Login sırasında yeni oturum kaydı aç — aynı-tip politikasını uygular.
   * 'notify' + aktif same-type + !confirmKick → AppError.conflict (SESSION_EXISTS).
   */
  static async openLoginSession(
    input: OpenLoginSessionInput,
  ): Promise<{ id: string }> {
    const { userId, deviceType, deviceId, jti, expiresAt, policy, confirmKick } = input;

    // notify: onay verilmediyse ve aynı tipte AKTİF (revoke edilmemiş, süresi dolmamış)
    // oturum varsa 409 döner; client confirmKick=true ile tekrar çağırıp ikisini açar.
    if (policy === "notify" && !confirmKick) {
      const existing = await prisma.session.findFirst({
        where: {
          userId,
          deviceType,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
        select: { deviceType: true, createdAt: true, deviceId: true },
      });
      if (existing) {
        const existingSession: ExistingSessionInfo = {
          deviceType: existing.deviceType,
          createdAt: existing.createdAt,
          deviceId: existing.deviceId,
        };
        throw AppError.conflict("Bu hesap başka bir cihazda açık", {
          code: "SESSION_EXISTS",
          existingSession,
        });
      }
    }

    return prisma.$transaction(async (tx) => {
      // kick: aynı (userId,deviceType) aktif oturumları düşür (atomik claim). off/notify
      // için düşürme YOK — ikisi de (ya da çoklu) açık kalır.
      if (policy === "kick") {
        await tx.session.updateMany({
          where: { userId, deviceType, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: "NEW_LOGIN" },
        });
      }
      return tx.session.create({
        data: { userId, deviceType, jti, deviceId, expiresAt },
        select: { id: true },
      });
    });
  }

  /** Tek oturumu (jti) iptal et — idempotent (zaten iptal/yok → revoked:false). */
  static async revokeSession(
    jti: string | undefined | null,
    reason: string,
  ): Promise<{ revoked: boolean }> {
    if (!jti) return { revoked: false };
    const res = await prisma.session.updateMany({
      where: { jti, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason.slice(0, 32) },
    });
    return { revoked: res.count > 0 };
  }

  /** Kullanıcının TÜM aktif oturumlarını iptal et (şifre sıfırlama / pasife alma / silme). */
  static async revokeAllForUser(
    userId: string,
    reason: string,
  ): Promise<{ count: number }> {
    const res = await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason.slice(0, 32) },
    });
    return { count: res.count };
  }

  /** jti hâlâ geçerli mi (kayıt var + iptal edilmemiş). Middleware fail-closed okur. */
  static async isSessionValid(jti: string | undefined | null): Promise<boolean> {
    if (!jti) return false;
    const s = await prisma.session.findUnique({
      where: { jti },
      select: { revokedAt: true },
    });
    return !!s && s.revokedAt === null;
  }

  /**
   * ÖLÜ oturum satırlarının fiziksel temizliği (admin bakım ucu — Faz 3).
   * Tablo hiç temizlenmiyordu: login başına 1 satır + hiç DELETE yok → yıllar
   * içinde sınırsız büyüme (ilk dayanıklılık denetiminin hijyen bulgusu).
   * KAPSAM MATEMATİĞİ: yalnız `revokedAt < cutoff` VEYA `expiresAt < cutoff`
   * satırlar silinir — aktif oturum (revokedAt null + expiresAt gelecekte) iki
   * koşula da giremez, silinmesi imkânsız. Fiziksel DELETE bilinçli istisnadır
   * (system-logs archive emsali: operasyonel kayıt bakımı, domain verisi değil).
   * Silinen jti'nin middleware etkisi yok: isSessionValid kayıt-yok'u zaten
   * geçersiz sayar (fail-closed) — purge edilen oturum çoktan ölüydü.
   */
  static async purgeDeadSessions(olderThanDays: number): Promise<{ deleted: number }> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    const res = await prisma.session.deleteMany({
      where: {
        OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
      },
    });
    return { deleted: res.count };
  }
}
