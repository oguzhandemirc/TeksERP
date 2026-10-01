// =============================================================================
// İSTEMCİ SÜRÜM KÜNYESİ İMZASI — panel latest.yml'e (`typ tekserp-panel`) · tablet apk/surum.json'a (`typ tekserp-apk`)
// imzalı künye (`tekserp: {v, bildirim}`)
// =============================================================================
// Satıcı Mac'inde koşar; özel anahtar CI'a, pakete ve VDS'e GİRMEZ. Panel kod imzası (Authenticode) yokken
// güncellemenin bütünlük kanıtı budur: künyesi doğrulanamayan güncelleme panelde İNDİRİLMEZ ve KURULMAZ.
// Yayın betiği (`deploy/electron-yayinla.sh`) imzasız künyeyi YÜKLEMEZ; bu komutu kendisi çağırır.
//
//   npx tsx scripts/panel-imza.ts imzala --musteri=<kod> [--surum=<x.y.z>] --anahtar=<dosya>
//   npx tsx scripts/panel-imza.ts dogrula --musteri=<kod> [--surum=<x.y.z>]
//   npx tsx scripts/panel-imza.ts anahtar-uret --kid=panel-<yıl>[-<n>] [--dizin=~/.tekserp/panel-uretim] [--json]
//   npx tsx scripts/panel-imza.ts apk-imzala --musteri=<kod> --apk=<yol.apk> --kunye=<surum.json> --anahtar=<dosya>
//   npx tsx scripts/panel-imza.ts apk-dogrula --musteri=<kod> --apk=<yol.apk> --kunye=<surum.json>
//   (apk-*: surum.json'u `deploy/mobil-yayinla.mjs` yazar ve bu komutu kendisi çağırır; çapa mobil/src/lib/apk-imza-capasi.json)
//   Ortak: [--dizin-paket=<release/<kod>/<sürüm> dizini>] (varsayılan Electron/release/<kod>/<sürüm>)
//          [--capa=<çapa json>]  YALNIZ bekçi — gerçek çapa Electron/electron/guncelleme/imza-capasi.json
//
// Anahtar: (a) üretim PAKET anahtarı (`paket-<yıl>`, build-korumali-imza.ts ile üretilmiş, parolalı) ya da
// (b) ayrı panel yayın anahtarı (`panel-<yıl>`, bu aracın `anahtar-uret`i, parolalı). Hangisi olduğuna çapa karar
// verir (anahtarın kid'i çapada değilse imza YAZILMAZ). Parola TTY'de gizli istem, değilse stdin satırı; argümandan
// ve ortamdan ASLA (`--parola…` çıkış 2).
// Çıkış: 0 tamam · 1 RED/hata · 2 kullanım.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliError, args, askPassword } from "./lib/cli-girdi";
import {
  DEPO_KOKU,
  generatePanelKey,
  openPanelSigningKey,
  readPanelAnchor,
  readPanelPackage,
  signPanelPackage,
  verifyPanelPackageText,
  writePanelKey,
} from "./lib/panel-imza";
import { TABLET_ANCHOR_FILE, signApkPackage, verifyApkPackage } from "./lib/apk-imza";

const evYolu = (p: string): string => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

function gerek(f: ReadonlyMap<string, string>, ad: string): string {
  const v = f.get(ad);
  if (!v) throw new CliError(`--${ad}=… gerekli`);
  return v;
}

function paketDizini(f: ReadonlyMap<string, string>): { dizin: string; kanal: string } {
  const kanal = gerek(f, "musteri");
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(kanal)) throw new CliError(`--musteri kanal kodu biçiminde değil: ${kanal}`);
  const verilen = f.get("dizin-paket");
  if (verilen) return { dizin: path.resolve(verilen), kanal };
  const pkg = JSON.parse(fs.readFileSync(path.join(DEPO_KOKU, "Electron", "package.json"), "utf8")) as { version: string };
  return { dizin: path.join(DEPO_KOKU, "Electron", "release", kanal, f.get("surum") ?? pkg.version), kanal };
}

function capa(f: ReadonlyMap<string, string>) {
  const test = f.get("capa");
  if (test) console.error("⚠ TEST ÇAPASI kullanılıyor — yalnız bekçi içindir; yayın kapısı gerçek çapayla yeniden doğrular");
  return test ? readPanelAnchor(path.resolve(test), { test: true }) : readPanelAnchor();
}

async function imzala(f: ReadonlyMap<string, string>): Promise<void> {
  const { dizin, kanal } = paketDizini(f);
  const anchor = capa(f);
  const key = await openPanelSigningKey(evYolu(gerek(f, "anahtar")), (kid) => askPassword(`Panel künye imza anahtarı (${kid}) parolası: `));
  if (!anchor.some((k) => k.kid === key.kid)) {
    throw new Error(`anahtar ${key.kid} panel imza çapasında YOK — bununla imzalanan sürümü hiçbir panel kurmaz (önce guven-capasi-ekle.ts panel)`);
  }
  const r = await signPanelPackage({ dir: dizin, kanal, key, anchor });
  console.log(`✓ künye imzalandı · ${kanal} ${r.doc.surum} · ${r.doc.paket.ad} (${r.doc.paket.boyut} B, sha512 ${r.doc.paket.sha512.slice(0, 16)}…) · kid ${key.kid}`);
  console.log(`  latest.yml: ${path.join(dizin, "latest.yml")}`);
}

