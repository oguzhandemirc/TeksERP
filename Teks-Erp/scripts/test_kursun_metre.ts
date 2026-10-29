// =============================================================================
// BEKÇİ — H1 kurşun çıkış metresi (RECORD) · karar belgesi DALGA2 §8 H1 kabul eşiği
// Çalıştır: npx tsx scripts/run-all-tests.ts kursun_metre
// =============================================================================
// §1 OFF (varsayılan): meterOut yok sayılır, yeni satır 0; düzeltme ucu 400.
// §2 SIMULATED ayar kapalıyken 400 + 0 satır (KK2 de yazılmaz).
// §3 ⭐ aynı token ×3 paralel completeQc2 ⇒ 1 okuma (8036 token kilidi).
// §4 ⭐ düzeltme ⇒ aktif 1 + damgalı 1; geri alınmış okumanın token'ı 409; çakışan yük 409.
// §5 ⭐ dağıtılmış (bypass) adımda düzeltme 409 + 0 satır (tablet kapısı).
// §6 politika kopyası satırda (bugünkü davranış: DECLARED_IN / NONE / eşiksiz).
// §7 ⭐ reopenStep ⇒ okuma + bağlı onay damgalı (KURSUN_REOPEN).
// §8 ⭐ DB seddi: ikinci aktif okuma (kısmi unique) ve eksi metre (CHECK) reddedilir.
// §9 ⭐ H4 sayaç cihazı alanları (servis doğrulaması): bilinmeyen counterMode 400 · 65 karakter / ASCII dışı
//    resetCommand 400 · METER olmayan cihazda dolu alan 400 · geçerli değer yazılır · "" ⇒ null.
// H4 sondası: `assertMeterCounterFields` çağrısı kaldırılınca §9a/§9b/§9d ❌.
// Negatif sondalar (2026-10-29, elle; PR gövdesinde): token kilidi kaldırılınca §3 ❌ ·
// tablet kapısı kaldırılınca §5 ❌ · reopen damgası kaldırılınca §7 ❌ ·
// kısmi unique index düşürülünce §8a ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import { MachineDataSource, MeterPhase, RollStatus, StepStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { PeripheralDeviceService } from "../src/services/peripheral.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { roleGrade } from "./fixture-quality-grade";
import { testActorId } from "./fixture-test-user";

const svc = new KursunQcService();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** Hata yakala: { status, code } — `details.code` sözleşmesi. */
async function hata(p: Promise<unknown>): Promise<{ status: number | null; code: unknown; msg: string }> {
  try {
    await p;
    return { status: null, code: null, msg: "" };
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: unknown }; meta?: unknown; message?: string };
    return { status: err.statusCode ?? -1, code: err.details?.code ?? null, msg: `${err.message ?? ""} ${JSON.stringify(err.meta ?? null)}` };
  }
}

const KEYS = [
  SETTING_KEYS.KURSUN_METER_CAPTURE,
  SETTING_KEYS.KURSUN_SIMULATED_METER_ENABLED,
  SETTING_KEYS.KURSUN_BYPASS_ENABLED,
  SETTING_KEYS.PRODUCTION_ENABLED,
];

