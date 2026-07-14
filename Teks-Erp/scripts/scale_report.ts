// =============================================================================
// TeksERP — Ölçek/Darboğaz ölçüm harness'i (Faz C1)
// =============================================================================
// teks_loadtest'e karşı aday HOT sorguları ölçer:
//   - Her sorgu N=20 kez GERÇEK servis metoduyla koşulur → p50/p95 (ms).
//   - EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ile plan alınır:
//       Seq Scan içeriyor mu? + Execution Time + plan/gerçek satır.
//   - DB metrikleri: pg_database_size, en büyük 10 tablo+index, cache hit,
//     rolls/system_logs dead-tuple %.
//   - MAX_OFFSET=10000 guard hâlâ 400 veriyor mu (1 test).
//
// ⚠️ SADECE teks_loadtest:
//   export DATABASE_URL="postgresql://oad@localhost:5432/teks_loadtest?schema=public"
//   export JWT_SECRET="ci-test-secret-not-for-production"; export TZ=UTC
//   npx tsx scripts/scale_report.ts
//
// Çıktı: konsola insan-okur tablo (docs/history/SCALE-REPORT.md elle bunu özetler).
// CUD YOK — salt okuma; DB'yi değiştirmez.
// =============================================================================

import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { DashboardService } from "../src/services/dashboard.service";
import { ShippingService } from "../src/services/shipping.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { SystemLogService } from "../src/services/system-log.service";
import { getStockDistribution } from "../src/services/reports/inventory.report.service";
import { getOrderFulfillment } from "../src/services/reports/sales.report.service";
import { getSystemLogSummary, getUserActivity } from "../src/services/reports/audit.report.service";
import { buildPagination } from "../src/utils/query-parser";
import { AppError } from "../src/utils/app-error";
import type { DateRange } from "../src/services/reports/_shared";

if (!process.env.DATABASE_URL?.includes("teks_loadtest")) {
  console.error("❌ GÜVENLİK: DATABASE_URL teks_loadtest içermiyor — durduruldu.");
  process.exit(1);
}

const N = 20; // her sorgu iterasyonu
const fullYear: DateRange = {
  from: new Date(Date.now() - 365 * 86_400_000),
  to: new Date(),
};

// ---------------------------------------------------------------------------
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

interface Timing {
  p50: number;
  p95: number;
  min: number;
  max: number;
}
async function timeIt(fn: () => Promise<unknown>): Promise<Timing> {
  // 2 ısınma turu (plan cache / buffer) — ölçüme katma.
  await fn().catch(() => {});
  await fn().catch(() => {});
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1_000_000); // ms
  }
  samples.sort((a, b) => a - b);
  return {
    p50: Math.round(percentile(samples, 50) * 100) / 100,
    p95: Math.round(percentile(samples, 95) * 100) / 100,
    min: Math.round(samples[0] * 100) / 100,
    max: Math.round(samples[samples.length - 1] * 100) / 100,
  };
}

interface ExplainResult {
  hasSeqScan: boolean;
  seqScanTables: string[];
  execMs: number | null;
  planMs: number | null;
  plan: string;
}
async function explain(sql: string): Promise<ExplainResult> {
  const rows = (await prisma.$queryRawUnsafe(
    "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + sql
  )) as Array<Record<string, string>>;
  const plan = rows.map((r) => Object.values(r)[0]).join("\n");
  const hasSeqScan = /Seq Scan/i.test(plan);
  const seqScanTables = [
    ...new Set([...plan.matchAll(/Seq Scan on (\w+)/g)].map((m) => m[1])),
  ];
  const execMatch = plan.match(/Execution Time: ([\d.]+) ms/);
  const planMatch = plan.match(/Planning Time: ([\d.]+) ms/);
  return {
    hasSeqScan,
    seqScanTables,
    execMs: execMatch ? Number(execMatch[1]) : null,
    planMs: planMatch ? Number(planMatch[1]) : null,
    plan,
  };
}

