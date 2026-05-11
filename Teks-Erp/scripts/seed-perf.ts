// =============================================================================
// TeksERP — Performans Seed Scripti
// =============================================================================
// Hedef: gerçek hacmi simüle etmek (5000 sipariş + bağlı veriler).
//
// Kullanım:
//   npx ts-node scripts/seed-perf.ts
//
// Notlar:
//   - Mevcut müşteri/item/station/qualityGrade verisini kullanır; SİLMEZ.
//   - Yeni kayıtlara "PERF-" prefix'i koyar — ayırt edilebilir, gerekirse
//     elle silinebilir (DELETE FROM ... WHERE code LIKE 'PERF-%').
//   - AuditService.log çağrılmaz (her CUD için audit yazmak 5000+ kaydı 10x
//     yavaşlatır). Bu test verisi; gerçek kullanıcı eylemi değil.
//   - createMany ile bulk insert. Batch size 1000 — DB connection limit dostu.
// =============================================================================

import { PrismaClient, RollStatus, OrderStatus, ShipmentStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { faker } from "@faker-js/faker/locale/tr";
import { randomUUID } from "crypto";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL gerekli");
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Hedefler — yıllık iş hacmine yakın gerçekçi simülasyon ─────────────────
// Toplam ~600k satır; pagination/index/raporlama testleri için yeterli.
const TARGET = {
  customers: 200, // PERF prefix'li ek müşteriler
  branchesPerCustomer: 4, // 200 × 4 = 800 şube
  orders: 50000,
  workOrders: 30000,
  stepsPerWorkOrder: 4, // ~120k WorkOrderStep
  rolls: 30000, // Status'a göre dağılır
  movementsPerRoll: 2, // ~60k RollMovement
  operationsPerRoll: 2, // ~60k RollOperation
  sacks: 20000,
  shipments: 30000, // %30 PREPARING, %70 SHIPPED
  itemsPerShipment: 4,
  travelerCards: 20000,
  scansPerCard: 2, // ~40k TravelerCardScan
  packagingQueueWaiting: 500, // canlı kuyrukta bekleyen
};

const BATCH = 1000;
faker.seed(42); // tekrarlanabilir veri

// ── Yardımcılar ─────────────────────────────────────────────────────────────
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function maybe<T>(value: T, ratio: number): T | null {
  return Math.random() < ratio ? value : null;
}
function rollStatusBucket(): RollStatus {
  const r = Math.random();
  if (r < 0.25) return RollStatus.WAREHOUSE;
  if (r < 0.45) return RollStatus.PRODUCED;
  if (r < 0.6) return RollStatus.IN_PRODUCTION;
  if (r < 0.7) return RollStatus.READY_FOR_SHIP;
  if (r < 0.85) return RollStatus.SHIPPED;
  if (r < 0.92) return RollStatus.A1_STOCK;
  if (r < 0.97) return RollStatus.STOCK;
  return RollStatus.SCRAP;
}

async function chunkInsert<T>(
  items: T[],
  insertFn: (chunk: T[]) => Promise<unknown>,
  label: string
): Promise<void> {
  if (items.length === 0) return;
  let done = 0;
  const start = Date.now();
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    await insertFn(chunk);
    done += chunk.length;
    process.stdout.write(`\r  ${label}: ${done}/${items.length}`);
  }
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  process.stdout.write(`\r  ${label}: ${done}/${items.length}  (${sec}s)\n`);
}

