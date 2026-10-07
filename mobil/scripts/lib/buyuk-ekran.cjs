// Büyük ekran yön kilidi çıkışının ve Play hedef SDK alt sınırının TEK KAYNAĞI: eklenti
// (plugins/withBuyukEkranYonu) yazar, build-apk.mjs AAB'nin kendisinden ölçer. Bağımlılık taşımaz.

/** API 36'da büyük ekranda (sw ≥ 600dp) yön kilidini koruyan uygulama özelliği; API 37 hedefinde yok sayılır. */
const YON_OZELLIGI = 'android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY';
/** Play'in yeni sürümde kabul ettiği en düşük hedef SDK (Play Console reddi 2026-10-08: 35 < 36). */
const PLAY_EN_DUSUK_HEDEF_SDK = 36;

module.exports = { YON_OZELLIGI, PLAY_EN_DUSUK_HEDEF_SDK };
