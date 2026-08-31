// =============================================================================
// TeksERP — Audit özeti A/B bench (Faz C2 — çözüm ölçümü)
// =============================================================================
// getSystemLogSummary için ESKİ (4 ardışık sorgu) vs YENİ (3 PARALEL sorgu +
// total'i byAction'dan türet) yaklaşımı AYNI veride ölçer.
//
// Neden YENİ ölçülmeye değer (Faz C2 GROUPING SETS regresyonundan FARKLI):
//   - Base prisma client HAVUZLU (pg Pool max:30, tx DEĞİL) → bağımsız sorgular
//     ayrı connection'larda GERÇEKTEN paralel koşar. CLAUDE.md kuralı #11
//     (`tx.* + Promise.all YASAK`) yalnız tek-connection tx client'ı içindir.
//   - `total` sorgusu GEREKSİZ: `byAction` LIMIT'siz + `action` NOT NULL →
//     totalLogs = Σ byAction.count (cebirsel olarak birebir). 4 tarama → 3.
//   - SQL ŞEKLİ değişmiyor (GROUPING SETS gibi yeni plan riski yok) → regresyon
//     yapısal olarak imkânsız; en kötü ihtimal "hızlanma yok".
//
// ⚠️ SADECE teks_loadtest:
//   export DATABASE_URL="postgresql://oad@localhost:5432/teks_loadtest?schema=public"
//   export JWT_SECRET="ci-test-secret-not-for-production"; export TZ=UTC
//   npx tsx scripts/bench_audit_summary.ts
//
// İlk koşuda ~430k system_logs satırı üretir (yoksa). Salt-okuma ölçüm; mevcut
// veriyi değiştirmez (yalnız tablo boşsa seed eder).
// =============================================================================

import { Prisma } from "@prisma/client";
import { assertGelistirmeVeritabani } from "./db-guard";
import prisma from "../src/lib/prisma";
import { pool } from "../src/lib/prisma";
import { getSystemLogSummary } from "../src/services/reports/audit.report.service";
import type { DateRange } from "../src/services/reports/_shared";

if (!process.env.DATABASE_URL?.includes("teks_loadtest")) {
  console.error("❌ GÜVENLİK: DATABASE_URL teks_loadtest içermiyor — durduruldu.");
  process.exit(1);
}

const N = 20;
const TARGET_ROWS = 430_000;
const fullYear: DateRange = {
  from: new Date(Date.now() - 365 * 86_400_000),
  to: new Date(),
};

interface SystemLogSummary {
  totalLogs: number;
  byAction: { action: string; count: number }[];
  byTable: { tableName: string; count: number }[];
  daily: { day: string; create: number; update: number; delete: number }[];
}

