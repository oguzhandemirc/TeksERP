// =============================================================================
// Test: K15 — fasondayken parti birleştirme (belge de birleşir, OSFM kuralı)
// Çalıştır: npx tsx scripts/test_batch_k15_merge.ts
// PARTI-AYIR-BIRLESTIR-V2 Faz 2 senaryoları:
//  a) 4 parti aynı fason adımında aynı firmada → merge: survivor en eski no,
//     tüm toplar+sevkler survivor'da, açık sevkler TEK açık sevke konsolide
//     (diğerleri K15_MERGE ile kapalı), kaynaklar mergedIntoId ile tarihçe,
//     getBranches lane: survivor locked=true, kaynaklar rollCount=0+mergedInto.
//  b) Merge SONRASI receive() (tam dönüş) → firma doğru çözülür, born toplar
//     survivor partisine doğar (uçtan uca kanıt).
//  c) Aynı adımda FARKLI firmalara açık sevkli 2 parti → 409 + iki firma adı;
//     hiçbir batch/dispatch mutasyonu olmadan.
//  d) FARKLI adımlarda farklı firmalara sevkli 2 parti → merge BAŞARILI.
//  e) Dönmüş (kilitsiz) 2 parti merge → tarihçe sevkler retarget; merge sonrası
//     cancelReceipt BAŞARILI (roll.batchId===dispatch.batchId doğal geçer).
//  f) mergedIntoId'li kaynak partiye yeni sevk / moveRolls hedefi → 400 red.
//  g) DÖNMÜŞ(F1) + AÇIK(F2) sevk AYNI adımda → merge BAŞARILI; merge sonrası
//     receive/pendingParties DOĞRU firmayı (F2, açık sevk) çözer (MAJOR-1 kanıtı —
//     outstanding-scope olmadan Map last-wins dönmüş sevkin firmasını tutardı).
//  h) PARTIAL loser konsolidasyonu — kısmi dönmüş sevkin kalemleri keeper'a
//     taşınır, receiptItem bağı kopmaz, keeper totalQty doğru + K15 belge notu,
//     loser totalQty=0 + irsaliyesi VOID (MINOR-2).
// =============================================================================
import prisma from "../src/lib/prisma";
import { PrintedDocStatus, PrintedDocType, RollStatus, StationKind, StationType, WorkOrderStatus } from "@prisma/client";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { createBatchTx, mergeBatches, moveRolls } from "../src/services/batch.service";
import { withBarcodeRetry } from "../src/utils/barcode-retry";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, parts: string[], fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    check(label, parts.every((p) => m.includes(p)), m.slice(0, 220));
  }
}

const sub = new SubcontractorService();
const woSvc = new WorkOrderService();

interface Lane {
  batchId: string;
  batchNumber: string;
  locked: boolean;
  rollCount: number;
  mergedInto: { id: string; batchNumber: string } | null;
}

