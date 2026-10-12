#!/usr/bin/env node
// Claude Code SessionStart hook (startup|clear): kullanıcı hafızasındaki
// `yapilacaklar-listesi.md`nin ilk 40 satırını bağlama basar — oturum devir notu
// okumadan güncel iş listesiyle açılır. Her hatada sessizce çıkar (exit 0).
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

if (process.env.TEKSERP_HOOK_SKIP === "1") process.exit(0);
try {
  // Worktree'de de ANA ağacın hafızası okunur: proje anahtarı ortak git dizininden çözülür.
  const ortak = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const anaAgac = resolve(dirname(ortak));
  const anahtar = anaAgac.replace(/[^A-Za-z0-9]/g, "-");
  const dosya = join(homedir(), ".claude", "projects", anahtar, "memory", "yapilacaklar-listesi.md");
  if (!existsSync(dosya)) process.exit(0);
  const govde = readFileSync(dosya, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
  const satirlar = govde.split("\n").slice(0, 40).join("\n");
  process.stdout.write(`## Yapılacaklar (hafıza: yapilacaklar-listesi.md, ilk 40 satır)\n${satirlar}\n`);
} catch {
  // sessiz: kanca oturumu asla engellemez
}
process.exit(0);
