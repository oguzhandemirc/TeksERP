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
  ChequeKind,
  ChequeStatus,
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
import { chequeService } from "../src/services/cheque.service";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { periodCloseService } from "../src/services/period-close.service";
import { cashPeriodCloseService } from "../src/services/cash-period-close.service";
import { returnService } from "../src/services/return.service";
import { systemSettingService } from "../src/services/system-setting.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import {
  foldColorNameForCompare,
  foldNameForCompare,
} from "../src/services/helpers/name-normalize.helper";

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
// TARİH YARDIMCILARI
// -----------------------------------------------------------------------------
// ⚠️ SAAT DİLİMİ: fabrika günü `Europe/Istanbul` takvim günüdür (kök CLAUDE.md
// `constants/time.ts` kuralı) ama bu script geliştirici makinesinde de koşar ve
// oranın `TZ`'si Istanbul olmayabilir. `new Date(y, m, d)` YEREL gün üretir →
// dönem kapanışı anahtarı (`periodDayKey` → `factoryDayKeyUtcMidnight`) bir gün
// kayabilirdi. Bu yüzden her sabit tarih `Date.UTC(..., 9, 0, 0)` ile kurulur:
// 09:00 UTC, Istanbul'da 12:00 — hiçbir makul saat diliminde gün değiştirmez.
const DAY_MS = 24 * 60 * 60 * 1000;

/** Bugünden N gün ileri (negatif = geri) — mutlak an, takvim günü değil. */
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * DAY_MS);
}

/**
 * N ay önceki takvim ayının SON günü (öğlen).
 *
 * `Date.UTC(y, m - n + 1, 0)` → "(m-n) ayının son günü"; JS ay taşmasını
 * kendisi çözer (Ocak'tan geriye gitmek yılı da düşürür).
 */
function endOfMonthsAgo(n: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n + 1, 0, 9, 0, 0));
}

/** Verilen günün N gün öncesi (öğlen sabitini korur). */
function daysBefore(base: Date, n: number): Date {
  return new Date(base.getTime() - n * DAY_MS);
}

/** Türkçe kısa tarih — ekrandaki rapor satırları için. */
function trDate(d: Date): string {
  return d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
}

/**
 * MÜHÜRLENECEK DÖNEM SONU — İKİ ay önceki ayın son günü.
 *
 * ⚠️ TEK KAYNAK ve bilerek ESKİ bir tarih. İki tüketicisi var (geçmişe tarihli
 * kasa hareketleri ile dönem kapanışlarının kendisi) ve ikisi ayrı hesaplasaydı
 * ay sınırında ayrışabilirlerdi — o durumda mühür, tam da onu doldurmak için
 * yazılmış hareketleri kapsamazdı.
 *
 * ⚠️ "İki ay önce" GÜVENLİK KARARIDIR: demo kurulumunda bugün yapılan hiçbir
 * deneme (masraf fişi, tahsilat, çek tahsili, fatura) bu mühre çarpmaz. Geçen
 * ayın sonu mühürlense, demoyu gezen kişi geriye tarihli tek bir denemede
 * "dönem kapalı" 409'una çarpar ve bunu bir arıza sanardı.
 */
const SEALED_PERIOD_END = endOfMonthsAgo(2);

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

/**
 * CARİ KART ALANLARI — vade + risk limiti + vergi dairesi.
 *
 * ⚠️ Bu tablo olmadan demo "vadesiz" görünür: `paymentTermDays` boşken fatura
 * diyaloğu vade ÖNERMEZ, girilmeyen `dueDate` yüzünden her fatura aging'in
 * "vadesiz" kovasına düşer ve H1/H2'nin tüm rozetleri (AÇIK/KISMİ/KAPALI,
 * "vadesi geçti", cari listesindeki "Gecikmiş" kolonu) BOŞ kalır. Yani
 * ekranlar çalışıyor ama gösterecek verileri yok — demo için en kötü hâl.
 *
 * Vade günleri bilerek FARKLI (30/45/60): tek değer, "vade cariden geliyor"
 * mesajını görünmez yapardı.
 */
