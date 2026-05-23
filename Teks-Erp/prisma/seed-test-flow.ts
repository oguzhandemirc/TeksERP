// =============================================================================
// TeksERP - Boyahane (Fason Kabul) → Tambur Test Seed
// =============================================================================
// Tek ürün ("Patos"), izin verilen renk/özellik listeleri, sipariş + iş emri,
// hammadde rulo + boyahaneye gönderilmiş bekleyen rulolar oluşturur. Akış:
//
//   KK1 (girdi, COMPLETED) → Boyahane (Fason Sevk yapıldı, AT_SUBCONTRACTOR
//   bekliyor) → Fason Kabul ile renk/özellik kazanır → KK2/Kurşun → Tambur
//   → Depo (WAREHOUSE) → Tartı/Paket → Sevkiyat
//
// Çalıştırma:
//   cd Teks-Erp
//   npx ts-node prisma/seed-test-flow.ts
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Test akışı seed'i başlıyor (Patos + Mavi + Yanmaz)...\n");

  // ---------------------------------------------------------------------------
  // 0. ÖN KOŞUL: stations (upsert), admin user, "renk veren" kategori (Boyahane)
  // ---------------------------------------------------------------------------
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  if (!admin) {
    throw new Error("admin kullanıcısı yok. Önce `npm run seed` çalıştırın.");
  }

  const stKK1 = await prisma.station.upsert({
    where: { code: "KK1" },
    update: {},
    create: { code: "KK1", name: "Kalite Kontrol 1", kind: "RAW_QC", type: "INTERNAL" },
  });
  const stBoyahane = await prisma.station.upsert({
    where: { code: "BOYAHANE" },
    update: {},
    create: {
      code: "BOYAHANE",
      name: "Boyahane (Fason)",
      kind: "SUBCONTRACTOR",
      type: "EXTERNAL",
    },
  });
  const stKursun = await prisma.station.upsert({
    where: { code: "KK2" },
    update: {},
    create: { code: "KK2", name: "Kurşun + KK2", kind: "PROCESS_QC", type: "INTERNAL" },
  });
  const stTambur = await prisma.station.upsert({
    where: { code: "TAMBUR" },
    update: {},
    create: { code: "TAMBUR", name: "Tambur", kind: "TAMBUR", type: "INTERNAL" },
  });

  // Boyahane kategorisi — hem renk hem özellik veren fason (her iki bayrak true)
  let boyahaneKategorisi = await prisma.subcontractorCategory.findUnique({
    where: { code: "BOYAHANE" },
  });
  if (!boyahaneKategorisi) {
    boyahaneKategorisi = await prisma.subcontractorCategory.create({
      data: {
        code: "BOYAHANE",
        name: "Boyahane",
        description: "Renk + özellik veren fason",
        appliesColor: true,
        appliesProperty: true,
      },
    });
  } else if (
    !boyahaneKategorisi.appliesColor ||
    !boyahaneKategorisi.appliesProperty
  ) {
    boyahaneKategorisi = await prisma.subcontractorCategory.update({
      where: { id: boyahaneKategorisi.id },
      data: { appliesColor: true, appliesProperty: true },
    });
  }
  // Bir Boyahane fason firması (test için)
  let boyaFirma = await prisma.subcontractor.findUnique({
    where: { code: "BOY-001" },
  });
  if (!boyaFirma) {
    boyaFirma = await prisma.subcontractor.create({
      data: { code: "BOY-001", name: "Anadolu Boya Ltd." },
    });
  }
  await prisma.subcontractorToCategory.upsert({
    where: {
      subcontractorId_categoryId: {
        subcontractorId: boyaFirma.id,
        categoryId: boyahaneKategorisi.id,
      },
    },
    update: {},
    create: {
      subcontractorId: boyaFirma.id,
      categoryId: boyahaneKategorisi.id,
    },
  });

  console.log("✅ İstasyonlar + Boyahane kategorisi (appliesColor + appliesProperty) hazır");

  const stamp = Date.now().toString().slice(-6);

  // ---------------------------------------------------------------------------
  // 1. RENK + ÖZELLİK + ÜRÜN (Patos) + ALLOWED LIST
  // ---------------------------------------------------------------------------
  const colorMavi = await prisma.color.upsert({
    where: { code: "MAVI" },
    update: {},
    create: { code: "MAVI", name: "Mavi", hex: "#1E40AF", sortOrder: 10 },
  });
  const colorKirmizi = await prisma.color.upsert({
    where: { code: "KIRMIZI" },
    update: {},
    create: { code: "KIRMIZI", name: "Kırmızı", hex: "#DC2626", sortOrder: 20 },
  });
  await prisma.color.upsert({
    where: { code: "SIYAH" },
    update: {},
    create: { code: "SIYAH", name: "Siyah", hex: "#111827", sortOrder: 30 },
  });

  const propYanmaz = await prisma.fabricProperty.upsert({
    where: { code: "YANMAZ" },
    update: {},
    create: { code: "YANMAZ", name: "Yanmazlık", category: "FINISH", sortOrder: 10 },
  });
  await prisma.fabricProperty.upsert({
    where: { code: "SU_GECIRMEZ" },
    update: {},
    create: {
      code: "SU_GECIRMEZ",
      name: "Su Geçirmez",
      category: "FINISH",
      sortOrder: 20,
    },
  });

  const itemPatos = await prisma.item.upsert({
    where: { code: "PATOS" },
    update: {},
    create: {
      code: "PATOS",
      name: "Patos",
      itemType: "FABRIC",
      unit: "MT",
    },
  });

  // Allowed colors (Mavi, Kırmızı izinli; Siyah istersen sonra ekle)
  await prisma.itemAllowedColor.upsert({
    where: {
      itemId_colorId: { itemId: itemPatos.id, colorId: colorMavi.id },
    },
    update: {},
    create: { itemId: itemPatos.id, colorId: colorMavi.id },
  });
  await prisma.itemAllowedColor.upsert({
    where: {
      itemId_colorId: { itemId: itemPatos.id, colorId: colorKirmizi.id },
    },
    update: {},
    create: { itemId: itemPatos.id, colorId: colorKirmizi.id },
  });

  // Allowed properties
  await prisma.itemAllowedProperty.upsert({
    where: {
      itemId_propertyId: { itemId: itemPatos.id, propertyId: propYanmaz.id },
    },
    update: {},
    create: { itemId: itemPatos.id, propertyId: propYanmaz.id },
  });

  console.log("✅ Patos + 2 renk + 2 özellik + allowed listeler oluşturuldu");

  // ---------------------------------------------------------------------------
  // 2. MÜŞTERİ + SİPARİŞ (Patos / Mavi / Yanmaz, 2400m)
  // ---------------------------------------------------------------------------
  const musteri = await prisma.customer.upsert({
    where: { code: "MUS-TEST-001" },
    update: {},
    create: {
      code: "MUS-TEST-001",
      name: "Test Moda Tekstil A.Ş.",
      taxNumber: "1234567890",
      type: "CUSTOMER",
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber: `SIP-TEST-${stamp}`,
      customerId: musteri.id,
      currency: "TRY",
      status: "APPROVED",
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lines: {
        create: [
          {
            itemId: itemPatos.id,
            colorId: colorMavi.id,
            quantity: 2400,
            width: 150,
            requiredProperties: {
              create: [{ propertyId: propYanmaz.id }],
            },
          },
        ],
      },
    },
    include: { lines: true },
  });
  const orderLine = order.lines[0];
  console.log(
    `✅ Sipariş: ${order.orderNumber} (${orderLine.quantity}m Patos · Mavi · Yanmaz · ${musteri.name})`,
  );

  // ---------------------------------------------------------------------------
  // 3. WORK ORDER — KK1(COMPLETED) → Boyahane(ACTIVE, AT_SUBCONTRACTOR) → KK2 → Tambur → Paket
  // ---------------------------------------------------------------------------
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `PARTI-TEST-${stamp}`,
      type: "ORDER_PRODUCTION",
      width: 150,
      targetQuantity: 2400,
      parameters: { color: "Mavi" },
      status: "IN_PROGRESS",
      plannedStartDate: sevenDaysAgo,
      plannedEndDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      targetItemId: itemPatos.id,
      targetColorId: colorMavi.id,
      targetProperties: {
        create: [{ propertyId: propYanmaz.id }],
      },
      steps: {
        create: [
          {
            stationId: stKK1.id,
            stepSequence: 1,
            status: "COMPLETED",
            startedAt: sevenDaysAgo,
            completedAt: oneDayAgo,
          },
          {
            stationId: stBoyahane.id,
            stepSequence: 2,
            status: "ACTIVE",
            startedAt: oneDayAgo,
            requiredCategoryId: boyahaneKategorisi.id,
            plannedSubcontractorId: boyaFirma.id,
          },
          { stationId: stKursun.id, stepSequence: 3, status: "PENDING" },
          { stationId: stTambur.id, stepSequence: 4, status: "PENDING" },
        ],
      },
      orderLinks: {
        create: [
          { orderLineId: orderLine.id, allocatedQty: orderLine.quantity },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });

  const [stepKK1, stepBoyahane] = wo.steps;
  console.log(`✅ İş emri: ${wo.batchNumber}`);
  console.log(
    `   Adımlar: KK1(✓) → Boyahane(ACTIVE) → KK2(PENDING) → Tambur(PENDING)`,
  );

  // ---------------------------------------------------------------------------
  // 4. HAM TOPLAR — KK1 girdisi + Boyahane'ye sevk edilmiş (AT_SUBCONTRACTOR)
  //    Bu rulolar HENÜZ RENK ALMAMIŞ — Fason Kabul ile colorId set edilecek.
  // ---------------------------------------------------------------------------
  const rollSeeds = [
    { qty: 580, weightKg: 70.5 },
    { qty: 540, weightKg: 65.8 },
    { qty: 610, weightKg: 74.2 },
    { qty: 495, weightKg: 60.1 },
  ];

  // Önce Fason Sevk belgesi oluştur (gerçekçi olsun)
  const dispatchNo = `SD-${String(now.getFullYear()).slice(-2)}${String(
    now.getMonth() + 1,
  ).padStart(2, "0")}-TEST-${stamp}`;
  const dispatch = await prisma.subcontractorDispatch.create({
    data: {
      dispatchNo,
      workOrderId: wo.id,
      stepId: stepBoyahane.id,
      subcontractorId: boyaFirma.id,
      plannedSubcontractorId: boyaFirma.id,
      dispatchedById: admin.id,
      totalQty: rollSeeds.reduce((s, r) => s + r.qty, 0),
    },
  });

  const woRolls = await Promise.all(
    rollSeeds.map(async (seed, i) => {
      const barcode = `TOP-${stamp}-${String(i + 1).padStart(3, "0")}`;
      const roll = await prisma.roll.create({
        data: {
          barcode,
          itemId: itemPatos.id,
          // colorId: null — HAM, henüz boyahaneden geçmemiş
          initialQty: seed.qty,
          currentQty: seed.qty,
          weightKg: seed.weightKg,
          width: 150,
          status: "AT_SUBCONTRACTOR",
          qualityGrade: "1.KALITE",
          producedInStepId: stepKK1.id,
          currentStepId: stepBoyahane.id,
        },
      });

      // KK1 movement (kapanmış) + Boyahane movement (açık, fason süresince)
      await prisma.rollMovement.create({
        data: {
          rollId: roll.id,
          workOrderStepId: stepKK1.id,
          qtyIn: seed.qty,
          qtyOut: seed.qty,
          weightIn: seed.weightKg,
          weightOut: seed.weightKg,
          enteredAt: sevenDaysAgo,
          exitedAt: oneDayAgo,
          operatorId: admin.id,
          notes: "AUTO_INTAKE",
        },
      });
      await prisma.rollMovement.create({
        data: {
          rollId: roll.id,
          workOrderStepId: stepBoyahane.id,
          qtyIn: seed.qty,
          weightIn: seed.weightKg,
          enteredAt: oneDayAgo,
          operatorId: admin.id,
          notes: `DISPATCH:${dispatchNo}`,
        },
      });
      await prisma.subcontractorDispatchItem.create({
        data: {
          dispatchId: dispatch.id,
          rollId: roll.id,
          dispatchedQty: seed.qty,
          dispatchedWeight: seed.weightKg,
        },
      });

      return roll;
    }),
  );
  console.log(
    `✅ ${woRolls.length} ham top boyahaneye gönderildi (AT_SUBCONTRACTOR, colorId=null)`,
  );

  // ---------------------------------------------------------------------------
  // 5. REFAKAT KARTI
  // ---------------------------------------------------------------------------
  const yyMm = `${String(now.getFullYear()).slice(-2)}${String(
    now.getMonth() + 1,
  ).padStart(2, "0")}`;
  const card = await prisma.travelerCard.create({
    data: {
      workOrderId: wo.id,
      cardNumber: `RK-${yyMm}-${stamp}`,
      barcode: `RK-${yyMm}-${stamp}-C`,
      status: "ACTIVE",
      printedById: admin.id,
    },
  });
  console.log(`✅ Refakat kartı: ${card.barcode}`);

  // ---------------------------------------------------------------------------
  // ÖZET
  // ---------------------------------------------------------------------------
  console.log("\n🎉 Test akışı hazır!\n");
  console.log("─".repeat(64));
  console.log("📋 Test senaryosu");
  console.log("─".repeat(64));
  console.log(`  Müşteri        : ${musteri.name}`);
  console.log(`  Sipariş        : ${order.orderNumber} (${orderLine.quantity}m)`);
  console.log(`  İş Emri        : ${wo.batchNumber}`);
  console.log(`  Hedef          : Patos · Mavi · Yanmaz`);
  console.log(`  Boyahane Sevk  : ${dispatchNo}`);
  console.log(`  Refakat Kartı  : ${card.barcode}`);
  console.log("");
  console.log("  🔵 Boyahaneye gönderilmiş ham toplar (renksiz):");
  woRolls.forEach((r) =>
    console.log(`     - ${r.barcode}  ${r.currentQty}m  ${r.weightKg}kg  HAM`),
  );
  console.log("─".repeat(64));
  console.log("");
  console.log("👉 Test adımları:");
  console.log("   1. /fason-kabul → Bu sevki seç → tüm topları kabul et");
  console.log("      → Toplar otomatik colorId=Mavi + RollProperty=Yanmaz alır");
  console.log("      → Status: IN_PRODUCTION (KK2 adımına taşınır)");
  console.log("   2. /kursun-qc → Refakat Kartı okut → Kurşun + QC2 işle");
  console.log("   3. /tambur → Refakat Kartı okut → kesim/koruma → finalize");
  console.log("   4. Toplar Depo'ya (WAREHOUSE) düşer");
  console.log("   5. /paketleme → tartı + paket → READY_FOR_SHIP");
  console.log("   6. /sevkiyat → çuval seç → finalize");
  console.log("");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error("❌ Seed hata:", e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
