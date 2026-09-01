// =============================================================================
// TeksERP — TOTP HESAP İŞLEMLERİ (kurulum penceresi · doğrulama · sıfırlama)
// =============================================================================
// `totp.service.ts` saf kriptografidir; burası DB'ye dokunan katmandır.
//
// TASARIM KARARI — KURULUMUN TEK YOLU YÖNETİCİNİN AÇTIĞI PENCEREDİR.
// "Parola doğruysa kullanıcı kendi kursun" (TOFU) cazip ama 2FA'nın koruduğu
// TEK senaryoyu kapatır: parola sızmışsa saldırgan 2FA'yı kendi telefonuna
// bağlar ve meşru sahibi kilitler. Burada kurulumu bir İNSAN yetkilendirir
// (`admin:users`), pencere tek kullanımlık ve kısa ömürlüdür.
// =============================================================================

import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  verifyTotp,
} from "./totp.service";

/** Kurulum penceresinin ömrü. Kısa: bağlantı bir sohbet/telefon görüşmesi
 *  boyunca kullanılır, gün boyu açık kalan bir kapı olması amaçlanmadı. */
export const ENROLLMENT_TTL_MS = 15 * 60 * 1000;

/** QR'da görünen hesap sağlayıcı adı. */
const TOTP_ISSUER = "TeksERP";

export type TotpStatus = {
  enabled: boolean;
  enabledAt: Date | null;
  /** Kullanılmamış kurtarma kodu sayısı — "1 kod kaldı" uyarısının kaynağı. */
  remainingRecoveryCodes: number;
};

