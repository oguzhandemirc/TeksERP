// =============================================================================
// Vardiya karnesi MÜHÜR bekçisi — M2 kapanış job'u · M3 elle düzeltme · M4 mühür · M5 mühür açma ·
// M6 mühür sınırı (`assertStopShiftWritableTx`) — dokuma raporları Dilim 3
// =============================================================================
// Koşum: npx tsx scripts/test_machine_shift_seal.ts   (DB'li; TEST- fikstürü; `dokuma.enabled` geçici)
//
// Ölçer (özet §4 M2–M6, §6 kapanış ölçütleri 1–3):
//   §0 statik — mühür kapısı `machineShiftStat.findUnique` + SHIFT_SEALED taşıyor; `sealedAt: null` yazımı src'de YOK
//   §1 M2: bayrak kapalı → "disabled" + satır yok; açık → OPEN satır (factoryDay kopya, terimler);
//      ikinci koşum yeniden hesaplar, ikinci satır doğmaz
//   §2 M3: OPEN karnede terim düzeltme → source SUPERVISOR, POT/APT/kapasite yeniden; M2 artık dokunmaz
//   §3 M4: claim OPEN→SEALED (gen 1, sealedAt, oranlar denormalize), kırılım kuşak 1, Seal(SEAL);
//      ikinci mühür 409 SHIFT_SEAL_RACE; M3 mühürlüde 409 SHIFT_SEALED; M2 mühürlüyü atlar
//   §4 M6: mühürlü vardiyada duruş aç/kapa/sınıfla/yeniden sınıfla/geri al → 409 SHIFT_SEALED
//   §5 M5: gerekçesiz 400; açma claim SEALED→OPEN, gen KALIR, `sealedAt` KALIR, Seal(UNSEAL);
//      ikinci açma 409 SHIFT_NOT_SEALED; açıkken duruş yolu yeniden çalışır; RESEAL gen 2,
//      kırılım kuşak 1 DURUR + kuşak 2 doğar; doğal anahtar (statId, gen, action) P2002
//   §6 yarış: iki paralel mühür → tam BİRİ 200, öteki 409
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-09-14):
//   · `assertStopShiftWritableTx`ten sealState okuması düşürülünce §4a–§4e ❌
//   · mühür claim'inden `sealState: "OPEN"` düşürülünce §3f (ikinci mühür) ❌ ve §6 ❌
//   · unseal'de `sealedAt: null` yazılınca §0b + §5c ❌
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MachineDataSource, Prisma, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { classifyStop, closeManualStop, openManualStop, reclassifyStop, revokeStop } from "../src/services/machine-stop.service";
import { correctShiftTerms, listShiftSeals, sealShiftStat, unsealShiftStat } from "../src/services/machine-shift-seal.service";
import { runShiftCloseOnce } from "../src/jobs/machine-shift-close.job";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function hata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e : null; }
}
const kod = (e: AppError | null): string => String(e?.details?.code ?? e?.statusCode ?? "yok");

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
const ids = { station: "", machine: "", def: "", shift: "", preset: "", preset2: "", stat: "" };

