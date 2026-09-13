// =============================================================================
// test_latency_persist — günlük özet kalıcılaştırması (GERÇEK DB, TEST- verisi)
// =============================================================================
// Koşum: npx tsx scripts/test_latency_persist.ts
//   Saat dilimi sondası CI gibi: TZ=UTC npx tsx scripts/test_latency_persist.ts
// Sözleşmeler: gün anahtarı tek kaynak (constants/time.ts, saat diliminden
// bağımsız), flush merge-upsert (gün içi toplanır), bucket'lar korunur,
// history persentili birleşik bucket'tan ve max'ı aşmaz, retention 90+ günü
// siler, flush hataları isteği düşürmez (sağlık sayacı).

import prisma from "../src/lib/prisma";
import { factoryDayKeyUtcMidnight, factoryYmd } from "../src/constants/time";
import {
  noteLatencyDelta,
  flushLatencyNow,
  latencyHistory,
  latencyHistoryRoutes,
  getLatencyPersistHealth,
  RETENTION_DAYS,
  type LatencyHistoryPoint,
} from "../src/services/latency-persist.service";
// Persentil ARİTMETİĞİ servisin kendi dışa açık yardımcısından gelir (tek kaynak):
// test AGGREGATION yolunu doğrular, matematiği KOPYALAMAZ — matematik değişirse
// kıyas da onunla değişir, test sessizce bayatlamaz.
import {
  BUCKET_BOUNDS_MS,
  bucketIndex,
  percentileFromBuckets,
} from "../src/services/latency-stats.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const RUN = Date.now();
const ROUTE = `/api/TEST-perf-${RUN}`; // benzersiz TEST- anahtarı
const KEY = `GET ${ROUTE}`;
const OLD_KEY = `GET /api/TEST-perf-old-${RUN}`;

