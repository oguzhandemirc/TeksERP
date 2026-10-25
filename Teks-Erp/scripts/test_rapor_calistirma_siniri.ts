// =============================================================================
// RAPOR ÇALIŞTIRMA SINIRI — semafor 429 · statement_timeout 503 · iptal → pg_cancel_backend
// =============================================================================
// Raporlar v2 R1-SEMCEK (plan §3.4, risk 3): backend TEK process'tir; ağır semantik sorgu onu
// kilitleyemez. Ölçülenler: kullanıcı başına 2 / kurulum başına 4 koşu (fazlası 429
// `RAPOR_SIRADA`), blok tx'i READ ONLY + `statement_timeout` (ayar 5..45, varsayılan 15) +
// `lock_timeout` 2 sn, 57014 → 503 `RAPOR_ZAMAN_ASIMI` + `ReportRun` ZAMAN_ASIMI, iptal ucu →
// durum IPTAL + sorgu gerçekten durur (pg_stat_activity), başkasının koşusu 404, önbellek izin
// özetine bağlı. Sentetik küpler `pg_sleep` ile yavaş sorgu üretir (gerçek kayıt değişmez).
//
// NEGATİF SONDA (2026-10-24): `ReportSemaphore.tryAcquire` sınır denetimi kaldırıldı
// (her zaman yer var) → 4 ❌ (§1a §1b §1c §2 429); md5 ile birebir geri alındı, 15/0.
//
// Koşum: npx tsx scripts/test_rapor_calistirma_siniri.ts
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { AppError } from "../src/utils/app-error";
import { semanticQuerySchema } from "../src/services/reports/semantik/derleyici";
import { abortDisconnectedRun, cancelRun, runSemanticQuery, type RunDeps } from "../src/services/reports/semantik/calistirici";
import { ResultCache } from "../src/services/reports/semantik/onbellek";
import { ReportSemaphore } from "../src/services/reports/semantik/semafor";
import type { AccessContext } from "../src/services/reports/semantik/izin";
import type { SemanticCube } from "../src/services/reports/semantik/tipler";
import { DEFAULT_REPORTS_STATEMENT_TIMEOUT_SEC, readReportsStatementTimeoutSec } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TAG = `TRC-${Date.now()}`;
const users: string[] = [];

function sleepCube(seconds: number): SemanticCube {
  return {
    id: "uyku", name: "Uyku", permission: "report:sales", module: "cekirdek:siparis-musteri",
    source: () => Prisma.sql`(SELECT now() AS at, 1::float AS qty FROM pg_sleep(${seconds}::float)) p`,
    timeColumn: "p.at",
    measures: [{ id: "uyku.adet", permission: "report:sales", module: "cekirdek:siparis-musteri", kind: "sum", sql: Prisma.sql`SUM(p.qty)`, parity: { exempt: "bekçi sentetik küpü — gerçek kayıtta yok" } }],
    dimensions: [],
  };
}

/** Oturum ayarlarını ölçü olarak okuyan küp: READ ONLY · statement_timeout · lock_timeout. */
const settingsCube: SemanticCube = {
  id: "ayar", name: "Ayar", permission: "report:sales", module: "cekirdek:siparis-musteri",
  source: () => Prisma.sql`(SELECT now() AS at,
      (current_setting('transaction_read_only') = 'on')::int::float AS ro,
      EXTRACT(EPOCH FROM current_setting('statement_timeout')::interval)::float AS st,
      EXTRACT(EPOCH FROM current_setting('lock_timeout')::interval)::float AS lt) p`,
  timeColumn: "p.at",
  measures: (["ro", "st", "lt"] as const).map((c) => ({
    id: `ayar.${c}`, permission: "report:sales", module: "cekirdek:siparis-musteri", kind: "sum" as const,
    sql: Prisma.sql`MAX(${Prisma.raw(`p.${c}`)})`, parity: { exempt: "bekçi sentetik küpü — gerçek kayıtta yok" },
  })),
  dimensions: [],
};

const deps = (cubes: SemanticCube[], timeoutSec = 15, semaphore = new ReportSemaphore()): RunDeps => ({
  cubes, semaphore, cache: new ResultCache(), readTimeoutSec: async () => timeoutSec,
});
const input = (kup: string, olculer: string[], extra: Record<string, unknown> = {}) =>
  semanticQuerySchema.parse({ kup, olculer, ...extra });

async function codeOf(p: Promise<unknown>): Promise<{ status: number; code?: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof AppError) return { status: e.statusCode, code: (e.details as { code?: string } | undefined)?.code };
    return { status: 500, code: String((e as Error).message).slice(0, 120) };
  }
}

