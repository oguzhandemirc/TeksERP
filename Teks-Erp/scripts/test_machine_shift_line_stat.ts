// =============================================================================
// Vardiya karnesi HAT KIRILIMI bekçisi — `MachineShiftLineStat` (eklemeli çocuk, veri tetikli)
// =============================================================================
// Koşum: npx tsx scripts/test_machine_shift_line_stat.ts   (DB'li; TEST- fikstürü; `dokuma.enabled` geçici)
//
// Ölçer (DOKUMA-RAPOR-BACKEND-TASARIM-OZETI §1/1 hükmü: ebeveyn unique BÖLÜNMEZ, hat kırılımı çocuk tablo):
//   §0 statik — ebeveyn unique aynen; çocuk `@@unique([statId, productionLineNo])`; migration DOLU şemada
//      ikinci koşumda sessiz (idempotent); src'de çocuk tabloya delete YOK; `byLine` Zod enum (fail-closed)
//   §1 saf helper — count 1 → `lines: []` (bugünkü davranış); count 2 → hat başına üretim, Σhat = makine;
//      koşumsuz hat runCount 0 / P ölçülemez; kümenin dışındaki hattın koşumu KAYBOLMAZ; boş/iptal vardiyada
//      hatlar sıfırla doğar; süre terimleri hatta YOK (ebeveynde)
//   §2 M2 — tek hatlı makinede çocuk satır DOĞMAZ; çift hatlıda `productionLineCount` kadar satır, upsert
//      (ikinci koşum satır çoğaltmaz, değeri tazeler); kapalı bayrakta hiçbir şey yazılmaz
//   §3 mühür — Seal `terms.lines` fotoğrafı; mühürlüde `byLine` ÇOCUK TABLODAN okur (koşum değişse
//      donmuş), açıkta anlık; mühürlü satırın hat satırı M2'de dokunulmaz
//   §4 raporlar — `byLine` yoksa `hatlar`/`lines` alanı HİÇ YOK (bayt bayt eski); varsa randıman +
//      vardiya karnesi + M1 listesi hat satırlarını taşır; hat P/E'si hattın, A'sı ebeveynin
//   §5 M3 — elle düzeltme hatlara dokunmaz; Σhat ≠ karne olunca `byLine` okuması UYARIR
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-09-15):
//   · `lineTerms`teki `productionLineCount <= 1` kapısı düşürülünce §1a + §2a ❌ (tek hatlıya satır doğar)
//   · `materializeShiftStatTx`ten `upsertLineStatsTx` çağrıları düşürülünce §2b/§2c/§3 ❌
//   · mühürlü dalda `storedLineRows` yerine anlık hesap konunca §3c ❌ (donmuşluk kaybolur)
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { computeShiftTermsPure, type ShiftTermsInput } from "../src/services/helpers/loom-shift-terms.helper";
import { MINOR_STOP_THRESHOLD_SEC } from "../src/constants/loom-shift";
import { listShiftStats } from "../src/services/machine-shift-stat.service";
import { correctShiftTerms, sealShiftStat, unsealShiftStat } from "../src/services/machine-shift-seal.service";
import { efficiencyReport, shiftScorecardReport } from "../src/services/reports/dokuma.report.service";
import { runShiftCloseOnce } from "../src/jobs/machine-shift-close.job";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const FLAG_KEY = "dokuma.enabled";
let originalFlag: unknown = undefined;
let flagTouched = false;
async function setFlag(value: boolean): Promise<void> {
  if (!flagTouched) {
    const row = await prisma.systemSetting.findUnique({ where: { key: FLAG_KEY } });
    originalFlag = row ? row.value : undefined;
    flagTouched = true;
  }
  await prisma.systemSetting.upsert({ where: { key: FLAG_KEY }, create: { key: FLAG_KEY, value, description: "Dokuma (bekçi geçici)" }, update: { value } });
}

