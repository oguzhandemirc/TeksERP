// =============================================================================
// MODÜL ANAHTARLARI — BACKEND AYNASI
// =============================================================================
// TEK KAYNAK BACKEND'DEDİR: `Teks-Erp/src/constants/module-flags.ts`. Electron
// backend'i import EDEMEZ (ayrı derleme birimi) — aynı durum `lib/permissions.ts`
// ve mobil `types/permissions.ts` için de geçerli. Bu yüzden ayna tutulur ve
// ayna MEKANİK bir bekçiyle birebirlenir (`module-flags.test.ts`): backend
// dosyası METİN olarak okunur, üç tablo satır satır karşılaştırılır.
//
// ⚠️ AYNA NE İŞE YARAR: Sistem Profili ekranı "hangi modül hangisine bağlı" ve
// "kapatırsan ne olur" cümlelerini kurabilmek için bağımlılık ve Türkçe ad
// tablolarına ihtiyaç duyar. Bu bilgi bir UÇTAN da servis edilebilirdi; ayna
// seçildi çünkü tablolar kurulumdan kuruluma DEĞİŞMEZ (kod sabiti) ve bir ağ
// hatası yüzünden "bağımlılık yok" diye yanlış bir ekran çizmek istemiyoruz.
// Değişkenlik taşıyan tek şey DEĞERLERDİR ve onlar zaten uçtan geliyor.
//
// ⚠️ AYNAYA "AKILLI" BİR ŞEY EKLEME. Buradaki tablolar backend metniyle birebir
// karşılaştırıldığı için fazladan bir satır/anahtar eklemek bekçiyi kırar. Yeni
// bir modül doğduğunda sıra: backend sabiti → bu ayna → bekçi yeşil.
// =============================================================================

/** `PATCH /api/feature-flags` gövdesindeki MODÜL alanları (camelCase). */
export const MODULE_FLAG_KEYS = [
  "productionEnabled",
  "financeEnabled",
  "ticaretEnabled",
  "iplikEnabled",
  "depoMultiEnabled",
  "kumasTeknikEnabled",
  "tezgahEnabled",
  "devereEnabled",
  "dokumaEnabled",
] as const;

export type ModuleFlagKey = (typeof MODULE_FLAG_KEYS)[number];

/**
 * `<bağımlı>` açıkken `<ön koşul>` de açık olmalı.
 *
 * ⚠️ Panel bunu YALNIZ ANLATIR, uygulamaz: gerçek sed `setFeatureFlags`in 400
 * `MODULE_DEPENDENCY` dalıdır. Ekranda göstermenin sebebi, kullanıcının hatayı
 * yemeden ÖNCE sırayı görmesi ("önce Ticaret, sonra İplik").
 */
export const MODULE_DEPENDENCIES: Readonly<Partial<Record<ModuleFlagKey, ModuleFlagKey>>> = {
  iplikEnabled: "ticaretEnabled",
  tezgahEnabled: "productionEnabled",
  dokumaEnabled: "productionEnabled",
};

/** Hata mesajlarında ve panelde kullanılan Türkçe modül adı. */
export const MODULE_LABELS: Readonly<Record<ModuleFlagKey, string>> = {
  productionEnabled: "Üretim",
  financeEnabled: "Ön muhasebe",
  ticaretEnabled: "Ticaret",
  iplikEnabled: "İplik",
  depoMultiEnabled: "Çoklu depo",
  kumasTeknikEnabled: "Kumaş teknik kartı",
  tezgahEnabled: "Tezgah izleme",
  devereEnabled: "Devere / levent",
  dokumaEnabled: "Dokuma işi",
};

/**
 * DB anahtarı (`system_settings.key`) → API/panel alanı.
 *
 * ⚠️ `GET /api/admin/module-profile` farkı DB ANAHTARLARIYLA döner
 * (`production.enabled`), `PATCH /api/feature-flags` ise CAMEL ALANLARLA yazar
 * (`productionEnabled`). Profil uygulamak = farkı tek PATCH gövdesine çevirmek,
 * yani bu haritanın kullanıldığı TEK yer o dönüşümdür. Elle `.replace(".", "")`
 * gibi bir dönüşüm `depo.multiEnabled → depoMultiEnabled` için doğru sonucu
 * VERMEZ; tablo bu yüzden açık yazılır.
 */
export const MODULE_FIELD_BY_SETTING_KEY: Readonly<Record<string, ModuleFlagKey>> = {
  "production.enabled": "productionEnabled",
  "finance.enabled": "financeEnabled",
  "ticaret.enabled": "ticaretEnabled",
  "iplik.enabled": "iplikEnabled",
  "depo.multiEnabled": "depoMultiEnabled",
  "kumasTeknik.enabled": "kumasTeknikEnabled",
  "tezgah.enabled": "tezgahEnabled",
  "devere.enabled": "devereEnabled",
  "dokuma.enabled": "dokumaEnabled",
};

/**
 * Panelde HENÜZ YÜZEYİ OLMAYAN modüller.
 *
 * Modüller ekranındaki anahtar listesi bunları BİLEREK içermez ("açtım,
 * hiçbir şey olmadı" üretirlerdi). Sistem Profili ekranı ise KURULUMUN TAM
 * FOTOĞRAFIDIR ve onları "yüzeyi yok" rozetiyle GÖSTERİR: profil tablosunda
 * yedi sütun var, panelde beşini göstermek satıcıyı yanıltırdı.
 */
export const MODULE_PLACEHOLDERS: readonly ModuleFlagKey[] = [
  "kumasTeknikEnabled",
  "tezgahEnabled",
];
