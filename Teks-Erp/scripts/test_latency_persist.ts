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

function localDay(offsetDays = 0): Date {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  d.setDate(d.getDate() + offsetDays);
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
