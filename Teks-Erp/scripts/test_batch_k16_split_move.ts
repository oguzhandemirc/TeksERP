// =============================================================================
// Test: K16 + K18 — fasondayken parti böl/taşı (sevk cerrahisi) + labelDirty
// Çalıştır: npx tsx scripts/test_batch_k16_split_move.ts
// PARTI-AYIR-BIRLESTIR-V2 Faz 3 senaryoları:
//  a) Fasonda 3 toplu parti, 2'si yeni partiye ayrılır → yeni parti (splitFrom
//     dolu), YENİ sevk kaydı (aynı firma+adım+plaka+şoför+talimat + ORİJİNAL
//     dispatchedAt, yeni no, K16 notu), kalemler 2/1, totalQty'ler kalemlerden,
//     iki parti de kilitli (K14), her (parti,adım)'da TEK açık sevk; K18:
//     taşınan toplar labelDirty, kalan top değil.
//  b) Ayırma sonrası her iki parti için receive() AYRI AYRI başarılı — born
//     toplar doğru partiye doğar (dispatch.batchId kalıtımı).
//  c) moveRolls TAM-RETARGET dalı: 2 toplu partinin İKİ topu da (tek sevk)
//     sevksiz hedef partiye taşınır → sevk kaydı OLDUĞU GİBİ retarget (yeni
//     belge yok, irsaliye ACTIVE), kaynak parti boş + İZLİ (mergedIntoId=hedef);
//     retarget sonrası kabul hedef partide başarılı.
//  d) moveRolls hedefin aynı adımda FARKLI firmaya açık sevki varken → 409 +
//     mutasyonsuzluk (K15 guard mesaj kalıbı: iki firma adı + adım).
//  e) moveRolls hedefin AYNI firmaya açık sevki varken → kalemler hedef sevkte
//     birleşir, tek açık sevk kalır; boşalan kaynak sevk K16_MOVE ile kapanır
//     (totalQty=0 + irsaliye VOID); kabul E2E başarılı.
//  f) K18 mergeBatches: taşınan CANLI top labelDirty=true; CONSUMED taşınan top
//     bayraklanmaz; survivor'ın kendi topu bayraklanmaz. + splitBatch tüketilmiş
//     tarihçe topunu bölmede reddeder (savunma).
//  g) split'te "TÜM toplar seçilemez" kuralı fasondayken de sürer.
// =============================================================================
import prisma from "../src/lib/prisma";
import { PrintedDocStatus, PrintedDocType, RollStatus, StationKind, StationType, WorkOrderStatus } from "@prisma/client";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { isBatchLockedTx, createBatchTx, mergeBatches, moveRolls, splitBatch } from "../src/services/batch.service";

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

/** (parti, adım) çiftindeki AÇIK+OUTSTANDING sevk sayısı (K16 değişmez kontrolü). */
function openOutstandingCount(batchId: string, stepId: string): Promise<number> {
  return prisma.subcontractorDispatch.count({
    where: {
      batchId,
      stepId,
      cancelledAt: null,
      directShippedAt: null,
      items: { some: { receiptItems: { none: { receipt: { cancelledAt: null } } } } },
    },
  });
}

