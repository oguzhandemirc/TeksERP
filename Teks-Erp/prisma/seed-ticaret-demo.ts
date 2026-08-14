// =============================================================================
// TİCARET DEMO SEED — alım-satım kurulumunun "boş ekran" panzehiri
// =============================================================================
// Çalıştırma:  npm run seed:ticaret-demo      (= npx tsx prisma/seed-ticaret-demo.ts)
//
// NEDEN AYRI BİR DOSYA: `prisma/seed.ts` TEMİZ FABRİKA kurulumudur (admin + izin
// ve rol katalogları + istasyonlar) ve bilinçli olarak müşteri/kumaş/sipariş
// İÇERMEZ. Demoya giren kişi ise ilk saniyede veri görmek zorundadır: boş bir
// sevkiyat listesi "özellik yok" diye okunur. Bu script o boşluğu doldurur ve
// fabrika seed'ine hiç dokunmaz.
//
// ⚠️ GÜVENLİK KAPISI — CANLI FABRİKA DB'sinde ASLA KOŞMAZ.
// Kök CLAUDE.md: "migrate reset / reseed / toplu DELETE YASAK". İki katman:
//   1) Veritabanı ADI 'demo' ya da 'ticaret' içermiyorsa script BAŞLAMADAN çıkar.
//      Bayrakla geçilemez ve geçilebilir OLMAMALI: "--force" gibi bir kaçış,
//      yorgun bir gecede canlı DB'ye yazmanın tek adımlık yolunu açardı.
//   2) Script HİÇBİR ŞEY SİLMEZ. Kendi verisini DEMO- önekli kodlarla üretir ve
//      idempotenttir (ikinci koşum yeni kayıt doğurmaz). Yani kapı 1 bir şekilde
//      aşılsa bile yıkım yüzeyi yoktur — yalnız fazladan demo kaydı olurdu.
//
// ⚠️ SERVİS KATMANINDAN GEÇİLİR, ham `prisma.create` ile belge UYDURULMAZ.
// Sevkiyat/fatura/tahsilat/masraf servis çağrılarıyla üretilir; çünkü defter
// satırı (`CariTransaction`), bakiye (`CariBalance`, `CashBox.balance`), donmuş
// belge (`PrintedDocument`) ve tahsis zinciri O YOLLARDA doğar. Ham insert
// "ekranda görünen ama defteri boş" bir demo yaratır — yani tam olarak
// gösterilmek istenen şeyin çalışmadığını gösterirdi.
// İSTİSNA: master data (depo/renk/kumaş/cari kart/kasa/banka/kur). Onlar
// `BaseService.autoCode` ile backend-authoritative kod üretir (DP+GGAAYY+NNNN)
// ve bizim DEMO- önekimizi yok sayardı — idempotentliğin çıpası tam da o kod
// olduğu için burada doğrudan `upsert` kullanılır.
//
// İDEMPOTENTLİK ÇIPALARI:
//   • master data      → `upsert` (unique `code`; `update: {}` = mevcut kaydı EZME)
//   • belge/hareket    → `clientToken` (deterministik UUID v5, aşağıdaki demoToken)
//   • tekil kayıtlar   → önden var-mı sorgusu (cari devri, kasa açılışı, onaylar)
// Servislerin kendi idempotency yolları (token replay) böylece devreye girer;
// ikinci koşum "zaten oluşturulmuş" der ve sayılar artmaz.
// =============================================================================
import { randomBytes } from "node:crypto";
import { v5 as uuidv5 } from "uuid";
import * as bcrypt from "bcryptjs";
import {
  CariTxnSource,
  CashTxnKind,
  CompanyType,
  Currency,
  InvoiceStatus,
  InvoiceType,
  ItemType,
  ItemUnit,
  PaymentDirection,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RollStatus,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { shippingService } from "../src/services/shipping.service";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { cariService } from "../src/services/cari.service";
import { systemSettingService } from "../src/services/system-setting.service";
import { PermissionManagementService } from "../src/services/permission-management.service";

// -----------------------------------------------------------------------------
// 0) GÜVENLİK KAPISI
// -----------------------------------------------------------------------------

/**
 * Bağlanılan veritabanının adını çözer.
 *
 * `new URL` postgres bağlantı dizesini ayrıştırabilir (protokol `postgresql:`);
 * elle string kesmek `?schema=public` ve kullanıcı adındaki `@` gibi hallerde
 * sessizce yanlış ad üretirdi — ve o ad tam da güvenlik kapısının dayandığı şey.
 */
function currentDatabaseName(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımsız — .env dosyasını kontrol edin.");
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/**
 * DEMO/TİCARET DIŞI HER VERİTABANINDA ÇIKAR.
 *
 * Beyaz liste (izin veren desen) tercih edildi, kara liste değil: "adı tekserp
 * DEĞİLSE koş" kuralı, yarın açılacak `tekserp_yedek` benzeri her yeni canlı
 * kopyayı sessizce hedef yapardı. Bilinmeyen ad = REDDET.
 */
function assertDemoDatabase(dbName: string): void {
  if (/demo|ticaret/i.test(dbName)) return;
  console.error(
    "\n⛔ REDDEDİLDİ — bu bir demo veritabanı değil.\n" +
      `   Bağlanılan veritabanı: ${dbName}\n` +
      "   Bu script yalnız adında 'demo' ya da 'ticaret' geçen veritabanlarında koşar.\n" +
      "   Zorlama bayrağı BİLEREK YOKTUR: canlı fabrika verisine demo kaydı yazmanın\n" +
      "   tek adımlık bir yolu olmamalı. Doğru yol, izole bir demo DB'si açıp\n" +
      "   DATABASE_URL'i ona çevirmektir.\n",
  );
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Deterministik idempotency anahtarları
// -----------------------------------------------------------------------------

/**
 * Demo kayıtlarının `clientToken` uzayı.
 *
 * Sabit bir namespace + sabit bir ad → HER KOŞUMDA AYNI UUID. Servislerin token
 * replay yolları (fiş/sevkiyat/fatura/tahsilat/kasa) böylece ikinci koşumda
 * mevcut kaydı döner. `randomUUID()` kullanılsaydı her koşum yeni belge doğurur
 * ve demo DB'si her tazelemede şişerdi.
 */
const DEMO_TOKEN_NAMESPACE = "6f9e1b2c-6a1f-4c0f-9c4e-9b3d5a7e1c20";
function demoToken(name: string): string {
  return uuidv5(`tekserp-ticaret-demo:${name}`, DEMO_TOKEN_NAMESPACE);
}

// -----------------------------------------------------------------------------
// Sayaç — ekrana "kaç kayıt üretildi" raporu basmak için
// -----------------------------------------------------------------------------
const tally = { created: 0, existing: 0 };
function note(created: boolean, label: string): void {
  if (created) {
    tally.created++;
    console.log(`   + ${label}`);
  } else {
    tally.existing++;
    console.log(`   = ${label} (zaten vardı)`);
  }
}

// -----------------------------------------------------------------------------
// VERİ TANIMLARI — perde / döşemelik kumaş ticareti yapan bir firma
// -----------------------------------------------------------------------------

const COLORS: Array<{ code: string; name: string; hex: string }> = [
  { code: "DEMO-EKRU", name: "Ekru", hex: "#EFE7D8" },
  { code: "DEMO-KREM", name: "Krem", hex: "#F3E9CE" },
  { code: "DEMO-ANTRASIT", name: "Antrasit", hex: "#3A3F44" },
  { code: "DEMO-BORDO", name: "Bordo", hex: "#6E1421" },
  { code: "DEMO-PETROL", name: "Petrol Mavisi", hex: "#14555A" },
  { code: "DEMO-VIZON", name: "Vizon", hex: "#A2907B" },
  { code: "DEMO-HAKI", name: "Haki", hex: "#5C6144" },
  { code: "DEMO-GRI", name: "Gri", hex: "#8C9196" },
];

const ITEMS: Array<{ code: string; name: string; salesPrice: number }> = [
  { code: "DEMO-KMS-BLACKOUT", name: "Blackout Perdelik 300 cm", salesPrice: 215 },
  { code: "DEMO-KMS-TUL", name: "Tül Perdelik Keten Görünümlü 300 cm", salesPrice: 139 },
  { code: "DEMO-KMS-JAKAR", name: "Jakarlı Perdelik 280 cm", salesPrice: 298 },
  { code: "DEMO-KMS-KADIFE", name: "Döşemelik Kadife 140 cm", salesPrice: 780 },
  { code: "DEMO-KMS-SONIL", name: "Döşemelik Şönil 140 cm", salesPrice: 620 },
  { code: "DEMO-KMS-SUITICI", name: "Su İtici Döşemelik 150 cm", salesPrice: 265 },
];

const PARTIES: Array<{
  code: string;
  name: string;
  type: CompanyType;
  taxNumber: string;
  city: string;
  contactName: string;
  contactPhone: string;
  email: string;
}> = [
  // Müşteriler
  { code: "DEMO-MST-001", name: "Perde Dünyası Mağazacılık A.Ş.", type: CompanyType.CUSTOMER, taxNumber: "4820013755", city: "İstanbul", contactName: "Selin Aksoy", contactPhone: "0212 555 10 21", email: "satinalma@perdedunyasi.example" },
  { code: "DEMO-MST-002", name: "Ev Tekstili Mağazacılık Ltd. Şti.", type: CompanyType.CUSTOMER, taxNumber: "3910077412", city: "Ankara", contactName: "Burak Demir", contactPhone: "0312 555 44 07", email: "burak@evtekstili.example" },
  { code: "DEMO-MST-003", name: "Villa Dekorasyon ve Mimarlık", type: CompanyType.CUSTOMER, taxNumber: "7720045188", city: "İzmir", contactName: "Ayşe Korkmaz", contactPhone: "0232 555 63 90", email: "ayse@villadekor.example" },
  { code: "DEMO-MST-004", name: "Otel Tedarik Grubu A.Ş.", type: CompanyType.CUSTOMER, taxNumber: "5610092233", city: "Antalya", contactName: "Murat Şen", contactPhone: "0242 555 18 45", email: "tedarik@otelgrup.example" },
  { code: "DEMO-MST-005", name: "Anadolu Mobilya Sanayi", type: CompanyType.CUSTOMER, taxNumber: "6330011904", city: "Kayseri", contactName: "Hakan Ünal", contactPhone: "0352 555 72 16", email: "hakan@anadolumobilya.example" },
  // Tedarikçiler
  { code: "DEMO-TED-001", name: "Anadolu Tekstil Dokuma San. A.Ş.", type: CompanyType.SUPPLIER, taxNumber: "2140066871", city: "Denizli", contactName: "Emre Balcı", contactPhone: "0258 555 30 12", email: "satis@anadolutekstil.example" },
  { code: "DEMO-TED-002", name: "Ege Kumaş İthalat İhracat Ltd.", type: CompanyType.SUPPLIER, taxNumber: "8850023467", city: "İzmir", contactName: "Deniz Yalçın", contactPhone: "0232 555 91 08", email: "deniz@egekumas.example" },
  { code: "DEMO-TED-003", name: "Bursa Kumaşçılık ve Tic. Ltd.", type: CompanyType.SUPPLIER, taxNumber: "1470058802", city: "Bursa", contactName: "Serkan Tunç", contactPhone: "0224 555 26 74", email: "serkan@bursakumas.example" },
  // Hem alıcı hem satıcı — tek kart, tek cari, mahsup edilebilir bakiye
  { code: "DEMO-CARI-001", name: "Marmara Tekstil Pazarlama A.Ş.", type: CompanyType.BOTH, taxNumber: "9060034125", city: "İstanbul", contactName: "Elif Karaca", contactPhone: "0216 555 77 39", email: "elif@marmaratekstil.example" },
];

/** Mal kabul satırı — `GoodsReceiptLineInput`e çevrilecek demo tanımı. */
interface DemoLine {
  itemCode: string;
  colorCode: string;
  qty: number;
  width: number;
  unitPrice: number;
}

interface DemoReceipt {
  key: string;
  supplierCode: string;
  warehouse: "MERKEZ" | "SUBE";
  currency: Currency;
  deliveryNoteNo: string;
  notes: string;
  lines: DemoLine[];
}

const RECEIPTS: DemoReceipt[] = [
  {
    key: "mk-1",
    supplierCode: "DEMO-TED-001",
    warehouse: "MERKEZ",
    currency: Currency.TRY,
    deliveryNoteNo: "ANT-2026-0417",
    notes: "Perdelik sezon alımı — 6 top.",
    lines: [
      { itemCode: "DEMO-KMS-BLACKOUT", colorCode: "DEMO-ANTRASIT", qty: 120, width: 300, unitPrice: 148.5 },
      { itemCode: "DEMO-KMS-BLACKOUT", colorCode: "DEMO-EKRU", qty: 95.5, width: 300, unitPrice: 148.5 },
      { itemCode: "DEMO-KMS-JAKAR", colorCode: "DEMO-BORDO", qty: 80, width: 280, unitPrice: 210 },
      { itemCode: "DEMO-KMS-JAKAR", colorCode: "DEMO-KREM", qty: 76.25, width: 280, unitPrice: 210 },
      { itemCode: "DEMO-KMS-TUL", colorCode: "DEMO-EKRU", qty: 140, width: 300, unitPrice: 96 },
      { itemCode: "DEMO-KMS-TUL", colorCode: "DEMO-KREM", qty: 132, width: 300, unitPrice: 96 },
    ],
  },
  {
    // ⚠️ DÖVİZLİ FİŞ — demo bilerek tek para biriminde kalmıyor: alış faturası
    // bu fişten üretilecek ve kur çevrimi (grandTotalTry) ekranda görünecek.
    key: "mk-2",
    supplierCode: "DEMO-TED-002",
    warehouse: "MERKEZ",
    currency: Currency.USD,
    deliveryNoteNo: "EGE-88231",
    notes: "İthal döşemelik — USD fiyatlı.",
    lines: [
      { itemCode: "DEMO-KMS-KADIFE", colorCode: "DEMO-PETROL", qty: 60, width: 140, unitPrice: 12.4 },
      { itemCode: "DEMO-KMS-KADIFE", colorCode: "DEMO-VIZON", qty: 55, width: 140, unitPrice: 12.4 },
      { itemCode: "DEMO-KMS-SONIL", colorCode: "DEMO-HAKI", qty: 48, width: 140, unitPrice: 9.8 },
      { itemCode: "DEMO-KMS-SONIL", colorCode: "DEMO-GRI", qty: 52, width: 140, unitPrice: 9.8 },
    ],
  },
  {
    // İkinci depo boş kalmasın: "hangi depoda ne var" sorusunun demoda bir
    // cevabı olmalı, yoksa çok depoluluk ekranda kanıtlanamaz.
    key: "mk-3",
    supplierCode: "DEMO-TED-003",
    warehouse: "SUBE",
    currency: Currency.TRY,
    deliveryNoteNo: "BRS-5512",
    notes: "Şube deposu takviye alımı.",
    lines: [
      { itemCode: "DEMO-KMS-SUITICI", colorCode: "DEMO-GRI", qty: 90, width: 150, unitPrice: 175 },
      { itemCode: "DEMO-KMS-SUITICI", colorCode: "DEMO-ANTRASIT", qty: 85, width: 150, unitPrice: 175 },
      { itemCode: "DEMO-KMS-JAKAR", colorCode: "DEMO-VIZON", qty: 70, width: 280, unitPrice: 210 },
      { itemCode: "DEMO-KMS-BLACKOUT", colorCode: "DEMO-KREM", qty: 110, width: 300, unitPrice: 148.5 },
      { itemCode: "DEMO-KMS-TUL", colorCode: "DEMO-EKRU", qty: 125, width: 300, unitPrice: 96 },
    ],
  },
];

// -----------------------------------------------------------------------------
// 1) DEMO KULLANICISI
// -----------------------------------------------------------------------------

/**
 * `demo` kullanıcısını hazırlar ve WEB_TRADE rolünü uygular.
 *
 * ⚠️ ŞİFRE KODA GÖMÜLMEZ. Depoya yazılan bir demo şifresi, demo sunucusu
 * internete açıldığı gün herkesin bildiği bir şifredir. Sıra: `DEMO_USER_PASSWORD`
 * ortam değişkeni → yoksa güvenli rastgele üret ve EKRANA BAS (operatör not alır).
 *
 * ⚠️ İKİNCİ KOŞUMDA ŞİFRE SIFIRLANMAZ (env verilmedikçe): rastgele yeni bir
 * şifre üretmek, çalışan bir demo girişini sessizce kilitlerdi.
 */
async function ensureDemoUser(): Promise<{ id: string; announcedPassword: string | null }> {
  const existing = await prisma.user.findUnique({
    where: { username: "demo" },
    select: { id: true, deletedAt: true },
  });

  const envPassword = process.env.DEMO_USER_PASSWORD?.trim() || null;
  let announced: string | null = null;
  let userId: string;

  if (existing && existing.deletedAt === null) {
    userId = existing.id;
    if (envPassword) {
      // Ortam değişkeni AÇIK bir niyettir ("şifre bu olsun") — uygulanır.
      // tokenVersion artırılır: eski oturum şifre değişince ölmeli.
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(envPassword, 10), tokenVersion: { increment: 1 } },
      });
      announced = envPassword;
    }
    note(false, "kullanıcı: demo");
  } else {
    const password = envPassword ?? randomBytes(9).toString("base64url");
    userId = (
      await prisma.user.create({
        data: {
          username: "demo",
          passwordHash: await bcrypt.hash(password, 10),
          fullName: "Demo Kullanıcı",
        },
        select: { id: true },
      })
    ).id;
    announced = password;
    note(true, "kullanıcı: demo");
  }

  // Rol: WEB_TRADE (ticaret paketi). Şablon boot uzlaştırmasıyla DB'ye gelir;
  // yoksa uzlaştırma hiç koşmamış demektir ve bunu sessizce geçmek, demo
  // kullanıcısını "giriş yapıyor ama hiçbir ekranı açamıyor" halde bırakırdı.
  const template = await prisma.permissionTemplate.findUnique({
    where: { code: "WEB_TRADE" },
    select: { id: true, isActive: true },
  });
  if (!template) {
    console.warn(
      "   ⚠️ WEB_TRADE yetki şablonu bulunamadı — backend en az bir kez açılıp\n" +
        "      rol kataloğu uzlaştırmasını koşturmalı. Demo kullanıcısı YETKİSİZ kaldı.",
    );
  } else if (!template.isActive) {
    console.warn("   ⚠️ WEB_TRADE şablonu pasif — yetki uygulanmadı.");
  } else {
    // Aktör: mümkünse admin (denetim izi "sistem yöneticisi verdi" desin),
    // yoksa kullanıcının kendisi.
    const admin = await prisma.user.findUnique({ where: { username: "admin" }, select: { id: true } });
    await PermissionManagementService.applyTemplate(userId, template.id, "merge", admin?.id ?? userId);
  }

  return { id: userId, announcedPassword: announced };
}

