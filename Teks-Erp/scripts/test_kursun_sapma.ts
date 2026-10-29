// =============================================================================
// BEKÇİ — H2 kurşun metre sapma politikası + onay · karar belgesi DALGA2 §8 H2 kabul eşiği
// Çalıştır: npx tsx scripts/run-all-tests.ts kursun_sapma
// =============================================================================
// §0 ⭐ tablet aynası: `src/lib/kursun-meter-variance.ts` ↔ `mobil/src/lib/` sha256 birebir.
// §1 ⭐ helper ↔ SQL ikizi 21 fikstürde aynı karar (eşik sınırı, yuvarlama, taban seçimi, boş eşik).
// §2 NONE: eşik 2 m, fark 3 m ⇒ 200 + işaret, imza 0, adım kapanır.
// §3 OPERATOR_REASON: sebep yok ⇒ 409 KURSUN_METER_MISMATCH + okuma/KK2 0; sebep var ⇒ 200 + 1 imza.
// §4 SUPERVISOR_PIN: finishStep 409; yanlış PIN 403 + 0 imza; izinsiz PIN 403; doğru PIN 1 imza;
//    PIN audit'te/hatada 0; tablet gövdesi (kuyruk) PIN taşıyamaz; PIN ucu giriş hız kovasında.
// §5 OFFICE: panelden seçilir (H4: 200); finishStep 409 → listede PENDING → ofis onayı → ACKED → 200; ikinci onay 409.
// §6 ⭐ eşik değişince eski okumanın işareti aynı (kopya); kip uyuşmazlığı / sapmasız okuma 409.
// §7 ⭐ H4 liste işareti: NONE ⇒ UNSIGNED; OPERATOR_REASON + sonradan IN düzeltmesi ⇒ UNSIGNED, bekleyen 0,
//    finishStep 200 (imza yolu olmayan kip kapı tutmaz); özet şeridi listeyle aynı where.
// §8 ⭐ MEASURED_IN tabanında yükleyici ikizi: `evaluateReadingVarianceTx` ↔ `readingDeviatedSql`/`readingBaseSql`
//    gerçek okuma satırlarında eşit (IN var · IN yok ⇒ bildirilene düşer · DECLARED_IN).
// Negatif sondalar (2026-10-29, elle; PR gövdesinde): ayna bozulunca §0 ❌ · SQL ikizinde `>`→`>=`
// §1 ❌ · politika kopyası yerine canlı ayar okununca §6a ❌ · finishStep kapısı kaldırılınca §4b/§5b ❌.
// H4 sondası: bekleyen yükleminden OPERATOR_REASON dışlaması kaldırılınca (`<> 'NONE'`) §7d/§7e ❌.
// =============================================================================
import { createHash, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MachineDataSource, MeterPhase, Prisma, RollStatus, StepStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { resolveMeterVariance, type MeterVarianceBasisCode } from "../src/lib/kursun-meter-variance";
import { meterDeviatedSql, readingBaseSql, readingDeviatedSql } from "../src/services/helpers/kursun-meter-variance-sql.helper";
import { evaluateReadingVarianceTx, pendingMeterAcksTx } from "../src/services/helpers/kursun-meter.helper";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { SETTING_KEYS, SystemSettingService } from "../src/services/system-setting.service";
import { completeQc2Schema, meterPinAckSchema } from "../src/controllers/kursun-qc.controller";
import { classifyRateLimitRequest } from "../src/middlewares/web-hardening";
import { getShortCredentialKeyRing } from "../src/lib/short-credential/keyring";
import { digestQuickPin } from "../src/lib/short-credential/digest";
import { AuthService } from "../src/services/auth.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

const svc = new KursunQcService();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function hata(p: Promise<unknown>): Promise<{ status: number | null; code: unknown; msg: string }> {
  try {
    await p;
    return { status: null, code: null, msg: "" };
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: unknown }; message?: string };
    return { status: err.statusCode ?? -1, code: err.details?.code ?? null, msg: `${err.message ?? ""} ${JSON.stringify(err.details ?? null)}` };
  }
}