const CARI_TERMS: Array<{
  code: string;
  taxOffice: string;
  paymentTermDays: number;
  riskLimit: number | null;
}> = [
  { code: "DEMO-MST-001", taxOffice: "Beyoğlu V.D.", paymentTermDays: 30, riskLimit: 750000 },
  { code: "DEMO-MST-002", taxOffice: "Çankaya V.D.", paymentTermDays: 45, riskLimit: 400000 },
  { code: "DEMO-MST-003", taxOffice: "Konak V.D.", paymentTermDays: 45, riskLimit: 250000 },
  { code: "DEMO-MST-004", taxOffice: "Muratpaşa V.D.", paymentTermDays: 60, riskLimit: 1200000 },
  { code: "DEMO-MST-005", taxOffice: "Kocasinan V.D.", paymentTermDays: 30, riskLimit: 300000 },
  { code: "DEMO-TED-001", taxOffice: "Pamukkale V.D.", paymentTermDays: 45, riskLimit: null },
  { code: "DEMO-TED-002", taxOffice: "Konak V.D.", paymentTermDays: 30, riskLimit: null },
  { code: "DEMO-TED-003", taxOffice: "Osmangazi V.D.", paymentTermDays: 60, riskLimit: null },
  { code: "DEMO-CARI-001", taxOffice: "Kadıköy V.D.", paymentTermDays: 30, riskLimit: 500000 },
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

  // ⚠️ KOD İLE UPSERT TEK BAŞINA YETMEZ — bu fonksiyon aşağıdaki
  // `findByLooseName` doktrinini (ADI kullanılan kart VARSA yeniden kullan)
  // uygulamıyordu ve 2026-09-01 deploy'unda ISIRDI:
  //   canlı demoda "Şube Depo" `DP0109260001` (servisin ürettiği OTOMATİK kod)
  //   ile duruyordu; kod araması ıskaladı, create denendi ve `warehouses_nameFold_key`
  //   ile P2002 verdi → seed yarıda kaldı, deploy durdu.
  // Ad seddi (2026-09-01) bu durumu "sessiz mükerrer"den "sert hata"ya çevirdi;
  // doğru çözüm seddi gevşetmek değil, seed'i kendi kuralına uydurmaktır.
  const kodDaki = await prisma.warehouse.findUnique({
    where: { code: "DEMO-DEPO-SUBE" },
    select: { id: true },
  });
  const hedefAd = "Şube Depo";
  const adDaki =
    kodDaki ??
    (await prisma.warehouse.findFirst({
      where: { name: { equals: hedefAd, mode: "insensitive" } },
      select: { id: true },
    }));
  const sube =
    adDaki ??
    (await prisma.warehouse.create({
      data: {
        code: "DEMO-DEPO-SUBE",
        name: hedefAd,
        address: "Ege Serbest Bölge, 3. Kısım, İzmir",
        notes: "Demo verisi — şube stoklarının tutulduğu ikinci depo.",
      },
      select: { id: true },
    }));
  note(!adDaki, "depo: Şube Depo");

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
  // ⚠️ `toLowerCase()` TÜRKÇEDE YETMEZ ve 2026-09-01 deploy'unda ISIRDI:
  // "GRİ".toLowerCase() → "gri̇" (i + BİRLEŞİMLİ NOKTA), "Gri" ise "gri" —
  // eşleşme kaçtı, seed ikinci bir "Gri" yaratmaya çalıştı ve DB'nin renk ad
  // seddine (`colors_nameFoldColor_key`, `tr_fold_color`) çarptı.
  // Kural: karşılaştırma UYGULAMANIN KANONİK katlamasıyla yapılır — bekçinin ve
  // DB'nin kullandığı ölçüyle aynı olmalı, yoksa "seed temiz sanır, DB reddeder"
  // ayrışması doğar. Renk kendi katlamasını kullanır (ayırıcıları da düşürür).
  const rows =
    tablo === "color"
      ? await prisma.color.findMany({
          where: { isActive: true, mergedIntoId: null },
          select: { id: true, name: true },
        })
      : await prisma.item.findMany({
          where: { isActive: true, mergedIntoId: null },
          select: { id: true, name: true },
        });
  const katla = (x: string): string =>
    tablo === "color" ? foldColorNameForCompare(x) : foldNameForCompare(x);
  const hedef = katla(ad);
  return rows.find((r) => katla(r.name) === hedef) ?? null;
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

/**
 * CARİ HESAPLAR — vade + risk limiti + vergi dairesi ile ÖNDEN açılır.
 *
 * ⚠️ Normalde cari hesap LAZY açılır (`ensureCariAccountTx`: 200 müşterinin
 * çoğunun hareketi yok, hepsine boş hesap açmak listeyi çöple doldurur). Demoda
 * tersi geçerli: dokuz firmanın hepsi zaten hareket görecek ve VADE bilgisi
 * lazy açılışta NULL doğar — yani fatura vadesi önerilmez, aging "vadesiz"
 * kovasında toplanır, H1/H2 rozetleri boş kalır. Bu yüzden hesaplar burada,
 * fatura/tahsilat yollarından ÖNCE ve vade bilgisiyle açılır.
 *
 * ⚠️ MEVCUT KAYIT EZİLMEZ. Güncelleme yalnız alan HÂLÂ BOŞKEN yapılır: demoyu
 * gezen kişi vadeyi panelden değiştirdiyse bir sonraki seed koşumu onu geri
 * almamalı (master data'daki `update: {}` kuralının aynısı).
 */
async function ensureCariAccounts(
  parties: Map<string, string>,
  userId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let created = 0;
  let patched = 0;

  for (const t of CARI_TERMS) {
    const customerId = parties.get(t.code);
    if (!customerId) continue;

    const existing = await prisma.cariAccount.findFirst({
      where: { customerId },
      select: { id: true, paymentTermDays: true, taxOffice: true, riskLimit: true },
    });

    if (!existing) {
      const res = await cariService.create(
        {
          customerId,
          taxOffice: t.taxOffice,
          defaultCurrency: Currency.TRY,
          paymentTermDays: t.paymentTermDays,
          riskLimit: t.riskLimit,
          notes: "Demo verisi.",
        },
        userId,
      );
      map.set(t.code, res.data.id);
      created++;
      continue;
    }

    map.set(t.code, existing.id);
    // Yalnız BOŞ alanlar tamamlanır (2026-08-14 öncesi koşumlarda açılmış,
    // vadesiz cariler için geriye dönük doldurma).
    const patch: { taxOffice?: string; paymentTermDays?: number; riskLimit?: number } = {};
    if (existing.paymentTermDays == null) patch.paymentTermDays = t.paymentTermDays;
    if (!existing.taxOffice) patch.taxOffice = t.taxOffice;
    if (existing.riskLimit == null && t.riskLimit != null) patch.riskLimit = t.riskLimit;
    if (Object.keys(patch).length > 0) {
      await cariService.update(existing.id, patch, userId);
      patched++;
    }
  }

  note(
    created > 0 || patched > 0,
    `cari hesap: ${map.size} hesap (${created} yeni, ${patched} vade/limit tamamlandı)`,
  );
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
    // ⚠️ ZATEN VARSA YENİDEN GÖNDERME (2026-09-01). `buildSalesLines` satırları
    // sevkiyatın CANLI toplarından türetir; ilk koşumdan sonra iadeler topları
    // çıkarınca ikinci koşumda payload KÜÇÜLÜR. Aynı token + farklı gövde artık
    // 409 `CLIENT_TOKEN_COLLISION` alıyor (gövde kapısı, 2026-09-01) — eskiden
    // sessizce ilk fatura dönüyordu. Belge zaten doğru oluştu; onu YENİDEN
    // hesaplanmış bir payload'la yeniden göndermenin bir işi yok.
    if (before) {
      confirmedSalesCariId = confirmedSalesCariId ?? null;
    } else if (lines.length === 0) {
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
    // Bkz. yukarıdaki gerekçe — zaten varsa yeniden gönderilmez.
    if (before) {
      // no-op: taslak fatura zaten oluşturulmuş.
    } else if (lines.length === 0) {
      console.warn("   ⚠️ Taslak satış faturası için satır üretilemedi — atlandı.");
    } else {
      const draft = await invoiceService.createDraft(
        {
          type: InvoiceType.SALES,
          customerId: parties.get("DEMO-MST-002")!,
          currency: Currency.TRY,
          // Vade = carinin kendi vade günü (Ev Tekstili → 45 gün). Taslakta da
          // dolu olmalı: aging ve "vadesi geçti" rozeti `dueDate`den okur ve
          // boş bırakılan her fatura "vadesiz" kovasında toplanır.
          dueDate: daysFromNow(45),
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
    const cur = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { status: true, dueDate: true },
    });
    if (cur.status === InvoiceStatus.DRAFT) {
      // ⚠️ VADE ONAYDAN ÖNCE yazılır: `updateDraft` yalnız DRAFT'ta çalışır
      // (atomik claim `status: DRAFT` ister) ve onaylanmış faturanın vadesini
      // değiştirmenin yolu YOKTUR. `createDraftFromGoodsReceipt` vade taşımaz —
      // fişte böyle bir alan yok — o yüzden burada carinin vade gününden
      // türetilir (Ege Kumaş → 30 gün).
      if (cur.dueDate == null) {
        await invoiceService.updateDraft(invoiceId, { dueDate: daysFromNow(30) }, userId);
      }
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

/**
 * KASA DEFTERİ — carisiz masraf/gelir fişleri + virman + bir İPTAL.
 *
 * Kasa Defteri raporunun KATEGORİ KIRILIMI bloğu (H7) yalnız `category` alanı
 * dolu satırlardan doğar; tek kalemli bir defterde blok tek satır gösterir ve
 * özelliğin ne işe yaradığı görünmez. Üç kova (Kira · Nakliye · Elektrik) +
 * bir gelir + bir virman + bir iptal, bloğun DÖRT davranışını birden kanıtlar:
 *   • kategori bazlı gruplama,
 *   • VİRMANIN AYRI KOVASI (`transfer()` ucu kategori kabul etmez — kırılımda
 *     "Kategorisiz" diye görünseydi düzeltilemez bir suçlama olurdu),
 *   • iptalin NETLEŞMESİ (ters satır aslının kategorisini taşır → kova
 *     "çıkan 1.900 / giren 1.900 / net 0" ve "NETLEŞTİ" rozeti),
 *   • kova toplamlarının hesap özetiyle mutabakatı.
 *
 * ⚠️ İKİ SATIR BİLEREK GEÇMİŞ DÖNEME TARİHLİ (`SEALED_PERIOD_END` öncesi):
 * dönem kapanışı fotoğrafı boş kalmasın. Onlarsız mühür 0,00 / 0 hareket
 * gösterir ve "mühürlü devir" notu, gösterdiği şey sıfır olduğu için hiçbir
 * şey anlatmaz. ⚠️ SIRA LOAD-BEARING: bu fonksiyon `ensurePeriodCloses`'tan
 * ÖNCE koşmalı — mühür yazıldıktan sonra o iki satır `assertCashPeriodOpenTx`
 * ile 409 alırdı.
 *
 * ⚠️ BU İKİ SATIRIN `clientToken`'ı İKİ KEZ LOAD-BEARING (negatif sondayla
 * ölçüldü, 2026-08-14): (a) idempotentlik çıpası, (b) ikinci koşumun kapalı
 * döneme çarpmasını önleyen şey. `create` token'ı dönem kilidinden ÖNCE sorup
 * mevcut kaydı döndüğü için yol hiç açılmaz. Token düşürülünce ikinci koşum
 * mükerrer üretmedi — doğrudan 409 ile ÇÖKTÜ ("05.06.2026 tarihli hareket bu
 * hesabın KAPALI dönemine düşüyor"). Yani buradaki hata sessiz değil gürültülü
 * çıkar; yine de çıpayı "gereksiz" sanıp kaldırma.
 *
 * ⚠️ İPTAL EDİLEN FİŞ GEÇMİŞE TARİHLENMEZ: `cancel` dönem kilidini fişin
 * ORİJİNAL `txnDate`'iyle sorar (bugüne değil) — mühürlü döneme tarihli bir
 * fişi iptal etmek o kapanmış sayfayı değiştirmek olurdu.
 */
async function ensureCashMovements(
  acc: { kasaTry: string; bankaTry: string; bankaUsd: string },
  userId: string,
): Promise<void> {
  const moves: Array<{
    key: string;
    kind: Extract<CashTxnKind, "EXPENSE" | "INCOME">;
    amount: number;
    category: string;
    description: string;
    reference?: string;
    txnDate: Date;
    label: string;
  }> = [
    // ── MÜHÜRLENECEK DÖNEMİN İÇİ ───────────────────────────────────────────
    {
      key: "cash:income-alt-kira",
      kind: CashTxnKind.INCOME,
      amount: 15000,
      category: "Diğer Gelir",
      description: "Depo üst katı alt kira geliri",
      txnDate: daysBefore(SEALED_PERIOD_END, 25),
      label: "gelir fişi (geçmiş dönem, 15.000 TL alt kira)",
    },
    {
      key: "cash:expense-kira-onceki",
      kind: CashTxnKind.EXPENSE,
      amount: 6500,
      category: "Kira",
      description: "Önceki dönem işyeri kirası",
      txnDate: daysBefore(SEALED_PERIOD_END, 10),
      label: "masraf fişi (geçmiş dönem, 6.500 TL kira)",
    },
    // ── AÇIK DÖNEM ─────────────────────────────────────────────────────────
    {
      // ⚠️ TOKEN DEĞİŞMEZ — 2026-08-14 öncesi koşumlarda bu fiş bu anahtarla
      // doğdu; adı "expense-nakliye"den başka bir şeye çevirmek ikinci bir
      // nakliye masrafı üretirdi (idempotentliğin tek çıpası token).
      key: "cash:expense-nakliye",
      kind: CashTxnKind.EXPENSE,
      amount: 4750,
      category: "Nakliye",
      description: "Ağustos dönemi araç ve hamaliye gideri",
      reference: "FT-2026-0912",
      txnDate: new Date(),
      label: "masraf fişi (4.750 TL nakliye)",
    },
    {
      key: "cash:expense-kira",
      kind: CashTxnKind.EXPENSE,
      amount: 6500,
      category: "Kira",
      description: "İşyeri kirası — cari dönem",
      txnDate: daysFromNow(-6),
      label: "masraf fişi (6.500 TL kira)",
    },
    {
      key: "cash:expense-elektrik",
      kind: CashTxnKind.EXPENSE,
      amount: 3850,
      category: "Elektrik",
      description: "Elektrik faturası — atölye ve depo",
      reference: "ELK-2026-08",
      txnDate: daysFromNow(-3),
      label: "masraf fişi (3.850 TL elektrik)",
    },
    {
      key: "cash:income-kupon",
      kind: CashTxnKind.INCOME,
      amount: 2400,
      category: "Diğer Gelir",
      description: "Parça/kupon kumaş satışı — carisiz nakit giriş",
      txnDate: daysFromNow(-2),
      label: "gelir fişi (2.400 TL kupon satışı)",
    },
  ];

  for (const m of moves) {
    const token = demoToken(m.key);
    const before = await prisma.cashTransaction.findUnique({
      where: { clientToken: token },
      select: { id: true },
    });
    const res = await cashTransactionService.create(
      {
        kind: m.kind,
        cashBoxId: acc.kasaTry,
        amount: m.amount,
        category: m.category,
        description: m.description,
        reference: m.reference,
        txnDate: m.txnDate,
        clientToken: token,
      },
      userId,
    );
    note(!before, `${m.label}: ${(res.data as { docNo: string }).docNo}`);
  }

  // ── VİRMAN — kasadan bankaya (tek uç, iki bacak, tek tx) ─────────────────
  const transferToken = demoToken("cash:transfer-kasa-banka");
  const transferBefore = await prisma.cashTransaction.findUnique({
    where: { clientToken: transferToken },
    select: { id: true },
  });
  const transferRes = await cashTransactionService.transfer(
    {
      fromCashBoxId: acc.kasaTry,
      toBankAccountId: acc.bankaTry,
      amount: 20000,
      txnDate: daysFromNow(-4),
      description: "Kasa fazlasının bankaya yatırılması",
      clientToken: transferToken,
    },
    userId,
  );
  note(
    !transferBefore,
    `virman: ${(transferRes.data as { docNos: string[] }).docNos.join(" / ")} (20.000 TL kasa → banka)`,
  );

  // ── İPTAL EDİLMİŞ MASRAF — kırılımda "NETLEŞTİ" rozetini doğurur ─────────
  const cancelToken = demoToken("cash:expense-temsil-iptal");
  const cancelBefore = await prisma.cashTransaction.findUnique({
    where: { clientToken: cancelToken },
    select: { id: true },
  });
  const cancelRes = await cashTransactionService.create(
    {
      kind: CashTxnKind.EXPENSE,
      cashBoxId: acc.kasaTry,
      amount: 1900,
      category: "Temsil ve Ağırlama",
      description: "Müşteri ziyareti gideri — yanlış kasadan girildi",
      txnDate: daysFromNow(-1),
      clientToken: cancelToken,
    },
    userId,
  );
  const cancelId = (cancelRes.data as { id: string; docNo: string }).id;
  const cancelDocNo = (cancelRes.data as { docNo: string }).docNo;
  // Durum SORULUR, körlemesine iptal ÇAĞRILMAZ: ikinci koşumda `cancel`
  // "zaten iptal edilmiş" 409'u fırlatır ve beklenen bir çakışmayı istisna
  // olarak fırlatmak gerçek hatayı gürültüye gömer (açılış bakiyesi emsali).
  const cancelState = await prisma.cashTransaction.findUniqueOrThrow({
    where: { id: cancelId },
    select: { status: true },
  });
  if (cancelState.status === PaymentStatus.ACTIVE) {
    await cashTransactionService.cancel(
      cancelId,
      "Gider şirket kredi kartından ödendi — kasadan çıkmadı.",
      userId,
    );
  }
  note(!cancelBefore, `iptal edilmiş masraf fişi: ${cancelDocNo} (1.900 TL temsil)`);
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

/**
 * DEVİR DÜZELTME ZİNCİRİ — devir → storno → doğru devir (üç ekstre satırı).
 *
 * Sisteme geçişte en sık yapılan hata yanlış devir tutarıdır (4.250 yerine
 * 42.500). Defter APPEND-ONLY olduğu için düzeltme SİLME değil TERS SATIRDIR
 * (`ADJUSTMENT_CANCEL`, `reversesTxnId` bağıyla — SAP FB08 storno modeli) ve
 * ancak ondan sonra doğrusu girilebilir. Demoda bu zincirin GÖRÜNMESİ gerekir:
 * ekstrede üç satır + ters-kayıt bağı, aksi halde "yanlış devir girdim, ne
 * yapacağım" sorusunun cevabı ekranda hiçbir yerde yoktur.
 *
 * ⚠️ TERS KAYIT BUGÜNE DÜŞER (`cancelOpeningBalance` sözleşmesi), orijinalin
 * tarihine DEĞİL — kapanmış bir dönemin ilan edilmiş fotoğrafı değişmez.
 * Bu yüzden orijinal ve düzeltilmiş devir GEÇMİŞE tarihlenebilir ama storno
 * satırı bugünkü tarihle görünür; ekstrede kasıtlı olarak böyle okunur.
 *
 * ⚠️ ÜÇ AYRI GUARD, üçü de farklı soruyu sorar (tek guard kullanmak zinciri
 * yarıda bırakırdı — örn. yalnız "ADJUSTMENT var mı" deseydik storno'dan sonra
 * doğru devir hiç girilmezdi):
 *   A) hiç ADJUSTMENT var mı        → yanlış devir yazılsın mı
 *   B) ADJUSTMENT_CANCEL var mı     → storno atılsın mı
 *   C) TERSLENMEMİŞ ADJUSTMENT var mı → doğru devir yazılsın mı
 */
async function ensureCariOpeningChain(
  cariIds: Map<string, string>,
  userId: string,
): Promise<void> {
  const cariId = cariIds.get("DEMO-MST-005");
  if (!cariId) {
    console.warn("   ⚠️ Devir zinciri için cari hesap bulunamadı — atlandı.");
    return;
  }
  const currency = Currency.TRY;
  const originalDate = daysFromNow(-40);

  // A) Yanlış devir.
  const anyAdjustment = await prisma.cariTransaction.findFirst({
    where: { cariId, currency, sourceType: CariTxnSource.ADJUSTMENT },
    select: { id: true },
  });
  if (!anyAdjustment) {
    await cariService.setOpeningBalance(
      {
        cariId,
        currency,
        balance: 4250,
        description: "Sisteme geçiş devri (demo — tutar HATALI girildi)",
        txnDate: originalDate,
      },
      userId,
    );
    note(true, "devir zinciri 1/3: Anadolu Mobilya +4.250 TL (hatalı)");
  } else {
    note(false, "devir zinciri 1/3: Anadolu Mobilya (hatalı devir)");
  }

  // B) Storno.
  const anyCancel = await prisma.cariTransaction.findFirst({
    where: { cariId, currency, sourceType: CariTxnSource.ADJUSTMENT_CANCEL },
    select: { id: true },
  });
  if (!anyCancel) {
    await cariService.cancelOpeningBalance(
      {
        cariId,
        currency,
        reason: "Devir tutarı yanlış girildi (4.250 yerine 42.500) — düzeltiliyor.",
      },
      userId,
    );
    note(true, "devir zinciri 2/3: storno (ADJUSTMENT_CANCEL, ters kayıt bağlı)");
  } else {
    note(false, "devir zinciri 2/3: storno");
  }

  // C) Doğru devir — "aktif devir" = TERSLENMEMİŞ ADJUSTMENT.
  const activeAdjustment = await prisma.cariTransaction.findFirst({
    where: { cariId, currency, sourceType: CariTxnSource.ADJUSTMENT, reversedBy: { is: null } },
    select: { id: true },
  });
  if (!activeAdjustment) {
    await cariService.setOpeningBalance(
      {
        cariId,
        currency,
        balance: 42500,
        description: "Sisteme geçiş devri (düzeltilmiş)",
        txnDate: originalDate,
      },
      userId,
    );
    note(true, "devir zinciri 3/3: Anadolu Mobilya +42.500 TL (doğru)");
  } else {
    note(false, "devir zinciri 3/3: doğru devir");
  }
}

// -----------------------------------------------------------------------------
// 8) ÇEK / SENET
// -----------------------------------------------------------------------------

/**
 * DÖRT ÇEK — portföyün dört ayrı hâli.
 *
 * Çek ekranları (portföy listesi · vade takvimi · özet kartları · teslim
 * bordrosu) boş bir tabloyla hiçbir şey anlatmaz. Dört örnek, ekranların ayırt
 * ettiği DÖRT durumu birden doldurur:
 *   • vadesi YAKLAŞAN (5 gün)  → "SOON" kovası + amber satır tonu
 *   • vadesi GEÇMİŞ            → "OVERDUE" kovası + kırmızı ton
 *   • TAHSİL EDİLMİŞ           → banka bakiyesi gerçekten oynar (takvim DIŞI)
 *   • VERİLEN (ISSUED)         → borç tarafı; ayrı kind, ayrı belge ön eki
 *
 * ⚠️ İŞLEM TARİHİ ≠ KEŞİDE TARİHİ (Sağlamlık SINIF 1) ve demo bunu GÖSTERMEK
 * zorunda: üçü de farklı verilir (`issueDate` kâğıdın üstündeki tarih,
 * `postingDate` defter çıpası, `dueDate` vade). Hepsi bugün olsaydı, alanların
 * neden üç ayrı kolon olduğu ekranda görünmezdi.
 *
 * ⚠️ TAHSİL BANKAYA YAPILIR, KASAYA DEĞİL — bilinçli: `collect` hesabın dönem
 * kilidini `eventDate` ile sorar ve mühürlenen hesap KASA'dır (aşağıdaki
 * `ensurePeriodCloses`). Kasaya tahsil edilse ve tarih mühürden önce olsa
 * seed 409 alırdı; banka mühürsüzdür.
 *
 * ⚠️ İLERLEME DURUMDAN TÜRETİLİR (`PORTFOLIO → AT_BANK → COLLECTED`), sayaçtan
 * değil: `deposit`/`collect` tek yönlü geçişlerdir ve ikinci koşumda körlemesine
 * çağrılsalardı 409 fırlatırlardı.
 */
async function ensureCheques(
  cariIds: Map<string, string>,
  acc: { kasaTry: string; bankaTry: string; bankaUsd: string },
  userId: string,
): Promise<void> {
  const specs: Array<{
    key: string;
    kind: ChequeKind;
    cariCode: string;
    amount: number;
    issueDate: Date;
    postingDate: Date;
    dueDate: Date;
    serialNo: string;
    bankName: string;
    branchName: string;
    drawerName: string;
    notes: string;
    label: string;
    /** Doluysa çek bankaya verilip tahsil edilir (banka hesabı id'si). */
    collectInto?: string;
  }> = [
    {
      key: "cheque:portfolio-soon",
      kind: ChequeKind.RECEIVED,
      cariCode: "DEMO-MST-001",
      amount: 38500,
      issueDate: daysFromNow(-25),
      postingDate: daysFromNow(-20),
      dueDate: daysFromNow(5),
      serialNo: "0041237",
      bankName: "T. İş Bankası",
      branchName: "Merter",
      drawerName: "Perde Dünyası Mağazacılık A.Ş.",
      notes: "Demo — vadesi yaklaşan portföy çeki.",
      label: `portföyde, vadesi YAKLAŞIYOR (${trDate(daysFromNow(5))}) — 38.500 TL`,
    },
    {
      key: "cheque:portfolio-overdue",
      kind: ChequeKind.RECEIVED,
      cariCode: "DEMO-MST-002",
      amount: 12900,
      issueDate: daysFromNow(-70),
      postingDate: daysFromNow(-60),
      dueDate: daysFromNow(-8),
      serialNo: "0075512",
      bankName: "Yapı Kredi",
      branchName: "Kızılay",
      drawerName: "Ev Tekstili Mağazacılık Ltd. Şti.",
      notes: "Demo — vadesi geçmiş, hâlâ portföyde.",
      label: `portföyde, vadesi GEÇMİŞ (${trDate(daysFromNow(-8))}) — 12.900 TL`,
    },
    {
      key: "cheque:collected",
      kind: ChequeKind.RECEIVED,
      cariCode: "DEMO-MST-001",
      amount: 64750,
      issueDate: daysFromNow(-60),
      postingDate: daysFromNow(-55),
      dueDate: daysFromNow(-15),
      serialNo: "0041198",
      bankName: "T. İş Bankası",
      branchName: "Merter",
      drawerName: "Perde Dünyası Mağazacılık A.Ş.",
      notes: "Demo — bankaya verilip tahsil edilen çek.",
      label: "TAHSİL EDİLDİ (banka bakiyesine girdi) — 64.750 TL",
      collectInto: acc.bankaTry,
    },
    {
      key: "cheque:issued",
      kind: ChequeKind.ISSUED,
      cariCode: "DEMO-TED-001",
      amount: 28000,
      issueDate: daysFromNow(-5),
      postingDate: daysFromNow(-5),
      dueDate: daysFromNow(40),
      serialNo: "0900341",
      bankName: "T.C. Ziraat Bankası",
      branchName: "Merkez",
      drawerName: "TeksERP Demo Tekstil A.Ş.",
      notes: "Demo — tedarikçiye verilen kendi çekimiz.",
      label: `VERİLEN çek, vade ${trDate(daysFromNow(40))} — 28.000 TL`,
    },
  ];

  for (const s of specs) {
    const cariId = cariIds.get(s.cariCode);
    if (!cariId) {
      console.warn(`   ⚠️ ${s.cariCode} için cari hesap yok — çek atlandı.`);
      continue;
    }
    const token = demoToken(s.key);
    const before = await prisma.cheque.findUnique({ where: { clientToken: token }, select: { id: true } });

    const res = await chequeService.create(
      {
        kind: s.kind,
        cariId,
        currency: Currency.TRY,
        amount: s.amount,
        issueDate: s.issueDate,
        postingDate: s.postingDate,
        dueDate: s.dueDate,
        serialNo: s.serialNo,
        bankName: s.bankName,
        branchName: s.branchName,
        drawerName: s.drawerName,
        notes: s.notes,
        clientToken: token,
      },
      userId,
    );
    const chequeId = res.data.id;

    if (s.collectInto) {
      // Durum makinesinde nerede kaldıysa oradan devam — idempotent ilerleme.
      const cur = await prisma.cheque.findUniqueOrThrow({
        where: { id: chequeId },
        select: { status: true },
      });
      if (cur.status === ChequeStatus.PORTFOLIO) {
        await chequeService.deposit(
          chequeId,
          { bankAccountId: s.collectInto, eventDate: daysFromNow(-12), notes: "Tahsile verildi (demo)." },
          userId,
        );
      }
      const afterDeposit = await prisma.cheque.findUniqueOrThrow({
        where: { id: chequeId },
        select: { status: true },
      });
      if (afterDeposit.status === ChequeStatus.AT_BANK) {
        await chequeService.collect(
          chequeId,
          { bankAccountId: s.collectInto, eventDate: daysFromNow(-10), notes: "Vadesinde tahsil edildi (demo)." },
          userId,
        );
      }
    }

    note(!before, `çek: ${res.data.docNo} — ${s.label}`);
  }
}

// -----------------------------------------------------------------------------
// 9) ALIŞ SİPARİŞİ
// -----------------------------------------------------------------------------

/**
 * ÜÇ ALIŞ SİPARİŞİ — "ne ısmarladım, ne geldi"nin üç hâli.
 *
 * `PurchaseOrder` ekranının tüm değeri KARŞILANMA farkındadır (`qty` ↔
 * `receivedQty`), tek bir OPEN sipariş bunu gösteremez. Üçü birlikte, ekranın
 * ayırt ettiği üç durumu doldurur:
 *   • OPEN     — hiç mal gelmemiş (açık taahhüt)
 *   • PARTIAL  — mal kabul fişi BAĞLI, kısmen karşılanmış (senkron bandı)
 *   • CLOSED (short-close) — "kalanı gelmeyecek", sebebiyle işaretli
 *
 * ⚠️ MAL KABUL FİŞLERİ SİPARİŞE BAĞLI AÇILIR (`purchaseOrderId`), sonradan
 * bağlanmaz: bağ fişin doğuşunda, siparişin advisory kilidi altında kurulur ve
 * `receivedQty` senkronu o yoldan tetiklenir. Bağsız açılan bir fişi sonradan
 * ilişkilendiren bir uç YOK — demo bunu yansıtmalı.
 *
 * ⚠️ TEDARİKÇİ ÇELİŞKİSİ 400 VERİR: fişin tedarikçisi ile siparişinki aynı
 * olmalı. Burada fişe tedarikçi HİÇ yazılmaz, siparişten miras alınır (servisin
 * kendi tercihi) — iki yerde aynı id'yi tekrarlamak, biri değişince sessiz bir
 * hata kaynağı olurdu.
 */
async function ensurePurchaseOrders(
  wh: { merkez: string; sube: string },
  items: Map<string, { id: string; name: string; unit: ItemUnit }>,
  colors: Map<string, string>,
  parties: Map<string, string>,
  userId: string,
): Promise<void> {
  const itemId = (code: string): string => items.get(code)!.id;

  // ── A) AÇIK — hiç mal gelmemiş ──────────────────────────────────────────
  const openToken = demoToken("purchase-order:open");
  const openBefore = await prisma.purchaseOrder.findUnique({
    where: { clientToken: openToken },
    select: { id: true },
  });
  const openRes = await purchaseOrderService.create(
    {
      supplierId: parties.get("DEMO-TED-001")!,
      currency: Currency.TRY,
      orderDate: daysFromNow(-6),
      expectedDate: daysFromNow(14),
      notes: "Demo — sezon takviyesi, henüz sevkiyat yapılmadı.",
      clientToken: openToken,
      lines: [
        { itemId: itemId("DEMO-KMS-BLACKOUT"), qty: 300, unitPrice: 148.5 },
        { itemId: itemId("DEMO-KMS-TUL"), qty: 250, unitPrice: 96 },
      ],
    },
    userId,
  );
  note(
    !openBefore,
    `alış siparişi (AÇIK): ${(openRes.data as { orderNo: string }).orderNo} — 2 kalem, hiç mal gelmedi`,
  );

  // ── B) KISMEN KARŞILANMIŞ — bağlı mal kabul fişiyle ─────────────────────
  const partialToken = demoToken("purchase-order:partial");
  const partialBefore = await prisma.purchaseOrder.findUnique({
    where: { clientToken: partialToken },
    select: { id: true },
  });
  const partialRes = await purchaseOrderService.create(
    {
      supplierId: parties.get("DEMO-TED-003")!,
      currency: Currency.TRY,
      orderDate: daysFromNow(-20),
      expectedDate: daysFromNow(-2),
      notes: "Demo — kısmi sevkiyat geldi, kalanı bekleniyor.",
      clientToken: partialToken,
      lines: [
        { itemId: itemId("DEMO-KMS-SUITICI"), qty: 300, unitPrice: 175 },
        { itemId: itemId("DEMO-KMS-JAKAR"), qty: 150, unitPrice: 210 },
      ],
    },
    userId,
  );
  const partialId = (partialRes.data as { id: string }).id;

  const partialReceiptToken = demoToken("goods-receipt:po-partial");
  const partialReceiptBefore = await prisma.goodsReceipt.findUnique({
    where: { clientToken: partialReceiptToken },
    select: { id: true },
  });
  const partialReceipt = await goodsReceiptService.create(
    {
      warehouseId: wh.merkez,
      // ⚠️ `supplierId` VERİLMEZ — siparişten miras alınır (tek kaynak).
      purchaseOrderId: partialId,
      deliveryNoteNo: "BRS-5590",
      currency: "TRY",
      notes: "Siparişin ilk partisi.",
      clientToken: partialReceiptToken,
      lines: [
        {
          itemId: itemId("DEMO-KMS-SUITICI"),
          colorId: colors.get("DEMO-GRI")!,
          initialQty: 120,
          width: 150,
          unitPrice: 175,
          clientToken: demoToken("goods-receipt-line:po-partial:0"),
        },
        {
          itemId: itemId("DEMO-KMS-JAKAR"),
          colorId: colors.get("DEMO-KREM")!,
          initialQty: 60,
          width: 280,
          unitPrice: 210,
          clientToken: demoToken("goods-receipt-line:po-partial:1"),
        },
      ],
    },
    userId,
  );
  note(
    !partialReceiptBefore,
    `mal kabul (siparişe bağlı): ${(partialReceipt.data as { receiptNo: string }).receiptNo}`,
  );
  const partialState = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: partialId },
    select: { orderNo: true, status: true },
  });
  note(
    !partialBefore,
    `alış siparişi (${partialState.status}): ${partialState.orderNo} — 180/450 m karşılandı`,
  );

  // ── C) SHORT-CLOSE — kısmen geldi, kalanı gelmeyecek ────────────────────
  const shortToken = demoToken("purchase-order:short-closed");
  const shortBefore = await prisma.purchaseOrder.findUnique({
    where: { clientToken: shortToken },
    select: { id: true },
  });
  const shortRes = await purchaseOrderService.create(
    {
      supplierId: parties.get("DEMO-TED-002")!,
      currency: Currency.TRY,
      orderDate: daysFromNow(-35),
      expectedDate: daysFromNow(-15),
      notes: "Demo — tedarikçi kalan metrajı üretemedi.",
      clientToken: shortToken,
      lines: [{ itemId: itemId("DEMO-KMS-KADIFE"), qty: 200, unitPrice: 610 }],
    },
    userId,
  );
  const shortId = (shortRes.data as { id: string }).id;

  const shortReceiptToken = demoToken("goods-receipt:po-short");
  await goodsReceiptService.create(
    {
      warehouseId: wh.sube,
      purchaseOrderId: shortId,
      deliveryNoteNo: "EGE-88410",
      currency: "TRY",
      notes: "Siparişin gelen tek partisi.",
      clientToken: shortReceiptToken,
      lines: [
        {
          itemId: itemId("DEMO-KMS-KADIFE"),
          colorId: colors.get("DEMO-BORDO")!,
          initialQty: 75,
          width: 140,
          unitPrice: 610,
          clientToken: demoToken("goods-receipt-line:po-short:0"),
        },
      ],
    },
    userId,
  );

  // `shortClose` ZATEN idempotent ("zaten kapatılmış" başarı döner) ama durum
  // yine de sorulur: `note()` sayacı ikinci koşumda "yeni" saymamalı.
  const shortState = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: shortId },
    select: { orderNo: true, shortClosedAt: true },
  });
  if (!shortState.shortClosedAt) {
    await purchaseOrderService.shortClose(
      shortId,
      "Tedarikçi kalan 125 m'yi üretemeyeceğini bildirdi — sipariş kapatıldı.",
      userId,
    );
  }
  note(
    !shortBefore,
    `alış siparişi (KAPATILDI — kalanı gelmeyecek): ${shortState.orderNo} — 75/200 m`,
  );
}

