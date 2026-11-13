// Telefon push DERLEME KAPISI (bildirim v2 F5 + push köprüsü P4). Varsayılan: app.json BİREBİR (mağaza paketi bugünküyle
// aynı — izin engeli, Firebase yok). Kapı yalnız ÜÇÜ birden varken açılır: `PATRON_NATIVE_PUSH=1` ∧ `google-services.json`
// (uygulama köküne konur, repoya GİRMEZ, .gitignore) ∧ `PATRON_EAS_PROJECT_ID` (EAS proje kimliği, UUID). Biri eksikse tek
// satır uyarı ve app.json aynen (fail-closed). `build-aab.mjs` aynı `pushKapisi`yı okur. Adımlar: docs/ops/PATRON-BILDIRIM-CANLI-DENEME.md.
const fs = require("node:fs");
const path = require("node:path");

/** Kapı açıkken engelden çıkan izinler: bildirim gösterme (Android 13+ çalışma zamanı istemi) + FCM alımı. */
const NATIVE_PUSH_IZINLERI = ["android.permission.POST_NOTIFICATIONS", "com.google.android.c2dm.permission.RECEIVE", "android.permission.WAKE_LOCK"];
const FIREBASE_DOSYASI = "google-services.json";
const EAS_KIMLIGI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kapı kararı (tek kaynak): `{ acik, eksik }` — eksik = kapalılık nedeni (bayrak yoksa null: bilinçli kapalı, uyarı yok). */
function pushKapisi({ env = process.env, root = __dirname } = {}) {
  if (env.PATRON_NATIVE_PUSH !== "1") return { acik: false, eksik: null, projectId: null };
  const eksik = [];
  if (!fs.existsSync(path.join(root, FIREBASE_DOSYASI))) eksik.push(FIREBASE_DOSYASI);
  const projectId = (env.PATRON_EAS_PROJECT_ID ?? "").trim();
  if (!EAS_KIMLIGI.test(projectId)) eksik.push("PATRON_EAS_PROJECT_ID");
  return eksik.length ? { acik: false, eksik, projectId: null } : { acik: true, eksik: null, projectId };
}

function withNativePush(config, { env = process.env, root = __dirname, warn = console.warn } = {}) {
  const k = pushKapisi({ env, root });
  if (!k.acik) {
    if (k.eksik) warn(`PATRON_NATIVE_PUSH=1 ama ${k.eksik.join(" + ")} yok — telefon push KAPALI derleniyor`);
    return config;
  }
  const android = config.android ?? {};
  const extra = config.extra ?? {};
  return {
    ...config,
    android: {
      ...android,
      googleServicesFile: `./${FIREBASE_DOSYASI}`,
      blockedPermissions: (android.blockedPermissions ?? []).filter((p) => !NATIVE_PUSH_IZINLERI.includes(p)),
    },
    plugins: [...(config.plugins ?? []), "expo-notifications"],
    extra: { ...extra, nativePush: true, eas: { ...(extra.eas ?? {}), projectId: k.projectId } },
  };
}

module.exports = ({ config }) => withNativePush(config);
module.exports.withNativePush = withNativePush;
module.exports.pushKapisi = pushKapisi;
module.exports.NATIVE_PUSH_IZINLERI = NATIVE_PUSH_IZINLERI;
