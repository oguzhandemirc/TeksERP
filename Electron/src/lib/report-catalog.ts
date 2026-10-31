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

// ── RAPORLAR v2 (R0-TANIM) ────────────────────────────────────────────────────
// v1 = bugünkü 36 rapor; v2 = 14 temel rapor (plan §5). Bir v1 satırının akıbeti
// `yeniHali`dir — ya bir v2'ye birleşti, ya muhasebe uzman aracı kaldı, ya da rapor
// menüsünden çıkıp kendi ekranına taşındı. Katalogdan SİLİNMEZ: eski adres geçişte açık.
export type ReportNesil = "v1" | "v2";
export const RAPOR_KATEGORILERI_V2 = ["satis-sevkiyat", "uretim", "kalite", "dokuma", "para", "muhasebe-araclari"] as const;
export type ReportKategoriV2 = (typeof RAPOR_KATEGORILERI_V2)[number];
export const RAPOR_PERSONALARI = ["patron", "satis", "sevkiyat", "planlama", "uretim", "kalite", "depo", "dokuma", "muhasebe"] as const;
export type ReportPersona = (typeof RAPOR_PERSONALARI)[number];
export const RAPOR_VARYANT_BOYUTLARI = [
  "musteri", "urun", "renk", "yon", "istasyon", "operator", "vardiya", "tezgah",
  "levent", "cozguKarti", "fasoncu", "kaynak", "sebep", "depo", "cari", "paraBirimi", "makine",
] as const;
export type ReportVaryantBoyutu = (typeof RAPOR_VARYANT_BOYUTLARI)[number];
/**
 * ⚠️ "Uzman araç" bir `sinif` DEĞİL, bir akıbettir (`{tur:"uzman"}`): `sinif` bugünkü hub'ın
 * "Hızlı bakış / Derin analiz" bölümlemesini taşır; orada değişirse bayrak kapalıyken panel değişirdi.
 */
export type ReportYeniHali =
  | { tur: "birlesti"; anahtar: string }
  | { tur: "uzman" }
  | { tur: "tasindi"; panelYolu: string; aciklama: string };

interface ReportCatalogBase {
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
  nesil: ReportNesil;
  /** Rapor Merkezi kategorisi; v1 satırı menüden çıkıyorsa `null` ("Eski raporlar"da kalır). */
  kategoriV2: ReportKategoriV2 | null;
  persona: readonly ReportPersona[];
  varyantBoyutlari: readonly ReportVaryantBoyutu[];
}

export interface ReportCatalogEntryV1 extends ReportCatalogBase {
  nesil: "v1";
  yeniHali: ReportYeniHali;
}

export interface ReportCatalogEntryV2 extends ReportCatalogBase {
  nesil: "v2";
  /** `false` iken uç yok: satır hiçbir yüzeyde çizilmez, taşıyıcı ölçülmez (R0-RAP dilimi `true` yapar). */
  hazir: boolean;
  /** Hiçbir v1 satırının yeni hâli OLMAYAN yeni rapor (`test_rapor_katalogu §8c/§8c2` ölçer). */
  yeniRapor?: true;
}

export type ReportCatalogEntry = ReportCatalogEntryV1 | ReportCatalogEntryV2;

