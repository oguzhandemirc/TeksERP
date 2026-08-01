// =============================================================================
// TeksERP - Database Seed
// =============================================================================
// Tek dosya, "boş DB'den sıfır kurulum" akışı. Her şey `create` ile yazılır;
// ikinci kez çalıştırılırsa unique constraint hatası verir — bu beklenen.
// (TEK İSTİSNA: izin satırları — onların ikinci bir yazarı var, backend'in
//  boot-time uzlaştırması; gerekçe 1. adımın başında.)
// Yeniden yüklemek için:
//
//   PGPASSWORD=... psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
//   npx prisma migrate dev
//   npm run seed
//
// Yüklenenler (TEMİZ FABRİKA KURULUMU — müşteri/renk/ürün/sipariş/top YOK):
//   1. 58 permission (web + mobil + admin — roll:manual-adjust dahil)
//      TEK KAYNAK: `src/constants/permission-catalog.ts` (liste artık burada değil)
//   2. 15 permission template (Admin Tam Yetki + mobil/masaüstü roller)
//   3. 1 kullanıcı (yalnız admin)
//   4. Admin'e tüm yetkiler atanır
//   5. 3 kalite sınıfı (1.KALITE / A1 / FIRE) + 6 iade nedeni
//   6. Çekirdek üretim: 2 kumaş özelliği (KURSUN/ZIMPARALI), 3 fason kategori
//      (BOYA/ZIMPARA/KARTELA), 3 fason firma (Boyer/Kestel/Kartela A.Ş.),
//      6 istasyon, 3 makine, 23 sistem ayarı (mevcut fabrika ayarları birebir),
//      7 donanım cihazı, istasyon yetenekleri, 3 hata tipi, 2 rota, 3 etiket şablonu
// =============================================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as bcrypt from "bcryptjs";
import "dotenv/config";
// Oturumu UTC-ye sabitler — adapter-pg timestamptz-i UTC varsayar (bkz. src/lib/pg-session.ts).
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";
import { buildDefaultFields } from "../src/config/label-fields";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: PG_SESSION_OPTIONS });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

