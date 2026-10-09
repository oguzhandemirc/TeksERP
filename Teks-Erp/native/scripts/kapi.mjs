#!/usr/bin/env node
// Native Cargo çalışma alanının commit kapısı + CI adımları (zero-dep). Üyeler: lisans-cekirdek (napi) ·
// tekserp-dogrulama (ORTAK doğrulama) · tekserp-guncelleyici · tekserp-hizmet (Windows hizmetleri).
//   denetle — `cargo fmt --all --check` + clippy (uyarı = hata): bütün alan (lisans çekirdeği test
//             çapalı) · lisans çekirdeği napi'siz · hizmet ikilileri Windows hedefinde (yalnız `check`,
//             bağlama yok — Mac'ten de ölçülür; hedef std'si kurulu değilse ⏭ beyanla, CI Windows job'ı ölçer)
//   test    — `cargo test`: alanın napi'siz üyeleri + lisans çekirdeği (TS kâhininin vektör dosyası, test çapası).
//             Gömülü çapa tek kiptir (üretim); `test-anchor` yalnız test derlemesinde dışarıdan çapa verir
//   test --kapi — commit kapısı kipi: AGIR_TESTLER (sahte dünya, ~7 dk) KOŞMAZ, ⏭ satırıyla söylenir.
//             Bayraksız kip (CI · `npm test`) onları ayrı koşar ve geçen sayıyı `#[test]` sayısıyla eşler.
// ÜÇ SONUÇ: 0 temiz · 1 ihlal · cargo YOKSA ⏭ beyanla 0 — Rust araç zinciri olmayan oturum kapıyı
// ölçemez; ölçüm CI'daki "Native" job'larındadır (sessiz yeşil değil, beyanlı atlama).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIZIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS_HEDEFI = "x86_64-pc-windows-msvc";
const komut = process.argv[2];
const KAPI_KIPI = process.argv.slice(3).includes("--kapi");

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
// Commit kapısından çıkarılan ağır test hedefleri (kullanıcı kararı 2026-10-09): yalnız CI koşar.
// Bekçi: `Teks-Erp/scripts/test_commit_gate_scope.ts` §4 (CI'da bayraksız koşum + sayım).
const AGIR_TESTLER = ["crash_restart", "pg_minor"];
const ALAN = ["--workspace", "--exclude", "lisans-cekirdek"];

/** Alanın napi'siz üyelerinin entegrasyon test hedefleri (`tests/*.rs` · `tests/<ad>/main.rs`). */
function testHedefleri() {
  const uyeler = (readFileSync(join(DIZIN, "Cargo.toml"), "utf8").match(/members\s*=\s*\[([^\]]*)\]/)?.[1] ?? "")
    .match(/"[^"]+"/g)
    .map((u) => u.slice(1, -1))
    .filter((u) => u !== "lisans-cekirdek");
  const hedefler = [];
  for (const u of uyeler) {
    const d = join(DIZIN, u, "tests");
    if (!existsSync(d)) continue;
    for (const g of readdirSync(d, { withFileTypes: true })) {
      if (g.isFile() && g.name.endsWith(".rs")) hedefler.push(g.name.slice(0, -3));
      else if (g.isDirectory() && existsSync(join(d, g.name, "main.rs"))) hedefler.push(g.name);
    }
  }
  return hedefler;
}

/** Ağır hedefin dosyasındaki `#[test]` sayısı — CI'da geçen sayı buna eşit olmalı (sessiz düşüş yok). */
function testSayisi(ad) {
  return (readFileSync(join(DIZIN, "tekserp-guncelleyici", "tests", `${ad}.rs`), "utf8").match(/^\s*#\[test\]/gm) ?? []).length;
}
const ADIMLAR = {
  denetle: [
    ["fmt", "--all", "--check"],
    ["clippy", "--release", "--workspace", "--all-targets", "--features", "lisans-cekirdek/test-anchor", "--", "-D", "warnings"],
    ["clippy", "--release", "-p", "lisans-cekirdek", "--all-targets", "--no-default-features", "--features", "test-anchor", "--", "-D", "warnings"],
    { windows: ["clippy", "--release", "--target", WINDOWS_HEDEFI, ...HIZMETLER, "--all-targets", "--", "-D", "warnings"] },
  ],
  test: [
    // Doctest yok (ölçüldü); hedef seçimi `--doc`u dışlar, bayraksız kip onu ayrıca koşar.
    { hafif: true },
    ["test", "-p", "lisans-cekirdek", "--no-default-features", "--features", "test-anchor"],
    { agir: true },
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
const hedefler = komut === "test" ? testHedefleri() : [];
const eksik = komut !== "test" ? [] : AGIR_TESTLER.filter((t) => !hedefler.includes(t));
if (eksik.length) {
  console.error(`❌ AGIR_TESTLER'de olup test hedefi olmayan: ${eksik.join(", ")} — listeyi güncelle`);
  process.exit(1);
}

/** Ağır hedefi koşar; çıktıdaki geçen sayısını `#[test]` sayısıyla eşler (0 yok sayılan, 0 süzülen). */
function agirKos(ad) {
  const args = ["test", ...ALAN, "--test", ad];
  console.log(`$ cargo ${args.join(" ")}`);
  const r = spawnSync(bulunan.cargo, args, { cwd: DIZIN, stdio: ["inherit", "pipe", "inherit"], env, timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" });
  process.stdout.write(r.stdout ?? "");
  if (r.error || r.status !== 0) return { ok: false, mesaj: r.error?.message ?? `çıkış ${r.status}` };
  const sonuc = [...(r.stdout ?? "").matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; \d+ measured; (\d+) filtered out/g)];
  const gecen = sonuc.reduce((t, m) => t + Number(m[1]), 0);
  const atlanan = sonuc.reduce((t, m) => t + Number(m[3]) + Number(m[4]), 0);
  const beklenen = testSayisi(ad);
  if (sonuc.length !== 1 || gecen !== beklenen || atlanan !== 0) {
    return { ok: false, mesaj: `${ad}: ${gecen} geçti, ${atlanan} atlandı/süzüldü — beklenen ${beklenen} (#[test] sayısı)` };
  }
  return { ok: true, gecen };
}

for (const a of adimlar) {
  if (a.hafif) {
    const hafif = hedefler.filter((t) => !AGIR_TESTLER.includes(t)).flatMap((t) => ["--test", t]);
    if (kos(bulunan.cargo, env, ["test", ...ALAN, "--lib", "--bins", ...hafif]) !== 0) process.exit(1);
    if (!KAPI_KIPI && kos(bulunan.cargo, env, ["test", ...ALAN, "--doc"]) !== 0) process.exit(1);
    continue;
  }
  if (a.agir) {
    if (KAPI_KIPI) {
      console.log(`⏭  ağır testler (${AGIR_TESTLER.join(" · ")}) commit kapısında KOŞMADI — yalnız CI koşar (Native Linux · Native Windows · ci.yml native), geçen sayısını doğrular`);
      atlanan++;
      continue;
    }
    const sayim = [];
    for (const ad of AGIR_TESTLER) {
      const s = agirKos(ad);
      if (!s.ok) {
        console.error(`❌ ağır test: ${s.mesaj}`);
        process.exit(1);
      }
      sayim.push(`${ad} ${s.gecen}`);
    }
    console.log(`✅ ağır testler koştu: ${sayim.join(" · ")} geçti (#[test] sayısına eşit)`);
    continue;
  }
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
