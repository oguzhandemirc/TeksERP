// =============================================================================
// KORUMALI PAKET İMZASI — PAKET anahtarıyla imzalı dosya listesi (Faz 2e)
// =============================================================================
// Satıcı Mac'inde koşar; imza anahtarı CI'a ve pakete GİRMEZ. Kapsam: src/lib/license/integrity-scope.ts.
//
//   npx tsx scripts/build-korumali-imza.ts anahtar-uret --kid=paket-<yıl>[-<n>]|pkt-<yıl>-<n> [--dizin=~/.tekserp/satici-uretim] [--json]
//       ÜRETİM (tören): parolalı (kök dosyasıyla aynı sarma, `protocol/anahtar-sarma.ts`); parola iki kez — TTY'de
//       gizli istem, TTY yoksa stdin'in ilk iki satırı. Çıktı `<dizin>/<kid>.paket.json` (0600, var olanı ezmez).
//   npx tsx scripts/build-korumali-imza.ts sertifika-ekle --anahtar=<pkt dosyası> --sertifika=<dosya> [--kok-dosyasi=<kök.json>]
//       Kök imzalı PAKET sertifikasını (satıcı `anahtar.ts paket-sertifika-uret`) anahtarın yanına `<kid>.sertifika.json`
//       olarak koyar; kök + PAKET kullanımı + kid + x eşleşmesi denetlenir, parola sorulmaz.
//   npx tsx scripts/build-korumali-imza.ts imzala --kok=<paket dizini> --anahtar=<dosya> --surum=<x.y.z>
//       [--urun=backend] [--musteri=<kod>] [--kurulum=<uuid>] [--derleme-tarihi=<ISO>]
//   npx tsx scripts/build-korumali-imza.ts zip --zip=<paket.zip> --anahtar=<dosya> [--kurulum=<uuid>] [--surum-belgesi=<md>]
//       [--ci-kosu=<korumali-paket.yml koşu numarası> | --derleme-kunyesi=<zip>.derleme.json | --ci-atla="<kullanıcının onay cümlesi>"]
//       (ÜRETİM anahtarında biri ZORUNLU, ikisi birlikte RED)
//   (`imzala`/`zip` ortak) [--zincir-anahtar=<pkt dosyası>] çift imza: `butunluk.jws` (paket-*) + `butunluk-zincir.jws`
//       (pkt-*, aynı yük); `--anahtar=<pkt dosyası>` tek başına zincir-yalnız; [--paket-iptal=<kök imzalı iptal>] yalnız
//       zincirli pakette `paket-iptal.jws`; [--kok-dosyasi=<kök.json>] çapa; iki parola sırayla. Sertifikanın bitişine
//       30 günden az kaldıysa imza YOK (parola sorulmadan).
//   npx tsx scripts/build-korumali-imza.ts belge --belge=<PAKET-DOCKER.json> --anahtar=<dosya> [--kok-dosyasi=<kök.json>]
//       Docker teslim künyesi → <belge>.jws; `pkt-*` anahtarda zincirli (yanındaki kök imzalı sertifika yüke girer).
//   npx tsx scripts/build-korumali-imza.ts anahtar-ac --anahtar=<dosya> [--json]   (parolayla açar, yazmaz: yedek ölçümü)
//
// `zip` kipi: zip'i açar, sürüm/müşteri/derleme künyesini PAKET.json + dist/server-kunye.json'dan okur,
// imzalar, imza dosyalarını + `butunluk-liste.txt`i ekler ve PAKET.json'daki dosya sayısını yazılan dosya kadar
// artırır (kur.ps1 sayım kapısı); `butunlukKid` birincil, `butunlukZincirKid` zincirli imzanın kid'i.
// Anahtar üretimi yalnız üretim ailesidir (`paket-<yıl>`, parolalı); parolasız anahtar yalnız bekçilerin test anahtarıdır.
// Anahtar AİLESİ derlemenin çapa kipine uymalı (G3, `dist/server-kunye.json` `guvenCapasi`): tek kip `uretim`, pakete
// yalnız `paket-<yıl>`; başka kip (eski `hazirlik`) ya da başka aile parola sorulmadan RED (paket açılışta imzalı
// listeyi tanımaz, çekirdeksiz kalırdı).
// CI KÖKENİ (G22/ALT-9): `.jsc` CI'da derlenir, Mac gözle denetleyemez — üretim anahtarıyla (`paket-<yıl>`) imza
// `--ci-kosu=<id>` ister ve parola sorulmadan ÖNCE koşu ölçülür: `korumali-paket.yml`, başarıyla bitmiş, `main`
// dalı, commit'i yapıtın künyesindeki (`dist/server-kunye.json`) ve PAKET.json'unki (`scripts/lib/ci-kokeni.ts`).
// Üretim dışı (test) anahtarda koşu verilirse ölçülür (dal serbest), verilmezse uyarı basılır.
// KAÇIŞ (kullanıcı kararı 2026-10-01): koşu YOKKEN üretim imzası yalnız `--ci-atla="<kullanıcının cümlesi>"` ile;
// cümle + saat + makine + HEAD imzalı yüke (`ciKokeni`) girer, yayıncı (`deploy/backend-yayinla.mjs`) uyarır ve
// defterine yazar. Üretim dışı (test) anahtarda `--ci-atla` RED (kaçış gerekmez).
// THINKPAD KÖKENİ (kullanıcı kararı 2026-10-08): kayıtlı ikinci derleme kökeni thinkpad-1 — `zip` kipinde
// `--derleme-kunyesi=<zip>.derleme.json` (`deploy/korumali-thinkpad.sh` yazar) parola sorulmadan ÖNCE yapıtla çapraz
// ölçülür (`scripts/lib/thinkpad-kokeni.ts`); tutarsa kaçış cümlesi GEREKMEZ, kayıt (`ciKokeni.kip = "thinkpad"`) imzalı yüke girer.
// Parolalı anahtarla imzada (`imzala` · `zip` · `belge`) parola TTY'den ya da stdin'in satırından sorulur;
// parola argümandan/ortamdan ASLA alınmaz (`--parola…` biçimli argüman çıkış 2 ile reddedilir).
// =============================================================================
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generateWrappedPackageKey,
  openPackageKey,
  packageKeyInfo,
  signManifestDocument,
  isProductionSigningKid,
  signPackageDirectory,
  writePackageKey,
  type OpenedPackageKey,
} from "./lib/butunluk-imza";
import {
  assertPackageCertificateFresh,
  attachPackageCertificate,
  certificateTokenFromFile,
  packageRoots,
  readPackageCertificate,
  readPackageRevocationFile,
  type PackageRoots,
} from "./lib/paket-sertifika";
import { CHAINED_INTEGRITY_FILE, PACKAGE_REVOCATION_FILE, isChainPackageKid } from "../src/lib/license/protocol/paket-zinciri";
import { CliError, args, askPassword } from "./lib/cli-girdi";
import { git } from "./lib/git";
import { type CiKokeniKaydi, ciAtlaHukmu, ciKokeniHukmu, ciKosusuOku } from "./lib/ci-kokeni";
import { RUST_PARCALARI, type ThinkpadKaydi, anaDaldaMi, betikBlobSha256, thinkpadKaydi, thinkpadKokeniHukmu } from "./lib/thinkpad-kokeni";
import { INTEGRITY_FILE, isProductionChainPackageKid } from "../src/lib/license/integrity-scope";
import { INTEGRITY_LIST_FILE } from "../src/lib/license/integrity-list";
import { istanbulSaati } from "../../scripts/lib/kullanici-cumlesi.mjs";

