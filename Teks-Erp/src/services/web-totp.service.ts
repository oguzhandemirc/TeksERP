// =============================================================================
// Web (tarayıcı, çerez kipi) girişinde iki adımlı doğrulama — İKİ KATMAN (2026-11-01)
// =============================================================================
// ① Fabrika politikası `auth.webTotpPolicy` (yalnız süperadmin yazar): REQUIRED (varsayılan,
//    K4) | USER_CHOICE. ② Kullanıcı tercihi `User.webTotpOptOut`: yalnız USER_CHOICE iken
//    etkili, yalnız KENDİ hesabından (`PUT /api/auth/web-totp`) yazılır; kapatmak parola +
//    (kuruluysa) kod ister, açmak serbest. USER_CHOICE'ta TOTP kurmamış hesap kodsuz girer (kurmak =
//    seçmek). Sistem hesabında tercih yok sayılır (CHECK de var).
// Kararın TEK tüketicisi `AuthService.assertSecondFactor` → `webTotpWaived`.
// =============================================================================
import { verifyPassword } from "./helpers/password-hasher.helper";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { TotpAccountService } from "./totp-account.service";
import { readWebTotpPolicy, type WebTotpPolicy } from "./system-setting.service";
import { CURRENT_PASSWORD_INVALID_CODE } from "../constants/password-policy";

export interface WebTotpOwnState {
  policy: WebTotpPolicy;
  /** Kayıtlı tercih (politika REQUIRED iken de saklı kalır, ama etkisizdir). */
  optOut: boolean;
  /** Tercih şu an girişi etkiliyor mu (USER_CHOICE ∧ optOut ∧ sistem hesabı değil). */
  effective: boolean;
  totpEnabled: boolean;
  /** Sistem hesabında tercih değiştirilemez. */
  canChange: boolean;
}

/**
 * Bu kullanıcı web/barındırılan girişte TOTP'den muaf mı? FAIL-CLOSED: hesap okunamazsa muaf DEĞİL.
 * USER_CHOICE'ta sistem-dışı hesap için kod yalnız TOTP KURULU ∧ opt-out YOKSA istenir.
 */
export async function webTotpWaived(userId: string): Promise<boolean> {
  if ((await readWebTotpPolicy()) !== "USER_CHOICE") return false;
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { webTotpOptOut: true, isSystemAccount: true },
  });
  if (!row || row.isSystemAccount === true) return false;
  if (row.webTotpOptOut === true) return true;
  // "Herkes kendi seçer" (2026-11-01): kurmak = seçmek. Kurmamış kullanıcı kodu seçmemiştir; 403
  // vermek taze kurulumu kilitliyordu (opt-out yalnız oturum açıkken yazılabiliyor).
  return !(await TotpAccountService.getStatus(userId)).enabled;
}

export class WebTotpService {
  static async getOwnState(userId: string): Promise<WebTotpOwnState> {
    const policy = await readWebTotpPolicy();
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { webTotpOptOut: true, isSystemAccount: true } });
    const status = await TotpAccountService.getStatus(userId);
    if (!row) throw AppError.notFound("Kullanıcı bulunamadı.");
    const system = row.isSystemAccount === true;
    return {
      policy,
      optOut: row.webTotpOptOut,
      effective: policy === "USER_CHOICE" && row.webTotpOptOut && !system,
      totpEnabled: status.enabled,
      canChange: !system,
    };
  }

  /**
   * Kullanıcının KENDİ tercihi. `optOut=true` (kodu kaldırmak) yeniden doğrulama ister ve yalnız
   * USER_CHOICE politikasında kabul edilir; `optOut=false` (kodu geri açmak) her zaman serbesttir.
   * Yanlış parola/kod 400 (401 panelin oturum-bitti dalını açardı — `changeOwnPassword` emsali).
   */
  static async setOwnOptOut(
    userId: string,
    input: { optOut: boolean; currentPassword?: string; totpCode?: string },
  ): Promise<WebTotpOwnState> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, deletedAt: true, isSystemAccount: true, passwordHash: true, webTotpOptOut: true },
    });
    if (!user || !user.isActive || user.deletedAt) {
      throw AppError.unauthorized("Hesap pasif veya bulunamadı. Tekrar giriş yapın.");
    }
    if (user.isSystemAccount) {
      throw AppError.forbidden("Sistem hesabında internetten girişte doğrulama kodu her zaman istenir.", {
        code: "WEB_TOTP_SYSTEM_ACCOUNT",
      });
    }
    if (input.optOut) {
      if ((await readWebTotpPolicy()) !== "USER_CHOICE") {
        throw AppError.conflict("Bu kurulumda internetten girişte doğrulama kodu herkese zorunlu.", {
          code: "WEB_TOTP_POLICY_REQUIRED",
        });
      }
      const pw = input.currentPassword ?? "";
      if (!pw || !(await verifyPassword(pw, user.passwordHash))) {
        throw AppError.badRequest("Mevcut parola yanlış.", { code: CURRENT_PASSWORD_INVALID_CODE });
      }
      if ((await TotpAccountService.getStatus(userId)).enabled) {
        const code = (input.totpCode ?? "").trim();
        if (!code) throw AppError.badRequest("Doğrulama kodu gerekli.", { code: "TOTP_REQUIRED" });
        if (!(await TotpAccountService.verifySecondFactor(userId, code))) {
          throw AppError.badRequest("Doğrulama kodu geçersiz.", { code: "TOTP_INVALID" });
        }
      }
    }
    if (user.webTotpOptOut !== input.optOut) {
      // Atomik: sistem hesabı ve önceki değer WHERE'de (iki sekme yarışı sessiz ezilmez).
      const claimed = await prisma.user.updateMany({
        where: { id: userId, isSystemAccount: false, webTotpOptOut: user.webTotpOptOut },
        data: { webTotpOptOut: input.optOut },
      });
      if (claimed.count === 0) {
        throw AppError.conflict("Tercih bu sırada değişti. Sayfayı yenileyip tekrar deneyin.", {
          code: "WEB_TOTP_CONFLICT",
        });
      }
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "USER_WEB_TOTP",
        recordId: userId,
        changes: [{ field: "webTotpOptOut", old: user.webTotpOptOut, new: input.optOut }],
      });
    }
    return this.getOwnState(userId);
  }

  /** Yönetici görünümü: tercih (salt okuma) — başkası adına yazma yolu YOK. */
  static async readOptOut(userId: string): Promise<boolean> {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { webTotpOptOut: true } });
    return row?.webTotpOptOut === true;
  }

  /** Sistem sayfası uyarısı: politika + web 2FA'yı kendi hesabında kapatmış aktif kullanıcı sayısı. */
  static async summary(): Promise<{ policy: WebTotpPolicy; optedOutCount: number }> {
    const policy = await readWebTotpPolicy();
    const optedOutCount = await prisma.user.count({
      where: { webTotpOptOut: true, isSystemAccount: false, isActive: true, deletedAt: null },
    });
    return { policy, optedOutCount };
  }
}
