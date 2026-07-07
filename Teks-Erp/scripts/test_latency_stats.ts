// =============================================================================
// test_latency_stats — latency-stats.service birim testleri (DB YOK)
// =============================================================================
// Koşum: npx tsx scripts/test_latency_stats.ts

import {
  recordLatency,
  latencySnapshot,
  resetLatencyStats,
  SLOW_REQUEST_MS,
  UNMATCHED_ROUTE_KEY,
} from "../src/services/latency-stats.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}`);
  }
}

function routeOf(snapshotRoute: string) {
  return latencySnapshot().routes.find((r) => r.route === snapshotRoute);
}

try {
  // --- Temel sayım + persentil (bucket üst sınırı yaklaşımı) ------------------
  resetLatencyStats();
  // 90 hızlı (≤10ms) + 10 yavaş (~400ms) → p50 ≤10ms bucket'ı (10), p95 500 bucket'ı.
  for (let i = 0; i < 90; i++) recordLatency("GET", "/api/items", 200, 8);
  for (let i = 0; i < 10; i++) recordLatency("GET", "/api/items", 200, 400);
  const items = routeOf("GET /api/items");
  check("count doğru (100)", items?.count === 100);
  check("p50 hızlı bucket'ta (10ms tavan)", items?.p50Ms === 10);
  // p95 yavaş dilime düşer: bucket tavanı 500 ama gözlenen max 400 → 400 raporlanır
  check("p95 gözlenen max'ı aşmaz (400)", items?.p95Ms === 400);
  check("max ham değer (400)", items?.maxMs === 400);
  check("errCount 0 (hepsi 200)", items?.errCount === 0);

  // Persentil ≤ max değişmezi: tek yavaş örnekli uçta p50 max'ı aşamaz.
  recordLatency("GET", "/api/tek", 200, 85);
  const tek = routeOf("GET /api/tek");
  check("p50 ≤ gözlenen max (85)", tek?.p50Ms === 85 && tek?.maxMs === 85);

  // --- 5xx sayacı --------------------------------------------------------------
  recordLatency("POST", "/api/orders", 500, 20);
  recordLatency("POST", "/api/orders", 502, 30);
  recordLatency("POST", "/api/orders", 404, 5); // 4xx err sayılmaz
  const orders = routeOf("POST /api/orders");
  check("≥500 errCount'a sayılır (2)", orders?.errCount === 2);
  check("4xx errCount'a sayılmaz", orders?.count === 3 && orders?.errCount === 2);

  // --- (eşleşmeyen) anahtarı (middleware 404'leri buraya koyar) ------------------
  // NOT: kardinalite tavanı DOLMADAN test edilir — tavan sonrası her yeni anahtar
  // gibi bu da '(diğer)' kovasına düşer (guard'ın doğru davranışı).
  recordLatency("GET", UNMATCHED_ROUTE_KEY, 404, 3);
  check(
    "(eşleşmeyen) kovası kaydediliyor",
    latencySnapshot().routes.some((r) => r.route === `GET ${UNMATCHED_ROUTE_KEY}`)
  );

  // --- +∞ bucket'ı → maxMs raporu ----------------------------------------------
  resetLatencyStats();
  for (let i = 0; i < 10; i++) recordLatency("GET", "/api/rapor", 200, 90_000);
  const rapor = routeOf("GET /api/rapor");
  check("60sn üstü istekte p95 = gözlenen max", rapor?.p95Ms === 90_000);

  // --- Yavaş-istek defteri: eşik + ring tavanı (50) ------------------------------
  resetLatencyStats();
  recordLatency("GET", "/api/hizli", 200, SLOW_REQUEST_MS - 1);
  check("eşik altı yavaş deftere GİRMEZ", latencySnapshot().slowRequests.length === 0);
  for (let i = 0; i < 60; i++) recordLatency("GET", `/api/yavas/:id`, 200, SLOW_REQUEST_MS + i);
  const slow = latencySnapshot().slowRequests;
  check("ring 50 ile sınırlı", slow.length === 50);
  check("en yenisi başta", slow[0].ms === SLOW_REQUEST_MS + 59);
  // 60 kayıt girdi, ilk 10 (ms: +0..+9) düşmüş olmalı — en eskisi düşer.
  check(
    "tavan aşımında EN ESKİLER düşer",
    !slow.some((s) => s.ms < SLOW_REQUEST_MS + 10)
  );

  // --- Kardinalite guard'ı: tavan üstü yeni route'lar '(diğer)' kovasında --------
  resetLatencyStats();
  for (let i = 0; i < 520; i++) recordLatency("GET", `/api/unique-${i}`, 200, 5);
  const snap = latencySnapshot();
  check("anahtar sayısı tavanı aşmıyor (≤501)", snap.routes.length <= 501);
  const overflow = snap.routes.find((r) => r.route === "(diğer)");
  check("taşan route'lar '(diğer)' kovasında", (overflow?.count ?? 0) >= 20);
  check("toplam istek kaybolmadı (520)", snap.totalCount === 520);

  // --- Reset --------------------------------------------------------------------
  const beforeResetAt = latencySnapshot().sinceAt;
  resetLatencyStats();
  const after = latencySnapshot();
  check("reset: route yok", after.routes.length === 0);
  check("reset: yavaş defter boş", after.slowRequests.length === 0);
  check("reset: totalCount 0", after.totalCount === 0);
  check("reset: sinceAt ilerledi (pencere başlangıcı yenilendi)", after.sinceAt >= beforeResetAt);

  // --- Sıralama: p95 büyük olan üstte -------------------------------------------
  recordLatency("GET", "/api/a", 200, 5);
  recordLatency("GET", "/api/b", 200, 2_000);
  const sorted = latencySnapshot().routes;
  check("p95 desc sıralı (yavaş üstte)", sorted[0].route === "GET /api/b");
} finally {
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}