// §0 — bayt-eşit tablet aynası (DB'siz)
function ayna(): void {
  const kok = path.resolve(__dirname, "..", "..");
  const ozet = (p: string): string | null => {
    try { return createHash("sha256").update(readFileSync(path.join(kok, p))).digest("hex"); } catch { return null; }
  };
  const k = ozet("Teks-Erp/src/lib/kursun-meter-variance.ts");
  const a = ozet("mobil/src/lib/kursun-meter-variance.ts");
  check("§0a kaynak var", k !== null);
  check("§0b ⭐ tablet aynası kaynakla bayt-eşit", k !== null && a !== null && k === a, a === null ? "ayna yok" : k === a ? "" : "içerik farklı");
}

type Fx = { ad: string; declared: number | null; measured: number | null; out: number; m: number | null; p: number | null; basis: MeterVarianceBasisCode };
const FIKSTURLER: Fx[] = [
  { ad: "fark 3 > eşik 2", declared: 100, measured: null, out: 103, m: 2, p: null, basis: "DECLARED_IN" },
  { ad: "fark = eşik (sınır, sapma değil)", declared: 100, measured: null, out: 102, m: 2, p: null, basis: "DECLARED_IN" },
  { ad: "fark eşiği 0,001 aşar", declared: 100, measured: null, out: 102.001, m: 2, p: null, basis: "DECLARED_IN" },
  { ad: "eksi fark", declared: 100, measured: null, out: 97, m: 2, p: null, basis: "DECLARED_IN" },
  { ad: "eksi fark sınırda", declared: 100, measured: null, out: 98, m: 2, p: null, basis: "DECLARED_IN" },
  { ad: "eşik yok ⇒ sapma yok", declared: 100, measured: null, out: 150, m: null, p: null, basis: "DECLARED_IN" },
  { ad: "yalnız yüzde, aşar", declared: 100, measured: null, out: 101.5, m: null, p: 1, basis: "DECLARED_IN" },
  { ad: "yalnız yüzde, sınır", declared: 100, measured: null, out: 101, m: null, p: 1, basis: "DECLARED_IN" },
  { ad: "max(M, %P) yüzde büyük, aşar", declared: 1000, measured: null, out: 1015, m: 2, p: 1, basis: "DECLARED_IN" },
  { ad: "max(M, %P) yüzde büyük, içinde", declared: 1000, measured: null, out: 1009, m: 2, p: 1, basis: "DECLARED_IN" },
  { ad: "max(M, %P) metre büyük, aşar", declared: 50, measured: null, out: 52.5, m: 2, p: 1, basis: "DECLARED_IN" },
  { ad: "taban yok ⇒ sapma yok", declared: null, measured: null, out: 100, m: 2, p: null, basis: "DECLARED_IN" },
  { ad: "ölçülen taban, aşar", declared: 100, measured: 95, out: 98, m: 2, p: null, basis: "MEASURED_IN" },
  { ad: "ölçülen yok ⇒ bildirilene düşer", declared: 100, measured: null, out: 103, m: 2, p: null, basis: "MEASURED_IN" },
  { ad: "bildirilen taban ölçüleni yok sayar", declared: 100, measured: 99, out: 101.5, m: 2, p: null, basis: "DECLARED_IN" },
  { ad: "ölçülen taban aynı veride aşar", declared: 100, measured: 99, out: 101.5, m: 2, p: null, basis: "MEASURED_IN" },
  { ad: "3 ondalığa yuvarlama", declared: 100.0004, measured: null, out: 102.0004, m: 2, p: null, basis: "DECLARED_IN" },
  { ad: "taban 0, yüzde eşiği 0 ⇒ her fark sapma", declared: 0, measured: null, out: 1, m: null, p: 50, basis: "DECLARED_IN" },
  { ad: "taban 0, fark 0", declared: 0, measured: null, out: 0, m: 2, p: null, basis: "DECLARED_IN" },
  { ad: "kesirli eşik sınırı", declared: 123.456, measured: null, out: 125.457, m: 2.001, p: null, basis: "DECLARED_IN" },
  { ad: "kesirli yüzde aşar", declared: 333.333, measured: null, out: 336.667, m: null, p: 1, basis: "DECLARED_IN" },
];

