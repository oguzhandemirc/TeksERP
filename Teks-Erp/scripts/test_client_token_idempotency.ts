// TEST: clientToken idempotency sözleşmesi (İdempotency denetimi Faz 2).
// Aynı token'la 2. çağrı = cached kayıt (mükerrer YOK); farklı payload = 409.
//
//   CT1 Order create   : replay → aynı id, order count 1; farklı payload → 409 collision
//   CT2 quickOrder      : replay → aynı sipariş, tek sipariş (WAREHOUSE toplar claim'siz)
//   CT3 WO create       : replay → aynı id + TEK refakat kartı; farklı targetItem → 409
//   CT4 quickStart      : replay → aynı WO, isActive===true KALIR (hardDelete regresyonu!)
//   CT5 reduceStock     : replay → N iptal (2N DEĞİL) + tek SwatchStockReduction satırı
//   CT6 hardDelete token: zero-attach telafisi sonrası aynı token'la taze create BAŞARIR
//
// Çalıştır: npx tsx scripts/test_client_token_idempotency.ts
import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { kartelaService } from "../src/services/kartela.service";
import { RollStatus, StationType } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, code: number, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(label, false, "hata bekleniyordu");
  } catch (e) {
    const sc = (e as { statusCode?: number }).statusCode;
    check(label, sc === code, `statusCode ${sc}`);
  }
}

