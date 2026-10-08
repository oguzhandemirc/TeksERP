// İnternet kipi (docs/design/TABLET-GENEL-CA-BAGLANTI.md §2): izinli üst alanın altındaki ad sabitsiz, Chromium'un
// SİSTEM güveni + ad eşleşmesiyle doğrulanır (panel sertifika kancası sabit dışını Chromium'a bırakır, `-3`).
// Kip adresin biçiminden türer. İKİZ: `mobil/src/lib/internet-tls.ts` (kipFor + üst alan listesi metin olarak aynı).

/** İnternet kipine giren üst alanlar — panelde TEK KAYNAK (kullanıcı kararı KA 2026-10-08). */
export const INTERNET_PARENT_DOMAINS: readonly string[] = ["etkiliyazilim.com"];

export type ServerKip = "sabitli" | "internet";

const LOCAL_SUFFIXES = [".local", ".lan", ".internal", ".home.arpa", ".localhost"];
const LABEL = /^[0-9a-z]([0-9a-z-]{0,61}[0-9a-z])?$/;

function normHost(host: string): string {
  return (host ?? "").trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Adresin kipi. İnternet: yalnız izinli üst alanın ALTINDAKİ geçerli ad (üst alanın kendisi değil). Geri kalan her
 * şey (IPv4/IPv6, tek etiket, yerel son ek, izinli üst alan dışı ad, bozuk ad) sabitlidir.
 */
export function kipFor(host: string, parents: readonly string[] = INTERNET_PARENT_DOMAINS): ServerKip {
  const h = normHost(host);
  if (!h || h.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return "sabitli";
  const labels = h.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return "sabitli";
  if (LOCAL_SUFFIXES.some((s) => h.endsWith(s))) return "sabitli";
  return parents.some((p) => h.endsWith(`.${normHost(p)}`)) ? "internet" : "sabitli";
}

export function isInternetHost(host: string): boolean {
  return kipFor(host) === "internet";
}