// -----------------------------------------------------------------------------
// 2) KUR
// -----------------------------------------------------------------------------

/**
 * Bugünün USD/EUR kurunu yazar.
 *
 * ⚠️ `update: {}` — mevcut satır EZİLMEZ. Aynı gün için TCMB işi ya da muhasebeci
 * gerçek kuru girmiş olabilir; demo verisi onun üstüne yazarsa fatura tutarları
 * sessizce değişirdi. `rateDate` @db.Date anahtarı UTC gece yarısına yazılır
 * (`factoryDayKeyUtcMidnight` — yerel gece yarısı günü bir geri etiketlerdi).
 */
async function ensureExchangeRates(): Promise<void> {
  const day = factoryDayKeyUtcMidnight();
  const rates: Array<[Currency, string]> = [
    [Currency.USD, "47.6858"],
    [Currency.EUR, "55.1240"],
  ];
  for (const [currency, rate] of rates) {
    const before = await prisma.exchangeRate.findUnique({
      where: { rateDate_currency: { rateDate: day, currency } },
      select: { id: true },
    });
    await prisma.exchangeRate.upsert({
      where: { rateDate_currency: { rateDate: day, currency } },
      update: {},
      create: { rateDate: day, currency, rate: new Prisma.Decimal(rate) },
    });
    note(!before, `kur: ${currency} = ${rate}`);
  }
}

