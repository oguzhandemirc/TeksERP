// =============================================================================
// TeksERP - Kurşun+KK2 Sonrası Akış Test Seed
// =============================================================================
// Ham stok + sipariş + iş emri + toplar hazırlar. Toplar Kurşun+KK2 adımında
// açık halde bekler — operatör refakat kartı veya istasyon ekranı üzerinden
// Kurşun → QC2 → Tambur → Paket/Tartı/Etiket akışını uçtan uca test edebilir.
//
// Çalıştırma:
//   cd Teks-Erp
//   npx ts-node prisma/seed-test-flow.ts
//
// Her çalıştırmada yeni bir iş emri + refakat kartı + toplar üretir. İstersen
// önce `npx ts-node prisma/clean-business-data.ts` ile eski iş verilerini sil.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Test akışı seed'i başlıyor (ham stok + sipariş + WO)...\n");

  // ---------------------------------------------------------------------------
  // 0. ÖN KOŞUL: stations, operator user
  // ---------------------------------------------------------------------------
  // İlk adım istasyonu: varsa dokuma/dokuma benzeri OTHER, yoksa ilk
  // SUBCONTRACTOR (Boyahane). Asıl amaç: Kurşun+KK2 öncesi geçmiş bir adım
  // olsun; iş akışı için hangisi olduğu kritik değil.
  const stStart =
    (await prisma.station.findFirst({
      where: { kind: "OTHER", department: { contains: "DOKUMA" } },
    })) ??
    (await prisma.station.findFirst({
      where: { kind: "SUBCONTRACTOR" },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.station.findFirst({ where: { kind: "OTHER" } }));

  const [stKursun, stTambur, stPaketleme, stSevk] = await Promise.all([
    prisma.station.findFirst({ where: { kind: "PROCESS_QC" } }),
    prisma.station.findFirst({ where: { kind: "TAMBUR" } }),
    prisma.station.findFirst({ where: { kind: "PACKAGING" } }),
    prisma.station.findFirst({ where: { kind: "SHIPPING" } }),
  ]);
  if (!stStart || !stKursun || !stTambur || !stPaketleme) {
    throw new Error(
      "Gerekli istasyonlar bulunamadı. PROCESS_QC / TAMBUR / PACKAGING ve en az bir başlangıç istasyonu gerekli.",
    );
  }
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  if (!admin) {
    throw new Error("admin kullanıcısı yok. Önce `npm run seed` çalıştırın.");
  }

  console.log("✅ İstasyonlar bulundu:");
  console.log(`   Başlangıç   → ${stStart.code} (${stStart.kind})`);
  console.log(`   Kurşun+KK2  → ${stKursun.code}`);
  console.log(`   Tambur      → ${stTambur.code}`);
  console.log(`   Paket/Tartı → ${stPaketleme.code}`);
  if (stSevk) console.log(`   Sevkiyat    → ${stSevk.code}`);

  const stamp = Date.now().toString().slice(-6); // son 6 hane — benzersizlik

  // ---------------------------------------------------------------------------
  // 1. ITEM + VARIANT (upsert — ana seed varsa tekrar kullanılır)
  // ---------------------------------------------------------------------------
  const itemHam = await prisma.item.upsert({
    where: { code: "HAM-POPLIN-150" },
    update: {},
    create: {
      code: "HAM-POPLIN-150",
      name: "Ham Poplin 150cm",
      itemType: "RAW_FABRIC",
      unit: "MT",
    },
  });

  const itemMamul = await prisma.item.upsert({
    where: { code: "MAM-POPLIN-LAC" },
    update: {},
    create: {
      code: "MAM-POPLIN-LAC",
      name: "Boyalı Poplin — Lacivert",
      itemType: "DYED_FABRIC",
      unit: "MT",
    },
  });

  const variantLacivert =
    (await prisma.itemVariant.findUnique({
      where: { itemId_code: { itemId: itemMamul.id, code: "NAVY-B12" } },
    })) ??
    (await prisma.itemVariant.create({
      data: {
        itemId: itemMamul.id,
        code: "NAVY-B12",
        name: "Navy Blue B12",
      },
    }));

  console.log(
    `✅ Ürünler: ${itemHam.code}, ${itemMamul.code} (varyant: ${variantLacivert.code})`,
  );

  // ---------------------------------------------------------------------------
  // 2. HAM STOK (KK1 geçmiş — STOCK durumunda)
  // ---------------------------------------------------------------------------
  const hamRolls = await Promise.all(
    [1200, 1100, 950].map((qty, i) =>
      prisma.roll.create({
        data: {
          barcode: `HAM-${stamp}-${String(i + 1).padStart(3, "0")}`,
          itemId: itemHam.id,
          initialQty: qty,
          currentQty: qty,
          weightKg: Number((qty * 0.18).toFixed(2)),
          width: 150,
          status: "STOCK",
          qualityGrade: "1.KALITE",
        },
      }),
    ),
  );
  console.log(`✅ ${hamRolls.length} ham top stoka girildi`);

  // ---------------------------------------------------------------------------
  // 3. MÜŞTERİ (upsert) + SİPARİŞ
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
      status: "IN_PRODUCTION",
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lines: {
        create: [
          {
            itemId: itemMamul.id,
            variantId: variantLacivert.id,
            quantity: 2400,
            width: 150,
          },
        ],
      },
    },
    include: { lines: true },
  });
  const orderLine = order.lines[0];
  console.log(
    `✅ Sipariş: ${order.orderNumber} (${orderLine.quantity}m @ ${musteri.name})`,
  );

  // ---------------------------------------------------------------------------
  // 4. WORK ORDER — Dokuma(COMPLETED) → Kurşun+KK2(ACTIVE) → Tambur → Paket
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
      recipeNo: "R-NAVY-B12",
      parameters: {
        targetWidth: 150,
        color: "Lacivert",
        dyeRecipeCode: "R-NAVY-B12",
      },
      status: "IN_PROGRESS",
      plannedStartDate: sevenDaysAgo,
      plannedEndDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      steps: {
        create: [
          {
            stationId: stStart.id,
            stepSequence: 1,
            status: "COMPLETED",
            startedAt: sevenDaysAgo,
            completedAt: oneDayAgo,
          },
          {
            stationId: stKursun.id,
            stepSequence: 2,
            status: "ACTIVE",
            startedAt: oneDayAgo,
          },
          { stationId: stTambur.id, stepSequence: 3, status: "PENDING" },
          { stationId: stPaketleme.id, stepSequence: 4, status: "PENDING" },
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

  const [stepStart, stepKursun] = wo.steps;
  console.log(`✅ İş emri: ${wo.batchNumber}`);
  console.log(
    `   Adımlar: ${stStart.code}(COMPLETED) → Kurşun+KK2(ACTIVE) → Tambur(PENDING) → Paket(PENDING)`,
  );

  // ---------------------------------------------------------------------------
  // 5. WO'ya BAĞLI TOPLAR — Kurşun+KK2 adımında açık bekliyor
  // ---------------------------------------------------------------------------
  const rollSeeds = [
    { qty: 580, weightKg: 70.5, grade: "1.KALITE" },
    { qty: 540, weightKg: 65.8, grade: "1.KALITE" },
    { qty: 610, weightKg: 74.2, grade: "1.KALITE" },
    { qty: 495, weightKg: 60.1, grade: "1.KALITE" },
  ];

  const woRolls = await Promise.all(
    rollSeeds.map(async (seed, i) => {
      const barcode = `TOP-${stamp}-${String(i + 1).padStart(3, "0")}`;
      const roll = await prisma.roll.create({
        data: {
          barcode,
          itemId: itemMamul.id,
          variantId: variantLacivert.id,
          initialQty: seed.qty,
          currentQty: seed.qty,
          weightKg: seed.weightKg,
          width: 150,
          status: "IN_PRODUCTION",
          qualityGrade: seed.grade,
          producedInStepId: stepStart.id,
          currentStepId: stepKursun.id,
        },
      });

      // Kurşun+KK2 adımında AÇIK (exitedAt=null) movement — Kurşun servisi bu
      // RollMovement'e bakarak topları "adımda açık" olarak listeler.
      await prisma.rollMovement.create({
        data: {
          rollId: roll.id,
          workOrderStepId: stepKursun.id,
          qtyIn: seed.qty,
          weightIn: seed.weightKg,
          enteredAt: new Date(),
          operatorId: admin.id,
          notes: `ENTERED_FROM_${stStart.code} (test seed)`,
        },
      });

      return roll;
    }),
  );
  console.log(`✅ ${woRolls.length} top iş emrine bağlandı (Kurşun+KK2 adımında açık)`);

  // ---------------------------------------------------------------------------
  // 6. REFAKAT KARTI (Traveler Card) — operatör okutsun
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
  console.log(`  Ürün           : ${itemMamul.code} / ${variantLacivert.code}`);
  console.log(`  Refakat Kartı  : ${card.barcode}`);
  console.log("");
  console.log("  📦 Ham stokta bekleyen top:");
  hamRolls.forEach((r) =>
    console.log(`     - ${r.barcode}  ${r.currentQty}m  ${r.weightKg}kg`),
  );
  console.log("");
  console.log("  🔩 Kurşun+KK2 adımında açık (bu adımdan test başlayacak):");
  woRolls.forEach((r) =>
    console.log(`     - ${r.barcode}  ${r.currentQty}m  ${r.weightKg}kg`),
  );
  console.log("─".repeat(64));
  console.log("");
  console.log("👉 Frontend'de test akışı:");
  console.log(
    `   1. /kursun-qc → Refakat Kartı okut: ${card.barcode}`,
  );
  console.log("   2. Her top için: Kurşun Geç → (opsiyonel hata ekle) → QC2 Bitti");
  console.log("   3. Toplar Tambur'a düşecek → /tambur");
  console.log("   4. Tambur'da: Refakat Kartı okut → kesim/korundu kararları → Bitti");
  console.log("   5. Toplar Paketleme'ye düşecek → /paketleme");
  console.log("   6. Her top için: tartı → Sevkiyata/Depoya → Bitti → etiket");
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
