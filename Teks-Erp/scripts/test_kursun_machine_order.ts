// =============================================================================
// Kurşun Planlama — MAKİNE İÇİ SIRA (2026-08-05)
// =============================================================================
// Planlamacı bir makinedeki işleri sürükleyip sıralar; sürükleme
// `WorkOrderStep.priority` yazar (`PATCH /kursun-qc/queue/reorder` — bekleyen
// kuyrukla AYNI uç ve AYNI alan).
//
// ⚠️ BU TESTİN VAR OLMA SEBEBİ: `listDistribution` atamaları `assignedAt asc`
// ile YÜKLER. Sıralama JS'te `sortByPlanOrder` ile yapılmasaydı sürükleme
// priority'yi yazar, DB doğru olur, EKRAN HİÇ DEĞİŞMEZDİ — hata yok, log yok,
// yalnız "sürüklüyorum, geri zıplıyor" diye bir saha şikâyeti. Bir `orderBy`
// bunu ifade edemez: kaynak atama satırı, sıralama anahtarları ise adımda.
//
// Kapsanan senaryolar:
//   1  Dağıtılmışlar planlama sırasında döner (priority artan)
//   2  Bir makineyi yeniden sıralamak SADECE onu etkiler (diğer makine + bekleyen
//      liste sabit kalır) — sürüklemenin kapsamı gerçekten grup mu
//   3  ACİL satır, priority'si en büyük olsa da makine grubunun BAŞINA pinlenir
//   4  Eşit priority'de `assignedAt` eşitlik bozucudur (sıra rastgele değil)
//   5  Bekleyen kuyruk sıralaması dağıtımdan BAĞIMSIZ (kümeler birbirini dışlar)
//
// Koşum: npx tsx scripts/test_kursun_machine_order.ts
// =============================================================================

import {
  Prisma,
  RollForm,
  RollStatus,
  StationKind,
  StepStatus,
  TravelerCardStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { KursunBypassService } from "../src/services/kursun-bypass.service";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";

const bypassSvc = new KursunBypassService();
const qcSvc = new KursunQcService();

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

async function need<T>(row: T | null | undefined, label: string): Promise<T> {
  if (!row) throw new Error(`Seed fixture eksik: ${label}`);
  return row;
}

const STAMP = `${process.pid}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
let woSeq = 0;

const createdWoIds: string[] = [];
const createdRollIds: string[] = [];
const createdStationIds: string[] = [];
const createdMachineIds: string[] = [];

interface Ctx {
  itemId: string;
  kursunStationId: string;
  tamburStationId: string;
  adminUserId: string;
}

/** Kurşun adımında AÇIK toplu, rotası Tambur'la biten (yani dağıtıma UYGUN) WO. */
async function makeWo(ctx: Ctx, tag: string): Promise<{ id: string; number: string; stepId: string }> {
  const number = `TEST-KMO-${STAMP}-${++woSeq}-${tag}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: number,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      targetItemId: ctx.itemId,
      steps: {
        create: [
          { stationId: ctx.kursunStationId, stepSequence: 1, status: StepStatus.ACTIVE },
          { stationId: ctx.tamburStationId, stepSequence: 2, status: StepStatus.PENDING },
        ],
      },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  createdWoIds.push(wo.id);
  const stepId = wo.steps.find((s) => s.stepSequence === 1)!.id;

  const batch = await prisma.batch.create({
    data: { batchNumber: `TEST-KMOP-${STAMP}-${woSeq}`, workOrderId: wo.id },
    select: { id: true },
  });
  await prisma.travelerCard.create({
    data: {
      cardNumber: number,
      barcode: number,
      workOrderId: wo.id,
      status: TravelerCardStatus.ACTIVE,
    },
  });
  const roll = await prisma.roll.create({
    data: {
      barcode: null,
      itemId: ctx.itemId,
      batchId: batch.id,
      initialQty: 100,
      currentQty: 100,
      status: RollStatus.IN_PRODUCTION,
      currentStepId: stepId,
      entrySource: "SUBCONTRACTOR_RETURN",
      form: RollForm.ACIK,
    },
    select: { id: true },
  });
  createdRollIds.push(roll.id);
  await prisma.rollMovement.create({
    data: { rollId: roll.id, workOrderStepId: stepId, qtyIn: 100 },
  });

  return { id: wo.id, number, stepId };
}

async function makeStation(suffix: string, kind: StationKind): Promise<string> {
  const st = await prisma.station.create({
    data: {
      code: `TEST-KMO-${suffix}-${STAMP}`.slice(0, 32),
      name: `TEST ${suffix}`,
      type: "INTERNAL",
      kind,
      department: "KALITE",
    },
    select: { id: true },
  });
  createdStationIds.push(st.id);
  return st.id;
}

