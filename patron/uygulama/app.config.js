// Telefon push DERLEME KAPISI (bildirim v2 F5 + push köprüsü P4). Varsayılan: app.json BİREBİR (mağaza paketi bugünküyle
// aynı — izin engeli, Firebase yok). Kapı yalnız ÜÇÜ birden varken açılır: `PATRON_NATIVE_PUSH=1` ∧ `google-services.json`
// (uygulama köküne konur, repoya GİRMEZ, .gitignore) ∧ `PATRON_EAS_PROJECT_ID` (EAS proje kimliği, UUID). Biri eksikse tek
// satır uyarı ve app.json aynen (fail-closed). Açık kapıda `EXPO_OWNER` verilmişse `owner` da yazılır (kapalıda hiç yok).
// Kimlik repoya SABİT YAZILMAZ (değerler repo dışı ortam dosyasında). `build-aab.mjs` aynı `pushKapisi`yı okur. Adımlar: docs/ops/PATRON-BILDIRIM-CANLI-DENEME.md.
const fs = require("node:fs");
const path = require("node:path");

/** Kapı açıkken engelden çıkan izinler: bildirim gösterme (Android 13+ çalışma zamanı istemi) + FCM alımı. */
const NATIVE_PUSH_IZINLERI = ["android.permission.POST_NOTIFICATIONS", "com.google.android.c2dm.permission.RECEIVE", "android.permission.WAKE_LOCK"];
/** expo-notifications'ın (ShortcutBadger) getirdiği üretici rozet izinleri: rozet sayısı kullanılmıyor → kapı açıkken ENGELLENİR (en az yetki, 2026-11-13 ölçümü). */
const ROZET_IZINLERI = [
  "com.android.launcher.permission.READ_SETTINGS", "com.android.launcher.permission.WRITE_SETTINGS",
  "com.android.launcher.permission.INSTALL_SHORTCUT", "com.android.launcher.permission.UNINSTALL_SHORTCUT",
  "com.sec.android.provider.badge.permission.READ", "com.sec.android.provider.badge.permission.WRITE",
  "com.htc.launcher.permission.READ_SETTINGS", "com.htc.launcher.permission.UPDATE_SHORTCUT",
  "com.sonyericsson.home.permission.BROADCAST_BADGE", "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
  "com.anddoes.launcher.permission.UPDATE_COUNT", "com.majeur.launcher.permission.UPDATE_BADGE",
  "com.huawei.android.launcher.permission.CHANGE_BADGE", "com.huawei.android.launcher.permission.READ_SETTINGS",
  "com.huawei.android.launcher.permission.WRITE_SETTINGS", "android.permission.READ_APP_BADGE",
  "com.oppo.launcher.permission.READ_SETTINGS", "com.oppo.launcher.permission.WRITE_SETTINGS",
  "me.everything.badger.permission.BADGE_COUNT_READ", "me.everything.badger.permission.BADGE_COUNT_WRITE",
];
/** TeksERP bildirim sesleri (S0): yalnız açık kapıda pakete girer (kapalı derleme BİREBİR app.json); küme `src/push/sesler.ts`. */
const BILDIRIM_SESLERI = ["tekserp_zil", "tekserp_alarm", "tekserp_mekik", "tekserp_dokuma", "tekserp_kisa"].map((s) => `./assets/sounds/${s}.wav`);
const FIREBASE_DOSYASI = "google-services.json";
const EAS_KIMLIGI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPO_SAHIBI = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

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
  const owner = (env.EXPO_OWNER ?? "").trim();
  return {
    ...config,
    ...(EXPO_SAHIBI.test(owner) ? { owner } : {}),
    android: {
      ...android,
      googleServicesFile: `./${FIREBASE_DOSYASI}`,
      blockedPermissions: [...(android.blockedPermissions ?? []).filter((p) => !NATIVE_PUSH_IZINLERI.includes(p)), ...ROZET_IZINLERI],
    },
    plugins: [...(config.plugins ?? []), ["expo-notifications", { sounds: BILDIRIM_SESLERI }]],
    extra: { ...extra, nativePush: true, eas: { ...(extra.eas ?? {}), projectId: k.projectId } },
  };
}

module.exports = ({ config }) => withNativePush(config);
module.exports.withNativePush = withNativePush;
module.exports.pushKapisi = pushKapisi;
module.exports.NATIVE_PUSH_IZINLERI = NATIVE_PUSH_IZINLERI;
module.exports.ROZET_IZINLERI = ROZET_IZINLERI;
module.exports.BILDIRIM_SESLERI = BILDIRIM_SESLERI;
