// TEST (Faz 4.2 / K8 + K14 + K15 + K16): parti düzeltme araçları — moveRolls / splitBatch / mergeBatches.
//   K14 kilidi türetilmiş kalır (lane locked rozeti) ama araçları DURDURMAZ:
//   K15: mergeBatches kilitli partide SERBEST — sevk belgesi survivor'a taşınır
//   (kapsamlı: test_batch_k15_merge.ts). K16: moveRolls/splitBatch de kilitli
//   partide SERBEST — sevk kalemi cerrahiyle taşınır (kapsamlı:
//   test_batch_k16_split_move.ts). Birleşmede EN ESKİ no yaşar;
//   K17: kaynak parti SİLİNMEZ, mergedIntoId=survivor tarihçe satırı kalır.
// Çalıştır: npx tsx scripts/test_batch_k8_tools.ts
import prisma from "../src/lib/prisma";
import { ensureTestSander } from "./fixture-subcontractor";
import { WorkOrderService } from "../src/services/workorder.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { moveRolls, mergeBatches, splitBatch, deleteIfEmptyAndTraceless } from "../src/services/batch.service";
import { RollStatus } from "@prisma/client";

const WIDTH = 250;
const wos = new WorkOrderService();
const sub = new SubcontractorService();
let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void { if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); } else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); } }
async function expectReject(l: string, fn: () => Promise<unknown>, needle: string): Promise<void> {
  let m: string | null = null;
  try { await fn(); } catch (e) { m = e instanceof Error ? e.message : String(e); }
  check(l, m !== null && m.includes(needle), m ?? "hata atılmadı");
}
let bcN = 0;
function bc(): string { bcN++; return `TST-K8-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bcN}`; }
let woId = "";

async function attachWave(item: string, grade: string, admin: string, n: number): Promise<{ batchId: string; rollIds: string[] }> {
  const bcs = Array.from({ length: n }, () => bc());
  for (const b of bcs) await prisma.roll.create({ data: { barcode: b, itemId: item, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: grade, width: WIDTH, createdById: admin } });
  const res = await wos.attachRolls(woId, bcs, admin);
  const rolls = await prisma.roll.findMany({ where: { barcode: { in: bcs } }, select: { id: true } });
  return { batchId: res.data!.batch!.id, rollIds: rolls.map((r) => r.id) };
}

