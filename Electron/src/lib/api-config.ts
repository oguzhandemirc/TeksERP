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

export { DEFAULT_API_BASE_URL };

/** Boşluk kırp, protokol yoksa http:// ekle, sondaki / işaretlerini at. */
export function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
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
