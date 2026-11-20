// DESTEK MERKEZİ — istemci kurulumu ve hata eşlemesi. Fabrikadaki `destek-transport.helper.ts`in bulut karşılığı:
// zaman aşımları ve `details.code` eşlemesi AYNIDIR (patron uygulaması ile panel aynı kararı verir). Fark: bulutta
// kurumsal vekil/egress katmanı yoktur; istek doğrudan `fetch` ile gider (Expo/Telegram çıkışıyla aynı düzen).
// Anahtar HİÇBİR çıktıya girmez: günlük satırı yalnız merkez kodu + HTTP durumu taşır, hata gövdesine merkezin kendi
// Türkçe mesajı ya da sabit metin yazılır. Merkez erişilemezken yalnız destek uçları hata döner (istek başına süre).
import { DestekApiError, DestekClient } from "../../integrations/destek";
import { CloudError } from "../../lib/errors";
import { isCenterCode } from "./codes";
import type { SupportApiConfig } from "./config";

/** İstek zaman aşımları (ms): normal, ekli yükleme, okunmamış rozeti. */
export const SUPPORT_TIMEOUT_MS = 15_000;
export const SUPPORT_UPLOAD_TIMEOUT_MS = 60_000;
export const SUPPORT_BADGE_TIMEOUT_MS = 5_000;

export function createSupportClient(cfg: SupportApiConfig, timeoutMs: number, fetchImpl: typeof fetch): DestekClient {
  return new DestekClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, timeoutMs, uploadTimeoutMs: timeoutMs, fetch: fetchImpl });
}

const UNREACHABLE = "Destek merkezine ulaşılamadı, lütfen biraz sonra tekrar deneyin.";
const MISCONFIGURED = "Destek bağlantısı şu an kullanılamıyor (sunucu yapılandırması). Sistem yöneticinize bildirin.";
/** Merkezin kimlik/imza reddi: istemciye 401 olarak GİTMEZ (uygulama 401'de oturumu kapatır). */
const CONFIG_CODES = new Set(["INVALID_API_KEY", "INVALID_SIGNATURE", "TIMESTAMP_OUT_OF_RANGE", "INSTALLATION_INACTIVE"]);
/** Günlüğe yalnız kısa kod (merkez kodu biçimsizse kırpılır). */
const shortCode = (s: string): string => s.replace(/[^A-Z0-9_]/g, "").slice(0, 40) || "BILINMIYOR";

function warn(text: string): void {
  console.warn(`[patron] destek: ${text}`);
}

/**
 * Merkez hatasını bulut hata sözleşmesine çevirir (`details.code`). Bilinmeyen (merkez dışı) hata aynen döner
 * (genel 500 yolu). Anahtar hiçbir dalda mesaja girmez.
 */
export function mapSupportError(e: unknown): unknown {
  if (!(e instanceof DestekApiError)) return e;
  const center = { merkezKodu: shortCode(e.code) };
  if (e.status === 0) {
    warn(`merkez isteği düştü: ${center.merkezKodu}`);
    return e.code === "TIMEOUT" ? new CloudError(504, "DESTEK_ZAMAN_ASIMI", UNREACHABLE, center) : new CloudError(502, "DESTEK_ULASILAMADI", UNREACHABLE, center);
  }
  if (e.status === 429) {
    const retryAfterSec = Math.min(Math.max(Math.ceil(e.retryAfterSeconds ?? 30), 1), 3600);
    return new CloudError(429, "RATE_LIMITED", "Destek merkezine çok sık istek gönderildi; biraz bekleyip tekrar deneyin.", { retryAfterSec });
  }
  if (e.status >= 500 || e.code === "REPLAYED") {
    warn(`merkez hatası: ${center.merkezKodu} (HTTP ${e.status})`);
    return new CloudError(502, "DESTEK_ULASILAMADI", UNREACHABLE, center);
  }
  if (e.status === 401 || CONFIG_CODES.has(e.code)) {
    warn(`merkez bağlantıyı reddetti: ${center.merkezKodu} (HTTP ${e.status})`);
    return new CloudError(502, "DESTEK_YAPILANDIRMA", MISCONFIGURED, center);
  }
  const message = e.message.slice(0, 500) || "Destek merkezi isteği reddetti.";
  return isCenterCode(e.code) ? new CloudError(e.status, e.code, message) : new CloudError(e.status >= 400 && e.status < 500 ? e.status : 502, "DESTEK_HATASI", message, center);
}

/** Merkez çağrısı: hata eşlenmiş olarak fırlar. */
export async function callCenter<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw mapSupportError(e);
  }
}