// ---------------------------------------------------------------------------
// ESKİ yaklaşım: 4 ardışık sorgu (mevcut servis davranışının birebir kopyası)
// ---------------------------------------------------------------------------
async function summaryOld(range: DateRange): Promise<SystemLogSummary> {
  const totalRow = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS total FROM system_logs
    WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
  `);
  const actionRows = await prisma.$queryRaw<Array<{ action: string; count: bigint }>>(Prisma.sql`
    SELECT action, COUNT(*) AS count FROM system_logs
    WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
    GROUP BY action ORDER BY count DESC
  `);
  const tableRows = await prisma.$queryRaw<Array<{ tableName: string; count: bigint }>>(Prisma.sql`
    SELECT "tableName", COUNT(*) AS count FROM system_logs
    WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
    GROUP BY "tableName" ORDER BY count DESC LIMIT 30
  `);
  const dailyRows = await prisma.$queryRaw<
    Array<{ day: Date; createCount: bigint; updateCount: bigint; deleteCount: bigint }>
  >(Prisma.sql`
    SELECT DATE_TRUNC('day', "createdAt")::date AS day,
      COUNT(*) FILTER (WHERE action = 'CREATE') AS "createCount",
      COUNT(*) FILTER (WHERE action = 'UPDATE') AS "updateCount",
      COUNT(*) FILTER (WHERE action = 'DELETE') AS "deleteCount"
    FROM system_logs
    WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
    GROUP BY 1 ORDER BY 1
  `);
  return {
    totalLogs: Number(totalRow[0]?.total ?? 0),
    byAction: actionRows.map((r) => ({ action: r.action, count: Number(r.count) })),
    byTable: tableRows.map((r) => ({ tableName: r.tableName, count: Number(r.count) })),
    daily: dailyRows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      create: Number(r.createCount),
      update: Number(r.updateCount),
      delete: Number(r.deleteCount),
    })),
  };
}

// ---------------------------------------------------------------------------
// YENİ yaklaşım = gerçek servis (getSystemLogSummary) — aşağıda optimize edilen.
// ---------------------------------------------------------------------------
const summaryNew = getSystemLogSummary;

// ---------------------------------------------------------------------------
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
async function timeIt(fn: () => Promise<unknown>): Promise<{ p50: number; p95: number; min: number; max: number }> {
  await fn().catch(() => {});
  await fn().catch(() => {});
  const s: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    s.push(Number(process.hrtime.bigint() - t0) / 1_000_000);
  }
  s.sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 100) / 100;
  return { p50: r(percentile(s, 50)), p95: r(percentile(s, 95)), min: r(s[0]), max: r(s[s.length - 1]) };
}

function deepEqualSummary(a: SystemLogSummary, b: SystemLogSummary): { ok: boolean; diff?: string } {
  if (a.totalLogs !== b.totalLogs) return { ok: false, diff: `totalLogs ${a.totalLogs} != ${b.totalLogs}` };
  const norm = (arr: { count?: number; [k: string]: unknown }[]) => JSON.stringify([...arr].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))));
  if (norm(a.byAction) !== norm(b.byAction)) return { ok: false, diff: "byAction farklı" };
  if (norm(a.byTable) !== norm(b.byTable)) return { ok: false, diff: "byTable farklı" };
  if (norm(a.daily) !== norm(b.daily)) return { ok: false, diff: "daily farklı" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
async function ensureSeed(): Promise<void> {
  const cnt = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS c FROM system_logs`)) as Array<{ c: bigint }>;
  const have = Number(cnt[0].c);
  if (have >= TARGET_ROWS) {
    console.log(`  system_logs zaten ${have.toLocaleString()} satır — seed atlandı.`);
    return;
  }
  console.log(`  system_logs ${have.toLocaleString()} satır — ${TARGET_ROWS.toLocaleString()}'e seed ediliyor...`);
  // Gerçekçi dağılım: ~10 action (CREATE/UPDATE/DELETE ağırlıklı + AUTH/SYSTEM),
  // ~24 tableName, createdAt 365 güne yayılmış. category tümü DOMAIN (özet
  // sorguları category'ye dokunmaz → bench için önemsiz, enum riskini eler).
  const CHUNK = 50_000;
  let inserted = have;
  while (inserted < TARGET_ROWS) {
    const batch = Math.min(CHUNK, TARGET_ROWS - inserted);
    await prisma.$executeRawUnsafe(`
      INSERT INTO system_logs (id, "userId", category, action, "tableName", "recordId", "createdAt", "updatedAt")
      SELECT
        gen_random_uuid(), NULL, 'DOMAIN'::"SystemLogCategory",
        (ARRAY['CREATE','CREATE','CREATE','CREATE','UPDATE','UPDATE','UPDATE','DELETE','LOGIN_SUCCESS','LOGIN_FAILED','STARTUP','ERROR'])[1 + (g % 12)],
        (ARRAY['Roll','RollOperation','RollMovement','WorkOrder','WorkOrderStep','Order','OrderLine','TravelerCard','TravelerCardScan','Shipment','Sack','ShipmentAllocation','Customer','Item','Color','Property','SubcontractorDispatch','SubcontractorReceipt','QualityGrade','RollError','PrintedDocument','UserPermission','FeatureFlag','Station'])[1 + (g % 24)],
        'rec-' || g::text,
        NOW() - (random() * 365 || ' days')::interval,
        NOW()
      FROM generate_series(1, ${batch}) g
    `);
    inserted += batch;
    process.stdout.write(`\r  ...${inserted.toLocaleString()} / ${TARGET_ROWS.toLocaleString()}`);
  }
  process.stdout.write("\n");
  await prisma.$executeRawUnsafe(`ANALYZE system_logs`);
  console.log("  seed + ANALYZE tamam.");
}

