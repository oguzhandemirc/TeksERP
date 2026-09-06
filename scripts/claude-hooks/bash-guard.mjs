#!/usr/bin/env node
// =============================================================================
// Claude Code PreToolUse hook — Bash komut kapısı (2026-09-05).
// Kök CLAUDE.md'deki "yasak komut" kuralları burada MEKANİKTİR: modelin hafızasına
// değil kapıya bağlıdır. stdin: {tool_name, tool_input:{command}}. exit 2 = engelle
// (stderr Claude'a gösterilir), exit 0 = izin. Kaçış: TEKSERP_HOOK_SKIP=1.
//
// `git commit`te kapı ÇALIŞTIRMAZ, `scripts/hooks/pre-commit.mjs`i ÇAĞIRIR: adım
// listesi (tip · lint · lint tavanı · o projenin hızlı testi) tek yerde yaşasın.
// Buraya kopyalanan bir adım listesi ayrışırdı — biri commit'i durdurur öbürü
// geçirirdi ve hangisinin doğru olduğu belli olmazdı (kök CLAUDE.md § Tek kaynak).
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { etkilenenProjeler, stagedFiles } from "../hooks/lib/staged.mjs";

// Depo kökü DOSYA KONUMUNDAN çözülür: Bash aracının cwd'si bir alt dizin
// olabilir ve o zaman `process.cwd()` staged çözümünü sessizce boşa düşürürdü.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
if (process.env.TEKSERP_HOOK_SKIP === "1") process.exit(0);
let input = "";
try { input = readFileSync(0, "utf8"); } catch { process.exit(0); }
let payload;
try { payload = JSON.parse(input || "{}"); } catch { process.exit(0); }
if (payload.tool_name !== "Bash") process.exit(0);
const cmd = String(payload.tool_input?.command ?? "");
if (!cmd.trim()) process.exit(0);

// --- 1) Yasak komutlar (kök CLAUDE.md § Yasaklar) ---
const BANS = [
  { re: /pkill\s+-f\s+["']?tsx/i, why: "`pkill -f tsx` YASAK — başkasının sunucusunu da öldürür. Yalnız kendi başlattığın PID'i durdur ya da ayrı port kullan (docs/GELISTIRME-DONGUSU.md)." },
  { re: /\bkillall\s+(node|tsx)\b/i, why: "`killall node` YASAK — tek-process invariantı: yalnız kendi PID'in." },
  { re: /prisma\s+migrate\s+reset\b/i, why: "`prisma migrate reset` YASAK — PRODUCTION CANLI kuralı; dev DB'de bile fixture'ları ve `_prisma_migrations` defterini sıfırlar. Yedekten restore ya da `<canlı>_restore_<damga>` kopyası kullan." },
  { re: /prisma\s+migrate\s+dev\b(?![^\n]*--create-only)/i, why: "`prisma migrate dev` (create-only'siz) YASAK — iki DEFERRABLE composite FK'yı DROP etmek ister. Yeni migration: `prisma migrate dev --create-only` + DropForeignKey satırlarını sil; pull'lanmış migration: `npm run prisma:migrate` (deploy)." },
  { re: /prisma\s+db\s+push\b/i, why: "`prisma db push` YASAK — migration defteri olmadan şema yazar, drift bekçisi kırmızıya döner. Migration yaz." },
  { re: /\b(TRUNCATE|DROP\s+(TABLE|DATABASE|SCHEMA))\b/i, why: "`TRUNCATE` / `DROP TABLE|DATABASE` YASAK — canlı veri kuralı. Kopya DB'de çalış (`db-copy`), toplu düzeltme script'i dry-run + `--apply`." },
  { re: /\bDELETE\s+FROM\b(?![^\n]*\bWHERE\b)/i, why: "WHERE'siz `DELETE FROM` YASAK — toplu DELETE canlı veri kuralına aykırı; soft delete ya da dry-run'lı script." },
  { re: /git\s+push\b[^\n]*(--force\b|\s-f\b)/i, why: "`git push --force` YASAK — paylaşılan dalın geçmişini ezer. Gerekiyorsa kullanıcı `!` ile kendisi koşar." },
  { re: /npm\s+run\s+build:win\b/i, why: "Ham `npm run build:win` YASAK — bir önceki müşterinin yayın adresiyle derler. `./deploy/electron-paketle.sh <müşteri>` kullan." },
  { re: /gradlew\s+assembleRelease\b/i, why: "`./gradlew assembleRelease` ELLE ÇAĞRILMAZ — `cd mobil && npm run build:apk -- --musteri=<kod>` (adres doğrulaması + bundle kontrolü)." },
];
for (const b of BANS) {
  if (b.re.test(cmd)) {
    process.stderr.write(`⛔ Komut kapısı: ${b.why}\n(kaçış yalnız kullanıcı kararıyla: TEKSERP_HOOK_SKIP=1)\n`);
    process.exit(2);
  }
}

// --- 2) git commit → ORTAK commit kapısı ---
// Kaçışlar (`--no-verify`, TEKSERP_HOOK_SKIP=1) git hook'uyla aynı anlamı taşır:
// kırmızıyı bilerek geçmek bir karardır, kapı onu tekrar dayatmaz.
if (/\bgit\s+commit\b/.test(cmd) && !/--no-verify/.test(cmd)) {
  // Git'in kendi kapısı kuruluysa BU hook susar: aynı adımlar iki kez koşarsa
  // commit başına ödenen süre ikiye katlanır (ölçüm: Electron 23 sn + mobil 29 sn).
  let hooksPath = "";
  try { hooksPath = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: REPO, encoding: "utf8" }).trim(); } catch { hooksPath = ""; }
  const gitKapisiKurulu = hooksPath === ".githooks" && existsSync(join(REPO, ".githooks", "pre-commit"));

  const staged = stagedFiles(REPO);
  if (staged.length === 0 || gitKapisiKurulu) process.exit(0);

  const projeler = etkilenenProjeler(REPO, staged).map((p) => p.ad);
  process.stderr.write(
    `⏳ commit kapısı (git hook'u KURULU DEĞİL → Claude tarafından koşuluyor)` +
      `${projeler.length ? `: ${projeler.join(" · ")}` : ""}\n` +
      `   Kalıcı kurulum: node scripts/hooks-kur.mjs\n`,
  );
  const r = spawnSync("node", [join(REPO, "scripts", "hooks", "pre-commit.mjs")], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 600_000,
    env: process.env,
  });
  if (r.status !== 0 || r.error) {
    process.stderr.write(
      `${r.stdout || ""}${r.stderr || ""}\n` +
        `⛔ commit kapısı KIRMIZI (çıkış ${r.status ?? r.error?.code}). Hata düzeltilmeden commit atılmaz.\n`,
    );
    process.exit(2);
  }
  process.stderr.write(r.stderr || "");
}
process.exit(0);