async function main() {
  const ts = Date.now();
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!admin || !item) throw new Error("Fixture: admin/item yok (seed gerekli)");

  // ── Ortak fixture: istasyonlar + firmalar ──
  const st1 = await prisma.station.create({
    data: { code: `TST-K15-ST1-${ts}`, name: "TEST K15 Fason1", type: StationType.EXTERNAL, kind: StationKind.SUBCONTRACTOR },
    select: { id: true, name: true },
  });
  const st2 = await prisma.station.create({
    data: { code: `TST-K15-ST2-${ts}`, name: "TEST K15 Fason2", type: StationType.EXTERNAL, kind: StationKind.SUBCONTRACTOR },
    select: { id: true },
  });
  const stInt = await prisma.station.create({
    data: { code: `TST-K15-STI-${ts}`, name: "TEST K15 İç", type: StationType.INTERNAL, kind: StationKind.OTHER },
    select: { id: true },
  });
  const firm1 = await prisma.subcontractor.create({
    data: { code: `TST-K15-F1-${ts}`, name: `TEST K15 Firma Bir ${ts}` },
    select: { id: true, name: true },
  });
  const firm2 = await prisma.subcontractor.create({
    data: { code: `TST-K15-F2-${ts}`, name: `TEST K15 Firma İki ${ts}` },
    select: { id: true, name: true },
  });

  // 2. iç adım ŞART (test_k14_lock_edges deseni): tek adımlı rotada tam dönüş
  // WO'yu COMPLETED yapar ve kabul-iptali "tamamlanmış WO" guard'ına takılırdı.
  const mkWO = (tag: string, steps: Array<{ stationId: string; planned?: string }>) =>
    prisma.workOrder.create({
      data: {
        workOrderNumber: `TST-K15-WO-${tag}-${ts}`,
        type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, width: 150, targetItemId: item.id,
        steps: {
          create: steps.map((s, i) => ({
            stationId: s.stationId,
            stepSequence: i + 1,
            status: (i === 0 ? "ACTIVE" : "PENDING") as "ACTIVE" | "PENDING",
            plannedSubcontractorId: s.planned ?? null,
          })),
        },
      },
      include: { steps: { orderBy: { stepSequence: "asc" } } },
    });

  const woA = await mkWO("A", [{ stationId: st1.id, planned: firm1.id }, { stationId: stInt.id }]);
  const woC = await mkWO("C", [{ stationId: st1.id, planned: firm1.id }, { stationId: stInt.id }]);
  const woD = await mkWO("D", [
    { stationId: st1.id, planned: firm1.id },
    { stationId: st2.id, planned: firm2.id },
    { stationId: stInt.id },
  ]);
  const woE = await mkWO("E", [{ stationId: st1.id, planned: firm1.id }, { stationId: stInt.id }]);
  const woG = await mkWO("G", [{ stationId: st1.id, planned: firm1.id }, { stationId: stInt.id }]);
  const woH = await mkWO("H", [{ stationId: st1.id, planned: firm1.id }, { stationId: stInt.id }]);
  const woIds = [woA.id, woC.id, woD.id, woE.id, woG.id, woH.id];

  const allRollIds: string[] = [];
  let n = 0;
  const mkRoll = async (stepId: string) => {
    n++;
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-K15-R${n}-${ts}`, itemId: item.id, status: RollStatus.IN_PRODUCTION,
        currentQty: 100, initialQty: 100, width: 150, currentStepId: stepId, entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    allRollIds.push(r.id);
    await prisma.rollMovement.create({
      data: { rollId: r.id, workOrderStepId: stepId, qtyIn: 100, operatorId: admin!.id },
    });
    return r;
  };
  // `withBarcodeRetry` ŞART — `batch.service.ts`'in sözleşmesi bunu açıkça yazıyor:
  // "Çağıran tx'i `withBarcodeRetry(() => prisma.$transaction(...))` ile sarmalı".
  // `generateBatchNumberTx` günün NUMERIC max'ı + 1 okur; bu bir check-then-act'tir
  // ve kilit almaz. Aynı anda BAŞKA biri (paralel bir test/script, paylaşılan dev
  // DB'si) parti yaratırsa iki taraf aynı P kodunu hesaplar → `@unique` ihlali
  // (P2002). Sarmalayıcı yokken bu test tam olarak öyle düştü (2026-08-01 koşusu);
  // tek başına koşarken görünmüyor çünkü yarışacak kimse yok.
  const mkBatch = async (workOrderId: string, rollIds: string[]) => {
    const { batch } = await withBarcodeRetry(() =>
      prisma.$transaction((tx) => createBatchTx(tx, { workOrderId, rollIds })),
    );
    return batch;
  };

  try {
    // ═══ Senaryo a: 4 parti aynı adımda aynı firmada fasonda → merge ═══
    const stepA1 = woA.steps[0]!.id;
    const rollsA = [await mkRoll(stepA1), await mkRoll(stepA1), await mkRoll(stepA1), await mkRoll(stepA1)];
    // Tip `mkBatch`'ten türetilir — boş `[]` implicit `any[]` doğuruyordu, yani
    // aşağıdaki `b.id` / `b.batchNumber` erişimleri hiç kontrol edilmiyordu.
    const batchesA: Awaited<ReturnType<typeof mkBatch>>[] = [];
    for (const r of rollsA) batchesA.push(await mkBatch(woA.id, [r.id]));
    const dispA: string[] = [];
    for (const r of rollsA) {
      const res = await sub.dispatch(
        { workOrderId: woA.id, stepId: stepA1, subcontractorId: firm1.id, rollIds: [r.id] },
        admin.id,
      );
      dispA.push((res.data as { id: string }).id);
    }
    const d1No = (await prisma.subcontractorDispatch.findUnique({
      where: { id: dispA[0] }, select: { dispatchNo: true },
    }))!.dispatchNo;

    const mergeA = await mergeBatches({ batchIds: batchesA.map((b) => b.id), userId: admin.id });
    check("a1: survivor en eski parti no", mergeA.survivorId === batchesA[0].id && mergeA.survivorNumber === batchesA[0].batchNumber);

    const rollsAfterA = await prisma.roll.findMany({
      where: { id: { in: rollsA.map((r) => r.id) } }, select: { batchId: true },
    });
    check("a2: TÜM toplar survivor'da", rollsAfterA.every((r) => r.batchId === batchesA[0].id));

    const dispAfterA = await prisma.subcontractorDispatch.findMany({
      where: { id: { in: dispA } },
      select: { id: true, batchId: true, cancelledAt: true, cancelReason: true, dispatchNo: true, totalQty: true, items: { select: { id: true } } },
    });
    check("a3: 4 sevk de batchId=survivor", dispAfterA.every((d) => d.batchId === batchesA[0].id));
    const openA = dispAfterA.filter((d) => !d.cancelledAt);
    const closedA = dispAfterA.filter((d) => d.cancelledAt);
    check("a4: TEK açık sevk kaldı (en eski)", openA.length === 1 && openA[0].dispatchNo === d1No);
    check("a5: açık sevk 4 kalemi topladı + totalQty=400", openA[0]?.items.length === 4 && Number(openA[0]?.totalQty) === 400);
    check(
      "a6: kapananlar K15_MERGE sebebiyle (survivor parti + yaşayan sevk no)",
      closedA.length === 3 &&
        closedA.every((d) => d.cancelReason?.startsWith("K15_MERGE:") && d.cancelReason.includes(mergeA.survivorNumber) && d.cancelReason.includes(d1No)),
    );

    const srcAfterA = await prisma.batch.findMany({
      where: { id: { in: batchesA.slice(1).map((b) => b.id) } }, select: { mergedIntoId: true },
    });
    check("a7: kaynak 3 parti duruyor + mergedIntoId=survivor", srcAfterA.length === 3 && srcAfterA.every((b) => b.mergedIntoId === batchesA[0].id));

    const lanesA = ((await woSvc.getBranches(woA.id)).data as { batches: Lane[] }).batches;
    const survLane = lanesA.find((l) => l.batchId === batchesA[0].id);
    const srcLanes = lanesA.filter((l) => batchesA.slice(1).some((b) => b.id === l.batchId));
    check("a8: lane survivor locked=true + rollCount=4", survLane?.locked === true && survLane.rollCount === 4);
    check(
      "a9: kaynak lane'ler rollCount=0 + mergedInto dolu",
      // `?.` ikinci erişimde de: `mergedInto` null olsaydı ilk koşul zaten false
      // olup kısa devre yapardı — davranış AYNI, yalnız tip güvenli.
      srcLanes.length === 3 && srcLanes.every((l) => l.rollCount === 0 && l.mergedInto?.id === batchesA[0].id && l.mergedInto?.batchNumber === mergeA.survivorNumber),
    );

    // ═══ Senaryo b: merge SONRASI receive (tam dönüş, konsolide sevkin tüm topları) ═══
    const recvB = await sub.receive(
      {
        workOrderId: woA.id, stepId: stepA1, subcontractorId: firm1.id,
        returns: rollsA.map((r) => ({ rollId: r.id })), newRolls: [{ qty: 400 }],
      },
      admin.id,
    );
    check("b1: merge sonrası kabul BAŞARILI (firma doğru çözüldü)", recvB.success === true);
    const receiptBId = (recvB.data as { id?: string }).id!;
    const bornB = await prisma.roll.findFirst({
      where: { parentReceiptId: receiptBId }, select: { id: true, batchId: true, currentStepId: true },
    });
    check("b2: born top survivor partisine doğdu", bornB?.batchId === batchesA[0].id);
    check("b3: born top sonraki (iç) adıma bağlandı", bornB?.currentStepId === woA.steps[1]!.id);
    const consumedB = await prisma.roll.count({
      where: { id: { in: rollsA.map((r) => r.id) }, status: RollStatus.SUBCONTRACTOR_CONSUMED },
    });
    check("b4: 4 orijinal top SUBCONTRACTOR_CONSUMED (survivor'da tarihçe)", consumedB === 4);

    // ═══ Senaryo c: aynı adımda FARKLI firmalara açık sevk → 409 + mutasyonsuz ═══
    const stepC1 = woC.steps[0]!.id;
    const rc1 = await mkRoll(stepC1); const rc2 = await mkRoll(stepC1);
    const bc1 = await mkBatch(woC.id, [rc1.id]); const bc2 = await mkBatch(woC.id, [rc2.id]);
    await sub.dispatch({ workOrderId: woC.id, stepId: stepC1, subcontractorId: firm1.id, rollIds: [rc1.id] }, admin.id);
    await sub.dispatch({ workOrderId: woC.id, stepId: stepC1, subcontractorId: firm2.id, rollIds: [rc2.id] }, admin.id);
    await expectErr(
      "c1: farklı firmalara açık sevkli merge 409 — mesajda İKİ firma adı + adım + parti no'ları",
      [firm1.name, firm2.name, st1.name, bc1.batchNumber, bc2.batchNumber],
      () => mergeBatches({ batchIds: [bc1.id, bc2.id], userId: admin!.id }),
    );
    const cBatches = await prisma.batch.findMany({
      where: { id: { in: [bc1.id, bc2.id] } }, select: { id: true, mergedIntoId: true },
    });
    const cRolls = await prisma.roll.findMany({
      where: { id: { in: [rc1.id, rc2.id] } }, select: { id: true, batchId: true },
    });
    const cDisps = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: woC.id }, select: { batchId: true, cancelledAt: true },
    });
    check(
      "c2: hiçbir batch/roll/dispatch mutasyonu yok",
      cBatches.every((b) => b.mergedIntoId === null) &&
        cRolls.find((r) => r.id === rc1.id)?.batchId === bc1.id &&
        cRolls.find((r) => r.id === rc2.id)?.batchId === bc2.id &&
        cDisps.length === 2 &&
        cDisps.every((d) => d.cancelledAt === null) &&
        cDisps.some((d) => d.batchId === bc1.id) && cDisps.some((d) => d.batchId === bc2.id),
    );

    // ═══ Senaryo d: FARKLI adımlarda farklı firmalara açık sevk → merge BAŞARILI ═══
    const stepD1 = woD.steps[0]!.id; const stepD2 = woD.steps[1]!.id;
    const rd1 = await mkRoll(stepD1); const rd2 = await mkRoll(stepD2);
    const bd1 = await mkBatch(woD.id, [rd1.id]); const bd2 = await mkBatch(woD.id, [rd2.id]);
    await sub.dispatch({ workOrderId: woD.id, stepId: stepD1, subcontractorId: firm1.id, rollIds: [rd1.id] }, admin.id);
    await sub.dispatch(
      { workOrderId: woD.id, stepId: stepD2, subcontractorId: firm2.id, rollIds: [rd2.id], allowRouteSkip: true },
      admin.id,
    );
    const mergeD = await mergeBatches({ batchIds: [bd1.id, bd2.id], userId: admin.id });
    check("d1: farklı adımlarda farklı firma — merge başarılı, survivor en eski", mergeD.survivorId === bd1.id);
    const dDisps = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: woD.id }, select: { stepId: true, batchId: true, cancelledAt: true },
    });
    check(
      "d2: iki açık sevk de survivor'da ve AÇIK kaldı (adım-scope'lu, konsolidasyon yok)",
      dDisps.length === 2 && dDisps.every((d) => d.batchId === bd1.id && d.cancelledAt === null) &&
        new Set(dDisps.map((d) => d.stepId)).size === 2,
    );

    // ═══ Senaryo e: dönmüş (kilitsiz) partiler merge → cancelReceipt doğal geçer ═══
    const stepE1 = woE.steps[0]!.id;
    const re1 = await mkRoll(stepE1); const re2 = await mkRoll(stepE1);
    const be1 = await mkBatch(woE.id, [re1.id]); const be2 = await mkBatch(woE.id, [re2.id]);
    await sub.dispatch({ workOrderId: woE.id, stepId: stepE1, subcontractorId: firm1.id, rollIds: [re1.id] }, admin.id);
    await sub.dispatch({ workOrderId: woE.id, stepId: stepE1, subcontractorId: firm1.id, rollIds: [re2.id] }, admin.id);
    await sub.receive(
      { workOrderId: woE.id, stepId: stepE1, subcontractorId: firm1.id, returns: [{ rollId: re1.id }], newRolls: [{ qty: 100 }] },
      admin.id,
    );
    const recvE2 = await sub.receive(
      { workOrderId: woE.id, stepId: stepE1, subcontractorId: firm1.id, returns: [{ rollId: re2.id }], newRolls: [{ qty: 100 }] },
      admin.id,
    );
    const receiptE2Id = (recvE2.data as { id?: string }).id!;
    const mergeE = await mergeBatches({ batchIds: [be1.id, be2.id], userId: admin.id });
    check("e1: dönmüş partiler merge başarılı, survivor en eski", mergeE.survivorId === be1.id);
    const eDisps = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: woE.id }, select: { batchId: true, cancelledAt: true },
    });
    check("e2: tarihçe (dönmüş) sevkler de retarget edildi + iptal edilmedi", eDisps.length === 2 && eDisps.every((d) => d.batchId === be1.id && d.cancelledAt === null));
    // Faz-1 tutarlılık guard'ının doğal geçeceğinin AÇIK kanıtı: iptal ÖNCESİ
    // canlanacak topun batchId'si == kaynak sevkin batchId'si (ikisi de survivor).
    const re2Row = await prisma.roll.findUnique({ where: { id: re2.id }, select: { batchId: true } });
    const re2DispItem = await prisma.subcontractorDispatchItem.findFirst({
      where: { rollId: re2.id, dispatch: { stepId: stepE1, cancelledAt: null, directShippedAt: null } },
      select: { dispatch: { select: { batchId: true } } },
    });
    check(
      "e3: iptal öncesi roll.batchId === dispatch.batchId === survivor (K15 retarget kanıtı)",
      re2Row?.batchId === be1.id && re2DispItem?.dispatch.batchId === be1.id,
    );
    const bornE2 = await prisma.roll.findFirst({ where: { parentReceiptId: receiptE2Id }, select: { id: true } });
    const cancelE = await sub.cancelReceipt(receiptE2Id, "K15 test — merge sonrası iptal", admin.id, bornE2 ? [bornE2.id] : []);
    check("e4: merge sonrası kabul iptali BAŞARILI (guard doğal geçti)", cancelE.success === true);
    const re2After = await prisma.roll.findUnique({ where: { id: re2.id }, select: { status: true, batchId: true } });
    check("e5: iptalle canlanan top AT_SUBCONTRACTOR + survivor partide", re2After?.status === RollStatus.AT_SUBCONTRACTOR && re2After.batchId === be1.id);

    // ═══ Senaryo f: mergedIntoId'li kaynak partiye yeni sevk/moveRolls → 400 ═══
    const rf = await mkRoll(stepA1);
    await prisma.roll.update({ where: { id: rf.id }, data: { batchId: batchesA[1].id } }); // birleşmiş kaynak
    await expectErr(
      "f1: birleşmiş kaynak partili topla yeni sevk 400 (survivor'a yönlendirme)",
      ["birleştirilmiş", mergeA.survivorNumber, batchesA[1].batchNumber],
      () => sub.dispatch({ workOrderId: woA.id, stepId: stepA1, subcontractorId: firm1.id, rollIds: [rf.id] }, admin!.id),
    );
    await expectErr(
      "f2: birleşmiş kaynak parti moveRolls HEDEFİ olamaz 400",
      ["birleştirilmiş", mergeA.survivorNumber],
      () => moveRolls({ rollIds: [rf.id], toBatchId: batchesA[1].id, userId: admin!.id }),
    );

    // ═══ Senaryo g: DÖNMÜŞ(F1) + AÇIK(F2) sevk AYNI adımda → merge BAŞARILI;
    //     firma çözümü merge sonrası AÇIK sevkin firmasını (F2) bulur (MAJOR-1) ═══
    const stepG1 = woG.steps[0]!.id;
    const rg1 = await mkRoll(stepG1); const rg2 = await mkRoll(stepG1);
    const bg1 = await mkBatch(woG.id, [rg1.id]); const bg2 = await mkBatch(woG.id, [rg2.id]);
    await sub.dispatch({ workOrderId: woG.id, stepId: stepG1, subcontractorId: firm1.id, rollIds: [rg1.id] }, admin.id);
    await sub.receive(
      { workOrderId: woG.id, stepId: stepG1, subcontractorId: firm1.id, returns: [{ rollId: rg1.id }], newRolls: [{ qty: 100 }] },
      admin.id,
    );
    const dispG2 = await sub.dispatch(
      { workOrderId: woG.id, stepId: stepG1, subcontractorId: firm2.id, rollIds: [rg2.id] },
      admin.id,
    );
    const dG2No = (await prisma.subcontractorDispatch.findUnique({
      where: { id: (dispG2.data as { id: string }).id }, select: { dispatchNo: true },
    }))!.dispatchNo;

    const mergeG = await mergeBatches({ batchIds: [bg1.id, bg2.id], userId: admin.id });
    check("g1: dönmüş(F1)+açık(F2) AYNI adım merge BAŞARILI (dönmüş sevk guard'a girmez)", mergeG.survivorId === bg1.id);

    // Mobil kabul gruplaması (buildPendingParties): survivor lane'i AÇIK sevkin
    // firmasını göstermeli. outstanding filtresi olmadan batchId→dispatch Map'i
    // (dispatchedAt desc + last-wins) dönmüş F1 sevkini tutar → deterministik kanıt.
    const detailG = (await sub.getPendingReturnGroupDetail(stepG1)).data as {
      parties: Array<{ dispatchNo: string | null; subcontractorId: string | null; rollCount: number }>;
    };
    const laneG = detailG.parties.find((p) => p.rollCount === 1);
    check(
      "g2: pendingParties survivor lane'i AÇIK sevki (F2) çözer — dönmüş F1 sevki ezmez",
      detailG.parties.length === 1 && laneG?.subcontractorId === firm2.id && laneG.dispatchNo === dG2No,
    );

    const recvG = await sub.receive(
      { workOrderId: woG.id, stepId: stepG1, subcontractorId: firm2.id, returns: [{ rollId: rg2.id }], newRolls: [{ qty: 100 }] },
      admin.id,
    );
    check("g3: merge sonrası F2 kabulü BAŞARILI (F74 outstanding-scope doğru firmayı çözdü)", recvG.success === true);
    const bornG = await prisma.roll.findFirst({
      where: { parentReceiptId: (recvG.data as { id?: string }).id! }, select: { batchId: true },
    });
    check("g4: born top survivor partiye doğdu", bornG?.batchId === bg1.id);

    // ═══ Senaryo h: PARTIAL loser konsolidasyonu — kısmi dönmüş sevkin kalemleri
    //     keeper'a taşınır, receiptItem bağı kopmaz, keeper totalQty doğru ═══
    const stepH1 = woH.steps[0]!.id;
    const rh1 = await mkRoll(stepH1); const rh2 = await mkRoll(stepH1); const rh3 = await mkRoll(stepH1);
    const bh1 = await mkBatch(woH.id, [rh1.id]); const bh2 = await mkBatch(woH.id, [rh2.id, rh3.id]);
    const dH1 = ((await sub.dispatch(
      { workOrderId: woH.id, stepId: stepH1, subcontractorId: firm1.id, rollIds: [rh1.id] },
      admin.id,
    )).data as { id: string }).id;
    const dH2 = ((await sub.dispatch(
      { workOrderId: woH.id, stepId: stepH1, subcontractorId: firm1.id, rollIds: [rh2.id, rh3.id] },
      admin.id,
    )).data as { id: string }).id;
    const dH2No = (await prisma.subcontractorDispatch.findUnique({
      where: { id: dH2 }, select: { dispatchNo: true },
    }))!.dispatchNo;
    // Kısmi dönüş: yalnız rh2 döner → dH2 hâlâ OUTSTANDING (rh3 fasonda).
    const recvH1 = await sub.receive(
      { workOrderId: woH.id, stepId: stepH1, subcontractorId: firm1.id, returns: [{ rollId: rh2.id }], newRolls: [{ qty: 100 }] },
      admin.id,
    );
    const receiptH1Id = (recvH1.data as { id?: string }).id!;

    const mergeH = await mergeBatches({ batchIds: [bh1.id, bh2.id], userId: admin.id });
    check("h1: kısmi-dönmüş loser ile merge BAŞARILI, survivor en eski", mergeH.survivorId === bh1.id);

    const dH1After = await prisma.subcontractorDispatch.findUnique({
      where: { id: dH1 },
      select: { totalQty: true, notes: true, cancelledAt: true, items: { select: { rollId: true } } },
    });
    const dH2After = await prisma.subcontractorDispatch.findUnique({
      where: { id: dH2 },
      select: { totalQty: true, cancelledAt: true, cancelReason: true, items: { select: { id: true } } },
    });
    check(
      "h2: loser'ın TÜM kalemleri (dönmüş rh2 dahil) keeper'a taşındı",
      dH1After?.items.length === 3 &&
        [rh1.id, rh2.id, rh3.id].every((id) => dH1After.items.some((i) => i.rollId === id)) &&
        dH2After?.items.length === 0,
    );
    check(
      "h3: keeper totalQty=300 (kalem toplamı), loser totalQty=0 + K15_MERGE kapalı",
      Number(dH1After?.totalQty) === 300 && !!dH2After?.cancelledAt &&
        Number(dH2After?.totalQty) === 0 && (dH2After?.cancelReason ?? "").startsWith("K15_MERGE:"),
    );
    check(
      "h4: keeper notes'a K15 belge notu APPEND edildi (loser sevk no ile)",
      (dH1After?.notes ?? "").includes("K15:") && (dH1After?.notes ?? "").includes(dH2No) &&
        (dH1After?.notes ?? "").includes("kalemleri bu sevke birleştirildi"),
    );
    // receiptItem bağı kopmadı — kısmi kabulün kalemi AYNI dispatch item'ı gösteriyor,
    // item artık keeper'ın altında (kalem taşınınca bağ kendiliğinden yaşayan sevke geçer).
    const rItemH = await prisma.subcontractorReceiptItem.findFirst({
      where: { receiptId: receiptH1Id, sourceDispatchItemId: { not: null } },
      select: { sourceDispatchItem: { select: { dispatchId: true, rollId: true } } },
    });
    check(
      "h5: receiptItem→dispatchItem bağı kopmadı, kalem keeper altında",
      rItemH?.sourceDispatchItem?.rollId === rh2.id && rItemH.sourceDispatchItem.dispatchId === dH1,
    );
    // Belge cerrahisi (MINOR-2): loser irsaliyesi VOID, keeper irsaliyesi ACTIVE.
    const docsH1 = await prisma.printedDocument.findMany({
      where: { docType: PrintedDocType.SUBCONTRACTOR_DISPATCH, sourceId: dH1 }, select: { status: true },
    });
    const docsH2 = await prisma.printedDocument.findMany({
      where: { docType: PrintedDocType.SUBCONTRACTOR_DISPATCH, sourceId: dH2 }, select: { status: true },
    });
    check(
      "h6: loser PrintedDocument VOIDED, keeper ACTIVE",
      docsH2.length > 0 && docsH2.every((d) => d.status === PrintedDocStatus.VOIDED) &&
        docsH1.some((d) => d.status === PrintedDocStatus.ACTIVE),
    );
    // Kalan mal (rh1+rh3) karışık kalemli (dönmüş+dönmemiş) keeper üzerinden kabul edilir.
    const recvH2 = await sub.receive(
      { workOrderId: woH.id, stepId: stepH1, subcontractorId: firm1.id, returns: [{ rollId: rh1.id }, { rollId: rh3.id }], newRolls: [{ qty: 200 }] },
      admin.id,
    );
    check("h7: merge sonrası kalan malın kabulü BAŞARILI", recvH2.success === true);
  } finally {
    // Cleanup — bağımlılık sırasıyla, hepsi WO-scope'lu.
    // PrintedDocument'lar sourceId polimorfik (FK yok) — dispatch id'leri silinmeden ÖNCE toplanır.
    const dispIdsAll = (
      await prisma.subcontractorDispatch
        .findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })
        .catch(() => [] as { id: string }[])
    ).map((d) => d.id);
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispIdsAll } } }).catch(() => {});
    // NEDEN `step` (`workOrderStep` DEĞİL): RollOperation/RollMovement üzerindeki
    // ilişki alanının ADI `step`'tir (`workOrderStepId` skaler kolonun adıdır).
    // Burada eskiden `workOrderStep:` yazıyordu → Prisma her çağrıda
    // PrismaClientValidationError atıyor, `.catch(() => {})` de onu YUTUYORDU:
    // temizlik hiç koşmadı, WO adımları/işlem log'ları ve peşi sıra istasyonlar
    // dev DB'sinde birikti (denetim anında 200 aktif istasyonun çoğu bu artıktı).
    // Hata değil, SESSİZ SIZINTI — `scripts/` derlenmediği için görünmüyordu.
    await prisma.rollOperation.deleteMany({ where: { step: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: allRollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { step: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receipt: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receipt: { workOrderId: { in: woIds } } } }).catch(() => {});
    // Born toplar receipt'lere FK ile bağlı — receipt'lerden ÖNCE silinmeli.
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (2026-08-21'den beri
    // fason kabulünde giden↔dönen metraj farkı da deftere yazılıyor). Silinmezse
    // temizlik 23001 ile yarıda kalır ve arkasında hayalet kayıt bırakır.
    await prisma.rollVariance.deleteMany({ where: { roll: { parentReceipt: { workOrderId: { in: woIds } } } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { parentReceipt: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatch: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { roll: { id: { in: allRollIds } } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: allRollIds } } }).catch(() => {});
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    await prisma.subcontractor.deleteMany({ where: { id: { in: [firm1.id, firm2.id] } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: [st1.id, st2.id, stInt.id] } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