async function main() {
  console.log("🌱 TeksERP — temiz fabrika kurulumu seed'i...\n");

  // ===========================================================================
  // 1. PERMISSIONS
  // ===========================================================================
  // Liste burada DEĞİL — TEK KAYNAK `src/constants/permission-catalog.ts`.
  // Aynı katalogu backend açılışta da okur ve DB'de eksik satırları yazar
  // (boot-time uzlaştırma, `src/jobs/permission-catalog.job.ts`); seed yalnız
  // taze kurulumun ilk yazımıdır. Yeni izin eklerken buraya DEĞİL, katalog
  // dosyasına yaz.
  //
  // ⚠️ Bu ADIM bilinçli olarak İDEMPOTENT — seed'in geri kalanının aksine.
  // Neden: artık izin satırlarının İKİ yazarı var (seed + boot-time uzlaştırma).
  // Taze kurulumda backend seed'den ÖNCE bir kez ayağa kalkarsa (dev'de
  // `npm run dev`, sahada servis otomatik başlarsa) katalog DB'ye zaten gelmiş
  // olur; `create` bunu P2002 sayıp seed'i daha ilk adımda düşürürdü ve DB
  // yarım kalırdı. `skipDuplicates` iki yazarı da aynı tek kaynağa yazdığı için
  // güvenli — çakışan satırın içeriği zaten aynı katalogdan gelmiştir.
  const { count: yeniIzinSayisi } = await prisma.permission.createMany({
    data: PERMISSION_CATALOG.map((p) => ({
      code: p.code,
      module: p.module,
      category: p.category,
      description: p.description,
    })),
    skipDuplicates: true,
  });
  const permissions = await prisma.permission.findMany({ select: { id: true, code: true } });
  const permByCode = new Map(permissions.map((p) => [p.code, p]));
  console.log(
    `✅ ${permissions.length} permission (${yeniIzinSayisi} yeni yazıldı, ` +
      `${permissions.length - yeniIzinSayisi} zaten vardı)`
  );

  // ===========================================================================
  // 2. PERMISSION TEMPLATES (Admin + mobil roller)
  // ===========================================================================
  const templates: { name: string; description: string; codes: string[] }[] = [
    {
      name: "Admin (Tam Yetki)",
      description: "Tüm web + mobil + admin yetkileri",
      codes: PERMISSION_CATALOG.map((p) => p.code),
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
    {
      // Kurşun bypass düzeni (production.kursunBypassEnabled): fabrika kurşun
      // makinelerine tablet KOYMUYOR — yetkili personel, kurşun adımında bekleyen
      // iş emrini fiziksel kurşun MAKİNESİNE atar (tek PROCESS_QC istasyonunun
      // altındaki `Machine` satırlarından birine — istasyona DEĞİL). Ekran görünürlüğü
      // `mobile:kursun-dagitim` ile; route'lar `requireAnyPermission("workorder:distribute",
      // "mobile:kursun-dagitim")` kullanır. Web ikizi `workorder:distribute` BİLİNÇLİ olarak
      // buraya konmadı (mobil şablon, saha kullanıcısına masaüstü yetkisi taşımasın);
      // planlama/süpervizör kullanıcısına admin panelinden tek tek verilir.
      name: "Mobil — Kurşun Dağıtım",
      description: "Kurşun dağıtım ekranı (iş emrini fiziksel kurşun makinesine ata + son adımsa işi bitir)",
      codes: [
        "mobile:kursun-dagitim",
        "workorder:read",
        "roll:read",
        "station:read",
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
    data: PERMISSION_CATALOG.map((p) => ({
      userId: adminUser.id,
      permissionId: permByCode.get(p.code)!.id,
      grantedById: adminUser.id,
    })),
  });
  console.log(`✅ Admin'e ${PERMISSION_CATALOG.length} yetki atandı`);

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
  // 6. ÇEKİRDEK ÜRETİM VERİSİ (temiz fabrika kurulumu)
  // ===========================================================================
  // Müşteri / renk / ürün / sipariş YOK — fabrika bunları kendi ekler. Yalnız
  // üretimin dönmesi için gereken çekirdek: özellik → fason kategori/firma →
  // istasyon → makine → sistem ayarı → donanım → istasyon yeteneği → hata tipi
  // → rota → etiket şablonu.

  // --- Kumaş özellikleri: yalnız istasyon-işlevine bağlı ikisi ---
  // KURSUN → Kurşun+KK2 istasyonu uygular; ZIMPARALI → Zımpara fason istasyonu
  // uygular. Demo özellikleri (antibakteriyel vb.) kaldırıldı — admin sonradan ekler.
  const propertyData = [
    { code: "KURSUN",    name: "Kurşunlu",  category: "İşlem", color: "#64748b", sortOrder: 10 },
    { code: "ZIMPARALI", name: "Zımparalı", category: "Yüzey", color: "#a3a3a3", sortOrder: 20 },
  ];
  const properties = await Promise.all(propertyData.map((p) => prisma.fabricProperty.create({ data: p })));
  const propByCode = new Map(properties.map((p) => [p.code, p]));
  console.log(`✅ ${properties.length} kumaş özelliği (KURSUN + ZIMPARALI)`);

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

  // --- Sistem ayarları (kurulum varsayılanları — mevcut fabrika ayarları birebir) ---
  // Fabrikanın çalışan ayarları seed'e sabitlenir; runtime'da Genel Ayarlar / Feature
  // Flag ekranlarından değiştirilebilir. Yalnız runtime imleçleri (audit.lastArchiveAt
  // vb.) BİLİNÇLİ olarak seed'lenmez. Kodda tanımlı ama burada olmayan ayarlar
  // kendi kod-varsayılanına düşer. Refakat kartı düzeni (traveler.cardConfig) sahadaki
  // güncel haliyle korunur. Argox kumaş etiketi medyası: 100×58 mm YATAY, 203dpi.
  const SYSTEM_SETTINGS: { key: string; value: Prisma.InputJsonValue }[] = [
    { key: "label.defaultMedia", value: { widthMm: 100, heightMm: 58, dpi: 203, gapMm: 2, marginMm: 3 } },
    { key: "label.copies", value: 1 },
    { key: "label.nativeSendEnabled", value: false },
    { key: "label.mobileRasterEnabled", value: false },
    { key: "workorder.partyCodeAuto", value: true },
    { key: "finance.pricingEnabled", value: false },
    { key: "kk1.weightEntryEnabled", value: false },
    { key: "return.gradingEnabled", value: false },
    { key: "device.pairingRequired", value: false },
    { key: "shipping.confirmationEnabled", value: false },
    // Kurşun bypass — varsayılan KAPALI. Panelden açılır (Genel Ayarlar → Üretim).
    // Yalnız YENİ dağıtım oluşturmayı kapılar; dağıtılmış işler bayrak kapansa da biter.
    { key: "production.kursunBypassEnabled", value: false },
    { key: "auth.sessionDurationMinutes", value: 480 },
    { key: "auth.idleTimeoutMinutes", value: 0 },
    { key: "workSession.idleTimeoutMinutes", value: 0 },
    { key: "auth.absoluteSessionCapDays", value: 30 },
    { key: "auth.autoLogoutOnExpiry", value: false },
    { key: "auth.sameTypeSessionPolicy", value: "off" },
    { key: "auth.loginMethods", value: { enabled: ["list", "pin"], primary: "pin" } },
    { key: "auth.mobileIdleLockEnabled", value: false },
    { key: "auth.mobileIdleLockMinutes", value: 10 },
    { key: "auth.mobileLockOnBackground", value: false },
    { key: "auth.pinLockoutEscalateAfter", value: 3 },
    { key: "auth.pinLockoutLongPenaltyMin", value: 15 },
    {
      key: "traveler.cardConfig",
      value: {
        companyName: "Adnan Şahin Tekstil",
        addressLine: "",
        phone: "",
        pageSize: "A4",
        margins: { top: 8, right: 8, bottom: 8, left: 8 },
        fontScale: 1.15,
        fontWeight: "normal",
        showOperationGrid: true,
        showNotes: true,
        showOrders: true,
        showProperties: true,
        specFields: {
          color: { show: true, size: "lg", weight: "normal" },
          width: { show: true, size: "lg", weight: "normal" },
          targetQuantity: { show: false, size: "md", weight: "normal" },
          targetWeight: { show: false, size: "md", weight: "normal" },
          foldType: { show: true, size: "lg", weight: "normal" },
          startDate: { show: false, size: "md", weight: "normal" },
          endDate: { show: false, size: "md", weight: "normal" },
        },
        specColumns: 3,
        orderFields: {
          orderNumber: { show: true, size: "md", weight: "normal" },
          customer: { show: true, size: "md", weight: "normal" },
          item: { show: true, size: "md", weight: "normal" },
          color: { show: true, size: "md", weight: "normal" },
          quantity: { show: true, size: "md", weight: "normal" },
        },
        orderTotal: { show: true, size: "md", weight: "bold" },
        footerNote: "",
      },
    },
  ];
  for (const s of SYSTEM_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value },
      update: { value: s.value },
    });
  }
  console.log(`✅ ${SYSTEM_SETTINGS.length} sistem ayarı (mevcut fabrika ayarları birebir)`);

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
  // Cihaz Kaydı'ndan girilir).
  //
  // ⚠️ `simulate: false` — METRE cihazlarının AKSİNE (onlar simüle doğar). Ayrım
  // bilinçli: metre değeri İÇ üretim verisidir ve yeniden ölçülebilir; KANTAR kg'si
  // sevk irsaliyesine ve çeki listesine BASILIR (müşteri/gümrük belgesi). Simüle
  // kantar 10–100 kg arası RASTGELE değer üretiyor ve tek-dokunuş tartı onu doğrudan
  // kaydediyor → ilk kurulumda seed simüle bir kantar bırakırsa uydurma kg belgeye
  // gider. Backend ayrıca ENFORCE eder (`shipping.simulatedWeightEnabled`, default
  // kapalı → simüle okuma `weighSack`'te 400); bu satır ilk kurulumu da temiz başlatır.
  // Demo/eğitim kurulumunda Cihaz Kaydı'ndan açılıp flag ile birlikte kullanılır.
  await prisma.peripheralDevice.create({
    data: {
      code: "SEVK-KANTAR", name: "Sevkiyat Kantarı",
      kind: "SCALE", connectionType: "BLUETOOTH_SPP",
      address: "00:23:09:01:2A:3C", role: "PRIMARY",
      pollCommand: "P", terminator: "\r\n", decimals: 2, unit: "kg", timeoutMs: 2500, simulate: false,
      stationId: sevk.id,
    },
  });
  console.log("✅ Sevkiyat kantarı (SCALE, BT-SPP, istasyona bağlı — SEVK_1)");

  // --- İstasyon yetenekleri ---
  // Renk ve demo özellik seed'lenmediği için boyahane yeteneği BOŞ başlar (admin
  // renk/özellik ekleyip atar). Kurşun ve Zımpara kendi işlevsel özelliğini uygular.
  await prisma.stationProperty.create({
    data: { stationId: kursun.id, propertyId: propByCode.get("KURSUN")!.id },
  });
  await prisma.stationProperty.create({
    data: { stationId: zimparaFason.id, propertyId: propByCode.get("ZIMPARALI")!.id },
  });
  // Tambur'un yeteneği yok (karar noktası).
  console.log("✅ İstasyon yetenekleri (Kurşun=KURSUN, Zımpara=ZIMPARALI; boyahane boş)");

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
  console.log("✅ 2 rota şablonu (Standart Boyama, Boya + Zımpara)");

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
  // ÇUVAL etiketi — KANVAS varyantı + Bağlam Varsayılanı ile birlikte doğar.
  // Neden diğerlerinden farklı: çuval baskısı FAIL-CLOSED (şablon çözülemezse 400).
  // Sebebi label-html-landscape.helper: bilinmeyen kind'ı ROLL_FINISHED'a düşürür →
  // şablonsuz çuval baskısı sessizce tire dolu bir TOP etiketi basardı. Bu satırlar
  // yalnız DEV paritesi içindir (production'da seed koşmaz; orada operatör Etiket
  // Stüdyosu'nda kendi çuval şablonunu kurar).
  const sackTpl = await prisma.labelTemplate.create({
    data: {
      name: "Standart Çuval Etiketi", kind: "SACK",
      // ESKİ AKIŞ (flow) blob'u — asıl tasarım aşağıdaki KANVAS varyantı; varyant
      // varken bu blob HİÇ OKUNMAZ (label-renderer.registry.ts:105). Yine de tutarlı
      // bırakılıyor: 10 alanın hepsi açık kalırsa varsayılan medyaya (100×58) sığmıyor
      // ve PPLB emitter'ı son satırları KIRPIYOR (test_label_canvas_equivalence yakalar).
      // sackNote burada da kapalı — iç not fiziksel etikete varsayılan basılmaz.
      fields: buildDefaultFields("SACK").map((f) =>
        ["branchName", "sackNote", "printedAt"].includes(f.key) ? { ...f, isVisible: false } : f,
      ) as unknown as object,
      variants: {
        create: {
          name: "100x70", widthMm: 100, heightMm: 70, isPrimary: true,
          // ⚠️ Her elemanda `id` ZORUNLU (`label-elements.validateCanvasLayout`).
          // Render yolu (`readCanvasLayout`) id'siz kanvası tolere eder, AMA stüdyo
          // id ile çalışır: id'siz eleman SEÇİLEMEZ/düzenlenemez ve Kaydet
          // "Eleman id zorunlu" ile reddedilir. Seed şablonu düzenlenebilir kalmalı.
          elements: {
            v: 1,
            elements: [
              { id: "code128-seed1", type: "code128", x: 5, y: 5, wMm: 62, hMm: 16 },
              { id: "qr-seed2", type: "qr", x: 72, y: 5, wMm: 22, hMm: 22 },
              { id: "field-seed3", type: "field", x: 5, y: 26, bind: "sackNo", label: "Çuval No", bold: true },
              { id: "field-seed4", type: "field", x: 5, y: 34, bind: "customerName", label: "Müşteri" },
              { id: "field-seed5", type: "field", x: 5, y: 42, bind: "rollCount", label: "Top Adedi" },
              { id: "field-seed6", type: "field", x: 40, y: 42, bind: "lengthMeters", label: "Metraj" },
              { id: "field-seed7", type: "field", x: 5, y: 50, bind: "weightKg", label: "Brüt" },
              // ⚠️ `sackNote` KASTEN YOK. İç not ("kendimiz için") müşteriye giden
              // FİZİKSEL etikete varsayılan olarak BASILMAMALI — schema.prisma
              // Sack.notes ve label-fields.ts SACK_FIELDS'teki "varsayılan KAPALI"
              // taahhüdü bu. İsteyen kurulum stüdyodan elle ekler.
              // Flow blob'undaki isVisible:false bu varyantta ETKİSİZDİR: renderer
              // kanvası ÖNCE okur (label-renderer.registry.ts:105) ve flow alanlarına
              // hiç bakmaz → tek gerçek koruma elemanın YOKLUĞU.
            ],
          },
        },
      },
    },
    select: { id: true },
  });
  await prisma.labelContextDefault.create({ data: { kind: "SACK", templateId: sackTpl.id } });
  console.log("✅ 4 label template (ROLL_RAW + ROLL_FINISHED + SWATCH + SACK kanvas/bağlam-varsayılanı)");

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