async function ikiz(): Promise<void> {
  let esit = 0;
  const farklar: string[] = [];
  let sapmaSay = 0;
  for (const f of FIKSTURLER) {
    const ts = resolveMeterVariance(
      { declaredIn: f.declared, measuredIn: f.measured, out: f.out },
      { thresholdM: f.m, thresholdPct: f.p, basis: f.basis, approvalMode: "OFFICE" },
    ).deviated;
    const n = (v: number | null) => (v == null ? Prisma.sql`NULL::numeric` : Prisma.sql`${new Prisma.Decimal(v)}::numeric`);
    const expr = meterDeviatedSql({
      out: n(f.out), declaredIn: n(f.declared), measuredIn: n(f.measured), thresholdM: n(f.m), thresholdPct: n(f.p),
      basis: Prisma.sql`${f.basis}::text`,
    });
    const row = await prisma.$queryRaw<{ d: boolean }[]>`SELECT ${expr} AS d`;
    if (row[0]?.d === ts) esit++;
    else farklar.push(`${f.ad}: ts=${ts} sql=${row[0]?.d}`);
    if (ts) sapmaSay++;
  }
  check(`§1a ⭐ helper ↔ SQL ${FIKSTURLER.length} fikstürde eşit`, esit === FIKSTURLER.length && FIKSTURLER.length >= 20, farklar.join(" · "));
  check("§1b körlük zemini: iki sınıf da var (sapmalı ve sapmasız)", sapmaSay >= 5 && FIKSTURLER.length - sapmaSay >= 5, `sapma=${sapmaSay}`);
}

const KEYS = [
  SETTING_KEYS.KURSUN_METER_CAPTURE,
  SETTING_KEYS.KURSUN_SIMULATED_METER_ENABLED,
  SETTING_KEYS.KURSUN_BYPASS_ENABLED,
  SETTING_KEYS.PRODUCTION_ENABLED,
  SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M,
  SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_PCT,
  SETTING_KEYS.KURSUN_METER_VARIANCE_BASIS,
  SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL,
];

async function setFlag(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never, description: "TEST kursun_sapma" },
    update: { value: value as never },
  });
}

