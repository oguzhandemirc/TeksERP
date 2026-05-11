// =============================================================================
// TeksERP - Database Seed (MINIMAL)
// =============================================================================
// Sadece Permission, PermissionTemplate, User ve UserPermission yüklenir.
// Master data (item, customer, color, station, route, work order, roll vb.)
// kullanıcı tarafından runtime'da web/mobil arayüzlerinden tanımlanır.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as bcrypt from "bcryptjs";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

async function main() {
  console.log("🌱 Seeding minimal TeksERP data (auth only)...\n");

  // ===========================================================================
  // 1. PERMISSIONS
  // ===========================================================================
  // category: "web" | "mobile" | "admin"
  const permissionData: {
    code: string;
    module: string;
    category: "web" | "mobile" | "admin";
    description?: string;
  }[] = [
    // ----- WEB / API endpoint izinleri -----
    // SALES
    { code: "order:read", module: "SALES", category: "web" },
    { code: "order:write", module: "SALES", category: "web" },
    { code: "customer:read", module: "SALES", category: "web" },
    { code: "customer:write", module: "SALES", category: "web" },
    // PRODUCTION
    { code: "workorder:read", module: "PRODUCTION", category: "web" },
    { code: "workorder:write", module: "PRODUCTION", category: "web" },
    { code: "roll:read", module: "PRODUCTION", category: "web" },
    { code: "roll:write", module: "PRODUCTION", category: "web" },
    { code: "station:read", module: "PRODUCTION", category: "web" },
    { code: "station:write", module: "PRODUCTION", category: "web" },
    // MASTER_DATA
    { code: "item:read", module: "MASTER_DATA", category: "web" },
    { code: "item:write", module: "MASTER_DATA", category: "web" },
    // QUALITY
    { code: "quality:read", module: "QUALITY", category: "web" },
    { code: "quality:write", module: "QUALITY", category: "web" },
    // PROPERTY
    { code: "property:read", module: "QUALITY", category: "web" },
    { code: "property:write", module: "QUALITY", category: "web" },
    // LOGISTICS
    { code: "shipment:read", module: "LOGISTICS", category: "web" },
    { code: "shipment:write", module: "LOGISTICS", category: "web" },
    { code: "allocation:write", module: "LOGISTICS", category: "web" },
    // SUBCONTRACTOR (yeni — fason firma + kategori CRUD)
    { code: "subcontractor:read", module: "SUBCONTRACTOR", category: "web" },
    { code: "subcontractor:write", module: "SUBCONTRACTOR", category: "web" },
    // ADMIN
    { code: "admin:users", module: "ADMIN", category: "admin", description: "Kullanıcı + yetki yönetimi" },
    { code: "admin:settings", module: "ADMIN", category: "admin", description: "Sistem ayarları + log arşiv" },
    { code: "admin:*", module: "ADMIN", category: "admin", description: "Tüm admin yetkileri (wildcard)" },

    // ----- MOBİL EKRAN izinleri -----
    { code: "mobile:dokuma", module: "MOBILE", category: "mobile", description: "Dokuma ekranı" },
    { code: "mobile:kk1", module: "MOBILE", category: "mobile", description: "KK1 ham giriş ekranı" },
    { code: "mobile:kk2-kursun", module: "MOBILE", category: "mobile", description: "Kurşun + KK2 ekranı" },
    { code: "mobile:tambur", module: "MOBILE", category: "mobile", description: "Tambur karar ekranı" },
    { code: "mobile:depo", module: "MOBILE", category: "mobile", description: "Depo ekranı" },
    { code: "mobile:tarti-paket", module: "MOBILE", category: "mobile", description: "Tartı + Paket ekranı" },
    { code: "mobile:sevkiyat", module: "MOBILE", category: "mobile", description: "Sevkiyat ekranı" },
    { code: "mobile:fason-sevk", module: "MOBILE", category: "mobile", description: "Fason sevk ekranı" },
    { code: "mobile:fason-kabul", module: "MOBILE", category: "mobile", description: "Fason mal kabul ekranı" },
    { code: "mobile:*", module: "MOBILE", category: "mobile", description: "Tüm mobil ekranlar (wildcard)" },
  ];

  const permissions = await Promise.all(
    permissionData.map((p) => prisma.permission.create({ data: p }))
  );
  const permByCode = new Map(permissions.map((p) => [p.code, p]));
  console.log(`✅ ${permissions.length} permissions created`);

  const permissionIdsFor = (codes: string[]): string[] =>
    codes.map((c) => {
      const p = permByCode.get(c);
      if (!p) throw new Error(`Seed: permission '${c}' not found`);
      return p.id;
    });

  // ===========================================================================
  // 2. PERMISSION TEMPLATES — sadece Admin (Tam Yetki)
  // ===========================================================================
  await prisma.permissionTemplate.create({
    data: {
      name: "Admin (Tam Yetki)",
      description: "Tüm web + mobil + admin yetkileri",
      permissions: {
        create: permissionIdsFor(permissionData.map((p) => p.code)).map((pid) => ({
          permissionId: pid,
        })),
      },
    },
  });
  console.log("✅ 1 permission template created (Admin)");

  // ===========================================================================
  // 3. USERS
  // ===========================================================================
  const adminUser = await prisma.user.create({
    data: {
      username: "admin",
      passwordHash: await hashPassword("admin123"),
      fullName: "Sistem Yöneticisi",
    },
  });

  // Test kullanıcıları — şifre: test123
  const testUsers = await Promise.all(
    [
      { username: "mehmet.planlama", fullName: "Mehmet Yılmaz" },
      { username: "ali.operator", fullName: "Ali Demir" },
      { username: "ayse.kalite", fullName: "Ayşe Kaya" },
      { username: "fatma.satis", fullName: "Fatma Özdemir" },
      { username: "veli.sevkiyat", fullName: "Veli Çelik" },
      { username: "ali.kursun", fullName: "Ali (Mobil — Kurşun/KK2)" },
      { username: "ahmet.depo", fullName: "Ahmet (Mobil — Depo/Sevkiyat/Tambur)" },
    ].map(async (u) =>
      prisma.user.create({
        data: { ...u, passwordHash: await hashPassword("test123") },
      })
    )
  );
  console.log(`✅ ${1 + testUsers.length} users created`);

  // ===========================================================================
  // 4. USER PERMISSIONS — sadece admin'e tüm yetkileri ver
  // ===========================================================================
  // Diğer kullanıcılar yetkisiz başlar; admin web UI'sından kademeli atayacak.
  await prisma.userPermission.createMany({
    data: permissionData.map((p) => ({
      userId: adminUser.id,
      permissionId: permByCode.get(p.code)!.id,
      grantedById: adminUser.id,
    })),
  });
  console.log(`✅ Admin'e ${permissionData.length} yetki atandı`);

  console.log("\n🎉 Seed tamamlandı.\n");
  console.log("Kullanıcılar:");
  console.log("  admin / admin123        → Tam yetki");
  console.log("  Diğerleri / test123     → Yetkisiz (admin UI'dan atayın)\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
