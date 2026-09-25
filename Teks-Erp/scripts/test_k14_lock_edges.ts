// =============================================================================
// Test: K14 kilit kenar durumları — zombi açık sevk + kabul-iptali parti guard'ı
// Çalıştır: npx tsx scripts/test_k14_lock_edges.ts
// Adversarial inceleme bulguları (2026-07-15, PARTI-AYIR-BIRLESTIR-V2 Faz 1):
//  F1) AT_SUB top detach edilirse partide AT_SUB top kalmaz ama açık sevk
//      OUTSTANDING kalır ("zombi") — yalnız-roll-türevli kilit yanlış açılıyordu.
//      Yeni kural çift koşullu: AT_SUB top VEYA outstanding açık sevk → kilit.
//  F2) K14 dönmüş partiyi K8 araçlarına açtı; merge/move sonrası cancelReceipt
//      canlanan AT_SUB topların batchId'sini sevkin batchId'sinden ayırırdı —
//      artık 409 (parti-tutarlılık guard'ı).
// =============================================================================
import prisma from "../src/lib/prisma";
import { RollStatus, StationKind, StationType, WorkOrderStatus } from "@prisma/client";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { isBatchLockedTx, createBatchTx } from "../src/services/batch.service";
import { withBarcodeRetry } from "../src/utils/barcode-retry";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m.slice(0, 160)); }
}

const sub = new SubcontractorService();