function arg(name: string): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : null;
}
/** Verilmediyse undefined; çıplak `--ad` ya da `--ad=` boş dize (boş kaçış cümlesi sessizce "yok" sayılmaz). */
function argVar(name: string): string | undefined {
  const p = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return p === undefined ? undefined : p.slice(name.length + 3);
}
function need(name: string): string {
  const v = arg(name);
  if (!v) throw new Error(`--${name}=… gerekli`);
  return v;
}
function home(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}
function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) as Record<string, unknown>;
}

/** Depo kökü: üretim anahtarı bunun içine yazılmaz (yanlışlıkla commit'lenmesin). */
const DEPO_KOKU = path.resolve(__dirname, "..", "..");

function icinde(dizin: string, kok: string): boolean {
  const rel = path.relative(kok, dizin);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function keygen(): Promise<void> {
  const kid = arg("kid");
  if (typeof kid !== "string") throw new Error("--kid=paket-<yıl>[-<n>] | pkt-<yıl>-<n> zorunlu (parolasız hazırlık anahtarı kalktı)");
  if (!isProductionSigningKid(kid)) throw new Error(`kid biçimi: paket-<yıl>[-<n>] (gömülü çapa) ya da pkt-<yıl>-<n> (kök sertifikalı), parolalı: ${kid}`);
  const dir = path.resolve(home(arg("dizin") ?? "~/.tekserp/satici-uretim"));
  if (icinde(dir, DEPO_KOKU)) throw new Error(`üretim PAKET anahtarı depo içine yazılmaz: ${dir}`);
  const hedef = path.join(dir, `${kid}.paket.json`);
  if (fs.existsSync(hedef)) throw new Error(`${hedef} zaten var — rotasyon yeni kid ile yapılır`);
  const first = await askPassword(`Yeni PAKET anahtarı (${kid}) parolası: `);
  const second = await askPassword("Parola (tekrar): ");
  const same = first.length === second.length && first.equals(second);
  second.fill(0);
  let file: string;
  try {
    if (!same) throw new Error("Parolalar eşleşmedi");
    file = writePackageKey(dir, await generateWrappedPackageKey(kid, first));
  } finally {
    first.fill(0);
  }
  const k = packageKeyInfo(file);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ v: 1, kid: k.kid, x: k.x, dosya: file, parolali: k.parolali }));
    return;
  }
  console.log(`✓ ${file} (0600, parolalı — kök dosyasıyla aynı sarma)`);
  if (isProductionChainPackageKid(k.kid)) {
    console.log(`  Açık yarı: { kid: "${k.kid}", x: "${k.x}" } — çapaya EKLENMEZ; kök PAKET sertifikası basar (satıcı \`anahtar.ts paket-sertifika-uret\`),`);
    console.log(`  sonra: npx tsx scripts/build-korumali-imza.ts sertifika-ekle --anahtar=${file} --sertifika=<dosya>`);
    console.log("  ⚠ Parolalı dosyanın kopyası Mac DIŞINDA saklanır (USB + kâğıt; parola ayrı kâğıtta).");
    return;
  }
  console.log(`  PACKAGE_PUBLIC_KEYS girdisi: { kid: "${k.kid}", x: "${k.x}" }`);
  console.log(`  Çapaya ekle: cd Teks-Erp && npx tsx scripts/guven-capasi-ekle.ts paket --dosya=${file}   (KURU; sonra --yaz)`);
  console.log("  ⚠ Parolalı dosyanın kopyası Mac DIŞINDA saklanır (USB + kâğıt; parola ayrı kâğıtta).");
}

