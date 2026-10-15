#!/usr/bin/env node
// =============================================================================
// PATRON ANDROID — imzalı release paketi (Google Play AAB; duman için APK)
// =============================================================================
//   npm run build:aab          prebuild --clean → ./gradlew bundleRelease → doğrula → ~/.tekserp/patron-android/cikti/
//   npm run build:apk:duman    aynı yol, assembleRelease (emülatörde duman; mağazaya gitmez, dağıtılmaz)
// İmza: YÜKLEME anahtarı (scripts/lib/android-derleme.cjs; repo dışında, parola Anahtar Zinciri'nden — hiçbir çıktıya
// basılmaz, yalnız Gradle/keytool alt sürecinin ortamına gider; Gradle daemon'da kalmasın diye --no-daemon).
// Bulut adresi derlemeye açıkça gömülür (EXPO_PUBLIC_PATRON_API) ve `.env*` dosyaları okunmaz (EXPO_NO_DOTENV=1).
// Doğrulama: birleşik manifest (paket · sürüm · izinler · Firebase/bildirim bileşeni yok), JS paketinde adres,
// imzanın yükleme sertifikası olması. Çıkış: 0 tamam · 1 hata.
// =============================================================================
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import derleme from "./lib/android-derleme.cjs";
import { buildTool, dur, jdkBul, sdkBul } from "./lib/android-ortam.mjs";
import { kasadanOku } from "../../../scripts/lib/parola-kasasi.mjs";

const { PATRON_API, GORUNEN_AD, CIKTI_ONEKI, IMZA, CIKTI_DIZINI, ORTAM_DOSYA, ORTAM_PAROLA } = derleme;
const UYGULAMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ANDROID = path.join(UYGULAMA, "android");
const APK = process.argv.includes("--apk");
const GOREV = APK ? "assembleRelease" : "bundleRelease";
const STORE = path.join(IMZA.dizin, IMZA.storeFile);
/** Birleşik manifestte bulunmasına izin verilen tek izin kümesi (fazlası Play formu ve en az yetki ihlali). */
const YASAK_BILESEN = /firebase|expo\.modules\.notifications|c2dm/i;

const app = JSON.parse(fs.readFileSync(path.join(UYGULAMA, "app.json"), "utf8")).expo;
const PAKET = app.android.package;
// AndroidX'in uygulamaya özel imza izni paket adını taşır: literal yazılmaz, paketten türer (paket adı değişince kırılmasın).
const IZINLI_IZINLER = ["android.permission.INTERNET", `${PAKET}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`];
const SURUM = app.version;
const KOD = app.android.versionCode;
const baslik = (t) => console.log(`\n── ${t}`);
const sha256 = (y) => crypto.createHash("sha256").update(fs.readFileSync(y)).digest("hex");

// (0) Ortam + anahtar
const jdk = jdkBul();
if (!jdk) dur("JDK 17+ bulunamadı", "brew install openjdk@17  ya da  export JAVA_HOME=<yol>");
const sdk = sdkBul();
if (!sdk) dur("Android SDK bulunamadı (~/Library/Android/sdk)", "export ANDROID_HOME=<yol>");
if (app.name !== GORUNEN_AD) dur(`app.json expo.name "${app.name}" ≠ "${GORUNEN_AD}" (scripts/lib/android-derleme.cjs)`);
if (!Number.isInteger(KOD) || KOD < 1 || !/^\d+\.\d+\.\d+$/.test(String(SURUM))) dur("app.json: version X.Y.Z ve android.versionCode ≥ 1 olmalı");
if (!fs.existsSync(STORE)) dur(`Yükleme anahtarı yok: ${STORE}`, "Yedekten geri yükle (keystore-yedek.README.md) ya da ilk kez: node scripts/anahtar-uret.mjs");
for (const [y, beklenen] of [[path.dirname(IMZA.dizin), 0o700], [IMZA.dizin, 0o700], [STORE, 0o600]]) {
  const kip = fs.statSync(y).mode & 0o777;
  if (kip & ~beklenen) dur(`${y} izni ${kip.toString(8)} — en çok ${beklenen.toString(8)} olmalı (chmod ${beklenen.toString(8)})`);
}
const parola = kasadanOku(IMZA.kasa);
if (!parola) dur(`Anahtar Zinciri'nde tekserp/${IMZA.kasa} yok`, `Kaydet: node scripts/parola-kaydet.mjs ${IMZA.kasa} (repo kökünde)`);
const imzaEnv = { [ORTAM_DOSYA]: STORE, [ORTAM_PAROLA]: parola.toString("utf8") };
parola.fill(0);
const javaEnv = { ...process.env, JAVA_HOME: jdk, PATH: `${path.join(jdk, "bin")}${path.delimiter}${process.env.PATH ?? ""}` };
const liste = spawnSync(path.join(jdk, "bin", "keytool"), ["-list", "-v", "-keystore", STORE, "-alias", IMZA.alias, "-storepass:env", ORTAM_PAROLA], { env: { ...javaEnv, ...imzaEnv }, encoding: "utf8" });
if (liste.status !== 0) dur("Yükleme anahtarı açılamadı (Anahtar Zinciri parolası ya da dosya uyuşmuyor)");
const SERTIFIKA = ((liste.stdout.match(/SHA256:\s*([0-9A-F:]+)/) ?? [])[1] ?? "").replace(/:/g, "").toLowerCase();
console.log(`Paket ${PAKET} · sürüm ${SURUM} (versionCode ${KOD}) · ${GOREV}`);
console.log(`Bulut adresi: ${PATRON_API} · JDK ${jdk} · SDK ${sdk}`);
console.log(`Yükleme sertifikası SHA-256: ${SERTIFIKA}`);