// -----------------------------------------------------------------------------
// 10) DÖNEM KAPANIŞI (mühür)
// -----------------------------------------------------------------------------

/**
 * İKİ MÜHÜR — bir cari + bir kasa, İKİ AY ÖNCESİNİN sonu için.
 *
 * Dönem kapanışı bu üründe iki ayrı yerde okunur: cari EKSTRESİNDE devir satırı
 * (`resolveStatementOpening`) ve KASA DEFTERİNDE devir notu
 * (`resolveCashBookOpening` → "X'e kadar mühürlü"). Mühür yoksa iki ekran da
 * düz toplam gösterir ve özelliğin varlığı görünmez.
 *
 * ⚠️ TARİH BİLİNÇLİ OLARAK ESKİ (`SEALED_PERIOD_END` = iki ay önce): demoyu
 * gezen kişinin BUGÜN yapacağı hiçbir işlem (fatura, tahsilat, masraf fişi,
 * çek tahsili) bu mühre çarpmaz. Mühür "kapalı dönem" mesajını göstermek için
 * değil, DEVİR mekanizmasını göstermek için var.
 *
 * ⚠️ CARİ TARAFINDA ÖNCE İÇERİK, SONRA MÜHÜR: mühürlenen dönemde hiç hareket
 * yoksa kapanış 0,00 / 0 hareket ölçer ve ekstredeki devir satırı "0,00" der —
 * yani mekanizma çalışır ama hiçbir şey anlatmaz. Bu yüzden mühürden ÖNCE,
 * dönemin içine tarihli bir devir yazılır. (Kasa tarafının içeriğini
 * `ensureCashMovements`'ın iki geçmiş-dönem satırı sağlar.)
 *
 * ⚠️ SIRA PAZARLIK DIŞI — bu fonksiyon `main()`'de EN SONA konur: mühür
 * yazıldıktan sonra o döneme tarihli her yazma 409 alır.
 */
