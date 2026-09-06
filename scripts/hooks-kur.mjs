#!/usr/bin/env node
// =============================================================================
// Commit kapısını kur/kaldır: git'in hook dizinini .githooks'a çevirir.
// =============================================================================
// `core.hooksPath` seçildi çünkü `.git/hooks` VERSİYONLANMAZ: her klon ve her
// yeni makine kapısız başlar ve bunu kimse fark etmez (2026-09-05'te tam olarak
// bu oldu — yerelde hiç hook yoktu). `.githooks/` repoda durur, tek komutla
// bağlanır ve `git config` çıktısında GÖRÜNÜR.
//
//   node scripts/hooks-kur.mjs          # kur
//   node scripts/hooks-kur.mjs --kaldir # kaldır (varsayılana dön)
//   node scripts/hooks-kur.mjs --durum  # kurulu mu
// =============================================================================
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
const arg = process.argv[2];

let mevcut = "";
try { mevcut = git(["config", "--get", "core.hooksPath"]); } catch { mevcut = ""; }

if (arg === "--durum") {
  console.log(mevcut === ".githooks" ? "✅ commit kapısı KURULU (core.hooksPath=.githooks)" : `⚠️  kapı kurulu değil (core.hooksPath=${mevcut || "<varsayılan>"}) → node scripts/hooks-kur.mjs`);
  process.exit(0);
}
if (arg === "--kaldir") {
  try { git(["config", "--unset", "core.hooksPath"]); } catch { /* zaten yok */ }
  console.log("🔓 commit kapısı kaldırıldı (core.hooksPath sıfırlandı).");
  process.exit(0);
}
git(["config", "core.hooksPath", ".githooks"]);
console.log("✅ commit kapısı kuruldu: core.hooksPath=.githooks");
console.log("   Koşan adımlar değişene orantılıdır (tip · lint · lint tavanı · o projenin hızlı testi).");
console.log("   Kaçış: TEKSERP_HOOK_SKIP=1 git commit …   ·   Kaldır: node scripts/hooks-kur.mjs --kaldir");
