// =============================================================================
// BEKÇİ — Numara serisi önbellek tazelemesinin SORGU BÜTÇESİ (K3c, 2026-10-29)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_number_series_sorgu_butcesi.ts
//
// NEDEN: `activateDueLines` seri başına bir `findFirst` atıyordu (N+1); tazeleme arka planda her
// 60 sn koşar ve turları onu tetikleyen isteğin (production-flow) sorgu bütçesine dalgalı biçimde
// taşıyordu (K2a: CI ölçülen=92). Düzeltme tek okuma; bu bekçi onu SERİ SAYISINDAN bağımsız tutar.
//
// ÖLÇÜLENLER:
//   §1 `refreshNumberSeriesCache` sorgu sayısı +1 ve +10 fikstür seride EŞİT (sabit), körlük
//      zemini: seri sayısı gerçekten arttı, tazeleme sorgu atıyor
//   §2 test kancası `settleNumberSeriesRefresh`: önbellek boşken tetiklenen arka plan tazelemesi
//      beklendikten sonra açılan pencerede `number_series*` okuması 0 (kanban bekçisinin dayanağı)
// Negatif sonda (2026-10-29): `activateDueLines`e seri başına `findFirst` geri konunca §1 ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import {
  invalidateNumberSeriesCache,
  refreshNumberSeriesCache,
  resolveSeriesFormat,
  settleNumberSeriesRefresh,
} from "../src/services/number-series.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

// --- Sorgu sayacı: pg istemcisini sarmala (yalnız ölçüm penceresinde sayar) ---
const byTable = new Map<string, number>();
let total = 0;
let capture = false;
pool.on("connect", (client: unknown) => {
  const c = client as { query: (...a: unknown[]) => unknown };
  const orig = c.query.bind(c);
  c.query = (...args: unknown[]) => {
    if (capture) {
      const first = args[0] as string | { text?: string };
      const sql = typeof first === "string" ? first : (first?.text ?? "");
      total++;
      const m = sql.match(/FROM\s+"public"\."([A-Za-z_0-9]+)"/i) ?? sql.match(/FROM\s+"([A-Za-z_0-9]+)"/i);
      const t = m ? m[1] : "?";
      byTable.set(t, (byTable.get(t) ?? 0) + 1);
    }
    return orig(...args);
  };
});
async function measure(fn: () => Promise<void>): Promise<number> {
  byTable.clear();
  total = 0;
  capture = true;
  try { await fn(); } finally { capture = false; }
  return total;
}

const KEY = `TST_K3C_${randomUUID().slice(0, 8)}`;
const PAST = new Date("2020-01-01T00:00:00Z");

async function addSeries(from: number, count: number): Promise<void> {
  for (let i = from; i < from + count; i++) {
    // Satır vadesi geçmiş ama damgaya eşit: aktivasyon OLAYI doğmaz, yalnız okuma ölçülür.
    await prisma.numberSeries.create({
      data: {
        key: `${KEY}_${i}`, label: `TEST seri ${i}`, prefix: "TS", dateSegment: "NONE", formatChangedAt: PAST,
        lines: { create: [{ prefix: "TS", dateSegment: "NONE", effectiveFrom: PAST }] },
      },
    });
  }
}

async function main(): Promise<void> {
  console.log("=== Numara serisi tazeleme sorgu bütçesi (K3c) ===");
  await settleNumberSeriesRefresh();
  await refreshNumberSeriesCache(); // ısıtma

  console.log("\n── §1 sorgu sayısı seri sayısından bağımsız ──");
  const base = await prisma.numberSeries.count();
  await addSeries(0, 1);
  const q1 = await measure(refreshNumberSeriesCache);
  await addSeries(1, 9);
  const q10 = await measure(refreshNumberSeriesCache);
  const after = await prisma.numberSeries.count();
  check("körlük zemini: fikstürle seri sayısı 10 arttı", after - base === 10, `${base} → ${after}`);
  check("körlük zemini: tazeleme sorgu atıyor", q1 > 0, `q1=${q1}`);
  check("§1 tazeleme sorgu sayısı +1 ve +10 seride EŞİT (N+1 yok)", q1 === q10, `+1 seri=${q1} · +10 seri=${q10}`);

  console.log("\n── §2 arka plan tazelemesi test kancasıyla beklenir ──");
  invalidateNumberSeriesCache();
  resolveSeriesFormat("roll"); // önbellek boş → arka plan tazelemesi tetiklenir
  await settleNumberSeriesRefresh();
  await measure(async () => {
    for (let i = 0; i < 5; i++) resolveSeriesFormat("roll");
    await new Promise((r) => setTimeout(r, 50));
  });
  const seriesReads = (byTable.get("number_series") ?? 0) + (byTable.get("number_series_lines") ?? 0);
  check("§2 kancadan sonra açılan pencerede numara serisi okuması 0", seriesReads === 0, `sayı=${seriesReads}`);
}

async function cleanup(): Promise<void> {
  await prisma.numberSeries.deleteMany({ where: { key: { startsWith: KEY } } });
  await settleNumberSeriesRefresh();
  await refreshNumberSeriesCache();
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error("temizlik:", (e as Error).message); });
    const left = await prisma.numberSeries.count({ where: { key: { startsWith: KEY } } });
    check("temizlik: fikstür seri kalıntısı yok", left === 0, String(left));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
