/**
 * Makineye özel key/value deposunun TEK geçidi — Electron'da `window.api.secureStore`
 * (electron-store + safeStorage, şifreli), tarayıcıda (web build) localStorage.
 *
 * secure-store tüketicileri (secure-token / api-config / machine-config / deviceId)
 * `window.api.secureStore`'a doğrudan değil BU modülden erişir; böylece aynı kod
 * iki hedefte de çalışır ve Electron davranışı bayt-bayt aynı kalır (api varsa
 * her çağrı ona delege edilir).
 *
 * ⚠️ BİLİNÇLİ İSTİSNA — "renderer localStorage'a TOKEN YAZMAZ" kuralı (CLAUDE.md
 * Process Boundary): o kural Electron'da `safeStorage` gibi daha güvenli bir
 * alternatif OLDUĞU için var. Tarayıcıda işletim sistemi anahtarlığına erişim yok;
 * SPA'larda JWT'nin standart yeri localStorage'dır ve XSS yüzeyine karşı savunma
 * burada değil, kullanıcı HTML'i basan iframe'lerin sandbox'ında (`lib/print.ts`)
 * ve sunucudaki `sanitizeTemplateHtml`'dedir. Bu istisnayı genişletme: Electron
 * yolunda localStorage'a düşmek YASAK olmaya devam ediyor (api varken webStore'a
 * asla düşülmez).
 */
import type { SecureStoreApi } from "@shared/ipc-contract";

/** localStorage anahtar öneki — UI tercihleri gibi diğer localStorage
 *  kayıtlarıyla ad çakışmasın. */
const WEB_PREFIX = "secure.";

/** Tarayıcı fallback'i — SecureStoreApi ile aynı sözleşme (async imzalar). */
const webStore: SecureStoreApi = {
  async get(key: string): Promise<string | null> {
    return window.localStorage.getItem(WEB_PREFIX + key);
  },
  async set(key: string, value: string): Promise<void> {
    window.localStorage.setItem(WEB_PREFIX + key, value);
  },
  async delete(key: string): Promise<void> {
    window.localStorage.removeItem(WEB_PREFIX + key);
  },
};

/** Çağrı ANINDA çözülür (modül yükleme sırasına bağımlılık olmasın diye):
 *  Electron'da preload `window.api`'yi her renderer script'inden önce kurar,
 *  web'de hep webStore'a düşer. */
export const secureStore: SecureStoreApi = {
  get: (key) => (window.api?.secureStore ?? webStore).get(key),
  set: (key, value) => (window.api?.secureStore ?? webStore).set(key, value),
  delete: (key) => (window.api?.secureStore ?? webStore).delete(key),
};
