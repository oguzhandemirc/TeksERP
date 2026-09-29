// Sabit pencereli hız sınırı (bellek içi, paket yok). Anahtar: vekil başlığı (yapılandırıldıysa)
// ya da soket adresi — başlık yalnız vekil arkasında güvenilir, varsayılan soket.
import type { NextFunction, Request, Response } from "express";

export function clientAddress(req: Request, proxyHeader: string | undefined): string {
  if (proxyHeader) {
    const v = req.get(proxyHeader);
    if (v) return v.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "?";
}

export function rateLimit(g: { perMinute: number; proxyHeader: string | undefined }) {
  const windows = new Map<string, { start: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (windows.size > 10_000) for (const [k, w] of windows) if (now - w.start >= 60_000) windows.delete(k);
    const key = clientAddress(req, g.proxyHeader);
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
