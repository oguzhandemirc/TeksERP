// =============================================================================
// Vardiya karnesi TERİMLERİ bekçisi — `helpers/loom-shift-terms.helper.ts` + M1 okuyucu
// =============================================================================
// Koşum: npx tsx scripts/test_machine_shift_terms.ts   (§1–§9 saf, §10 DB'li; TEST- fikstürü)
//
// Ölçer (özet §3, sözleşme ①/③):
//   §1 duruş PENCEREYE KIRPILIR (23:50 başlayan 12 sa duruş → ilk vardiyaya 600 sn); açık duruş
//      `now`a kadar + uyarı; pencere dışı duruş hiç sayılmaz
//   §2 değişmez: Σ(breakdown \ NON_SCHEDULED).stopSec + … ≤ POT, Σ kova = terimler
//   §3 BOŞ TEZGAH → nonScheduledSec = takvim, POT 0, source INFERRED, emptyLoom
//   §4 iptal vardiya → terimler 0, oranlar null
//   §5 iki koşum → targetUnitsPerMin NULL, kapasite TOPLANIR (500×4sa + 700×4sa)
//   §6 atkı KAPANDIĞI vardiyaya: açık koşum katılmaz + uyarı; sonraki pencerede kapanan koşum
//      bu pencereye atkı yazmaz; picksAtClose NULL → uyarı, 0 değil
//   §7 MINOR süre sınıfı: eşik altı UNPLANNED → minor (APT düşmez); eşik altı PLANNED → PLANNED
//      kalır; sınıfsız → UNPLANNED + unclassifiedSec + uyarı
//   §8 source önceliği: SIMULATED > SUPERVISOR > OPERATOR > INFERRED
//   §9 tek koşum, tam pencere → E = A × P (terimler helper'dan, oranlar efficiency'den)
//   §10 DB: yükleyici doğru satırları toplar (geri alınmış/başka makine hariç, etiket KOPYA);
//      `listShiftStats` WEAVING istasyonundaki aktif tezgahı `live` döner, mühürlü satırı DB'den
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-09-14):
//   · `clipToWindow`da pencere kırpması kaldırılınca (tam süre) §1a ❌ · boş tezgah kuralı
//     kaldırılınca §3a/§3b ❌ · `closedHere`den `endedAt < endsAt` düşürülünce §6b ❌
// =============================================================================
import { randomUUID } from "node:crypto";
import { MachineDataSource, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { computeShiftTermsPure, clipToWindow, type ShiftTermsInput } from "../src/services/helpers/loom-shift-terms.helper";
import { computeMachineKpis } from "../src/services/helpers/loom-efficiency.helper";
import { computeShiftTerms, listShiftStats, loadShiftTermsInput } from "../src/services/machine-shift-stat.service";
import { MINOR_STOP_THRESHOLD_SEC } from "../src/constants/loom-shift";
import { factoryDayKeyUtcMidnight, factoryYmd } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const T = (iso: string): Date => new Date(iso);
const W0 = T("2026-04-05T00:00:00.000Z");
const W1 = T("2026-04-05T08:00:00.000Z");
const NOW = T("2026-04-05T09:00:00.000Z");
const base = (): ShiftTermsInput => ({
  window: { startsAt: W0, endsAt: W1, isCancelled: false, plannedBreakMinutes: 0 },
  stops: [], runs: [], doffSources: [], spec: null, productionLineCount: 1, now: NOW, stopThresholdSec: MINOR_STOP_THRESHOLD_SEC,
});
type Stop = ShiftTermsInput["stops"][number];
type Run = ShiftTermsInput["runs"][number];
let seq = 0;
const stop = (s: Partial<Stop> & { startedAt: Date; endedAt: Date | null }): Stop => ({
  id: `s${++seq}`, durationSec: s.endedAt ? Math.floor((s.endedAt.getTime() - s.startedAt.getTime()) / 1000) : null,
  reasonCode: "X", reasonLabel: "x", lossClass: "UNPLANNED", beamSlot: 1, source: "OPERATOR", ...s,
});
const run = (r: Partial<Run> & { startedAt: Date; endedAt: Date | null }): Run =>
  ({ id: `r${++seq}`, picksAtClose: null, producedM: null, targetUnitsPerMin: 600, unitsPerCm: null, productionLineNo: 1, ...r });
const fullRun = (picks: number, target = 600): Run => run({ startedAt: W0, endedAt: T("2026-04-05T07:59:59.000Z"), picksAtClose: picks, targetUnitsPerMin: target });

const ek = Date.now().toString(36);
const ids = { station: "", station2: "", machine: "", machine2: "", machineOff: "", def: "", shift: "", shiftNext: "", preset: "", stat: "" };

async function pure(): Promise<void> {
  // ── §1 kırpma ─────────────────────────────────────────────────────────────
  // Önceki vardiya 16:00–00:00; duruş 23:50'de başlayıp 12 saat sürer → o vardiyaya yalnız 600 sn.
  const P0 = T("2026-04-04T16:00:00.000Z");
  const uzun = stop({ startedAt: T("2026-04-04T23:50:00.000Z"), endedAt: T("2026-04-05T11:50:00.000Z") });
  check("§1a ⭐ 23:50 başlayan 12 sa duruş ilk vardiyaya 600 sn", clipToWindow(uzun.startedAt, uzun.endedAt, { startsAt: P0, endsAt: W0 }, NOW) === 600);
  const t1 = computeShiftTermsPure({ ...base(), window: { ...base().window, startsAt: P0, endsAt: W0 }, stops: [uzun], runs: [run({ startedAt: P0, endedAt: T("2026-04-04T23:59:59.000Z"), picksAtClose: 1000 })] });
  check("§1b kırpılmış 600 sn UNPLANNED kovasına, APT = 28800 − 600", t1.unplannedDownSec === 600 && t1.aptSec === 28_200, `${t1.unplannedDownSec}/${t1.aptSec}`);
  const t1x = computeShiftTermsPure({ ...base(), stops: [uzun], runs: [fullRun(1000)] });
  check("§1b' aynı duruş SONRAKİ vardiyanın tamamını kaplar (28800), iki pencere toplamı 12 sa'yi aşmaz", t1x.unplannedDownSec === 28_800 && t1x.aptSec === 0);
  const acik = stop({ startedAt: T("2026-04-05T07:00:00.000Z"), endedAt: null });
  const t1b = computeShiftTermsPure({ ...base(), stops: [acik], runs: [fullRun(1000)] });
  check("§1c açık duruş pencere sonuna (now > endsAt) kadar 3600 sn + uyarı", t1b.unplannedDownSec === 3600 && t1b.warnings.some((w) => /Açık duruş/.test(w)));
  const disari = stop({ startedAt: T("2026-04-05T09:00:00.000Z"), endedAt: T("2026-04-05T10:00:00.000Z") });
  const t1c = computeShiftTermsPure({ ...base(), stops: [disari], runs: [fullRun(1000)] });
  check("§1d pencere dışı duruş sayılmaz (stopCount 0)", t1c.stopCount === 0 && t1c.breakdown.length === 0);

  // ── §2 değişmez ───────────────────────────────────────────────────────────
  const karma = [
    stop({ startedAt: T("2026-04-05T01:00:00.000Z"), endedAt: T("2026-04-05T01:30:00.000Z"), lossClass: "SETUP", reasonCode: "S" }),
    stop({ startedAt: T("2026-04-05T02:00:00.000Z"), endedAt: T("2026-04-05T02:20:00.000Z"), lossClass: "PLANNED", reasonCode: "P" }),
    stop({ startedAt: T("2026-04-05T03:00:00.000Z"), endedAt: T("2026-04-05T04:00:00.000Z"), lossClass: "NON_SCHEDULED", reasonCode: "N" }),
    stop({ startedAt: T("2026-04-05T05:00:00.000Z"), endedAt: T("2026-04-05T05:00:10.000Z"), lossClass: "UNPLANNED", reasonCode: "M" }),
    stop({ startedAt: T("2026-04-05T06:00:00.000Z"), endedAt: T("2026-04-05T06:05:00.000Z"), lossClass: null, reasonCode: null }),
  ];
  const t2 = computeShiftTermsPure({ ...base(), window: { ...base().window, plannedBreakMinutes: 30 }, stops: karma, runs: [fullRun(1000)] });
  const icKova = t2.breakdown.filter((b) => b.lossClass !== "NON_SCHEDULED").reduce((a, b) => a + b.stopSec, 0);
  check("§2a ⭐ Σ(breakdown \\ NON_SCHEDULED) ≤ POT", icKova <= t2.potSec, `${icKova} ≤ ${t2.potSec}`);
  check("§2b POT = takvim − NON_SCHEDULED − mola (28800 − 3600 − 1800)", t2.potSec === 23_400 && t2.nonScheduledSec === 3600 && t2.plannedBreakSec === 1800);
  check("§2c APT = POT − SETUP − PLANNED − UNPLANNED (23400 − 1800 − 1200 − 300)", t2.aptSec === 20_100 && t2.setupSec === 1800 && t2.plannedDownSec === 1200 && t2.unplannedDownSec === 300, String(t2.aptSec));
  check("§2d Σ kova = Σ breakdown.stopSec (kırılım terimlerle birebir)", t2.breakdown.reduce((a, b) => a + b.stopSec, 0) === t2.setupSec + t2.plannedDownSec + t2.nonScheduledSec + t2.unplannedDownSec + t2.minorStopSec);
  check("§2e stopCount 5 · minorStopCount 1 · breakdown 5 satır", t2.stopCount === 5 && t2.minorStopCount === 1 && t2.breakdown.length === 5);

  // ── §3 boş tezgah ─────────────────────────────────────────────────────────
  const t3 = computeShiftTermsPure(base());
  check("§3a ⭐ boş tezgah → nonScheduledSec = takvim, POT 0", t3.nonScheduledSec === 28_800 && t3.potSec === 0 && t3.emptyLoom);
  check("§3b ⭐ boş tezgah → source INFERRED + uyarı", t3.source === "INFERRED" && t3.warnings.some((w) => /Boş tezgah/.test(w)));
  const k3 = computeMachineKpis(t3);
  check("§3c boş tezgah oranları null (ölçülemedi)", k3.availabilityPct === null && k3.performancePct === null);

  // ── §4 iptal ──────────────────────────────────────────────────────────────
  const t4 = computeShiftTermsPure({ ...base(), window: { ...base().window, isCancelled: true }, stops: karma, runs: [fullRun(1000)] });
  check("§4a iptal vardiya → takvim 0, terimler 0, kırılım boş", t4.calendarSec === 0 && t4.potSec === 0 && t4.stopCount === 0 && t4.unitsActual === 0 && t4.breakdown.length === 0);
  check("§4b iptal vardiya → oranlar null", computeMachineKpis(t4).availabilityPct === null);

  // ── §5 iki koşum ──────────────────────────────────────────────────────────
  const r5a = run({ startedAt: W0, endedAt: T("2026-04-05T04:00:00.000Z"), picksAtClose: 100_000, targetUnitsPerMin: 500 });
  const r5b = run({ startedAt: T("2026-04-05T04:00:00.000Z"), endedAt: T("2026-04-05T07:59:00.000Z"), picksAtClose: 150_000, targetUnitsPerMin: 700 });
  const t5 = computeShiftTermsPure({ ...base(), runs: [r5a, r5b] });
  check("§5a ⭐ iki koşum → targetUnitsPerMin NULL (etiket yok, payda kapasite)", t5.targetUnitsPerMin === null && t5.runCount === 2);
  check("§5b kapasite TOPLANIR: 500×240 + 700×239 = 287300", t5.targetUnitCapacityPot === 287_300 && t5.targetUnitCapacityApt === 287_300, String(t5.targetUnitCapacityPot));
  check("§5c atkı ikisinden (250000), unitsPerCmAtClose NULL", t5.unitsActual === 250_000 && t5.unitsPerCmAtClose === null);
  const t5b = computeShiftTermsPure({ ...base(), runs: [run({ startedAt: W0, endedAt: T("2026-04-05T07:59:00.000Z"), picksAtClose: 10, targetUnitsPerMin: null })] });
  check("§5d hedef devir NULL ∧ künye yok → kapasite 0 + uyarı (P ölçülemez)", t5b.targetUnitCapacityApt === 0 && t5b.warnings.some((w) => /hedef deviri yok/.test(w)) && computeMachineKpis(t5b).performancePct === null);
  const t5c = computeShiftTermsPure({ ...base(), spec: { nominalUnitsPerMin: 400, monitoringState: "OFF" }, runs: [run({ startedAt: W0, endedAt: T("2026-04-05T07:59:00.000Z"), picksAtClose: 10, targetUnitsPerMin: null })] });
  check("§5e hedef NULL → künye nominal yedeği (400×479 = 191600)", t5c.targetUnitCapacityPot === 191_600 && t5c.targetUnitsPerMin === 400 && t5c.monitoringState === "OFF");

  // ── §6 atkı kapandığı vardiyaya ───────────────────────────────────────────
  const acikRun = run({ startedAt: T("2026-04-05T06:00:00.000Z"), endedAt: null, picksAtClose: null });
  const t6 = computeShiftTermsPure({ ...base(), runs: [acikRun] });
  check("§6a ⭐ açık koşum: atkı 0, kapasite şu ana kadar (600×120=72000) + uyarı", t6.unitsActual === 0 && t6.targetUnitCapacityPot === 72_000 && t6.warnings.some((w) => /Açık koşum/.test(w)));
  const sonraKapanan = run({ startedAt: T("2026-04-05T06:00:00.000Z"), endedAt: T("2026-04-05T10:00:00.000Z"), picksAtClose: 50_000 });
  const t6b = computeShiftTermsPure({ ...base(), runs: [sonraKapanan] });
  check("§6b ⭐ sonraki pencerede kapanan koşumun atkısı BU pencereye yazılmaz (orantılama yok)", t6b.unitsActual === 0 && t6b.targetUnitCapacityPot === 72_000);
  const sayacsiz = run({ startedAt: W0, endedAt: T("2026-04-05T07:00:00.000Z"), picksAtClose: null });
  const t6c = computeShiftTermsPure({ ...base(), runs: [sayacsiz] });
  check("§6c picksAtClose NULL → atkı 0 DEĞİL ölçülmedi uyarısı", t6c.warnings.some((w) => /sayacı okunmadı/.test(w)));

  // ── §7 MINOR süre sınıfı ──────────────────────────────────────────────────
  const kisaU = stop({ startedAt: T("2026-04-05T01:00:00.000Z"), endedAt: T("2026-04-05T01:00:15.000Z"), lossClass: "UNPLANNED" });
  const kisaP = stop({ startedAt: T("2026-04-05T02:00:00.000Z"), endedAt: T("2026-04-05T02:00:15.000Z"), lossClass: "PLANNED", reasonCode: "P" });
  const t7 = computeShiftTermsPure({ ...base(), stops: [kisaU, kisaP], runs: [fullRun(1000)] });
  check("§7a ⭐ eşik altı UNPLANNED → MINOR, APT'den düşmez (28800 − yalnız PLANNED 15)", t7.minorStopCount === 1 && t7.minorStopSec === 15 && t7.unplannedDownSec === 0 && t7.aptSec === 28_800 - 15, String(t7.aptSec));
  check("§7b eşik altı PLANNED → PLANNED kalır (süre sınıfı yalnız kullanılabilirlik kaybına)", t7.plannedDownSec === 15 && t7.breakdown.some((b) => b.lossClass === "MINOR") && t7.breakdown.some((b) => b.lossClass === "PLANNED"));
  const sinifsiz = stop({ startedAt: T("2026-04-05T03:00:00.000Z"), endedAt: T("2026-04-05T03:10:00.000Z"), lossClass: null, reasonCode: null, beamSlot: null });
  const t7b = computeShiftTermsPure({ ...base(), stops: [sinifsiz], runs: [fullRun(1000)] });
  check("§7c ⭐ sınıfsız → UNPLANNED + unclassifiedSec 600 + uyarı; kırılımda reasonCode NULL, beamSlotNull", t7b.unplannedDownSec === 600 && t7b.unclassifiedSec === 600 && t7b.warnings.some((w) => /sınıflandırılmamış/.test(w)) && t7b.breakdown[0]?.reasonCode === null && t7b.breakdown[0]?.beamSlotNull === true);

  // ── §8 source ─────────────────────────────────────────────────────────────
  const t8a = computeShiftTermsPure({ ...base(), stops: [stop({ startedAt: T("2026-04-05T01:00:00.000Z"), endedAt: T("2026-04-05T01:30:00.000Z"), source: "SIMULATED" })], supervisorTouched: true });
  check("§8a ⭐ SIMULATED > SUPERVISOR", t8a.source === "SIMULATED");
  const t8b = computeShiftTermsPure({ ...base(), runs: [fullRun(1)], supervisorTouched: true });
  check("§8b SUPERVISOR > OPERATOR", t8b.source === "SUPERVISOR");
  const t8c = computeShiftTermsPure({ ...base(), doffSources: ["OPERATOR"] });
  check("§8c yalnız doff → OPERATOR (gözlem var)", t8c.source === "OPERATOR" && !t8c.emptyLoom);
  const t8d = computeShiftTermsPure({ ...base(), doffSources: ["SIMULATED"] });
  check("§8d doff sayacı SIMULATED → karne SIMULATED", t8d.source === "SIMULATED");

  // ── §9 E = A × P ──────────────────────────────────────────────────────────
  const t9 = computeShiftTermsPure({ ...base(), stops: [stop({ startedAt: T("2026-04-05T01:00:00.000Z"), endedAt: T("2026-04-05T02:00:00.000Z") })], runs: [fullRun(200_000)] });
  const k9 = computeMachineKpis(t9);
  check("§9a tek koşum tam pencere: A %87.5 (25200/28800)", k9.availabilityPct === 87.5, String(k9.availabilityPct));
  check("§9b ⭐ E ≡ A × P (terimler helper'dan: cap 252000 / 288000)", t9.targetUnitCapacityApt === 251_990 && Math.abs(k9.effectivenessPct! - (k9.availabilityPct! * k9.performancePct!) / 100) <= 0.02, `${t9.targetUnitCapacityApt} · E ${k9.effectivenessPct} A ${k9.availabilityPct} P ${k9.performancePct}`);
}

async function db(): Promise<void> {
  console.log("\n§10 — DB: yükleyici + M1 okuyucu");
  const st = await prisma.station.create({ data: { name: `TEST-ST-IST-${ek}`, code: `TEST-ST-S-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
  ids.station = st.id;
  const st2 = await prisma.station.create({ data: { name: `TEST-ST-KK-${ek}`, code: `TEST-ST-K-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "PROCESS_QC", isActive: true } });
  ids.station2 = st2.id;
  const m = await prisma.machine.create({ data: { stationId: st.id, name: `TEST-ST-TEZ-${ek}`, code: `TEST-ST-M-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machine = m.id;
  const m2 = await prisma.machine.create({ data: { stationId: st2.id, name: `TEST-ST-KKM-${ek}`, code: `TEST-ST-M2-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machine2 = m2.id;
  const mOff = await prisma.machine.create({ data: { stationId: st.id, name: `TEST-ST-PASIF-${ek}`, code: `TEST-ST-M3-${ek}`.toUpperCase().slice(0, 32), isActive: false } });
  ids.machineOff = mOff.id;
  const def = await prisma.shiftDefinition.create({ data: { code: `T${ek}`.toUpperCase().slice(0, 8), name: `TEST-ST vardiya ${ek}`, startMinute: 0, durationMinutes: 480, plannedBreakMinutes: 30 } });
  ids.def = def.id;
  const gun = T("1991-03-03T00:00:00.000Z"); // sentetik gün — canlı veriyle çakışmaz
  const S0 = T("1991-03-03T05:00:00.000Z"), S1 = T("1991-03-03T13:00:00.000Z");
  const sh = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: gun, startsAt: S0, endsAt: S1 } });
  ids.shift = sh.id;
  const shNext = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: new Date(gun.getTime() + 86_400_000), startsAt: S1, endsAt: new Date(S1.getTime() + 8 * 3600_000) } });
  ids.shiftNext = shNext.id;
  const preset = await prisma.reasonPreset.create({ data: { kind: ReasonPresetKind.MACHINE_STOP, code: `TEST_ST_${ek}`.toUpperCase().slice(0, 64), label: `TEST-ST sebep ${ek}`, stopLossClass: "SETUP", sortOrder: 999 } });
  ids.preset = preset.id;
  const stopData = (over: Record<string, unknown>) => ({
    machineId: m.id, stopKey: randomUUID(), factoryDay: factoryDayKeyUtcMidnight(S0), shiftInstanceId: sh.id, source: MachineDataSource.OPERATOR,
    startedAt: new Date(S0.getTime() + 3600_000), endedAt: new Date(S0.getTime() + 2 * 3600_000), durationSec: 3600, reasonCode: preset.code, lossClass: "SETUP" as const, ...over,
  });
  await prisma.machineStopEvent.create({ data: stopData({}) });
  await prisma.machineStopEvent.create({ data: stopData({ revokedAt: new Date(), revokeReason: "TEST", startedAt: new Date(S0.getTime() + 3 * 3600_000), endedAt: new Date(S0.getTime() + 4 * 3600_000) }) });
  await prisma.machineStopEvent.create({ data: stopData({ machineId: m2.id, startedAt: new Date(S0.getTime() + 5 * 3600_000), endedAt: new Date(S0.getTime() + 6 * 3600_000) }) });
  await prisma.machineRun.create({ data: { machineId: m.id, startedAt: S0, endedAt: new Date(S1.getTime() - 60_000), picksAtClose: 100_000, targetUnitsPerMin: 500, closedTermsAt: new Date(), producedM: "123.456" } });

  const input = await loadShiftTermsInput(prisma, m.id, sh.id);
  check("§10a yükleyici: geri alınmış ve başka makinenin duruşu HARİÇ (1 duruş)", input.stops.length === 1);
  check("§10b ⭐ sebep etiketi katalogdan KOPYA", input.stops[0]?.reasonLabel === preset.label && input.window.plannedBreakMinutes === 30);
  check("§10c koşum Decimal → sayı (producedM 123.456)", input.runs.length === 1 && input.runs[0]?.producedM === 123.456);
  const terms = await computeShiftTerms(prisma, m.id, sh.id);
  check("§10d terimler: SETUP 3600, POT 28800−1800, atkı 100000, producedM 123.456", terms.setupSec === 3600 && terms.potSec === 27_000 && terms.unitsActual === 100_000 && terms.producedM === 123.456, `${terms.setupSec}/${terms.potSec}/${terms.unitsActual}`);

  const ymd = factoryYmd(new Date(gun.getTime() + 12 * 3600_000));
  const list = await listShiftStats({ from: ymd, to: ymd });
  const mids = [m.id, m2.id, mOff.id];
  const mine = list.data.filter((r) => r.shiftInstanceId === sh.id && mids.includes(r.machineId));
  check("§10e ⭐ liste: WEAVING istasyonundaki AKTİF tezgah var, PROCESS_QC makinesi ve pasif tezgah YOK", mine.length === 1 && mine[0]?.machineId === m.id, `${mine.length} satır: ${mine.map((r) => r.machine.code).join(",")}`);
  check("§10f satır `live`, OPEN, terimler + oranlar + source OPERATOR", mine[0]?.live === true && mine[0]?.sealState === "OPEN" && mine[0]?.terms.source === "OPERATOR" && mine[0]?.kpis.availabilityPct !== null);
  check("§10g meta.total = vardiya × tezgah, kırpılmadı", list.meta.total >= 1 && list.meta.truncated === false && list.meta.live >= 1);

  // Mühürlü satır (Dilim 3'ün yazarı yok — fikstür yazar): DB'den, `live:false`, terimler DB'dekiler.
  const stat = await prisma.machineShiftStat.create({
    data: { machineId: m.id, shiftInstanceId: sh.id, factoryDay: gun, stopThresholdSec: 20, source: "SUPERVISOR", monitoringState: "OFF", potSec: 100, aptSec: 50, unitsActual: 7, sealState: "SEALED", sealGeneration: 1, sealedAt: new Date() },
  });
  ids.stat = stat.id;
  const list2 = await listShiftStats({ from: ymd, to: ymd, machineId: m.id });
  const row = list2.data.find((r) => r.shiftInstanceId === sh.id);
  check("§10h ⭐ mühürlü satır DB'den: live:false, POT 100 (anlık 27000 DEĞİL), source SUPERVISOR", row?.live === false && row?.sealState === "SEALED" && row?.terms.potSec === 100 && row?.terms.source === "SUPERVISOR" && row?.kpis.availabilityPct === 50);
  const list3 = await listShiftStats({ from: ymd, to: ymd, machineId: m.id, sealState: "OPEN" });
  check("§10i sealState=OPEN süzgeci mühürlüyü düşürür (sunucuda)", !list3.data.some((r) => r.shiftInstanceId === sh.id));
}

async function cleanup(): Promise<void> {
  try {
    if (ids.stat) await prisma.machineShiftStat.deleteMany({ where: { id: ids.stat } });
    const mids = [ids.machine, ids.machine2, ids.machineOff].filter(Boolean);
    const stops = await prisma.machineStopEvent.findMany({ where: { machineId: { in: mids } }, select: { id: true } });
    const sid = stops.map((s) => s.id);
    await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
    await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
    await prisma.machineRun.deleteMany({ where: { machineId: { in: mids } } });
    if (ids.preset) await prisma.reasonPreset.deleteMany({ where: { id: ids.preset } });
    await prisma.shiftInstance.deleteMany({ where: { id: { in: [ids.shift, ids.shiftNext].filter(Boolean) } } });
    if (ids.def) await prisma.shiftDefinition.deleteMany({ where: { id: ids.def } });
    await prisma.machine.deleteMany({ where: { id: { in: mids } } });
    await prisma.station.deleteMany({ where: { id: { in: [ids.station, ids.station2].filter(Boolean) } } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

pure()
  .then(db)
  .catch((e) => { fail++; console.error("❌ Bekçi hata ile durdu:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
