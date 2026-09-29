// =============================================================================
// KORUMALI PAKET İMZASI — PAKET anahtarıyla imzalı dosya listesi (Faz 2e)
// =============================================================================
// Satıcı Mac'inde koşar; imza anahtarı CI'a ve pakete GİRMEZ. Kapsam: src/lib/license/integrity-scope.ts.
//
//   npx tsx scripts/build-korumali-imza.ts anahtar-uret [--kid=paket-hazirlik] [--dizin=~/.tekserp/satici-hazirlik]
//   npx tsx scripts/build-korumali-imza.ts imzala --kok=<paket dizini> --anahtar=<dosya> --surum=<x.y.z>
//       [--urun=backend] [--musteri=<kod>] [--kurulum=<uuid>] [--derleme-tarihi=<ISO>]
//   npx tsx scripts/build-korumali-imza.ts zip --zip=<paket.zip> --anahtar=<dosya> [--kurulum=<uuid>] [--surum-belgesi=<md>]
//   npx tsx scripts/build-korumali-imza.ts belge --belge=<PAKET-DOCKER.json> --anahtar=<dosya>   (Docker teslim künyesi → <belge>.jws)
//
// `zip` kipi: zip'i açar, sürüm/müşteri/derleme künyesini PAKET.json + dist/server-kunye.json'dan okur,
// imzalar, `butunluk.jws`i ekler ve PAKET.json'daki dosya sayısını bir artırır (kur.ps1 sayım kapısı).
// Hazırlık anahtarı (`paket-hazirlik`) yalnız TEST/DEMO paketleri içindir: ÜRETİM kurulumu onu reddeder.
// =============================================================================
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePackageKey, readPackageKey, signManifestDocument, signPackageDirectory, writePackageKey } from "./lib/butunluk-imza";
import { STAGING_PACKAGE_CLASSES, STAGING_PACKAGE_KID_PREFIX } from "../src/lib/license/integrity-scope";

function arg(name: string): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : null;
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

function keygen(): void {
  const kid = arg("kid") ?? STAGING_PACKAGE_KID_PREFIX;
  if (!kid.startsWith(STAGING_PACKAGE_KID_PREFIX)) {
    throw new Error("bu komut yalnız HAZIRLIK anahtarı üretir; üretim anahtarı (paket-<yıl>, parolalı) ayrı törende");
  }
  const dir = home(arg("dizin") ?? "~/.tekserp/satici-hazirlik");
  const file = writePackageKey(dir, generatePackageKey(kid, STAGING_PACKAGE_CLASSES));
  const k = readPackageKey(file);
  console.log(`✓ ${file} (0600)`);
  console.log(`  PACKAGE_PUBLIC_KEYS girdisi: { kid: "${k.kid}", x: "${k.x}" }`);
}

interface DirOptions {
  readonly root: string;
  readonly keyFile: string;
  readonly surum: string;
  readonly musteri: string | null;
}

async function signDir(o: DirOptions): Promise<string> {
  const key = readPackageKey(o.keyFile);
  const kunyeFile = path.join(o.root, "dist", "server-kunye.json");
  const kunye = fs.existsSync(kunyeFile) ? readJson(kunyeFile) : {};
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
  });
  console.log(`✓ ${r.file} — ${r.manifest.dosyalar.length} dosya · kid ${key.kid} · ${r.token.length} bayt`);
  return key.kid;
}

async function signZip(): Promise<void> {
  const zip = path.resolve(need("zip"));
  const keyFile = home(need("anahtar"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-imza-"));
  try {
    execFileSync("unzip", ["-q", zip, "-d", tmp]);
    const paket = readJson(path.join(tmp, "PAKET.json"));
    if (fs.existsSync(path.join(tmp, "butunluk.jws"))) throw new Error("paket zaten imzalı (butunluk.jws var)");
    if (paket.korumali !== true) throw new Error("yalnız KORUMALI paket imzalanır (PAKET.json korumali=true)");
    const surum = paket.uygulamaSurumu;
    if (typeof surum !== "string") throw new Error("PAKET.json uygulamaSurumu yok");
    const kanal = typeof paket.backendKanal === "string" ? paket.backendKanal : null;
    const kid = await signDir({ root: tmp, keyFile, surum, musteri: arg("musteri") ?? kanal });
    const updated = { ...paket, dosyaSayisi: Number(paket.dosyaSayisi) + 1, butunlukKid: kid };
    fs.writeFileSync(path.join(tmp, "PAKET.json"), `${JSON.stringify(updated, null, 2)}\n`);
    execFileSync("zip", ["-q", "-X", zip, "butunluk.jws", "PAKET.json"], { cwd: tmp });
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
  const cmd = process.argv[2];
  if (cmd === "anahtar-uret") return keygen();
  if (cmd === "imzala") {
    await signDir({ root: path.resolve(need("kok")), keyFile: home(need("anahtar")), surum: need("surum"), musteri: arg("musteri") });
    return;
  }
  if (cmd === "zip") return signZip();
  if (cmd === "belge") {
    const key = readPackageKey(home(need("anahtar")));
    const r = await signManifestDocument(path.resolve(need("belge")), key);
    console.log(`✓ ${r.file} · kid ${key.kid} · ${r.token.length} bayt`);
    return;
  }
  throw new Error("komut: anahtar-uret | imzala | zip | belge");
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
