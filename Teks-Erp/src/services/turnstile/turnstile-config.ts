// =============================================================================
// Tarayıcı girişi bot koruması — Cloudflare Turnstile yapılandırması (V1c, 2026-11-13)
// =============================================================================
// Kapsam: YALNIZ web çerez kipi girişi (`cookieLoginApplies`). Panel (Electron Bearer), tablet ve
// patron telefonu etkilenmez — yönetici Cloudflare arızasında panelden girip kapatabilsin.
// Anahtarlar: açık/kapalı + site anahtarı DB'de (site anahtarı sır DEĞİL, tarayıcıya verilir);
// gizli anahtar YALNIZ ortam değişkeninde (`TURNSTILE_SECRET_KEY`) — DB'ye, log'a, audit'e, yanıta girmez.
// =============================================================================
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { isWebPanelMode } from "../../lib/web-session-cookie";
import { TURNSTILE_ENABLED_SETTING_KEY, TURNSTILE_SITE_KEY_SETTING_KEY } from "../../constants/reserved-settings";
import { systemSettingService } from "../system-setting.service";

export const TURNSTILE_SECRET_ENV = "TURNSTILE_SECRET_KEY";
/** Cloudflare site anahtarı biçimi (`0x4AAA…`, test anahtarları `1x0000…`); gevşek ama sınırlı. */
const SITE_KEY_RE = /^[0-9A-Za-z_-]{8,128}$/;

export interface TurnstileConfig {
  enabled: boolean;
  siteKey: string | null;
}

export interface TurnstileAdminView extends TurnstileConfig {
  /** Gizli anahtar ortamda tanımlı mı — DEĞERİ hiçbir yanıtta yok. */
  secretConfigured: boolean;
  /** Sunucu web paneli kipinde mi (değilse koruma hiçbir girişe uygulanmaz). */
  webPanelMode: boolean;
}

export function readTurnstileSecret(): string | null {
  const v = (process.env[TURNSTILE_SECRET_ENV] ?? "").trim();
  return v.length > 0 ? v : null;
}

/** Kayıt yok / çöp → kapalı (bugünkü davranış); site anahtarı biçimsizse yok sayılır. */
export async function readTurnstileConfig(): Promise<TurnstileConfig> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [TURNSTILE_ENABLED_SETTING_KEY, TURNSTILE_SITE_KEY_SETTING_KEY] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
  const site = byKey.get(TURNSTILE_SITE_KEY_SETTING_KEY);
  return {
    enabled: byKey.get(TURNSTILE_ENABLED_SETTING_KEY) === true,
    siteKey: typeof site === "string" && SITE_KEY_RE.test(site) ? site : null,
  };
}

/** Giriş sayfasının öğrendiği tek alan: koruma bu sunucuda uygulanıyorsa site anahtarı, değilse null. */
export async function readTurnstilePublicSiteKey(): Promise<string | null> {
  if (!isWebPanelMode()) return null;
  const cfg = await readTurnstileConfig();
  return cfg.enabled && cfg.siteKey ? cfg.siteKey : null;
}

export async function readTurnstileAdminView(): Promise<TurnstileAdminView> {
  return { ...(await readTurnstileConfig()), secretConfigured: readTurnstileSecret() !== null, webPanelMode: isWebPanelMode() };
}

/**
 * Tek yazma yüzeyi. Çıkışsız kapı üretmez: site anahtarı ya da ortamdaki gizli anahtar yokken
 * açma isteği 400 `TURNSTILE_KEYS_MISSING`. Kapatmak her zaman serbest. Audit `systemSettingService.set`ten.
 */
export async function updateTurnstileConfig(
  actorId: string,
  input: { enabled: boolean; siteKey?: string | null },
): Promise<TurnstileAdminView> {
  const current = await readTurnstileConfig();
  const siteKey = input.siteKey === undefined ? current.siteKey : (input.siteKey ?? "").trim() || null;
  if (siteKey !== null && !SITE_KEY_RE.test(siteKey)) {
    throw AppError.badRequest("Site anahtarı geçersiz görünüyor.", { code: "TURNSTILE_SITE_KEY_INVALID" });
  }
  if (input.enabled && (siteKey === null || readTurnstileSecret() === null)) {
    throw AppError.badRequest(
      `Açmak için site anahtarı girilmeli ve sunucuda ${TURNSTILE_SECRET_ENV} tanımlı olmalı.`,
      { code: "TURNSTILE_KEYS_MISSING", siteKey: siteKey !== null, secret: readTurnstileSecret() !== null },
    );
  }
  if (siteKey !== current.siteKey) {
    await systemSettingService.set(TURNSTILE_SITE_KEY_SETTING_KEY, siteKey ?? "", "Turnstile site anahtarı", actorId);
  }
  if (input.enabled !== current.enabled) {
    await systemSettingService.set(TURNSTILE_ENABLED_SETTING_KEY, input.enabled, "Tarayıcı girişi bot koruması", actorId);
  }
  return readTurnstileAdminView();
}
