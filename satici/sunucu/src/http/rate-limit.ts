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

/**
 * Anahtar başına pencerede TEK kullanım (ör. kullanıcı başına 5 dk'da bir deneme bildirimi). `take` yer ayırır; iş düşerse
 * `refund` ayrılan yeri geri verir (başarısız deneme kullanıcıyı pencere boyunca kilitlemesin). Bellek içi, süreç başına.
 */
export class CooldownLimiter {
  private readonly last = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  take(key: string, nowMs: number = Date.now()): { readonly ok: true; readonly refund: () => void } | { readonly ok: false; readonly retryAfterSec: number } {
    if (this.last.size > MAX_KEYS) for (const [k, t] of this.last) if (nowMs - t >= this.windowMs) this.last.delete(k);
    const prev = this.last.get(key);
    if (prev !== undefined && nowMs - prev < this.windowMs) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((prev + this.windowMs - nowMs) / 1000)) };
    this.last.set(key, nowMs);
    return {
      ok: true,
      refund: () => {
        if (this.last.get(key) !== nowMs) return;
        if (prev === undefined) this.last.delete(key);
        else this.last.set(key, prev);
      },
    };
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