export const REPORT_CATALOG: readonly ReportCatalogEntry[] = [
  // ── ÜRETİM ────────────────────────────────────────────────────────────────
  { key: "production/wip", baslik: "Nerede Takıldı (WIP)", soru: "Yarı mamul şu an hangi adımda bekliyor ve ne kadar süredir orada?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/production/wip", uc: "/api/reports/production/wip", kapiTasiyici: [{ dosya: "src/routes/reports/production.routes.ts", yol: "/wip" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "production/uretim-akisi" } },
  { key: "production/batch-trace", baslik: "Parti İzleme", soru: "Bu parti hangi adımlardan geçti ve şu an nerede?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/production/batch-trace",
    uc: ["/api/reports/production/batch-search", "/api/reports/production/batch-trace/:batchId"], kapiTasiyici: [{ dosya: "src/routes/reports/production.routes.ts", yol: "/batch-search" }, { dosya: "src/routes/reports/production.routes.ts", yol: "/batch-trace/:batchId" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "tasindi", panelYolu: "operations", aciklama: "Operasyon ekranındaki iz sürme; Partiler aramasından (Ctrl+K) da açılır" } },
  { key: "production/traveler-trace", baslik: "Top İzleme", soru: "Bu topun refakat kartı hangi istasyonlarda okutuldu?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/production/traveler-trace", uc: "/api/reports/production/traveler-trace", kapiTasiyici: [{ dosya: "src/routes/reports/production.routes.ts", yol: "/traveler-trace" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "tasindi", panelYolu: "operations", aciklama: "Operasyon ekranındaki iz sürme; top kartından da açılır" } },
  { key: "production/operator-performance", baslik: "Operatör İş Hacmi", soru: "Hangi operatör bu dönemde kaç iş kaydı üretti?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/production/operator-performance", uc: "/api/reports/production/operator-performance", kapiTasiyici: [{ dosya: "src/routes/reports/production.routes.ts", yol: "/operator-performance" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "production/uretim-akisi" } },

  // ── SİPARİŞ & SEVKİYAT ────────────────────────────────────────────────────
  { key: "sales/order-cancellation", baslik: "Sipariş İptal Karnesi", soru: "Bu dönemde kaç sipariş satırı iptal edildi ve hangi sebeple?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 90, tarih: "aralik-iso",
    panelYolu: "reports/sales/order-cancellation", uc: "/api/reports/sales/order-cancellation", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/order-cancellation" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/vazgecilen-is" } },
  { key: "sales/order-leadtime", baslik: "Sipariş → Teslim Süresi", soru: "Sipariş girişinden sevke kadar kaç gün geçiyor?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 180, tarih: "aralik-iso",
    panelYolu: "reports/sales/order-leadtime", uc: "/api/reports/sales/order-leadtime", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/order-leadtime" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/termin" } },
  { key: "sales/demand-analysis", baslik: "Talep Analizi", soru: "Hangi ürün ve renkler bu dönemde ne kadar talep gördü, önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 90, tarih: "aralik-iso",
    panelYolu: "reports/sales/demand-analysis", uc: "/api/reports/sales/demand-analysis", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/demand-analysis" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/siparis-talep" } },
  { key: "sales/order-intake", baslik: "Sipariş Karnesi", soru: "Bu dönemde ne kadar sipariş girdi ve önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/order-intake", uc: "/api/reports/sales/order-intake", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/order-intake" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/siparis-talep" } },
  { key: "sales/open-order-coverage", baslik: "Açık Sipariş Karşılanma", soru: "Açık sipariş satırlarının ne kadarı bugün stoktan karşılanabiliyor?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/sales/open-order-coverage", uc: "/api/reports/sales/open-order-coverage", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/open-order-coverage" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/acik-siparisler" } },
  { key: "sales/shipment-scorecard", baslik: "Sevk & Termin Karnesi", soru: "Sevkler termine uydu mu, önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/shipment-scorecard", uc: "/api/reports/sales/shipment-scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/shipment-scorecard" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/termin" } },
  { key: "sales/destination-mix", baslik: "Yurtiçi / Yurtdışı Satış", soru: "Satışların ne kadarı yurtiçi, ne kadarı yurtdışı; ihracatta kime, nereye, ne kadar ve hangi fiyatla gidiyor?",
    sinif: "gelismis", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/destination-mix", uc: "/api/reports/sales/destination-mix", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/destination-mix" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/sevkiyat" } },
  { key: "sales/return-scorecard", baslik: "İade Karnesi", soru: "Bu dönemde ne kadar mal iade edildi ve önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/return-scorecard", uc: "/api/reports/sales/return-scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/sales.routes.ts", yol: "/return-scorecard" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/vazgecilen-is" } },

  // ── KALİTE ────────────────────────────────────────────────────────────────
  { key: "quality/scorecard", baslik: "Kalite Karnesi", soru: "Kalite kademeleri bu dönemde nasıl dağıldı, önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:quality", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/quality/scorecard", uc: "/api/reports/quality/scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/quality.routes.ts", yol: "/scorecard" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "quality/kalite" } },
  { key: "quality/scrap-scorecard", baslik: "Fire Karnesi", soru: "Bu dönemde ne kadar fire verildi ve oranı önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:quality", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/quality/scrap-scorecard", uc: "/api/reports/quality/scrap-scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/quality.routes.ts", yol: "/scrap-scorecard" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "quality/kayip" } },
  { key: "quality/plan-deviation-scorecard", baslik: "Plan-Sapma Karnesi", soru: "Üretim planından ne kadar sapıldı ve sapma önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:quality", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/quality/plan-deviation-scorecard", uc: "/api/reports/quality/plan-deviation-scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/quality.routes.ts", yol: "/plan-deviation-scorecard" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "quality/kalite" } },

  // ── STOK & DEPO ───────────────────────────────────────────────────────────
  { key: "inventory/scorecard", baslik: "Stok & Ölü Stok", soru: "Depoda bugün ne kadar mal var ve ne kadarı ölü stok?",
    sinif: "basit", izin: "report:inventory", modul: "cekirdek:stok-giris", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/inventory/scorecard", uc: "/api/reports/inventory/scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/inventory.routes.ts", yol: "/scorecard" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "inventory/depo" } },

  // ── DOKUMA ────────────────────────────────────────────────────────────────
  { key: "dokuma/randiman", baslik: "Randıman", soru: "Tezgahlar bu dönemde ne kadar verimli çalıştı?",
    sinif: "gelismis", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 7, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/randiman", uc: "/api/reports/dokuma/randiman", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/randiman" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "dokuma/tezgah-randimani" } },
  { key: "dokuma/durus-pareto", baslik: "Duruş Pareto", soru: "Tezgahları en çok hangi sebepler durdurdu?",
    sinif: "gelismis", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 7, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/durus-pareto", uc: "/api/reports/dokuma/durus-pareto", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/durus-pareto" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "dokuma/duruslar" } },
  { key: "dokuma/vardiya-karnesi", baslik: "Vardiya Karnesi", soru: "Bu vardiyada tezgahlar ne üretti, ne kadar durdu?",
    sinif: "gelismis", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: null, tarih: "tek-gun",
    panelYolu: "reports/dokuma/vardiya-karnesi", uc: "/api/reports/dokuma/vardiya-karnesi", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/vardiya-karnesi" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "dokuma/tezgah-randimani" } },
  { key: "dokuma/karne", baslik: "Karne Listesi ve Mühür", soru: "Hangi vardiya karneleri mühürlendi, hangileri hâlâ açık?",
    sinif: "gelismis", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 7, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/karne", uc: null, kapiTasiyici: null, yuzey: "yaprak-yabanci-uc",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "tasindi", panelYolu: "operations/weaving-floor", aciklama: "Dokuma salonu ekranındaki karne listesi ve mühür" } },
  { key: "dokuma/zincir", baslik: "Üretim Zinciri", soru: "Hangi sipariş kalemi zincirin neresinde ve nerede takıldı?",
    sinif: "basit", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/dokuma/zincir", uc: "/api/reports/dokuma/zincir", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/zincir" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/acik-siparisler" } },
  { key: "dokuma/mudahale", baslik: "Müdahale ve Çözüm Süresi", soru: "Tezgah alarmları ne kadar sürede üstlenildi, ne kadar sürede çözüldü?",
    sinif: "gelismis", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 7, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/mudahale", uc: "/api/reports/dokuma/mudahale", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/mudahale" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "dokuma/duruslar" } },
  // S1c uçları + S4a yaprakları (levent sonucu · kapasite · bitiş tahmini); levent karoları hub'da ayrıca devere ister.
  { key: "dokuma/levent-sonucu", baslik: "Levent Sonucu", soru: "Her leventten beklenen kumaş çıktı mı, fire ne kadar?",
    sinif: "basit", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 30, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/levent-sonucu", uc: "/api/reports/dokuma/levent-sonucu", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/levent-sonucu" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "dokuma/levent-dengesi" } },
  { key: "dokuma/kapasite-kullanimi", baslik: "Kapasite Kullanımı", soru: "Tezgahlar haftada teorik kapasitelerinin ne kadarını kumaşa çevirdi?",
    sinif: "gelismis", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 30, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/kapasite-kullanimi", uc: "/api/reports/dokuma/kapasite-kullanimi", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/kapasite-kullanimi" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "dokuma/tezgah-randimani" } },
  { key: "dokuma/levent-bitis-tahmini", baslik: "Levent Bitiş Tahmini", soru: "Tezgahtaki leventler günlük hızla ne zaman biter?",
    sinif: "basit", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/dokuma/levent-bitis-tahmini", uc: "/api/reports/dokuma/levent-bitis-tahmini", kapiTasiyici: [{ dosya: "src/routes/reports/dokuma.report.routes.ts", yol: "/levent-bitis-tahmini" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "tasindi", panelYolu: "operations/warp-beams", aciklama: "Levent planı ekranındaki bitiş tahmini" } },

  // ── ÖN MUHASEBE ───────────────────────────────────────────────────────────
  { key: "finance/aging", baslik: "Cari Yaşlandırma", soru: "Cari bakiyeler bu tarihte hangi vade kovalarında duruyor?",
    sinif: "gelismis", izin: "report:finance", modul: "financeEnabled", varsayilanGun: null, tarih: "kesit",
    panelYolu: "reports/finance/aging", uc: "/api/reports/finance/aging", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/aging" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "finance/alacaklar" } },
  { key: "finance/cash-book", baslik: "Kasa & Banka Defteri", soru: "Bu dönemde kasaya ve bankaya ne girdi, ne çıktı?",
    sinif: "gelismis", izin: "report:finance", modul: "financeEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/finance/cash-book", uc: "/api/reports/finance/cash-book", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/cash-book" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: "muhasebe-araclari", persona: ["muhasebe"], varyantBoyutlari: [], yeniHali: { tur: "uzman" } },
  { key: "finance/cheque-due", baslik: "Çek Vade Takvimi", soru: "Önümüzdeki günlerde hangi çekler vadesi geliyor?",
    sinif: "basit", izin: "report:finance", modul: "financeEnabled", varsayilanGun: null, tarih: "ileri-pencere",
    panelYolu: "reports/finance/cheque-due", uc: null, kapiTasiyici: null, yuzey: "yaprak-yabanci-uc",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "finance/alacaklar" } },
  { key: "finance/vat-summary", baslik: "KDV Dönem Özeti", soru: "Bu dönemde ne kadar KDV hesaplandı ve indirildi?",
    sinif: "basit", izin: "report:finance", modul: "financeEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/finance/vat-summary", uc: "/api/reports/finance/vat-summary", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/vat-summary" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: "muhasebe-araclari", persona: ["muhasebe"], varyantBoyutlari: [], yeniHali: { tur: "uzman" } },
  { key: "finance/fx-diff", baslik: "Kur Farkı Raporu", soru: "Döviz bakiyelerinde bu dönemde ne kadar kur farkı oluştu?",
    sinif: "gelismis", izin: "report:finance", modul: "financeEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/finance/fx-diff", uc: "/api/reports/finance/fx-diff", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/fx-diff" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: "muhasebe-araclari", persona: ["muhasebe"], varyantBoyutlari: [], yeniHali: { tur: "uzman" } },
  { key: "finance/statement", baslik: "Cari Ekstre", soru: "Bu carinin bu dönemdeki hareketleri ve bakiyesi ne?",
    sinif: "gelismis", izin: "report:finance", modul: "financeEnabled", varsayilanGun: null, tarih: "aralik-iso",
    panelYolu: "", uc: "/api/reports/finance/statement", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/statement" }], yuzey: "diyalog",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "tasindi", panelYolu: "finance/cari", aciklama: "Cari kartındaki ekstre" } },

  // ── FASON ─────────────────────────────────────────────────────────────────
  { key: "subcontract/scorecard", baslik: "Fason Karnesi", soru: "Fasoncular bu dönemde ne kadar iş aldı, ne kadarı zamanında döndü?",
    sinif: "gelismis", izin: "report:subcontract", modul: "planlanan:fason", varsayilanGun: 90, tarih: "aralik-iso",
    panelYolu: "reports/subcontract/scorecard", uc: "/api/reports/subcontract/scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/subcontract.routes.ts", yol: "/scorecard" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "subcontract/fasoncular" } },

  // ── MÜŞTERİ ───────────────────────────────────────────────────────────────
  { key: "customer/scorecard", baslik: "Müşteri Karnesi", soru: "Hangi müşteri bu dönemde ne kadar aldı, önceki döneme göre nasıl değişti?",
    sinif: "gelismis", izin: "report:customer", modul: "cekirdek:siparis-musteri", varsayilanGun: 90, tarih: "aralik-iso",
    panelYolu: "reports/customer/scorecard", uc: "/api/reports/customer/scorecard", kapiTasiyici: [{ dosya: "src/routes/reports/customer.routes.ts", yol: "/scorecard" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/siparis-talep" } },
  { key: "customer/order-profile", baslik: "Müşteri Sipariş Profili", soru: "Bu müşteri genelde hangi ürün ve renkleri sipariş ediyor?",
    sinif: "basit", izin: "report:customer", modul: "cekirdek:siparis-musteri", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/customer/order-profile", uc: "/api/reports/customer/order-profile", kapiTasiyici: [{ dosya: "src/routes/reports/customer.routes.ts", yol: "/order-profile" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "birlesti", anahtar: "sales/siparis-talep" } },

  // ── DENETİM ───────────────────────────────────────────────────────────────
  { key: "audit/system-log-summary", baslik: "Denetim Kaydı Özeti", soru: "Bu dönemde sistemde hangi işlemler kaç kez yapıldı?",
    sinif: "basit", izin: "report:audit", modul: "cekirdek:sistem-kimlik-belge", varsayilanGun: 7, tarih: "aralik-iso",
    panelYolu: "reports/audit/system-log-summary", uc: "/api/reports/audit/system-log-summary", kapiTasiyici: [{ dosya: "src/routes/reports/audit.routes.ts", yol: "/system-log-summary" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "tasindi", panelYolu: "system/logs", aciklama: "Denetim kaydı ekranındaki özet" } },
  { key: "audit/user-activity", baslik: "Kullanıcı Aktivitesi", soru: "Hangi kullanıcı bu dönemde hangi işlemleri yaptı?",
    sinif: "basit", izin: "report:audit", modul: "cekirdek:sistem-kimlik-belge", varsayilanGun: 7, tarih: "aralik-iso",
    panelYolu: "reports/audit/user-activity", uc: "/api/reports/audit/user-activity", kapiTasiyici: [{ dosya: "src/routes/reports/audit.routes.ts", yol: "/user-activity" }], yuzey: "yaprak",
    nesil: "v1", kategoriV2: null, persona: [], varyantBoyutlari: [], yeniHali: { tur: "tasindi", panelYolu: "system/activity", aciklama: "Kullanıcı aktivitesi ekranı" } },
  // ── RAPORLAR v2 — 14 TEMEL RAPOR (plan §5) ────────────────────────────────
  // `hazir:false` = uç henüz yok; hiçbir yüzeyde çizilmez (`isReportSurfaced`). Taşıyıcı dosya
  // R0-RAPA/B/C'nin yazacağı yerdir; `yol` o dosyada `router.get` yolu olarak beyan edilir.
  { key: "sales/siparis-talep", baslik: "Ne kadar iş aldık?", soru: "Bu dönemde kaç metre sipariş aldık, hangi müşteri hangi kumaşı ve rengi istedi, önceki döneme göre nasıl değişti?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/siparis-talep", uc: "/api/reports/sales/siparis-talep", kapiTasiyici: [{ dosya: "src/routes/reports/temel-satis.routes.ts", yol: "/sales/siparis-talep" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "satis-sevkiyat", persona: ["patron", "satis"], varyantBoyutlari: ["musteri", "urun", "renk", "yon"], hazir: true },
  { key: "sales/sevkiyat", baslik: "Ne sevk ettik?", soru: "Bu dönemde kime, nereye kaç metre mal sevk ettik ve önceki döneme göre nasıl değişti?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/sevkiyat", uc: "/api/reports/sales/sevkiyat", kapiTasiyici: [{ dosya: "src/routes/reports/temel-satis.routes.ts", yol: "/sales/sevkiyat" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "satis-sevkiyat", persona: ["patron", "sevkiyat", "muhasebe"], varyantBoyutlari: ["musteri", "urun", "renk", "yon"], hazir: true },
  { key: "sales/termin", baslik: "Sözümüzü tuttuk mu?", soru: "Termini olan siparişlerin ne kadarı zamanında gitti ve siparişler kaç günde teslim edildi?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/termin", uc: "/api/reports/sales/termin", kapiTasiyici: [{ dosya: "src/routes/reports/temel-satis.routes.ts", yol: "/sales/termin" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "satis-sevkiyat", persona: ["patron", "sevkiyat", "satis"], varyantBoyutlari: ["musteri", "urun", "yon"], hazir: true },
  { key: "sales/acik-siparisler", baslik: "Açık siparişler hazır mı?", soru: "Açık siparişlerin ne kadarı bugün depodan karşılanabiliyor, kalanı üretimin neresinde?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/sales/acik-siparisler", uc: "/api/reports/sales/acik-siparisler", kapiTasiyici: [{ dosya: "src/routes/reports/temel-satis.routes.ts", yol: "/sales/acik-siparisler" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "satis-sevkiyat", persona: ["planlama", "sevkiyat"], varyantBoyutlari: ["urun", "renk"], hazir: true },
  { key: "sales/vazgecilen-is", baslik: "Ne geri geldi, neden vazgeçildi?", soru: "Bu dönemde ne kadar mal iade geldi, kaç sipariş iptal edildi ve hangi sebeplerle?",
    sinif: "basit", izin: "report:sales", modul: "cekirdek:siparis-musteri", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/sales/vazgecilen-is", uc: "/api/reports/sales/vazgecilen-is", kapiTasiyici: [{ dosya: "src/routes/reports/temel-satis.routes.ts", yol: "/sales/vazgecilen-is" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "satis-sevkiyat", persona: ["satis", "kalite"], varyantBoyutlari: ["musteri", "urun", "sebep"], hazir: true },
  { key: "production/uretim-akisi", baslik: "Üretim nerede takıldı?", soru: "Toplar şu an hangi istasyonda bekliyor ve bu dönemde istasyonlardan ne kadar iş geçti?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/production/uretim-akisi", uc: "/api/reports/production/uretim-akisi", kapiTasiyici: [{ dosya: "src/routes/reports/temel-uretim.routes.ts", yol: "/production/uretim-akisi" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "uretim", persona: ["uretim"], varyantBoyutlari: ["istasyon", "operator"], hazir: false },
  // KQ-D6: hazır ilk v2 satırı — uç `RaporSunumu` döner, sayfa katalogdan üretilen genel yaprak.
  { key: "production/kursun-gramaj", baslik: "Kurşun Gramajı", soru: "Hangi gün hangi kumaşa hangi makinede kaç gram kurşun basıldı, hedeften sapan oldu mu?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/production/kursun-gramaj", uc: "/api/reports/production/kursun-gramaj", kapiTasiyici: [{ dosya: "src/routes/reports/production.routes.ts", yol: "/kursun-gramaj" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "uretim", persona: ["uretim", "kalite"], varyantBoyutlari: ["kaynak"], hazir: true, yeniRapor: true },
  // MAL-7: maliyet modülünün raporu (tutar yok); panelde ayrıca Maliyet & Teklif › İplik İhtiyaç Planı (`cost/yarn-need`) aynı zarfı çizer.
  { key: "maliyet/iplik-ihtiyaci", baslik: "İplik İhtiyaç Planı", soru: "Açık siparişleri dokumak için hangi iplikten kaç kg lazım, ne kadarı stokta ya da yolda, eksik ne?",
    sinif: "basit", izin: "report:yarn-need", modul: "maliyetEnabled", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/maliyet/iplik-ihtiyaci", uc: "/api/reports/maliyet/iplik-ihtiyaci", kapiTasiyici: [{ dosya: "src/routes/reports/maliyet.report.routes.ts", yol: "/iplik-ihtiyaci" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "uretim", persona: ["planlama", "patron"], varyantBoyutlari: ["musteri", "urun"], hazir: true, yeniRapor: true },
  // D4-G3: kârlılık (hizmet işleri; tek kaynak `profitability.helper`); panelde kendi sayfası (V2_KEYS_WITH_OWN_PAGE),
  // Maliyet & Teklif hub'ında karo. Kapı maliyet ∧ ön muhasebe; izin `cost:read` (+ uçta `report:finance`). Varyant sonraki dilim.
  { key: "maliyet/karlilik", baslik: "Kârlılık", soru: "Hangi müşteri, hangi işlem ve hangi ay ne kazandırdı; gelirden ipe, makineye ve dışarıya ne gitti?",
    sinif: "basit", izin: "cost:read", modul: "maliyetEnabled", varsayilanGun: 90, tarih: "aralik-gun",
    panelYolu: "reports/maliyet/karlilik", uc: "/api/reports/maliyet/karlilik", kapiTasiyici: [{ dosya: "src/routes/reports/maliyet.report.routes.ts", yol: "/karlilik" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "para", persona: ["patron", "muhasebe"], varyantBoyutlari: ["musteri", "makine"], hazir: true, yeniRapor: true },
  { key: "quality/kalite", baslik: "Kalite nasıl gidiyor?", soru: "Bu dönemde kumaşın ne kadarı birinci kalite çıktı ve önceki döneme göre nasıl değişti?",
    sinif: "basit", izin: "report:quality", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/quality/kalite", uc: "/api/reports/quality/kalite", kapiTasiyici: [{ dosya: "src/routes/reports/temel-uretim.routes.ts", yol: "/quality/kalite" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "kalite", persona: ["kalite", "patron"], varyantBoyutlari: ["urun", "renk", "fasoncu", "levent"], hazir: false },
  { key: "quality/kayip", baslik: "Ne kaybettik?", soru: "Bu dönemde satılabilir olmaktan çıkan kumaş ne kadar ve en çok hangi kaynaktan?",
    sinif: "basit", izin: "report:quality", modul: "productionEnabled", varsayilanGun: 30, tarih: "aralik-iso",
    panelYolu: "reports/quality/kayip", uc: "/api/reports/quality/kayip", kapiTasiyici: [{ dosya: "src/routes/reports/temel-uretim.routes.ts", yol: "/quality/kayip" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "kalite", persona: ["kalite", "patron"], varyantBoyutlari: ["kaynak", "urun", "fasoncu", "tezgah", "levent"], hazir: false },
  { key: "inventory/depo", baslik: "Depoda ne yatıyor?", soru: "Depoda bugün ne kadar mal var ve ne kadarı uzun süredir satılmadan bekliyor?",
    sinif: "basit", izin: "report:inventory", modul: "cekirdek:stok-giris", varsayilanGun: null, tarih: "yok",
    panelYolu: "reports/inventory/depo", uc: "/api/reports/inventory/depo", kapiTasiyici: [{ dosya: "src/routes/reports/temel-uretim.routes.ts", yol: "/inventory/depo" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "uretim", persona: ["patron", "depo"], varyantBoyutlari: ["urun", "renk", "depo"], hazir: false },
  { key: "subcontract/fasoncular", baslik: "Fasoncular zamanında dönüyor mu?", soru: "Fasona giden işler zamanında ve eksiksiz döndü mü, fasonda ne kadar iş bekliyor?",
    sinif: "basit", izin: "report:subcontract", modul: "planlanan:fason", varsayilanGun: 90, tarih: "aralik-iso",
    panelYolu: "reports/subcontract/fasoncular", uc: "/api/reports/subcontract/fasoncular", kapiTasiyici: [{ dosya: "src/routes/reports/temel-uretim.routes.ts", yol: "/subcontract/fasoncular" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "uretim", persona: ["planlama", "patron"], varyantBoyutlari: ["fasoncu", "urun", "renk"], hazir: false },
  { key: "dokuma/tezgah-randimani", baslik: "Tezgahlar verimli mi?", soru: "Tezgahlar bu dönemde dokuyabilecekleri kumaşın ne kadarını dokudu?",
    sinif: "basit", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 7, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/tezgah-randimani", uc: "/api/reports/dokuma/tezgah-randimani", kapiTasiyici: [{ dosya: "src/routes/reports/temel-dokuma-finans.routes.ts", yol: "/dokuma/tezgah-randimani" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "dokuma", persona: ["dokuma"], varyantBoyutlari: ["vardiya", "tezgah", "levent"], hazir: true },
  { key: "dokuma/duruslar", baslik: "Tezgahlar neden duruyor?", soru: "Tezgahlar en çok hangi sebeplerle durdu ve duruşa ne çabuk müdahale edildi?",
    sinif: "basit", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 7, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/duruslar", uc: "/api/reports/dokuma/duruslar", kapiTasiyici: [{ dosya: "src/routes/reports/temel-dokuma-finans.routes.ts", yol: "/dokuma/duruslar" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "dokuma", persona: ["dokuma"], varyantBoyutlari: ["vardiya", "tezgah", "sebep"], hazir: true },
  // Levent karoları hub'da ayrıca devere ister (v1 levent satırlarıyla aynı beyan).
  { key: "dokuma/levent-dengesi", baslik: "Leventten beklenen kumaş çıktı mı?", soru: "Biten leventlerden beklenen kumaşın ne kadarı dokundu?",
    sinif: "basit", izin: "report:production", modul: "dokumaEnabled", varsayilanGun: 30, tarih: "aralik-gun",
    panelYolu: "reports/dokuma/levent-dengesi", uc: "/api/reports/dokuma/levent-dengesi", kapiTasiyici: [{ dosya: "src/routes/reports/temel-dokuma-finans.routes.ts", yol: "/dokuma/levent-dengesi" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "dokuma", persona: ["dokuma", "patron"], varyantBoyutlari: ["cozguKarti", "tezgah"], hazir: true },
  { key: "finance/alacaklar", baslik: "Kimden ne alacağız?", soru: "Vadesi geçmiş alacak ne kadar ve önümüzdeki günlerde hangi çeklerin vadesi geliyor?",
    sinif: "basit", izin: "report:finance", modul: "financeEnabled", varsayilanGun: null, tarih: "kesit",
    panelYolu: "reports/finance/alacaklar", uc: "/api/reports/finance/alacaklar", kapiTasiyici: [{ dosya: "src/routes/reports/temel-dokuma-finans.routes.ts", yol: "/finance/alacaklar" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "para", persona: ["patron", "muhasebe"], varyantBoyutlari: ["cari", "paraBirimi"], hazir: true },
  // D4-H1: masraf özeti (kategori × ay); panelde kendi sayfası `/reports/finance/masraf-ozeti` (V2_KEYS_WITH_OWN_PAGE) aynı zarfı çizer.
  // Uç `paraBirimi` varyantını uygular; kasa/kategori süzgeci ve varyantı sonraki dilim (tasarım §9.5/§9.8 sapması, arşiv notu).
  { key: "finance/masraf-ozeti", baslik: "Masraf Özeti", soru: "Bu dönemde hangi kalem için ne kadar harcadık ve aydan aya nasıl değişti?",
    sinif: "basit", izin: "report:finance", modul: "financeEnabled", varsayilanGun: 90, tarih: "aralik-gun",
    panelYolu: "reports/finance/masraf-ozeti", uc: "/api/reports/finance/masraf-ozeti", kapiTasiyici: [{ dosya: "src/routes/reports/finance.report.routes.ts", yol: "/masraf-ozeti" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "para", persona: ["patron", "muhasebe"], varyantBoyutlari: ["paraBirimi"], hazir: true, yeniRapor: true },
  // D4-A4: makine duruşları (span defteri; kurşun/brode/tambur + tezgah). Kapı `dokuma ∨ (üretim ∧ uretim.makineDurusTakibi)`
  // (`requireMachineStopRegime`); panelde kendi sayfası (V2_KEYS_WITH_OWN_PAGE), buluta `production/makine-duruslari`.
  { key: "production/makine-duruslari", baslik: "Makineler neden durdu?", soru: "Makineler bu dönemde ne kadar durdu, en çok hangi sebeple ve hangi makinede?",
    sinif: "basit", izin: "report:production", modul: "productionEnabled", varsayilanGun: 7, tarih: "aralik-gun",
    panelYolu: "reports/production/makine-duruslari", uc: "/api/reports/production/makine-duruslari", kapiTasiyici: [{ dosya: "src/routes/reports/temel-uretim.routes.ts", yol: "/production/makine-duruslari" }], yuzey: "yaprak",
    nesil: "v2", kategoriV2: "uretim", persona: ["uretim", "patron"], varyantBoyutlari: ["makine", "istasyon", "sebep"], hazir: true, yeniRapor: true },
];

/** Katalogdan TÜRETİLİR — derleyici bilinmeyen anahtarı reddeder (K4). */
export type ReportKey = (typeof REPORT_CATALOG)[number]["key"];

/** Anahtar → satır. Bilinmeyen anahtar `undefined` (çağıran fail-closed davranır). */
export const REPORT_BY_KEY = new Map(REPORT_CATALOG.map((r) => [r.key, r]));

/**
 * Satır bugün bir yüzeyde (karo · route · palet · Sistem → Modüller) çizilir mi — TEK yüklem.
 * v2 satırı ucu inene kadar (`hazir:false`) çizilmez; listeyi kendi süzen yüzey yazılmaz.
 */
export function isReportSurfaced(entry: ReportCatalogEntry): boolean {
  return entry.nesil === "v1" || entry.hazir;
}

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
