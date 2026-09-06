// =============================================================================
// TeksERP — Audit özeti PARALELLİK izolasyon probu (Faz C2)
// =============================================================================
// Soru: getSystemLogSummary'nin 4 alt-sorgusu havuzlu base client'ta Promise.all
// ile GERÇEKTEN paralel mi koşuyor, yoksa serileşiyor mu? + her alt-sorgunun
// payı nedir? Bench'in 1.07× nötr sonucu gürültü mü, yapısal mı?
//
// ⚠️ SADECE teks_loadtest. Veri zaten seed'li olmalı (bench_audit_summary önce).
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { pool } from "../src/lib/prisma";

if (!process.env.DATABASE_URL?.includes("teks_loadtest")) {
  console.error("❌ GÜVENLİK: DATABASE_URL teks_loadtest içermiyor.");
  process.exit(1);
}

const N = 30;
const from = new Date(Date.now() - 365 * 86_400_000);
const to = new Date();

const qTotal = () => prisma.$queryRaw(Prisma.sql`
  SELECT COUNT(*) AS total FROM system_logs WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}`);
const qAction = () => prisma.$queryRaw(Prisma.sql`
  SELECT action, COUNT(*) AS count FROM system_logs WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
  GROUP BY action ORDER BY count DESC`);
const qTable = () => prisma.$queryRaw(Prisma.sql`
  SELECT "tableName", COUNT(*) AS count FROM system_logs WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
  GROUP BY "tableName" ORDER BY count DESC LIMIT 30`);
// Faz C2 bench'i 2026-08-01 tz dönüşümü ÖNCESİNİN sorgu şeklini DONMUŞ taşır;
// `factoryDaySql`e çevirmek ölçtüğü şeyi değiştirir (kayıtlı sayılar geçersizleşir).
/* eslint-disable no-restricted-syntax */
const qDaily = () => prisma.$queryRaw(Prisma.sql`
  SELECT DATE_TRUNC('day', "createdAt")::date AS day,
    COUNT(*) FILTER (WHERE action = 'CREATE') AS "createCount",
    COUNT(*) FILTER (WHERE action = 'UPDATE') AS "updateCount",
    COUNT(*) FILTER (WHERE action = 'DELETE') AS "deleteCount"
  FROM system_logs WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
  GROUP BY 1 ORDER BY 1`);
/* eslint-enable no-restricted-syntax */

function pct(s: number[], p: number): number {
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
async function bench(label: string, fn: () => Promise<unknown>, warm = 4): Promise<number> {
  for (let i = 0; i < warm; i++) await fn().catch(() => {});
  const s: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    s.push(Number(process.hrtime.bigint() - t0) / 1_000_000);
  }
  s.sort((a, b) => a - b);
  const p50 = Math.round(pct(s, 50) * 100) / 100;
  const p95 = Math.round(pct(s, 95) * 100) / 100;
  const mn = Math.round(s[0] * 100) / 100;
  console.log(`  ${label.padEnd(40)} p50=${String(p50).padStart(8)}ms p95=${String(p95).padStart(8)}ms min=${String(mn).padStart(8)}ms`);
  return p50;
}

async function main(): Promise<void> {
  console.log("\n=== PARALELLİK İZOLASYON PROBU (teks_loadtest) ===\n");
  console.log("--- 1) Tek alt-sorgu maliyetleri (sıralı, ayrı ayrı) ---");
  const pT = await bench("total (COUNT)", qTotal);
  const pA = await bench("byAction (GROUP BY action)", qAction);
  const pB = await bench("byTable (GROUP BY tableName LIMIT 30)", qTable);
  const pD = await bench("daily (GROUP BY day + 3 FILTER)", qDaily);
  console.log(`  → tek-sorgu p50 toplamı (total+A+B+D) = ${(pT + pA + pB + pD).toFixed(1)}ms`);
  console.log(`  → derive-total sonrası (A+B+D)        = ${(pA + pB + pD).toFixed(1)}ms`);

  console.log("\n--- 2) PARALELLİK TESTİ: aynı sorgu (byAction) ×3 ---");
  const seq3 = await bench("3× byAction ARDIŞIK (await sırayla)", async () => {
    await qAction(); await qAction(); await qAction();
  });
  const par3 = await bench("3× byAction PARALEL (Promise.all)", async () => {
    await Promise.all([qAction(), qAction(), qAction()]);
  });
  const eff = seq3 / par3;
  console.log(`  → paralellik etkinliği = ardışık/paralel = ${eff.toFixed(2)}×  (1.0=paralellik YOK, 3.0=mükemmel)`);
  console.log(`  → tek byAction p50=${pA}ms; ideal-paralel ≈ ${pA}ms, gerçek-paralel=${par3}ms`);

  console.log("\n--- 3) GERÇEK ŞEKİL (stats AKTİF): 3 aday ---");
  const oldShape = await bench("ESKİ: total→A→B→D ardışık (4 sorgu)", async () => {
    await qTotal(); await qAction(); await qTable(); await qDaily();
  });
  const seqShape = await bench("YENİ-seq: A→B→D ardışık (derive-total)", async () => {
    await qAction(); await qTable(); await qDaily();
  });
  const parShape = await bench("YENİ-par: [A,B,D] Promise.all", async () => {
    await Promise.all([qAction(), qTable(), qDaily()]);
  });
  const fmt = (base: number, x: number) => `${(base / x).toFixed(2)}× ${base / x >= 1.15 ? "✅" : base / x <= 0.95 ? "❌" : "⚖️"}`;
  console.log(`\n  ESKİ(4seq) ${oldShape}ms`);
  console.log(`  YENİ-seq(3,derive) ${seqShape}ms → ESKİ'ye göre ${fmt(oldShape, seqShape)}`);
  console.log(`  YENİ-par(3,paralel) ${parShape}ms → ESKİ'ye göre ${fmt(oldShape, parShape)} | seq'e göre ${fmt(seqShape, parShape)}`);

  await prisma.$disconnect();
  await pool.end();
}
main().catch(async (e) => {
  console.error("❌ probe error:", e);
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
