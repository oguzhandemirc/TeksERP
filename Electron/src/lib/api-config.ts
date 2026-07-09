/**
 * Backend (API) adresinin çalışma-anı yönetimi.
 *
 * Adres build sırasında gömülür ama kurulu uygulamada sunucu IP'si değişebilir.
 * Bu yüzden kullanıcı adresi yerel olarak (electron-store / secure-store IPC)
 * o makineye özgü saklayabilir. Açılışta `bootstrapApiBaseUrl()` kayıtlı adresi
 * okuyup axios `baseURL`'ine uygular; kayıt yoksa `DEFAULT_API_BASE_URL` kalır.
 *
 * NOT: Hangi sunucuya bağlanılacağı **makineye** özgüdür — backend'deki
 * UserPreference'a değil, kasıtlı olarak yerel depoya yazılır.
 */
import apiClient, { DEFAULT_API_BASE_URL } from "@/services/apiClient";

/** secure-store anahtarı (token ile aynı şifreli blob içinde, ayrı key). */
const STORE_KEY = "config.apiBaseUrl";
/** Son kullanılan adreslerin listesi (hızlı seçim) — aynı yerel şifreli store. */
const RECENT_STORE_KEY = "config.apiBaseUrl.recent";
/** Hızlı-seçim listesinde tutulacak en fazla adres. */
const MAX_RECENT = 6;

export { DEFAULT_API_BASE_URL };

/** Boşluk kırp, protokol yoksa http:// ekle, sondaki / işaretlerini at. */
export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

/** Adresin parçaları — protokol / host(IP veya ad) / port ayrı input'lar için. */
export interface ApiBaseUrlParts {
  protocol: "http" | "https";
  /** IP veya hostname (port hariç). */
  host: string;
  /** Port (metin — boş olabilir). */
  port: string;
}

/**
 * Bir adres metnini protokol/host/port parçalarına ayırır. Yarım/eksik girdilerde
 * (form yazılırken) `new URL` kullanamayacağımız için elle ayrıştırır; hatalıda
 * makul varsayılan (http, boş host/port) döner — kullanıcı düzeltebilir.
 */
export function splitApiBaseUrl(raw: string): ApiBaseUrlParts {
  const trimmed = (raw ?? "").trim();
  const protoMatch = /^(https?):\/\//i.exec(trimmed);
  const protocol = (protoMatch?.[1]?.toLowerCase() as "http" | "https" | undefined) ?? "http";
  const rest = trimmed.replace(/^(https?):\/\//i, "").replace(/\/+$/, "");
  // İlk "/"e kadarki yetkili kısım (path'i at); sonra host:port ayır.
  const authority = rest.split("/")[0] ?? "";
  const lastColon = authority.lastIndexOf(":");
  // IPv6 değil, basit host:port — son ":" port ayırıcısı sayılır (sadece rakamsa).
  if (lastColon > -1 && /^\d+$/.test(authority.slice(lastColon + 1))) {
    return { protocol, host: authority.slice(0, lastColon), port: authority.slice(lastColon + 1) };
  }
  return { protocol, host: authority, port: "" };
}

/** Parçalardan normalize edilmiş adres kurar (port boşsa eklenmez). */
export function joinApiBaseUrl(parts: ApiBaseUrlParts): string {
  const host = parts.host.trim();
  if (!host) return "";
  const port = parts.port.trim();
  return normalizeApiBaseUrl(`${parts.protocol}://${host}${port ? `:${port}` : ""}`);
}

/** Yerel kayıtlı "son kullanılan adresler" (yeni→eski). Hatada boş liste. */
export async function getRecentApiBaseUrls(): Promise<string[]> {
  try {
    const raw = await window.api?.secureStore.get(RECENT_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((u): u is string => typeof u === "string");
  } catch {
    return [];
  }
}

/** Adresi son-kullanılanların başına ekler (normalize + tekilleştir + MAX_RECENT). */
export async function pushRecentApiBaseUrl(url: string): Promise<void> {
  const normalized = normalizeApiBaseUrl(url);
  if (!normalized) return;
  const current = await getRecentApiBaseUrls();
  const next = [normalized, ...current.filter((u) => u !== normalized)].slice(0, MAX_RECENT);
  try {
    await window.api?.secureStore.set(RECENT_STORE_KEY, JSON.stringify(next));
  } catch {
    /* sessiz geç — hızlı seçim listesi kritik değil */
  }
}

/** Bir adresi son-kullanılanlardan çıkarır (× ile silme). */
export async function removeRecentApiBaseUrl(url: string): Promise<string[]> {
  const normalized = normalizeApiBaseUrl(url);
  const next = (await getRecentApiBaseUrls()).filter((u) => u !== normalized);
  try {
    await window.api?.secureStore.set(RECENT_STORE_KEY, JSON.stringify(next));
  } catch {
    /* sessiz geç */
  }
  return next;
}

/** Yerel kayıtlı adres (yoksa null). IPC hatalarında sessizce null döner. */
export async function getStoredApiBaseUrl(): Promise<string | null> {
  try {
    return (await window.api?.secureStore.get(STORE_KEY)) ?? null;
  } catch {
    return null;
  }
}

/** Adresi yerel olarak kaydet. */
export async function setStoredApiBaseUrl(url: string): Promise<void> {
  await window.api.secureStore.set(STORE_KEY, normalizeApiBaseUrl(url));
}

/** Kayıtlı adresi sil — varsayılana dönüş. */
export async function clearStoredApiBaseUrl(): Promise<void> {
  await window.api.secureStore.delete(STORE_KEY);
}

/** axios singleton'ın baseURL'ini güncelle — bir sonraki istek anında kullanır. */
export function applyApiBaseUrl(url: string): void {
  apiClient.defaults.baseURL = normalizeApiBaseUrl(url);
}

/** O an axios'a uygulanmış aktif adres. */
export function getActiveApiBaseUrl(): string {
  return (apiClient.defaults.baseURL as string | undefined) ?? DEFAULT_API_BASE_URL;
}

/** Açılışta çağrılır: kayıtlı adres varsa baseURL'e uygula, yoksa default kalsın. */
export async function bootstrapApiBaseUrl(): Promise<void> {
  const stored = await getStoredApiBaseUrl();
  if (stored) applyApiBaseUrl(stored);
}