async function setFlag(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never, description: "TEST kursun_metre" },
    update: { value: value as never },
  });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);

  // Fikstür iş anahtarıyla kurulur (ortamda "herhangi bir kayıt" aranmaz).
  const STAMP = Date.now().toString(36);
  const admin = { id: await testActorId() };
  const grade = await roleGrade("FIRST");
  const station = await prisma.station.create({
    data: { code: `TEST-KMT-${STAMP}`.slice(0, 32), name: `TEST KMETRE ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true, inspectionEnabled: true },
    select: { id: true },
  });
  const item = await prisma.item.create({ data: { code: `TEST-KMT-ITM-${STAMP}`, name: `TEST KMETRE kumaş ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });
  const machine = await prisma.machine.create({
    data: { stationId: station.id, code: `TEST-KMT-M-${STAMP}`.slice(0, 32), name: `TEST KMETRE makine`, isActive: true },
    select: { id: true },
  });

  const saved = await prisma.systemSetting.findMany({ where: { key: { in: KEYS } } });
  const tag = `TEST-KMETRE-${Date.now()}`;
  const woIds: string[] = [];
  const rollIds: string[] = [];
  const peripheralIds: string[] = [];
  const bypassIds: string[] = [];

  /** Akışta bir top: WO IN_PROGRESS, PROCESS_QC adımı ACTIVE, top adımda + açık hareket. */
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

  const meter = (meters: number, source: MachineDataSource = MachineDataSource.MACHINE, clientToken = randomUUID()) =>
    ({ meters, source, clientToken, rawCounter: null, peripheralId: null, cardSampleId: null });
  const okumalar = (rollId: string, stepId: string) =>
    prisma.rollMeterReading.findMany({ where: { rollId, workOrderStepId: stepId }, orderBy: { createdAt: "asc" } });

  try {
    await setFlag(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setFlag(SETTING_KEYS.KURSUN_BYPASS_ENABLED, false);
    await setFlag(SETTING_KEYS.KURSUN_SIMULATED_METER_ENABLED, false);
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.KURSUN_METER_CAPTURE } });

    // §1 OFF — varsayılan (satır yok)
    {
      const a = await mkActive();
      const res = await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, meterOut: meter(98.5) }, admin.id, null);
      check("§1a OFF: completeQc2 meterOut ile başarılı (yok sayıldı)", res.success === true);
      check("§1b ⭐ OFF: yeni okuma satırı 0", (await okumalar(a.rollId, a.stepId)).length === 0);
      const h = await hata(svc.recordMeterReading({ rollId: a.rollId, stepId: a.stepId, phase: MeterPhase.OUT, input: meter(98) }, admin.id));
      check("§1c OFF: düzeltme ucu 400 METER_CAPTURE_DISABLED", h.status === 400 && h.code === "METER_CAPTURE_DISABLED", JSON.stringify(h));
      check("§1d OFF: düzeltme sonrası satır 0", (await okumalar(a.rollId, a.stepId)).length === 0);
    }

    await setFlag(SETTING_KEYS.KURSUN_METER_CAPTURE, "OUT");

    // §2 SIMULATED kapalı
    {
      const a = await mkActive();
      const h = await hata(svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, meterOut: meter(99, MachineDataSource.SIMULATED) }, admin.id, null));
      check("§2a SIMULATED: 400 SIMULATED_METER_DISABLED", h.status === 400 && h.code === "SIMULATED_METER_DISABLED", JSON.stringify(h));
      check("§2b SIMULATED: okuma 0", (await okumalar(a.rollId, a.stepId)).length === 0);
      const qc2 = await prisma.rollOperation.count({ where: { rollId: a.rollId, workOrderStepId: a.stepId } });
      check("§2c SIMULATED: KK2 de yazılmadı (0 satır)", qc2 === 0, `op=${qc2}`);
    }

    // §3 aynı token ×3 paralel
    const a3 = await mkActive();
    const tok = randomUUID();
    {
      const sonuc = await Promise.allSettled([1, 2, 3].map(() =>
        svc.completeQc2({ rollId: a3.rollId, stepId: a3.stepId, meterOut: meter(98.5, MachineDataSource.MACHINE, tok) }, admin.id, null)));
      check("§3a üç deneme de başarılı", sonuc.every((s) => s.status === "fulfilled"),
        sonuc.map((s) => (s.status === "rejected" ? String((s.reason as Error).message).slice(0, 80) : "ok")).join(" | "));
      const rows = await okumalar(a3.rollId, a3.stepId);
      check("§3b ⭐ aynı token ×3 ⇒ 1 okuma", rows.length === 1, `n=${rows.length}`);
      check("§3c okuma OUT, 98.5 m, MACHINE", rows[0]?.phase === MeterPhase.OUT && Number(rows[0]?.meters) === 98.5 && rows[0]?.source === "MACHINE");
      // §6 politika kopyası
      check("§6 politika kopyası: DECLARED_IN / NONE / eşiksiz",
        rows[0]?.basis === "DECLARED_IN" && rows[0]?.approvalMode === "NONE" && rows[0]?.thresholdM === null && rows[0]?.thresholdPct === null);
    }

    // §4 düzeltme
    {
      const newTok = randomUUID();
      const res = await svc.recordMeterReading(
        { rollId: a3.rollId, stepId: a3.stepId, phase: MeterPhase.OUT, input: meter(97, MachineDataSource.OPERATOR, newTok) }, admin.id);
      check("§4a düzeltme başarılı", res.success === true && res.message === "Metre okuması düzeltildi", res.message);
      const rows = await okumalar(a3.rollId, a3.stepId);
      const aktif = rows.filter((r) => r.revokedAt === null);
      const damgali = rows.filter((r) => r.revokedAt !== null);
      check("§4b ⭐ düzeltme ⇒ aktif 1 + damgalı 1", aktif.length === 1 && damgali.length === 1, `aktif=${aktif.length} damgalı=${damgali.length}`);
      check("§4c aktif = 97 m, damgalı = 98.5 m (satır değişmedi)", Number(aktif[0]?.meters) === 97 && Number(damgali[0]?.meters) === 98.5);
      check("§4d damga sebebi KURSUN_METER_CORRECTION", damgali[0]?.revokeReason === "KURSUN_METER_CORRECTION", String(damgali[0]?.revokeReason));
      const h1 = await hata(svc.completeQc2({ rollId: a3.rollId, stepId: a3.stepId, meterOut: meter(98.5, MachineDataSource.MACHINE, tok) }, admin.id, null));
      check("§4e geri alınmış okumanın token'ı 409 METER_READING_REVOKED", h1.status === 409 && h1.code === "METER_READING_REVOKED", JSON.stringify(h1));
      const h2 = await hata(svc.recordMeterReading(
        { rollId: a3.rollId, stepId: a3.stepId, phase: MeterPhase.OUT, input: meter(50, MachineDataSource.OPERATOR, newTok) }, admin.id));
      check("§4f aynı token farklı metre 409 CLIENT_TOKEN_COLLISION", h2.status === 409 && h2.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(h2));
      const replay = await svc.recordMeterReading(
        { rollId: a3.rollId, stepId: a3.stepId, phase: MeterPhase.OUT, input: meter(97, MachineDataSource.OPERATOR, newTok) }, admin.id);
      check("§4g aynı yük replay ⇒ aynı okuma, yeni satır yok", replay.data?.id === aktif[0]?.id && (await okumalar(a3.rollId, a3.stepId)).length === 2);
      const h3 = await hata(svc.recordMeterReading({ rollId: a3.rollId, stepId: a3.stepId, phase: MeterPhase.IN, input: meter(100) }, admin.id));
      check("§4h OUT kipinde giriş okuması 400", h3.status === 400 && h3.code === "METER_CAPTURE_DISABLED", JSON.stringify(h3));
      // 3'ten fazla ondalıklı metre (kayan nokta artığı / hassas sayaç) — kolon 3 ondalık; replay 409 DEĞİL aynı okuma.
      const fpTok = randomUUID();
      const fpMetre = 98.5555;
      const fp1 = await svc.recordMeterReading(
        { rollId: a3.rollId, stepId: a3.stepId, phase: MeterPhase.OUT, input: meter(fpMetre, MachineDataSource.OPERATOR, fpTok) }, admin.id);
      const fp2 = await hata(svc.recordMeterReading(
        { rollId: a3.rollId, stepId: a3.stepId, phase: MeterPhase.OUT, input: meter(fpMetre, MachineDataSource.OPERATOR, fpTok) }, admin.id));
      check("§4i ⭐ >3 ondalıklı metre replay ⇒ 409 değil, aynı okuma", fp1.success === true && fp2.status === null, JSON.stringify(fp2));
      check("§4j okuma 3 ondalığa sabit (98.556)", Number(fp1.data?.meters) === 98.556, String(fp1.data?.meters));
    }

    // §8 DB seddi — kısmi unique (adım × evre başına TEK aktif) ve CHECK meters >= 0
    {
      const ikinci = await hata(prisma.rollMeterReading.create({
        data: { rollId: a3.rollId, workOrderStepId: a3.stepId, phase: MeterPhase.OUT, meters: 96, source: MachineDataSource.OPERATOR,
          basis: "DECLARED_IN", approvalMode: "NONE", clientToken: randomUUID() },
      }));
      check("§8a ⭐ ikinci AKTİF okuma DB'de reddedilir (kısmi unique)", ikinci.status !== null && /roll_meter_readings_active_uq|rollId.*workOrderStepId.*phase/.test(ikinci.msg), ikinci.msg);
      const eksi = await hata(prisma.$executeRaw`UPDATE roll_meter_readings SET meters = -1 WHERE "rollId" = ${a3.rollId}::uuid AND "revokedAt" IS NULL`);
      check("§8b CHECK meters >= 0", eksi.status !== null && eksi.msg.includes("roll_meter_readings_meters_ck"), eksi.msg);
    }

    // §5 bypass'lı adım
    {
      const a = await mkActive();
      const bp = await prisma.kursunBypassAssignment.create({
        data: { workOrderId: a.woId, workOrderStepId: a.stepId, machineId: machine.id, assignedById: admin.id },
        select: { id: true },
      });
      bypassIds.push(bp.id);
      const h = await hata(svc.recordMeterReading({ rollId: a.rollId, stepId: a.stepId, phase: MeterPhase.OUT, input: meter(90) }, admin.id));
      check("§5a ⭐ dağıtılmış adımda düzeltme 409", h.status === 409, JSON.stringify(h));
      check("§5b dağıtılmış adımda 0 satır", (await okumalar(a.rollId, a.stepId)).length === 0);
    }

    // §7 reopen damgası — son adım, kapanmış tur
    {
      const wo = await prisma.workOrder.create({
        data: { workOrderNumber: `${tag}-WO-${woIds.length}`, status: WorkOrderStatus.COMPLETED },
        select: { id: true },
      });
      woIds.push(wo.id);
      const step = await prisma.workOrderStep.create({
        data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: StepStatus.COMPLETED },
        select: { id: true },
      });
      const r = await prisma.roll.create({
        data: {
          barcode: `${tag}-R-${rollIds.length}`, itemId: item.id, initialQty: 100, currentQty: 100,
          status: RollStatus.WAREHOUSE, qualityGrade: grade.code, qualityGradeId: grade.id,
          entrySource: "SUPPLIER_RECEIPT", createdById: admin.id, currentStepId: null,
        },
        select: { id: true },
      });
      rollIds.push(r.id);
      await prisma.rollMovement.create({
        data: { rollId: r.id, workOrderStepId: step.id, qtyIn: 100, qtyOut: 100, exitedAt: new Date(Date.now() - 30000),
          notes: `QC2_STEP_FINISHED:${randomUUID()}`, operatorId: admin.id },
      });
      const okuma = await prisma.rollMeterReading.create({
        data: { rollId: r.id, workOrderStepId: step.id, phase: MeterPhase.OUT, meters: 98, source: MachineDataSource.MACHINE,
          basis: "DECLARED_IN", approvalMode: "NONE", clientToken: randomUUID(), createdById: admin.id },
        select: { id: true },
      });
      const ack = await prisma.rollMeterAck.create({ data: { readingId: okuma.id, mode: "NONE", approvedById: admin.id }, select: { id: true } });
      await svc.reopenStep({ stepId: step.id }, admin.id);
      const o = await prisma.rollMeterReading.findUniqueOrThrow({ where: { id: okuma.id } });
      const k = await prisma.rollMeterAck.findUniqueOrThrow({ where: { id: ack.id } });
      check("§7a ⭐ reopen ⇒ okuma damgalı (KURSUN_REOPEN), silinmedi", o.revokedAt !== null && o.revokeReason === "KURSUN_REOPEN", String(o.revokeReason));
      check("§7b reopen ⇒ bağlı onay aynı tx'te damgalı", k.revokedAt !== null && k.revokeReason === "KURSUN_REOPEN");
    }

    // §9 sayaç cihazı alanları
    {
      const dev = new PeripheralDeviceService({ modelName: "peripheralDevice", tableName: "PERIPHERAL_DEVICE", searchFields: ["name"], uniqueField: "code" });
      const base = (kind: string, extra: Record<string, unknown>) => {
        const code = `TEST-KMT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 48);
        return { code, name: `TEST KMETRE ${code}`, kind, connectionType: "SERIAL_COM", ...extra };
      };
      const a = await hata(dev.create(base("METER", { counterMode: "BOGUS" }), admin.id));
      check("§9a ⭐ bilinmeyen counterMode ⇒ 400 INVALID_COUNTER_MODE", a.status === 400 && a.code === "INVALID_COUNTER_MODE", JSON.stringify(a));
      const b = await hata(dev.create(base("METER", { resetCommand: "R".repeat(65) }), admin.id));
      check("§9b ⭐ 65 karakter resetCommand ⇒ 400 INVALID_RESET_COMMAND", b.status === 400 && b.code === "INVALID_RESET_COMMAND", JSON.stringify(b));
      const c = await hata(dev.create(base("METER", { resetCommand: "SIFIRLA\n\u00e7" }), admin.id));
      check("§9c ASCII dışı / denetim karakterli resetCommand ⇒ 400", c.status === 400 && c.code === "INVALID_RESET_COMMAND", JSON.stringify(c));
      const d = await hata(dev.create(base("SCALE", { counterMode: "RESETTING" }), admin.id));
      check("§9d ⭐ METER olmayan cihazda sayaç alanı ⇒ 400 COUNTER_FIELDS_METER_ONLY", d.status === 400 && d.code === "COUNTER_FIELDS_METER_ONLY", JSON.stringify(d));
      const ok = await dev.create(base("METER", { counterMode: "CUMULATIVE", resetCommand: "R".repeat(64) }), admin.id);
      const id = (ok.data as { id: string }).id;
      peripheralIds.push(id);
      const row = await prisma.peripheralDevice.findUniqueOrThrow({ where: { id }, select: { counterMode: true, resetCommand: true } });
      check("§9e geçerli değer (CUMULATIVE, 64 karakter) yazılır", row.counterMode === "CUMULATIVE" && row.resetCommand?.length === 64);
      const u = await hata(dev.update(id, { counterMode: "X" }, admin.id));
      check("§9f güncellemede de bilinmeyen kip 400", u.status === 400 && u.code === "INVALID_COUNTER_MODE", JSON.stringify(u));
      const k = await hata(dev.update(id, { kind: "SCALE" }, admin.id));
      const r1 = await prisma.peripheralDevice.findUniqueOrThrow({ where: { id }, select: { counterMode: true, resetCommand: true } });
      check("§9g tür SCALE'e çevrilince (eski istemci alan göndermez) sayaç alanları temizlenir, 200", k.status === null && r1.counterMode === null && r1.resetCommand === null, JSON.stringify(k));
      await dev.update(id, { kind: "METER", counterMode: "RESETTING", resetCommand: "Z" }, admin.id);
      await dev.update(id, { kind: "METER", counterMode: "", resetCommand: "" }, admin.id);
      const r2 = await prisma.peripheralDevice.findUniqueOrThrow({ where: { id }, select: { counterMode: true, resetCommand: true } });
      check("§9h \"\" ⇒ null", r2.counterMode === null && r2.resetCommand === null);
    }
  } finally {
    // Sonda koşumunda doğrulamasız yazılan satır da dahil (ad damgalı).
    await prisma.peripheralDevice.deleteMany({ where: { OR: [{ id: { in: peripheralIds } }, { name: { startsWith: "TEST KMETRE " } }] } }).catch(() => {});
    await prisma.rollMeterAck.deleteMany({ where: { reading: { rollId: { in: rollIds } } } }).catch(() => {});
    await prisma.rollMeterReading.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.kursunBypassAssignment.deleteMany({ where: { id: { in: bypassIds } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...rollIds, ...peripheralIds] } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    await prisma.machine.deleteMany({ where: { id: machine.id } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: station.id } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: item.id } }).catch(() => {});
    // Ayarlar birebir geri yüklenir.
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