// -----------------------------------------------------------------------------
// 3) MASTER DATA
// -----------------------------------------------------------------------------

/**
 * İki depo: sistemin VARSAYILAN deposu ("Merkez Depo") + demo şube deposu.
 *
 * ⚠️ Merkez depo YENİDEN YARATILMAZ, mevcut varsayılan kullanılır. Sebep:
 * `openSack` çuvalı `resolveTargetWarehouseId(tx, null)` ile VARSAYILAN depoya
 * damgalar. Kendi "DEMO-DEPO-MERKEZ"imizi açsaydık toplar bizim depomuzda,
 * çuval varsayılan depoda doğar ve demo daha ilk sevkiyatta kendi kendisiyle
 * çelişirdi. `ensureDefaultWarehouse` boot uzlaştırmasının aynısıdır: varsa
 * kullanır, hiç depo yoksa DP-MERKEZ'i doğurur.
 */
async function ensureWarehouses(): Promise<{ merkez: string; sube: string }> {
  const def = await ensureDefaultWarehouse();
  note(def.action === "created", `depo: ${def.name} (varsayılan)`);

  const existing = await prisma.warehouse.findUnique({ where: { code: "DEMO-DEPO-SUBE" }, select: { id: true } });
  const sube = await prisma.warehouse.upsert({
    where: { code: "DEMO-DEPO-SUBE" },
    update: {},
    create: {
      code: "DEMO-DEPO-SUBE",
      name: "Şube Depo",
      address: "Ege Serbest Bölge, 3. Kısım, İzmir",
      notes: "Demo verisi — şube stoklarının tutulduğu ikinci depo.",
    },
    select: { id: true },
  });
  note(!existing, "depo: Şube Depo");

  return { merkez: def.id, sube: sube.id };
}

