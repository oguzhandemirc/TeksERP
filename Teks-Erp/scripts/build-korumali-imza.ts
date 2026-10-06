// =============================================================================
// KORUMALI PAKET İMZASI — PAKET anahtarıyla imzalı dosya listesi (Faz 2e)
// =============================================================================
// Satıcı Mac'inde koşar; imza anahtarı CI'a ve pakete GİRMEZ. Kapsam: src/lib/license/integrity-scope.ts.
//
//   npx tsx scripts/build-korumali-imza.ts anahtar-uret [--kid=paket-hazirlik] [--dizin=~/.tekserp/satici-hazirlik]   (hazırlık, parolasız)
//   npx tsx scripts/build-korumali-imza.ts anahtar-uret --kid=paket-<yıl>[-<n>] [--dizin=~/.tekserp/satici-uretim] [--json]
//       ÜRETİM (tören): parolalı (kök dosyasıyla aynı sarma, `protocol/anahtar-sarma.ts`); parola iki kez — TTY'de
//       gizli istem, TTY yoksa stdin'in ilk iki satırı. Çıktı `<dizin>/<kid>.paket.json` (0600, var olanı ezmez).
//   npx tsx scripts/build-korumali-imza.ts imzala --kok=<paket dizini> --anahtar=<dosya> --surum=<x.y.z>
//       [--urun=backend] [--musteri=<kod>] [--kurulum=<uuid>] [--derleme-tarihi=<ISO>]
//   npx tsx scripts/build-korumali-imza.ts zip --zip=<paket.zip> --anahtar=<dosya> [--kurulum=<uuid>] [--surum-belgesi=<md>]
//       [--ci-kosu=<korumali-paket.yml koşu numarası> | --ci-atla="<kullanıcının onay cümlesi>"]   (ÜRETİM anahtarında biri ZORUNLU)
//   npx tsx scripts/build-korumali-imza.ts belge --belge=<PAKET-DOCKER.json> --anahtar=<dosya>   (Docker teslim künyesi → <belge>.jws)
//
// `zip` kipi: zip'i açar, sürüm/müşteri/derleme künyesini PAKET.json + dist/server-kunye.json'dan okur,
// imzalar, `butunluk.jws` + `butunluk-liste.txt`i ekler ve PAKET.json'daki dosya sayısını iki artırır
// (kur.ps1 sayım kapısı).
// Hazırlık anahtarı (`paket-hazirlik`) yalnız TEST/DEMO paketleri içindir: ÜRETİM kurulumu onu reddeder.
// Anahtar AİLESİ derlemenin çapa kipine uymalı (G3, `dist/server-kunye.json` `guvenCapasi`): üretim çapalı pakete
// yalnız `paket-<yıl>`, hazırlık çapalıya yalnız `paket-hazirlik*` — uymazsa parola sorulmadan RED (paket açılışta
// imzalı listeyi tanımaz, çekirdeksiz kalırdı).
// CI KÖKENİ (G22/ALT-9): `.jsc` CI'da derlenir, Mac gözle denetleyemez — üretim anahtarıyla (`paket-<yıl>`) imza
// `--ci-kosu=<id>` ister ve parola sorulmadan ÖNCE koşu ölçülür: `korumali-paket.yml`, başarıyla bitmiş, `main`
// dalı, commit'i yapıtın künyesindeki (`dist/server-kunye.json`) ve PAKET.json'unki (`scripts/lib/ci-kokeni.ts`).
// Hazırlık anahtarında koşu verilirse ölçülür (dal serbest), verilmezse uyarı basılır.
// KAÇIŞ (kullanıcı kararı 2026-10-01): koşu YOKKEN üretim imzası yalnız `--ci-atla="<kullanıcının cümlesi>"` ile;
// cümle + saat + makine + HEAD imzalı yüke (`ciKokeni`) girer, yayıncı (`deploy/backend-yayinla.mjs`) uyarır ve
// defterine yazar. Hazırlık anahtarında `--ci-atla` RED (kaçış gerekmez).
// Parolalı anahtarla imzada (`imzala` · `zip` · `belge`) parola TTY'den ya da stdin'in satırından sorulur;
// parola argümandan/ortamdan ASLA alınmaz (`--parola…` biçimli argüman çıkış 2 ile reddedilir).
// =============================================================================
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  generatePackageKey,
  generateWrappedPackageKey,
  openPackageKey,
  packageKeyInfo,
  readPackageKey,
  signManifestDocument,
  signPackageDirectory,
  writePackageKey,
} from "./lib/butunluk-imza";
import { CliError, args, askPassword } from "./lib/cli-girdi";
import { git } from "./lib/git";
import { type CiKokeniKaydi, ciAtlaHukmu, ciKokeniHukmu, ciKosusuOku } from "./lib/ci-kokeni";
import { STAGING_PACKAGE_CLASSES, STAGING_PACKAGE_KID_PREFIX, isProductionPackageKid, isStagingPackageKid } from "../src/lib/license/integrity-scope";
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
  const kid = arg("kid") ?? STAGING_PACKAGE_KID_PREFIX;
  if (isStagingPackageKid(kid)) {
    const dir = home(arg("dizin") ?? "~/.tekserp/satici-hazirlik");
    const file = writePackageKey(dir, generatePackageKey(kid, STAGING_PACKAGE_CLASSES));
    const k = readPackageKey(file);
    console.log(`✓ ${file} (0600)`);
    console.log(`  PACKAGE_PUBLIC_KEYS girdisi: { kid: "${k.kid}", x: "${k.x}" }`);
    return;
  }
  if (!isProductionPackageKid(kid)) throw new Error(`kid biçimi: paket-hazirlik[-…] (hazırlık, parolasız) ya da paket-<yıl>[-<n>] (üretim, parolalı): ${kid}`);
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
  console.log(`  PACKAGE_PUBLIC_KEYS girdisi: { kid: "${k.kid}", x: "${k.x}" }`);
  console.log(`  Çapaya ekle: cd Teks-Erp && npx tsx scripts/guven-capasi-ekle.ts paket --dosya=${file}   (KURU; sonra --yaz)`);
  console.log("  ⚠ Parolalı dosyanın kopyası Mac DIŞINDA saklanır (USB + kâğıt; parola ayrı kâğıtta).");
}

