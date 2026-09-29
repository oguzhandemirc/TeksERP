/**
 * Lisans PANEL AKTARMASI — saf doğrulama (main + testler ortak).
 *
 * Backend satıcıya çıkamıyorsa panel, backend'in İMZALADIĞI isteği satıcıya
 * taşır ve yanıtı backend'e geri verir. Panel sır görmez ve üretemez: istek
 * kurulum anahtarıyla, yanıt satıcı anahtarlarıyla imzalıdır (protokol §14).
 * Main süreç yine de rastgele bir POST vekili OLMAMALI — hedef yalnız satıcının
 * çevrimdışı ucu, gövde yalnız `{ v: 1, zarf }`.
 */

/** Satıcının çevrimdışı ucu (`ENDPOINTS.OFFLINE`) — hedef yol bununla bitmeli. */
export const LICENSE_RELAY_PATH = "/v1/cevrimdisi";
export const LICENSE_RELAY_TIMEOUT_MS = 30_000;
/** İmzalı zarf birkaç KB'dır; tavan kötü niyetli büyük gövdeyi keser. */
export const LICENSE_RELAY_MAX_ENVELOPE = 64 * 1024;
/** Lisans yanıtı (HAK + sertifika + kira + belirteçler) — birkaç on KB. */
export const LICENSE_RELAY_MAX_RESPONSE_BYTES = 512 * 1024;

export interface LicenseRelayRequest {
  /** Backend'in `aktarma-istegi` yanıtındaki `hedefUrl`. */
  hedefUrl: string;
  /** Backend'in `istekGovdesi` alanı — AYNEN gönderilir. */
  istekGovdesi: { v: 1; zarf: string };
}

export type LicenseRelayFailure =
  | "HEDEF_GECERSIZ"
  | "GOVDE_GECERSIZ"
  | "AG_HATASI"
  | "ZAMAN_ASIMI"
  | "YANIT_BUYUK"
  | "YANIT_JSON_DEGIL";

export type LicenseRelayResult =
  /** Satıcı cevap verdi (2xx ya da hata gövdesi); `yanit` JSON'dur. */
  | { ok: true; status: number; yanit: unknown }
  | { ok: false; kod: LicenseRelayFailure; status?: number };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Satıcının YAPILANDIRILMIŞ ana makineleri — aktarma yalnız bunlara gider (D12). Backend
 * `lib/license/vendor-url.ts` varsayılanı (üretim) + hazırlık satıcısı; ayna bekçisi
 * `license-relay.test.ts`. Hedefi backend söyler ama panel ona güvenmez: kurcalanmış bir
 * backend paneli fabrika ağından rastgele bir adrese POST atan bir vekile çeviremesin.
 */
export const LICENSE_VENDOR_HOSTS: readonly string[] = ["lisans.etkiliyazilim.com", "lisans-test.etkiliyazilim.com"];

export interface RelayTargetPolicy {
  /** Döngü adresi (sahte/yerel satıcı) — yalnız paketlenmemiş geliştirme derlemesinde. */
  allowLoopback: boolean;
}

/** Hedef adres satıcının çevrimdışı ucu mu? Geçerliyse normalize URL, değilse null. */
export function validateRelayTarget(raw: unknown, policy: RelayTargetPolicy): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const vendorHost = url.protocol === "https:" && LICENSE_VENDOR_HOSTS.includes(url.hostname);
  // Döngü adresi yalnız geliştirmede (Senaryo L'nin yerel satıcısı); üretim paketinde kapalı.
  const loopback = policy.allowLoopback && LOOPBACK_HOSTS.has(url.hostname) && (url.protocol === "http:" || url.protocol === "https:");
  if (!vendorHost && !loopback) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (!url.pathname.endsWith(LICENSE_RELAY_PATH)) return null;
  return url.toString();
}

/** Gövde tam olarak `{ v: 1, zarf }` mi? Fazla alan taşıyan gövde reddedilir. */
export function validateRelayBody(raw: unknown): { v: 1; zarf: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.length !== 2 || keys[0] !== "v" || keys[1] !== "zarf") return null;
  if (o.v !== 1 || typeof o.zarf !== "string") return null;
  if (o.zarf.length === 0 || o.zarf.length > LICENSE_RELAY_MAX_ENVELOPE) return null;
  // base64url alfabesi — zarf başka bir şey taşıyamaz.
  if (!/^[A-Za-z0-9_-]+$/.test(o.zarf)) return null;
  return { v: 1, zarf: o.zarf };
}
