// =============================================================================
// TeksERP - System Setting / device-auth
// =============================================================================
// Cihaz eşleme · kısa kimlik · TOTP okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { isHostedInstallation } from "../helpers/install-class.helper";
import { asBoolean, asNumber } from "./core";
import { DEFAULT_TRUSTED_DEVICE_DAYS, DEFAULT_WEB_TOTP_POLICY, MAX_TRUSTED_DEVICE_DAYS, WEB_TOTP_POLICIES, type WebTotpPolicy } from "./defaults";
import { SETTING_KEYS } from "./keys";


/**
 * Mobil cihaz eşleştirmesi ZORUNLU mu? Default false (pasif). Kapalıyken (default)
 * eşleşmemiş/kayıtsız tabletler de sisteme girebilir ve çalışır — ancak işledikleri
 * topta makine atfı (RollMovement/RollOperation.machineId) NULL kalır. Açıkken bugünkü
 * davranış: eşleşmemiş/pasif cihaz device.middleware'de 401 DEVICE_INACTIVE ile kesilir.
 * Diğer flag'lerin aksine ENFORCE edilir (middleware + mobileUsers + mobil pairing gate).
 */
export async function readDevicePairingRequired(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  // ETKİN değer: kısa kimlik "yalnız onaylı cihaz" kuralı (ya da barındırılan sınıf) eşleştirmeyi
  // de zorunlu kılar — otomatik onaylanan cihaz o kuralı içi boş bırakırdı.
  if (isHostedInstallation()) return true;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED },
    select: { value: true },
  });
  return asBoolean(setting?.value) || (await readStoredShortCredentialApprovedDeviceOnly(client));
}

/**
 * Cihaz kanıtı (`x-device-proof`) zorunlu mu — ETKİN değer. Default false (bugünkü davranış:
 * `x-device-id` tek başına cihazı tanır). Barındırılan kurulumda daima true.
 * ENFORCE: `device.middleware` kanıtsız/yanlış kanıtlı onaylı cihaza 401 `DEVICE_PROOF_INVALID`.
 */
export async function readDeviceProofRequired(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (isHostedInstallation()) return true;
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVICE_PROOF_REQUIRED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Onaysız (PENDING + aktif) tablet onay beklemeden yalnız kullanıcı adı + parolayla girebilsin mi.
 * Default false (bugünkü davranış). Barındırılan sınıf ZORLAMAZ — yönetici açar/kapatır.
 * ENFORCE: `device.middleware` (yalnız eşleştirme etkin zorunluyken) + `DeviceService` durum cevabı.
 * Rejim okuması: cache'siz (kapatıldığı AN onaysız tabletler kesilir).
 */
export async function readDeviceUnpairedPasswordLogin(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVICE_UNPAIRED_PASSWORD_LOGIN },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Kısa kimlik "yalnız onaylı cihaz" kuralının KAYITLI değeri (barındırılan sınıf hariç). */
export async function readStoredShortCredentialApprovedDeviceOnly(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Hızlı PIN / QR kartla giriş YALNIZ onaylı cihazdan mı — ETKİN değer. Default false
 * (bugünkü davranış: her istemci PIN/kart deneyebilir). Barındırılan kurulumda daima true.
 * ENFORCE: `auth.controller` login-quick-pin / login-card 403 `DEVICE_NOT_APPROVED`.
 */
export async function readShortCredentialApprovedDeviceOnly(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (isHostedInstallation()) return true;
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * 2FA'sı açık hesabın hızlı PIN / QR kart girişinde de TOTP kodu sorulsun mu. Default false
 * (bugünkü davranış). Süperadmin bu ayara BAKMAZ — onda PIN/kart girişinde kod hep sorulur.
 * ENFORCE: `AuthService.assertSecondFactor` (tek boğaz).
 */
export async function readShortCredentialTotpRequired(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_SHORT_CREDENTIAL_TOTP_REQUIRED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/**
 * Web paneli (tarayıcı, çerez kipi) TOTP politikası. Default REQUIRED (K4, bugünkü davranış).
 * FAIL-CLOSED: satır yok / çöp değer → REQUIRED. Süperadmin bu ayara BAKMAZ.
 * ENFORCE: `AuthService.assertSecondFactor` (tek boğaz).
 */
export async function readWebTotpPolicy(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<WebTotpPolicy> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_WEB_TOTP_POLICY },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && WEB_TOTP_POLICIES.includes(v as WebTotpPolicy)) return v as WebTotpPolicy;
  return DEFAULT_WEB_TOTP_POLICY;
}

/**
 * Web girişinde güvenilir cihaz süresi (gün). Default 0 (kapalı, bugünkü davranış).
 * FAIL-CLOSED: satır yok / çöp / negatif → 0; tavan MAX_TRUSTED_DEVICE_DAYS'e kırpılır.
 * ENFORCE: `AuthService.assertSecondFactor` (tek boğaz) → `trusted-device.service`.
 */
export async function readTrustedDeviceDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_TRUSTED_DEVICE_DAYS },
    select: { value: true },
  });
  if (!setting) return DEFAULT_TRUSTED_DEVICE_DAYS;
  const parsed = asNumber(setting.value);
  if (parsed === null || !Number.isFinite(parsed) || parsed < 1) return DEFAULT_TRUSTED_DEVICE_DAYS;
  return Math.min(Math.floor(parsed), MAX_TRUSTED_DEVICE_DAYS);
}
