// =============================================================================
// İstek başlığı middleware'i (izlenebilirlik B1) — `X-Request-Id` + `request_traces` anlık görüntüsü
// =============================================================================
// `runWithRequestContext`in hemen ARKASINA bağlanır: kimlik ALS'tan gelir, audit'in `requestId`siyle
// aynıdır. `finish`te SENKRON anlık görüntü alınır ve kuyruğa bırakılır — istek yolunda await/DB yok.
// GÖVDE/sorgu/başlık değeri saklanmaz; `res.json` sarmalı gövdeden YALNIZ `details.code`u okur.
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

function readErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const details = (body as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" && code !== "" ? code.slice(0, 60) : null;
}

export function requestTraceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const tc = currentTraceContext();
  if (!tc) return next();
  res.setHeader("X-Request-Id", tc.requestId);
  const startedAt = new Date();
  const startNs = process.hrtime.bigint();
  let errorCode: string | null = null;
  const origJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (res.statusCode >= 400) errorCode = readErrorCode(body);
    return origJson(body);
  }) as Response["json"];

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
        errorCode,
        audit: tc.audit,
        createdAt: startedAt,
      });
    } catch {
      /* telemetri isteği asla etkilemez */
    }
  });
  next();
}
