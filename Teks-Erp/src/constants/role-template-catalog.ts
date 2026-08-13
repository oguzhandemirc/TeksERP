// =============================================================================
// TeksERP — ROL (YETKİ ŞABLONU) KATALOĞU (TEK KAYNAK)
// =============================================================================
// `PermissionTemplate` satırları admin panelindeki "hazır yetki paketi"dir:
// yeni bir kullanıcı açılırken 40+ kutuyu tek tek işaretlemek yerine tek tıkla
// bir iş fonksiyonunun yetkileri verilir.
//
// NEDEN KODDA:
//   Şablonlar 2026-08-06'ya kadar YALNIZ `prisma/seed.ts`'te yaşıyordu ve seed
//   yalnız ilk kurulumda koşuyor. Sonuç ölçüldü: canlı fabrikada "Admin (Tam
//   Yetki)" şablonu 55 izin taşıyordu, katalog ise 67 — yani o şablonla açılan
//   yeni yönetici 12 yetkiyi ALMIYORDU ve bunu hiçbir yerde göremiyordu.
//   İzin kataloğu bu sorunu 2026-08-01'de boot-time uzlaştırmayla çözmüştü;
//   burada AYNI kalıp uygulanır: **kodu deploy etmek = rolleri getirmek.**
//
// SÖZLEŞME — YALNIZ EKLE, ASLA SİLME/EZME (izin kataloğuyla birebir aynı):
//   • Kodu DB'de olmayan şablon OLUŞTURULUR.
//   • Var olan şablonun adı/açıklaması EZİLMEZ (fabrika panelden değiştirmiş
//     olabilir).
//   • Var olan şablona katalogdaki EKSİK izinler EKLENİR; fabrikanın elle
//     eklediği fazlalar KORUNUR. Fabrika bir izni kalıcı olarak çıkarmak
//     istiyorsa sistem şablonunu pasife alıp kendi şablonunu kurar — çünkü
//     "eksik olanı ekle" ile "fabrikanın çıkardığını geri getirme" aynı anda
//     sağlanamaz ve ikisinden GÜVENLİ olan, paketin eksik kalmamasıdır.
//   • Bu yüzden sistem şablonu SİLİNMEZ, pasifleştirilir (`isActive=false`).
//     Sert silme, bir sonraki restart'ta diriliş demekti.
//
// KİMLİK `code`'DUR, AD DEĞİL: fabrika şablonu yeniden adlandırabilir; ada göre
// eşleştiren bir uzlaştırma o şablonu "yok" sayıp ikizini doğururdu.
//
// KATALOG NE İÇERMEZ: kullanıcı→izin ATAMALARI. Şablon bir kısayoldur, runtime'da
// User'a JOIN'lenmez — uygulandığı an izinler kullanıcıya KOPYALANIR. Kural
// değişmedi: *katalog koda, atama panele.*
// =============================================================================

import { PERMISSION_CATALOG } from "./permission-catalog";

export type RoleTemplateEntry = {
  /** Kalıcı kimlik. Fabrika adı değiştirse de bu sabit kalır — DB'de `@unique`. */
  readonly code: string;
  /** İLK oluşturmada yazılan ad. Sonradan panelden değiştirilebilir, ezilmez. */
  readonly name: string;
  /** İLK oluşturmada yazılan açıklama. Sonradan ezilmez. */
  readonly description: string;
  /**
   * `list` → aşağıdaki `codes` dizisi.
   * `all`  → izin kataloğunun TAMAMI; her boot'ta eksikler eklenir. Yalnız
   *          "Admin (Tam Yetki)" için — o şablonun tanımı bir liste değil bir
   *          KURALDIR ("her şey"), bu yüzden katalogla eşitlenmesi doğrudur.
   */
  readonly mode: "list" | "all";
  readonly codes: readonly string[];
};

/** Mevcut (2026-08-06 öncesi seed'lenmiş) şablonların adı → kod eşlemesi.
 *  Uzlaştırma, kodsuz eski satırları BİR KEZ bu tabloyla eşleyip kodlarını yazar;
 *  eşleşmezse yeni satır doğurur (ve eski satır fabrikanın kendi şablonu sayılır). */
