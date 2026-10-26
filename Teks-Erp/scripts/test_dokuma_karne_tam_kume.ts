// =============================================================================
// DOKUMA KARNESİ TAM KÜME — seçilen aralık BÜTÜN tezgah × vardiya çiftlerini toplar (kesme yok)
// =============================================================================
// Perf-2 B1: eski toplayıcı ilk 500 çifti sayıyordu (toplam/Pareto kesilen kümeden) ve mühürsüz
// çift başına 7 sıralı SQL atıyordu. Bu bekçi ölçer:
//   §0 statik: toplayıcıda çift kesmesi (`slice`) ve çift başına `computeShiftTerms` YOK; toplu yol var
//   §1 toplu ≡ tekil: her açık çiftin toplu terimleri tekil `computeShiftTerms`le BİREBİR (sınır aşan
//      duruş/koşum, doff, iki vardiya) — kovalama hatası burada kırmızı
//   §2 kesme yok: `meta.total` = vardiya × tezgah; `toplam.rowCount` = total (sayfa küçük olsa da)
//   §3 sayfalama tutarlı: imleçle bütün sayfalar = tam küme (sıra aynı, tekrar yok); toplamlar her sayfada aynı
//   §4 Pareto tam aralıktan: Σ tekil kırılım = rapor toplamı
//   §5 bozuk imleç 400 INVALID_CURSOR (fail-closed); karne listesi ucu da sayfalı
// NEGATİF SONDA (2026-10-12): ① toplayıcıya `kept.slice(0, 5)` konunca §2/§3/§4 kırmızı ·
//   ② yükleyicide duruşlar tezgaha göre kovalanmayınca (`stops: stops`) §1b kırmızı. (Pencere kesişimi
//   düşürmek gözlenemez: saf helper pencereye kırpar — sonda bunu ölçtü, yeşil kaldı.)
// =============================================================================
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { MachineDataSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { collectShiftStatRows, computeShiftTerms, listShiftStats } from "../src/services/machine-shift-stat.service";
import { durusParetoReport, efficiencyReport } from "../src/services/reports/dokuma.report.service";
import { factoryDayKeyUtcMidnight, factoryYmd } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ek = Date.now().toString(36);
const ids = { station: "", m: [] as string[], defs: [] as string[], shifts: [] as string[] };
const H = 3600_000;

async function main(): Promise<void> {
  console.log("\n=== Dokuma karnesi TAM KÜME — kesme yok · toplu ≡ tekil · sayfalama ===\n");
  const KOK = join(__dirname, "..");
  const svc = readFileSync(join(KOK, "src/services/machine-shift-stat.service.ts"), "utf8");
  const collector = svc.slice(svc.indexOf("export async function collectShiftStatRows"), svc.indexOf("export const SHIFT_STAT_PAGE_SIZE"));
  check("§0a toplayıcıda çift kesmesi YOK (`slice` / `SHIFT_STAT_LIST_TAKE`)", collector.length > 0 && !/\.slice\(/.test(collector) && !/SHIFT_STAT_LIST_TAKE/.test(svc));
  check("§0b toplayıcı çift başına `computeShiftTerms(` çağırmaz; toplu `computeShiftTermsMany` var", !/computeShiftTerms\(/.test(collector) && /computeShiftTermsMany\(/.test(collector));
  check("§0c tekil yükleyici toplu yükleyiciden geçer (tek yükleyici)", /loadShiftTermsInputs\(tx, \[machineId\]/.test(svc));

  // ── fikstür: 4 tezgah × 3 gün × 2 vardiya; sınır aşan duruş/koşum, doff ─────
  const st = await prisma.station.create({ data: { name: `TEST-TK-IST-${ek}`, code: `TEST-TK-S-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
  ids.station = st.id;
  for (let n = 1; n <= 4; n++) ids.m.push((await prisma.machine.create({ data: { stationId: st.id, name: `TEST-TK-TEZ${n}-${ek}`, code: `TEST-TK-M${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } })).id);
  const d1 = await prisma.shiftDefinition.create({ data: { code: `TKA${ek}`.toUpperCase().slice(0, 8), name: `TEST-TK A ${ek}`, startMinute: 360, durationMinutes: 480, plannedBreakMinutes: 30 } });
  const d2 = await prisma.shiftDefinition.create({ data: { code: `TKB${ek}`.toUpperCase().slice(0, 8), name: `TEST-TK B ${ek}`, startMinute: 840, durationMinutes: 480 } });
  ids.defs = [d1.id, d2.id];
  const days = [0, 1, 2].map((i) => new Date(Date.UTC(1993, 6, 10 + i)));
  const shiftWins: Array<{ id: string; s: Date; e: Date }> = [];
  for (const day of days) {
    const a0 = new Date(day.getTime() + 3 * H), b0 = new Date(day.getTime() + 11 * H);
    const a = await prisma.shiftInstance.create({ data: { shiftDefinitionId: d1.id, factoryDayKey: day, startsAt: a0, endsAt: b0 } });
    const b = await prisma.shiftInstance.create({ data: { shiftDefinitionId: d2.id, factoryDayKey: day, startsAt: b0, endsAt: new Date(b0.getTime() + 8 * H) } });
    shiftWins.push({ id: a.id, s: a0, e: b0 }, { id: b.id, s: b0, e: new Date(b0.getTime() + 8 * H) });
  }
  ids.shifts = shiftWins.map((w) => w.id);
  const stop = (machineId: string, startedAt: Date, durSec: number, over: Record<string, unknown> = {}) => prisma.machineStopEvent.create({
    data: { machineId, stopKey: randomUUID(), factoryDay: factoryDayKeyUtcMidnight(startedAt), source: MachineDataSource.OPERATOR, startedAt, endedAt: new Date(startedAt.getTime() + durSec * 1000), durationSec: durSec, lossClass: "UNPLANNED", ...over },
  });
  for (const [i, m] of ids.m.entries()) {
    for (const [k, w] of shiftWins.entries()) {
      await stop(m, new Date(w.s.getTime() + (30 + i * 7 + k) * 60_000), 300 + i * 60 + k * 10);
      if ((i + k) % 3 === 0) await stop(m, new Date(w.s.getTime() + 2 * H), 12, { lossClass: "MINOR" });
    }
    // Vardiya sınırını AŞAN duruş (A → B) ve koşum (gün 1 boyunca)
    await stop(m, new Date(shiftWins[0]!.e.getTime() - 20 * 60_000), 2400 + i * 30, { lossClass: "SETUP" });
    if (i < 3) await prisma.machineRun.create({ data: { machineId: m, startedAt: new Date(shiftWins[0]!.s.getTime() + 10 * 60_000), endedAt: new Date(shiftWins[1]!.e.getTime() - 10 * 60_000), picksAtClose: 200_000 + i * 1000, targetUnitsPerMin: i === 2 ? null : 500, closedTermsAt: new Date() } });
    await prisma.doffEvent.create({ data: { machineId: m, doffedAt: new Date(shiftWins[2]!.s.getTime() + H), pieceCount: 1, counterSource: i % 2 ? MachineDataSource.MACHINE : MachineDataSource.OPERATOR, code: `TK${ek}${i}`.slice(0, 32) } });
  }
  const from = factoryYmd(new Date(days[0]!.getTime() + 12 * H));
  const to = factoryYmd(new Date(days[2]!.getTime() + 12 * H));
  const benim = (r: { machineId: string }) => ids.m.includes(r.machineId);
  const now = new Date();

  // ── §1 toplu ≡ tekil ─────────────────────────────────────────────────────
  const coll = await collectShiftStatRows({ from, to }, { now, includeBreakdown: true });
  const mine = coll.rows.filter(benim);
  check("§1a fikstür: 4 tezgah × 6 vardiya = 24 satır (hepsi canlı)", mine.length === 24 && mine.every((r) => r.live), String(mine.length));
  let esit = 0;
  const farklar: string[] = [];
  for (const r of mine) {
    const { warnings, emptyLoom, runCount: _r, lines: _l, breakdown, ...terms } = await computeShiftTerms(prisma, r.machineId, r.shiftInstanceId, { now });
    const same = JSON.stringify(terms) === JSON.stringify(r.terms) && JSON.stringify(breakdown) === JSON.stringify(r.breakdown) && JSON.stringify(warnings) === JSON.stringify(r.warnings) && emptyLoom === r.emptyLoom;
    if (same) esit++; else farklar.push(`${r.machine.code}/${r.shiftInstance.shiftDefinition.code}`);
  }
  check("§1b ⭐ her açık çiftin TOPLU terimleri tekil hesapla BİREBİR (terimler · kırılım · uyarı)", esit === 24, `${esit}/24 ${farklar.slice(0, 3).join(",")}`);
  const sinirA = mine.find((r) => r.machineId === ids.m[0] && r.shiftInstanceId === shiftWins[0]!.id)!;
  const sinirB = mine.find((r) => r.machineId === ids.m[0] && r.shiftInstanceId === shiftWins[1]!.id)!;
  check("§1c körlük zemini: sınır aşan duruş iki vardiyada da görünür (setup > 0 her ikisinde)", sinirA.terms.setupSec > 0 && sinirB.terms.setupSec > 0, `${sinirA.terms.setupSec}/${sinirB.terms.setupSec}`);

  // ── §2 kesme yok ─────────────────────────────────────────────────────────
  const looms = await prisma.machine.count({ where: { isActive: true, station: { kind: "WEAVING" } } });
  const r0 = await efficiencyReport({ from, to, limit: 5 });
  check("§2a ⭐ meta.total = vardiya × tezgah (tam küme), sayfa 5", r0.meta.total === coll.rows.length && r0.meta.total >= 24 && r0.satirlar.length === 5, `total=${r0.meta.total} beklenen=${coll.rows.length} (tezgah ${looms})`);
  check("§2b ⭐ toplam satır sayısı tam kümeden (sayfadan değil)", r0.toplam.rowCount === r0.meta.total && Object.values(r0.kaynakKirilimi).reduce((a, k) => a + k.satir, 0) === r0.meta.total);
  check("§2c truncated = sonraki sayfa var; nextCursor dolu", r0.meta.truncated === true && typeof r0.meta.nextCursor === "string");

  // ── §3 sayfalama ──────────────────────────────────────────────────────────
  const all: string[] = [];
  let cursor: string | undefined;
  let sayfa = 0;
  let toplamAyni = true;
  for (;;) {
    const r = await efficiencyReport({ from, to, limit: 7, ...(cursor ? { cursor } : {}) });
    sayfa++;
    all.push(...r.satirlar.map((x) => `${x.shiftInstanceId}|${x.machineId}`));
    if (JSON.stringify(r.toplam) !== JSON.stringify(r0.toplam) || r.meta.total !== r0.meta.total) toplamAyni = false;
    if (!r.meta.nextCursor || sayfa > 500) break;
    cursor = r.meta.nextCursor;
  }
  const full = coll.rows.map((x) => `${x.shiftInstanceId}|${x.machineId}`);
  check("§3a ⭐ bütün sayfalar = tam küme, aynı sıra, tekrar yok", JSON.stringify(all) === JSON.stringify(full) && new Set(all).size === all.length, `${all.length}/${full.length} · ${sayfa} sayfa`);
  check("§3b toplam ve meta her sayfada aynı (sayfadan bağımsız)", toplamAyni);
  const liste = await listShiftStats({ from, to, limit: 10 });
  const liste2 = liste.meta.nextCursor ? await listShiftStats({ from, to, limit: 10, cursor: liste.meta.nextCursor }) : null;
  check("§3c karne listesi ucu sayfalı: sayı tam kümeden, ikinci sayfa ilkinin devamı", liste.meta.total === coll.rows.length && liste.data.length === 10 && !!liste2 && liste2.data[0]?.shiftInstanceId + "|" + liste2.data[0]?.machineId === full[10]);

  // ── §4 Pareto tam aralıktan ───────────────────────────────────────────────
  const m2 = ids.m[1]!;
  let beklenen = 0;
  for (const w of shiftWins) beklenen += (await computeShiftTerms(prisma, m2, w.id, { now })).breakdown.reduce((a, b) => a + b.stopSec, 0);
  const p = await durusParetoReport({ from, to, machineId: m2 });
  check("§4 ⭐ Pareto toplamı = 6 vardiyanın Σ tekil kırılımı", p.toplam.stopSec === beklenen && beklenen > 0, `${p.toplam.stopSec} ↔ ${beklenen}`);

  // ── §5 bozuk imleç ────────────────────────────────────────────────────────
  let kod = "";
  try { await efficiencyReport({ from, to, cursor: "yok-boyle-imlec" }); } catch (e) { kod = String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message); }
  check("§5 tanınmayan imleç 400 INVALID_CURSOR (sessizce baştan başlamaz)", kod === "INVALID_CURSOR", kod);
}

async function cleanup(): Promise<void> {
  try {
    if (ids.m.length) {
      await prisma.doffEvent.deleteMany({ where: { machineId: { in: ids.m } } });
      await prisma.machineStopEvent.deleteMany({ where: { machineId: { in: ids.m } } });
      await prisma.machineRun.deleteMany({ where: { machineId: { in: ids.m } } });
    }
    if (ids.shifts.length) await prisma.shiftInstance.deleteMany({ where: { id: { in: ids.shifts } } });
    if (ids.defs.length) await prisma.shiftDefinition.deleteMany({ where: { id: { in: ids.defs } } });
    if (ids.m.length) await prisma.machine.deleteMany({ where: { id: { in: ids.m } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

main()
  .catch((e) => { fail++; console.error("❌ Bekçi hata ile durdu:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
