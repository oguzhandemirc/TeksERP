// =============================================================================
// İstek başlığı (`request_traces`) BEYANLI DIŞLAMA listesi — izlenebilirlik B1
// =============================================================================
// Bu uçlar sürekli yoklama/kalp atışıdır: satırları "kim ne yaptı" sorusuna cevap vermez,
// tabloyu gürültüyle doldurur. Eşleşme normalleştirilmiş `routeKey` üzerinden (UUID/sayı `:id`).
// Her satır GERÇEK bir route'a bakar (`file` + `pattern`); bekçi `test_request_trace` ölü yolu yakalar.
// =============================================================================

export interface RequestTraceExclusion {
  /** `*` = her yöntem. */
  method: "GET" | "POST" | "*";
  routeKey: string;
  /** true = `routeKey` ve altındaki her yol. */
  prefix: boolean;
  /** Route'un tanımlandığı dosya (src/ altından) ve dosyada geçen kalıp — ölü yol bekçisi. */
  file: string;
  pattern: string;
  reason: string;
}

export const REQUEST_TRACE_EXCLUSIONS: readonly RequestTraceExclusion[] = [
  {
    method: "*", routeKey: "/health", prefix: true, file: "app.ts", pattern: 'app.get("/health"',
    reason: "canlılık/tepsi yoklaması (dakikada birçok kez); iş eylemi değil",
  },
  {
    method: "POST", routeKey: "/api/devices/announce", prefix: false, file: "routes/device.routes.ts", pattern: 'devicePublicRouter.post("/announce"',
    reason: "eşleşmemiş cihazın periyodik kendini duyurması; red (4xx) de her turda tekrarlanır",
  },
  {
    method: "GET", routeKey: "/api/devices/status", prefix: false, file: "routes/device.routes.ts", pattern: 'devicePublicRouter.get("/status"',
    reason: "onay bekleyen cihazın durum yoklaması; onaysız cihaz her turda 403 alır",
  },
  {
    method: "GET", routeKey: "/api/devices/pairing-required", prefix: false, file: "routes/device.routes.ts", pattern: 'devicePublicRouter.get("/pairing-required"',
    reason: "eşleştirme gerekliliği yoklaması (public); iş eylemi değil",
  },
  {
    method: "POST", routeKey: "/api/machine-signals/heartbeat", prefix: false, file: "routes/machine-signal.routes.ts", pattern: 'router.post("/heartbeat"',
    reason: "makine toplayıcısının kalp atışı; sürekli akar, reddi toplayıcı sağlığı olarak ayrıca izlenir",
  },
];

/** `routeKey` (normalleştirilmiş) ve yöntem dışlama listesinde mi. */
export function isRequestTraceExcluded(method: string, routeKey: string): boolean {
  for (const h of REQUEST_TRACE_EXCLUSIONS) {
    if (h.method !== "*" && h.method !== method) continue;
    if (routeKey === h.routeKey) return true;
    if (h.prefix && routeKey.startsWith(`${h.routeKey}/`)) return true;
  }
  return false;
}