export const LEGACY_TEMPLATE_NAME_TO_CODE: Readonly<Record<string, string>> = {
  "Admin (Tam Yetki)": "ADMIN_FULL",
  "Mobil — Üretim Operatörü": "MOBILE_PRODUCTION_OPERATOR",
  "Mobil — KK1 Operatörü": "MOBILE_KK1",
  "Mobil — KK2/Kurşun Operatörü": "MOBILE_KK2_KURSUN",
  "Mobil — Tambur Operatörü": "MOBILE_TAMBUR",
  "Mobil — Depo Operatörü": "MOBILE_DEPO",
  "Mobil — Fason Sevk Operatörü": "MOBILE_FASON_SEVK",
  "Mobil — Fason Kabul Operatörü": "MOBILE_FASON_KABUL",
  "Mobil — Kartela Sevk Operatörü": "MOBILE_KARTELA_SEVK",
  "Mobil — Kartela Kabul Operatörü": "MOBILE_KARTELA_KABUL",
  "Mobil — Paketleme Operatörü": "MOBILE_PAKETLEME",
  "Mobil — Sevkiyat Operatörü": "MOBILE_SEVKIYAT",
  "Mobil — İade Operatörü": "MOBILE_IADE",
  "Mobil — Hızlı İş Emri": "MOBILE_HIZLI_IS_EMRI",
  "Mobil — Kurşun Dağıtım": "MOBILE_KURSUN_DAGITIM",
  "Mobil — Tüm Ekranlar": "MOBILE_ALL",
};

// ─────────────────────────────────────────────────────────────────────────────
// MASAÜSTÜ (BÜRO) ROLLERİ
//
// 2026-08-06 denetiminde ölçüldü: canlıda 16 şablonun 15'i tek-ekran MOBİL,
// biri "tam yetki" idi — yani büro personeli için hazır paket YOKTU ve üç
// masaüstü kullanıcısı (Eda · Enes · Samet) BİREBİR AYNI 40 izne sahipti.
// Aşağıdaki roller görev ayrılığı (SoD) gözetilerek kurulmuştur; en kritik üç
// ayrım kodda zaten yapılmış ama kimse kullanmıyordu:
//   • `shipping:write` (sevk eden) ≠ `shipping:invoice` (faturalayan)
//   • `shipping:write` ≠ `shipping:undo-dispatch` (resmi çıkış belgesini iptal)
//   • günlük iş ≠ `roll:manual-adjust` (envanteri elle düzeltme)
// Bu üç "tehlikeli" yetki bilinçli olarak yalnız Muhasebe/Süpervizör rollerinde.
// ─────────────────────────────────────────────────────────────────────────────

