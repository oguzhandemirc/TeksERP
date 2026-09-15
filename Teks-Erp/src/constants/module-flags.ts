// =============================================================================
// TeksERP — MODÜL ANAHTARLARI (TEK KAYNAK)
// =============================================================================
// Bir ERP kurulumu "hangi modülleri kullanıyorum" sorusunu YEDİ anahtarla
// cevaplar. Bunlar GÖRÜNÜRLÜK ayarı DEĞİL, REJİM anahtarlarıdır: kapalıyken
// menü çizilmez, route 403 verir (`middlewares/module.middleware.ts`) ve
// kancalar no-op'a düşer. Emsal ve kalıp `finance.enabled` (2026-08-13).
//
// ⚠️ İKİ AD UZAYI VAR ve karıştırılmamalı:
//   • DB anahtarı  (`system_settings.key`)  → "ticaret.enabled"
//   • API/panel alanı (`FeatureFlags`)      → "ticaretEnabled"
// `modul.*` yalnız KAVRAMSAL sınıf adıdır (tasarım belgesi); koda GİRMEZ.
//
// ⚠️ NEDEN DB ANAHTARLARI BURADA DÜZ STRING: `system-setting.service.ts` bu
// dosyayı bağımlılık doğrulaması için IMPORT EDER. Buradan `SETTING_KEYS`
// import etmek dairesel bağımlılık kurar ve CommonJS'te modül init sırasına
// göre `undefined` bir Set üretir — yani kapı sessizce açılır. İkilik bekçiyle
// kilitlenir (`scripts/test_module_flags.ts`: MODULE_SETTING_KEYS ↔ SETTING_KEYS).
//
// TÜKETİCİLER (DÖRT): `setFeatureFlags` bağımlılık doğrulaması · `admin.routes`
// ham ayar ucunun reddi (K7) · `feature-flag.routes.ts` `flagWriteGuard`ının
// SÜPERADMİN dalı (modül anahtarını yalnız sistem hesabı yazar) · bekçi
// `scripts/test_module_flags.ts`.
//
// ⚠️ SON İKİ KÜME MODÜL KÜMESİ DEĞİL: `SUPERADMIN_ONLY_*` yazma kapısının kümesidir ve
// rapor görünürlük listesini de kapsar (Raporlar K3). Modül sorusu soran hiçbir yol
// onları okumaz — ayrım adla taşınır.
// =============================================================================

/**
 * `PATCH /api/feature-flags` gövdesindeki MODÜL alanları (camelCase).
 *
 * ⚠️ `financeEnabled` ve `productionEnabled` DE bu kümededir: ikisi de birer
 * modül şalteridir, yalnız daha erken doğdular. Kümeyi "yeni beş anahtar" diye
 * daraltmak, ham ayar ucunun (K7) o ikisini yazmaya devam etmesi demek olurdu.
 */
export const MODULE_FLAG_KEYS: ReadonlySet<string> = new Set([
  "productionEnabled",
  "financeEnabled",
  "ticaretEnabled",
  "iplikEnabled",
  "depoMultiEnabled",
  "kumasTeknikEnabled",
  "tezgahEnabled",
  "devereEnabled",
  "dokumaEnabled",
  "emanetEnabled",
]);

/**
 * `PATCH /api/feature-flags` gövdesinde SÜPERADMİN şartı doğuran anahtarların TAMAMI:
 * dokuz modül anahtarı + rapor görünürlük listesi.
 *
 * ⚠️ NEDEN `MODULE_FLAG_KEYS`i GENİŞLETMEDİK, ÜSTÜNE KÜME KURDUK: `reportsClosedKeys`
 * bir modül anahtarı DEĞİL — bağımlılık tablosuna girmez, profil sabitinde yaşamaz,
 * `MODULE_SETTING_KEYS` ile birebirliği ölçülen dokuzluğun parçası değildir. Onu o kümeye
 * atmak `test_module_flags`in "dokuz ↔ dokuz" ölçümünü bozar ve `MODULE_DEPENDENCIES`
 * okuyan her yolu yanlış soruya sokardı. Ortak olan tek şey YAZMA KAPISIdır; kümeyi de
 * tam olarak o soruya göre adlandırdık.
 */