// (1) Prebuild — android/ git dışıdır; her derleme temiz üretilir (sürüm kimliği app.json'dan, elde kalan klasörden değil).
// Metro dönüşüm önbelleği EXPO_PUBLIC_* değerini anahtarına katmaz: ortak $TMPDIR/metro-cache eski bulut adresini
// pakete gömdü (ölçüldü 2026-10-16). Her derleme kendi boş TMPDIR'iyle — ortak önbelleğe dokunmadan, çıkışta silinir.
const metroTmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-yonetim-derleme-"));
process.on("exit", () => fs.rmSync(metroTmp, { recursive: true, force: true }));
const derlemeEnv = { ...javaEnv, TMPDIR: metroTmp, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, EXPO_PUBLIC_PATRON_API: PATRON_API, EXPO_NO_DOTENV: "1", EXPO_NO_TELEMETRY: "1", CI: "1", NODE_ENV: "production" };
baslik("(1/3) expo prebuild --platform android --clean");
const pb = spawnSync("npx", ["expo", "prebuild", "--platform", "android", "--clean", "--no-install"], { cwd: UYGULAMA, stdio: "inherit", env: derlemeEnv });
if (pb.status !== 0) dur("prebuild başarısız");

// (2) Gradle — parola yalnız bu alt sürecin ortamında.
baslik(`(2/3) ./gradlew --no-daemon ${GOREV}`);
const gr = spawnSync(path.join(ANDROID, "gradlew"), ["--no-daemon", GOREV], { cwd: ANDROID, stdio: "inherit", env: { ...derlemeEnv, ...imzaEnv } });
delete imzaEnv[ORTAM_PAROLA];
if (gr.status !== 0) dur(`Gradle ${GOREV} başarısız (exit ${gr.status})`);

// (3) Doğrulama
baslik("(3/3) Doğrulama");
const cikti = APK ? path.join(ANDROID, "app/build/outputs/apk/release/app-release.apk") : path.join(ANDROID, "app/build/outputs/bundle/release/app-release.aab");
if (!fs.existsSync(cikti)) dur(`Çıktı yok: ${cikti}`);
const sorunlar = [];

const manifestYolu = path.join(ANDROID, "app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml");
const manifestAday = fs.existsSync(manifestYolu) ? manifestYolu : bul(path.join(ANDROID, "app/build/intermediates"), (y) => /merged_manifests?\/release\/.*AndroidManifest\.xml$/.test(y));
if (!manifestAday) sorunlar.push("birleşik manifest bulunamadı");
const izinler = [];
if (manifestAday) {
  const m = fs.readFileSync(manifestAday, "utf8");
  const etiket = m.match(/<manifest[^>]*>/)?.[0] ?? "";
  const nitelik = (ad) => etiket.match(new RegExp(`${ad}="([^"]+)"`))?.[1];
  if (nitelik("package") !== PAKET) sorunlar.push(`paket ${nitelik("package")} ≠ ${PAKET}`);
  if (nitelik("android:versionCode") !== String(KOD)) sorunlar.push(`versionCode ${nitelik("android:versionCode")} ≠ ${KOD}`);
  if (nitelik("android:versionName") !== SURUM) sorunlar.push(`versionName ${nitelik("android:versionName")} ≠ ${SURUM}`);
  for (const [, ad] of m.matchAll(/<uses-permission(?:-sdk-23)?\s[^>]*android:name="([^"]+)"/g)) izinler.push(ad);
  const fazla = izinler.filter((i) => !IZINLI_IZINLER.includes(i));
  if (fazla.length) sorunlar.push(`izinli olmayan izin: ${fazla.join(", ")}`);
  const bilesen = [...m.matchAll(/<(?:service|receiver|provider)\b[^>]*?android:name="([^"]+)"/g)].map((x) => x[1]).filter((ad) => YASAK_BILESEN.test(ad));
  if (bilesen.length) sorunlar.push(`bildirim/Firebase bileşeni pakette: ${bilesen.join(", ")}`);
  if (/android:allowBackup="true"/.test(m)) sorunlar.push("allowBackup açık (önbellek yedeğe girmemeli)");
  // Görünen ad: uygulama etiketi @string/app_name → prebuild'in yazdığı strings.xml (kaynak app.json expo.name).
  const etiketRef = m.match(/<application\b[^>]*android:label="([^"]+)"/)?.[1];
  const strings = path.join(ANDROID, "app/src/main/res/values/strings.xml");
  const adDegeri = fs.existsSync(strings) ? fs.readFileSync(strings, "utf8").match(/<string name="app_name">([^<]*)<\/string>/)?.[1] : undefined;
  if (etiketRef !== "@string/app_name" || adDegeri !== GORUNEN_AD) sorunlar.push(`uygulama etiketi ${etiketRef ?? "YOK"} = "${adDegeri ?? "?"}" ≠ "${GORUNEN_AD}"`);
}

