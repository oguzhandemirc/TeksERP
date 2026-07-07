// =============================================================================
// test_latency_persist — günlük özet kalıcılaştırması (GERÇEK DB, TEST- verisi)
// =============================================================================
// Koşum: npx tsx scripts/test_latency_persist.ts
// Sözleşmeler: flush merge-upsert (gün içi toplanır), bucket'lar korunur,
// history persentili birleşik bucket'tan ve max'ı aşmaz, retention 90+ günü
// siler, flush hataları isteği düşürmez (sağlık sayacı).

import prisma from "../src/lib/prisma";
import {
  noteLatencyDelta,
  flushLatencyNow,
  latencyHistory,
  latencyHistoryRoutes,
  getLatencyPersistHealth,
  RETENTION_DAYS,
} from "../src/services/latency-persist.service";

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

const RUN = Date.now();
const ROUTE = `/api/TEST-perf-${RUN}`; // benzersiz TEST- anahtarı
const KEY = `GET ${ROUTE}`;
const OLD_KEY = `GET /api/TEST-perf-old-${RUN}`;

// Servisin gün temsiliyle AYNI: yerel Y/M/D + UTC-midnight (DATE kolonuna
// UTC gün-parçası yazıldığı için — bkz. latency-persist.service localDay).
function localDay(offsetDays = 0): Date {
  const n = new Date();
  const d = new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

async function main(): Promise<void> {
  try {
    // Retention hedefi: 100 gün önceye TEST satırı — İLK flush'ta silinmeli
    // (retention süreçte günde 1 kez, ilk flush'ta koşar).
    await prisma.endpointLatencyDaily.create({
      data: {
        day: localDay(-(RETENTION_DAYS + 10)),
        routeKey: OLD_KEY,
        count: 1,
        errCount: 0,
        maxMs: 5,
        buckets: new Array(16).fill(0),
      },
    });

    // --- 1. flush: 90 hızlı + 10 yavaş + 2 hata --------------------------------
    for (let i = 0; i < 90; i++) noteLatencyDelta("GET", ROUTE, 200, 8);
    for (let i = 0; i < 10; i++) noteLatencyDelta("GET", ROUTE, 200, 400);
    noteLatencyDelta("GET", ROUTE, 500, 30);
    noteLatencyDelta("GET", ROUTE, 503, 30);
    await flushLatencyNow();

    const row1 = await prisma.endpointLatencyDaily.findUnique({
      where: { day_routeKey: { day: localDay(), routeKey: KEY } },
    });
    check("flush satırı oluştu", !!row1);
    check("count doğru (102)", row1?.count === 102);
    check("errCount yalnız ≥500 (2)", row1?.errCount === 2);
    check("maxMs doğru (400)", row1?.maxMs === 400);
    const buckets1 = (row1?.buckets as number[]) ?? [];
    check(
      "bucket toplamı count'a eşit",
      buckets1.reduce((a, b) => a + b, 0) === 102
    );

    // --- Retention: eski satır silindi, bugünkü duruyor -------------------------
    const oldRow = await prisma.endpointLatencyDaily.findUnique({
      where: { day_routeKey: { day: localDay(-(RETENTION_DAYS + 10)), routeKey: OLD_KEY } },
    });
    check(`retention: ${RETENTION_DAYS}+ gün eski satır silindi`, oldRow === null);

    // --- 2. flush: gün içi MERGE (üst üste toplama) ------------------------------
    for (let i = 0; i < 50; i++) noteLatencyDelta("GET", ROUTE, 200, 8);
    noteLatencyDelta("GET", ROUTE, 200, 2_000); // yeni max
    await flushLatencyNow();

    const row2 = await prisma.endpointLatencyDaily.findUnique({
      where: { day_routeKey: { day: localDay(), routeKey: KEY } },
    });
    check("merge: count toplandı (153)", row2?.count === 153);
    check("merge: maxMs yükseldi (2000)", row2?.maxMs === 2000);
    const buckets2 = (row2?.buckets as number[]) ?? [];
    check(
      "merge: bucket toplamı da 153",
      buckets2.reduce((a, b) => a + b, 0) === 153
    );

    // --- History: persentil birleşik bucket'tan, max'ı aşmaz ---------------------
    const series = await latencyHistory(7, KEY);
    check("history serisi tek gün", series.length === 1);
    // 140×8ms + 10×400 + 2×30 + 1×2000 → p50 hızlı dilimde (10ms bucket tavanı)
    check("history p50 hızlı bucket'ta", series[0]?.p50Ms === 10);
    check("history p95 ≤ max", (series[0]?.p95Ms ?? 9e9) <= (series[0]?.maxMs ?? 0));
    check("history errCount taşındı (2)", series[0]?.errCount === 2);

    const routes = await latencyHistoryRoutes(7);
    check("route listesi anahtarı içeriyor", routes.includes(KEY));

    // --- MUTLAK takvim günü (denetim bulgusu): DB'deki day::text YEREL bugüne
    // eşit olmalı — localDay yanlış üretse round-trip yine tutar, bu tutmaz.
    const n = new Date();
    const todayLocal = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    const rawDay = await prisma.$queryRaw<Array<{ d: string }>>`
      SELECT day::text AS d FROM endpoint_latency_daily WHERE "routeKey" = ${KEY}`;
    check(`DB'deki gün etiketi YEREL bugün (${todayLocal})`, rawDay[0]?.d === todayLocal);
    check("history etiketi de yerel bugün", series[0]?.day === todayLocal);

    // --- Route'suz history: farklı uçların bucket'ları GÜN İÇİNDE birleşir ----
    const ROUTE2 = `/api/TEST-perf-b-${RUN}`;
    for (let i = 0; i < 20; i++) noteLatencyDelta("GET", ROUTE2, 200, 3_000); // yavaş uç
    await flushLatencyNow();
    const all = await latencyHistory(7); // route filtresi YOK
    const today = all.find((s) => s.day === todayLocal);
    // Dev DB'de başka satır olabilir — en azından iki TEST ucunun toplamını kapsamalı
    check("route'suz seri iki ucu da kapsıyor (count ≥ 173)", (today?.count ?? 0) >= 173);
    check("birleşik p95 yavaş ucu görüyor (≥ 400)", (today?.p95Ms ?? 0) >= 400);

    // --- Sağlık: başarılı akışta failure yok -------------------------------------
    const health = getLatencyPersistHealth();
    check("flush hatası yok", health.flushFailures === 0);
    check("lastFlushOkAt dolu", typeof health.lastFlushOkAt === "number");
  } finally {
    // Cleanup — test kendi yarattığını siler.
    await prisma.endpointLatencyDaily.deleteMany({
      where: { routeKey: { contains: `TEST-perf` } },
    });
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  }
}

void main();
