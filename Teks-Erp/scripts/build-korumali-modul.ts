// =============================================================================
// Şifreli modül paketi MÜHÜRLEYİCİ (Faz 2d) — build-korumali.mjs `--sifrele` çağırır.
// =============================================================================
// Düz modül CJS'ini hazırlık makinesindeki modül anahtarıyla (0600, REPO DIŞI; satıcı CLI'ı
// `satici/sunucu/scripts/modul-anahtari.ts uret` üretir) AES-256-GCM ile `.tkmod` paketine çevirir.
// Modülün en yüksek sürümlü anahtar dosyası kullanılır; anahtar yoksa derleme DÜŞER (fail-closed).
//
//   npx tsx scripts/build-korumali-modul.ts --girdi=<cjs> --cikti=<tkmod> --modul=<anahtar> --paket=<ad> [--anahtar-dizini=<yol>]
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseModuleKeyFile } from "../src/lib/license/protocol";
import { openModulePackage, sealModulePackage } from "../src/lib/license/encrypted-module";

export const MODULE_KEY_DIR_DEFAULT = path.join(os.homedir(), ".tekserp", "satici-hazirlik", "modul-anahtarlari");

function arg(name: string): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(p.indexOf("=") + 1) : null;
}

/** Modülün en yüksek sürümlü anahtar dosyası (`<modul>.<surum>.json`); dosya izni 0600'den gevşekse RED. */
export function latestModuleKey(dir: string, modul: string): { surum: number; kid: string; anahtar: Buffer; file: string } {
  const pattern = new RegExp(`^${modul.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(\\d+)\\.json$`);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => pattern.test(f)) : [];
  const best = files.map((f) => ({ f, surum: Number(pattern.exec(f)?.[1]) })).sort((a, b) => b.surum - a.surum)[0];
  if (!best) throw new Error(`${modul} için modül anahtarı yok (${dir}) — satıcı CLI'ı: modul-anahtari.ts uret --modul=${modul}`);
  const file = path.join(dir, best.f);
  if (process.platform !== "win32" && (fs.statSync(file).mode & 0o077) !== 0) throw new Error(`Modül anahtarı dosyası 0600 değil: ${file}`);
  const parsed = parseModuleKeyFile(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed || parsed.modul !== modul || parsed.surum !== best.surum) throw new Error(`Modül anahtarı dosyası biçimsiz ya da kimliği uyuşmuyor: ${file}`);
  return { surum: parsed.surum, kid: parsed.kid, anahtar: parsed.anahtar, file };
}

function main(): void {
  const girdi = arg("girdi");
  const cikti = arg("cikti");
  const modul = arg("modul");
  const paket = arg("paket");
  if (!girdi || !cikti || !modul || !paket) throw new Error("--girdi --cikti --modul --paket zorunlu");
  const key = latestModuleKey(path.resolve(arg("anahtar-dizini") ?? MODULE_KEY_DIR_DEFAULT), modul);
  const code = fs.readFileSync(girdi);
  const pkg = sealModulePackage({ code, key: key.anahtar, modul, paket, surum: key.surum, kid: key.kid });
  // Mühür kendi kendine açılabilmeli (yanlış anahtar/biçim derlemede yakalansın, sahada değil).
  if (!openModulePackage(pkg, key.anahtar)) throw new Error("Mühürlenen paket aynı anahtarla açılamadı");
  key.anahtar.fill(0);
  fs.mkdirSync(path.dirname(cikti), { recursive: true });
  fs.writeFileSync(cikti, pkg);
  console.log(JSON.stringify({ modul, paket, surum: key.surum, kid: key.kid, bayt: pkg.length }));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
