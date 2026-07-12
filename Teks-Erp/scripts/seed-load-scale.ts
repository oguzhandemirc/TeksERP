// =============================================================================
// TeksERP — Gerçekçi YÜK/ÖLÇEK üreteci (Faz C1)
// =============================================================================
// AMAÇ: Fabrikaya günde ORDERS_PER_DAY sipariş gelirse DAYS gün sonunda ne kadar
// veri birikir → 1 yıllık footprint'i GERÇEKTEN üret, böylece scale_report.ts
// hot sorguları gerçek hacme karşı EXPLAIN'le ölçebilsin.
//
// ⚠️ SADECE teks_loadtest DB'sinde çalıştır:
//   export DATABASE_URL="postgresql://oad@localhost:5432/teks_loadtest?schema=public"
//   export JWT_SECRET="ci-test-secret-not-for-production"; export TZ=UTC
//   npx prisma migrate deploy && npm run seed   # önce master data
//   ORDERS_PER_DAY=50 DAYS=365 npx tsx scripts/seed-load-scale.ts
//
// Parametreler (env):
//   ORDERS_PER_DAY  (default 50) — günlük sipariş sayısı
//   DAYS            (default 365) — kaç güne yayılsın
//
// YÖNTEM (CLAUDE.md DB perf kuralı #9 — createMany toplu insert):
//   - client-üretimi UUID (uuid v4) ile parent→child referansı tek round-trip.
//   - chunk'lı createMany (CHUNK satır/insert) — pg parametre limiti güvenli.
//   - FK sırası: önce parent (order → line/wo → step/roll → op/movement/scan ...).
//   - tarihler DAYS boyunca YAYILIR (createdAt/orderDate/deadline/scannedAt...).
//   - statüler gerçekçi dağıtılır (çoğu COMPLETED/WAREHOUSE/SHIPPED, bir kısmı açık).
//   - SystemLog EN HIZLI BÜYÜYEN tablo (~25-30/order) — action+category dağıtılır.
//
// Per-order yaklaşık footprint (plan hedefi ile uyumlu):
//   order 1, order_line ~2, work_order ~1, work_order_step ~3, roll ~3,
//   roll_operation ~6, roll_movement ~6, traveler_card ~1, traveler_card_scan ~6,
//   shipment ~0.5, sack ~1.5, sack_allocation ~2, shipment_order ~0.5,
//   system_log ~25-30.
// =============================================================================

