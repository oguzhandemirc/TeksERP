// =============================================================================
// RAPOR KATALOĞU — SATIR ŞEMASI (tipler + kapalı söz dağarcığı kümeleri)
// =============================================================================
// `report-catalog.ts`ten ayrıldı (dosya boyu); dışa açık adlar oradan da verilir (`export *`).
// Electron aynası `lib/report-catalog-types.ts` gövdesi BİREBİR kopyadır (`test_rapor_katalogu §5`).
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
  /** Rapor Merkezi kategorisi; v1 satırında `null` (eski rapor Merkez'de kategori almaz). */
  kategoriV2: ReportKategoriV2 | null;
  persona: readonly ReportPersona[];
  varyantBoyutlari: readonly ReportVaryantBoyutu[];
}

export interface ReportCatalogEntryV1 extends ReportCatalogBase {
  nesil: "v1";
  yeniHali: ReportYeniHali;
  /**
   * Panelden KALDIRILMIŞ eski rapor (2026-11-12, 1. aşama): hiçbir yüzeyde çizilmez; backend ucu eski panel
   * sürümleri için bir sürüm daha AÇIK kalır (kapı anahtarı bu satır). 2. aşamada uç + satır silinir.
   */
  emekli?: true;
}

export interface ReportCatalogEntryV2 extends ReportCatalogBase {
  nesil: "v2";
  /** `false` iken uç yok: satır hiçbir yüzeyde çizilmez, taşıyıcı ölçülmez (R0-RAP dilimi `true` yapar). */
  hazir: boolean;
  /** Hiçbir v1 satırının yeni hâli OLMAYAN yeni rapor (`test_rapor_katalogu §8c/§8c2` ölçer). */
  yeniRapor?: true;
}

export type ReportCatalogEntry = ReportCatalogEntryV1 | ReportCatalogEntryV2;
