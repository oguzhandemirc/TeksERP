// Tambur kesimi etiket NİYETİNİ child'ın lastLabelSnapshot'ına seed ediyor mu?
// Çalıştırma:  npx tsx scripts/test_roll_label_cut_seed_snapshot.ts
// Test verisi üzerinde çalışır; ürettiği kayıtları sonunda temizler.
//
// Sektör-standardı sözleşme: müşteri/stok niyeti kesim KARARI anında server-side
// kalıcı olur — yazıcı/ekran bağımsız. (markedForKartela gibi.) Doğrulananlar:
//   1. cutWarehouseRoll + targetCustomerId → child snapshot {customerId}; no-opts
//      getRollLabel o müşteriyi basar.
//   2. + targetOrderLineId → {orderLineId}; no-opts müşteri + sipariş no.
//   3. hedef yok → {stock:true}; no-opts müşterisiz.
//   4. ham STOCK parent + rawDestination=STOCK + targetCustomerId → child STOCK,
//      niyet BASTIRILIR → {stock:true} (üretime devam topu müşterisiz).
//   5. ham STOCK parent + rawDestination=WAREHOUSE + targetCustomerId → WAREHOUSE
//      child, niyet UYGULANIR → {customerId}.
//   6. geçersiz targetOrderLineId → 400; pasif targetCustomerId → 400.

