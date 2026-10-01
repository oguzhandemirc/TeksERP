// İşletim sistemine devredilen iki işlemin (dış bağlantı açma, klasörde gösterme) politikası.
// Saf modül: electron import etmez. Uygulayıcı `electron/security/external-open.ts`.

/**
 * Panelin işletim sistemi tarayıcısında açabileceği TEK adres kümesi (beyanlı izin listesi).
 * Ölçüldü: panelde dış bağlantı yalnız satıcı sitesine gider (kenar çubuğu markası + giriş ekranı).
 * Yeni bir hedef gerekiyorsa buraya EKLENİR — şema/alan adı kalıbıyla genişletilmez.
 */
export const EXTERNAL_LINK_HOSTS: readonly string[] = ["etkiliyazilim.com", "www.etkiliyazilim.com"];

const MAX_URL_LENGTH = 2048;

/** Yalnız https, kullanıcı bilgisi/port taşımayan ve izin listesindeki ana makine. */
export function isAllowedExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  return EXTERNAL_LINK_HOSTS.includes(url.hostname);
}

/**
 * "Klasörde göster" yalnız YEREL mutlak yola: UNC/ağ yolu (`\\sunucu\pay`, `//sunucu/pay`) ve
 * göreli yol HAYIR — ağ yoluna dokunmak Windows'ta kimlik özetini o sunucuya gönderebilir.
 */
export function isShowableLocalPath(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) return false;
  if (raw.startsWith("\\\\") || raw.startsWith("//") || raw.includes("\0")) return false;
  return /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("/");
}