const ek = Date.now().toString(36);
const ids = { station: "", m1: "", m2: "", def: "", shift: "", stats: [] as string[] };
const KOK = join(__dirname, "..");
const MIG = "20260915010000_machine_shift_line_stats";

// ── §1 saf helper fikstürü ──────────────────────────────────────────────────
const T = (s: string) => new Date(s);
const W0 = T("2026-04-05T00:00:00.000Z"), W1 = T("2026-04-05T08:00:00.000Z"), NOW = T("2026-04-05T09:00:00.000Z");
const base = (productionLineCount: number): ShiftTermsInput => ({
  window: { startsAt: W0, endsAt: W1, isCancelled: false, plannedBreakMinutes: 0 },
  stops: [], runs: [], doffSources: [], spec: null, productionLineCount, now: NOW, stopThresholdSec: MINOR_STOP_THRESHOLD_SEC,
});
let seq = 0;
const run = (line: number, picks: number | null, target: number | null = 600) => ({
  id: `r${++seq}`, startedAt: W0, endedAt: T("2026-04-05T07:59:59.000Z"), picksAtClose: picks, producedM: null, targetUnitsPerMin: target, unitsPerCm: null, productionLineNo: line,
});

function safHelper(): void {
  console.log("── §1 saf helper ──");
  const tek = computeShiftTermsPure({ ...base(1), runs: [run(1, 1000)] });
  check("§1a ⭐ count 1 → `lines` BOŞ (bugünkü davranış; hat boyutu doğmaz)", tek.lines.length === 0 && tek.unitsActual === 1000);
  const cift = computeShiftTermsPure({ ...base(2), runs: [run(1, 100_000, 500), run(2, 60_000, 400)] });
  const [h1, h2] = cift.lines;
  check("§1b count 2 → iki hat, sıralı", cift.lines.length === 2 && h1?.productionLineNo === 1 && h2?.productionLineNo === 2);
  check("§1c ⭐ Σhat atkı = makine atkısı (100000 + 60000)", h1!.unitsActual === 100_000 && h2!.unitsActual === 60_000 && h1!.unitsActual + h2!.unitsActual === cift.unitsActual);
  const capSum = h1!.targetUnitCapacityApt + h2!.targetUnitCapacityApt;
  // Koşum 07:59:59'da kapanır → pencere payı 28 799 sn; hat 1 kapasitesi 500 × 28799 / 60.
  check("§1d Σhat kapasite = makine kapasitesi (yuvarlama payı ≤ hat sayısı); hat 1 = 500×28799/60", Math.abs(capSum - cift.targetUnitCapacityApt) <= 2 && h1!.targetUnitCapacityApt === Math.round((500 * 28_799) / 60), `${capSum} ↔ ${cift.targetUnitCapacityApt}`);
  check("§1e hat hedefi tek koşumdan (500 / 400); makine hedefi NULL (iki farklı hedef)", h1!.targetUnitsPerMin === 500 && h2!.targetUnitsPerMin === 400 && cift.targetUnitsPerMin === null);
  const yalniz1 = computeShiftTermsPure({ ...base(2), runs: [run(1, 1000)] });
  check("§1f koşumsuz hat 2: satır VAR, runCount 0, kapasite 0 (P ölçülemez — uydurulmaz)", yalniz1.lines.length === 2 && yalniz1.lines[1]!.runCount === 0 && yalniz1.lines[1]!.unitsActual === 0 && yalniz1.lines[1]!.targetUnitCapacityApt === 0);
  const disHat = computeShiftTermsPure({ ...base(2), runs: [run(1, 10), run(3, 20)] });
  check("§1g ⭐ count dışındaki hattın koşumu KAYBOLMAZ (hat 3 eklenir; Σhat = makine)", disHat.lines.length === 3 && disHat.lines[2]!.productionLineNo === 3 && disHat.lines[2]!.unitsActual === 20 && disHat.lines.reduce((a, l) => a + l.unitsActual, 0) === disHat.unitsActual);
  const bos = computeShiftTermsPure(base(2));
  check("§1h boş tezgahta hatlar sıfırla doğar (count kadar)", bos.emptyLoom && bos.lines.length === 2 && bos.lines.every((l) => l.runCount === 0 && l.unitsActual === 0));
  const iptal = computeShiftTermsPure({ ...base(2), window: { ...base(2).window, isCancelled: true }, runs: [run(1, 5)] });
  check("§1i iptal vardiyada hatlar sıfır", iptal.lines.length === 2 && iptal.lines.every((l) => l.unitsActual === 0));
  check("§1j hat satırında SÜRE terimi yok (potSec/aptSec ebeveynde)", !("potSec" in h1!) && !("aptSec" in h1!));
  const sayacsiz = computeShiftTermsPure({ ...base(2), runs: [run(1, null), run(2, 7)] });
  check("§1k sayaçsız kapanış hatta da 0 DEĞİL ölçülmedi (uyarı var, hat 1 atkı 0, hat 2 7)", sayacsiz.lines[0]!.unitsActual === 0 && sayacsiz.lines[1]!.unitsActual === 7 && sayacsiz.warnings.some((w) => /sayacı okunmadı/.test(w)));
}

