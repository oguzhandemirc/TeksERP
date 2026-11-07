// =============================================================================
// TeksERP - System Setting / session
// =============================================================================
// Oturum süresi · boşta kalma · mobil kilit okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { isHostedInstallation } from "../helpers/install-class.helper";
import { asBoolean, asNumber } from "./core";
import { DEFAULT_ABSOLUTE_SESSION_CAP_DAYS, DEFAULT_AUTO_LOGOUT_ON_EXPIRY, DEFAULT_IDLE_TIMEOUT_MINUTES, DEFAULT_MOBILE_IDLE_LOCK_ENABLED, DEFAULT_MOBILE_IDLE_LOCK_MINUTES, DEFAULT_MOBILE_LOCK_ON_BACKGROUND, DEFAULT_MOBILE_OFFLINE_LOCK_DEFER, DEFAULT_REMEMBER_LAST_USER, DEFAULT_SAME_TYPE_SESSION_POLICY, DEFAULT_SESSION_DURATION_HOURS, DEFAULT_SESSION_DURATION_MINUTES, DEFAULT_WORK_SESSION_IDLE_MINUTES, MAX_ABSOLUTE_SESSION_CAP_DAYS, MAX_IDLE_TIMEOUT_MINUTES, MAX_MOBILE_IDLE_LOCK_MINUTES, MAX_SESSION_DURATION_HOURS, MAX_SESSION_DURATION_MINUTES, MAX_WORK_SESSION_IDLE_MINUTES, MIN_MOBILE_IDLE_LOCK_MINUTES, SAME_TYPE_SESSION_POLICIES, type SameTypeSessionPolicy } from "./defaults";
import { SETTING_KEYS } from "./keys";


/**
 * Oturum (JWT) ömrünü SAAT olarak okur. Yoksa/geçersizse 8 (eski sabit davranış).
 * 1 saatin altı → default; tavanı MAX_SESSION_DURATION_HOURS'a (30 gün) kırpılır.
 * AuthService.login bunu okuyup jwt.sign expiresIn'e (saniye) çevirir.
 */
export async function readSessionDurationHours(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_SESSION_DURATION_HOURS },
    select: { value: true },
  });
  if (!setting) return DEFAULT_SESSION_DURATION_HOURS;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return DEFAULT_SESSION_DURATION_HOURS;
  return Math.min(Math.floor(parsed), MAX_SESSION_DURATION_HOURS);
}

/**
 * Oturum (JWT) ömrünü DAKİKA olarak okur — dakika-granüler yeni ayar (tek kaynak).
 * Öncelik: auth.sessionDurationMinutes. Bu satır YOKSA geriye-uyum: eski
 * auth.sessionDurationHours ×60 (o da yoksa/geçersizse 480 = 8 saat). Değer
 * 1..MAX_SESSION_DURATION_MINUTES (43200 = 30 gün) aralığına kırpılır.
 * AuthService.issueToken bunu okuyup jwt.sign expiresIn'e (×60 saniye) çevirir.
 */
export async function readSessionDurationMinutes(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_SESSION_DURATION_MINUTES },
    select: { value: true },
  });
  const clamp = (n: number) =>
    Math.min(Math.max(1, Math.floor(n)), MAX_SESSION_DURATION_MINUTES);
  if (!setting) {
    // Dakika satırı yok → eski saat ayarına düş (×60), o da yoksa default 480.
    const hoursSetting = await client.systemSetting.findUnique({
      where: { key: SETTING_KEYS.AUTH_SESSION_DURATION_HOURS },
      select: { value: true },
    });
    if (!hoursSetting) return DEFAULT_SESSION_DURATION_MINUTES;
    const hours = asNumber(hoursSetting.value);
    if (hours === null || hours < 1) return DEFAULT_SESSION_DURATION_MINUTES;
    return clamp(Math.floor(hours) * 60);
  }
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 1) return DEFAULT_SESSION_DURATION_MINUTES;
  return clamp(parsed);
}

/**
 * Hareketsizlik zaman aşımını DAKİKA olarak okur. Yoksa/geçersizse 0 (kapalı).
 * 0 = kapalı (otomatik çıkış yok); tavanı MAX_IDLE_TIMEOUT_MINUTES'a (24 saat) kırpılır.
 * Frontend (Electron AppShell) bunu okuyup idle logout sayacını kurar — backend
 * token'ı yine kendi mutlak ömrüne kadar geçerli kalır (idle salt UI tarafı).
 */
export async function readIdleTimeoutMinutes(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_IDLE_TIMEOUT_MINUTES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_IDLE_TIMEOUT_MINUTES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return DEFAULT_IDLE_TIMEOUT_MINUTES;
  return Math.min(Math.floor(parsed), MAX_IDLE_TIMEOUT_MINUTES);
}
/**
 * Çalışma oturumu (WorkSession) hareketsizlik zaman aşımını DAKİKA olarak okur.
 * Yoksa/geçersizse 600 (10 saat); 0 = kapalı; tavan 1440. Backend TEMBEL enforce
 * eder — timer/cron yok: resolveActiveSession / sweepIdleSessions okuma anında
 * süresi dolan oturumu IDLE ile kapatır (work-session.helper.ts).
 */
