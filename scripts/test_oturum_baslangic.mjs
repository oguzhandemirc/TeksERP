#!/usr/bin/env node
// =============================================================================
// BEKÇİ — OTURUM AÇILIŞ KANCASI ÇIKTI TAVANI (scripts/claude-hooks/oturum-baslangic.mjs) · zero-dep, DB'siz
// =============================================================================
// ⭐ NEDEN VAR (2026-11-03): kanca her açılış/clear'da hafızadaki yapılacaklar listesinin
//    "ilk 40 satırı"nı basıyordu; satırlar uzadıkça ~16 bin karakter oldu ve her oturumun
//    bağlamından sessizce yedi. Satır sınırı bir boyut sınırı DEĞİLDİR ⇒ tavan karakterle ölçülür.
//
// NE ÖLÇER (gerçek kanca, sahte HOME + geçici git deposu; kullanıcı hafızasına dokunmaz):
//   §1 "## GÜNCEL DURUM" bölümü basılır, öteki bölümler basılmaz
//   §2 bölüm yoksa yalnız ilk 15 satır
//   §3 dev bölüm TAVANI (2.000 karakter) aşmaz, kesik notu taşır
//   §4 hafıza dosyası yoksa ve TEKSERP_HOOK_SKIP=1 iken sessiz, çıkış 0
//   §5 (yerel) gerçek hafıza dosyasıyla çıktı ≤ tavan — dosya yoksa ⏭ beyanla
// Kalıcı sonda: `--sonda` — kancanın bozulmuş kopyaları (tavan kaldırıldı · bölüm seçimi
//   kaldırıldı) §1/§3'e karşı koşulur; ısırmazsa KIRMIZI.
//
//   node scripts/test_oturum_baslangic.mjs [--sonda]
// =============================================================================
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const KANCA = join(KOK, "scripts", "claude-hooks", "oturum-baslangic.mjs");
const TAVAN = 2000;
const SONDA = process.argv.includes("--sonda");