async function makeMachine(stationId: string, suffix: string): Promise<string> {
  const m = await prisma.machine.create({
    data: {
      stationId,
      code: `TEST-KMOM-${suffix}-${STAMP}`.slice(0, 32),
      name: `TEST Makine ${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });
  createdMachineIds.push(m.id);
  return m.id;
}

async function setFlag(enabled: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
    create: {
      key: SETTING_KEYS.KURSUN_BYPASS_ENABLED,
      value: enabled,
      description: "TEST — kurşun bypass bayrağı",
    },
    update: { value: enabled },
  });
}

/** Yalnız BU testin ürettiği satırlar — dev DB'sindeki gerçek işler karışmasın. */
function mine<T extends { workOrderNumber: string }>(rows: T[]): T[] {
  return rows.filter((r) => r.workOrderNumber.startsWith(`TEST-KMO-${STAMP}-`));
}

/** Bir makinenin ekrandaki satır sırası (iş emri no listesi). */
async function machineOrder(machineName: string): Promise<string[]> {
  const d = (await bypassSvc.listDistribution()).data;
  return mine(d.assigned)
    .filter((r) => r.machineName === machineName)
    .map((r) => r.workOrderNumber);
}

async function main(): Promise<void> {
  const item = await need(
    await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif Item",
  );
  const kursunProperty = await need(
    await prisma.fabricProperty.findFirst({ where: { code: "KURSUN" }, select: { id: true } }),
    "FabricProperty KURSUN",
  );
  const admin = await need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin kullanıcısı",
  );

  const kursunStationId = await makeStation("KURSUN", StationKind.PROCESS_QC);
  await prisma.stationProperty.create({
    data: { stationId: kursunStationId, propertyId: kursunProperty.id },
  });
  const tamburStationId = await makeStation("TAMBUR", StationKind.TAMBUR);
  const machineA = await makeMachine(kursunStationId, "A");
  const machineB = await makeMachine(kursunStationId, "B");

  const ctx: Ctx = {
    itemId: item.id,
    kursunStationId,
    tamburStationId,
    adminUserId: admin.id,
  };

  await setFlag(true);

  // ===========================================================================
  section("1) Dağıtılmışlar PLANLAMA sırasında döner");
  // ===========================================================================
  // A makinesine 3, B'ye 1 iş. Dağıtım sırası (assignedAt) A1 → A2 → A3.
  const a1 = await makeWo(ctx, "A1");
  const a2 = await makeWo(ctx, "A2");
  const a3 = await makeWo(ctx, "A3");
  const b1 = await makeWo(ctx, "B1");
  // Bekleyen kalsın diye dağıtılmayan bir iş de var (5. senaryo).
  const w1 = await makeWo(ctx, "W1");

  for (const wo of [a1, a2, a3]) {
    await bypassSvc.assign({ workOrderId: wo.id, machineId: machineA }, admin.id);
  }
  await bypassSvc.assign({ workOrderId: b1.id, machineId: machineB }, admin.id);

  const order0 = await machineOrder("TEST Makine A");
  check(
    "1a A makinesi 3 satır taşıyor",
    order0.length === 3,
    order0.join(" → "),
  );
  check(
    "1b Başlangıç sırası dağıtım sırasıyla aynı (priority hepsinde 0 → assignedAt bozar)",
    order0[0] === a1.number && order0[2] === a3.number,
    order0.join(" → "),
  );

  // ===========================================================================
  section("2) Yeniden sıralama SADECE o makineyi etkiler");
  // ===========================================================================
  const bOrderBefore = await machineOrder("TEST Makine B");
  const waitingBefore = mine((await bypassSvc.listDistribution()).data.waiting).map(
    (r) => r.workOrderNumber,
  );

  // Ekrandaki sürüklemenin birebir karşılığı: A3'ü en başa al.
  await qcSvc.reorderQueue(
    [
      { id: a3.stepId, priority: 0 },
      { id: a1.stepId, priority: 10 },
      { id: a2.stepId, priority: 20 },
    ],
    admin.id,
  );

  const order1 = await machineOrder("TEST Makine A");
  check(
    "2a A makinesinin sırası DEĞİŞTİ (sürükleme ekrana yansıyor)",
    order1[0] === a3.number && order1[1] === a1.number && order1[2] === a2.number,
    order1.join(" → "),
  );
  check(
    "2b B makinesi DOKUNULMADAN kaldı",
    JSON.stringify(await machineOrder("TEST Makine B")) === JSON.stringify(bOrderBefore),
    bOrderBefore.join(" → "),
  );
  const waitingAfter = mine((await bypassSvc.listDistribution()).data.waiting).map(
    (r) => r.workOrderNumber,
  );
  check(
    "2c Bekleyen kuyruk DOKUNULMADAN kaldı",
    JSON.stringify(waitingAfter) === JSON.stringify(waitingBefore),
    waitingAfter.join(" → "),
  );

  // ===========================================================================
  section("3) ACİL satır, priority'si en KÖTÜ olsa da grubun başına pinlenir");
  // ===========================================================================
  // A2 şu an sonuncu (priority 20). Acil işaretlenince başa geçmeli.
  await qcSvc.setQueueUrgent(a2.stepId, true, admin.id);
  const order2 = await machineOrder("TEST Makine A");
  check(
    "3a Acil satır grubun BAŞINDA",
    order2[0] === a2.number,
    order2.join(" → "),
  );
  check(
    "3b Kalanların göreli sırası korundu (A3 → A1)",
    order2[1] === a3.number && order2[2] === a1.number,
    order2.join(" → "),
  );

  await qcSvc.setQueueUrgent(a2.stepId, false, admin.id);
  const order3 = await machineOrder("TEST Makine A");
  check(
    "3c Acil kalkınca priority sırasına GERİ döner",
    order3[0] === a3.number && order3[2] === a2.number,
    order3.join(" → "),
  );

  // ===========================================================================
  section("4) Eşit priority'de sıra RASTGELE değil — assignedAt bozar");
  // ===========================================================================
  await qcSvc.reorderQueue(
    [
      { id: a1.stepId, priority: 50 },
      { id: a2.stepId, priority: 50 },
      { id: a3.stepId, priority: 50 },
    ],
    admin.id,
  );
  const tied1 = await machineOrder("TEST Makine A");
  const tied2 = await machineOrder("TEST Makine A");
  check(
    "4a Eşit priority'de sıra KARARLI (iki çağrı aynı)",
    JSON.stringify(tied1) === JSON.stringify(tied2),
    tied1.join(" → "),
  );
  check(
    "4b Eşitlik bozucu dağıtım anı (A1 → A2 → A3)",
    tied1[0] === a1.number && tied1[1] === a2.number && tied1[2] === a3.number,
    tied1.join(" → "),
  );

  // ===========================================================================
  section("5) Bekleyen kuyruk dağıtımdan BAĞIMSIZ (kümeler birbirini dışlar)");
  // ===========================================================================
  const waiting = mine((await bypassSvc.listDistribution()).data.waiting);
  check(
    "5a Dağıtılmış işler bekleyen listede GÖRÜNMEZ",
    waiting.length === 1 && waiting[0].workOrderNumber === w1.number,
    waiting.map((r) => r.workOrderNumber).join(" → "),
  );
  check(
    "5b Dağıtılmamış iş bekleyen listede DURUYOR",
    waiting.some((r) => r.workOrderStepId === w1.stepId),
  );
}

async function teardown(originalFlag: Prisma.JsonValue | null): Promise<void> {
  try {
    const assignments = await prisma.kursunBypassAssignment.findMany({
      where: { workOrderId: { in: createdWoIds } },
      select: { id: true },
    });
    const assignmentIds = assignments.map((a) => a.id);

    await prisma.kursunBypassAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    await prisma.rollError.deleteMany({ where: { rollId: { in: createdRollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: createdRollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: createdRollIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...createdWoIds, ...createdRollIds, ...assignmentIds] } },
    });
    // Makineler İSTASYONLARDAN ÖNCE (Machine.stationId FK RESTRICT).
    await prisma.machine.deleteMany({ where: { id: { in: createdMachineIds } } });
    await prisma.stationProperty.deleteMany({ where: { stationId: { in: createdStationIds } } });
    await prisma.station.deleteMany({ where: { id: { in: createdStationIds } } });

    if (originalFlag === null) {
      await prisma.systemSetting
        .delete({ where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED } })
        .catch(() => {});
    } else {
      await prisma.systemSetting.update({
        where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
        data: { value: originalFlag as Prisma.InputJsonValue },
      });
    }
    console.log("\n(temizlendi — TEST-KMO kayıtları silindi, bayrak geri alındı)");
  } catch (e) {
    console.error("TEMİZLİK HATASI:", e instanceof Error ? e.message : e);
  }
}

(async () => {
  const existingFlag = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
    select: { value: true },
  });
  const originalFlag = existingFlag ? existingFlag.value : null;

  try {
    await main();
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e);
  } finally {
    await teardown(originalFlag);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
})();
