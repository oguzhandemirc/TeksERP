// =============================================================================
// RAPOR KATALOĞU — BACKEND AYNASI
// =============================================================================
// TEK KAYNAK BACKEND'DEDİR: `Teks-Erp/src/constants/report-catalog.ts`. Electron
// backend'i import EDEMEZ (ayrı derleme birimi) — `lib/module-flags.ts` ile aynı
// gerekçe ve aynı kalıp. Ayna MEKANİK bir bekçiyle birebirlenir
// (`Teks-Erp/scripts/test_rapor_katalogu.ts`): backend dosyası METİN olarak okunur
// ve `REPORT_CATALOG` gövdesi karakter karakter karşılaştırılır.
//
// ⚠️ AYNA NEDEN VAR: karo süzmesi, route kapısı ve komut paleti "bu anahtar açık mı"
// sorusunu ÇİZİM anında sorar; bir ağ hatası yüzünden "kapalı" ya da "bilinmiyor"
// çizmek, kapalı bir raporu göstermekten de kötüdür. Değişkenlik taşıyan tek şey
// `reports.closedKeys` DEĞERİDİR ve o zaten uçtan gelir.
//
// ⚠️ AYNAYA "AKILLI" BİR ŞEY EKLEME: gövde birebir karşılaştırılır. Yeni bir rapor
// doğduğunda sıra: backend sabiti → bu ayna → bekçi yeşil.
// =============================================================================

export type ReportSinif = "basit" | "gelismis";
export type ReportTarih = "aralik-iso" | "aralik-gun" | "tek-gun" | "kesit" | "ileri-pencere" | "yok";
export type ReportYuzey = "yaprak" | "yaprak-yabanci-uc" | "diyalog";

export interface ReportCatalogEntry {
  /** `"<kategori>/<rapor>"` — adres kalıbıyla aynı; kapı, karo ve route bu anahtara bağlanır. */
  key: string;
  baslik: string;
  /** Tek cümle: bu rapor NEYİ cevaplar. Ekrandaki başlık/açıklamadan türer, uydurulmaz. */
  soru: string;
  sinif: ReportSinif;
  /** `report:*` izin kodu (route dosyasındaki guard'dan ölçüldü). */
  izin: string;
  /** SCREEN_CATALOG `reports/<kategori>` satırının `modul`u — söz dağarcığı ORTAK. */
  modul: string;
  tarih: ReportTarih;
  /**
   * Panelin açılışta geriye bakacağı GÜN sayısı — bugün hem yaprakta hem katalogda
   * yazılı olan sayının TEK evi (d5 R4 ölçümü: 10 yaprakta "çift yazım").
   * `yok`/`kesit`/`ileri-pencere`/`tek-gun` sözleşmelerinde `null`.
   * ⚠️ `finance/statement` de `null`: diyalog 3 AY geriye bakıyor (`setMonth(-3)`), gün
   * sayısı DEĞİL — buraya 90 yazmak ölçülmemiş bir sayı uydurmak olurdu (3 ay ≠ 90 gün).
   */
  varsayilanGun: number | null;
  /** Electron adres yolu. */
  panelYolu: string;
  /** Backend yolu; `yaprak-yabanci-uc` ve ölçülemeyen yüzeylerde `null`. Parti izleme İKİ uçludur. */
  uc: string | string[] | null;
  yuzey: ReportYuzey;
  /**
   * R1'de `requireReportOpen("<key>")` ÇAĞIRACAK yer(ler) — beyan R0'da, ölçüm R1'de.
   *
   * ⚠️ ÇOĞUL, çünkü bir rapor İKİ uçtan servis edilebiliyor (`production/batch-trace`:
   * arama + izleme). Tek taşıyıcı beyan etmek, ikinci ucu KAPISIZ bırakır ve kapı yine de
   * "taşıyıcı var" diye yeşil kalırdı — `uc` zaten çoğul, taşıyıcı da öyle olmalı.
   * ⚠️ `null` YALNIZ yabancı-uç yapraklarında (uç başkasının sözleşmesi; panel karosu
   * R2'de süzer). Bekçi bu sayının 2'de sabit kalmasını ölçer — üçüncüsü kırmızıdır.
   */
  kapiTasiyici: Array<{ dosya: string; yol: string }> | null;
}