const paketParolasi = (kid: string): Promise<Buffer> => askPassword(`PAKET anahtarı (${kid}) parolası: `);

/** Kök çapası: tören kök dosyası (`--kok-dosyasi`) > bekçi test çapası (`--kok-capa` / ortam) > üretim kökleri. */
function kokCapasi(): PackageRoots {
  const kokDosyasi = arg("kok-dosyasi");
  const testCapa = arg("kok-capa");
  return packageRoots({ kokDosyasi: kokDosyasi ? home(kokDosyasi) : null, testCapa: testCapa ? home(testCapa) : null });
}

interface DirOptions {
  readonly root: string;
  /** Birincil anahtar: `paket-*` (→ `butunluk.jws`) ya da `pkt-*` (zincir-yalnız → `butunluk-zincir.jws`). */
  readonly keyFile: string;
  /** Çift imzanın zincir anahtarı (`pkt-*`); birincil `paket-*` olmalı. */
  readonly zincirKeyFile: string | null;
  readonly surum: string;
  readonly musteri: string | null;
  /** PAKET.json `commit` (zip kipinde); dizin imzasında null. */
  readonly paketCommit?: string | null;
  /** Zip kipinde imzadan ÖNCE ölçülen zip özeti + PAKET.json (thinkpad kökeni); dizin imzasında yok. */
  readonly zipOlcumu?: { readonly zipSha256: string; readonly paket: Record<string, unknown> } | null;
}

