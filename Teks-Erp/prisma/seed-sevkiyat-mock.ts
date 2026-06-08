// =============================================================================
// SEVKİYAT MOCK SEED — sevkiyata hazır test verisi (idempotent)
// =============================================================================
// Önkoşul: `npm run seed` (master data: müşteri/şube/ürün/renk/kalite).
// Bu script SADECE sevkiyat mock verisini (SVKM- prefix) üretir; her çalıştırmada
// önce kendi eski verisini siler, sonra temiz kurar.
//
// Çalıştır:  npx ts-node --project prisma/tsconfig.json prisma/seed-sevkiyat-mock.ts
//        ya: npm run seed:sevkiyat
//
// Kapsanan sevkiyat durumları (güncel Çuval Depo / Kapı Önü modeli):
//   • SERBEST DEPO   — WAREHOUSE topları, hiçbir sevkiyata bağlı değil (taranmaya hazır)
//   • ÇUVALLAMA       — PREPARING sevkiyat: açık çuvallar + içine okutulmuş toplar (commit YOK)
//   • ÇUVAL DEPO      — READY sevkiyat: tüm çuvallar tartılı/kodlu, karşılanma işlendi (commit)
//   • KAPI ÖNÜ        — AT_DOOR sevkiyat: kamyon bekliyor, plaka/şoför girili, commit'li
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const P = "SVKM-"; // marker prefix — reset bu prefix'e göre çalışır

function req<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(
      `Master data eksik: "${name}" bulunamadı. Önce \`npm run seed\` çalıştır.`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// 1) RESET — bu mock'un eski verisini FK-güvenli sırayla sil
// ---------------------------------------------------------------------------
async function reset() {
  // Roll FK'leri (sack/shipment) önce temizlensin diye toplar ilk silinir.
  const rolls = await prisma.roll.findMany({
    where: { barcode: { startsWith: P } },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);
  if (rollIds.length) {
    // Roll'a RESTRICT bağlı log tabloları (güvenlik — bu script log üretmez ama yine de)
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  }

  // Çuvallar (artık hiçbir top bağlı değil)
  await prisma.sack.deleteMany({ where: { sackNo: { startsWith: P } } });

  // Sevkiyatlar — shipmentOrder + shipmentAllocation onDelete:Cascade ile gider
  await prisma.shipment.deleteMany({ where: { shipmentNo: { startsWith: P } } });

  // Siparişler — orderLine cascade (allocation'lar yukarıda zaten gitti)
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: P } } });
}

