#!/usr/bin/env node
// Native lisans çekirdeğini derler: `node scripts/derle.mjs <yerel|win-x64|linux-x64> [--uretim | --hazirlik]`.
//   varsayılan  → `dist/` , `test-anchor` özellikli, ÜRETİM gömülü çapalı (kâhin bekçisi dışarıdan test çapası verebilsin)
//   --uretim    → `dist-uretim/`, özelliksiz: YALNIZ üretim kökleri + PAKET anahtarları gömülü (üretim kanalının paketi)
//   --hazirlik  → `dist-hazirlik/`, `hazirlik-capasi`: YALNIZ hazırlık kökleri + PAKET anahtarları gömülü (hazırlık
//                 kanalının paketi); iki kip tek ikilide birleşmez, TS yükleyicisi kendi kipinden farklısını açmaz
// win-x64   Mac/Linux'tan `napi build -x` (cargo-xwin; CRT statik — `.cargo/config.toml`).
// linux-x64 `cargo zigbuild` ile glibc 2.28 tabanı (zig PATH'te olmalı); çıktıdaki en yüksek
//           GLIBC sembol sürümü ÖLÇÜLÜR, 2.28'i aşarsa derleme BAŞARISIZ sayılır.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIZIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const hedef = process.argv[2] ?? "yerel";
const uretim = process.argv.includes("--uretim");
const hazirlik = process.argv.includes("--hazirlik");
if (uretim && hazirlik) {
  console.error("--uretim ve --hazirlik birlikte verilemez: bir ikili TEK kipin çapasını taşır");
  process.exit(2);
}
const kip = uretim ? "uretim" : hazirlik ? "hazirlik" : null;
const cikti = join(DIZIN, kip ? `dist-${kip}` : "dist");
const ozellik = uretim ? [] : hazirlik ? ["--features", "hazirlik-capasi"] : ["--features", "test-anchor"];
const GLIBC_TAVANI = [2, 28];
const env = { ...process.env, PATH: [join(homedir(), ".cargo", "bin"), process.env.PATH ?? ""].join(delimiter) };

function kos(komut, args) {
  console.log(`$ ${komut} ${args.join(" ")}`);
  const r = spawnSync(komut, args, { cwd: DIZIN, stdio: "inherit", env, timeout: 1_800_000, shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`❌ derleme başarısız (${komut}, çıkış ${r.status ?? r.error?.message})`);
    process.exit(1);
  }
}

function glibcEnYuksek(dosya) {
  const metin = readFileSync(dosya).toString("latin1");
  const surumler = [...metin.matchAll(/GLIBC_(\d+)\.(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  return surumler.sort((a, b) => b[0] - a[0] || b[1] - a[1])[0] ?? null;
}

const napi = ["napi", "build", "--platform", "--release", "--no-js", ...ozellik, "--output-dir", cikti];
if (hedef === "yerel") {
  kos("npx", napi);
} else if (hedef === "win-x64") {
  kos("npx", [...napi, "--target", "x86_64-pc-windows-msvc", "-x"]);
} else if (hedef === "linux-x64") {
  kos("cargo", ["zigbuild", "--release", ...ozellik, "--target", "x86_64-unknown-linux-gnu.2.28"]);
  const kaynak = join(DIZIN, "target", "x86_64-unknown-linux-gnu", "release", "liblisans_cekirdek.so");
  const varis = join(cikti, "lisans-cekirdek.linux-x64-gnu.node");
  if (!existsSync(kaynak)) {
    console.error(`❌ zigbuild çıktısı yok: ${kaynak}`);
    process.exit(1);
  }
  mkdirSync(cikti, { recursive: true });
  copyFileSync(kaynak, varis);
  const g = glibcEnYuksek(varis);
  const asti = !g || g[0] > GLIBC_TAVANI[0] || (g[0] === GLIBC_TAVANI[0] && g[1] > GLIBC_TAVANI[1]);
  console.log(`${asti ? "❌" : "✅"} en yüksek GLIBC sembolü ${g ? g.join(".") : "bulunamadı"} (tavan ${GLIBC_TAVANI.join(".")})`);
  if (asti) process.exit(1);
} else {
  console.error("kullanım: node scripts/derle.mjs <yerel|win-x64|linux-x64> [--uretim | --hazirlik]");
  process.exit(2);
}
console.log(`✅ ${hedef}${kip ? ` (${kip} çapalı)` : " (test çapalı, üretim gömülü)"} → ${cikti}`);
