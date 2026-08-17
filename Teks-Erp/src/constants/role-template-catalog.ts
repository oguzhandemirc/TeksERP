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
  "mobile:kk1-yari-mamul":
    "Ekran değil, KK1-içi yetenek (2026-08-17): dışarıdan alınan yarı mamül kabulü. Renkli mal kabulü açar; yanlışlıkla kullanılırsa top ham stoğa 'boyalı' düşer → varsayılan operatör paketine GİRMEZ, panelden seçili kişiye verilir.",
};
