// =============================================================================
// Latency Middleware — her isteğin süresini route bazında toplar
// =============================================================================
// app.ts'te morgan'dan hemen sonra mount edilir → statik/health/swagger dahil
// tüm istekler ölçülür. Anahtar route pattern'i HEDEFLER ama Express'te
// req.baseUrl pattern DEĞİL eşleşen GERÇEK string'dir (parametreli iç
// mount'larda — ör. customer.routes `/:customerId/branches` — UUID içerir);
// bu yüzden anahtar her durumda SEGMENT NORMALİZASYONUNDAN geçer: UUID/sayı
// görünümlü segmentler ':id'ye çevrilir. Böylece ID'ler anahtara sızmaz ve
// 500'lük anahtar tavanı (latency-stats.service) ID çöpüyle dolmaz.

import { Request, Response, NextFunction } from "express";
import {
  recordLatency,
  UNMATCHED_ROUTE_KEY,
  STATIC_ROUTE_KEY,
} from "../services/latency-stats.service";
import { noteLatencyDelta } from "../services/latency-persist.service";

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
/** Barkod/token benzeri uzun opak segmentler için savunma eşiği. */
const LONG_OPAQUE_SEGMENT = 24;
/** Route sözlüğü görünümü: küçük-harf kelime(+tire). Uzunluktan bağımsız MUAF —
 *  denetimde 'subcontractor-categories' (tam 24 kr) yanlış pozitif çıkmıştı;
 *  opak değerler (barkod TEKS-..., hex, UUID) rakam/büyük harf içerir, bu
 *  desene uymaz. ':param' adları da iki noktayla ayrışır, zaten dokunulmaz. */
const WORDLIKE_SEGMENT = /^[a-z][a-z-]*$/;

/** Somut değer taşıyan segmentleri pattern'e indirger — ':param' adları ve
 *  normal path kelimeleri (items, subcontractor-categories...) olduğu gibi kalır. */
function normalizeKeyPath(path: string): string {
  return path
    .split("/")
    .map((seg) =>
      UUID_SEGMENT.test(seg) ||
      NUMERIC_SEGMENT.test(seg) ||
      (seg.length >= LONG_OPAQUE_SEGMENT && !WORDLIKE_SEGMENT.test(seg))
        ? ":id"
        : seg,
    )
    .join("/");
}

/** Router mount öneki. Normal (başarılı) cevapta req.baseUrl doludur; ama
 *  handler next(error) ile hata zincirine çıktıysa Express router'dan çıkarken
 *  baseUrl'i GERİ SARAR — finish anında '' görürüz ve anahtar 'GET /perf' gibi
 *  öneksiz kalırdı (aynı ucun istatistiği ikiye bölünür). Bu durumda önek,
 *  originalUrl'den route path'inin segment sayısı düşülerek yeniden kurulur.
 *  Kök route'ta ('/') tüm originalUrl öneğe girer — 'GET /' çöküşü olmaz.
 *  Her iki kaynak da somut değer içerebilir → nihai anahtar normalize edilir. */
function mountPrefix(req: Request, routePath: string): string {
  if (req.baseUrl) return req.baseUrl;
  const originalPath = (req.originalUrl ?? "").split("?")[0].replace(/\/+$/, "");
  const routeSegs = routePath.split("/").filter(Boolean);
  const origSegs = originalPath.split("/").filter(Boolean);
  if (origSegs.length < routeSegs.length) return "";
  const prefixSegs = origSegs.slice(0, origSegs.length - routeSegs.length);
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
    const key = normalizeKeyPath(`${mountPrefix(req, routePath)}${suffix}`);
    return key === "" ? "/" : key;
  }
  // Route'a hiç ulaşmadan abort edilen istek (499) de "eşleşmemiş" sayılır —
  // statik dosya kovasına düşmesi yanıltıcı olurdu.
  return statusCode === 404 || statusCode === CLIENT_ABORTED_STATUS
    ? UNMATCHED_ROUTE_KEY
    : STATIC_ROUTE_KEY;
}

/** İstemci isteği yarıda kesti (timeout/pencere kapatma) — cevap tamamlanmadı.
 *  nginx konvansiyonundaki 499 ile işaretlenir: EN YAVAŞ istekler çoğu zaman
 *  tam bunlardır; ölçüm dışı kalsalar yavaş-istek defteri sistematik kör olurdu. */
export const CLIENT_ABORTED_STATUS = 499;

export function latencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startNs = process.hrtime.bigint();
  let recorded = false;
  const record = (status: number): void => {
    if (recorded) return;
    recorded = true;
    const ms = Number(process.hrtime.bigint() - startNs) / 1e6;
    const routeKey = resolveRouteKey(req, status);
    recordLatency(req.method, routeKey, status, ms); // RAM (canlı snapshot)
    noteLatencyDelta(req.method, routeKey, status, ms); // günlük özet delta'sı (Faz 3)
  };
  // finish = cevap tamamlandı; close = soket kapandı (abort'ta finish gelmez —
  // Node her iki durumda da 'close' yayar, recorded guard'ı çifte kaydı önler).
  res.on("finish", () => record(res.statusCode));
  res.on("close", () => record(CLIENT_ABORTED_STATUS));
  next();
}