async function main(): Promise<void> {
  ayna();
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  await ikiz();

  const STAMP = Date.now().toString(36);
  const admin = { id: await testActorId() };
  const station = await prisma.station.create({
    data: { code: `TEST-KSP-${STAMP}`.slice(0, 32), name: `TEST KSAPMA ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true, inspectionEnabled: true },
    select: { id: true },
  });
  const item = await prisma.item.create({ data: { code: `TEST-KSP-ITM-${STAMP}`, name: `TEST KSAPMA kumaş ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });
  const saved = await prisma.systemSetting.findMany({ where: { key: { in: KEYS } } });
  const tag = `TEST-KSAPMA-${Date.now()}`;
  const woIds: string[] = [];
  const rollIds: string[] = [];
  const userIds: string[] = [];
  const started = new Date();

  const mkActive = async (): Promise<{ woId: string; stepId: string; rollId: string }> => {
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${tag}-WO-${woIds.length}`, status: WorkOrderStatus.IN_PROGRESS },
      select: { id: true },
    });
    woIds.push(wo.id);
    const step = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: StepStatus.ACTIVE },
      select: { id: true },
    });
    const r = await prisma.roll.create({
      data: {
        barcode: `${tag}-R-${rollIds.length}`, itemId: item.id, initialQty: 100, currentQty: 100,
        status: RollStatus.IN_PRODUCTION, entrySource: "SUPPLIER_RECEIPT", createdById: admin.id, currentStepId: step.id,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    await prisma.rollMovement.create({ data: { rollId: r.id, workOrderStepId: step.id, qtyIn: 100, operatorId: admin.id } });
    return { woId: wo.id, stepId: step.id, rollId: r.id };
  };
  const meter = (meters: number, ack?: { reasonCode?: string; reasonText?: string }) =>
    ({ meters, source: MachineDataSource.MACHINE, clientToken: randomUUID(), rawCounter: null, peripheralId: null, cardSampleId: null, ack: ack ?? null });
  const acksOf = (rollId: string) => prisma.rollMeterAck.findMany({ where: { reading: { rollId } } });
  const readingOf = (rollId: string) => prisma.rollMeterReading.findFirstOrThrow({ where: { rollId, phase: MeterPhase.OUT, revokedAt: null } });

  /** PIN'li kullanıcı (yalnız HMAC özeti yazılır). */
  const ring = getShortCredentialKeyRing();
  const mkPinUser = async (ad: string, withPerm: boolean): Promise<{ id: string; pin: string }> => {
    if (!ring.ok) throw new Error("kısa kimlik anahtarı halkası okunamadı");
    for (;;) {
      const pin = String(randomInt(100000, 1000000));
      const digest = digestQuickPin(ring.ring.active, pin);
      if (await prisma.user.findFirst({ where: { quickPinDigest: digest }, select: { id: true } })) continue;
      const perm = withPerm ? await prisma.permission.findUniqueOrThrow({ where: { code: "kursun:meter-approve" }, select: { id: true } }) : null;
      const u = await prisma.user.create({
        data: {
          username: `TEST-ksp-${ad}-${STAMP}`, fullName: `TEST ${ad}`, passwordHash: await AuthService.hashPassword(randomUUID()),
          quickPinDigest: digest, ...(perm ? { permissions: { create: { permissionId: perm.id } } } : {}),
        },
        select: { id: true },
      });
      userIds.push(u.id);
      return { id: u.id, pin };
    }
  };

  try {
    await setFlag(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setFlag(SETTING_KEYS.KURSUN_BYPASS_ENABLED, false);
    await setFlag(SETTING_KEYS.KURSUN_METER_CAPTURE, "OUT");
    await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M, 2);
    await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_PCT, 0);
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.KURSUN_METER_VARIANCE_BASIS, SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL] } } });

    // §2 NONE (varsayılan kip)
    let noneRollId = "";
    let noneStepId = "";
    {
      const a = await mkActive();
      noneRollId = a.rollId;
      noneStepId = a.stepId;
      const res = await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, meterOut: meter(103) }, admin.id, null);
      check("§2a ⭐ NONE: 200 + işaret (deviated, imza beklemiyor)", res.success && res.data.meter?.deviated === true && res.data.meter?.pendingAck === false,
        JSON.stringify(res.data.meter));
      check("§2b NONE: imza 0", (await acksOf(a.rollId)).length === 0);
      const f = await hata(svc.finishStep({ stepId: a.stepId }, admin.id));
      check("§2c NONE: adım kapanır (sapma kapıyı tutmaz)", f.status === null, JSON.stringify(f));
    }

    // §3 OPERATOR_REASON
    await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, "OPERATOR_REASON");
    {
      const a = await mkActive();
      const h = await hata(svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, meterOut: meter(103) }, admin.id, null));
      check("§3a ⭐ REASON: sebep yok ⇒ 409 KURSUN_METER_MISMATCH", h.status === 409 && h.code === "KURSUN_METER_MISMATCH", JSON.stringify(h));
      const okuma = await prisma.rollMeterReading.count({ where: { rollId: a.rollId } });
      const kk2 = await prisma.rollOperation.count({ where: { rollId: a.rollId } });
      check("§3b REASON: 409'da okuma 0 + KK2 0 (tx bütün)", okuma === 0 && kk2 === 0, `okuma=${okuma} kk2=${kk2}`);
      const res = await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, meterOut: meter(103, { reasonCode: "KUMAS_CEKTI" }) }, admin.id, null);
      const acks = await acksOf(a.rollId);
      check("§3c ⭐ REASON: sebep var ⇒ 200 + 1 imza (OPERATOR_REASON, sebep kodu)", res.success && acks.length === 1 && acks[0].mode === "OPERATOR_REASON" && acks[0].reasonCode === "KUMAS_CEKTI",
        `acks=${acks.length}`);
      const b = await mkActive();
      const ok = await svc.completeQc2({ rollId: b.rollId, stepId: b.stepId, meterOut: meter(101) }, admin.id, null);
      check("§3d REASON: eşik içinde sebep istenmez, imza 0", ok.success && (await acksOf(b.rollId)).length === 0);
    }

    // §4 SUPERVISOR_PIN
    await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, "SUPERVISOR_PIN");
    {
      const sup = await mkPinUser("sup", true);
      const yetkisiz = await mkPinUser("op", false);
      const a = await mkActive();
      const res = await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, meterOut: meter(103) }, admin.id, null);
      check("§4a PIN: okuma onaysız yazılır, pendingAck", res.success && res.data.meter?.pendingAck === true);
      const f = await hata(svc.finishStep({ stepId: a.stepId }, admin.id));
      check("§4b ⭐ PIN: imzasız sapma ⇒ finishStep 409 METER_DEVIATION_UNACKED", f.status === 409 && f.code === "METER_DEVIATION_UNACKED", JSON.stringify(f));
      const readingId = (await readingOf(a.rollId)).id;
      let yanlis = String((Number(sup.pin) + 1) % 1000000).padStart(6, "0");
      if (yanlis === yetkisiz.pin) yanlis = String((Number(sup.pin) + 2) % 1000000).padStart(6, "0");
      const w = await hata(svc.ackMeterReading({ readingId, mode: "SUPERVISOR_PIN", pin: yanlis }, admin.id));
      check("§4c ⭐ PIN: yanlış PIN ⇒ 403 METER_PIN_INVALID + 0 imza", w.status === 403 && w.code === "METER_PIN_INVALID" && (await acksOf(a.rollId)).length === 0, JSON.stringify(w));
      check("§4d PIN: hata metni/ayrıntısı PIN'i yankılamaz", !w.msg.includes(yanlis));
      const y = await hata(svc.ackMeterReading({ readingId, mode: "SUPERVISOR_PIN", pin: yetkisiz.pin }, admin.id));
      check("§4e PIN: izinsiz kişinin PIN'i ⇒ 403 METER_PIN_NOT_PERMITTED + 0 imza", y.status === 403 && y.code === "METER_PIN_NOT_PERMITTED" && (await acksOf(a.rollId)).length === 0, JSON.stringify(y));
      const ok = await svc.ackMeterReading({ readingId, mode: "SUPERVISOR_PIN", pin: sup.pin, reason: { reasonCode: "OLCUM" } }, admin.id);
      const acks = await acksOf(a.rollId);
      check("§4f ⭐ PIN: doğru PIN ⇒ 1 imza, onaylayan süpervizör", ok.success && acks.length === 1 && acks[0].approvedById === sup.id && acks[0].mode === "SUPERVISOR_PIN");
      await new Promise((r) => setTimeout(r, 300));
      const logs = await prisma.systemLog.findMany({ where: { createdAt: { gte: started } }, select: { newData: true, oldData: true, recordId: true } });
      const sizan = logs.filter((l) => [sup.pin, yanlis, yetkisiz.pin].some((p) => JSON.stringify([l.newData, l.oldData]).includes(p)));
      const ackLog = logs.filter((l) => l.recordId === acks[0]?.id);
      check("§4g ⭐ PIN audit'te 0 (bu koşumun bütün audit satırları)", sizan.length === 0 && ackLog.length >= 1, `sızan=${sizan.length} ackLog=${ackLog.length}`);
      const kuyruk = completeQc2Schema.safeParse({ rollId: a.rollId, stepId: a.stepId, meterOut: { ...meter(103), ack: { reasonCode: "X", pin: sup.pin } } });
      const kuyruk2 = completeQc2Schema.safeParse({ rollId: a.rollId, stepId: a.stepId, meterOut: { ...meter(103), pin: sup.pin } });
      check("§4h ⭐ tablet gövdesi (kuyruk) PIN taşıyamaz: ack içinde 400, üst düzeyde atılır",
        !kuyruk.success && kuyruk2.success && !JSON.stringify(kuyruk2.data).includes(sup.pin));
      check("§4i PIN gövdesi katı (fazla alan 400)", !meterPinAckSchema.safeParse({ pin: "123456", extra: 1 }).success);
      check("§4j ⭐ PIN ucu giriş hız sınırı kovasında", classifyRateLimitRequest("POST", `/api/kursun-qc/meter-readings/${readingId}/pin-ack`) === "login");
      const f2 = await hata(svc.finishStep({ stepId: a.stepId }, admin.id));
      check("§4k PIN: imzadan sonra adım kapanır", f2.status === null, JSON.stringify(f2));
    }

    // §5 OFFICE
    {
      const panel = await hata(new SystemSettingService().setFeatureFlags({ kursunMeterVarianceApproval: "OFFICE" }, admin.id));
      check("§5a ⭐ OFFICE panelden seçilir (H4: ofis ekranı var) ⇒ 200", panel.status === null, JSON.stringify(panel));
      await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, "OFFICE");
      const a = await mkActive();
      await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, meterOut: meter(103) }, admin.id, null);
      const f = await hata(svc.finishStep({ stepId: a.stepId }, admin.id));
      check("§5b ⭐ OFFICE: finishStep 409 METER_DEVIATION_UNACKED", f.status === 409 && f.code === "METER_DEVIATION_UNACKED", JSON.stringify(f));
      const list = await svc.listMeterDeviations({ stepId: a.stepId }, { limit: 50 });
      const readingId = (await readingOf(a.rollId)).id;
      check("§5c OFFICE: listede PENDING (SQL ikizi) + özet bekleyen 1", list.data.length === 1 && list.data[0].readingId === readingId && list.data[0].status === "PENDING" && list.summary.pending === 1,
        JSON.stringify({ n: list.data.length, st: list.data[0]?.status, sum: list.summary }));
      const ok = await svc.ackMeterReading({ readingId, mode: "OFFICE" }, admin.id);
      check("§5d OFFICE: ofis onayı ⇒ 1 imza", ok.success && (await acksOf(a.rollId)).length === 1);
      const after = await svc.listMeterDeviations({ stepId: a.stepId }, { limit: 50 });
      check("§5d2 OFFICE: onaydan sonra ACKED, özet imzasız 0", after.data[0]?.status === "ACKED" && after.data[0]?.ack?.mode === "OFFICE" && after.summary.unsigned === 0,
        JSON.stringify({ st: after.data[0]?.status, sum: after.summary }));
      const iki = await hata(svc.ackMeterReading({ readingId, mode: "OFFICE" }, admin.id));
      check("§5e ⭐ ikinci onay ⇒ 409 METER_ALREADY_ACKED + imza hâlâ 1", iki.status === 409 && iki.code === "METER_ALREADY_ACKED" && (await acksOf(a.rollId)).length === 1, JSON.stringify(iki));
      const f2 = await hata(svc.finishStep({ stepId: a.stepId }, admin.id));
      check("§5f ⭐ OFFICE: onaydan sonra finishStep 200", f2.status === null, JSON.stringify(f2));
    }

    // §6 kopya + kip/sapma kapıları
    {
      const eski = await readingOf(noneRollId).catch(() => null);
      const eskiOkuma = eski ?? (await prisma.rollMeterReading.findFirstOrThrow({ where: { rollId: noneRollId, phase: MeterPhase.OUT } }));
      await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M, 50);
      const v = await evaluateReadingVarianceTx(prisma, eskiOkuma);
      check("§6a ⭐ eşik 2→50 değişti, eski okumanın işareti aynı (kopya)", v.deviated === true && Number(eskiOkuma.thresholdM) === 2, `thresholdM=${String(eskiOkuma.thresholdM)}`);
      await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M, 2);
      await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, "SUPERVISOR_PIN");
      const a = await mkActive();
      await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, meterOut: meter(103) }, admin.id, null);
      const rid = (await readingOf(a.rollId)).id;
      const mm = await hata(svc.ackMeterReading({ readingId: rid, mode: "OFFICE" }, admin.id));
      check("§6b PIN kipli okumaya ofis onayı ⇒ 409 METER_ACK_MODE_MISMATCH", mm.status === 409 && mm.code === "METER_ACK_MODE_MISMATCH", JSON.stringify(mm));
      await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, "OFFICE");
      const b = await mkActive();
      await svc.completeQc2({ rollId: b.rollId, stepId: b.stepId, meterOut: meter(101) }, admin.id, null);
      const nd = await hata(svc.ackMeterReading({ readingId: (await readingOf(b.rollId)).id, mode: "OFFICE" }, admin.id));
      check("§6c sapmasız okumaya onay ⇒ 409 METER_NOT_DEVIATED", nd.status === 409 && nd.code === "METER_NOT_DEVIATED", JSON.stringify(nd));
      await svc.reopenStep({ stepId: a.stepId }, admin.id).catch(() => null);
    }

    // §7 H4 liste işareti + OPERATOR_REASON kapı tutmaz
    {
      const none = await svc.listMeterDeviations({ stepId: noneStepId }, { limit: 50 });
      check("§7a ⭐ NONE sapması listede UNSIGNED (işaret), özet imzasız 1", none.data.length === 1 && none.data[0].status === "UNSIGNED" && none.summary.unsigned === 1 && none.summary.pending === 0,
        JSON.stringify({ n: none.data.length, st: none.data[0]?.status, sum: none.summary }));
      await setFlag(SETTING_KEYS.KURSUN_METER_CAPTURE, "IN_OUT");
      await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_BASIS, "MEASURED_IN");
      await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, "OPERATOR_REASON");
      const a = await mkActive();
      await svc.recordMeterReading({ rollId: a.rollId, stepId: a.stepId, phase: MeterPhase.IN, input: meter(100) }, admin.id);
      const res = await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, meterOut: meter(101) }, admin.id, null);
      check("§7b REASON: eşik içinde (101 ↔ IN 100) sebepsiz 200, imza 0", res.success && res.data.meter?.deviated === false && (await acksOf(a.rollId)).length === 0, JSON.stringify(res.data.meter));
      await svc.recordMeterReading({ rollId: a.rollId, stepId: a.stepId, phase: MeterPhase.IN, input: meter(95) }, admin.id);
      const list = await svc.listMeterDeviations({ stepId: a.stepId }, { limit: 50 });
      check("§7c IN 100→95 düzeltmesi OUT'u sapmaya kaydırdı ⇒ listede UNSIGNED (imzasız sapma)", list.data.length === 1 && list.data[0].status === "UNSIGNED" && list.data[0].diffMeters === 6,
        JSON.stringify({ n: list.data.length, st: list.data[0]?.status, diff: list.data[0]?.diffMeters }));
      const pend = await pendingMeterAcksTx(prisma, { stepId: a.stepId });
      check("§7d ⭐ REASON: bekleyen yüklemi 0 (imza yolu yok ⇒ kapı değil)", pend.length === 0 && list.summary.pending === 0, `bekleyen=${pend.length}`);
      const f = await hata(svc.finishStep({ stepId: a.stepId }, admin.id));
      check("§7e ⭐ REASON + sonradan IN düzeltmesi ⇒ finishStep 200", f.status === null, JSON.stringify(f));
      const all = await svc.listMeterDeviations({ fromDay: undefined }, { limit: 1 });
      const sayim = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM roll_meter_readings r
        WHERE r.phase = 'OUT'::"MeterPhase" AND r."revokedAt" IS NULL AND ${readingDeviatedSql("r")}`;
      check("§7f özet toplamı = sapmalı aktif OUT sayısı (aynı where); sayfa 1 + imleç", all.summary.total === Number(sayim[0].n) && all.data.length === 1 && (all.summary.total > 1 ? all.pagination.nextCursor !== null : true),
        `özet=${all.summary.total} sayım=${String(sayim[0].n)}`);
      if (all.pagination.nextCursor) {
        const p2 = await svc.listMeterDeviations({}, { cursor: all.pagination.nextCursor, limit: 1 });
        check("§7g imleç sonraki satırı verir (tekrar yok)", p2.data.length === 1 && p2.data[0].readingId !== all.data[0].readingId);
      }
    }

    // §8 MEASURED_IN yükleyici ikizi — gerçek satırlarda TS ↔ SQL
    {
      const rows = await prisma.rollMeterReading.findMany({ where: { rollId: { in: rollIds }, phase: MeterPhase.OUT, revokedAt: null } });
      let esit = 0;
      let olculenli = 0;
      const farklar: string[] = [];
      for (const r of rows) {
        const ts = await evaluateReadingVarianceTx(prisma, r);
        const q = await prisma.$queryRaw<{ d: boolean; b: Prisma.Decimal | null; m: boolean }[]>`
          SELECT ${readingDeviatedSql("r")} AS d, ${readingBaseSql("r")} AS b,
            EXISTS (SELECT 1 FROM roll_meter_readings mi WHERE mi."rollId" = r."rollId" AND mi."workOrderStepId" = r."workOrderStepId" AND mi.phase = 'IN'::"MeterPhase" AND mi."revokedAt" IS NULL) AS m
          FROM roll_meter_readings r WHERE r.id = ${r.id}::uuid`;
        const sqlBase = q[0]?.b == null ? null : Number(q[0].b);
        const tsBase = r.thresholdM == null && r.thresholdPct == null ? sqlBase : ts.baseMeters;
        if (q[0]?.d === ts.deviated && tsBase === sqlBase) esit++;
        else farklar.push(`${r.id.slice(0, 8)} ts=${ts.deviated}/${ts.baseMeters} sql=${q[0]?.d}/${sqlBase}`);
        if (r.basis === "MEASURED_IN" && q[0]?.m) olculenli++;
      }
      check("§8a körlük zemini: MEASURED_IN + aktif IN'li okuma var", olculenli >= 1 && rows.length >= 5, `ölçülenli=${olculenli} satır=${rows.length}`);
      check("§8b ⭐ yükleyici ikizi: TS ↔ SQL sapma + taban her satırda eşit", esit === rows.length, farklar.join(" · "));
    }
  } finally {
    await prisma.rollMeterAck.deleteMany({ where: { reading: { rollId: { in: rollIds } } } }).catch(() => {});
    await prisma.rollMeterReading.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...rollIds] } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: station.id } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: item.id } }).catch(() => {});
    await prisma.systemSetting.deleteMany({ where: { key: { in: KEYS } } });
    for (const s of saved) {
      await prisma.systemSetting.create({ data: { key: s.key, value: s.value as never, description: s.description } });
    }
  }
}

main()
  .then(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  })
  .catch(async (err) => {
    console.error("HATA:", err);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail + 1} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
