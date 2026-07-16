// TEST: Fasondan Doğrudan Sevk — KAPSAMLI SENARYOLAR (edge-case + preview + belge).
// Mevcut test_direct_ship_fason.ts ana akışı + idempotency + 2 guard'ı kapsar;
// bu dosya geri kalan her şeyi dener (adversaryal denetim matrisi):
//   over-ship cap, duplicate alloc, çok-satır karşılanma + order status recompute,
//   çoklu açık dispatch (WO kapanmaz), ardışık fason + internal downstream SKIP,
//   batchId (parti) korunur, eşleşmeyen/iptal satır reddi, kısa sebep, top kaçtı 409,
//   previewDirectShip doğruluğu, donmuş belge içeriği + ayrı zincir.
//
// Çalıştır: npx tsx scripts/test_direct_ship_scenarios.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus, WorkOrderStatus, PrintedDocType, PrintedDocStatus } from "@prisma/client";

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", ST_ZIMPARA = "", ST_TAMBUR = "", SUB_BOYER = "", SUB_KESTEL = "", CUSTOMER = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_ZIMPARA = need(await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } }), "ZIMPARA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  SUB_BOYER = need(await prisma.subcontractor.findFirst({ where: { code: "BOYER" }, select: { id: true } }), "BOYER");
  SUB_KESTEL = need(await prisma.subcontractor.findFirst({ where: { code: "KESTEL" }, select: { id: true } }), "KESTEL");
  CUSTOMER = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "MUS-001");
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>, msgPart?: string): Promise<void> {
  let err: string | null = null;
  try { await fn(); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  check(label, err !== null && (!msgPart || err.includes(msgPart)), err ?? "(hata YOK!)");
}

let bc = 0;
function barcode(): string { bc++; return `TST-DSS-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

const woIds: string[] = [], stepIds: string[] = [], orderIds: string[] = [];
async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({ data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN } });
  return r.id;
}
async function makeWo(steps: Array<{ stationId: string; seq: number }>): Promise<{ woId: string; stepIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 100);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TST-DSS-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH, targetQuantity: 1000, targetItemId: ITEM, steps: { create: steps.map((s) => ({ stationId: s.stationId, stepSequence: s.seq, status: "PENDING" as const })) } },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id); const ids = wo.steps.map((s) => s.id); stepIds.push(...ids);
  return { woId: wo.id, stepIds: ids };
}
async function makeOrderLine(qty: number): Promise<string> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const order = await prisma.order.create({ data: { orderNumber: `TST-DSS-ORD-${stamp}`, customerId: CUSTOMER, status: "APPROVED", lines: { create: [{ itemId: ITEM, colorId: null, width: WIDTH, quantity: qty }] } }, include: { lines: true } });
  orderIds.push(order.id); return order.lines[0].id;
}
async function dispatchRolls(woId: string, stepId: string, sc: string, rollIds: string[]): Promise<string> {
  const d = await sub.dispatch({ workOrderId: woId, stepId, subcontractorId: sc, rollIds }, ADMIN);
  return (d.data as { id: string }).id;
}

async function main(): Promise<void> {
  await resolveFixtures();

  // 1) OVER-SHIP: qty > kalan → reddedilir
  console.log("\n=== 1) Over-ship cap (qty > kalan kapasite) ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
    const r = await stockRoll(300);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r]);
    const lineId = await makeOrderLine(500);
    await expectThrow("qty=600 (kalan 500) → reddedilir", () => sub.executeDirectShip({ dispatchId: dId, reason: "over-ship denemesi", customerId: CUSTOMER, orderLineAllocations: [{ orderLineId: lineId, qty: 600 }] }, ADMIN), "aşıyor");
    // Dispatch hâlâ açık olmalı (tx rollback)
    const d = await prisma.subcontractorDispatch.findUnique({ where: { id: dId }, select: { directShippedAt: true } });
    check("Hatadan sonra dispatch açık kaldı (tx rollback)", d?.directShippedAt === null);
  }

  // 2) DUPLICATE orderLineId → reddedilir
  console.log("\n=== 2) Duplicate orderLineId ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
    const r = await stockRoll(300);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r]);
    const lineId = await makeOrderLine(1000);
    await expectThrow("aynı satır iki kez → reddedilir", () => sub.executeDirectShip({ dispatchId: dId, reason: "duplicate denemesi", customerId: CUSTOMER, orderLineAllocations: [{ orderLineId: lineId, qty: 100 }, { orderLineId: lineId, qty: 50 }] }, ADMIN), "iki kez");
  }

  // 3) ÇOK-SATIR karşılanma + order status recompute (tam karşılanma → COMPLETED)
  console.log("\n=== 3) Çok-satır karşılanma + order status COMPLETED ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
    const r1 = await stockRoll(300), r2 = await stockRoll(300);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r1, r2]);
    const lineA = await makeOrderLine(200), lineB = await makeOrderLine(300);
    await sub.executeDirectShip({ dispatchId: dId, reason: "iki siparişe bölündü", customerId: CUSTOMER, orderLineAllocations: [{ orderLineId: lineA, qty: 200 }, { orderLineId: lineB, qty: 300 }] }, ADMIN);
    const olA = await prisma.orderLine.findUnique({ where: { id: lineA }, select: { shippedQty: true, order: { select: { status: true } } } });
    const olB = await prisma.orderLine.findUnique({ where: { id: lineB }, select: { shippedQty: true } });
    check("Satır A shippedQty=200", Number(olA?.shippedQty) === 200);
    check("Satır B shippedQty=300", Number(olB?.shippedQty) === 300);
    check("Satır A siparişi COMPLETED (tam karşılandı)", olA?.order.status === "COMPLETED", String(olA?.order.status));
  }

  // 4) ÇOKLU AÇIK DISPATCH: D1 direct-ship → WO KAPANMAZ (D2 hâlâ fasonda)
  console.log("\n=== 4) Çoklu açık dispatch — D1 direct-ship, WO açık kalır ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
    const r1 = await stockRoll(200), r2 = await stockRoll(200);
    const d1 = await dispatchRolls(woId, s[0], SUB_BOYER, [r1]);
    await dispatchRolls(woId, s[0], SUB_KESTEL, [r2]); // D2 açık kalır
    await sub.executeDirectShip({ dispatchId: d1, reason: "yalnız D1 doğrudan sevk", customerId: CUSTOMER }, ADMIN);
    const r1a = await prisma.roll.findUnique({ where: { id: r1 }, select: { status: true } });
    const r2a = await prisma.roll.findUnique({ where: { id: r2 }, select: { status: true } });
    const step = await prisma.workOrderStep.findUnique({ where: { id: s[0] }, select: { status: true } });
    const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
    check("D1 topu CONSUMED", r1a?.status === RollStatus.SUBCONTRACTOR_CONSUMED);
    check("D2 topu hâlâ AT_SUBCONTRACTOR", r2a?.status === RollStatus.AT_SUBCONTRACTOR);
    check("Adım hâlâ ACTIVE (D2 bekliyor)", step?.status === StepStatus.ACTIVE, String(step?.status));
    check("WO hâlâ IN_PROGRESS (kapanmadı)", wo?.status === WorkOrderStatus.IN_PROGRESS, String(wo?.status));
  }

  // 5) ARDIŞIK FASON + INTERNAL downstream → hepsi SKIPPED, WO COMPLETED
  console.log("\n=== 5) [BOYA→ZIMPARA(fason)→TAMBUR(internal)], BOYA direct-ship → downstream SKIP ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }, { stationId: ST_ZIMPARA, seq: 2 }, { stationId: ST_TAMBUR, seq: 3 }]);
    const r = await stockRoll(400);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r]);
    await sub.executeDirectShip({ dispatchId: dId, reason: "boyahane son durak oldu", customerId: CUSTOMER, completeWorkOrder: true }, ADMIN);
    const steps = await prisma.workOrderStep.findMany({ where: { id: { in: s } }, select: { id: true, status: true, skipReason: true } });
    const m = (id: string) => steps.find((x) => x.id === id)!;
    check("BOYA COMPLETED", m(s[0]).status === StepStatus.COMPLETED);
    check("ZIMPARA(fason) SKIPPED", m(s[1]).status === StepStatus.SKIPPED && m(s[1]).skipReason === "FASON_DIRECT_SHIP");
    check("TAMBUR(internal) SKIPPED", m(s[2]).status === StepStatus.SKIPPED && m(s[2]).skipReason === "FASON_DIRECT_SHIP");
    const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
    check("WO COMPLETED", wo?.status === WorkOrderStatus.COMPLETED);
    // Parti lane korunur — direct-ship top'un partisini (batchId) null'lamaz.
    // Eski batchSplitId=dispatch.id → yeni Roll.batchId = SubcontractorDispatch.batchId (aynı Batch).
    const disp = await prisma.subcontractorDispatch.findUnique({ where: { id: dId }, select: { batchId: true } });
    const ra = await prisma.roll.findUnique({ where: { id: r }, select: { batchId: true } });
    check("batchId (parti) KORUNDU (null değil, dispatch partisiyle eşit)", ra?.batchId != null && ra?.batchId === disp?.batchId, String(ra?.batchId));
  }

  // 6) Eşleşmeyen satır + iptal sipariş + kısa sebep
  console.log("\n=== 6) Eşleşmeyen satır / iptal sipariş / kısa sebep reddi ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
    const r = await stockRoll(300);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r]);
    // farklı item'lı satır → eşleşmez. Başka seed item bul.
    const otherItem = await prisma.item.findFirst({ where: { code: { not: "PATOS" }, isActive: true }, select: { id: true } });
    if (otherItem) {
      const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
      const ord = await prisma.order.create({ data: { orderNumber: `TST-DSS-NM-${stamp}`, customerId: CUSTOMER, status: "APPROVED", lines: { create: [{ itemId: otherItem.id, width: WIDTH, quantity: 100 }] } }, include: { lines: true } });
      orderIds.push(ord.id);
      await expectThrow("eşleşmeyen item satırı → reddedilir", () => sub.executeDirectShip({ dispatchId: dId, reason: "eşleşmeyen satır", customerId: CUSTOMER, orderLineAllocations: [{ orderLineId: ord.lines[0].id, qty: 50 }] }, ADMIN), "eşleşmiyor");
    } else { check("(eşleşmeyen item testi atlandı — başka item yok)", true); }
    // iptal sipariş
    const cancLine = await makeOrderLine(200);
    await prisma.order.updateMany({ where: { lines: { some: { id: cancLine } } }, data: { status: "CANCELLED" } });
    await expectThrow("iptal sipariş satırı → reddedilir", () => sub.executeDirectShip({ dispatchId: dId, reason: "iptal sipariş", customerId: CUSTOMER, orderLineAllocations: [{ orderLineId: cancLine, qty: 50 }] }, ADMIN), "İptal");
    // kısa sebep (reason guard customerId guard'ından da önce → customerId'siz doğru)
    await expectThrow("kısa sebep (<3) → reddedilir", () => sub.executeDirectShip({ dispatchId: dId, reason: "ab" }, ADMIN), "3 karakter");
    // müşteri-zorunlu guard (07fbbde): customerId olmadan → 400 "müşteri zorunludur"
    await expectThrow("customerId YOK → 'müşteri zorunludur'", () => sub.executeDirectShip({ dispatchId: dId, reason: "müşterisiz doğrudan sevk denemesi" }, ADMIN), "müşteri zorunludur");
  }

  // 7) TOP KAÇTI → 409 (claim guard)
  console.log("\n=== 7) Top başka işlemle değişti → 409 claim ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
    const r = await stockRoll(300);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r]);
    // topu elle kaçır (status değiştir)
    await prisma.roll.update({ where: { id: r }, data: { status: RollStatus.STOCK } });
    await expectThrow("toplar AT_SUBCONTRACTOR değil → hata", () => sub.executeDirectShip({ dispatchId: dId, reason: "top kaçtı senaryosu", customerId: CUSTOMER }, ADMIN));
    await prisma.roll.update({ where: { id: r }, data: { status: RollStatus.AT_SUBCONTRACTOR } }); // cleanup için geri al
  }

  // 8) PREVIEW doğruluğu
  console.log("\n=== 8) previewDirectShip doğruluğu ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }, { stationId: ST_TAMBUR, seq: 2 }]);
    const r1 = await stockRoll(250), r2 = await stockRoll(250);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r1, r2]);
    const lineId = await makeOrderLine(400);
    const pv = (await sub.previewDirectShip(dId)).data as {
      affectedRolls: unknown[]; downstreamStepsToSkip: unknown[]; woWillComplete: boolean;
      otherAtSubcontractor: number; candidateOrderLines: { orderLineId: string; suggestedQty: number; isWorkOrderLinked: boolean }[];
      alreadyDirectShipped: boolean; cancelled: boolean;
    };
    check("preview: 2 etkilenecek top", pv.affectedRolls.length === 2);
    check("preview: 1 atlanacak downstream adım (Tambur)", pv.downstreamStepsToSkip.length === 1);
    check("preview: woWillComplete=true (başka top yok)", pv.woWillComplete === true);
    check("preview: otherAtSubcontractor=0", pv.otherAtSubcontractor === 0);
    check("preview: alreadyDirectShipped=false, cancelled=false", !pv.alreadyDirectShipped && !pv.cancelled);
    const cand = pv.candidateOrderLines.find((c) => c.orderLineId === lineId);
    check("preview: spec-eşleşen aday sipariş satırı listelendi", cand != null);
    // NOT: FIFO havuzu TÜM eşleşen açık satırlara (seed dahil) termin sırasıyla
    // dağıtır → bizim (en yeni) satır 0 alabilir; doğru olan havuzun dağıtılması.
    const totalSuggested = pv.candidateOrderLines.reduce((s, c) => s + c.suggestedQty, 0);
    check("preview: FIFO havuzu eşleşen satırlara dağıtıldı (toplam suggestedQty>0)", totalSuggested > 0, `toplam=${totalSuggested}`);
    // direct-ship sonrası alreadyDirectShipped=true
    await sub.executeDirectShip({ dispatchId: dId, reason: "preview sonrası sevk", customerId: CUSTOMER }, ADMIN);
    const pv2 = (await sub.previewDirectShip(dId)).data as { alreadyDirectShipped: boolean };
    check("preview (sevk sonrası): alreadyDirectShipped=true", pv2.alreadyDirectShipped === true);
  }

  // 8b) PREVIEW woWillComplete=false (başka açık dispatch)
  console.log("\n=== 8b) preview woWillComplete=false (çoklu açık dispatch) ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
    const r1 = await stockRoll(200), r2 = await stockRoll(200);
    const d1 = await dispatchRolls(woId, s[0], SUB_BOYER, [r1]);
    await dispatchRolls(woId, s[0], SUB_KESTEL, [r2]);
    const pv = (await sub.previewDirectShip(d1)).data as { woWillComplete: boolean; otherAtSubcontractor: number };
    check("preview: otherAtSubcontractor=1", pv.otherAtSubcontractor === 1, String(pv.otherAtSubcontractor));
    check("preview: woWillComplete=false", pv.woWillComplete === false);
  }

  // 9) BELGE: donmuş, içerik, ayrı zincir
  console.log("\n=== 9) Donmuş belge (SUBCONTRACTOR_DIRECT_SHIP) içerik + ayrı zincir ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
    const r = await stockRoll(300);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r]);
    const lineId = await makeOrderLine(300);
    await sub.executeDirectShip({ dispatchId: dId, reason: "belge testi sebebi", customerId: CUSTOMER, orderLineAllocations: [{ orderLineId: lineId, qty: 300 }] }, ADMIN);
    // Donmuş belgenin sourceId'si DirectShipment.id (dispatch DEĞİL) — önce olayı bul.
    const ds9 = await prisma.directShipment.findFirst({ where: { dispatchId: dId }, select: { id: true, customerId: true } });
    check("DirectShipment kaydı doğdu (customerId doğru)", ds9 != null && ds9.customerId === CUSTOMER);
    const ds9Id = ds9?.id ?? "00000000-0000-0000-0000-000000000000";
    const dsDoc = await prisma.printedDocument.findFirst({ where: { docType: PrintedDocType.SUBCONTRACTOR_DIRECT_SHIP, sourceId: ds9Id, status: PrintedDocStatus.ACTIVE }, select: { snapshot: true } });
    check("DIRECT_SHIP belgesi ACTIVE donmuş", dsDoc != null);
    const snap = dsDoc?.snapshot as { doc?: { directShip?: boolean; directShipReason?: string; allocations?: unknown[] } } | null;
    check("belge snapshot: directShip=true", snap?.doc?.directShip === true);
    check("belge snapshot: reason var", snap?.doc?.directShipReason === "belge testi sebebi");
    check("belge snapshot: allocations 1 satır", (snap?.doc?.allocations?.length ?? 0) === 1);
    // Ayrı zincir: SUBCONTRACTOR_DISPATCH belgesi de var (dispatch anında donmuştu)
    const dispDoc = await prisma.printedDocument.findFirst({ where: { docType: PrintedDocType.SUBCONTRACTOR_DISPATCH, sourceId: dId }, select: { id: true } });
    check("Ayrı zincir: SUBCONTRACTOR_DISPATCH belgesi de mevcut (çakışma yok)", dispDoc != null);
  }

  // 10) EŞZAMANLILIK YARIŞI: iki paralel executeDirectShip → tam biri kazanır
  console.log("\n=== 10) Concurrency — iki paralel direct-ship, tam biri kazanır ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
    const r = await stockRoll(300);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r]);
    // Aynı dispatch'e eşzamanlı iki çağrı (havuzlu client → ayrı tx/connection).
    const results = await Promise.allSettled([
      sub.executeDirectShip({ dispatchId: dId, reason: "yarış A", customerId: CUSTOMER }, ADMIN),
      sub.executeDirectShip({ dispatchId: dId, reason: "yarış B", customerId: CUSTOMER }, ADMIN),
    ]);
    const fulfilled = results.filter((x) => x.status === "fulfilled").length;
    const rejected = results.filter((x) => x.status === "rejected").length;
    // İki sonuç da olabilir: (biri 200 + biri 409) VEYA (biri commit + diğeri idempotent-cached 200).
    // Kritik invariant: top TAM BİR KEZ tüketildi, dispatch bir kez işaretlendi, tek RollOperation.
    const rollOps = await prisma.rollOperation.count({ where: { rollId: r, operationType: "SUBCONTRACTOR_RETURNED" } });
    const rollNow = await prisma.roll.findUnique({ where: { id: r }, select: { status: true } });
    check("İki paralel çağrı çöküş yapmadı (1 reject VEYA 2 idempotent çözüldü)", fulfilled >= 1 && fulfilled + rejected === 2, `fulfilled=${fulfilled} rejected=${rejected}`);
    check("Top TAM BİR KEZ tüketildi (CONSUMED + tek SUBCONTRACTOR_RETURNED op)", rollNow?.status === RollStatus.SUBCONTRACTOR_CONSUMED && rollOps === 1, `status=${rollNow?.status} ops=${rollOps}`);
    // Belge sourceId = DirectShipment.id → önce olay kayıtlarını say (çift kayıt da yarış hatası olur).
    const ds10 = await prisma.directShipment.findMany({ where: { dispatchId: dId }, select: { id: true } });
    check("Tek DirectShipment kaydı (çift olay yok)", ds10.length === 1, String(ds10.length));
    const doc = await prisma.printedDocument.count({ where: { sourceId: { in: ds10.map((d) => d.id) }, docType: PrintedDocType.SUBCONTRACTOR_DIRECT_SHIP } });
    check("Tek DIRECT_SHIP belgesi (çift freeze yok)", doc === 1, String(doc));
  }

  // 11) completeWorkOrder=FALSE → WO AÇIK kalır, downstream ATLANMAZ (P-2606-4-1 fix)
  console.log("\n=== 11) completeWorkOrder=false → WO açık kalır, downstream PENDING ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }, { stationId: ST_TAMBUR, seq: 2 }]);
    const r1 = await stockRoll(150), r2 = await stockRoll(150);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r1, r2]);
    // Tüm topları sevk et ama "iş emrini tamamla" DEME.
    await sub.executeDirectShip({ dispatchId: dId, reason: "kısmi sipariş, kalan üretim devam", customerId: CUSTOMER, completeWorkOrder: false }, ADMIN);
    const steps = await prisma.workOrderStep.findMany({ where: { id: { in: s } }, select: { id: true, status: true } });
    const m = (id: string) => steps.find((x) => x.id === id)!;
    check("BOYA adımı COMPLETED (top kalmadı)", m(s[0]).status === StepStatus.COMPLETED, m(s[0]).status);
    check("TAMBUR adımı PENDING (ATLANMADI)", m(s[1]).status === StepStatus.PENDING, m(s[1]).status);
    const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
    check("WO IN_PROGRESS (KAPANMADI — kalan üretim devam)", wo?.status === WorkOrderStatus.IN_PROGRESS, String(wo?.status));
    const rollsConsumed = await prisma.roll.count({ where: { id: { in: [r1, r2] }, status: RollStatus.SUBCONTRACTOR_CONSUMED } });
    check("Sevk edilen 2 top CONSUMED", rollsConsumed === 2);
  }

  // 12) KISMİ SEVK (rollIds alt-küme) → seçilmeyen fasonda kalır, dispatch açık
  console.log("\n=== 12) Kısmi sevk — 2 toptan 1'i sevk, diğeri fasonda kalır ===");
  {
    const { woId, stepIds: s } = await makeWo([{ stationId: ST_BOYA, seq: 1 }]);
    const r1 = await stockRoll(200), r2 = await stockRoll(200);
    const dId = await dispatchRolls(woId, s[0], SUB_BOYER, [r1, r2]);
    await sub.executeDirectShip({ dispatchId: dId, reason: "yalnız bir topu doğrudan sevk", customerId: CUSTOMER, rollIds: [r1] }, ADMIN);
    const r1a = await prisma.roll.findUnique({ where: { id: r1 }, select: { status: true } });
    const r2a = await prisma.roll.findUnique({ where: { id: r2 }, select: { status: true } });
    check("Sevk edilen top (r1) CONSUMED", r1a?.status === RollStatus.SUBCONTRACTOR_CONSUMED, String(r1a?.status));
    check("Sevk EDİLMEYEN top (r2) hâlâ AT_SUBCONTRACTOR (fasonda kaldı)", r2a?.status === RollStatus.AT_SUBCONTRACTOR, String(r2a?.status));
    const step = await prisma.workOrderStep.findUnique({ where: { id: s[0] }, select: { status: true } });
    check("Fason adımı ACTIVE (r2 bekliyor)", step?.status === StepStatus.ACTIVE, String(step?.status));
    const disp = await prisma.subcontractorDispatch.findUnique({ where: { id: dId }, select: { directShippedAt: true } });
    check("Dispatch AÇIK (directShippedAt null — kısmi sevk)", disp?.directShippedAt === null);
    const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
    check("WO IN_PROGRESS", wo?.status === WorkOrderStatus.IN_PROGRESS);
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceipt: { workOrderId: { in: woIds } } }, { barcode: { startsWith: "TST-DSS-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    const directShipments = await prisma.directShipment.findMany({ where: { dispatchId: { in: dispatchIds } }, select: { id: true } });
    const directShipmentIds = directShipments.map((d) => d.id);
    const orderLines = await prisma.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    const orderLineIds = orderLines.map((l) => l.id);
    // Direct-ship irsaliyesinin sourceId'si DirectShipment.id — her iki kaynağı da sil.
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...directShipmentIds] } } });
    // DirectShipment sökümü: önce roll bağını çöz, sonra allocation, sonra kayıt
    // (DirectShipment.dispatchId Restrict → dispatch'ten ÖNCE silinmeli).
    await prisma.roll.updateMany({ where: { directShipment: { dispatchId: { in: dispatchIds } } }, data: { directShipmentId: null } });
    await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.directShipment.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.orderLine.deleteMany({ where: { id: { in: orderLineIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...dispatchIds, ...woIds, ...orderIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main().catch((e) => { console.error("HATA:", e); fail++; }).finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
