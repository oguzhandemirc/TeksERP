#!/usr/bin/env node
// =============================================================================
// GIT PRE-COMMIT KAPISI — zero-dep (husky/lefthook YOK, paket eklemedik).
// =============================================================================
// NEDEN VAR (2026-09-05 ölçümü): yerelde hiçbir git hook'u yoktu. Tip kontrolü
// yalnız Claude'un Bash aracındaki PreToolUse hook'unda koşuyordu, yani KİMSE
// elle commit attığında koşmuyordu — ve main'de 9 tip hatası + 7 kırmızı test
// bir gün boyunca durdu. CI de yakalamadı çünkü Electron tip adımı no-op'tu.
//
// ÖLÇÜM (2026-09-05): tek proje değiştiğinde 30-50 sn; ÜÇ proje birden
// değiştiğinde 13 adım / 142 sn. Bedel değişenle orantılıdır, commit'in kendisiyle değil.
//
// KADANS (docs/standart/TEST-VE-DERLEME.md): commit anında UCUZ ve DEĞİŞENE
// ORANTILI kapılar koşar — değişen alt projede tip + lint + lint tavanı, ve o
// projenin HIZLI test paketi (Electron 23sn / mobil 29sn). Backend bekçi paketi
// (6,5 dk) commit kadansında DEĞİLDİR; o PR/push öncesidir.
//
// Kaçış: `TEKSERP_HOOK_SKIP=1 git commit …` ya da `git commit --no-verify`.
// Kaçış bir KARARDIR: kırmızıyı bilerek geçiyorsan commit mesajında söyle.
//
// Kurulum: node scripts/hooks-kur.mjs   (git config core.hooksPath .githooks)
// =============================================================================

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { etkilenenProjeler, stagedFiles } from "./lib/staged.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

if (process.env.TEKSERP_HOOK_SKIP === "1") {
  process.stderr.write("⚠️  commit kapısı ATLANDI (TEKSERP_HOOK_SKIP=1)\n");
  process.exit(0);
}

const staged = stagedFiles(REPO);
if (staged.length === 0) process.exit(0);

const basladi = Date.now();
const adimlar = [];

const headOku = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};
const headBasta = headOku();

for (const proje of etkilenenProjeler(REPO, staged)) {
  adimlar.push({ ad: `${proje.ad} · tip`, cwd: proje.ad, cmd: proje.typecheck });
  // Lint doğrudan değil KAPI üzerinden: taranan küme aynı kalır (tavan aynı kümeyi
  // ölçmek zorunda), yalnız verdikt commit'in kendi dosyalarına daralır. Staged liste
  // stdin'den geçer — kapı tabanı yeniden türetmesin (bkz. lint-gate.mjs § KÜME).
  adimlar.push({
    ad: `${proje.ad} · lint`,
    cwd: ".",
    cmd: ["node", ["scripts/hooks/lint-gate.mjs", `--proje=${proje.ad}`]],
    stdin: `${staged.join("\n")}\n`,
  });
  const anahtar = { "Teks-Erp": "backend", Electron: "electron", mobil: "mobil" }[proje.ad];
  if (existsSync(join(REPO, proje.ad, "lint-baseline.json"))) {
    adimlar.push({
      ad: `${proje.ad} · lint tavanı`,
      cwd: ".",
      // Tavan da commit kapısı kipinde: SAYIM proje geneli kalır (tabanla
      // karşılaştırılabilir olmalı), yalnız VERDİKT bu commit'in dosyalarına bakar.
      cmd: ["node", ["scripts/check-lint-baseline.mjs", `--proje=${anahtar}`, "--commit-kapisi"]],
      stdin: `${staged.join("\n")}\n`,
    });
  }
  if (proje.test) adimlar.push({ ad: `${proje.ad} · test`, cwd: proje.ad, cmd: proje.test });
}

// Migration/bekçi hijyeni: bu bekçinin değeri YERELDEDİR (CI'da temiz checkout
// yüzünden "untracked migration" gibi kapıları yapısal olarak hep yeşildir).
if (staged.some((f) => f.startsWith("Teks-Erp/prisma/") || f.startsWith("Teks-Erp/scripts/"))) {
  // `--commit-kapisi` + stdin: takipsiz kapılar (GATE 1/4) yalnız commit
  // migration'a dokunuyorsa SERT; yoksa uyarı (bkz. check-migrations.mjs § COMMIT
  // KAPISI KİPİ). Bayraksız çağrı — CI, `npm test` — sert davranışı korur.
  adimlar.push({
    ad: "migration hijyeni",
    cwd: ".",
    cmd: ["node", ["scripts/check-migrations.mjs", "--commit-kapisi"]],
    stdin: `${staged.join("\n")}\n`,
  });
}