async function main(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`Seed eksik: ${l}`); return v.id; };
  const ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE");
  const ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "ZIMPARA_FASON");
  const SUB = (await ensureTestSander()).id;

  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TST-K8-${stamp}`, type: "STOCK_PRODUCTION", status: "PLANNED", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_ZIMPARA, stepSequence: 1, status: "PENDING", plannedSubcontractorId: SUB }] } },
    include: { steps: true } });
  woId = wo.id;
  const zimpara = wo.steps[0].id;

  const p1 = await attachWave(ITEM, GRADE, ADMIN, 4); // P1: 4 top
  const p2 = await attachWave(ITEM, GRADE, ADMIN, 3); // P2: 3 top
  check("iki dalga iki ayrı parti", p1.batchId !== p2.batchId);

  // ── moveRolls: P2'den 1 top → P1 ──
  await moveRolls({ rollIds: [p2.rollIds[0]], toBatchId: p1.batchId, userId: ADMIN });
  const moved = await prisma.roll.findUnique({ where: { id: p2.rollIds[0] }, select: { batchId: true } });
  check("moveRolls: top P1'e taşındı", moved?.batchId === p1.batchId);
  check("moveRolls: P1=5 top", (await prisma.roll.count({ where: { batchId: p1.batchId } })) === 5);
  check("moveRolls: P2=2 top", (await prisma.roll.count({ where: { batchId: p2.batchId } })) === 2);

  // ── splitBatch: P1'den 2 top → yeni P3 ──
  const split = await splitBatch({ batchId: p1.batchId, rollIds: [p1.rollIds[0], p1.rollIds[1]], userId: ADMIN });
  check("splitBatch: yeni parti P ile başlar", split.newBatchNumber.startsWith("P"), split.newBatchNumber);
  const p3row = await prisma.batch.findUnique({ where: { id: split.newBatchId }, select: { splitFromId: true } });
  check("splitBatch: P3 splitFrom=P1", p3row?.splitFromId === p1.batchId);
  check("splitBatch: P3=2 top", (await prisma.roll.count({ where: { batchId: split.newBatchId } })) === 2);
  check("splitBatch: yeni kart ÜRETİLMEZ (kart WO başına)", (await prisma.travelerCard.count({ where: { workOrderId: woId } })) === 0);
  check("splitBatch: P1=3 top kaldı", (await prisma.roll.count({ where: { batchId: p1.batchId } })) === 3);

  // ── mergeBatches: P1 + P3 → EN ESKİ (P1) yaşar; K17: kaynak SİLİNMEZ ──
  const merge = await mergeBatches({ batchIds: [split.newBatchId, p1.batchId], userId: ADMIN });
  check("mergeBatches: survivor=P1 (en eski no yaşar)", merge.survivorId === p1.batchId, `survivor=${merge.survivorNumber}`);
  check("mergeBatches: P1=5 top (P3 geri döndü)", (await prisma.roll.count({ where: { batchId: p1.batchId } })) === 5);
  const p3after = await prisma.batch.findUnique({ where: { id: split.newBatchId }, select: { mergedIntoId: true } });
  check("mergeBatches (K17): P3 silinMEZ — mergedIntoId=survivor tarihçe satırı", p3after?.mergedIntoId === p1.batchId);

  // ── K14 kilit: P2'yi sevk et → mal FASONDA (AT_SUBCONTRACTOR) → moveRolls/splitBatch 409 ──
  await sub.bulkDispatchStep({ workOrderId: woId, stepId: zimpara, rollIds: p2.rollIds.slice(1) }, ADMIN);
  type Lane = { batchId: string; locked: boolean; mergedInto: { id: string; batchNumber: string } | null };
  const laneOf = async (batchId: string): Promise<Lane | undefined> => {
    const res = await wos.getBranches(woId);
    return (res.data as { batches: Lane[] }).batches.find((l) => l.batchId === batchId);
  };
  check("lane: fasonda mallı parti locked=true", (await laneOf(p2.batchId))?.locked === true);

  // ── K16: kilitli partide moveRolls/splitBatch ARTIK SERBEST (kapsamlı senaryolar:
  //    test_batch_k16_split_move.ts). Akışın devamı bozulmasın diye roundtrip yapılır. ──
  // Sevksiz top kilitli HEDEFE taşınabilir (sevk cerrahisi gerektirmez) + geri alınır.
  await moveRolls({ rollIds: [p1.rollIds[2]], toBatchId: p2.batchId, userId: ADMIN });
  check("K16: kilitli hedefe moveRolls SERBEST", (await prisma.roll.findUnique({ where: { id: p1.rollIds[2] }, select: { batchId: true } }))?.batchId === p2.batchId);
  await moveRolls({ rollIds: [p1.rollIds[2]], toBatchId: p1.batchId, userId: ADMIN });
  check("K16: kilitli kaynaktan sevksiz top geri taşındı", (await prisma.roll.findUnique({ where: { id: p1.rollIds[2] }, select: { batchId: true } }))?.batchId === p1.batchId);
  // Kilitli partiden AT_SUB top bölünür → sevk kalemi de bölünür (K16 yeni sevk).
  const splitLocked = await splitBatch({ batchId: p2.batchId, rollIds: [p2.rollIds[1]], userId: ADMIN });
  const bornDisp = await prisma.subcontractorDispatch.findFirst({
    where: { batchId: splitLocked.newBatchId, cancelledAt: null },
    select: { notes: true, items: { select: { rollId: true } } },
  });
  check("K16: kilitli parti splitBatch SERBEST — kalem yeni partinin K16 sevkine bölündü",
    (await prisma.roll.findUnique({ where: { id: p2.rollIds[1] }, select: { batchId: true } }))?.batchId === splitLocked.newBatchId
    && bornDisp?.items.length === 1 && bornDisp.items[0].rollId === p2.rollIds[1] && (bornDisp.notes ?? "").includes("K16:"));
  // Geri birleştir (K15 konsolidasyonu kalemleri orijinal sevke geri toplar).
  await mergeBatches({ batchIds: [p2.batchId, splitLocked.newBatchId], userId: ADMIN });
  check("K16→K15 roundtrip: kalemler orijinal sevke geri toplandı, tek açık sevk",
    (await prisma.subcontractorDispatch.count({ where: { workOrderId: woId, batchId: p2.batchId, cancelledAt: null } })) === 1
    && (await prisma.subcontractorDispatchItem.count({ where: { dispatch: { workOrderId: woId, batchId: p2.batchId, cancelledAt: null } } })) === 2);

  // ── K15: fasonda mallı parti mergeBatches ARTIK SERBEST — sevk belgesi de
  //    survivor'a taşınır (belge cerrahisi detayları: test_batch_k15_merge.ts) ──
  const mergeLocked = await mergeBatches({ batchIds: [p2.batchId, p1.batchId], userId: ADMIN });
  check("K15: fasonda mallı parti mergeBatches SERBEST — survivor P1 (en eski)", mergeLocked.survivorId === p1.batchId, mergeLocked.survivorNumber);
  const p2after = await prisma.batch.findUnique({ where: { id: p2.batchId }, select: { mergedIntoId: true } });
  check("K15/K17: P2 tarihçe satırı (mergedIntoId=P1) + sevki P1'e retarget", p2after?.mergedIntoId === p1.batchId
    && (await prisma.subcontractorDispatch.count({ where: { workOrderId: woId, batchId: p1.batchId, cancelledAt: null } })) === 1);
  check("lane: birleşmiş kaynak parti mergedInto dolu", (await laneOf(p2.batchId))?.mergedInto?.id === p1.batchId);

  // ── K14: TAM DÖNÜŞ — fason kabul (tüm toplar döner) → kilit KENDİLİĞİNDEN açılır,
  //    sevk kayıtları tarihçe olarak partide kalır (merge sonrası parti = P1) ──
  await sub.receive(
    { workOrderId: woId, stepId: zimpara, subcontractorId: SUB, returns: p2.rollIds.slice(1).map((rollId) => ({ rollId })), newRolls: [{ qty: 90 }, { qty: 95 }] },
    ADMIN,
  );
  const p1Live = await prisma.roll.findMany({
    where: { batchId: p1.batchId, status: { notIn: [RollStatus.SUBCONTRACTOR_CONSUMED, RollStatus.CANCELLED] }, parentReceiptId: { not: null } },
    select: { id: true, status: true },
  });
  check("kabul (merge sonrası): AT_SUBCONTRACTOR kalmadı + 2 born top SURVIVOR P1'de doğdu",
    p1Live.length === 2 && p1Live.every((r) => r.status !== RollStatus.AT_SUBCONTRACTOR)
    && (await prisma.roll.count({ where: { batchId: p1.batchId, status: RollStatus.AT_SUBCONTRACTOR } })) === 0,
    p1Live.map((r) => r.status).join(","));
  check("lane: dönmüş parti locked=false (sevk tarihçesi dursa da)", (await laneOf(p1.batchId))?.locked === false);

  // Dönmüş parti araçlara AÇIK:
  const born = p1Live.map((r) => r.id);
  const split2 = await splitBatch({ batchId: p1.batchId, rollIds: [born[0]], userId: ADMIN });
  check("K14: dönmüş partiden splitBatch SERBEST", split2.newBatchNumber.startsWith("P"), split2.newBatchNumber);
  await moveRolls({ rollIds: [born[0]], toBatchId: p1.batchId, userId: ADMIN });
  check("K14: dönmüş partiye moveRolls SERBEST (top geri döndü)", (await prisma.roll.findUnique({ where: { id: born[0] }, select: { batchId: true } }))?.batchId === p1.batchId);
  check("boşalan izsiz ara parti silindi", (await prisma.batch.findUnique({ where: { id: split2.newBatchId }, select: { id: true } })) === null);
  await expectReject("birleşmiş (mergedIntoId) parti yeniden merge'e giremez → 400", () => mergeBatches({ batchIds: [p2.batchId, p1.batchId], userId: ADMIN }), "birleştirilmiş");
  check("merge sonrası: sevk-izli P2 kaydı YAŞIYOR (tarihçe — silinmez)", (await prisma.batch.findUnique({ where: { id: p2.batchId }, select: { id: true } })) !== null);
  check("merge sonrası: born toplar P1'de", (await prisma.roll.count({ where: { id: { in: born }, batchId: p1.batchId } })) === 2);

  // ── K17 hazırlık: mergedIntoId kolonu smoke (yaz/oku + relation çift yön) ──
  await prisma.batch.update({ where: { id: p2.batchId }, data: { mergedIntoId: p1.batchId } });
  const p2row2 = await prisma.batch.findUnique({
    where: { id: p2.batchId },
    select: { mergedIntoId: true, mergedInto: { select: { batchNumber: true } } },
  });
  check("K17 smoke: mergedIntoId yazıldı/okundu", p2row2?.mergedIntoId === p1.batchId, `mergedInto=${p2row2?.mergedInto?.batchNumber}`);
  const p1row = await prisma.batch.findUnique({ where: { id: p1.batchId }, select: { mergedChildren: { select: { id: true } } } });
  check("K17 smoke: survivor mergedChildren'ı görür", p1row?.mergedChildren.some((c) => c.id === p2.batchId) === true);

  // ── K17 hazırlık: merge izi taşıyan BOŞ parti silinmez (deleteIfEmptyAndTraceless) ──
  const stamp2 = `${Date.now()}`.slice(-6);
  const tgt = await prisma.batch.create({ data: { batchNumber: `TSTK17A${stamp2}`, workOrderId: woId } });
  const src = await prisma.batch.create({ data: { batchNumber: `TSTK17B${stamp2}`, workOrderId: woId, mergedIntoId: tgt.id } });
  check("K17: mergedIntoId izli boş parti silinMEZ", (await prisma.$transaction((tx) => deleteIfEmptyAndTraceless(tx, src.id))) === false);
  check("K17: içine birleşme almış boş parti silinMEZ", (await prisma.$transaction((tx) => deleteIfEmptyAndTraceless(tx, tgt.id))) === false);
  await prisma.batch.update({ where: { id: src.id }, data: { mergedIntoId: null } });
  check("K17: iz kalkınca boş parti silinir", (await prisma.$transaction((tx) => deleteIfEmptyAndTraceless(tx, src.id))) === true);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (!woId) return;
  try {
    const batches = await prisma.batch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const batchIds = batches.map((b) => b.id);
    const rolls = await prisma.roll.findMany({ where: { OR: [{ batchId: { in: batchIds } }, { parentReceipt: { workOrderId: woId } }, { barcode: { startsWith: "TST-K8-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: woId }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...receiptIds] } } });
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (2026-08-21'den beri
    // fason kabulünde giden↔dönen metraj farkı da deftere yazılıyor). Silinmezse
    // temizlik 23001 ile yarıda kalır ve arkasında hayalet kayıt bırakır.
    await prisma.rollVariance.deleteMany({ where: { roll: { id: { in: rollIds } } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: woId } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...dispatchIds, ...receiptIds, woId, ...batchIds] } } });
    await prisma.workOrder.delete({ where: { id: woId } });
    console.log("(temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
