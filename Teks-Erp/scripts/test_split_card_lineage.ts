// TEST: Parti ayırma SOY BAĞI + ESKİ REFAKAT KARTI YÖNLENDİRMESİ.
//
// Senaryo: Ayrılan parti fiziksel olarak ESKİ WO'nun refakat kartını taşır.
// Eski kart kabulde okutulunca (pendingReturns by workOrderId) operatör çıkmaza
// girmemeli: splitFromId soy bağı üzerinden ayrılan partinin YENİ WO'daki
// bekleyen grubu da listede görünmeli (isSplitChild=true). Ayrıca:
//   - getBranches: kaynak WO'da splitChildren izi, yeni WO'da splitFrom izi
//   - Yeni WO'nun kendi ACTIVE refakat kartı var (split tx'inde basıldı)
//   - Zincir: ayrılanın ayrılması (torun) da eski karttan bulunur (BFS)
//
// Çalıştır: npx ts-node scripts/test_split_card_lineage.ts
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

  // ── İki parti boyahaneye ──
  const p1 = [await stockRoll(300), await stockRoll(300)];
  await sub.dispatch({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB, rollIds: p1 }, ADMIN);
  const p2 = [await stockRoll(200), await stockRoll(200)];
  const d2 = await sub.dispatch({ workOrderId: wo.id, stepId: srcBoya, subcontractorId: SUB, rollIds: p2 }, ADMIN);
  const lane2 = (d2.data as Any).id as string;          // sevk (dispatch) id — Dallar paneli assertion'ı için
  const batch2 = (d2.data as Any).batchId as string;    // sevkin partisi (Batch id) — splitBranch artık batchId ister

  // ── Parti-2'yi ayır (continue, renk B) ──
  const res = (await wos.splitBranch(wo.id, { batchId: batch2, mode: "NEW_COLOR", newColorId: colorB.id, orderMode: "stock" }, ADMIN)).data as Any;
  const childId = res.newWorkOrderId as string;
  woIds.push(childId);

  // ── 1) Soy bağı kolonu ──
  const child = await prisma.workOrder.findUnique({ where: { id: childId }, select: { splitFromId: true, workOrderNumber: true } });
  check("Yeni WO.splitFromId = kaynak WO", child?.splitFromId === wo.id);

  // ── 2) Yeni WO'nun KENDİ aktif kartı (split tx'inde basıldı) ──
  const newCard = await prisma.travelerCard.findFirst({
    where: { workOrderId: childId, status: TravelerCardStatus.ACTIVE },
    select: { id: true, barcode: true, snapshot: true },
  });
  check("Yeni WO'nun kendi ACTIVE kartı var", newCard !== null);
  check("Yeni kart barkodu eskisinden farklı", newCard?.barcode !== oldCard?.barcode);
  const snapStr = JSON.stringify(newCard?.snapshot ?? {});
  check("Yeni kart snapshot'ı YENİ rengi taşıyor", snapStr.includes(colorB.id) || snapStr.includes(colorB.name), colorB.name);

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
  check("Yeni WO Dallar: taşınan sevk lane'i yeni WO'da",
    childBranches.batches?.some((b: Any) => b.dispatches?.some((d: Any) => d.dispatchId === lane2)) === true);

  // ── 5) ZİNCİR: ayrılanın ayrılması (torun) da eski karttan bulunur ──
  console.log("\nZİNCİR — yeni WO'nun partisini bir kez daha ayır (renk C)");
  const res2 = (await wos.splitBranch(childId, { batchId: res.newBatchId as string, mode: "NEW_COLOR", newColorId: colorC.id, orderMode: "stock" }, ADMIN)).data as Any;
  const grandId = res2.newWorkOrderId as string;
  woIds.push(grandId);
  const groups2 = (await sub.listPendingReturns({ workOrderId: wo.id })).data as Any[];
  check("Eski kart torunu da bulur (BFS)", groups2.some((g) => g.workOrder.id === grandId), `grup=${groups2.length}`);
  check("Ara WO'nun artık bekleyen grubu yok (parti torunda)", !groups2.some((g) => g.workOrder.id === childId));

  // ── 6) Yönlendirilen gruptan kabul: doğru WO + doğru renk ──
  console.log("\nKABUL — eski karttan bulunan torun grubuyla");
  const grandGroup = groups2.find((g) => g.workOrder.id === grandId);
  const rc = await sub.receive({
    workOrderId: grandGroup.workOrder.id, stepId: grandGroup.step.id,
    subcontractorId: grandGroup.lastDispatch.subcontractorId,
    returns: grandGroup.rolls.map((r: Any) => ({ rollId: r.id })),
    newRolls: [{ qty: 380 }],
  }, ADMIN);
  const born = await prisma.roll.findFirst({ where: { parentReceiptId: (rc.data as Any).id }, select: { colorId: true } });
  check("Yönlendirilen kabulde EN SON renk (C) uygulandı", born?.colorId === colorC.id, colorC.name);

  console.log(`\n──────────────────────────────────────────`);
  console.log(`SONUÇ: ${pass} geçti, ${fail} başarısız`);
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
    // Batch.splitFromId self-FK (Restrict) çocuk→ebeveyn zinciri: torun WO'nun batch'i
    // çocuk WO'nun batch'ine bağlı → önce en yeni WO'nun batch'lerini sil (ters woIds sırası).
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
