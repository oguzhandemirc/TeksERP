// =============================================================================
// FASON (MÜŞTERİ MALI) İŞ EMRİ — `CUSTOMER_GOODS_SERVICE` (2026-11-06)
//   §1 elle create: müşteri zorunlu (400 WO_CUSTOMER_REQUIRED) · müşteriyle doğar, sipariş istemez, customerId yazılır
//   §2 sipariş kalemi 400 WO_CUSTOMER_GOODS_NO_ORDER (create · Sipariş Bağla)
//   §3 quickStart: müşteri topların tek sahibinden (gelen belge yolu) · gövde ≠ sahip 400 · çok sahip 400 · sahipsiz+gövdesiz 400
//   §4 gelen belge formu: `formWorkOrderFields` belge carisini müşteri olarak geçirir (yalnız Fason türünde)
//   §5 liste: tür süzgeci (tek where; tanınmayan 400) · müşteri = İE'nin kendisi · filter[customerId] kendi müşteriden süzer
//   §6 eski türler değişmedi: stok quickStart STOCK + customerId NULL · tür Fason'a çevrilemez (replace 400)
//   §7 DB CHECK: Fason türünde müşterisiz satır yazılamaz
// Yetki: yeni uç/izin YOK — oluşturma mevcut `workorder:write` / `mobile:hizli-is-emri` kapılarından geçer.
// Koşum: npx tsx scripts/test_workorder_customer_goods.ts
// =============================================================================
import type { Request } from "express";
import { RollEntrySource, RollStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { workOrderLinkService } from "../src/services/workorder-link.service";
import { formWorkOrderFields } from "../src/services/gelen-belge-form-is-emri.service";
import { parseQueryParams } from "../src/utils/query-parser";

const svc = new WorkOrderService();
const uniq = `${Date.now()}`;
const rollIds: string[] = [];
const woIds: string[] = [];
const customerIds: string[] = [];
const itemIds: string[] = [];
const orderIds: string[] = [];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

function errCode(e: unknown): string | undefined {
  return (e as { details?: { code?: string } })?.details?.code;
}

async function expectCode(label: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "hata atılmadı");
  } catch (e) {
    check(label, errCode(e) === code, `code=${errCode(e)} ${(e as Error).message?.slice(0, 80)}`);
  }
}

async function makeRoll(itemId: string, owner: string | null) {
  const r = await prisma.roll.create({
    data: {
      barcode: `TEST-CGS-${uniq}-${Math.floor(Math.random() * 1e7)}`,
      itemId, colorId: null, width: 150, initialQty: 50, currentQty: 50,
      status: RollStatus.STOCK, entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      ownerCustomerId: owner,
    },
    select: { id: true, barcode: true },
  });
  rollIds.push(r.id);
  return { id: r.id, barcode: r.barcode as string };
}

async function makeCustomer(tag: string) {
  const c = await prisma.customer.create({ data: { code: `TCGS${tag}${uniq.slice(-6)}`, name: `TEST-CGS ${tag} ${uniq}`, isCustomerRole: true }, select: { id: true, name: true } });
  customerIds.push(c.id);
  return c;
}

function listReq(query: Record<string, string>): Request {
  return { query, user: undefined } as unknown as Request;
}

