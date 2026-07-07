// =============================================================================
// Latency Stats — per-endpoint gecikme istatistiği (saf bellek, DB YOK)
// =============================================================================
// Neden (SAHA-DAYANIKLILIK-FAZ2.md §B1): morgan her isteğin süresini konsola
// yazar ama kimse TOPLAMAZ — "hangi endpoint yavaş?" sorusu üretimde ancak
// böyle bir kalıcı sayaçla anlık cevaplanabilir. Tasarım sınırları:
//   - İstek başına O(1); kilit yok; timer yok (/health "yeni timer yok" ilkesi
//     korunur — her şey istek-güdümlü).
//   - SABİT bellek: route anahtarı tavanı (MAX_ROUTE_KEYS) + logaritmik bucket
//     histogramı + son-50 yavaş istek ring'i. Ham URL asla anahtar olmaz
//     (path param'lar route pattern'i ile `:id` olarak gelir — middleware'e bak).
//   - Persentiller bucket ÜST SINIRINDAN okunur → yaklaşıktır (ör. p95 "≤250ms"
//     hassasiyetinde); endpoint'ler arası KARŞILAŞTIRMA ve trend için yeterli,
//     mikro-benchmark için değil.

/** Bucket üst sınırları (ms) — son eleman +∞ (maxMs ile raporlanır). */
const BUCKET_BOUNDS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000,
  Number.POSITIVE_INFINITY,
];

/** Bu eşik ve üstü istekler yavaş-istek defterine (ring) yazılır. */
export const SLOW_REQUEST_MS = 1_000;
/** Yavaş-istek defteri boyu. */
const SLOW_RING_SIZE = 50;
/** Route anahtarı tavanı — aşımı `(diğer)` kovasına düşer (kardinalite guard'ı). */
const MAX_ROUTE_KEYS = 500;

/** Router'a hiç eşleşmeyen istekler (404 vb.) — ham path anahtara sızmasın. */
export const UNMATCHED_ROUTE_KEY = "(eşleşmeyen)";
/** Route'suz ama başarılı cevaplar (statik dosya, swagger UI iç varlıkları). */
export const STATIC_ROUTE_KEY = "(statik/diğer)";
const OVERFLOW_ROUTE_KEY = "(diğer)";

interface RouteStat {
  count: number;
  /** HTTP ≥500 cevap sayısı. */
  errCount: number;
  maxMs: number;
  lastAt: number;
  /** BUCKET_BOUNDS_MS ile hizalı sayaçlar. */
  buckets: number[];
}

export interface SlowRequestEntry {
  at: number;
  method: string;
  route: string;
  status: number;
  ms: number;
}

export interface RouteSnapshot {
  route: string;
  count: number;
  errCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  lastAt: number;
}

const stats = new Map<string, RouteStat>();
const slowRing: SlowRequestEntry[] = [];
let statsSince = Date.now();
let totalCount = 0;

function bucketIndex(ms: number): number {
  for (let i = 0; i < BUCKET_BOUNDS_MS.length; i++) {
    if (ms <= BUCKET_BOUNDS_MS[i]) return i;
  }
  return BUCKET_BOUNDS_MS.length - 1;
}

/** Kümülatif bucket sayımından persentil — bucket üst sınırını döner ama
 *  gözlenen max'ı ASLA aşmaz (aksi hâlde "p50=100, max=85" gibi çelişkili
 *  görünürdü); +∞ bucket'ına düşerse gözlenen maxMs raporlanır. */
function percentileMs(stat: RouteStat, p: number): number {
  const target = Math.ceil(stat.count * p);
  const observedMax = Math.round(stat.maxMs);
  let cumulative = 0;
  for (let i = 0; i < stat.buckets.length; i++) {
    cumulative += stat.buckets[i];
    if (cumulative >= target) {
      const bound = BUCKET_BOUNDS_MS[i];
      return Number.isFinite(bound) ? Math.min(bound, observedMax) : observedMax;
    }
  }
  return observedMax;
}

/** Middleware'in tek giriş noktası — istek başına O(1). */
export function recordLatency(method: string, routeKey: string, status: number, ms: number): void {
  const key = `${method} ${routeKey}`;
  let stat = stats.get(key);
  if (!stat) {
    if (stats.size >= MAX_ROUTE_KEYS) {
      // Tavan doldu — yeni route'lar tek kovada birikir, bellek sabit kalır.
      stat = stats.get(OVERFLOW_ROUTE_KEY);
      if (!stat) {
        stat = { count: 0, errCount: 0, maxMs: 0, lastAt: 0, buckets: BUCKET_BOUNDS_MS.map(() => 0) };
        stats.set(OVERFLOW_ROUTE_KEY, stat);
      }
    } else {
      stat = { count: 0, errCount: 0, maxMs: 0, lastAt: 0, buckets: BUCKET_BOUNDS_MS.map(() => 0) };
      stats.set(key, stat);
    }
  }
  stat.count += 1;
  totalCount += 1;
  if (status >= 500) stat.errCount += 1;
  if (ms > stat.maxMs) stat.maxMs = ms;
  stat.lastAt = Date.now();
  stat.buckets[bucketIndex(ms)] += 1;

  if (ms >= SLOW_REQUEST_MS) {
    slowRing.push({ at: Date.now(), method, route: routeKey, status, ms: Math.round(ms) });
    if (slowRing.length > SLOW_RING_SIZE) slowRing.splice(0, slowRing.length - SLOW_RING_SIZE);
  }
}

/** Admin ucu okuma görünümü — p95'e göre sıralı (en şüpheli en üstte). */
export function latencySnapshot(): {
  sinceAt: number;
  totalCount: number;
  routes: RouteSnapshot[];
  slowRequests: SlowRequestEntry[];
} {
  const routes: RouteSnapshot[] = [];
  for (const [route, stat] of stats) {
    routes.push({
      route,
      count: stat.count,
      errCount: stat.errCount,
      p50Ms: percentileMs(stat, 0.5),
      p95Ms: percentileMs(stat, 0.95),
      maxMs: Math.round(stat.maxMs),
      lastAt: stat.lastAt,
    });
  }
  routes.sort((a, b) => b.p95Ms - a.p95Ms || b.count - a.count);
  return {
    sinceAt: statsSince,
    totalCount,
    routes,
    slowRequests: [...slowRing].reverse(), // en yenisi başta
  };
}

/** Sayaçları sıfırla (admin POST /perf/reset — audit'i route katmanı yazar). */
export function resetLatencyStats(): void {
  stats.clear();
  slowRing.length = 0;
  totalCount = 0;
  statsSince = Date.now();
}
