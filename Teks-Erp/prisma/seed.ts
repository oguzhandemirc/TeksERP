// =============================================================================
// TeksERP - Database Seed
// =============================================================================
// Realistic Turkish textile industry test data for all 22 models.
// Run: npx prisma db seed
// =============================================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as bcrypt from "bcryptjs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Helper: hash password
// ---------------------------------------------------------------------------
async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

// ---------------------------------------------------------------------------
// MAIN SEED
// ---------------------------------------------------------------------------
async function main() {
  console.log("🌱 Seeding TeksERP database...\n");

  // =========================================================================
  // 1. PERMISSIONS
  // =========================================================================
  const permissionData: { code: string; module: string }[] = [
    // SALES
    { code: "order:read", module: "SALES" },
    { code: "order:write", module: "SALES" },
    { code: "order:delete", module: "SALES" },
    { code: "customer:read", module: "SALES" },
    { code: "customer:write", module: "SALES" },
    // PRODUCTION
    { code: "workorder:read", module: "PRODUCTION" },
    { code: "workorder:write", module: "PRODUCTION" },
    { code: "workorder:create", module: "PRODUCTION" },
    { code: "roll:read", module: "PRODUCTION" },
    { code: "roll:write", module: "PRODUCTION" },
    { code: "station:read", module: "PRODUCTION" },
    { code: "station:write", module: "PRODUCTION" },
    // QUALITY
    { code: "quality:read", module: "QUALITY" },
    { code: "quality:write", module: "QUALITY" },
    // LOGISTICS
    { code: "shipment:read", module: "LOGISTICS" },
    { code: "shipment:write", module: "LOGISTICS" },
    { code: "allocation:read", module: "LOGISTICS" },
    { code: "allocation:write", module: "LOGISTICS" },
    // FINANCE
    { code: "finance:read", module: "FINANCE" },
    { code: "finance:write", module: "FINANCE" },
    // ADMIN
    { code: "admin:users", module: "ADMIN" },
    { code: "admin:roles", module: "ADMIN" },
    { code: "admin:settings", module: "ADMIN" },
  ];

  const permissions = await Promise.all(
    permissionData.map((p) =>
      prisma.permission.create({ data: p })
    )
  );
  console.log(`✅ ${permissions.length} permissions created`);

  // =========================================================================
  // 2. ROLES
  // =========================================================================
  const adminRole = await prisma.role.create({
    data: { name: "Admin", description: "Tam yetkili sistem yöneticisi" },
  });
  const planningRole = await prisma.role.create({
    data: { name: "Planlama Şefi", description: "Üretim planlama ve iş emri yönetimi" },
  });
  const productionRole = await prisma.role.create({
    data: { name: "Üretim Operatörü", description: "Sahada üretim işlemleri" },
  });
  const qualityRole = await prisma.role.create({
    data: { name: "Kalite Kontrol", description: "Kurşun ve Tambur operasyonları" },
  });
  const salesRole = await prisma.role.create({
    data: { name: "Satış Temsilcisi", description: "Sipariş ve müşteri yönetimi" },
  });
  const shippingRole = await prisma.role.create({
    data: { name: "Sevkiyatçı", description: "Sevkiyat ve lojistik işlemleri" },
  });
  console.log("✅ 6 roles created");

  // =========================================================================
  // 3. ROLE → PERMISSION ASSIGNMENTS
  // =========================================================================
  // Admin gets ALL permissions
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({
      roleId: adminRole.id,
      permissionId: p.id,
    })),
  });

  // Planning gets production + order read
  const planningPermCodes = [
    "workorder:read", "workorder:write", "workorder:create",
    "roll:read", "roll:write", "station:read",
    "order:read", "allocation:read", "allocation:write",
  ];
  await prisma.rolePermission.createMany({
    data: permissions
      .filter((p) => planningPermCodes.includes(p.code))
      .map((p) => ({ roleId: planningRole.id, permissionId: p.id })),
  });

  // Production operator
  const prodPermCodes = [
    "workorder:read", "roll:read", "roll:write", "station:read",
  ];
  await prisma.rolePermission.createMany({
    data: permissions
      .filter((p) => prodPermCodes.includes(p.code))
      .map((p) => ({ roleId: productionRole.id, permissionId: p.id })),
  });

  // Quality control
  const qualityPermCodes = [
    "quality:read", "quality:write", "roll:read", "roll:write",
    "workorder:read",
  ];
  await prisma.rolePermission.createMany({
    data: permissions
      .filter((p) => qualityPermCodes.includes(p.code))
      .map((p) => ({ roleId: qualityRole.id, permissionId: p.id })),
  });

  // Sales
  const salesPermCodes = [
    "order:read", "order:write", "customer:read", "customer:write",
    "allocation:read",
  ];
  await prisma.rolePermission.createMany({
    data: permissions
      .filter((p) => salesPermCodes.includes(p.code))
      .map((p) => ({ roleId: salesRole.id, permissionId: p.id })),
  });

  // Shipping
  const shipPermCodes = [
    "shipment:read", "shipment:write", "order:read",
    "roll:read", "allocation:read",
  ];
  await prisma.rolePermission.createMany({
    data: permissions
      .filter((p) => shipPermCodes.includes(p.code))
      .map((p) => ({ roleId: shippingRole.id, permissionId: p.id })),
  });
  console.log("✅ Role-permission assignments completed");

  // =========================================================================
  // 4. USERS
  // =========================================================================
  const adminUser = await prisma.user.create({
    data: {
      username: "admin",
      passwordHash: await hashPassword("admin123"),
      fullName: "Sistem Yöneticisi",
    },
  });
  const plannerUser = await prisma.user.create({
    data: {
      username: "mehmet.planlama",
      passwordHash: await hashPassword("test123"),
      fullName: "Mehmet Yılmaz",
    },
  });
  const operatorUser = await prisma.user.create({
    data: {
      username: "ali.operator",
      passwordHash: await hashPassword("test123"),
      fullName: "Ali Demir",
    },
  });
  const qualityUser = await prisma.user.create({
    data: {
      username: "ayse.kalite",
      passwordHash: await hashPassword("test123"),
      fullName: "Ayşe Kaya",
    },
  });
  const salesUser = await prisma.user.create({
    data: {
      username: "fatma.satis",
      passwordHash: await hashPassword("test123"),
      fullName: "Fatma Özdemir",
    },
  });
  const shippingUser = await prisma.user.create({
    data: {
      username: "veli.sevkiyat",
      passwordHash: await hashPassword("test123"),
      fullName: "Veli Çelik",
    },
  });
  console.log("✅ 6 users created");

  // =========================================================================
  // 5. USER → ROLE ASSIGNMENTS
  // =========================================================================
  await prisma.userRole.createMany({
    data: [
      { userId: adminUser.id, roleId: adminRole.id },
      { userId: plannerUser.id, roleId: planningRole.id },
      { userId: operatorUser.id, roleId: productionRole.id },
      { userId: qualityUser.id, roleId: qualityRole.id },
      { userId: salesUser.id, roleId: salesRole.id },
      { userId: shippingUser.id, roleId: shippingRole.id },
    ],
  });
  console.log("✅ User-role assignments completed");

  // =========================================================================
  // 6. STATIONS
  // =========================================================================
  const stDokuma = await prisma.station.create({
    data: { code: "DOKUMA_1", name: "Dokuma Salonu", type: "INTERNAL", kind: "OTHER", department: "DOKUMA" },
  });
  const stKK1 = await prisma.station.create({
    data: { code: "KK1_1", name: "Kalite Kontrol 1 (Ham Giriş)", type: "INTERNAL", kind: "RAW_QC", department: "KALITE" },
  });
  const stDevere = await prisma.station.create({
    data: { code: "DEVERE_1", name: "Devere Hazırlık", type: "INTERNAL", kind: "OTHER", department: "DEVERE" },
  });
  const stBoyahaneDis = await prisma.station.create({
    data: { code: "BOYAHANE_DIS", name: "Fason Boyahane (Dış)", type: "EXTERNAL", kind: "SUBCONTRACTOR", department: "TERBIYE" },
  });
  const stBaskiDis = await prisma.station.create({
    data: { code: "BASKI_DIS", name: "Fason Baskı (Dış)", type: "EXTERNAL", kind: "SUBCONTRACTOR", department: "TERBIYE" },
  });
  // Kurşun ve Kalite Kontrol 2 aynı fiziksel istasyon — per-roll akış tek WorkOrderStep'te yönetilir.
  const stKursun = await prisma.station.create({
    data: { code: "KURSUN_QC2_1", name: "Kurşun + Kalite Kontrol 2", type: "INTERNAL", kind: "PROCESS_QC", department: "KALITE" },
  });
  const stTambur = await prisma.station.create({
    data: { code: "TAMBUR_1", name: "Tambur (Karar Noktası)", type: "INTERNAL", kind: "TAMBUR", department: "KALITE" },
  });
  const stPaketleme = await prisma.station.create({
    data: { code: "PAKET_1", name: "Paketleme & Tartı", type: "INTERNAL", kind: "PACKAGING", department: "SEVKIYAT" },
  });
  const stSevkiyat = await prisma.station.create({
    data: { code: "SEVK_1", name: "Sevkiyat Rampa", type: "INTERNAL", kind: "SHIPPING", department: "SEVKIYAT" },
  });
  console.log("✅ 9 stations created");

  // =========================================================================
  // 6.1 DEFECT TYPES (hata kataloğu — operatör ekranında buton olarak çıkar)
  // =========================================================================
  const defectTypes = await Promise.all([
    prisma.defectType.create({ data: { code: "LEKE", name: "Leke", severity: "MAJOR", description: "Boya/kir lekesi" } }),
    prisma.defectType.create({ data: { code: "YIRTIK", name: "Yırtık", severity: "CRITICAL", description: "Kumaşta yırtık veya delik" } }),
    prisma.defectType.create({ data: { code: "ATKI_ATLAMA", name: "Atkı Atlaması", severity: "MAJOR", description: "Atkı ipliğinde atlama" } }),
    prisma.defectType.create({ data: { code: "COZGU_ATLAMA", name: "Çözgü Atlaması", severity: "MAJOR", description: "Çözgü ipliğinde atlama" } }),
    prisma.defectType.create({ data: { code: "RENK_FARKI", name: "Renk Farkı", severity: "MINOR", description: "Top içi veya toplar arası renk farkı" } }),
    prisma.defectType.create({ data: { code: "KALIN_ATKI", name: "Kalın Atkı", severity: "MINOR" } }),
    prisma.defectType.create({ data: { code: "INCE_ATKI", name: "İnce Atkı", severity: "MINOR" } }),
    prisma.defectType.create({ data: { code: "BUZULME", name: "Büzülme", severity: "MAJOR", description: "Boyahane sonrası büzülme" } }),
    prisma.defectType.create({ data: { code: "EGIK_ATKI", name: "Eğik Atkı", severity: "MINOR" } }),
    prisma.defectType.create({ data: { code: "IPLIK_KOPUKLUGU", name: "İplik Kopukluğu", severity: "MAJOR" } }),
  ]);
  console.log(`✅ ${defectTypes.length} defect types created`);

  // =========================================================================
  // 7. MACHINES
  // =========================================================================
  const machines = await Promise.all([
    prisma.machine.create({ data: { stationId: stDokuma.id, code: "TEZGAH_01", name: "Dokuma Tezgah 1", deviceIp: "192.168.1.101" } }),
    prisma.machine.create({ data: { stationId: stDokuma.id, code: "TEZGAH_02", name: "Dokuma Tezgah 2", deviceIp: "192.168.1.102" } }),
    prisma.machine.create({ data: { stationId: stDokuma.id, code: "TEZGAH_03", name: "Dokuma Tezgah 3", deviceIp: "192.168.1.103" } }),
    prisma.machine.create({ data: { stationId: stKursun.id, code: "KURSUN_MAK_1", name: "Kurşun Makinesi 1" } }),
    prisma.machine.create({ data: { stationId: stTambur.id, code: "TAMBUR_MAK_1", name: "Tambur Makinesi 1" } }),
    prisma.machine.create({ data: { stationId: stTambur.id, code: "TAMBUR_MAK_2", name: "Tambur Makinesi 2" } }),
    prisma.machine.create({ data: { stationId: stPaketleme.id, code: "KANTAR_01", name: "Dijital Kantar 1", deviceIp: "192.168.1.201" } }),
  ]);
  console.log(`✅ ${machines.length} machines created`);

  // =========================================================================
  // 8. ROUTES
  // =========================================================================
  const routeBoyama = await prisma.route.create({
    data: {
      name: "Standart Boyama Rotası",
      steps: {
        create: [
          { stationId: stBoyahaneDis.id, sequence: 1 },
          { stationId: stKursun.id, sequence: 2 },
          { stationId: stTambur.id, sequence: 3 },
          { stationId: stPaketleme.id, sequence: 4 },
        ],
      },
    },
  });
  const routeBoyamaBaski = await prisma.route.create({
    data: {
      name: "Boyama + Baskı Rotası",
      steps: {
        create: [
          { stationId: stBoyahaneDis.id, sequence: 1 },
          { stationId: stBaskiDis.id, sequence: 2 },
          { stationId: stKursun.id, sequence: 3 },
          { stationId: stTambur.id, sequence: 4 },
          { stationId: stPaketleme.id, sequence: 5 },
        ],
      },
    },
  });
  const routeDokuma = await prisma.route.create({
    data: {
      name: "Dokuma Üretim Rotası",
      steps: {
        create: [
          { stationId: stDevere.id, sequence: 1 },
          { stationId: stDokuma.id, sequence: 2 },
          { stationId: stKursun.id, sequence: 3 },
          { stationId: stTambur.id, sequence: 4 },
          { stationId: stPaketleme.id, sequence: 5 },
        ],
      },
    },
  });
  console.log("✅ 3 routes created");

  // =========================================================================
  // 9. ITEMS (Stock Cards)
  // =========================================================================
  const itemHamKumas = await prisma.item.create({
    data: { code: "HAM-001", name: "Ham Poplin Kumaş", itemType: "RAW_FABRIC", unit: "MT" },
  });
  const itemBoyaliKumas1 = await prisma.item.create({
    data: { code: "MAM-001", name: "Boyalı Poplin - Lacivert", itemType: "DYED_FABRIC", unit: "MT" },
  });
  const itemBoyaliKumas2 = await prisma.item.create({
    data: { code: "MAM-002", name: "Boyalı Gabardin - Siyah", itemType: "DYED_FABRIC", unit: "MT" },
  });
  const itemBoyaliKumas3 = await prisma.item.create({
    data: { code: "MAM-003", name: "Boyalı Twill - Haki", itemType: "DYED_FABRIC", unit: "MT" },
  });
  const itemIplik = await prisma.item.create({
    data: { code: "IPL-001", name: "Ne 30/1 Pamuk İplik", itemType: "YARN", unit: "KG" },
  });
  const itemCozgu = await prisma.item.create({
    data: { code: "COZ-001", name: "Çözgü Levendi 2400 Tel", itemType: "WARP", unit: "MT" },
  });
  const itemSarf = await prisma.item.create({
    data: { code: "SRF-001", name: "Paket Naylonu 120cm", itemType: "CONSUMABLE", unit: "ADET" },
  });
  console.log("✅ 7 items created");

  // =========================================================================
  // 10. CUSTOMERS
  // =========================================================================
  const customer1 = await prisma.customer.create({
    data: { code: "MUS-001", name: "Moda Tekstil A.Ş.", taxNumber: "1234567890", type: "CUSTOMER" },
  });
  const customer2 = await prisma.customer.create({
    data: { code: "MUS-002", name: "Anadolu Konfeksiyon Ltd.", taxNumber: "9876543210", type: "CUSTOMER" },
  });
  const customer3 = await prisma.customer.create({
    data: { code: "MUS-003", name: "Export Denim Co.", taxNumber: "5555555555", type: "CUSTOMER" },
  });
  const supplierBoya = await prisma.customer.create({
    data: { code: "TED-001", name: "Renk Boyahane San. Tic.", taxNumber: "1112223334", type: "SUBCONTRACTOR" },
  });
  const supplierBaski = await prisma.customer.create({
    data: { code: "TED-002", name: "Dijital Baskı Merkezi", taxNumber: "4443332221", type: "SUBCONTRACTOR" },
  });
  console.log("✅ 5 customers created");

  // =========================================================================
  // 11. ORDERS
  // =========================================================================
  const order1 = await prisma.order.create({
    data: {
      orderNumber: "SIP-2026-001",
      customerId: customer1.id,
      currency: "TRY",
      totalAmount: new Prisma.Decimal(125000.0),
      status: "IN_PRODUCTION",
      deadline: new Date("2026-05-15"),
      lines: {
        create: [
          { itemId: itemBoyaliKumas1.id, quantity: 5000, unitPrice: new Prisma.Decimal(25.0) },
        ],
      },
    },
    include: { lines: true },
  });

  const order2 = await prisma.order.create({
    data: {
      orderNumber: "SIP-2026-002",
      customerId: customer2.id,
      currency: "TRY",
      totalAmount: new Prisma.Decimal(90000.0),
      status: "APPROVED",
      deadline: new Date("2026-06-01"),
      lines: {
        create: [
          { itemId: itemBoyaliKumas2.id, quantity: 3000, unitPrice: new Prisma.Decimal(30.0) },
        ],
      },
    },
    include: { lines: true },
  });

  const order3 = await prisma.order.create({
    data: {
      orderNumber: "SIP-2026-003",
      customerId: customer3.id,
      currency: "USD",
      totalAmount: new Prisma.Decimal(48000.0),
      status: "PENDING",
      deadline: new Date("2026-07-01"),
      lines: {
        create: [
          { itemId: itemBoyaliKumas3.id, quantity: 2000, unitPrice: new Prisma.Decimal(12.0) },
          { itemId: itemBoyaliKumas1.id, quantity: 2000, unitPrice: new Prisma.Decimal(12.0) },
        ],
      },
    },
    include: { lines: true },
  });
  console.log("✅ 3 orders (5 order lines) created");

  // =========================================================================
  // 12. WORK ORDERS (Batches)
  // =========================================================================
  const wo1 = await prisma.workOrder.create({
    data: {
      batchNumber: "PARTI-2026-001",
      type: "FABRIC_DYEING",
      parameters: { targetWidth: 150, dyeRecipeCode: "R-LAC-001", color: "Lacivert" },
      status: "IN_PROGRESS",
      steps: {
        create: [
          { stationId: stBoyahaneDis.id, stepSequence: 1, status: "COMPLETED", startedAt: new Date("2026-04-01"), completedAt: new Date("2026-04-05") },
          { stationId: stKursun.id, stepSequence: 2, status: "COMPLETED", startedAt: new Date("2026-04-06"), completedAt: new Date("2026-04-07") },
          { stationId: stTambur.id, stepSequence: 3, status: "ACTIVE", startedAt: new Date("2026-04-08") },
          { stationId: stPaketleme.id, stepSequence: 4, status: "PENDING" },
        ],
      },
      orderLinks: {
        create: [
          { orderLineId: order1.lines[0].id },
        ],
      },
    },
    include: { steps: true },
  });

  const wo2 = await prisma.workOrder.create({
    data: {
      batchNumber: "PARTI-2026-002",
      type: "FABRIC_DYEING",
      parameters: { targetWidth: 160, dyeRecipeCode: "R-SYH-005", color: "Siyah" },
      status: "PLANNED",
      steps: {
        create: [
          { stationId: stBoyahaneDis.id, stepSequence: 1, status: "PENDING" },
          { stationId: stKursun.id, stepSequence: 2, status: "PENDING" },
          { stationId: stTambur.id, stepSequence: 3, status: "PENDING" },
          { stationId: stPaketleme.id, stepSequence: 4, status: "PENDING" },
        ],
      },
      orderLinks: {
        create: [
          { orderLineId: order2.lines[0].id },
        ],
      },
    },
  });

  const wo3 = await prisma.workOrder.create({
    data: {
      batchNumber: "PARTI-2026-003",
      type: "FABRIC_DYEING",
      parameters: { targetWidth: 150, dyeRecipeCode: "R-HKI-012", color: "Haki" },
      status: "COMPLETED",
      steps: {
        create: [
          { stationId: stBoyahaneDis.id, stepSequence: 1, status: "COMPLETED", startedAt: new Date("2026-03-10"), completedAt: new Date("2026-03-14") },
          { stationId: stKursun.id, stepSequence: 2, status: "COMPLETED", startedAt: new Date("2026-03-15"), completedAt: new Date("2026-03-16") },
          { stationId: stTambur.id, stepSequence: 3, status: "COMPLETED", startedAt: new Date("2026-03-17"), completedAt: new Date("2026-03-18") },
          { stationId: stPaketleme.id, stepSequence: 4, status: "COMPLETED", startedAt: new Date("2026-03-19"), completedAt: new Date("2026-03-20") },
        ],
      },
    },
    include: { steps: true },
  });
  console.log("✅ 3 work orders (12 steps) created");

  // =========================================================================
  // 13. ROLLS
  // =========================================================================

  // Rolls from completed WO3 (Haki) – ready for shipment
  const roll1 = await prisma.roll.create({
    data: {
      barcode: "TOP-2026-001",
      itemId: itemBoyaliKumas3.id,
      initialQty: 520,
      currentQty: 505,
      weightKg: 62.5,
      status: "READY_FOR_SHIP",
      qualityGrade: "1.KALITE",
      producedInStepId: wo3.steps[2].id,
      packageId: "PKT-001",
      grossWeightKg: 64.0,
      netWeightKg: 62.5,
      packagingDate: new Date("2026-03-20"),
    },
  });

  const roll2 = await prisma.roll.create({
    data: {
      barcode: "TOP-2026-002",
      itemId: itemBoyaliKumas3.id,
      initialQty: 480,
      currentQty: 478,
      weightKg: 58.0,
      status: "READY_FOR_SHIP",
      qualityGrade: "1.KALITE",
      producedInStepId: wo3.steps[2].id,
      packageId: "PKT-002",
      grossWeightKg: 59.5,
      netWeightKg: 58.0,
      packagingDate: new Date("2026-03-20"),
    },
  });

  // Rolls from WO1 (Lacivert) – currently at Tambur
  const roll3 = await prisma.roll.create({
    data: {
      barcode: "TOP-2026-003",
      itemId: itemBoyaliKumas1.id,
      initialQty: 600,
      currentQty: 585,
      weightKg: 72.0,
      status: "IN_PRODUCTION",
      qualityGrade: "1.KALITE",
      currentStepId: wo1.steps[2].id,
    },
  });

  const roll4 = await prisma.roll.create({
    data: {
      barcode: "TOP-2026-004",
      itemId: itemBoyaliKumas1.id,
      initialQty: 550,
      currentQty: 540,
      weightKg: 66.0,
      status: "IN_PRODUCTION",
      qualityGrade: "1.KALITE",
      currentStepId: wo1.steps[2].id,
    },
  });

  const roll5 = await prisma.roll.create({
    data: {
      barcode: "TOP-2026-005",
      itemId: itemBoyaliKumas1.id,
      initialQty: 510,
      currentQty: 500,
      weightKg: 61.0,
      status: "IN_PRODUCTION",
      qualityGrade: "1.KALITE",
      currentStepId: wo1.steps[2].id,
    },
  });

  // Raw fabric rolls in stock
  const roll6 = await prisma.roll.create({
    data: {
      barcode: "HAM-TOP-001",
      itemId: itemHamKumas.id,
      initialQty: 1200,
      currentQty: 1200,
      weightKg: 145.0,
      status: "STOCK",
      qualityGrade: "1.KALITE",
    },
  });

  const roll7 = await prisma.roll.create({
    data: {
      barcode: "HAM-TOP-002",
      itemId: itemHamKumas.id,
      initialQty: 1100,
      currentQty: 1100,
      weightKg: 132.0,
      status: "STOCK",
      qualityGrade: "1.KALITE",
    },
  });

  // A scrap roll (fire)
  const rollScrap = await prisma.roll.create({
    data: {
      barcode: "TOP-2026-FIRE-001",
      itemId: itemBoyaliKumas3.id,
      initialQty: 15,
      currentQty: 15,
      weightKg: 1.8,
      status: "SCRAP",
      qualityGrade: "FIRE",
      producedInStepId: wo3.steps[2].id,
    },
  });

  // A shipped roll
  const rollShipped = await prisma.roll.create({
    data: {
      barcode: "TOP-2026-006",
      itemId: itemBoyaliKumas3.id,
      initialQty: 490,
      currentQty: 488,
      weightKg: 60.0,
      status: "SHIPPED",
      qualityGrade: "1.KALITE",
      producedInStepId: wo3.steps[2].id,
      packageId: "PKT-003",
      grossWeightKg: 61.5,
      netWeightKg: 60.0,
      packagingDate: new Date("2026-03-20"),
    },
  });
  console.log("✅ 9 rolls created");

  // =========================================================================
  // 14. ROLL ERRORS (Defects)
  // =========================================================================
  // Defects found at Kurşun for WO1 rolls
  const err1 = await prisma.rollError.create({
    data: {
      rollId: roll3.id,
      startMeter: 120,
      endMeter: 122,
      errorType: "LEKE",
      isProcessed: true,
      actionTaken: "KEPT_AS_A1",
    },
  });

  const err2 = await prisma.rollError.create({
    data: {
      rollId: roll3.id,
      startMeter: 350,
      endMeter: 365,
      errorType: "YIRTIK",
      isProcessed: true,
      actionTaken: "CUT_FOR_SCRAP",
    },
  });

  const err3 = await prisma.rollError.create({
    data: {
      rollId: roll4.id,
      startMeter: 200,
      endMeter: 201,
      errorType: "IPLIK_HATASI",
      isProcessed: false,
    },
  });

  const err4 = await prisma.rollError.create({
    data: {
      rollId: roll5.id,
      startMeter: 80,
      endMeter: 90,
      errorType: "BOYA_LEKESI",
      isProcessed: false,
    },
  });
  console.log("✅ 4 roll errors created");

  // =========================================================================
  // 15. ORDER ALLOCATIONS
  // =========================================================================
  // Allocate completed WO3 rolls to order3 (Haki)
  await prisma.orderAllocation.create({
    data: { orderLineId: order3.lines[0].id, rollId: roll1.id, allocatedQty: 505 },
  });
  await prisma.orderAllocation.create({
    data: { orderLineId: order3.lines[0].id, rollId: roll2.id, allocatedQty: 478 },
  });
  await prisma.orderAllocation.create({
    data: { orderLineId: order3.lines[0].id, rollId: rollShipped.id, allocatedQty: 488 },
  });
  console.log("✅ 3 order allocations created");

  // =========================================================================
  // 16. SHIPMENTS
  // =========================================================================
  // A completed shipment
  const shipment1 = await prisma.shipment.create({
    data: {
      shipmentNumber: "SEV-2026-001",
      customerId: customer3.id,
      driverName: "Hasan Şoför",
      plateNumber: "34 ABC 123",
      carrier: "Aras Kargo",
      status: "SHIPPED",
      shippedAt: new Date("2026-03-25"),
      items: {
        create: [
          { rollId: rollShipped.id, shippedQty: 488, shippedWeight: 60.0 },
        ],
      },
    },
  });

  // A shipment being prepared
  const shipment2 = await prisma.shipment.create({
    data: {
      shipmentNumber: "SEV-2026-002",
      customerId: customer3.id,
      driverName: "Mustafa Usta",
      plateNumber: "16 DEF 456",
      carrier: "Öz Taşımacılık",
      status: "PREPARING",
      items: {
        create: [
          { rollId: roll1.id, shippedQty: 505, shippedWeight: 62.5 },
          { rollId: roll2.id, shippedQty: 478, shippedWeight: 58.0 },
        ],
      },
    },
  });
  console.log("✅ 2 shipments (3 shipment items) created");

  // =========================================================================
  // 17. CURRENT ACCOUNTS (Finance)
  // =========================================================================
  await prisma.currentAccount.create({
    data: { customerId: customer1.id, balance: new Prisma.Decimal(45000.0), currency: "TRY" },
  });
  await prisma.currentAccount.create({
    data: { customerId: customer2.id, balance: new Prisma.Decimal(0), currency: "TRY" },
  });
  await prisma.currentAccount.create({
    data: { customerId: customer3.id, balance: new Prisma.Decimal(-12500.0), currency: "USD" },
  });
  await prisma.currentAccount.create({
    data: { customerId: supplierBoya.id, balance: new Prisma.Decimal(-8200.0), currency: "TRY" },
  });
  console.log("✅ 4 current accounts created");

  // =========================================================================
  // 18. MACHINE LOGS
  // =========================================================================
  await prisma.machineLog.createMany({
    data: [
      {
        machineId: machines[0].id,
        logType: "STATUS_UPDATE",
        details: { workingItemCode: "COZ-001", speed: 420, efficiency: 92.5 },
      },
      {
        machineId: machines[0].id,
        logType: "MAINTENANCE",
        details: { reason: "Periyodik bakım", duration: "2 saat", technician: "Ahmet Usta" },
      },
      {
        machineId: machines[1].id,
        logType: "STATUS_UPDATE",
        details: { workingItemCode: "COZ-001", speed: 380, efficiency: 88.0 },
      },
      {
        machineId: machines[6].id,
        logType: "STATUS_UPDATE",
        details: { lastWeigh: 62.5, unit: "KG", rollBarcode: "TOP-2026-001" },
      },
    ],
  });
  console.log("✅ 4 machine logs created");

  // =========================================================================
  // 19. SYSTEM LOGS (Audit Trail)
  // =========================================================================
  await prisma.systemLog.createMany({
    data: [
      {
        userId: salesUser.id,
        action: "CREATE",
        tableName: "ORDER",
        recordId: order1.id,
        oldData: Prisma.JsonNull,
        newData: { orderNumber: "SIP-2026-001", status: "PENDING" },
      },
      {
        userId: salesUser.id,
        action: "UPDATE",
        tableName: "ORDER",
        recordId: order1.id,
        oldData: { status: "PENDING" },
        newData: { status: "IN_PRODUCTION" },
      },
      {
        userId: plannerUser.id,
        action: "CREATE",
        tableName: "WORK_ORDER",
        recordId: wo1.id,
        oldData: Prisma.JsonNull,
        newData: { batchNumber: "PARTI-2026-001", status: "PLANNED" },
      },
      {
        userId: shippingUser.id,
        action: "CREATE",
        tableName: "SHIPMENT",
        recordId: shipment1.id,
        oldData: Prisma.JsonNull,
        newData: { shipmentNumber: "SEV-2026-001", status: "PREPARING" },
      },
      {
        userId: shippingUser.id,
        action: "UPDATE",
        tableName: "SHIPMENT",
        recordId: shipment1.id,
        oldData: { status: "PREPARING" },
        newData: { status: "SHIPPED" },
      },
    ],
  });
  console.log("✅ 5 system logs created");

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log("\n🎉 Seed completed successfully!");
  console.log("─".repeat(50));
  console.log("📊 Summary:");
  console.log("   Permissions:      23");
  console.log("   Roles:            6");
  console.log("   Users:            6");
  console.log("   Stations:         9");
  console.log("   Machines:         7");
  console.log("   Routes:           3");
  console.log("   Items:            7");
  console.log("   Customers:        5 (3 müşteri + 2 fasoncu)");
  console.log("   Orders:           3 (5 kalem)");
  console.log("   Work Orders:      3 (12 adım)");
  console.log("   Rolls:            9");
  console.log("   Roll Errors:      4");
  console.log("   Allocations:      3");
  console.log("   Shipments:        2 (3 kalem)");
  console.log("   Current Accounts: 4");
  console.log("   Machine Logs:     4");
  console.log("   System Logs:      5");
  console.log("─".repeat(50));
  console.log("\n🔑 Login credentials:");
  console.log("   admin / admin123      (Sistem Yöneticisi)");
  console.log("   mehmet.planlama / test123  (Planlama Şefi)");
  console.log("   ali.operator / test123     (Üretim Operatörü)");
  console.log("   ayse.kalite / test123      (Kalite Kontrol)");
  console.log("   fatma.satis / test123      (Satış Temsilcisi)");
  console.log("   veli.sevkiyat / test123    (Sevkiyatçı)");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