function walk(dir: string, out: string[] = []): string[] {
  for (const ad of readdirSync(dir)) {
    const p = join(dir, ad);
    if (statSync(p).isDirectory()) walk(p, out); else if (ad.endsWith(".ts")) out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  console.log("\n=== Vardiya karnesi MÜHÜR — M2/M3/M4/M5/M6, claim'ler, kuşaklar, yarış ===\n");

  // ── §0 statik ─────────────────────────────────────────────────────────────
  const KOK = join(__dirname, "..");
  const kapi = readFileSync(join(KOK, "src/services/helpers/machine-stop-context.helper.ts"), "utf8");
  check("§0a mühür kapısı `machineShiftStat.findUnique` + SHIFT_SEALED taşıyor", /machineShiftStat\.findUnique/.test(kapi) && /SHIFT_SEALED/.test(kapi));
  const sealedAtNull = walk(join(KOK, "src")).filter((f) => /sealedAt:\s*null\b/.test(readFileSync(f, "utf8").replace(/\/\/[^\n]*/g, "")));
  check("§0b ⭐ `sealedAt: null` yazımı src'de YOK (ileri damga null'lanmaz)", sealedAtNull.length === 0, sealedAtNull.join(", "));

  // ── fikstür ───────────────────────────────────────────────────────────────
  const st = await prisma.station.create({ data: { name: `TEST-SS-IST-${ek}`, code: `TEST-SS-S-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
  ids.station = st.id;
  const m = await prisma.machine.create({ data: { stationId: st.id, name: `TEST-SS-TEZ-${ek}`, code: `TEST-SS-M-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machine = m.id;
  const def = await prisma.shiftDefinition.create({ data: { code: `S${ek}`.toUpperCase().slice(0, 8), name: `TEST-SS vardiya ${ek}`, startMinute: 0, durationMinutes: 480 } });
  ids.def = def.id;
  // 6 gün önce (amir damgası 7 gün sınırı içinde; başka fikstürlerin penceresinden uzak)
  const S0 = new Date(Date.now() - 6 * 86_400_000 - 2 * 3600_000);
  const S1 = new Date(S0.getTime() + 8 * 3600_000);
  const sh = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: factoryDayKeyUtcMidnight(S0), startsAt: S0, endsAt: S1 } });
  ids.shift = sh.id;
  const preset = await prisma.reasonPreset.create({ data: { kind: ReasonPresetKind.MACHINE_STOP, code: `TEST_SS_${ek}`.toUpperCase().slice(0, 64), label: `TEST-SS sebep ${ek}`, stopLossClass: "SETUP", sortOrder: 999 } });
  ids.preset = preset.id;
  const preset2 = await prisma.reasonPreset.create({ data: { kind: ReasonPresetKind.MACHINE_STOP, code: `TEST_SS2_${ek}`.toUpperCase().slice(0, 64), label: `TEST-SS sebep2 ${ek}`, stopLossClass: "UNPLANNED", sortOrder: 999 } });
  ids.preset2 = preset2.id;
  // Duruşlar üretim yolundan (mühür kapısı OPEN'da geçer): sınıflı 1 sa SETUP + sınıfsız 10 dk + AÇIK bir tane.
  const d1 = await openManualStop({ machineId: m.id, startedAt: new Date(S0.getTime() + 3600_000), reasonCode: preset.code, source: "SUPERVISOR" }, undefined);
  await closeManualStop(d1.data.id, new Date(S0.getTime() + 2 * 3600_000), undefined);
  const d2 = await openManualStop({ machineId: m.id, startedAt: new Date(S0.getTime() + 3 * 3600_000), source: "SUPERVISOR" }, undefined);
  await closeManualStop(d2.data.id, new Date(S0.getTime() + 3 * 3600_000 + 600_000), undefined);
  const dAcik = await openManualStop({ machineId: m.id, startedAt: new Date(S0.getTime() + 5 * 3600_000), source: "SUPERVISOR" }, undefined);
  check("fikstür: duruşlar bu vardiyaya bağlandı", d1.data.shiftInstanceId === sh.id && dAcik.data.shiftInstanceId === sh.id);
  await prisma.machineRun.create({ data: { machineId: m.id, startedAt: S0, endedAt: new Date(S1.getTime() - 60_000), picksAtClose: 100_000, targetPicksPerMin: 500, closedTermsAt: new Date() } });
  const scope = { onlyShiftInstanceIds: [sh.id], onlyMachineIds: [m.id] };

  // ── §1 M2 ─────────────────────────────────────────────────────────────────
  await setFlag(false);
  const kapali = await runShiftCloseOnce(scope);
  check("§1a bayrak KAPALI → 'disabled'", kapali === "disabled");
  check("§1b kapalıyken karne satırı DOĞMAZ", (await prisma.machineShiftStat.count({ where: { machineId: m.id } })) === 0);
  await setFlag(true);
  const r1 = await runShiftCloseOnce(scope);
  if (r1 === "disabled") throw new Error("disabled");
  const stat = await prisma.machineShiftStat.findUniqueOrThrow({ where: { machineId_shiftInstanceId: { machineId: m.id, shiftInstanceId: sh.id } } });
  ids.stat = stat.id;
  check("§1c ⭐ açıkken OPEN satır doğdu (created 1)", r1.created === 1 && stat.sealState === "OPEN" && stat.sealGeneration === 0, JSON.stringify(r1));
  check("§1d factoryDay = ShiftInstance.factoryDayKey KOPYASI", stat.factoryDay.getTime() === sh.factoryDayKey.getTime());
  // Sınıfsız iki duruş: kapalı 600 sn + AÇIK olan pencere sonuna kadar (5 sa → 8 sa = 10800) ⇒ UNPLANNED = unclassified = 11400.
  check("§1e terimler: SETUP 3600 · sınıfsız 11400 UNPLANNED (=unclassified) · atkı 100000 · source OPERATOR (terime elle dokunulmadı)",
    stat.setupSec === 3600 && stat.unplannedDownSec === 11_400 && stat.unclassifiedSec === 11_400 && stat.picksActual === 100_000 && stat.source === "OPERATOR", `${stat.setupSec}/${stat.unplannedDownSec}/${stat.unclassifiedSec}/${stat.source}`);
  const r2 = await runShiftCloseOnce(scope);
  check("§1f ikinci koşum yeniden hesaplar, ikinci satır doğmaz", r2 !== "disabled" && r2.recomputed === 1 && r2.created === 0 && (await prisma.machineShiftStat.count({ where: { machineId: m.id } })) === 1);

  // ── §2 M3 ─────────────────────────────────────────────────────────────────
  await correctShiftTerms(stat.id, { picksActual: 120_000, targetPicksPerMin: 500, plannedDownSec: 1200 });
  const s2 = await prisma.machineShiftStat.findUniqueOrThrow({ where: { id: stat.id } });
  check("§2a ⭐ düzeltme → source SUPERVISOR, atkı 120000, POT sabit, APT yeniden (PLANNED 1200 düştü)", s2.source === "SUPERVISOR" && s2.picksActual === 120_000 && s2.potSec === stat.potSec && s2.aptSec === stat.aptSec - 1200, `${s2.aptSec} ↔ ${stat.aptSec}`);
  check("§2b kapasite tek hedeften yeniden: 500×APT/60", s2.targetPickCapacityApt === Math.round((500 * s2.aptSec) / 60) && s2.targetPickCapacityPot === Math.round((500 * s2.potSec) / 60));
  const r3 = await runShiftCloseOnce(scope);
  const s2b = await prisma.machineShiftStat.findUniqueOrThrow({ where: { id: stat.id } });
  check("§2c ⭐ M2 elle düzeltilmiş satıra DOKUNMAZ (skipped-supervisor 1, atkı 120000 kaldı)", r3 !== "disabled" && r3["skipped-supervisor"] === 1 && s2b.picksActual === 120_000);

  // ── §3 M4 ─────────────────────────────────────────────────────────────────
  const m4 = await sealShiftStat(stat.id, undefined);
  const s3 = await prisma.machineShiftStat.findUniqueOrThrow({ where: { id: stat.id } });
  check("§3a ⭐ mühür: SEALED, gen 1, sealedAt dolu, action SEAL", s3.sealState === "SEALED" && s3.sealGeneration === 1 && s3.sealedAt !== null && m4.data.action === "SEAL");
  check("§3b oranlar denormalize (A/P/E + formulaVersion 1)", s3.availabilityPct !== null && s3.performancePct !== null && s3.effectivenessPct !== null && s3.formulaVersion === 1, `${s3.availabilityPct}/${s3.performancePct}/${s3.effectivenessPct}`);
  const bd1 = await prisma.machineShiftStopBreakdown.findMany({ where: { statId: stat.id, sealGeneration: 1 } });
  check("§3c kırılım kuşak 1: SETUP satırı (etiket KOPYA) + sınıfsız kova (reasonCode NULL) + açık duruş", bd1.length >= 2 && bd1.some((b) => b.reasonCode === preset.code && b.reasonLabel === preset.label && b.lossClass === "SETUP") && bd1.some((b) => b.reasonCode === null), String(bd1.length));
  const seals1 = await listShiftSeals(stat.id);
  check("§3d Seal defteri: (gen 1, SEAL) terim fotoğrafı stored POT ile birebir", seals1.data.length === 1 && seals1.data[0]?.action === "SEAL" && seals1.data[0]?.potSec === s3.potSec && seals1.data[0]?.picksActual === 120_000);
  const e3 = await hata(() => sealShiftStat(stat.id, undefined));
  check("§3f ⭐ ikinci mühür 409 SHIFT_SEAL_RACE", kod(e3) === "SHIFT_SEAL_RACE", kod(e3));
  const e3b = await hata(() => correctShiftTerms(stat.id, { picksActual: 1 }));
  check("§3g mühürlüde M3 düzeltme 409 SHIFT_SEALED", kod(e3b) === "SHIFT_SEALED", kod(e3b));
  const r4 = await runShiftCloseOnce(scope);
  check("§3h M2 mühürlü satırı atlar", r4 !== "disabled" && r4["skipped-sealed"] === 1);

  // ── §4 M6 ─────────────────────────────────────────────────────────────────
  const e4a = await hata(() => closeManualStop(dAcik.data.id, new Date(S0.getTime() + 6 * 3600_000), undefined));
  check("§4a ⭐ mühürlü vardiyada duruş KAPAMA 409 SHIFT_SEALED", kod(e4a) === "SHIFT_SEALED", kod(e4a));
  const e4b = await hata(() => classifyStop(d2.data.id, { reasonCode: preset2.code }, undefined));
  check("§4b mühürlü vardiyada SINIFLAMA 409 SHIFT_SEALED", kod(e4b) === "SHIFT_SEALED", kod(e4b));
  const e4c = await hata(() => reclassifyStop(d1.data.id, { fromReasonCode: preset.code, toReasonCode: preset2.code, reason: "TEST" }, undefined));
  check("§4c mühürlü vardiyada YENİDEN SINIFLAMA 409 SHIFT_SEALED", kod(e4c) === "SHIFT_SEALED", kod(e4c));
  const e4d = await hata(() => revokeStop(d1.data.id, "TEST geri al", undefined));
  check("§4d mühürlü vardiyada GERİ ALMA 409 SHIFT_SEALED", kod(e4d) === "SHIFT_SEALED", kod(e4d));
  // Açılış: mühürlü pencereye yeni duruş — açık duruş seddi önce takılmasın diye başka an değil, aynı makinede AÇIK duruş var;
  // kapı sed'den ÖNCE koşar (assertStopShiftWritableTx açılışta ilk kapı) ⇒ SHIFT_SEALED beklenir.
  const e4e = await hata(() => openManualStop({ machineId: m.id, startedAt: new Date(S0.getTime() + 7 * 3600_000), source: "SUPERVISOR" }, undefined));
  check("§4e mühürlü vardiyada duruş AÇMA 409 SHIFT_SEALED", kod(e4e) === "SHIFT_SEALED", kod(e4e));

  // ── §5 M5 ─────────────────────────────────────────────────────────────────
  const e5 = await hata(() => unsealShiftStat(stat.id, "ab", undefined));
  check("§5a gerekçe < 3 → 400 UNSEAL_REASON_REQUIRED", kod(e5) === "UNSEAL_REASON_REQUIRED", kod(e5));
  await unsealShiftStat(stat.id, "geç gelen sınıflandırma", undefined);
  const s5 = await prisma.machineShiftStat.findUniqueOrThrow({ where: { id: stat.id } });
  check("§5b ⭐ açma: OPEN, gen 1 KALIR", s5.sealState === "OPEN" && s5.sealGeneration === 1);
  check("§5c ⭐ `sealedAt` NULL'LANMADI (en son ne zaman mühürlendi)", s5.sealedAt !== null && s5.sealedAt.getTime() === s3.sealedAt!.getTime());
  const seals2 = await listShiftSeals(stat.id);
  check("§5d Seal defteri: (gen 1, UNSEAL) gerekçeyle", seals2.data.some((r) => r.action === "UNSEAL" && r.sealGeneration === 1 && r.reason === "geç gelen sınıflandırma"));
  const e5b = await hata(() => unsealShiftStat(stat.id, "ikinci kez", undefined));
  check("§5e ikinci açma 409 SHIFT_NOT_SEALED", kod(e5b) === "SHIFT_NOT_SEALED", kod(e5b));
  const c5 = await classifyStop(d2.data.id, { reasonCode: preset2.code }, undefined);
  check("§5f açıkken duruş yolu yeniden çalışır (sınıfsız duruş sınıflandı)", c5.data.reasonCode === preset2.code);
  await closeManualStop(dAcik.data.id, new Date(S0.getTime() + 6 * 3600_000), undefined);
  await classifyStop(dAcik.data.id, { reasonCode: preset2.code }, undefined);
  const m5 = await sealShiftStat(stat.id, undefined);
  const s5b = await prisma.machineShiftStat.findUniqueOrThrow({ where: { id: stat.id } });
  check("§5g ⭐ yeniden mühür: RESEAL, gen 2, sealedAt ilerledi", m5.data.action === "RESEAL" && s5b.sealGeneration === 2 && s5b.sealedAt!.getTime() >= s3.sealedAt!.getTime());
  const bd1b = await prisma.machineShiftStopBreakdown.count({ where: { statId: stat.id, sealGeneration: 1 } });
  const bd2 = await prisma.machineShiftStopBreakdown.findMany({ where: { statId: stat.id, sealGeneration: 2 } });
  const p2Row = bd2.find((b) => b.reasonCode === preset2.code);
  check("§5h ⭐ kırılım kuşak 1 DURUR, kuşak 2 doğar (sınıfsız kova yok; UNPLANNED sebebi 2 duruş TEK satırda)", bd1b === bd1.length && bd2.length === 2 && !bd2.some((b) => b.reasonCode === null) && p2Row?.stopCount === 2 && p2Row.lossClass === "UNPLANNED", `${bd1b}/${bd2.length}`);
  const e5c = await hata(async () => {
    try {
      await prisma.machineShiftStatSeal.create({ data: { statId: stat.id, action: "RESEAL", sealGeneration: 2, terms: {}, potSec: 0, aptSec: 0, picksActual: 0, targetPickCapacityPot: 0, formulaVersion: 1 } });
    } catch (e) { throw e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" ? AppError.conflict("P2002", { code: "P2002" }) : e; }
  });
  check("§5i doğal anahtar (statId, gen, action) sed: mükerrer RESEAL P2002", kod(e5c) === "P2002");
  const seals3 = await listShiftSeals(stat.id);
  check("§5j Seal defteri kronolojik 3 satır: SEAL(1) · UNSEAL(1) · RESEAL(2)", seals3.data.map((r) => `${r.action}${r.sealGeneration}`).join(",") === "SEAL1,UNSEAL1,RESEAL2", seals3.data.map((r) => `${r.action}${r.sealGeneration}`).join(","));

  // ── §6 yarış ──────────────────────────────────────────────────────────────
  await unsealShiftStat(stat.id, "yarış sondası", undefined);
  const [p1, p2] = await Promise.all([hata(() => sealShiftStat(stat.id, undefined)), hata(() => sealShiftStat(stat.id, undefined))]);
  const okSayisi = [p1, p2].filter((e) => e === null).length;
  const raceSayisi = [p1, p2].filter((e) => kod(e) === "SHIFT_SEAL_RACE").length;
  check("§6a ⭐ iki paralel mühür → tam BİRİ 200, öteki 409 SHIFT_SEAL_RACE", okSayisi === 1 && raceSayisi === 1, `${okSayisi}/${raceSayisi}`);
  const s6 = await prisma.machineShiftStat.findUniqueOrThrow({ where: { id: stat.id } });
  check("§6b gen tam 3 (yarış çift artırmadı)", s6.sealGeneration === 3 && (await prisma.machineShiftStatSeal.count({ where: { statId: stat.id, sealGeneration: 3 } })) === 1);
}

async function cleanup(): Promise<void> {
  try {
    if (ids.stat) {
      await prisma.machineShiftStopBreakdown.deleteMany({ where: { statId: ids.stat } });
      await prisma.machineShiftStatSeal.deleteMany({ where: { statId: ids.stat } });
      await prisma.machineShiftStat.deleteMany({ where: { id: ids.stat } });
    }
    if (ids.machine) {
      const stops = await prisma.machineStopEvent.findMany({ where: { machineId: ids.machine }, select: { id: true } });
      const sid = stops.map((s) => s.id);
      await prisma.machineStopReclass.deleteMany({ where: { stopEventId: { in: sid } } });
      await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
      await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
      await prisma.machineRun.deleteMany({ where: { machineId: ids.machine } });
    }
    await prisma.reasonPreset.deleteMany({ where: { id: { in: [ids.preset, ids.preset2].filter(Boolean) } } });
    if (ids.shift) await prisma.shiftInstance.deleteMany({ where: { id: ids.shift } });
    if (ids.def) await prisma.shiftDefinition.deleteMany({ where: { id: ids.def } });
    if (ids.machine) await prisma.machine.deleteMany({ where: { id: ids.machine } });
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