import prisma from "../src/lib/prisma";
import { pool } from "../src/lib/prisma";
import { v4 as uuid } from "uuid";
import {
  RollStatus,
  RollOperationType,
  RollEntrySource,
  OrderStatus,
  StepStatus,
  WorkOrderType,
  WorkOrderStatus,
  ScanType,
  ShipmentStatus,
  ShipmentDestination,
  SystemLogCategory,
  TravelerCardStatus,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Parametreler
// ---------------------------------------------------------------------------
const ORDERS_PER_DAY = Number(process.env.ORDERS_PER_DAY ?? "50");
const DAYS = Number(process.env.DAYS ?? "365");
const TOTAL_ORDERS = ORDERS_PER_DAY * DAYS;
const CHUNK = 4000; // satır/insert — pg parametre limiti (her satır ~20 alan) güvenli

if (!process.env.DATABASE_URL?.includes("teks_loadtest")) {
  console.error(
    "❌ GÜVENLİK: DATABASE_URL teks_loadtest içermiyor. Yanlış DB'ye yazma riski — durduruldu.\n" +
      `   Mevcut: ${process.env.DATABASE_URL}`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}
function rand(max: number): number {
  return Math.floor(Math.random() * max);
}
function randPick<T>(arr: T[]): T {
  return arr[rand(arr.length)];
}

/** insertChunked: büyük diziyi CHUNK'lara böl, sayaç döndür. */
async function insertChunked<T extends Record<string, unknown>>(
  label: string,
  rows: T[],
  insertFn: (chunk: T[]) => Promise<{ count: number }>
): Promise<number> {
  let inserted = 0;
  const t0 = Date.now();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const r = await insertFn(rows.slice(i, i + CHUNK));
    inserted += r.count;
  }
  console.log(`  ✅ ${label.padEnd(26)} ${inserted.toLocaleString()} satır (${Date.now() - t0}ms)`);
  return inserted;
}

/** i. sipariş için createdAt: DAYS aralığına yayılmış, gün-içi rastgele saat. */
function orderCreatedAt(i: number): Date {
  // i'inci sipariş hangi güne düşer (eşit dağıtım)
  const dayOffset = Math.floor(i / ORDERS_PER_DAY); // 0..DAYS-1
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() - (DAYS - 1 - dayOffset)); // en eski = DAYS-1 gün önce
  // gün-içi saat 06:00-18:00 arası rastgele
  base.setUTCHours(6 + rand(12), rand(60), rand(60), 0);
  return base;
}
function plusMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}
function plusDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(
    `\n=== seed-load-scale: ORDERS_PER_DAY=${ORDERS_PER_DAY} × DAYS=${DAYS} = ${TOTAL_ORDERS.toLocaleString()} sipariş ===\n`
  );
  const tStart = Date.now();

  // -------------------------------------------------------------------------
  // Master FK'ları seed'den çöz (business-key ile — hardcoded UUID YOK)
  // -------------------------------------------------------------------------
  const [items, colors, customers, branches, users, grades, stations, properties] =
    await Promise.all([
      prisma.item.findMany({ where: { isActive: true }, select: { id: true } }),
      prisma.color.findMany({ where: { isActive: true }, select: { id: true } }),
      prisma.customer.findMany({ where: { isActive: true }, select: { id: true } }),
      prisma.customerBranch.findMany({ select: { id: true, customerId: true } }),
      prisma.user.findMany({ select: { id: true } }),
      prisma.qualityGrade.findMany({ select: { id: true, code: true } }),
      prisma.station.findMany({ select: { id: true, kind: true } }),
      prisma.fabricProperty.findMany({ select: { id: true } }),
    ]);

  if (!items.length || !colors.length || !customers.length || !users.length || !grades.length || !stations.length) {
    throw new Error("Master data eksik — önce `npm run seed` çalıştır.");
  }
  void properties;

  const itemIds = items.map((x) => x.id);
  const colorIds = colors.map((x) => x.id);
  const customerIds = customers.map((x) => x.id);
  const userIds = users.map((x) => x.id);
  const gradeWarehouse = grades.find((g) => g.code === "1.KALITE") ?? grades[0];
  const gradeA1 = grades.find((g) => g.code === "A1") ?? grades[0];
  const gradeFire = grades.find((g) => g.code === "FIRE") ?? grades[0];
  // istasyon kind eşlemesi (üretim adımları için)
  const stByKind = (k: string) => stations.filter((s) => s.kind === k).map((s) => s.id);
  const subStations = stByKind("SUBCONTRACTOR");
  const procStations = stByKind("PROCESS_QC");
  const tamburStations = stByKind("TAMBUR");
  const stepStations = [
    subStations[0] ?? stations[0].id,
    procStations[0] ?? stations[0].id,
    tamburStations[0] ?? stations[0].id,
  ];
  const branchByCustomer = new Map<string, string[]>();
  for (const b of branches) {
    const arr = branchByCustomer.get(b.customerId) ?? [];
    arr.push(b.id);
    branchByCustomer.set(b.customerId, arr);
  }

  // Statü dağılımı: çoğu kapalı/sevkli, bir kısmı açık.
  // En eski siparişler büyük çoğunlukla COMPLETED; son ~10 gün açık/kısmi.
  function orderStatusFor(dayOffset: number): OrderStatus {
    const recent = dayOffset >= DAYS - 10;
    if (recent) {
      return randPick([
        OrderStatus.PENDING,
        OrderStatus.APPROVED,
        OrderStatus.PARTIAL_SHIPPED,
        OrderStatus.COMPLETED,
      ]);
    }
    const roll = Math.random();
    if (roll < 0.82) return OrderStatus.COMPLETED;
    if (roll < 0.90) return OrderStatus.PARTIAL_SHIPPED;
    if (roll < 0.95) return OrderStatus.APPROVED;
    if (roll < 0.98) return OrderStatus.CANCELLED;
    return OrderStatus.PENDING;
  }

  // -------------------------------------------------------------------------
  // Pre-allocate: tüm parent id'leri client-side üret, child'lar referans alsın
  // -------------------------------------------------------------------------
  type OrderCtx = {
    id: string;
    customerId: string;
    branchId: string | null;
    createdAt: Date;
    deadline: Date;
    status: OrderStatus;
    lineIds: string[];
    woId: string;
    stepIds: string[];
    rollIds: string[];
    cardId: string;
    shipmentId: string | null;
    dayOffset: number;
  };

  const orderRows: Record<string, unknown>[] = [];
  const lineRows: Record<string, unknown>[] = [];
  const woRows: Record<string, unknown>[] = [];
  const stepRows: Record<string, unknown>[] = [];
  const rollRows: Record<string, unknown>[] = [];
  const opRows: Record<string, unknown>[] = [];
  const movementRows: Record<string, unknown>[] = [];
  const cardRows: Record<string, unknown>[] = [];
  const scanRows: Record<string, unknown>[] = [];
  const shipmentRows: Record<string, unknown>[] = [];
  const sackRows: Record<string, unknown>[] = [];
  const shipmentOrderRows: Record<string, unknown>[] = [];
  const allocationRows: Record<string, unknown>[] = [];
  const logRows: Record<string, unknown>[] = [];

  // Çuval kodu için global sayaç (AMB%05d benzeri)
  let sackSeq = 0;
  let woSeq = 0;
  let cardSeq = 0;
  let shipSeq = 0;

  console.log("Satırlar hesaplanıyor (bellekte)...");

  // -------------------------------------------------------------------------
  // flush: biriken satırları FK sırasında DB'ye yaz, dizileri boşalt.
  // (Loop'tan ÖNCE tanımlı — `totals` TDZ'ye takılmasın diye burada.)
  // -------------------------------------------------------------------------
  const totals: Record<string, number> = {};
  async function flush(): Promise<void> {
    // FK sırası: master → order → line → wo → step → SHIPMENT/SACK (roll'dan ÖNCE,
    // çünkü roll.shipmentId/sackId bunlara bağlanıyor) → roll → op/movement/...
    totals.orders = (totals.orders ?? 0) + (await insertChunked("order", orderRows, (c) => prisma.order.createMany({ data: c as never })));
    totals.order_line = (totals.order_line ?? 0) + (await insertChunked("order_line", lineRows, (c) => prisma.orderLine.createMany({ data: c as never })));
    totals.work_order = (totals.work_order ?? 0) + (await insertChunked("work_order", woRows, (c) => prisma.workOrder.createMany({ data: c as never })));
    totals.work_order_step = (totals.work_order_step ?? 0) + (await insertChunked("work_order_step", stepRows, (c) => prisma.workOrderStep.createMany({ data: c as never })));
    totals.shipment = (totals.shipment ?? 0) + (await insertChunked("shipment", shipmentRows, (c) => prisma.shipment.createMany({ data: c as never })));
    totals.sack = (totals.sack ?? 0) + (await insertChunked("sack", sackRows, (c) => prisma.sack.createMany({ data: c as never })));
    totals.roll = (totals.roll ?? 0) + (await insertChunked("roll", rollRows, (c) => prisma.roll.createMany({ data: c as never })));
    totals.roll_operation = (totals.roll_operation ?? 0) + (await insertChunked("roll_operation", opRows, (c) => prisma.rollOperation.createMany({ data: c as never })));
    totals.roll_movement = (totals.roll_movement ?? 0) + (await insertChunked("roll_movement", movementRows, (c) => prisma.rollMovement.createMany({ data: c as never })));
    totals.traveler_card = (totals.traveler_card ?? 0) + (await insertChunked("traveler_card", cardRows, (c) => prisma.travelerCard.createMany({ data: c as never })));
    totals.traveler_card_scan = (totals.traveler_card_scan ?? 0) + (await insertChunked("traveler_card_scan", scanRows, (c) => prisma.travelerCardScan.createMany({ data: c as never })));
    totals.shipment_order = (totals.shipment_order ?? 0) + (await insertChunked("shipment_order", shipmentOrderRows, (c) => prisma.shipmentOrder.createMany({ data: c as never })));
    totals.sack_allocation = (totals.sack_allocation ?? 0) + (await insertChunked("sack_allocation", allocationRows, (c) => prisma.sackAllocation.createMany({ data: c as never })));
    totals.system_log = (totals.system_log ?? 0) + (await insertChunked("system_log", logRows, (c) => prisma.systemLog.createMany({ data: c as never })));

    // dizileri boşalt
    orderRows.length = 0;
    lineRows.length = 0;
    woRows.length = 0;
    stepRows.length = 0;
    rollRows.length = 0;
    opRows.length = 0;
    movementRows.length = 0;
    cardRows.length = 0;
    scanRows.length = 0;
    shipmentRows.length = 0;
    sackRows.length = 0;
    shipmentOrderRows.length = 0;
    allocationRows.length = 0;
    logRows.length = 0;
    console.log(`  — flush bitti (toplam order: ${(totals.orders ?? 0).toLocaleString()})\n`);
  }

  for (let i = 0; i < TOTAL_ORDERS; i++) {
    const createdAt = orderCreatedAt(i);
    const dayOffset = Math.floor(i / ORDERS_PER_DAY);
    const status = orderStatusFor(dayOffset);
    const customerId = pick(customerIds, i);
    const custBranches = branchByCustomer.get(customerId) ?? [];
    const branchId = custBranches.length ? randPick(custBranches) : null;
    const deadline = plusDays(createdAt, 20 + rand(40));

    const ctx: OrderCtx = {
      id: uuid(),
      customerId,
      branchId,
      createdAt,
      deadline,
      status,
      lineIds: [],
      woId: uuid(),
      stepIds: [uuid(), uuid(), uuid()],
      rollIds: [],
      cardId: uuid(),
      shipmentId: null,
      dayOffset,
    };

    const completedish =
      status === OrderStatus.COMPLETED || status === OrderStatus.PARTIAL_SHIPPED;

    // ---- Order ----
    orderRows.push({
      id: ctx.id,
      orderNumber: `LT-${String(i).padStart(7, "0")}`,
      customerId,
      branchId,
      currency: "TRY",
      totalAmount: 1000 + rand(50000),
      status,
      orderDate: createdAt,
      deadline,
      shippedQty: completedish ? 200 + rand(800) : 0,
      completedAt: status === OrderStatus.COMPLETED ? plusDays(createdAt, 15 + rand(20)) : null,
      createdAt,
      updatedAt: createdAt,
    });

    // ---- Order lines (~2/order) ----
    const nLines = 1 + rand(2); // 1-2
    for (let l = 0; l < nLines; l++) {
      const lineId = uuid();
      ctx.lineIds.push(lineId);
      lineRows.push({
        id: lineId,
        orderId: ctx.id,
        itemId: pick(itemIds, i + l),
        colorId: Math.random() < 0.85 ? pick(colorIds, i + l) : null,
        quantity: 100 + rand(900),
        shippedQty: completedish ? 100 + rand(400) : 0,
        unitPrice: 10 + rand(90),
        width: pick([140, 150, 160, 180, 200, 220], i + l),
        createdAt,
        updatedAt: createdAt,
      });
    }

    // ---- WorkOrder (~1/order) ----
    woSeq++;
    const woStatus: WorkOrderStatus = completedish
      ? WorkOrderStatus.COMPLETED
      : status === OrderStatus.CANCELLED
        ? WorkOrderStatus.CANCELLED
        : randPick([WorkOrderStatus.PLANNED, WorkOrderStatus.IN_PROGRESS]);
    woRows.push({
      id: ctx.woId,
      batchNumber: `P-LT-${String(woSeq).padStart(7, "0")}`,
      type: WorkOrderType.ORDER_PRODUCTION,
      width: pick([140, 150, 160, 180, 200], i),
      targetQuantity: 300 + rand(700),
      status: woStatus,
      plannedStartDate: createdAt,
      plannedEndDate: deadline,
      targetItemId: pick(itemIds, i),
      targetColorId: pick(colorIds, i),
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    });

    // ---- WorkOrderSteps (~3/order: Boya → Kurşun+KK2 → Tambur) ----
    for (let s = 0; s < 3; s++) {
      const stepStatus: StepStatus = completedish
        ? StepStatus.COMPLETED
        : s === 0
          ? StepStatus.ACTIVE
          : StepStatus.PENDING;
      stepRows.push({
        id: ctx.stepIds[s],
        workOrderId: ctx.woId,
        stationId: stepStations[s],
        stepSequence: s + 1,
        status: stepStatus,
        startedAt: completedish || s === 0 ? plusDays(createdAt, s) : null,
        completedAt: completedish ? plusDays(createdAt, s + 1) : null,
        priority: 0,
        isUrgent: false,
        createdAt,
        updatedAt: createdAt,
      });
    }

    // ---- Rolls (~3/order: 1 parent stok + 2 üretim/depo top) ----
    // Statü dağılımı: completedish → çoğu WAREHOUSE/SHIPPED; açık → STOCK/IN_PRODUCTION.
    const nRolls = 3;
    // Bu siparişin roll satır objelerine referans — shipment bloğu içinde
    // shipmentId/sackId ile bağlayabilmek için (rollRows flat olduğundan).
    const orderRollRefs: Array<{ row: Record<string, unknown>; status: RollStatus }> = [];
    for (let r = 0; r < nRolls; r++) {
      const rollId = uuid();
      ctx.rollIds.push(rollId);
      let rollStatus: RollStatus;
      let colorId: string | null;
      let gradeId = gradeWarehouse.id;
      let gradeCode = gradeWarehouse.code;
      if (completedish) {
        // %55 SHIPPED, %35 WAREHOUSE, %10 A1/SCRAP
        const rr = Math.random();
        if (rr < 0.55) rollStatus = RollStatus.SHIPPED;
        else if (rr < 0.9) rollStatus = RollStatus.WAREHOUSE;
        else if (rr < 0.97) {
          rollStatus = RollStatus.A1_STOCK;
          gradeId = gradeA1.id;
          gradeCode = gradeA1.code;
        } else {
          rollStatus = RollStatus.SCRAP;
          gradeId = gradeFire.id;
          gradeCode = gradeFire.code;
        }
        colorId = pick(colorIds, i + r);
      } else if (r === 0) {
        rollStatus = RollStatus.STOCK;
        colorId = null; // ham
      } else {
        rollStatus = randPick([RollStatus.IN_PRODUCTION, RollStatus.AT_SUBCONTRACTOR, RollStatus.WAREHOUSE]);
        colorId = rollStatus === RollStatus.WAREHOUSE ? pick(colorIds, i + r) : null;
      }
      const initialQty = 80 + rand(220);
      const rollRow: Record<string, unknown> = {
        id: rollId,
        barcode: `LT-R-${i}-${r}`,
        itemId: pick(itemIds, i + r),
        colorId,
        initialQty,
        currentQty: rollStatus === RollStatus.SHIPPED ? 0 : initialQty,
        weightKg: 20 + rand(80),
        status: rollStatus,
        qualityGrade: gradeCode,
        qualityGradeId: gradeId,
        width: pick([140, 150, 160, 180, 200, 220], i + r),
        entrySource: r === 0 ? RollEntrySource.SUPPLIER_RECEIPT : RollEntrySource.TAMBUR_SPLIT,
        producedInStepId: r === 0 ? null : ctx.stepIds[2],
        currentStepId: rollStatus === RollStatus.IN_PRODUCTION || rollStatus === RollStatus.AT_SUBCONTRACTOR ? ctx.stepIds[0] : null,
        shipmentId: null as string | null,
        sackId: null as string | null,
        createdById: pick(userIds, i),
        createdAt: plusDays(createdAt, r),
        updatedAt: plusDays(createdAt, r),
      };
      rollRows.push(rollRow);
      orderRollRefs.push({ row: rollRow, status: rollStatus });

      // ---- RollOperations (~2/roll = ~6/order) ----
      // KURSUN_APPLIED + QC2_COMPLETED (proc step) ; completedish ise + TAMBUR_PROCESSED.
      // @@unique([rollId, workOrderStepId, operationType]) → her tip ayrı satır (sorun yok).
      const opTypesForRoll: RollOperationType[] = completedish
        ? [RollOperationType.KURSUN_APPLIED, RollOperationType.QC2_COMPLETED, RollOperationType.TAMBUR_PROCESSED]
        : [RollOperationType.KURSUN_APPLIED, RollOperationType.QC2_COMPLETED];
      for (let o = 0; o < opTypesForRoll.length; o++) {
        const ot = opTypesForRoll[o];
        const stepForOp = ot === RollOperationType.TAMBUR_PROCESSED ? ctx.stepIds[2] : ctx.stepIds[1];
        opRows.push({
          id: uuid(),
          rollId,
          workOrderStepId: stepForOp,
          operationType: ot,
          operatorId: pick(userIds, i + o),
          createdAt: plusMinutes(plusDays(createdAt, r), o * 30),
        });
        // ---- RollMovement (her op'a ~1 → ~6/order) ----
        // DB seddi: partial UNIQUE (rollId, workOrderStepId) WHERE exitedAt IS NULL —
        // bir top+adımda en fazla BİR açık hareket. KURSUN+QC2 aynı PROCESS_QC adımını
        // paylaştığı için, açık (exitedAt=null) bırakmayı YALNIZ son op'a (o === son)
        // ve yalnız completedish-DEĞİL toplara sınırla; gerisi kapalı.
        const isLastOpForRoll = o === opTypesForRoll.length - 1;
        const leaveOpen = !completedish && isLastOpForRoll;
        movementRows.push({
          id: uuid(),
          rollId,
          workOrderStepId: stepForOp,
          qtyIn: initialQty,
          qtyOut: leaveOpen ? null : initialQty - rand(5),
          weightIn: 20 + rand(80),
          enteredAt: plusMinutes(plusDays(createdAt, r), o * 30),
          exitedAt: leaveOpen ? null : plusMinutes(plusDays(createdAt, r), o * 30 + 25),
          operatorId: pick(userIds, i + o),
          createdAt: plusMinutes(plusDays(createdAt, r), o * 30),
        });
      }
    }

    // ---- TravelerCard (~1/order) ----
    cardSeq++;
    cardRows.push({
      id: ctx.cardId,
      cardNumber: `RK-LT-${String(cardSeq).padStart(7, "0")}`,
      barcode: `RKB-LT-${String(cardSeq).padStart(7, "0")}`,
      workOrderId: ctx.woId,
      version: 1,
      status: completedish ? TravelerCardStatus.COMPLETED : TravelerCardStatus.ACTIVE,
      printedAt: createdAt,
      printedById: pick(userIds, i),
      createdAt,
      updatedAt: createdAt,
    });

    // ---- TravelerCardScan (~6/order: 3 adım × ARRIVAL+DEPARTURE) ----
    for (let s = 0; s < 3; s++) {
      const stationId = stepStations[s];
      const stepId = ctx.stepIds[s];
      const scanBase = plusDays(createdAt, s);
      scanRows.push({
        id: uuid(),
        cardId: ctx.cardId,
        stationId,
        workOrderStepId: stepId,
        scanType: ScanType.ARRIVAL,
        scannedAt: scanBase,
        scannedById: pick(userIds, i + s),
        createdAt: scanBase,
      });
      scanRows.push({
        id: uuid(),
        cardId: ctx.cardId,
        stationId,
        workOrderStepId: stepId,
        scanType: ScanType.DEPARTURE,
        scannedAt: plusMinutes(scanBase, 90),
        scannedById: pick(userIds, i + s),
        createdAt: plusMinutes(scanBase, 90),
      });
    }

    // ---- Shipment (~0.5/order) — yalnız completedish siparişlerin ~%50'si ----
    if (completedish && Math.random() < 0.5) {
      shipSeq++;
      const shipId = uuid();
      ctx.shipmentId = shipId;
      // Çuval depo modeli: PREPARING/READY kalktı → PLANNED (+ AT_DOOR/DISPATCHED).
      const shipStatus: ShipmentStatus =
        status === OrderStatus.COMPLETED
          ? randPick([ShipmentStatus.DISPATCHED, ShipmentStatus.PLANNED, ShipmentStatus.AT_DOOR])
          : ShipmentStatus.PLANNED;
      const shipCreated = plusDays(createdAt, 12 + rand(10));
      shipmentRows.push({
        id: shipId,
        shipmentNo: `SV-LT-${String(shipSeq).padStart(7, "0")}`,
        customerId,
        branchId,
        status: shipStatus,
        destination: Math.random() < 0.3 ? ShipmentDestination.EXPORT : ShipmentDestination.DOMESTIC,
        plateNumber: shipStatus === ShipmentStatus.DISPATCHED ? `34 LT ${rand(9999)}` : null,
        dispatchedAt: shipStatus === ShipmentStatus.DISPATCHED ? plusDays(shipCreated, 1) : null,
        dispatchedById: shipStatus === ShipmentStatus.DISPATCHED ? pick(userIds, i) : null,
        createdAt: shipCreated,
        updatedAt: shipCreated,
      });

      // ---- ShipmentOrder (~0.5/order) — bu sipariş bu sevkiyatta ----
      // isActive DENORM: app katmanı PLANNED/AT_DOOR → true, DISPATCHED/CANCELLED → false.
      shipmentOrderRows.push({
        shipmentId: shipId,
        orderId: ctx.id,
        isActive: shipStatus === ShipmentStatus.PLANNED || shipStatus === ShipmentStatus.AT_DOOR,
        createdAt: shipCreated,
      });

      // ---- Sacks (~1.5/order → 3 çuval bu sevkiyatın yarısında) ----
      const nSacks = 2 + rand(2); // 2-3
      const sackIds: string[] = [];
      for (let sk = 0; sk < nSacks; sk++) {
        sackSeq++;
        const sackId = uuid();
        sackIds.push(sackId);
        sackRows.push({
          id: sackId,
          sackNo: `SACK-LT-${String(sackSeq).padStart(7, "0")}`,
          customerId, // Sack.customerId opsiyonel — burada bağlı sevkiyatın müşterisiyle aynı
          branchId,
          shipmentId: shipId,
          seq: sk + 1,
          weightKg: 30 + rand(70),
          // Sevkiyata atanmış çuval tartıldı (mühür/kod YOK — çuval depo modeli; kod = sackNo).
          weighedById: pick(userIds, i),
          weighedAt: shipCreated,
          createdAt: shipCreated,
          updatedAt: shipCreated,
        });
      }

      // ---- Topları çuvallara bağla (shipmentId + sackId) ----
      // Bu siparişin WAREHOUSE/SHIPPED topları bu sevkiyata okutulmuş sayılır →
      // Roll.shipmentId/sackId dolar (gerçek sevkiyat içeriği). N+1/içerik
      // sorgularının (getShipmentById) anlamlı veriye sahip olması için kritik.
      const shippableRolls = orderRollRefs.filter(
        (rr) => rr.status === RollStatus.WAREHOUSE || rr.status === RollStatus.SHIPPED
      );
      shippableRolls.forEach((rr, idx) => {
        rr.row.shipmentId = shipId;
        rr.row.sackId = sackIds[idx % sackIds.length];
        // Roll statüsü sevkiyat statüsüyle hizalı: SHIPPED yalnız DISPATCHED'te (stok
        // bina dışı → currentQty 0); PLANNED/AT_DOOR sevkiyatta toplar hâlâ WAREHOUSE.
        if (shipStatus === ShipmentStatus.DISPATCHED) {
          rr.row.status = RollStatus.SHIPPED;
          rr.row.currentQty = 0;
        } else {
          rr.row.status = RollStatus.WAREHOUSE;
          rr.row.currentQty = rr.row.initialQty;
        }
      });

      // ---- SackAllocation (~2/order) — çuval bazlı karşılanma defteri ----
      // Model: ShipmentAllocation KALKTI → SackAllocation(sackId, orderLineId, qty).
      // Her satıra bir çuval ata; (sackId, orderLineId) benzersiz (her satır bir kez).
      ctx.lineIds.forEach((lineId, li) => {
        allocationRows.push({
          id: uuid(),
          sackId: sackIds[li % sackIds.length],
          orderLineId: lineId,
          qty: 50 + rand(200),
          createdAt: shipCreated,
        });
      });
    }

    // ---- SystemLog (~25-30/order) — EN HIZLI BÜYÜYEN ----
    // DOMAIN ağırlıklı (CRUD audit) + az AUTH/SYSTEM. Her domain olayına 1 log.
    const domainEvents: Array<{ table: string; action: string; recId: string }> = [
      { table: "orders", action: "CREATE", recId: ctx.id },
      { table: "order_lines", action: "CREATE", recId: ctx.lineIds[0] },
      { table: "work_orders", action: "CREATE", recId: ctx.woId },
      { table: "work_orders", action: "UPDATE", recId: ctx.woId },
      { table: "work_order_steps", action: "UPDATE", recId: ctx.stepIds[0] },
      { table: "work_order_steps", action: "UPDATE", recId: ctx.stepIds[1] },
      { table: "work_order_steps", action: "UPDATE", recId: ctx.stepIds[2] },
      { table: "rolls", action: "CREATE", recId: ctx.rollIds[0] },
      { table: "rolls", action: "CREATE", recId: ctx.rollIds[1] },
      { table: "rolls", action: "UPDATE", recId: ctx.rollIds[0] },
      { table: "rolls", action: "UPDATE", recId: ctx.rollIds[1] },
      { table: "rolls", action: "UPDATE", recId: ctx.rollIds[2] },
      { table: "roll_operations", action: "CREATE", recId: ctx.rollIds[0] },
      { table: "roll_operations", action: "CREATE", recId: ctx.rollIds[1] },
      { table: "roll_movements", action: "CREATE", recId: ctx.rollIds[0] },
      { table: "roll_movements", action: "UPDATE", recId: ctx.rollIds[0] },
      { table: "traveler_cards", action: "CREATE", recId: ctx.cardId },
      { table: "traveler_card_scans", action: "CREATE", recId: ctx.cardId },
      { table: "subcontractor_dispatches", action: "CREATE", recId: ctx.woId },
      { table: "subcontractor_receipts", action: "CREATE", recId: ctx.woId },
      { table: "orders", action: "UPDATE", recId: ctx.id },
    ];
    if (ctx.shipmentId) {
      domainEvents.push(
        { table: "shipments", action: "CREATE", recId: ctx.shipmentId },
        { table: "shipments", action: "UPDATE", recId: ctx.shipmentId },
        { table: "sacks", action: "CREATE", recId: ctx.shipmentId },
        { table: "sack_allocations", action: "CREATE", recId: ctx.shipmentId },
        { table: "order_lines", action: "UPDATE", recId: ctx.lineIds[0] }
      );
    }
    if (status === OrderStatus.CANCELLED) {
      domainEvents.push(
        { table: "orders", action: "DELETE", recId: ctx.id },
        { table: "work_orders", action: "DELETE", recId: ctx.woId }
      );
    }
    for (let e = 0; e < domainEvents.length; e++) {
      const ev = domainEvents[e];
      logRows.push({
        id: uuid(),
        userId: pick(userIds, i + e),
        category: SystemLogCategory.DOMAIN,
        action: ev.action,
        tableName: ev.table,
        recordId: ev.recId,
        createdAt: plusMinutes(createdAt, e * 5),
        updatedAt: plusMinutes(createdAt, e * 5),
      });
    }
    // ~%15 ihtimalle 1 AUTH login + ara sıra SYSTEM event
    if (Math.random() < 0.15) {
      logRows.push({
        id: uuid(),
        userId: pick(userIds, i),
        category: SystemLogCategory.AUTH,
        action: "LOGIN_SUCCESS",
        tableName: "AUTH",
        recordId: "login",
        createdAt,
        updatedAt: createdAt,
      });
    }
    if (Math.random() < 0.02) {
      logRows.push({
        id: uuid(),
        userId: null,
        category: SystemLogCategory.SYSTEM,
        action: "ERROR",
        tableName: "SYSTEM",
        recordId: "-",
        createdAt,
        updatedAt: createdAt,
      });
    }

    // Bellek baskısını yönet: 5000 siparişte bir DB'ye flush et (FK sırası korunur).
    if (orderRows.length >= 5000 || i === TOTAL_ORDERS - 1) {
      await flush();
    }
  }

  // -------------------------------------------------------------------------
  // ANALYZE — planner istatistikleri tazelensin (EXPLAIN doğruluğu için kritik)
  // -------------------------------------------------------------------------
  console.log("ANALYZE çalıştırılıyor (planner istatistikleri)...");
  await prisma.$executeRawUnsafe("ANALYZE");

  console.log("\n=== ÜRETİLEN HACİM (gerçek count) ===");
  for (const [table, n] of Object.entries(totals)) {
    console.log(`  ${table.padEnd(26)} ${n.toLocaleString()}`);
  }
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  console.log(`  ${"TOPLAM SATIR".padEnd(26)} ${grand.toLocaleString()}`);
  console.log(`\nSüre: ${((Date.now() - tStart) / 1000).toFixed(1)}s\n`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("❌ seed-load-scale error:", e);
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