async function ensurePeriodCloses(
  cariIds: Map<string, string>,
  acc: { kasaTry: string; bankaTry: string; bankaUsd: string },
  userId: string,
): Promise<void> {
  const periodEnd = SEALED_PERIOD_END;

  // ── Cari mühür — Otel Tedarik Grubu ────────────────────────────────────
  const cariId = cariIds.get("DEMO-MST-004");
  if (cariId) {
    // İçerik: mühürlenecek dönemin içine tarihli devir.
    const hasOpening = await prisma.cariTransaction.findFirst({
      where: { cariId, currency: Currency.TRY, sourceType: CariTxnSource.ADJUSTMENT, reversedBy: { is: null } },
      select: { id: true },
    });
    if (!hasOpening) {
      await cariService.setOpeningBalance(
        {
          cariId,
          currency: Currency.TRY,
          balance: 18750,
          description: "Sisteme geçiş devri (demo)",
          txnDate: daysBefore(periodEnd, 20),
        },
        userId,
      );
      note(true, "cari devir bakiyesi: Otel Tedarik Grubu +18.750 TL (mühürlenecek dönem içinde)");
    } else {
      note(false, "cari devir bakiyesi: Otel Tedarik Grubu");
    }

    const closed = await prisma.cariPeriodClose.findFirst({
      where: { cariId, currency: Currency.TRY, reopenedAt: null, periodEnd: { gte: periodEnd } },
      select: { id: true },
    });
    if (!closed) {
      const res = await periodCloseService.close(
        {
          cariId,
          currency: Currency.TRY,
          periodEnd,
          notes: "Demo — sisteme geçiş öncesi dönemin mühürlenmesi.",
        },
        userId,
      );
      note(
        true,
        `cari dönem kapanışı: Otel Tedarik Grubu · ${trDate(periodEnd)} · devir ${res.data.closingBalance.toString()} TL`,
      );
    } else {
      note(false, `cari dönem kapanışı: Otel Tedarik Grubu · ${trDate(periodEnd)}`);
    }
  }

  // ── Kasa mührü — Merkez Kasa (TL) ──────────────────────────────────────
  const cashClosed = await prisma.cashPeriodClose.findFirst({
    where: { cashBoxId: acc.kasaTry, reopenedAt: null, periodEnd: { gte: periodEnd } },
    select: { id: true },
  });
  if (!cashClosed) {
    const res = await cashPeriodCloseService.close(
      {
        cashBoxId: acc.kasaTry,
        periodEnd,
        notes: "Demo — kasa sayımı yapıldı, dönem mühürlendi.",
      },
      userId,
    );
    note(
      true,
      `kasa dönem kapanışı: Merkez Kasa · ${trDate(periodEnd)} · devir ${res.data.closingBalance.toString()} TL (${res.data.txnCount} hareket)`,
    );
  } else {
    note(false, `kasa dönem kapanışı: Merkez Kasa · ${trDate(periodEnd)}`);
  }
}

