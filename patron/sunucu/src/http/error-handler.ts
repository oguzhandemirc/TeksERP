// Hata gövdesi backend/satıcı ile aynı: {success:false, message:<TR>, details:{code}}. 503 yalnız tesis DB'si hazır değilken (TEKRAR_DENEYIN).
// Günlüğe istek gövdesi/başlığı yazılmaz (imzalı istek, parola, TOTP, davet/oturum belirteci, iş verisi).
import type { NextFunction, Request, Response } from "express";
import { CloudError, retryConflict, type CloudCode } from "../lib/errors";
import { isRetryableConflict } from "../lib/prisma-errors";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, message: "Bulunamadı", details: { code: "BULUNAMADI" satisfies CloudCode } });
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof CloudError) {
    res.status(err.status).json({ success: false, message: err.message, details: { ...(err.extra ?? {}), code: err.code } });
    return;
  }
  const e = err as { type?: string; status?: number; message?: string; name?: string };
  if (e.type === "entity.too.large" || e.status === 413) {
    res.status(413).json({ success: false, message: "İstek gövdesi çok büyük", details: { code: "PAKET_BUYUK" } });
    return;
  }
  if (e.type === "entity.parse.failed" || e.status === 400) {
    res.status(400).json({ success: false, message: "İstek gövdesi okunamadı", details: { code: "GOVDE_GECERSIZ" } });
    return;
  }
  if (isRetryableConflict(err)) {
    const e409 = retryConflict();
    res.status(e409.status).json({ success: false, message: e409.message, details: { code: e409.code } });
    return;
  }
  console.error(`[patron] ${req.method} ${req.path} beklenmeyen hata: ${e.name ?? "Error"}: ${e.message ?? String(err)}`);
  res.status(500).json({ success: false, message: "Sunucu hatası", details: { code: "SUNUCU_HATASI" } });
}

/** Erişim günlüğü: yöntem + YOL (sorgu dizgisi ASLA — imleç/süzgeç iş verisi taşıyabilir) + durum + süre. */
export function accessLog(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on("finish", () => {
    if (process.env.PATRON_ERISIM_GUNLUGU === "0") return;
    const pathOnly = (req.originalUrl || req.url).split("?")[0];
    console.log(`[patron] ${req.method} ${pathOnly} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
}