const js = zipGirdisi(cikti, APK ? "assets/index.android.bundle" : "base/assets/index.android.bundle");
if (!js) sorunlar.push("JS paketi (index.android.bundle) okunamadı");
else {
  if (!js.includes(Buffer.from(PATRON_API))) sorunlar.push(`JS paketinde bulut adresi (${PATRON_API}) yok`);
  // RN'in kendi "localhost:8081" geliştirme dizgesi kütüphanededir; aranan bizim geliştirme/CI adreslerimiz.
  for (const yasak of ["patron.ornek.invalid", "localhost:4620", "127.0.0.1:4620"]) if (js.includes(Buffer.from(yasak))) sorunlar.push(`JS paketinde geliştirme adresi: ${yasak}`);
}

const imza = spawnSync(path.join(jdk, "bin", "keytool"), ["-printcert", "-jarfile", cikti], { env: javaEnv, encoding: "utf8" });
const imzaIzi = ((imza.stdout.match(/SHA256:\s*([0-9A-F:]+)/) ?? [])[1] ?? "").replace(/:/g, "").toLowerCase();
if (APK) {
  const apksigner = buildTool(sdk, "apksigner");
  const v = apksigner ? spawnSync(apksigner, ["verify", "--print-certs", cikti], { env: javaEnv, encoding: "utf8" }) : null;
  const iz = (v?.stdout.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/) ?? [])[1] ?? "";
  if (!v || v.status !== 0 || iz !== SERTIFIKA) sorunlar.push(`APK imzası yükleme sertifikası değil (${iz || "doğrulanamadı"})`);
} else if (imzaIzi !== SERTIFIKA) sorunlar.push(`AAB imzası yükleme sertifikası değil (${imzaIzi || "imzasız"})`);

if (sorunlar.length) dur("DOĞRULAMA KIRMIZI — paket kopyalanmadı", ...sorunlar);

fs.mkdirSync(CIKTI_DIZINI, { recursive: true, mode: 0o700 });
const ad = `${CIKTI_ONEKI}-${SURUM}-vc${KOD}.${APK ? "duman.apk" : "aab"}`;
const hedef = path.join(CIKTI_DIZINI, ad);
fs.copyFileSync(cikti, hedef);
const ozet = sha256(hedef);
fs.writeFileSync(`${hedef}.sha256`, `${ozet}  ${ad}\n`);
console.log(`✓ ${hedef}`);
console.log(`  SHA-256 ${ozet} · ${(fs.statSync(hedef).size / 1048576).toFixed(1)} MB`);
console.log(`  izinler: ${izinler.join(", ") || "(yok)"}`);
console.log(`  imza: yükleme sertifikası ${SERTIFIKA.slice(0, 16)}…`);

function bul(kok, yuklem) {
  if (!fs.existsSync(kok)) return null;
  for (const g of fs.readdirSync(kok, { withFileTypes: true })) {
    const y = path.join(kok, g.name);
    if (g.isDirectory()) {
      const r = bul(y, yuklem);
      if (r) return r;
    } else if (yuklem(y)) return y;
  }
  return null;
}

/** ZIP içinden tek girdi (unzip -p); yoksa null. */
function zipGirdisi(zip, girdi) {
  const r = spawnSync("unzip", ["-p", zip, girdi], { maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 && r.stdout.length > 0 ? r.stdout : null;
}
