// =============================================================================
// BEKÇİ — TEZGAH DURUŞU ELLE GİRİŞ (Faz 1b, 2026-09-14): aç · kapa · sınıfla ·
// yeniden sınıfla (DEFTER) · geri al (DAMGA) — tek yazıcı `machine-stop.service`
// =============================================================================
//   §1 aç: satır doğar, `requiresReason` sebepsizde true / sebepliyle lossClass KOPYA;
//      vardiya/koşum bağlamı startedAt'ten (yoksa NULL); factoryDay fabrika günü
//   §2 tek açık duruş seddi: ikinci açılış 409 STOP_ALREADY_OPEN; replay aynı token → aynı satır; farklı yük → 409 (F2)
//   §3 kapa: durationSec startedAt'ten, endSource OPERATOR; ikinci kapama 409; bitiş<başlangıç 400
//   §4 sınıfla: ilk karar claim (NULL→değer), lossClass katalogdan; ikinci sınıfla 409 STOP_ALREADY_CLASSIFIED
//   §5 yeniden sınıfla: reasonCode değişir, `MachineStopReclass` from→to satırı AYNI tx; bayat from 409;
//      olgular (startedAt/endedAt/durationSec/stopKey) DEĞİŞMEZ; karşı kayıt (to→from) ikinci satır; yeni not olayda, eski not satırda (F3)
//   §6 lossClass DONMUŞ: katalog satırının sınıfı değişse duruş satırı değişmez
//   §7 geri al: damga, satır durur; geri alınmış duruş sınıflanamaz/kapanamaz; replay 409 STOP_REVOKED;
//      geri alma seddi boşaltır — aynı makinede yeni duruş açılabilir
//   §8 iptal vardiya kapısı (tek fonksiyon `assertStopShiftWritableTx`): açılış (F1: kapsayan vardiya iptal olsa da
//      DÖNER, NULL yalnız vardiya hiç yoksa) VE sınıflama 409 SHIFT_CANCELLED
//   §9 liste: açık + kuyruk yüklemi (boğaz ikizi `CLASSIFICATION_QUEUE_WHERE`)
//   §10 defter-beyan çapası: yazan/tersYazan sembolleri gerçek (beyan 82 ile aynı trende)
//   §11 BEFORE DELETE seddi (migration 20260914091000): insan kararlı duruş DELETE → RAISE; sınıfsız silinir
//   §12 YUVA (F4, `Machine.warpBeamSlots`): tek yuvada beamSlot 400 · aralık dışı 400 · uygun yazılır · CHECK >= 0
//
// NEGATİF SONDALAR (2026-09-14, cp+sha256): reclassify'dan defter satırı kaldırıldı → §5b/§5e ❌ ·
// classify claim'inden `reasonCode: null` düşürüldü → §4c ❌ (ikinci sınıflandırma yerinde ezdi).
// =============================================================================
import { MachineDataSource, ReasonPresetKind } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { classifyStop, closeManualStop, openManualStop, reclassifyStop, revokeStop } from "../src/services/machine-stop.service";
import { CLASSIFICATION_QUEUE_WHERE, listMachineStops } from "../src/services/loom-list.service";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
async function hata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e : null;
  }
}
const kod = (e: AppError | null): string => String(e?.details?.code ?? e?.statusCode ?? "yok");

const ek = Date.now().toString(36);
const ids = { station: "", makine: "", makine2: "", makine3: "", shiftDef: "", shift: "", shiftCancelled: "", preset: "", stops: [] as string[] };