export class TotpAccountService {
  /** Kullanıcının TOTP durumu (panel + giriş akışı ortak kullanır). */
  static async getStatus(userId: string): Promise<TotpStatus> {
    const [user, remaining] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { totpSecret: true, totpEnabledAt: true },
      }),
      prisma.userRecoveryCode.count({ where: { userId, usedAt: null } }),
    ]);
    return {
      // ⚠️ İKİ ALAN BİRDEN aranır: sır yazılı ama `totpEnabledAt` boşsa kurulum
      // YARIM kalmıştır ve o kullanıcıyı kilitlememek gerekir.
      enabled: Boolean(user?.totpSecret && user.totpEnabledAt),
      enabledAt: user?.totpEnabledAt ?? null,
      remainingRecoveryCodes: remaining,
    };
  }

  /**
   * Yönetici bir kullanıcı için kurulum penceresi açar.
   *
   * Açık ve tüketilmemiş önceki pencereler İPTAL EDİLİR (süresi geçmiş sayılır):
   * aynı anda iki geçerli kurulum bağlantısı dolaşması, "hangisi geçerliydi"
   * sorusunu cevapsız bırakırdı.
   */
  static async openWindow(params: {
    userId: string;
    openedById: string;
  }): Promise<{ token: string; expiresAt: Date; otpauthUri: string; secret: string }> {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, username: true, isActive: true, deletedAt: true },
    });
    if (!user || !user.isActive || user.deletedAt) {
      throw AppError.notFound("Kullanıcı bulunamadı veya pasif.");
    }

    const secret = generateTotpSecret();
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);

    await prisma.$transaction(async (tx) => {
      await tx.totpEnrollment.updateMany({
        where: { userId: params.userId, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });
      await tx.totpEnrollment.create({
        data: { userId: params.userId, openedById: params.openedById, token, secret, expiresAt },
      });
    });

    await AuditService.log({
      userId: params.openedById,
      action: "CREATE",
      tableName: "totp_enrollments",
      recordId: token,
      newData: { userId: params.userId, username: user.username, expiresAt },
    });

    return {
      token,
      expiresAt,
      secret,
      otpauthUri: buildOtpauthUri({
        username: user.username,
        secretBase32: secret,
        issuer: TOTP_ISSUER,
      }),
    };
  }

  /** Pencereyi token'dan çöz — QR'ı göstermek için. Tüketmez. */
  static async readWindow(token: string): Promise<{
    username: string;
    otpauthUri: string;
    secret: string;
    expiresAt: Date;
  }> {
    const row = await prisma.totpEnrollment.findUnique({
      where: { token },
      select: {
        secret: true,
        expiresAt: true,
        consumedAt: true,
        user: { select: { username: true, isActive: true } },
      },
    });
    // Tek mesaj — "süresi doldu" ile "hiç yoktu" ayrımı token tahmin edene ipucu verir.
    if (!row || row.consumedAt || row.expiresAt <= new Date() || !row.user.isActive) {
      throw AppError.notFound("Kurulum bağlantısı geçersiz veya süresi dolmuş.");
    }
    return {
      username: row.user.username,
      secret: row.secret,
      expiresAt: row.expiresAt,
      otpauthUri: buildOtpauthUri({
        username: row.user.username,
        secretBase32: row.secret,
        issuer: TOTP_ISSUER,
      }),
    };
  }

  /**
   * Kurulumu tamamla: kullanıcı telefonundaki ilk kodu doğrular.
   *
   * ⚠️ ATOMİK CLAIM (`updateMany` + `count===0` → 409). `findUnique → if → update`
   * yazılsaydı iki eşzamanlı istek aynı pencereyi iki kez tüketip iki farklı
   * kurtarma kodu seti üretirdi; kullanıcı birini saklar, diğeri sessizce
   * geçerli kalırdı.
   */
  static async consumeWindow(
    token: string,
    code: string,
  ): Promise<{ recoveryCodes: string[]; username: string }> {
    const row = await prisma.totpEnrollment.findUnique({
      where: { token },
      select: {
        userId: true,
        secret: true,
        expiresAt: true,
        consumedAt: true,
        user: { select: { username: true, isActive: true } },
      },
    });
    if (!row || row.consumedAt || row.expiresAt <= new Date() || !row.user.isActive) {
      throw AppError.notFound("Kurulum bağlantısı geçersiz veya süresi dolmuş.");
    }

    // Kurulumda replay kilidi YOK (`lastUsedStep` verilmez): kullanıcının henüz
    // kabul edilmiş bir adımı yoktur ve ilk kod tanım gereği ilktir.
    const check = verifyTotp(row.secret, code);
    if (!check.ok) {
      throw AppError.badRequest(
        check.reason === "format"
          ? "Kod 6 haneli olmalı."
          : "Kod doğrulanamadı. Telefonunuzdaki güncel kodu girin.",
        { code: "TOTP_INVALID" },
      );
    }

    const plainCodes = generateRecoveryCodes();
    const hashed = await Promise.all(plainCodes.map((c) => bcrypt.hash(c, 10)));

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.totpEnrollment.updateMany({
        where: { token, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw AppError.conflict("Bu kurulum bağlantısı az önce kullanıldı.", {
          code: "ENROLLMENT_CONSUMED",
        });
      }
      await tx.user.update({
        where: { id: row.userId },
        data: {
          totpSecret: row.secret,
          totpEnabledAt: new Date(),
          totpLastStep: check.step,
          // ⚠️ tokenVersion BUMP EDİLMEZ: 2FA kurmak yetkiyi değiştirmez ve
          // kullanıcıyı açık oturumlarından atmak için bir sebep yok. (Sıfırlama
          // farklıdır — orada bumplanır.)
        },
      });
      // Eski kullanılmamış kodlar geçersiz — yeni set tek geçerli settir.
      await tx.userRecoveryCode.deleteMany({ where: { userId: row.userId, usedAt: null } });
      await tx.userRecoveryCode.createMany({
        data: hashed.map((codeHash) => ({ userId: row.userId, codeHash })),
      });
    });

    await AuditService.log({
      userId: row.userId,
      action: "UPDATE",
      tableName: "users",
      recordId: row.userId,
      newData: { totpEnabled: true, recoveryCodesIssued: plainCodes.length },
    });

    return { recoveryCodes: plainCodes, username: row.user.username };
  }

  /**
   * Giriş sırasında ikinci faktörü doğrula. TOTP kodu VEYA kurtarma kodu kabul eder.
   *
   * ⚠️ Kurtarma kodu TEK KULLANIMLIKTIR ve atomik claim ile tüketilir; aksi hâlde
   * eşzamanlı iki deneme aynı kodu iki kez geçirebilirdi.
   */
  static async verifySecondFactor(userId: string, code: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true },
    });
    if (!user?.totpSecret || !user.totpEnabledAt) return false;

    const result = verifyTotp(user.totpSecret, code, { lastUsedStep: user.totpLastStep });
    if (result.ok) {
      // Replay kilidi: kabul edilen adım kaydedilir. `lte` koşulu YARIŞ içindir —
      // iki eşzamanlı istek aynı kodu kullanırsa yalnız biri adımı ilerletir.
      await prisma.user.updateMany({
        where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: result.step } }] },
        data: { totpLastStep: result.step },
      });
      return true;
    }
    if (result.reason === "replay") return false;

    return this.consumeRecoveryCode(userId, code);
  }

  /** Kurtarma kodunu tüket. Eşleşme yoksa `false`. */
  private static async consumeRecoveryCode(userId: string, input: string): Promise<boolean> {
    const candidate = normalizeRecoveryCode(input);
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(candidate)) return false;

    const rows = await prisma.userRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
    for (const row of rows) {
      if (!(await bcrypt.compare(candidate, row.codeHash))) continue;
      const claimed = await prisma.userRecoveryCode.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return false; // Yarışı kaybetti — kod zaten harcandı.
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "user_recovery_codes",
        recordId: row.id,
        newData: { used: true, remaining: rows.length - 1 },
      });
      return true;
    }
    return false;
  }

  /**
   * Yönetici sıfırlaması — telefon kaybı / cihaz değişimi.
   *
   * ⚠️ `tokenVersion` BUMP EDİLİR (kurulumdan farklı olarak): 2FA'yı kaldırmak
   * hesabın güvenlik duruşunu DÜŞÜRÜR ve bu, açık oturumların yeniden
   * doğrulanmasını gerektirir. Sıfırlama zaten "bu hesapta bir şey ters gitti"
   * anlamına gelir.
   */
  static async reset(params: { userId: string; byId: string }): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: params.userId },
        data: {
          totpSecret: null,
          totpEnabledAt: null,
          totpLastStep: null,
          tokenVersion: { increment: 1 },
        },
      });
      await tx.userRecoveryCode.deleteMany({ where: { userId: params.userId, usedAt: null } });
      await tx.totpEnrollment.updateMany({
        where: { userId: params.userId, consumedAt: null },
        data: { expiresAt: new Date() },
      });
    });
    await AuditService.log({
      userId: params.byId,
      action: "UPDATE",
      tableName: "users",
      recordId: params.userId,
      newData: { totpEnabled: false, reason: "ADMIN_RESET" },
    });
  }
}
