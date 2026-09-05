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

import { spawnSync } from "node:child_process";
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

for (const proje of etkilenenProjeler(REPO, staged)) {
  adimlar.push({ ad: `${proje.ad} · tip`, cwd: proje.ad, cmd: proje.typecheck });
  adimlar.push({ ad: `${proje.ad} · lint`, cwd: proje.ad, cmd: proje.lint });
  const anahtar = { "Teks-Erp": "backend", Electron: "electron", mobil: "mobil" }[proje.ad];
  if (existsSync(join(REPO, proje.ad, "lint-baseline.json"))) {
    adimlar.push({
      ad: `${proje.ad} · lint tavanı`,
      cwd: ".",
      cmd: ["node", ["scripts/check-lint-baseline.mjs", `--proje=${anahtar}`]],
    });
  }
  if (proje.test) adimlar.push({ ad: `${proje.ad} · test`, cwd: proje.ad, cmd: proje.test });
}

// Migration/bekçi hijyeni: bu bekçinin değeri YERELDEDİR (CI'da temiz checkout
// yüzünden "untracked migration" gibi kapıları yapısal olarak hep yeşildir).
if (staged.some((f) => f.startsWith("Teks-Erp/prisma/") || f.startsWith("Teks-Erp/scripts/"))) {
  adimlar.push({ ad: "migration hijyeni", cwd: ".", cmd: ["node", ["scripts/check-migrations.mjs"]] });
}

// Doküman kapısı: ölü link + CLAUDE.md boyut tavanı.
if (staged.some((f) => f.endsWith(".md"))) {
  adimlar.push({ ad: "doküman kapısı", cwd: ".", cmd: ["node", ["scripts/check-docs.mjs"]] });
}

if (adimlar.length === 0) process.exit(0);

process.stderr.write(`⏳ commit kapısı: ${adimlar.length} adım (${adimlar.map((a) => a.ad).join(" · ")})\n`);

for (const adim of adimlar) {
  const t0 = Date.now();
  const r = spawnSync(adim.cmd[0], adim.cmd[1], {
    cwd: join(REPO, adim.cwd),
    encoding: "utf8",
    timeout: 600_000,
    env: process.env,
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

process.stderr.write(`✅ commit kapısı temiz (${((Date.now() - basladi) / 1000).toFixed(1)}s)\n`);
process.exit(0);