// TANIMLAYICI DİLİ ([IL-16]): üretim kodunda İngilizce. ESLint bunu ölçemiyor —
// yalnız Türkçe KARAKTERİ yasaklıyor, ASCII yazılmış Türkçe KELİMEYİ değil.
// ⚠️ KAPIDA OLMASI ŞART: bu tam olarak "commit ederken fark edilmezse bir daha
// hiç fark edilmez" sınıfı. 2026-09-10'da tek oturumda 8 tanımlayıcı bu şekilde
// girdi ve hiçbir şey ses çıkarmadı. Yalnız `src/` değişince koşar (0,4 sn).
if (staged.some((f) => /^(Teks-Erp|Electron|mobil)\/src\/.*\.tsx?$/.test(f))) {
  adimlar.push({
    ad: "tanımlayıcı dili",
    cwd: "Teks-Erp",
    cmd: ["npx", ["tsx", "scripts/test_identifier_language.ts"]],
    // ⚠️ KAPSAM LİSTESİ BURADAN GİDER, bekçi kendisi TÜRETMEZ. Altı oturum aynı
    // ağacı paylaşıyor: bekçi ağaca baksa BAŞKASININ commit edilmemiş dosyasındaki
    // ihlalden bizi durdururdu (2026-09-13 gecesi tam olarak bu oldu). Liste
    // `stagedFiles()`ten gelir — `git status`tan DEĞİL: kısmi commit'te geçici
    // indeks yüzünden o yanlış cevap verir.
    env: { TEKSERP_KOMIT_DOSYALARI: staged.join("\n") },
  });
}

// Doküman kapısı: ölü link + CLAUDE.md boyut tavanı.
if (staged.some((f) => f.endsWith(".md"))) {
  adimlar.push({ ad: "doküman kapısı", cwd: ".", cmd: ["node", ["scripts/check-docs.mjs"]] });
}

// ⚠️ SÜRÜM NOTU KAPISI: notlar YAYIN KAPISIDIR ama gövdeleri `.json`, ve proje
// adımları yalnız `.ts/.tsx` değişiminde doğuyor — yani not commit'leri HİÇ adım
// koşmadan iniyordu (ölçüldü 2026-09-12: notlara dokunan 22 commit'in 16'sı
// YALNIZ `.json` değiştirmiş). Kapı zaten vardı, tetiği yoktu. Yollar ADIYLA
// listelenir: `src/data/` altında bugün başka üretilmiş dosya YOK (ölçüldü) ve
// jenerik bir `.json` deseni ölçülmemiş bir kapsam iddia ederdi.
const SURUM_NOTU_YOLLARI = new Set([
  "surum-notlari.json",
  "Electron/src/data/surum-notlari.json",
  "mobil/src/data/surum-notlari.json",
]);
if (staged.some((f) => SURUM_NOTU_YOLLARI.has(f))) {
  adimlar.push({
    ad: "sürüm notu kapısı",
    cwd: ".",
    cmd: ["node", ["scripts/check-surum-notlari.mjs"]],
  });
}

if (adimlar.length === 0) process.exit(0);

process.stderr.write(`⏳ commit kapısı: ${adimlar.length} adım (${adimlar.map((a) => a.ad).join(" · ")})\n`);

for (const adim of adimlar) {
  const t0 = Date.now();
  const r = spawnSync(adim.cmd[0], adim.cmd[1], {
    cwd: join(REPO, adim.cwd),
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, ...(adim.env ?? {}) },
    ...(adim.stdin === undefined ? {} : { input: adim.stdin }),
  });
  const sn = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 0 && !r.error) {
    process.stderr.write(`   ✅ ${adim.ad} (${sn}s)\n`);
    continue;
  }
  const govde = `${r.stdout || ""}\n${r.stderr || ""}`.split("\n").filter(Boolean).slice(-30).join("\n");
  process.stderr.write(
    `   ❌ ${adim.ad} KIRMIZI (${sn}s, çıkış ${r.status ?? r.error?.code})\n` +
      `${govde.replace(/^/gm, "      | ")}\n\n` +
      `⛔ Commit atılmadı. Bilerek geçmek gerekiyorsa: TEKSERP_HOOK_SKIP=1 git commit …\n`,
  );
  process.exit(1);
}

// ⚠️ Ortak çalışma ağacında başka bir oturum, biz kapıyı koştururken commit atmış
// olabilir. Git'in ref kilidi ATOMİKTİR — commit sessizce ezilmez, `fatal: cannot
// lock ref 'HEAD'` ile GÜRÜLTÜLÜ düşer; yani korunması gereken korunuyor. Kaybedilen
// tek şey bu koşumun süresidir (ölçüm 2026-09-12: 48 sn). İNİŞ KİLİDİ ÖNERİLMEDİ:
// bayat kilit beş oturumu birden iniş-siz bırakır ve zaman aşımı eşiği seçilemez
// (kapı 48 sn ↔ `npm test` 6,5 dk). Anlaşma kalır, teşhis eklenir.
const headSonda = headOku();
if (headBasta && headSonda && headBasta !== headSonda) {
  process.stderr.write(
    `⚠️  HEAD koşum sırasında kaydı (${headBasta.slice(0, 8)} → ${headSonda.slice(0, 8)}).\n` +
      `   Commit REDDEDİLECEK (ref kilidi). Kayıp yok: staged dosyalar index'te kalır.\n` +
      `   Yap: git log --oneline -1 ile yeni ucu gör, sonra commit'i TEKRARLA.\n`,
  );
}

process.stderr.write(`✅ commit kapısı temiz (${((Date.now() - basladi) / 1000).toFixed(1)}s)\n`);
process.exit(0);
