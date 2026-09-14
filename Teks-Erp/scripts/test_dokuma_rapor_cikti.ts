// =============================================================================
// Dokuma raporlarının ÇIKTI bekçisi — randıman · duruş Pareto · vardiya karnesi (Dilim 4)
// =============================================================================
// Koşum: npx tsx scripts/test_dokuma_rapor_cikti.ts   (DB'li; TEST- fikstürü; sentetik gün 1993-06-06)
//
// `test_dokuma_rapor_onkosullari §4` mandalının kapanışı: rapor SÖZLEŞMESİNİN (dokuma.md
// § Raporların sözleşmesi + İKİ DEĞİŞMEZ) yanlışlanma koşulları burada ölçülür:
//   ① RANDIMAN — üç oran AYRI alan (çarpılmış tek "randıman" alanı YOK), hedef devir yokken
//      P NULL + gerekçe ("ölçülemedi" BEYAN), toplam Σ/Σ ve dışlanan sayısı, satır sayısı = Σ kaynak kırılımı
//   ② PARETO — SEBEP × SÜRE SINIFI; MINOR sebep listesinde DEĞİL (ayrı blok); sınıflandırılmamış ayrı
//      kova; `atanmamis` (beamSlot NULL) ayrı eksen; toplam = Σsebepler + mikro + sınıfsız;
//      mühürlü karnede `reasonLabel` DONMUŞ (katalog etiketi değişince eski kuşak değişmez), açıkta canlı
//   ③ VARDİYA KARNESİ — satır sayısı = ölçülen + elle + simüle + çıkarım; `SIMULATED` `OPERATOR`a
//      KATILMAZ; ölçülemedi sayısı = P null satırlar; üretim toplamı
//   ④ meta.ufuk = LOOM_HORIZON_DAY ve ufuk öncesi satır sayısı beyan edilir; `DEFTER_UFKU`/`LEDGER_HORIZON`
//      dokuma raporunda İMPORT EDİLMEZ (AST)
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-09-14):
//   · `resolveShiftSource` SIMULATED'ı OPERATOR'a çökertince ①d/②i/③b ❌ · Pareto'da MINOR satırları sebep
//     listesine sokunca ②a/②b/②e ❌ · `sumBreakdown` her satırı OPERATOR'a yazınca ①d/②i/③b ❌
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MachineDataSource, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { durusParetoReport, efficiencyReport, shiftScorecardReport } from "../src/services/reports/dokuma.report.service";
import { sealShiftStat } from "../src/services/machine-shift-seal.service";
import { runShiftCloseOnce } from "../src/jobs/machine-shift-close.job";
import { LOOM_HORIZON_DAY } from "../src/constants/dokuma-ufku";
import { factoryDayKeyUtcMidnight, factoryYmd } from "../src/constants/time";

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
const ids = { station: "", m: [] as string[], def: "", shift: "", presets: [] as string[], stats: [] as string[] };

