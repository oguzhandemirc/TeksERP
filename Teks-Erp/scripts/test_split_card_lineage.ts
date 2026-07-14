// TEST: Parti ayırma SOY BAĞI + ESKİ REFAKAT KARTI YÖNLENDİRMESİ (redye NEW_COLOR).
//
// Senaryo: Ayrılan parti fiziksel olarak ESKİ WO'nun refakat kartını taşır.
// Eski kart kabulde okutulunca (pendingReturns by workOrderId) operatör çıkmaza
// girmemeli: splitFromId soy bağı üzerinden ayrılan partinin YENİ WO'daki bekleyen
// grubu da listede görünmeli (isSplitChild=true). Ayrıca:
//   - getBranches: kaynak WO'da splitChildren izi, yeni WO'da splitFrom izi
//   - Yeni WO'nun kendi ACTIVE refakat kartı var (split tx'inde basıldı)
//   - Zincir: ayrılanın ayrılması (torun) da eski karttan bulunur (BFS)
//
// REDESIGN GERÇEĞİ (parti modeli): NEW_COLOR yalnız BOYANMIŞ/canlı topu ayırır
// (REDYE_ELIGIBLE = IN_PRODUCTION/STOCK/WAREHOUSE + boyahane adımında/sonrasında +
// çuval/sevk yok) — fasondaki (AT_SUBCONTRACTOR) boyanmamış top DEĞİL. Bu yüzden
// ayrılacak parti önce DYE-FIRST ile boyanır (dispatch→receive → born toplar
// IN_PRODUCTION, Tambur'da). NEW_COLOR ayrılan topları yeni WO'nun boyahane adımına
// GERİ SARAR (IN_PRODUCTION, colorId=null); pendingReturns'te görünmesi için o
// toplar tekrar FASONA SEVK edilir (AT_SUBCONTRACTOR). Zincirin bir sonraki halkası
// için ara WO'da yeniden kabul (dye) + NEW_COLOR yapılır — böylece eski karttan
// BFS ile torun (2. seviye ayrılan) bulunur. Renk (A/B/C) sadece araç; asıl test
// edilen KART/PARTİ SOY BAĞI.
//
// Çalıştır: npx tsx scripts/test_split_card_lineage.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, TravelerCardStatus } from "@prisma/client";

// Fixture'lar business key ile çözülür (hardcoded UUID seed reset'inde geçersizleşir
// — UUID migration sonrası kardeş testlerle aynı desen).
let ITEM = "";
let GRADE = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_TAMBUR = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "User admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "Station TAMBUR_1");
}

