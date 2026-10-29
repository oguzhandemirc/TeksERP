// =============================================================================
// BEKÇİ — H3b kurşun adım özetinde sayaç alanları · karar belgesi DALGA2 §8 H3b
// Çalıştır: npx tsx scripts/test_kursun_adim_sayac.ts
// =============================================================================
// §1 ⭐ OFF (varsayılan): getStep + kart okutma yanıtında `meter` anahtarı YOK; OUT yanıtından
//    `meter` anahtarları çıkarılınca OFF yanıtıyla bayt-aynı (yalnız ekleme).
// §2 ⭐ OUT + politika: step.meter anahtar kümesi ve değer türleri tabletin tipiyle birebir
//    (`mobil/src/types/models.ts` KursunStepSummary.meter), değerler `resolveKursunMeterPolicy`.
// §3 ⭐ rolls[].meter.declaredIn = SQL ikizi `declaredInSql` (gelen belge satırlı + satırsız top).
// §4 ⭐ measuredIn = aktif IN okuması (düzeltmede damgalanan IN sayılmaz); IN yoksa null.
// §5 listOpenCards yanıtında `meter` YOK (yalnız adım özeti).
// §6 ⭐ 1 top ve 50 top adımında getStep sorgu sayısı EŞİT (N+1 yok; pg Client.query sayacı).
// Negatif sondalar (2026-10-29, elle; PR gövdesinde): declaredIn initialQty'den okununca §3a ❌ ·
// IN `revokedAt` süzgeci kaldırılınca §4 ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import pg from "pg";
import { MachineDataSource, MeterPhase, Prisma, RollStatus, StepStatus, TravelerCardStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { resolveKursunMeterPolicy } from "../src/services/helpers/kursun-meter.helper";
import { declaredInSql } from "../src/services/helpers/kursun-meter-variance-sql.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

const svc = new KursunQcService();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
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
    create: { key, value: value as never, description: "TEST kursun_adim_sayac" },
    update: { value: value as never },
  });
}

/** Bütün `meter` anahtarlarını derinlemesine düşürür — OFF yanıtıyla bayt karşılaştırması için. */
function stripMeter(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripMeter);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "meter").map(([k, x]) => [k, stripMeter(x)]));
  }
  return v;
}

