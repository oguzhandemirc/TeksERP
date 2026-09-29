// Patron bulutu adresi — TEK çözüm yeri; `PATRON_BULUT_URL` başka yerde okunmaz.
// Varsayılan KAPALI (bugünkü davranış: dışarı veri kanalı yok); adres kurulumda açıkça verilir.
import { isEgressTargetAllowed } from "../lib/http-egress";

export type CloudUrlSource = "kapali" | "ortam" | "gecersiz";

/** Boş / `kapali` → null · yalnız köken (şema + host[:port]); dış çıkış kuralı (HTTPS, düz HTTP yalnız döngü). */
export function resolveCloudUrl(raw: string | undefined): { url: string | null; source: CloudUrlSource } {
  const v = raw?.trim();
  if (!v || v.toLowerCase() === "kapali") return { url: null, source: "kapali" };
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

let current = resolveCloudUrl(process.env.PATRON_BULUT_URL);

export function getCloudUrl(): { url: string | null; source: CloudUrlSource } {
  return current;
}

/** Test-only: sahte bulut adresi. */
export function setCloudUrlForTests(raw: string | undefined): void {
  current = resolveCloudUrl(raw);
}