async function main(): Promise<void> {
  console.log("\n=== Dokuma raporları ÇIKTI — ① üç oran · ② iki eksen · ③ kaynak kırılımı · ④ ufuk ===\n");

  // ── ④ statik: dokuma raporu defter ufkunu OKUMAZ ─────────────────────────
  const KOK = join(__dirname, "..");
  const raporSrc = readFileSync(join(KOK, "src/services/reports/dokuma.report.service.ts"), "utf8") + readFileSync(join(KOK, "src/routes/reports/dokuma.report.routes.ts"), "utf8");
  check("④a dokuma raporu `ledger-horizon`/`DEFTER_UFKU`/`LEDGER_HORIZON` import ETMİYOR (ayrı ufuk)", !/ledger-horizon|DEFTER_UFKU|LEDGER_HORIZON/.test(raporSrc));
  check("④b dokuma raporu `dokuma-ufku` sabitini okuyor", /dokuma-ufku/.test(raporSrc) && /LOOM_HORIZON_DAY/.test(raporSrc));

  // ── fikstür ───────────────────────────────────────────────────────────────
  const st = await prisma.station.create({ data: { name: `TEST-RC-IST-${ek}`, code: `TEST-RC-S-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
  ids.station = st.id;
  const mk = async (n: number) => (await prisma.machine.create({ data: { stationId: st.id, name: `TEST-RC-TEZ${n}-${ek}`, code: `TEST-RC-M${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } })).id;
  const m1 = await mk(1), m2 = await mk(2), m3 = await mk(3);
  ids.m = [m1, m2, m3];
  const def = await prisma.shiftDefinition.create({ data: { code: `R${ek}`.toUpperCase().slice(0, 8), name: `TEST-RC vardiya ${ek}`, startMinute: 480, durationMinutes: 480 } });
  ids.def = def.id;
  const gun = new Date(Date.UTC(1993, 5, 6)); // sentetik — canlı veriyle çakışmaz, ufuktan ÖNCE
  const S0 = new Date(Date.UTC(1993, 5, 6, 5)), S1 = new Date(Date.UTC(1993, 5, 6, 13));
  const sh = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: gun, startsAt: S0, endsAt: S1 } });
  ids.shift = sh.id;
  const pSetup = await prisma.reasonPreset.create({ data: { kind: ReasonPresetKind.MACHINE_STOP, code: `TEST_RC_S_${ek}`.toUpperCase().slice(0, 64), label: `TEST-RC kurulum ${ek}`, stopLossClass: "SETUP", sortOrder: 999 } });
  const pUnpl = await prisma.reasonPreset.create({ data: { kind: ReasonPresetKind.MACHINE_STOP, code: `TEST_RC_U_${ek}`.toUpperCase().slice(0, 64), label: `TEST-RC kopuş ${ek}`, stopLossClass: "UNPLANNED", sortOrder: 999 } });
  ids.presets = [pSetup.id, pUnpl.id];
  const stop = (machineId: string, startMin: number, durSec: number, over: Record<string, unknown>) => prisma.machineStopEvent.create({
    data: {
      machineId, stopKey: randomUUID(), factoryDay: factoryDayKeyUtcMidnight(S0), shiftInstanceId: sh.id, source: MachineDataSource.OPERATOR,
      startedAt: new Date(S0.getTime() + startMin * 60_000), endedAt: new Date(S0.getTime() + startMin * 60_000 + durSec * 1000), durationSec: durSec, ...over,
    },
  });
  // m1 (OPERATOR): SETUP 1 sa (yuva 1) · UNPLANNED 10 dk (yuva NULL → atanmamış) · MINOR 15 sn · sınıfsız 5 dk
  await stop(m1, 60, 3600, { reasonCode: pSetup.code, lossClass: "SETUP", beamSlot: 1 });
  await stop(m1, 180, 600, { reasonCode: pUnpl.code, lossClass: "UNPLANNED", beamSlot: null });
  await stop(m1, 240, 15, { reasonCode: pUnpl.code, lossClass: "UNPLANNED", beamSlot: 1 });
  await stop(m1, 300, 300, { beamSlot: 1 }); // sınıfsız ama yuvası belli — atanmamış kovası yalnız yuvası NULL olanı sayar
  await prisma.machineRun.create({ data: { machineId: m1, startedAt: S0, endedAt: new Date(S1.getTime() - 60_000), picksAtClose: 100_000, targetUnitsPerMin: 500, closedTermsAt: new Date(), producedM: "250.5" } });
  // m2 (SIMULATED duruş; hedef devir YOK → P ölçülemez)
  await stop(m2, 120, 1800, { reasonCode: pUnpl.code, lossClass: "UNPLANNED", beamSlot: 1, source: MachineDataSource.SIMULATED });
  await prisma.machineRun.create({ data: { machineId: m2, startedAt: S0, endedAt: new Date(S1.getTime() - 60_000), picksAtClose: 50_000, targetUnitsPerMin: null, closedTermsAt: new Date() } });
  // m3: hiçbir şey → boş tezgah (INFERRED)
  const ymd = factoryYmd(new Date(gun.getTime() + 12 * 3600_000));
  const benim = (r: { machineId: string }) => ids.m.includes(r.machineId);

  // ── ① RANDIMAN ────────────────────────────────────────────────────────────
  const r1 = await efficiencyReport({ from: ymd, to: ymd });
  const sat = r1.satirlar.filter(benim);
  const row1 = sat.find((r) => r.machineId === m1)!, row2 = sat.find((r) => r.machineId === m2)!, row3 = sat.find((r) => r.machineId === m3)!;
  check("①a üç tezgah × bir vardiya = 3 satır", sat.length === 3 && !!row1 && !!row2 && !!row3, String(sat.length));
  check("①b ⭐ üç oran AYRI alan; çarpılmış tek 'randıman' alanı YOK", row1.availabilityPct !== null && row1.performancePct !== null && row1.effectivenessPct !== null && !("randimanPct" in row1) && !("oee" in row1), `${row1.availabilityPct}/${row1.performancePct}/${row1.effectivenessPct}`);
  check("①b' E kendi paydasından (capPot), A×P'den türetilmedi — tek koşumda ≤ 0.02 fark", Math.abs(row1.effectivenessPct! - (row1.availabilityPct! * row1.performancePct!) / 100) <= 0.02);
  check("①c ⭐ hedef devir yokken P NULL + gerekçe ('ölçülemedi' BEYAN, 0 değil)", row2.performancePct === null && typeof row2.olculemedi.P === "string" && row2.availabilityPct !== null, row2.olculemedi.P ?? "");
  check("①c' boş tezgah INFERRED, emptyLoom, A null", row3.source === "INFERRED" && row3.emptyLoom && row3.availabilityPct === null);
  const kk = r1.kaynakKirilimi;
  const kkToplam = Object.values(kk).reduce((a, k) => a + k.satir, 0);
  check("①d ⭐ kaynak kırılımı basılıyor: OPERATOR ≥1 · SIMULATED ≥1 · INFERRED ≥1, SIMULATED OPERATOR'a katılmadı", kk.OPERATOR.satir >= 1 && kk.SIMULATED.satir >= 1 && kk.INFERRED.satir >= 1 && row2.source === "SIMULATED" && row1.source === "OPERATOR", JSON.stringify(Object.fromEntries(Object.entries(kk).map(([k, v]) => [k, v.satir]))));
  check("①e ⭐ toplam satır = Σ kaynak kırılımı", kkToplam === r1.satirlar.length, `${kkToplam} ↔ ${r1.satirlar.length}`);
  check("①f toplam Σ/Σ ve DIŞLANAN sayısı (P: ≥ 2 ölçülemez satır)", r1.toplam.olculemedi.P >= 2 && r1.toplam.rowCount === r1.satirlar.length, JSON.stringify(r1.toplam.olculemedi));
  check("①g meta.ufuk = LOOM_HORIZON_DAY, ufuk öncesi satır beyanı (1993 < ufuk)", r1.meta.ufuk === LOOM_HORIZON_DAY && r1.meta.ufukOncesiSatir >= 3, `${r1.meta.ufuk} · ${r1.meta.ufukOncesiSatir}`);

  // ── ② PARETO (açık karne: canlı) ──────────────────────────────────────────
  const p1 = await durusParetoReport({ from: ymd, to: ymd, machineId: m1 });
  check("②a SEBEP × SÜRE SINIFI satırları: SETUP (kurulum) + UNPLANNED (kopuş), süreye göre sıralı", p1.sebepler.length === 2 && p1.sebepler[0]?.reasonCode === pSetup.code && p1.sebepler[0]?.lossClass === "SETUP" && p1.sebepler[0]?.stopSec === 3600 && p1.sebepler[1]?.reasonCode === pUnpl.code && p1.sebepler[1]?.stopSec === 600, JSON.stringify(p1.sebepler.map((s) => [s.reasonCode, s.lossClass, s.stopSec])));
  check("②b ⭐ MINOR sebep listesinde DEĞİL — ayrı blok (1 duruş, 15 sn)", !p1.sebepler.some((s) => s.lossClass === "MINOR") && p1.mikroDuruslar.stopCount === 1 && p1.mikroDuruslar.stopSec === 15);
  check("②c sınıflandırılmamış AYRI kova (1 duruş, 300 sn) ve sebep listesinde değil", p1.siniflandirilmamis.stopCount === 1 && p1.siniflandirilmamis.stopSec === 300 && !p1.sebepler.some((s) => s.reasonCode === null));
  check("②d ⭐ `atanmamis` (beamSlot NULL) AYRI eksen: 1 duruş 600 sn — sebep listesiyle KESİŞİR, toplama eklenmez", p1.atanmamis.stopCount === 1 && p1.atanmamis.stopSec === 600 && p1.toplam.stopSec === 3600 + 600 + 15 + 300);
  check("②e toplam = Σsebepler + mikro + sınıflandırılmamış", p1.toplam.stopSec === p1.sebepler.reduce((a, s) => a + s.stopSec, 0) + p1.mikroDuruslar.stopSec + p1.siniflandirilmamis.stopSec && p1.toplam.stopCount === 4);
  check("②f etiket katalogdan (açık karne canlı okur)", p1.sebepler[0]?.reasonLabel === pSetup.label);

  // Mühürle → etiket DONAR: katalog etiketi değişince mühürlü karnenin Pareto'su DEĞİŞMEZ, açık olan değişir.
  await setFlag(true);
  const job = await runShiftCloseOnce({ onlyShiftInstanceIds: [sh.id], onlyMachineIds: [m1, m2] });
  check("fikstür: karne satırları yazıldı", job !== "disabled" && job.created === 2, JSON.stringify(job));
  const stat1 = await prisma.machineShiftStat.findUniqueOrThrow({ where: { machineId_shiftInstanceId: { machineId: m1, shiftInstanceId: sh.id } } });
  const stat2 = await prisma.machineShiftStat.findUniqueOrThrow({ where: { machineId_shiftInstanceId: { machineId: m2, shiftInstanceId: sh.id } } });
  ids.stats = [stat1.id, stat2.id];
  await sealShiftStat(stat1.id, undefined);
  await prisma.reasonPreset.update({ where: { id: pSetup.id }, data: { label: `TEST-RC kurulum DEĞİŞTİ ${ek}` } });
  const p2 = await durusParetoReport({ from: ymd, to: ymd, machineId: m1 });
  check("②g ⭐ MÜHÜRLÜ karnede reasonLabel DONMUŞ (katalog değişti, kuşak 1 değişmedi)", p2.sebepler.find((s) => s.reasonCode === pSetup.code)?.reasonLabel === pSetup.label, p2.sebepler.find((s) => s.reasonCode === pSetup.code)?.reasonLabel ?? "");
  check("②h mühürlü karnenin Pareto'su son kuşaktan, sayılar aynı", p2.toplam.stopSec === p1.toplam.stopSec && p2.mikroDuruslar.stopCount === 1 && p2.atanmamis.stopCount === 1);
  const p3 = await durusParetoReport({ from: ymd, to: ymd, machineId: m2 });
  check("②i açık karne canlı: m2'nin SIMULATED duruşu kaynak kırılımında SIMULATED", p3.kaynakKirilimi.SIMULATED.satir === 1 && p3.kaynakKirilimi.OPERATOR.satir === 0 && p3.sebepler[0]?.stopSec === 1800);

  // ── ③ VARDİYA KARNESİ ─────────────────────────────────────────────────────
  const v = await shiftScorecardReport({ factoryDay: ymd, shiftDefinitionId: def.id });
  const vs = v.vardiyalar.find((x) => x.shiftInstanceId === sh.id)!;
  check("③a vardiya satırı var; makineler 3", !!vs && vs.makineler.filter(benim).length === 3, String(v.vardiyalar.length));
  const oz = vs.ozet;
  check("③b ⭐ kaynak kırılımı: elle 1 (OPERATOR/SUPERVISOR) · simüle 1 · çıkarım 1 · ölçülen 0; SIMULATED elle'ye katılmadı", oz.elle === 1 && oz.simule === 1 && oz.cikarim === 1 && oz.olculen === 0, JSON.stringify(oz));
  check("③c ⭐ toplam satır = ölçülen + elle + simüle + çıkarım", oz.toplamSatir === oz.olculen + oz.elle + oz.simule + oz.cikarim && oz.toplamSatir === 3);
  check("③d ölçülemedi = P null satırlar (m2 hedef yok + m3 boş) = 2", oz.olculemedi === 2, String(oz.olculemedi));
  check("③e üretim toplamı: atkı 150000, metre 250.5; duruş toplamı m1+m2", vs.uretim.unitsActual === 150_000 && vs.uretim.producedM === 250.5 && vs.durusSec === 3600 + 600 + 15 + 300 + 1800, `${vs.uretim.unitsActual}/${vs.uretim.producedM}/${vs.durusSec}`);
  check("③f mühürlü m1 satırı live:false SEALED; m2/m3 live", vs.makineler.find((x) => x.machineId === m1)?.sealState === "SEALED" && vs.makineler.find((x) => x.machineId === m2)?.live === true);
  check("③g meta.ufuk basılıyor", v.meta.ufuk === LOOM_HORIZON_DAY && v.meta.ufukOncesiSatir >= 3);
  const vFiltre = await shiftScorecardReport({ factoryDay: ymd, shiftDefinitionId: def.id });
  check("③h vardiya tanımı süzgeci sunucuda (yalnız bu tanım)", vFiltre.vardiyalar.every((x) => x.shift.code === def.code));
}

