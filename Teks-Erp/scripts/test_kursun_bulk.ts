// =============================================================================
// Kurşun Planlama — TOPLU DAĞITIM / TAŞIMA / HAVUZA ALMA (2026-08-05)
// =============================================================================
// Planlamacı havuzdan çok satır seçip tek hamlede bir makineye dağıtır; makine
// sekmesinden seçtiklerini havuza döndürür ya da başka makineye taşır.
//
// ⚠️ SÖZLEŞMENİN ÇEKİRDEĞİ: sonuç PARÇALI olabilir ve bu BİLİNÇLİDİR.
// `assignBulk`/`cancelBulk` tek bir transaction DEĞİLDİR — her satır kendi
// tx'inde işlenir. İki gerekçe:
//   1. `assign` iş emri satırını kilitler; 50 iş emrini tek tx'e almak 50 satırı
//      işlem boyunca kilitli tutar (kök kural 10 ihlali + deadlock riski).
//   2. Hepsi-ya-hiç yanlış semantik: listedeki bir iş bu arada uygunluğunu
//      yitirdiyse diğerlerinin dağıtımını geri almak planlamacının niyetine
//      aykırıdır. Dağıtım zaten geri alınabilir bir karardır.
// Bu yüzden test asıl olarak şunu kilitler: **başarılı satırlar KALICIDIR ve
// atlanan her satır SOMUT sebebiyle döner.** Sessiz atlama en kötü davranıştır.
//
// Kapsanan senaryolar:
//   1  Hepsi uygun → hepsi atanır, `failed` boş
//   2  KARIŞIK liste → uygunlar ATANIR ve KALIR, uygun olmayan somut sebeple atlanır
//   3  Toplu TAŞIMA → `moved` sayacı; iş yeni makinede, eskisinde değil
//   4  Toplu HAVUZA ALMA → işler bekleyen listeye döner
//   5  Zaten iptal edilmiş id → parçalı sonuç (biri geçer, biri sebebiyle atlanır)
//   6  userId yoksa 401 (dağıtım bir sorumluluk kaydıdır, anonim olamaz)
//
// Koşum: npx tsx scripts/test_kursun_bulk.ts
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
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

const svc = new KursunBypassService();

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
  /** Kurşundan sonra gelen ama TAMBUR olmayan istasyon → adım dağıtıma UYGUN DEĞİL. */
  blockerStationId: string;
  adminUserId: string;
}