// Gün anahtarı TEK KAYNAKTAN (constants/time.ts) — servisin `localDay`i de aynı
// fonksiyona bağlı. Eski hâli süreç saat dilimiyle (`getFullYear()` vb.) kendi
// gününü üretiyordu: UTC koşan CI'da 21:00Z–00:00Z (İstanbul 00:00–03:00) servis
// fabrika gününe yazarken test bir önceki güne bakıyor, her gece 3 saat kırmızı
// pencere açılıyordu (ölçüldü 2026-09-14, koşum 21:08Z: 11/16).
function localDay(offsetDays = 0, at: Date = new Date()): Date {
  const d = factoryDayKeyUtcMidnight(at);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

/**
 * NEGATİF SONDA — gerçek saati beklemeden: testin gün anahtarı, sözleşmenin
 * (`factoryYmd`) gününe SABİT anlarda eşit olmalı. 21:30Z fabrika için ERTESİ
 * gündür; süreç saat dilimine dayanan bir helper `TZ=UTC` altında burada 09-13
 * üretir ve kırmızı verir (mutasyon: `localDay`i eski Y/M/D hâline çevir).
 * `TEST_LATENCY_NOW` (ISO) verilirse o an da listeye eklenir.
 */
function checkDaySourceAgainstContract(): void {
  const instants = [
    ["2026-09-13T21:30:00Z", "2026-09-14"], // İstanbul 00:30 — kırmızı pencerenin içi
    ["2026-09-13T20:59:59Z", "2026-09-13"], // İstanbul 23:59:59 — pencerenin hemen öncesi
    // Kış anı MEVSİM FARKI ÖLÇMEZ, mevsim farkı OLMADIĞINI kilitler: Türkiye 2016'dan
    // beri sabit UTC+3, DST yok ⇒ 21:30Z her mevsim ertesi gündür. tzdata DST'yi
    // geri getirirse ya da ofset "yazın +3 kışın +2" diye elle yazılırsa BU satır
    // kırmızı verir — beklentiyi 01-15'e çevirmek sondayı öldürür.
    ["2026-01-15T21:30:00Z", "2026-01-16"],
  ];
  const extra = process.env.TEST_LATENCY_NOW;
  if (extra) instants.push([extra, factoryYmd(new Date(extra))]);
  for (const [iso, expected] of instants) {
    const at = new Date(iso);
    const mine = localDay(0, at).toISOString().slice(0, 10);
    check(
      `gün anahtarı sözleşmeyle aynı @${iso}`,
      mine === expected && factoryYmd(at) === expected,
      `test=${mine} sözleşme=${factoryYmd(at)} beklenen=${expected} TZ=${process.env.TZ ?? "(süreç)"}`
    );
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type TodayRow = { routeKey: string; count: number; errCount: number; maxMs: number; buckets: unknown };
interface Folded {
  count: number;
  errCount: number;
  maxMs: number;
  buckets: number[];
}

/** Bugünün TÜM satırları — latencyHistory'nin okuduğu kümenin AYNISI (oracle girdisi). */
async function readTodayRows(): Promise<TodayRow[]> {
  return prisma.endpointLatencyDaily.findMany({
    where: { day: localDay() },
    select: { routeKey: true, count: true, errCount: true, maxMs: true, buckets: true },
  });
}

/**
 * Servisin gün-içi katlamasının BİREBİR aynısı (latency-persist.service
 * latencyHistory byDay döngüsü): count/errCount toplanır, maxMs maksimum alınır,
 * bucket'lar MAX-UZUNLUK ile indeks indeks toplanır (uzun dizinin kuyruğu düşmesin).
 */
function foldRows(rows: TodayRow[]): Folded {
  const f: Folded = { count: 0, errCount: 0, maxMs: 0, buckets: BUCKET_BOUNDS_MS.map(() => 0) };
  for (const r of rows) {
    f.count += r.count;
    f.errCount += r.errCount;
    f.maxMs = Math.max(f.maxMs, r.maxMs);
    const b = r.buckets as number[];
    for (let i = 0; i < Math.max(f.buckets.length, b.length); i++) {
      f.buckets[i] = (f.buckets[i] ?? 0) + (b[i] ?? 0);
    }
  }
  return f;
}

/**
 * OKU–ÇAĞIR–OKU sandviçi. Canlı dev sunucusu AYNI tabloya YAZAR (kendi 5dk'lık
 * flush'ı) ve latencyHistory ayrı bir statement = ayrı MVCC snapshot'ı okur →
 * history ile oracle okuması arasında satır değişirse TAM EŞİTLİK kıyası anlamsız
 * olur. İki okumanın parmak izi eşitse pencere KARARLI sayılır; değilse beklenip
 * yeniden denenir (4×150ms tek bir flush'ı garantiyle aşar). Kararsızlıkta test
 * SESSİZCE GEÇMEZ — nedeni yazan bir check düşer.
 */
async function readStableUnion(
  dayLabel: string
): Promise<{ rows: TodayRow[]; oracle: Folded; point: LatencyHistoryPoint | undefined } | null> {
  const fp = (f: Folded): string => `${f.count}|${f.errCount}|${f.maxMs}|${f.buckets.join(",")}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = foldRows(await readTodayRows());
    const series = await latencyHistory(7); // route filtresi YOK
    const rows = await readTodayRows();
    const oracle = foldRows(rows);
    if (fp(before) === fp(oracle)) {
      return { rows, oracle, point: series.find((s) => s.day === dayLabel) };
    }
    await sleep(150);
  }
  return null;
}

async function main(): Promise<void> {
  try {
    checkDaySourceAgainstContract();

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

    // --- MUTLAK takvim günü (denetim bulgusu): DB'deki day::text FABRİKA bugününe
    // eşit olmalı — localDay yanlış üretse round-trip yine tutar, bu tutmaz.
    // Beklenen değer SÜREÇ saat diliminden (`getFullYear()` vb.) DEĞİL, sözleşmenin
    // kendisinden (constants/time.ts → factoryYmd) türetilir: aksi halde UTC koşan
    // CI'da 21:00Z sonrası bu iddia kendi kendine yanlışlanırdı ve "yerel"in hangi
    // yerel olduğu bir kez daha yazılmamış olurdu.
    const todayFactory = factoryYmd();
    const rawDay = await prisma.$queryRaw<Array<{ d: string }>>`
      SELECT day::text AS d FROM endpoint_latency_daily WHERE "routeKey" = ${KEY}`;
    check(`DB'deki gün etiketi FABRİKA bugünü (${todayFactory})`, rawDay[0]?.d === todayFactory);
    check("history etiketi de fabrika bugünü", series[0]?.day === todayFactory);

    // --- Route'suz history: farklı uçların bucket'ları GÜN İÇİNDE birleşir ----
    const ROUTE2 = `/api/TEST-perf-b-${RUN}`;
    const KEY2 = `GET ${ROUTE2}`;
    for (let i = 0; i < 20; i++) noteLatencyDelta("GET", ROUTE2, 200, 3_000); // yavaş uç
    await flushLatencyNow();

    // AMBIENT-DUYARSIZLIĞIN KENDİ KANITI: güne 20.000 hızlı örneklik gürültü satırı
    // ekle (finally'deki `contains: "TEST-perf"` temizliğine takılır). Eski mutlak
    // eşik testi ("p95 ≥ 400") bu satır varken KESİN düşerdi; aşağıdaki oracle
    // kıyası etkilenmez. Ayrıca birleşik persentili HER satırın tek-başına
    // persentilinden UZAĞA iter → "birleşik histogramdan mı okundu, yoksa tek
    // satırdan/satır-başı ortalamadan mı?" ayrımı ölçülebilir hale gelir.
    const noiseBuckets = BUCKET_BOUNDS_MS.map(() => 0);
    noiseBuckets[0] = 20_000; // ≤1ms bucket'ı
    await prisma.endpointLatencyDaily.create({
      data: {
        day: localDay(),
        routeKey: `GET /api/TEST-perf-noise-${RUN}`,
        count: 20_000,
        errCount: 0,
        maxMs: 1,
        buckets: noiseBuckets,
      },
    });

    const union = await readStableUnion(todayFactory);
    if (!union) {
      check(
        "bugünün satırları KARARLI okundu (oracle kıyası için şart)",
        false,
        "4 denemede de okuma penceresinde satır değişti — canlı sunucu yazmayı sürdürüyor"
      );
    } else {
      const { rows, oracle, point } = union;
      const r1 = rows.find((r) => r.routeKey === KEY);
      const r2 = rows.find((r) => r.routeKey === KEY2);

      // ÇAPA: kendi satırlarımız gerçekten yazıldı mı? Bu olmadan "seri = oracle"
      // eşitliği, iki TEST satırı hiç yazılmasa da ambient'e karşı doğru çıkardı.
      check(
        "iki TEST ucu da bugünün satırlarında (153 + 20)",
        r1?.count === 153 && r2?.count === 20,
        `k1=${r1?.count} k2=${r2?.count} satır=${rows.length}`
      );
      // Yazım yolu: 3000ms doğru bucket'a düştü (bucketIndex hizası korunuyor).
      check(
        "yavaş uç 3000ms doğru bucket'a yazıldı (20 örnek)",
        ((r2?.buckets as number[] | undefined)?.[bucketIndex(3_000)] ?? 0) === 20,
        `idx=${bucketIndex(3_000)} sayaç=${(r2?.buckets as number[] | undefined)?.[bucketIndex(3_000)]}`
      );

      // BİRLEŞME KANITI (eski `count >= 173` yerine): route'suz seri günün TÜM
      // satırlarının toplamıdır — tek satır ya da satır-başı ortalama DEĞİL.
      // `>= 173` BOŞTU: kirlilikte monoton olduğu için testin kendi satırları hiç
      // yazılmasa bile ambient tek başına geçiriyordu.
      check(
        "route'suz seri günün tüm satırlarını birleştirdi (count)",
        point?.count === oracle.count,
        `seri=${point?.count} oracle=${oracle.count}`
      );
      check(
        "birleşimde errCount de toplandı",
        point?.errCount === oracle.errCount,
        `seri=${point?.errCount} oracle=${oracle.errCount}`
      );
      check(
        "birleşik maxMs satırların maksimumu",
        point?.maxMs === oracle.maxMs,
        `seri=${point?.maxMs} oracle=${oracle.maxMs}`
      );
      // Yavaş uç agregada var mı? maxMs hacimden BAĞIMSIZ (monoton) → sağlam.
      check("birleşik seri yavaş ucu kapsıyor (maxMs ≥ 3000)", (point?.maxMs ?? 0) >= 3_000, `max=${point?.maxMs}`);
      // Yavaş bucket birleşmeden SAĞ ÇIKTI mı — "yavaş ucu görüyor"un dürüst hâli.
      check(
        "yavaş bucket (3000ms) birleşik histogramda duruyor",
        (oracle.buckets[bucketIndex(3_000)] ?? 0) >= 20,
        `birleşik=${oracle.buckets[bucketIndex(3_000)]}`
      );

      // Persentiller BİRLEŞİK bucket'tan: servisin kendi dışa açık yardımcısıyla
      // kıyaslanır. Mutlak eşik KULLANILMAZ — birleşik p95 ambient trafiğin
      // ŞEKLİNE bağlıdır (yeterince hızlı örnekle 1ms bucket'ına yakınsar), yani
      // sıfır dışında sağlam hiçbir alt sınır yoktur.
      const expP50 = percentileFromBuckets(oracle.buckets, oracle.count, 0.5, oracle.maxMs);
      const expP95 = percentileFromBuckets(oracle.buckets, oracle.count, 0.95, oracle.maxMs);
      check("birleşik p50 = birleşik bucket'ın p50'si", point?.p50Ms === expP50, `seri=${point?.p50Ms} beklenen=${expP50}`);
      check("birleşik p95 = birleşik bucket'ın p95'i", point?.p95Ms === expP95, `seri=${point?.p95Ms} beklenen=${expP95}`);
    }

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