// -----------------------------------------------------------------------------
// 11) İADE + İADE FATURASI
// -----------------------------------------------------------------------------

/**
 * ÇOK KALEMLİ İADE (grup) + ondan kesilen SATIŞ İADE FATURASI.
 *
 * İade ekranı, iade irsaliyesi, "BU SEVKİYATTAN İADE EDİLENLER" kartı, iade
 * karnesi ve H8'in "iadeden fatura kes" düğmesi — hepsi tek bir `RollReturn`
 * kaydı olmadan boş. İKİ top iade edilir (tek değil), çünkü `returnGroupId`
 * yalnız çok kalemli iadede dolar ve "N defter satırı ↔ TEK belge" kuralı
 * ancak grupla görünür.
 *
 * ⚠️ AYNI ZAMANDA BRÜT KURALININ CANLI ÖRNEĞİDİR: iade topun `shipmentId`'sini
 * NULL'lar ama sevkiyatın irsaliyesi/listesi/detayı BRÜT kalır (kök CLAUDE.md,
 * 2026-08-02/03/05 notları). Demoda bu, "sevkiyat 3 top diyor ama depoda 1 top
 * geri geldi" olarak görünür ve tam da olması gereken budur.
 *
 * ⚠️ FATURANIN KAYNAK BAĞI GRUBUN LİDERİDİR (`returnGroupId ?? id`), üyenin
 * kendi id'si DEĞİL: üye id'siyle yazmak aynı gruba ikinci bir fatura açardı
 * (`assertSourceFree` seddi lider üzerinden çalışır).
 *
 * ⚠️ SEVK ONAYI AÇIKSA SESSİZ ATLANIR: iade `roll.status = SHIPPED` ister;
 * `shipping.confirmationEnabled` açık bir kurulumda sevkiyat PLANNED kalır ve
 * toplar hiç SHIPPED olmaz. Script ayarı DEĞİŞTİRMEZ (mevcut sözleşme) —
 * durumu uyarı olarak söyler ve devam eder.
 */
