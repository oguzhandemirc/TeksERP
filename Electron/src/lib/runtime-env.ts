/**
 * Build hedefi tespiti — Electron'da preload `window.api`'yi her renderer
 * script'inden önce kurar; saf web build'inde (vite.config.web.ts) undefined kalır.
 *
 * Yalnız masaüstünde ANLAMLI yüzeyler bu bayrakla gizlenir (örn. "Sunucu adresi"
 * ayarı: web'de API, sayfanın açıldığı origin'dir — kullanıcı runtime'da adres
 * ezerse localStorage'a yazılan yanlış adres bir sonraki açılışta da uygulanır ve
 * kullanıcı kendi kilidini açamaz). Donanım ekranları bu bayrağı KULLANMAZ —
 * onlar kendi `window.api?.<domain>` kontrolleriyle "yalnız masaüstünde" mesajı
 * basmaya devam eder (domain bazlı degrade, toptan gizleme değil).
 */
export const IS_ELECTRON = typeof window !== "undefined" && Boolean(window.api);
