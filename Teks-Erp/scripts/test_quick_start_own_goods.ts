// =============================================================================
// KENDİ ÜRETİM İŞ EMRİ — quick-start `ownGoods` (tablet "Kendi üretim" formu, 2026-11-09)
//   §1 topsuz açılış: yalnız İE doğar (STOCK, müşterisiz, parti yok) · bayraksız boş liste bugünkü gibi 400
//   §2 top okutarak: toplar bağlanır, rotanın İLK adımına iner (IN_PRODUCTION)
//   §3 emanet top: 400 WO_OWN_GOODS_CONSIGNED_ROLL (details.barcodes) + İE doğmaz · bayraksız bugünkü gibi kabul
//   §4 uygunsuz top details.code taşır: bulunamayan / stok dışı / farklı kumaş
//   §5 ownGoods + Fason türü 400 WO_OWN_GOODS_TYPE · sipariş kalemiyle tür ORDER türer
//   §6 idempotency: topsuz + hedefsiz aynı token replay aynı İE'yi döner (varsayılan kumaş çakışma sayılmaz)
//   §7 HTTP şeması: boş rollBarcodes yalnız ownGoods ile geçer
// Koşum: npx tsx scripts/test_quick_start_own_goods.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { RollEntrySource, RollStatus, StationKind, StationType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { quickStartSchemaForTest } from "../src/controllers/workorder.controller";

const svc = new WorkOrderService();
const uniq = `${Date.now()}`;
const rollIds: string[] = [];
const woIds: string[] = [];
const customerIds: string[] = [];
const itemIds: string[] = [];
const orderIds: string[] = [];
const stationIds: string[] = [];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const errCode = (e: unknown): string | undefined => (e as { details?: { code?: string } })?.details?.code;
async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<unknown> {
  try {
    const r = await fn();
    const wo = (r as { data?: { workOrder?: { id: string } } })?.data?.workOrder;
    if (wo) woIds.push(wo.id);
    check(label, false, "hata atılmadı");
    return undefined;
  } catch (e) {
    check(label, errCode(e) === code, `code=${errCode(e)} ${(e as Error).message?.slice(0, 90)}`);
    return e;
  }
}
const track = <T extends { data?: { workOrder?: { id: string } } }>(r: T): T => {
  if (r.data?.workOrder) woIds.push(r.data.workOrder.id);
  return r;
};

async function makeRoll(itemId: string, owner: string | null, status: RollStatus = RollStatus.STOCK) {
  const r = await prisma.roll.create({
    data: {
      barcode: `TEST-OWN-${uniq}-${Math.floor(Math.random() * 1e7)}`,
      itemId, colorId: null, width: 150, initialQty: 40, currentQty: 40,
      status, entrySource: RollEntrySource.SUPPLIER_RECEIPT, ownerCustomerId: owner,
    },
    select: { id: true, barcode: true },
  });
  rollIds.push(r.id);
  return { id: r.id, barcode: r.barcode as string };
}

