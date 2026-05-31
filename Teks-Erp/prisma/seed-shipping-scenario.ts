// =============================================================================
// SEVKİYAT SENARYO SEED — tekrar çalıştırılabilir (idempotent) test verisi
// =============================================================================
// Önkoşul: `npm run seed` (master data: müşteri/şube/ürün/renk/kalite/istasyon).
// Bu script SADECE senaryo verisini (TST- prefix) üretir; her çalıştırmada önce
// kendi eski verisini siler, sonra temiz bir senaryo kurar.
//
// Çalıştır:  npx ts-node --project prisma/tsconfig.json prisma/seed-shipping-scenario.ts
//        ya: npm run seed:scenario
//
// Kapsadığı test aşamaları:
//   • WO picker (gap): bazı satırlar Açık>0 görünür, tahsisli olanlar gizli
//   • Tambur: açık kumaş + refakat kartı → cutOpenFabric/finalize (targetOrderLineId)
//   • Etiket: targetOrderLineId'li WAREHOUSE topları (müşteriye özel etiket)
//   • Paket: açık çuval + içinde top + paketlenmemiş WAREHOUSE topları
//   • Sevkiyat: kapalı çuval + PREPARING irsaliye (dispatch testi)
//   • Sipariş statüsü: kısmi sevk (PARTIAL_SHIPPED) örneği
// =============================================================================

