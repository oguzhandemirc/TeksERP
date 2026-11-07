// =============================================================================
// İstek kimliği + hata kodu yakalayıcı — erişim logu, yavaş istek halkası ve istek başlığının TEK kaynağı
// =============================================================================
// morgan'dan ÖNCE mount edilir: log satırı, latency halkası ve `X-Request-Id` aynı `req.reqId`yi görür.
// Gelen `x-request-id` yalnız dar biçimde korunur (log zehirlenmesi/başlık enjeksiyonu yok); audit
// gruplama kimliği (`req.serverRequestId`) HER ZAMAN sunucu üretir — istemci başka işlemin audit'ine karışamaz.
// =============================================================================

import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

/** Gelen kimlik bu biçimdeyse korunur: 8–64 karakter, harf/rakam ve `._:-`. */
export const INCOMING_REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,64}$/;

export function sanitizeIncomingRequestId(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && INCOMING_REQUEST_ID_RE.test(v) ? v : null;
}

/** Gövde NESNESİNDEN yalnız `details.code` okunur (yeniden serileştirme yok; `body.code` okunmaz). */
export function readErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const details = (body as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" && code !== "" ? code.slice(0, 60) : null;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const serverId = randomUUID();
  req.serverRequestId = serverId;
  req.reqId = sanitizeIncomingRequestId(req.headers["x-request-id"]) ?? serverId;
  res.setHeader("X-Request-Id", req.reqId);
  const origJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (res.statusCode >= 400) res.locals.errorCode = readErrorCode(body) ?? undefined;
    return origJson(body);
  }) as Response["json"];
  next();
}