import { RollStatus, RollEntrySource, Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { LabelService } from "../src/services/label.service";

const tambur = new TamburService();
const labels = new LabelService();
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const parentIds: string[] = [];
let customerId: string | null = null;
let inactiveCustomerId: string | null = null;
let orderId: string | null = null;
let orderLineId: string | null = null;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function snapOf(rollId: string): Promise<Record<string, unknown> | null> {
  const r = await prisma.roll.findUnique({ where: { id: rollId }, select: { lastLabelSnapshot: true } });
  return (r?.lastLabelSnapshot ?? null) as Record<string, unknown> | null;
}

async function makeParent(status: RollStatus, colorId: string | null, qty: number) {
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok (npm run seed).");
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-PARENT-${stamp}-${parentIds.length}`,
      itemId: item.id,
      colorId,
      width: 150,
      initialQty: qty,
      currentQty: qty,
      status,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true, itemId: true },
  });
  parentIds.push(roll.id);
  return roll;
}

async function main() {
  console.log("=== Tambur kesim etiket-niyeti seed testi ===\n");

  const customer = await prisma.customer.create({
    data: { code: `TEST-CUST-${stamp}`, name: `TEST Müşteri ${stamp}` },
    select: { id: true, name: true },
  });
  customerId = customer.id;
  const inactive = await prisma.customer.create({
    data: { code: `TEST-INACT-${stamp}`, name: `TEST Pasif ${stamp}`, isActive: false },
    select: { id: true },
  });
  inactiveCustomerId = inactive.id;

  const wh = await makeParent(RollStatus.WAREHOUSE, null, 1000);
  const order = await prisma.order.create({
    data: { orderNumber: `TEST-ORD-${stamp}`, customerId: customer.id },
    select: { id: true, orderNumber: true },
  });
  orderId = order.id;
  const line = await prisma.orderLine.create({
    data: { orderId: order.id, itemId: wh.itemId, quantity: new Prisma.Decimal(100) },
    select: { id: true },
  });
  orderLineId = line.id;

  // --- 1. targetCustomerId → {customerId} ---
  const c1 = await tambur.cutWarehouseRoll(wh.id, { cutLength: 10, targetCustomerId: customer.id });
  const s1 = await snapOf(c1.data.childRoll.id);
  check("1a WAREHOUSE+targetCustomerId → snapshot {customerId}", s1?.customerId === customer.id, JSON.stringify(s1));
  const l1 = await labels.getRollLabel(c1.data.childRoll.id);
  check("1b no-opts getRollLabel müşteriyi basar", l1.data.customerName === customer.name, `${l1.data.customerName}`);

  // --- 2. targetOrderLineId → {orderLineId} ---
  const c2 = await tambur.cutWarehouseRoll(wh.id, { cutLength: 10, targetOrderLineId: line.id });
  const s2 = await snapOf(c2.data.childRoll.id);
  check("2a WAREHOUSE+targetOrderLineId → snapshot {orderLineId}", s2?.orderLineId === line.id, JSON.stringify(s2));
  const l2 = await labels.getRollLabel(c2.data.childRoll.id);
  check("2b no-opts müşteri + sipariş no", l2.data.customerName === customer.name && l2.data.orderNumber === order.orderNumber, `${l2.data.customerName}/${l2.data.orderNumber}`);

  // --- 3. hedef yok → {stock:true} ---
  const c3 = await tambur.cutWarehouseRoll(wh.id, { cutLength: 10 });
  const s3 = await snapOf(c3.data.childRoll.id);
  check("3a hedefsiz → snapshot {stock:true}", s3?.stock === true && s3?.customerId === undefined, JSON.stringify(s3));
  const l3 = await labels.getRollLabel(c3.data.childRoll.id);
  check("3b no-opts müşterisiz", l3.data.customerName === null && l3.data.customerId === null);

  // --- 4. ham STOCK parent + rawDestination=STOCK + müşteri → niyet bastırılır ---
  const raw = await makeParent(RollStatus.STOCK, null, 200);
  const c4 = await tambur.cutWarehouseRoll(raw.id, { cutLength: 10, rawDestination: "STOCK", targetCustomerId: customer.id });
  const s4 = await snapOf(c4.data.childRoll.id);
  check("4a raw→STOCK child statü STOCK", c4.data.childRoll.status === RollStatus.STOCK, c4.data.childRoll.status);
  check("4b raw→STOCK niyet BASTIRILDI → {stock:true}", s4?.stock === true && s4?.customerId === undefined, JSON.stringify(s4));

  // --- 5. ham STOCK parent + rawDestination=WAREHOUSE + müşteri → niyet uygulanır ---
  const c5 = await tambur.cutWarehouseRoll(raw.id, { cutLength: 10, rawDestination: "WAREHOUSE", targetCustomerId: customer.id });
  const s5 = await snapOf(c5.data.childRoll.id);
  check("5a raw→WAREHOUSE child statü WAREHOUSE", c5.data.childRoll.status === RollStatus.WAREHOUSE, c5.data.childRoll.status);
  check("5b raw→WAREHOUSE niyet UYGULANDI → {customerId}", s5?.customerId === customer.id, JSON.stringify(s5));

  // --- 6. geçersiz / pasif hedef → 400 ---
  let badLine = false;
  try {
    await tambur.cutWarehouseRoll(wh.id, { cutLength: 10, targetOrderLineId: "00000000-0000-0000-0000-000000000000" });
  } catch {
    badLine = true;
  }
  check("6a geçersiz targetOrderLineId reddedildi", badLine);
  let pasif = false;
  try {
    await tambur.cutWarehouseRoll(wh.id, { cutLength: 10, targetCustomerId: inactive.id });
  } catch {
    pasif = true;
  }
  check("6b pasif targetCustomerId reddedildi", pasif);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  const childIds = (
    await prisma.roll.findMany({ where: { parentRollId: { in: parentIds } }, select: { id: true } })
  ).map((r) => r.id);
  const allRollIds = [...parentIds, ...childIds];
  if (allRollIds.length) {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: allRollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: childIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: parentIds } } });
  }
  if (orderLineId) await prisma.orderLine.deleteMany({ where: { id: orderLineId } });
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
  if (inactiveCustomerId) await prisma.customer.deleteMany({ where: { id: inactiveCustomerId } });
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Cleanup hatası:", e));
    await prisma.$disconnect();
  });