const sub = new SubcontractorService();
const wos = new WorkOrderService();
const cards = new TravelerCardService();

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-LIN-${rand}${bc}`;
}
async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN },
  });
  return r.id;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const woIds: string[] = [];

// Bir fason adımına dönen born (parentReceiptId'li açık kumaş) topları getir.
async function bornRollsOf(receiptId: string): Promise<Array<{ id: string; colorId: string | null; currentStepId: string | null; status: RollStatus; batchId: string | null }>> {
  return prisma.roll.findMany({
    where: { parentReceiptId: receiptId },
    select: { id: true, colorId: true, currentStepId: true, status: true, batchId: true },
    orderBy: { createdAt: "asc" },
  });
}

async function main(): Promise<void> {
  await resolveFixtures();
  const dye = await prisma.subcontractorCategory.findFirst({ where: { appliesColor: true }, select: { id: true } });
  const link = await prisma.subcontractorToCategory.findFirst({ where: { categoryId: dye!.id }, select: { subcontractorId: true } });
  const SUB = link!.subcontractorId;
  const kk1 = await prisma.station.findFirst({ where: { kind: "RAW_QC" }, select: { id: true } });
  const colors = await prisma.color.findMany({ where: { isActive: true }, take: 3, select: { id: true, name: true } });
  if (colors.length < 3) throw new Error("En az 3 aktif renk gerekli");
  const [colorA, colorB, colorC] = colors;
  console.log(`\nRenkler: A=${colorA.name} B=${colorB.name} C=${colorC.name}\n`);

  // ── Kaynak WO: KK1 → Boyahane(renk) → Tambur, hedef renk A ──
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-LIN-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 2000, targetItemId: ITEM, targetColorId: colorA.id,
      steps: { create: [
        { stationId: kk1!.id, stepSequence: 1, status: "PENDING" },
        { stationId: ST_BOYA, stepSequence: 2, status: "PENDING", requiredCategoryId: dye!.id },
        { stationId: ST_TAMBUR, stepSequence: 3, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  const srcBoya = wo.steps[1].id;
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const oldCard = await prisma.travelerCard.findFirst({
    where: { workOrderId: wo.id, status: TravelerCardStatus.ACTIVE },
    select: { id: true, barcode: true },
  });
  check("Kaynak WO'nun aktif kartı var (eski kart)", oldCard !== null);

  // ── Parti-1: kaynak WO'da AT_SUBCONTRACTOR kalır (eski kartın "kendi grubu") ──
  const p1 = [await stockRoll(300), await stockRoll(300)];
  await sub.dispatch({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB, rollIds: p1 }, ADMIN);

  // ── Parti-2: DYE-FIRST — boyahaneye sevk + kabul → born toplar BOYANIR (renk A),
  //    IN_PRODUCTION, Tambur'da. Ancak böyle NEW_COLOR ile ayrılabilir (redye-uygun). ──
  const p2 = [await stockRoll(200), await stockRoll(200)];
  const d2 = await sub.dispatch({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB, rollIds: p2 }, ADMIN);
  const batch2 = (d2.data as Any).batchId as string;   // sevkin partisi (Batch id) — NEW_COLOR bunu ayırır
  const rc0 = await sub.receive({
    workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB,
    returns: p2.map((rollId) => ({ rollId })), newRolls: [{ qty: 190 }, { qty: 190 }],
  }, ADMIN);
  const dyed = await bornRollsOf((rc0.data as Any).id);
  check("Parti-2 boyandı: 2 born top (renk A, IN_PRODUCTION, Tambur)",
    dyed.length === 2 && dyed.every((r) => r.colorId === colorA.id && r.status === RollStatus.IN_PRODUCTION),
    `${dyed.length} top, renk=${dyed[0]?.colorId?.slice(0, 8)}`);
  check("Boyanan born toplar batch2'yi kalıttı", dyed.every((r) => r.batchId === batch2));

  // ── Seviye-1: batch2'yi NEW_COLOR (renk B) ile YENİ WO'ya ayır ──
  const res = (await wos.splitBranch(wo.id, { batchId: batch2, mode: "NEW_COLOR", newColorId: colorB.id, orderMode: "stock" }, ADMIN)).data as Any;
  const childId = res.newWorkOrderId as string;
  const childBatch = res.newBatchId as string;
  woIds.push(childId);
  check("Seviye-1 NEW_COLOR: 2 top taşındı", res.movedRollCount === 2, `${res.movedRollCount}`);

  // Ayrılan toplar yeni WO'nun boyahane adımına GERİ SARILDI (IN_PRODUCTION, colorId=null).
  const afterL1 = await bornRollsOf((rc0.data as Any).id); // aynı roll id'ler taşındı (repoint, recreate DEĞİL)
  const childBoya = afterL1[0]?.currentStepId as string;
  check("Ayrılan toplar yeni WO boyahane adımında (IN_PRODUCTION, renk sıfırlandı)",
    afterL1.length === 2 && afterL1.every((r) => r.status === RollStatus.IN_PRODUCTION && r.colorId === null && r.currentStepId === childBoya),
    `step=${childBoya?.slice(0, 8)}`);
  const bornIds = afterL1.map((r) => r.id);

  // ── 1) Soy bağı kolonu ──
  const child = await prisma.workOrder.findUnique({ where: { id: childId }, select: { splitFromId: true, workOrderNumber: true, targetColorId: true } });
  check("Yeni WO.splitFromId = kaynak WO", child?.splitFromId === wo.id);
  check("Yeni WO.targetColorId = yeni renk B", child?.targetColorId === colorB.id);

  // ── 2) Yeni WO'nun KENDİ aktif kartı (split tx'inde basıldı) ──
  const newCard = await prisma.travelerCard.findFirst({
    where: { workOrderId: childId, status: TravelerCardStatus.ACTIVE },
    select: { id: true, barcode: true, snapshot: true },
  });
  check("Yeni WO'nun kendi ACTIVE kartı var", newCard !== null);
  check("Yeni kart barkodu eskisinden farklı", newCard?.barcode !== oldCard?.barcode);
  const snapStr = JSON.stringify(newCard?.snapshot ?? {});
  check("Yeni kart snapshot'ı YENİ rengi taşıyor", snapStr.includes(colorB.id) || snapStr.includes(colorB.name), colorB.name);

  // ── Ayrılan parti ESKİ kartı taşır: fiziksel olarak yeniden boyahaneye gönderilir
  //    (redye geri-sarımından sonra ilk sevk). Şimdi AT_SUBCONTRACTOR → pendingReturns'te görünür. ──
  const dB = await sub.dispatch({ workOrderId: childId, stepId: childBoya, subcontractorId: SUB, rollIds: bornIds }, ADMIN);
  const laneB = (dB.data as Any).id as string;

  // ── 3) ESKİ KART YÖNLENDİRMESİ: pendingReturns(eski WO) ayrılan partiyi de bulur ──
  console.log("\nESKİ KART OKUTMA — listPendingReturns(kaynak WO)");
  const groups = (await sub.listPendingReturns({ workOrderId: wo.id })).data as Any[];
  check("İki grup döndü (parti-1 eski WO + parti-2 yeni WO)", groups.length === 2, `grup=${groups.length}`);
  const ownGroup = groups.find((g) => g.workOrder.id === wo.id);
  const childGroup = groups.find((g) => g.workOrder.id === childId);
  check("Eski WO'nun kendi grubu var (parti-1)", ownGroup?.rollCount === 2, `${ownGroup?.rollCount}`);
  check("Ayrılan partinin grubu YENİ WO altında görünür", childGroup?.rollCount === 2, `${childGroup?.rollCount}`);
  check("Ayrılan grup isSplitChild=true işaretli", childGroup?.isSplitChild === true);
  check("Kendi grubu isSplitChild=false", ownGroup?.isSplitChild === false);
  check("Ayrılan grup yeni batchNumber taşır", childGroup?.workOrder.batchNumber === child?.workOrderNumber);

  // ── 4) Dallar paneli izleri ──
  const srcBranches = (await wos.getBranches(wo.id)).data as Any;
  check("Kaynak WO Dallar: splitChildren yeni WO'yu içerir",
    srcBranches.splitChildren?.some((c: Any) => c.id === childId) === true);
  check("Kaynak WO Dallar: çocuğun yeni rengi görünür",
    srcBranches.splitChildren?.find((c: Any) => c.id === childId)?.targetColor?.id === colorB.id);
  const childBranches = (await wos.getBranches(childId)).data as Any;
  check("Yeni WO Dallar: splitFrom kaynak WO'yu gösterir", childBranches.splitFrom?.id === wo.id);
  // (Adaptasyon) NEW_COLOR'da orijinal sevk taşınmaz — born toplar tüketilir, yeni WO'da
  // YENİ parti + YENİ sevk (laneB) doğar. İz: yeni WO partisinin fason sevki yeni WO'da.
  check("Yeni WO Dallar: yeni partinin fason sevki yeni WO'da",
    childBranches.batches?.some((b: Any) => b.dispatches?.some((d: Any) => d.dispatchId === laneB)) === true);

  // ── 5) ZİNCİR: ayrılanın ayrılması (torun) da eski karttan bulunur ──
  //    Ara WO'da toplar tekrar kabul edilir (renk B ile boyanır → IN_PRODUCTION, Tambur),
  //    sonra bir kez daha NEW_COLOR (renk C) ile ayrılır → torun WO.
  console.log("\nZİNCİR — ara WO'da yeniden kabul (renk B) + tekrar ayır (renk C)");
  const rcB = await sub.receive({
    workOrderId: childId, stepId: childBoya, subcontractorId: SUB,
    returns: bornIds.map((rollId) => ({ rollId })), newRolls: [{ qty: 180 }, { qty: 180 }],
  }, ADMIN);
  const dyedB = await bornRollsOf((rcB.data as Any).id);
  check("Ara WO kabulünde born toplar renk B aldı (yeni WO hedef rengi)",
    dyedB.length === 2 && dyedB.every((r) => r.colorId === colorB.id && r.status === RollStatus.IN_PRODUCTION),
    `renk=${dyedB[0]?.colorId?.slice(0, 8)}`);

  const res2 = (await wos.splitBranch(childId, { batchId: childBatch, mode: "NEW_COLOR", newColorId: colorC.id, orderMode: "stock" }, ADMIN)).data as Any;
  const grandId = res2.newWorkOrderId as string;
  woIds.push(grandId);
  check("Seviye-2 NEW_COLOR: torun WO oluştu", typeof grandId === "string" && grandId !== childId);

  // Torun toplar torun WO boyahanesine sarıldı → pendingReturns için tekrar sevk.
  const afterL2 = await bornRollsOf((rcB.data as Any).id);
  const grandBoya = afterL2[0]?.currentStepId as string;
  const grandIds = afterL2.map((r) => r.id);
  await sub.dispatch({ workOrderId: grandId, stepId: grandBoya, subcontractorId: SUB, rollIds: grandIds }, ADMIN);

  const groups2 = (await sub.listPendingReturns({ workOrderId: wo.id })).data as Any[];
  check("Eski kart torunu da bulur (BFS)", groups2.some((g) => g.workOrder.id === grandId), `grup=${groups2.length}`);
  check("Ara WO'nun artık bekleyen grubu yok (parti torunda)", !groups2.some((g) => g.workOrder.id === childId));

  // ── 6) Yönlendirilen gruptan kabul: doğru WO + doğru (en son) renk ──
  console.log("\nKABUL — eski karttan bulunan torun grubuyla");
  const grandGroup = groups2.find((g) => g.workOrder.id === grandId);
  const rc = await sub.receive({
    workOrderId: grandGroup.workOrder.id, stepId: grandGroup.step.id,
    subcontractorId: grandGroup.lastDispatch.subcontractorId,
    returns: grandGroup.rolls.map((r: Any) => ({ rollId: r.id })),
    newRolls: [{ qty: 170 }],
  }, ADMIN);
  const born = await prisma.roll.findFirst({ where: { parentReceiptId: (rc.data as Any).id }, select: { colorId: true } });
  check("Yönlendirilen kabulde EN SON renk (C) uygulandı", born?.colorId === colorC.id, colorC.name);

  console.log(`\n──────────────────────────────────────────`);
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const stepIds = steps.map((s) => s.id);
    const rolls = await prisma.roll.findMany({
      where: { OR: [ { currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } },
        { parentReceipt: { workOrderId: { in: woIds } } }, { barcode: { startsWith: "TST-LIN-" } } ] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((dd) => dd.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds] } } });
    // Parti modeli: WO'ya bağlı Batch'ler (dispatch/split ile doğar) — batches_workOrderId_fkey.
    // Roll.batchId / SubcontractorDispatch.batchId FK'ları önce silindi (yukarıda), şimdi Batch'ler.
    // Batch.splitFromId self-FK çocuk→ebeveyn zinciri: torun WO'nun batch'i çocuk WO'nun
    // batch'ine bağlı → önce en yeni WO'nun batch'lerini sil (ters woIds sırası).
    for (const woId of [...woIds].reverse()) {
      await prisma.batch.deleteMany({ where: { workOrderId: woId } });
    }
    // splitFromId self-FK: çocukları önce sil (SET NULL olduğundan sıra kritik değil ama temiz olsun)
    await prisma.workOrder.deleteMany({ where: { id: { in: [...woIds].reverse() } } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main().catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