export const SUPERADMIN_ONLY_FLAG_KEYS: ReadonlySet<string> = new Set([
  ...MODULE_FLAG_KEYS,
  "reportsClosedKeys",
]);

/** Aynı dokuz modülün DB anahtarı (`system_settings.key`). */
export const MODULE_SETTING_KEYS: ReadonlySet<string> = new Set([
  "production.enabled",
  "finance.enabled",
  "ticaret.enabled",
  "iplik.enabled",
  "depo.multiEnabled",
  "kumasTeknik.enabled",
  "tezgah.enabled",
  "devere.enabled",
  "dokuma.enabled",
  "emanet.enabled",
]);

/**
 * Ham ayar ucundan (`PUT /api/admin/settings/:key`) YAZILAMAYAN DB anahtarları:
 * dokuz modül anahtarı + `reports.closedKeys`. K7 kalıbı — ikinci bir yazma yüzeyi
 * açılmaz, yoksa süperadmin kapısı (`flagWriteGuard`) etrafından dolaşılırdı.
 */
export const SUPERADMIN_ONLY_SETTING_KEYS: ReadonlySet<string> = new Set([
  ...MODULE_SETTING_KEYS,
  "reports.closedKeys",
]);

/**
 * Modül bağımlılıkları: `<bağımlı>` açıkken `<ön koşul>` de açık olmalı.
 *
 * • İplik, ticaret paketinin bir parçasıdır — iplik kg defteri alış/satış
 *   yüzeyleri olmadan tek başına anlamsızdır (mal kabul, alış siparişi,
 *   fiyat listesi hepsi ticarette).
 * • Tezgah izleme üretimin bir alt yüzeyidir — üretim kapalıyken izlenecek
 *   iş emri yoktur.
 * • Devere (çözgü hazırlama/levent) iplik kg defterini TÜKETİR: levent doğarken
 *   `WARP_ISSUE` hareketi yazılır, yani iplik kapalıyken levent doğamaz.
 * • Dokuma işi üretimin bir alt yüzeyidir ve tezgah izlemenin KARDEŞİDİR, çocuğu
 *   değil: fasona dokutan firmada dokuma işi var tezgah yok, yalnız devere
 *   makinesini izleyen firmada tersi (DOKUMA-IS-EMRI §2.5).
 *
 * İKİ YERDE UYGULANIR ve ikisi de gerekli: yazma yolunda (`setFeatureFlags`
 * 400 verir — tutarsız çift hiç DOĞMAZ) ve okuma yolunda (middleware; elle
 * SQL/eski satır yüzünden tutarsız bir çift zaten varsa kapı yine kapalıdır).
 *
 * ⚠️ ZİNCİR (iplik → ticaret): bu tablo TEK ön koşul taşır, geçişli kapanışı KENDİ
 * ÜRETMEZ. Yazma yolu zinciri dolaylı kapatır, OKUMA kapısı zinciri ELLE ölçer
 * (`requireIplikEnabled` iki seviye).
 * ⚠️ DEVERE BAĞIMSIZDIR (DEVERE-LEVENT §9.7d; 1e K3 hükmü 2026-09-14): hazır/fason levent
 * iplik tüketmez, "iplik KAPALI + devere AÇIK" kurulumu meşrudur. İplik kapısı AKSİYON
 * ANINDA: içeride sarım `applyYarnMovementTx` üzerinden iplik kapalıysa 403 alır.
 */
export const MODULE_DEPENDENCIES: Readonly<Record<string, string>> = {
  iplikEnabled: "ticaretEnabled",
  tezgahEnabled: "productionEnabled",
  dokumaEnabled: "productionEnabled",
};

/** Hata mesajlarında ve panelde kullanılan Türkçe modül adı. */
export const MODULE_LABELS: Readonly<Record<string, string>> = {
  productionEnabled: "Üretim",
  financeEnabled: "Ön muhasebe",
  ticaretEnabled: "Ticaret",
  iplikEnabled: "İplik",
  depoMultiEnabled: "Çoklu depo",
  kumasTeknikEnabled: "Kumaş teknik kartı",
  tezgahEnabled: "Tezgah izleme",
  devereEnabled: "Devere / levent",
  dokumaEnabled: "Dokuma işi",
  emanetEnabled: "Emanet / konsinye mülkiyet",
};