async function statik(): Promise<void> {
  console.log("── §0 statik ──");
  const sema = readFileSync(join(KOK, "prisma/schema.prisma"), "utf8");
  const ebeveyn = /model MachineShiftStat \{[\s\S]*?\n\}/.exec(sema)?.[0] ?? "";
  check("§0a ebeveyn unique BÖLÜNMEDİ: `@@unique([machineId, shiftInstanceId])`, `productionLineNo` yok", /@@unique\(\[machineId, shiftInstanceId\]\)/.test(ebeveyn) && !/productionLineNo/.test(ebeveyn));
  const cocuk = /model MachineShiftLineStat \{[\s\S]*?\n\}/.exec(sema)?.[0] ?? "";
  check("§0b çocuk `@@unique([statId, productionLineNo])` + Restrict FK + updatedAt (DURUM)", /@@unique\(\[statId, productionLineNo\]\)/.test(cocuk) && /onDelete: Restrict/.test(cocuk) && /updatedAt/.test(cocuk));
  const sql = readFileSync(join(KOK, "prisma/migrations", MIG, "migration.sql"), "utf8");
  let ikinci = "ok";
  try { await pool.query(sql); } catch (e) { ikinci = (e as Error).message; }
  check("§0c ⭐ migration DOLU şemada ikinci koşumda sessiz (idempotent)", ikinci === "ok", ikinci);
  check("§0d migration ADDITIVE: ALTER/DROP başka tabloya yok", !/ALTER TABLE "(?!machine_shift_line_stats")/.test(sql) && !/DROP /.test(sql));
  const seal = readFileSync(join(KOK, "src/services/machine-shift-seal.service.ts"), "utf8");
  const stat = readFileSync(join(KOK, "src/services/machine-shift-stat.service.ts"), "utf8");
  check("§0e src'de çocuk tabloya delete/deleteMany YOK (silme yok; küme dışı satır sıfır kalır)", !/machineShiftLineStat\.(delete|deleteMany)\(/.test(seal + stat));
  const rotalar = readFileSync(join(KOK, "src/routes/reports/dokuma.report.routes.ts"), "utf8") + readFileSync(join(KOK, "src/routes/machine-shift-stat.routes.ts"), "utf8");
  check("§0f `byLine` iki route dosyasında Zod enum([\"1\",\"0\"]) — tanınmayan değer 400 (fail-closed)", (rotalar.match(/byLine[^\n]*z\.enum\(\["1", "0"\]/g) ?? []).length === 2);
  check("§0g Pareto ucu `byLine` ALMAZ (duruş ekseni hat bilmez)", /durusParetoReport\(paretoSchema\.parse/.test(rotalar) && !/paretoSchema[^\n]*byLine/.test(rotalar));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(2); }
  console.log("\n=== Vardiya karnesi HAT KIRILIMI — çocuk tablo, veri tetikli, opt-in okuma ===\n");
  await statik();
  safHelper();

  // ── fikstür: iki tezgah (tek hat · çift hat), bir vardiya, sentetik gün ────
  console.log("── §2 M2 ──");
  const st = await prisma.station.create({ data: { name: `TEST-LS-IST-${ek}`, code: `TEST-LS-S-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
  ids.station = st.id;
  const m1 = await prisma.machine.create({ data: { stationId: st.id, name: `TEST-LS-TEK-${ek}`, code: `TEST-LS-M1-${ek}`.toUpperCase().slice(0, 32), isActive: true, productionLineCount: 1 } });
  const m2 = await prisma.machine.create({ data: { stationId: st.id, name: `TEST-LS-CIFT-${ek}`, code: `TEST-LS-M2-${ek}`.toUpperCase().slice(0, 32), isActive: true, productionLineCount: 2 } });
  ids.m1 = m1.id; ids.m2 = m2.id;
  const def = await prisma.shiftDefinition.create({ data: { code: `L${ek}`.toUpperCase().slice(0, 8), name: `TEST-LS vardiya ${ek}`, startMinute: 480, durationMinutes: 480 } });
  ids.def = def.id;
  const gun = new Date(Date.UTC(1994, 2, 3)); // sentetik — canlı veriyle ve öteki bekçilerin günüyle çakışmaz
  const ymd = "1994-03-03";
  const S0 = new Date(Date.UTC(1994, 2, 3, 5)), S1 = new Date(Date.UTC(1994, 2, 3, 13));
  const sh = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: gun, startsAt: S0, endsAt: S1 } });
  ids.shift = sh.id;
  const kosum = (machineId: string, line: number, picks: number, target: number) =>
    prisma.machineRun.create({ data: { machineId, productionLineNo: line, startedAt: S0, endedAt: new Date(S1.getTime() - 60_000), picksAtClose: picks, targetUnitsPerMin: target, closedTermsAt: new Date() }, select: { id: true } });
  await kosum(m1.id, 1, 50_000, 500);
  const r21 = await kosum(m2.id, 1, 100_000, 500);
  await kosum(m2.id, 2, 60_000, 400);
  const scope = { onlyShiftInstanceIds: [sh.id], onlyMachineIds: [m1.id, m2.id] };

  await setFlag(false);
  const kapali = await runShiftCloseOnce(scope);
  check("§2⓪ bayrak KAPALI → 'disabled', çocuk tablo boş", kapali === "disabled" && (await prisma.machineShiftLineStat.count({ where: { stat: { machineId: { in: [m1.id, m2.id] } } } })) === 0);
  await setFlag(true);
  const r1 = await runShiftCloseOnce(scope);
  const stats = await prisma.machineShiftStat.findMany({ where: { shiftInstanceId: sh.id, machineId: { in: [m1.id, m2.id] } } });
  ids.stats = stats.map((s) => s.id);
  const s1 = stats.find((s) => s.machineId === m1.id)!, s2 = stats.find((s) => s.machineId === m2.id)!;
  check("§2a ⭐ tek hatlı makinede çocuk satır DOĞMAZ (bugünkü davranış)", r1 !== "disabled" && r1.created === 2 && (await prisma.machineShiftLineStat.count({ where: { statId: s1.id } })) === 0);
  const h = await prisma.machineShiftLineStat.findMany({ where: { statId: s2.id }, orderBy: { productionLineNo: "asc" } });
  check("§2b ⭐ çift hatlıda 2 satır: hat 1 100000@500 · hat 2 60000@400; Σ = ebeveyn", h.length === 2 && h[0]!.unitsActual === 100_000 && h[0]!.targetUnitsPerMin === 500 && h[1]!.unitsActual === 60_000 && h[1]!.targetUnitsPerMin === 400 && h[0]!.unitsActual + h[1]!.unitsActual === s2.unitsActual, `${h.length}/${s2.unitsActual}`);
  await prisma.machineRun.update({ where: { id: r21.id }, data: { picksAtClose: 110_000 } });
  const r2 = await runShiftCloseOnce(scope);
  const h2 = await prisma.machineShiftLineStat.findMany({ where: { statId: s2.id }, orderBy: { productionLineNo: "asc" } });
  check("§2c ⭐ ikinci koşum UPSERT: satır çoğalmaz (2), hat 1 tazelendi (110000)", r2 !== "disabled" && r2.recomputed === 2 && h2.length === 2 && h2[0]!.unitsActual === 110_000 && h2[0]!.id === h[0]!.id);

  // ── §3 mühür ──────────────────────────────────────────────────────────────
  console.log("── §3 mühür ──");
  await sealShiftStat(s2.id, undefined);
  const seal = await prisma.machineShiftStatSeal.findFirstOrThrow({ where: { statId: s2.id, sealGeneration: 1, action: "SEAL" }, select: { terms: true } });
  const fotoLines = (seal.terms as { lines?: Array<{ productionLineNo: number; unitsActual: number }> }).lines ?? [];
  check("§3a ⭐ Seal `terms.lines` fotoğrafı: 2 hat, hat 1 110000", fotoLines.length === 2 && fotoLines[0]?.unitsActual === 110_000);
  await prisma.machineRun.update({ where: { id: r21.id }, data: { picksAtClose: 999_999 } });
  const r3 = await runShiftCloseOnce(scope);
  const h3 = await prisma.machineShiftLineStat.findMany({ where: { statId: s2.id }, orderBy: { productionLineNo: "asc" } });
  check("§3b mühürlü karnenin hat satırına M2 DOKUNMAZ (skipped-sealed; hat 1 110000 kaldı)", r3 !== "disabled" && r3["skipped-sealed"] === 1 && h3[0]!.unitsActual === 110_000);
  const okumaMuhurlu = await listShiftStats({ from: ymd, to: ymd, machineId: m2.id, byLine: true });
  const satirM = okumaMuhurlu.data[0]!;
  check("§3c ⭐ mühürlüde `byLine` ÇOCUK TABLODAN (koşum 999999 oldu, okunan 110000 — donmuş)", satirM.live === false && satirM.lines?.length === 2 && satirM.lines[0]?.unitsActual === 110_000, String(satirM.lines?.[0]?.unitsActual));
  await unsealShiftStat(s2.id, "hat sondası", undefined);
  const okumaAcik = await listShiftStats({ from: ymd, to: ymd, machineId: m2.id, byLine: true });
  check("§3d açıkta `byLine` ANLIK (999999)", okumaAcik.data[0]!.live === true && okumaAcik.data[0]!.lines?.[0]?.unitsActual === 999_999);
  await prisma.machineRun.update({ where: { id: r21.id }, data: { picksAtClose: 110_000 } });

  // ── §4 raporlar ───────────────────────────────────────────────────────────
  console.log("── §4 raporlar ──");
  const eski = await efficiencyReport({ from: ymd, to: ymd, machineId: m2.id });
  check("§4a ⭐ `byLine` yoksa randıman satırında `hatlar` alanı HİÇ YOK (bayt bayt eski)", eski.satirlar.length === 1 && !("hatlar" in eski.satirlar[0]!));
  const yeni = await efficiencyReport({ from: ymd, to: ymd, machineId: m2.id, byLine: true });
  const hat = yeni.satirlar[0]!.hatlar!;
  check("§4b randıman `byLine`: 2 hat; hat 1 P = 110000/kapasite, A ebeveynle aynı", hat.length === 2 && hat[0]!.kpis.performancePct !== null && hat[0]!.kpis.availabilityPct === yeni.satirlar[0]!.availabilityPct);
  const tekHat = await efficiencyReport({ from: ymd, to: ymd, machineId: m1.id, byLine: true });
  check("§4c tek hatlı makinede `byLine` → `hatlar: []` (alan var, boş)", Array.isArray(tekHat.satirlar[0]!.hatlar) && tekHat.satirlar[0]!.hatlar!.length === 0);
  const karneEski = await shiftScorecardReport({ factoryDay: ymd, shiftDefinitionId: def.id });
  const mkEski = karneEski.vardiyalar[0]!.makineler.find((m) => m.machineId === m2.id)!;
  check("§4d vardiya karnesi `byLine` yoksa `hatlar` YOK", !("hatlar" in mkEski));
  const karne = await shiftScorecardReport({ factoryDay: ymd, shiftDefinitionId: def.id, byLine: true });
  const mk2 = karne.vardiyalar[0]!.makineler.find((m) => m.machineId === m2.id)!;
  check("§4e vardiya karnesi `byLine`: makine satırında 2 hat, Σhat = makine atkısı", mk2.hatlar?.length === 2 && mk2.hatlar.reduce((a, l) => a + l.unitsActual, 0) === mk2.unitsActual);
  const listeEski = await listShiftStats({ from: ymd, to: ymd, machineId: m2.id });
  check("§4f M1 listesi `byLine` yoksa `lines` YOK", !("lines" in listeEski.data[0]!));

  // ── §5 M3 sapma uyarısı ───────────────────────────────────────────────────
  console.log("── §5 M3 ──");
  await correctShiftTerms(s2.id, { unitsActual: 150_000 });
  const h5 = await prisma.machineShiftLineStat.findMany({ where: { statId: s2.id }, orderBy: { productionLineNo: "asc" } });
  check("§5a M3 hatlara DOKUNMAZ (hat 1 110000 kaldı)", h5[0]!.unitsActual === 110_000);
  await sealShiftStat(s2.id, undefined);
  const sapma = await listShiftStats({ from: ymd, to: ymd, machineId: m2.id, byLine: true });
  check("§5b ⭐ Σhat (170000) ≠ karne (150000) → `byLine` okuması UYARIR", sapma.data[0]!.warnings.some((w) => /Σhat atkı 170000 ≠ karne 150000/.test(w)), sapma.data[0]!.warnings.join(" | "));
  const sessiz = await listShiftStats({ from: ymd, to: ymd, machineId: m2.id });
  check("§5c `byLine` yoksa uyarı da yok (eski gövde)", sessiz.data[0]!.warnings.length === 0);
}

async function cleanup(): Promise<void> {
  try {
    if (ids.stats.length) {
      await prisma.machineShiftLineStat.deleteMany({ where: { statId: { in: ids.stats } } });
      await prisma.machineShiftStopBreakdown.deleteMany({ where: { statId: { in: ids.stats } } });
      await prisma.machineShiftStatSeal.deleteMany({ where: { statId: { in: ids.stats } } });
      await prisma.machineShiftStat.deleteMany({ where: { id: { in: ids.stats } } });
    }
    const makineler = [ids.m1, ids.m2].filter(Boolean);
    if (makineler.length) await prisma.machineRun.deleteMany({ where: { machineId: { in: makineler } } });
    if (ids.shift) await prisma.shiftInstance.deleteMany({ where: { id: ids.shift } });
    if (ids.def) await prisma.shiftDefinition.deleteMany({ where: { id: ids.def } });
    if (makineler.length) await prisma.machine.deleteMany({ where: { id: { in: makineler } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
    await prisma.systemSetting.deleteMany({ where: { key: "dokuma.shiftCloseLastRunAt" } });
    if (flagTouched) {
      if (originalFlag === undefined) await prisma.systemSetting.deleteMany({ where: { key: FLAG_KEY } });
      else await prisma.systemSetting.update({ where: { key: FLAG_KEY }, data: { value: originalFlag as Prisma.InputJsonValue } });
    }
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
    process.exit(fail > 0 ? 1 : 0);
  });
