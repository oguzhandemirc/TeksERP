// =============================================================================
// İstek başlığı middleware'i (izlenebilirlik B1) — `X-Request-Id` + `request_traces` anlık görüntüsü
// =============================================================================
// `runWithRequestContext`in hemen ARKASINA bağlanır: kimlik ALS'tan gelir, audit'in `requestId`siyle
// aynıdır. `finish`te SENKRON anlık görüntü alınır ve kuyruğa bırakılır — istek yolunda await/DB yok.
// GÖVDE/sorgu/başlık değeri saklanmaz; hata kodu `res.locals.errorCode`dan (`request-id.middleware`).
// =============================================================================

import type { Request, Response, NextFunction } from "express";
import { currentTraceContext } from "../lib/request-context";
import { readClientLabelHeaders } from "../constants/client-info";
import { isRequestTraceExcluded } from "../constants/request-trace-haric";
import { mountPrefix, normalizeKeyPath } from "./latency.middleware";
import { isTraceCandidate, recordTrace } from "../services/request-trace.service";

/** Uç kalıbı: latency ile AYNI normalleştirme (UUID/sayı/opak segment `:id`). */
export function resolveTraceRouteKey(req: Request): string {
  const route = (req as Request & { route?: { path?: unknown } }).route;
  let raw: string;
  if (route?.path != null) {
    const routePath = String(route.path);
    raw = `${mountPrefix(req, routePath)}${routePath === "/" ? "" : routePath}`;
  } else {
    raw = (req.originalUrl ?? "").split("?")[0].replace(/\/+$/, "");
  }
  const key = normalizeKeyPath(raw);
  return (key === "" ? "/" : key).slice(0, 160);
}

export function requestTraceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const tc = currentTraceContext();
  if (!tc) return next();
  // `X-Request-Id` başlığı ve `details.code` yakalama `requestIdMiddleware`in (morgan'dan önce, tek sahip).
  const startedAt = new Date();
  const startNs = process.hrtime.bigint();

  res.on("finish", () => {
    try {
      const method = req.method;
      const status = res.statusCode;
      if (!isTraceCandidate(method, status)) return;
      const routeKey = resolveTraceRouteKey(req);
      if (isRequestTraceExcluded(method, routeKey)) return;
      const labels = readClientLabelHeaders(req.headers);
      recordTrace({
        id: tc.requestId,
        userId: req.user?.userId ?? null,
        deviceRefId: req.device?.id ?? null,
        panelInstanceId: req.device ? null : labels.instanceId,
        deviceLocalId: req.device?.deviceId ?? labels.instanceId,
        clientType: labels.kind ?? req.device?.kind ?? null,
        appVersion: labels.version,
        ip: req.ip ?? null,
        method,
        routeKey,
        status,
        durationMs: Number(process.hrtime.bigint() - startNs) / 1e6,
        errorCode: res.locals.errorCode ?? null,
        audit: tc.audit,
        createdAt: startedAt,
      });
    } catch {
      /* telemetri isteği asla etkilemez */
    }
  });
  next();
}
