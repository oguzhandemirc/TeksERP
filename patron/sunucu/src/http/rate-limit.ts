// Sabit pencereli hız sınırı (bellek içi, paket yok). Anahtar istemci adresidir: vekil başlığı herkesçe
// yazılabilir, o yüzden YALNIZ bağlantı güvenilen kenar vekilinden (Cloudflare) geldiyse okunur; araya iç
// vekil (Traefik) giriyorsa güven kararı onun X-Forwarded-For'a eklediği SON halkaya göre verilir.
// Satıcıdaki `satici/sunucu/src/http/client-address.ts` ile aynı kural (lisans.md genel dinleyici satırı).
import { BlockList, isIP, isIPv4, isIPv6 } from "node:net";
import type { NextFunction, Request, Response } from "express";
import type { CloudConfig } from "../config";

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
  readonly edge: BlockList;
  readonly inner: BlockList | null;
}

type TrustConfig = Pick<CloudConfig, "VEKIL_IP_BASLIGI" | "GUVENILIR_VEKIL_AGLARI" | "IC_VEKIL_AGLARI">;

function stripMapped(address: string | undefined): string {
  if (!address) return "";
  return address.startsWith("::ffff:") && isIPv4(address.slice(7)) ? address.slice(7) : address;
}

function blockListOf(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [net, bits] = cidr.split("/");
    list.addSubnet(net!, Number(bits), isIPv6(net!) ? "ipv6" : "ipv4");
  }
  return list;
}

function inList(list: BlockList, address: string): boolean {
  if (isIPv4(address)) return list.check(address, "ipv4");
  if (isIPv6(address)) return list.check(address, "ipv6");
  return false;
}

const trustCache = new WeakMap<TrustConfig, ProxyTrust>();

/** Yapılandırma başına bir kez kurulur (istek başına BlockList inşa edilmez). */
export function proxyTrustOf(config: TrustConfig): ProxyTrust {
  let t = trustCache.get(config);
  if (!t) {
    t = {
      header: config.VEKIL_IP_BASLIGI?.toLowerCase(),
      edge: blockListOf(config.GUVENILIR_VEKIL_AGLARI ?? CLOUDFLARE_NETWORKS),
      inner: config.IC_VEKIL_AGLARI.length > 0 ? blockListOf(config.IC_VEKIL_AGLARI) : null,
    };
    trustCache.set(config, t);
  }
  return t;
}

function headerValue(req: Pick<Request, "headers">, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v.join(",") : v;
}

/** Güven zinciri tutarsa başlıktaki adres, yoksa bağlantının (ya da iç vekilin gördüğü) adresi. */
export function clientAddress(req: Pick<Request, "headers" | "socket">, config: TrustConfig): string {
  const trust = proxyTrustOf(config);
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

export function rateLimit(g: { perMinute: number; config: TrustConfig }) {
  const windows = new Map<string, { start: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (windows.size > 10_000) for (const [k, w] of windows) if (now - w.start >= 60_000) windows.delete(k);
    const key = clientAddress(req, g.config);
    const w = windows.get(key);
    if (!w || now - w.start >= 60_000) {
      windows.set(key, { start: now, count: 1 });
      next();
      return;
    }
    w.count++;
    if (w.count > g.perMinute) {
      res.set("Retry-After", String(Math.ceil((w.start + 60_000 - now) / 1000)));
      res.status(429).json({ success: false, message: "Çok fazla istek; biraz sonra deneyin", details: { code: "HIZ_SINIRI" } });
      return;
    }
    next();
  };
}