async function main() {
  const ts = Date.now();
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!admin || !item) throw new Error("Fixture: admin/item yok (seed gerekli)");

  const station = await prisma.station.create({
    data: { code: `TST-K14-ST-${ts}`, name: "TEST K14 Fason", type: StationType.EXTERNAL, kind: StationKind.SUBCONTRACTOR },
    select: { id: true },
  });
  // 2. iç adım ŞART: tek adımlı rotada tam dönüş WO'yu COMPLETED yapar ("her rota
  // final üretir") ve cancelReceipt "tamamlanmış WO" guard'ına takılır — F2
  // senaryosu parti-tutarlılık guard'ına hiç ulaşamazdı.
  const station2 = await prisma.station.create({
    data: { code: `TST-K14-ST2-${ts}`, name: "TEST K14 İç", type: StationType.INTERNAL, kind: StationKind.OTHER },
    select: { id: true },
  });
  const firm = await prisma.subcontractor.create({
    data: { code: `TST-K14-F-${ts}`, name: `TEST K14 Firma ${ts}` },
    select: { id: true },
  });
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-K14-WO-${ts}`,
      type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, width: 150, targetItemId: item.id,
      steps: {
        create: [
          { stationId: station.id, stepSequence: 1, status: "ACTIVE" as const, plannedSubcontractorId: firm.id },
          { stationId: station2.id, stepSequence: 2, status: "PENDING" as const },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  const stepId = wo.steps[0]!.id;

  const mkRoll = (n: number) =>
    prisma.roll.create({
      data: {
        barcode: `TST-K14-R${n}-${ts}`, itemId: item.id, status: RollStatus.IN_PRODUCTION,
        currentQty: 100, initialQty: 100, width: 150, currentStepId: stepId, entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });

  const cleanupRollIds: string[] = [];
  const cleanupBatchIds: string[] = [];
  try {
    // ── F1: zombi açık sevk ──
    const r1 = await mkRoll(1); const r2 = await mkRoll(2);
    cleanupRollIds.push(r1.id, r2.id);
    for (const r of [r1, r2]) {
      await prisma.rollMovement.create({ data: { rollId: r.id, workOrderStepId: stepId, qtyIn: 100, operatorId: admin.id } });
    }
    // `withBarcodeRetry` ŞART (gerekçe: test_batch_k15_merge.ts) — `generateBatchNumberTx`
    // kilitsiz max+1 okur, paralel bir yazar aynı P kodunu üretirse P2002 düşer.
    const { batch } = await withBarcodeRetry(() =>
      prisma.$transaction((tx) => createBatchTx(tx, { workOrderId: wo.id, rollIds: [r1.id, r2.id] })),
    );
    cleanupBatchIds.push(batch.id);
    await sub.dispatch({ workOrderId: wo.id, stepId, subcontractorId: firm.id, rollIds: [r1.id, r2.id] }, admin.id);

    let locked = await prisma.$transaction((tx) => isBatchLockedTx(tx, batch.id));
    check("F1a: fasonda mal varken kilitli", locked === true);

    // Detach'i simüle et: AT_SUB toplar partiden koparılıp stok/steplesse düşer
    // (eski toplu söküm bunu yapabiliyordu; guard o dönemden kalan veriye karşı durur).
    await prisma.roll.updateMany({
      where: { id: { in: [r1.id, r2.id] } },
      data: { batchId: null, status: RollStatus.STOCK, currentStepId: null },
    });
    locked = await prisma.$transaction((tx) => isBatchLockedTx(tx, batch.id));
    check("F1b: AT_SUB top kalmasa da OUTSTANDING açık sevk kilidi sürdürür (zombi)", locked === true);

    // Sevk iptal edilince kilit söner.
    const disp = await prisma.subcontractorDispatch.findFirst({
      where: { batchId: batch.id, cancelledAt: null }, select: { id: true },
    });
    // İptal öncesi topları sevk-iptalinin beklediği duruma geri koy (AT_SUB + step).
    await prisma.roll.updateMany({
      where: { id: { in: [r1.id, r2.id] } },
      data: { batchId: batch.id, status: RollStatus.AT_SUBCONTRACTOR, currentStepId: stepId },
    });
    await sub.cancel(disp!.id, "K14 test iptali", admin.id);
    locked = await prisma.$transaction((tx) => isBatchLockedTx(tx, batch.id));
    check("F1c: sevk iptalinde kilit kendiliğinden açılır", locked === false);

    // ── F2: kabul-iptali parti-tutarlılık guard'ı ──
    const r3 = await mkRoll(3);
    cleanupRollIds.push(r3.id);
    await prisma.rollMovement.create({ data: { rollId: r3.id, workOrderStepId: stepId, qtyIn: 100, operatorId: admin.id } });
    const { batch: batch2 } = await withBarcodeRetry(() =>
      prisma.$transaction((tx) => createBatchTx(tx, { workOrderId: wo.id, rollIds: [r3.id] })),
    );
    cleanupBatchIds.push(batch2.id);
    await sub.dispatch({ workOrderId: wo.id, stepId, subcontractorId: firm.id, rollIds: [r3.id] }, admin.id);
    const recv = await sub.receive(
      { workOrderId: wo.id, stepId, subcontractorId: firm.id, returns: [{ rollId: r3.id }], newRolls: [{ qty: 100 }] },
      admin.id,
    );
    const receiptId = (recv.data as { id?: string }).id!;
    locked = await prisma.$transaction((tx) => isBatchLockedTx(tx, batch2.id));
    check("F2a: tam dönüş sonrası parti kilitsiz (K14 amacı)", locked === false);

    // Merge/move'u simüle et: tüketilmiş orijinal topun üyeliği başka partiye taşınır.
    const born = await prisma.roll.findFirst({ where: { parentReceiptId: receiptId }, select: { id: true } });
    if (born) cleanupRollIds.push(born.id);
    await prisma.roll.updateMany({ where: { id: r3.id }, data: { batchId: batch.id } });
    await expectErr(
      "F2b: üyelik değişmişken kabul iptali 409 (parti/sevk tutarlılığı)",
      "parti üyeliği kabulden sonra değişmiş",
      () => sub.cancelReceipt(receiptId, "K14 test — tutarsız iptal", admin.id, born ? [born.id] : []),
    );

    // Üyelik geri gelince iptal serbest.
    await prisma.roll.updateMany({ where: { id: r3.id }, data: { batchId: batch2.id } });
    const cancelRes = await sub.cancelReceipt(receiptId, "K14 test — tutarlı iptal", admin.id, born ? [born.id] : []);
    check("F2c: üyelik geri dönünce kabul iptali başarılı", cancelRes.success === true);
    locked = await prisma.$transaction((tx) => isBatchLockedTx(tx, batch2.id));
    check("F2d: iptal sonrası (mal yeniden fasonda) parti yine kilitli", locked === true);
  } finally {
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: cleanupRollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: cleanupRollIds } } }).catch(() => {});
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receipt: { workOrderId: wo.id } } }).catch(() => {});
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receipt: { workOrderId: wo.id } } }).catch(() => {});
    await prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: wo.id } }).catch(() => {});
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatch: { workOrderId: wo.id } } }).catch(() => {});
    await prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: wo.id } }).catch(() => {});
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (2026-08-21'den beri
    // fason kabulünde giden↔dönen metraj farkı da deftere yazılıyor). Silinmezse
    // temizlik 23001 ile yarıda kalır ve arkasında hayalet kayıt bırakır.
    await prisma.rollVariance.deleteMany({ where: { roll: { parentReceiptId: { not: null }, batchId: { in: cleanupBatchIds } } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { parentReceiptId: { not: null }, batchId: { in: cleanupBatchIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { roll: { id: { in: cleanupRollIds } } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: cleanupRollIds } } }).catch(() => {});
    await prisma.batch.deleteMany({ where: { id: { in: cleanupBatchIds } } }).catch(() => {});
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: wo.id } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: wo.id } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: wo.id } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: wo.id } }).catch(() => {});
    await prisma.subcontractor.deleteMany({ where: { id: firm.id } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: [station.id, station2.id] } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
