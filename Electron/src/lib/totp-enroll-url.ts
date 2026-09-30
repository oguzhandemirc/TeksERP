/**
 * 2FA KURULUM BAĞLANTISI — yöneticinin kullanıcıya ilettiği adres.
 *
 * Kök açıkça verilebilir (`VITE_PUBLIC_APP_URL`, yalnız web derlemesinde gömülür); verilmezse
 * mevcut origin'e düşülür — fabrika dış adresi tünelle birlikte emekli (B6), kurulum LAN'dadır.
 * Electron'da konum `file://`dir; oradan bağlantı ÜRETİLMEZ (aşağıdaki boş dönüş sorunu görünür kılar).
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