async function cleanup(): Promise<void> {
  try {
    if (ids.stats.length) {
      await prisma.machineShiftStopBreakdown.deleteMany({ where: { statId: { in: ids.stats } } });
      await prisma.machineShiftStatSeal.deleteMany({ where: { statId: { in: ids.stats } } });
      await prisma.machineShiftStat.deleteMany({ where: { id: { in: ids.stats } } });
    }
    if (ids.m.length) {
      const stops = await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.m } }, select: { id: true } });
      const sid = stops.map((s) => s.id);
      await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
      await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
      await prisma.machineRun.deleteMany({ where: { machineId: { in: ids.m } } });
    }
    if (ids.presets.length) await prisma.reasonPreset.deleteMany({ where: { id: { in: ids.presets } } });
    if (ids.shift) await prisma.shiftInstance.deleteMany({ where: { id: ids.shift } });
    if (ids.def) await prisma.shiftDefinition.deleteMany({ where: { id: ids.def } });
    if (ids.m.length) await prisma.machine.deleteMany({ where: { id: { in: ids.m } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
    await prisma.systemSetting.deleteMany({ where: { key: "dokuma.shiftCloseLastRunAt" } });
    if (flagTouched) {
      if (originalFlag === undefined) await prisma.systemSetting.deleteMany({ where: { key: FLAG_KEY } });
      else await prisma.systemSetting.update({ where: { key: FLAG_KEY }, data: { value: originalFlag as import("@prisma/client").Prisma.InputJsonValue } });
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
