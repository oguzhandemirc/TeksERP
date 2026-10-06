// Satıcı lisans sunucusunun adresi — TEK çözüm yeri; `LICENSE_SERVER_URL` başka yerde okunmaz
// (bekçi test_lisans_satici_adresi §4). Etkinleşmemiş kurulum adres ne olursa olsun dışarı çıkmaz.
import { isEgressTargetAllowed } from "../http-egress";

/** Tek satıcı: ortam verilmezse bu adres; `LICENSE_SERVER_URL` yalnız yerel prova/bekçi satıcısını gösterir. */
export const DEFAULT_LICENSE_SERVER_URL = "https://lisans.etkiliyazilim.com";
/** `LICENSE_SERVER_URL=kapali`: satıcıya hiç çıkılmaz (çevrimdışı kurulum, geliştirme makinesi). */
export const LICENSE_SERVER_DISABLED = "kapali";

export type VendorUrlSource = "varsayilan" | "ortam" | "kapali" | "gecersiz";

/**
 * Boş → varsayılan · `kapali` → null · yalnız köken (şema + host[:port]) kabul, dış çıkışla aynı
 * kural (HTTPS; düz HTTP yalnız döngü adresi) — biçimsiz değer null'a düşer (fail-closed).
 */
export function resolveVendorUrl(raw: string | undefined): { url: string | null; source: VendorUrlSource } {
  const v = raw?.trim();
  if (!v) return { url: DEFAULT_LICENSE_SERVER_URL, source: "varsayilan" };
  if (v.toLowerCase() === LICENSE_SERVER_DISABLED) return { url: null, source: "kapali" };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { url: null, source: "gecersiz" };
  }
  const originOnly = !u.username && !u.password && !u.search && !u.hash && (u.pathname === "/" || u.pathname === "");
  if (!originOnly || !isEgressTargetAllowed(u)) return { url: null, source: "gecersiz" };
  return { url: u.origin, source: "ortam" };
}

/** Süreç açılışındaki çözüm (ortam bir kez okunur); kaynak açılış günlüğüne yazılır, değer değil. */
export const STARTUP_VENDOR = resolveVendorUrl(process.env.LICENSE_SERVER_URL);