// fake Request — query string parametreleriyle (test_performance.ts kalıbı).
function req(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

interface Row {
  name: string;
  timing?: Timing;
  explain?: ExplainResult;
  note?: string;
}
const results: Row[] = [];

async function measure(
  name: string,
  fn: () => Promise<unknown>,
  explainSql?: string,
  note?: string
): Promise<void> {
  const timing = await timeIt(fn);
  const ex = explainSql ? await explain(explainSql) : undefined;
  results.push({ name, timing, explain: ex, note });
  const seq = ex ? (ex.hasSeqScan ? `SEQ:${ex.seqScanTables.join(",")}` : "index") : "-";
  const exec = ex?.execMs != null ? `${ex.execMs}ms` : "-";
  console.log(
    `  ${name.padEnd(46)} p50=${String(timing.p50).padStart(8)}ms p95=${String(timing.p95).padStart(8)}ms | plan=${seq} exec=${exec}`
  );
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("\n=== SCALE REPORT (teks_loadtest) ===\n");

  const inventory = new InventoryService();
  const shipping = new ShippingService();
  const subcontractor = new SubcontractorService();
  void subcontractor;

  // -------------------------------------------------------------------------
  // 0) Hacim sayıları
  // -------------------------------------------------------------------------
  console.log("--- Tablo satır sayıları ---");
  const tableNames = [
    "orders", "order_lines", "work_orders", "work_order_steps", "rolls",
    "roll_operations", "roll_movements", "traveler_cards", "traveler_card_scans",
    "shipments", "shipment_orders", "sacks", "shipment_allocations", "system_logs",
  ];
  const counts: Record<string, number> = {};
  for (const t of tableNames) {
    const r = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS c FROM "${t}"`)) as Array<{ c: bigint }>;
    counts[t] = Number(r[0].c);
    console.log(`  ${t.padEnd(26)} ${counts[t].toLocaleString()}`);
  }
  const grand = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`  ${"TOPLAM".padEnd(26)} ${grand.toLocaleString()}`);

  // -------------------------------------------------------------------------
  // 1) HOT SORGULAR — gerçek servis + EXPLAIN
  // -------------------------------------------------------------------------
  console.log("\n--- Hot sorgular (gerçek servis p50/p95 + EXPLAIN ANALYZE) ---");

  // dashboard.getStationsLiveState
  await measure(
    "dashboard.getStationsLiveState",
    () => DashboardService.getStationsLiveState(),
    `SELECT s."id", COALESCE(q.cnt,0) FROM "stations" s
     LEFT JOIN (SELECT wos."stationId", COUNT(r."id") cnt FROM "rolls" r
       JOIN "work_order_steps" wos ON wos."id" = r."currentStepId" GROUP BY wos."stationId") q
       ON q."stationId" = s."id" WHERE s."isActive" = true`
  );

  // inventory.findAllRolls — (i) cursor liste status=WAREHOUSE
  await measure(
    "inventory.findAllRolls (WAREHOUSE cursor)",
    () => inventory.findAllRolls(req({ mode: "cursor", limit: "50", "filter[status]": "WAREHOUSE", sortBy: "createdAt", sortOrder: "desc" })),
    `SELECT id FROM rolls WHERE status='WAREHOUSE' AND "qualityGrade"<>'FIRE' ORDER BY "createdAt" DESC LIMIT 51`
  );

  // inventory.getRollStats — (ii) groupBy
  await measure(
    "inventory.getRollStats (groupBy)",
    () => inventory.getRollStats(req({ "filter[status]": "ALL" })),
    `SELECT status, "qualityGrade", COUNT(*), SUM("currentQty") FROM rolls GROUP BY status, "qualityGrade"`
  );

  // inventory.findAllRolls — (iii) serbest-metin arama item.name contains
  await measure(
    "inventory.findAllRolls (item.name contains)",
    () => inventory.findAllRolls(req({ mode: "cursor", limit: "50", "filter[status]": "ALL", search: "PATOS" })),
    `SELECT r.id FROM rolls r JOIN items i ON i.id=r."itemId"
     WHERE (r.barcode='PATOS' OR i.name ILIKE '%PATOS%' OR i.code ILIKE '%PATOS%')
     ORDER BY r."createdAt" DESC LIMIT 51`
  );

  // inventory.findAllRolls — (iv) barcode equals
  const sampleBarcode = (await prisma.$queryRawUnsafe(
    `SELECT barcode FROM rolls WHERE barcode IS NOT NULL LIMIT 1`
  )) as Array<{ barcode: string }>;
  const bc = sampleBarcode[0]?.barcode ?? "LT-R-0-0";
  await measure(
    "inventory.findAllRolls (barcode equals)",
    () => inventory.findAllRolls(req({ mode: "cursor", limit: "50", "filter[status]": "ALL", search: bc })),
    `SELECT id FROM rolls WHERE barcode='${bc}' LIMIT 51`
  );

  // reports: getStockDistribution
  await measure(
    "reports.getStockDistribution",
    () => getStockDistribution(),
    `SELECT i.name, COALESCE(c.name,'Ham'), COUNT(*), SUM(r."currentQty")
     FROM rolls r JOIN items i ON r."itemId"=i.id LEFT JOIN colors c ON r."colorId"=c.id
     WHERE r.status IN ('WAREHOUSE','STOCK') GROUP BY i.name, COALESCE(c.name,'Ham')
     ORDER BY 4 DESC NULLS LAST LIMIT 100`
  );

  // reports: getOrderFulfillment (date range)
  await measure(
    "reports.getOrderFulfillment",
    () => getOrderFulfillment(fullYear),
    `SELECT o.status, COUNT(*), SUM(lines.total_qty), SUM(o."shippedQty")
     FROM orders o LEFT JOIN LATERAL (SELECT COALESCE(SUM(ol.quantity),0) total_qty FROM order_lines ol WHERE ol."orderId"=o.id) lines ON true
     WHERE o."createdAt">=NOW()-INTERVAL '365 days' GROUP BY o.status`
  );

  // reports: getSystemLogSummary
  await measure(
    "reports.getSystemLogSummary",
    () => getSystemLogSummary(fullYear),
    `SELECT "tableName", COUNT(*) FROM system_logs
     WHERE "createdAt">=NOW()-INTERVAL '365 days' GROUP BY "tableName" ORDER BY 2 DESC LIMIT 30`
  );

  // reports: getUserActivity (multi-col GROUP BY + date range + join)
  await measure(
    "reports.getUserActivity",
    () => getUserActivity(fullYear),
    `SELECT sl."userId", u.username,
       COUNT(*) FILTER (WHERE sl.action='CREATE'), COUNT(*)
     FROM system_logs sl LEFT JOIN users u ON u.id=sl."userId"
     WHERE sl."createdAt">=NOW()-INTERVAL '365 days'
     GROUP BY sl."userId", u.username, u."fullName" ORDER BY 4 DESC LIMIT 100`
  );

  // audit SystemLog operatör-aktivite: userId+category='DOMAIN'+createdAt aralığı,
  // ORDER BY createdAt DESC LIMIT 100
  const sampleUser = (await prisma.$queryRawUnsafe(
    `SELECT "userId" FROM system_logs WHERE "userId" IS NOT NULL LIMIT 1`
  )) as Array<{ userId: string }>;
  const uid = sampleUser[0]?.userId;
  await measure(
    "SystemLog.list (userId+DOMAIN, sayfa 1)",
    () => SystemLogService.list({ userId: uid, category: "DOMAIN", limit: 100 }),
    `SELECT id FROM system_logs WHERE "userId"='${uid}' AND category='DOMAIN'
     ORDER BY "createdAt" DESC, id DESC LIMIT 101`
  );

  // derin sayfa (offset 1000 benzeri) — cursor tabanlı; OFFSET 1000 raw EXPLAIN
  await measure(
    "SystemLog deep page (OFFSET 1000)",
    async () => {
      await prisma.$queryRawUnsafe(
        `SELECT id FROM system_logs WHERE "userId"=$1 AND category='DOMAIN'
         ORDER BY "createdAt" DESC, id DESC LIMIT 100 OFFSET 1000`,
        uid
      );
    },
    `SELECT id FROM system_logs WHERE "userId"='${uid}' AND category='DOMAIN'
     ORDER BY "createdAt" DESC, id DESC LIMIT 100 OFFSET 1000`
  );

  // shipping loadShipmentForFinalize (büyük sevkiyat) — N+1 var mı (getShipmentById public)
  const bigShip = (await prisma.$queryRawUnsafe(
    `SELECT s.id FROM shipments s
     JOIN rolls r ON r."shipmentId"=s.id
     GROUP BY s.id ORDER BY COUNT(r.id) DESC LIMIT 1`
  )) as Array<{ id: string }>;
  const shipId = bigShip[0]?.id;
  if (shipId) {
    await measure(
      "shipping.getShipmentById (büyük sevk, N+1?)",
      () => shipping.getShipmentById(shipId),
      undefined,
      "Prisma nested select — N+1 query sayısı için aşağıdaki manuel sayım"
    );
  } else {
    results.push({ name: "shipping.getShipmentById", note: "büyük sevk bulunamadı" });
  }

  // subcontractor list/finalization N+1 — receive() yazma yapar (ölçemeyiz);
  // bunun yerine onun OKUMA yükünü temsil eden dispatch-with-items load'unu ölç.
  const sampleStep = (await prisma.$queryRawUnsafe(
    `SELECT "stationId" FROM work_order_steps LIMIT 1`
  )) as Array<{ stationId: string }>;
  void sampleStep;
  // SubcontractorReceipt liste benzeri ağır okuma: son 100 receipt + items + newRoll
  await measure(
    "subcontractor receipts list (items+newRoll join)",
    async () => {
      await prisma.subcontractorReceipt.findMany({
        take: 100,
        orderBy: { receivedAt: "desc" },
        include: { items: { include: { newRoll: { select: { id: true, barcode: true } } } } },
      });
    },
    `SELECT id FROM subcontractor_receipts ORDER BY "receivedAt" DESC LIMIT 100`,
    "Prisma include → ana sorgu + N alt sorgu (relation load count)"
  );

  // -------------------------------------------------------------------------
  // 2) MAX_OFFSET guard testi
  // -------------------------------------------------------------------------
  console.log("\n--- MAX_OFFSET=10000 guard ---");
  let guardThrew = false;
  let guard400 = false;
  try {
    buildPagination(300, 50); // skip=14950 > 10000
  } catch (e) {
    guardThrew = true;
    guard400 = e instanceof AppError && e.statusCode === 400;
  }
  console.log(`  skip>10000 → hata fırlattı: ${guardThrew}, AppError 400: ${guard400}`);
  results.push({ name: "MAX_OFFSET guard (skip>10000 → 400)", note: `threw=${guardThrew} is400=${guard400}` });

  // -------------------------------------------------------------------------
  // 3) DB METRİKLERİ
  // -------------------------------------------------------------------------
  console.log("\n--- DB boyutları ---");
  const dbSize = (await prisma.$queryRawUnsafe(
    `SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
            pg_database_size(current_database())::bigint AS bytes`
  )) as Array<{ size: string; bytes: bigint }>;
  console.log(`  pg_database_size: ${dbSize[0].size} (${Number(dbSize[0].bytes).toLocaleString()} bytes)`);

  console.log("\n--- En büyük 10 tablo (heap) + index toplamı ---");
  const bigTables = (await prisma.$queryRawUnsafe(
    `SELECT c.relname AS name,
            pg_size_pretty(pg_relation_size(c.oid)) AS heap,
            pg_size_pretty(pg_indexes_size(c.oid)) AS idx,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
            pg_total_relation_size(c.oid)::bigint AS total_bytes
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relkind='r' AND n.nspname='public'
     ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 10`
  )) as Array<{ name: string; heap: string; idx: string; total: string; total_bytes: bigint }>;
  for (const t of bigTables) {
    console.log(`  ${t.name.padEnd(26)} heap=${t.heap.padStart(10)} idx=${t.idx.padStart(10)} total=${t.total.padStart(10)}`);
  }

  console.log("\n--- Cache hit oranı (heap blks) ---");
  const cacheHit = (await prisma.$queryRawUnsafe(
    `SELECT sum(heap_blks_hit) AS hit, sum(heap_blks_read) AS read,
            ROUND(100.0*sum(heap_blks_hit)/NULLIF(sum(heap_blks_hit)+sum(heap_blks_read),0),2) AS hit_pct
     FROM pg_statio_user_tables`
  )) as Array<{ hit: bigint; read: bigint; hit_pct: number }>;
  console.log(`  cache hit: ${cacheHit[0].hit_pct}% (hit=${Number(cacheHit[0].hit).toLocaleString()} read=${Number(cacheHit[0].read).toLocaleString()})`);

  console.log("\n--- Dead-tuple % (rolls, system_logs) ---");
  const deadTuples = (await prisma.$queryRawUnsafe(
    `SELECT relname,
            n_live_tup::bigint AS live, n_dead_tup::bigint AS dead,
            ROUND(100.0*n_dead_tup/NULLIF(n_live_tup+n_dead_tup,0),2) AS dead_pct
     FROM pg_stat_user_tables WHERE relname IN ('rolls','system_logs')`
  )) as Array<{ relname: string; live: bigint; dead: bigint; dead_pct: number }>;
  for (const d of deadTuples) {
    console.log(`  ${d.relname.padEnd(14)} live=${Number(d.live).toLocaleString()} dead=${Number(d.dead).toLocaleString()} dead%=${d.dead_pct ?? 0}`);
  }

  // -------------------------------------------------------------------------
  // 4) Full EXPLAIN dökümü (rapor için seçili planlar) — stderr'e detaylı
  // -------------------------------------------------------------------------
  console.log("\n=== SEÇİLİ EXPLAIN PLANLARI (rapor için) ===\n");
  for (const r of results) {
    if (r.explain) {
      console.log(`### ${r.name}`);
      console.log(`p50=${r.timing?.p50}ms p95=${r.timing?.p95}ms | seqScan=${r.explain.hasSeqScan}${r.explain.seqScanTables.length ? " (" + r.explain.seqScanTables.join(",") + ")" : ""} | exec=${r.explain.execMs}ms plan=${r.explain.planMs}ms`);
      console.log(r.explain.plan);
      console.log("");
    }
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("❌ scale_report error:", e);
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