// Sorgu sayacı: pg havuzunun bütün istemcileri `pg.Client` örneğidir.
let counting = false;
let queryCount = 0;
const origQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
  if (counting) queryCount++;
  return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
} as typeof origQuery;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);

  const STAMP = Date.now().toString(36);
  const admin = { id: await testActorId() };
  const station = await prisma.station.create({
    data: { code: `TEST-KAS-${STAMP}`.slice(0, 32), name: `TEST KADIMSAYAC ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true, inspectionEnabled: true },
    select: { id: true },
  });
  const item = await prisma.item.create({ data: { code: `TEST-KAS-ITM-${STAMP}`, name: `TEST KADIMSAYAC kumaş ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });
  const saved = await prisma.systemSetting.findMany({ where: { key: { in: KEYS } } });
  const tag = `TEST-KAS-${STAMP}`.toUpperCase();
  const woIds: string[] = [];
  const rollIds: string[] = [];
  const noteIds: string[] = [];

  /** Akışta N top: WO IN_PROGRESS + aktif kart, PROCESS_QC adımı ACTIVE, toplar adımda + açık hareket. */
  const mkStep = async (n: number): Promise<{ stepId: string; cardBarcode: string; rollIds: string[] }> => {
    const num = `${tag}-WO-${woIds.length}`;
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: num, status: WorkOrderStatus.IN_PROGRESS }, select: { id: true } });
    woIds.push(wo.id);
    await prisma.travelerCard.create({ data: { cardNumber: num, barcode: num, workOrderId: wo.id, status: TravelerCardStatus.ACTIVE } });
    const step = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: StepStatus.ACTIVE },
      select: { id: true },
    });
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await prisma.roll.create({
        data: {
          barcode: `${tag}-R-${rollIds.length}`, itemId: item.id, initialQty: 100, currentQty: 100,
          status: RollStatus.IN_PRODUCTION, entrySource: "SUPPLIER_RECEIPT", createdById: admin.id, currentStepId: step.id,
        },
        select: { id: true },
      });
      rollIds.push(r.id);
      ids.push(r.id);
      await prisma.rollMovement.create({ data: { rollId: r.id, workOrderStepId: step.id, qtyIn: 100, operatorId: admin.id } });
    }
    return { stepId: step.id, cardBarcode: num, rollIds: ids };
  };
  const meter = (meters: number) =>
    ({ meters, source: MachineDataSource.MACHINE, clientToken: randomUUID(), rawCounter: null, peripheralId: null, cardSampleId: null });
  type Summary = Awaited<ReturnType<KursunQcService["getStep"]>>["data"];
  const step = async (id: string): Promise<NonNullable<Summary>> => (await svc.getStep(id)).data!;
  const rollOf = (s: NonNullable<Summary>, rollId: string) => s.rolls.find((r) => r.rollId === rollId)!;

  try {
    await setFlag(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setFlag(SETTING_KEYS.KURSUN_BYPASS_ENABLED, false);
    await setFlag(SETTING_KEYS.KURSUN_SIMULATED_METER_ENABLED, false);
    await prisma.systemSetting.deleteMany({
      where: { key: { in: [SETTING_KEYS.KURSUN_METER_CAPTURE, SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M, SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_PCT, SETTING_KEYS.KURSUN_METER_VARIANCE_BASIS, SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL] } },
    });

    // İki top: A gelen belge satırlı (95.5 m), B satırsız (initialQty 100).
    const s = await mkStep(2);
    const [rollA, rollB] = s.rollIds;
    const note = await prisma.customerDeliveryNote.create({ data: { noteNo: `${tag}-N`.slice(0, 32), sourceKind: "MANUAL" }, select: { id: true } });
    noteIds.push(note.id);
    await prisma.customerDeliveryNoteLine.create({ data: { noteId: note.id, lineNo: 1, meters: new Prisma.Decimal("95.5"), rollId: rollA, status: "ENTERED" } });

    // §1 OFF
    const offStep = JSON.stringify(await svc.getStep(s.stepId));
    const offCard = JSON.stringify(await svc.getByCardBarcode(s.cardBarcode, station.id));
    check("§1a ⭐ OFF: getStep yanıtında \"meter\" anahtarı yok", !offStep.includes('"meter"'));
    check("§1b ⭐ OFF: kart okutma yanıtında \"meter\" anahtarı yok", !offCard.includes('"meter"'));

    // §2–§3 OUT + politika
    await setFlag(SETTING_KEYS.KURSUN_METER_CAPTURE, "OUT");
    const outRes = await svc.getStep(s.stepId);
    check("§1c ⭐ OUT yanıtından meter düşürülünce OFF yanıtıyla bayt-aynı (yalnız ekleme)", JSON.stringify(stripMeter(outRes)) === offStep);
    const outCard = await svc.getByCardBarcode(s.cardBarcode, station.id);
    check("§1d kart okutma OUT yanıtı da meter'siz hâliyle OFF'la bayt-aynı + meter var", JSON.stringify(stripMeter(outCard)) === offCard && outCard.data?.meter?.capture === "OUT");

    await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M, 2);
    await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_PCT, 1.5);
    await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_BASIS, "MEASURED_IN");
    await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, "SUPERVISOR_PIN");
    {
      const d = await step(s.stepId);
      const m = d.meter as Record<string, unknown> | undefined;
      check("§2a ⭐ step.meter anahtarları {capture, policy}", !!m && Object.keys(m).sort().join() === "capture,policy", JSON.stringify(m));
      const p = (m?.policy ?? {}) as Record<string, unknown>;
      check("§2b ⭐ policy anahtarları {approvalMode, basis, thresholdM, thresholdPct}", Object.keys(p).sort().join() === "approvalMode,basis,thresholdM,thresholdPct", JSON.stringify(p));
      check("§2c değer türleri: capture ∈ {OUT, IN_OUT}, eşikler number|null, basis/approval tabletin kümesinde",
        ["OUT", "IN_OUT"].includes(m?.capture as string)
        && [p.thresholdM, p.thresholdPct].every((x) => x === null || typeof x === "number")
        && ["DECLARED_IN", "MEASURED_IN"].includes(p.basis as string)
        && ["NONE", "OPERATOR_REASON", "SUPERVISOR_PIN", "OFFICE"].includes(p.approvalMode as string));
      const policy = await resolveKursunMeterPolicy(prisma);
      check("§2d ⭐ policy = resolveKursunMeterPolicy (2 / 1.5 / MEASURED_IN / SUPERVISOR_PIN)",
        JSON.stringify(p) === JSON.stringify(policy) && p.thresholdM === 2 && p.thresholdPct === 1.5 && p.basis === "MEASURED_IN" && p.approvalMode === "SUPERVISOR_PIN", JSON.stringify(p));
      const rm = rollOf(d, rollA).meter as Record<string, unknown> | undefined;
      check("§2e rolls[].meter anahtarları {declaredIn, measuredIn}", !!rm && Object.keys(rm).sort().join() === "declaredIn,measuredIn", JSON.stringify(rm));
    }
    await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, "NONE");

    // §3 declaredIn ↔ SQL ikizi: iki topa OUT okuması yazılır, ikizin değeri okuma satırından ölçülür.
    {
      await svc.completeQc2({ rollId: rollA, stepId: s.stepId, meterOut: meter(95) }, admin.id, null);
      await svc.completeQc2({ rollId: rollB, stepId: s.stepId, meterOut: meter(99) }, admin.id, null);
      const twin = await prisma.$queryRaw<Array<{ rollId: string; declaredIn: Prisma.Decimal | null }>>`
        SELECT r."rollId", ${declaredInSql("r")} AS "declaredIn" FROM roll_meter_readings r
        WHERE r."workOrderStepId" = ${s.stepId}::uuid AND r.phase = 'OUT'::"MeterPhase" AND r."revokedAt" IS NULL`;
      const twinOf = (id: string) => { const t = twin.find((x) => x.rollId === id)?.declaredIn; return t == null ? null : Number(t); };
      const d = await step(s.stepId);
      const a = rollOf(d, rollA).meter?.declaredIn;
      const b = rollOf(d, rollB).meter?.declaredIn;
      check("§3a ⭐ satırlı top: declaredIn = SQL ikizi = 95.5", a === twinOf(rollA) && a === 95.5, `özet=${a} ikiz=${twinOf(rollA)}`);
      check("§3b ⭐ satırsız top: declaredIn = SQL ikizi = 100 (initialQty)", b === twinOf(rollB) && b === 100, `özet=${b} ikiz=${twinOf(rollB)}`);
      check("§3c OUT kipinde IN okuması yok ⇒ measuredIn null", rollOf(d, rollA).meter?.measuredIn === null);
    }

    // §4 measuredIn = aktif IN okuması
    await setFlag(SETTING_KEYS.KURSUN_METER_CAPTURE, "IN_OUT");
    {
      await svc.recordMeterReading({ rollId: rollA, stepId: s.stepId, phase: MeterPhase.IN, input: meter(97) }, admin.id);
      await svc.recordMeterReading({ rollId: rollA, stepId: s.stepId, phase: MeterPhase.IN, input: meter(96.25) }, admin.id);
      const ins = await prisma.rollMeterReading.findMany({ where: { rollId: rollA, workOrderStepId: s.stepId, phase: MeterPhase.IN } });
      check("§4a zemin: aktif 1 + damgalı 1 IN okuması", ins.length === 2 && ins.filter((r) => r.revokedAt === null).length === 1);
      let d: NonNullable<Summary> | null = null;
      try { d = await step(s.stepId); } catch (e) { console.log(`   getStep hata: ${(e as Error).message.slice(0, 200)}`); }
      check("§4b ⭐ measuredIn = aktif IN (96.25; damgalı 97 sayılmaz)", d !== null && rollOf(d, rollA).meter?.measuredIn === 96.25, JSON.stringify(d && rollOf(d, rollA).meter));
      check("§4c IN okuması olmayan top ⇒ measuredIn null", d !== null && rollOf(d, rollB).meter?.measuredIn === null);
      check("§4d IN_OUT kipi step.meter.capture'da", d?.meter?.capture === "IN_OUT");
    }

    // §5 listOpenCards
    {
      const list = await svc.listOpenCards(station.id);
      const js = JSON.stringify(list);
      check("§5 ⭐ listOpenCards: fikstür kartı listede, \"meter\" anahtarı YOK", js.includes(s.cardBarcode) && !js.includes('"meter"'));
    }

    // §6 sorgu sayısı top sayısından bağımsız
    {
      const one = await mkStep(1);
      const fifty = await mkStep(50);
      const measure = async (id: string): Promise<number> => {
        await svc.getStep(id); // ısınma (ayar önbelleği)
        queryCount = 0;
        counting = true;
        try { await svc.getStep(id); } finally { counting = false; }
        return queryCount;
      };
      const q1 = await measure(one.stepId);
      const q50 = await measure(fifty.stepId);
      const d50 = await step(fifty.stepId);
      check("§6a ⭐ 1 top ve 50 top adımında sorgu sayısı eşit", q1 === q50 && q1 > 0, `1 top=${q1} · 50 top=${q50}`);
      check("§6b 50 topun hepsinde meter dolu (declaredIn 100)", d50.rolls.length === 50 && d50.rolls.every((r) => r.meter?.declaredIn === 100));
    }
  } finally {
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: noteIds } } }).catch(() => {});
    await prisma.rollMeterAck.deleteMany({ where: { reading: { rollId: { in: rollIds } } } }).catch(() => {});
    await prisma.rollMeterReading.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...rollIds] } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: station.id } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: item.id } }).catch(() => {});
    await prisma.systemSetting.deleteMany({ where: { key: { in: KEYS } } });
    for (const x of saved) {
      await prisma.systemSetting.create({ data: { key: x.key, value: x.value as never, description: x.description } });
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