async function ensureReturns(
  shipments: { hizli: string | null; cuval: string | null },
  parties: Map<string, string>,
  userId: string,
): Promise<void> {
  const shipmentId = shipments.hizli;
  if (!shipmentId) {
    console.warn("   ⚠️ İade için kaynak sevkiyat yok — atlandı.");
    return;
  }

  // Bu sevkiyattan daha önce iade alınmış mı? (`RollReturn`'ün clientToken'ı
  // YOK — idempotentlik çıpası "iptal edilmemiş iade var mı" sorgusudur.)
  const existing = await prisma.rollReturn.findFirst({
    where: { fromShipmentId: shipmentId, cancelledAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, returnGroupId: true },
  });

  let groupSourceId: string;
  let returnedRollIds: string[];

  if (existing) {
    groupSourceId = existing.returnGroupId ?? existing.id;
    const members = await prisma.rollReturn.findMany({
      where: { OR: [{ returnGroupId: groupSourceId }, { id: groupSourceId }], cancelledAt: null },
      select: { rollId: true },
    });
    returnedRollIds = members.map((m) => m.rollId);
    note(false, "iade: sevkiyattan çok kalemli iade");
  } else {
    const rolls = await prisma.roll.findMany({
      where: { shipmentId, status: RollStatus.SHIPPED },
      orderBy: { createdAt: "asc" },
      take: 2,
      select: { id: true },
    });
    if (rolls.length < 2) {
      console.warn(
        "   ⚠️ İade için SHIPPED top bulunamadı (sevk onayı açık olabilir — sevkiyat PLANNED) — atlandı.",
      );
      return;
    }
    const res = await returnService.createReturn(
      {
        rollIds: rolls.map((r) => r.id),
        reasonText: "Müşteri renk tonunu beğenmedi — iki top geri gönderildi.",
        note: "Demo — çok kalemli iade (tek belge, iki defter satırı).",
      },
      userId,
    );
    const data = res.data as { ids: string[]; returnGroupId?: string };
    groupSourceId = data.returnGroupId ?? data.ids[0]!;
    returnedRollIds = rolls.map((r) => r.id);
    note(true, `iade: ${rolls.length} top geri alındı (grup belgesi)`);
  }

  // ── SATIŞ İADE FATURASI ────────────────────────────────────────────────
  const invoiceToken = demoToken("invoice:sales-return");
  const invoiceBefore = await prisma.invoice.findUnique({
    where: { clientToken: invoiceToken },
    select: { id: true },
  });

  const returnedRolls = await prisma.roll.findMany({
    where: { id: { in: returnedRollIds } },
    select: {
      currentQty: true,
      item: { select: { id: true, code: true, name: true, unit: true } },
      color: { select: { name: true } },
    },
  });
  if (returnedRolls.length === 0) {
    console.warn("   ⚠️ İade faturası için satır üretilemedi — atlandı.");
    return;
  }

  const priceByItemCode = new Map(ITEMS.map((i) => [i.code, i.salesPrice]));
  const grouped = new Map<
    string,
    { itemId: string; code: string; description: string; qty: Prisma.Decimal; unit: string }
  >();
  for (const r of returnedRolls) {
    const key = `${r.item.id}|${r.color?.name ?? ""}`;
    const cur = grouped.get(key);
    if (cur) {
      cur.qty = cur.qty.plus(r.currentQty);
      continue;
    }
    grouped.set(key, {
      itemId: r.item.id,
      code: r.item.code,
      description: r.color?.name ? `${r.item.name} · ${r.color.name}` : r.item.name,
      qty: new Prisma.Decimal(r.currentQty),
      unit: unitLabel(r.item.unit),
    });
  }

  // ⚠️ ZATEN VARSA YENİDEN GÖNDERME — satırlar İADE EDİLEN TOPLARDAN türetilir
  // ve o küme koşumlar arasında değişir (iade/storno akışları topları oynatır).
  // Aynı token + farklı gövde artık 409 alıyor (gövde kapısı, 2026-09-01);
  // belge zaten doğru oluştu, yeniden hesaplanmış payload'la göndermenin işi yok.
  // (Aynı düzeltme `ensureInvoices`in iki satış faturası noktasında da var.)
  if (invoiceBefore) return;

  const draft = await invoiceService.createDraft(
    {
      type: InvoiceType.SALES_RETURN,
      customerId: parties.get("DEMO-MST-001")!,
      currency: Currency.TRY,
      returnGroupId: groupSourceId,
      notes: "Demo — iade grubundan kesilen satış iade faturası.",
      clientToken: invoiceToken,
      lines: [...grouped.values()].map((g) => ({
        itemId: g.itemId,
        description: g.description,
        qty: g.qty.toString(),
        unit: g.unit,
        unitPrice: priceByItemCode.get(g.code) ?? 100,
        vatRate: 20,
      })),
    },
    userId,
  );

  const state = await prisma.invoice.findUniqueOrThrow({
    where: { id: draft.data.id },
    select: { status: true, docNo: true },
  });
  if (state.status === InvoiceStatus.DRAFT) {
    await invoiceService.confirm(draft.data.id, userId);
  }
  note(!invoiceBefore, `satış iade faturası (ONAYLI): ${state.docNo}`);
}

