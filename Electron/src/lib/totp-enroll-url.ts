/**
 * 2FA KURULUM ADRESİ — yöneticinin kullanıcıya ilettiği bağlantı ve uygulama içi yol.
 *
 * Kök açıkça verilebilir (`VITE_PUBLIC_APP_URL`, yalnız web derlemesinde gömülür); verilmezse
 * sayfanın http(s) origin'ine düşülür. Electron'da konum `file://`dir ve web paneli yayınlanmaz:
 * orada paylaşılabilir bağlantı YOKTUR (`null`) — kurulum uygulama içinde açılır (`enrollHash`).
 */
/** Kurulum sayfasının hash-router yolu — router, App kapısı ve URL üreteci
 *  AYNI sabitten beslenir. Üç yerde elle yazılsaydı biri değişince bağlantı
 *  sessizce "Bağlantı geçersiz" ekranına düşerdi. */
export const TOTP_ENROLL_PATH = "/2fa-kurulum";

/** Uygulama içi kurulum yolu (`window.location.hash` için) — bağlantı da bunu taşır. */
export function buildTotpEnrollHash(token: string): string {
  return `#${TOTP_ENROLL_PATH}?token=${encodeURIComponent(token)}`;
}

function currentHttpOrigin(): string {
  return typeof window !== "undefined" && window.location.protocol.startsWith("http")
    ? window.location.origin
    : "";
}

/** Başka bir cihazda açılabilir MUTLAK bağlantı; kök yoksa `null` (göreli bağlantı hiçbir yerde açılmaz). */
export function buildTotpEnrollUrl(
  token: string,
  publicBase: string | undefined = import.meta.env.VITE_PUBLIC_APP_URL,
  pageOrigin: string = currentHttpOrigin(),
): string | null {
  const origin = ((publicBase ?? "").trim() || pageOrigin.trim()).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(origin)) return null;
  return `${origin}/${buildTotpEnrollHash(token)}`;
}
