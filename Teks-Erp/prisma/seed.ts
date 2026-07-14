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
//   1. 55 permission (web + mobil + admin — roll:manual-adjust dahil)
//   2. 15 permission template (Admin Tam Yetki + mobil/masaüstü roller)
//   3. 1 kullanıcı (yalnız admin — ek test kullanıcıları kaldırıldı 2026-07-03)
//   4. Admin'e tüm yetkiler atanır
//   5. 3 kalite sınıfı (1.KALITE / A1 / FIRE)
//   6. Master demo (test ortamı için): 4 müşteri, 6 renk, 7 kumaş özelliği,
//      3 fason kategori (BOYA/ZIMPARA/KARTELA), 3 fason firma (Boyer/Kestel/Kartela A.Ş.)
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
    { code: "order:read", module: "SALES", category: "web", description: "Sipariş listesi/detay görüntüleme" },
    { code: "order:write", module: "SALES", category: "web", description: "Sipariş oluşturma/düzenleme/iptal" },
    { code: "customer:read", module: "SALES", category: "web", description: "Müşteri listesi/detay görüntüleme" },
    { code: "customer:write", module: "SALES", category: "web", description: "Müşteri oluşturma/düzenleme" },
    { code: "workorder:read", module: "PRODUCTION", category: "web", description: "İş emri listesi/detay görüntüleme" },
    { code: "workorder:write", module: "PRODUCTION", category: "web", description: "İş emri oluşturma/düzenleme/finalize etme" },
    { code: "roll:read", module: "PRODUCTION", category: "web", description: "Top (rulo) listesi/detay görüntüleme" },
    { code: "roll:write", module: "PRODUCTION", category: "web", description: "Top oluşturma/durum güncelleme" },
    { code: "roll:manual-adjust", module: "PRODUCTION", category: "web", description: "Süpervizör — manuel top düzeltme/kurtarma (üretime geri al, nitelik/durum düzeltme)" },
    { code: "station:read", module: "PRODUCTION", category: "web", description: "Üretim istasyonu listesi/detay görüntüleme" },
    { code: "station:write", module: "PRODUCTION", category: "web", description: "Üretim istasyonu tanımlama/düzenleme" },
    { code: "item:read", module: "MASTER_DATA", category: "web", description: "Ürün/kumaş tanımı listesi/detay görüntüleme" },
    { code: "item:write", module: "MASTER_DATA", category: "web", description: "Ürün/kumaş tanımı oluşturma/düzenleme" },
    { code: "quality:read", module: "QUALITY", category: "web", description: "Kalite derecesi tanımlarını görüntüleme" },
    { code: "quality:write", module: "QUALITY", category: "web", description: "Kalite derecesi tanımlama/düzenleme" },
    { code: "property:read", module: "QUALITY", category: "web", description: "Özellik (renk/desen vb.) tanımlarını görüntüleme" },
    { code: "property:write", module: "QUALITY", category: "web", description: "Özellik tanımlama/düzenleme" },
    { code: "subcontractor:read", module: "SUBCONTRACTOR", category: "web", description: "Fason firma listesi/detay görüntüleme" },
    { code: "subcontractor:write", module: "SUBCONTRACTOR", category: "web", description: "Fason firma oluşturma/düzenleme" },
    { code: "kartela:read", module: "KARTELA", category: "web", description: "Kartela sevk/kabul takibi" },
    { code: "kartela:write", module: "KARTELA", category: "web", description: "Kartela sevk/kabul + iptal" },
    { code: "customer-alias:read", module: "SALES", category: "web", description: "Müşteriye özel renk/isim eşlemesini görüntüleme" },
    { code: "customer-alias:write", module: "SALES", category: "web", description: "Müşteriye özel renk/isim eşlemesi tanımlama" },
    { code: "label:read", module: "LOGISTICS", category: "web", description: "Etiket payload'unu görüntüleme" },
    { code: "label:print", module: "LOGISTICS", category: "web", description: "Etiket basma aksiyonu" },
    { code: "label:edit", module: "LOGISTICS", category: "web", description: "Sipariş satırı bazlı müşteri ismi/renk override" },
    { code: "label-template:read", module: "LOGISTICS", category: "web", description: "Etiket şablonu listele" },
    { code: "label-template:write", module: "LOGISTICS", category: "web", description: "Etiket şablonu oluşturma/düzenleme/silme" },
    { code: "shipping:read", module: "LOGISTICS", category: "web", description: "Sevkiyat/çuval listesi/detay görüntüleme" },
    { code: "shipping:write", module: "LOGISTICS", category: "web", description: "Çuval/irsaliye oluşturma, tartı/kapama, sevk" },
    { code: "return:read", module: "LOGISTICS", category: "web", description: "İade takibi raporu görüntüleme" },
    { code: "return:write", module: "LOGISTICS", category: "web", description: "İade alma + iade nedeni kataloğu oluşturma/düzenleme/silme" },
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
    { code: "mobile:hizli-is-emri", module: "MOBILE", category: "mobile", description: "Hızlı İş Emri ekranı (stok topu okut → iş emri başlat + iş emri yönetimi)" },
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
    {
      // Yeni kullanıcının varsayılan aldığı üretim paketi (KK1↔KK2↔Tambur rotasyonu).
      // createUser bunu otomatik verir; şablon admin'in sonradan tek tıkla uygulaması için.
      name: "Mobil — Üretim Operatörü",
      description: "KK1 + Kurşun/KK2 + Tambur (varsayılan istasyon rotasyonu)",
      codes: ["mobile:kk1", "mobile:kk2-kursun", "mobile:tambur"],
    },
    { name: "Mobil — KK1 Operatörü",         description: "Ham kumaş kabul ekranı",         codes: ["mobile:kk1"] },
    { name: "Mobil — KK2/Kurşun Operatörü",  description: "Kurşun + QC2 ekranı",            codes: ["mobile:kk2-kursun"] },
    { name: "Mobil — Tambur Operatörü",      description: "Tambur karar / kesim ekranı",    codes: ["mobile:tambur"] },
    { name: "Mobil — Depo Operatörü",        description: "Depo ekranı (salt-okunur)",        codes: ["mobile:depo"] },
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
      description: "Stok topu okut → iş emri başlat + iş emri yönetimi (masaüstü iş emri yetkileriyle aynı)",
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
  // Yalnız admin seed'lenir. Ek test kullanıcıları KALDIRILDI (kullanıcı isteği:
  // her reseed'de tek tek silmek zorunda kalıyordu). Yeni kullanıcılar admin
  // panelinden açılır; HTTP testleri (test_http_api / test_direct_ship_api) kendi
  // geçici 0-izinli kullanıcılarını üretip temizler.
  const adminUser = await prisma.user.create({
    data: {
      username: "admin",
      passwordHash: await hashPassword("123123"),
      fullName: "Sistem Yöneticisi",
    },
  });
  console.log("✅ 1 kullanıcı (admin)");

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
  // Sevkiyat/paketleme noktası: üretim dışı MAKİNESİZ istasyon (StationKind.SHIPPING).
  // Donanım (çuval kantarı) doğrudan İSTASYONA bağlanır (PeripheralDevice.stationId);
  // telefonlar burada makinesiz istasyon-oturumu açar (birden çok tartı telefonu serbest).
  const sevk = await prisma.station.create({
    data: {
      code: "SEVK_1", name: "Sevkiyat / Paketleme", type: "INTERNAL", kind: "SHIPPING",
      department: "SEVKIYAT", allowAsWorkOrderStep: false,
    },
  });
  console.log("✅ 6 istasyon (KK1 entry-only, Kurşun+KK2, Tambur, Boya, Zımpara, Sevkiyat)");

  // --- Makineler (içerideki üretim istasyonları; tablet oturumla bu makinelere bağlanır) ---
  // Sevkiyat MAKİNESİZ (SHIPPING) — makine kaydı yok; kantar istasyona bağlı (aşağıda).
  await prisma.machine.createMany({
    data: [
      { stationId: kk1.id,    code: "KK1-M1",    name: "KK1 Tablet 1" },
      { stationId: kursun.id, code: "KK2-M1",    name: "KK2 Makine 1" },
      { stationId: tambur.id, code: "TAMBUR-M1", name: "Tambur Makine 1" },
    ],
  });
  console.log("✅ 3 makine (KK1-M1, KK2-M1, TAMBUR-M1)");

  // --- Sistem varsayılan etiket medyası (Etiket Stüdyosu v2) ---
  // "Boyutlar" (LabelFormatProfile) kataloğu KALDIRILDI: medya artık doğrudan yazıcı
  // cihazında (labelWidthMm vd.). Cihaz seçili değilken (Electron önizleme, kartela)
  // bu ayar kullanılır. Argox OS 214 plus kumaş etiketi: 100×58 mm YATAY, 203dpi,
  // 2mm gap, 3mm GÜVENLİK PAYI (içerik ~94×52) — topa yatay yapıştırılır.
  const DEFAULT_MEDIA = { widthMm: 100, heightMm: 58, dpi: 203, gapMm: 2, marginMm: 3 };
  await prisma.systemSetting.upsert({
    where: { key: "label.defaultMedia" },
    create: { key: "label.defaultMedia", value: DEFAULT_MEDIA },
    update: { value: DEFAULT_MEDIA },
  });
  console.log("✅ Sistem varsayılan etiket medyası (label.defaultMedia = 100×58, 203dpi)");

  // --- Saha donanımı: makineye-bağlı yazıcılar (PeripheralDevice, NETWORK_TCP) ---
  // MachineHardware emekli; saha donanımının TEK kaynağı PeripheralDevice. Faz-1
  // gönderim simüle. KK1/KK2 yazıcıları burada; Tambur yazıcısı aşağıda (TAMBUR-ARGOX-01).
  const seededMachines = await prisma.machine.findMany({
    where: { code: { in: ["KK1-M1", "KK2-M1", "TAMBUR-M1"] } },
    select: { id: true, code: true },
  });
  const mById = (code: string) => seededMachines.find((m) => m.code === code)?.id;
  const stationPrinters = [
    { code: "KK1-ARGOX-01", name: "KK1 Argox (ağ)", machineCode: "KK1-M1", address: "192.168.1.50" },
    { code: "KK2-ARGOX-01", name: "KK2 Argox (ağ)", machineCode: "KK2-M1", address: "192.168.1.51" },
  ];
  for (const sp of stationPrinters) {
    const machineId = mById(sp.machineCode);
    if (!machineId) continue;
    await prisma.peripheralDevice.create({
      data: {
        code: sp.code, name: sp.name, kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP",
        address: sp.address, port: 9100, machineId, languageOverride: "PPLA",
        labelWidthMm: 100, labelHeightMm: 58, labelDpi: 203, labelGapMm: 2,
      },
    });
  }
  console.log(`✅ ${stationPrinters.length} istasyon yazıcısı (PeripheralDevice, NETWORK_TCP)`);

  // --- Birleşik cihaz kaydı (PeripheralDevice) — Tambur ağ yazıcısı ---
  // Tambur makinesine bağlı Argox ağ yazıcısı (NETWORK_TCP). Baskı anında
  // label.service cihaz→{dil,medya,şablon} çözer. Mobil BT yazıcılar sahada
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
        languageOverride: "PPLA",
        labelWidthMm: 100, labelHeightMm: 58, labelDpi: 203, labelGapMm: 2,
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

  // --- Saha giriş cihazları (PeripheralDevice: METER) — RS232→HC-06 (BT) ---
  // Tambur: 2-kat + 4-kat metre okuyucu (foldType→role ile seçilir). KK1: tek
  // metre (role PRIMARY) — ham mal girişinde metraj otomatik okunur (kg manuel).
  // Faz-1 simüle (simulate=true); MAC/protokol örnek — sahada Cihaz Kaydı'ndan düzenlenir.
  const kk1MachineId = mById("KK1-M1");
  if (tamburMachineId) {
    await prisma.peripheralDevice.createMany({
      data: [
        {
          code: "TAMBUR-METRE-2KAT", name: "Tambur 2 Kat Metre",
          kind: "METER", connectionType: "BLUETOOTH_SPP",
          address: "00:23:09:01:05:5E", role: "2-KAT",
          terminator: "\r\n", decimals: 1, unit: "m", timeoutMs: 2500, simulate: true,
          machineId: tamburMachineId,
        },
        {
          code: "TAMBUR-METRE-4KAT", name: "Tambur 4 Kat Metre",
          kind: "METER", connectionType: "BLUETOOTH_SPP",
          address: "00:23:09:01:1E:1B", role: "4-KAT",
          terminator: "\r\n", decimals: 1, unit: "m", timeoutMs: 2500, simulate: true,
          machineId: tamburMachineId,
        },
      ],
    });
    console.log("✅ Tambur 2-kat/4-kat metre cihazları (METER, BT-SPP, role)");
  }
  if (kk1MachineId) {
    await prisma.peripheralDevice.create({
      data: {
        code: "KK1-METRE", name: "KK1 Metre",
        kind: "METER", connectionType: "BLUETOOTH_SPP",
        address: "00:23:09:01:1D:17", role: "PRIMARY",
        terminator: "\r\n", decimals: 1, unit: "m", timeoutMs: 2500, simulate: true,
        machineId: kk1MachineId,
      },
    });
    console.log("✅ KK1 metre cihazı (METER, BT-SPP, role PRIMARY)");
  }

  // --- Sevkiyat kantarı (PeripheralDevice: SCALE) — HC-06 → Android telefon (BT-SPP) ---
  // Çuval brüt tartısı buradan okunur (mobil PaketlemeScreen "Tart"). Telefon kantara
  // doğrudan Bluetooth Classic (BT-SPP) ile bağlanır. Sevkiyat MAKİNESİZ istasyon
  // (SHIPPING) — kantar doğrudan İSTASYONA bağlı (stationId), oturum-kapsamlı çözülür.
  // address = HC-06 MAC; pollCommand = istek-cevap komutu (tam komut + format sahada
  // Cihaz Kaydı'ndan girilir). Faz-1 simüle (simulate=true).
  await prisma.peripheralDevice.create({
    data: {
      code: "SEVK-KANTAR", name: "Sevkiyat Kantarı",
      kind: "SCALE", connectionType: "BLUETOOTH_SPP",
      address: "00:23:09:01:2A:3C", role: "PRIMARY",
      pollCommand: "P", terminator: "\r\n", decimals: 2, unit: "kg", timeoutMs: 2500, simulate: true,
      stationId: sevk.id,
    },
  });
  console.log("✅ Sevkiyat kantarı (SCALE, BT-SPP, istasyona bağlı — SEVK_1)");

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
  console.log("Kullanıcı:");
  console.log("  admin / 123123          → Tam yetki (tek seed kullanıcısı)\n");
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
