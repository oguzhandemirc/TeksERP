// =============================================================================
// Modül anahtarı CLI'ı (Faz 2d) — şifreli modül paketinin AES-256 anahtarı.
// =============================================================================
// `uret`: yeni anahtarı DERLEME makinesindeki dosyaya yazar (0600, üstüne yazmaz; varsayılan dizin
//   ~/.tekserp/satici-hazirlik/modul-anahtarlari — REPO DIŞI). `build-korumali.mjs --sifrele` bu
//   dosyayla paketi şifreler.
// `ice-aktar`: aynı dosyayı satıcı KASASINA alır (DB'de kasa anahtarıyla sarılı; tekrar güvenli) —
//   kira basımında HAK'taki, dondurulmamış modüle kurulumun X25519'una sarılı gider.
// Düz anahtar argv/env/log/denetime GİRMEZ; yalnız dosyada (0600) ve bellekte.
//
// Kullanım (satici/sunucu içinden):
//   npx tsx scripts/modul-anahtari.ts uret --modul=depo.multiEnabled [--surum=1] [--dizin=<yol>]
//   npx tsx scripts/modul-anahtari.ts ice-aktar --dosya=<yol>
// =============================================================================
import crypto from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { KeyStore } from "../src/keys/key-store";
import { loadServerSecrets } from "../src/keys/server-secrets";
import { loadEnvFile } from "../src/lib/env";
import { ModuleKeySchema, moduleKeyId, parseModuleKeyFile } from "../src/lisans-protokol";
import type { VendorContext } from "../src/services/context";
import { importModuleKey } from "../src/services/module-key.service";
import { CliError, args } from "./lib/cli-girdi";

export const MODULE_KEY_DIR_DEFAULT = path.join(os.homedir(), ".tekserp", "satici-hazirlik", "modul-anahtarlari");

/** Anahtar dosyasını okur ve kid'in anahtarın özeti olduğunu doğrular (kurcalanmış dosya kabul edilmez). */
export function readModuleKeyFile(file: string): { modul: string; surum: number; kid: string; anahtar: Buffer } {
  const parsed = parseModuleKeyFile(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed) throw new CliError(`Modül anahtarı dosyası biçimsiz ya da kimliği anahtarla uyuşmuyor: ${file}`);
  return parsed;
}

function generate(flags: Map<string, string>): void {
  const modul = flags.get("modul") ?? "";
  if (!ModuleKeySchema.safeParse(modul).success) throw new CliError("--modul geçerli bir modül anahtarı olmalı (ör. depo.multiEnabled)");
  const surum = Number(flags.get("surum") ?? "1");
  if (!Number.isInteger(surum) || surum < 1) throw new CliError("--surum ≥ 1 tamsayı olmalı");
  const dir = path.resolve(flags.get("dizin") ?? MODULE_KEY_DIR_DEFAULT);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const anahtar = crypto.randomBytes(32);
  const kid = moduleKeyId(anahtar);
  const file = path.join(dir, `${modul}.${surum}.json`);
  const body = { v: 1, tur: "tekserp-modul-anahtari", modul, surum, kid, anahtar: anahtar.toString("base64url") };
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);
  anahtar.fill(0);
  console.log(`✅ ${modul} ${surum}. sürüm anahtarı üretildi · ${kid} · ${file} (0600)`);
}

async function importFile(flags: Map<string, string>): Promise<void> {
  const file = flags.get("dosya");
  if (!file) throw new CliError("--dosya zorunlu");
  const key = readModuleKeyFile(path.resolve(file));
  loadEnvFile();
  const config = loadConfig(process.env, path.resolve(__dirname, ".."));
  // Anahtar birimi imajda salt okunur: kasa anahtarı yalnız OKUNUR (üreticisi `anahtar.ts sirlar-uret`).
  const ctx: VendorContext = { config, keys: KeyStore.load(config), ...loadServerSecrets(config.ANAHTAR_DIZINI) };
  const { prisma, pool } = await import("../src/lib/prisma");
  try {
    const r = await importModuleKey(ctx, { modul: key.modul, surum: key.surum, anahtar: key.anahtar, yapan: "cli" });
    console.log(r.yeni ? `✅ kasaya alındı: ${key.modul} ${key.surum}. sürüm · ${r.kid}` : `= zaten kasada: ${r.kid}`);
  } finally {
    key.anahtar.fill(0);
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const { command, flags } = args(process.argv.slice(2));
  if (command === "uret") return generate(flags);
  if (command === "ice-aktar") return importFile(flags);
  throw new CliError("komut: uret | ice-aktar");
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(err instanceof CliError ? 2 : 1);
    },
  );
}
