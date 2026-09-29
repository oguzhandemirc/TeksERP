// İSTEMCİ ADRESİ — hız sınırının anahtarı. Vekil başlığı (cf-connecting-ip) herkesçe yazılabilir: yalnız
// bağlantı GÜVENİLEN kenar vekilinden (Cloudflare aralıkları) geldiyse okunur. Araya iç vekil (Traefik)
// giriyorsa soket onun adresidir; o zaman güven kararı iç vekilin X-Forwarded-For'a eklediği SON halkaya
// (iç vekilin gördüğü adres) göre verilir. Hiçbiri tutmazsa soketin adresi.
import { BlockList, isIP, isIPv4, isIPv6 } from "node:net";
import type { Request } from "express";
import type { VendorConfig } from "../config";

/** Cloudflare'in yayımladığı kenar aralıkları (cloudflare.com/ips); değişirse GUVENILIR_VEKIL_AGLARI ile ezilir. */
export const CLOUDFLARE_NETWORKS: readonly string[] = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

export interface ProxyTrust {
  /** İstemci adresini taşıyan başlık (küçük harf); yoksa başlık hiç okunmaz. */
  readonly header: string | undefined;
  /** Başlığa güvenilen kenar vekilleri. */
  readonly edge: BlockList;
  /** Kenar ile satıcı arasındaki iç vekiller (boşsa null). */
  readonly inner: BlockList | null;
}

/** `::ffff:1.2.3.4` → `1.2.3.4` (IPv4 eşlemeli IPv6 soket adresi). */
export function stripMapped(address: string | undefined): string {
  if (!address) return "";
  return address.startsWith("::ffff:") && isIPv4(address.slice(7)) ? address.slice(7) : address;
}

export function blockListOf(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [net, bits] = cidr.split("/");
    list.addSubnet(net!, Number(bits), isIPv6(net!) ? "ipv6" : "ipv4");
  }
  return list;
}

export function inList(list: BlockList, address: string): boolean {
  if (isIPv4(address)) return list.check(address, "ipv4");
  if (isIPv6(address)) return list.check(address, "ipv6");
  return false;
}

export function proxyTrustFrom(config: Pick<VendorConfig, "VEKIL_IP_BASLIGI" | "GUVENILIR_VEKIL_AGLARI" | "IC_VEKIL_AGLARI">): ProxyTrust {
  return {
    header: config.VEKIL_IP_BASLIGI?.toLowerCase(),
    edge: blockListOf(config.GUVENILIR_VEKIL_AGLARI ?? CLOUDFLARE_NETWORKS),
    inner: config.IC_VEKIL_AGLARI.length > 0 ? blockListOf(config.IC_VEKIL_AGLARI) : null,
  };
}

function headerValue(req: Pick<Request, "headers">, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v.join(",") : v;
}

/** Hız sınırı anahtarı: güven zinciri tutarsa başlıktaki adres, yoksa bağlantının (ya da iç vekilin gördüğü) adresi. */
export function clientAddress(req: Pick<Request, "headers" | "socket">, trust: ProxyTrust): string {
  let peer = stripMapped(req.socket.remoteAddress);
  if (trust.inner && inList(trust.inner, peer)) {
    const hops = (headerValue(req, "x-forwarded-for") ?? "").split(",").map((h) => stripMapped(h.trim()));
    const last = hops[hops.length - 1];
    if (last && isIP(last)) peer = last;
  }
  if (trust.header && inList(trust.edge, peer)) {
    const claimed = stripMapped((headerValue(req, trust.header) ?? "").split(",")[0]?.trim());
    if (claimed && isIP(claimed)) return claimed;
  }
  return peer || "?";
}
