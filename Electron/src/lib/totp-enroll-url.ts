/**
 * 2FA KURULUM BAĞLANTISI — yöneticinin kullanıcıya ilettiği adres.
 *
 * ⚠️ ADRESİ `window.location`TAN TÜRETMEK YANLIŞTIR. Yönetici bu bağlantıyı
 * çoğunlukla FABRİKA İÇİNDEN, Electron panelinden üretir; orada konum
 * `file://` (Electron) ya da `http://192.168.1.250:4000` (LAN web) olur ve
 * ikisi de kullanıcının DIŞARIDAN açabileceği bir adres DEĞİLDİR — üstelik
 * hata sessizdir: bağlantı yöneticinin makinesinde çalışır, patronun
 * telefonunda açılmaz.
 *
 * Bu yüzden dış adres AÇIKÇA yapılandırılır (`VITE_PUBLIC_APP_URL`, derleme
 * anında gömülür). Yapılandırılmamışsa mevcut origin'e düşülür ve bu, LAN'da
 * kurulum yapan kurulumlar için doğru davranıştır (uzaktan erişim yoksa
 * kullanıcı zaten fabrikadadır).
 */
/** Kurulum sayfasının hash-router yolu — router, App kapısı ve URL üreteci
 *  AYNI sabitten beslenir. Üç yerde elle yazılsaydı biri değişince bağlantı
 *  sessizce "Bağlantı geçersiz" ekranına düşerdi. */
export const TOTP_ENROLL_PATH = "/2fa-kurulum";

export function buildTotpEnrollUrl(
  token: string,
  publicBase: string | undefined = import.meta.env.VITE_PUBLIC_APP_URL,
): string {
  const base = (publicBase ?? "").trim().replace(/\/+$/, "");
  const origin =
    base ||
    (typeof window !== "undefined" && window.location.protocol.startsWith("http")
      ? window.location.origin
      : "");
  // Hash router: kurulum sayfası `#/2fa-kurulum` altında yaşıyor.
  return `${origin}/#${TOTP_ENROLL_PATH}?token=${encodeURIComponent(token)}`;
}
