// =============================================================================
// Günlüğe giden URL'de sır taşıyan sorgu parametrelerinin DEĞERİ maskelenir
// =============================================================================
// Erişim günlüğü (morgan) dosyaya düşer ve yedeklenir; etkinleştirme kodu, tek kullanımlık
// kurulum token'ı gibi değerler orada kalıcı olur. Parametre ADI kalır (istek tanınsın),
// değer `***` olur. Ad büyük/küçük harf ve yüzde kodlamasından bağımsız, `kod[]` gibi dizi
// biçimi de aynı ada sayılır. Bekçi: `scripts/test_lisans_kapisi.ts` (§13).
// =============================================================================

/** Değeri günlüğe yazılmayan sorgu parametreleri (küçük harf). */
export const SECRET_QUERY_PARAMS: ReadonlySet<string> = new Set([
  "kod",
  "token",
  "belirtec",
  "sifre",
  "parola",
  "password",
  "pin",
  "totp",
  "secret",
  "sir",
]);

export const REDACTED_VALUE = "***";

function paramName(raw: string): string {
  let name = raw.replace(/\+/g, " ");
  try {
    name = decodeURIComponent(name);
  } catch {
    // Bozuk yüzde kodlaması: ham adla karşılaştırılır.
  }
  return name.trim().toLowerCase().replace(/\[[^\]]*\]$/, "");
}

/** `/yol?kod=X&amac=y` → `/yol?kod=***&amac=y`; sorgusuz URL aynen döner. */
export function redactSecretQueryParams(url: string): string {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const hash = url.indexOf("#", q);
  const query = hash === -1 ? url.slice(q + 1) : url.slice(q + 1, hash);
  const tail = hash === -1 ? "" : url.slice(hash);
  const parts = query.split("&").map((part) => {
    const eq = part.indexOf("=");
    if (eq === -1) return part;
    const raw = part.slice(0, eq);
    return SECRET_QUERY_PARAMS.has(paramName(raw)) ? `${raw}=${REDACTED_VALUE}` : part;
  });
  return `${url.slice(0, q)}?${parts.join("&")}${tail}`;
}
