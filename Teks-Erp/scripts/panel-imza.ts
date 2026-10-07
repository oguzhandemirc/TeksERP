// =============================================================================
// İSTEMCİ SÜRÜM KÜNYESİ İMZASI — panel latest.yml'e (`typ tekserp-panel`) imzalı künye (`tekserp: {v, bildirim, iptal?}`)
// =============================================================================
// Satıcı Mac'inde koşar; özel anahtar CI'a, pakete ve VDS'e GİRMEZ. Panel kod imzası (Authenticode) yokken
// güncellemenin bütünlük kanıtı budur: künyesi doğrulanamayan güncelleme panelde İNDİRİLMEZ ve KURULMAZ.
// Yayın betiği (`deploy/electron-grup-yayinla.sh`) imzasız künyeyi YÜKLEMEZ; bu komutu kendisi çağırır.
//
//   npx tsx scripts/panel-imza.ts imzala --musteri=<kod> [--surum=<x.y.z>] --anahtar=<ist-… dosyası> [--sertifika=<dosya>] [--iptal=<dosya>]
//   npx tsx scripts/panel-imza.ts dogrula --musteri=<kod> [--surum=<x.y.z>]
//   npx tsx scripts/panel-imza.ts anahtar-uret --kid=ist-<yıl>-<n> [--dizin=~/.tekserp/panel-uretim] [--json]
//   npx tsx scripts/panel-imza.ts sertifika-ekle --anahtar=<ist-… .panel.json> --sertifika=<satıcının verdiği dosya> [--kok-dosyasi=<*.kok.json>]
//       Sertifika köke bağlı, ISTEMCI, kid ve x anahtarınkiyle AYNI değilse RED; geçerse anahtarın yanına <kid>.sertifika.json.
//   npx tsx scripts/panel-imza.ts yeniden-imzala --latest=<yayındaki latest.yml> --musteri=<grup> --anahtar=<ist-…> --cikti=<yeni latest.yml>
//                                               [--sertifika=<dosya>] [--kok-dosyasi=<*.kok.json>]
//       Yıllık tören: yük AYNEN, yalnız imzacı/sertifika/imzaZamani yeni; kurulum dosyası gerekmez (paket baytı değişmez).
//   npx tsx scripts/panel-imza.ts anahtar-ac --anahtar=<dosya> [--json]   (yedeğin açılabilirlik ölçümü: kid + x, özel yarı basılmaz)
//   Ortak: [--dizin-paket=<release/<kod>/<sürüm> dizini>] (varsayılan Electron/release/<kod>/<sürüm>)
//          [--capa=<çapa json>]  YALNIZ bekçi — gerçek çapa Electron/electron/guncelleme/imza-capasi.json
//
// Panel künyesi (v:2): `ist-<yıl>-<n>` anahtarı (bu aracın `anahtar-uret`i, parolalı) + kök imzalı ISTEMCI sertifikası
// (`--sertifika`, varsayılan anahtarın yanındaki `<kid>.sertifika.json`); çapa yalnız kökler, sertifikayı çapadaki bir
// kök imzalamadıysa imza YAZILMAZ. `--iptal=<dosya>` (ham JWS) güncel dağıtım iptalini bloğa koyar. Tablet APK
// künyesi ortak tablette yok (K-14; eski kanal aracı `eski-kanal-son` etiketinde). Parola TTY'de gizli istem,
// değilse stdin satırı ya da `--parola-dosyasi=<yol>` (0600, her istenen parola bir satır); argümandan ve ortamdan ASLA
// (`--parola…` çıkış 2). Bitişine 30 günden az kalmış ISTEMCI sertifikasıyla imza YOK (yıllık tören).
// Çıkış: 0 tamam · 1 RED/hata · 2 kullanım.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliError, args, askPassword } from "./lib/cli-girdi";
import {
  DEPO_KOKU,
  attachClientCertificate,
  generatePanelKey,
  publicXOf,
  readPanelKeyPublic,
  resignPanelRelease,
  rootAnchorFromKeyFile,
  openPanelSigningKey,
  readClientCertificate,
  readPanelAnchor,
  readPanelPackage,
  signPanelPackage,
  verifyPanelPackageText,
  writePanelKey,
} from "./lib/panel-imza";

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
  const kok = f.get("kok-dosyasi");
  if (kok) return rootAnchorFromKeyFile(path.resolve(evYolu(kok)));
  const test = f.get("capa");
  if (test) console.error("⚠ TEST ÇAPASI kullanılıyor — yalnız bekçi içindir; yayın kapısı gerçek çapayla yeniden doğrular");
  return test ? readPanelAnchor(path.resolve(test), { test: true }) : readPanelAnchor();
}

async function imzala(f: ReadonlyMap<string, string>): Promise<void> {
  const { dizin, kanal } = paketDizini(f);
  const anchor = capa(f);
  const keyFile = evYolu(gerek(f, "anahtar"));
  const key = await openPanelSigningKey(keyFile, (kid) => askPassword(`Panel künye imza anahtarı (${kid}) parolası: `));
  if (!key.kid.startsWith("ist-")) {
    throw new Error(`panel künyesini (v:2) yalnız ist-* anahtarı imzalar (kök imzalı ISTEMCI sertifikalı); verilen: ${key.kid}`);
  }
  const sertifikaDosyasi = f.get("sertifika");
  const certificate = readClientCertificate({ keyFile, kid: key.kid, ...(sertifikaDosyasi ? { file: evYolu(sertifikaDosyasi) } : {}) });
  const iptalDosyasi = f.get("iptal");
  const iptal = iptalDosyasi ? fs.readFileSync(evYolu(iptalDosyasi), "utf8").trim() : undefined;
  const r = await signPanelPackage({ dir: dizin, kanal, key, certificate, ...(iptal ? { iptal } : {}), anchor });
  console.log(`✓ künye imzalandı · ${kanal} ${r.doc.surum} · ${r.doc.paket.ad} (${r.doc.paket.boyut} B, sha512 ${r.doc.paket.sha512.slice(0, 16)}…) · kid ${key.kid}`);
  console.log(`  latest.yml: ${path.join(dizin, "latest.yml")}`);
}

