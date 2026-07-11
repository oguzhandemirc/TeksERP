// =============================================================================
// SEVKİYAT SENARYO SEED — tekrar çalıştırılabilir (idempotent) test verisi
// =============================================================================
// Önkoşul: `npm run seed` (master data: müşteri/şube/ürün/renk/kalite/istasyon).
// Bu script SADECE senaryo verisini (TST- prefix) üretir; her çalıştırmada önce
// kendi eski verisini siler, sonra temiz bir senaryo kurar.
//
// Çalıştır:  npx tsx prisma/seed-shipping-scenario.ts
//        ya: npm run seed:scenario
//
// ÇUVAL HAVUZU (B) MODELİ — kapsadığı test aşamaları:
//   • WO picker (gap): bazı satırlar Açık>0 görünür, tahsisli olanlar gizli
//   • Tambur: açık kumaş + refakat kartı → cutOpenFabric/finalize (targetOrderLineId)
//   • Etiket: WAREHOUSE topları — etiket müşterisi baskı anında seçilir (top→sipariş bağı YOK)
//   • Paket: AÇIK çuval (sealedAt=null) + içinde top + paketlenmemiş WAREHOUSE topları
//   • Çuval havuzu: MÜHÜRLÜ + sevkiyatsız çuval → SackAllocation ile packedQty rezervi
//   • Sevkiyat (PLANNED): mühürlü çuval bir sevkiyata atanmış (dispatch testi)
//   • Sevkiyat (DISPATCHED): sevk edilmiş çuval → shippedQty + PARTIAL_SHIPPED örneği
//
// Karşılanma denormları (OrderLine/Order.packedQty & shippedQty) SackAllocation
// defteriyle ELDE TUTARLI yazılır (bkz. order-status.helper karşılanma kuralları):
//   shippedQty = Σ SackAllocation.qty (çuval DISPATCHED sevkiyatta)
//   packedQty  = Σ SackAllocation.qty (çuval havuzda VEYA PLANNED/AT_DOOR sevkiyatta)
// =============================================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const P = "TST-"; // marker prefix — reset bu prefix'e göre çalışır

function req<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(
      `Master data eksik: "${name}" bulunamadı. Önce \`npm run seed\` çalıştır.`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// 1) RESET — bu senaryonun eski verisini FK-güvenli sırayla sil
// ---------------------------------------------------------------------------
async function reset() {
  const orders = await prisma.order.findMany({
    where: { orderNumber: { startsWith: P } },
    select: { id: true, lines: { select: { id: true } } },
  });
  const orderIds = orders.map((o) => o.id);
  const orderLineIds = orders.flatMap((o) => o.lines.map((l) => l.id));

  const wos = await prisma.workOrder.findMany({
    where: { batchNumber: { startsWith: P } },
    select: { id: true, steps: { select: { id: true } } },
  });
  const woIds = wos.map((w) => w.id);
  const stepIds = wos.flatMap((w) => w.steps.map((s) => s.id));

  const sacks = await prisma.sack.findMany({
    where: { sackNo: { startsWith: P } },
    select: { id: true },
  });
  const sackIds = sacks.map((s) => s.id);

  const shipments = await prisma.shipment.findMany({
    where: { shipmentNo: { startsWith: P } },
    select: { id: true },
  });
  const shipmentIds = shipments.map((s) => s.id);

  // Senaryo roll'larını bul (barkodlu + açık kumaş + hedefli + çuvallı + sevkiyatlı).
  // OR dizisini KOŞULLU kur — boş branch'te `{ id: "__none__" }` sentineli Prisma 7 pg
  // adapter'ında P2007 (invalid uuid) fırlatır; hiç dolmayan filtreyi eklemeyerek kaçın.
  const rollOr: Prisma.RollWhereInput[] = [{ barcode: { startsWith: P } }];
  if (stepIds.length) {
    rollOr.push({ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } });
  }
  if (sackIds.length) rollOr.push({ sackId: { in: sackIds } });
  if (shipmentIds.length) rollOr.push({ shipmentId: { in: shipmentIds } });
  const rolls = await prisma.roll.findMany({ where: { OR: rollOr }, select: { id: true } });
  const rollIds = rolls.map((r) => r.id);

  // SackAllocation ÖNCE (Restrict: çuval; ayrıca orderLine'a bağlı) — sil ki sack/order
  // silinebilsin. Tahsislerimizin tümü TST çuvallarına bağlı; orderLine de savunma için.
  if (sackIds.length) {
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
  }
  if (orderLineIds.length) {
    await prisma.sackAllocation.deleteMany({ where: { orderLineId: { in: orderLineIds } } });
  }

  // Roll'a RESTRICT bağlı log tabloları ÖNCE silinmeli (movement/operation RESTRICT'tir).
  if (rollIds.length) {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  }
  if (stepIds.length) {
    await prisma.rollMovement.deleteMany({ where: { workOrderStepId: { in: stepIds } } });
    await prisma.rollOperation.deleteMany({ where: { workOrderStepId: { in: stepIds } } });
  }
  if (rollIds.length) {
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  }

  // ShipmentOrder (Restrict: shipment + order) — shipment/order silinmeden önce sil.
  if (shipmentIds.length) {
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
  }

  if (woIds.length) {
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  }
  if (orderIds.length) {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } }); // lines cascade
  }
  if (sackIds.length) {
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
  }
  await prisma.shipment.deleteMany({ where: { shipmentNo: { startsWith: P } } });
}