async function main() {
  const t0 = Date.now();
  console.log("─".repeat(60));
  console.log("Performans seed başlıyor — hedef:", TARGET);
  console.log("─".repeat(60));

  // ── Mevcut referanslar (PERF olmayan, mevcut sistem verisi) ────────────
  const [users, items, qualityGrades, stations] = await Promise.all([
    prisma.user.findMany({ select: { id: true, username: true } }),
    prisma.item.findMany({
      where: { isActive: true },
      include: { variants: { where: { isActive: true }, select: { id: true, code: true } } },
    }),
    prisma.qualityGrade.findMany({ where: { isActive: true }, select: { code: true } }),
    prisma.station.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
  ]);

  if (users.length === 0) throw new Error("En az bir kullanıcı (admin) gerekli");
  if (items.length === 0) throw new Error("En az bir aktif item gerekli");

  const adminUser = users.find((u) => u.username === "admin") ?? users[0];
  const grades = qualityGrades.length > 0 ? qualityGrades.map((g) => g.code) : ["1.KALITE"];

  console.log(
    `Mevcut: ${items.length} item, ${users.length} kullanıcı, ${stations.length} istasyon`
  );

  // ── 0) Önceki PERF kayıtlarını temizle (idempotent çalıştırma) ─────────
  // Strateji: PERF müşteri ID'lerini yakala, ona bağlı TÜM child kayıtları
  // sil (prefix bağımsız). Daha sonra bağımsız PERF prefix'li eski kayıtlar
  // için fallback temizlik. Bu yaklaşım eski seed kalıntılarına da dayanıklı.
  console.log("\n[0] Önceki PERF verisi temizleniyor...");
  const perfCustomers = await prisma.customer.findMany({
    where: { code: { startsWith: "PERF-MUS-" } },
    select: { id: true },
  });
  const perfCustomerIds = perfCustomers.map((c) => c.id);

  if (perfCustomerIds.length > 0) {
    // PERF müşterilerin tüm sevkiyatlarına bağlı item'lar
    await prisma.shipmentItem.deleteMany({
      where: { shipment: { customerId: { in: perfCustomerIds } } },
    });
    await prisma.shipment.deleteMany({
      where: { customerId: { in: perfCustomerIds } },
    });
    // PERF müşterilerin çuvalları → önce o çuvallara bağlı roll.sackId temizle
    await prisma.roll.updateMany({
      where: { sack: { customerId: { in: perfCustomerIds } } },
      data: { sackId: null },
    });
    await prisma.sack.deleteMany({
      where: { customerId: { in: perfCustomerIds } },
    });
    // PERF müşterilere bağlı sipariş satırlarındaki allocation
    await prisma.orderAllocation.deleteMany({
      where: { orderLine: { order: { customerId: { in: perfCustomerIds } } } },
    });
    // PERF müşterilere bağlı orderlar (cascade ile orderLines + packagingQueue + planlanan)
    await prisma.packagingQueue.deleteMany({
      where: { order: { customerId: { in: perfCustomerIds } } },
    });
    await prisma.shipmentPlannedOrder.deleteMany({
      where: { order: { customerId: { in: perfCustomerIds } } },
    });
    await prisma.order.deleteMany({
      where: { customerId: { in: perfCustomerIds } },
    });
    // PERF müşterilere bağlı şubeler (cascade)
    await prisma.customerBranch.deleteMany({
      where: { customerId: { in: perfCustomerIds } },
    });
  }

  // PERF prefix'li bağımsız kayıtlar (müşterilere bağlı olmayan veya kalıntı):
  // Roll → bağımlı tabloları önce
  await prisma.orderAllocation.deleteMany({
    where: { roll: { barcode: { startsWith: "PERF-ROL-" } } },
  });
  await prisma.rollOperation.deleteMany({
    where: { roll: { barcode: { startsWith: "PERF-ROL-" } } },
  });
  await prisma.rollMovement.deleteMany({
    where: { roll: { barcode: { startsWith: "PERF-ROL-" } } },
  });
  await prisma.shipmentItem.deleteMany({
    where: { roll: { barcode: { startsWith: "PERF-ROL-" } } },
  });
  await prisma.roll.updateMany({
    where: { barcode: { startsWith: "PERF-ROL-" }, sackId: { not: null } },
    data: { sackId: null },
  });
  await prisma.roll.deleteMany({
    where: { barcode: { startsWith: "PERF-ROL-" } },
  });
  // PERF traveler cards
  await prisma.travelerCardScan.deleteMany({
    where: { card: { cardNumber: { startsWith: "PERF-RFK-" } } },
  });
  await prisma.travelerCard.deleteMany({
    where: { cardNumber: { startsWith: "PERF-RFK-" } },
  });
  // PERF WO
  await prisma.workOrderStep.deleteMany({
    where: { workOrder: { batchNumber: { startsWith: "PERF-WO-" } } },
  });
  await prisma.workOrderToOrderLine.deleteMany({
    where: { workOrder: { batchNumber: { startsWith: "PERF-WO-" } } },
  });
  await prisma.workOrder.deleteMany({
    where: { batchNumber: { startsWith: "PERF-WO-" } },
  });
  // PERF prefix'li ek shipment/sack kalıntısı (müşteriye bağlı değilse)
  await prisma.shipmentItem.deleteMany({
    where: { shipment: { shipmentNumber: { startsWith: "PERF-IRS-" } } },
  });
  await prisma.shipment.deleteMany({
    where: { shipmentNumber: { startsWith: "PERF-IRS-" } },
  });
  await prisma.sack.deleteMany({
    where: { sackNumber: { startsWith: "PERF-SCK-" } },
  });
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: "PERF-" } },
  });
  // En son PERF müşterileri
  await prisma.customer.deleteMany({
    where: { code: { startsWith: "PERF-MUS-" } },
  });
  console.log("  Temizlendi.");

  // Temizlemeden SONRA mevcut (gerçek) müşterileri al — silinmiş PERF
  // müşterilerinin ID'leri allCustomerIds'e karışmasın.
  const baseCustomers = await prisma.customer.findMany({
    where: { type: "CUSTOMER", isActive: true },
    select: { id: true, code: true },
  });
  console.log(`  Kalan gerçek müşteri: ${baseCustomers.length}`);

  // ── 1) Yeni Müşteriler ─────────────────────────────────────────────────
  console.log("\n[1] Müşteriler ekleniyor...");
  const newCustomerData = Array.from({ length: TARGET.customers }, (_, i) => {
    const id = randomUUID();
    return {
      id,
      code: `PERF-MUS-${String(i + 1).padStart(4, "0")}`,
      name: faker.company.name() + " Tekstil",
      taxNumber: faker.string.numeric(10),
      type: "CUSTOMER" as const,
      isActive: true,
    };
  });
  await chunkInsert(
    newCustomerData,
    (chunk) => prisma.customer.createMany({ data: chunk, skipDuplicates: true }),
    "Müşteri"
  );

  // Tüm müşteri ID'leri (eski + yeni)
  const allCustomerIds = [
    ...baseCustomers.map((c) => c.id),
    ...newCustomerData.map((c) => c.id),
  ];

  // ── 2) Şubeler ─────────────────────────────────────────────────────────
  console.log("[2] Şubeler ekleniyor...");
  const branchesData = newCustomerData.flatMap((c) =>
    Array.from({ length: TARGET.branchesPerCustomer }, (_, i) => ({
      id: randomUUID(),
      customerId: c.id,
      code: `${c.code}-S${i + 1}`,
      name: `${faker.location.city()} Şubesi`,
      address: faker.location.streetAddress(),
      city: faker.location.city(),
      district: faker.location.county(),
      contactName: faker.person.fullName(),
      contactPhone: faker.phone.number(),
      isActive: true,
    }))
  );
  await chunkInsert(
    branchesData,
    (chunk) => prisma.customerBranch.createMany({ data: chunk, skipDuplicates: true }),
    "Şube"
  );

  // ── 3) Sipariş başlıkları ──────────────────────────────────────────────
  console.log("[3] Siparişler ekleniyor...");
  const today = new Date();
  const orderData = Array.from({ length: TARGET.orders }, (_, i) => {
    const customerId = pickRandom(allCustomerIds);
    const orderDate = faker.date.recent({ days: 90 });
    const deadline = new Date(orderDate);
    deadline.setDate(deadline.getDate() + faker.number.int({ min: 7, max: 60 }));
    const r = Math.random();
    let status: OrderStatus = "APPROVED";
    if (r < 0.1) status = "PENDING";
    else if (r < 0.85) status = "APPROVED";
    else if (r < 0.95) status = "PARTIAL_SHIPPED";
    else status = "COMPLETED";
    const seq = String(i + 1).padStart(5, "0");
    return {
      id: randomUUID(),
      orderNumber: `PERF-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}-${seq}`,
      customerId,
      currency: "TRY",
      status,
      orderDate,
      deadline,
    };
  });
  await chunkInsert(
    orderData,
    (chunk) => prisma.order.createMany({ data: chunk, skipDuplicates: true }),
    "Sipariş"
  );

  // ── 4) Sipariş kalemleri (1-3 per sipariş) ─────────────────────────────
  console.log("[4] Sipariş kalemleri ekleniyor...");
  const orderLineData: Array<{
    id: string;
    orderId: string;
    itemId: string;
    variantId: string | null;
    quantity: number;
  }> = [];
  for (const o of orderData) {
    const lineCount = faker.number.int({ min: 1, max: 3 });
    for (let i = 0; i < lineCount; i++) {
      const item = pickRandom(items);
      const variant = item.variants.length > 0 ? pickRandom(item.variants) : null;
      orderLineData.push({
        id: randomUUID(),
        orderId: o.id,
        itemId: item.id,
        variantId: variant?.id ?? null,
        quantity: faker.number.int({ min: 100, max: 2000 }),
      });
    }
  }
  await chunkInsert(
    orderLineData,
    (chunk) => prisma.orderLine.createMany({ data: chunk, skipDuplicates: true }),
    "Sipariş kalemi"
  );

  // ── 5) İş emirleri ──────────────────────────────────────────────────────
  console.log("[5] İş emirleri ekleniyor...");
  const woData = Array.from({ length: TARGET.workOrders }, (_, i) => {
    const seq = String(i + 1).padStart(5, "0");
    const r = Math.random();
    const status =
      r < 0.2 ? "PLANNED" : r < 0.6 ? "IN_PROGRESS" : r < 0.85 ? "COMPLETED" : "PAUSED";
    const type = Math.random() < 0.7 ? "ORDER_PRODUCTION" : "STOCK_PRODUCTION";
    return {
      id: randomUUID(),
      batchNumber: `PERF-WO-${seq}`,
      type: type as "ORDER_PRODUCTION" | "STOCK_PRODUCTION",
      status: status as "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "PAUSED",
      targetQuantity: faker.number.int({ min: 200, max: 3000 }),
      width: faker.number.int({ min: 140, max: 220 }),
    };
  });
  await chunkInsert(
    woData,
    (chunk) => prisma.workOrder.createMany({ data: chunk, skipDuplicates: true }),
    "İş emri"
  );

  // ORDER_PRODUCTION tipi WO'ları rastgele OrderLine'lara bağla
  const orderProductionWOs = woData.filter((w) => w.type === "ORDER_PRODUCTION");
  const wolData: Array<{ workOrderId: string; orderLineId: string }> = [];
  for (const w of orderProductionWOs) {
    const linkCount = faker.number.int({ min: 1, max: 2 });
    const seen = new Set<string>();
    for (let i = 0; i < linkCount; i++) {
      const ol = pickRandom(orderLineData);
      if (seen.has(ol.id)) continue;
      seen.add(ol.id);
      wolData.push({ workOrderId: w.id, orderLineId: ol.id });
    }
  }
  await chunkInsert(
    wolData,
    (chunk) =>
      prisma.workOrderToOrderLine.createMany({ data: chunk, skipDuplicates: true }),
    "WO-Sipariş bağı"
  );

  // ── 6) WorkOrderStep'ler (her WO için 4 adım) ───────────────────────────
  console.log("[6] WorkOrder adımları ekleniyor...");
  if (stations.length === 0) {
    console.log("  Uyarı: aktif istasyon yok — adımlar atlandı.");
  }
  const stepData: Array<{
    id: string;
    workOrderId: string;
    stationId: string;
    stepSequence: number;
    status: "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED";
    startedAt: Date | null;
    completedAt: Date | null;
  }> = [];
  if (stations.length > 0) {
    for (const w of woData) {
      for (let i = 1; i <= TARGET.stepsPerWorkOrder; i++) {
        const station = pickRandom(stations);
        const r = Math.random();
        const status =
          w.status === "COMPLETED"
            ? "COMPLETED"
            : r < 0.5
              ? "PENDING"
              : r < 0.8
                ? "ACTIVE"
                : "COMPLETED";
        const started = status !== "PENDING" ? faker.date.recent({ days: 30 }) : null;
        const completed = status === "COMPLETED" ? faker.date.recent({ days: 14 }) : null;
        stepData.push({
          id: randomUUID(),
          workOrderId: w.id,
          stationId: station.id,
          stepSequence: i,
          status: status as "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED",
          startedAt: started,
          completedAt: completed,
        });
      }
    }
  }
  await chunkInsert(
    stepData,
    (chunk) => prisma.workOrderStep.createMany({ data: chunk, skipDuplicates: true }),
    "WO Adım"
  );
  // İndekslemek için step → WO map
  const stepsByWO = new Map<string, typeof stepData>();
  for (const s of stepData) {
    const arr = stepsByWO.get(s.workOrderId) ?? [];
    arr.push(s);
    stepsByWO.set(s.workOrderId, arr);
  }

  // ── 7) Toplar (Roll) — bazıları step'e bağlı ────────────────────────────
  console.log("[7] Toplar ekleniyor...");
  const rollData = Array.from({ length: TARGET.rolls }, (_, i) => {
    const item = pickRandom(items);
    const variant = item.variants.length > 0 ? pickRandom(item.variants) : null;
    const initialQty = faker.number.int({ min: 50, max: 500 });
    const seq = String(i + 1).padStart(6, "0");
    const status = rollStatusBucket();
    // Üretim akışındaki roller bir step'e bağlı olmalı (gerçekçi)
    let producedInStepId: string | null = null;
    let currentStepId: string | null = null;
    const wo = pickRandom(woData);
    const woSteps = stepsByWO.get(wo.id) ?? [];
    if (woSteps.length > 0) {
      producedInStepId = woSteps[0].id; // ilk step'te üretildi
      if (status === "IN_PRODUCTION" && woSteps.length > 1) {
        currentStepId = pickRandom(woSteps.slice(1)).id;
      }
    }
    return {
      id: randomUUID(),
      barcode: `PERF-ROL-${seq}`,
      itemId: item.id,
      variantId: variant?.id ?? null,
      initialQty,
      currentQty: initialQty - faker.number.int({ min: 0, max: 5 }),
      weightKg: faker.number.float({ min: 5, max: 50, fractionDigits: 2 }),
      width: faker.number.int({ min: 140, max: 220 }),
      status,
      qualityGrade: pickRandom(grades),
      createdById: adminUser.id,
      producedInStepId,
      currentStepId,
    };
  });
  await chunkInsert(
    rollData,
    (chunk) => prisma.roll.createMany({ data: chunk, skipDuplicates: true }),
    "Top"
  );

  // ── 8) Roll Movements (her aktif rol için 2 hareket) ────────────────────
  console.log("[8] Roll hareketleri ekleniyor...");
  const movementData: Array<{
    id: string;
    rollId: string;
    workOrderStepId: string;
    qtyIn: number;
    qtyOut: number | null;
    enteredAt: Date;
    exitedAt: Date | null;
    operatorId: string | null;
  }> = [];
  for (const r of rollData) {
    if (!r.producedInStepId) continue;
    for (let m = 0; m < TARGET.movementsPerRoll; m++) {
      movementData.push({
        id: randomUUID(),
        rollId: r.id,
        workOrderStepId: r.producedInStepId,
        qtyIn: r.initialQty,
        qtyOut: m === 1 ? r.currentQty : null,
        enteredAt: faker.date.recent({ days: 30 }),
        exitedAt: m === 1 ? faker.date.recent({ days: 14 }) : null,
        operatorId: adminUser.id,
      });
    }
  }
  await chunkInsert(
    movementData,
    (chunk) => prisma.rollMovement.createMany({ data: chunk, skipDuplicates: true }),
    "Roll Hareketi"
  );

  // ── 9) Roll Operations (KURSUN, QC2, TAMBUR_PROCESSED, PACKAGED) ────────
  console.log("[9] Roll operasyonları ekleniyor...");
  const opTypes: Array<"KURSUN_APPLIED" | "QC2_COMPLETED" | "TAMBUR_PROCESSED" | "PACKAGED"> = [
    "KURSUN_APPLIED",
    "QC2_COMPLETED",
    "TAMBUR_PROCESSED",
    "PACKAGED",
  ];
  const operationData: Array<{
    id: string;
    rollId: string;
    workOrderStepId: string;
    operationType: "KURSUN_APPLIED" | "QC2_COMPLETED" | "TAMBUR_PROCESSED" | "PACKAGED";
    operatorId: string | null;
  }> = [];
  for (const r of rollData) {
    if (!r.producedInStepId) continue;
    const types = faker.helpers.arrayElements(opTypes, TARGET.operationsPerRoll);
    for (const t of types) {
      operationData.push({
        id: randomUUID(),
        rollId: r.id,
        workOrderStepId: r.producedInStepId,
        operationType: t,
        operatorId: adminUser.id,
      });
    }
  }
  await chunkInsert(
    operationData,
    (chunk) => prisma.rollOperation.createMany({ data: chunk, skipDuplicates: true }),
    "Roll Operasyonu"
  );

  // ── 9.5) OrderAllocation: PRODUCED/WAREHOUSE/READY rolleri sipariş satırlarına bağla
  console.log("[9.5] Allocation ekleniyor...");
  const allocableRolls = rollData.filter((r) =>
    ["PRODUCED", "WAREHOUSE", "READY_FOR_SHIP", "A1_STOCK"].includes(r.status)
  );
  // OrderLine'ı item bazlı index'leyelim
  const linesByItem = new Map<string, typeof orderLineData>();
  for (const ol of orderLineData) {
    const arr = linesByItem.get(ol.itemId) ?? [];
    arr.push(ol);
    linesByItem.set(ol.itemId, arr);
  }
  const allocData: Array<{
    id: string;
    rollId: string;
    orderLineId: string;
    allocatedQty: number;
  }> = [];
  for (const r of allocableRolls) {
    const lines = linesByItem.get(r.itemId);
    if (!lines || lines.length === 0) continue;
    if (Math.random() > 0.55) continue; // %55'ini allocate et
    const ol = pickRandom(lines);
    allocData.push({
      id: randomUUID(),
      rollId: r.id,
      orderLineId: ol.id,
      allocatedQty: Math.min(r.currentQty, ol.quantity),
    });
  }
  await chunkInsert(
    allocData,
    (chunk) => prisma.orderAllocation.createMany({ data: chunk, skipDuplicates: true }),
    "Allocation"
  );

  // ── 7) Çuvallar (her müşteriye 50 adet) ─────────────────────────────────
  console.log("[10] Çuvallar ekleniyor...");
  const sackData = Array.from({ length: TARGET.sacks }, (_, i) => {
    const customerId = pickRandom(allCustomerIds);
    const seq = String(i + 1).padStart(6, "0");
    return {
      id: randomUUID(),
      sackNumber: `PERF-SCK-${seq}`,
      customerId,
      weightKg: maybe(faker.number.float({ min: 8, max: 35, fractionDigits: 2 }), 0.7),
    };
  });
  await chunkInsert(
    sackData,
    (chunk) => prisma.sack.createMany({ data: chunk, skipDuplicates: true }),
    "Çuval"
  );

  // ── 8) Sevkiyatlar + ShipmentItem'lar ───────────────────────────────────
  console.log("[11] Sevkiyatlar ekleniyor...");
  const branchByCustomer = new Map<string, string[]>();
  for (const b of branchesData) {
    const arr = branchByCustomer.get(b.customerId) ?? [];
    arr.push(b.id);
    branchByCustomer.set(b.customerId, arr);
  }

  const shipmentData = Array.from({ length: TARGET.shipments }, (_, i) => {
    const customerId = pickRandom(allCustomerIds);
    const branches = branchByCustomer.get(customerId) ?? [];
    const branchId = branches.length > 0 ? pickRandom(branches) : null;
    const r = Math.random();
    const status: ShipmentStatus = r < 0.3 ? "PREPARING" : "SHIPPED";
    const shippedAt = status === "SHIPPED" ? faker.date.recent({ days: 60 }) : null;
    const seq = String(i + 1).padStart(5, "0");
    return {
      id: randomUUID(),
      shipmentNumber: `PERF-IRS-${seq}`,
      customerId,
      branchId,
      status,
      priority: status === "PREPARING" ? faker.number.int({ min: 0, max: 100 }) : 0,
      plannedDate:
        status === "PREPARING" ? faker.date.soon({ days: 14 }) : null,
      shippedAt,
      shippedById: status === "SHIPPED" ? adminUser.id : null,
      driverName: maybe(faker.person.fullName(), 0.6),
      plateNumber: maybe(
        `${faker.number.int({ min: 1, max: 81 })} ${faker.string.alpha({ length: 3, casing: "upper" })} ${faker.number.int({ min: 100, max: 999 })}`,
        0.7
      ),
    };
  });
  await chunkInsert(
    shipmentData,
    (chunk) => prisma.shipment.createMany({ data: chunk, skipDuplicates: true }),
    "Sevkiyat"
  );

  // SHIPPED sevkiyatların her birine ortalama N adet ShipmentItem (SHIPPED roll'lardan)
  const shippedShipments = shipmentData.filter((s) => s.status === "SHIPPED");
  const eligibleRolls = rollData.filter(
    (r) => r.status === "SHIPPED" || r.status === "READY_FOR_SHIP"
  );
  const shipmentItemData: Array<{
    id: string;
    shipmentId: string;
    rollId: string;
    shippedQty: number;
    shippedWeight: number | null;
  }> = [];
  const usedRolls = new Set<string>();
  for (const sh of shippedShipments) {
    const itemCount = faker.number.int({
      min: 2,
      max: TARGET.itemsPerShipment * 2,
    });
    for (let i = 0; i < itemCount; i++) {
      const roll = pickRandom(eligibleRolls);
      if (usedRolls.has(roll.id)) continue;
      usedRolls.add(roll.id);
      shipmentItemData.push({
        id: randomUUID(),
        shipmentId: sh.id,
        rollId: roll.id,
        shippedQty: roll.currentQty,
        shippedWeight: roll.weightKg ?? null,
      });
    }
  }
  await chunkInsert(
    shipmentItemData,
    (chunk) =>
      prisma.shipmentItem.createMany({ data: chunk, skipDuplicates: true }),
    "Sevkiyat kalemi"
  );

  // ── 12) Refakat Kartları ────────────────────────────────────────────────
  console.log("[12] Refakat kartları ekleniyor...");
  const cardData = Array.from({ length: TARGET.travelerCards }, (_, i) => {
    const wo = pickRandom(woData);
    const r = Math.random();
    const status: "ACTIVE" | "REPRINTED" | "VOIDED" | "COMPLETED" =
      r < 0.7 ? "ACTIVE" : r < 0.85 ? "COMPLETED" : r < 0.95 ? "REPRINTED" : "VOIDED";
    const seq = String(i + 1).padStart(6, "0");
    return {
      id: randomUUID(),
      cardNumber: `PERF-RFK-${seq}`,
      barcode: `PERF-RFKB-${seq}-C`,
      workOrderId: wo.id,
      status,
      printedById: adminUser.id,
      printedAt: faker.date.recent({ days: 60 }),
    };
  });
  await chunkInsert(
    cardData,
    (chunk) => prisma.travelerCard.createMany({ data: chunk, skipDuplicates: true }),
    "Refakat Kartı"
  );

  // Card scans — kartların yarısı için 2'şer scan
  const scanData: Array<{
    id: string;
    cardId: string;
    stationId: string;
    workOrderStepId: string | null;
    scanType: "ARRIVAL" | "DEPARTURE" | "INFO";
    scannedAt: Date;
  }> = [];
  if (stations.length > 0) {
    for (const c of cardData.slice(0, Math.floor(cardData.length / 2))) {
      const woSteps = stepsByWO.get(c.workOrderId) ?? [];
      for (let i = 0; i < 2; i++) {
        const step = woSteps.length > 0 ? pickRandom(woSteps) : null;
        scanData.push({
          id: randomUUID(),
          cardId: c.id,
          stationId: step ? step.stationId : pickRandom(stations).id,
          workOrderStepId: step?.id ?? null,
          scanType: i === 0 ? "ARRIVAL" : "DEPARTURE",
          scannedAt: faker.date.recent({ days: 30 }),
        });
      }
    }
  }
  // Scan ekleme; FK çakışmasında atla (test datası için tolere edilebilir)
  if (scanData.length > 0) {
    try {
      await chunkInsert(
        scanData,
        (chunk) =>
          prisma.travelerCardScan.createMany({ data: chunk, skipDuplicates: true }),
        "Kart Tarama"
      );
    } catch (err) {
      console.warn(
        "  ⚠ Kart taraması atlandı (FK), seed devam ediyor:",
        (err as Error).message.slice(0, 80)
      );
    }
  }

  // ── 13) PackagingQueue: aktif kuyrukta bekleyen siparişler ──────────────
  console.log("[13] Paketleme kuyruğu ekleniyor...");
  // PERF prefix'li APPROVED siparişlerden rastgele seç
  const approvedOrderIds = orderData
    .filter((o) => o.status === "APPROVED")
    .slice(0, TARGET.packagingQueueWaiting)
    .map((o) => o.id);
  const queueData = approvedOrderIds.map((orderId, i) => ({
    id: randomUUID(),
    orderId,
    priority: i, // sıralı
    isUrgent: i < 5, // ilk 5'i acil
    urgentMarkedAt: i < 5 ? new Date() : null,
    addedByUserId: adminUser.id,
    note: i < 5 ? "Test acil iş" : null,
  }));
  await chunkInsert(
    queueData,
    (chunk) =>
      prisma.packagingQueue.createMany({ data: chunk, skipDuplicates: true }),
    "Paketleme Kuyruğu"
  );

  // ── Özet ────────────────────────────────────────────────────────────────
  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("─".repeat(60));
  console.log(`✅ Tamam — toplam süre ${totalSec}s`);
  console.log("─".repeat(60));

  const summary = await Promise.all([
    prisma.customer.count(),
    prisma.customerBranch.count(),
    prisma.order.count(),
    prisma.orderLine.count(),
    prisma.workOrder.count(),
    prisma.workOrderStep.count(),
    prisma.workOrderToOrderLine.count(),
    prisma.roll.count(),
    prisma.rollMovement.count(),
    prisma.rollOperation.count(),
    prisma.orderAllocation.count(),
    prisma.sack.count(),
    prisma.shipment.count(),
    prisma.shipmentItem.count(),
    prisma.travelerCard.count(),
    prisma.travelerCardScan.count(),
    prisma.packagingQueue.count(),
  ]);
  console.log("Toplam DB kaydı:");
  console.log("  Customers:           ", summary[0]);
  console.log("  Customer Branches:   ", summary[1]);
  console.log("  Orders:              ", summary[2]);
  console.log("  Order Lines:         ", summary[3]);
  console.log("  Work Orders:         ", summary[4]);
  console.log("  WO Steps:            ", summary[5]);
  console.log("  WO-OrderLine links:  ", summary[6]);
  console.log("  Rolls:               ", summary[7]);
  console.log("  Roll Movements:      ", summary[8]);
  console.log("  Roll Operations:     ", summary[9]);
  console.log("  Order Allocations:   ", summary[10]);
  console.log("  Sacks:               ", summary[11]);
  console.log("  Shipments:           ", summary[12]);
  console.log("  Shipment Items:      ", summary[13]);
  console.log("  Traveler Cards:      ", summary[14]);
  console.log("  Card Scans:          ", summary[15]);
  console.log("  Packaging Queue:     ", summary[16]);
}

main()
  .catch((err) => {
    console.error("\n❌ HATA:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
