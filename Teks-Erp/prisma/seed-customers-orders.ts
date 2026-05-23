// =============================================================================
// TeksERP - 10 müşteri + 3 yeni ürün (alias'lı) + 20 sipariş seed
// =============================================================================
// Çalıştırma:
//   cd Teks-Erp
//   npx ts-node prisma/seed-customers-orders.ts
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Sabitler — tüm siparişler aynı ölçü
const ORDER_QTY = 1000;
const ORDER_WIDTH = 150;

const CUSTOMERS = [
  { code: "MUS-T01", name: "Akın Tekstil A.Ş.", tax: "1111111111", city: "İstanbul", district: "Bağcılar" },
  { code: "MUS-T02", name: "Bursa Moda San. Ltd.", tax: "2222222222", city: "Bursa", district: "Osmangazi" },
  { code: "MUS-T03", name: "Çukurova Kumaş A.Ş.", tax: "3333333333", city: "Adana", district: "Seyhan" },
  { code: "MUS-T04", name: "Deniz Tekstil Tic.", tax: "4444444444", city: "İzmir", district: "Konak" },
  { code: "MUS-T05", name: "Ege Dokuma San.", tax: "5555555555", city: "Denizli", district: "Pamukkale" },
  { code: "MUS-T06", name: "Fırat Kumaş Ltd.", tax: "6666666666", city: "Gaziantep", district: "Şahinbey" },
  { code: "MUS-T07", name: "Gediz Tekstil A.Ş.", tax: "7777777777", city: "Manisa", district: "Yunusemre" },
  { code: "MUS-T08", name: "Hilal Moda Tic.", tax: "8888888888", city: "İstanbul", district: "Esenyurt" },
  { code: "MUS-T09", name: "Işık Dokuma San.", tax: "9999999999", city: "Kahramanmaraş", district: "Onikişubat" },
  { code: "MUS-T10", name: "Jale Tekstil Ltd.", tax: "1010101010", city: "Tekirdağ", district: "Çorlu" },
];

const PRODUCTS = [
  { code: "KETEN", name: "Keten Kumaş" },
  { code: "KADIFE", name: "Kadife Kumaş" },
  { code: "SATEN", name: "Saten Kumaş" },
];

// Her müşterinin her ürün için "kendi isimlendirmesi" (alias)
// 10 müşteri × 3 ürün = 30 alias
const ALIASES_BY_CUSTOMER: Record<string, Record<string, string>> = {
  "MUS-T01": { KETEN: "AKLİN", KADIFE: "AKVELL", SATEN: "AKSHINE" },
  "MUS-T02": { KETEN: "BURLİN", KADIFE: "BURVEL", SATEN: "BURSAT" },
  "MUS-T03": { KETEN: "ÇUKLİN", KADIFE: "ÇUKVEL", SATEN: "ÇUKSAT" },
  "MUS-T04": { KETEN: "DENİN", KADIFE: "DENVEL", SATEN: "DENSAT" },
  "MUS-T05": { KETEN: "EGELİN", KADIFE: "EGEVEL", SATEN: "EGESAT" },
  "MUS-T06": { KETEN: "FIRLİN", KADIFE: "FIRVEL", SATEN: "FIRSAT" },
  "MUS-T07": { KETEN: "GEDLİN", KADIFE: "GEDVEL", SATEN: "GEDSAT" },
  "MUS-T08": { KETEN: "HİLLİN", KADIFE: "HİLVEL", SATEN: "HİLSAT" },
  "MUS-T09": { KETEN: "IŞLİN", KADIFE: "IŞVEL", SATEN: "IŞSAT" },
  "MUS-T10": { KETEN: "JALLİN", KADIFE: "JALVEL", SATEN: "JALSAT" },
};

