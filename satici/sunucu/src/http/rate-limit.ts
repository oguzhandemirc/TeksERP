// Sabit pencereli hız sınırı (bellek içi, paket yok). Anahtar istemci adresidir (client-address.ts:
// vekil başlığı yalnız güvenilen vekilden gelen bağlantıda okunur) ya da kurulum/anahtar kapsamı.
import type { NextFunction, Request, Response } from "express";
import { VendorError } from "../lib/errors";
import { clientAddress, type ProxyTrust } from "./client-address";

const WINDOW_MS = 60_000;
const MAX_KEYS = 10_000;

export class FixedWindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly perMinute: number) {}

  /** Sayar; sınır aşıldıysa kalan saniyeyi (Retry-After), aşılmadıysa null döner. */
  hit(key: string, nowMs: number = Date.now()): number | null {
    if (this.windows.size > MAX_KEYS) for (const [k, w] of this.windows) if (nowMs - w.start >= WINDOW_MS) this.windows.delete(k);
    const w = this.windows.get(key);
    if (!w || nowMs - w.start >= WINDOW_MS) {
      this.windows.set(key, { start: nowMs, count: 1 });
      return null;
    }
    w.count++;
    return w.count > this.perMinute ? Math.max(1, Math.ceil((w.start + WINDOW_MS - nowMs) / 1000)) : null;
  }
}

export const rateLimited = (retryAfterSec: number): VendorError =>
  new VendorError(429, "HIZ_SINIRI", "Çok fazla istek; biraz sonra deneyin", { tekrarSn: retryAfterSec });

/** İstemci adresi başına dakikalık sınır; aşımda 429 HIZ_SINIRI + Retry-After. */
export function rateLimit(g: { perMinute: number; trust: ProxyTrust }) {
  const limiter = new FixedWindowLimiter(g.perMinute);
  return (req: Request, res: Response, next: NextFunction): void => {
    const retry = limiter.hit(clientAddress(req, g.trust));
    if (retry === null) {
      next();
      return;
    }
    res.set("Retry-After", String(retry));
    res.status(429).json({ success: false, message: "Çok fazla istek; biraz sonra deneyin", details: { code: "HIZ_SINIRI" } });
  };
}