async function explainScans(range: DateRange): Promise<{ scans: number; execMs: number }> {
  // byAction sorgusunun planını al — temsilci tek-tarama maliyeti.
  const rows = (await prisma.$queryRawUnsafe(
    `EXPLAIN (ANALYZE, FORMAT TEXT) SELECT action, COUNT(*) FROM system_logs
     WHERE "createdAt" >= '${range.from.toISOString()}' AND "createdAt" <= '${range.to.toISOString()}'
     GROUP BY action`
  )) as Array<Record<string, string>>;
  const plan = rows.map((r) => Object.values(r)[0]).join("\n");
  const execMatch = plan.match(/Execution Time: ([\d.]+) ms/);
  const scans = (plan.match(/Seq Scan on system_logs/g) ?? []).length;
  return { scans, execMs: execMatch ? Number(execMatch[1]) : 0 };
}

async function main(): Promise<void> {
  // ⛔ İLK İFADE (BULGU-T1-019, 2. tavsiye): bu betik `system_logs`e SENTETİK
  // satır basar. Prod'a yazsaydı denetim defterini kirletirdi — üstelik audit
  // tablosu değiştirilemez (trigger korumalı), yani temizliği de kolay olmazdı.
  assertGelistirmeVeritabani("bench_audit_summary");
  console.log("\n=== AUDIT ÖZETİ A/B BENCH (teks_loadtest) ===\n");
  await ensureSeed();

  // Doğruluk kapısı: YENİ çıktı ESKİ ile birebir aynı olmalı.
  const oldOut = await summaryOld(fullYear);
  const newOut = (await summaryNew(fullYear)) as SystemLogSummary;
  const eq = deepEqualSummary(oldOut, newOut);
  console.log(`\n  DOĞRULUK: YENİ == ESKİ → ${eq.ok ? "✅ AYNI" : "❌ FARKLI: " + eq.diff}`);
  console.log(`    total=${oldOut.totalLogs.toLocaleString()} | byAction=${oldOut.byAction.length} grup | byTable=${oldOut.byTable.length} | daily=${oldOut.daily.length} gün`);
  if (!eq.ok) {
    console.error("  ❌ Çıktı eşdeğer değil — ölçüm anlamsız, durduruldu.");
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  }

  const ex = await explainScans(fullYear);
  console.log(`\n  Tek tarama (byAction) EXPLAIN: ${ex.scans ? "Seq Scan" : "index"}, exec=${ex.execMs}ms`);

  console.log(`\n  Ölçülüyor (N=${N}, 365-gün worst-case)...`);
  const tOld = await timeIt(() => summaryOld(fullYear));
  const tNew = await timeIt(() => summaryNew(fullYear));

  console.log("\n  ┌─────────────────────────────────────────────────────────────┐");
  console.log(`  │ ESKİ (4 ardışık sorgu)      p50=${String(tOld.p50).padStart(8)}ms p95=${String(tOld.p95).padStart(8)}ms │`);
  console.log(`  │ YENİ (3 paralel + derive)   p50=${String(tNew.p50).padStart(8)}ms p95=${String(tNew.p95).padStart(8)}ms │`);
  console.log("  └─────────────────────────────────────────────────────────────┘");
  const speedup = tOld.p50 / tNew.p50;
  const verdict = speedup >= 1.15 ? `✅ ${speedup.toFixed(2)}× HIZLANMA → UYGULA` : speedup <= 0.95 ? `❌ ${speedup.toFixed(2)}× REGRESYON → UYGULAMA` : `⚖️ ${speedup.toFixed(2)}× nötr (±%15 içinde)`;
  console.log(`\n  KARAR: ${verdict}\n`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("❌ bench error:", e);
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
