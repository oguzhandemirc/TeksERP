// Patron bulutunun adresi — TEK çözüm yeri; `PATRON_CLOUD_URL` başka yerde okunmaz.
// Adres tek başına eşitlemeyi ya da gelen kutusunu AÇMAZ: ön koşul kiradan ve HAK'tan gelir (`eligibility.ts`).
import { isEgressTargetAllowed } from "../lib/http-egress";

export const DEFAULT_PATRON_CLOUD_URL = "https://patron.etkiliyazilim.com";
/** `PATRON_CLOUD_URL=kapali`: buluta hiç çıkılmaz (geliştirme makinesi, çevrimdışı kurulum). */
export const PATRON_CLOUD_DISABLED = "kapali";

export type CloudUrlSource = "varsayilan" | "ortam" | "kapali" | "gecersiz";

/** Boş → varsayılan · `kapali` → null · yalnız köken; düz HTTP yalnız döngü adresine (test sahte bulutu). */
export function resolveCloudUrl(raw: string | undefined): { url: string | null; source: CloudUrlSource } {
  const v = raw?.trim();
  if (!v) return { url: DEFAULT_PATRON_CLOUD_URL, source: "varsayilan" };
  if (v.toLowerCase() === PATRON_CLOUD_DISABLED) return { url: null, source: "kapali" };
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

let current = resolveCloudUrl(process.env.PATRON_CLOUD_URL);

export function getCloudUrl(): { url: string | null; source: CloudUrlSource } {
  return current;
}

/** Test-only: sahte bulut adresi. */
export function setCloudUrlForTests(url: string | null): void {
  current = url === null ? { url: null, source: "kapali" } : resolveCloudUrl(url);
}