async function dogrula(f: ReadonlyMap<string, string>): Promise<void> {
  const { dizin, kanal } = paketDizini(f);
  const pkg = readPanelPackage(dizin);
  const r = await verifyPanelPackageText(pkg.latestText, pkg.setupPath, { kanal, anchor: capa(f) });
  if (!r.ok) throw new Error(`künye GEÇERSİZ (${r.code}): ${r.message}`);
  console.log(`✓ künye geçerli · ${kanal} ${r.doc.surum} · kid ${r.kid}`);
}

async function anahtarUret(f: ReadonlyMap<string, string>): Promise<void> {
  const kid = gerek(f, "kid");
  const dizin = path.resolve(evYolu(f.get("dizin") ?? "~/.tekserp/panel-uretim"));
  const hedef = path.join(dizin, `${kid}.panel.json`);
  if (fs.existsSync(hedef)) throw new Error(`${hedef} zaten var — rotasyon yeni kid ile yapılır`);
  const first = await askPassword(`Yeni panel yayın anahtarı (${kid}) parolası: `);
  const second = await askPassword("Parola (tekrar): ");
  const same = first.length === second.length && first.equals(second);
  second.fill(0);
  let file: string;
  try {
    if (!same) throw new Error("Parolalar eşleşmedi");
    file = writePanelKey(dizin, await generatePanelKey(kid, first));
  } finally {
    first.fill(0);
  }
  const k = JSON.parse(fs.readFileSync(file, "utf8")) as { kid: string; x: string };
  if (f.has("json")) {
    console.log(JSON.stringify({ v: 1, kid: k.kid, x: k.x, dosya: file }));
    return;
  }
  console.log(`✓ ${file} (0600, parolalı — kök/PAKET dosyasıyla aynı sarma)`);
  console.log(`  Çapaya ekle: cd Teks-Erp && npx tsx scripts/guven-capasi-ekle.ts panel --dosya=${file}   (KURU; sonra --yaz)`);
  console.log("  ⚠ Parolalı dosyanın kopyası Mac DIŞINDA saklanır (USB + kâğıt; parola ayrı kâğıtta).");
}

function apkGirdisi(f: ReadonlyMap<string, string>) {
  const kanal = gerek(f, "musteri");
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(kanal)) throw new CliError(`--musteri kanal kodu biçiminde değil: ${kanal}`);
  const test = f.get("capa");
  if (test) console.error("⚠ TEST ÇAPASI kullanılıyor — yalnız bekçi içindir; yayın kapısı gerçek çapayla yeniden doğrular");
  const anchor = test ? readPanelAnchor(path.resolve(test), { test: true }) : readPanelAnchor(TABLET_ANCHOR_FILE);
  return { kanal, apk: path.resolve(gerek(f, "apk")), kunye: path.resolve(gerek(f, "kunye")), anchor };
}

async function apkImzala(f: ReadonlyMap<string, string>): Promise<void> {
  const { kanal, apk, kunye, anchor } = apkGirdisi(f);
  const key = await openPanelSigningKey(evYolu(gerek(f, "anahtar")), (kid) => askPassword(`Tablet APK künyesi imza anahtarı (${kid}) parolası: `));
  const r = await signApkPackage({ apk, kunye, kanal, key, anchor });
  console.log(`✓ APK künyesi imzalandı · ${kanal} ${r.doc.versionName} (vc ${r.doc.versionCode}) · ${r.doc.paket.ad} (${r.doc.paket.boyut} B, sha256 ${r.doc.paket.sha256.slice(0, 16)}…) · kid ${key.kid}`);
}

async function apkDogrula(f: ReadonlyMap<string, string>): Promise<void> {
  const { kanal, apk, kunye, anchor } = apkGirdisi(f);
  const r = await verifyApkPackage(JSON.parse(fs.readFileSync(kunye, "utf8")) as unknown, apk, { kanal, anchor });
  if (!r.ok) throw new Error(`APK künyesi GEÇERSİZ (${r.code}): ${r.message}`);
  console.log(`✓ APK künyesi geçerli · ${kanal} ${r.doc.versionName} (vc ${r.doc.versionCode}) · kid ${r.kid}`);
}

async function main(): Promise<void> {
  // Parola taşıyan argüman (`--parola=…` · `--password` …) değerine bakılmadan reddedilir.
  const { command, flags } = args(process.argv.slice(2));
  if (command === "imzala") return imzala(flags);
  if (command === "dogrula") return dogrula(flags);
  if (command === "anahtar-uret") return anahtarUret(flags);
  if (command === "apk-imzala") return apkImzala(flags);
  if (command === "apk-dogrula") return apkDogrula(flags);
  throw new CliError("komut: imzala | dogrula | anahtar-uret | apk-imzala | apk-dogrula");
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof CliError ? 2 : 1);
});
