// İstemci IPv6 adresini /64 önekine indirme (VDS denetimi K1-2/Y2, 2026-11-01).
// Cloudflare IPv6 ziyaretçiyi /128 taşır; /64 bloğu olan tek makine her istekte yeni "IP" olur ve
// adres başına hız kovası + giriş kilidi atlanır. Ev/VPS ağı en küçük birim olarak /64 alır.
// IPv4 ve IPv4-eşlemli (::ffff:a.b.c.d) adres OLDUĞU GİBİ kalır — /64'e indirmek bütün IPv4'ü birleştirirdi.
import { isIPv6 } from "node:net";

/** Tam yazılmış 8 hextet (küçük harf, baştaki sıfırsız); IPv6 değilse null. */
function expandIPv6(raw: string): string[] | null {
  let addr = raw.trim().toLowerCase();
  if (addr.startsWith("[") && addr.endsWith("]")) addr = addr.slice(1, -1);
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  if (!isIPv6(addr)) return null;
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(addr);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    addr = `${addr.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", rest] = addr.split("::");
  const left = head ? head.split(":") : [];
  const right = rest !== undefined && rest !== "" ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  const parts = [...left, ...fill, ...right];
  if (parts.length !== 8) return null;
  return parts.map((h) => Number.parseInt(h, 16).toString(16));
}

/**
 * Anahtar için istemci adresi: IPv6 → `a:b:c:d::/64`; IPv4, IPv4-eşlemli ve tanınmayan değer aynen.
 */
export function clientIpBucket(ip: string): string {
  const parts = expandIPv6(ip);
  if (!parts) return ip;
  // ::ffff:0:0/96 — IPv4-eşlemli; IPv4 kimliği korunur (girdi aynen döner).
  if (parts.slice(0, 5).every((h) => h === "0") && parts[5] === "ffff") return ip;
  return `${parts.slice(0, 4).join(":")}::/64`;
}