// UUID v4 üretici (istemci emsali).
function uuid(): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const v = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${v}${hex(3)}-${hex(12)}`;
}

const orderSvc = new OrderService({
  modelName: "order", tableName: "ORDER", searchFields: ["orderNumber"],
  defaultInclude: { lines: true }, nestedCreateFields: ["lines"],
});
const wos = new WorkOrderService();

const ts = Date.now();
const createdOrderIds: string[] = [];
const createdWoIds: string[] = [];
const createdRollIds: string[] = [];
const createdSwatchIds: string[] = [];
let ITEM = "", ITEM2 = "", ADMIN = "", CUSTOMER = "", STATION = "";

async function main(): Promise<void> {
  const item = await prisma.item.create({ data: { code: `TST-CT-I-${ts}`, name: "CT KUMAŞ", itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const item2 = await prisma.item.create({ data: { code: `TST-CT-I2-${ts}`, name: "CT KUMAŞ 2", itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const customer = await prisma.customer.create({ data: { code: `TST-CT-C-${ts}`, name: "CT MÜŞTERİ" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  // NEDEN `type` (kind DEĞİL): aşağıdaki hata mesajının da dediği gibi burada istenen
  // INTERNAL bir istasyon; "fason mu" ayrımının kanonik kaynağı `Station.type`'tır
  // (`subcontractor.service.ts` her yerde `station.type !== StationType.EXTERNAL` ile bakar).
  // Eskiden `kind: { not: StationKind.EXTERNAL }` yazıyordu — `StationKind`'da EXTERNAL
  // ÜYESİ YOK (o `StationType`'ta). Runtime'da `undefined` olduğu ve Prisma `undefined`
  // koşulu tamamen ATTIĞI için süzgeç sessizce `{ isActive: true }`'e düşüyor, yani
  // "fason olmayan" garantisi hiç uygulanmıyordu; CT3/CT4/CT6'nın kurduğu iş emirleri
  // pekâlâ bir boyahane adımı üzerine kurulabilirdi. `orderBy` determinizm için:
  // sırasız `findFirst` DB'nin fiziksel satır sırasına kalır (bu projede geri-yükleme
  // kopya-DB'ye pg_restore ile yapılıyor → sıra garanti değil).
  const station = await prisma.station.findFirst({
    where: { type: { not: StationType.EXTERNAL }, isActive: true },
    orderBy: [{ createdAt: "asc" }, { code: "asc" }],
    select: { id: true },
  });
  if (!admin || !station) throw new Error("Seed fixture eksik (admin / INTERNAL station) — önce 'npm run seed'");
  ITEM = item.id; ITEM2 = item2.id; CUSTOMER = customer.id; ADMIN = admin.id; STATION = station.id;

  // ═══ CT1 — ORDER CREATE REPLAY ═══
  console.log("\n=== CT1: Order create — aynı token replay → aynı sipariş; farklı payload → 409 ===");
  {
    const token = uuid();
    const payload = () => ({ customerId: CUSTOMER, lines: [{ itemId: ITEM, quantity: 100, width: 150 }], clientToken: token });
    const r1 = await orderSvc.create(payload(), ADMIN);
    const o1 = r1.data as { id: string; orderNumber: string };
    createdOrderIds.push(o1.id);
    const r2 = await orderSvc.create(payload(), ADMIN); // birebir replay
    const o2 = r2.data as { id: string; orderNumber: string };
    check("CT1: replay aynı sipariş id döner (cached)", o1.id === o2.id, `${o1.orderNumber}`);
    const cnt = await prisma.order.count({ where: { clientToken: token } });
    check("CT1: tek sipariş yazıldı (mükerrer yok)", cnt === 1, `count ${cnt}`);
    // Aynı token + FARKLI payload (2 satır) → collision 409.
    await expectErr("CT1: aynı token farklı payload → 409", 409, () =>
      orderSvc.create({ customerId: CUSTOMER, lines: [{ itemId: ITEM, quantity: 100, width: 150 }, { itemId: ITEM, quantity: 50, width: 200 }], clientToken: token }, ADMIN),
    );
  }

  // ═══ CT2 — quickOrderFromRolls REPLAY ═══
  console.log("\n=== CT2: quickOrder — replay → tek sipariş (WAREHOUSE toplar claim'siz) ===");
  {
    const mk = (n: number) => prisma.roll.create({ data: { barcode: `TST-CT-QO${n}-${ts}`, itemId: ITEM, colorId: null, status: RollStatus.STOCK, currentQty: 100, initialQty: 100, width: 150, qualityGrade: "A", entrySource: "SUPPLIER_RECEIPT" }, select: { id: true } });
    const ra = await mk(1); const rb = await mk(2);
    createdRollIds.push(ra.id, rb.id);
    const token = uuid();
    const body = () => ({ customerId: CUSTOMER, rollIds: [ra.id, rb.id], clientToken: token });
    const q1 = await orderSvc.quickOrderFromRolls(body(), ADMIN);
    const qo1 = (q1.data as { order: { id: string; orderNumber: string } }).order;
    createdOrderIds.push(qo1.id);
    // Replay: toplar artık WAREHOUSE (ilk çağrı claim etti) → claim atlanır, tek koruma token.
    const q2 = await orderSvc.quickOrderFromRolls(body(), ADMIN);
    const qo2 = (q2.data as { order: { id: string; orderNumber: string } }).order;
    check("CT2: replay aynı hızlı sipariş döner", qo1.id === qo2.id, `${qo1.orderNumber}`);
    const cnt = await prisma.order.count({ where: { clientToken: token } });
    check("CT2: tek sipariş yazıldı (timeout-replay mükerrer önlendi)", cnt === 1, `count ${cnt}`);
  }

  // ═══ CT3 — WO CREATE REPLAY ═══
  console.log("\n=== CT3: WO create — replay → aynı id + TEK refakat kartı; farklı targetItem → 409 ===");
  {
    const token = uuid();
    const woPayload = () => ({ clientToken: token, type: "STOCK_PRODUCTION", targetItemId: ITEM, steps: [{ stationId: STATION, notes: null }] });
    const w1 = await wos.create(woPayload(), ADMIN);
    const wo1 = w1.data as { id: string; workOrderNumber: string };
    createdWoIds.push(wo1.id);
    const w2 = await wos.create(woPayload(), ADMIN); // replay
    const wo2 = w2.data as { id: string };
    check("CT3: replay aynı WO id döner (cached)", wo1.id === wo2.id, `${wo1.workOrderNumber}`);
    const woCnt = await prisma.workOrder.count({ where: { clientToken: token } });
    check("CT3: tek WO yazıldı", woCnt === 1, `count ${woCnt}`);
    const cardCnt = await prisma.travelerCard.count({ where: { workOrderId: wo1.id } });
    check("CT3: TEK refakat kartı (çift kart yok)", cardCnt === 1, `card ${cardCnt}`);
    // Aynı token + farklı targetItem → collision.
    await expectErr("CT3: aynı token farklı targetItem → 409", 409, () =>
      wos.create({ clientToken: token, type: "STOCK_PRODUCTION", targetItemId: ITEM2, steps: [{ stationId: STATION, notes: null }] }, ADMIN),
    );
  }

  // ═══ CT4 — quickStart REPLAY (hardDelete regresyon guard'ı) ═══
  console.log("\n=== CT4: quickStart — replay → aynı WO, isActive===true KALIR (hardDelete regresyonu) ===");
  {
    const mk = (n: number) => prisma.roll.create({ data: { barcode: `TST-CT-QS${n}-${ts}`, itemId: ITEM, colorId: null, status: RollStatus.STOCK, currentQty: 200, initialQty: 200, width: 150, qualityGrade: "A", entrySource: "SUPPLIER_RECEIPT" }, select: { id: true, barcode: true } });
    const ra = await mk(1); const rb = await mk(2);
    createdRollIds.push(ra.id, rb.id);
    const token = uuid();
    const qsBody = () => ({ clientToken: token, type: "STOCK_PRODUCTION", targetItemId: ITEM, steps: [{ stationId: STATION, notes: null }], rollBarcodes: [ra.barcode, rb.barcode] });
    const s1 = await wos.quickStart(qsBody() as never, ADMIN);
    const qs1 = s1.data as { workOrder: { id: string; workOrderNumber: string }; attached: number };
    createdWoIds.push(qs1.workOrder.id);
    check("CT4: ilk quickStart 2 top bağladı", qs1.attached === 2, `attached ${qs1.attached}`);
    // Replay: create cached WO döner → quickStart replay-guard attach/telafi'yi ATLAR.
    // (Guard olmasa attach=0 → zero-attach telafisi GERÇEK WO'yu hardDelete ederdi.)
    const s2 = await wos.quickStart(qsBody() as never, ADMIN);
    const qs2 = s2.data as { workOrder: { id: string }; attached: number };
    check("CT4: replay aynı WO döner", qs1.workOrder.id === qs2.workOrder.id, `${qs1.workOrder.workOrderNumber}`);
    const fresh = await prisma.workOrder.findUnique({ where: { id: qs1.workOrder.id }, select: { isActive: true } });
    check("CT4: WO isActive===true KALIR (replay onu ARŞİVLEMEDİ)", fresh?.isActive === true);
    check("CT4: replay attached sayısı doğru (2)", qs2.attached === 2, `attached ${qs2.attached}`);
  }

  // ═══ CT5 — reduceStock REPLAY (çift düşüm guard'ı) ═══
  console.log("\n=== CT5: reduceStock — replay → N iptal (2N DEĞİL) + tek reduction satırı ===");
  {
    // 5 müsait kartela oluştur (aynı item, renksiz, depoda).
    for (let i = 0; i < 5; i++) {
      const sw = await prisma.swatch.create({ data: { cardNumber: `TST-CT-SW-${ts}-${i}`, barcode: `TST-CT-SWB-${ts}-${i}`, itemId: ITEM, colorId: null }, select: { id: true } });
      createdSwatchIds.push(sw.id);
    }
    const token = uuid();
    const body = () => ({ itemId: ITEM, colorId: null, count: 2, reason: "TEST sayım düzeltmesi", clientToken: token });
    const rr1 = await kartelaService.reduceStock(body(), ADMIN);
    check("CT5: ilk düşüm 2 kartela iptal etti", rr1.data.reduced === 2, `reduced ${rr1.data.reduced}`);
    const rr2 = await kartelaService.reduceStock(body(), ADMIN); // replay
    check("CT5: replay cached { reduced: 2 } döner", rr2.data.reduced === 2, `reduced ${rr2.data.reduced}`);
    const cancelled = await prisma.swatch.count({ where: { id: { in: createdSwatchIds }, cancelledAt: { not: null } } });
    check("CT5: TOPLAM 2 kartela iptal (2N=4 DEĞİL — çift düşüm önlendi)", cancelled === 2, `cancelled ${cancelled}`);
    const redCnt = await prisma.swatchStockReduction.count({ where: { clientToken: token } });
    check("CT5: tek SwatchStockReduction satırı", redCnt === 1, `reduction ${redCnt}`);
  }

  // ═══ CT6 — hardDelete TOKEN RELEASE ═══
  console.log("\n=== CT6: hardDelete token release → aynı token'la taze create BAŞARIR ===");
  {
    const token = uuid();
    const w1 = await wos.create({ clientToken: token, type: "STOCK_PRODUCTION", targetItemId: ITEM, steps: [{ stationId: STATION, notes: null }] }, ADMIN);
    const wo1 = w1.data as { id: string };
    // hardDelete (zero-attach telafisi emsali) → arşivler + clientToken NULL'lar.
    await wos.hardDelete(wo1.id, ADMIN);
    const afterDel = await prisma.workOrder.findUnique({ where: { id: wo1.id }, select: { isActive: true, clientToken: true } });
    check("CT6: hardDelete WO'yu arşivledi + token'ı serbest bıraktı", afterDel?.isActive === false && afterDel?.clientToken === null);
    // Aynı token'la taze create → collision DEĞİL, yeni WO doğar (token serbest).
    const w2 = await wos.create({ clientToken: token, type: "STOCK_PRODUCTION", targetItemId: ITEM, steps: [{ stationId: STATION, notes: null }] }, ADMIN);
    const wo2 = w2.data as { id: string; workOrderNumber: string };
    createdWoIds.push(wo1.id, wo2.id);
    check("CT6: aynı token'la taze create BAŞARIR (yeni WO)", wo2.id !== wo1.id && w2.success === true, `${wo2.workOrderNumber}`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    // WO'ya bağlı toplar/kartlar → WO; sipariş satırları → sipariş; sonra master-data.
    const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } })).map((s) => s.id);
    const attachedRollIds = (await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }] }, select: { id: true } })).map((r) => r.id);
    const allRollIds = [...new Set([...createdRollIds, ...attachedRollIds])];
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: createdWoIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: allRollIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    await prisma.swatchStockReduction.deleteMany({ where: { itemId: ITEM } });
    await prisma.swatch.deleteMany({ where: { id: { in: createdSwatchIds } } });
    for (const id of createdOrderIds) {
      await prisma.orderLine.deleteMany({ where: { orderId: id } });
      await prisma.order.delete({ where: { id } }).catch(() => {});
    }
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...createdWoIds, ...createdOrderIds, ...createdRollIds] } } });
    await prisma.item.deleteMany({ where: { id: { in: [ITEM, ITEM2].filter(Boolean) } } });
    await prisma.customer.deleteMany({ where: { id: CUSTOMER } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