async function waitForPid(runId: string): Promise<number | null> {
  for (let i = 0; i < 100; i++) {
    const r = await prisma.reportRun.findUnique({ where: { id: runId }, select: { backendPid: true } });
    if (r?.backendPid) return r.backendPid;
    await new Promise((res) => setTimeout(res, 50));
  }
  return null;
}

async function main(): Promise<void> {
  console.log("\n=== Rapor çalıştırma sınırı ===\n");
  for (const k of ["a", "b"]) {
    const u = await prisma.user.create({ data: { username: `${TAG}-${k}`.toLowerCase(), passwordHash: "x", fullName: `${TAG} ${k}` }, select: { id: true } });
    users.push(u.id);
  }
  const ctxA: AccessContext = { userId: users[0]!, permissions: ["report:sales"], openModuleKeys: new Set() };
  const ctxB: AccessContext = { userId: users[1]!, permissions: ["report:sales"], openModuleKeys: new Set() };

  // §1 semafor birimi
  const sem = new ReportSemaphore();
  const a1 = sem.tryAcquire("u1");
  const a2 = sem.tryAcquire("u1");
  const a3 = sem.tryAcquire("u1");
  const b1 = sem.tryAcquire("u2");
  const b2 = sem.tryAcquire("u2");
  const c1 = sem.tryAcquire("u3");
  check("§1a kullanıcı başına 2 (üçüncüsü yok)", a1 !== null && a2 !== null && a3 === null);
  check("§1b kurulum başına 4 (beşincisi yok)", b1 !== null && b2 !== null && c1 === null, JSON.stringify(sem.inUse()));
  a1!();
  a1!();
  check("§1c bırakma tek kullanımlık (çift çağrı sayacı bozmaz)", sem.inUse().total === 3 && sem.tryAcquire("u3") !== null);

  // §2 dolu semaforda koşu 429
  const full = new ReportSemaphore();
  full.tryAcquire(ctxA.userId);
  full.tryAcquire(ctxA.userId);
  const busy = await codeOf(runSemanticQuery(input("ayar", ["ayar.ro"]), ctxA, undefined, deps([settingsCube], 15, full)));
  check("§2 ⭐ sınır doluyken 429 RAPOR_SIRADA", busy?.status === 429 && busy.code === "RAPOR_SIRADA", JSON.stringify(busy));

  // §3 blok tx'inin oturum ayarları
  const s = await runSemanticQuery(input("ayar", ["ayar.ro", "ayar.st", "ayar.lt"]), ctxA, undefined, deps([settingsCube], 7));
  check("§3 ⭐ blok tx'i READ ONLY · statement_timeout = ayar (7 sn) · lock_timeout 2 sn",
    s.toplam.degerler["ayar.ro"] === 1 && s.toplam.degerler["ayar.st"] === 7 && s.toplam.degerler["ayar.lt"] === 2, JSON.stringify(s.toplam.degerler));

  // §4 ayar okuyucusu: 5..45 dışı → 15
  const stub = (v: unknown) => ({ systemSetting: { findUnique: async () => (v === undefined ? null : { value: v }) } }) as never;
  const reads = [await readReportsStatementTimeoutSec(stub(undefined)), await readReportsStatementTimeoutSec(stub(3)), await readReportsStatementTimeoutSec(stub(99)), await readReportsStatementTimeoutSec(stub(7.5)), await readReportsStatementTimeoutSec(stub(30))];
  check("§4 `reports.statementTimeoutSec` okuyucusu: yok/3/99/7,5 → 15 · 30 → 30", JSON.stringify(reads) === JSON.stringify([15, 15, 15, 15, 30]) && DEFAULT_REPORTS_STATEMENT_TIMEOUT_SEC === 15, JSON.stringify(reads));

  // §5 zaman aşımı → 503 + ZAMAN_ASIMI
  const timeoutRun = "00000000-0000-4000-8000-" + String(Date.now()).slice(-12).padStart(12, "0");
  const t0 = Date.now();
  const to = await codeOf(runSemanticQuery(input("uyku", ["uyku.adet"], { kosuId: timeoutRun }), ctxA, timeoutRun, deps([sleepCube(30)], 5)));
  const toMs = Date.now() - t0;
  const toRow = await prisma.reportRun.findUnique({ where: { id: timeoutRun }, select: { status: true, errorCode: true, backendPid: true } });
  check("§5 ⭐ 57014 → 503 RAPOR_ZAMAN_ASIMI, ~5 sn'de (30 sn uyku kesildi)", to?.status === 503 && to.code === "RAPOR_ZAMAN_ASIMI" && toMs < 9000, `${JSON.stringify(to)} ${toMs} ms`);
  check("§5b koşu satırı ZAMAN_ASIMI · 57014 · pid yazılı", toRow?.status === "ZAMAN_ASIMI" && toRow.errorCode === "57014" && (toRow.backendPid ?? 0) > 0, JSON.stringify(toRow));

  // §6 iptal ucu → durum IPTAL + sorgu gerçekten durur
  const cancelId = "00000000-0000-4000-9000-" + String(Date.now()).slice(-12).padStart(12, "0");
  const t1 = Date.now();
  const pending = codeOf(runSemanticQuery(input("uyku", ["uyku.adet"]), ctxA, cancelId, deps([sleepCube(30)], 45)));
  const pid = await waitForPid(cancelId);
  await new Promise((r) => setTimeout(r, 300));
  const foreign = await codeOf(cancelRun(cancelId, ctxB));
  check("§6a başkasının koşusu iptal edilemez → 404 (varlık sızmaz)", foreign?.status === 404 && foreign.code === "RAPOR_KOSU_YOK", JSON.stringify(foreign));
  const res = await cancelRun(cancelId, ctxA);
  const outcome = await pending;
  const cMs = Date.now() - t1;
  const live = pid ? await prisma.$queryRaw<Array<{ n: bigint; st: string | null }>>`SELECT count(*) AS n, string_agg(state || ':' || left(query, 60), ' | ') AS st FROM pg_stat_activity WHERE pid = ${pid}::int AND pid <> pg_backend_pid() AND query ILIKE '%pg_sleep%' AND state = 'active'` : [{ n: 1n, st: null }];
  const cRow = await prisma.reportRun.findUnique({ where: { id: cancelId }, select: { status: true } });
  check("§6b ⭐ iptal → pg_cancel_backend: sorgu 30 sn beklemeden durdu", res.durum === "IPTAL" && cMs < 8000 && Number(live[0]!.n) === 0, `${cMs} ms · pid ${pid} · ${live[0]!.st}`);
  check("§6c iptal edilen koşu 409 RAPOR_IPTAL döner, satır IPTAL", outcome?.status === 409 && outcome.code === "RAPOR_IPTAL" && cRow?.status === "IPTAL", `${JSON.stringify(outcome)} ${cRow?.status}`);
  const again = await codeOf(cancelRun(cancelId, ctxA));
  check("§6d bitmiş koşuyu yeniden iptal → 409 RAPOR_KOSU_BITTI (atomik claim)", again?.status === 409 && again.code === "RAPOR_KOSU_BITTI", JSON.stringify(again));

  // §7 bağlantı kopması → aynı yol
  const dropId = "00000000-0000-4000-a000-" + String(Date.now()).slice(-12).padStart(12, "0");
  const t2 = Date.now();
  const dropped = codeOf(runSemanticQuery(input("uyku", ["uyku.adet"]), ctxA, dropId, deps([sleepCube(30)], 45)));
  await waitForPid(dropId);
  await new Promise((r) => setTimeout(r, 300));
  await abortDisconnectedRun(dropId, ctxA.userId);
  const dOut = await dropped;
  const dRow = await prisma.reportRun.findUnique({ where: { id: dropId }, select: { status: true } });
  check("§7 istemci koptu → koşu durur, satır IPTAL", dOut?.code === "RAPOR_IPTAL" && dRow?.status === "IPTAL" && Date.now() - t2 < 8000, `${JSON.stringify(dOut)} ${dRow?.status}`);

  // §8 önbellek: izin özetine bağlı, "Yenile" atlar
  const d8 = deps([settingsCube], 7);
  const first = await runSemanticQuery(input("ayar", ["ayar.ro"]), ctxA, undefined, d8);
  const second = await runSemanticQuery(input("ayar", ["ayar.ro"]), ctxA, undefined, d8);
  const refresh = await runSemanticQuery(input("ayar", ["ayar.ro"], { yenile: true }), ctxA, undefined, d8);
  const otherPerms = await runSemanticQuery(input("ayar", ["ayar.ro"]), { ...ctxA, permissions: ["report:sales", "report:finance"] }, undefined, d8);
  check("§8 önbellek: ikinci okuma isabet · Yenile atlar · farklı izin kümesi paylaşmaz",
    !first.onbellek.isabet && second.onbellek.isabet && !refresh.onbellek.isabet && !otherPerms.onbellek.isabet);
  check("§8b önbellek isabeti koşu satırı yazmaz (kosuId null)", second.kosuId === null);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    if (users.length) {
      await prisma.reportRun.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