async function main() {
  const ts = Date.now();
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!admin || !item) throw new Error("Fixture: admin/item yok (seed gerekli)");

  // ── Ortak fixture: istasyonlar + firmalar (test_batch_k15_merge deseni) ──
  const st1 = await prisma.station.create({
    data: { code: `TST-K16-ST1-${ts}`, name: "TEST K16 Fason1", type: StationType.EXTERNAL, kind: StationKind.SUBCONTRACTOR },
    select: { id: true, name: true },
  });
  const stInt = await prisma.station.create({
    data: { code: `TST-K16-STI-${ts}`, name: "TEST K16 İç", type: StationType.INTERNAL, kind: StationKind.OTHER },
    select: { id: true },
  });
  const firm1 = await prisma.subcontractor.create({
    data: { code: `TST-K16-F1-${ts}`, name: `TEST K16 Firma Bir ${ts}` },
    select: { id: true, name: true },
  });
  const firm2 = await prisma.subcontractor.create({
    data: { code: `TST-K16-F2-${ts}`, name: `TEST K16 Firma İki ${ts}` },
    select: { id: true, name: true },
  });

  // 2. iç adım ŞART: tek adımlı rotada tam dönüş WO'yu COMPLETED yapar (k15 deseni).
  const mkWO = (tag: string) =>
    prisma.workOrder.create({
      data: {
        workOrderNumber: `TST-K16-WO-${tag}-${ts}`,
        type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, width: 150, targetItemId: item.id,
        steps: {
          create: [
            { stationId: st1.id, stepSequence: 1, status: "ACTIVE" as const, plannedSubcontractorId: firm1.id },
            { stationId: stInt.id, stepSequence: 2, status: "PENDING" as const },
          ],
        },
      },
      include: { steps: { orderBy: { stepSequence: "asc" } } },
    });

  const woA = await mkWO("A");
  const woC = await mkWO("C");
  const woD = await mkWO("D");
  const woE = await mkWO("E");
  const woF = await mkWO("F");
  const woIds = [woA.id, woC.id, woD.id, woE.id, woF.id];

  const allRollIds: string[] = [];
  let n = 0;
  const mkRoll = async (stepId: string) => {
    n++;
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-K16-R${n}-${ts}`, itemId: item.id, status: RollStatus.IN_PRODUCTION,
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
  const mkBatch = async (workOrderId: string, rollIds: string[]) => {
    const { batch } = await prisma.$transaction((tx) => createBatchTx(tx, { workOrderId, rollIds }));
    return batch;
  };
  const locked = (batchId: string) => prisma.$transaction((tx) => isBatchLockedTx(tx, batchId));

  try {
    // ═══ Senaryo a: fasonda 3 toplu parti, 2'si yeni partiye — KISMİ sevk bölme ═══
    const stepA1 = woA.steps[0]!.id;
    const ra1 = await mkRoll(stepA1); const ra2 = await mkRoll(stepA1); const ra3 = await mkRoll(stepA1);
    const bA = await mkBatch(woA.id, [ra1.id, ra2.id, ra3.id]);
    const dispA = ((await sub.dispatch(
      {
        workOrderId: woA.id, stepId: stepA1, subcontractorId: firm1.id,
        rollIds: [ra1.id, ra2.id, ra3.id],
        plateNumber: "06 K16 123", driverName: "K16 Şoför", notes: "K16 orijinal not", instruction: "K16 talimatı",
      },
      admin.id,
    )).data as { id: string }).id;
    // dispatchedAt'i geçmişe çek — K16 doğan sevkin "fiziksel gerçek" tarihi
    // (orijinal sevkin günü) kalıttığı ayırt edilebilir olsun.
    const pastA = new Date(Date.now() - 36 * 3600 * 1000);
    await prisma.subcontractorDispatch.update({ where: { id: dispA }, data: { dispatchedAt: pastA } });
    const dANo = (await prisma.subcontractorDispatch.findUnique({ where: { id: dispA }, select: { dispatchNo: true } }))!.dispatchNo;

    const splitA = await splitBatch({ batchId: bA.id, rollIds: [ra1.id, ra2.id], userId: admin.id });

    const newBatchRow = await prisma.batch.findUnique({
      where: { id: splitA.newBatchId }, select: { splitFromId: true },
    });
    const memA = await prisma.roll.findMany({
      where: { id: { in: [ra1.id, ra2.id, ra3.id] } }, select: { id: true, batchId: true, labelDirty: true, status: true },
    });
    check(
      "a1: yeni parti doğdu (splitFrom=kaynak) + üyelik 2/1 bölündü",
      newBatchRow?.splitFromId === bA.id &&
        memA.filter((r) => r.batchId === splitA.newBatchId).length === 2 &&
        memA.find((r) => r.id === ra3.id)?.batchId === bA.id,
    );

    const bornA = await prisma.subcontractorDispatch.findFirst({
      where: { batchId: splitA.newBatchId },
      select: {
        dispatchNo: true, stepId: true, subcontractorId: true, plateNumber: true, driverName: true,
        instruction: true, notes: true, dispatchedAt: true, cancelledAt: true, totalQty: true,
        items: { select: { rollId: true } },
      },
    });
    check(
      "a2: YENİ sevk doğdu — aynı firma+adım+plaka+şoför+talimat, ORİJİNAL dispatchedAt, yeni no",
      !!bornA && bornA.cancelledAt === null && bornA.subcontractorId === firm1.id && bornA.stepId === stepA1 &&
        bornA.plateNumber === "06 K16 123" && bornA.driverName === "K16 Şoför" && bornA.instruction === "K16 talimatı" &&
        bornA.dispatchedAt.getTime() === pastA.getTime() && bornA.dispatchNo !== dANo && bornA.dispatchNo.startsWith("FS"),
      bornA?.dispatchNo,
    );
    check(
      "a3: yeni sevkin notes'u orijinal notu taşır + K16 bölünme izi APPEND",
      (bornA?.notes ?? "").includes("K16 orijinal not") && (bornA?.notes ?? "").includes(`K16: ${dANo} sevkinden bölündü`),
    );
    const srcDispA = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispA },
      select: { totalQty: true, notes: true, cancelledAt: true, items: { select: { rollId: true } } },
    });
    check(
      "a4: kalemler 2/1 bölündü + iki sevkin totalQty'si kalemlerden (200/100)",
      bornA?.items.length === 2 && [ra1.id, ra2.id].every((id) => bornA.items.some((i) => i.rollId === id)) &&
        srcDispA?.items.length === 1 && srcDispA.items[0].rollId === ra3.id &&
        Number(bornA?.totalQty) === 200 && Number(srcDispA?.totalQty) === 100,
    );
    check(
      "a5: kaynak sevk AÇIK kaldı + K16 bölünme notu APPEND edildi",
      srcDispA?.cancelledAt === null && (srcDispA?.notes ?? "").includes("K16:") && (srcDispA?.notes ?? "").includes("sevkine bölündü"),
    );
    check("a6: iki parti de kilitli (K14 — mal fasonda)", (await locked(bA.id)) === true && (await locked(splitA.newBatchId)) === true);
    check(
      "a7: her iki (parti,adım) çiftinde TEK açık+outstanding sevk",
      (await openOutstandingCount(bA.id, stepA1)) === 1 && (await openOutstandingCount(splitA.newBatchId, stepA1)) === 1,
    );
    check(
      "a8 (K18): taşınan toplar labelDirty=true, kaynakta kalan top false",
      memA.find((r) => r.id === ra1.id)?.labelDirty === true &&
        memA.find((r) => r.id === ra2.id)?.labelDirty === true &&
        memA.find((r) => r.id === ra3.id)?.labelDirty === false,
    );

    // ═══ Senaryo g: fasondayken de "TÜM toplar seçilemez" (tek kalan topu ayırma) ═══
    await expectErr(
      "g1: partinin TÜM (kalan tek) topu split edilemez",
      ["TÜM topları seçilemez"],
      () => splitBatch({ batchId: bA.id, rollIds: [ra3.id], userId: admin!.id }),
    );

    // ═══ Senaryo b: ayırma sonrası her iki parti için receive AYRI AYRI ═══
    const recvB1 = await sub.receive(
      { workOrderId: woA.id, stepId: stepA1, subcontractorId: firm1.id, returns: [{ rollId: ra1.id }, { rollId: ra2.id }], newRolls: [{ qty: 200 }] },
      admin.id,
    );
    const bornB1 = await prisma.roll.findFirst({
      where: { parentReceiptId: (recvB1.data as { id?: string }).id! }, select: { batchId: true },
    });
    check("b1: yeni partinin kabulü BAŞARILI + born top YENİ partiye doğdu", recvB1.success === true && bornB1?.batchId === splitA.newBatchId);
    const recvB2 = await sub.receive(
      { workOrderId: woA.id, stepId: stepA1, subcontractorId: firm1.id, returns: [{ rollId: ra3.id }], newRolls: [{ qty: 100 }] },
      admin.id,
    );
    const bornB2 = await prisma.roll.findFirst({
      where: { parentReceiptId: (recvB2.data as { id?: string }).id! }, select: { batchId: true },
    });
    check("b2: kaynak partinin kabulü BAŞARILI + born top KAYNAK partiye doğdu", recvB2.success === true && bornB2?.batchId === bA.id);
    check("b3: tam dönüş sonrası iki parti de kilitsiz (K14 kendiliğinden açılma)", (await locked(bA.id)) === false && (await locked(splitA.newBatchId)) === false);

    // ═══ Senaryo c: moveRolls TAM-RETARGET — sevk olduğu gibi hedefe, kaynak boş+izli ═══
    const stepC1 = woC.steps[0]!.id;
    const rc1 = await mkRoll(stepC1); const rc2 = await mkRoll(stepC1);
    const rc3 = await mkRoll(woC.steps[1]!.id); // hedef partinin (sevksiz) kendi topu
    const bc1 = await mkBatch(woC.id, [rc1.id, rc2.id]);
    const bc2 = await mkBatch(woC.id, [rc3.id]);
    const dispC = ((await sub.dispatch(
      { workOrderId: woC.id, stepId: stepC1, subcontractorId: firm1.id, rollIds: [rc1.id, rc2.id] },
      admin.id,
    )).data as { id: string }).id;
    const dCNo = (await prisma.subcontractorDispatch.findUnique({ where: { id: dispC }, select: { dispatchNo: true } }))!.dispatchNo;

    const moveC = await moveRolls({ rollIds: [rc1.id, rc2.id], toBatchId: bc2.id, userId: admin.id });
    const dispCAfter = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispC }, select: { batchId: true, dispatchNo: true, cancelledAt: true, items: { select: { rollId: true } } },
    });
    check(
      "c1: sevk kaydı OLDUĞU GİBİ hedefe retarget (aynı id/no, yeni belge YOK)",
      dispCAfter?.batchId === bc2.id && dispCAfter.dispatchNo === dCNo && dispCAfter.cancelledAt === null &&
        dispCAfter.items.length === 2 &&
        (await prisma.subcontractorDispatch.count({ where: { workOrderId: woC.id } })) === 1,
    );
    const rcAfter = await prisma.roll.findMany({
      where: { id: { in: [rc1.id, rc2.id, rc3.id] } }, select: { id: true, batchId: true, status: true, labelDirty: true },
    });
    check(
      "c2: toplar hedef partide + AT_SUBCONTRACTOR kaldı",
      rcAfter.filter((r) => r.batchId === bc2.id).length === 3 &&
        [rc1.id, rc2.id].every((id) => rcAfter.find((r) => r.id === id)?.status === RollStatus.AT_SUBCONTRACTOR),
    );
    const bc1After = await prisma.batch.findUnique({ where: { id: bc1.id }, select: { mergedIntoId: true } });
    check(
      "c3: kaynak parti BOŞ + İZLİ kaldı (silinmedi, mergedIntoId=hedef)",
      !!bc1After && bc1After.mergedIntoId === bc2.id &&
        (await prisma.roll.count({ where: { batchId: bc1.id } })) === 0 &&
        moveC.mergedSourceBatchIds.includes(bc1.id) && moveC.deletedBatchIds.length === 0,
    );
    const docsC = await prisma.printedDocument.findMany({
      where: { docType: PrintedDocType.SUBCONTRACTOR_DISPATCH, sourceId: dispC }, select: { status: true },
    });
    check("c4: retarget'te irsaliye VOID edilmedi (ACTIVE — belge gerçeği hâlâ yansıtıyor)", docsC.length > 0 && docsC.every((d) => d.status === PrintedDocStatus.ACTIVE));
    check(
      "c5 (K18): taşınan toplar labelDirty=true, hedefin kendi topu false",
      rcAfter.find((r) => r.id === rc1.id)?.labelDirty === true &&
        rcAfter.find((r) => r.id === rc2.id)?.labelDirty === true &&
        rcAfter.find((r) => r.id === rc3.id)?.labelDirty === false,
    );
    const recvC = await sub.receive(
      { workOrderId: woC.id, stepId: stepC1, subcontractorId: firm1.id, returns: [{ rollId: rc1.id }, { rollId: rc2.id }], newRolls: [{ qty: 200 }] },
      admin.id,
    );
    const bornC = await prisma.roll.findFirst({
      where: { parentReceiptId: (recvC.data as { id?: string }).id! }, select: { batchId: true },
    });
    check("c6: retarget sonrası kabul BAŞARILI + born top hedef partiye doğdu", recvC.success === true && bornC?.batchId === bc2.id);

    // ═══ Senaryo d: hedefin aynı adımda FARKLI firmaya açık sevki → 409 + mutasyonsuz ═══
    const stepD1 = woD.steps[0]!.id;
    const rd1 = await mkRoll(stepD1); const rd2 = await mkRoll(stepD1);
    const bd1 = await mkBatch(woD.id, [rd1.id]); const bd2 = await mkBatch(woD.id, [rd2.id]);
    await sub.dispatch({ workOrderId: woD.id, stepId: stepD1, subcontractorId: firm1.id, rollIds: [rd1.id] }, admin.id);
    await sub.dispatch({ workOrderId: woD.id, stepId: stepD1, subcontractorId: firm2.id, rollIds: [rd2.id] }, admin.id);
    await expectErr(
      "d1: farklı firmaya açık sevkli hedefe moveRolls 409 — mesajda İKİ firma + adım (K15 kalıbı)",
      [firm1.name, firm2.name, st1.name, "farklı firmalara açık sevkler"],
      () => moveRolls({ rollIds: [rd1.id], toBatchId: bd2.id, userId: admin!.id }),
    );
    const dRolls = await prisma.roll.findMany({
      where: { id: { in: [rd1.id, rd2.id] } }, select: { id: true, batchId: true, labelDirty: true },
    });
    const dDisps = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: woD.id }, select: { batchId: true, cancelledAt: true },
    });
    check(
      "d2: mutasyonsuzluk — üyelik/sevk/labelDirty değişmedi, yeni sevk doğmadı",
      dRolls.find((r) => r.id === rd1.id)?.batchId === bd1.id &&
        dRolls.every((r) => r.labelDirty === false) &&
        dDisps.length === 2 && dDisps.every((d) => d.cancelledAt === null) &&
        dDisps.some((d) => d.batchId === bd1.id) && dDisps.some((d) => d.batchId === bd2.id) &&
        (await prisma.batch.findUnique({ where: { id: bd1.id }, select: { mergedIntoId: true } }))?.mergedIntoId === null,
    );

    // ═══ Senaryo e: hedefin AYNI firmaya açık sevki → kalemler hedef sevkte birleşir ═══
    const stepE1 = woE.steps[0]!.id;
    const re1 = await mkRoll(stepE1); const re2 = await mkRoll(stepE1);
    const be1 = await mkBatch(woE.id, [re1.id]); const be2 = await mkBatch(woE.id, [re2.id]);
    const dE1 = ((await sub.dispatch(
      { workOrderId: woE.id, stepId: stepE1, subcontractorId: firm1.id, rollIds: [re1.id] },
      admin.id,
    )).data as { id: string }).id;
    const dE2 = ((await sub.dispatch(
      { workOrderId: woE.id, stepId: stepE1, subcontractorId: firm1.id, rollIds: [re2.id] },
      admin.id,
    )).data as { id: string }).id;
    const dE1No = (await prisma.subcontractorDispatch.findUnique({ where: { id: dE1 }, select: { dispatchNo: true } }))!.dispatchNo;

    await moveRolls({ rollIds: [re1.id], toBatchId: be2.id, userId: admin.id });
    const dE1After = await prisma.subcontractorDispatch.findUnique({
      where: { id: dE1 }, select: { cancelledAt: true, cancelReason: true, totalQty: true, items: { select: { id: true } } },
    });
    const dE2After = await prisma.subcontractorDispatch.findUnique({
      where: { id: dE2 }, select: { dispatchNo: true, cancelledAt: true, totalQty: true, notes: true, items: { select: { rollId: true } } },
    });
    check(
      "e1: kalemler hedef sevkte birleşti (2 kalem) + totalQty=200 + K16 belge notu",
      dE2After?.cancelledAt === null && dE2After.items.length === 2 &&
        [re1.id, re2.id].every((id) => dE2After.items.some((i) => i.rollId === id)) &&
        Number(dE2After.totalQty) === 200 &&
        (dE2After.notes ?? "").includes("K16:") && (dE2After.notes ?? "").includes(dE1No),
    );
    check(
      "e2: boşalan kaynak sevk K16_MOVE sebebiyle kapandı (totalQty=0, K15_MERGE-benzeri)",
      !!dE1After?.cancelledAt && dE1After.items.length === 0 && Number(dE1After.totalQty) === 0 &&
        (dE1After.cancelReason ?? "").startsWith("K16_MOVE:") && (dE1After.cancelReason ?? "").includes(dE2After?.dispatchNo ?? "!"),
    );
    const docsE1 = await prisma.printedDocument.findMany({
      where: { docType: PrintedDocType.SUBCONTRACTOR_DISPATCH, sourceId: dE1 }, select: { status: true },
    });
    check(
      "e3: kapanan sevkin irsaliyesi VOID + (parti,adım)'da TEK açık sevk kaldı",
      docsE1.length > 0 && docsE1.every((d) => d.status === PrintedDocStatus.VOIDED) &&
        (await openOutstandingCount(be2.id, stepE1)) === 1 &&
        (await openOutstandingCount(be1.id, stepE1)) === 0,
    );
    const be1After = await prisma.batch.findUnique({ where: { id: be1.id }, select: { mergedIntoId: true } });
    check(
      "e4: boşalan kaynak parti tarihçe satırı (mergedIntoId=hedef) + K18 taşınan top bayraklı",
      be1After?.mergedIntoId === be2.id &&
        (await prisma.roll.findUnique({ where: { id: re1.id }, select: { labelDirty: true } }))?.labelDirty === true &&
        (await prisma.roll.findUnique({ where: { id: re2.id }, select: { labelDirty: true } }))?.labelDirty === false,
    );
    const recvE = await sub.receive(
      { workOrderId: woE.id, stepId: stepE1, subcontractorId: firm1.id, returns: [{ rollId: re1.id }, { rollId: re2.id }], newRolls: [{ qty: 200 }] },
      admin.id,
    );
    const bornE = await prisma.roll.findFirst({
      where: { parentReceiptId: (recvE.data as { id?: string }).id! }, select: { batchId: true },
    });
    check("e5: birleşik sevkin kabulü BAŞARILI + born top hedef partiye doğdu", recvE.success === true && bornE?.batchId === be2.id);

    // ═══ Senaryo f: K18 mergeBatches — CANLI taşınan bayraklı, CONSUMED değil ═══
    const stepF1 = woF.steps[0]!.id;
    const rf2 = await mkRoll(stepF1);
    const bf2 = await mkBatch(woF.id, [rf2.id]); // ÖNCE doğdu → merge survivor'ı
    const rf1 = await mkRoll(stepF1);
    const bf1 = await mkBatch(woF.id, [rf1.id]);
    await sub.dispatch({ workOrderId: woF.id, stepId: stepF1, subcontractorId: firm1.id, rollIds: [rf1.id] }, admin.id);
    const recvF = await sub.receive(
      { workOrderId: woF.id, stepId: stepF1, subcontractorId: firm1.id, returns: [{ rollId: rf1.id }], newRolls: [{ qty: 100 }] },
      admin.id,
    );
    const rfB = (await prisma.roll.findFirst({
      where: { parentReceiptId: (recvF.data as { id?: string }).id! }, select: { id: true },
    }))!;
    allRollIds.push(rfB.id);
    // Deterministik başlangıç: bayrakları sıfırla.
    await prisma.roll.updateMany({ where: { id: { in: [rf1.id, rf2.id, rfB.id] } }, data: { labelDirty: false } });

    const mergeF = await mergeBatches({ batchIds: [bf1.id, bf2.id], userId: admin.id });
    const fRolls = await prisma.roll.findMany({
      where: { id: { in: [rf1.id, rf2.id, rfB.id] } }, select: { id: true, batchId: true, status: true, labelDirty: true },
    });
    check("f1: survivor en eski parti (hedef) + taşınan toplar survivor'da", mergeF.survivorId === bf2.id && fRolls.every((r) => r.batchId === bf2.id));
    check(
      "f2 (K18): taşınan CANLI top bayraklı; CONSUMED taşınan + survivor'ın kendi topu bayraksız",
      fRolls.find((r) => r.id === rfB.id)?.labelDirty === true &&
        fRolls.find((r) => r.id === rf1.id)?.status === RollStatus.SUBCONTRACTOR_CONSUMED &&
        fRolls.find((r) => r.id === rf1.id)?.labelDirty === false &&
        fRolls.find((r) => r.id === rf2.id)?.labelDirty === false,
    );
    // Savunma: tüketilmiş tarihçe topu bölmede taşınamaz.
    await expectErr(
      "f3: CONSUMED tarihçe topu splitBatch'te reddedilir (savunma)",
      ["Tüketilmiş", "taşınamaz"],
      () => splitBatch({ batchId: bf2.id, rollIds: [rf1.id], userId: admin!.id }),
    );
  } finally {
    // Cleanup — bağımlılık sırasıyla, hepsi WO-scope'lu (k15 deseni).
    const dispIdsAll = (
      await prisma.subcontractorDispatch
        .findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })
        .catch(() => [] as { id: string }[])
    ).map((d) => d.id);
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispIdsAll } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { workOrderStep: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: allRollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { workOrderStep: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receipt: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receipt: { workOrderId: { in: woIds } } } }).catch(() => {});
    // Born toplar receipt'lere FK ile bağlı — receipt'lerden ÖNCE silinmeli.
    await prisma.roll.deleteMany({ where: { parentReceipt: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatch: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: allRollIds } } }).catch(() => {});
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    await prisma.subcontractor.deleteMany({ where: { id: { in: [firm1.id, firm2.id] } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: [st1.id, stInt.id] } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
