#!/usr/bin/env node
// =============================================================================
// PATRON ANDROID — Google Play YÜKLEME anahtarı töreni (bir kez) + şifreli yedek
// =============================================================================
//   node scripts/anahtar-uret.mjs            anahtar yoksa üretir: rastgele parola → Anahtar Zinciri
//                                            `tekserp/patron-play-yukleme` → keytool (PKCS12, RSA 4096, 10000 gün)
//                                            ~/.tekserp/patron-android/yukleme/ (700/600). Var olanın ÜSTÜNE YAZMAZ.
//   node scripts/anahtar-uret.mjs --yedek    yükleme dizinini şifreli arşive alır (keystore-yedek.tar.gz.enc,
//                                            AES-256-CBC + PBKDF2 200000, parola = Anahtar Zinciri kaydı) ve açılıp
//                                            aynı baytları verdiğini doğrular.
// Parola hiçbir çıktıya, argv'ye, dosyaya yazılmaz: keytool/openssl'e yalnız alt süreç ortamıyla gider.
// Çıkış: 0 tamam · 1 hata.
// =============================================================================
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import derleme from "./lib/android-derleme.cjs";
import { dur, jdkBul } from "./lib/android-ortam.mjs";
import { kasadanOku, kasaKayitliMi, kasayaYaz } from "../../../scripts/lib/parola-kasasi.mjs";

const { IMZA } = derleme;
const UYGULAMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const YEDEK = path.join(UYGULAMA, "keystore-yedek.tar.gz.enc");
const STORE = path.join(IMZA.dizin, IMZA.storeFile);
const ORTAM = "TEKSERP_PATRON_TOREN_PAROLASI";
const OPENSSL = ["-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-md", "sha256"];

const jdk = jdkBul();
if (!jdk) dur("JDK 17+ bulunamadı", "brew install openjdk@17  ya da  export JAVA_HOME=<yol>");
const keytool = path.join(jdk, "bin", "keytool");
const ozet = (b) => crypto.createHash("sha256").update(b).digest("hex");

function parolaAl() {
  const p = kasadanOku(IMZA.kasa);
  if (!p) dur(`Anahtar Zinciri'nde tekserp/${IMZA.kasa} yok`, "Önce anahtar üretimi: node scripts/anahtar-uret.mjs");
  return p;
}

function sertifikaIzi(parola) {
  const r = spawnSync(keytool, ["-list", "-v", "-keystore", STORE, "-alias", IMZA.alias, "-storepass:env", ORTAM], { env: { ...process.env, [ORTAM]: parola.toString("utf8") }, encoding: "utf8" });
  if (r.status !== 0) dur("keytool anahtarı açamadı (parola ya da dosya uyuşmuyor)", (r.stderr || r.stdout || "").split("\n")[0]);
  return (r.stdout.match(/SHA256:\s*([0-9A-F:]+)/) ?? [])[1] ?? "?";
}

function uret() {
  if (fs.existsSync(STORE)) dur(`Anahtar zaten var: ${STORE}`, "Üstüne yazılmaz (Play yükleme anahtarı değişirse Play Console'dan sıfırlama gerekir).");
  if (kasaKayitliMi(IMZA.kasa)) dur(`Anahtar Zinciri'nde tekserp/${IMZA.kasa} zaten kayıtlı ama anahtar dosyası yok`, "Yedekten geri yükle (keystore-yedek.README.md) — yeni parola eskisinin üstüne yazılmaz.");
  fs.mkdirSync(IMZA.dizin, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(IMZA.dizin), 0o700);
  fs.chmodSync(IMZA.dizin, 0o700);
  const parola = Buffer.from(crypto.randomBytes(24).toString("base64url"), "utf8");
  kasayaYaz(IMZA.kasa, parola);
  const env = { ...process.env, [ORTAM]: parola.toString("utf8") };
  parola.fill(0);
  const r = spawnSync(keytool, ["-genkeypair", "-storetype", "PKCS12", "-keystore", STORE, "-alias", IMZA.alias, "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000",
    "-dname", `CN=${IMZA.cn}, O=Etkili Yazilim, C=TR`, "-storepass:env", ORTAM, "-keypass:env", ORTAM], { env, encoding: "utf8" });
  delete env[ORTAM];
  if (r.status !== 0) dur("keytool anahtar üretemedi", (r.stderr || "").split("\n")[0], `Anahtar Zinciri kaydı tekserp/${IMZA.kasa} yazıldı; dosya yoksa kaydı silip yeniden dene.`);
  fs.chmodSync(STORE, 0o600);
  const p = parolaAl();
  const iz = sertifikaIzi(p);
  p.fill(0);
  console.log(`✓ Yükleme anahtarı üretildi: ${STORE} (600)`);
  console.log(`  alias ${IMZA.alias} · parola Anahtar Zinciri tekserp/${IMZA.kasa} (basılmadı)`);
  console.log(`  sertifika SHA-256: ${iz}`);
  console.log("  Sıradaki: node scripts/anahtar-uret.mjs --yedek");
}

function yedekle() {
  if (!fs.existsSync(STORE)) dur(`Anahtar yok: ${STORE}`);
  const p = parolaAl();
  const env = { ...process.env, [ORTAM]: p.toString("utf8") };
  p.fill(0);
  const tar = spawnSync("tar", ["--no-mac-metadata", "--no-xattrs", "-czf", "-", "-C", path.dirname(IMZA.dizin), path.basename(IMZA.dizin)], { maxBuffer: 64 * 1024 * 1024 });
  if (tar.status !== 0) dur("tar başarısız");
  const gecici = path.join(os.tmpdir(), `patron-yedek-${process.pid}.enc`);
  const enc = spawnSync("openssl", ["enc", ...OPENSSL, "-salt", "-pass", `env:${ORTAM}`, "-out", gecici], { input: tar.stdout, env });
  if (enc.status !== 0) dur("openssl şifreleme başarısız", String(enc.stderr).split("\n")[0]);
  // Doğrula: aç → arşivdeki keystore baytları diskteki ile aynı mı.
  const dec = spawnSync("openssl", ["enc", "-d", ...OPENSSL, "-pass", `env:${ORTAM}`, "-in", gecici], { env, maxBuffer: 64 * 1024 * 1024 });
  delete env[ORTAM];
  if (dec.status !== 0) dur("yedek açılamadı — yazılmadı");
  const acik = spawnSync("tar", ["-xzOf", "-", `${path.basename(IMZA.dizin)}/${IMZA.storeFile}`], { input: dec.stdout, maxBuffer: 64 * 1024 * 1024 });
  if (acik.status !== 0 || ozet(acik.stdout) !== ozet(fs.readFileSync(STORE))) dur("yedekteki anahtar diskteki ile aynı değil — yazılmadı");
  fs.copyFileSync(gecici, YEDEK);
  fs.rmSync(gecici);
  console.log(`✓ Şifreli yedek yazıldı ve açılıp doğrulandı: ${path.relative(process.cwd(), YEDEK)}`);
  console.log(`  arşiv SHA-256: ${ozet(fs.readFileSync(YEDEK))}`);
}

if (process.argv.includes("--yedek")) yedekle();
else uret();