async function main() {
  console.log("=== Kendi üretim iş emri (quick-start ownGoods) ===\n");
  const item = await prisma.item.create({ data: { code: `TST-OWN-I-${uniq}`, name: `TEST-OWN KUMAS ${uniq}`, itemType: "FABRIC" }, select: { id: true } });
  const item2 = await prisma.item.create({ data: { code: `TST-OWN-J-${uniq}`, name: `TEST-OWN KUMAS2 ${uniq}`, itemType: "FABRIC" }, select: { id: true } });
  itemIds.push(item.id, item2.id);
  const station = await prisma.station.create({
    data: { code: `TST-OWN-ST-${uniq}`.slice(0, 32), name: `TEST-OWN İç ${uniq}`, type: StationType.INTERNAL, kind: StationKind.OTHER, allowAsWorkOrderStep: true },
    select: { id: true },
  });
  stationIds.push(station.id);
  const steps = [{ stationId: station.id, notes: null }];
  const cust = await prisma.customer.create({ data: { code: `TOWN${uniq.slice(-7)}`, name: `TEST-OWN MUSTERI ${uniq}`, isCustomerRole: true }, select: { id: true } });
  customerIds.push(cust.id);

  // §1 topsuz
  await expectCode("§1a bayraksız boş liste → 400 ROLL_BARCODE_REQUIRED (bugünkü kural)", "ROLL_BARCODE_REQUIRED", () =>
    svc.quickStart({ steps, targetItemId: item.id, rollBarcodes: [] }));
  const t1 = track(await svc.quickStart({ ownGoods: true, steps, targetItemId: item.id, rollBarcodes: [] }));
  const w1 = t1.data?.workOrder;
  check("§1b ownGoods topsuz: İE doğdu, tür STOCK, müşterisiz", !!w1 && w1.type === "STOCK_PRODUCTION" && w1.customerId === null, `type=${w1?.type}`);
  check("§1c topsuz: attached 0, parti yok", t1.data?.attached === 0 && t1.data?.batch === null);
  const b1 = w1 ? await prisma.batch.count({ where: { workOrderId: w1.id } }) : -1;
  check("§1d topsuz İE'de parti satırı yok", b1 === 0, `batch=${b1}`);

  // §2 top okutarak
  const r1 = await makeRoll(item.id, null);
  const r2 = await makeRoll(item.id, null);
  const t2 = track(await svc.quickStart({ ownGoods: true, steps, rollBarcodes: [r1.barcode, r2.barcode] }));
  check("§2a top okutarak: 2 top bağlandı, tür STOCK", t2.data?.attached === 2 && t2.data?.workOrder.type === "STOCK_PRODUCTION");
  const first = t2.data ? await prisma.workOrderStep.findFirst({ where: { workOrderId: t2.data.workOrder.id }, orderBy: { stepSequence: "asc" }, select: { id: true } }) : null;
  const atFirst = await prisma.roll.count({ where: { id: { in: [r1.id, r2.id] }, currentStepId: first?.id ?? "-", status: RollStatus.IN_PRODUCTION } });
  check("§2b toplar ilk adımda (IN_PRODUCTION)", atFirst === 2, `n=${atFirst}`);

  // §3 emanet top
  const rc = await makeRoll(item.id, cust.id);
  const rn = await makeRoll(item.id, null);
  const before = await prisma.workOrder.count({ where: { targetItemId: item.id } });
  const e3 = await expectCode("§3a emanet top + ownGoods → 400 WO_OWN_GOODS_CONSIGNED_ROLL", "WO_OWN_GOODS_CONSIGNED_ROLL", () =>
    svc.quickStart({ ownGoods: true, steps, rollBarcodes: [rn.barcode, rc.barcode] }));
  const bc = (e3 as { details?: { barcodes?: string[] } } | undefined)?.details?.barcodes ?? [];
  check("§3b details.barcodes yalnız emanet topu sayar", bc.length === 1 && bc[0] === rc.barcode, JSON.stringify(bc));
  const after = await prisma.workOrder.count({ where: { targetItemId: item.id } });
  check("§3c red İE doğurmadı (ön doğrulama create'ten önce)", after === before, `${before}→${after}`);
  const rcState = await prisma.roll.findUnique({ where: { id: rc.id }, select: { status: true, currentStepId: true } });
  check("§3d emanet top yerinde kaldı (STOCK, adımsız)", rcState?.status === RollStatus.STOCK && rcState.currentStepId === null);
  const t3 = track(await svc.quickStart({ steps, rollBarcodes: [rc.barcode] }));
  check("§3e bayraksız quickStart emanet topu bugünkü gibi kabul eder", t3.data?.attached === 1);

  // §4 uygunsuz top kodları
  await expectCode("§4a bulunamayan barkod → ROLL_NOT_FOUND", "ROLL_NOT_FOUND", () =>
    svc.quickStart({ ownGoods: true, steps, rollBarcodes: [`TEST-OWN-YOK-${uniq}`] }));
  const rs = await makeRoll(item.id, null, RollStatus.SHIPPED);
  await expectCode("§4b stok dışı top → ROLL_NOT_ATTACHABLE", "ROLL_NOT_ATTACHABLE", () =>
    svc.quickStart({ ownGoods: true, steps, rollBarcodes: [rs.barcode] }));
  const r4 = await makeRoll(item.id, null);
  await expectCode("§4c hedef kumaştan farklı top → ROLL_ITEM_MISMATCH", "ROLL_ITEM_MISMATCH", () =>
    svc.quickStart({ ownGoods: true, steps, targetItemId: item2.id, rollBarcodes: [r4.barcode] }));
  const r5 = await makeRoll(item2.id, null);
  await expectCode("§4d iki kumaşlı toplar → ROLLS_MIXED_ITEM", "ROLLS_MIXED_ITEM", () =>
    svc.quickStart({ ownGoods: true, steps, rollBarcodes: [r4.barcode, r5.barcode] }));

  // §5 tür
  await expectCode("§5a ownGoods + Fason türü → 400 WO_OWN_GOODS_TYPE (topsuz)", "WO_OWN_GOODS_TYPE", () =>
    svc.quickStart({ ownGoods: true, type: "CUSTOMER_GOODS_SERVICE", customerId: cust.id, steps, targetItemId: item.id, rollBarcodes: [] }));
  await expectCode("§5b ownGoods + Fason türü → 400 WO_OWN_GOODS_TYPE (toplu)", "WO_OWN_GOODS_TYPE", () =>
    svc.quickStart({ ownGoods: true, type: "CUSTOMER_GOODS_SERVICE", customerId: cust.id, steps, rollBarcodes: [r4.barcode] }));
  const order = await prisma.order.create({
    data: { orderNumber: `TOWN-ORD-${uniq}`, customerId: cust.id, lines: { create: [{ itemId: item.id, colorId: null, quantity: 100, width: 150 }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  orderIds.push(order.id);
  const t5 = track(await svc.quickStart({ ownGoods: true, steps, targetItemId: item.id, orderLineIds: [order.lines[0]!.id], rollBarcodes: [] }));
  check("§5c topsuz + sipariş kalemi → tür ORDER (bugünkü türetme)", t5.data?.workOrder.type === "ORDER_PRODUCTION", `type=${t5.data?.workOrder.type}`);

  // §6 idempotency (hedefsiz topsuz: kumaşı sunucu yazabilir; yoksa 400 → o durumda kumaşlı sınanır)
  const token = randomUUID();
  const body = { ownGoods: true, steps, targetItemId: item.id, rollBarcodes: [] as string[], clientToken: token };
  const i1 = track(await svc.quickStart(body));
  const i2 = await svc.quickStart(body);
  check("§6a aynı token replay aynı İE'yi döner", !!i1.data && i1.data.workOrder.id === i2.data?.workOrder.id);
  const n = await prisma.workOrder.count({ where: { clientToken: token } });
  check("§6b tek İE satırı", n === 1, `n=${n}`);

  // §7 HTTP şeması
  check("§7a şema: boş liste + bayraksız reddedilir", !quickStartSchemaForTest.safeParse({ steps, rollBarcodes: [] }).success);
  check("§7b şema: boş liste + ownGoods geçer", quickStartSchemaForTest.safeParse({ steps, rollBarcodes: [], ownGoods: true }).success);
  check("§7c şema: ownGoods anahtarı korunur (sessiz silinmez)", quickStartSchemaForTest.safeParse({ steps, rollBarcodes: ["X"], ownGoods: true }).data?.ownGoods === true);

}

async function cleanup() {
  if (rollIds.length) {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => undefined);
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, batchId: null } }).catch(() => undefined);
  }
  for (const id of woIds) {
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }).catch(() => undefined);
    await prisma.travelerCard.deleteMany({ where: { workOrderId: id } }).catch(() => undefined);
    await prisma.batch.deleteMany({ where: { workOrderId: id } }).catch(() => undefined);
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: id } }).catch(() => undefined);
    await prisma.workOrderEvent.deleteMany({ where: { workOrderId: id } }).catch(() => undefined);
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }).catch(() => undefined);
    await prisma.workOrder.delete({ where: { id } }).catch((e) => console.error("İE temizliği:", (e as Error).message.slice(0, 120)));
  }
  if (rollIds.length) await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch((e) => console.error("top temizliği:", (e as Error).message.slice(0, 160)));
  for (const id of orderIds) await prisma.order.delete({ where: { id } }).catch(() => undefined);
  for (const id of itemIds) await prisma.item.delete({ where: { id } }).catch((e) => console.error("kumaş temizliği:", (e as Error).message.slice(0, 120)));
  if (stationIds.length) await prisma.station.deleteMany({ where: { id: { in: stationIds } } }).catch((e) => console.error("istasyon temizliği:", (e as Error).message.slice(0, 120)));
  for (const id of customerIds) await prisma.customer.delete({ where: { id } }).catch((e) => console.error("müşteri temizliği:", (e as Error).message.slice(0, 120)));
}

main()
  .catch((e) => { console.error("TEST HATASI:", e); fail++; })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Temizlik hatası:", e));
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