// ---------------------------------------------------------------------------
// 2) SEED — mock veriyi kur
// ---------------------------------------------------------------------------
async function seed() {
  // --- Master data lookup (seed.ts'ten) ---
  const arda = req(await prisma.customer.findUnique({ where: { code: "MUS-001" } }), "Müşteri MUS-001");
  const moda = req(await prisma.customer.findUnique({ where: { code: "MUS-002" } }), "Müşteri MUS-002");
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
  const lacivert = req(await prisma.color.findUnique({ where: { code: "LACIVERT" } }), "Renk LACIVERT");
  const kirmizi = req(await prisma.color.findUnique({ where: { code: "KIRMIZI" } }), "Renk KIRMIZI");
  const beyaz = req(await prisma.color.findUnique({ where: { code: "BEYAZ" } }), "Renk BEYAZ");
  const grade1 = req(
    await prisma.qualityGrade.findUnique({ where: { code: "1.KALITE" } }),
    "Kalite 1.KALITE"
  );
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const adminId = admin?.id ?? null;

  // WAREHOUSE topu yaratan kısayol — sevke hazır, kalite 1.KALITE
  const makeRoll = (
    barcode: string,
    colorId: string | null,
    width: number,
    qty: number,
    extra: { shipmentId?: string; sackId?: string } = {}
  ) =>
    prisma.roll.create({
      data: {
        barcode,
        itemId: patos.id,
        colorId,
        width,
        initialQty: qty,
        currentQty: qty,
        status: "WAREHOUSE",
        qualityGrade: grade1.code,
        qualityGradeId: grade1.id,
        entrySource: "TAMBUR_SPLIT",
        createdById: adminId,
        ...extra,
      },
      select: { id: true, currentQty: true },
    });

  // =========================================================================
  // A) SERBEST DEPO — sevkiyata bağlı olmayan WAREHOUSE topları (taranmaya hazır)
  // =========================================================================
  await makeRoll(`${P}WH-01`, mavi.id, 280, 420);
  await makeRoll(`${P}WH-02`, mavi.id, 280, 380);
  await makeRoll(`${P}WH-03`, lacivert.id, 220, 500);
  await makeRoll(`${P}WH-04`, kirmizi.id, 150, 300);
  await makeRoll(`${P}WH-05`, beyaz.id, 280, 450);
  await makeRoll(`${P}WH-06`, mavi.id, 280, 410);

  // =========================================================================
  // B) ÇUVALLAMA AŞAMASINDA — PREPARING sevkiyat (ARDA / İstanbul)
  //    Açık çuvallar + içine okutulmuş toplar. Commit YOK (shippedQty 0).
  // =========================================================================
  const oPrep = await prisma.order.create({
    data: { orderNumber: `${P}O-PREP`, customerId: arda.id, branchId: ardaIst.id, status: "APPROVED" },
  });
  await prisma.orderLine.create({
    data: { orderId: oPrep.id, itemId: patos.id, colorId: mavi.id, quantity: 2000, width: 280 },
  });

  const shPrep = await prisma.shipment.create({
    data: {
      shipmentNo: `${P}SVK-PREP`,
      customerId: arda.id,
      branchId: ardaIst.id,
      status: "PREPARING",
      orders: { create: [{ orderId: oPrep.id }] },
    },
  });
  // Çuval 1 — tartılı + kodlu (operatör bitirmiş gibi), 2 top içinde
  const cvP1 = await prisma.sack.create({
    data: { sackNo: `${P}CV-P1`, shipmentId: shPrep.id, seq: 1, weightKg: 48.2, manualCode: "ARDA-IST-01" },
  });
  await makeRoll(`${P}PREP-01`, mavi.id, 280, 400, { shipmentId: shPrep.id, sackId: cvP1.id });
  await makeRoll(`${P}PREP-02`, mavi.id, 280, 400, { shipmentId: shPrep.id, sackId: cvP1.id });
  // Çuval 2 — henüz tartılmamış/kodlanmamış (açık çuval), 1 top içinde
  const cvP2 = await prisma.sack.create({
    data: { sackNo: `${P}CV-P2`, shipmentId: shPrep.id, seq: 2 },
  });
  await makeRoll(`${P}PREP-03`, mavi.id, 280, 380, { shipmentId: shPrep.id, sackId: cvP2.id });

  // =========================================================================
  // C) ÇUVAL DEPO — READY sevkiyat (ARDA / Ankara)
  //    Tüm çuvallar tartılı + kodlu, karşılanma (commit) işlendi.
  // =========================================================================
  const oReady = await prisma.order.create({
    data: { orderNumber: `${P}O-READY`, customerId: arda.id, branchId: ardaAnk.id, status: "APPROVED" },
  });
  const lReady = await prisma.orderLine.create({
    data: { orderId: oReady.id, itemId: patos.id, colorId: lacivert.id, quantity: 1500, width: 220 },
  });

  const shReady = await prisma.shipment.create({
    data: {
      shipmentNo: `${P}SVK-READY`,
      customerId: arda.id,
      branchId: ardaAnk.id,
      status: "READY",
      readyAt: new Date(),
      orders: { create: [{ orderId: oReady.id }] },
    },
  });
  const cvR1 = await prisma.sack.create({
    data: { sackNo: `${P}CV-R1`, shipmentId: shReady.id, seq: 1, weightKg: 52.0, manualCode: "ARDA-ANK-01" },
  });
  await makeRoll(`${P}READY-01`, lacivert.id, 220, 450, { shipmentId: shReady.id, sackId: cvR1.id });
  await makeRoll(`${P}READY-02`, lacivert.id, 220, 450, { shipmentId: shReady.id, sackId: cvR1.id });
  const cvR2 = await prisma.sack.create({
    data: { sackNo: `${P}CV-R2`, shipmentId: shReady.id, seq: 2, weightKg: 49.5, manualCode: "ARDA-ANK-02" },
  });
  await makeRoll(`${P}READY-03`, lacivert.id, 220, 400, { shipmentId: shReady.id, sackId: cvR2.id });

  // Commit: karşılanma 1300m → satır shippedQty + tahsis + sipariş status (PARTIAL_SHIPPED)
  const readyLoaded = 450 + 450 + 400;
  await prisma.shipmentAllocation.create({
    data: { shipmentId: shReady.id, orderLineId: lReady.id, qty: readyLoaded },
  });
  await prisma.orderLine.update({ where: { id: lReady.id }, data: { shippedQty: readyLoaded } });
  await prisma.order.update({
    where: { id: oReady.id },
    data: { shippedQty: readyLoaded, status: "PARTIAL_SHIPPED" },
  });

  // =========================================================================
  // D) KAPI ÖNÜ — AT_DOOR sevkiyat (Moda / İzmir)
  //    Kamyon bekliyor, plaka/şoför girili, commit'li.
  // =========================================================================
  const oDoor = await prisma.order.create({
    data: { orderNumber: `${P}O-DOOR`, customerId: moda.id, branchId: modaIzm.id, status: "APPROVED" },
  });
  const lDoor = await prisma.orderLine.create({
    data: { orderId: oDoor.id, itemId: patos.id, colorId: kirmizi.id, quantity: 1000, width: 150 },
  });

  const shDoor = await prisma.shipment.create({
    data: {
      shipmentNo: `${P}SVK-DOOR`,
      customerId: moda.id,
      branchId: modaIzm.id,
      status: "AT_DOOR",
      readyAt: new Date(),
      plateNumber: "35 SVK 0035",
      driverName: "Mehmet Yıldız",
      carrier: "Hızlı Lojistik",
      orders: { create: [{ orderId: oDoor.id }] },
    },
  });
  const cvD1 = await prisma.sack.create({
    data: { sackNo: `${P}CV-D1`, shipmentId: shDoor.id, seq: 1, weightKg: 41.0, manualCode: "MODA-IZM-01" },
  });
  await makeRoll(`${P}DOOR-01`, kirmizi.id, 150, 300, { shipmentId: shDoor.id, sackId: cvD1.id });
  await makeRoll(`${P}DOOR-02`, kirmizi.id, 150, 350, { shipmentId: shDoor.id, sackId: cvD1.id });

  const doorLoaded = 300 + 350;
  await prisma.shipmentAllocation.create({
    data: { shipmentId: shDoor.id, orderLineId: lDoor.id, qty: doorLoaded },
  });
  await prisma.orderLine.update({ where: { id: lDoor.id }, data: { shippedQty: doorLoaded } });
  await prisma.order.update({
    where: { id: oDoor.id },
    data: { shippedQty: doorLoaded, status: "PARTIAL_SHIPPED" },
  });

  // --- Özet ---
  console.log(`
✅ Sevkiyat mock verisi kuruldu (prefix: ${P})

  SERBEST DEPO (taranmaya hazır WAREHOUSE topları)
    ${P}WH-01..06 → 6 top (MAVI 280 / LACIVERT 220 / KIRMIZI 150 / BEYAZ 280), 2460m

  ÇUVALLAMA AŞAMASINDA  → ${P}SVK-PREP  (ARDA / İstanbul, PREPARING)
    Çuval ${P}CV-P1 (48.2kg, "ARDA-IST-01") → 2 top (800m)
    Çuval ${P}CV-P2 (tartılmamış, açık)      → 1 top (380m)
    Karşılanma YOK (commit henüz değil) — sipariş APPROVED

  ÇUVAL DEPO            → ${P}SVK-READY (ARDA / Ankara, READY)
    Çuval ${P}CV-R1 (52.0kg, "ARDA-ANK-01") → 2 top (900m)
    Çuval ${P}CV-R2 (49.5kg, "ARDA-ANK-02") → 1 top (400m)
    Karşılanma 1300m işlendi → sipariş PARTIAL_SHIPPED (1500 talep)

  KAPI ÖNÜ             → ${P}SVK-DOOR  (Moda / İzmir, AT_DOOR)
    Çuval ${P}CV-D1 (41.0kg, "MODA-IZM-01") → 2 top (650m)
    Plaka 35 SVK 0035 / Şoför Mehmet Yıldız → "Alındı" ile DISPATCH testi
    Karşılanma 650m işlendi → sipariş PARTIAL_SHIPPED (1000 talep)

  Reset: bu scripti tekrar çalıştır — tüm ${P} verisi silinip yeniden kurulur.
`);
}

async function main() {
  console.log("🧹 Eski sevkiyat mock verisi temizleniyor...");
  await reset();
  console.log("🌱 Sevkiyat mock kuruluyor...");
  await seed();
}

main()
  .catch((e) => {
    console.error("❌ Sevkiyat mock seed hatası:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