// -----------------------------------------------------------------------------
// RAPOR
// -----------------------------------------------------------------------------

/**
 * MÜKERRER TARAMASI — "0 yeni" sayacının GÖREMEDİĞİ hatayı yakalar.
 *
 * ⚠️ BU FONKSİYON NEDEN VAR (ölçülmüş bir sahte-yeşil vakası, 2026-08-14):
 * Idempotentlik bekçisi "ikinci koşum 0 yeni demeli" idi. Bu bekçi, bir yazma
 * yolundan `clientToken` çıpası düşürülünce KIRMIZI VERMEZ — ölçüldü: çek
 * yolundan `clientToken` kaldırıldı, ikinci koşum 4 mükerrer çek üretti ve
 * özet yine **"0 yeni"** dedi. Sebep, `note()`'un "yeni mi" kararını yazma
 * sonucundan değil ÖNDEN yapılan bir token sorgusundan alması: token DB'de hâlâ
 * duruyordu (ilk koşumdan), yalnız YENİ kayıt onu taşımıyordu. Yani sayaç
 * "zaten vardı" derken kayıt sessizce ikizleniyordu.
 *
 * ⚠️ ANAHTARLAR TÜRETİLİR, LİSTELENMEZ. "Şu dört seri numarası" gibi bir liste
 * tutmak, yeni bir örnek eklendiği gün sessizce eksik tarayan bir bekçi
 * bırakırdı (bu depoda "ölü muaf listesi" olarak adlandırılan sınıf). Bunun
 * yerine her aile için ZATEN BENZERSİZ OLMASI GEREKEN bir iş anahtarı
 * gruplanır: aynı çek seri numarası iki kez, aynı tedarikçiden aynı irsaliye
 * numarası iki kez, aynı gün aynı açıklamayla aynı masraf iki kez — hepsi
 * gerçek birer veri hatasıdır, yalnız seed hatası değil.
 *
 * ⚠️ KAPSAM DEMO VERİSİYLE SINIRLI (demo cari / demo tedarikçi / demo kasa):
 * fabrika verisi taşıyan paylaşımlı bir geliştirme DB'sinde de koşuyoruz ve
 * fabrikanın kendi kayıtlarına hüküm vermek bu script'in işi değil.
 *
 * ⚠️ SEVKİYAT/ÇUVAL KAPSAM DIŞI ve bu bir eksiklik olarak YAZILIDIR: `Shipment`
 * oluşturma sözleşmesinde serbest metin alanı yok (`dispatchNote` ayrı bir uçla
 * yazılıyor), yani türetilebilir bir iş anahtarı yok. Plaka/nakliyeci gerçek
 * hayatta tekrar eder — onu anahtar yapmak yanlış alarm üretirdi.
 */
async function findDuplicateDemoRecords(): Promise<string[]> {
  const demoCodes = PARTIES.map((p) => p.code);
  const demoCari = { customer: { code: { in: demoCodes } } };
  const problems: string[] = [];
  const push = (label: string, key: string, n: number): void => {
    if (n > 1) problems.push(`${label} → "${key}" ${n} kez`);
  };

  for (const r of await prisma.cheque.groupBy({
    by: ["serialNo"],
    where: { cari: demoCari, serialNo: { not: null } },
    _count: { _all: true },
  })) {
    push("çek (seri no)", r.serialNo ?? "—", r._count._all);
  }

  for (const r of await prisma.goodsReceipt.groupBy({
    by: ["deliveryNoteNo"],
    where: { supplier: { code: { in: demoCodes } }, deliveryNoteNo: { not: null } },
    _count: { _all: true },
  })) {
    push("mal kabul (irsaliye no)", r.deliveryNoteNo ?? "—", r._count._all);
  }

  for (const r of await prisma.purchaseOrder.groupBy({
    by: ["notes"],
    where: { supplier: { code: { in: demoCodes } }, notes: { startsWith: "Demo" } },
    _count: { _all: true },
  })) {
    push("alış siparişi (not)", r.notes ?? "—", r._count._all);
  }

  for (const r of await prisma.invoice.groupBy({
    by: ["notes"],
    where: { cari: demoCari, notes: { startsWith: "Demo" } },
    _count: { _all: true },
  })) {
    push("fatura (not)", r.notes ?? "—", r._count._all);
  }

  for (const r of await prisma.payment.groupBy({
    by: ["notes"],
    where: { cari: demoCari, notes: { startsWith: "Demo" } },
    _count: { _all: true },
  })) {
    push("tahsilat/ödeme (not)", r.notes ?? "—", r._count._all);
  }

  // ⚠️ KAPSAM YALNIZ KASA: virman TEK uçtan İKİ satır doğurur (çıkan kasada,
  // giren bankada) ve ikisi AYNI açıklamayı taşır. Banka bacağı da kapsama
  // alınsaydı meşru virman "mükerrer" diye kırmızı verirdi.
  for (const r of await prisma.cashTransaction.groupBy({
    by: ["description", "txnDate"],
    where: { cashBox: { code: "DEMO-KASA-TRY" }, description: { not: null } },
    _count: { _all: true },
  })) {
    push("kasa hareketi (açıklama + tarih)", r.description ?? "—", r._count._all);
  }

  // ⚠️ `cariId` DE ANAHTARA GİRER: iki farklı cariye aynı metinle devir
  // girmek meşrudur ("Sisteme geçiş devri (demo)") — yalnız açıklamaya
  // bakan bir tarama onları ikiz sanardı.
  for (const r of await prisma.cariTransaction.groupBy({
    by: ["cariId", "description"],
    where: { cari: demoCari, description: { not: null } },
    _count: { _all: true },
  })) {
    push("cari defter satırı (cari + açıklama)", r.description ?? "—", r._count._all);
  }

  for (const r of await prisma.rollReturn.groupBy({
    by: ["note"],
    where: { customer: { code: { in: demoCodes } }, note: { startsWith: "Demo" }, cancelledAt: null },
    _count: { _all: true },
  })) {
    // İade GRUBU birden çok satır doğurur (top başına bir defter satırı) ve
    // hepsi aynı notu taşır — bu MEŞRU. Bu yüzden eşik grup büyüklüğüdür.
    if (r._count._all > 2) problems.push(`iade (not) → "${r.note}" ${r._count._all} kez (grup 2 top olmalı)`);
  }

  return problems;
}

