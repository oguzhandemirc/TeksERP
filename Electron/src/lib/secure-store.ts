/**
 * Makineye özel key/value deposunun TEK geçidi — Electron'da `window.api.secureStore`
 * (electron-store + safeStorage, şifreli), tarayıcıda (web build) localStorage.
 *
 * secure-store tüketicileri (secure-token / api-config / machine-config / deviceId)
 * `window.api.secureStore`'a doğrudan değil BU modülden erişir; böylece aynı kod
 * iki hedefte de çalışır ve Electron davranışı bayt-bayt aynı kalır (api varsa
 * her çağrı ona delege edilir).
 *
 * OTURUM TOKEN'I TARAYICIDA HİÇ SAKLANMAZ (bulut web paneli K2, 2026-10-15): kimlik
 * sunucunun httpOnly çerezindedir; `auth.token` webStore'da yazılmaz/okunmaz (silme
 * eski demo derlemesinden kalan kaydı temizler). Panel kipi kapalı backend JSON token
 * dönerse token yalnız `tokenStore`un bellek önbelleğinde yaşar (yenilemede ölür).
 * Electron yolunda localStorage'a düşmek YASAK (api varken webStore'a asla düşülmez).
 */
import type { SecureStoreApi } from "@shared/ipc-contract";

/** localStorage anahtar öneki — UI tercihleri gibi diğer localStorage
 *  kayıtlarıyla ad çakışmasın. */
const WEB_PREFIX = "secure.";

/** Tarayıcıda kalıcı depoya HİÇ girmeyen anahtar — oturum token'ı (`secure-token.ts`). */
const WEB_NEVER_PERSIST = "auth.token";

/** Tarayıcı fallback'i — SecureStoreApi ile aynı sözleşme (async imzalar). */
const webStore: SecureStoreApi = {
  async get(key: string): Promise<string | null> {
    if (key === WEB_NEVER_PERSIST) return null;
    return window.localStorage.getItem(WEB_PREFIX + key);
  },
  async set(key: string, value: string): Promise<void> {
    if (key === WEB_NEVER_PERSIST) return;
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
