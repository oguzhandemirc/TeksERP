/**
 * Sunucu Adresi penceresinin "Fabrika içi / Bulut" seçimi. Kip adresin biçiminden türer (docs/design/
 * TABLET-GENEL-CA-BAGLANTI.md §2 k1): mod `panelTransportFor`un SONUCUDUR, ikinci bir kural değildir. Seçim
 * yalnız ekranı sadeleştirir; seçimle adres çelişirse kayıt reddedilir, kipe sessiz düşüş olmaz.
 */
import { LAN_TLS_DEFAULT_PORT, panelTransportFor, type PanelTransport, type TlsPin } from "@shared/lan-tls";
import { isInternetHost } from "@shared/internet-tls";
import { joinApiBaseUrl, type ApiBaseUrlParts } from "@/lib/api-config";

export type ServerMode = "fabrika" | "bulut";

export const SERVER_MODES: readonly ServerMode[] = ["fabrika", "bulut"];

export const SERVER_MODE_LABEL: Record<ServerMode, string> = {
  fabrika: "Fabrika içi",
  bulut: "Bulut",
};

export const BULUT_ONLY_REASON =
  "Bulut bağlantısı yalnız etkiliyazilim.com altındaki adreslerle kurulur (ör. firmaniz.etkiliyazilim.com). Fabrikadaki sunucuya bağlanıyorsanız üstten “Fabrika içi”ni seçin.";

export const FABRIKA_INTERNET_REASON = "Bu adres bir bulut sunucusu — üstten “Bulut”u seçin.";

/** İnternet kipi (genel CA) → Bulut; döngü, sabitli, reddedilen her adres → Fabrika içi. */
export function serverModeOf(t: PanelTransport): ServerMode {
  return t.kind === "internet" ? "bulut" : "fabrika";
}

/** Kayıtlı/seçilen adresin modu; boş adres Fabrika içi (varsayılan). */
export function serverModeFor(pins: readonly TlsPin[], url: string): ServerMode {
  return url ? serverModeOf(panelTransportFor(pins, url, isInternetHost)) : "fabrika";
}

/** Seçilen mod adresin modunu tutmuyorsa Türkçe sebep. */
export function modeRefusal(mode: ServerMode, t: PanelTransport): string | null {
  if (serverModeOf(t) === mode) return null;
  return mode === "bulut" ? BULUT_ONLY_REASON : FABRIKA_INTERNET_REASON;
}

/** Şifresiz (http) seçeneği bu adreste kabul edilir mi — A2: yalnız döngü adresi; karar `panelTransportFor`da. */
export function httpAllowed(pins: readonly TlsPin[], parts: ApiBaseUrlParts): boolean {
  const url = joinApiBaseUrl({ ...parts, protocol: "http" });
  return !!url && panelTransportFor(pins, url, isInternetHost).kind !== "refused";
}

/**
 * Mod değişince alanlar: ikisinde de https. Fabrika içi şifreli LAN portuyla (4443) gelir; Bulut'ta port BOŞ
 * (443) ve kilitli — elle yazılmak istenirse açılır.
 */
export function partsForMode(mode: ServerMode, parts: ApiBaseUrlParts): ApiBaseUrlParts {
  if (mode === "bulut") return { protocol: "https", host: parts.host, port: "" };
  const port = parts.port && parts.protocol === "https" ? parts.port : String(LAN_TLS_DEFAULT_PORT);
  return { protocol: "https", host: parts.host, port };
}

/**
 * Fabrika içinde ağ adresi yazılınca şifresiz seçenek geçersizdir: http → https, API portu (ya da boş) → 4443.
 * Döngü adresinde (sunucu bilgisayarının kendisi) dokunulmaz.
 */
export function upgradeForNetwork(pins: readonly TlsPin[], parts: ApiBaseUrlParts, httpDefaultPort: string): ApiBaseUrlParts {
  if (parts.protocol !== "http" || !parts.host.trim() || httpAllowed(pins, parts)) return parts;
  const port = !parts.port || parts.port === httpDefaultPort ? String(LAN_TLS_DEFAULT_PORT) : parts.port;
  return { ...parts, protocol: "https", port };
}
