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
// TÜKETİCİLER: `setFeatureFlags` bağımlılık doğrulaması · `admin.routes` ham
// ayar ucunun reddi (K7) · (sonraki paket) `flagWriteGuard` süperadmin dalı ·
// bekçi `scripts/test_module_flags.ts`.
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
]);

/** Aynı yedi modülün DB anahtarı (`system_settings.key`). */
export const MODULE_SETTING_KEYS: ReadonlySet<string> = new Set([
  "production.enabled",
  "finance.enabled",
  "ticaret.enabled",
  "iplik.enabled",
  "depo.multiEnabled",
  "kumasTeknik.enabled",
  "tezgah.enabled",
]);

/**
 * Modül bağımlılıkları: `<bağımlı>` açıkken `<ön koşul>` de açık olmalı.
 *
 * • İplik, ticaret paketinin bir parçasıdır — iplik kg defteri alış/satış
 *   yüzeyleri olmadan tek başına anlamsızdır (mal kabul, alış siparişi,
 *   fiyat listesi hepsi ticarette).
 * • Tezgah izleme üretimin bir alt yüzeyidir — üretim kapalıyken izlenecek
 *   iş emri yoktur.
 *
 * İKİ YERDE UYGULANIR ve ikisi de gerekli: yazma yolunda (`setFeatureFlags`
 * 400 verir — tutarsız çift hiç DOĞMAZ) ve okuma yolunda (middleware; elle
 * SQL/eski satır yüzünden tutarsız bir çift zaten varsa kapı yine kapalıdır).
 */
export const MODULE_DEPENDENCIES: Readonly<Record<string, string>> = {
  iplikEnabled: "ticaretEnabled",
  tezgahEnabled: "productionEnabled",
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
};