async function dogrula(f: ReadonlyMap<string, string>): Promise<void> {
  const { dizin, kanal } = paketDizini(f);
  const pkg = readPanelPackage(dizin);
  const r = await verifyPanelPackageText(pkg.latestText, pkg.setupPath, { kanal, anchor: capa(f) });
  if (!r.ok) throw new Error(`künye GEÇERSİZ (${r.code}): ${r.message}`);
  console.log(`✓ künye geçerli · ${kanal} ${r.doc.surum} · kid ${r.kid} · kök ${r.rootKid}`);
}

async function anahtarUret(f: ReadonlyMap<string, string>): Promise<void> {
  const kid = gerek(f, "kid");
  // `panel-<yıl>` yalnız tablet APK künyesini imzalardı (K-14'te kalktı); künye v:2 imzacısı yalnız ist-*.
  if (!kid.startsWith("ist-")) throw new CliError(`--kid ist-<yıl>-<n> biçiminde olmalı: ${kid}`);
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
  console.log(`  Sertifika: kök imzalı ISTEMCI sertifikası ({sertifika: <JWS>}) şuraya konur → ${path.join(dizin, `${k.kid}.sertifika.json`)} (çapa değişmez; panel çapası kökler)`);
  console.log("  ⚠ Parolalı dosyanın kopyası Mac DIŞINDA saklanır (USB + kâğıt; parola ayrı kâğıtta).");
}

async function sertifikaEkle(f: ReadonlyMap<string, string>): Promise<void> {
  const keyFile = evYolu(gerek(f, "anahtar"));
  const certificate = readClientCertificate({ keyFile, kid: readPanelKeyPublic(keyFile).kid, file: evYolu(gerek(f, "sertifika")) });
  const r = attachClientCertificate({ keyFile, certificate, anchor: capa(f) });
  console.log(`✓ ISTEMCI sertifikası ${r.yazildi ? "eklendi" : "zaten ekli (aynı)"} · ${r.kid} · kök ${r.rootKid} · bitiş ${r.bitis.slice(0, 10)}`);
  console.log(`  ${r.file}`);
}

async function yenidenImzala(f: ReadonlyMap<string, string>): Promise<void> {
  const kanal = gerek(f, "musteri");
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(kanal)) throw new CliError(`--musteri kanal kodu biçiminde değil: ${kanal}`);
  const latest = path.resolve(evYolu(gerek(f, "latest")));
  const cikti = path.resolve(evYolu(gerek(f, "cikti")));
  if (fs.existsSync(cikti)) throw new Error(`${cikti} zaten var — üstüne yazılmaz`);
  const anchor = capa(f);
  const keyFile = evYolu(gerek(f, "anahtar"));
  const kid = readPanelKeyPublic(keyFile).kid;
  const sertifikaDosyasi = f.get("sertifika");
  const certificate = readClientCertificate({ keyFile, kid, ...(sertifikaDosyasi ? { file: evYolu(sertifikaDosyasi) } : {}) });
  const key = await openPanelSigningKey(keyFile, (k) => askPassword(`Panel künye imza anahtarı (${k}) parolası: `));
  const r = resignPanelRelease({ latestText: fs.readFileSync(latest, "utf8"), kanal, key, certificate, anchor });
  fs.writeFileSync(cikti, r.text, { flag: "wx", mode: 0o644 });
  console.log(`✓ künye yeniden imzalandı · ${kanal} ${r.doc.surum} · ${r.oncekiKid} → ${r.yeniKid} · paket ${r.doc.paket.ad} (sha512 ${r.doc.paket.sha512.slice(0, 16)}…, değişmedi)`);
  console.log(`  ${cikti}`);
}

async function anahtarAc(f: ReadonlyMap<string, string>): Promise<void> {
  const keyFile = evYolu(gerek(f, "anahtar"));
  const pub = readPanelKeyPublic(keyFile);
  const key = await openPanelSigningKey(keyFile, (k) => askPassword(`Anahtar (${k}) parolası: `));
  const x = publicXOf(key.privateKey);
  if (x !== pub.x || key.kid !== pub.kid) throw new Error(`açılan özel anahtar dosyadaki açık yarıyla uyuşmuyor (${pub.kid})`);
  if (f.has("json")) console.log(JSON.stringify({ v: 1, kid: key.kid, x, acildi: true }));
  else console.log(`✓ ${key.kid} açıldı · x=${x}`);
}

async function main(): Promise<void> {
  // Parola taşıyan argüman (`--parola=…` · `--password` …) değerine bakılmadan reddedilir.
  const { command, flags } = args(process.argv.slice(2));
  if (command === "imzala") return imzala(flags);
  if (command === "dogrula") return dogrula(flags);
  if (command === "anahtar-uret") return anahtarUret(flags);
  if (command === "sertifika-ekle") return sertifikaEkle(flags);
  if (command === "yeniden-imzala") return yenidenImzala(flags);
  if (command === "anahtar-ac") return anahtarAc(flags);
  throw new CliError("komut: imzala | dogrula | anahtar-uret | sertifika-ekle | yeniden-imzala | anahtar-ac");
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof CliError ? 2 : 1);
});