async function main() {
  console.log("=== Fason (müşteri malı) iş emri ===\n");
  // Kumaş fikstürü iş anahtarıyla kurulur (ortamdaki kayda yaslanılmaz).
  const item = await prisma.item.create({ data: { code: `TST-CGS-I-${uniq}`, name: `TEST-CGS KUMAS ${uniq}`, itemType: "FABRIC" }, select: { id: true } });
  itemIds.push(item.id);
  const station = await prisma.station.findFirst({ where: { allowAsWorkOrderStep: true }, select: { id: true } });
  if (!station) throw new Error("Test verisi yetersiz (npm run seed:fixtures).");
  const steps = [{ stationId: station.id, notes: null }];
  const custA = await makeCustomer("A");
  const custB = await makeCustomer("B");

  // §1 elle create
  await expectCode("§1a müşterisiz Fason create → 400 WO_CUSTOMER_REQUIRED", "WO_CUSTOMER_REQUIRED", () =>
    svc.create({ type: "CUSTOMER_GOODS_SERVICE", steps, targetItemId: item.id }));
  const c1 = await svc.create({ type: "CUSTOMER_GOODS_SERVICE", steps, targetItemId: item.id, customerId: custA.id });
  if (c1.data) woIds.push(c1.data.id);
  check("§1b müşteriyle Fason create: tür korunur", c1.data?.type === "CUSTOMER_GOODS_SERVICE", `type=${c1.data?.type}`);
  check("§1c customerId İE'ye yazıldı", c1.data?.customerId === custA.id);
  const stockWo = await svc.create({ type: "STOCK_PRODUCTION", steps, targetItemId: item.id, customerId: custA.id });
  if (stockWo.data) woIds.push(stockWo.data.id);
  check("§1d Stok türünde gövdedeki customerId YAZILMAZ", stockWo.data?.customerId === null);

  // §2 sipariş kalemi
  const order = await prisma.order.create({
    data: { orderNumber: `TCGS-ORD-${uniq}`, customerId: custA.id, lines: { create: [{ itemId: item.id, colorId: null, quantity: 100, width: 150 }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  orderIds.push(order.id);
  const lineId = order.lines[0]!.id;
  await expectCode("§2a Fason create + sipariş kalemi → 400 WO_CUSTOMER_GOODS_NO_ORDER", "WO_CUSTOMER_GOODS_NO_ORDER", () =>
    svc.create({ type: "CUSTOMER_GOODS_SERVICE", steps, targetItemId: item.id, customerId: custA.id, orderLineIds: [lineId] }));
  await expectCode("§2b Fason İE'ye Sipariş Bağla → 400 WO_CUSTOMER_GOODS_NO_ORDER", "WO_CUSTOMER_GOODS_NO_ORDER", () =>
    workOrderLinkService.linkOrderLines(c1.data!.id, [lineId]));

  // §3 quickStart (gelen belge yolu: toplar belge carisinin malı)
  const rA1 = await makeRoll(item.id, custA.id);
  const rA2 = await makeRoll(item.id, custA.id);
  const q1 = await svc.quickStart({ type: "CUSTOMER_GOODS_SERVICE", steps, rollBarcodes: [rA1.barcode, rA2.barcode] });
  if (q1.data?.workOrder) woIds.push(q1.data.workOrder.id);
  check("§3a quickStart Fason: müşteri topların sahibinden", q1.data?.workOrder.customerId === custA.id && q1.data?.workOrder.type === "CUSTOMER_GOODS_SERVICE", `customerId=${q1.data?.workOrder.customerId}`);
  check("§3b quickStart Fason: toplar bağlandı", q1.data?.attached === 2);
  const rA3 = await makeRoll(item.id, custA.id);
  await expectCode("§3c gövde müşterisi ≠ top sahibi → 400 WO_CUSTOMER_OWNER_MISMATCH", "WO_CUSTOMER_OWNER_MISMATCH", () =>
    svc.quickStart({ type: "CUSTOMER_GOODS_SERVICE", customerId: custB.id, steps, rollBarcodes: [rA3.barcode] }));
  const rB1 = await makeRoll(item.id, custB.id);
  await expectCode("§3d iki sahipli toplar → 400 WO_CUSTOMER_AMBIGUOUS", "WO_CUSTOMER_AMBIGUOUS", () =>
    svc.quickStart({ type: "CUSTOMER_GOODS_SERVICE", steps, rollBarcodes: [rA3.barcode, rB1.barcode] }));
  const rN1 = await makeRoll(item.id, null);
  await expectCode("§3e sahipsiz top + müşterisiz → 400 WO_CUSTOMER_REQUIRED", "WO_CUSTOMER_REQUIRED", () =>
    svc.quickStart({ type: "CUSTOMER_GOODS_SERVICE", steps, rollBarcodes: [rN1.barcode] }));
  const q2 = await svc.quickStart({ type: "CUSTOMER_GOODS_SERVICE", customerId: custB.id, steps, rollBarcodes: [rN1.barcode] });
  if (q2.data?.workOrder) woIds.push(q2.data.workOrder.id);
  check("§3f sahipsiz top + seçilen müşteri → açılır (operatör seçimi)", q2.data?.workOrder.customerId === custB.id);

  // §4 gelen belge formu alanları
  const base = { clientToken: "00000000-0000-4000-8000-000000000000", ownerCustomerId: custA.id, kursunMeters: 10 } as Parameters<typeof formWorkOrderFields>[0];
  check("§4a form Fason türünde customerId = belge carisi", formWorkOrderFields({ ...base, type: "CUSTOMER_GOODS_SERVICE" }).customerId === custA.id);
  check("§4b form Stok/varsayılan türde customerId GEÇMEZ", formWorkOrderFields({ ...base }).customerId === undefined && formWorkOrderFields({ ...base, type: "STOCK_PRODUCTION" }).customerId === undefined);

  // §5 liste: tür süzgeci + müşteri
  const r1 = listReq({ "filter[type]": "CUSTOMER_GOODS_SERVICE", "filter[customerId]": custA.id, limit: "50", cursor: "" });
  const list = await svc.findAll(r1) as { data?: Array<{ id: string; type: string; customers?: Array<{ id: string }> }> };
  const rows = list.data ?? [];
  check("§5a tür + müşteri süzgeci: yalnız Fason satırları", rows.length >= 2 && rows.every((w) => w.type === "CUSTOMER_GOODS_SERVICE"), `n=${rows.length}`);
  check("§5b süzgeç kendi müşteriden: c1 + q1 listede", [c1.data!.id, q1.data!.workOrder.id].every((id) => rows.some((w) => w.id === id)));
  check("§5c satır müşterisi = İE'nin kendi müşterisi", rows.some((w) => w.id === c1.data!.id && w.customers?.[0]?.id === custA.id));
  const csv = await svc.findAll(listReq({ "filter[type]": "STOCK_PRODUCTION,ORDER_PRODUCTION", limit: "200", cursor: "" })) as { data?: Array<{ type: string }> };
  check("§5d CSV tür süzgeci Fason'u dışlar", (csv.data ?? []).every((w) => w.type !== "CUSTOMER_GOODS_SERVICE"));
  await expectCode("§5e tanınmayan tür → 400 INVALID_FILTER", "INVALID_FILTER", () => svc.buildListWhere(listReq({ "filter[type]": "NOPE" }), parseQueryParams(listReq({ "filter[type]": "NOPE" }))));

  // §6 eski türler
  const rS = await makeRoll(item.id, custA.id);
  const qs = await svc.quickStart({ steps, rollBarcodes: [rS.barcode] });
  if (qs.data?.workOrder) woIds.push(qs.data.workOrder.id);
  check("§6a türsüz quickStart bugünkü gibi STOCK, müşteri yazılmaz", qs.data?.workOrder.type === "STOCK_PRODUCTION" && qs.data?.workOrder.customerId === null);
  await expectCode("§6b replace ile Stok → Fason 400 WO_CUSTOMER_GOODS_TYPE_FROZEN", "WO_CUSTOMER_GOODS_TYPE_FROZEN", () =>
    svc.replace(stockWo.data!.id, { type: "CUSTOMER_GOODS_SERVICE", steps, targetItemId: item.id } as Parameters<WorkOrderService["replace"]>[1]));

  // §7 DB seddi
  let dbBlocked = false;
  try {
    await prisma.workOrder.update({ where: { id: c1.data!.id }, data: { customerId: null } });
  } catch { dbBlocked = true; }
  check("§7 DB CHECK: Fason türünde müşteri NULL yazılamaz", dbBlocked);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup() {
  if (rollIds.length) {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => undefined);
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch((e) => console.error("roll temizliği:", (e as Error).message));
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
  for (const id of orderIds) await prisma.order.delete({ where: { id } }).catch(() => undefined);
  for (const id of itemIds) await prisma.item.delete({ where: { id } }).catch((e) => console.error("kumaş temizliği:", (e as Error).message.slice(0, 120)));
  for (const id of customerIds) await prisma.customer.delete({ where: { id } }).catch((e) => console.error("müşteri temizliği:", (e as Error).message.slice(0, 120)));
}

main()
  .catch((e) => { console.error("TEST HATASI:", e); fail++; })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Temizlik hatası:", e));
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  });