/**
 * ⚠️ SAYAÇLAR DEMO KAPSAMINA DARALTILIR, `count()` ÇIPLAK ÇAĞRILMAZ.
 *
 * Bu script fabrika verisi taşıyan bir DB'de de koşabiliyor (geliştirme
 * ortamındaki `adnansahin_ticaret` tam olarak öyle). Çıplak sayaç, fabrikanın
 * 15.000 topunu "demo verisi" diye raporlar ve ikinci koşumun "0 yeni"
 * kontrolünü gözle doğrulanamaz yapardı. Tek istisna `Depo (toplam)`: çok
 * depoluluk VERİDEN türetildiği için (`useMultiWarehouse`) burada anlamlı olan
 * sistemdeki toplam depo sayısıdır ve başlıkta öyle yazar.
 *
 * ⚠️ MAL KABUL SAYACI TEDARİKÇİDEN süzülür, irsaliye numarasından DEĞİL: alış
 * siparişine bağlı fişlerin (`ensurePurchaseOrders`) irsaliye numaraları
 * `RECEIPTS` tablosunda yok — eski süzgeç onları sessizce saymıyordu.
 */
async function printSummary(dbName: string): Promise<void> {
  const demoCustomerCodes = PARTIES.map((p) => p.code);
  const demoCari = { customer: { code: { in: demoCustomerCodes } } };
  const [
    warehouses,
    colors,
    items,
    customers,
    receipts,
    rolls,
    shipments,
    invoices,
    payments,
    cashTxns,
    cari,
    cheques,
    purchaseOrders,
    periodCloses,
    cashPeriodCloses,
    returns,
  ] = await Promise.all([
    prisma.warehouse.count(),
    prisma.color.count({ where: { code: { startsWith: "DEMO-" } } }),
    prisma.item.count({ where: { code: { startsWith: "DEMO-" } } }),
    prisma.customer.count({ where: { code: { in: demoCustomerCodes } } }),
    prisma.goodsReceipt.count({ where: { supplier: { code: { in: demoCustomerCodes } } } }),
    prisma.roll.count({ where: { item: { code: { startsWith: "DEMO-" } } } }),
    prisma.shipment.count({ where: { customer: { code: { in: demoCustomerCodes } } } }),
    prisma.invoice.count({ where: { cari: demoCari } }),
    prisma.payment.count({ where: { cari: demoCari } }),
    prisma.cashTransaction.count({ where: { cashBox: { code: "DEMO-KASA-TRY" } } }),
    prisma.cariAccount.count({ where: { customer: { code: { in: demoCustomerCodes } } } }),
    prisma.cheque.count({ where: { cari: demoCari } }),
    prisma.purchaseOrder.count({ where: { supplier: { code: { in: demoCustomerCodes } } } }),
    prisma.cariPeriodClose.count({ where: { cari: demoCari, reopenedAt: null } }),
    prisma.cashPeriodClose.count({ where: { cashBox: { code: "DEMO-KASA-TRY" }, reopenedAt: null } }),
    prisma.rollReturn.count({ where: { customer: { code: { in: demoCustomerCodes } }, cancelledAt: null } }),
  ]);

  console.log("\n─────────────────────────────────────────────");
  console.log(`Veritabanı        : ${dbName}`);
  console.log(`Bu koşumda        : ${tally.created} yeni, ${tally.existing} mevcut`);
  console.log("─────────────────────────────────────────────");
  console.log(`Depo (toplam)     : ${warehouses}`);
  console.log(`Demo renk         : ${colors}`);
  console.log(`Demo kumaş        : ${items}`);
  console.log(`Demo cari kart    : ${customers}   (cari hesap: ${cari})`);
  console.log(`Alış siparişi     : ${purchaseOrders}`);
  console.log(`Mal kabul fişi    : ${receipts}`);
  console.log(`Demo kumaş topu   : ${rolls}`);
  console.log(`Sevkiyat          : ${shipments}`);
  console.log(`İade (top)        : ${returns}`);
  console.log(`Fatura            : ${invoices}`);
  console.log(`Çek / senet       : ${cheques}`);
  console.log(`Tahsilat/ödeme    : ${payments}`);
  console.log(`Kasa hareketi     : ${cashTxns}`);
  console.log(`Dönem kapanışı    : ${periodCloses} cari · ${cashPeriodCloses} kasa`);
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
  // ⚠️ Cari hesaplar fatura/tahsilat yollarından ÖNCE açılır: o yollar hesabı
  // LAZY açar ve vade/limit alanlarını NULL bırakır (bkz. `ensureCariAccounts`).
  const cariIds = await ensureCariAccounts(parties, user.id);

  console.log("▸ Kasa / banka");
  const accounts = await ensureCashAndBank();
  await ensureOpeningBalances(accounts, user.id);
  // ⚠️ Kasa hareketleri açılıştan SONRA (bakiye eksiye düşmesin) ve dönem
  // kapanışından ÖNCE (iki satır mühürlenecek döneme tarihli).
  await ensureCashMovements(accounts, user.id);

  console.log("▸ Alış siparişi / mal kabul");
  const receipts = await ensureGoodsReceipts(wh, items, colors, parties, user.id);
  await ensurePurchaseOrders(wh, items, colors, parties, user.id);

  console.log("▸ Sevkiyat");
  const shipments = await ensureShipments(receipts, parties, user.id);

  console.log("▸ Fatura");
  await ensureInvoices(shipments, receipts, parties, user.id);

  console.log("▸ Tahsilat / devir");
  await ensurePayment(parties, accounts.kasaTry, user.id);
  await ensureCariOpening(parties, user.id);
  await ensureCariOpeningChain(cariIds, user.id);

  console.log("▸ Çek / senet");
  await ensureCheques(cariIds, accounts, user.id);

  console.log("▸ İade / iade faturası");
  // ⚠️ SEVKİYAT ve FATURA'dan SONRA: iade topun `shipmentId`'sini NULL'lar ve
  // satış faturasının satırları o bağdan üretiliyor. Ters sırada faturaya iki
  // top eksik yazılırdı (idempotent tekrarda değil, İLK koşumda).
  await ensureReturns(shipments, parties, user.id);

  console.log("▸ Dönem kapanışı (mühür)");
  // ⚠️ EN SON: mühür yazıldıktan sonra o döneme tarihli her yazma 409 alır.
  await ensurePeriodCloses(cariIds, accounts, user.id);

  await printSummary(dbName);

  // ── İDEMPOTENTLİK BEKÇİSİ ────────────────────────────────────────────────
  // "0 yeni" sayacı tek başına YETMEZ (bkz. `findDuplicateDemoRecords`
  // başlığındaki ölçülmüş sahte-yeşil vakası) → çıkış kodu buradan da düşer.
  const duplicates = await findDuplicateDemoRecords();
  if (duplicates.length > 0) {
    console.error("❌ MÜKERRER DEMO KAYDI — seed idempotent DEĞİL:");
    for (const d of duplicates) console.error(`   • ${d}`);
    console.error(
      "\n   Olası sebep: bir yazma yolundan `clientToken` (demoToken) çıpası düşmüş.\n" +
        "   Sayaç bunu göremez; çıpayı geri koyup mükerrer kayıtları elle temizleyin.\n",
    );
    process.exitCode = 1;
  } else {
    console.log("✓ Mükerrer demo kaydı yok (idempotentlik doğrulandı).\n");
  }

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
