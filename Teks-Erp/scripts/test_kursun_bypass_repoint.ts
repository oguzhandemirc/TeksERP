// =============================================================================
// KURŞUN BYPASS ATAMASI — DEVİR / TEBDİL'DE NE OLUR? (K2, 2026-08-21)
// =============================================================================
// `repointRollsTx` topun TÜM ayak izini (Roll konumu ×2, RollMovement,
// RollOperation, RollError ×2) klon adımlara taşıyordu ama
// `KursunBypassAssignment` O LİSTEDE YOKTU. Sonuç, DEVİR (kapanış dispozisyonu
// TRANSFER) akışında sessiz bir kayıptı:
//   1. atama kaynak WO'nun artık ölü adımında kalıyor,
//   2. aynı tx'in sonundaki `voidStalePendingBypassAssignmentsTx(..., force)`
//      onu İPTAL ediyor,
//   3. mal fiziksel olarak hâlâ kurşun makinesindeyken sistemde "dağıtılmamış"
//      görünüyor: dağıtım ekranından kayboluyor ve Tambur okutması kapatacak
//      bir atama bulamıyor.
//
// KARAR (iki yön, bilinçli olarak FARKLI):
//   • DEVİR      → atama MALLA BİRLİKTE TAŞINIR (aynı satır, aynı makine).
//                  Mal hâlâ o makinede; yalnız iş emri değişti.
//   • AYIRMA/TEBDİL (split) → atama TAŞINMAZ, bayatsa İPTAL edilir. Toplar
//                  boyahaneye geri sarılıyor / fasonda yeni WO'ya geçiyor;
//                  kurşunu yeniden görecekler, dağıtımı planlamacı yeniden yapar.
//
//   T1  DEVİR: atama yeni WO + klon adımda, AYNI SATIR, makine aynı, açık
//   T2  DEVİR: kapanışın force-void'i repoint edileni İPTAL ETMEDİ (sıra kuralı)
//   T3  DEVİR: TAŞINMAYAN adımdaki atama repoint EDİLMEZ → force-void (WO_CLOSE)
//   T4  UNDYED_MOVE (tüm parti) → kaynak SUPERSEDED → cancelReason WO_SUPERSEDED
//   T5  UNDYED_MOVE (kaynakta canlı top kalıyor) → atama YAŞAR
//   T6  NEW_COLOR: kurşun adımı terminal (SKIPPED) ise non-force void
//       (SPLIT_SOURCE); yeni WO'da atama DOĞMAZ
//   T7  İkinci repoint 0 döner (idempotent)
//
// Fixture'ı TEST KENDİ YARATIR (`test_kursun_bypass.ts` deseni): kendi PROCESS_QC
// istasyonu + kendi makineleri; seed istasyonlarına dokunulmaz. Global bayrak
// yedeklenip geri konur.
//
// Koşum: npx tsx scripts/test_kursun_bypass_repoint.ts
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
import { WorkOrderService } from "../src/services/workorder.service";
import { WorkOrderSplitService } from "../src/services/workorder-split.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { repointPendingBypassAssignmentsTx } from "../src/services/helpers/kursun-bypass-guard.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

const bypassSvc = new KursunBypassService();
const woSvc = new WorkOrderService();
const splitSvc = new WorkOrderSplitService();
const subSvc = new SubcontractorService();

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
function need<T>(row: T | null | undefined, label: string): T {
  if (!row) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
  return row;
}

