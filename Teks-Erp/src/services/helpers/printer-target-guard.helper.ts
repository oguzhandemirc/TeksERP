// Etiket "Test Et" ucunun hedef süzgeci (VDS denetimi D3): sunucu, istemcinin verdiği adrese TCP
// açar — süzgeçsiz uç iç ağ tarayıcısıdır (SSRF). Yazıcı fabrika LAN'ındadır: yalnız özel IPv4
// aralığı (RFC 1918) ve RAW baskı portları; ad (DNS) kabul edilmez, rebinding yolu kalmasın.
import { isIPv4 } from "node:net";

/** RAW (JetDirect) baskı portları; çok portlu baskı sunucuları 9100–9103 kullanır. */
export const PRINTER_TEST_ALLOWED_PORTS: ReadonlySet<number> = new Set([9100, 9101, 9102, 9103]);

function isPrivateLanIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 192 && b === 168;
}

/** Ret gerekçesi (Türkçe) ya da null. Döngü, link-local (169.254/metadata), dış IP ve ad reddedilir. */
export function printerTestTargetRefusal(host: string, port: number | undefined): string | null {
  const h = host.trim();
  if (!isIPv4(h)) return "Yazıcı adresi fabrika ağındaki bir IPv4 adresi olmalı (ör. 192.168.1.50)";
  if (!isPrivateLanIpv4(h)) {
    return "Yazıcı adresi fabrika iç ağında olmalı (10.x, 172.16–31.x, 192.168.x) — döngü, link-local ve dış adres kabul edilmez";
  }
  if (port !== undefined && !PRINTER_TEST_ALLOWED_PORTS.has(port)) {
    return `Yazıcı portu ${[...PRINTER_TEST_ALLOWED_PORTS].join(", ")} olmalı`;
  }
  return null;
}