interface DirResult {
  readonly kid: string;
  readonly zincirKid: string | null;
  /** Paket köküne yazılan dosyalar (liste + imza dosyaları + varsa iptal). */
  readonly yazilan: readonly string[];
}
/** Kaçışın kaydı HEAD'i taşır; ölçülemezse kaçış yok (fail-closed). */
function depoHead(): string {
  try {
    const sha = git(["-C", DEPO_KOKU, "rev-parse", "HEAD"], { stdio: "yut" }).trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch {
    /* aşağıda RED */
  }
  throw new Error(`--ci-atla: depo HEAD'i ölçülemedi (${DEPO_KOKU}) — kaçış kaydı HEAD'siz yazılmaz, imza atılmadı`);
}

/**
 * ALT-9 — yapıtın CI kökeni; üretim anahtarında `--ci-kosu` ya da kullanıcının cümlesiyle `--ci-atla` zorunlu,
 * parola sorulmadan ÖNCE ölçülür. Dönen kayıt imzalı yüke girer (üretim dışı test anahtarında koşusuz: null).
 */
function ciKokeniDenetle(
  kunye: Record<string, unknown>,
  keyFile: string,
  paketCommit: string | null,
  root: string,
  zipOlcumu: DirOptions["zipOlcumu"],
): CiKokeniKaydi | ThinkpadKaydi | null {
  const kid = packageKeyInfo(keyFile).kid;
  const uretim = isProductionSigningKid(kid);
  const id = arg("ci-kosu");
  const atla = argVar("ci-atla");
  const derlemeKunyesi = argVar("derleme-kunyesi");
  if (derlemeKunyesi !== undefined && argVar("ci-kosu") !== undefined) throw new Error("--ci-kosu ile --derleme-kunyesi birlikte verilemez — yapıtın TEK kökeni ölçülür; imza atılmadı");
  if (atla !== undefined) {
    const h = ciAtlaHukmu({ ham: atla, uretim, kosuVar: argVar("ci-kosu") !== undefined || derlemeKunyesi !== undefined });
    if (h.sonuc !== "uyumlu") throw new Error(`CI KAÇIŞI REDDEDİLDİ (${kid}) — imza atılmadı:\n  ${h.satirlar.join("\n  ")}`);
    const kayit: CiKokeniKaydi = { kip: "atlandi", cumle: h.cumle, saat: istanbulSaati(), makine: os.hostname().split(".")[0] || "?", head: depoHead() };
    console.warn(`⚠ ${h.satirlar[0]}`);
    console.warn(`  saat ${kayit.saat} · makine ${kayit.makine} · HEAD ${kayit.head.slice(0, 12)} — imzalı künyeye yazılıyor; yayıncı uyaracak`);
    return kayit;
  }
  if (derlemeKunyesi !== undefined) return thinkpadKokeniDenetle(derlemeKunyesi, root, zipOlcumu, uretim);
  if (!id) {
    if (uretim) {
      throw new Error(
        `üretim PAKET imzası (${kid}) CI kökeni ister: --ci-kosu=<korumali-paket.yml koşu numarası> (gh run list --workflow=korumali-paket.yml)` +
          ` ya da thinkpad derleme künyesi: --derleme-kunyesi=<zip>.derleme.json` +
          ` — ikisi de yoksa yalnız kullanıcının cümlesiyle: --ci-atla="<cümle>" — imza atılmadı`,
      );
    }
    console.warn(`⚠ CI kökeni ÖLÇÜLMEDİ (üretim dışı test anahtarı ${kid}, --ci-kosu verilmedi)`);
    return null;
  }
  const kosu = ciKosusuOku(id);
  const h = ciKokeniHukmu({ kosu, kunyeCommit: kunye.commit, paketCommit, uretim });
  if (h.sonuc !== "uyumlu") {
    throw new Error(`CI KÖKENİ ${h.sonuc === "olculemedi" ? "ÖLÇÜLEMEDİ" : "TUTMUYOR"} — imza atılmadı:\n  ${h.satirlar.join("\n  ")}`);
  }
  console.log(`✓ ${h.satirlar[0]}`);
  return { kip: "kosu", kosu: Number(id), dal: String(kosu.head_branch), commit: String(kosu.head_sha) };
}

const sha256Dosya = (f: string): string | null => (fs.existsSync(f) ? createHash("sha256").update(fs.readFileSync(f)).digest("hex") : null);

/** Kayıtlı derleme makinesinin (thinkpad-1) künyesi yapıtla çapraz ölçülür; tutmazsa/ölçülemezse imza YOK. */
function thinkpadKokeniDenetle(dosya: string, root: string, zipOlcumu: DirOptions["zipOlcumu"], uretim: boolean): ThinkpadKaydi {
  if (!zipOlcumu) throw new Error("--derleme-kunyesi yalnız `zip` kipinde (zip özeti künyeyle ölçülür) — imza atılmadı");
  let kunye: unknown = null;
  try {
    kunye = dosya ? readJson(home(dosya)) : null;
  } catch {
    kunye = null;
  }
  const k = (kunye ?? {}) as { kaynak?: { commit?: unknown }; betik?: { commit?: unknown } };
  const kaynakCommit = String(k.kaynak?.commit ?? "");
  const betikCommit = String(k.betik?.commit ?? "");
  const zipRust = Object.fromEntries(Object.entries(RUST_PARCALARI).map(([ad, yol]) => [ad, sha256Dosya(path.join(root, yol))])) as Record<keyof typeof RUST_PARCALARI, string | null>;
  const serverKunyeYolu = path.join(root, "dist", "server-kunye.json");
  const h = thinkpadKokeniHukmu({
    kunye,
    zipSha256: zipOlcumu.zipSha256,
    paket: zipOlcumu.paket,
    serverKunye: fs.existsSync(serverKunyeYolu) ? readJson(serverKunyeYolu) : {},
    zipRust,
    betikBlobSha256: betikBlobSha256(DEPO_KOKU, betikCommit),
    anaDalda: { kaynak: anaDaldaMi(DEPO_KOKU, kaynakCommit), betik: anaDaldaMi(DEPO_KOKU, betikCommit) },
    uretim,
  });
  if (h.sonuc !== "uyumlu") {
    throw new Error(`THINKPAD KÖKENİ ${h.sonuc === "olculemedi" ? "ÖLÇÜLEMEDİ" : "TUTMUYOR"} (${dosya || "(boş yol)"}) — imza atılmadı:\n  ${h.satirlar.join("\n  ")}`);
  }
  console.log(`✓ ${h.satirlar[0]}`);
  return thinkpadKaydi(kunye, zipOlcumu.zipSha256);
}

/** Derlemenin çapa kipi `uretim` olmalı ve anahtar üretim ailesinden; künyede kip yoksa (G3 öncesi derleme) uyarı. */
function anahtarAilesiDenetle(kunye: Record<string, unknown>, keyFile: string): void {
  const kip = kunye.guvenCapasi;
  const kid = packageKeyInfo(keyFile).kid;
  if (kip === undefined) {
    console.warn(`⚠ künyede çapa kipi yok (G3 öncesi derleme) — ${kid} anahtar ailesi denetlenmedi`);
    return;
  }
  if (kip !== "uretim") throw new Error(`anahtar ailesi denetlenemez: paket ${String(kip)} çapalı — yalnız uretim çapası imzalanır (hazırlık kipi kalktı)`);
  if (!isProductionSigningKid(kid)) throw new Error(`anahtar ailesi derlemenin çapa kipine uymuyor: paket uretim çapalı, anahtar ${kid} — paket-<yıl> ya da pkt-<yıl>-<n> anahtarıyla imzala`);
}

/** Zincirli anahtarın sertifikası: anahtarın yanındaki `<kid>.sertifika.json` (ya da verilen dosya); tazelik imzadan ÖNCE. */
function zincirSertifikasi(keyFile: string, file: string | null): string {
  const kid = packageKeyInfo(keyFile).kid;
  if (!isChainPackageKid(kid)) throw new Error(`zincir anahtarı pkt-* olmalı: ${kid}`);
  const cert = readPackageCertificate({ keyFile, kid, file: file ? home(file) : null });
  assertPackageCertificateFresh(cert);
  return cert;
}

async function signDir(o: DirOptions): Promise<DirResult> {
  const kunyeFile = path.join(o.root, "dist", "server-kunye.json");
  const kunye = fs.existsSync(kunyeFile) ? readJson(kunyeFile) : {};
  const birincilKid = packageKeyInfo(o.keyFile).kid;
  const zincirli = isChainPackageKid(birincilKid);
  if (o.zincirKeyFile && zincirli) throw new Error("--zincir-anahtar çift imza içindir: birincil --anahtar paket-* olmalı (zincir-yalnız imzada yalnız --anahtar=pkt-*)");
  anahtarAilesiDenetle(kunye, o.keyFile);
  if (o.zincirKeyFile) anahtarAilesiDenetle(kunye, o.zincirKeyFile);
  // Parola sorulmadan önce: CI kökeni, sertifika + tazelik, kök çapası, iptal belgesi.
  const ciKokeni = ciKokeniDenetle(kunye, o.keyFile, o.paketCommit ?? null, o.root, o.zipOlcumu ?? null);
  const birincilCert = zincirli ? zincirSertifikasi(o.keyFile, arg("sertifika")) : null;
  const zincirCert = o.zincirKeyFile ? zincirSertifikasi(o.zincirKeyFile, arg("zincir-sertifika")) : null;
  const zincirVar = birincilCert !== null || zincirCert !== null;
  const roots = zincirVar ? kokCapasi() : null;
  const iptalDosyasi = arg("paket-iptal");
  if (iptalDosyasi && !zincirVar) throw new Error("--paket-iptal yalnız zincirli imzalı pakete girer (--zincir-anahtar ya da --anahtar=pkt-*)");
  const paketIptal = iptalDosyasi && roots ? readPackageRevocationFile(home(iptalDosyasi), roots.roots) : null;
  const derlemeTarihi = arg("derleme-tarihi") ?? (typeof kunye.zaman === "string" ? kunye.zaman : null);
  if (!derlemeTarihi) throw new Error("derleme tarihi yok: dist/server-kunye.json `zaman` ya da --derleme-tarihi");
  // İki parola sırayla; ikincisi düşerse birincinin açılmış anahtarı yalnız bellekte kalır, dosya yazılmaz.
  const key: OpenedPackageKey = await openPackageKey(o.keyFile, paketParolasi);
  const zincirKey = o.zincirKeyFile ? await openPackageKey(o.zincirKeyFile, paketParolasi) : null;
  const r = await signPackageDirectory({
    root: o.root,
    key,
    ...(birincilCert ? { certificate: birincilCert } : {}),
    zincir: zincirKey && zincirCert ? { key: zincirKey, certificate: zincirCert } : null,
    ...(roots ? { roots: roots.roots } : {}),
    paketIptal: paketIptal?.token ?? null,
    urun: arg("urun") ?? "backend",
    surum: o.surum,
    derlemeTarihi,
    musteri: o.musteri ?? (typeof kunye.musteri === "string" ? kunye.musteri : null),
    paketId: typeof kunye.paketId === "string" ? kunye.paketId : undefined,
    kurulumId: arg("kurulum") ?? (typeof kunye.kurulumId === "string" ? kunye.kurulumId : null),
    ciKokeni,
  });
  const imzaDosyalari = r.imzalar.map((i) => `${path.basename(i.file)} (${i.kid})`).join(" + ");
  console.log(`✓ ${imzaDosyalari} + ${INTEGRITY_LIST_FILE} — ${r.entries.length} dosya · paketId ${r.manifest.paketId} · kapsam ${r.manifest.kapsam.dizinler.join(", ")}`);
  if (roots) console.log(`  kök çapası: ${roots.kaynak}`);
  if (paketIptal) console.log(`✓ ${PACKAGE_REVOCATION_FILE} (sıra ${paketIptal.verified.document.sira})`);
  return {
    kid: key.kid,
    zincirKid: r.imzalar.find((i) => path.basename(i.file) === CHAINED_INTEGRITY_FILE)?.kid ?? null,
    yazilan: [r.listFile, ...r.imzalar.map((i) => i.file), ...(r.iptalFile ? [r.iptalFile] : [])].map((f) => path.relative(o.root, f)),
  };
}

async function signZip(): Promise<void> {
  const zip = path.resolve(need("zip"));
  const keyFile = home(need("anahtar"));
  const zincirArg = arg("zincir-anahtar");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-imza-"));
  try {
    const zipSha256 = createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
    execFileSync("unzip", ["-q", zip, "-d", tmp]);
    const paket = readJson(path.join(tmp, "PAKET.json"));
    const imzaIzi = [INTEGRITY_FILE, CHAINED_INTEGRITY_FILE, INTEGRITY_LIST_FILE, PACKAGE_REVOCATION_FILE].filter((f) => fs.existsSync(path.join(tmp, f)));
    if (imzaIzi.length > 0) throw new Error(`paket zaten imzalı (${imzaIzi.join(", ")} var)`);
    if (paket.korumali !== true) throw new Error("yalnız KORUMALI paket imzalanır (PAKET.json korumali=true)");
    const surum = paket.uygulamaSurumu;
    if (typeof surum !== "string") throw new Error("PAKET.json uygulamaSurumu yok");
    const kanal = typeof paket.backendKanal === "string" ? paket.backendKanal : null;
    // Ortak paket (backendKanal null) müşteri/kurulum taşımaz: filigran kurulumda, imzalı yüke de girmez.
    if (kanal === null && (arg("musteri") !== null || arg("kurulum") !== null)) throw new Error("ortak paket (PAKET.json backendKanal null) --musteri/--kurulum almaz — filigran kurulumda");
    const r = await signDir({
      root: tmp,
      keyFile,
      zincirKeyFile: zincirArg ? home(zincirArg) : null,
      surum,
      musteri: arg("musteri") ?? kanal,
      paketCommit: typeof paket.commit === "string" ? paket.commit : null,
      zipOlcumu: { zipSha256, paket },
    });
    // kur.ps1 sayım kapısı: PAKET.json dosya sayısı yazılan her dosya kadar artar.
    const updated = { ...paket, dosyaSayisi: Number(paket.dosyaSayisi) + r.yazilan.length, butunlukKid: r.kid, ...(r.zincirKid ? { butunlukZincirKid: r.zincirKid } : {}) };
    fs.writeFileSync(path.join(tmp, "PAKET.json"), `${JSON.stringify(updated, null, 2)}\n`);
    execFileSync("zip", ["-q", "-X", zip, ...r.yazilan, "PAKET.json"], { cwd: tmp });
    const sha = createHash("sha256").update(fs.readFileSync(zip)).digest("hex").toUpperCase();
    console.log(`✓ ${path.basename(zip)} imzalandı (${r.yazilan.join(", ")}) · yeni SHA256 ${sha}`);
    const belge = arg("surum-belgesi");
    if (belge) {
      const text = fs.readFileSync(belge, "utf8").replace(/^\*\*SHA256:\*\*.*$/m, `**SHA256:** \`${sha}\``);
      fs.writeFileSync(belge, text);
      console.log(`  sürüm belgesi SHA256 satırı güncellendi: ${belge}`);
    } else {
      console.log("  ⚠ sürüm belgesindeki SHA256 artık eski — --surum-belgesi=<md> ile güncelle");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** `sertifika-ekle`: kök imzalı PAKET sertifikasını anahtarın yanına koyar; parola sormaz. */
function sertifikaEkle(): void {
  const keyFile = home(need("anahtar"));
  const certificate = certificateTokenFromFile(home(need("sertifika")));
  const roots = kokCapasi();
  const r = attachPackageCertificate({ keyFile, certificate, roots: roots.roots });
  console.log(`${r.yazildi ? "✓ eklendi" : "✓ zaten ekli (aynı içerik)"}: ${r.file} · kid ${r.kid} · kök ${r.rootKid} (${roots.kaynak}) · bitiş ${r.bitis}`);
}

/**
 * `belge`: Docker teslim künyesi. `pkt-*` anahtarda zincirli (kök imzalı PAKET sertifikası yükte, öz-denetim kök
 * çapasıyla KABUL kipinde); sertifika + tazelik parola SORULMADAN denetlenir. `paket-*` gömülü çapalı (eski).
 */
async function belge(): Promise<void> {
  const keyFile = home(need("anahtar"));
  const kid = packageKeyInfo(keyFile).kid;
  const zincir = isChainPackageKid(kid) ? { certificate: zincirSertifikasi(keyFile, arg("sertifika")), roots: kokCapasi().roots } : null;
  const key = await openPackageKey(keyFile, paketParolasi);
  const r = await signManifestDocument(path.resolve(need("belge")), key, zincir);
  console.log(`✓ ${r.file} · kid ${key.kid}${zincir ? " (zincirli, kök imzalı PAKET sertifikası)" : ""} · ${r.token.length} bayt`);
}

/** `anahtar-ac --anahtar=<dosya> [--json]`: parolayla AÇAR (yedek ölçümü), hiçbir şey yazmaz; yalnız kid + x basar. */
async function anahtarAc(): Promise<void> {
  const key = await openPackageKey(home(need("anahtar")), paketParolasi);
  if (process.argv.includes("--json")) console.log(JSON.stringify({ v: 1, kid: key.kid, x: key.x }));
  else console.log(`✓ açıldı: ${key.kid} · x=${key.x}`);
}

async function main(): Promise<void> {
  // Parola taşıyan argüman (`--parola=…` · `--password` …) değerine bakılmadan reddedilir.
  args(process.argv.slice(2));
  const cmd = process.argv[2];
  if (cmd === "anahtar-uret") return keygen();
  if (cmd === "imzala") {
    const zincirArg = arg("zincir-anahtar");
    await signDir({ root: path.resolve(need("kok")), keyFile: home(need("anahtar")), zincirKeyFile: zincirArg ? home(zincirArg) : null, surum: need("surum"), musteri: arg("musteri") });
    return;
  }
  if (cmd === "sertifika-ekle") return sertifikaEkle();
  if (cmd === "zip") return signZip();
  if (cmd === "belge") return belge();
  if (cmd === "anahtar-ac") return anahtarAc();
  throw new Error("komut: anahtar-uret | sertifika-ekle | anahtar-ac | imzala | zip | belge");
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof CliError ? 2 : 1);
});