export async function readWorkSessionIdleTimeoutMinutes(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORK_SESSION_IDLE_TIMEOUT_MINUTES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_WORK_SESSION_IDLE_MINUTES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return DEFAULT_WORK_SESSION_IDLE_MINUTES;
  return Math.min(Math.floor(parsed), MAX_WORK_SESSION_IDLE_MINUTES);
}

/**
 * Aynı-tip oturum politikasını okur: 'kick' (default) | 'notify' | 'off'. Yoksa/
 * geçersizse 'kick' (eskiyi düşür, yeni kazanır). AuthService.issueToken bunu okuyup
 * SessionRegistryService.openLoginSession'a geçirir (backend ENFORCE).
 */
export async function readSameTypeSessionPolicy(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<SameTypeSessionPolicy> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY },
    select: { value: true },
  });
  const v = setting?.value;
  if (typeof v === "string" && SAME_TYPE_SESSION_POLICIES.includes(v as SameTypeSessionPolicy)) {
    return v as SameTypeSessionPolicy;
  }
  return DEFAULT_SAME_TYPE_SESSION_POLICY;
}

/**
 * Token süresi dolunca istemci otomatik çıkış yapsın mı? Default TRUE (kayıt yoksa).
 * Client (mobil + Electron) ENFORCE eder — JWT exp decode → süre dolunca logout.
 */
export async function readAutoLogoutOnExpiry(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  // Barındırılan (internete açık) kurulumda sınıf kilidi: çalınan token sessizce aylarca yaşamasın (VDS O2).
  if (isHostedInstallation()) return true;
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY },
    select: { value: true },
  });
  if (!setting) return DEFAULT_AUTO_LOGOUT_ON_EXPIRY;
  return asBoolean(setting.value);
}

/**
 * Mobil hareketsizlik ekran kilidi açık mı? Default TRUE (kayıt yoksa). Client (mobil)
 * ENFORCE eder — tablet mobileIdleLockMinutes kadar dokunulmazsa kilit ekranı gelir.
 */
export async function readMobileIdleLockEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_MOBILE_IDLE_LOCK_ENABLED },
    select: { value: true },
  });
  if (!setting) return DEFAULT_MOBILE_IDLE_LOCK_ENABLED;
  return asBoolean(setting.value);
}

/**
 * Mobil "uygulama arka plana geçince anında kilitle" açık mı? Default TRUE (kayıt
 * yoksa). Idle kilitten bağımsız. Client (mobil) ENFORCE eder — AppState 'active'
 * dışına çıkınca kilit ekranı gelir (work session açık kalır; kart/PIN ile açılır).
 */
export async function readMobileLockOnBackground(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_MOBILE_LOCK_ON_BACKGROUND },
    select: { value: true },
  });
  if (!setting) return DEFAULT_MOBILE_LOCK_ON_BACKGROUND;
  return asBoolean(setting.value);
}

/** Çevrimdışıyken tablet kilidi ertelensin mi? Default FALSE (kayıt yoksa). Client (mobil) ENFORCE. */
export async function readMobileOfflineLockDefer(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_MOBILE_OFFLINE_LOCK_DEFER },
    select: { value: true },
  });
  if (!setting) return DEFAULT_MOBILE_OFFLINE_LOCK_DEFER;
  return asBoolean(setting.value);
}

/** Giriş ekranı son kullanıcıyı hatırlasın mı? Default FALSE (kayıt yoksa). Client (panel) ENFORCE. */
export async function readRememberLastUser(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_REMEMBER_LAST_USER },
    select: { value: true },
  });
  if (!setting) return DEFAULT_REMEMBER_LAST_USER;
  return asBoolean(setting.value);
}

/**
 * Mobil idle kilit süresini DAKİKA olarak okur. Yoksa/geçersizse 10; 1..120 aralığına
 * kırpılır. Client (mobil) ENFORCE eder.
 */
export async function readMobileIdleLockMinutes(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_MOBILE_IDLE_LOCK_MINUTES },
    select: { value: true },
  });
  if (!setting) return DEFAULT_MOBILE_IDLE_LOCK_MINUTES;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < MIN_MOBILE_IDLE_LOCK_MINUTES) return DEFAULT_MOBILE_IDLE_LOCK_MINUTES;
  return Math.min(Math.floor(parsed), MAX_MOBILE_IDLE_LOCK_MINUTES);
}

/**
 * Mutlak oturum tavanını GÜN olarak okur. Yoksa/geçersizse 30. 0 KABUL edilir (reader 0
 * döner, panel "sert tavan" gösterir); negatif → default. Tavan 365'e kırpılır. AuthService
 * .issueToken bunu `effectiveAbsoluteSessionCapDays` ile okur: zaman aşımı kapalıyken bile
 * token en fazla bu kadar gün yaşar (capDays>0 → capDays gün; 0 → UNSET_… sert tavan).
 */
export async function readAbsoluteSessionCapDays(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS },
    select: { value: true },
  });
  if (!setting) return DEFAULT_ABSOLUTE_SESSION_CAP_DAYS;
  const parsed = asNumber(setting.value);
  if (parsed === null || parsed < 0) return DEFAULT_ABSOLUTE_SESSION_CAP_DAYS;
  return Math.min(Math.floor(parsed), MAX_ABSOLUTE_SESSION_CAP_DAYS);
}