async function main() {
  console.log("🌱 Müşteri / ürün / sipariş seed'i başlıyor...\n");

  // ---------------------------------------------------------------------------
  // 1. Renk + Özellik (Mavi + Yanmaz) — varsa kullan, yoksa oluştur
  // ---------------------------------------------------------------------------
  const colorMavi = await prisma.color.upsert({
    where: { code: "MAVI" },
    update: {},
    create: { code: "MAVI", name: "Mavi", hex: "#1E40AF", sortOrder: 10 },
  });
  const propYanmaz = await prisma.fabricProperty.upsert({
    where: { code: "YANMAZ" },
    update: {},
    create: { code: "YANMAZ", name: "Yanmazlık", category: "FINISH", sortOrder: 10 },
  });
  console.log("✅ Renk (Mavi) + Özellik (Yanmaz) hazır");

  // ---------------------------------------------------------------------------
  // 2. 3 yeni ürün — izin listesi boş (tüm renk/özellik serbest)
  // ---------------------------------------------------------------------------
  const items = await Promise.all(
    PRODUCTS.map((p) =>
      prisma.item.upsert({
        where: { code: p.code },
        update: {},
        create: {
          code: p.code,
          name: p.name,
          itemType: "FABRIC",
          unit: "MT",
        },
      }),
    ),
  );
  console.log(`✅ ${items.length} ürün oluşturuldu/güncellendi: ${items.map((i) => i.code).join(", ")}`);

  // ---------------------------------------------------------------------------
  // 3. 10 müşteri + her birine 1 şube
  // ---------------------------------------------------------------------------
  const customers: { customer: Awaited<ReturnType<typeof prisma.customer.upsert>>; branchId: string }[] = [];
  for (const c of CUSTOMERS) {
    const customer = await prisma.customer.upsert({
      where: { code: c.code },
      update: { name: c.name, taxNumber: c.tax },
      create: {
        code: c.code,
        name: c.name,
        taxNumber: c.tax,
        type: "CUSTOMER",
      },
    });

    // Şube — code unique değil, name'e göre idempotent yap
    let branch = await prisma.customerBranch.findFirst({
      where: { customerId: customer.id, name: "Merkez" },
    });
    if (!branch) {
      branch = await prisma.customerBranch.create({
        data: {
          customerId: customer.id,
          code: "MERKEZ",
          name: "Merkez",
          city: c.city,
          district: c.district,
        },
      });
    }
    customers.push({ customer, branchId: branch.id });
  }
  console.log(`✅ ${customers.length} müşteri + ${customers.length} şube hazır`);

  // ---------------------------------------------------------------------------
  // 4. CustomerItemAlias — her müşteri × her ürün
  // ---------------------------------------------------------------------------
  let aliasCount = 0;
  for (const { customer } of customers) {
    const aliases = ALIASES_BY_CUSTOMER[customer.code];
    for (const item of items) {
      const alias = aliases?.[item.code];
      if (!alias) continue;
      await prisma.customerItemAlias.upsert({
        where: {
          customerId_itemId: { customerId: customer.id, itemId: item.id },
        },
        update: { alias },
        create: { customerId: customer.id, itemId: item.id, alias },
      });
      aliasCount += 1;
    }
  }
  console.log(`✅ ${aliasCount} müşteri-ürün alias kaydı (her müşteri 3 ürün için kendi adı)`);

  // ---------------------------------------------------------------------------
  // 5. 20 sipariş — her müşteri 2 sipariş, ürün döngüsel
  // ---------------------------------------------------------------------------
  const stamp = Date.now().toString().slice(-6);
  let orderSeq = 1;
  const createdOrders: { number: string; customer: string; itemCode: string }[] = [];

  for (let i = 0; i < customers.length; i++) {
    const { customer, branchId } = customers[i];
    for (let j = 0; j < 2; j++) {
      const item = items[(i * 2 + j) % items.length];
      const orderNumber = `SIP-T${stamp}-${String(orderSeq).padStart(3, "0")}`;
      orderSeq += 1;

      await prisma.order.create({
        data: {
          orderNumber,
          customerId: customer.id,
          branchId,
          currency: "TRY",
          status: "APPROVED",
          deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          lines: {
            create: [
              {
                itemId: item.id,
                colorId: colorMavi.id,
                quantity: ORDER_QTY,
                width: ORDER_WIDTH,
                requiredProperties: {
                  create: [{ propertyId: propYanmaz.id }],
                },
              },
            ],
          },
        },
      });

      createdOrders.push({ number: orderNumber, customer: customer.name, itemCode: item.code });
    }
  }
  console.log(`✅ ${createdOrders.length} sipariş oluşturuldu`);

  // ---------------------------------------------------------------------------
  // Özet
  // ---------------------------------------------------------------------------
  console.log("\n🎉 Seed tamamlandı!\n");
  console.log("─".repeat(72));
  console.log("📋 Test verisi özeti");
  console.log("─".repeat(72));
  console.log(`  Müşteri sayısı : ${customers.length}`);
  console.log(`  Ürün sayısı    : ${items.length} (${items.map((i) => i.code).join(", ")})`);
  console.log(`  Alias sayısı   : ${aliasCount}`);
  console.log(`  Sipariş sayısı : ${createdOrders.length}`);
  console.log(`  Sabit ölçü     : ${ORDER_QTY}m · ${ORDER_WIDTH}cm · Mavi · Yanmaz`);
  console.log("─".repeat(72));
  console.log("");
  for (const o of createdOrders) {
    console.log(`   ${o.number}  →  ${o.customer.padEnd(30)}  [${o.itemCode}]`);
  }
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
