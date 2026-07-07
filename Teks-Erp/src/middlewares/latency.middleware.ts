// =============================================================================
// Latency Middleware — her isteğin süresini route bazında toplar
// =============================================================================
// app.ts'te morgan'dan hemen sonra mount edilir → statik/health/swagger dahil
// tüm istekler ölçülür. Anahtar HAM URL DEĞİL route pattern'idir
// (`GET /api/rolls/:id`) — UUID/parametre anahtara sızmaz (kardinalite guard'ı
// latency-stats.service'te ayrıca tavanlıdır).

import { Request, Response, NextFunction } from "express";
import {
  recordLatency,
  UNMATCHED_ROUTE_KEY,
  STATIC_ROUTE_KEY,
} from "../services/latency-stats.service";

/** Router mount öneki. Normal (başarılı) cevapta req.baseUrl doludur; ama
 *  handler next(error) ile hata zincirine çıktıysa Express router'dan çıkarken
 *  baseUrl'i GERİ SARAR — finish anında '' görürüz ve anahtar 'GET /perf' gibi
 *  öneksiz kalırdı (aynı ucun istatistiği ikiye bölünür). Bu durumda önek,
 *  originalUrl'den route path'inin segment sayısı düşülerek yeniden kurulur
 *  (route pattern'i korunur, gerçek ID'ler yine sızmaz). */
function mountPrefix(req: Request, routePath: string): string {
  if (req.baseUrl) return req.baseUrl;
  const originalPath = (req.originalUrl ?? "").split("?")[0];
  const routeSegs = routePath.split("/").filter(Boolean);
  const origSegs = originalPath.split("/").filter(Boolean);
  if (routeSegs.length === 0 || origSegs.length < routeSegs.length) return "";
  const prefixSegs = origSegs.slice(0, origSegs.length - routeSegs.length);
  // App-level route (ör. /health): önek segmenti yok → boş önek ('//health' değil).
  return prefixSegs.length ? "/" + prefixSegs.join("/") : "";
}

/** finish anında route anahtarını çöz. req.route yalnız bir route handler'ı
 *  eşleştiyse dolu olur. Route'suz istek: 404 → (eşleşmeyen), diğerleri (statik
 *  dosya, swagger iç varlıkları) → (statik/diğer). */
function resolveRouteKey(req: Request, statusCode: number): string {
  const route = (req as Request & { route?: { path?: string } }).route;
  if (route?.path != null) {
    const routePath = String(route.path);
    const suffix = routePath === "/" ? "" : routePath;
    const key = `${mountPrefix(req, routePath)}${suffix}`;
    return key === "" ? "/" : key;
  }
  return statusCode === 404 ? UNMATCHED_ROUTE_KEY : STATIC_ROUTE_KEY;
}

export function latencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startNs = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - startNs) / 1e6;
    recordLatency(req.method, resolveRouteKey(req, res.statusCode), res.statusCode, ms);
  });
  next();
}