async function main(): Promise<void> {
  console.log("\n=== Tezgah duruşu ELLE GİRİŞ — tek yazıcı, claim'ler, reclass defteri, damga ===\n");
  const S0 = new Date(Date.now() - 3 * 3600_000);
  const S1 = new Date(Date.now() - 2 * 3600_000);

  const station = await prisma.station.create({
    data: { name: `TEST-MS-IST-${ek}`, code: `TEST-MS-S-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "PROCESS_QC", isActive: true },
  });
  ids.station = station.id;
  const makine = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-MS-MAK-${ek}`, code: `TEST-MS-M-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.makine = makine.id;
  const makine2 = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-MS-MAK2-${ek}`, code: `TEST-MS-M2-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.makine2 = makine2.id;
  const makine3 = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-MS-MAK3-${ek}`, code: `TEST-MS-M3-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.makine3 = makine3.id;
  // Vardiya: S0'ı kapsayan bir örnek + iptal edilmiş bir örnek (§8)
  const shiftDef = await prisma.shiftDefinition.create({
    data: { code: `T${ek}`.toUpperCase().slice(0, 8), name: `TEST-MS vardiya ${ek}`, startMinute: 0, durationMinutes: 60 * 8 },
  });
  ids.shiftDef = shiftDef.id;
  const gunBasi = factoryDayKeyUtcMidnight(S0);
  const shift = await prisma.shiftInstance.create({
    data: { shiftDefinitionId: shiftDef.id, factoryDayKey: gunBasi, startsAt: new Date(S0.getTime() - 3600_000), endsAt: new Date(S0.getTime() + 3600_000) },
  });
  ids.shift = shift.id;
  const shiftCancelled = await prisma.shiftInstance.create({
    data: {
      shiftDefinitionId: shiftDef.id,
      factoryDayKey: new Date(gunBasi.getTime() - 86_400_000),
      startsAt: new Date(S1.getTime() - 7 * 3600_000),
      endsAt: new Date(S1.getTime() - 5 * 3600_000),
      isCancelled: true,
      cancelReason: "bekçi §8",
    },
  });
  ids.shiftCancelled = shiftCancelled.id;
  const presetCount = await prisma.reasonPreset.count({ where: { kind: ReasonPresetKind.MACHINE_STOP, isActive: true } });
  check("§0 katalog: aktif MACHINE_STOP preset var (uzlaştırma koşmuş)", presetCount >= 20, `${presetCount}`);

  // ── §1 aç ────────────────────────────────────────────────────────────────
  const token = crypto.randomUUID();
  const a1 = await openManualStop({ machineId: makine.id, startedAt: S0, clientToken: token, source: MachineDataSource.SUPERVISOR }, undefined);
  ids.stops.push(a1.data.id);
  check("§1a sebepsiz açılış: requiresReason true, reasonCode/lossClass NULL", a1.data.requiresReason && a1.data.reasonCode === null && a1.data.lossClass === null);
  check("§1b bağlam startedAt'ten: shiftInstanceId = kapsayan vardiya, factoryDay = fabrika günü", a1.data.shiftInstanceId === shift.id && a1.data.factoryDay.getTime() === gunBasi.getTime(), `${a1.data.shiftInstanceId} / ${a1.data.factoryDay.toISOString()}`);
  check("§1c stopKey = clientToken, source SUPERVISOR, endedAt NULL", a1.data.stopKey === token && a1.data.source === MachineDataSource.SUPERVISOR && a1.data.endedAt === null);
  const a2 = await openManualStop({ machineId: makine2.id, startedAt: S0, reasonCode: "COZGU_KOPUSU" }, undefined);
  ids.stops.push(a2.data.id);
  check("§1d sebepli açılış: lossClass katalogdan KOPYA (UNPLANNED), requiresReason false, classifiedAt dolu", a2.data.reasonCode === "COZGU_KOPUSU" && a2.data.lossClass === "UNPLANNED" && !a2.data.requiresReason && a2.data.classifiedAt !== null);
  const kotu = await hata(() => openManualStop({ machineId: makine.id, startedAt: S1, reasonCode: "YOK_BOYLE_KOD" }, undefined));
  check("§1e geçersiz sebep kodu 400 REASON_CODE_INVALID", kotu?.statusCode === 400 && kod(kotu) === "REASON_CODE_INVALID", kod(kotu));

  // ── §2 sed + replay ──────────────────────────────────────────────────────
  const ikinci = await hata(() => openManualStop({ machineId: makine.id, startedAt: S1 }, undefined));
  check("§2a aynı makinede ikinci açık duruş 409 STOP_ALREADY_OPEN (DB seddi)", ikinci?.statusCode === 409 && kod(ikinci) === "STOP_ALREADY_OPEN", kod(ikinci));
  const replay = await openManualStop({ machineId: makine.id, startedAt: S0, clientToken: token }, undefined);
  check("§2b replay aynı token → aynı satır (yeni satır yok)", replay.data.id === a1.data.id && (await prisma.machineStopEvent.count({ where: { machineId: makine.id } })) === 1);
  const sahte = await hata(() => openManualStop({ machineId: makine.id, startedAt: new Date(S0.getTime() + 60_000), clientToken: token }, undefined));
  check("§2c replay PARMAK İZİ: aynı token, farklı startedAt → 409 CLIENT_TOKEN_COLLISION (F2)", sahte?.statusCode === 409 && kod(sahte) === "CLIENT_TOKEN_COLLISION", kod(sahte));

  // ── §3 kapa ──────────────────────────────────────────────────────────────
  const geri = await hata(() => closeManualStop(a1.data.id, new Date(S0.getTime() - 60_000), undefined));
  check("§3a bitiş < başlangıç 400 STOP_END_BEFORE_START", geri?.statusCode === 400 && kod(geri) === "STOP_END_BEFORE_START", kod(geri));
  const k1 = await closeManualStop(a1.data.id, S1, undefined);
  check("§3b kapandı: durationSec = 3600, endSource OPERATOR", k1.data.durationSec === 3600 && k1.data.endSource === "OPERATOR" && k1.data.endedAt?.getTime() === S1.getTime(), `${k1.data.durationSec}`);
  const k2 = await hata(() => closeManualStop(a1.data.id, S1, undefined));
  check("§3c ikinci kapama 409 STOP_ALREADY_CLOSED (claim)", k2?.statusCode === 409 && kod(k2) === "STOP_ALREADY_CLOSED", kod(k2));

  // ── §4 sınıfla ───────────────────────────────────────────────────────────
  const s1 = await classifyStop(a1.data.id, { reasonCode: "MEKANIK_ARIZA", reasonNote: "bekçi §4" }, undefined);
  check("§4a ilk sınıflandırma: reasonCode + lossClass KOPYA (UNPLANNED) + classifiedAt", s1.data.reasonCode === "MEKANIK_ARIZA" && s1.data.lossClass === "UNPLANNED" && s1.data.classifiedAt !== null);
  check("§4b kuyruk yüklemi: sınıflanınca kuyruktan düştü", (await prisma.machineStopEvent.count({ where: { id: a1.data.id, ...CLASSIFICATION_QUEUE_WHERE } })) === 0);
  const s2 = await hata(() => classifyStop(a1.data.id, { reasonCode: "TEMIZLIK" }, undefined));
  check("§4c ikinci 'sınıfla' 409 STOP_ALREADY_CLASSIFIED — yerinde ezme YOK", s2?.statusCode === 409 && kod(s2) === "STOP_ALREADY_CLASSIFIED", kod(s2));
  const hala = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: a1.data.id }, select: { reasonCode: true } });
  check("§4d karar yerinde: hâlâ MEKANIK_ARIZA", hala.reasonCode === "MEKANIK_ARIZA");

  // ── §5 yeniden sınıfla — DEFTER ─────────────────────────────────────────
  const once = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: a1.data.id }, select: { startedAt: true, endedAt: true, durationSec: true, stopKey: true } });
  const bayat = await hata(() => reclassifyStop(a1.data.id, { fromReasonCode: "TEMIZLIK", toReasonCode: "PLANLI_BAKIM" }, undefined));
  check("§5a bayat from → 409 STOP_RECLASS_STALE (kayıtlı karar üzerine yazılmadı)", bayat?.statusCode === 409 && kod(bayat) === "STOP_RECLASS_STALE", kod(bayat));
  const r1 = await reclassifyStop(a1.data.id, { fromReasonCode: "MEKANIK_ARIZA", toReasonCode: "PLANLI_BAKIM", reason: "bekçi §5: aslında bakımmış" }, undefined);
  check("§5b karar değişti: PLANLI_BAKIM / PLANNED", r1.data.reasonCode === "PLANLI_BAKIM" && r1.data.lossClass === "PLANNED");
  const defter = await prisma.machineStopReclass.findMany({ where: { stopEventId: a1.data.id }, orderBy: { createdAt: "asc" } });
  check("§5c ⭐ DEFTER satırı: from MEKANIK_ARIZA/UNPLANNED → to PLANLI_BAKIM/PLANNED", defter.length === 1 && defter[0]!.fromReasonCode === "MEKANIK_ARIZA" && defter[0]!.toReasonCode === "PLANLI_BAKIM" && defter[0]!.fromLossClass === "UNPLANNED" && defter[0]!.toLossClass === "PLANNED", JSON.stringify(defter.map((d) => [d.fromReasonCode, d.toReasonCode])));
  const sonra = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: a1.data.id }, select: { startedAt: true, endedAt: true, durationSec: true, stopKey: true } });
  check("§5d olgular DEĞİŞMEDİ (startedAt/endedAt/durationSec/stopKey)", JSON.stringify(once) === JSON.stringify(sonra));
  const r2 = await reclassifyStop(a1.data.id, { fromReasonCode: "PLANLI_BAKIM", toReasonCode: "MEKANIK_ARIZA", reason: "bekçi §5: karşı kayıt" }, undefined);
  const defter2 = await prisma.machineStopReclass.findMany({ where: { stopEventId: a1.data.id }, orderBy: { createdAt: "asc" } });
  check("§5e ⭐ karşı kayıt: to→from İKİNCİ satır, ilki değişmedi (ters yol = aynı fonksiyon)", r2.data.reasonCode === "MEKANIK_ARIZA" && defter2.length === 2 && defter2[0]!.id === defter[0]!.id && defter2[1]!.fromReasonCode === "PLANLI_BAKIM" && defter2[1]!.toReasonCode === "MEKANIK_ARIZA");
  const r3 = await reclassifyStop(a1.data.id, { fromReasonCode: "MEKANIK_ARIZA", toReasonCode: "ELEKTRIK_ARIZA", reason: "bekçi §5h", reasonNote: "yeni not §5h" }, undefined);
  const son3 = await prisma.machineStopReclass.findFirst({ where: { stopEventId: a1.data.id }, orderBy: { createdAt: "desc" }, select: { reason: true } });
  check("§5h reclass NOTU (F3): olayda yeni not, ESKİ not reclass satırında saklanır — yerinde ezme yok", r3.data.reasonNote === "yeni not §5h" && (son3?.reason ?? "").includes("bekçi §5h") && (son3?.reason ?? "").includes("eski not: bekçi §4"), `olay=${r3.data.reasonNote} · satır=${son3?.reason}`);
  await reclassifyStop(a1.data.id, { fromReasonCode: "ELEKTRIK_ARIZA", toReasonCode: "MEKANIK_ARIZA", reason: "bekçi §5h geri" }, undefined);
  const noop = await hata(() => reclassifyStop(a1.data.id, { fromReasonCode: "MEKANIK_ARIZA", toReasonCode: "MEKANIK_ARIZA" }, undefined));
  check("§5f aynı koda yeniden sınıflama 400 STOP_RECLASS_NOOP", noop?.statusCode === 400 && kod(noop) === "STOP_RECLASS_NOOP", kod(noop));
  const sinifsiz = await openManualStop({ machineId: makine.id, startedAt: S1, clientToken: crypto.randomUUID() }, undefined);
  ids.stops.push(sinifsiz.data.id);
  const erken = await hata(() => reclassifyStop(sinifsiz.data.id, { fromReasonCode: "MOLA", toReasonCode: "TEMIZLIK" }, undefined));
  check("§5g sınıflanmamış duruşa reclass 409 STOP_NOT_CLASSIFIED", erken?.statusCode === 409 && kod(erken) === "STOP_NOT_CLASSIFIED", kod(erken));

  // ── §6 lossClass donmuş ───────────────────────────────────────────────────
  const preset = await prisma.reasonPreset.create({
    data: { kind: ReasonPresetKind.MACHINE_STOP, code: `TEST_MS_${ek}`.toUpperCase().slice(0, 64), label: `TEST-MS sebep ${ek}`, stopLossClass: "SETUP", sortOrder: 999 },
  });
  ids.preset = preset.id;
  await closeManualStop(sinifsiz.data.id, new Date(S1.getTime() + 600_000), undefined);
  const s6 = await classifyStop(sinifsiz.data.id, { reasonCode: preset.code }, undefined);
  await prisma.reasonPreset.update({ where: { id: preset.id }, data: { stopLossClass: "PLANNED" } });
  const donmus = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: sinifsiz.data.id }, select: { lossClass: true } });
  check("§6 lossClass KOPYA DONMUŞ: katalog SETUP→PLANNED olsa da satır SETUP", s6.data.lossClass === "SETUP" && donmus.lossClass === "SETUP", `${donmus.lossClass}`);

  // ── §7 geri al ────────────────────────────────────────────────────────────
  const kisa = await hata(() => revokeStop(sinifsiz.data.id, "ab", undefined));
  check("§7a gerekçe < 3 → 400", kisa?.statusCode === 400, kod(kisa));
  const rv = await revokeStop(sinifsiz.data.id, "bekçi §7: hayalet duruş", undefined);
  const durur = await prisma.machineStopEvent.findUnique({ where: { id: sinifsiz.data.id }, select: { revokedAt: true, reasonCode: true } });
  check("§7b damga: satır DURUR, revokedAt dolu, karar korunur", rv.data.revokedAt !== null && durur !== null && durur.revokedAt !== null && durur.reasonCode === preset.code);
  const rv2 = await hata(() => revokeStop(sinifsiz.data.id, "ikinci kez", undefined));
  check("§7c ikinci geri alma 409 STOP_ALREADY_REVOKED", rv2?.statusCode === 409 && kod(rv2) === "STOP_ALREADY_REVOKED", kod(rv2));
  const rc = await hata(() => reclassifyStop(sinifsiz.data.id, { fromReasonCode: preset.code, toReasonCode: "MOLA" }, undefined));
  check("§7d geri alınmış duruş yeniden sınıflanamaz 409 STOP_REVOKED", rc?.statusCode === 409 && kod(rc) === "STOP_REVOKED", kod(rc));
  const acik = await openManualStop({ machineId: makine.id, startedAt: S1, clientToken: crypto.randomUUID() }, undefined);
  ids.stops.push(acik.data.id);
  check("§7e geri alma seddi boşalttı: aynı makinede yeni duruş açıldı", acik.data.id !== sinifsiz.data.id);
  const acikRv = await revokeStop(acik.data.id, "bekçi §7e açık duruş geri", undefined);
  const yenidenAc = await hata(() => openManualStop({ machineId: makine.id, startedAt: S1, clientToken: acik.data.stopKey }, undefined));
  check("§7f geri alınmış anahtarla replay 409 STOP_REVOKED (canlıymış gibi dönmez)", acikRv.data.revokedAt !== null && yenidenAc?.statusCode === 409 && kod(yenidenAc) === "STOP_REVOKED", kod(yenidenAc));

  // ── §8 iptal vardiya kapısı (F1: kapsayan vardiya iptal olsa da DÖNER, kapı 409) ────
  const iptalAn = new Date(S1.getTime() - 6 * 3600_000);
  const iptalde = await hata(() => openManualStop({ machineId: makine3.id, startedAt: iptalAn, clientToken: crypto.randomUUID() }, undefined));
  check("§8a ⭐ AÇILIŞ: iptal edilmiş vardiyaya düşen duruş 409 SHIFT_CANCELLED (vardiya NULL'a düşmez)", iptalde?.statusCode === 409 && kod(iptalde) === "SHIFT_CANCELLED", kod(iptalde));
  // Kapama/sınıflama dalı: satır doğrudan DB'de kurulur (iptal vardiyaya bağlı), sınıflanması 409 verir.
  const dbStop = await prisma.machineStopEvent.create({
    data: { machineId: makine2.id, stopKey: crypto.randomUUID(), startedAt: S1, shiftInstanceId: shiftCancelled.id, factoryDay: gunBasi, source: MachineDataSource.SUPERVISOR, requiresReason: true, endedAt: S1 },
  });
  ids.stops.push(dbStop.id);
  const kapali = await hata(() => classifyStop(dbStop.id, { reasonCode: "MOLA" }, undefined));
  check("§8b ⭐ iptal vardiyadaki duruşun sınıflanması 409 SHIFT_CANCELLED (tek kapı: assertStopShiftWritableTx)", kapali?.statusCode === 409 && kod(kapali) === "SHIFT_CANCELLED", kod(kapali));

  // ── §9 liste ──────────────────────────────────────────────────────────────
  const l1 = await listMachineStops({ machineId: makine2.id, openOnly: true });
  check("§9a açık liste: geri alınmışlar hariç, yalnız endedAt NULL", l1.data.every((s) => s.endedAt === null && s.revokedAt === null) && l1.data.some((s) => s.id === a2.data.id));
  const l2 = await listMachineStops({ queueOnly: true, limit: 500 });
  check("§9b kuyruk: hepsi sebepsiz ∧ requiresReason ∧ geri alınmamış", l2.data.every((s) => s.reasonCode === null && s.requiresReason && s.revokedAt === null));

  // ── §11 BEFORE DELETE seddi: insan kararlı duruş SİLİNEMEZ (sınıfsız silinir) ───────
  const trg1 = await prisma.machineStopEvent.create({ data: { machineId: makine3.id, stopKey: crypto.randomUUID(), startedAt: S1, endedAt: S1, factoryDay: gunBasi, source: MachineDataSource.SUPERVISOR, reasonCode: "MOLA", lossClass: "PLANNED", reasonSource: MachineDataSource.SUPERVISOR } });
  const trg2 = await prisma.machineStopEvent.create({ data: { machineId: makine3.id, stopKey: crypto.randomUUID(), startedAt: S1, endedAt: S1, factoryDay: gunBasi, source: MachineDataSource.SUPERVISOR, requiresReason: true } });
  ids.stops.push(trg1.id, trg2.id);
  let silHata: string | null = null;
  try { await prisma.machineStopEvent.delete({ where: { id: trg1.id } }); } catch (e) { silHata = (e as Error).message; }
  check("§11a ⭐ insan kararlı duruş DELETE → DB RAISE (trigger), satır durur", silHata !== null && /silinemez|restrict/i.test(silHata) && (await prisma.machineStopEvent.count({ where: { id: trg1.id } })) === 1, silHata?.slice(0, 80) ?? "hata yok");
  let silOk = true;
  try { await prisma.machineStopEvent.delete({ where: { id: trg2.id } }); } catch { silOk = false; }
  check("§11b sınıfsız (makine/insan kararı yok) duruş silinebilir — sed yalnız insan kararına", silOk && (await prisma.machineStopEvent.count({ where: { id: trg2.id } })) === 0);

  // ── §12 YUVA (F4): beamSlot yalnız warpBeamSlots > 1 makinede, 1..N ───────────────
  const tekYuva = await hata(() => openManualStop({ machineId: makine3.id, startedAt: S1, beamSlot: 1, clientToken: crypto.randomUUID() }, undefined));
  check("§12a tek yuvalı makinede beamSlot → 400 BEAM_SLOT_NOT_APPLICABLE", tekYuva?.statusCode === 400 && kod(tekYuva) === "BEAM_SLOT_NOT_APPLICABLE", kod(tekYuva));
  await prisma.machine.update({ where: { id: makine3.id }, data: { warpBeamSlots: 2 } });
  const tasan = await hata(() => openManualStop({ machineId: makine3.id, startedAt: S1, beamSlot: 3, clientToken: crypto.randomUUID() }, undefined));
  check("§12b 2 yuvalı makinede beamSlot 3 → 400 BEAM_SLOT_OUT_OF_RANGE", tasan?.statusCode === 400 && kod(tasan) === "BEAM_SLOT_OUT_OF_RANGE", kod(tasan));
  const uygun = await openManualStop({ machineId: makine3.id, startedAt: S1, beamSlot: 2, clientToken: crypto.randomUUID() }, undefined);
  ids.stops.push(uygun.data.id);
  check("§12c 2 yuvalı makinede beamSlot 2 yazıldı", uygun.data.beamSlot === 2);
  const negatif = await hata(() => prisma.machine.update({ where: { id: makine3.id }, data: { warpBeamSlots: -1 } }));
  check("§12d warpBeamSlots < 0 DB CHECK (machines_warp_beam_slots_nonneg) reddeder", negatif === null && (await prisma.machine.findUnique({ where: { id: makine3.id }, select: { warpBeamSlots: true } }))?.warpBeamSlots === 2);

  // ── §10 beyan çapası (statik) ─────────────────────────────────────────────
  const beyan = readFileSync(join(__dirname, "lib", "defter-beyan.ts"), "utf8");
  const svc = readFileSync(join(__dirname, "..", "src", "services", "machine-stop.service.ts"), "utf8");
  check("§10 defter-beyan MachineStopEvent tersYazan `revokeStop` + Reclass `reclassifyStop` — sembol gerçek", /revokeStop/.test(beyan) && /reclassifyStop/.test(beyan) && /export async function revokeStop/.test(svc) && /export async function reclassifyStop/.test(svc));
}

async function cleanup(): Promise<void> {
  try {
    const stops = await prisma.machineStopEvent.findMany({ where: { OR: [{ id: { in: ids.stops } }, { machineId: { in: [ids.makine, ids.makine2, ids.makine3].filter(Boolean) } }] }, select: { id: true } });
    const sid = stops.map((s) => s.id);
    await prisma.machineStopReclass.deleteMany({ where: { stopEventId: { in: sid } } });
    // BEFORE DELETE seddi insan kararlı satırı korur — fikstür temizliği ÖNCE kararı siler (üretim yolu değil).
    await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
    await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
    if (ids.preset) await prisma.reasonPreset.deleteMany({ where: { id: ids.preset } });
    await prisma.shiftInstance.deleteMany({ where: { id: { in: [ids.shift, ids.shiftCancelled].filter(Boolean) } } });
    if (ids.shiftDef) await prisma.shiftDefinition.deleteMany({ where: { id: ids.shiftDef } });
    await prisma.machine.deleteMany({ where: { id: { in: [ids.makine, ids.makine2, ids.makine3].filter(Boolean) } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Bekçi hata ile durdu:", e);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