export const REPORT_CATALOG: readonly ReportCatalogEntry[] = [
  // ── ÜRETİM ────────────────────────────────────────────────────────────────
  { key: "production/wip", baslik: "Nerede Takıldı (WIP)", soru: "Yarı mamul şu an hangi adımda bekliyor ve ne kadar süredir orada?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/production/wip", uc: "/api/reports/production/wip", kapiTasiyici: [{ dosya: "src/routes/reports/production.routes.ts", yol: "/wip" }], yuzey: "yaprak" },
  { key: "production/batch-trace", baslik: "Parti İzleme", soru: "Bu parti hangi adımlardan geçti ve şu an nerede?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/production/batch-trace",
    uc: ["/api/reports/production/batch-search", "/api/reports/production/batch-trace/:batchId"], kapiTasiyici: [{ dosya: "src/routes/reports/production.routes.ts", yol: "/batch-search" }, { dosya: "src/routes/reports/production.routes.ts", yol: "/batch-trace/:batchId" }], yuzey: "yaprak" },
  { key: "production/traveler-trace", baslik: "Top İzleme", soru: "Bu topun refakat kartı hangi istasyonlarda okutuldu?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/production/traveler-trace", uc: "/api/reports/production/traveler-trace", kapiTasiyici: [{ dosya: "src/routes/reports/production.routes.ts", yol: "/traveler-trace" }], yuzey: "yaprak" },
  { key: "production/operator-performance", baslik: "Operatör İş Hacmi", soru: "Hangi operatör bu dönemde kaç iş kaydı üretti?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/production/operator-performance", uc: "/api/reports/production/operator-performance", kapiTasiyici: [{ dosya: "src/routes/reports/production.routes.ts", yol: "/operator-performance" }], yuzey: "yaprak" },

  // ── SİPARİŞ & SEVKİYAT ────────────────────────────────────────────────────
  { key: "sales/order-cancellation", baslik: "Sipariş İptal Karnesi", soru: "Bu dönemde kaç sipariş satırı iptal edildi ve hangi sebeple?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 90, tarih: "aralik-iso",
    panelYolu: "reports/sales/order-cancellation", uc: "/api/reports/sales/order-cancellation", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/order-cancellation" }], yuzey: "yaprak" },
  { key: "sales/order-leadtime", baslik: "Sipariş → Teslim Süresi", soru: "Sipariş girişinden sevke kadar kaç gün geçiyor?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 180, tarih: "aralik-iso",
    panelYolu: "reports/sales/order-leadtime", uc: "/api/reports/sales/order-leadtime", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/order-leadtime" }], yuzey: "yaprak" },
  { key: "sales/demand-analysis", baslik: "Talep Analizi", soru: "Hangi ürün ve renkler bu dönemde ne kadar talep gördü, önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 90, tarih: "aralik-iso",
    panelYolu: "reports/sales/demand-analysis", uc: "/api/reports/sales/demand-analysis", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/demand-analysis" }], yuzey: "yaprak" },
  { key: "sales/order-intake", baslik: "Sipariş Karnesi", soru: "Bu dönemde ne kadar sipariş girdi ve önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/order-intake", uc: "/api/reports/sales/order-intake", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/order-intake" }], yuzey: "yaprak" },
  { key: "sales/open-order-coverage", baslik: "Açık Sipariş Karşılanma", soru: "Açık sipariş satırlarının ne kadarı bugün stoktan karşılanabiliyor?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/sales/open-order-coverage", uc: "/api/reports/sales/open-order-coverage", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/open-order-coverage" }], yuzey: "yaprak" },
  { key: "sales/shipment-scorecard", baslik: "Sevk & Termin Karnesi", soru: "Sevkler termine uydu mu, önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/shipment-scorecard", uc: "/api/reports/sales/shipment-scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/shipment-scorecard" }], yuzey: "yaprak" },
  { key: "sales/destination-mix", baslik: "Yurtiçi / Yurtdışı Satış", soru: "Satışların ne kadarı yurtiçi, ne kadarı yurtdışı; ihracatta kime, nereye, ne kadar ve hangi fiyatla gidiyor?",
    sinif: "gelismis", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/destination-mix", uc: "/api/reports/sales/destination-mix", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/destination-mix" }], yuzey: "yaprak" },
  { key: "sales/return-scorecard", baslik: "İade Karnesi", soru: "Bu dönemde ne kadar mal iade edildi ve önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/return-scorecard", uc: "/api/reports/sales/return-scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/return-scorecard" }], yuzey: "yaprak" },

  // ── KALİTE ────────────────────────────────────────────────────────────────
  { key: "quality/scorecard", baslik: "Kalite Karnesi", soru: "Kalite kademeleri bu dönemde nasıl dağıldı, önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:quality", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/quality/scorecard", uc: "/api/reports/quality/scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/quality.routes.ts", yol: "/scorecard" }], yuzey: "yaprak" },
  { key: "quality/scrap-scorecard", baslik: "Fire Karnesi", soru: "Bu dönemde ne kadar fire verildi ve oranı önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:quality", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/quality/scrap-scorecard", uc: "/api/reports/quality/scrap-scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/quality.routes.ts", yol: "/scrap-scorecard" }], yuzey: "yaprak" },
  { key: "quality/plan-deviation-scorecard", baslik: "Plan-Sapma Karnesi", soru: "Üretim planından ne kadar sapıldı ve sapma önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:quality", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/quality/plan-deviation-scorecard", uc: "/api/reports/quality/plan-deviation-scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/quality.routes.ts", yol: "/plan-deviation-scorecard" }], yuzey: "yaprak" },

  // ── STOK & DEPO ───────────────────────────────────────────────────────────
  { key: "inventory/scorecard", baslik: "Stok & Ölü Stok", soru: "Depoda bugün ne kadar mal var ve ne kadarı ölü stok?",
    sinif: "basit", izin: "report:inventory", modul: "cekirdek:stok-giris", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/inventory/scorecard", uc: "/api/reports/inventory/scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/inventory.routes.ts", yol: "/scorecard" }], yuzey: "yaprak" },

  // ── DOKUMA ────────────────────────────────────────────────────────────────
  { key: "dokuma/randiman", baslik: "Randıman", soru: "Tezgahlar bu dönemde ne kadar verimli çalıştı?",
    sinif: "gelismis", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 7, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/randiman", uc: "/api/reports/dokuma/randiman", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/randiman" }], yuzey: "yaprak" },
  { key: "dokuma/durus-pareto", baslik: "Duruş Pareto", soru: "Tezgahları en çok hangi sebepler durdurdu?",
    sinif: "gelismis", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 7, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/durus-pareto", uc: "/api/reports/dokuma/durus-pareto", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/durus-pareto" }], yuzey: "yaprak" },
  { key: "dokuma/vardiya-karnesi", baslik: "Vardiya Karnesi", soru: "Bu vardiyada tezgahlar ne üretti, ne kadar durdu?",
    sinif: "gelismis", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: null, tarih: "tek-gun",
    panelYolu: "reports/dokuma/vardiya-karnesi", uc: "/api/reports/dokuma/vardiya-karnesi", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/vardiya-karnesi" }], yuzey: "yaprak" },
  { key: "dokuma/karne", baslik: "Karne Listesi ve Mühür", soru: "Hangi vardiya karneleri mühürlendi, hangileri hâlâ açık?",
    sinif: "gelismis", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 7, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/karne", uc: null, kapiTasiyici: null, yuzey: "yaprak-yabanci-uc" },
  { key: "dokuma/zincir", baslik: "Üretim Zinciri", soru: "Hangi sipariş kalemi zincirin neresinde ve nerede takıldı?",
    sinif: "basit", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/dokuma/zincir", uc: "/api/reports/dokuma/zincir", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/zincir" }], yuzey: "yaprak" },

  // ── ÖN MUHASEBE ───────────────────────────────────────────────────────────
  { key: "finance/aging", baslik: "Cari Yaşlandırma", soru: "Cari bakiyeler bu tarihte hangi vade kovalarında duruyor?",
    sinif: "gelismis", izin: "report:finance", modul: "financeEnabled", varsayilanGun: null, tarih: "kesit",
    panelYolu: "reports/finance/aging", uc: "/api/reports/finance/aging", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/aging" }], yuzey: "yaprak" },
  { key: "finance/cash-book", baslik: "Kasa & Banka Defteri", soru: "Bu dönemde kasaya ve bankaya ne girdi, ne çıktı?",
    sinif: "gelismis", izin: "report:finance", modul: "financeEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/finance/cash-book", uc: "/api/reports/finance/cash-book", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/cash-book" }], yuzey: "yaprak" },
  { key: "finance/cheque-due", baslik: "Çek Vade Takvimi", soru: "Önümüzdeki günlerde hangi çekler vadesi geliyor?",
    sinif: "basit", izin: "report:finance", modul: "financeEnabled", varsayilanGun: null, tarih: "ileri-pencere",
    panelYolu: "reports/finance/cheque-due", uc: null, kapiTasiyici: null, yuzey: "yaprak-yabanci-uc" },
  { key: "finance/vat-summary", baslik: "KDV Dönem Özeti", soru: "Bu dönemde ne kadar KDV hesaplandı ve indirildi?",
    sinif: "basit", izin: "report:finance", modul: "financeEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/finance/vat-summary", uc: "/api/reports/finance/vat-summary", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/vat-summary" }], yuzey: "yaprak" },
  { key: "finance/fx-diff", baslik: "Kur Farkı Raporu", soru: "Döviz bakiyelerinde bu dönemde ne kadar kur farkı oluştu?",
    sinif: "gelismis", izin: "report:finance", modul: "financeEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/finance/fx-diff", uc: "/api/reports/finance/fx-diff", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/fx-diff" }], yuzey: "yaprak" },
  { key: "finance/statement", baslik: "Cari Ekstre", soru: "Bu carinin bu dönemdeki hareketleri ve bakiyesi ne?",
    sinif: "gelismis", izin: "report:finance", modul: "financeEnabled", varsayilanGun: null, tarih: "aralik-iso",
    panelYolu: "", uc: "/api/reports/finance/statement", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/statement" }], yuzey: "diyalog" },

  // ── FASON ─────────────────────────────────────────────────────────────────
  { key: "subcontract/scorecard", baslik: "Fason Karnesi", soru: "Fasoncular bu dönemde ne kadar iş aldı, ne kadarı zamanında döndü?",
    sinif: "gelismis", izin: "report:subcontract", modul: "planlanan:fason", varsayilanGun: 90, tarih: "aralik-iso",
    panelYolu: "reports/subcontract/scorecard", uc: "/api/reports/subcontract/scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/subcontract.routes.ts", yol: "/scorecard" }], yuzey: "yaprak" },

  // ── MÜŞTERİ ───────────────────────────────────────────────────────────────
  { key: "customer/scorecard", baslik: "Müşteri Karnesi", soru: "Hangi müşteri bu dönemde ne kadar aldı, önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:customer", modul: "cekirdek:siparis-musteri", varsayilanGun: 90, tarih: "aralik-iso",
    panelYolu: "reports/customer/scorecard", uc: "/api/reports/customer/scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/customer.routes.ts", yol: "/scorecard" }], yuzey: "yaprak" },
  { key: "customer/order-profile", baslik: "Müşteri Sipariş Profili", soru: "Bu müşteri genelde hangi ürün ve renkleri sipariş ediyor?",
    sinif: "basit", izin: "report:customer", modul: "cekirdek:siparis-musteri", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/customer/order-profile", uc: "/api/reports/customer/order-profile", kapiTasiyici: [{ dosya: "src/routes/reports/customer.routes.ts", yol: "/order-profile" }], yuzey: "yaprak" },

  // ── DENETİM ───────────────────────────────────────────────────────────────
  { key: "audit/system-log-summary", baslik: "Denetim Kaydı Özeti", soru: "Bu dönemde sistemde hangi işlemler kaç kez yapıldı?",
    sinif: "basit", izin: "report:audit", modul: "cekirdek:sistem-kimlik-belge", varsayilanGun: 7, tarih: "aralik-iso",
    panelYolu: "reports/audit/system-log-summary", uc: "/api/reports/audit/system-log-summary", kapiTasiyici: [{ dosya: "src/routes/reports/audit.routes.ts", yol: "/system-log-summary" }], yuzey: "yaprak" },
  { key: "audit/user-activity", baslik: "Kullanıcı Aktivitesi", soru: "Hangi kullanıcı bu dönemde hangi işlemleri yaptı?",
    sinif: "basit", izin: "report:audit", modul: "cekirdek:sistem-kimlik-belge", varsayilanGun: 7, tarih: "aralik-iso",
    panelYolu: "reports/audit/user-activity", uc: "/api/reports/audit/user-activity", kapiTasiyici: [{ dosya: "src/routes/reports/audit.routes.ts", yol: "/user-activity" }], yuzey: "yaprak" },
];

/** Katalogdan TÜRETİLİR — derleyici bilinmeyen anahtarı reddeder (K4). */
export type ReportKey = (typeof REPORT_CATALOG)[number]["key"];

/** Anahtar → satır. Bilinmeyen anahtar `undefined` (çağıran fail-closed davranır). */
export const REPORT_BY_KEY = new Map(REPORT_CATALOG.map((r) => [r.key, r]));

/**
 * `varsayilanGun` GEREKTİRMEYEN tarih sözleşmeleri — KAPALI küme, bekçi iki yönlü ölçer
 * (bu kümede `null` ZORUNLU · dışında `null` YASAK). Kümeyi genişletmek bilinçli bir
 * karardır: yeni bir değer eklemek, o sözleşmeli her yaprağın varsayılanını KODA geri
 * kaçırır ve d5'in kapattığı "çift yazım" borcunu yeniden açar.
 */
export const GUNSUZ_TARIH_SOZLESMELERI: readonly ReportTarih[] = [
  "yok", // hiç tarih parametresi yok
  "kesit", // tek an fotoğrafı (`asOf`), pencere değil
  "tek-gun", // tek fabrika günü (`factoryDay`), pencere değil
  "ileri-pencere", // İLERİ bakar; varsayılan pencereyi BACKEND uygular, panel sayı yazmaz
] as const;

/**
 * Pencere sözleşmeli olduğu HALDE `varsayilanGun` taşımayan satırlar ve NEDENİ.
 * Muafiyet liste değil ÖLÇÜMdür: bekçi depo kökünden `kanit` dosyasında `desen`i arar ve bulamazsa
 * muafiyeti DÜŞÜRÜR (kırmızı) — "bir zamanlar öyleydi" bir gerekçe değildir.
 */
export const VARSAYILAN_GUN_MUAFLARI: ReadonlyArray<{
  key: string;
  neden: string;
  kanit: string;
  desen: string;
}> = [
  {
    key: "finance/statement",
    neden: "Diyalog AY aritmetiğiyle geriye bakıyor (3 ay); 3 ay sabit bir gün sayısı DEĞİL (28–31 gün) — buraya 90 yazmak ölçülmemiş bir sayı uydurmak olur.",
    kanit: "Electron/src/pages/Reports/Finance/CariStatementDialog.tsx",
    desen: "setMonth(",
  },
] as const;