/**
 * ⚠️ AD ÇAKIŞMASI — `code` ile upsert TEK BAŞINA YETMEZ.
 *
 * Master data'da mükerrer ad koruması UYGULAMA katmanındadır (DB'de unique YOK,
 * bilinçli karar — bkz. kök CLAUDE.md ad standardı). Seed doğrudan Prisma'ya
 * yazdığı için o guard'ı ATLAR: fabrika verisi taşıyan bir DB'de zaten "Ekru"
 * varsa, DEMO- kodlu ikinci bir "Ekru" doğar ve `test_consistency` §18 kırmızı
 * verir (ölçüldü — bu fonksiyon tam o yüzden yazıldı).
 *
 * Kural: ADI zaten kullanılan bir kart VARSA onu YENİDEN KULLAN, kopya üretme.
 * Karşılaştırma case/boşluk-duyarsız — bekçinin kullandığı ölçüyle aynı olmalı,
 * yoksa "seed temiz sanır, bekçi kırmızı verir" ayrışması doğar.
 */
async function findByLooseName(
  tablo: "color" | "item",
  ad: string,
): Promise<{ id: string } | null> {
  const hedef = ad.trim().toLowerCase();
  const rows =
    tablo === "color"
      ? await prisma.color.findMany({ where: { isActive: true }, select: { id: true, name: true } })
      : await prisma.item.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  return rows.find((r) => r.name.trim().toLowerCase() === hedef) ?? null;
}

async function ensureColors(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let created = 0;
  for (const [i, c] of COLORS.entries()) {
    const before = await prisma.color.findUnique({ where: { code: c.code }, select: { id: true } });
    if (before) {
      map.set(c.code, before.id);
      continue;
    }
    // Kendi kodumuzla yoksa: AYNI ADI taşıyan bir kart var mı? Varsa onu kullan.
    const adDaki = await findByLooseName("color", c.name);
    if (adDaki) {
      map.set(c.code, adDaki.id);
      continue;
    }
    const row = await prisma.color.create({
      data: { code: c.code, name: c.name, hex: c.hex, sortOrder: 100 + i },
      select: { id: true },
    });
    created++;
    map.set(c.code, row.id);
  }
  note(created > 0, `renk: ${COLORS.length} kart (${created} yeni)`);
  return map;
}

