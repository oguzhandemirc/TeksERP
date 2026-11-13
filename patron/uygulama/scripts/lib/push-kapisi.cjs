// Telefon push kapısının DERLEME tarafı (saf; `build-aab.mjs` ve jest okur). Kapı kararı `app.config.js` `pushKapisi`;
// burada kapıya göre: birleşik manifestte izinli izin kümesi, bildirim bileşeni denetimi ve Android bağlama dışlaması.
// Autolinking dışlamayı yalnız package.json'dan okur (CLI yalnız EKLER) → açık derlemede dışlama geçici kaldırılır.

/** Android'de yalnız kapı açıkken bağlanan paketler (expo-application, expo-notifications'ın bağımlılığı). */
const PUSH_PAKETLERI = ["expo-notifications", "expo-application"];
/** Firebase / bildirim bileşeni deseni (servis, alıcı, sağlayıcı adı). */
const BILDIRIM_BILESENI = /firebase|expo\.modules\.notifications|c2dm/i;

/** Birleşik manifestte bulunmasına izin verilen izinler: bugünkü küme; kapı açıkken + bildirim izinleri. */
function izinliIzinler(paket, acik, pushIzinleri) {
  // AndroidX'in uygulamaya özel imza izni paket adını taşır: literal yazılmaz, paketten türer.
  // CAMERA: yalnız sunucu bağlantı karekodunu okutmak için (expo-camera, mikrofon kapalı).
  const taban = ["android.permission.INTERNET", "android.permission.CAMERA", `${paket}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`];
  return acik ? [...taban, ...pushIzinleri] : taban;
}

/** Kapalı: hiçbir bildirim/Firebase bileşeni olmaz. Açık: expo-notifications servisi OLMALI (modül gerçekten bağlandı). */
function bilesenSorunlari(bilesenler, acik) {
  const bildirim = bilesenler.filter((ad) => BILDIRIM_BILESENI.test(ad));
  if (!acik) return bildirim.length ? [`bildirim/Firebase bileşeni pakette: ${bildirim.join(", ")}`] : [];
  return bilesenler.some((ad) => /expo\.modules\.notifications/.test(ad)) ? [] : ["kapı açık ama expo-notifications bileşeni pakette yok (bağlama dışlaması kalktı mı?)"];
}

/** package.json nesnesi → kapıya göre Android dışlaması. Kapalı: aynen (aynı nesne). Açık: push paketleri dışlamadan çıkar. */
function autolinkingKapiya(pkg, acik) {
  if (!acik) return pkg;
  const android = pkg.expo?.autolinking?.android ?? {};
  return {
    ...pkg,
    expo: {
      ...pkg.expo,
      autolinking: {
        ...pkg.expo.autolinking,
        android: { ...android, exclude: (android.exclude ?? []).filter((p) => !PUSH_PAKETLERI.includes(p)) },
      },
    },
  };
}

module.exports = { PUSH_PAKETLERI, BILDIRIM_BILESENI, izinliIzinler, bilesenSorunlari, autolinkingKapiya };