async function makeWo(
  ctx: Ctx,
  opts: { eligible: boolean } = { eligible: true },
): Promise<{ id: string; number: string; stepId: string }> {
  const number = `TEST-KBK-${STAMP}-${++woSeq}`;
  const nextStationId = opts.eligible ? ctx.tamburStationId : ctx.blockerStationId;

  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: number,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      targetItemId: ctx.itemId,
      steps: {
        create: [
          { stationId: ctx.kursunStationId, stepSequence: 1, status: StepStatus.ACTIVE },
          { stationId: nextStationId, stepSequence: 2, status: StepStatus.PENDING },
        ],
      },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  createdWoIds.push(wo.id);
  const stepId = wo.steps.find((s) => s.stepSequence === 1)!.id;

  const batch = await prisma.batch.create({
    data: { batchNumber: `TEST-KBKP-${STAMP}-${woSeq}`, workOrderId: wo.id },
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
      code: `TEST-KBK-${suffix}-${STAMP}`.slice(0, 32),
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
      code: `TEST-KBKM-${suffix}-${STAMP}`.slice(0, 32),
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

/** Bu adımın AÇIK ataması hangi makinede? (yoksa null) */
async function openAssignment(stepId: string) {
  return prisma.kursunBypassAssignment.findFirst({
    where: { workOrderStepId: stepId, completedAt: null, cancelledAt: null },
    select: { id: true, machineId: true },
  });
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
  // ⚠️ mode AUTO ZORUNLU (2026-08-10): bypass rejiminde tablet salt-okunur,
  // işaretleyecek operatör yok → `assign` OPTIONAL satırı reddeder. Şema
  // varsayılanı OPTIONAL olduğu için fixture bunu AÇIKÇA yazar.
  await prisma.stationProperty.create({
    data: { stationId: kursunStationId, propertyId: kursunProperty.id , mode: "AUTO" },
  });
  const tamburStationId = await makeStation("TAMBUR", StationKind.TAMBUR);
  const blockerStationId = await makeStation("ZIMPARA", StationKind.OTHER);
  const machineA = await makeMachine(kursunStationId, "A");
  const machineB = await makeMachine(kursunStationId, "B");

  const ctx: Ctx = {
    itemId: item.id,
    kursunStationId,
    tamburStationId,
    blockerStationId,
    adminUserId: admin.id,
  };

  await setFlag(true);

  // ===========================================================================
  section("1) Hepsi uygun → hepsi atanır");
  // ===========================================================================
  const ok1 = await makeWo(ctx);
  const ok2 = await makeWo(ctx);
  const ok3 = await makeWo(ctx);

  const r1 = await svc.assignBulk(
    { workOrderIds: [ok1.id, ok2.id, ok3.id], machineId: machineA },
    admin.id,
  );
  check("1a assigned = 3", r1.data.assigned === 3, `${r1.data.assigned}`);
  check("1b failed BOŞ", r1.data.failed.length === 0, JSON.stringify(r1.data.failed));
  check("1c moved = 0 (hepsi YENİ atama)", r1.data.moved === 0, `${r1.data.moved}`);
  const a1 = await openAssignment(ok1.stepId);
  check("1d Atamalar gerçekten A makinesinde", a1?.machineId === machineA);

  // ===========================================================================
  section("2) KARIŞIK liste → uygunlar KALIR, uygun olmayan SEBEPLE atlanır");
  // ===========================================================================
  const good1 = await makeWo(ctx);
  const good2 = await makeWo(ctx);
  const bad = await makeWo(ctx, { eligible: false }); // rota Tambur'la bitmiyor

  const r2 = await svc.assignBulk(
    { workOrderIds: [good1.id, bad.id, good2.id], machineId: machineA },
    admin.id,
  );
  check("2a assigned = 2", r2.data.assigned === 2, `${r2.data.assigned}`);
  check("2b failed = 1", r2.data.failed.length === 1, JSON.stringify(r2.data.failed));
  check(
    "2c Atlanan satır DOĞRU iş emri",
    r2.data.failed[0]?.workOrderId === bad.id,
  );
  check(
    "2d Sebep SOMUT ('Tambur değil')",
    /Tambur/i.test(r2.data.failed[0]?.message ?? ""),
    r2.data.failed[0]?.message?.slice(0, 70) ?? "",
  );
  // ÇEKİRDEK: kısmi başarı GERİ ALINMAZ.
  check("2e good1 ATANMIŞ KALDI (rollback YOK)", (await openAssignment(good1.stepId)) !== null);
  check("2f good2 ATANMIŞ KALDI", (await openAssignment(good2.stepId)) !== null);
  check("2g bad ATANMADI", (await openAssignment(bad.stepId)) === null);
  check(
    "2h Mesaj atlananı SÖYLÜYOR (sessiz değil)",
    /atlandı/i.test(r2.message ?? ""),
    r2.message ?? "",
  );

  // ===========================================================================
  section("3) Toplu TAŞIMA (A → B) — `moved` sayacı");
  // ===========================================================================
  const r3 = await svc.assignBulk(
    { workOrderIds: [ok1.id, ok2.id], machineId: machineB },
    admin.id,
  );
  check("3a assigned = 2", r3.data.assigned === 2, `${r3.data.assigned}`);
  check("3b moved = 2 (ikisi de TAŞINDI, yeni atama değil)", r3.data.moved === 2, `${r3.data.moved}`);
  check("3c ok1 artık B makinesinde", (await openAssignment(ok1.stepId))?.machineId === machineB);
  check("3d ok3 hâlâ A makinesinde (dokunulmadı)", (await openAssignment(ok3.stepId))?.machineId === machineA);
  const openCount = await prisma.kursunBypassAssignment.count({
    where: { workOrderStepId: ok1.stepId, completedAt: null, cancelledAt: null },
  });
  check("3e Taşınan adımda TEK açık atama var (eski kapandı)", openCount === 1, `${openCount}`);

  // ===========================================================================
  section("4) Toplu HAVUZA ALMA → işler bekleyen listeye döner");
  // ===========================================================================
  const asgOk1 = await openAssignment(ok1.stepId);
  const asgOk2 = await openAssignment(ok2.stepId);
  const r4 = await svc.cancelBulk(
    { assignmentIds: [asgOk1!.id, asgOk2!.id] },
    admin.id,
  );
  check("4a cancelled = 2", r4.data.cancelled === 2, `${r4.data.cancelled}`);
  check("4b failed BOŞ", r4.data.failed.length === 0);
  check("4c ok1'in açık ataması KALMADI", (await openAssignment(ok1.stepId)) === null);

  const dist = await svc.listDistribution();
  const waitingNumbers = dist.data.waiting.map((w) => w.workOrderNumber);
  check(
    "4d Havuza alınan iş BEKLEYEN listesinde",
    waitingNumbers.includes(ok1.number) && waitingNumbers.includes(ok2.number),
  );
  check(
    "4e Hâlâ dağıtık olan iş bekleyen listesinde DEĞİL",
    !waitingNumbers.includes(ok3.number),
  );

  // ===========================================================================
  section("5) Zaten iptal edilmiş id → PARÇALI sonuç");
  // ===========================================================================
  const asgOk3 = await openAssignment(ok3.stepId);
  const r5 = await svc.cancelBulk(
    // asgOk1 az önce iptal edildi → ikinci kez iptal edilemez.
    { assignmentIds: [asgOk3!.id, asgOk1!.id] },
    admin.id,
  );
  check("5a cancelled = 1", r5.data.cancelled === 1, `${r5.data.cancelled}`);
  check("5b failed = 1", r5.data.failed.length === 1, JSON.stringify(r5.data.failed));
  check(
    "5c Sebep SOMUT ('zaten iptal')",
    /iptal/i.test(r5.data.failed[0]?.message ?? ""),
    r5.data.failed[0]?.message?.slice(0, 70) ?? "",
  );
  check("5d Geçerli olan GERÇEKTEN iptal edildi", (await openAssignment(ok3.stepId)) === null);

  // ===========================================================================
  section("6) userId yoksa 401 (anonim dağıtım olamaz)");
  // ===========================================================================
  for (const [label, run] of [
    ["assignBulk", () => svc.assignBulk({ workOrderIds: [good1.id], machineId: machineA })],
    ["cancelBulk", () => svc.cancelBulk({ assignmentIds: [asgOk3!.id] })],
  ] as const) {
    let status = 0;
    try {
      await run();
    } catch (e) {
      if (e instanceof AppError) status = e.statusCode;
    }
    check(`6 ${label} userId'siz 401`, status === 401, `${status}`);
  }
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
    console.log("\n(temizlendi — TEST-KBK kayıtları silindi, bayrak geri alındı)");
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
