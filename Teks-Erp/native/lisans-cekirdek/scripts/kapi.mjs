#!/usr/bin/env node
// Native lisans çekirdeğinin commit kapısı + CI adımları (zero-dep). Alt komutlar:
//   denetle — `cargo fmt --check` + `cargo clippy` (uyarı = hata; napi · test çapası · İKİ çapa kipi)
//   test    — `cargo test` (TS kâhininin vektör dosyası dahil; test çapası özelliğiyle) İKİ kipte: üretim (özelliksiz
//             gömülü çapa) ve hazırlık (`hazirlik-capasi`) — gömülü çapa vektörleri yalnız kendi kipinde koşar
// ÜÇ SONUÇ: 0 temiz · 1 ihlal · cargo YOKSA ⏭ beyanla 0 — Rust araç zinciri olmayan oturum kapıyı
// ölçemez; ölçüm CI'daki "Native lisans çekirdeği" job'ındadır (sessiz yeşil değil, beyanlı atlama).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIZIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const komut = process.argv[2];

function cargoBul() {
  const ev = join(homedir(), ".cargo", "bin");
  const yollar = [...(process.env.PATH ?? "").split(delimiter), ev];
  const ad = process.platform === "win32" ? "cargo.exe" : "cargo";
  const bulunan = yollar.find((p) => p && existsSync(join(p, ad)));
  return bulunan ? { cargo: join(bulunan, ad), path: [bulunan, ...yollar].join(delimiter) } : null;
}

function kos(cargo, env, args) {
  console.log(`$ cargo ${args.join(" ")}`);
  const r = spawnSync(cargo, args, { cwd: DIZIN, stdio: "inherit", env, timeout: 900_000 });
  if (r.error) {
    console.error(`❌ cargo koşulamadı: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

const ADIMLAR = {
  denetle: [
    ["fmt", "--check"],
    ["clippy", "--release", "--all-targets", "--features", "test-anchor", "--", "-D", "warnings"],
    ["clippy", "--release", "--all-targets", "--no-default-features", "--features", "test-anchor", "--", "-D", "warnings"],
    ["clippy", "--release", "--all-targets", "--features", "hazirlik-capasi", "--", "-D", "warnings"],
    ["clippy", "--release", "--all-targets", "--no-default-features", "--features", "test-anchor,hazirlik-capasi", "--", "-D", "warnings"],
  ],
  test: [
    ["test", "--no-default-features", "--features", "test-anchor"],
    ["test", "--no-default-features", "--features", "test-anchor,hazirlik-capasi"],
  ],
};

const adimlar = ADIMLAR[komut];
if (!adimlar) {
  console.error(`kullanım: node scripts/kapi.mjs <${Object.keys(ADIMLAR).join("|")}>`);
  process.exit(2);
}
const bulunan = cargoBul();
if (!bulunan) {
  console.log(`⏭  native lisans çekirdeği · ${komut} ÖLÇÜLMEDİ — cargo yok (rustup ile kur: Teks-Erp/native/lisans-cekirdek/CLAUDE.md); CI "Native lisans çekirdeği" job'ı ölçer`);
  process.exit(0);
}
const env = { ...process.env, PATH: bulunan.path };
for (const a of adimlar) {
  const kod = kos(bulunan.cargo, env, a);
  if (kod !== 0) process.exit(1);
}
console.log(`✅ native lisans çekirdeği · ${komut} temiz`);
