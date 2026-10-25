// Telefon push (bildirim v2 F5) DERLEME KAPISI. Varsayılan: app.json BİREBİR (mağaza paketi bugünküyle aynı — izin
// engeli, Firebase yok). Kapı yalnız `PATRON_NATIVE_PUSH=1` ∧ `google-services.json` (repoya GİRMEZ, .gitignore) varken
// açılır; dosya yoksa tek satır uyarı ve app.json aynen (fail-closed). Açma adımları: docs/ops/PATRON-BILDIRIM-CANLI-DENEME.md.
const fs = require("node:fs");
const path = require("node:path");

/** Kapı açıkken engelden çıkan izinler: bildirim gösterme (Android 13+ çalışma zamanı istemi) + FCM alımı. */
const NATIVE_PUSH_IZINLERI = ["android.permission.POST_NOTIFICATIONS", "com.google.android.c2dm.permission.RECEIVE", "android.permission.WAKE_LOCK"];
const FIREBASE_DOSYASI = "google-services.json";

function withNativePush(config, { env = process.env, root = __dirname, warn = console.warn } = {}) {
  if (env.PATRON_NATIVE_PUSH !== "1") return config;
  const dosya = path.join(root, FIREBASE_DOSYASI);
  if (!fs.existsSync(dosya)) {
    warn(`PATRON_NATIVE_PUSH=1 ama ${FIREBASE_DOSYASI} yok — telefon push KAPALI derleniyor`);
    return config;
  }
  const android = config.android ?? {};
  return {
    ...config,
    android: {
      ...android,
      googleServicesFile: `./${FIREBASE_DOSYASI}`,
      blockedPermissions: (android.blockedPermissions ?? []).filter((p) => !NATIVE_PUSH_IZINLERI.includes(p)),
    },
    plugins: [...(config.plugins ?? []), "expo-notifications"],
    extra: { ...(config.extra ?? {}), nativePush: true },
  };
}

module.exports = ({ config }) => withNativePush(config);
module.exports.withNativePush = withNativePush;
module.exports.NATIVE_PUSH_IZINLERI = NATIVE_PUSH_IZINLERI;
