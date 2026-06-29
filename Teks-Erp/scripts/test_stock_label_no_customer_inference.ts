// Etiket müşteri çözümü — EXPLICIT-ONLY sözleşmesi testi.
// Çalıştırma:  npx tsx scripts/test_stock_label_no_customer_inference.ts
// Test verisi üzerinde çalışır; ürettiği kayıtları sonunda temizler.
//
// Saha bug'ı: "Tamburdan stok etiketi ile çıkarırken HEP siparişteki müşteriyi
// basıyor." Kök neden: getRollLabel'de açık bağlam + snapshot yokken WO'nun
// tek-müşterisini TAHMİN eden "geri uyum" dalı (branch ②). Bu dal kaldırıldı.
//
// Doğrulananlar (roll'un WO'su TEK müşteriye bağlı — eski kod burada müşteri
// SIZDIRIRDI):
//   1. Bağlam yok + snapshot yok → müşteri NULL (STOK). WO'dan TAHMİN YOK.  ← regresyon
//   2. Explicit { orderLineId } → o siparişin müşterisi basılır (explicit çalışır).
//   3. Explicit { stock:true } → müşteri NULL (zorla stok).
//   4. snapshot.customerId → no-opts'ta o müşteri basılır (snapshot dalı korunur).
//   5. snapshot.stock=true → no-opts'ta müşteri NULL (stok snapshot korunur).

import { RollStatus, RollEntrySource, Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { LabelService } from "../src/services/label.service";

const labels = new LabelService();
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Temizlik kuyrukları (FK sırasına göre silinir).
const rollIds: string[] = [];
let workOrderId: string | null = null;
let stepId: string | null = null;
let orderId: string | null = null;
let orderLineId: string | null = null;
let customerId: string | null = null;

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

async function main() {
  console.log("=== Etiket EXPLICIT-ONLY müşteri çözümü testi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const station = await prisma.station.findFirst({ select: { id: true } });
  if (!item || !station) {
    throw new Error("Test verisi yetersiz — aktif Item / Station yok (önce npm run seed).");
  }

  // TEST müşterisi (adı kesin bilinsin → "tahmin edilirdi" karşılaştırması net).
  const customer = await prisma.customer.create({
    data: { code: `TEST-CUST-${stamp}`, name: `TEST Müşteri ${stamp}` },
    select: { id: true, name: true },
  });
  customerId = customer.id;

  // Sipariş + tek satır (bu müşteriye).
  const order = await prisma.order.create({
    data: { orderNumber: `TEST-ORD-${stamp}`, customerId: customer.id },
    select: { id: true, orderNumber: true },
  });
  orderId = order.id;
  const line = await prisma.orderLine.create({
    data: { orderId: order.id, itemId: item.id, quantity: new Prisma.Decimal(100) },
    select: { id: true },
  });
  orderLineId = line.id;

  // İş emri + tek adım + WO↔satır bağı (TEK müşteri → eski branch ② tetiklerdi).
  const wo = await prisma.workOrder.create({
    data: { batchNumber: `TEST-WO-${stamp}` },
    select: { id: true },
  });
  workOrderId = wo.id;
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
    select: { id: true },
  });
  stepId = step.id;
  await prisma.workOrderToOrderLine.create({
    data: { workOrderId: wo.id, orderLineId: line.id },
  });

  // Tambur çıktısı top — bu adımda üretildi, üstünde HİÇ etiket yok (snapshot null).
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-STOCKLBL-${stamp}`,
      itemId: item.id,
      colorId: null,
      width: 150,
      initialQty: 50,
      currentQty: 50,
      status: RollStatus.WAREHOUSE,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.TAMBUR_SPLIT,
      producedInStepId: step.id,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);

  // --- 1. REGRESYON: bağlam yok + snapshot yok → müşteri NULL (WO'dan tahmin yok) ---
  const stockDefault = await labels.getRollLabel(roll.id);
  check(
    "Bağlamsız + snapshot'sız top → müşteri NULL (WO tahmini yok)",
    stockDefault.data.customerName === null && stockDefault.data.customerId === null,
    `customerName=${JSON.stringify(stockDefault.data.customerName)}`,
  );

  // --- 2. Explicit { orderLineId } → o siparişin müşterisi basılır ---
  const explicitLine = await labels.getRollLabel(roll.id, { orderLineId: line.id });
  check(
    "Explicit orderLineId → müşteri basılır (explicit çalışır)",
    explicitLine.data.customerName === customer.name &&
      explicitLine.data.orderNumber === order.orderNumber,
    `customerName=${JSON.stringify(explicitLine.data.customerName)}`,
  );

  // --- 3. Explicit { stock:true } → müşteri NULL ---
  const forced = await labels.getRollLabel(roll.id, { orderLineId: line.id, stock: true });
  check(
    "Explicit stock:true → müşteri NULL (zorla stok, orderLineId'i bile ezer)",
    forced.data.customerName === null && forced.data.customerId === null,
    `customerName=${JSON.stringify(forced.data.customerName)}`,
  );

  // --- 4. snapshot.customerId → no-opts'ta o müşteri (snapshot dalı korunur) ---
  await prisma.roll.update({
    where: { id: roll.id },
    data: { lastLabelSnapshot: { customerId: customer.id } as Prisma.InputJsonValue },
  });
  const fromSnapCust = await labels.getRollLabel(roll.id);
  check(
    "snapshot.customerId → no-opts müşteri basılır (snapshot dalı korunur)",
    fromSnapCust.data.customerName === customer.name,
    `customerName=${JSON.stringify(fromSnapCust.data.customerName)}`,
  );

  // --- 5. snapshot.stock=true → no-opts'ta müşteri NULL ---
  await prisma.roll.update({
    where: { id: roll.id },
    data: { lastLabelSnapshot: { stock: true } as Prisma.InputJsonValue },
  });
  const fromSnapStock = await labels.getRollLabel(roll.id);
  check(
    "snapshot.stock=true → no-opts müşteri NULL (stok snapshot korunur)",
    fromSnapStock.data.customerName === null && fromSnapStock.data.customerId === null,
    `customerName=${JSON.stringify(fromSnapStock.data.customerName)}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  if (rollIds.length) {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  }
  if (workOrderId && orderLineId) {
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId } });
  }
  if (stepId) await prisma.workOrderStep.deleteMany({ where: { id: stepId } });
  if (workOrderId) await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
  if (orderLineId) await prisma.orderLine.deleteMany({ where: { id: orderLineId } });
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
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
