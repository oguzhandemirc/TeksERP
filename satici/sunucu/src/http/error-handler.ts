// Hata gövdesi backend ile aynı: {success:false, message:<TR>, details:{code}}. 503 kullanılmaz.
// Günlüğe istek gövdesi/başlığı yazılmaz (imzalı istek, sağlık özeti, parmak izi).
import type { NextFunction, Request, Response } from "express";
import { VendorError, retryConflict, type VendorCode } from "../lib/errors";
import { isRetryableConflict, isUniqueViolation } from "../lib/prisma-errors";
import { maskTokenPath } from "../distribution/tokens";

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ success: false, message: "Bulunamadı", details: { code: "BULUNAMADI" satisfies VendorCode } });
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof VendorError) {
    res.status(err.status).json({ success: false, message: err.message, details: { ...(err.extra ?? {}), code: err.code } });
    return;
  }
  const e = err as { type?: string; status?: number; message?: string; name?: string };
  if (e.type === "entity.too.large" || e.type === "entity.parse.failed" || e.status === 400 || e.status === 413) {
    res.status(400).json({ success: false, message: "İstek gövdesi okunamadı", details: { code: "GOVDE_GECERSIZ" } });
    return;
  }
  // Yarışı kaybeden tekillik ihlali (P2002) de "tekrar deneyin"dir: yeniden deneme ön okumada doğru cevabı bulur (500 değil).
  if (isRetryableConflict(err) || isUniqueViolation(err)) {
    const e409 = retryConflict(isUniqueViolation(err) ? "Kayıt aynı anda başka bir işlemle çakıştı; lütfen tekrar deneyin" : undefined);
    res.status(e409.status).json({ success: false, message: e409.message, details: { code: e409.code } });
    return;
  }
  console.error(`[satici] ${req.method} ${req.path} beklenmeyen hata: ${e.name ?? "Error"}: ${e.message ?? String(err)}`);
  res.status(500).json({ success: false, message: "Sunucu hatası", details: { code: "SUNUCU_HATASI" } });
}

/** Erişim günlüğü: yöntem + YOL (sorgu dizgisi ve #parça ASLA; /d · /y belirteci maskeli) + durum + süre. */
export function accessLog(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on("finish", () => {
    if (process.env.SATICI_ERISIM_GUNLUGU === "0") return;
    const pathOnly = maskTokenPath((req.originalUrl || req.url).split("?")[0] ?? "");
    console.log(`[satici] ${req.method} ${pathOnly} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
}
