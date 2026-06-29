// =============================================================================
// TeksERP - Database Seed
// =============================================================================
// Tek dosya, "boş DB'den sıfır kurulum" akışı. Her şey `create` ile yazılır;
// ikinci kez çalıştırılırsa unique constraint hatası verir — bu beklenen.
// Yeniden yüklemek için:
//
//   PGPASSWORD=... psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
//   npx prisma migrate dev
//   npm run seed
//
// Yüklenenler:
//   1. 54 permission (web + mobil + admin)
//   2. 14 permission template (Admin Tam Yetki + mobil/masaüstü roller)
//   3. 7 kullanıcı (admin + 6 test — admin dışı yetkisiz başlar)
//   4. Admin'e tüm yetkiler atanır
//   5. 3 kalite sınıfı (1.KALITE / A1 / FIRE)
//   6. Master demo (test ortamı için): 4 müşteri, 6 renk, 6 kumaş özelliği,
//      2 fason kategori (BOYA/ZIMPARA), 2 fason firma (Boyer/Kestel Zımpara)
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as bcrypt from "bcryptjs";
import "dotenv/config";
import { buildDefaultFields } from "../src/config/label-fields";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

async function main() {
  console.log("🌱 Seeding TeksERP test data...\n");

  // ===========================================================================
  // 1. PERMISSIONS
  // ===========================================================================
  const permissionData: {
    code: string;
    module: string;
    category: "web" | "mobile" | "admin";
    description?: string;
  }[] = [
    // ----- WEB / API endpoint izinleri -----
    { code: "order:read", module: "SALES", category: "web" },
    { code: "order:write", module: "SALES", category: "web" },
    { code: "customer:read", module: "SALES", category: "web" },
    { code: "customer:write", module: "SALES", category: "web" },
    { code: "workorder:read", module: "PRODUCTION", category: "web" },
    { code: "workorder:write", module: "PRODUCTION", category: "web" },
    { code: "roll:read", module: "PRODUCTION", category: "web" },
    { code: "roll:write", module: "PRODUCTION", category: "web" },
    { code: "roll:manual-adjust", module: "PRODUCTION", category: "web", description: "Süpervizör — manuel top düzeltme/kurtarma (üretime geri al, nitelik/durum düzeltme)" },
    { code: "station:read", module: "PRODUCTION", category: "web" },
    { code: "station:write", module: "PRODUCTION", category: "web" },
    { code: "item:read", module: "MASTER_DATA", category: "web" },
    { code: "item:write", module: "MASTER_DATA", category: "web" },
    { code: "quality:read", module: "QUALITY", category: "web" },
    { code: "quality:write", module: "QUALITY", category: "web" },
    { code: "property:read", module: "QUALITY", category: "web" },
    { code: "property:write", module: "QUALITY", category: "web" },
    { code: "subcontractor:read", module: "SUBCONTRACTOR", category: "web" },
    { code: "subcontractor:write", module: "SUBCONTRACTOR", category: "web" },
    { code: "kartela:read", module: "KARTELA", category: "web", description: "Kartela sevk/kabul takibi" },
    { code: "kartela:write", module: "KARTELA", category: "web", description: "Kartela sevk/kabul + iptal" },
    { code: "customer-alias:read", module: "SALES", category: "web" },
    { code: "customer-alias:write", module: "SALES", category: "web" },
    { code: "label:read", module: "LOGISTICS", category: "web", description: "Etiket payload'unu görüntüleme" },
    { code: "label:print", module: "LOGISTICS", category: "web", description: "Etiket basma aksiyonu" },
    { code: "label:edit", module: "LOGISTICS", category: "web", description: "Sipariş satırı bazlı müşteri ismi/renk override" },
    { code: "label-template:read", module: "LOGISTICS", category: "web", description: "Etiket template listele" },
    { code: "label-template:write", module: "LOGISTICS", category: "web", description: "Template CRUD" },
    { code: "shipping:read", module: "LOGISTICS", category: "web", description: "Sevkiyat/çuval listesi/detay görüntüleme" },
    { code: "shipping:write", module: "LOGISTICS", category: "web", description: "Çuval/irsaliye oluşturma, tartı/kapama, sevk" },
    { code: "return:read", module: "LOGISTICS", category: "web", description: "İade takibi raporu görüntüleme" },
    { code: "return:write", module: "LOGISTICS", category: "web", description: "İade alma + iade nedeni kataloğu CRUD" },
    { code: "admin:users", module: "ADMIN", category: "admin", description: "Kullanıcı + yetki yönetimi" },
    { code: "admin:settings", module: "ADMIN", category: "admin", description: "Sistem ayarları + log arşiv" },
    { code: "admin:*", module: "ADMIN", category: "admin", description: "Tüm admin yetkileri (wildcard)" },
    { code: "report:production", module: "REPORTS", category: "web", description: "Üretim raporları" },
    { code: "report:sales", module: "REPORTS", category: "web", description: "Sipariş raporları" },
    { code: "report:quality", module: "REPORTS", category: "web", description: "Kalite raporları" },
    { code: "report:inventory", module: "REPORTS", category: "web", description: "Stok & depo raporları" },
    { code: "report:subcontract", module: "REPORTS", category: "web", description: "Fason raporları" },
    { code: "report:customer", module: "REPORTS", category: "web", description: "Müşteri / satış profil raporları" },
    { code: "report:audit", module: "REPORTS", category: "web", description: "Sistem / audit raporları" },

    // ----- MOBİL EKRAN izinleri -----
    // Route'larda `requireAnyPermission("web:perm", "mobile:xxx")` ile web
    // yetkilerine alternatif kabul edilir.
    { code: "mobile:kk1", module: "MOBILE", category: "mobile", description: "KK1 ham giriş ekranı" },
    { code: "mobile:kk2-kursun", module: "MOBILE", category: "mobile", description: "Kurşun + KK2 ekranı" },
    { code: "mobile:tambur", module: "MOBILE", category: "mobile", description: "Tambur karar ekranı" },
    { code: "mobile:depo", module: "MOBILE", category: "mobile", description: "Depo ekranı" },
    { code: "mobile:fason-sevk", module: "MOBILE", category: "mobile", description: "Fason sevk ekranı" },
    { code: "mobile:fason-kabul", module: "MOBILE", category: "mobile", description: "Fason mal kabul ekranı" },
    { code: "mobile:kartela-sevk", module: "MOBILE", category: "mobile", description: "Kartela sevk ekranı" },
    { code: "mobile:kartela-kabul", module: "MOBILE", category: "mobile", description: "Kartela mal kabul ekranı" },
    { code: "mobile:tarti-paket", module: "MOBILE", category: "mobile", description: "Tartı & Paketleme ekranı" },
    { code: "mobile:sevkiyat", module: "MOBILE", category: "mobile", description: "Sevkiyat yönetimi ekranı" },
    { code: "mobile:iade", module: "MOBILE", category: "mobile", description: "İade girişi ekranı" },
    { code: "mobile:hizli-is-emri", module: "MOBILE", category: "mobile", description: "Hızlı İş Emri ekranı (stok topu okut → WO başlat + WO yönetimi)" },
    { code: "mobile:*", module: "MOBILE", category: "mobile", description: "Tüm mobil ekranlar (wildcard)" },
  ];

  const permissions = await Promise.all(
    permissionData.map((p) => prisma.permission.create({ data: p }))
  );
  const permByCode = new Map(permissions.map((p) => [p.code, p]));
  console.log(`✅ ${permissions.length} permission`);

  // ===========================================================================
  // 2. PERMISSION TEMPLATES (Admin + mobil roller)
  // ===========================================================================
  const templates: { name: string; description: string; codes: string[] }[] = [
    {
      name: "Admin (Tam Yetki)",
      description: "Tüm web + mobil + admin yetkileri",
      codes: permissionData.map((p) => p.code),
    },
    { name: "Mobil — KK1 Operatörü",         description: "Ham kumaş kabul ekranı",         codes: ["mobile:kk1"] },
    { name: "Mobil — KK2/Kurşun Operatörü",  description: "Kurşun + QC2 ekranı",            codes: ["mobile:kk2-kursun"] },
    { name: "Mobil — Tambur Operatörü",      description: "Tambur karar / kesim ekranı",    codes: ["mobile:tambur"] },
    { name: "Mobil — Depo Operatörü",        description: "Depo ekranı (read-only)",        codes: ["mobile:depo"] },
    { name: "Mobil — Fason Sevk Operatörü",  description: "Fason firmaya sevk ekranı",      codes: ["mobile:fason-sevk"] },
    { name: "Mobil — Fason Kabul Operatörü", description: "Fason firmadan mal kabul ekranı", codes: ["mobile:fason-kabul"] },
    { name: "Mobil — Kartela Sevk Operatörü",  description: "Kartela firmaya sevk ekranı",      codes: ["mobile:kartela-sevk"] },
    { name: "Mobil — Kartela Kabul Operatörü", description: "Kartela firmadan mal kabul ekranı", codes: ["mobile:kartela-kabul"] },
    { name: "Mobil — Paketleme Operatörü",   description: "Tartı & Paketleme ekranı",       codes: ["mobile:tarti-paket"] },
    { name: "Mobil — Sevkiyat Operatörü",    description: "Sevkiyat yönetimi ekranı",        codes: ["mobile:sevkiyat"] },
    { name: "Mobil — İade Operatörü",        description: "İade girişi ekranı",             codes: ["mobile:iade"] },
    {
      // Mobilde masaüstüyle aynı iş emri yetkileri: stok topu okut → WO başlat,
      // eski WO'ları listele/görüntüle/çıktı al/düzenle. Ekran görünürlüğü
      // `mobile:hizli-is-emri` ile; aksiyonlar için gereken master-data read'leri bundle'da.
      name: "Mobil — Hızlı İş Emri",
      description: "Stok topu okut → iş emri başlat + iş emri yönetimi (masaüstü WO yetkileri)",
      codes: [
        "mobile:hizli-is-emri",
        "workorder:read", "workorder:write",
        "roll:read",
        "item:read", "property:read", "station:read",
        "subcontractor:read", "order:read", "customer:read",
        "label:print",
      ],
    },
    { name: "Mobil — Tüm Ekranlar",          description: "Tüm mobil ekranlar (wildcard)",  codes: ["mobile:*"] },
  ];

  for (const tpl of templates) {
    await prisma.permissionTemplate.create({
      data: {
        name: tpl.name,
        description: tpl.description,
        permissions: {
          create: tpl.codes.map((c) => ({ permissionId: permByCode.get(c)!.id })),
        },
      },
    });
  }
  console.log(`✅ ${templates.length} permission template (Admin + ${templates.length - 1} mobil rol)`);

  // ===========================================================================
  // 3. USERS
  // ===========================================================================
  const adminUser = await prisma.user.create({
    data: {
      username: "admin",
      passwordHash: await hashPassword("123123"),
      fullName: "Sistem Yöneticisi",
    },
  });

  const testUsers = await Promise.all(
    [
      { username: "mehmet.planlama", fullName: "Mehmet Yılmaz" },
      { username: "ali.operator",    fullName: "Ali Demir" },
      { username: "ayse.kalite",     fullName: "Ayşe Kaya" },
      { username: "fatma.satis",     fullName: "Fatma Özdemir" },
      { username: "ali.kursun",      fullName: "Ali (Mobil — Kurşun/KK2)" },
      { username: "ahmet.depo",      fullName: "Ahmet (Mobil — Depo/Tambur)" },
    ].map(async (u) =>
      prisma.user.create({
        data: { ...u, passwordHash: await hashPassword("test123") },
      })
    )
  );
  console.log(`✅ ${1 + testUsers.length} kullanıcı (admin + ${testUsers.length} test)`);

  // ===========================================================================
  // 4. USER PERMISSIONS — sadece admin'e tüm yetkiler
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

  // ===========================================================================
  // 5. QUALITY GRADES — 1.KALITE / A1 / FIRE
  // ===========================================================================
  await prisma.qualityGrade.createMany({
    data: [
      // targetStatus = Tambur kesim hedefi (hep WAREHOUSE — proses-only fabrika).
      // returnTargetStatus = İADE rafı (returnGradingEnabled açıkken): FİRE→hurda,
      // A1→2.kalite stok, 1.Kalite→Hazır Depo. Tambur bu kolonu OKUMAZ.
      { code: "1.KALITE", name: "1. Kalite",       color: "#10b981", sortOrder: 10, targetStatus: "WAREHOUSE", returnTargetStatus: "WAREHOUSE" },
      { code: "A1",       name: "A1 (Alt Kalite)", color: "#f59e0b", sortOrder: 20, targetStatus: "WAREHOUSE", returnTargetStatus: "A1_STOCK" },
      { code: "FIRE",     name: "Fire",            color: "#ef4444", sortOrder: 30, targetStatus: "WAREHOUSE", returnTargetStatus: "SCRAP" },
    ],
  });
  console.log("✅ 3 kalite sınıfı (1.KALITE/A1/FIRE)");

  // İade nedenleri — admin sonradan ekleyip çıkarabilir (return:write); İade ekranında
  // seçenek olarak çıkar. Serbest metin (RollReturn.reasonText) ile birlikte opsiyonel.
  await prisma.returnReason.createMany({
    data: [
      { code: "YANLIS_URUN",      name: "Yanlış Ürün",      color: "#f59e0b", sortOrder: 10 },
      { code: "YANLIS_RENK_EN",   name: "Yanlış Renk/En",   color: "#f59e0b", sortOrder: 20 },
      { code: "HASARLI",          name: "Hasarlı",          color: "#ef4444", sortOrder: 30 },
      { code: "FAZLA_SEVK",       name: "Fazla Sevkiyat",   color: "#3b82f6", sortOrder: 40 },
      { code: "MUSTERI_VAZGECTI", name: "Müşteri Vazgeçti",  color: "#6b7280", sortOrder: 50 },
      { code: "DIGER",            name: "Diğer",            color: "#6b7280", sortOrder: 60 },
    ],
  });
  console.log("✅ 6 iade nedeni");

  // ===========================================================================
  // 6. MASTER DEMO (test ortamı — production'da çalıştırılmamalı)
  // ===========================================================================
  // Sıra: müşteri → renk → özellik → fason kategori/firma → istasyon → makine
  //       → istasyon yetenekleri → hata tipi → rota → ürün+izinler → alias
  //       → şube → etiket template

  // --- Müşteriler ---
  const customerData = [
    { code: "MUS-001", name: "Arda Tekstil A.Ş.",     taxNumber: "1234567890", type: "CUSTOMER" as const },
    { code: "MUS-002", name: "Moda Konfeksiyon Ltd.", taxNumber: "2345678901", type: "CUSTOMER" as const },
    { code: "MUS-003", name: "Beyaz Giyim San.",      taxNumber: "3456789012", type: "CUSTOMER" as const },
    { code: "MUS-004", name: "Yeşil Tekstil İhracat", taxNumber: "4567890123", type: "CUSTOMER" as const },
  ];
  const customers = await Promise.all(customerData.map((c) => prisma.customer.create({ data: c })));
  const custByCode = new Map(customers.map((c) => [c.code, c]));
  console.log(`✅ ${customers.length} müşteri`);

  // --- Renkler ---
  const colorData = [
    { code: "BEYAZ",    name: "BEYAZ",    hex: "#FFFFFF", sortOrder: 10 },
    { code: "SIYAH",    name: "SİYAH",    hex: "#000000", sortOrder: 20 },
    { code: "LACIVERT", name: "LACİVERT", hex: "#1e3a8a", sortOrder: 30 },
    { code: "KIRMIZI",  name: "KIRMIZI",  hex: "#dc2626", sortOrder: 40 },
    { code: "MAVI",     name: "MAVİ",     hex: "#2563eb", sortOrder: 50 },
    { code: "BEJ",      name: "BEJ",      hex: "#d4b896", sortOrder: 60 },
  ];
  const colors = await Promise.all(colorData.map((c) => prisma.color.create({ data: c })));
  const colorByCode = new Map(colors.map((c) => [c.code, c]));
  console.log(`✅ ${colors.length} renk`);

  // --- Kumaş özellikleri (KURSUN dahil 7 — KURSUN sadece kurşun istasyonunda uygulanır) ---
  const propertyData = [
    { code: "ANTIBAKTERIYEL", name: "Antibakteriyel", category: "Kimyasal",     color: "#10b981", sortOrder: 10 },
    { code: "SU_GECIRMEZ",    name: "Su Geçirmez",    category: "Kimyasal",     color: "#0ea5e9", sortOrder: 20 },
    { code: "YANMAZ",         name: "Yanmaz",         category: "Dayanıklılık", color: "#f97316", sortOrder: 30 },
    { code: "ELASTIK",        name: "Elastik",        category: "Dayanıklılık", color: "#8b5cf6", sortOrder: 40 },
    { code: "ZIMPARALI",      name: "Zımparalı",      category: "Yüzey",        color: "#a3a3a3", sortOrder: 50 },
    { code: "PARLAK",         name: "Parlak",         category: "Yüzey",        color: "#fbbf24", sortOrder: 60 },
    { code: "KURSUN",         name: "Kurşunlu",       category: "İşlem",        color: "#64748b", sortOrder: 70 },
  ];
  const properties = await Promise.all(propertyData.map((p) => prisma.fabricProperty.create({ data: p })));
  const propByCode = new Map(properties.map((p) => [p.code, p]));
  console.log(`✅ ${properties.length} kumaş özelliği`);

  // --- Fason kategori + firma ---
  const cats = await Promise.all([
    prisma.subcontractorCategory.create({
      data: {
        code: "BOYA",
        name: "Boyahane",
        description: "Renk veren fason adım — kabulde Roll.colorId + özellikleri WO'dan kopyalanır",
        appliesColor: true,
        appliesProperty: true,
      },
    }),
    prisma.subcontractorCategory.create({
      data: {
        code: "ZIMPARA",
        name: "Zımpara",
        description: "Yüzey işleme — kabulde yalnız özellik (Zımparalı) WO'dan kopyalanır",
        appliesColor: false,
        appliesProperty: true,
      },
    }),
    // Kartela fason kategorisi — bitmiş top kartelaya bu kategorideki firmalara
    // gönderilir. Renk/özellik uygulamaz (üretim rotasının parçası değil).
    prisma.subcontractorCategory.create({
      data: {
        code: "KARTELA",
        name: "Kartela",
        description: "Bitmiş top → kartela üretimi (kartela sevk/kabul firmaları)",
        appliesColor: false,
        appliesProperty: false,
      },
    }),
  ]);
  const catByCode = new Map(cats.map((c) => [c.code, c]));
  console.log(`✅ ${cats.length} fason kategori (BOYA, ZIMPARA, KARTELA)`);

  await prisma.subcontractor.create({
    data: {
      code: "BOYER",
      name: "Boyer Boyacılık",
      phone: "+90 212 555 1010",
      address: "İstanbul / Bayrampaşa",
      categories: { create: [{ categoryId: catByCode.get("BOYA")!.id }] },
    },
  });
  await prisma.subcontractor.create({
    data: {
      code: "KESTEL",
      name: "Kestel Zımpara",
      phone: "+90 224 555 2020",
      address: "Bursa / Kestel",
      categories: { create: [{ categoryId: catByCode.get("ZIMPARA")!.id }] },
    },
  });
  await prisma.subcontractor.create({
    data: {
      code: "KARTELAAS",
      name: "Kartela A.Ş.",
      phone: "+90 212 555 3030",
      address: "İstanbul / Zeytinburnu",
      categories: { create: [{ categoryId: catByCode.get("KARTELA")!.id }] },
    },
  });
  console.log("✅ 3 fason firma (BOYER, KESTEL, KARTELA A.Ş.)");

  // --- İstasyonlar ---
  // KK1 ham kumaş giriş noktası: bir tablet burada durur, operatör barkod basıp
  // yeni Roll oluşturur. WO step picker'da görünmemesi için allowAsWorkOrderStep=false.
  // İleride 2. bir KK1 noktası açılırsa aynı pattern ile eklenir.
  const kk1 = await prisma.station.create({
    data: {
      code: "KK1_1", name: "KK1 — Ham Mal Girişi", type: "INTERNAL", kind: "RAW_QC",
      department: "KALITE", allowAsWorkOrderStep: false,
    },
  });
  const kursun = await prisma.station.create({
    data: { code: "KURSUN_KK2", name: "Kurşun + KK2", type: "INTERNAL", kind: "PROCESS_QC", department: "KALITE" },
  });
  const tambur = await prisma.station.create({
    data: { code: "TAMBUR_1", name: "Tambur", type: "INTERNAL", kind: "TAMBUR", department: "KALITE" },
  });
  const boyaFason = await prisma.station.create({
    data: {
      code: "BOYA_FASON", name: "Boyahane (Fason)", type: "EXTERNAL", kind: "SUBCONTRACTOR",
      department: "TERBIYE", defaultCategoryId: catByCode.get("BOYA")!.id,
    },
  });
  const zimparaFason = await prisma.station.create({
    data: {
      code: "ZIMPARA_FASON", name: "Zımpara (Fason)", type: "EXTERNAL", kind: "SUBCONTRACTOR",
      department: "TERBIYE", defaultCategoryId: catByCode.get("ZIMPARA")!.id,
    },
  });
  console.log("✅ 5 istasyon (KK1 entry-only, Kurşun+KK2, Tambur, Boya, Zımpara)");

  // --- Makineler (içerideki istasyonlar için; tablet/makine bu Machine altına pair'lenir) ---
  await prisma.machine.createMany({
    data: [
      { stationId: kk1.id,    code: "KK1-M1",    name: "KK1 Tablet 1" },
      { stationId: kursun.id, code: "KK2-M1",    name: "KK2 Makine 1" },
      { stationId: tambur.id, code: "TAMBUR-M1", name: "Tambur Makine 1" },
    ],
  });
  console.log("✅ 3 makine (KK1-M1, KK2-M1, TAMBUR-M1)");

  // --- Yazıcı modeli kataloğu + etiket format profilleri ---
  // "Yazıcı değişse de format/komut tanımları kaybolmasın" → kalıcı katalog.
  // Argox OS 214 plus: 203dpi, max 104mm. Kumaş etiketi medya 100×60 mm YATAY +
  // 3mm GÜVENLİK PAYI (içerik ~94×54) — topa yatay yapıştırılır; iki kolon
  // (sol QR+barkod, sağ metin). Etiket birkaç mm küçük çıksa bile kırpılmaz.
  const argoxProfile = await prisma.labelFormatProfile.create({
    data: {
      code: "ARGOX_TOP_100x60",
      name: "Argox 100×60 mm Yatay Top (3mm pay)",
      widthMm: 100, heightMm: 60, marginMm: 3, gapMm: 2, dpi: 203, orientation: "LANDSCAPE",
    },
  });
  // Sistem default profili — Electron (device yok) ve resolver fallback bunu kullanır.
  await prisma.labelFormatProfile.create({
    data: {
      code: "DEFAULT",
      name: "Varsayılan Top Etiketi (100×60 yatay, 3mm pay)",
      widthMm: 100, heightMm: 60, marginMm: 3, gapMm: 2, dpi: 203, orientation: "LANDSCAPE",
    },
  });
  const argox = await prisma.printerModel.create({
    data: {
      code: "ARGOX_OS214_PLUS",
      name: "Argox OS 214 plus",
      manufacturer: "Argox",
      dpi: 203, maxWidthMm: 104, language: "PPLA",
      defaultProfileId: argoxProfile.id,
    },
  });
  console.log("✅ Yazıcı modeli (Argox OS 214 plus, PPLA) + 2 etiket format profili");

  // --- Makine donanımı (saha yazıcı + RS232 ara cihaz config örnekleri) ---
  // Dokümantasyon + cihaz/kodlama seçimi. Faz-1 donanım SİMÜLE; bu kayıtlar örnek.
  const seededMachines = await prisma.machine.findMany({
    where: { code: { in: ["KK1-M1", "KK2-M1", "TAMBUR-M1"] } },
    select: { id: true, code: true },
  });
  const mById = (code: string) => seededMachines.find((m) => m.code === code)?.id;
  const hwData = [
    {
      code: "KK1-M1",
      printerIp: "192.168.1.50",
      printerMac: "00:23:09:01:15:01",
      kqMac: "00:23:09:01:1D:17",
      mtMac: "00:23:09:01:1D:17",
      kqPattern: "(\\d+(?:\\.\\d+)?)",
      mtPattern: "y",
      notes: "KK1 — kantar + metre okuyucu (örnek config)",
    },
    {
      code: "KK2-M1",
      printerIp: "192.168.1.51",
      printerMac: "00:23:09:01:AB:B9",
      kqMac: "00:23:09:01:37:89",
      mtMac: "00:23:09:01:37:89",
      notes: "KK2/Kurşun — yazıcı + tek RS232 köprü",
    },
    {
      code: "TAMBUR-M1",
      printerIp: "192.168.1.52",
      printerMac: "00:23:09:01:A6:87",
      kqMac: "00:23:09:01:19:C7",
      mtMac: "00:23:09:01:05:5E",
      mtMac2: "00:23:09:01:1E:1B",
      notes: "Tambur — 2 kanal metre okuyucu",
    },
  ];
  for (const h of hwData) {
    const machineId = mById(h.code);
    if (!machineId) continue;
    const { code: _c, ...rest } = h;
    void _c;
    await prisma.machineHardware.create({
      data: { machineId, ...rest, printerModelId: argox.id, formatProfileId: argoxProfile.id },
    });
  }
  console.log(`✅ ${hwData.length} makine donanım config (örnek yazıcı/RS232 desenleri)`);

  // --- Birleşik cihaz kaydı (PeripheralDevice) — örnek ağ yazıcısı ---
  // Tambur makinesine bağlı Argox ağ yazıcısı (NETWORK_TCP). Baskı anında
  // label.service cihaz→{dil,profil,şablon} çözer. Mobil BT yazıcılar sahada
  // register-bt ile kendiliğinden eklenir.
  const tamburMachineId = mById("TAMBUR-M1");
  if (tamburMachineId) {
    const peripheral = await prisma.peripheralDevice.create({
      data: {
        code: "TAMBUR-ARGOX-01",
        name: "Tambur Argox (ağ)",
        kind: "LABEL_PRINTER",
        connectionType: "NETWORK_TCP",
        address: "192.168.1.52",
        port: 9100,
        machineId: tamburMachineId,
        printerModelId: argox.id,
        formatProfileId: argoxProfile.id,
      },
    });
    const finishedDefault = await prisma.labelTemplate.findFirst({
      where: { kind: "ROLL_FINISHED", isDefault: true, isActive: true },
      select: { id: true },
    });
    if (finishedDefault) {
      await prisma.peripheralTemplateRoute.create({
        data: { peripheralId: peripheral.id, kind: "ROLL_FINISHED", templateId: finishedDefault.id },
      });
    }
    console.log("✅ Örnek cihaz kaydı (Tambur Argox, NETWORK_TCP, PPLA)");
  }

  // --- İstasyon yetenekleri ---
  // Boyahane: tüm 6 renk + 5 özellik (Kurşun ve Zımparalı hariç — onlar başka istasyonun işi)
  await prisma.stationColor.createMany({
    data: colors.map((c) => ({ stationId: boyaFason.id, colorId: c.id })),
  });
  const boyaPropCodes = ["ANTIBAKTERIYEL", "SU_GECIRMEZ", "YANMAZ", "ELASTIK", "PARLAK"];
  await prisma.stationProperty.createMany({
    data: boyaPropCodes.map((code) => ({ stationId: boyaFason.id, propertyId: propByCode.get(code)!.id })),
  });
  // Kurşun: yalnız KURSUN özelliği
  await prisma.stationProperty.create({
    data: { stationId: kursun.id, propertyId: propByCode.get("KURSUN")!.id },
  });
  // Zımpara: yalnız ZIMPARALI özelliği
  await prisma.stationProperty.create({
    data: { stationId: zimparaFason.id, propertyId: propByCode.get("ZIMPARALI")!.id },
  });
  // Tambur'un yeteneği yok (karar noktası).
  console.log("✅ İstasyon yetenekleri (Boya=6 renk+5 özellik, Kurşun=KURSUN, Zımpara=ZIMPARALI)");

  // --- Hata tipleri ---
  // Saha #18: GENEL — KK2'de hata tipini belirtmek istemeyen operatör için
  // varsayılan/hızlı tuş (mobil ekran code'a göre öne çıkarır).
  await prisma.defectType.createMany({
    data: [
      { code: "GENEL",  name: "Genel Hata", severity: "MINOR" },
      { code: "YIRTIK", name: "Yırtık",  severity: "MAJOR" },
      { code: "LEKE",   name: "Lekeli",  severity: "MINOR" },
    ],
  });
  console.log("✅ 3 hata tipi (Genel Hata, Yırtık, Lekeli)");

  // --- Rota şablonları (generic + 1 ARDA-özel) ---
  await prisma.route.create({
    data: {
      code: "STD-BOYA", name: "Standart Boyama", description: "Boya → Kurşun+KK2 → Tambur", isFavorite: true,
      steps: { create: [
        { sequence: 1, stationId: boyaFason.id },
        { sequence: 2, stationId: kursun.id },
        { sequence: 3, stationId: tambur.id },
      ]},
    },
  });
  await prisma.route.create({
    data: {
      code: "BOYA-ZIMPARA", name: "Boya + Zımpara", description: "Boya → Zımpara → Kurşun+KK2 → Tambur",
      steps: { create: [
        { sequence: 1, stationId: boyaFason.id },
        { sequence: 2, stationId: zimparaFason.id },
        { sequence: 3, stationId: kursun.id },
        { sequence: 4, stationId: tambur.id },
      ]},
    },
  });
  // ARDA Tekstil'e özel rota — defaultRoutes ilişkisinin demo'su
  await prisma.route.create({
    data: {
      code: "ARDA-HIZLI", name: "ARDA — Hızlı Boyama",
      description: "ARDA için kısa rota (kurşun atlanır, doğrudan tambur)",
      customerId: custByCode.get("MUS-001")!.id,
      steps: { create: [
        { sequence: 1, stationId: boyaFason.id },
        { sequence: 2, stationId: tambur.id },
      ]},
    },
  });
  console.log("✅ 3 rota şablonu (2 generic + 1 ARDA-özel)");

  // --- Patos kumaşı + tüm renk/özellik izinli ---
  const patos = await prisma.item.create({
    data: {
      code: "PATOS", name: "PATOS", itemType: "FABRIC", unit: "MT",
      allowedColors:     { create: colors.map((c) => ({ colorId: c.id })) },
      allowedProperties: { create: properties.map((p) => ({ propertyId: p.id })) },
    },
  });
  console.log(`✅ Patos kumaşı (tüm ${colors.length} renk + ${properties.length} özellik izinli)`);

  // --- Customer-Item alias (her müşterinin Patos için kendi adı) ---
  const itemAliases = [
    { customerCode: "MUS-001", alias: "Soft Patos" },
    { customerCode: "MUS-002", alias: "Premium Pamuk" },
    { customerCode: "MUS-003", alias: "Klasik Patos" },
    { customerCode: "MUS-004", alias: "Eco Patos" },
  ];
  await prisma.customerItemAlias.createMany({
    data: itemAliases.map((a) => ({
      customerId: custByCode.get(a.customerCode)!.id,
      itemId:     patos.id,
      alias:      a.alias,
    })),
  });
  console.log(`✅ ${itemAliases.length} Patos müşteri alias'ı`);

  // --- Customer-Color alias (örnek 3: aynı renk farklı müşteride farklı isim) ---
  const colorAliases = [
    { customerCode: "MUS-001", colorCode: "MAVI",     alias: "Royal Blue" },
    { customerCode: "MUS-002", colorCode: "LACIVERT", alias: "Navy" },
    { customerCode: "MUS-003", colorCode: "BEYAZ",    alias: "Saf Beyaz" },
  ];
  await prisma.customerColorAlias.createMany({
    data: colorAliases.map((a) => ({
      customerId: custByCode.get(a.customerCode)!.id,
      colorId:    colorByCode.get(a.colorCode)!.id,
      alias:      a.alias,
    })),
  });
  console.log(`✅ ${colorAliases.length} renk alias'ı`);

  // --- Customer şubeleri (ARDA 2, Moda 1; diğerleri tek-şube/şubesiz) ---
  await prisma.customerBranch.createMany({
    data: [
      { customerId: custByCode.get("MUS-001")!.id, code: "IST", name: "İstanbul Merkez",
        address: "Tekstilkent Sanayi Sitesi", city: "İstanbul", district: "Esenyurt",
        contactName: "Murat Bey", contactPhone: "+90 212 555 0001" },
      { customerId: custByCode.get("MUS-001")!.id, code: "ANK", name: "Ankara Şube",
        city: "Ankara", district: "OSTİM", contactName: "Selim Bey", contactPhone: "+90 312 555 0002" },
      { customerId: custByCode.get("MUS-002")!.id, code: "IZM", name: "İzmir Merkez",
        city: "İzmir", district: "Bornova", contactName: "Aylin Hanım", contactPhone: "+90 232 555 0003" },
    ],
  });
  console.log("✅ 3 şube (ARDA: İstanbul + Ankara, Moda: İzmir)");

  // --- Label template'ler (her LabelKind için default — etiket endpoint'leri için zorunlu) ---
  await prisma.labelTemplate.create({
    data: {
      name: "Standart Ham Top Etiketi", kind: "ROLL_RAW", isDefault: true,
      fields: buildDefaultFields("ROLL_RAW") as unknown as object,
    },
  });
  await prisma.labelTemplate.create({
    data: {
      name: "Standart Bitmiş Top Etiketi", kind: "ROLL_FINISHED", isDefault: true,
      fields: buildDefaultFields("ROLL_FINISHED") as unknown as object,
    },
  });
  await prisma.labelTemplate.create({
    data: {
      name: "Standart Kartela Etiketi", kind: "SWATCH", isDefault: true,
      fields: buildDefaultFields("SWATCH") as unknown as object,
    },
  });
  console.log("✅ 3 label template (ROLL_RAW + ROLL_FINISHED + SWATCH default)");

  console.log("\n🎉 Seed tamamlandı.\n");
  console.log("Kullanıcılar:");
  console.log("  admin / 123123          → Tam yetki");
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