const paketParolasi = (kid: string): Promise<Buffer> => askPassword(`PAKET anahtarı (${kid}) parolası: `);

interface DirOptions {
  readonly root: string;
  readonly keyFile: string;
  readonly surum: string;
  readonly musteri: string | null;
  /** PAKET.json `commit` (zip kipinde); dizin imzasında null. */
  readonly paketCommit?: string | null;
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
 * parola sorulmadan ÖNCE ölçülür. Dönen kayıt imzalı yüke girer (hazırlıkta koşusuz: null).
 */
function ciKokeniDenetle(kunye: Record<string, unknown>, keyFile: string, paketCommit: string | null): CiKokeniKaydi | null {
  const kid = packageKeyInfo(keyFile).kid;
  const uretim = isProductionPackageKid(kid);
  const id = arg("ci-kosu");
  const atla = argVar("ci-atla");
  if (atla !== undefined) {
    const h = ciAtlaHukmu({ ham: atla, uretim, kosuVar: argVar("ci-kosu") !== undefined });
    if (h.sonuc !== "uyumlu") throw new Error(`CI KAÇIŞI REDDEDİLDİ (${kid}) — imza atılmadı:\n  ${h.satirlar.join("\n  ")}`);
    const kayit: CiKokeniKaydi = { kip: "atlandi", cumle: h.cumle, saat: istanbulSaati(), makine: os.hostname().split(".")[0] || "?", head: depoHead() };
    console.warn(`⚠ ${h.satirlar[0]}`);
    console.warn(`  saat ${kayit.saat} · makine ${kayit.makine} · HEAD ${kayit.head.slice(0, 12)} — imzalı künyeye yazılıyor; yayıncı uyaracak`);
    return kayit;
  }
  if (!id) {
    if (uretim) {
      throw new Error(
        `üretim PAKET imzası (${kid}) CI kökeni ister: --ci-kosu=<korumali-paket.yml koşu numarası> (gh run list --workflow=korumali-paket.yml)` +
          ` — koşu yoksa yalnız kullanıcının cümlesiyle: --ci-atla="<cümle>" — imza atılmadı`,
      );
    }
    console.warn(`⚠ CI kökeni ÖLÇÜLMEDİ (hazırlık anahtarı ${kid}, --ci-kosu verilmedi)`);
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

/** Derlemenin çapa kipi ile anahtarın ailesi uyuşmalı; künyede kip yoksa (G3 öncesi derleme) uyarı. */
function anahtarAilesiDenetle(kunye: Record<string, unknown>, keyFile: string): void {
  const kip = kunye.guvenCapasi;
  const kid = packageKeyInfo(keyFile).kid;
  if (kip === undefined) {
    console.warn(`⚠ künyede çapa kipi yok (G3 öncesi derleme) — ${kid} anahtar ailesi denetlenmedi`);
    return;
  }
  const uyar = kip === "uretim" ? isProductionPackageKid(kid) : kip === "hazirlik" ? isStagingPackageKid(kid) : false;
  if (!uyar) throw new Error(`anahtar ailesi derlemenin çapa kipine uymuyor: paket ${String(kip)} çapalı, anahtar ${kid} — ${kip === "uretim" ? "paket-<yıl>" : "paket-hazirlik"} anahtarıyla imzala`);
}

async function signDir(o: DirOptions): Promise<string> {
  const kunyeFile = path.join(o.root, "dist", "server-kunye.json");
  const kunye = fs.existsSync(kunyeFile) ? readJson(kunyeFile) : {};
  anahtarAilesiDenetle(kunye, o.keyFile);
  const ciKokeni = ciKokeniDenetle(kunye, o.keyFile, o.paketCommit ?? null);
  const key = await openPackageKey(o.keyFile, paketParolasi);
  const derlemeTarihi = arg("derleme-tarihi") ?? (typeof kunye.zaman === "string" ? kunye.zaman : null);
  if (!derlemeTarihi) throw new Error("derleme tarihi yok: dist/server-kunye.json `zaman` ya da --derleme-tarihi");
  const r = await signPackageDirectory({
    root: o.root,
    key,
    urun: arg("urun") ?? "backend",
    surum: o.surum,
    derlemeTarihi,
    musteri: o.musteri ?? (typeof kunye.musteri === "string" ? kunye.musteri : null),
    paketId: typeof kunye.paketId === "string" ? kunye.paketId : undefined,
    kurulumId: arg("kurulum") ?? (typeof kunye.kurulumId === "string" ? kunye.kurulumId : null),
    ciKokeni,
  });
  console.log(`✓ ${r.file} + ${INTEGRITY_LIST_FILE} — ${r.entries.length} dosya · kapsam ${r.manifest.kapsam.dizinler.join(", ")} · kid ${key.kid}`);
  return key.kid;
}

async function signZip(): Promise<void> {
  const zip = path.resolve(need("zip"));
  const keyFile = home(need("anahtar"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-imza-"));
  try {
    execFileSync("unzip", ["-q", zip, "-d", tmp]);
    const paket = readJson(path.join(tmp, "PAKET.json"));
    if (fs.existsSync(path.join(tmp, "butunluk.jws")) || fs.existsSync(path.join(tmp, INTEGRITY_LIST_FILE))) {
      throw new Error(`paket zaten imzalı (butunluk.jws ya da ${INTEGRITY_LIST_FILE} var)`);
    }
    if (paket.korumali !== true) throw new Error("yalnız KORUMALI paket imzalanır (PAKET.json korumali=true)");
    const surum = paket.uygulamaSurumu;
    if (typeof surum !== "string") throw new Error("PAKET.json uygulamaSurumu yok");
    const kanal = typeof paket.backendKanal === "string" ? paket.backendKanal : null;
    // Ortak paket (backendKanal null) müşteri/kurulum taşımaz: filigran kurulumda, imzalı yüke de girmez.
    if (kanal === null && (arg("musteri") !== null || arg("kurulum") !== null)) throw new Error("ortak paket (PAKET.json backendKanal null) --musteri/--kurulum almaz — filigran kurulumda");
    const kid = await signDir({ root: tmp, keyFile, surum, musteri: arg("musteri") ?? kanal, paketCommit: typeof paket.commit === "string" ? paket.commit : null });
    const updated = { ...paket, dosyaSayisi: Number(paket.dosyaSayisi) + 2, butunlukKid: kid };
    fs.writeFileSync(path.join(tmp, "PAKET.json"), `${JSON.stringify(updated, null, 2)}\n`);
    execFileSync("zip", ["-q", "-X", zip, "butunluk.jws", INTEGRITY_LIST_FILE, "PAKET.json"], { cwd: tmp });
    const sha = createHash("sha256").update(fs.readFileSync(zip)).digest("hex").toUpperCase();
    console.log(`✓ ${path.basename(zip)} imzalandı · yeni SHA256 ${sha}`);
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

async function main(): Promise<void> {
  // Parola taşıyan argüman (`--parola=…` · `--password` …) değerine bakılmadan reddedilir.
  args(process.argv.slice(2));
  const cmd = process.argv[2];
  if (cmd === "anahtar-uret") return keygen();
  if (cmd === "imzala") {
    await signDir({ root: path.resolve(need("kok")), keyFile: home(need("anahtar")), surum: need("surum"), musteri: arg("musteri") });
    return;
  }
  if (cmd === "zip") return signZip();
  if (cmd === "belge") {
    const key = await openPackageKey(home(need("anahtar")), paketParolasi);
    const r = await signManifestDocument(path.resolve(need("belge")), key);
    console.log(`✓ ${r.file} · kid ${key.kid} · ${r.token.length} bayt`);
    return;
  }
  throw new Error("komut: anahtar-uret | imzala | zip | belge");
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof CliError ? 2 : 1);
});
