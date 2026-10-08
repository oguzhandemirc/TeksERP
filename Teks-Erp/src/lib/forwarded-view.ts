// Güvenilen ters vekil (nginx/Cloudflare) arkasında istemcinin GÖRDÜĞÜ şema ve port.
// Güven kararı Express'in `trust proxy` ayarından gelir (TRUST_PROXY); ayar yoksa ya da soketin
// karşı ucu güvenilmiyorsa başlıklar yok sayılır ve çağıran bugünkü (doğrudan bağlantı) değerleri kullanır.

import type { Request } from "express";

export interface ForwardedView {
  protocol: "http" | "https";
  port: number;
}

export interface ForwardedHeaders {
  proto?: string | undefined;
  port?: string | undefined;
  host?: string | undefined;
}

/** Virgüllü başlığın ilk değeri — Express'in `req.protocol`u ile aynı seçim. */
function firstValue(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.split(",")[0]?.trim() ?? "";
  return v === "" ? null : v;
}

function parsePort(raw: string | null): number | null {
  if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
}

/** `ad:port` ya da `[v6]:port` → port; köşeli parantezsiz IPv6 ("::1") port taşımaz sayılır. */
function portOfHost(raw: string | null): number | null {
  if (raw === null) return null;
  if (raw.startsWith("[")) return parsePort(/^\[[^\]]+\]:(\d+)$/.exec(raw)?.[1] ?? null);
  const parts = raw.split(":");
  return parts.length === 2 ? parsePort(parts[1] ?? null) : null;
}

/**
 * Güvenilen vekilin başlıklarından görünümü kurar. Şema yalnız http|https; tanınmayan/eksik şema → null
 * (vekil görünümü yok). Port sırası: X-Forwarded-Port → X-Forwarded-Host'taki port → şemanın varsayılanı;
 * geçersiz port değeri (1–65535 dışı, sayı değil) yok sayılır.
 */
export function parseForwardedView(h: ForwardedHeaders): ForwardedView | null {
  const proto = firstValue(h.proto)?.toLowerCase();
  if (proto !== "http" && proto !== "https") return null;
  const port = parsePort(firstValue(h.port)) ?? portOfHost(firstValue(h.host)) ?? (proto === "https" ? 443 : 80);
  return { protocol: proto, port };
}

/** İstek güvenilen vekilden geldiyse istemcinin gördüğü şema/port; aksi halde null. */
export function readForwardedView(req: Request): ForwardedView | null {
  const trust: unknown = req.app.get("trust proxy fn");
  const addr = req.socket?.remoteAddress;
  if (typeof trust !== "function" || !addr || !(trust as (a: string, i: number) => boolean)(addr, 0)) return null;
  return parseForwardedView({
    proto: req.get("x-forwarded-proto"),
    port: req.get("x-forwarded-port"),
    host: req.get("x-forwarded-host"),
  });
}
