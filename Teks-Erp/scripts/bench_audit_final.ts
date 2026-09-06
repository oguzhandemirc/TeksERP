// =============================================================================
// TeksERP — Audit özeti FİNAL A/B (Faz C2 çözüm doğrulaması)
// =============================================================================
// 3 senaryoyu AYNI veride ölçer, katkıları ayrıştırır (stats'ı toggle eder):
//   0) GERÇEK BASELINE  : 4 ardışık sorgu, ifade-stats YOK (mevcut production)
//   1) SADECE STATS     : 4 ardışık sorgu, sl_day_exact AKTİF (daily paralel hashagg)
//   2) FİNAL ÇÖZÜM      : getSystemLogSummary servisi (3 paralel + derive-total) + stats
// 0→1 = istatistik kazancı, 1→2 = kod kazancı, 0→2 = toplam.
//
// ⚠️ SADECE teks_loadtest. Veri seed'li olmalı (bench_audit_summary önce).
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { pool } from "../src/lib/prisma";
import { getSystemLogSummary } from "../src/services/reports/audit.report.service";
import type { DateRange } from "../src/services/reports/_shared";

if (!process.env.DATABASE_URL?.includes("teks_loadtest")) {
  console.error("❌ GÜVENLİK: DATABASE_URL teks_loadtest içermiyor.");
  process.exit(1);
}

const N = 25;
const range: DateRange = { from: new Date(Date.now() - 365 * 86_400_000), to: new Date() };

async function old4seq(r: DateRange): Promise<unknown> {
  const t = await prisma.$queryRaw(Prisma.sql`SELECT COUNT(*) AS total FROM system_logs WHERE "createdAt" >= ${r.from} AND "createdAt" <= ${r.to}`);
  const a = await prisma.$queryRaw(Prisma.sql`SELECT action, COUNT(*) AS count FROM system_logs WHERE "createdAt" >= ${r.from} AND "createdAt" <= ${r.to} GROUP BY action ORDER BY count DESC`);
  const b = await prisma.$queryRaw(Prisma.sql`SELECT "tableName", COUNT(*) AS count FROM system_logs WHERE "createdAt" >= ${r.from} AND "createdAt" <= ${r.to} GROUP BY "tableName" ORDER BY count DESC LIMIT 30`);
  // Faz C2 bench'i 2026-08-01 tz dönüşümü ÖNCESİNİN sorgu şeklini DONMUŞ taşır;
  // `factoryDaySql`e çevirmek ölçtüğü şeyi değiştirir (kayıtlı sayılar geçersizleşir).
  // eslint-disable-next-line no-restricted-syntax
  const d = await prisma.$queryRaw(Prisma.sql`SELECT DATE_TRUNC('day',"createdAt")::date AS day, COUNT(*) FILTER (WHERE action='CREATE') AS c, COUNT(*) FILTER (WHERE action='UPDATE') AS u, COUNT(*) FILTER (WHERE action='DELETE') AS dd FROM system_logs WHERE "createdAt" >= ${r.from} AND "createdAt" <= ${r.to} GROUP BY 1 ORDER BY 1`);
  return [t, a, b, d];
}

function pct(s: number[], p: number): number { return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; }
async function bench(label: string, fn: () => Promise<unknown>): Promise<{ p50: number; min: number; p95: number }> {
  for (let i = 0; i < 5; i++) await fn().catch(() => {});
  const s: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    s.push(Number(process.hrtime.bigint() - t0) / 1_000_000);
  }
  s.sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 100) / 100;
  const out = { p50: r(pct(s, 50)), min: r(s[0]), p95: r(pct(s, 95)) };
  console.log(`  ${label.padEnd(44)} p50=${String(out.p50).padStart(8)}ms  min=${String(out.min).padStart(8)}ms  p95=${String(out.p95).padStart(8)}ms`);
  return out;
}

async function setStats(on: boolean): Promise<void> {
  if (on) {
    // Bench, istatistiği 20260801050000 ÖNCESİNİN ifadesiyle kurar — A/B'nin
    // ölçtüğü tam olarak o eski plan. Canlı tanım migration'da, burada değil.
    // eslint-disable-next-line no-restricted-syntax
    await prisma.$executeRawUnsafe(`CREATE STATISTICS IF NOT EXISTS sl_day_exact ON ((DATE_TRUNC('day', "createdAt")::date)) FROM system_logs`);
  } else {
    await prisma.$executeRawUnsafe(`DROP STATISTICS IF EXISTS sl_day_exact`);
  }
  await prisma.$executeRawUnsafe(`ANALYZE system_logs`);
}

async function main(): Promise<void> {
  console.log("\n=== AUDIT ÖZETİ — FİNAL A/B (teks_loadtest, 365-gün worst-case) ===\n");

  console.log("--- 0) GERÇEK BASELINE: 4 ardışık, stats YOK ---");
  await setStats(false);
  const s0 = await bench("0) 4seq, stats yok", () => old4seq(range));

  console.log("\n--- 1) SADECE STATS: 4 ardışık, sl_day_exact aktif ---");
  await setStats(true);
  const s1 = await bench("1) 4seq + stats", () => old4seq(range));

  console.log("\n--- 2) FİNAL: servis (3 paralel + derive-total) + stats ---");
  const s2 = await bench("2) getSystemLogSummary (final)", () => getSystemLogSummary(range));

  const r = (a: number, b: number) => (a / b).toFixed(2);
  console.log("\n  ┌── KATKI AYRIŞTIRMASI (p50 / min) ─────────────────────────────┐");
  console.log(`  │ 0 baseline           ${String(s0.p50).padStart(7)}ms / ${String(s0.min).padStart(7)}ms                      │`);
  console.log(`  │ 1 +stats             ${String(s1.p50).padStart(7)}ms / ${String(s1.min).padStart(7)}ms   (0→1: ${r(s0.p50, s1.p50)}× / ${r(s0.min, s1.min)}×) │`);
  console.log(`  │ 2 +kod (final)       ${String(s2.p50).padStart(7)}ms / ${String(s2.min).padStart(7)}ms   (1→2: ${r(s1.p50, s2.p50)}× / ${r(s1.min, s2.min)}×) │`);
  console.log(`  │ TOPLAM 0→2: ${r(s0.p50, s2.p50)}× (p50) / ${r(s0.min, s2.min)}× (min)                       │`);
  console.log("  └───────────────────────────────────────────────────────────────┘");

  // stats kalsın (migration bunu kalıcı yapacak).
  await setStats(true);
  await prisma.$disconnect();
  await pool.end();
}
main().catch(async (e) => {
  console.error("❌ final bench error:", e);
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