const STAMP = `${process.pid}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
let woSeq = 0;

const createdWoIds: string[] = [];
const createdRollIds: string[] = [];
const createdStationIds: string[] = [];
const createdMachineIds: string[] = [];

interface MasterData {
  itemId: string;
  adminUserId: string;
  kursunStationId: string;
  tamburStationId: string;
  boyaStationId: string;
  colorId: string;
  subcontractorId: string;
}

/** İş emri numarası — refakat kartı barkodu olarak da kullanılır. */
function woNumber(): string {
  return `TEST-KBR-${STAMP}-${++woSeq}`;
}

/**
 * WO + rota + kart kurar. `route` istasyon id'leri sırayla verilir.
 * Adım durumları: ilk adım ACTIVE, kalanı PENDING.
 */
async function makeWo(
  md: MasterData,
  route: string[],
): Promise<{ woId: string; woNumber: string; stepIds: string[] }> {
  const num = woNumber();
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: num,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      targetItemId: md.itemId,
      steps: {
        create: route.map((stationId, i) => ({
          stationId,
          stepSequence: i + 1,
          status: i === 0 ? StepStatus.ACTIVE : StepStatus.PENDING,
        })),
      },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  createdWoIds.push(wo.id);
  await prisma.travelerCard.create({
    data: { cardNumber: num, barcode: num, workOrderId: wo.id, status: TravelerCardStatus.ACTIVE },
  });
  const stepIds = [...wo.steps]
    .sort((a, b) => a.stepSequence - b.stepSequence)
    .map((s) => s.id);
  return { woId: wo.id, woNumber: num, stepIds };
}

async function makeBatch(woId: string): Promise<string> {
  const b = await prisma.batch.create({
    data: { batchNumber: `TEST-KBRP-${STAMP}-${++woSeq}`, workOrderId: woId },
    select: { id: true },
  });
  return b.id;
}

/** Adıma AÇIK movement'lı barkodsuz açık kumaş topu ekler (fason kabul emsali). */
async function addRoll(
  md: MasterData,
  args: { batchId: string; stepId: string; qty: number },
): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: null,
      itemId: md.itemId,
      batchId: args.batchId,
      initialQty: args.qty,
      currentQty: args.qty,
      status: RollStatus.IN_PRODUCTION,
      currentStepId: args.stepId,
      entrySource: "SUBCONTRACTOR_RETURN",
      form: RollForm.ACIK,
    },
    select: { id: true },
  });
  createdRollIds.push(roll.id);
  await prisma.rollMovement.create({
    data: { rollId: roll.id, workOrderStepId: args.stepId, qtyIn: args.qty },
  });
  return roll.id;
}

async function makeStation(suffix: string, name: string, kind: StationKind): Promise<string> {
  const st = await prisma.station.create({
    data: {
      code: `TEST-KBR-${suffix}-${STAMP}`.slice(0, 32),
      name,
      type: "INTERNAL",
      kind,
      department: "KALITE",
    },
    select: { id: true },
  });
  createdStationIds.push(st.id);
  return st.id;
}

async function makeMachine(stationId: string, suffix: string, name: string): Promise<string> {
  const m = await prisma.machine.create({
    data: { stationId, code: `TEST-KBRM-${suffix}-${STAMP}`.slice(0, 32), name, isActive: true },
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

async function pendingOf(woId: string) {
  return prisma.kursunBypassAssignment.findFirst({
    where: { workOrderId: woId, completedAt: null, cancelledAt: null },
    select: { id: true, machineId: true, workOrderStepId: true, cancelledAt: true },
  });
}

async function rowById(id: string) {
  return prisma.kursunBypassAssignment.findUnique({
    where: { id },
    select: {
      id: true,
      workOrderId: true,
      workOrderStepId: true,
      machineId: true,
      cancelledAt: true,
      cancelReason: true,
      completedAt: true,
    },
  });
}

async function woIdByNumber(num: string): Promise<string | null> {
  const w = await prisma.workOrder.findUnique({ where: { workOrderNumber: num }, select: { id: true } });
  return w?.id ?? null;
}

// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const item = need(
    await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif Item",
  );
  const admin = need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin kullanıcısı",
  );
  const tambur = need(
    await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }),
    "Station TAMBUR_1",
  );
  const boya = need(
    await prisma.station.findFirst({
      where: { code: "BOYA_FASON" },
      select: { id: true, appliesColor: true },
    }),
    "Station BOYA_FASON",
  );
  const kursunProp = need(
    await prisma.fabricProperty.findFirst({ where: { code: "KURSUN" }, select: { id: true } }),
    "FabricProperty KURSUN",
  );
  const color = need(
    await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif Color",
  );
  const dyeHouse = await ensureTestDyeHouse();

  // Testin KENDİ PROCESS_QC istasyonu + makineleri (seed'e dokunulmaz).
  // ⚠️ KURSUN özelliği AUTO modda ZORUNLU — bypass'ta tablette işaretleme yok.
  const kursunStationId = await makeStation("S", "TEST Kurşun İstasyonu (repoint)", StationKind.PROCESS_QC);
  await prisma.stationProperty.create({
    data: { stationId: kursunStationId, propertyId: kursunProp.id, mode: "AUTO" },
  });
  const machineA = await makeMachine(kursunStationId, "A", "TEST Kurşun Makinesi A");

  const md: MasterData = {
    itemId: item.id,
    adminUserId: admin.id,
    kursunStationId,
    tamburStationId: tambur.id,
    boyaStationId: boya.id,
    colorId: color.id,
    subcontractorId: dyeHouse.id,
  };

  await setFlag(true);

  // ===========================================================================
  // T1 + T2 — DEVİR: atama MALLA BİRLİKTE taşınır, force-void ona dokunmaz
  // ===========================================================================
  section("T1/T2) DEVİR (kapanış dispozisyonu TRANSFER)");
  {
    const wo = await makeWo(md, [md.kursunStationId, md.tamburStationId]);
    const batchId = await makeBatch(wo.woId);
    const kursunStep = wo.stepIds[0]!;
    const r1 = await addRoll(md, { batchId, stepId: kursunStep, qty: 100 });
    const r2 = await addRoll(md, { batchId, stepId: kursunStep, qty: 200 });

    const assigned = await bypassSvc.assign(
      { workOrderId: wo.woId, machineId: machineA },
      md.adminUserId,
    );
    const assignmentId = assigned.data.assignmentId;
    check("T1-0 ön koşul: atama kaynak WO'nun kurşun adımında açık", assigned.data.workOrderStepId === kursunStep);

    const res = await woSvc.completeWorkOrder(
      wo.woId,
      {
        reason: "T1 devir testi",
        dispositions: [
          { rollId: r1, action: "TRANSFER" },
          { rollId: r2, action: "TRANSFER" },
        ],
        transferOrderMode: "stock",
      },
      md.adminUserId,
    );
    const msg = res.message ?? "";
    const newWoNumber = /yeni iş emrinde: (\S+)/.exec(msg)?.[1] ?? "";
    const newWoId = newWoNumber ? await woIdByNumber(newWoNumber) : null;
    if (newWoId) createdWoIds.push(newWoId);
    check("T1-1 ön koşul: devir yeni iş emri doğurdu", !!newWoId, newWoNumber);

    const row = await rowById(assignmentId);
    check(
      "T1-2: atama AYNI SATIR olarak yeni WO'ya taşındı (yeniden yaratılmadı)",
      row?.workOrderId === newWoId,
      `workOrderId ${row?.workOrderId?.slice(0, 8)}`,
    );
    check("T1-3: makine DEĞİŞMEDİ", row?.machineId === machineA);
    check("T1-4: atama hâlâ AÇIK (completedAt null)", row?.completedAt === null);
    check(
      "T2: kapanışın force-void'i repoint edileni İPTAL ETMEDİ (çağrı sırası kuralı)",
      row?.cancelledAt === null,
      `cancelReason ${row?.cancelReason ?? "—"}`,
    );

    // Hedef adım: yeni WO'nun KLON kurşun adımı olmalı (kaynağınki değil).
    const newSteps = newWoId
      ? await prisma.workOrderStep.findMany({
          where: { workOrderId: newWoId },
          select: { id: true, stationId: true, stepSequence: true },
          orderBy: { stepSequence: "asc" },
        })
      : [];
    const newKursunStep = newSteps.find((s) => s.stationId === md.kursunStationId);
    check("T1-5: atama KLON kurşun adımına oturdu", !!newKursunStep && row?.workOrderStepId === newKursunStep.id);
    check("T1-6: kaynak WO'da bekleyen atama KALMADI", (await pendingOf(wo.woId)) === null);

    // Audit izi — "dağıtım kayboldu mu" sorusunun cevabı.
    const audit = await prisma.systemLog.findFirst({
      where: { tableName: "WORK_ORDER", recordId: wo.woId, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const newData = (audit?.newData ?? {}) as Record<string, unknown>;
    check("T1-7: audit `bypassRepointed: 1` taşıyor", newData.bypassRepointed === 1, JSON.stringify(newData.bypassRepointed));
  }

  // ===========================================================================
  // T3 — DEVİR: TAŞINMAYAN adımın ataması repoint EDİLMEZ (stepMap süzgeci)
  // ===========================================================================
  section("T3) DEVİR: taşınmayan adımın ataması force-void'e düşer");
  {
    const wo = await makeWo(md, [md.kursunStationId, md.tamburStationId]);
    const batchId = await makeBatch(wo.woId);
    const kursunStep = wo.stepIds[0]!;
    const tamburStep = wo.stepIds[1]!;
    // Devredilecek top TAMBUR adımında (kurşun adımında DEĞİL).
    const rt = await addRoll(md, { batchId, stepId: tamburStep, qty: 150 });

    // ⚠️ FIXTURE KISAYOLU: atama satırı doğrudan yazılıyor. `assign()` yalnız
    //    İLK PROCESS_QC adımını hedefler ve o adımda AÇIK movement arar; burada
    //    bilerek "topu taşınmayan bir adımda BAYAT kalmış atama" kuruyoruz —
    //    servis yoluyla üretilemeyecek ama sahada (kısmi devir sonrası) doğal
    //    olarak oluşan durum budur.
    const stale = await prisma.kursunBypassAssignment.create({
      data: {
        workOrderId: wo.woId,
        workOrderStepId: kursunStep,
        machineId: machineA,
        assignedById: md.adminUserId,
      },
      select: { id: true },
    });

    const res = await woSvc.completeWorkOrder(
      wo.woId,
      { reason: "T3 kısmi devir testi", dispositions: [{ rollId: rt, action: "TRANSFER" }] },
      md.adminUserId,
    );
    const newWoNumber = /yeni iş emrinde: (\S+)/.exec(res.message ?? "")?.[1] ?? "";
    const newWoId = newWoNumber ? await woIdByNumber(newWoNumber) : null;
    if (newWoId) createdWoIds.push(newWoId);

    const row = await rowById(stale.id);
    check("T3-1: taşınmayan adımın ataması kaynak WO'da KALDI", row?.workOrderId === wo.woId);
    check("T3-2: atama force-void ile İPTAL edildi", row?.cancelledAt != null);
    check("T3-3: cancelReason = WO_CLOSE", row?.cancelReason === "WO_CLOSE", row?.cancelReason ?? "—");
    check(
      "T3-4: yeni WO'ya HİÇ atama sızmadı",
      newWoId ? (await prisma.kursunBypassAssignment.count({ where: { workOrderId: newWoId } })) === 0 : false,
    );
  }

  // ===========================================================================
  // T4 — UNDYED_MOVE (tüm parti) → kaynak SUPERSEDED → WO_SUPERSEDED
  // ===========================================================================
  section("T4) UNDYED_MOVE: kaynak devredilince atama WO_SUPERSEDED ile iptal");
  {
    const wo = await makeWo(md, [md.boyaStationId, md.kursunStationId, md.tamburStationId]);
    const boyaStep = wo.stepIds[0]!;
    const kursunStep = wo.stepIds[1]!;

    // (a) Fasona gidecek parti.
    const fasonBatch = await makeBatch(wo.woId);
    const fasonRoll = await addRoll(md, { batchId: fasonBatch, stepId: boyaStep, qty: 300 });
    // (b) `assign` kurşun adımında AÇIK movement arar → geçici top.
    const tmpBatch = await makeBatch(wo.woId);
    const tmpRoll = await addRoll(md, { batchId: tmpBatch, stepId: kursunStep, qty: 50 });

    const assigned = await bypassSvc.assign(
      { workOrderId: wo.woId, machineId: machineA },
      md.adminUserId,
    );
    const assignmentId = assigned.data.assignmentId;

    await subSvc.dispatch(
      { workOrderId: wo.woId, stepId: boyaStep, subcontractorId: md.subcontractorId, rollIds: [fasonRoll] },
      md.adminUserId,
    );

    // Geçici topu ÖLÜ statüye çek → WO undyedMove sonrası tamamen boşalsın
    // (`supersedeEmptiedSourceWorkOrderTx` canlı top sayar).
    await prisma.roll.update({
      where: { id: tmpRoll },
      data: { status: RollStatus.CANCELLED, currentStepId: null },
    });

    await splitSvc.splitBranch(
      wo.woId,
      { batchId: fasonBatch, mode: "UNDYED_MOVE", orderMode: "stock", reason: "T4 fason taşıma" },
      md.adminUserId,
    );

    const src = await prisma.workOrder.findUnique({ where: { id: wo.woId }, select: { status: true } });
    check("T4-0 ön koşul: kaynak WO SUPERSEDED", src?.status === WorkOrderStatus.SUPERSEDED, src?.status ?? "—");

    const row = await rowById(assignmentId);
    check("T4-1: atama İPTAL edildi", row?.cancelledAt != null);
    check("T4-2: cancelReason = WO_SUPERSEDED", row?.cancelReason === "WO_SUPERSEDED", row?.cancelReason ?? "—");
    check("T4-3: atama TAŞINMADI (kaynak WO'da kaldı)", row?.workOrderId === wo.woId);

    const moved = await prisma.workOrder.findFirst({
      where: { splitFromId: wo.woId },
      select: { id: true },
    });
    if (moved) createdWoIds.push(moved.id);
    check(
      "T4-4: hedef WO'da atama DOĞMAZ (planlamacı yeniden dağıtır)",
      moved ? (await prisma.kursunBypassAssignment.count({ where: { workOrderId: moved.id } })) === 0 : false,
    );
  }

  // ===========================================================================
  // T5 — UNDYED_MOVE (kaynakta canlı top kalıyor) → atama YAŞAR
  // ===========================================================================
  section("T5) UNDYED_MOVE: kaynakta iş sürüyorsa atama YAŞAR (non-force kapsam)");
  {
    const wo = await makeWo(md, [md.boyaStationId, md.kursunStationId, md.tamburStationId]);
    const boyaStep = wo.stepIds[0]!;
    const kursunStep = wo.stepIds[1]!;

    const fasonBatch = await makeBatch(wo.woId);
    const fasonRoll = await addRoll(md, { batchId: fasonBatch, stepId: boyaStep, qty: 300 });
    const liveBatch = await makeBatch(wo.woId);
    await addRoll(md, { batchId: liveBatch, stepId: kursunStep, qty: 120 });

    const assigned = await bypassSvc.assign(
      { workOrderId: wo.woId, machineId: machineA },
      md.adminUserId,
    );
    const assignmentId = assigned.data.assignmentId;

    await subSvc.dispatch(
      { workOrderId: wo.woId, stepId: boyaStep, subcontractorId: md.subcontractorId, rollIds: [fasonRoll] },
      md.adminUserId,
    );
    await splitSvc.splitBranch(
      wo.woId,
      { batchId: fasonBatch, mode: "UNDYED_MOVE", orderMode: "stock", reason: "T5 fason taşıma" },
      md.adminUserId,
    );

    const row = await rowById(assignmentId);
    check("T5-1: atama YAŞIYOR (kurşun adımı hâlâ açık)", row?.cancelledAt === null, row?.cancelReason ?? "—");
    check("T5-2: atama kaynak WO + kurşun adımında", row?.workOrderId === wo.woId && row?.workOrderStepId === kursunStep);
    check("T5-3: makine değişmedi", row?.machineId === machineA);
  }

  // ===========================================================================
  // T6 — NEW_COLOR: kurşun adımı TERMİNAL ise non-force void (SPLIT_SOURCE)
  // ===========================================================================
  section("T6) NEW_COLOR (tebdil): terminal kurşun adımının bayat ataması iptal");
  {
    const wo = await makeWo(md, [md.boyaStationId, md.kursunStationId, md.tamburStationId]);
    const boyaStep = wo.stepIds[0]!;
    const kursunStep = wo.stepIds[1]!;
    const batchId = await makeBatch(wo.woId);
    const roll = await addRoll(md, { batchId, stepId: kursunStep, qty: 400 });
    void boyaStep;

    const assigned = await bypassSvc.assign(
      { workOrderId: wo.woId, machineId: machineA },
      md.adminUserId,
    );
    const assignmentId = assigned.data.assignmentId;

    // ⚠️ FIXTURE: adımı TERMİNAL yap (SKIPPED, recompute'un dokunmadığı tek durum).
    //    Sahadaki karşılığı: kurşun kapandıktan/atlandıktan sonra tebdil kararı.
    //    `assign` terminal adıma dağıtım YAPMAZ; bu yüzden sıra atama → terminal.
    await prisma.workOrderStep.update({
      where: { id: kursunStep },
      data: { status: StepStatus.SKIPPED, skipReason: "TEST" },
    });

    await splitSvc.splitBranch(
      wo.woId,
      { batchId, mode: "NEW_COLOR", newColorId: md.colorId, orderMode: "stock", reason: "T6 tebdil" },
      md.adminUserId,
    );
    void roll;

    const row = await rowById(assignmentId);
    check("T6-1: bayat atama İPTAL edildi", row?.cancelledAt != null);
    check(
      "T6-2: cancelReason = SPLIT_SOURCE (non-force kapsam yakaladı)",
      row?.cancelReason === "SPLIT_SOURCE",
      row?.cancelReason ?? "—",
    );
    const moved = await prisma.workOrder.findFirst({ where: { splitFromId: wo.woId }, select: { id: true } });
    if (moved) createdWoIds.push(moved.id);
    check(
      "T6-3: yeni WO'da atama DOĞMAZ",
      moved ? (await prisma.kursunBypassAssignment.count({ where: { workOrderId: moved.id } })) === 0 : false,
    );
  }

  // ===========================================================================
  // T7 — İkinci repoint 0 döner (idempotent)
  // ===========================================================================
  section("T7) repointPendingBypassAssignmentsTx idempotent");
  {
    const src = await makeWo(md, [md.kursunStationId, md.tamburStationId]);
    const dst = await makeWo(md, [md.kursunStationId, md.tamburStationId]);
    const batchId = await makeBatch(src.woId);
    const kursunStep = src.stepIds[0]!;
    await addRoll(md, { batchId, stepId: kursunStep, qty: 90 });
    const assigned = await bypassSvc.assign(
      { workOrderId: src.woId, machineId: machineA },
      md.adminUserId,
    );

    const stepMap = new Map([[kursunStep, dst.stepIds[0]!]]);
    const first = await prisma.$transaction((tx) =>
      repointPendingBypassAssignmentsTx(tx, {
        sourceWorkOrderId: src.woId,
        targetWorkOrderId: dst.woId,
        stepMap,
      }),
    );
    const second = await prisma.$transaction((tx) =>
      repointPendingBypassAssignmentsTx(tx, {
        sourceWorkOrderId: src.woId,
        targetWorkOrderId: dst.woId,
        stepMap,
      }),
    );
    check("T7-1: ilk repoint 1 satır taşıdı", first === 1, `${first}`);
    check("T7-2: ikinci repoint 0 döner (idempotent)", second === 0, `${second}`);
    const row = await rowById(assigned.data.assignmentId);
    check("T7-3: satır hedef WO + hedef adımda, açık", row?.workOrderId === dst.woId && row?.workOrderStepId === dst.stepIds[0] && row?.cancelledAt === null);
  }
}

// -----------------------------------------------------------------------------

async function teardown(originalFlag: Prisma.JsonValue | null): Promise<void> {
  try {
    // Devir/tebdil klonları `createdWoIds`e eklendi; yine de splitFrom zincirini tara.
    const clones = await prisma.workOrder.findMany({
      where: { splitFromId: { in: createdWoIds } },
      select: { id: true },
    });
    const woIds = [...new Set([...createdWoIds, ...clones.map((c) => c.id)])];

    const stepRows = await prisma.workOrderStep.findMany({
      where: { workOrderId: { in: woIds } },
      select: { id: true },
    });
    const stepIds = stepRows.map((s) => s.id);
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { id: { in: createdRollIds } },
          { currentStepId: { in: stepIds } },
          { producedInStepId: { in: stepIds } },
          { parentRollId: { in: createdRollIds } },
        ],
      },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: { in: woIds } },
      select: { id: true },
    });
    const dispatchIds = dispatches.map((d) => d.id);
    const assignments = await prisma.kursunBypassAssignment.findMany({
      where: { workOrderId: { in: woIds } },
      select: { id: true },
    });
    const assignmentIds = assignments.map((a) => a.id);

    await prisma.kursunBypassAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ.
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...woIds, ...rollIds, ...assignmentIds, ...dispatchIds] } },
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
    console.log("\n(temizlendi — TEST- iş emirleri / toplar / makineler / istasyonlar silindi, bayrak geri alındı)");
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