async function ensureItems(): Promise<Map<string, { id: string; name: string; unit: ItemUnit }>> {
  const map = new Map<string, { id: string; name: string; unit: ItemUnit }>();
  let created = 0;
  for (const it of ITEMS) {
    const before = await prisma.item.findUnique({ where: { code: it.code }, select: { id: true } });
    if (before) {
      map.set(it.code, { id: before.id, name: it.name, unit: ItemUnit.MT });
      continue;
    }
    const adDaki = await findByLooseName("item", it.name);
    if (adDaki) {
      map.set(it.code, { id: adDaki.id, name: it.name, unit: ItemUnit.MT });
      continue;
    }
    const row = await prisma.item.create({
      // ⚠️ `allowedColors` BİLEREK BOŞ: boş liste "tüm aktif renkler serbest"
      // demektir (`createInitialEntry` guard'ı). Demo kartlarına renk kilidi
      // koymak, siteyi gezen kişinin denediği ilk kombinasyonu reddederdi.
      data: { code: it.code, name: it.name, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
      select: { id: true, name: true, unit: true },
    });
    created++;
    map.set(it.code, row);
  }
  note(created > 0, `kumaş: ${ITEMS.length} kart (${created} yeni)`);
  return map;
}

async function ensureParties(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let created = 0;
  for (const p of PARTIES) {
    const before = await prisma.customer.findUnique({ where: { code: p.code }, select: { id: true } });
    const row = await prisma.customer.upsert({
      where: { code: p.code },
      update: {},
      create: {
        code: p.code,
        name: p.name,
        type: p.type,
        taxNumber: p.taxNumber,
        city: p.city,
        country: "Türkiye",
        contactName: p.contactName,
        contactPhone: p.contactPhone,
        email: p.email,
        notes: "Demo verisi.",
      },
      select: { id: true },
    });
    if (!before) created++;
    map.set(p.code, row.id);
  }
  note(created > 0, `cari kart: ${PARTIES.length} firma (${created} yeni)`);
  return map;
}

async function ensureCashAndBank(): Promise<{ kasaTry: string; bankaTry: string; bankaUsd: string }> {
  const kasaBefore = await prisma.cashBox.findUnique({ where: { code: "DEMO-KASA-TRY" }, select: { id: true } });
  const kasaTry = await prisma.cashBox.upsert({
    where: { code: "DEMO-KASA-TRY" },
    update: {},
    // ⚠️ `balance` YAZILMAZ. Kasa bakiyesi denormalize bir TOPLAMDIR ve tek
    // meşru yazarı hareket servisleridir; elle bir açılış sayısı yazmak defterle
    // bakiyeyi ilk günden ayrıştırır (test_consistency §23 kırmızı verir).
    // Para aşağıda OPENING fişiyle girer.
    create: { code: "DEMO-KASA-TRY", name: "Merkez Kasa (TL)", currency: Currency.TRY },
    select: { id: true },
  });
  note(!kasaBefore, "kasa: Merkez Kasa (TL)");

  const bankTryBefore = await prisma.bankAccount.findUnique({ where: { code: "DEMO-BANKA-TRY" }, select: { id: true } });
  const bankaTry = await prisma.bankAccount.upsert({
    where: { code: "DEMO-BANKA-TRY" },
    update: {},
    create: {
      code: "DEMO-BANKA-TRY",
      name: "Ziraat Bankası — TL",
      bankName: "T.C. Ziraat Bankası",
      iban: "TR330006100519786457841326",
      currency: Currency.TRY,
    },
    select: { id: true },
  });
  note(!bankTryBefore, "banka: Ziraat Bankası — TL");

  const bankUsdBefore = await prisma.bankAccount.findUnique({ where: { code: "DEMO-BANKA-USD" }, select: { id: true } });
  const bankaUsd = await prisma.bankAccount.upsert({
    where: { code: "DEMO-BANKA-USD" },
    update: {},
    create: {
      code: "DEMO-BANKA-USD",
      name: "Ziraat Bankası — USD",
      bankName: "T.C. Ziraat Bankası",
      iban: "TR720006100519786457841409",
      currency: Currency.USD,
    },
    select: { id: true },
  });
  note(!bankUsdBefore, "banka: Ziraat Bankası — USD");

  return { kasaTry: kasaTry.id, bankaTry: bankaTry.id, bankaUsd: bankaUsd.id };
}

/**
 * Kasa/banka AÇILIŞ bakiyeleri.
 *
 * ⚠️ Servis hesap başına TEK açılışa izin verir (partial unique + anlamlı 409).
 * Bu yüzden ikinci koşumda 409 yemek yerine önden sorulur — bir demo script'inin
 * beklenen bir çakışmayı istisna olarak fırlatması, gerçek hatayı gürültüye
 * gömer.
 */
async function ensureOpeningBalances(
  acc: { kasaTry: string; bankaTry: string; bankaUsd: string },
  userId: string,
): Promise<void> {
  const openings: Array<{ label: string; ref: { cashBoxId?: string; bankAccountId?: string }; amount: number }> = [
    { label: "Merkez Kasa (TL) açılışı 50.000", ref: { cashBoxId: acc.kasaTry }, amount: 50000 },
    { label: "Ziraat TL açılışı 275.000", ref: { bankAccountId: acc.bankaTry }, amount: 275000 },
    { label: "Ziraat USD açılışı 18.000", ref: { bankAccountId: acc.bankaUsd }, amount: 18000 },
  ];

  for (const o of openings) {
    const dup = await prisma.cashTransaction.findFirst({
      where: {
        kind: CashTxnKind.OPENING,
        status: { not: PaymentStatus.CANCELLED },
        ...(o.ref.cashBoxId ? { cashBoxId: o.ref.cashBoxId } : { bankAccountId: o.ref.bankAccountId }),
      },
      select: { id: true },
    });
    if (dup) {
      note(false, `kasa/banka açılışı: ${o.label}`);
      continue;
    }
    await cashTransactionService.create(
      {
        kind: CashTxnKind.OPENING,
        cashBoxId: o.ref.cashBoxId ?? null,
        bankAccountId: o.ref.bankAccountId ?? null,
        amount: o.amount,
        description: "Sisteme geçiş açılış bakiyesi (demo)",
        clientToken: demoToken(`opening:${o.label}`),
      },
      userId,
    );
    note(true, `kasa/banka açılışı: ${o.label}`);
  }
}

// -----------------------------------------------------------------------------
// 4) MAL KABUL
// -----------------------------------------------------------------------------

/**
 * Üç mal kabul fişi (biri USD) — topları depoya indirir.
 *
 * ⚠️ `weightKg` GÖNDERİLMEZ: `kk1.weightEntryEnabled` varsayılan KAPALI ve
 * `createInitialEntry` kapalıyken gelen ağırlığı REDDEDER (400). Ticaret
 * demosunda metraj yeterli; kg alanı için ayar açılması gerekir.
 */
async function ensureGoodsReceipts(
  wh: { merkez: string; sube: string },
  items: Map<string, { id: string; name: string; unit: ItemUnit }>,
  colors: Map<string, string>,
  parties: Map<string, string>,
  userId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  for (const r of RECEIPTS) {
    const token = demoToken(`goods-receipt:${r.key}`);
    const before = await prisma.goodsReceipt.findUnique({ where: { clientToken: token }, select: { id: true } });

    const res = await goodsReceiptService.create(
      {
        warehouseId: r.warehouse === "MERKEZ" ? wh.merkez : wh.sube,
        supplierId: parties.get(r.supplierCode) ?? null,
        deliveryNoteNo: r.deliveryNoteNo,
        currency: r.currency as "TRY" | "USD" | "EUR" | "GBP" | "RUB",
        notes: r.notes,
        clientToken: token,
        lines: r.lines.map((l, i) => ({
          itemId: items.get(l.itemCode)!.id,
          colorId: colors.get(l.colorCode)!,
          initialQty: l.qty,
          width: l.width,
          unitPrice: l.unitPrice,
          // Satır başına ayrı token: fiş yeniden açılmasa bile satır replay'i
          // (yarım kalmış koşum) mükerrer top doğurmasın.
          clientToken: demoToken(`goods-receipt-line:${r.key}:${i}`),
        })),
      },
      userId,
    );

    const detail = res.data as { id: string; receiptNo: string; failed?: Array<{ reason: string }> };
    if (detail.failed?.length) {
      // Parçalı sonuç servisin sözleşmesidir ("N girildi, M atlandı") — demo
      // script'i onu YUTMAZ, aksi halde eksik stoklu bir demo sessizce doğar.
      console.warn(`   ⚠️ ${detail.receiptNo}: ${detail.failed.length} satır atlandı — ${detail.failed[0]?.reason}`);
    }
    out.set(r.key, detail.id);
    note(!before, `mal kabul: ${detail.receiptNo} (${r.lines.length} top, ${r.currency})`);
  }

  return out;
}

// -----------------------------------------------------------------------------
// 5) SEVKİYAT
// -----------------------------------------------------------------------------

/**
 * İki sevkiyat — İKİ FARKLI YOLDAN, bilinçli olarak.
 *
 * 1) HIZLI SEVK (`createShipmentFromRolls`): çuval operatöre görünmeden doğar.
 * 2) ÇUVAL YOLU (`openSack` → `scanIntoSack` → `createShipment`): paketleme
 *    ekranının gerçek akışı.
 * İkisi de aynı çekirdeği (`createShipmentCoreTx`) çağırır ama demoda ikisini de
 * göstermek gerekiyor: ekranlar farklı ve "hangi butonu kullanacağım" sorusunun
 * cevabı veriyle görünmeli.
 *
 * `shipping.confirmationEnabled` KAPALI olduğunda sevkiyat aynı adımda
 * DISPATCHED olur; AÇIK olduğunda PLANNED kalır ve Sevk Kapısı'ndan onaylanır.
 * Script ayarı DEĞİŞTİRMEZ — kurulumun kendi rejimi neyse demo onu gösterir.
 */
async function ensureShipments(
  receipts: Map<string, string>,
  parties: Map<string, string>,
  userId: string,
): Promise<{ hizli: string | null; cuval: string | null }> {
  const result: { hizli: string | null; cuval: string | null } = { hizli: null, cuval: null };

  // ── 1) Hızlı Sevk ────────────────────────────────────────────────────────
  const quickToken = demoToken("shipment:quick");
  const quickExisting = await prisma.shipment.findUnique({ where: { clientToken: quickToken }, select: { id: true } });
  if (quickExisting) {
    result.hizli = quickExisting.id;
    note(false, "sevkiyat: Hızlı Sevk");
  } else {
    const rolls = await prisma.roll.findMany({
      where: { goodsReceiptId: receipts.get("mk-1"), status: RollStatus.WAREHOUSE, sackId: null, shipmentId: null },
      orderBy: { createdAt: "asc" },
      take: 3,
      select: { id: true },
    });
    if (rolls.length === 0) {
      console.warn("   ⚠️ Hızlı sevk için uygun top bulunamadı — atlandı.");
    } else {
      const res = await shippingService.createShipmentFromRolls(
        {
          rollIds: rolls.map((r) => r.id),
          customerId: parties.get("DEMO-MST-001")!,
          plateNumber: "34 ABC 123",
          driverName: "Kemal Yılmaz",
          carrier: "Öz Anadolu Nakliyat",
          clientToken: quickToken,
        },
        userId,
      );
      const data = res.data as { id: string; shipmentNo: string };
      result.hizli = data.id;
      note(true, `sevkiyat: ${data.shipmentNo} (Hızlı Sevk, ${rolls.length} top)`);
    }
  }

  // ── 2) Çuval yolu ────────────────────────────────────────────────────────
  const sackShipToken = demoToken("shipment:sack");
  const sackShipExisting = await prisma.shipment.findUnique({
    where: { clientToken: sackShipToken },
    select: { id: true },
  });
  if (sackShipExisting) {
    result.cuval = sackShipExisting.id;
    note(false, "sevkiyat: çuval yolu");
    return result;
  }

  const customerId = parties.get("DEMO-MST-002")!;
  const sackRes = await shippingService.openSack(
    { customerId, clientToken: demoToken("sack:demo-1") },
    userId,
  );
  const sackId = (sackRes.data as { id: string }).id;

  const sackRolls = await prisma.roll.findMany({
    where: { goodsReceiptId: receipts.get("mk-2"), status: RollStatus.WAREHOUSE, sackId: null, shipmentId: null },
    orderBy: { createdAt: "asc" },
    take: 2,
    select: { barcode: true },
  });
  for (const r of sackRolls) {
    if (!r.barcode) continue;
    await shippingService.scanIntoSack({ sackId, barcode: r.barcode }, userId);
  }
  // Brüt tartı — paketleme akışının gerçek adımı; çuval etiketinde ve
  // irsaliyede basılan kg buradan gelir.
  // ⚠️ Kaynak MANUAL: demo bir kantara bağlı değil ve "SCALE" demek, kolonun tek
  // varlık sebebini (simüle sayı ≠ gerçek tartı) yalanlamak olurdu.
  await shippingService.weighSack({ sackId, weightKg: 87.4, source: "MANUAL" }, userId);

  const shipRes = await shippingService.createShipment(
    {
      sackIds: [sackId],
      customerId,
      plateNumber: "06 XYZ 780",
      driverName: "Osman Aydın",
      carrier: "Başkent Lojistik",
      clientToken: sackShipToken,
    },
    userId,
  );
  const shipData = shipRes.data as { id: string; shipmentNo: string };
  result.cuval = shipData.id;
  note(true, `sevkiyat: ${shipData.shipmentNo} (çuval yolu, ${sackRolls.length} top)`);

  return result;
}

// -----------------------------------------------------------------------------
// 6) FATURA
// -----------------------------------------------------------------------------

/** `ItemUnit` → fatura satırındaki birim etiketi. */
function unitLabel(unit: ItemUnit): string {
  if (unit === ItemUnit.KG) return "kg";
  if (unit === ItemUnit.ADET) return "adet";
  return "m";
}

/**
 * Sevkiyattaki topları FATURA SATIRINA çevirir.
 *
 * ⚠️ Satırlar kumaş + renk bazında GRUPLANIR. Müşteri faturası "Blackout ·
 * Antrasit 215,5 m" der, "3 ayrı top satırı" demez — tedarikçi faturasında
 * `createDraftFromGoodsReceipt` de aynı kararı verdi.
 */
async function buildSalesLines(
  shipmentId: string,
  priceByItemCode: Map<string, number>,
): Promise<Array<{ itemId: string; description: string; qty: string; unit: string; unitPrice: number; vatRate: number }>> {
  const rolls = await prisma.roll.findMany({
    where: { shipmentId },
    select: {
      currentQty: true,
      item: { select: { id: true, code: true, name: true, unit: true } },
      color: { select: { name: true } },
    },
  });

  const groups = new Map<string, { itemId: string; code: string; description: string; qty: Prisma.Decimal; unit: string }>();
  for (const r of rolls) {
    const key = `${r.item.id}|${r.color?.name ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.qty = existing.qty.plus(r.currentQty);
      continue;
    }
    groups.set(key, {
      itemId: r.item.id,
      code: r.item.code,
      description: r.color?.name ? `${r.item.name} · ${r.color.name}` : r.item.name,
      qty: new Prisma.Decimal(r.currentQty),
      unit: unitLabel(r.item.unit),
    });
  }

  return [...groups.values()].map((g) => ({
    itemId: g.itemId,
    description: g.description,
    qty: g.qty.toString(),
    unit: g.unit,
    // Fiyat bilinmiyorsa 0 YAZILMAZ, makul bir demo fiyatı konur: 0 fiyatlı
    // satır taslakta serbesttir ama onayda 400 verir ve demo yarıda kalırdı.
    unitPrice: priceByItemCode.get(g.code) ?? 100,
    vatRate: 20,
  }));
}

async function ensureInvoices(
  shipments: { hizli: string | null; cuval: string | null },
  receipts: Map<string, string>,
  parties: Map<string, string>,
  userId: string,
): Promise<{ confirmedSalesCariId: string | null }> {
  const priceByItemCode = new Map(ITEMS.map((i) => [i.code, i.salesPrice]));
  let confirmedSalesCariId: string | null = null;

  // ── Satış faturası #1 — ONAYLI (cari deftere işler) ──────────────────────
  if (shipments.hizli) {
    const token = demoToken("invoice:sales-confirmed");
    const before = await prisma.invoice.findUnique({ where: { clientToken: token }, select: { id: true } });
    const lines = await buildSalesLines(shipments.hizli, priceByItemCode);
    if (lines.length === 0) {
      console.warn("   ⚠️ Onaylı satış faturası için satır üretilemedi — atlandı.");
    } else {
      const draft = await invoiceService.createDraft(
        {
          type: InvoiceType.SALES,
          customerId: parties.get("DEMO-MST-001")!,
          currency: Currency.TRY,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          notes: "Demo — sevkiyattan kesilen satış faturası.",
          shipmentId: shipments.hizli,
          clientToken: token,
          lines,
        },
        userId,
      );
      const invoiceId = draft.data.id;

      // ONAY tek yönlüdür ve ikinci kez çağrılırsa 409 verir → durum sorulur.
      const status = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true, docNo: true, cariId: true },
      });
      if (status.status === InvoiceStatus.DRAFT) {
        await invoiceService.confirm(invoiceId, userId);
      }
      confirmedSalesCariId = status.cariId;
      note(!before, `satış faturası (ONAYLI): ${status.docNo}`);
    }
  }

  // ── Satış faturası #2 — TASLAK (deftere hiçbir şey yazmaz) ───────────────
  if (shipments.cuval) {
    const token = demoToken("invoice:sales-draft");
    const before = await prisma.invoice.findUnique({ where: { clientToken: token }, select: { id: true } });
    const lines = await buildSalesLines(shipments.cuval, priceByItemCode);
    if (lines.length === 0) {
      console.warn("   ⚠️ Taslak satış faturası için satır üretilemedi — atlandı.");
    } else {
      const draft = await invoiceService.createDraft(
        {
          type: InvoiceType.SALES,
          customerId: parties.get("DEMO-MST-002")!,
          currency: Currency.TRY,
          notes: "Demo — henüz onaylanmamış taslak (deftere işlemez, serbestçe düzenlenir).",
          shipmentId: shipments.cuval,
          clientToken: token,
          lines,
        },
        userId,
      );
      const docNo = (
        await prisma.invoice.findUniqueOrThrow({ where: { id: draft.data.id }, select: { docNo: true } })
      ).docNo;
      note(!before, `satış faturası (TASLAK): ${docNo}`);
    }
  }

  // ── Alış faturası — USD'li mal kabul fişinden üretilir ────────────────────
  // ⚠️ `createDraftFromGoodsReceipt` clientToken ALMAZ; idempotentliği
  // `assertSourceFree` (aynı fişe ikinci fatura 409) sağlar. Beklenen çakışmayı
  // istisna olarak fırlatmak yerine önden soruyoruz.
  const purchaseSourceId = receipts.get("mk-2");
  if (purchaseSourceId) {
    const existing = await prisma.invoice.findFirst({
      where: { goodsReceiptId: purchaseSourceId, status: { not: InvoiceStatus.CANCELLED } },
      select: { id: true, status: true, docNo: true },
    });
    let invoiceId: string;
    let docNo: string;
    if (existing) {
      invoiceId = existing.id;
      docNo = existing.docNo;
    } else {
      const draft = await invoiceService.createDraftFromGoodsReceipt(purchaseSourceId, userId);
      invoiceId = draft.data.id;
      docNo = draft.data.docNo;
    }
    const cur = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } });
    if (cur.status === InvoiceStatus.DRAFT) {
      await invoiceService.confirm(invoiceId, userId);
    }
    note(!existing, `alış faturası (ONAYLI, USD): ${docNo}`);
  }

  return { confirmedSalesCariId };
}

// -----------------------------------------------------------------------------
// 7) TAHSİLAT + MASRAF + CARİ DEVRİ
// -----------------------------------------------------------------------------

/** Müşteriden KISMİ tahsilat — kasaya nakit. */
async function ensurePayment(
  parties: Map<string, string>,
  cashBoxId: string,
  userId: string,
): Promise<void> {
  const token = demoToken("payment:in-cash");
  const before = await prisma.payment.findUnique({ where: { clientToken: token }, select: { id: true } });
  const res = await paymentService.create(
    {
      direction: PaymentDirection.IN,
      method: PaymentMethod.CASH,
      customerId: parties.get("DEMO-MST-001")!,
      currency: Currency.TRY,
      amount: 25000,
      cashBoxId,
      reference: "Kasa tahsilatı — kısmi",
      notes: "Demo — faturanın tamamı değil, bakiye açık kalsın diye kısmi tahsilat.",
      clientToken: token,
    },
    userId,
  );
  note(!before, `tahsilat: ${(res.data as { docNo: string }).docNo} (25.000 TL nakit)`);
}

/** Carisiz gider fişi — kasanın kendi defteri. */
async function ensureExpense(cashBoxId: string, userId: string): Promise<void> {
  const token = demoToken("cash:expense-nakliye");
  const before = await prisma.cashTransaction.findUnique({ where: { clientToken: token }, select: { id: true } });
  const res = await cashTransactionService.create(
    {
      kind: CashTxnKind.EXPENSE,
      cashBoxId,
      amount: 4750,
      category: "Nakliye",
      description: "Ağustos dönemi araç ve hamaliye gideri",
      reference: "FT-2026-0912",
      clientToken: token,
    },
    userId,
  );
  note(!before, `masraf fişi: ${(res.data as { docNo: string }).docNo} (4.750 TL nakliye)`);
}

/**
 * Bir müşteriye AÇILIŞ (devir) bakiyesi.
 *
 * Sisteme geçiş gününün olmazsa olmazı: firma programa geçtiğinde müşterisinin
 * zaten borcu vardır. Devir bir HAREKETTİR (ADJUSTMENT kaynaklı defter satırı),
 * bakiyeye elle yazılan bir sayı değil — ekstrede görünür ve düzeltilebilir.
 * Servis ikinci devri REDDEDER → önden sorulur.
 */
async function ensureCariOpening(parties: Map<string, string>, userId: string): Promise<void> {
  const customerId = parties.get("DEMO-MST-003")!;
  let cari = await prisma.cariAccount.findFirst({ where: { customerId }, select: { id: true } });
  if (!cari) {
    const created = await cariService.create(
      {
        customerId,
        taxOffice: "Konak V.D.",
        defaultCurrency: Currency.TRY,
        paymentTermDays: 45,
        riskLimit: 250000,
        notes: "Demo — devir bakiyesi taşıyan cari.",
      },
      userId,
    );
    cari = { id: created.data.id };
  }

  const dup = await prisma.cariTransaction.findFirst({
    where: { cariId: cari.id, currency: Currency.TRY, sourceType: CariTxnSource.ADJUSTMENT },
    select: { id: true },
  });
  if (dup) {
    note(false, "cari devir bakiyesi: Villa Dekorasyon");
    return;
  }
  await cariService.setOpeningBalance(
    {
      cariId: cari.id,
      currency: Currency.TRY,
      balance: 42500,
      description: "Sisteme geçiş devri (demo)",
    },
    userId,
  );
  note(true, "cari devir bakiyesi: Villa Dekorasyon +42.500 TL");
}

// -----------------------------------------------------------------------------
// RAPOR
// -----------------------------------------------------------------------------

async function printSummary(dbName: string): Promise<void> {
  const demoCustomerCodes = PARTIES.map((p) => p.code);
  const [warehouses, colors, items, customers, receipts, rolls, shipments, invoices, payments, cashTxns, cari] =
    await Promise.all([
      prisma.warehouse.count(),
      prisma.color.count({ where: { code: { startsWith: "DEMO-" } } }),
      prisma.item.count({ where: { code: { startsWith: "DEMO-" } } }),
      prisma.customer.count({ where: { code: { in: demoCustomerCodes } } }),
      prisma.goodsReceipt.count({ where: { deliveryNoteNo: { in: RECEIPTS.map((r) => r.deliveryNoteNo) } } }),
      prisma.roll.count({ where: { item: { code: { startsWith: "DEMO-" } } } }),
      prisma.shipment.count({ where: { customer: { code: { in: demoCustomerCodes } } } }),
      prisma.invoice.count({ where: { cari: { customer: { code: { in: demoCustomerCodes } } } } }),
      prisma.payment.count({ where: { cari: { customer: { code: { in: demoCustomerCodes } } } } }),
      prisma.cashTransaction.count({ where: { cashBox: { code: "DEMO-KASA-TRY" } } }),
      prisma.cariAccount.count({ where: { customer: { code: { in: demoCustomerCodes } } } }),
    ]);

  console.log("\n─────────────────────────────────────────────");
  console.log(`Veritabanı        : ${dbName}`);
  console.log(`Bu koşumda        : ${tally.created} yeni, ${tally.existing} mevcut`);
  console.log("─────────────────────────────────────────────");
  console.log(`Depo (toplam)     : ${warehouses}`);
  console.log(`Demo renk         : ${colors}`);
  console.log(`Demo kumaş        : ${items}`);
  console.log(`Demo cari kart    : ${customers}   (cari hesap: ${cari})`);
  console.log(`Mal kabul fişi    : ${receipts}`);
  console.log(`Demo kumaş topu   : ${rolls}`);
  console.log(`Sevkiyat          : ${shipments}`);
  console.log(`Fatura            : ${invoices}`);
  console.log(`Tahsilat/ödeme    : ${payments}`);
  console.log(`Kasa hareketi     : ${cashTxns}`);
  console.log("─────────────────────────────────────────────\n");
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------


/**
 * ⚠️ REJİM BAYRAKLARI — demonun GÖRÜNÜR olmasının ÖN KOŞULU.
 *
 * Ticaret paketinin tüm yüzeyleri bayrak arkasında ("fabrika sıfır-fark"):
 * `finance.enabled` kapalıyken Cari/Fatura/Tahsilat menüde HİÇ görünmez, Hızlı
 * Sevk düğmesi çizilmez, Envanter üretim sekmeleriyle açılır. Yani bayraksız
 * bir demo, ticaret paketini değil FABRİKA ERP'sini gösterir — gösterilmek
 * istenenin tam tersini.
 *
 * ⚠️ ÇOK DEPO bayrakla DEĞİL VERİDEN çözülür (`useMultiWarehouse`): aktif depo
 * sayısı 1'den büyükse depo yüzeyleri kendiliğinden açılır. Bu yüzden burada
 * yalnız iki finans bayrağı set edilir; depo tarafını `ensureWarehouses` zaten
 * iki depo yaratarak sağlıyor.
 *
 * İdempotent: zaten açıksa yazılmaz (ayar tablosuna gereksiz audit düşmesin).
 */
async function ensureRegimeFlags(userId: string): Promise<void> {
  const mevcut = (await systemSettingService.getFeatureFlags()).data;
  const hedef: Array<["financeEnabled" | "pricingEnabled", boolean]> = [
    ["financeEnabled", true],
    ["pricingEnabled", true],
  ];
  const eksik = hedef.filter(([k, v]) => mevcut?.[k] !== v);
  if (eksik.length === 0) {
    console.log("   - rejim bayraklari zaten acik");
    return;
  }
  await systemSettingService.setFeatureFlags(Object.fromEntries(eksik), userId);
  console.log(`   - rejim bayraklari acildi: ${eksik.map(([k]) => k).join(", ")}`);
}

async function main(): Promise<void> {
  const dbName = currentDatabaseName();
  assertDemoDatabase(dbName);

  console.log("🧪 TeksERP — TİCARET DEMO verisi\n");
  console.log(`   Veritabanı: ${dbName}`);
  console.log("   Bu script HİÇBİR KAYDI SİLMEZ; yalnız DEMO- önekli veri ekler ve idempotenttir.\n");

  console.log("▸ Kullanıcı");
  const user = await ensureDemoUser();

  console.log("▸ Rejim bayraklari");
  await ensureRegimeFlags(user.id);

  console.log("▸ Kur");
  await ensureExchangeRates();

  console.log("▸ Depo / katalog / cari kartlar");
  const wh = await ensureWarehouses();
  const colors = await ensureColors();
  const items = await ensureItems();
  const parties = await ensureParties();

  console.log("▸ Kasa / banka");
  const accounts = await ensureCashAndBank();
  await ensureOpeningBalances(accounts, user.id);

  console.log("▸ Mal kabul");
  const receipts = await ensureGoodsReceipts(wh, items, colors, parties, user.id);

  console.log("▸ Sevkiyat");
  const shipments = await ensureShipments(receipts, parties, user.id);

  console.log("▸ Fatura");
  await ensureInvoices(shipments, receipts, parties, user.id);

  console.log("▸ Tahsilat / masraf / devir");
  await ensurePayment(parties, accounts.kasaTry, user.id);
  await ensureExpense(accounts.kasaTry, user.id);
  await ensureCariOpening(parties, user.id);

  await printSummary(dbName);

  console.log("Giriş bilgisi:");
  if (user.announcedPassword) {
    console.log(`   demo / ${user.announcedPassword}`);
    console.log("   ⚠️ Bu şifre BİR KEZ basılır — not alın. Değiştirmek için DEMO_USER_PASSWORD ile yeniden koşun.\n");
  } else {
    console.log("   demo / (mevcut şifre korundu — değiştirmek için DEMO_USER_PASSWORD ile yeniden koşun)\n");
  }
}

main()
  .catch((e) => {
    console.error("\n❌ Demo seed hatası:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Servisler audit satırlarını `void AuditService.log(...)` ile ATEŞLE-UNUT
    // yazıyor (best-effort, isteği düşürmesin diye). Havuzu hemen kapatmak o
    // uçuştaki yazımları "bağlantı kapandı" hatasına düşürürdü — demo kaydı
    // denetim izi olmadan doğar ve sebebi ekranda gürültü olarak görünürdü.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await prisma.$disconnect();
    await pool.end();
  });