const WEB_ROLES: readonly RoleTemplateEntry[] = [
  {
    code: "WEB_PRODUCTION_PLANNING",
    name: "Üretim Planlama",
    description:
      "İş emri aç/yönet, rota-istasyon-ürün tanımla, kurşun dağıt, üretim raporları",
    mode: "list",
    codes: [
      "workorder:read",
      "workorder:write",
      "workorder:distribute",
      "roll:read",
      "roll:history",
      "station:read",
      "station:write",
      "item:read",
      "item:write",
      "property:read",
      "quality:read",
      "subcontractor:read",
      "subcontractor:write",
      "order:read",
      "customer:read",
      "label:read",
      "label:print",
      "report:production",
      "report:inventory",
      "report:subcontract",
    ],
  },
  {
    code: "WEB_WAREHOUSE_SHIPPING",
    name: "Depo & Sevkiyat",
    description:
      "Çuval aç/okut/tart, sevkiyat kur ve sevk et, iade al, etiket bas, kendi yazıcı-kantar ayarı",
    mode: "list",
    codes: [
      "shipping:read",
      "shipping:write",
      "return:read",
      "return:write",
      "kartela:read",
      "kartela:write",
      "roll:read",
      "roll:write",
      "label:read",
      "label:print",
      "order:read",
      "customer:read",
      "item:read",
      "workorder:read",
      "report:inventory",
      // Yazıcısını/kantarını kendisi kuran personel — sunucuya hiçbir şey yazmaz,
      // etkisi tek bilgisayarla sınırlıdır (bkz. permission-catalog.ts gerekçesi).
      "settings:workstation",
      // Ticaret paketi (2026-08-13): depoyu GÖRÜR ve depolar arası TAŞIR.
      // ⚠️ Fabrikada görünür fark YOK — tek depo varken transfer karosu ve depo
      // seçicileri zaten çizilmiyor; izin var ama yüzey yok.
      "warehouse:read",
      "warehouse:transfer",
      // ⚠️ `goods-receipt:*` BİLEREK YOK: Mal Kabul ekranı yalnız izinle kapılı
      // (tek depolu ticaret kurulumu da kullanacağı için multiWarehouse şartı
      // konamaz) → şablona akarsa fabrikada karo BELİRİR. Alım-satım kurulumunda
      // admin bu izinleri elle atar.
    ],
  },
  {
    code: "WEB_ACCOUNTING",
    name: "Muhasebe",
    description:
      "Sevkiyatları salt-okunur görüntüle, fatura izini işaretle, dönem raporları — sevk/iptal YETKİSİ YOK",
    mode: "list",
    codes: [
      "shipping:read",
      "shipping:invoice",
      "return:read",
      "order:read",
      "customer:read",
      "item:read",
      "report:sales",
      "report:customer",
      "report:inventory",
      "report:subcontract",
      // ── Ön muhasebe (2026-08-13) ────────────────────────────────────────
      // ⚠️ GÖREV AYRILIĞI korunuyor: bu rol taslak hazırlar ve ONAYLAR
      // (`finance:invoice`) — çünkü muhasebeci zaten `shipping:invoice` ile
      // dış fatura izini işaretliyor, aynı kişi. TAHSİLAT (`finance:payment`)
      // BİLİNÇLİ OLARAK YOK: parayı sayan ile faturayı kesen ayrı olabilmeli;
      // gerekiyorsa panelden ayrıca verilir.
      // ⚠️ Bu izinler ÜRETİCİ FABRİKAYA da gider ama `finance.enabled` bayrağı
      // varsayılan KAPALI olduğu için orada tek satır bile çizilmez —
      // görünürlüğün gerçek kapısı bayraktır, izin değil.
      "finance:read",
      "finance:write",
      "finance:invoice",
      "report:finance",
    ],
  },
  {
    // Ticaret paketi (2026-08-13) — GÖREV AYRILIĞI gereği ayrı rol: parayı
    // sayan kişi ile faturayı kesen kişi aynı olmak ZORUNDA değil. Küçük
    // firmada ikisi de aynı kullanıcıya verilebilir; ayrımı yazılım dayatmaz,
    // yalnız MÜMKÜN kılar. `finance:read` olmadan tahsilat ekranı tutar
    // gösteremezdi (o izin tutar görme kapısıdır).
    code: "WEB_CASHIER",
    name: "Kasa / Tahsilat",
    description:
      "Tahsilat ve ödeme kaydı, kasa/banka bakiyesi — fatura onaylama YETKİSİ YOK",
    mode: "list",
    codes: [
      "finance:read",
      "finance:payment",
      "customer:read",
      "subcontractor:read",
      "report:finance",
    ],
  },
  {
    code: "WEB_SALES",
    name: "Satış / Sipariş",
    description:
      "Sipariş ve müşteri yönetimi, müşteriye özel isim/renk eşlemesi, satış raporları",
    mode: "list",
    codes: [
      "order:read",
      "order:write",
      "customer:read",
      "customer:write",
      "customer-alias:read",
      "customer-alias:write",
      "item:read",
      "property:read",
      "quality:read",
      "shipping:read",
      "label:edit",
      "report:sales",
      "report:customer",
    ],
  },
  {
    code: "WEB_QUALITY",
    name: "Kalite",
    description: "Kalite ve özellik tanımları, top izlenebilirliği, kalite raporları",
    mode: "list",
    codes: [
      "quality:read",
      "quality:write",
      "property:read",
      "property:write",
      "roll:read",
      "roll:history",
      "workorder:read",
      "station:read",
      "item:read",
      "report:quality",
      "report:production",
    ],
  },
  {
    code: "WEB_DOCUMENT_DESIGN",
    name: "Belge & Etiket Tasarımı",
    description:
      "Belge şablonları, refakat kartı, serbest belgeler ve etiket stüdyosu — sistem ayarlarına DOKUNMAZ",
    mode: "list",
    codes: [
      "document-template:read",
      "document-template:write",
      "label-template:read",
      "label-template:write",
      "label:read",
      "label:print",
      // Etiketler kartı `station:read` ile süzülüyor (bilinen hiza sorunu) —
      // onsuz tasarımcı kendi ekranını göremez.
      "station:read",
      "item:read",
      "customer:read",
      "quality:read",
    ],
  },
  {
    code: "WEB_PRODUCTION_SUPERVISOR",
    name: "Üretim Süpervizörü",
    description:
      "Envanter düzeltme (takılı topu kurtar, metraj/renk düzelt) + sevk geri alma (storno) — günlük iş rolleriyle BİLİNÇLİ olarak ayrıdır",
    mode: "list",
    codes: [
      "roll:read",
      "roll:write",
      "roll:history",
      "roll:manual-adjust",
      "shipping:read",
      "shipping:undo-dispatch",
      "workorder:read",
      "workorder:write",
      "station:read",
      "item:read",
      "report:production",
      "report:inventory",
    ],
  },
  {
    // ── TİCARET KURULUMU: TEK ŞABLON (2026-08-14) ─────────────────────────
    // Persona denetimi ölçtü: "birkaç depo + mal kabul + depodan satış + sevk,
    // üretim ve mobil YOK" kullanıcısını kurmak için ÜÇ şablon (Depo&Sevkiyat +
    // Muhasebe + Satış) uygulayıp üstüne elle 4 izin vermek gerekiyordu; iki
    // izin (roll:read, order:read) atlanırsa Envanter ve Siparişler ekranları
    // HİÇ görünmüyor ve kullanıcı sebebini hiçbir yerde göremiyordu.
    //
    // ⚠️ Bu şablon FABRİKAYA DA GİDER ama kimseye ATANMAZ (kural: katalog koda,
    // atama panele). Görünürlük riski yok: mal kabul/depo/muhasebe yüzeylerinin
    // hepsi ya multiWarehouse ya finance.enabled rejimine kapılı ve fabrika
    // ikisinde de kapalı taraftadır.
    //
    // ⚠️ goods-receipt:* bilinçli olarak BAŞKA hiçbir şablonda yok
    // (test_single_warehouse_parity §5c). Burada olması o kuralın İSTİSNASIDIR
    // ve bekçinin muaf listesine gerekçesiyle yazıldı — ticaret kurulumunun
    // tanımı gereği mal kabul onun ana işidir.
    code: "WEB_TRADE",
    name: "Ticaret (Depo + Satış + Muhasebe)",
    description:
      "Alım-satım kurulumu: mal kabul, depo/transfer, stok, sipariş, sevkiyat, iade ve ön muhasebe — ÜRETİM YOK",
    mode: "list",
    codes: [
      // Depo & stok
      "warehouse:read",
      "warehouse:write",
      "warehouse:transfer",
      "goods-receipt:read",
      "goods-receipt:write",
      "roll:read",
      "roll:write",
      // Satış & sevkiyat
      "order:read",
      "order:write",
      "customer:read",
      "customer:write",
      "customer-alias:read",
      "customer-alias:write",
      "shipping:read",
      "shipping:write",
      "shipping:invoice",
      "return:read",
      "return:write",
      // Katalog — ticaret firması kendi kumaş/renk kartlarını açar
      "item:read",
      "item:write",
      "property:read",
      "quality:read",
      // Etiket (opsiyonel kullanım; basmak zorunlu değil)
      "label:read",
      "label:print",
      "label-template:read",
      // Ön muhasebe — SoD gereği finance:payment DAHİL (tek kişilik ekipte aynı
      // kişi; ayrı çalışan varsa panelden ayrılır)
      "finance:read",
      "finance:write",
      "finance:invoice",
      "finance:payment",
      // Raporlar
      "report:sales",
      "report:inventory",
      "report:customer",
      "report:finance",
    ],
  },
  {
    code: "WEB_SYSTEM_ADMIN",
    name: "Sistem Yöneticisi",
    description:
      "Kullanıcı ve yetki yönetimi, sistem ayarları, yedek/log arşivi, denetim raporu",
    mode: "list",
    codes: [
      "admin:users",
      "admin:settings",
      "settings:workstation",
      "report:audit",
      // Depo TANIMI (yeni depo açma, varsayılan depo seçimi) sistem yapılandırmasıdır,
      // günlük depo işi değil. Depo & Sevkiyat rolüne KONULMADI: fabrikada tek depo
      // varken depo yüzeyleri gizli ve öyle kalmalı — ikinci depoyu açmak bilinçli
      // bir kurulum kararıdır (`warehouse:transfer` ise günlük iş, o rolde).
      "warehouse:write",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MOBİL ROLLER — 2026-08-06 öncesi seed'in birebir devamı + iki yeni ekran.
// ─────────────────────────────────────────────────────────────────────────────

const MOBILE_ROLES: readonly RoleTemplateEntry[] = [
  {
    // `createUser`'ın yeni operatöre otomatik verdiği paket (opt-out'lu);
    // şablon, admin'in sonradan tek tıkla uygulaması için.
    code: "MOBILE_PRODUCTION_OPERATOR",
    name: "Mobil — Üretim Operatörü",
    description: "KK1 + Kurşun/KK2 + Tambur (varsayılan istasyon rotasyonu)",
    mode: "list",
    codes: ["mobile:kk1", "mobile:kk2-kursun", "mobile:tambur"],
  },
  { code: "MOBILE_KK1", name: "Mobil — KK1 Operatörü", description: "Ham kumaş kabul ekranı", mode: "list", codes: ["mobile:kk1"] },
  { code: "MOBILE_KK2_KURSUN", name: "Mobil — KK2/Kurşun Operatörü", description: "Kurşun + QC2 ekranı", mode: "list", codes: ["mobile:kk2-kursun"] },
  { code: "MOBILE_TAMBUR", name: "Mobil — Tambur Operatörü", description: "Tambur karar / kesim ekranı", mode: "list", codes: ["mobile:tambur"] },
  { code: "MOBILE_DEPO", name: "Mobil — Depo Operatörü", description: "Depo ekranı (salt-okunur)", mode: "list", codes: ["mobile:depo"] },
  { code: "MOBILE_FASON_SEVK", name: "Mobil — Fason Sevk Operatörü", description: "Fason firmaya sevk ekranı", mode: "list", codes: ["mobile:fason-sevk"] },
  { code: "MOBILE_FASON_KABUL", name: "Mobil — Fason Kabul Operatörü", description: "Fason firmadan mal kabul ekranı", mode: "list", codes: ["mobile:fason-kabul"] },
  { code: "MOBILE_KARTELA_SEVK", name: "Mobil — Kartela Sevk Operatörü", description: "Kartela firmaya sevk ekranı", mode: "list", codes: ["mobile:kartela-sevk"] },
  { code: "MOBILE_KARTELA_KABUL", name: "Mobil — Kartela Kabul Operatörü", description: "Kartela firmadan mal kabul ekranı", mode: "list", codes: ["mobile:kartela-kabul"] },
  { code: "MOBILE_PAKETLEME", name: "Mobil — Paketleme Operatörü", description: "Tartı & Paketleme ekranı", mode: "list", codes: ["mobile:tarti-paket"] },
  { code: "MOBILE_SEVKIYAT", name: "Mobil — Sevkiyat Operatörü", description: "Sevkiyat yönetimi ekranı", mode: "list", codes: ["mobile:sevkiyat"] },
  { code: "MOBILE_IADE", name: "Mobil — İade Operatörü", description: "İade girişi ekranı", mode: "list", codes: ["mobile:iade"] },
  {
    // Mobilde masaüstüyle aynı iş emri yetkileri: stok topu okut → WO başlat,
    // eski WO'ları listele/görüntüle/çıktı al/düzenle.
    code: "MOBILE_HIZLI_IS_EMRI",
    name: "Mobil — Hızlı İş Emri",
    description: "Stok topu okut → iş emri başlat + iş emri yönetimi",
    mode: "list",
    codes: [
      "mobile:hizli-is-emri",
      "workorder:read",
      "workorder:write",
      "roll:read",
      "item:read",
      "property:read",
      "station:read",
      "subcontractor:read",
      "order:read",
      "customer:read",
      "label:print",
    ],
  },
  {
    // Web ikizi `workorder:distribute` BİLİNÇLİ olarak yok — mobil şablon saha
    // kullanıcısına masaüstü yetkisi taşımasın; planlamacıya panelden verilir.
    code: "MOBILE_KURSUN_DAGITIM",
    name: "Mobil — Kurşun Dağıtım",
    description: "İş emrini fiziksel kurşun makinesine ata + son adımsa işi bitir",
    mode: "list",
    codes: ["mobile:kursun-dagitim", "workorder:read", "roll:read", "station:read"],
  },
  {
    // 2026-08-05'te eklenen ekran — hiçbir şablonda yoktu.
    code: "MOBILE_SIPARIS",
    name: "Mobil — Sipariş",
    description: "Telefondan sipariş listesi + yeni müşteri siparişi açma (satış/planlama)",
    mode: "list",
    codes: ["mobile:siparis", "customer:read", "item:read", "property:read", "quality:read"],
  },
  {
    // 2026-08-05'te eklenen ekran — hiçbir şablonda yoktu.
    code: "MOBILE_KUMAS",
    name: "Mobil — Kumaş Ekle",
    description: "Telefondan yeni kumaş/ürün tanımı (kod · tip · izinli renk ve özellik)",
    mode: "list",
    codes: ["mobile:kumas", "item:read", "property:read", "quality:read"],
  },
  { code: "MOBILE_ALL", name: "Mobil — Tüm Ekranlar", description: "Tüm mobil ekranlar (wildcard)", mode: "list", codes: ["mobile:*"] },
];

export const ROLE_TEMPLATE_CATALOG: readonly RoleTemplateEntry[] = [
  {
    code: "ADMIN_FULL",
    name: "Admin (Tam Yetki)",
    description: "Tüm web + mobil + admin yetkileri (katalogla otomatik eşitlenir)",
    mode: "all",
    codes: [],
  },
  ...WEB_ROLES,
  ...MOBILE_ROLES,
];

/**
 * Bir şablonun İÇERMESİ GEREKEN izin kodları. `mode:"all"` katalogun tamamına
 * genişler — bu yüzden "Admin (Tam Yetki)" bir daha bayatlayamaz.
 */
export function resolveRoleTemplateCodes(entry: RoleTemplateEntry): readonly string[] {
  return entry.mode === "all" ? PERMISSION_CATALOG.map((p) => p.code) : entry.codes;
}

/**
 * Dar (tek iş fonksiyonu) rollerde BİLİNÇLİ olarak yer almayan izinler.
 * Bekçi bu listeyi muaf sayar; gerekçesiz muaf eklenemez.
 *
 * ⚠️ Muaf listesi BAYATLIĞA karşı da denetlenir: burada olup katalogda olmayan
 * bir kod, gerçek bir boşluğu sessizce kapsam dışında tutar.
 */
export const ROLE_COVERAGE_EXEMPT: Readonly<Record<string, string>> = {
  "admin:*":
    "Global admin wildcard'ı — dar bir role konulsaydı o rolü sessizce süper kullanıcı yapardı. Yalnız 'Admin (Tam Yetki)' taşır.",
  "mobile:tambur-duzelt":
    "Ekran değil, Tambur-içi yetenek: envanter zincirinde DELİK açar (elle top yaratma). Varsayılan operatör paketine GİRMEZ, panelden SEÇİLİ kişiye verilir (root CLAUDE.md, 2026-08-04).",
  "mobile:kk1-desen":
    "Ekran değil, KK1-içi yetenek: inline yeni desen açma. Yalnız seçili ham giriş operatörlerine verilir (permission-catalog.ts).",
  // 2026-08-14: goods-receipt:* muafları KALDIRILDI — artık dar bir rol
  // (WEB_TRADE) onları taşıyor. Muaf bırakmak "ölü muaf" olurdu ve bekçinin
  // iki yönlü denetimi zaten kırmızı verdi. Fabrika görünürlüğü şablonla
  // değil REJİMLE korunuyor: şablon kimseye atanmaz ve mal kabul karosu
  // goods-receipt izni olmayan kullanıcıda zaten çizilmez.
};