// ---------------------------------------------------------------------------
// 2) SEED — senaryoyu kur
// ---------------------------------------------------------------------------
async function seed() {
  // --- Master data lookup (seed.ts'ten) ---
  const arda = req(
    await prisma.customer.findUnique({ where: { code: "MUS-001" } }),
    "Müşteri MUS-001"
  );
  const moda = req(
    await prisma.customer.findUnique({ where: { code: "MUS-002" } }),
    "Müşteri MUS-002"
  );
  const ardaIst = req(
    await prisma.customerBranch.findFirst({ where: { customerId: arda.id, code: "IST" } }),
    "ARDA İstanbul şubesi (IST)"
  );
  const ardaAnk = req(
    await prisma.customerBranch.findFirst({ where: { customerId: arda.id, code: "ANK" } }),
    "ARDA Ankara şubesi (ANK)"
  );
  const modaIzm = req(
    await prisma.customerBranch.findFirst({ where: { customerId: moda.id, code: "IZM" } }),
    "Moda İzmir şubesi (IZM)"
  );
  const patos = req(await prisma.item.findUnique({ where: { code: "PATOS" } }), "Ürün PATOS");
  const mavi = req(await prisma.color.findUnique({ where: { code: "MAVI" } }), "Renk MAVI");
  const grade1 = req(
    await prisma.qualityGrade.findUnique({ where: { code: "1.KALITE" } }),
    "Kalite 1.KALITE"
  );
  const tambur = req(
    await prisma.station.findFirst({ where: { kind: "TAMBUR" } }),
    "TAMBUR istasyonu"
  );
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const adminId = admin?.id ?? null;

  // Ortak roll alanları (PATOS / MAVI / 280 en / 1.KALITE)
  const baseRoll = {
    itemId: patos.id,
    colorId: mavi.id,
    width: 280,
    qualityGrade: grade1.code,
    qualityGradeId: grade1.id,
  };

  // --- Siparişler + kalemler ---
  // Karşılanma denormları (packedQty / shippedQty) SackAllocation'larla ELDE tutarlı yazılır:
  //   o1 (ARDA/IST): l1a packed 400 (PLANNED sevkiyat), l1b packed 500 (havuz) → APPROVED
  //   o2 (ARDA/ANK): l2a shipped 300 (DISPATCHED) → PARTIAL_SHIPPED
  //   o3 (Moda/IZM): karşılanma yok → APPROVED
  const o1 = await prisma.order.create({
    data: {
      orderNumber: `${P}0001`, customerId: arda.id, branchId: ardaIst.id, status: "APPROVED",
      packedQty: 900, // l1a 400 + l1b 500
    },
  });
  const l1a = await prisma.orderLine.create({
    data: {
      orderId: o1.id, itemId: patos.id, colorId: mavi.id, quantity: 1000, width: 280,
      pieceLengthM: 400, cutNote: "Her 400 m'de bir kes", customerItemName: "Soft Patos",
      packedQty: 400, // CV-0003 (PLANNED sevkiyat) rezervi
    },
  });
  const l1b = await prisma.orderLine.create({
    data: {
      orderId: o1.id, itemId: patos.id, colorId: mavi.id, quantity: 500, width: 280,
      packedQty: 500, // CV-0004 (mühürlü havuz çuvalı) rezervi
    },
  });

  const o2 = await prisma.order.create({
    data: {
      orderNumber: `${P}0002`, customerId: arda.id, branchId: ardaAnk.id,
      status: "PARTIAL_SHIPPED", shippedQty: 300, // CV-0002 (DISPATCHED) ile tutarlı
    },
  });
  const l2a = await prisma.orderLine.create({
    data: {
      orderId: o2.id, itemId: patos.id, colorId: mavi.id, quantity: 600, width: 280, pieceLengthM: 300,
      shippedQty: 300, // CV-0002 sevk defteri
    },
  });

  const o3 = await prisma.order.create({
    data: { orderNumber: `${P}0003`, customerId: moda.id, branchId: modaIzm.id, status: "APPROVED" },
  });
  const l3a = await prisma.orderLine.create({
    data: {
      orderId: o3.id, itemId: patos.id, colorId: mavi.id, quantity: 800, width: 280,
      pieceLengthM: 400, cutNote: "4 eşit parça",
    },
  });

  // --- İş emri (çoklu sipariş: ARDA L1a + Moda L3a) + tambur adımı + refakat kartı ---
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `${P}B-0001`,
      type: "ORDER_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: patos.id,
      targetColorId: mavi.id,
      width: 280,
      targetQuantity: 2400, // 1000 + 800 sipariş + 600 stok fazlası
      foldType: "2-KAT",
      steps: { create: [{ stationId: tambur.id, stepSequence: 1 }] },
      orderLinks: {
        create: [
          { orderLineId: l1a.id, allocatedQty: 1000 },
          { orderLineId: l3a.id, allocatedQty: 800 },
        ],
      },
    },
    include: { steps: true },
  });
  const tamburStep = wo.steps[0];

  await prisma.travelerCard.create({
    data: {
      cardNumber: `${P}RK-0001`,
      barcode: `${P}RK-0001-BC`,
      workOrderId: wo.id,
      status: "ACTIVE",
      version: 1,
      printedById: adminId,
    },
  });

  // --- Açık kumaş topları (tambur'da kesime hazır) — barcode=null, IN_PRODUCTION ---
  for (const qty of [1200, 800]) {
    const of = await prisma.roll.create({
      data: {
        ...baseRoll,
        barcode: null,
        initialQty: qty,
        currentQty: qty,
        status: "IN_PRODUCTION",
        entrySource: "SUBCONTRACTOR_RETURN",
        currentStepId: tamburStep.id,
        producedInStepId: tamburStep.id,
        createdById: adminId,
      },
    });
    await prisma.rollMovement.create({
      data: { rollId: of.id, workOrderStepId: tamburStep.id, qtyIn: qty, operatorId: adminId },
    });
  }

  // --- Sevkiyatlar (çuvallar bunlara atanmadan ÖNCE var olmalı) ---
  // IRS-0001: DISPATCHED (o2 sevk edildi) — PARTIAL_SHIPPED örneği
  const shipDispatched = await prisma.shipment.create({
    data: {
      shipmentNo: `${P}IRS-0001`, customerId: arda.id, branchId: ardaAnk.id, status: "DISPATCHED",
      plateNumber: "34 TST 0001", driverName: "Test Şoför",
      dispatchedAt: new Date(), dispatchedById: adminId,
    },
  });
  // IRS-0002: PLANNED (mühürlü çuval sevkiyata atandı) — dispatch testi
  const shipPlanned = await prisma.shipment.create({
    data: {
      shipmentNo: `${P}IRS-0002`, customerId: arda.id, branchId: ardaIst.id, status: "PLANNED",
      plateNumber: "34 TST 0002", driverName: "Test Şoför 2",
    },
  });

  // --- Çuvallar (havuz + sevkiyat) ---
  // CV-0001: AÇIK çuval (sealedAt=null, sevkiyatsız) — paketleme akışı sürüyor
  const s1 = await prisma.sack.create({
    data: { sackNo: `${P}CV-0001`, customerId: arda.id, branchId: ardaIst.id },
  });
  // CV-0002: MÜHÜRLÜ + DISPATCHED sevkiyatta (o2 sevk edildi)
  const s2 = await prisma.sack.create({
    data: {
      sackNo: `${P}CV-0002`, customerId: arda.id, branchId: ardaAnk.id,
      shipmentId: shipDispatched.id, seq: 1, manualCode: `${P}AMB-0002`,
      weightKg: 45.5, weighedById: adminId, weighedAt: new Date(),
      sealedAt: new Date(), sealedById: adminId,
    },
  });
  // CV-0003: MÜHÜRLÜ + PLANNED sevkiyatta (dispatch testi)
  const s3 = await prisma.sack.create({
    data: {
      sackNo: `${P}CV-0003`, customerId: arda.id, branchId: ardaIst.id,
      shipmentId: shipPlanned.id, seq: 1, manualCode: `${P}AMB-0003`,
      weightKg: 52.0, weighedById: adminId, weighedAt: new Date(),
      sealedAt: new Date(), sealedById: adminId,
    },
  });
  // CV-0004: MÜHÜRLÜ + HAVUZDA (shipmentId=null, seq=null) — packedQty rezervi
  const s4 = await prisma.sack.create({
    data: {
      sackNo: `${P}CV-0004`, customerId: arda.id, branchId: ardaIst.id,
      manualCode: `${P}AMB-0004`,
      weightKg: 60.0, weighedById: adminId, weighedAt: new Date(),
      sealedAt: new Date(), sealedById: adminId,
    },
  });

  // --- WAREHOUSE / SHIPPED topları (paket/etiket/sevkiyat testi) ---
  // GEVŞEK MODEL: top→sipariş bağı YOK (Roll.targetOrderLineId kalktı). Toplar spec
  // (PATOS/MAVI/280) bazında fungible; hangi siparişe sayıldığı SackAllocation defterinde.
  // Composite FK invariant: çuvaldaki top sevkiyata bağlıysa Roll.shipmentId =
  // Sack.shipmentId olmalı (sacks(id, shipmentId) hedefli DEFERRABLE FK). Havuz/açık
  // çuval toplarında shipmentId=null → FK atlanır (MATCH SIMPLE).
  await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0001`, initialQty: 400, currentQty: 400, status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", sackId: s1.id, createdById: adminId },
  });
  await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0002`, initialQty: 400, currentQty: 400, status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", createdById: adminId },
  });
  await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0003`, initialQty: 400, currentQty: 400, status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", createdById: adminId },
  });
  await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0004`, initialQty: 300, currentQty: 300, status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", createdById: adminId },
  });
  // CV-0002 içeriği (DISPATCHED) → SHIPPED; shipmentId çuvalınkiyle eşit.
  await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0005`, initialQty: 300, currentQty: 300, status: "SHIPPED", entrySource: "TAMBUR_SPLIT", sackId: s2.id, shipmentId: shipDispatched.id, createdById: adminId },
  });
  // CV-0003 içeriği (PLANNED) → WAREHOUSE; shipmentId çuvalınkiyle eşit.
  await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0006`, initialQty: 400, currentQty: 400, status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", sackId: s3.id, shipmentId: shipPlanned.id, createdById: adminId },
  });
  // CV-0004 içeriği (havuz) → WAREHOUSE; shipmentId=null.
  await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0007`, initialQty: 500, currentQty: 500, status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", sackId: s4.id, createdById: adminId },
  });

  // --- SackAllocation defteri (çuval metrajı ↔ sipariş satırı) ---
  //   CV-0002 (DISPATCHED) → l2a 300 : shippedQty
  //   CV-0003 (PLANNED)    → l1a 400 : packedQty (donmuş)
  //   CV-0004 (havuz)      → l1b 500 : packedQty (rezerv)
  await prisma.sackAllocation.createMany({
    data: [
      { sackId: s2.id, orderLineId: l2a.id, qty: 300 },
      { sackId: s3.id, orderLineId: l1a.id, qty: 400 },
      { sackId: s4.id, orderLineId: l1b.id, qty: 500 },
    ],
  });

  // --- ShipmentOrder (donmuş tahsislerden türeyen sipariş kümesi) ---
  //   isActive: PLANNED/AT_DOOR → true; DISPATCHED/CANCELLED → false (app katmanı kuralı).
  await prisma.shipmentOrder.createMany({
    data: [
      { shipmentId: shipDispatched.id, orderId: o2.id, isActive: false },
      { shipmentId: shipPlanned.id, orderId: o1.id, isActive: true },
    ],
  });

  // --- Özet ---
  console.log(`