let pass = 0;
let fail = 0;
let atlanan = 0;
function check(ad, ok, detay = "") {
  if (ok) { pass++; console.log(`  ✅ ${ad}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.log(`  ❌ ${ad}${detay ? ` — ${detay}` : ""}`); }
}

const uzunSatir = (i) => `- satır ${i} ` + "x".repeat(400);
const ORNEK_GUNCEL = [
  "---", "name: yapilacaklar-listesi", "---", "", "Kural satırı.", "",
  "## GÜNCEL DURUM (2026-11-03)", "- main abc1234", "- SÜREN: iş akışı", "",
  "## Eski açıklar", ...Array.from({ length: 60 }, (_, i) => uzunSatir(i)),
].join("\n");
const ORNEK_BOLUMSUZ = Array.from({ length: 40 }, (_, i) => `satir-${i}`).join("\n");
const ORNEK_DEV = ["## GÜNCEL DURUM", ...Array.from({ length: 40 }, (_, i) => uzunSatir(i)), "## Sonraki"].join("\n");

/** Geçici git deposu + sahte HOME kurar, kancayı (ya da bozulmuş kopyasını) koşar. */
function kos(kancaYolu, hafiza, ekEnv = {}) {
  const kum = mkdtempSync(join(tmpdir(), "tekserp-oturum-"));
  try {
    const repo = join(kum, "repo");
    const home = join(kum, "home");
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
    const ortak = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: repo, encoding: "utf8" }).trim();
    const anahtar = resolve(dirname(ortak)).replace(/[^A-Za-z0-9]/g, "-");
    if (hafiza !== null) {
      const dizin = join(home, ".claude", "projects", anahtar, "memory");
      mkdirSync(dizin, { recursive: true });
      writeFileSync(join(dizin, "yapilacaklar-listesi.md"), hafiza);
    }
    const env = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: repo, ...ekEnv };
    delete env.GIT_DIR; delete env.GIT_INDEX_FILE; delete env.GIT_WORK_TREE;
    if (!("TEKSERP_HOOK_SKIP" in ekEnv)) delete env.TEKSERP_HOOK_SKIP;
    const r = spawnSync(process.execPath, [kancaYolu], { cwd: repo, env, encoding: "utf8", timeout: 20_000 });
    return { cikti: r.stdout ?? "", kod: r.status };
  } finally {
    rmSync(kum, { recursive: true, force: true });
  }
}

/** §1 ve §3 yüklemleri — sonda bunları bozulmuş kancaya karşı da koşar. */
function bolumSecimiDogru(kancaYolu) {
  const { cikti } = kos(kancaYolu, ORNEK_GUNCEL);
  return cikti.includes("- main abc1234") && cikti.includes("- SÜREN: iş akışı") && !cikti.includes("Eski açıklar") && !cikti.includes("satır 0 ");
}
function tavanTutuyor(kancaYolu) {
  const { cikti } = kos(kancaYolu, ORNEK_DEV);
  return { ok: cikti.length > 0 && cikti.length <= TAVAN && cikti.includes("kesildi"), uzunluk: cikti.length };
}

function dinlenme() {
  console.log("=== Oturum açılış kancası çıktı tavanı ===\n");
  check("§1 ⭐ yalnız \"## GÜNCEL DURUM\" bölümü basılır (öteki bölümler basılmaz)", bolumSecimiDogru(KANCA));

  const b = kos(KANCA, ORNEK_BOLUMSUZ).cikti;
  check("§2 bölüm yoksa ilk 15 satır", b.includes("satir-14") && !b.includes("satir-15") && b.length <= TAVAN, `${b.length} karakter`);

  const t = tavanTutuyor(KANCA);
  check(`§3 ⭐ dev bölüm tavanı (${TAVAN} karakter) aşmaz, kesik notu taşır`, t.ok, `${t.uzunluk} karakter`);

  const yok = kos(KANCA, null);
  check("§4a hafıza dosyası yoksa sessiz, çıkış 0", yok.cikti === "" && yok.kod === 0);
  const skip = kos(KANCA, ORNEK_GUNCEL, { TEKSERP_HOOK_SKIP: "1" });
  check("§4b TEKSERP_HOOK_SKIP=1 iken sessiz, çıkış 0", skip.cikti === "" && skip.kod === 0);

  // §5 gerçek hafıza (yerel ölçüm): yalnız OKUR; CI'da dosya yoktur ⇒ ⏭ beyan.
  const gercek = spawnSync(process.execPath, [KANCA], { cwd: KOK, env: { ...process.env, CLAUDE_PROJECT_DIR: KOK, TEKSERP_HOOK_SKIP: "" }, encoding: "utf8", timeout: 20_000 });
  const g = gercek.stdout ?? "";
  if (g === "") { atlanan++; console.log(`  ⏭ §5 gerçek hafıza dosyası yok (${join(homedir(), ".claude", "projects")}) — ölçülemedi`); }
  else check(`§5 gerçek hafızayla çıktı ≤ ${TAVAN} karakter`, g.length <= TAVAN, `${g.length} karakter`);
}

function sonda() {
  console.log("=== Oturum açılış kancası — negatif sondalar ===\n");
  const kaynak = readFileSync(KANCA, "utf8");
  const kum = mkdtempSync(join(tmpdir(), "tekserp-oturum-sonda-"));
  try {
    const mutantlar = [
      { ad: "tavan kaldırıldı", eski: "if (tam.length <= TAVAN_KARAKTER) return tam;", yeni: "return tam;", yuklem: () => tavanTutuyor(join(kum, "oturum-baslangic.mjs")).ok },
      { ad: "bölüm seçimi kaldırıldı (eski 40 satır)", eski: "const bas = satirlar.findIndex((s) => /^##\\s+GÜNCEL DURUM/.test(s));", yeni: "const bas = -1;", yuklem: () => bolumSecimiDogru(join(kum, "oturum-baslangic.mjs")) },
    ];
    for (const m of mutantlar) {
      check(`sonda '${m.ad}': mutasyon UYGULANDI`, kaynak.includes(m.eski));
      writeFileSync(join(kum, "oturum-baslangic.mjs"), kaynak.replace(m.eski, m.yeni));
      check(`sonda '${m.ad}': bekçi ISIRIYOR`, m.yuklem() === false);
    }
  } finally {
    rmSync(kum, { recursive: true, force: true });
  }
}

if (SONDA) sonda();
else dinlenme();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlanan ? `, ${atlanan} atlandı` : ""} ===`);
process.exitCode = fail > 0 ? 1 : 0;
