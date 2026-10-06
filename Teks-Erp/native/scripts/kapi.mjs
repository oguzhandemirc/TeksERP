#!/usr/bin/env node
// Native Cargo çalışma alanının commit kapısı + CI adımları (zero-dep). Üyeler: lisans-cekirdek (napi) ·
// tekserp-dogrulama (ORTAK doğrulama) · tekserp-guncelleyici · tekserp-hizmet (Windows hizmetleri).
//   denetle — `cargo fmt --all --check` + clippy (uyarı = hata): bütün alan (lisans çekirdeği test
//             çapalı) · lisans çekirdeği napi'siz · hizmet ikilileri Windows hedefinde (yalnız `check`,
//             bağlama yok — Mac'ten de ölçülür; hedef std'si kurulu değilse ⏭ beyanla, CI Windows job'ı ölçer)
//   test    — `cargo test`: alanın napi'siz üyeleri + lisans çekirdeği (TS kâhininin vektör dosyası, test çapası).
//             Gömülü çapa tek kiptir (üretim); `test-anchor` yalnız test derlemesinde dışarıdan çapa verir
// ÜÇ SONUÇ: 0 temiz · 1 ihlal · cargo YOKSA ⏭ beyanla 0 — Rust araç zinciri olmayan oturum kapıyı
// ölçemez; ölçüm CI'daki "Native" job'larındadır (sessiz yeşil değil, beyanlı atlama).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIZIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS_HEDEFI = "x86_64-pc-windows-msvc";
const komut = process.argv[2];

function cargoBul() {
  const ev = join(homedir(), ".cargo", "bin");
  const yollar = [...(process.env.PATH ?? "").split(delimiter), ev];
  const ad = process.platform === "win32" ? "cargo.exe" : "cargo";
  const bulunan = yollar.find((p) => p && existsSync(join(p, ad)));
  return bulunan ? { cargo: join(bulunan, ad), dizin: bulunan, path: [bulunan, ...yollar].join(delimiter) } : null;
}

function kos(program, env, args) {
  console.log(`$ ${program.endsWith("cargo") || program.endsWith("cargo.exe") ? "cargo" : program} ${args.join(" ")}`);
  const r = spawnSync(program, args, { cwd: DIZIN, stdio: "inherit", env, timeout: 1_800_000 });
  if (r.error) {
    console.error(`❌ koşulamadı: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

/** Windows hedefinin std'si kurulu mu (rustup yoksa ya da hedef yoksa hayır — beyanla atlanır). */
function windowsHedefiKurulu(bulunan, env) {
  if (process.platform === "win32") return true;
  const rustup = join(bulunan.dizin, "rustup");
  if (!existsSync(rustup)) return false;
  const r = spawnSync(rustup, ["target", "list", "--installed"], { cwd: DIZIN, env, encoding: "utf8" });
  return r.status === 0 && r.stdout.split(/\r?\n/).includes(WINDOWS_HEDEFI);
}

const HIZMETLER = ["-p", "tekserp-dogrulama", "-p", "tekserp-guncelleyici", "-p", "tekserp-hizmet"];
const ADIMLAR = {
  denetle: [
    ["fmt", "--all", "--check"],
    ["clippy", "--release", "--workspace", "--all-targets", "--features", "lisans-cekirdek/test-anchor", "--", "-D", "warnings"],
    ["clippy", "--release", "-p", "lisans-cekirdek", "--all-targets", "--no-default-features", "--features", "test-anchor", "--", "-D", "warnings"],
    { windows: ["clippy", "--release", "--target", WINDOWS_HEDEFI, ...HIZMETLER, "--all-targets", "--", "-D", "warnings"] },
  ],
  test: [
    ["test", "--workspace", "--exclude", "lisans-cekirdek"],
    ["test", "-p", "lisans-cekirdek", "--no-default-features", "--features", "test-anchor"],
  ],
};

const adimlar = ADIMLAR[komut];
if (!adimlar) {
  console.error(`kullanım: node scripts/kapi.mjs <${Object.keys(ADIMLAR).join("|")}>`);
  process.exit(2);
}
const bulunan = cargoBul();
if (!bulunan) {
  console.log(`⏭  native çalışma alanı · ${komut} ÖLÇÜLMEDİ — cargo yok (rustup ile kur: Teks-Erp/native/CLAUDE.md); CI "Native" job'ları ölçer`);
  process.exit(0);
}
const env = { ...process.env, PATH: bulunan.path };
let atlanan = 0;
for (const a of adimlar) {
  if (!Array.isArray(a)) {
    // Windows'ta bu adım yerel hedefin clippy'sidir (yukarıdaki alan adımı zaten kapsar) → tekrar koşulmaz.
    if (process.platform === "win32") continue;
    if (!windowsHedefiKurulu(bulunan, env)) {
      console.log(`⏭  Windows hedefi (${WINDOWS_HEDEFI}) kurulu değil — hizmet ikililerinin Windows kodu burada ÖLÇÜLMEDİ (rustup target add ${WINDOWS_HEDEFI}); CI "Native Windows" job'ı ölçer`);
      atlanan++;
      continue;
    }
    if (kos(bulunan.cargo, env, a.windows) !== 0) process.exit(1);
    continue;
  }
  if (kos(bulunan.cargo, env, a) !== 0) process.exit(1);
}
console.log(`✅ native çalışma alanı · ${komut} temiz${atlanan ? ` (${atlanan} adım beyanla atlandı)` : ""}`);