✅ Sevkiyat senaryosu kuruldu (çuval havuzu B modeli, prefix: ${P})

  SİPARİŞLER
    ${P}0001  ARDA / İstanbul   L1a 1000m (her 400 kes, "Soft Patos") + L1b 500m
              → packedQty 900 (l1a 400 PLANNED + l1b 500 havuz), APPROVED
    ${P}0002  ARDA / Ankara     L2a 600m (300 sevk edildi → PARTIAL_SHIPPED)
    ${P}0003  Moda / İzmir      L3a 800m (4 eşit parça), APPROVED

  İŞ EMRİ
    ${P}B-0001  çoklu sipariş (ARDA L1a 1000 + Moda L3a 800), hedef 2400 (600 stok fazlası)
    → WO picker testi: L1a & L3a tahsisli (Açık 0, gizli), L1b (500) & L2a görünür

  TAMBUR (refakat kartı barkodu: ${P}RK-0001-BC)
    2 açık kumaş topu (1200m + 800m) tambur adımında → cutOpenFabric/finalize ile kes;
    etiket müşterisi baskı anında seçilir (top→sipariş bağı yok)

  DEPO / ETİKET (WAREHOUSE topları — PATOS/MAVI/280, spec bazında fungible)
    ${P}TOP-0001 (açık çuval CV-0001 içinde)   ${P}TOP-0002 / ${P}TOP-0003 / ${P}TOP-0004 (serbest depo)
    → etiket müşterisi baskı anında seçilir (manuel/müşteriye özel etiket testi)

  ÇUVAL HAVUZU / PAKET / SEVKİYAT
    Açık çuval   ${P}CV-0001 (ARDA/İstanbul, sealedAt=null, TOP-0001) → top ekle/tart/mühürle testi
    Havuz çuvalı ${P}CV-0004 (ARDA/İstanbul, mühürlü, sevkiyatsız, TOP-0007) → l1b packedQty 500
    PLANNED       ${P}IRS-0002 (ARDA/İstanbul) ← CV-0003 (TOP-0006) → l1a packedQty 400, dispatch testi
    DISPATCHED    ${P}IRS-0001 (ARDA/Ankara)   ← CV-0002 (TOP-0005 SHIPPED) → l2a shippedQty 300

  Reset: bu scripti tekrar çalıştır — tüm ${P} verisi silinip yeniden kurulur.
`);
}

async function main() {
  console.log("🧹 Eski senaryo verisi temizleniyor...");
  await reset();
  console.log("🌱 Senaryo kuruluyor...");
  await seed();
}

main()
  .catch((e) => {
    console.error("❌ Senaryo seed hatası:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