import { PrismaClient } from "@prisma/client";
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

  // Senaryo roll'larını bul (barkodlu + açık kumaş + hedefli + çuvallı)
  const rolls = await prisma.roll.findMany({
    where: {
      OR: [
        { barcode: { startsWith: P } },
        stepIds.length ? { currentStepId: { in: stepIds } } : { id: "__none__" },
        stepIds.length ? { producedInStepId: { in: stepIds } } : { id: "__none__" },
        orderLineIds.length ? { targetOrderLineId: { in: orderLineIds } } : { id: "__none__" },
        sackIds.length ? { sackId: { in: sackIds } } : { id: "__none__" },
      ],
    },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);

  // Roll'a RESTRICT bağlı log tabloları ÖNCE silinmeli (movement/operation RESTRICT'tir).
  if (rollIds.length || stepIds.length) {
    const rollOrStep = {
      OR: [
        rollIds.length ? { rollId: { in: rollIds } } : { id: "__none__" },
        stepIds.length ? { workOrderStepId: { in: stepIds } } : { id: "__none__" },
      ],
    };
    await prisma.rollMovement.deleteMany({ where: rollOrStep });
    await prisma.rollOperation.deleteMany({ where: rollOrStep });
  }
  if (rollIds.length) {
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
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
  const o1 = await prisma.order.create({
    data: { orderNumber: `${P}0001`, customerId: arda.id, branchId: ardaIst.id, status: "APPROVED" },
  });
  const l1a = await prisma.orderLine.create({
    data: {
      orderId: o1.id, itemId: patos.id, colorId: mavi.id, quantity: 1000, width: 280,
      pieceLengthM: 400, cutNote: "Her 400 m'de bir kes", customerItemName: "Soft Patos",
    },
  });
  const l1b = await prisma.orderLine.create({
    data: { orderId: o1.id, itemId: patos.id, colorId: mavi.id, quantity: 500, width: 280 },
  });

  const o2 = await prisma.order.create({
    data: {
      orderNumber: `${P}0002`, customerId: arda.id, branchId: ardaAnk.id,
      status: "PARTIAL_SHIPPED", shippedQty: 300, // W5 (SHIPPED) ile tutarlı
    },
  });
  const l2a = await prisma.orderLine.create({
    data: { orderId: o2.id, itemId: patos.id, colorId: mavi.id, quantity: 600, width: 280, pieceLengthM: 300 },
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

  // --- WAREHOUSE topları (paket/etiket testi) ---
  // ARDA L1a'ya 2 top, Moda L3a'ya 1 top, 1 stok (hedefsiz)
  const w1 = await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0001`, initialQty: 400, currentQty: 400, status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", targetOrderLineId: l1a.id, createdById: adminId },
  });
  await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0002`, initialQty: 400, currentQty: 400, status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", targetOrderLineId: l1a.id, createdById: adminId },
  });
  await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0003`, initialQty: 400, currentQty: 400, status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", targetOrderLineId: l3a.id, createdById: adminId },
  });
  await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0004`, initialQty: 300, currentQty: 300, status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", targetOrderLineId: null, createdById: adminId },
  });

  // --- Açık çuval (paket akışı sürüyor) + içinde W1 ---
  const s1 = await prisma.sack.create({
    data: { sackNo: `${P}CV-0001`, customerId: arda.id, branchId: ardaIst.id, status: "OPEN" },
  });
  await prisma.roll.update({ where: { id: w1.id }, data: { sackId: s1.id } });

  // --- Kapalı çuval (tartıldı) + SHIPPED top + PREPARING irsaliye (dispatch testi) ---
  const w5 = await prisma.roll.create({
    data: { ...baseRoll, barcode: `${P}TOP-0005`, initialQty: 300, currentQty: 300, status: "SHIPPED", entrySource: "TAMBUR_SPLIT", targetOrderLineId: l2a.id, createdById: adminId },
  });
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `${P}IRS-0001`, customerId: arda.id, branchId: ardaAnk.id, status: "PREPARING",
      plateNumber: "34 TST 0001", driverName: "Test Şoför",
    },
  });
  const s2 = await prisma.sack.create({
    data: {
      sackNo: `${P}CV-0002`, customerId: arda.id, branchId: ardaAnk.id, status: "CLOSED",
      weightKg: 45.5, closedAt: new Date(), shipmentId: shipment.id,
      shipToName: ardaAnk.name, shipToAddress: ardaAnk.address, shipToCity: ardaAnk.city, shipToDistrict: ardaAnk.district,
    },
  });
  await prisma.roll.update({ where: { id: w5.id }, data: { sackId: s2.id } });

  // --- Özet ---
  console.log(`
✅ Sevkiyat senaryosu kuruldu (prefix: ${P})

  SİPARİŞLER
    ${P}0001  ARDA / İstanbul   L1a 1000m (her 400 kes, "Soft Patos") + L1b 500m
    ${P}0002  ARDA / Ankara     L2a 600m (kısmi sevk: 300 gitti → PARTIAL_SHIPPED)
    ${P}0003  Moda / İzmir      L3a 800m (4 eşit parça)

  İŞ EMRİ
    ${P}B-0001  çoklu sipariş (ARDA L1a 1000 + Moda L3a 800), hedef 2400 (600 stok fazlası)
    → WO picker testi: L1a & L3a tahsisli (Açık 0, gizli), L1b (500) & L2a (300) görünür

  TAMBUR (refakat kartı barkodu: ${P}RK-0001-BC)
    2 açık kumaş topu (1200m + 800m) tambur adımında → cutOpenFabric/finalize ile
    "kime?" seçip (L1a/L3a/stok) kes → targetOrderLineId + etiket testi

  DEPO / ETİKET (WAREHOUSE topları)
    ${P}TOP-0001 → ARDA L1a (çuval CV-0001 içinde)   ${P}TOP-0002 → ARDA L1a
    ${P}TOP-0003 → Moda L3a                          ${P}TOP-0004 → STOK (hedefsiz, manuel etiket testi)

  PAKET / SEVKİYAT
    Açık çuval ${P}CV-0001 (ARDA/İstanbul, içinde TOP-0001) → top ekle/tart/kapat testi
    Kapalı çuval ${P}CV-0002 (ARDA/Ankara, 45.5kg, TOP-0005) → irsaliye ${P}IRS-0001'e bağlı
    İrsaliye ${P}IRS-0001 (PREPARING, plaka 34 TST 0001) → dispatch testi

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
